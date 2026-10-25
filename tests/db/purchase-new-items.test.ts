/**
 * Typing the bazar like a person says it (ADR 0039): a purchase line may name an item that is not in the
 * list yet. It is added, or found by name / Bangla name / learnt spelling, in the same save; a refused
 * purchase leaves no stray item; only the owner and the branch's purchaser may do it.
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

async function one<T extends Row>(sql: string, params: unknown[] = []): Promise<T> {
  const [row] = await admin<T>(sql, params);
  return row!;
}

interface Fx {
  org: TestOrg;
  b1: string;
  purchaser: TestUser;
  manager: TestUser;
  today: string;
}

const record = (fx: Fx, user: TestUser, lines: unknown[]) =>
  asUser(
    user,
    (s) =>
      s.attempt<{ id: string }>(
        `select public.record_purchase_with_new_items($1, $2, null, null, $3::date, $4::jsonb) as id`,
        [fx.org.id, fx.b1, fx.today, JSON.stringify(lines)],
      ),
    { commit: true },
  );

const count = async (fx: Fx, name: string) =>
  (
    await one<{ n: number }>(
      `select count(*)::int as n from public.ingredients where org_id = $1 and lower(name) = lower($2)`,
      [fx.org.id, name],
    )
  ).n;

describe('a purchase that names a new item', () => {
  let fx: Fx;
  beforeAll(async () => {
    const org = await createOrg({ branches: ['Dhanmondi'] });
    const b1 = org.branchIds[0]!;
    const { today } = await one<{ today: string }>(
      `select private.business_date(now(), 240)::text as today`,
    );
    fx = {
      org,
      b1,
      purchaser: await addMember(org, 'purchaser', [b1]),
      manager: await addMember(org, 'manager', [b1]),
      today,
    };
  });

  it('adds the item and records the purchase together, audited', async () => {
    const res = await record(fx, fx.purchaser, [
      {
        new_ingredient: { name: 'Kacha morich', base: 'g' },
        qty_base: 500,
        line_total_poisha: 15000,
      },
    ]);
    expect(res.ok).toBe(true);
    expect(await count(fx, 'Kacha morich')).toBe(1);
    const line = await one<{ qty_base: string; name: string }>(
      `select pl.qty_base::text, i.name from public.purchase_lines pl
         join public.ingredients i on i.id = pl.ingredient_id where pl.org_id = $1`,
      [fx.org.id],
    );
    expect(line.name).toBe('Kacha morich');
    expect(Number(line.qty_base)).toBe(500);
    const audit = await one<{ n: number }>(
      `select count(*)::int as n from public.audit_log
        where org_id = $1 and action = 'ingredient.create_from_purchase'`,
      [fx.org.id],
    );
    expect(audit.n).toBe(1);
  });

  it('finds an item by its name again instead of making a twin', async () => {
    const res = await record(fx, fx.org.owner, [
      {
        new_ingredient: { name: 'kacha MORICH', base: 'g' },
        qty_base: 200,
        line_total_poisha: 6000,
      },
    ]);
    expect(res.ok).toBe(true);
    expect(await count(fx, 'Kacha morich')).toBe(1);
  });

  it('refuses a new item that clashes with the unit an item is kept in', async () => {
    const res = await record(fx, fx.purchaser, [
      {
        new_ingredient: { name: 'Kacha morich', base: 'pcs' },
        qty_base: 3,
        line_total_poisha: 900,
      },
    ]);
    expect(res.ok).toBe(false);
  });

  it('leaves no stray item when the purchase is refused', async () => {
    const res = await record(fx, fx.purchaser, [
      { new_ingredient: { name: 'Ghost item', base: 'g' }, qty_base: 100, line_total_poisha: 500 },
      { new_ingredient: { name: 'Bad line', base: 'g' }, qty_base: 0, line_total_poisha: 500 },
    ]);
    expect(res.ok).toBe(false);
    expect(await count(fx, 'Ghost item')).toBe(0);
    expect(await count(fx, 'Bad line')).toBe(0);
  });

  it('is not open to a manager', async () => {
    const res = await record(fx, fx.manager, [
      {
        new_ingredient: { name: 'Manager item', base: 'g' },
        qty_base: 100,
        line_total_poisha: 500,
      },
    ]);
    expect(res.ok).toBe(false);
    expect(await count(fx, 'Manager item')).toBe(0);
  });

  it('refuses a line with neither an item nor a new one', async () => {
    const res = await record(fx, fx.purchaser, [{ qty_base: 100, line_total_poisha: 500 }]);
    expect(res.ok).toBe(false);
  });
});
