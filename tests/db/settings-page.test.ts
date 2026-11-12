/**
 * The owner's Settings page, end to end at the database: the menu-price VAT choice (and that the till
 * charges what it promises), the receipt details the till prints, and the sales channels with their
 * commission. Each write is the same statement the page's server action sends through PostgREST.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { computeLine } from '@/lib/money';
import { addMember, admin, asUser, closePool, createOrg, type TestOrg } from './harness';

afterAll(closePool);

/** A paired till with a cashier signed in, a dine-in channel and one ৳300 dish. */
async function till(org: TestOrg) {
  const branchId = org.branchIds[0]!;
  const manager = await addMember(org, 'manager', [branchId]);
  const [channel] = await admin<{ id: string }>(
    `insert into public.channels (org_id, name, kind) values ($1, 'Dine-in', 'dine_in') returning id`,
    [org.id],
  );
  const [item] = await admin<{ id: string }>(
    `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, 'Kacchi', 30000) returning id`,
    [org.id],
  );
  const [staff] = await admin<{ id: string }>(
    `insert into public.staff (org_id, branch_id, display_name, role) values ($1, $2, 'Rahim', 'cashier') returning id`,
    [org.id, branchId],
  );
  await admin(
    `insert into public.staff_pins (staff_id, org_id, pin_hash) values ($1, $2, extensions.crypt('1234', extensions.gen_salt('bf', 4)))`,
    [staff!.id, org.id],
  );
  const reg = await asUser(
    manager,
    async (s) =>
      (
        await s.q<{ r: { device_id: string; pairing_code: string } }>(
          `select public.register_device($1, $2, 'Counter 1') as r`,
          [org.id, branchId],
        )
      )[0]!.r,
    { commit: true },
  );
  await asUser(
    manager,
    (s) => s.q('select public.claim_device($1, $2)', [reg.device_id, reg.pairing_code]),
    { commit: true },
  );
  await asUser(
    manager,
    (s) => s.q('select public.start_staff_session($1, $2, $3)', [reg.device_id, staff!.id, '1234']),
    { commit: true },
  );
  const sell = (channelId = channel!.id) =>
    asUser(
      manager,
      (s) =>
        s.attempt<Record<string, string>>(
          'select * from public.submit_order($1, $2, $3, $4, $5, $6, $7, null, null, null, $8::jsonb)',
          [
            org.id,
            branchId,
            randomUUID(),
            randomUUID(),
            reg.device_id,
            staff!.id,
            channelId,
            JSON.stringify([{ menu_item_id: item!.id, quantity: 1 }]),
          ],
        ),
      { commit: true },
    );
  return { manager, channelId: channel!.id, sell };
}

/** Exactly what updateSettingsAction sends. */
const saveSettings = (org: TestOrg, includesVat: boolean, vatBps = 500, serviceBps = 0) =>
  asUser(
    org.owner,
    (s) =>
      s.attempt(
        `update public.org_settings
            set price_includes_vat = $2, vat_rate_bps = $3, service_charge_bps = $4,
                default_cutoff_minutes = 240, week_start = 6
          where org_id = $1 returning org_id`,
        [org.id, includesVat, vatBps, serviceBps],
      ),
    { commit: true },
  );

describe('Menu prices: Include VAT / Exclude VAT', () => {
  it('Include VAT: the customer pays exactly the menu price, and the till screen agrees', async () => {
    const org = await createOrg({ branches: ['Main'] });
    const saved = await saveSettings(org, true);
    expect(saved.ok && saved.rowCount).toBe(1);

    const { sell } = await till(org);
    const res = await sell();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const order = res.rows[0]!;
    // ৳300 menu price with 5% VAT inside it: net 285.71 + VAT 14.29 = 300.00.
    expect(Number(order.total_poisha)).toBe(30_000);
    expect(Number(order.net_poisha)).toBe(28_571);
    expect(Number(order.vat_poisha)).toBe(1_429);
    expect(order.price_includes_vat).toBe(true);

    const screen = computeLine(
      { unitPricePoisha: 30_000, quantity: 1 },
      { priceIncludesVat: true, vatRateBps: 500, serviceChargeBps: 0, vatOnServiceCharge: false },
    );
    expect(screen.totalPoisha).toBe(Number(order.total_poisha));
    expect(screen.vatPoisha).toBe(Number(order.vat_poisha));
  });

  it('Exclude VAT: VAT is added on top at the till, and the till screen agrees', async () => {
    const org = await createOrg({ branches: ['Main'] });
    expect((await saveSettings(org, false)).ok).toBe(true);

    const { sell } = await till(org);
    const res = await sell();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const order = res.rows[0]!;
    // ৳300 + 5% VAT = ৳315.
    expect(Number(order.net_poisha)).toBe(30_000);
    expect(Number(order.vat_poisha)).toBe(1_500);
    expect(Number(order.total_poisha)).toBe(31_500);
    expect(order.price_includes_vat).toBe(false);

    const screen = computeLine(
      { unitPricePoisha: 30_000, quantity: 1 },
      { priceIncludesVat: false, vatRateBps: 500, serviceChargeBps: 0, vatOnServiceCharge: false },
    );
    expect(screen.totalPoisha).toBe(Number(order.total_poisha));
  });

  it('the owner can switch back and forth before the first sale; after it, the switch is refused with the plain message', async () => {
    const org = await createOrg({ branches: ['Main'] });
    expect((await saveSettings(org, false)).ok).toBe(true);
    expect((await saveSettings(org, true)).ok).toBe(true);
    const { sell } = await till(org);
    expect((await sell()).ok).toBe(true);

    const flip = await saveSettings(org, false);
    expect(flip.ok).toBe(false);
    // 23514 + "price_includes_vat" is what mapDbError turns into errors.priceBasisLocked.
    if (!flip.ok) {
      expect(flip.code).toBe('23514');
      expect(flip.message).toContain('price_includes_vat');
    }
    // Saving the same choice with a new VAT rate still works after sales.
    expect((await saveSettings(org, true, 750)).ok).toBe(true);
  });

  it('a manager cannot change the price settings', async () => {
    const org = await createOrg({ branches: ['Main'] });
    const manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    const res = await asUser(manager, (s) =>
      s.attempt('update public.org_settings set price_includes_vat = false where org_id = $1', [
        org.id,
      ]),
    );
    expect(res.ok ? res.rowCount : 0).toBe(0);
  });
});

describe('Receipt details', () => {
  /** Exactly what updateReceiptSettingsAction sends: a PostgREST upsert on the primary key. */
  const saveReceipt = (org: TestOrg, who: TestOrg['owner'], name: string, footer: string | null) =>
    asUser(
      who,
      (s) =>
        s.attempt(
          `insert into public.org_receipt_settings (org_id, legal_name, bin, address, phone, footer)
           values ($1, $2, '000123456-0101', 'House 12, Road 5, Dhanmondi', '01700000000', $3)
           on conflict (org_id) do update set legal_name = excluded.legal_name, bin = excluded.bin,
             address = excluded.address, phone = excluded.phone, footer = excluded.footer
           returning org_id`,
          [org.id, name, footer],
        ),
      { commit: true },
    );

  it('the owner saves them the first time and again later, and the till user reads what is printed', async () => {
    const org = await createOrg({ branches: ['Main'] });
    expect((await saveReceipt(org, org.owner, 'Kacchi Ghor Ltd', 'Thank you!')).ok).toBe(true);
    expect((await saveReceipt(org, org.owner, 'Kacchi Ghor Limited', null)).ok).toBe(true);

    // fetchReceiptInfo runs as whoever is signed in on the till (a cashier here).
    const cashier = await addMember(org, 'cashier', [org.branchIds[0]!]);
    const rows = await asUser(cashier, (s) =>
      s.q(
        'select legal_name, bin, address, phone, footer from public.org_receipt_settings where org_id = $1',
        [org.id],
      ),
    );
    expect(rows).toEqual([
      {
        legal_name: 'Kacchi Ghor Limited',
        bin: '000123456-0101',
        address: 'House 12, Road 5, Dhanmondi',
        phone: '01700000000',
        footer: null,
      },
    ]);

    // An edit to the receipt header is audited.
    const audit = await admin(
      `select 1 from public.audit_log where org_id = $1 and entity = 'org_receipt_settings'`,
      [org.id],
    );
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it('a manager cannot change them, and another restaurant cannot see them', async () => {
    const org = await createOrg({ branches: ['Main'] });
    expect((await saveReceipt(org, org.owner, 'Mine', null)).ok).toBe(true);
    const manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    expect((await saveReceipt(org, manager, 'Hijacked', null)).ok).toBe(false);

    const stranger = await createOrg({ branches: ['Main'] });
    const seen = await asUser(stranger.owner, (s) =>
      s.q('select 1 from public.org_receipt_settings where org_id = $1', [org.id]),
    );
    expect(seen).toHaveLength(0);
  });
});

describe('Sales channels', () => {
  it('"Add default channels" adds the five channels once, even when pressed twice', async () => {
    const org = await createOrg({ branches: ['Main'] });
    for (let i = 0; i < 2; i++) {
      await asUser(org.owner, (s) => s.q('select public.ensure_org_defaults($1)', [org.id]), {
        commit: true,
      });
    }
    const kinds = await admin<{ kind: string }>(
      'select kind::text from public.channels where org_id = $1 order by kind',
      [org.id],
    );
    expect(kinds.map((k) => k.kind).sort()).toEqual(
      ['dine_in', 'foodpanda', 'own_delivery', 'pathao_food', 'takeaway'].sort(),
    );
  });

  it('the owner adds a channel; the same name twice is refused (shown as "name already used")', async () => {
    const org = await createOrg({ branches: ['Main'] });
    const add = () =>
      asUser(
        org.owner,
        (s) =>
          s.attempt(
            `insert into public.channels (org_id, name, kind) values ($1, 'Foodi', 'custom')`,
            [org.id],
          ),
        { commit: true },
      );
    expect((await add()).ok).toBe(true);
    const again = await add();
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('23505');
  });

  it('a switched-off channel cannot take orders at the till; switched back on, it can', async () => {
    const org = await createOrg({ branches: ['Main'] });
    const { sell, channelId } = await till(org);
    const toggle = (active: boolean) =>
      asUser(
        org.owner,
        (s) =>
          s.attempt('update public.channels set is_active = $2 where id = $1 returning id', [
            channelId,
            active,
          ]),
        { commit: true },
      );

    expect((await toggle(false)).ok).toBe(true);
    const refused = await sell();
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toContain('unknown channel');

    expect((await toggle(true)).ok).toBe(true);
    expect((await sell()).ok).toBe(true);
  });

  it('commission: saving twice the same day updates one row; managers never see it', async () => {
    const org = await createOrg({ branches: ['Main'] });
    const [ch] = await admin<{ id: string }>(
      `insert into public.channels (org_id, name, kind) values ($1, 'foodpanda', 'foodpanda') returning id`,
      [org.id],
    );
    // Exactly what setChannelCommissionAction sends (upsert on org_id, channel_id, effective_from).
    const save = (bps: number, fee: number, pack: number) =>
      asUser(
        org.owner,
        (s) =>
          s.attempt(
            `insert into public.channel_commissions
               (org_id, channel_id, commission_bps, fixed_fee_poisha, packaging_poisha, effective_from)
             values ($1, $2, $3, $4, $5, '2026-11-13')
             on conflict (org_id, channel_id, effective_from) do update set
               commission_bps = excluded.commission_bps, fixed_fee_poisha = excluded.fixed_fee_poisha,
               packaging_poisha = excluded.packaging_poisha
             returning channel_id`,
            [org.id, ch!.id, bps, fee, pack],
          ),
        { commit: true },
      );
    expect((await save(3000, 0, 0)).ok).toBe(true);
    expect((await save(2500, 1000, 1500)).ok).toBe(true);

    const rows = await asUser(org.owner, (s) =>
      s.q(
        'select commission_bps, fixed_fee_poisha::int as fee, packaging_poisha::int as pack from public.channel_commissions where channel_id = $1',
        [ch!.id],
      ),
    );
    expect(rows).toEqual([{ commission_bps: 2500, fee: 1000, pack: 1500 }]);

    const manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    const seen = await asUser(manager, (s) =>
      s.q('select 1 from public.channel_commissions where channel_id = $1', [ch!.id]),
    );
    expect(seen).toHaveLength(0);
  });
});
