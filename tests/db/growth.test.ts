/**
 * Phase 10 growth module (ROADMAP Phase 10, PRODUCT.md M17, ADR 0023 §7): content ideas grounded in
 * revenue-only figures, approved by an owner or manager, never posted automatically.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  admin,
  asUser,
  closePool,
  createOrg,
  type TestOrg,
  type TestUser,
} from './harness';

afterAll(closePool);

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const dhaka = (date: string, time: string) => new Date(`${date}T${time}:00+06:00`).toISOString();
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const TODAY = '2026-07-06';
const NOW = dhaka(TODAY, '12:00');

async function id(sql: string, params: unknown[]) {
  const [row] = await admin<{ id: string }>(sql, params);
  return row!.id;
}

describe('growth: content ideas', () => {
  let org: TestOrg;
  let manager: TestUser;
  let cashier: TestUser;
  let branch: string;
  beforeAll(async () => {
    org = await createOrg({ branches: ['Main'] });
    branch = org.branchIds[0]!;
    manager = await addMember(org, 'manager', [branch]);
    cashier = await addMember(org, 'cashier', [branch]);
    const channel = await id(
      `insert into public.channels (org_id, name, kind) values ($1, 'Dine-in', 'dine_in') returning id`,
      [org.id],
    );
    const cat = await id(
      `insert into public.menu_categories (org_id, name) values ($1, 'Mains') returning id`,
      [org.id],
    );
    const kacchi = await id(
      `insert into public.menu_items (org_id, category_id, name, base_price_poisha) values ($1, $2, 'Kacchi', 45000) returning id`,
      [org.id, cat],
    );
    const borhani = await id(
      `insert into public.menu_items (org_id, category_id, name, base_price_poisha) values ($1, $2, 'Borhani', 8000) returning id`,
      [org.id, cat],
    );
    const order = async (date: string, time: string, item: string, qty: number, net: number) => {
      const orderId = randomUUID();
      await admin(
        `insert into public.orders (id, org_id, branch_id, channel_id, order_status, payment_status, placed_at,
           gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, price_includes_vat, vat_rate_bps)
         values ($1,$2,$3,$4,'completed','paid',$5,$6,$6,$6,$6,false,0)`,
        [orderId, org.id, branch, channel, dhaka(date, time), net],
      );
      await admin(
        `insert into public.order_items (org_id, branch_id, order_id, menu_item_id, name_snapshot, quantity,
           unit_price_poisha, gross_poisha, net_before_discount_poisha, net_poisha, total_poisha)
         values ($1,$2,$3,$4,'x',$5,$6,$6,$6,$6,$6)`,
        [org.id, branch, orderId, item, qty, net],
      );
    };
    // 20 days of lunch (12:00), Kacchi ×3/day; 8 days of a late slot (23:30), Borhani ×1/day.
    for (let d = 0; d < 20; d++) await order(addDays(TODAY, -d), '12:00', kacchi, 3, 135000);
    for (let d = 0; d < 8; d++) await order(addDays(TODAY, -d - 1), '23:30', borhani, 1, 8000);
  });

  it('the growth inputs are revenue-only: the top seller and the weakest/strongest daypart', async () => {
    const [row] = await asUser(manager, (s) =>
      s.q<Row>('select * from public.metric_growth_inputs($1, $2, $3)', [org.id, branch, NOW]),
    );
    expect([row!.top_item_name, n(row!.top_item_qty), row!.top_item_is_star]).toEqual([
      'Kacchi',
      60,
      false, // no recipe cost, so menu_matrix never classes it a star; falls back to top seller by units
    ]);
    expect(row!.strong_daypart).toBe('lunch');
    expect(row!.weak_daypart).toBe('late');
    expect(n(row!.weak_daypart_share_bps)).toBeLessThan(n(row!.strong_daypart_share_bps));
    // No cost or margin figure anywhere in the row.
    expect(Object.keys(row!).some((k) => /cost|margin|cm_/.test(k))).toBe(false);
  });

  it('a cashier may not read growth inputs or write a draft', async () => {
    const res = await asUser(cashier, (s) =>
      s.attempt('select * from public.metric_growth_inputs($1, $2, $3)', [org.id, branch, NOW]),
    );
    expect(res.ok ? 'ok' : res.code).toBe('42501');
    const write = await asUser(cashier, (s) =>
      s.attempt(
        `insert into public.growth_content_drafts (org_id, kind, title) values ($1, 'custom', 'x')`,
        [org.id],
      ),
    );
    expect(write.ok).toBe(false);
  });

  it('a manager writes an idea, approves it with a date, and marks it posted once approved', async () => {
    const draftId = await asUser(
      manager,
      (s) =>
        s.q<{ id: string }>(
          `insert into public.growth_content_drafts (org_id, branch_id, kind, title, caption_bn)
           values ($1, $2, 'custom', 'Friday special', 'আজ ফ্রাইডে স্পেশাল') returning id`,
          [org.id, branch],
        ),
      { commit: true },
    ).then((rows) => rows[0]!.id);

    const early = await asUser(manager, (s) =>
      s.attempt('select public.mark_growth_posted($1)', [draftId]),
    );
    expect(early.ok).toBe(false); // not approved yet

    await asUser(
      manager,
      (s) =>
        s.q('select public.approve_growth_draft($1, $2, $3, $4)', [
          draftId,
          'আজ বিশেষ ফ্রাইডে অফার',
          null,
          '2026-07-10',
        ]),
      { commit: true },
    );
    const [approved] = await admin<Row>(
      `select status, caption_bn, target_date::text as target_date, approved_by is not null as has_approver
         from public.growth_content_drafts where id = $1`,
      [draftId],
    );
    expect([
      approved!.status,
      approved!.caption_bn,
      approved!.target_date,
      approved!.has_approver,
    ]).toEqual(['approved', 'আজ বিশেষ ফ্রাইডে অফার', '2026-07-10', true]);

    const reapprove = await asUser(manager, (s) =>
      s.attempt('select public.approve_growth_draft($1)', [draftId]),
    );
    expect(reapprove.ok).toBe(false); // already reviewed

    await asUser(manager, (s) => s.q('select public.mark_growth_posted($1)', [draftId]), {
      commit: true,
    });
    const [posted] = await admin<{ status: string; posted_at: string | null }>(
      `select status, posted_at from public.growth_content_drafts where id = $1`,
      [draftId],
    );
    expect(posted!.status).toBe('posted');
    expect(posted!.posted_at).not.toBeNull();

    const audit = await admin<{ action: string }>(
      `select action from public.audit_log where org_id = $1 and entity = 'growth_content_draft' order by created_at`,
      [org.id],
    );
    expect(audit.map((a) => a.action)).toEqual(['growth.approve', 'growth.posted']);
  });

  it('discarding a draft is a plain update the owner or manager may do (no RPC needed), never for other orgs', async () => {
    const draftId = await asUser(
      manager,
      (s) =>
        s.q<{ id: string }>(
          `insert into public.growth_content_drafts (org_id, kind, title) values ($1, 'custom', 'Scratch') returning id`,
          [org.id],
        ),
      { commit: true },
    ).then((rows) => rows[0]!.id);
    await asUser(
      manager,
      (s) =>
        s.q(`update public.growth_content_drafts set status = 'discarded' where id = $1`, [
          draftId,
        ]),
      { commit: true },
    );
    const other = await createOrg({ branches: ['Main'] });
    const theirManager = await addMember(other, 'manager', [other.branchIds[0]!]);
    const cross = await asUser(theirManager, (s) =>
      s.attempt(`update public.growth_content_drafts set status = 'discarded' where id = $1`, [
        draftId,
      ]),
    );
    expect(cross.ok ? cross.rowCount : 0).toBe(0);
  });
});
