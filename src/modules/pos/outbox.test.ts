import { describe, expect, it } from 'vitest';
import { isNetworkError, memoryStore, Outbox, type OutboxOp, type Transport } from './outbox';

/**
 * A stand-in for the server with the same idempotency rules as submit_order / record_payment /
 * send_to_kitchen. tests/db/pos-integrity.test.ts ("offline replay is exactly-once") proves the real RPCs do.
 */
function fakeServer() {
  const orders = new Map<string, { id: string; sent: boolean }>();
  const payments = new Map<string, { orderId: string; amount: number }>();
  let online = false;
  /** Commit on the server, then drop the response — the classic "did it go through?" case. */
  let loseNextResponses = 0;

  const apply = (op: OutboxOp): unknown => {
    switch (op.kind) {
      case 'submit_order': {
        const existing = [...orders.values()].find((o) => o.id === op.args.orderId);
        if (existing) return existing;
        const row = { id: op.args.orderId, sent: false };
        orders.set(op.args.idempotencyKey, row);
        return row;
      }
      case 'send_to_kitchen': {
        const order = [...orders.values()].find((o) => o.id === op.args.orderId);
        if (!order) throw { code: 'P0002', message: 'order not found' };
        order.sent = true;
        return null;
      }
      case 'record_payment': {
        if (!payments.has(op.args.idempotencyKey))
          payments.set(op.args.idempotencyKey, {
            orderId: op.args.orderId,
            amount: op.args.amountPoisha,
          });
        return null;
      }
    }
  };

  const transport: Transport = async (op) => {
    if (!online) throw new TypeError('Failed to fetch');
    const response = apply(op);
    if (loseNextResponses > 0) {
      loseNextResponses--;
      throw { code: '', message: 'TypeError: network connection lost' };
    }
    return response;
  };
  return {
    transport,
    orders,
    payments,
    goOnline: () => (online = true),
    loseResponses: (n: number) => (loseNextResponses = n),
  };
}

let counter = 0;
const id = () => `id-${++counter}`;
const clock = () => '2026-09-21T17:30:00.000Z';
const base = {
  orgId: 'org',
  branchId: 'branch',
  deviceId: 'device',
  staffId: 'staff',
};

async function queueOrder(outbox: Outbox, n: number) {
  const orderId = `order-${n}`;
  await outbox.enqueue(orderId, {
    kind: 'submit_order',
    args: {
      ...base,
      orderId,
      idempotencyKey: `order-key-${n}`,
      channelId: 'channel',
      tableId: null,
      placedAt: clock(),
      lines: [{ menu_item_id: 'item', quantity: 1 }],
      provisionalReceiptNo: `P-${n}`,
    },
  });
  await outbox.enqueue(orderId, { kind: 'send_to_kitchen', args: { ...base, orderId } });
  await outbox.enqueue(orderId, {
    kind: 'record_payment',
    args: {
      ...base,
      orderId,
      method: 'cash',
      amountPoisha: 25_000,
      reference: null,
      idempotencyKey: `pay-key-${n}`,
    },
  });
}

describe('offline outbox', () => {
  it('20 orders created with the network off sync exactly once after reconnect', async () => {
    const server = fakeServer();
    const outbox = new Outbox(memoryStore(), server.transport, id, clock);
    for (let n = 1; n <= 20; n++) await queueOrder(outbox, n);

    const offline = await outbox.flush();
    expect(offline.offline).toBe(true);
    expect(offline.synced).toBe(0);
    expect(await outbox.entries()).toHaveLength(60);
    expect(server.orders.size).toBe(0);

    // Back online, but the first responses are lost after the server committed them.
    server.goOnline();
    server.loseResponses(3);
    let rounds = 0;
    while ((await outbox.entries()).length > 0 && rounds < 10) {
      await outbox.flush();
      rounds++;
    }

    expect(await outbox.entries()).toHaveLength(0);
    expect(server.orders.size).toBe(20);
    expect(server.payments.size).toBe(20);
    expect([...server.orders.values()].every((o) => o.sent)).toBe(true);
  });

  it('keeps order within an order and parks a refused operation without losing later ones', async () => {
    const server = fakeServer();
    server.goOnline();
    const refused: Transport = async (op) => {
      if (op.kind === 'submit_order' && op.args.orderId === 'order-2')
        throw { code: '22023', message: 'menu item is not available at this branch' };
      return server.transport(op);
    };
    const outbox = new Outbox(memoryStore(), refused, id, clock);
    await queueOrder(outbox, 1);
    await queueOrder(outbox, 2);
    await queueOrder(outbox, 3);

    const result = await outbox.flush();
    expect(result.synced).toBe(6);
    expect(result.failed).toBe(1);
    expect(result.pending).toBe(2);
    const left = await outbox.entries();
    expect(left.map((e) => [e.orderId, e.op.kind, e.status])).toEqual([
      ['order-2', 'submit_order', 'failed'],
      ['order-2', 'send_to_kitchen', 'pending'],
      ['order-2', 'record_payment', 'pending'],
    ]);
    expect(left[0]!.error).toContain('22023');

    await outbox.discard(left[0]!.id);
    expect(await outbox.entries()).toHaveLength(0);
  });

  it('shares one flush between concurrent callers', async () => {
    const server = fakeServer();
    server.goOnline();
    let calls = 0;
    const counting: Transport = async (op) => {
      calls++;
      return server.transport(op);
    };
    const outbox = new Outbox(memoryStore(), counting, id, clock);
    await queueOrder(outbox, 1);
    const [a, b] = await Promise.all([outbox.flush(), outbox.flush()]);
    expect(a).toBe(b);
    expect(calls).toBe(3);
  });

  it('tells network failures from server refusals', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError({ code: '', message: 'TypeError: Failed to fetch' })).toBe(true);
    expect(isNetworkError({ message: 'Bad gateway' })).toBe(true);
    expect(isNetworkError({ code: '42501', message: 'not allowed' })).toBe(false);
    expect(isNetworkError({ code: 'PGRST202', message: 'function not found' })).toBe(false);
  });
});
