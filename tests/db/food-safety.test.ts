/**
 * ADR 0043: expired or unsafe ingredients cannot go into a dish, offline orders are never lost, the daily
 * checks show what nobody recorded, and a complaint closes only with its corrective actions done.
 * Dates are relative to the real clock because the till's guard uses the database's now(), as write_purchase does.
 */
import { randomUUID } from 'node:crypto';
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

type Row = Record<string, unknown>;

const [{ today, iso }] = (await admin<{ today: string; iso: string }>(
  `select private.business_date(now(), 240)::text as today, now()::text as iso`,
)) as [{ today: string; iso: string }];
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function id(sql: string, params: unknown[]) {
  const [row] = await admin<{ id: string }>(sql, params);
  return row!.id;
}

interface Kitchen {
  org: TestOrg;
  main: string;
  manager: TestUser;
  kitchen: TestUser;
  cashier: TestUser;
  chicken: string;
  rice: string;
  burger: string;
  plain: string;
  device: string;
  staff: string;
  channel: string;
}

/** A restaurant with a burger (chicken) and plain rice (rice), and a till signed in as the owner. */
async function setup(): Promise<Kitchen> {
  const org = await createOrg({ branches: ['Main'] });
  const main = org.branchIds[0]!;
  const ingredient = (name: string, days: number | null) =>
    id(
      `insert into public.ingredients (org_id, name, base, shelf_life_days) values ($1, $2, 'g', $3) returning id`,
      [org.id, name, days],
    );
  const chicken = await ingredient('Chicken', 2);
  const rice = await ingredient('Rice', null);
  const dish = async (name: string, ingredientId: string) => {
    const item = await id(
      `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, $2, 20000) returning id`,
      [org.id, name],
    );
    const recipe = await id(
      `insert into public.recipes (org_id, menu_item_id, status, approved_at) values ($1, $2, 'active', now()) returning id`,
      [org.id, item],
    );
    await admin(
      `insert into public.recipe_lines (org_id, recipe_id, ingredient_id, qty_base) values ($1, $2, $3, 150)`,
      [org.id, recipe, ingredientId],
    );
    return item;
  };
  const burger = await dish('Burger', chicken);
  const plain = await dish('Plain rice', rice);
  const channel = await id(
    `insert into public.channels (org_id, name, kind) values ($1, 'Takeaway', 'takeaway') returning id`,
    [org.id],
  );
  const device = await id(
    `insert into public.devices (org_id, branch_id, name, kind, status) values ($1, $2, 'Till', 'pos', 'active') returning id`,
    [org.id, main],
  );
  const staff = await id(
    `insert into public.staff (org_id, branch_id, display_name) values ($1, $2, 'Rafiq') returning id`,
    [org.id, main],
  );
  await admin(
    `insert into public.staff_sessions (org_id, branch_id, device_id, staff_id, expires_at)
     values ($1, $2, $3, $4, now() + interval '8 hours')`,
    [org.id, main, device, staff],
  );
  return {
    org,
    main,
    manager: await addMember(org, 'manager', [main]),
    kitchen: await addMember(org, 'kitchen', [main]),
    cashier: await addMember(org, 'cashier', [main]),
    chicken,
    rice,
    burger,
    plain,
    device,
    staff,
    channel,
  };
}

async function buy(k: Kitchen, ingredientId: string, on: string, qty = 2000) {
  const purchase = await id(
    `insert into public.purchases (org_id, branch_id, purchased_on, source, status, total_poisha)
     values ($1, $2, $3, 'form', 'confirmed', 100000) returning id`,
    [k.org.id, k.main, on],
  );
  return id(
    `insert into public.purchase_lines (org_id, branch_id, purchase_id, ingredient_id, qty_base, line_total_poisha)
     values ($1, $2, $3, $4, $5, 100000) returning id`,
    [k.org.id, k.main, purchase, ingredientId, qty],
  );
}

const placeOrder = (k: Kitchen, menuItem: string, placedAt: string | null = null) =>
  asUser(k.org.owner, (s) =>
    s.attempt(
      `select id from public.submit_order($1, $2, $3, $4, $5, $6, $7, null, null, $8, $9::jsonb, null)`,
      [
        k.org.id,
        k.main,
        randomUUID(),
        randomUUID(),
        k.device,
        k.staff,
        k.channel,
        placedAt,
        JSON.stringify([{ menu_item_id: menuItem, quantity: 1 }]),
      ],
    ),
  );

const blockedAtTill = (k: Kitchen) =>
  asUser(k.cashier, (s) =>
    s.q<Row>('select * from public.food_safety_blocked_items($1, $2, now())', [k.org.id, k.main]),
  );

describe('food safety', () => {
  let k: Kitchen;
  beforeAll(async () => {
    k = await setup();
  }, 120_000);

  it('an item with no shelf life is never blocked, however old', async () => {
    await buy(k, k.rice, addDays(today, -60));
    expect(await blockedAtTill(k)).toEqual([]);
    expect((await placeOrder(k, k.plain)).ok).toBe(true);
  });

  it('expired: the dish leaves the till, and the server refuses it even from a stale till', async () => {
    const lot = await buy(k, k.chicken, addDays(today, -5));
    const blocked = await blockedAtTill(k);
    expect(blocked.map((b) => [b.menu_item_id, b.ingredient_name, b.reason])).toEqual([
      [k.burger, 'Chicken', 'expired'],
    ]);
    const res = await placeOrder(k, k.burger);
    expect(res.ok ? 'placed' : res.message).toBe('food_safety_blocked');
    // Other dishes still sell.
    expect((await placeOrder(k, k.plain)).ok).toBe(true);
    const [row] = await asUser(k.manager, (s) =>
      s.q<Row>('select * from public.metric_food_safety_blocks($1, null, now())', [k.org.id]),
    );
    expect([row!.reason, row!.lot_id, row!.dishes]).toEqual(['expired', lot, ['Burger']]);
  });

  it('an order taken offline is accepted when it syncs, and flagged to the owner', async () => {
    const thirtyMinutesAgo = new Date(Date.parse(iso) - 30 * 60_000).toISOString();
    const sold = await asUser(k.org.owner, async (s) => {
      await s.q(
        `select id from public.submit_order($1,$2,$3,$4,$5,$6,$7,null,null,$8,$9::jsonb,null)`,
        [
          k.org.id,
          k.main,
          randomUUID(),
          randomUUID(),
          k.device,
          k.staff,
          k.channel,
          thirtyMinutesAgo,
          JSON.stringify([{ menu_item_id: k.burger, quantity: 1 }]),
        ],
      );
      return s.q<Row>('select * from public.metric_food_safety_sold($1, null, now())', [k.org.id]);
    });
    expect(sold).toHaveLength(1);
    expect(sold[0]!.ingredients).toEqual(['Chicken']);
  });

  it('a new in-date lot lifts the block by itself', async () => {
    const fresh = await buy(k, k.chicken, today);
    expect(await blockedAtTill(k)).toEqual([]);
    expect((await placeOrder(k, k.burger)).ok).toBe(true);
    await admin('delete from public.purchase_lines where id = $1', [fresh]);
  });

  it('old stock under a fresh lot is listed as probably on the shelf, oldest used first', async () => {
    const old = await buy(k, k.chicken, addDays(today, -6), 1000);
    const fresh = await buy(k, k.chicken, today, 500);
    const rows = await asUser(k.manager, (s) =>
      s.q<Row>(
        'select * from public.metric_food_safety($1, null, now()) where ingredient_id = $2',
        [k.org.id, k.chicken],
      ),
    );
    const byLot = new Map(rows.map((r) => [r.lot_id, r]));
    expect(byLot.get(old)?.status).toBe('expired');
    expect(byLot.get(old)?.estimated).toBe(true);
    expect(Number(byLot.get(old)?.on_shelf_qty)).toBeGreaterThan(0);
    expect(await blockedAtTill(k)).toEqual([]);
    await admin('delete from public.purchase_lines where id = any($1::uuid[])', [[old, fresh]]);
  });

  it('moving a date later needs a manager and a reason; it is audited; a purchaser cannot edit it directly', async () => {
    const lot = await buy(k, k.chicken, addDays(today, -5));
    const later = addDays(today, 1);
    const set = (u: TestUser, note: string | null) =>
      asUser(
        u,
        (s) =>
          s.attempt(`select public.set_lot_expiry($1, 'purchase', $2, $3, $4)`, [
            k.org.id,
            lot,
            later,
            note,
          ]),
        { commit: true },
      );
    const kitchen = await set(k.kitchen, 'looks ok');
    expect(kitchen.ok ? 'ok' : kitchen.code).toBe('42501');
    const noReason = await set(k.manager, null);
    expect(noReason.ok ? 'ok' : noReason.message).toBe('food_safety_reason_needed');
    expect((await set(k.manager, 'packet says tomorrow')).ok).toBe(true);
    expect(await blockedAtTill(k)).toEqual([]);
    const [audit] = await admin<Row>(
      `select before, after, reason from public.audit_log where org_id = $1 and action = 'food_safety.lot_expiry'`,
      [k.org.id],
    );
    expect(audit!.reason).toBe('packet says tomorrow');
    expect((audit!.after as Row).expires_on).toBe(later);

    const purchaser = await addMember(k.org, 'purchaser', [k.main]);
    const direct = await asUser(purchaser, (s) =>
      s.attempt(`update public.purchase_lines set expires_on = $2 where id = $1`, [
        lot,
        addDays(today, 30),
      ]),
    );
    expect(direct.ok ? 'updated' : direct.code).toBe('42501');
  });

  it('the kitchen can stop an item at once; only a manager lifts it, with a reason', async () => {
    const [{ hold }] = (await asUser(
      k.kitchen,
      (s) =>
        s.q<{ hold: string }>(`select public.hold_ingredient($1, $2, $3, 'smells bad') as hold`, [
          k.org.id,
          k.main,
          k.rice,
        ]),
      { commit: true },
    )) as [{ hold: string }];
    expect((await blockedAtTill(k)).map((b) => b.reason)).toEqual(['held']);
    expect((await placeOrder(k, k.plain)).ok).toBe(false);

    const byKitchen = await asUser(k.kitchen, (s) =>
      s.attempt(`select public.release_ingredient_hold($1, $2, 'fine now')`, [k.org.id, hold]),
    );
    expect(byKitchen.ok ? 'ok' : byKitchen.code).toBe('42501');
    await asUser(
      k.manager,
      (s) =>
        s.q(`select public.release_ingredient_hold($1, $2, 'threw it out, new bag')`, [
          k.org.id,
          hold,
        ]),
      { commit: true },
    );
    expect(await blockedAtTill(k)).toEqual([]);
  });

  it('the owner can make expired dates warn only; a hold still blocks', async () => {
    const other = await setup();
    await buy(other, other.chicken, addDays(today, -5));
    expect(await blockedAtTill(other)).toHaveLength(1);
    await admin(
      `update public.org_settings set food_safety_block_expired = false where org_id = $1`,
      [other.org.id],
    );
    expect(await blockedAtTill(other)).toEqual([]);
    expect((await placeOrder(other, other.burger)).ok).toBe(true);
    await asUser(
      other.kitchen,
      (s) =>
        s.q(`select public.hold_ingredient($1, $2, $3, 'recall notice')`, [
          other.org.id,
          other.main,
          other.chicken,
        ]),
      { commit: true },
    );
    expect(await blockedAtTill(other)).toHaveLength(1);
  });

  it('an old purchase record is not expired food: only a date passed in the last week stops a dish', async () => {
    const other = await setup();
    await buy(other, other.chicken, addDays(today, -30));
    expect(await blockedAtTill(other)).toEqual([]);
    expect((await placeOrder(other, other.burger)).ok).toBe(true);
    const seen = (fn: string) =>
      asUser(other.manager, (s) =>
        s.q<Row>(`select * from public.${fn}($1, null, now())`, [other.org.id]),
      );
    expect((await seen('metric_food_safety_stale')).map((r) => r.name)).toEqual(['Chicken']);
    expect(await seen('metric_food_safety')).toEqual([]);
    // Bought again and past its date by 3 days: that is real, so it stops, and is not "stale" any more.
    await buy(other, other.chicken, addDays(today, -5));
    expect((await blockedAtTill(other)).map((b) => b.reason)).toEqual(['expired']);
    expect(await seen('metric_food_safety_stale')).toEqual([]);
  });

  it('a hold by staff blocks however old the purchase record is', async () => {
    const other = await setup();
    await buy(other, other.chicken, addDays(today, -60));
    await asUser(
      other.kitchen,
      (s) =>
        s.q(`select public.hold_ingredient($1, $2, $3, 'smells bad')`, [
          other.org.id,
          other.main,
          other.chicken,
        ]),
      { commit: true },
    );
    expect((await blockedAtTill(other)).map((b) => b.reason)).toEqual(['held']);
  });

  it('each purchase keeps its own date, and the full list shows fresh ones too', async () => {
    const other = await setup();
    await admin('update public.ingredients set shelf_life_days = 10 where id = $1', [other.rice]);
    const first = await buy(other, other.rice, addDays(today, -2), 1000);
    const second = await buy(other, other.rice, today, 1000);
    const list = (extra: string) =>
      asUser(other.manager, (s) =>
        s.q<Row>(
          `select lot_id, expires_on::text as until, status from public.metric_food_safety($1, null, now()${extra})`,
          [other.org.id],
        ),
      );
    expect(await list('')).toEqual([]);
    expect(await list(', true')).toEqual([
      { lot_id: first, until: addDays(today, 8), status: 'fresh' },
      { lot_id: second, until: addDays(today, 10), status: 'fresh' },
    ]);
  });

  it('another restaurant cannot read or change any of it', async () => {
    const stranger = await createOrg({ branches: ['Elsewhere'] });
    const read = await asUser(stranger.owner, (s) =>
      s.attempt('select * from public.food_safety_blocked_items($1, $2, now())', [
        k.org.id,
        k.main,
      ]),
    );
    expect(read.ok ? 'ok' : read.code).toBe('42501');
    const hold = await asUser(stranger.owner, (s) =>
      s.attempt(`select public.hold_ingredient($1, $2, $3, 'sabotage')`, [
        k.org.id,
        k.main,
        k.chicken,
      ]),
    );
    expect(hold.ok ? 'ok' : hold.code).toBe('42501');
  });
});

describe('daily compliance checks', () => {
  let k: Kitchen;
  let check: string;
  let fridge: string;
  const dhakaNoon = (date: string) => new Date(`${date}T12:00:00+06:00`).toISOString();
  beforeAll(async () => {
    k = await setup();
    const yesterday = addDays(today, -3);
    check = await id(
      `insert into public.compliance_checks (org_id, name, starts_on) values ($1, 'Floor cleaned', $2) returning id`,
      [k.org.id, yesterday],
    );
    fridge = await id(
      `insert into public.compliance_checks (org_id, name, category, needs_note, starts_on)
       values ($1, 'Fridge temperature', 'inspection', true, $2) returning id`,
      [k.org.id, today],
    );
  }, 120_000);

  const states = (u: TestUser) =>
    asUser(u, (s) =>
      s.q<Row>(
        'select *, period_start::text as p from public.metric_daily_checks($1, null, $2, 7)',
        [k.org.id, dhakaNoon(today)],
      ),
    );

  it('shows today as due, past days as missing, and nothing before the check started', async () => {
    const rows = await states(k.manager);
    const floor = rows.filter((r) => r.check_id === check);
    expect(floor.map((r) => [r.p, r.state]).sort()).toEqual([
      [addDays(today, -3), 'missing'],
      [addDays(today, -2), 'missing'],
      [addDays(today, -1), 'missing'],
      [today, 'due'],
    ]);
    expect(rows.filter((r) => r.check_id === fridge).map((r) => r.state)).toEqual(['due']);
  });

  it('the kitchen records; a late record is marked late; a reading is required where the check asks', async () => {
    const record = (date: string | null, targetCheck = check, note: string | null = null) =>
      asUser(
        k.kitchen,
        (s) =>
          s.attempt(`select public.record_compliance_check($1, $2, $3, 'done', $4, $5)`, [
            k.org.id,
            k.main,
            targetCheck,
            note,
            date,
          ]),
        { commit: true },
      );
    expect((await record(null)).ok).toBe(true);
    expect((await record(addDays(today, -1))).ok).toBe(true);
    const noReading = await record(null, fridge);
    expect(noReading.ok ? 'ok' : noReading.message).toBe('check_needs_note');
    expect((await record(null, fridge, '3°C')).ok).toBe(true);
    const tooOld = await record(addDays(today, -20));
    expect(tooOld.ok ? 'ok' : tooOld.message).toBe('check_date_out_of_range');
    const floor = (await states(k.manager)).filter((r) => r.check_id === check);
    const by = Object.fromEntries(floor.map((r) => [r.p as string, [r.state, r.late]]));
    expect(by[today]).toEqual(['done', false]);
    expect(by[addDays(today, -1)]).toEqual(['done', true]);
    expect(by[addDays(today, -2)]).toEqual(['missing', false]);
  });

  it('scores finished periods only', async () => {
    const [row] = await asUser(k.manager, (s) =>
      s.q<Row>('select * from public.metric_daily_checks_summary($1, null, $2, 7)', [
        k.org.id,
        dhakaNoon(today),
      ]),
    );
    // Yesterday recorded; the two days before it not: 1 of 3.
    expect([Number(row!.done_now), Number(row!.missing), row!.score_bps]).toEqual([2, 2, 3333]);
  });

  it('a problem needs words and opens one case, however often it is recorded', async () => {
    const report = () =>
      asUser(
        k.manager,
        (s) =>
          s.q(`select public.record_compliance_check($1, $2, $3, 'problem', 'drain blocked')`, [
            k.org.id,
            k.main,
            check,
          ]),
        { commit: true },
      );
    await report();
    await report();
    const cases = await admin<Row>(
      `select kind, source, title from public.incidents where org_id = $1`,
      [k.org.id],
    );
    expect(cases).toEqual([{ kind: 'hygiene', source: 'daily_check', title: 'Floor cleaned' }]);
  });

  it('weekly checks follow the restaurant’s week; the starter list adds once; a cashier sees nothing', async () => {
    const [{ p }] = (await admin<{ p: string }>(
      `select private.check_period_start('weekly', date '2026-11-11', 6)::text as p`,
    )) as [{ p: string }];
    expect(p).toBe('2026-11-07');
    const add = () =>
      asUser(
        k.org.owner,
        async (s) =>
          (
            await s.q<{ n: number }>(`select public.add_starter_compliance_checks($1) as n`, [
              k.org.id,
            ])
          )[0]!.n,
        { commit: true },
      );
    expect(await add()).toBe(10);
    expect(await add()).toBe(0);
    const res = await asUser(k.cashier, (s) =>
      s.attempt('select * from public.metric_daily_checks($1, null, now(), 7)', [k.org.id]),
    );
    expect(res.ok ? 'ok' : res.code).toBe('42501');
  });

  it('the morning message counts blocked items and yesterday’s missing records', async () => {
    await id(
      `insert into public.compliance_checks (org_id, name, starts_on) values ($1, 'Never recorded', $2) returning id`,
      [k.org.id, addDays(today, -2)],
    );
    await buy(k, k.chicken, addDays(today, -5));
    const [row] = await asService((s) =>
      s.q<Row>('select * from public.job_safety_summary($1, $2)', [k.org.id, dhakaNoon(today)]),
    );
    // Yesterday only: 'Floor cleaned' was recorded, the starter list began today, this one was not.
    expect([Number(row!.blocked_items), Number(row!.missed_checks)]).toEqual([1, 1]);
    const res = await asUser(k.org.owner, (s) =>
      s.attempt('select * from public.job_safety_summary($1, now())', [k.org.id]),
    );
    expect(res.ok).toBe(false);
  });
});

describe('complaints and incidents', () => {
  let k: Kitchen;
  let accountant: TestUser;
  const open = (extra: unknown[] = [null, false, 'Ayesha', '01711000000', true]) =>
    asUser(
      k.manager,
      async (s) =>
        (
          await s.q<{ id: string }>(
            `select public.open_incident($1, $2, 'complaint', 'high', 'in_person', 'Hair in the biryani', 'Table 4', null,
               'Bill 42', $3, $4, $5, $6, $7) as id`,
            [k.org.id, k.main, ...extra],
          )
        )[0]!.id,
      { commit: true },
    );
  const resolve = (incident: string, cause = 'No hair net', got = 'Replaced and apologised') =>
    asUser(
      k.manager,
      (s) =>
        s.attempt(`select public.resolve_incident($1, $2, $3, $4)`, [
          k.org.id,
          incident,
          cause,
          got,
        ]),
      { commit: true },
    );
  beforeAll(async () => {
    k = await setup();
    accountant = await addMember(k.org, 'accountant');
  }, 120_000);

  it('closes only with a cause, a resolution and every corrective action done', async () => {
    const incident = await open();
    const noCause = await resolve(incident, '', 'Replaced');
    expect(noCause.ok ? 'ok' : noCause.message).toBe('incident_needs_root_cause');
    const noAction = await resolve(incident);
    expect(noAction.ok ? 'ok' : noAction.message).toBe('incident_needs_action');
    const [{ action }] = (await asUser(
      k.manager,
      (s) =>
        s.q<{ action: string }>(
          `select public.add_incident_action($1, $2, 'corrective', 'Hair nets for all kitchen staff', $3) as action`,
          [k.org.id, incident, addDays(today, -1)],
        ),
      { commit: true },
    )) as [{ action: string }];
    const pending = await resolve(incident);
    expect(pending.ok ? 'ok' : pending.message).toBe('incident_action_open');
    const [list] = await asUser(k.manager, (s) =>
      s.q<Row>('select * from public.metric_incidents($1, null, now()) where id = $2', [
        k.org.id,
        incident,
      ]),
    );
    expect([list!.status, Number(list!.overdue_actions)]).toEqual(['in_progress', 1]);
    await asUser(
      k.manager,
      (s) => s.q(`select public.complete_incident_action($1, $2)`, [k.org.id, action]),
      { commit: true },
    );
    expect((await resolve(incident)).ok).toBe(true);
    // Resolved is closed: nothing changes it until it is reopened with a reason.
    const late = await asUser(k.manager, (s) =>
      s.attempt(`select public.add_incident_action($1, $2, 'note', 'one more thing')`, [
        k.org.id,
        incident,
      ]),
    );
    expect(late.ok ? 'ok' : late.message).toBe('incident_is_resolved');
    const noReason = await asUser(k.manager, (s) =>
      s.attempt(`select public.reopen_incident($1, $2, '')`, [k.org.id, incident]),
    );
    expect(noReason.ok ? 'ok' : noReason.message).toBe('incident_needs_reason');
    await asUser(
      k.manager,
      (s) =>
        s.q(`select public.reopen_incident($1, $2, 'it happened again')`, [k.org.id, incident]),
      { commit: true },
    );
    expect((await resolve(incident)).ok).toBe(true);
  });

  it('never writes the customer’s name or phone to the audit log, and the accountant and kitchen cannot read them', async () => {
    const incident = await open();
    const rows = await admin<Row>(
      `select before, after, reason from public.audit_log where org_id = $1 and entity_id = $2`,
      [k.org.id, incident],
    );
    expect(rows.length).toBeGreaterThan(0);
    const text = JSON.stringify(rows);
    expect(text).not.toContain('01711000000');
    expect(text).not.toContain('Ayesha');
    for (const u of [accountant, k.kitchen, k.cashier]) {
      const list = await asUser(u, (s) =>
        s.attempt('select * from public.metric_incidents($1, null, now())', [k.org.id]),
      );
      expect(list.ok ? 'ok' : list.code).toBe('42501');
      const direct = await asUser(u, (s) =>
        s.q('select id from public.incidents where org_id = $1', [k.org.id]),
      );
      expect(direct).toEqual([]);
    }
  });

  it('a food-safety case can stop the ingredient in the same step', async () => {
    await open([k.chicken, true, null, null, false]);
    const blocked = await blockedAtTill(k);
    expect(blocked.map((b) => [b.menu_item_id, b.reason])).toEqual([[k.burger, 'held']]);
  });

  it('a review or comment becomes one case, however many times it is pressed', async () => {
    const review = await id(
      `insert into public.reviews (org_id, branch_id, source, rating, body, reviewed_at)
       values ($1, $2, 'facebook', 2, 'Cold food and rude staff', now()) returning id`,
      [k.org.id, k.main],
    );
    const fromReview = () =>
      asUser(
        k.manager,
        async (s) =>
          (
            await s.q<{ id: string }>('select public.incident_from_review($1, $2) as id', [
              k.org.id,
              review,
            ])
          )[0]!.id,
        { commit: true },
      );
    const first = await fromReview();
    expect(await fromReview()).toBe(first);
    const [row] = await admin<Row>(
      'select severity, source, title from public.incidents where id = $1',
      [first],
    );
    expect(row).toEqual({
      severity: 'high',
      source: 'facebook',
      title: 'Cold food and rude staff',
    });
  });

  it('summarises without any customer detail', async () => {
    const [row] = await asUser(k.manager, (s) =>
      s.q<Row>('select * from public.metric_incident_summary($1, null, now())', [k.org.id]),
    );
    expect(Number(row!.resolved_30d)).toBeGreaterThan(0);
    expect(JSON.stringify(row)).not.toContain('Ayesha');
  });

  it('a manager of another branch cannot touch the case', async () => {
    const chain = await createOrg({ branches: ['A', 'B'] });
    const managerA = await addMember(chain, 'manager', [chain.branchIds[0]!]);
    const managerB = await addMember(chain, 'manager', [chain.branchIds[1]!]);
    const [{ inc }] = (await asUser(
      managerA,
      (s) =>
        s.q<{ inc: string }>(
          `select public.open_incident($1, $2, 'other', 'low', 'other', 'Broken chair') as inc`,
          [chain.id, chain.branchIds[0]],
        ),
      { commit: true },
    )) as [{ inc: string }];
    const res = await asUser(managerB, (s) =>
      s.attempt(`select public.add_incident_action($1, $2, 'note', 'mine now')`, [chain.id, inc]),
    );
    expect(res.ok ? 'ok' : res.code).toBe('42501');
  });
});

describe('complaints written by the customer', () => {
  let k: Kitchen;
  const token = async (branch: string) =>
    (
      await admin<{ t: string }>('select complaint_token as t from public.branches where id = $1', [
        branch,
      ])
    )[0]!.t;
  const send = async (
    t: string,
    text: string,
    topic = 'food',
    name: string | null = null,
    phone: string | null = null,
  ) => {
    const [row] = await asService(
      (s) =>
        s.q<{ r: string }>('select public.submit_complaint($1, $2, $3, $4, $5, now()) as r', [
          t,
          topic,
          text,
          name,
          phone,
        ]),
      { commit: true },
    );
    return row!.r;
  };
  beforeAll(async () => {
    k = await setup();
  }, 120_000);

  it('reaches the manager, serious when someone felt sick, with no contact details in the audit log', async () => {
    expect(
      await send(
        await token(k.main),
        'Felt sick after the chicken',
        'sick',
        'Ayesha',
        '+8801711000000',
      ),
    ).toBe('ok');
    const [row] = await asUser(k.manager, (s) =>
      s.q<Row>('select * from public.metric_incidents($1, null, now())', [k.org.id]),
    );
    expect([
      row!.source,
      row!.kind,
      row!.severity,
      row!.title,
      row!.customer_name,
      row!.contact_ok,
    ]).toEqual(['customer', 'food_safety', 'high', 'Felt sick after the chicken', 'Ayesha', true]);
    const audit = JSON.stringify(
      await admin<Row>('select * from public.audit_log where org_id = $1 and entity_id = $2', [
        k.org.id,
        row!.id,
      ]),
    );
    expect(audit).toContain('incident.open');
    expect(audit).not.toContain('Ayesha');
    expect(audit).not.toContain('1711000000');
  });

  it('counts a double tap once, and takes at most 20 an hour per branch', async () => {
    const other = await setup();
    const t = await token(other.main);
    expect(await send(t, 'Cold soup')).toBe('ok');
    expect(await send(t, 'Cold soup')).toBe('ok');
    for (let i = 2; i <= 20; i++) expect(await send(t, `Complaint number ${i}`)).toBe('ok');
    expect(await send(t, 'One too many')).toBe('busy');
    const [{ n }] = (await admin<{ n: number }>(
      'select count(*)::int as n from public.incidents where org_id = $1',
      [other.org.id],
    )) as [{ n: number }];
    expect(n).toBe(20);
  }, 60_000);

  it('refuses an unknown link and blank text, and a new link stops the old one', async () => {
    const old = await token(k.main);
    expect(await send('0'.repeat(32), 'Cold soup')).toBe('gone');
    expect(await send(old, '  ')).toBe('invalid');
    await asUser(
      k.manager,
      (s) => s.q('select public.reset_complaint_link($1, $2)', [k.org.id, k.main]),
      {
        commit: true,
      },
    );
    expect(await token(k.main)).not.toBe(old);
    expect(await send(old, 'Cold soup')).toBe('gone');
  });

  it('only the service role can write, and a manager of another branch cannot change the link', async () => {
    const t = await token(k.main);
    const signedIn = await asUser(k.manager, (s) =>
      s.attempt(`select public.submit_complaint($1, 'food', 'Cold soup', null, null, now())`, [t]),
    );
    expect(signedIn.ok ? 'ok' : signedIn.code).toBe('42501');
    const chain = await createOrg({ branches: ['A', 'B'] });
    const managerA = await addMember(chain, 'manager', [chain.branchIds[0]!]);
    const res = await asUser(managerA, (s) =>
      s.attempt('select public.reset_complaint_link($1, $2)', [chain.id, chain.branchIds[1]]),
    );
    expect(res.ok ? 'ok' : res.code).toBe('42501');
  });
});
