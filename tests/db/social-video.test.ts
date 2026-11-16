/**
 * Short videos (ADR 0061): the owner or a manager sets the videos (how many a day, the voice, greetings) and
 * makes their own video of 1–3 dishes, any kind, any special day, or a real offer below the menu price; a
 * dish's high-quality photo sits only in the org's own hq/ folder; growth.pairs counts dishes bought
 * together; the autopilot may plan several videos a day (one per slot). Nobody else, and no other
 * restaurant, can do any of it, and every change is audited.
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

const code = (r: { ok: true } | { ok: false; code: string }) => (r.ok ? 'ok' : r.code);
const commit = { commit: true };

async function dish(orgId: string, name: string, pricePoisha = 30000): Promise<string> {
  const [row] = await admin<{ id: string }>(
    `insert into public.menu_items (org_id, name, photo_path, base_price_poisha) values ($1, $2, $3, $4) returning id`,
    [orgId, name, `${orgId}/${name.toLowerCase()}.webp`, pricePoisha],
  );
  return row!.id;
}

describe('social video', () => {
  let org: TestOrg;
  let other: TestOrg;
  let manager: TestUser;
  let accountant: TestUser;
  let kacchi: string;
  let borhani: string;
  let firni: string;
  let noPhoto: string;

  beforeAll(async () => {
    org = await createOrg({ branches: ['Main'] });
    other = await createOrg({ branches: ['Main'] });
    manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    accountant = await addMember(org, 'accountant', []);
    kacchi = await dish(org.id, 'Kacchi', 35000);
    borhani = await dish(org.id, 'Borhani', 8000);
    firni = await dish(org.id, 'Firni', 6000);
    const [n] = await admin<{ id: string }>(
      `insert into public.menu_items (org_id, name) values ($1, 'Tea') returning id`,
      [org.id],
    );
    noPhoto = n!.id;
  });

  const settings = (
    who: TestUser,
    perDay: number,
    share = 'half',
    gender = 'female',
    greet = true,
  ) =>
    asUser(
      who,
      (s) =>
        s.attempt('select public.save_social_video_settings($1, $2::smallint, $3, $4, $5)', [
          org.id,
          perDay,
          share,
          gender,
          greet,
        ]),
      commit,
    );

  it('the owner or a manager sets the videos; others are refused; bad values are refused; audited', async () => {
    expect(code(await settings(org.owner, 3, 'all', 'male', false))).toBe('ok');
    expect(code(await settings(manager, 2))).toBe('ok');
    for (const who of [accountant, other.owner]) expect(code(await settings(who, 5))).toBe('42501');
    expect(code(await settings(org.owner, 6))).toBe('22023');
    expect(code(await settings(org.owner, 1, 'loud'))).toBe('22023');
    const [s] = await admin<Record<string, unknown>>(
      `select videos_per_day, voice_share, voice_gender, greetings from public.social_settings where org_id = $1`,
      [org.id],
    );
    expect(s).toEqual({
      videos_per_day: 2,
      voice_share: 'half',
      voice_gender: 'female',
      greetings: true,
    });
    const audits = await admin(
      `select 1 from public.audit_log where org_id = $1 and action = 'social.video_settings'`,
      [org.id],
    );
    expect(audits).toHaveLength(2);
  });

  const request = (
    who: TestUser,
    items: string[],
    kind: string | null,
    o: {
      occasion?: string | null;
      text?: string | null;
      offer?: number | null;
      orgId?: string;
    } = {},
  ) =>
    asUser(
      who,
      (s) =>
        s.attempt(
          `select public.request_social_video($1, $2::uuid[], $3, $4, $5, 'Family time', $6, now(), current_date)`,
          [o.orgId ?? org.id, items, kind, o.occasion ?? null, o.text ?? null, o.offer ?? null],
        ),
      commit,
    );

  it('makes an owner or manager video of 1–3 dishes in a kind that fits', async () => {
    expect(code(await request(org.owner, [kacchi], 'showcase'))).toBe('ok');
    expect(
      code(await request(manager, [kacchi, borhani], 'versus', { occasion: 'eid_fitr' })),
    ).toBe('ok');
    expect(code(await request(org.owner, [kacchi, borhani, firni], null))).toBe('ok');
    expect(code(await request(org.owner, [kacchi, borhani], 'search'))).toBe('ok');
    const rows = await admin<Record<string, unknown>>(
      `select menu_item_id, extra_item_ids, video_kind, occasion, format, source, angle
         from public.social_posts where org_id = $1 order by created_at`,
      [org.id],
    );
    expect(rows[1]).toMatchObject({
      menu_item_id: kacchi,
      extra_item_ids: [borhani],
      video_kind: 'versus',
      occasion: 'eid_fitr',
      format: 'video',
      source: 'owner',
      angle: 'own',
    });
    expect(rows[2]!.extra_item_ids).toEqual([borhani, firni]);
    expect(rows[2]!.video_kind).toBeNull();
  });

  it('refuses the wrong number of dishes, a dish without a photo, and anyone else', async () => {
    expect(code(await request(org.owner, [kacchi, borhani], 'showcase'))).toBe('22023');
    expect(code(await request(org.owner, [kacchi], 'carousel'))).toBe('22023');
    expect(code(await request(org.owner, [], null))).toBe('22023');
    expect(code(await request(org.owner, [kacchi, borhani, firni, noPhoto], null))).toBe('22023');
    expect(code(await request(org.owner, [noPhoto], null))).toBe('22023');
    expect(code(await request(org.owner, [kacchi], 'showcase', { occasion: 'Bad Day' }))).toBe(
      '22023',
    );
    expect(code(await request(accountant, [kacchi], 'showcase'))).toBe('42501');
    expect(code(await request(other.owner, [kacchi], 'showcase'))).toBe('42501');
    // Another restaurant's dish cannot be put in this restaurant's video.
    const theirs = await dish(other.id, 'Burger');
    expect(code(await request(org.owner, [theirs], null))).toBe('22023');
  });

  it('a custom special day needs its words; an offer needs one dish and a price below the menu', async () => {
    expect(code(await request(org.owner, [kacchi], null, { occasion: 'custom' }))).toBe('22023');
    expect(
      code(
        await request(org.owner, [kacchi], null, { occasion: 'custom', text: 'Our 5th birthday' }),
      ),
    ).toBe('ok');
    expect(code(await request(org.owner, [kacchi], 'offer', { offer: 35000 }))).toBe('23514');
    expect(code(await request(org.owner, [kacchi], 'offer'))).toBe('23514');
    expect(code(await request(org.owner, [kacchi], 'showcase', { offer: 30000 }))).toBe('22023');
    expect(code(await request(org.owner, [kacchi], 'offer', { offer: 29900 }))).toBe('ok');
    // A branch selling the dish for less: the offer must be below that price too.
    await admin(
      `insert into public.branch_item_prices (org_id, branch_id, menu_item_id, price_poisha) values ($1, $2, $3, 30000)`,
      [org.id, org.branchIds[0], kacchi],
    );
    expect(code(await request(org.owner, [kacchi], 'offer', { offer: 30000 }))).toBe('23514');
    await admin(`delete from public.branch_item_prices where menu_item_id = $1`, [kacchi]);
    const [offer] = await admin<{ offer_poisha: string; occasion_text: string | null }>(
      `select offer_poisha, occasion_text from public.social_posts
        where org_id = $1 and video_kind = 'offer'`,
      [org.id],
    );
    expect(Number(offer!.offer_poisha)).toBe(29900);
    const audits = await admin(
      `select 1 from public.audit_log where org_id = $1 and action = 'social.request_video'`,
      [org.id],
    );
    expect(audits.length).toBeGreaterThanOrEqual(6);
  });

  it("a high-quality photo: owner or manager, only in the org's own hq/ folder, audited", async () => {
    const set = (who: TestUser, path: string | null, orgId = org.id) =>
      asUser(
        who,
        (s) => s.attempt('select public.set_dish_hq_photo($1, $2, $3)', [orgId, kacchi, path]),
        commit,
      );
    expect(code(await set(manager, `${org.id}/hq/${randomUUID()}.webp`))).toBe('ok');
    expect(code(await set(org.owner, `${org.id}/${randomUUID()}.webp`))).toBe('22023');
    expect(code(await set(org.owner, `${other.id}/hq/${randomUUID()}.webp`))).toBe('22023');
    expect(code(await set(accountant, `${org.id}/hq/${randomUUID()}.jpg`))).toBe('42501');
    expect(code(await set(other.owner, `${other.id}/hq/${randomUUID()}.jpg`, other.id))).toBe(
      '22023',
    );
    expect(code(await set(org.owner, null))).toBe('ok');
    const [m] = await admin<{ hq_photo_path: string | null }>(
      `select hq_photo_path from public.menu_items where id = $1`,
      [kacchi],
    );
    expect(m!.hq_photo_path).toBeNull();
    // The database itself keeps the path in the org's hq/ folder.
    const direct = await admin(`update public.menu_items set hq_photo_path = $2 where id = $1`, [
      kacchi,
      `${other.id}/hq/x.webp`,
    ]).then(
      () => 'ok',
      () => 'refused',
    );
    expect(direct).toBe('refused');
    const audits = await admin(
      `select 1 from public.audit_log where org_id = $1 and action = 'social.hq_photo'`,
      [org.id],
    );
    expect(audits).toHaveLength(2);
  });

  it('the autopilot may plan one post per slot of a day', async () => {
    const insert = (slot: number) =>
      admin(
        `insert into public.social_posts (org_id, source, angle, format, plan_date, slot, scheduled_at)
         values ($1, 'autopilot', 'spotlight', 'video', '2026-12-01', $2, now())`,
        [org.id, slot],
      ).then(
        () => 'ok',
        (e: { code?: string }) => e.code ?? 'error',
      );
    expect(await insert(0)).toBe('ok');
    expect(await insert(1)).toBe('ok');
    expect(await insert(2)).toBe('ok');
    expect(await insert(1)).toBe('23505');
    expect(await insert(6)).toBe('23514');
  });
});

describe('growth.pairs: dishes bought together', () => {
  let org: TestOrg;
  let other: TestOrg;
  let manager: TestUser;
  let a: string;
  let b: string;
  let c: string;

  beforeAll(async () => {
    org = await createOrg({ branches: ['Main'] });
    other = await createOrg({ branches: ['Main'] });
    manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    a = await dish(org.id, 'Kacchi');
    b = await dish(org.id, 'Borhani');
    c = await dish(org.id, 'Firni');
    const [{ id: channel }] = (await admin<{ id: string }>(
      `insert into public.channels (org_id, name, kind) values ($1, 'Dine-in', 'dine_in') returning id`,
      [org.id],
    )) as [{ id: string }];
    const [{ id: staff }] = (await admin<{ id: string }>(
      `insert into public.staff (org_id, branch_id, display_name, role) values ($1, $2, 'Cashier', 'cashier') returning id`,
      [org.id, org.branchIds[0]],
    )) as [{ id: string }];
    const order = async (items: string[], status = 'completed', daysAgo = 1) => {
      const id = randomUUID();
      await admin(
        `insert into public.orders (id, org_id, branch_id, channel_id, staff_id, order_status, payment_status, placed_at,
           gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, price_includes_vat, vat_rate_bps)
         values ($1,$2,$3,$4,$5,$6,'paid', now() - make_interval(days => $7::int),100,100,100,100,false,0)`,
        [id, org.id, org.branchIds[0], channel, staff, status, daysAgo],
      );
      for (const item of items)
        await admin(
          `insert into public.order_items (org_id, branch_id, order_id, menu_item_id, name_snapshot, quantity,
             unit_price_poisha, gross_poisha, net_before_discount_poisha, net_poisha, total_poisha, status)
           values ($1,$2,$3,$4,'x',1,100,100,100,100,100,'active')`,
          [org.id, org.branchIds[0], id, item],
        );
    };
    await order([a, b]);
    await order([a, b, c]);
    await order([a, b, b]);
    await order([a, c]);
    await order([a, b], 'cancelled');
    await order([a, c], 'completed', 90);
  });

  const pairs = (who: TestUser, orgId = org.id) =>
    asUser(who, (s) =>
      s.q<{ item_a: string; item_b: string; orders: string }>(
        'select * from public.metric_item_pairs($1, now())',
        [orgId],
      ),
    );

  it('counts orders holding both dishes over the last 60 days, cancelled orders left out', async () => {
    const rows = await pairs(manager);
    const key = (x: string, y: string) => [x, y].sort().join('|');
    const got = new Map(rows.map((r) => [key(r.item_a, r.item_b), Number(r.orders)]));
    expect(got.get(key(a, b))).toBe(3);
    expect(got.get(key(a, c))).toBe(2);
    expect(got.get(key(b, c))).toBe(1);
    expect(rows.every((r) => r.item_a < r.item_b)).toBe(true);
  });

  it('can be asked for one dish only', async () => {
    const rows = await asUser(manager, (s) =>
      s.q<{ item_a: string; item_b: string }>(
        'select * from public.metric_item_pairs($1, now(), $2)',
        [org.id, b],
      ),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.item_a === b || r.item_b === b)).toBe(true);
  });

  it('another restaurant sees nothing of it', async () => {
    const rows = await asUser(other.owner, (s) =>
      s.attempt('select * from public.metric_item_pairs($1, now())', [org.id]),
    );
    if (rows.ok) expect(rows.rows).toHaveLength(0);
    else expect(rows.code).toBe('42501');
  });
});
