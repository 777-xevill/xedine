/**
 * ADR 0024: Settings → Features. The switches live on org_settings, so they inherit its RLS (every
 * member reads, only the owner writes) and its audit trigger. Presentation only — no access change.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { addMember, admin, asUser, closePool, createOrg } from './harness';

afterAll(closePool);

describe('enabled features (org_settings.enabled_features)', () => {
  it('starts empty, so a new restaurant sees only the core sections', async () => {
    const org = await createOrg();
    const [row] = await admin<{ enabled_features: string[] }>(
      'select enabled_features from public.org_settings where org_id = $1',
      [org.id],
    );
    expect(row!.enabled_features).toEqual([]);
  });

  it('the owner switches features on, and the change is audited', async () => {
    const org = await createOrg();
    await asUser(
      org.owner,
      (s) =>
        s.q(
          `update public.org_settings set enabled_features = '{recipes,reviews}' where org_id = $1`,
          [org.id],
        ),
      { commit: true },
    );
    const [row] = await admin<{ after: { enabled_features: string[] } }>(
      `select after from public.audit_log where org_id = $1 and action = 'org_settings.update'`,
      [org.id],
    );
    expect(row!.after.enabled_features).toEqual(['recipes', 'reviews']);
  });

  it('a manager can read the switches but cannot change them', async () => {
    const org = await createOrg();
    const manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    const seen = await asUser(manager, (s) =>
      s.q<{ enabled_features: string[] }>(
        'select enabled_features from public.org_settings where org_id = $1',
        [org.id],
      ),
    );
    expect(seen).toHaveLength(1);
    const changed = await asUser(manager, (s) =>
      s.q(
        `update public.org_settings set enabled_features = '{customers}' where org_id = $1 returning 1`,
        [org.id],
      ),
    );
    expect(changed).toHaveLength(0);
  });
});
