/**
 * Table QR (ADR 0045): every table has a link; the table page shows the branch's menu, the member card
 * rules and the Google link; a new customer joins from the table, a known number never sees a card, and
 * only the service role can read the page or join.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  admin,
  asService,
  asUser,
  closePool,
  createOrg,
  type TestOrg,
  type TestUser,
} from './harness';

afterAll(closePool);

const commit = { commit: true };
const NOW = '2026-11-11T08:00:00Z';

describe('table QR', () => {
  let org: TestOrg;
  let branch: string;
  let manager: TestUser;
  let cashier: TestUser;
  let tableId: string;
  let token: string;

  const page = (tk: string) =>
    asService((s) =>
      s.q<{ v: Record<string, unknown> | null }>('select public.table_page($1, $2) as v', [
        tk,
        NOW,
      ]),
    ).then((r) => r[0]!.v);

  const join = (phone: string, name: string | null = null, offers = false, tk = token) =>
    asService(
      (s) =>
        s.q<{ v: { status: string; token?: string; org_id?: string } }>(
          'select public.join_member_at_table($1, $2, $3, $4, $5) as v',
          [tk, phone, name, offers, NOW],
        ),
      commit,
    ).then((r) => r[0]!.v);

  beforeAll(async () => {
    org = await createOrg({ branches: ['Dhanmondi'] });
    branch = org.branchIds[0]!;
    manager = await addMember(org, 'manager', [branch]);
    cashier = await addMember(org, 'cashier', [branch]);
    const [tb] = await admin<{ id: string; qr_token: string }>(
      `insert into public.dining_tables (org_id, branch_id, name) values ($1, $2, '4') returning id, qr_token`,
      [org.id, branch],
    );
    tableId = tb!.id;
    token = tb!.qr_token;
    const [kacchi] = await admin<{ id: string }>(
      `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, 'Kacchi', 30000) returning id`,
      [org.id],
    );
    const [borhani] = await admin<{ id: string }>(
      `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, 'Borhani', 8000) returning id`,
      [org.id],
    );
    await admin(
      `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, 'Firni', 6000)`,
      [org.id],
    );
    // This branch sells Kacchi for ৳320 and has no Borhani today.
    await admin(
      `insert into public.branch_item_prices (org_id, branch_id, menu_item_id, price_poisha, is_available, has_price_override)
       values ($1, $2, $3, 32000, true, true), ($1, $2, $4, 8000, false, false)`,
      [org.id, branch, kacchi!.id, borhani!.id],
    );
    await admin(
      `insert into public.loyalty_settings (org_id, is_on, earn_points, earn_every_poisha, point_value_poisha,
         min_redeem_points, discount_on, discount_bps)
       values ($1, true, 1, 10000, 100, 50, true, 1000)`,
      [org.id],
    );
    await admin(
      `insert into public.customers (org_id, phone, name) values ($1, '+8801711111111', 'Karim')`,
      [org.id],
    );
  });

  it('a new table gets its own 32-character link by itself', () => {
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('the table page shows the names, the member rules and the menu at this branch’s prices', async () => {
    const v = (await page(token))!;
    expect(v.table).toBe('4');
    expect(v.branch).toBe('Dhanmondi');
    expect(v.member_on).toBe(true);
    expect(v.discount_bps).toBe(1000);
    expect(v.complaint_token).toMatch(/^[0-9a-f]{32}$/);
    expect(v.google_review_url).toBeNull();
    const menu = v.menu as { name: string; price_poisha: number }[];
    expect(menu.find((m) => m.name === 'Kacchi')?.price_poisha).toBe(32000);
    expect(menu.find((m) => m.name === 'Firni')?.price_poisha).toBe(6000);
    expect(menu.map((m) => m.name)).not.toContain('Borhani');
    expect(JSON.stringify(v)).not.toContain('1711111111');
    expect(await page('0'.repeat(32))).toBeNull();
    expect(await page('nope')).toBeNull();
  });

  it('only the service role reads the page or joins', async () => {
    for (const u of [org.owner, manager, cashier]) {
      const r = await asUser(u, (s) => s.attempt('select public.table_page($1, $2)', [token, NOW]));
      expect(r.ok).toBe(false);
      const j = await asUser(u, (s) =>
        s.attempt('select public.join_member_at_table($1, $2, null, false, $3)', [
          token,
          '01722222222',
          NOW,
        ]),
      );
      expect(j.ok).toBe(false);
    }
  });

  it('a new customer joins from the table and gets a card; offers only when ticked', async () => {
    const r = await join('017-3333 3333', '  Rina  ', true);
    expect(r.status).toBe('new');
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(r.org_id).toBe(org.id);
    const [c] = await admin<{ id: string; name: string; first_seen_at: Date }>(
      `select id, name, first_seen_at from public.customers where org_id = $1 and phone = '+8801733333333'`,
      [org.id],
    );
    expect(c!.name).toBe('Rina');
    expect(c!.first_seen_at.toISOString()).toBe('2026-11-11T08:00:00.000Z');
    const [card] = await admin<{ token: string; joined_table_id: string }>(
      'select token, joined_table_id from public.member_cards where org_id = $1 and customer_id = $2',
      [org.id, c!.id],
    );
    expect(card).toEqual({ token: r.token, joined_table_id: tableId });
    const consents = await admin<{ channel: string; granted: boolean; source: string }>(
      `select channel::text, granted, source from public.consents where org_id = $1 and customer_id = $2 order by channel`,
      [org.id, c!.id],
    );
    expect(consents).toEqual(
      [
        { channel: 'whatsapp', granted: true, source: 'table_qr' },
        { channel: 'sms', granted: true, source: 'table_qr' },
      ].sort((a, b) => a.channel.localeCompare(b.channel)),
    );

    const quiet = await join('01744444444');
    expect(quiet.status).toBe('new');
    const [n] = await admin<{ n: number }>(
      `select count(*)::int as n from public.consents x join public.customers c on c.id = x.customer_id
        where c.org_id = $1 and c.phone = '+8801744444444'`,
      [org.id],
    );
    expect(n!.n).toBe(0);
  });

  it('a number the restaurant already knows never gets a card from the table', async () => {
    expect(await join('01711111111')).toEqual({ status: 'known' });
    // A second tap with the same new number is "known" too, not a second card.
    expect((await join('01733333333')).status).toBe('known');
    const [n] = await admin<{ n: number }>(
      `select count(*)::int as n from public.member_cards mc join public.customers c on c.id = mc.customer_id
        where c.org_id = $1 and c.phone = '+8801711111111'`,
      [org.id],
    );
    expect(n!.n).toBe(0);
  });

  it('refuses a bad number, an unknown link, a removed table and a card that is off', async () => {
    expect((await join('12345')).status).toBe('invalid');
    expect((await join('01755555555', null, false, 'f'.repeat(32))).status).toBe('gone');
    await admin('update public.loyalty_settings set is_on = false where org_id = $1', [org.id]);
    expect((await join('01755555555')).status).toBe('off');
    expect((await page(token))!.member_on).toBe(false);
    await admin('update public.loyalty_settings set is_on = true where org_id = $1', [org.id]);
    await admin('update public.dining_tables set is_active = false where id = $1', [tableId]);
    expect(await page(token)).toBeNull();
    expect((await join('01755555555')).status).toBe('gone');
    await admin('update public.dining_tables set is_active = true where id = $1', [tableId]);
  });

  it('a branch takes at most 30 new members an hour through its tables', async () => {
    const already = await admin<{ n: number }>(
      `select count(*)::int as n from public.member_cards where org_id = $1 and joined_table_id is not null`,
      [org.id],
    ).then((r) => r[0]!.n);
    for (let i = already; i < 30; i++) {
      expect((await join(`0181${String(1000000 + i)}`)).status).toBe('new');
    }
    expect((await join('01899999999')).status).toBe('busy');
  });

  it('the owner or manager sets the Google link and gives a table a new link; a cashier cannot', async () => {
    await asUser(
      manager,
      (s) =>
        s.q('select public.set_google_review_url($1, $2, $3)', [
          org.id,
          branch,
          'https://g.page/r/abc/review',
        ]),
      commit,
    );
    expect((await page(token))!.google_review_url).toBe('https://g.page/r/abc/review');
    const bad = await asUser(manager, (s) =>
      s.attempt('select public.set_google_review_url($1, $2, $3)', [
        org.id,
        branch,
        'javascript:x',
      ]),
    );
    expect(bad.ok).toBe(false);
    const byCashier = await asUser(cashier, (s) =>
      s.attempt('select public.set_google_review_url($1, $2, $3)', [org.id, branch, '']),
    );
    expect(byCashier.ok).toBe(false);
    expect(
      (
        await asUser(cashier, (s) =>
          s.attempt('select public.reset_table_link($1, $2)', [org.id, tableId]),
        )
      ).ok,
    ).toBe(false);

    await asUser(
      manager,
      (s) => s.q('select public.reset_table_link($1, $2)', [org.id, tableId]),
      commit,
    );
    const [{ qr_token: fresh }] = (await admin<{ qr_token: string }>(
      'select qr_token from public.dining_tables where id = $1',
      [tableId],
    )) as [{ qr_token: string }];
    expect(fresh).not.toBe(token);
    expect(await page(token)).toBeNull();
    expect((await page(fresh))!.table).toBe('4');
    const audit = await admin(
      `select 1 from public.audit_log where org_id = $1 and action = 'table.link_reset'`,
      [org.id],
    );
    expect(audit.length).toBe(1);
  });
});
