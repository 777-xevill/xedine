/**
 * The bazar by chat (ADR 0025). The bot runs as the service role but acts as the one person the owner
 * linked the chat to: every check below is the same owner/purchaser rule the web applies, and the
 * audit log names the person, never the bot.
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
  b2: string;
  purchaser: TestUser;
  manager: TestUser;
  chicken: string;
  onion: string;
  today: string;
}

let chatSeq = 0;
const newChat = () => `tg-${Date.now()}-${++chatSeq}`;

async function fixture(): Promise<Fx> {
  const org = await createOrg({ branches: ['Dhanmondi', 'Mirpur'] });
  const [b1, b2] = org.branchIds as [string, string];
  const purchaser = await addMember(org, 'purchaser', [b1]);
  const manager = await addMember(org, 'manager', [b1]);
  const ing = async (name: string) =>
    (
      await one<{ id: string }>(
        `insert into public.ingredients (org_id, name, base) values ($1, $2, 'g') returning id`,
        [org.id, name],
      )
    ).id;
  const { today } = await one<{ today: string }>(
    `select private.business_date(now(), 240)::text as today`,
  );
  return {
    org,
    b1,
    b2,
    purchaser,
    manager,
    chicken: await ing('Chicken'),
    onion: await ing('Onion'),
    today,
  };
}

const makeLink = async (fx: Fx, user: TestUser, branch: string) => {
  const rows = await asUser(
    fx.org.owner,
    (s) =>
      s.q<{ code: string }>(`select public.create_chat_link($1, $2, $3, 'telegram') as code`, [
        fx.org.id,
        user.id,
        branch,
      ]),
    { commit: true },
  );
  return rows[0]!.code;
};

const draftJson = (fx: Fx, flagged = false) =>
  JSON.stringify({
    supplier: '',
    lines: [
      {
        name: 'murgi',
        ingredient_id: fx.chicken,
        qty: 10,
        unit: 'kg',
        qty_base: 10000,
        line_total_poisha: 180000,
        flags: [],
      },
      {
        name: 'piyaj',
        ingredient_id: flagged ? null : fx.onion,
        qty: 5,
        unit: 'kg',
        qty_base: flagged ? null : 5000,
        line_total_poisha: 30000,
        flags: flagged ? ['no_match'] : [],
      },
    ],
  });

const createDraft = async (chat: string, extracted: string) =>
  (
    await svc(
      `select public.chat_create_purchase_draft('telegram', $1, 'voice', 'murgi 10 kg 1800', $2::jsonb, '{}') as id`,
      [chat, extracted],
    )
  )[0]!.id as string;

describe('linking a chat', () => {
  let fx: Fx;
  beforeAll(async () => {
    fx = await fixture();
  });

  it('only the owner makes links, and only for someone who may buy for that branch', async () => {
    const byManager = await asUser(fx.manager, (s) =>
      s.attempt(`select public.create_chat_link($1, $2, $3, 'telegram')`, [
        fx.org.id,
        fx.purchaser.id,
        fx.b1,
      ]),
    );
    expect(byManager.ok).toBe(false);
    const forManager = await asUser(fx.org.owner, (s) =>
      s.attempt(`select public.create_chat_link($1, $2, $3, 'telegram')`, [
        fx.org.id,
        fx.manager.id,
        fx.b1,
      ]),
    );
    expect(forManager.ok).toBe(false);
    const otherBranch = await asUser(fx.org.owner, (s) =>
      s.attempt(`select public.create_chat_link($1, $2, $3, 'telegram')`, [
        fx.org.id,
        fx.purchaser.id,
        fx.b2,
      ]),
    );
    expect(otherBranch.ok).toBe(false);
  });

  it('a code works once, only through the service role, and stores only its hash', async () => {
    const code = await makeLink(fx, fx.purchaser, fx.b1);
    const [stored] = await admin<{ code_hash: string }>(
      `select code_hash from public.chat_links where org_id = $1 and user_id = $2 and revoked_at is null`,
      [fx.org.id, fx.purchaser.id],
    );
    expect(stored!.code_hash).not.toContain(code);
    const chat = newChat();
    const byUser = await asUser(fx.purchaser, (s) =>
      s.attempt(`select * from public.chat_redeem_link('telegram', $1, $2)`, [chat, code]),
    );
    expect(byUser.ok).toBe(false);
    const [who] = await svc(`select * from public.chat_redeem_link('telegram', $1, $2)`, [
      chat,
      code,
    ]);
    expect(who).toEqual({ org_id: fx.org.id, branch_id: fx.b1, user_id: fx.purchaser.id });
    const again = await svcTry(`select * from public.chat_redeem_link('telegram', $1, $2)`, [
      newChat(),
      code,
    ]);
    expect(again.ok).toBe(false);
    // The audit log names the purchaser, not the bot.
    const [audit] = await admin<{ actor_user_id: string }>(
      `select actor_user_id from public.audit_log where org_id = $1 and action = 'chat.linked'`,
      [fx.org.id],
    );
    expect(audit!.actor_user_id).toBe(fx.purchaser.id);
  });

  it('a new link replaces an unused one; an expired code is refused', async () => {
    const first = await makeLink(fx, fx.purchaser, fx.b1);
    const second = await makeLink(fx, fx.purchaser, fx.b1);
    expect(
      (
        await svcTry(`select * from public.chat_redeem_link('telegram', $1, $2)`, [
          newChat(),
          first,
        ])
      ).ok,
    ).toBe(false);
    await admin(
      `update public.chat_links set code_expires_at = now() - interval '1 minute' where org_id = $1 and code_hash is not null`,
      [fx.org.id],
    );
    expect(
      (
        await svcTry(`select * from public.chat_redeem_link('telegram', $1, $2)`, [
          newChat(),
          second,
        ])
      ).ok,
    ).toBe(false);
  });

  it('the purchaser sees their own link and the owner sees all; a manager sees none', async () => {
    const count = async (u: TestUser) =>
      (
        await asUser(u, (s) =>
          s.q<{ n: number }>(`select count(*)::int as n from public.chat_links where org_id = $1`, [
            fx.org.id,
          ]),
        )
      )[0]!.n;
    expect(await count(fx.purchaser)).toBeGreaterThan(0);
    expect(await count(fx.org.owner)).toBeGreaterThan(0);
    expect(await count(fx.manager)).toBe(0);
  });
});

describe('a purchase from the chat', () => {
  let fx: Fx;
  let chat: string;
  beforeAll(async () => {
    fx = await fixture();
    chat = newChat();
    await svc(`select * from public.chat_redeem_link('telegram', $1, $2)`, [
      chat,
      await makeLink(fx, fx.purchaser, fx.b1),
    ]);
  });

  const purchases = async () =>
    admin<{ total: string; entered_by: string; source: string; day: string }>(
      `select total_poisha::text as total, entered_by, source::text, purchased_on::text as day from public.purchases where org_id = $1`,
      [fx.org.id],
    );

  it('an unconnected chat can do nothing', async () => {
    const res = await svcTry(
      `select public.chat_create_purchase_draft('telegram', 'nobody', 'voice', 'x', '{}', '{}')`,
    );
    expect(res.ok).toBe(false);
  });

  it('a draft moves nothing; ✅ records exactly the draft, as the purchaser, once', async () => {
    const draft = await createDraft(chat, draftJson(fx));
    const [d] = await admin<{ created_by: string; branch_id: string }>(
      `select created_by, branch_id from public.purchase_drafts where id = $1`,
      [draft],
    );
    expect(d).toEqual({ created_by: fx.purchaser.id, branch_id: fx.b1 });
    expect(await purchases()).toHaveLength(0);

    await svc(`select public.chat_confirm_purchase_draft('telegram', $1, $2)`, [chat, draft]);
    // ৳1,800 + ৳300 = ৳2,100 = 210000 poisha.
    expect(await purchases()).toEqual([
      { total: '210000', entered_by: fx.purchaser.id, source: 'voice', day: fx.today },
    ]);
    const lines = await admin<{ ingredient_id: string; qty: string }>(
      `select ingredient_id, qty_base::text as qty from public.purchase_lines where org_id = $1 order by qty_base`,
      [fx.org.id],
    );
    expect(lines).toEqual([
      { ingredient_id: fx.onion, qty: '5000' },
      { ingredient_id: fx.chicken, qty: '10000' },
    ]);
    const twice = await svcTry(`select public.chat_confirm_purchase_draft('telegram', $1, $2)`, [
      chat,
      draft,
    ]);
    expect(twice.ok).toBe(false);
    expect(await purchases()).toHaveLength(1);
    const [audit] = await admin<{ actor_user_id: string }>(
      `select actor_user_id from public.audit_log where org_id = $1 and action = 'purchase.confirm_draft'`,
      [fx.org.id],
    );
    expect(audit!.actor_user_id).toBe(fx.purchaser.id);
  });

  it('a flagged draft cannot be confirmed from the chat; ❌ discards it', async () => {
    const draft = await createDraft(chat, draftJson(fx, true));
    const res = await svcTry(`select public.chat_confirm_purchase_draft('telegram', $1, $2)`, [
      chat,
      draft,
    ]);
    expect(res.ok).toBe(false);
    await svc(`select public.chat_discard_purchase_draft('telegram', $1, $2)`, [chat, draft]);
    const [d] = await admin<{ status: string }>(
      `select status::text from public.purchase_drafts where id = $1`,
      [draft],
    );
    expect(d!.status).toBe('discarded');
  });

  it("another chat cannot touch this chat's draft", async () => {
    const draft = await createDraft(chat, draftJson(fx));
    const otherOrg = await fixture();
    const otherChat = newChat();
    await svc(`select * from public.chat_redeem_link('telegram', $1, $2)`, [
      otherChat,
      await makeLink(otherOrg, otherOrg.purchaser, otherOrg.b1),
    ]);
    const res = await svcTry(`select public.chat_confirm_purchase_draft('telegram', $1, $2)`, [
      otherChat,
      draft,
    ]);
    expect(res.ok).toBe(false);
  });

  it('removing the purchaser from the branch stops the chat at once', async () => {
    await admin(
      `update public.memberships set status = 'suspended' where org_id = $1 and user_id = $2`,
      [fx.org.id, fx.purchaser.id],
    );
    const res = await svcTry(
      `select public.chat_create_purchase_draft('telegram', $1, 'voice', 'x', '{}', '{}')`,
      [chat],
    );
    expect(res.ok).toBe(false);
    await admin(
      `update public.memberships set status = 'active' where org_id = $1 and user_id = $2`,
      [fx.org.id, fx.purchaser.id],
    );
  });

  it('/stop disconnects the chat', async () => {
    const [r] = await svc(`select public.chat_unlink('telegram', $1) as ok`, [chat]);
    expect(r!.ok).toBe(true);
    const res = await svcTry(
      `select public.chat_create_purchase_draft('telegram', $1, 'voice', 'x', '{}', '{}')`,
      [chat],
    );
    expect(res.ok).toBe(false);
  });
});

describe('a new item on the list', () => {
  let fx: Fx;
  let chat: string;
  beforeAll(async () => {
    fx = await fixture();
    chat = newChat();
    await svc(`select * from public.chat_redeem_link('telegram', $1, $2)`, [
      chat,
      await makeLink(fx, fx.purchaser, fx.b1),
    ]);
  });

  const withNew = (name: string, base = 'g') =>
    JSON.stringify({
      supplier: '',
      lines: [
        {
          name: 'murgi',
          ingredient_id: fx.chicken,
          qty_base: 3000,
          line_total_poisha: 54000,
          flags: [],
        },
        {
          name,
          ingredient_id: null,
          qty_base: 2000,
          line_total_poisha: 40000,
          flags: [],
          new_ingredient: { name, base },
        },
      ],
    });
  const ingredientsNamed = (name: string) =>
    admin<{ base: string }>(
      `select base::text from public.ingredients where org_id = $1 and name = $2`,
      [fx.org.id, name],
    );

  it('creates nothing until ✅, then creates the item and buys it, audited as the purchaser', async () => {
    const draft = await createDraft(chat, withNew('Kacha Morich'));
    expect(await ingredientsNamed('Kacha Morich')).toHaveLength(0);
    await svc(`select public.chat_confirm_purchase_draft('telegram', $1, $2)`, [chat, draft]);
    expect(await ingredientsNamed('Kacha Morich')).toEqual([{ base: 'g' }]);
    const [p] = await admin<{ qty: string; poisha: string }>(
      `select pl.qty_base::text as qty, pl.line_total_poisha::text as poisha
         from public.purchase_lines pl join public.ingredients i on i.id = pl.ingredient_id
        where pl.org_id = $1 and i.name = 'Kacha Morich'`,
      [fx.org.id],
    );
    expect(p).toEqual({ qty: '2000', poisha: '40000' });
    const [audit] = await admin<{ actor_user_id: string }>(
      `select actor_user_id from public.audit_log where org_id = $1 and action = 'ingredient.create_from_chat'`,
      [fx.org.id],
    );
    expect(audit!.actor_user_id).toBe(fx.purchaser.id);
  });

  it('cancelling creates nothing; a same-named item is reused, never duplicated or re-based', async () => {
    const cancelled = await createDraft(chat, withNew('Dhone Pata'));
    await svc(`select public.chat_discard_purchase_draft('telegram', $1, $2)`, [chat, cancelled]);
    expect(await ingredientsNamed('Dhone Pata')).toHaveLength(0);

    const again = await createDraft(chat, withNew('kacha morich'));
    await svc(`select public.chat_confirm_purchase_draft('telegram', $1, $2)`, [chat, again]);
    expect(await ingredientsNamed('Kacha Morich')).toHaveLength(1);

    const clash = await createDraft(chat, withNew('Kacha Morich', 'pcs'));
    const res = await svcTry(`select public.chat_confirm_purchase_draft('telegram', $1, $2)`, [
      chat,
      clash,
    ]);
    expect(res.ok).toBe(false);
  });
});
