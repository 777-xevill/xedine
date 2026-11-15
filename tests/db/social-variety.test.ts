/**
 * Posters without limits, dishes by sales or the owner's marks (ADR 0058): an owner's post keeps the look
 * it was previewed in; the owner or a manager marks dishes post / never / auto (one list at a time, audited);
 * nobody else, and no other restaurant, can.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { addMember, admin, asUser, closePool, createOrg } from './harness';

afterAll(closePool);

async function dish(orgId: string, name: string): Promise<string> {
  const [row] = await admin<{ id: string }>(
    `insert into public.menu_items (org_id, name, photo_path) values ($1, $2, $3) returning id`,
    [orgId, name, `${orgId}/${name.toLowerCase()}.webp`],
  );
  return row!.id;
}

const marks = async (orgId: string) =>
  (
    await admin<{ post_item_ids: string[]; never_item_ids: string[] }>(
      `select post_item_ids, never_item_ids from public.social_settings where org_id = $1`,
      [orgId],
    )
  )[0]!;

describe('social variety', () => {
  it('keeps the look an owner post was previewed in, with any layout name', async () => {
    const org = await createOrg();
    const kacchi = await dish(org.id, 'Kacchi');
    const spec = JSON.stringify({ v: 1, layout: 'polaroid', seed: 7 });
    const res = await asUser(
      org.owner,
      (s) =>
        s.attempt(
          `select public.request_social_post($1, $2, 'image', '', now(), current_date, $3, null, '{}', $4::jsonb)`,
          [org.id, kacchi, 'polaroid', spec],
        ),
      { commit: true },
    );
    expect(res.ok).toBe(true);
    const [post] = await admin<{ template: string; design_spec: { layout: string } }>(
      `select template, design_spec from public.social_posts where org_id = $1`,
      [org.id],
    );
    expect(post!.template).toBe('polaroid');
    expect(post!.design_spec.layout).toBe('polaroid');
    const bad = await asUser(org.owner, (s) =>
      s.attempt(
        `select public.request_social_post($1, $2, 'image', '', now(), current_date, null, null, '{}', '"x"'::jsonb)`,
        [org.id, kacchi],
      ),
    );
    expect(bad.ok).toBe(false);
  });

  it('marks a dish post, never or auto — one list at a time — and audits it', async () => {
    const org = await createOrg();
    const manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    const kacchi = await dish(org.id, 'Kacchi');
    const mark = (who: typeof org.owner, m: string) =>
      asUser(who, (s) => s.attempt(`select public.mark_social_dish($1, $2, $3)`, [org.id, kacchi, m]), {
        commit: true,
      });
    expect((await mark(org.owner, 'post')).ok).toBe(true);
    expect(await marks(org.id)).toEqual({ post_item_ids: [kacchi], never_item_ids: [] });
    expect((await mark(manager, 'never')).ok).toBe(true);
    expect(await marks(org.id)).toEqual({ post_item_ids: [], never_item_ids: [kacchi] });
    expect((await mark(org.owner, 'auto')).ok).toBe(true);
    expect(await marks(org.id)).toEqual({ post_item_ids: [], never_item_ids: [] });
    const audits = await admin<{ before: { mark: string }; after: { mark: string } }>(
      `select before, after from public.audit_log where org_id = $1 and action = 'social.mark' order by created_at`,
      [org.id],
    );
    expect(audits.map((a) => `${a.before.mark}>${a.after.mark}`)).toEqual([
      'auto>post',
      'post>never',
      'never>auto',
    ]);
    const badMark = await asUser(org.owner, (s) =>
      s.attempt(`select public.mark_social_dish($1, $2, 'always')`, [org.id, kacchi]),
    );
    expect(badMark.ok).toBe(false);
  });

  it("refuses a cashier, another restaurant, and another restaurant's dish", async () => {
    const org = await createOrg();
    const other = await createOrg();
    const cashier = await addMember(org, 'cashier', [org.branchIds[0]!]);
    const mine = await dish(org.id, 'Kacchi');
    const theirs = await dish(other.id, 'Theirs');
    for (const [who, orgId, item] of [
      [cashier, org.id, mine],
      [other.owner, org.id, mine],
      [org.owner, org.id, theirs],
    ] as const) {
      const res = await asUser(who, (s) =>
        s.attempt(`select public.mark_social_dish($1, $2, 'post')`, [orgId, item]),
      );
      expect(res.ok).toBe(false);
    }
  });
});
