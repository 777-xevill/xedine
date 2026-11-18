/**
 * Phase 10 onboarding (ROADMAP Phase 10; ADR 0023): the checklist ticks itself from real data, the menu
 * import creates categories and items but never overwrites, and only the owner may do either.
 */
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
const NOW = new Date('2026-07-06T06:00:00Z').toISOString();

describe('onboarding', () => {
  let org: TestOrg;
  let manager: TestUser;
  beforeAll(async () => {
    org = await createOrg({ branches: ['Main'] });
    manager = await addMember(org, 'manager', [org.branchIds[0]!]);
  });

  const progress = async () =>
    Object.fromEntries(
      (
        await asUser(org.owner, (s) =>
          s.q<Row>('select * from public.metric_setup_progress($1, $2)', [org.id, NOW]),
        )
      ).map((r) => [r.step as string, [r.done, Number(r.have), Number(r.need)]]),
    );

  it('starts with nothing ticked except what exists', async () => {
    const p = await progress();
    expect(Object.keys(p)).toHaveLength(12);
    expect(p.menu).toEqual([false, 0, 5]);
    expect(p.first_order).toEqual([false, 0, 1]);
  });

  it('imports a menu: new categories, new items, existing names skipped, never overwritten', async () => {
    const rows = [
      { category: 'Biryani', name: 'Kacchi', name_bn: 'কাচ্চি', price_poisha: 45000 },
      { category: 'biryani', name: 'Tehari', name_bn: null, price_poisha: 25000 },
      { category: 'Drinks', name: 'Borhani', name_bn: null, price_poisha: 8000 },
      { category: '', name: 'Firni', name_bn: null, price_poisha: 6000 },
      { category: 'Drinks', name: 'Lassi', name_bn: null, price_poisha: 7000 },
    ];
    const [first] = await asUser(
      org.owner,
      (s) =>
        s.q<{ r: Row }>('select public.import_menu($1, $2::jsonb) as r', [
          org.id,
          JSON.stringify(rows),
        ]),
      { commit: true },
    );
    expect(first!.r).toEqual({ created: 5, skipped: 0, categories: 3 });
    const [again] = await asUser(
      org.owner,
      (s) =>
        s.q<{ r: Row }>('select public.import_menu($1, $2::jsonb) as r', [
          org.id,
          JSON.stringify([{ category: 'Biryani', name: 'KACCHI', name_bn: null, price_poisha: 1 }]),
        ]),
      { commit: true },
    );
    expect(again!.r).toEqual({ created: 0, skipped: 1, categories: 0 });
    const [kacchi] = await admin<{ price: string }>(
      `select base_price_poisha as price from public.menu_items where org_id = $1 and name = 'Kacchi'`,
      [org.id],
    );
    expect(Number(kacchi!.price)).toBe(45000);
    expect((await progress()).menu).toEqual([true, 5, 5]);
    const audited = await admin<{ c: number }>(
      `select count(*)::int as c from public.audit_log where org_id = $1 and action = 'menu.import'`,
      [org.id],
    );
    expect(audited[0]!.c).toBe(2);
  });

  it('refuses a manager and a bad row', async () => {
    const res = await asUser(manager, (s) =>
      s.attempt('select public.import_menu($1, $2::jsonb)', [
        org.id,
        JSON.stringify([{ category: 'X', name: 'Y', price_poisha: 100 }]),
      ]),
    );
    expect(res.ok ? 'ok' : res.code).toBe('42501');
    const bad = await asUser(org.owner, (s) =>
      s.attempt('select public.import_menu($1, $2::jsonb)', [
        org.id,
        JSON.stringify([{ category: 'X', name: '', price_poisha: 100 }]),
      ]),
    );
    expect(bad.ok).toBe(false);
    const p = await asUser(manager, (s) =>
      s.attempt('select * from public.metric_setup_progress($1, $2)', [org.id, NOW]),
    );
    expect(p.ok).toBe(false);
  });
});

describe('setup health', () => {
  let org: TestOrg;
  let manager: TestUser;
  beforeAll(async () => {
    org = await createOrg({ branches: ['Main'] });
    manager = await addMember(org, 'manager', [org.branchIds[0]!]);
  });

  const health = async () =>
    await asUser(org.owner, (s) =>
      s.q<Row>('select * from public.metric_setup_health($1, $2)', [org.id, NOW]),
    );
  const byStep = async () =>
    Object.fromEntries(
      (await health()).map((r) => [r.step as string, [r.done, Number(r.have), Number(r.need)]]),
    );

  it('lists every step once, in groups, with the twelve onboarding steps marked required', async () => {
    const rows = await health();
    const steps = rows.map((r) => r.step as string);
    expect(new Set(steps).size).toBe(steps.length);
    expect(new Set(rows.map((r) => r.category))).toEqual(
      new Set([
        'basics',
        'menu',
        'selling',
        'costs',
        'stock',
        'team',
        'alerts',
        'customers',
        'golive',
      ]),
    );
    const required = rows.filter((r) => r.required).map((r) => r.step);
    for (const s of ['profile', 'menu', 'channels', 'recipes', 'owner_whatsapp', 'first_order']) {
      expect(required).toContain(s);
    }
    expect(rows.find((r) => r.step === 'member_card')!.required).toBe(false);
    // Groups come out together, in order, so the page needs no sorting of its own.
    const cats = rows.map((r) => r.category as string);
    expect(cats).toEqual([...cats].sort((a, b) => cats.indexOf(a) - cats.indexOf(b)));
  });

  it('ticks from real data: place and tax exist from sign-up, profile once cuisine and city are in', async () => {
    let p = await byStep();
    expect(p.place![0]).toBe(true);
    expect(p.tax![0]).toBe(true);
    expect(p.profile![0]).toBe(false);
    await admin(
      `insert into public.org_profile (org_id, cuisine, city) values ($1, 'biryani', 'Dhaka')
       on conflict (org_id) do update set cuisine = excluded.cuisine, city = excluded.city`,
      [org.id],
    );
    p = await byStep();
    expect(p.profile![0]).toBe(true);
  });

  it('a delivery-app channel without its commission is not done; none at all is not needed', async () => {
    expect((await byStep()).commissions).toEqual([true, 0, 0]);
    await admin(
      `insert into public.channels (org_id, name, kind, is_active) values ($1, 'foodpanda', 'foodpanda', true)`,
      [org.id],
    );
    expect((await byStep()).commissions).toEqual([false, 0, 1]);
  });

  it('only the owner may read it', async () => {
    const res = await asUser(manager, (s) =>
      s.attempt('select * from public.metric_setup_health($1, $2)', [org.id, NOW]),
    );
    expect(res.ok ? 'ok' : res.code).toBe('42501');
  });
});
