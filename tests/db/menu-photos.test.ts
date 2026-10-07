/**
 * Dish photos on the till (ADR 0031). A dish can only point at a file in its own org's folder; only the
 * org's owner may put files there; another org's owner may not touch them.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { addMember, admin, asUser, closePool, createOrg } from './harness';

afterAll(closePool);

async function newItem(orgId: string): Promise<string> {
  const [row] = await admin<{ id: string }>(
    `insert into public.menu_items (org_id, name, base_price_poisha) values ($1, 'Biryani', 25000) returning id`,
    [orgId],
  );
  return row!.id;
}

describe('menu photos', () => {
  it('lets a dish point at a file in its own org folder', async () => {
    const org = await createOrg();
    const id = await newItem(org.id);
    const res = await asUser(org.owner, (s) =>
      s.attempt(`update public.menu_items set photo_path = $1 where id = $2`, [
        `${org.id}/abc12345.webp`,
        id,
      ]),
    );
    expect(res.ok).toBe(true);
  });

  it("refuses a dish pointing into another org's folder", async () => {
    const org = await createOrg();
    const other = await createOrg();
    const id = await newItem(org.id);
    const res = await asUser(org.owner, (s) =>
      s.attempt(`update public.menu_items set photo_path = $1 where id = $2`, [
        `${other.id}/abc12345.webp`,
        id,
      ]),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('23514');
  });

  it('lets only the owner upload into the org folder', async () => {
    const org = await createOrg();
    const manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    const insert = `insert into storage.objects (bucket_id, name) values ('menu-photos', $1)`;
    const asOwner = await asUser(org.owner, (s) => s.attempt(insert, [`${org.id}/own.webp`]));
    expect(asOwner.ok).toBe(true);
    const asManager = await asUser(manager, (s) => s.attempt(insert, [`${org.id}/mgr.webp`]));
    expect(asManager.ok).toBe(false);
  });

  it("refuses an owner uploading into another org's folder", async () => {
    const org = await createOrg();
    const other = await createOrg();
    const res = await asUser(org.owner, (s) =>
      s.attempt(`insert into storage.objects (bucket_id, name) values ('menu-photos', $1)`, [
        `${other.id}/sneaky.webp`,
      ]),
    );
    expect(res.ok).toBe(false);
  });
});
