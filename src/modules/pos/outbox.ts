/**
 * The offline outbox (ARCHITECTURE.md "Offline POS", CLAUDE.md #7). Every order, kitchen send and
 * payment is written here first and then pushed to the server in order. Each operation carries a
 * client-generated id or idempotency key, so replaying one whose response was lost never creates a
 * second row: "sync exactly once" is the server's idempotency plus this queue never dropping work.
 *
 * Only these three operations go through the outbox. Voids, refunds, discounts and cancels need a
 * live manager approval (ADR 0014) and stay online-only.
 *
 * Pure module: storage and transport are injected, so the engine is unit-tested in Node.
 */

export interface SubmitOrderOp {
  kind: 'submit_order';
  args: {
    orgId: string;
    branchId: string;
    orderId: string;
    idempotencyKey: string;
    deviceId: string;
    staffId: string;
    channelId: string;
    tableId: string | null;
    placedAt: string;
    lines: {
      menu_item_id: string;
      quantity: number;
      variant_id?: string;
      modifier_ids?: string[];
      note?: string;
      client_unit_price_poisha?: number;
    }[];
    provisionalReceiptNo: string | null;
  };
}
export interface SendToKitchenOp {
  kind: 'send_to_kitchen';
  args: { orgId: string; branchId: string; orderId: string; deviceId: string; staffId: string };
}
export interface RecordPaymentOp {
  kind: 'record_payment';
  args: {
    orgId: string;
    branchId: string;
    orderId: string;
    method: string;
    amountPoisha: number;
    reference: string | null;
    idempotencyKey: string;
    deviceId: string;
    staffId: string;
  };
}
export type OutboxOp = SubmitOrderOp | SendToKitchenOp | RecordPaymentOp;

export interface OutboxEntry {
  id: string;
  seq: number;
  /** Operations for one order run strictly in order; a failure blocks the rest of that order. */
  orderId: string;
  op: OutboxOp;
  createdAt: string;
  attempts: number;
  status: 'pending' | 'failed';
  error?: string;
}

export interface OutboxStore {
  all(): Promise<OutboxEntry[]>;
  put(entry: OutboxEntry): Promise<void>;
  remove(id: string): Promise<void>;
}

export type Transport = (op: OutboxOp) => Promise<unknown>;

export interface FlushResult {
  synced: number;
  failed: number;
  pending: number;
  /** True when a network error stopped the flush; the remaining work waits for the next attempt. */
  offline: boolean;
  /** Server responses for the entries synced in this flush, keyed by entry id. */
  results: Map<string, { entry: OutboxEntry; result: unknown }>;
}

/**
 * A network failure (no response, or a gateway that isn't PostgREST) is retried; a Postgres or
 * PostgREST error with a code is a real refusal and is parked as failed for a person to look at.
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (typeof error !== 'object' || error === null) return true;
  const code = (error as { code?: unknown }).code;
  return typeof code !== 'string' || code.trim() === '';
}

function describe(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    return [code, message].filter((v) => typeof v === 'string' && v !== '').join(': ');
  }
  return String(error);
}

export class Outbox {
  private flushing: Promise<FlushResult> | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private readonly store: OutboxStore,
    private readonly transport: Transport,
    private readonly makeId: () => string,
    private readonly clockIso: () => string,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  async entries(): Promise<OutboxEntry[]> {
    return (await this.store.all()).sort((a, b) => a.seq - b.seq);
  }

  async enqueue(orderId: string, op: OutboxOp): Promise<OutboxEntry> {
    const existing = await this.store.all();
    const seq = existing.reduce((max, e) => Math.max(max, e.seq), 0) + 1;
    const entry: OutboxEntry = {
      id: this.makeId(),
      seq,
      orderId,
      op,
      createdAt: this.clockIso(),
      attempts: 0,
      status: 'pending',
    };
    await this.store.put(entry);
    this.notify();
    return entry;
  }

  /** Drop a failed entry and everything queued after it for the same order. */
  async discard(entryId: string): Promise<void> {
    const all = await this.entries();
    const target = all.find((e) => e.id === entryId);
    if (!target) return;
    for (const e of all) {
      if (e.orderId === target.orderId && e.seq >= target.seq) await this.store.remove(e.id);
    }
    this.notify();
  }

  /** One flush at a time; a second caller shares the flush already running. */
  flush(): Promise<FlushResult> {
    if (!this.flushing) {
      this.flushing = this.run().finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async run(): Promise<FlushResult> {
    const result: FlushResult = {
      synced: 0,
      failed: 0,
      pending: 0,
      offline: false,
      results: new Map(),
    };
    const blocked = new Set<string>();
    for (const entry of await this.entries()) {
      if (entry.status === 'failed') {
        blocked.add(entry.orderId);
        result.failed++;
        continue;
      }
      if (result.offline || blocked.has(entry.orderId)) {
        result.pending++;
        continue;
      }
      try {
        const response = await this.transport(entry.op);
        await this.store.remove(entry.id);
        result.synced++;
        result.results.set(entry.id, { entry, result: response });
      } catch (error) {
        if (isNetworkError(error)) {
          await this.store.put({ ...entry, attempts: entry.attempts + 1 });
          result.offline = true;
          result.pending++;
        } else {
          await this.store.put({
            ...entry,
            attempts: entry.attempts + 1,
            status: 'failed',
            error: describe(error),
          });
          blocked.add(entry.orderId);
          result.failed++;
        }
      }
    }
    this.notify();
    return result;
  }
}

export function memoryStore(): OutboxStore {
  const rows = new Map<string, OutboxEntry>();
  return {
    all: async () => [...rows.values()].map((r) => structuredClone(r)),
    put: async (entry) => {
      rows.set(entry.id, structuredClone(entry));
    },
    remove: async (id) => {
      rows.delete(id);
    },
  };
}
