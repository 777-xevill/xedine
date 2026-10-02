/**
 * Items that come and go (ADR 0028). An item can be hidden only when the records say none is left
 * (or, never counted, the owner says so), only by the owner, always audited; buying it again brings it
 * back. A purchaser's pick in the chat teaches the item that spelling on ✅. Stock Guard lists what a
 * person should look at, by fixed rules.
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

type Row = Record<string, unknown>;

async function one<T extends Row>(sql: string, params: unknown[] = []): Promise<T> {
  const [row] = await admin<T>(sql, params);
  return row!;
}
const svc = (sql: string, params: unknown[] = []) =>
  asService((s) => s.q<Row>(sql, params), { commit: true });
const svcTry = (sql: string, params: unknown[] = []) =>
  asService((s) => s.attempt<Row>(sql, params));

interface Fx {
  org: TestOrg;
  b1: string;
  purchaser: TestUser;
  manager: TestUser;
  today: string;
}

let chatSeq = 0;
const newChat = () => `tg-life-${Date.now()}-${++chatSeq}`;

async function fixture(): Promise<Fx> {
  const org = await createOrg({ branches: ['Dhanmondi'] });
  const b1 = org.branchIds[0]!;
  const { today } = await one<{ today: string }>(
    `select private.business_date(now(), 240)::text as today`,
  );
  return {
    org,
    b1,
    purchaser: await addMember(org, 'purchaser', [b1]),
    manager: await addMember(org, 'manager', [b1]),
    today,
  };
}

const ingredient = async (fx: Fx, name: string, base = 'g') =>
  (
    await one<{ id: string }>(
      `insert into public.ingredients (org_id, name, base) values ($1, $2, $3) returning id`,
      [fx.org.id, name, base],
    )
  ).id;

/** A business date `days` before today. */
const ago = async (fx: Fx, days: number) =>
  (await one<{ d: string }>(`select ($1::date - $2::int)::text as d`, [fx.today, days])).d;

async function purchase(fx: Fx, ing: string, daysAgo: number, qty: number, paid: number) {
  const on = await ago(fx, daysAgo);
  const { id } = await one<{ id: string }>(
    `insert into public.purchases (org_id, branch_id, purchased_on, status, total_poisha, confirmed_at)
     values ($1, $2, $3, 'confirmed', $4, now()) returning id`,
    [fx.org.id, fx.b1, on, paid],
  );
  await admin(
    `insert into public.purchase_lines (org_id, branch_id, purchase_id, ingredient_id, qty_base, line_total_poisha)
     values ($1, $2, $3, $4, $5, $6)`,
    [fx.org.id, fx.b1, id, ing, qty, paid],
  );
}

async function count(fx: Fx, ing: string, daysAgo: number, qty: number) {
  const on = await ago(fx, daysAgo);
  const { id } = await one<{ id: string }>(
    `insert into public.stock_counts (org_id, branch_id, counted_on, status, submitted_at)
     values ($1, $2, $3, 'submitted', now()) returning id`,
    [fx.org.id, fx.b1, on],
  );
  await admin(
    `insert into public.stock_count_lines (org_id, branch_id, stock_count_id, ingredient_id, counted_qty_base)
     values ($1, $2, $3, $4, $5)`,
    [fx.org.id, fx.b1, id, ing, qty],
  );
}

const hide = (fx: Fx, user: TestUser, ing: string, noneLeft = false) =>
  asUser(
    user,
    (s) =>
      s.attempt(`select public.set_ingredient_hidden($1, $2, true, now(), $3)`, [
        fx.org.id,
        ing,
        noneLeft,
      ]),
    { commit: true },
  );
const active = async (ing: string) =>
  (await one<{ a: boolean }>(`select is_active as a from public.ingredients where id = $1`, [ing]))
    .a;

describe('hiding an item never hides money', () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await fixture();
  });

  it('only the owner hides, and only through set_ingredient_hidden', async () => {
    const cheese = await ingredient(fx, 'Cheese');
    await count(fx, cheese, 5, 0);
    expect((await hide(fx, fx.manager, cheese)).ok).toBe(false);
    expect((await hide(fx, fx.purchaser, cheese)).ok).toBe(false);
    const direct = await asUser(fx.org.owner, (s) =>
      s.attempt(`update public.ingredients set is_active = false where id = $1`, [cheese]),
    );
    expect(direct.ok).toBe(false);
    expect(await active(cheese)).toBe(true);
  });

  it('refuses while the records say some is on the shelf', async () => {
    const saffron = await ingredient(fx, 'Saffron');
    await purchase(fx, saffron, 70, 50, 500000);
    await count(fx, saffron, 10, 20);
    const res = await hide(fx, fx.org.owner, saffron);
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).toContain('still in stock');
    expect(await active(saffron)).toBe(true);
  });

  it('never counted: the owner must say none is left, and that is audited', async () => {
    const cream = await ingredient(fx, 'Cream', 'ml');
    await purchase(fx, cream, 80, 2000, 60000);
    const res = await hide(fx, fx.org.owner, cream);
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).toContain('stock unknown');
    expect((await hide(fx, fx.org.owner, cream, true)).ok).toBe(true);
    expect(await active(cream)).toBe(false);
    const audit = await one<{ actor_user_id: string; said: boolean }>(
      `select actor_user_id, (after ->> 'owner_said_none_left')::boolean as said
         from public.audit_log where org_id = $1 and action = 'ingredient.hide' and entity_id = $2`,
      [fx.org.id, cream],
    );
    expect(audit).toEqual({ actor_user_id: fx.org.owner.id, said: true });
  });

  it('counted to zero: hides without asking; buying it again brings it back', async () => {
    const lemon = await ingredient(fx, 'Lemon', 'pcs');
    await purchase(fx, lemon, 75, 40, 20000);
    await count(fx, lemon, 3, 0);
    expect((await hide(fx, fx.org.owner, lemon)).ok).toBe(true);
    expect(await active(lemon)).toBe(false);
    await purchase(fx, lemon, 0, 20, 10000);
    expect(await active(lemon)).toBe(true);
    const back = await one<{ reason: string }>(
      `select reason from public.audit_log where org_id = $1 and action = 'ingredient.unhide' and entity_id = $2`,
      [fx.org.id, lemon],
    );
    expect(back.reason).toBe('bought again');
  });
});

describe('a pick in the chat', () => {
  let fx: Fx;
  let chat: string;
  let chicken: string;
  beforeAll(async () => {
    fx = await fixture();
    chicken = await ingredient(fx, 'Chicken');
    chat = newChat();
    const [link] = await asUser(
      fx.org.owner,
      (s) =>
        s.q<{ code: string }>(`select public.create_chat_link($1, $2, $3, 'telegram') as code`, [
          fx.org.id,
          fx.purchaser.id,
          fx.b1,
        ]),
      { commit: true },
    );
    await svc(`select * from public.chat_redeem_link('telegram', $1, $2)`, [chat, link!.code]);
  });

  const line = (over: Row) => ({
    name: 'deshi murgi',
    ingredient_id: null,
    qty: 2,
    unit: 'kg',
    qty_base: 2000,
    line_total_poisha: 120000,
    flags: ['pick'],
    candidates: [chicken],
    ...over,
  });
  const draft = async (lines: Row[]) =>
    (
      await svc(
        `select public.chat_create_purchase_draft('telegram', $1, 'import', 'x', $2::jsonb, '{}') as id`,
        [chat, JSON.stringify({ supplier: '', lines })],
      )
    )[0]!.id as string;

  it('a line waiting for a pick blocks ✅', async () => {
    const d = await draft([line({})]);
    const res = await svcTry(`select public.chat_confirm_purchase_draft('telegram', $1, $2)`, [
      chat,
      d,
    ]);
    expect(res.ok).toBe(false);
  });

  it('the pick is saved on the own draft only, with the same number of lines', async () => {
    const d = await draft([line({})]);
    const picked = JSON.stringify([
      line({ ingredient_id: chicken, flags: [], picked: true, candidates: undefined }),
    ]);
    const wrong = await svcTry(
      `select public.chat_update_purchase_draft('telegram', $1, $2, $3::jsonb, '{}')`,
      [chat, d, JSON.stringify([])],
    );
    expect(wrong.ok).toBe(false);
    const stranger = await svcTry(
      `select public.chat_update_purchase_draft('telegram', $1, $2, $3::jsonb, '{}')`,
      ['nobody', d, picked],
    );
    expect(stranger.ok).toBe(false);
    await svc(`select public.chat_update_purchase_draft('telegram', $1, $2, $3::jsonb, '{}')`, [
      chat,
      d,
      picked,
    ]);
    await svc(`select public.chat_confirm_purchase_draft('telegram', $1, $2)`, [chat, d]);
    const lines = await admin<{ ingredient_id: string }>(
      `select pl.ingredient_id from public.purchase_lines pl join public.purchase_drafts d on d.purchase_id = pl.purchase_id where d.id = $1`,
      [d],
    );
    expect(lines).toEqual([{ ingredient_id: chicken }]);
  });

  it('✅ remembers the spelling once, audited as the purchaser; everyone can read it, only the owner edits', async () => {
    const aliases = await admin<{ alias: string; ingredient_id: string }>(
      `select alias, ingredient_id from public.ingredient_aliases where org_id = $1`,
      [fx.org.id],
    );
    expect(aliases).toEqual([{ alias: 'deshi murgi', ingredient_id: chicken }]);
    // A second pick with the same spelling adds nothing.
    const d = await draft([line({ ingredient_id: chicken, flags: [], picked: true })]);
    await svc(`select public.chat_confirm_purchase_draft('telegram', $1, $2)`, [chat, d]);
    const n = await one<{ n: number }>(
      `select count(*)::int as n from public.ingredient_aliases where org_id = $1`,
      [fx.org.id],
    );
    expect(n.n).toBe(1);
    const audit = await one<{ actor_user_id: string }>(
      `select actor_user_id from public.audit_log where org_id = $1 and action = 'ingredient.alias_from_chat'`,
      [fx.org.id],
    );
    expect(audit.actor_user_id).toBe(fx.purchaser.id);
    const seen = await asUser(fx.manager, (s) =>
      s.q<{ n: number }>(`select count(*)::int as n from public.ingredient_aliases`),
    );
    expect(seen[0]!.n).toBe(1);
    const write = await asUser(fx.manager, (s) =>
      s.attempt(
        `insert into public.ingredient_aliases (org_id, ingredient_id, alias) values ($1, $2, 'broiler')`,
        [fx.org.id, chicken],
      ),
    );
    expect(write.ok).toBe(false);
  });

  it('a new item is marked as added from the chat; a hidden one of that name comes back instead', async () => {
    const newLine = (name: string) => ({
      name,
      ingredient_id: null,
      qty: 1,
      unit: 'kg',
      qty_base: 1000,
      line_total_poisha: 30000,
      flags: [],
      new_ingredient: { name, base: 'g' },
    });
    await svc(`select public.chat_confirm_purchase_draft('telegram', $1, $2)`, [
      chat,
      await draft([newLine('Paneer')]),
    ]);
    const paneer = await one<{ id: string; added_via: string }>(
      `select id, added_via from public.ingredients where org_id = $1 and name = 'Paneer'`,
      [fx.org.id],
    );
    expect(paneer.added_via).toBe('chat');

    const basil = await ingredient(fx, 'Basil');
    await count(fx, basil, 2, 0);
    expect((await hide(fx, fx.org.owner, basil)).ok).toBe(true);
    await svc(`select public.chat_confirm_purchase_draft('telegram', $1, $2)`, [
      chat,
      await draft([newLine('basil')]),
    ]);
    const basils = await admin<{ id: string; is_active: boolean }>(
      `select id, is_active from public.ingredients where org_id = $1 and lower(name) = 'basil'`,
      [fx.org.id],
    );
    expect(basils).toEqual([{ id: basil, is_active: true }]);
  });
});

describe('Stock Guard', () => {
  let fx: Fx;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    fx = await fixture();
    // Price typo: four purchases at ৳180/kg, then ৳1,800/kg (a zero too many).
    ids.onion = await ingredient(fx, 'Onion');
    for (const d of [20, 15, 10, 5]) await purchase(fx, ids.onion, d, 10000, 180000);
    await purchase(fx, ids.onion, 1, 10000, 1800000);
    // Below zero: counted 100 g, then 300 g thrown away.
    ids.ghee = await ingredient(fx, 'Ghee');
    await count(fx, ids.ghee, 4, 100);
    await admin(
      `insert into public.waste_logs (org_id, branch_id, ingredient_id, qty_base, business_date) values ($1, $2, $3, 300, $4)`,
      [fx.org.id, fx.b1, ids.ghee, await ago(fx, 2)],
    );
    // Idle: 2 kg on the shelf, nothing bought or used for 70 days.
    ids.cashew = await ingredient(fx, 'Cashew');
    await purchase(fx, ids.cashew, 90, 2000, 200000);
    await count(fx, ids.cashew, 70, 2000);
    // Unused, counted empty: may be hidden.
    ids.mint = await ingredient(fx, 'Mint');
    await purchase(fx, ids.mint, 100, 500, 5000);
    await count(fx, ids.mint, 65, 0);
    // Unused, never counted: ask the owner.
    ids.cheese = await ingredient(fx, 'Cheese');
    await purchase(fx, ids.cheese, 80, 1000, 90000);
  });

  const guard = async (u: TestUser) =>
    asUser(u, (s) =>
      s.q<{
        kind: string;
        name: string;
        qty: string | null;
        last_total_poisha: string | null;
        usual_total_poisha: string | null;
      }>(
        `select kind, name, qty::text, last_total_poisha::text, usual_total_poisha::text
           from public.metric_stock_guard($1, $2, now())`,
        [fx.org.id, fx.b1],
      ),
    );

  it('lists each kind for the owner, by fixed rules', async () => {
    const rows = await guard(fx.org.owner);
    const by = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.name);
    expect(by('price_typo')).toEqual(['Onion']);
    expect(rows.find((r) => r.kind === 'price_typo')).toMatchObject({
      last_total_poisha: '1800000',
      usual_total_poisha: '180000',
    });
    expect(by('below_zero')).toEqual(['Ghee']);
    expect(rows.find((r) => r.kind === 'below_zero')!.qty).toBe('-200');
    expect(by('idle_stock')).toEqual(['Cashew']);
    expect(by('unused')).toEqual(['Mint']);
    expect(by('unused_unknown')).toEqual(['Cheese']);
  });

  it('names the purchaser who added an item from the chat', async () => {
    const { id } = await one<{ id: string }>(
      `insert into public.ingredients (org_id, name, base, added_via) values ($1, 'Kalojira', 'g', 'chat') returning id`,
      [fx.org.id],
    );
    await admin(`update public.profiles set full_name = 'Karim' where user_id = $1`, [
      fx.purchaser.id,
    ]);
    await admin(
      `insert into public.audit_log (org_id, branch_id, actor_user_id, action, entity, entity_id)
       values ($1, $2, $3, 'ingredient.create_from_chat', 'ingredient', $4)`,
      [fx.org.id, fx.b1, fx.purchaser.id, id],
    );
    const rows = await asUser(fx.manager, (s) =>
      s.q<{ kind: string; name: string; actor: string }>(
        `select kind, name, actor from public.metric_stock_guard($1, $2, now()) where kind = 'new_item'`,
        [fx.org.id, fx.b1],
      ),
    );
    expect(rows).toEqual([{ kind: 'new_item', name: 'Kalojira', actor: 'Karim' }]);
  });

  it('a price check is money: a manager gets the rest of the list, not the price', async () => {
    const rows = await guard(fx.manager);
    expect(rows.some((r) => r.kind === 'price_typo')).toBe(false);
    expect(rows.some((r) => r.kind === 'below_zero')).toBe(true);
  });

  it('another org sees nothing of it', async () => {
    const other = await fixture();
    const res = await asUser(other.org.owner, (s) =>
      s.attempt(`select * from public.metric_stock_guard($1, null, now())`, [fx.org.id]),
    );
    expect(res.ok).toBe(false);
  });
});
