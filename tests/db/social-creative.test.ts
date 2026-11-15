/**
 * The creative poster engine (ADR 0057): an owner's post can name its design, carry the words they
 * approved and add up to three more dishes of their own menu; the dish art is the job's to write and the
 * owner's and managers' to read; the autopilot's designs are only ever known ones.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { addMember, admin, asUser, closePool, createOrg } from './harness';

afterAll(closePool);

async function dish(orgId: string, name: string, photo = true): Promise<string> {
  const [row] = await admin<{ id: string }>(
    `insert into public.menu_items (org_id, name, photo_path) values ($1, $2, $3) returning id`,
    [orgId, name, photo ? `${orgId}/${name.toLowerCase()}.webp` : null],
  );
  return row!.id;
}

const request = `select public.request_social_post($1, $2, 'image', '', now(), current_date, $3, $4::jsonb, $5::uuid[]) as id`;

describe('social creative posts', () => {
  it('keeps the design, the approved words and the extra dishes of an owner post, and audits them', async () => {
    const org = await createOrg();
    const [kacchi, borhani, firni] = [
      await dish(org.id, 'Kacchi'),
      await dish(org.id, 'Borhani'),
      await dish(org.id, 'Firni'),
    ];
    const words = JSON.stringify({ headline_bn: 'আসল স্বাদ', poster_lang: 'bn' });
    const res = await asUser(
      org.owner,
      // The main dish listed again among the extras is dropped, not stored twice.
      (s) => s.attempt(request, [org.id, kacchi, 'menu', words, [borhani, firni, kacchi]]),
      { commit: true },
    );
    expect(res.ok).toBe(true);
    const [post] = await admin<{
      template: string;
      design_words: Record<string, string>;
      extra_item_ids: string[];
    }>(`select template, design_words, extra_item_ids from public.social_posts where org_id = $1`, [
      org.id,
    ]);
    expect(post!.template).toBe('menu');
    expect(post!.design_words.headline_bn).toBe('আসল স্বাদ');
    expect([...post!.extra_item_ids].sort()).toEqual([borhani, firni].sort());
    const [audit] = await admin<{ after: { design: string; words: boolean } }>(
      `select after from public.audit_log where org_id = $1 and action = 'social.request'`,
      [org.id],
    );
    expect(audit!.after).toMatchObject({ design: 'menu', words: true });
  });

  it('still accepts the original six-argument call', async () => {
    const org = await createOrg();
    const kacchi = await dish(org.id, 'Kacchi');
    const res = await asUser(org.owner, (s) =>
      s.attempt(
        `select public.request_social_post($1, $2, 'video', 'Friday special', now(), current_date)`,
        [org.id, kacchi],
      ),
    );
    expect(res.ok).toBe(true);
  });

  it('refuses an unknown design, words that are not an object, and too many dishes', async () => {
    const org = await createOrg();
    const ids = [
      await dish(org.id, 'A'),
      await dish(org.id, 'B'),
      await dish(org.id, 'C'),
      await dish(org.id, 'D'),
      await dish(org.id, 'E'),
    ];
    const tryIt = (design: string | null, words: string | null, extra: string[]) =>
      asUser(org.owner, (s) => s.attempt(request, [org.id, ids[0], design, words, extra]));
    for (const res of [
      await tryIt('poster-of-doom', null, []),
      await tryIt('menu', '"just a string"', []),
      await tryIt('menu', null, ids.slice(1)),
    ]) {
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('22023');
    }
  });

  it("never puts another restaurant's dish, or a dish without a photo, on the poster", async () => {
    const org = await createOrg();
    const other = await createOrg();
    const mine = await dish(org.id, 'Kacchi');
    const theirs = await dish(other.id, 'Theirs');
    const noPhoto = await dish(org.id, 'Plain', false);
    for (const extra of [[theirs], [noPhoto]]) {
      const res = await asUser(org.owner, (s) =>
        s.attempt(request, [org.id, mine, 'menu', null, extra]),
      );
      expect(res.ok).toBe(false);
    }
  });

  it('lets the owner and managers read dish art but never write it; the files stay in the org folder', async () => {
    const org = await createOrg();
    const manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    const kacchi = await dish(org.id, 'Kacchi');
    await admin(
      `insert into public.social_dish_art (org_id, menu_item_id, source_path, cutout_path, cutout_usable)
       values ($1, $2, $3, $4, true)`,
      [org.id, kacchi, `${org.id}/kacchi.webp`, `${org.id}/art/x-cut.webp`],
    );
    for (const who of [org.owner, manager]) {
      const read = await asUser(who, (s) =>
        s.attempt(`select cutout_usable from public.social_dish_art where org_id = $1`, [org.id]),
      );
      expect(read.ok && read.rows).toEqual([{ cutout_usable: true }]);
      const write = await asUser(who, (s) =>
        s.attempt(`update public.social_dish_art set cutout_usable = false where org_id = $1`, [
          org.id,
        ]),
      );
      expect(write.ok && write.rowCount).not.toBe(1);
    }
    await expect(
      admin(
        `update public.social_dish_art set cutout_path = 'someone-else/art/x.webp' where org_id = $1`,
        [org.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('lets the autopilot rotate only through known designs, and never through none', async () => {
    const org = await createOrg();
    await admin(`insert into public.social_settings (org_id) values ($1)`, [org.id]);
    const [row] = await admin<{ designs: string[]; show_price: boolean }>(
      `select designs, show_price from public.social_settings where org_id = $1`,
      [org.id],
    );
    expect(row!.designs).toHaveLength(10);
    expect(row!.show_price).toBe(true);
    const set = (designs: string) =>
      asUser(org.owner, (s) =>
        s.attempt(`update public.social_settings set designs = $2::text[] where org_id = $1`, [
          org.id,
          designs,
        ]),
      );
    const ok = await set('{status,menu}');
    expect(ok.ok && ok.rowCount).toBe(1);
    expect((await set('{status,graffiti}')).ok).toBe(false);
    expect((await set('{}')).ok).toBe(false);
  });
});
