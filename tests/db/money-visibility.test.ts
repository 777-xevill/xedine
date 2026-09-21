/**
 * ADR 0007 / ROADMAP Phase 0 "Done when": a branch manager cannot read any cost, margin or profit
 * value, proven at the SQL layer. The list below is deliberately hand-written (not derived from the
 * policy engine) so it fails if the engine and the decision ever drift apart.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureRow, type BuildContext } from './fixture-builder';
import {
  addMember,
  admin,
  asUser,
  closePool,
  createOrg,
  type TestOrg,
  type TestUser,
} from './harness';

/** Cost, margin, profit and finding-impact data: owner + accountant only. */
const MONEY_ONLY_TABLES = [
  'channel_commissions',
  'ingredient_costs',
  'order_item_costs',
  'fixed_costs',
  'salary_entries',
  'advances',
  'findings',
  'finding_evidence',
  'insight_feed',
  'forecast_accuracy',
  'org_cost_settings',
  'audit_log',
] as const;

let org: TestOrg;
let ctx: BuildContext;
let manager: TestUser;
let cashier: TestUser;
let kitchen: TestUser;
let purchaser: TestUser;
let accountant: TestUser;

beforeAll(async () => {
  org = await createOrg();
  ctx = { orgId: org.id, userId: org.owner.id, branchIds: org.branchIds };
  const b = [org.branchIds[0]!];
  manager = await addMember(org, 'manager', b);
  cashier = await addMember(org, 'cashier', b);
  kitchen = await addMember(org, 'kitchen', b);
  purchaser = await addMember(org, 'purchaser', b);
  accountant = await addMember(org, 'accountant');
  for (const t of MONEY_ONLY_TABLES) await ensureRow(t, ctx);
}, 120_000);

afterAll(closePool);

const count = (user: TestUser, table: string) =>
  asUser(
    user,
    async (s) =>
      (
        await s.q<{ n: number }>(
          `select count(*)::int as n from public.${table} where org_id = $1`,
          [org.id],
        )
      )[0]!.n,
  );

describe.each(MONEY_ONLY_TABLES)('%s', (table) => {
  it('has data (the check below is not vacuous)', async () => {
    const [row] = await admin<{ n: number }>(
      `select count(*)::int as n from public.${table} where org_id = $1`,
      [org.id],
    );
    expect(row!.n).toBeGreaterThan(0);
  });

  it('is invisible to manager, cashier, kitchen and purchaser', async () => {
    for (const [name, user] of Object.entries({ manager, cashier, kitchen, purchaser })) {
      expect(await count(user, table), `${name} reading ${table}`).toBe(0);
    }
  });

  it('is visible to the owner and the accountant', async () => {
    expect(await count(org.owner, table)).toBeGreaterThan(0);
    expect(await count(accountant, table)).toBeGreaterThan(0);
  });

  it('is read-only for the accountant', async () => {
    const res = await asUser(accountant, (s) =>
      s.attempt(`delete from public.${table} where org_id = $1`, [org.id]),
    );
    if (res.ok) expect(res.rowCount).toBe(0);
    else expect(res.code).toBe('42501');
    const [row] = await admin<{ n: number }>(
      `select count(*)::int as n from public.${table} where org_id = $1`,
      [org.id],
    );
    expect(row!.n).toBeGreaterThan(0);
  });
});

describe('purchases carry prices: purchasers and the owner see them, managers do not', () => {
  it('follows ADR 0007', async () => {
    await ensureRow('purchases', ctx);
    expect(await count(purchaser, 'purchases')).toBeGreaterThan(0);
    expect(await count(org.owner, 'purchases')).toBeGreaterThan(0);
    expect(await count(manager, 'purchases')).toBe(0);
    expect(await count(cashier, 'purchases')).toBe(0);
  });
});

describe('sales data is visible to managers but sensitive customer data is not visible to the accountant', () => {
  it('orders: manager yes, purchaser no', async () => {
    await ensureRow('orders', ctx);
    expect(await count(manager, 'orders')).toBeGreaterThan(0);
    expect(await count(purchaser, 'orders')).toBe(0);
  });

  it('customers (PII): manager and cashier yes, accountant and kitchen no', async () => {
    await ensureRow('customers', ctx);
    expect(await count(manager, 'customers')).toBeGreaterThan(0);
    expect(await count(cashier, 'customers')).toBeGreaterThan(0);
    expect(await count(accountant, 'customers')).toBe(0);
    expect(await count(kitchen, 'customers')).toBe(0);
  });
});

describe('finding workflow: the owner moves status, not the ৳ figure', () => {
  it('the owner can acknowledge a finding but cannot rewrite its impact', async () => {
    const finding = await ensureRow('findings', ctx);
    const ok = await asUser(org.owner, (s) =>
      s.attempt(`update public.findings set status = 'acknowledged' where id = $1`, [finding.id]),
    );
    expect(ok.ok && ok.rowCount).toBe(1);
    const tamper = await asUser(org.owner, (s) =>
      s.attempt('update public.findings set impact_poisha = 1 where id = $1', [finding.id]),
    );
    expect(tamper.ok).toBe(false);
    if (!tamper.ok) expect(tamper.code).toBe('42501');
    const forge = await asUser(org.owner, (s) =>
      s.attempt(
        `insert into public.findings (org_id, type, period_start, period_end, impact_poisha) values ($1, 'fake', current_date, current_date, 999999)`,
        [org.id],
      ),
    );
    expect(forge.ok).toBe(false);
  });
});

describe('the AI ledger is private to the person who had the conversation', () => {
  it("an owner cannot read a colleague's assistant history", async () => {
    await ensureRow('ai_conversations', { ...ctx, userId: manager.id });
    const rows = await asUser(org.owner, (s) =>
      s.q('select id from public.ai_conversations where org_id = $1', [org.id]),
    );
    expect(rows).toHaveLength(0);
    const own = await asUser(manager, (s) =>
      s.q('select id from public.ai_conversations where org_id = $1', [org.id]),
    );
    expect(own.length).toBeGreaterThan(0);
  });
});
