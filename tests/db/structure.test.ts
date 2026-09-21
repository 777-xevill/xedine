import { afterAll, describe, expect, it } from 'vitest';
import { admin, closePool, createOrg } from './harness';

afterAll(closePool);

const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();

describe('schema structure (CLAUDE.md non-negotiable #2)', () => {
  it('every public table has RLS enabled and is registered with the policy engine', async () => {
    const unprotected = await admin<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`,
    );
    expect(names(unprotected), 'tables with RLS disabled').toEqual([]);

    const unregistered = await admin<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p')
         and not exists (select 1 from private.policy_registry r where r.table_name = c.relname)`,
    );
    expect(names(unregistered), 'tables missing from private.policy_registry').toEqual([]);
  });

  it('the policy registry has no stale entries', async () => {
    const stale = await admin<{ name: string }>(
      `select r.table_name as name from private.policy_registry r
       where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                         where n.nspname = 'public' and c.relname = r.table_name)`,
    );
    expect(names(stale)).toEqual([]);
  });

  it('every RLS-enabled tenant table has at least one policy, or is service-only', async () => {
    const noPolicy = await admin<{ name: string }>(
      `select r.table_name as name from private.policy_registry r
       where r.kind in ('tenant', 'custom', 'platform_read')
         and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = r.table_name)`,
    );
    expect(names(noPolicy)).toEqual([]);
  });

  it('policies only ever target the authenticated role', async () => {
    const bad = await admin<{ name: string; roles: string }>(
      `select p.policyname as name, p.roles::text as roles from pg_policies p
       where p.schemaname = 'public' and p.roles <> array['authenticated']::name[]`,
    );
    expect(bad).toEqual([]);
  });

  it('anon has no privileges on any public table', async () => {
    const leaks = await admin<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p')
         and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
              or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))`,
    );
    expect(names(leaks)).toEqual([]);
  });

  it('service-only tables are unreachable by signed-in users, not merely empty', async () => {
    const reachable = await admin<{ name: string }>(
      `select r.table_name as name from private.policy_registry r
       where r.kind = 'service_only' and has_table_privilege('authenticated', format('public.%I', r.table_name), 'select')`,
    );
    expect(names(reachable)).toEqual([]);
  });

  it('no public function is executable by anon or PUBLIC', async () => {
    const exposed = await admin<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(names(exposed)).toEqual([]);
  });

  it('job plumbing is not callable by signed-in users', async () => {
    const exposed = await admin<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('job_run_begin', 'job_run_finish', 'job_health')
         and has_function_privilege('authenticated', p.oid, 'execute')`,
    );
    expect(names(exposed)).toEqual([]);
  });

  it('every SECURITY DEFINER function pins search_path', async () => {
    const unpinned = await admin<{ name: string }>(
      `select n.nspname || '.' || p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'private') and p.prosecdef
         and not coalesce(exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'), false)`,
    );
    expect(names(unpinned)).toEqual([]);
  });

  it('foreign keys between tenant tables carry org_id on both sides (no cross-tenant references)', async () => {
    const bad = await admin<{ name: string }>(
      `select con.conname as name
       from pg_constraint con
       join pg_class cl on cl.oid = con.conrelid join pg_namespace ns on ns.oid = cl.relnamespace
       join pg_class fcl on fcl.oid = con.confrelid join pg_namespace fns on fns.oid = fcl.relnamespace
       where con.contype = 'f' and ns.nspname = 'public' and fns.nspname = 'public'
         and exists (select 1 from pg_attribute a where a.attrelid = cl.oid and a.attname = 'org_id' and not a.attisdropped)
         and exists (select 1 from pg_attribute a where a.attrelid = fcl.oid and a.attname = 'org_id' and not a.attisdropped)
         and not (
           (select array_agg(a.attname) from pg_attribute a where a.attrelid = con.conrelid and a.attnum = any (con.conkey)) @> array['org_id']::name[]
           and (select array_agg(a.attname) from pg_attribute a where a.attrelid = con.confrelid and a.attnum = any (con.confkey)) @> array['org_id']::name[]
         )`,
    );
    expect(names(bad)).toEqual([]);
  });

  it('every tenant table has an index leading with org_id, and branch tables index branch_id', async () => {
    const noOrgIndex = await admin<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
       where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('job_runs', 'webhook_events')
         and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indkey[0] = a.attnum)`,
    );
    expect(names(noOrgIndex), 'tables with no org_id-leading index').toEqual([]);

    const noBranchIndex = await admin<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute b on b.attrelid = c.oid and b.attname = 'branch_id' and not b.attisdropped
       join pg_attribute o on o.attrelid = c.oid and o.attname = 'org_id' and not o.attisdropped
       where n.nspname = 'public' and c.relkind = 'r'
         and not exists (select 1 from pg_index i where i.indrelid = c.oid
                         and (i.indkey[0] = b.attnum or (i.indkey[0] = o.attnum and i.indkey[1] = b.attnum)))`,
    );
    expect(names(noBranchIndex), 'branch tables with no branch index').toEqual([]);
  });

  it('every money column is bigint poisha, never float or numeric (CLAUDE.md #3)', async () => {
    const bad = await admin<{ name: string; type: string }>(
      `select table_name || '.' || column_name as name, data_type as type
       from information_schema.columns
       where table_schema = 'public' and column_name like '%\\_poisha' and data_type <> 'bigint'`,
    );
    expect(bad).toEqual([]);
  });

  it('append-only tables reject UPDATE, DELETE and TRUNCATE even from a superuser', async () => {
    const org = await createOrg(); // writes audit_log rows
    await expect(
      admin(`update public.audit_log set action = 'tampered' where org_id = $1`, [org.id]),
    ).rejects.toMatchObject({
      code: '23001',
    });
    await expect(
      admin(`delete from public.audit_log where org_id = $1`, [org.id]),
    ).rejects.toMatchObject({ code: '23001' });
    await expect(admin('truncate public.audit_log')).rejects.toMatchObject({ code: '23001' });
    const [row] = await admin<{ n: number }>(
      'select count(*)::int as n from public.audit_log where org_id = $1',
      [org.id],
    );
    expect(row!.n).toBeGreaterThan(0);
  });
});
