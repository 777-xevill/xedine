/**
 * Food facts (ADR 0049): the AI's guesses wait for a person; only the owner or a manager approves (audited);
 * a guess never overwrites an approval; the table page shows only approved facts.
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
const NOW = '2026-11-14T08:00:00Z';

describe('dish nutrition', () => {
  let org: TestOrg;
  let manager: TestUser;
  let cashier: TestUser;
  let kacchi: string;
  let firni: string;
  let token: string;

  const guess = (u: TestUser, rows: unknown[]) =>
    asUser(
      u,
      (s) =>
        s.attempt('select public.put_nutrition_guesses($1, $2::jsonb, $3, 1) as n', [
          org.id,
          JSON.stringify(rows),
          'test-model',
        ]),
      commit,
    );
  const approve = (u: TestUser, item: string, kcal: number, protein: number, allergens: string[]) =>
    asUser(
      u,
      (s) =>
        s.attempt('select public.approve_dish_nutrition($1, $2, $3, $4, 50, 20, $5::text[])', [
          org.id,
          item,
          kcal,
          protein,
          allergens,
        ]),
      commit,
    );
  const facts = (item: string) =>
    admin<{ kcal: number; protein_g: string; status: string; allergens: string[] }>(
      'select kcal, protein_g, status, allergens from public.dish_nutrition where org_id = $1 and menu_item_id = $2',
      [org.id, item],
    ).then((r) => r[0]);

  beforeAll(async () => {
    org = await createOrg({ branches: ['Dhanmondi'] });
    manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    cashier = await addMember(org, 'cashier', [org.branchIds[0]!]);
    const items = await admin<{ id: string; name: string }>(
      `insert into public.menu_items (org_id, name, base_price_poisha)
       values ($1, 'Kacchi', 42000), ($1, 'Firni', 9000) returning id, name`,
      [org.id],
    );
    kacchi = items.find((i) => i.name === 'Kacchi')!.id;
    firni = items.find((i) => i.name === 'Firni')!.id;
    const [tb] = await admin<{ qr_token: string }>(
      `insert into public.dining_tables (org_id, branch_id, name) values ($1, $2, '1') returning qr_token`,
      [org.id, org.branchIds[0]],
    );
    token = tb!.qr_token;
  });

  const row = (id: string, kcal: number) => ({
    menu_item_id: id,
    kcal,
    protein_g: 30,
    carbs_g: 90,
    fat_g: 35,
    allergens: ['milk', 'milk'],
  });

  it('a manager saves AI guesses; a cashier cannot', async () => {
    const r = await guess(manager, [row(kacchi, 850), row(firni, 300)]);
    expect(r.ok).toBe(true);
    expect((await facts(kacchi))!.status).toBe('ai_guess');
    expect((await facts(kacchi))!.allergens).toEqual(['milk']);
    expect((await guess(cashier, [row(kacchi, 1)])).ok).toBe(false);
    expect((await approve(cashier, kacchi, 800, 30, [])).ok).toBe(false);
    expect((await facts(kacchi))!.kcal).toBe(850);
  });

  it('nobody writes the table directly', async () => {
    for (const u of [org.owner, manager]) {
      const r = await asUser(u, (s) =>
        s.attempt(
          `update public.dish_nutrition set status = 'approved', approved_at = now() where org_id = $1`,
          [org.id],
        ),
      );
      // RLS has no write policy: the update touches nothing or is refused.
      if (r.ok) expect((await facts(kacchi))!.status).toBe('ai_guess');
    }
  });

  it('the table page shows only approved facts', async () => {
    const before = await asService((s) =>
      s.q<{ v: { menu: { name: string; kcal: number | null }[] } }>(
        'select public.table_page($1, $2) as v',
        [token, NOW],
      ),
    );
    expect(before[0]!.v.menu.find((m) => m.name === 'Kacchi')!.kcal).toBeNull();

    expect((await approve(manager, kacchi, 820, 31.26, ['milk', 'nuts'])).ok).toBe(true);
    const after = await asService((s) =>
      s.q<{
        v: {
          menu: {
            name: string;
            kcal: number | null;
            protein_g: number | null;
            allergens: string[] | null;
          }[];
        };
      }>('select public.table_page($1, $2) as v', [token, NOW]),
    );
    const k = after[0]!.v.menu.find((m) => m.name === 'Kacchi')!;
    expect(k.kcal).toBe(820);
    expect(Number(k.protein_g)).toBe(31.3);
    expect([...k.allergens!].sort()).toEqual(['milk', 'nuts']);
    expect(after[0]!.v.menu.find((m) => m.name === 'Firni')!.kcal).toBeNull();
  });

  it('a later guess never overwrites an approval, and approving is audited', async () => {
    await guess(org.owner, [row(kacchi, 1500)]);
    expect((await facts(kacchi))!.kcal).toBe(820);
    const audit = await admin<{ n: number }>(
      `select count(*)::int as n from public.audit_log
        where org_id = $1 and action = 'menu.nutrition_approve' and entity_id = $2`,
      [org.id, kacchi],
    );
    expect(audit[0]!.n).toBe(1);
  });

  it('a bad allergen or value is refused; removing facts is audited', async () => {
    expect((await approve(manager, firni, 300, 6, ['peanut'])).ok).toBe(false);
    expect((await approve(manager, firni, 99999, 6, [])).ok).toBe(false);
    const r = await asUser(
      manager,
      (s) => s.attempt('select public.clear_dish_nutrition($1, $2)', [org.id, kacchi]),
      commit,
    );
    expect(r.ok).toBe(true);
    expect(await facts(kacchi)).toBeUndefined();
    const audit = await admin<{ n: number }>(
      `select count(*)::int as n from public.audit_log where org_id = $1 and action = 'menu.nutrition_clear'`,
      [org.id],
    );
    expect(audit[0]!.n).toBe(1);
  });

  it('a dish from another restaurant cannot be given facts', async () => {
    const other = await createOrg({ branches: ['X'] });
    const [dish] = await admin<{ id: string }>(
      `insert into public.menu_items (org_id, name) values ($1, 'Other') returning id`,
      [other.id],
    );
    expect((await approve(manager, dish!.id, 300, 6, [])).ok).toBe(false);
    const g = await guess(manager, [row(dish!.id, 300)]);
    expect(g.ok).toBe(true);
    const n = await admin<{ n: number }>(
      'select count(*)::int as n from public.dish_nutrition where menu_item_id = $1',
      [dish!.id],
    );
    expect(n[0]!.n).toBe(0);
  });
});
