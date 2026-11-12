/**
 * The outlook (ADR 0051) at the database: only the owner sets where a branch is (audited, both numbers or
 * neither), everyone at a branch reads its weather but nobody signed in writes it, and the jobs' once-only
 * marks are unreachable. Isolation of the new tables across orgs is covered by isolation.test.ts.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { addMember, admin, asUser, closePool, createOrg } from './harness';

afterAll(closePool);

describe('Branch location', () => {
  it('the owner sets it, it is rounded and audited, and can be cleared again', async () => {
    const org = await createOrg({ branches: ['Mirpur'] });
    const branchId = org.branchIds[0]!;
    await asUser(
      org.owner,
      (s) =>
        s.q('select public.set_branch_location($1, $2, $3, $4)', [
          org.id,
          branchId,
          23.822345,
          90.365412,
        ]),
      { commit: true },
    );
    const [b] = await admin<{ latitude: string; longitude: string }>(
      'select latitude, longitude from public.branches where id = $1',
      [branchId],
    );
    expect([Number(b!.latitude), Number(b!.longitude)]).toEqual([23.8223, 90.3654]);
    const [audit] = await admin<{ n: string }>(
      `select count(*) as n from public.audit_log where org_id = $1 and action = 'branch.location'`,
      [org.id],
    );
    expect(Number(audit!.n)).toBe(1);

    await asUser(
      org.owner,
      (s) => s.q('select public.set_branch_location($1, $2, null, null)', [org.id, branchId]),
      { commit: true },
    );
    const [cleared] = await admin<{ latitude: string | null }>(
      'select latitude from public.branches where id = $1',
      [branchId],
    );
    expect(cleared!.latitude).toBeNull();
  });

  it('refuses half a location, a manager, and another org’s branch', async () => {
    const org = await createOrg({ branches: ['Uttara'] });
    const other = await createOrg({ branches: ['Elsewhere'] });
    const branchId = org.branchIds[0]!;
    const manager = await addMember(org, 'manager', [branchId]);

    const half = await asUser(org.owner, (s) =>
      s.attempt('select public.set_branch_location($1, $2, 23.8, null)', [org.id, branchId]),
    );
    expect(half.ok ? 'ok' : half.code).toBe('22023');

    const byManager = await asUser(manager, (s) =>
      s.attempt('select public.set_branch_location($1, $2, 23.8, 90.3)', [org.id, branchId]),
    );
    expect(byManager.ok ? 'ok' : byManager.code).toBe('42501');

    const crossOrg = await asUser(org.owner, (s) =>
      s.attempt('select public.set_branch_location($1, $2, 23.8, 90.3)', [
        org.id,
        other.branchIds[0]!,
      ]),
    );
    expect(crossOrg.ok ? 'ok' : crossOrg.code).toBe('22023');
  });
});

describe('Weather readings', () => {
  it('everyone at the branch reads them; nobody signed in can write them', async () => {
    const org = await createOrg({ branches: ['Dhanmondi'] });
    const branchId = org.branchIds[0]!;
    const manager = await addMember(org, 'manager', [branchId]);
    await admin(
      `insert into public.weather_hours (org_id, branch_id, at, period_hours, temp_c, rain_mm, symbol)
       values ($1, $2, '2026-11-14T06:00:00Z', 1, 29.5, 3.2, 'rain')`,
      [org.id, branchId],
    );
    const seen = await asUser(manager, (s) =>
      s.q<{ rain_mm: string }>('select rain_mm from public.weather_hours where org_id = $1', [
        org.id,
      ]),
    );
    expect(seen.map((r) => Number(r.rain_mm))).toEqual([3.2]);

    const write = await asUser(org.owner, (s) =>
      s.attempt(
        `insert into public.weather_hours (org_id, branch_id, at, period_hours, rain_mm)
         values ($1, $2, '2026-11-14T07:00:00Z', 1, 0) returning at`,
        [org.id, branchId],
      ),
    );
    expect(write.ok).toBe(false);

    const marks = await asUser(org.owner, (s) =>
      s.attempt('select key from public.org_job_marks where org_id = $1', [org.id]),
    );
    expect(marks.ok ? 'ok' : marks.code).toBe('42501');
  });
});
