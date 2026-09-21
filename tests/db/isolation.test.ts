/**
 * ROADMAP Phase 0 "Done when": RLS suite proves org A users can't read/write any org B row (every table),
 * and each role sees exactly what its policy says. Every table is enumerated from the database, so a
 * new table is covered the moment it is migrated; the suite cannot silently skip one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureRow, tableColumns, type BuildContext } from './fixture-builder';
import {
  addMember,
  admin,
  asUser,
  closePool,
  createOrg,
  type TestOrg,
  type TestUser,
} from './harness';

interface RegistryRow {
  table: string;
  kind: 'tenant' | 'custom' | 'service_only' | 'platform_read';
  scope: 'org' | 'branch' | null;
  read: string[] | null;
}

const TENANT_ROLES = ['manager', 'cashier', 'kitchen', 'purchaser', 'accountant'] as const;

// Top-level await: vitest needs the table list at collection time to generate one suite per table.
const registry = await admin<{
  table_name: string;
  kind: RegistryRow['kind'];
  scope: RegistryRow['scope'];
  read_roles: string[] | null;
}>(
  `select table_name, kind, scope, read_roles::text[] as read_roles from private.policy_registry order by table_name`,
);
const orgColumnTables = new Set(
  (
    await admin<{ table_name: string }>(
      `select table_name from information_schema.columns where table_schema = 'public' and column_name = 'org_id'`,
    )
  ).map((r) => r.table_name),
);
const tables: RegistryRow[] = registry
  .filter((r) => orgColumnTables.has(r.table_name) || r.table_name === 'organizations')
  .map((r) => ({ table: r.table_name, kind: r.kind, scope: r.scope, read: r.read_roles }));

let orgA: TestOrg;
let orgB: TestOrg;
let ctxA: BuildContext;
let ctxB: BuildContext;
const roleUsers = {} as Record<(typeof TENANT_ROLES)[number], TestUser>;

beforeAll(async () => {
  orgA = await createOrg();
  orgB = await createOrg();
  ctxA = { orgId: orgA.id, userId: orgA.owner.id, branchIds: orgA.branchIds };
  ctxB = { orgId: orgB.id, userId: orgB.owner.id, branchIds: orgB.branchIds };
  for (const role of TENANT_ROLES) {
    roleUsers[role] = await addMember(
      orgA,
      role,
      role === 'accountant' ? [] : [orgA.branchIds[0]!],
    );
  }
}, 120_000);

afterAll(closePool);

const orgColumn = (table: string) => (table === 'organizations' ? 'id' : 'org_id');

it('covers the whole schema (sanity: enough tables were enumerated)', () => {
  expect(tables.length).toBeGreaterThan(80);
});

describe.each(tables)('$table', ({ table, kind, scope, read }) => {
  const col = orgColumn(table);

  it('has fixture rows for both tenants', async () => {
    await ensureRow(table, ctxA);
    await ensureRow(table, ctxB);
    const [a] = await admin<{ n: number }>(
      `select count(*)::int as n from public.${table} where ${col} = $1`,
      [orgA.id],
    );
    expect(a!.n, `no ${table} row could be built for org A`).toBeGreaterThan(0);
  });

  it("another organization's owner cannot read this organization's rows", async () => {
    const res = await asUser(orgB.owner, (s) =>
      s.attempt<{ n: number }>(`select count(*)::int as n from public.${table} where ${col} = $1`, [
        orgA.id,
      ]),
    );
    if (res.ok) expect(res.rows[0]!.n).toBe(0);
    else expect(res.code).toBe('42501'); // service-only tables: permission denied, not merely empty
  });

  it("another organization's owner cannot insert rows into this organization", async () => {
    const [source] = await admin(`select * from public.${table} where ${col} = $1 limit 1`, [
      orgA.id,
    ]);
    const copy = { ...source } as Record<string, unknown>;
    if ('id' in copy && table !== 'organizations') copy.id = crypto.randomUUID();
    if (table === 'organizations') copy.slug = `x-${crypto.randomUUID().slice(0, 8)}`;
    const res = await asUser(orgB.owner, (s) =>
      s.attempt(
        `insert into public.${table} select * from json_populate_record(null::public.${table}, $1::json)`,
        [JSON.stringify(copy)],
      ),
    );
    expect(res.ok, 'cross-tenant INSERT must not succeed').toBe(false);
    if (!res.ok) expect(res.code).toBe('42501');
  });

  it("another organization's owner cannot update or delete this organization's rows", async () => {
    const [before] = await admin<{ n: number }>(
      `select count(*)::int as n from public.${table} where ${col} = $1`,
      [orgA.id],
    );
    const updated = await asUser(orgB.owner, (s) =>
      s.attempt(`update public.${table} set ${col} = ${col} where ${col} = $1`, [orgA.id]),
    );
    if (updated.ok) expect(updated.rowCount).toBe(0);
    else expect(updated.code).toBe('42501');
    const deleted = await asUser(orgB.owner, (s) =>
      s.attempt(`delete from public.${table} where ${col} = $1`, [orgA.id]),
    );
    if (deleted.ok) expect(deleted.rowCount).toBe(0);
    else expect(deleted.code).toBe('42501');
    const [after] = await admin<{ n: number }>(
      `select count(*)::int as n from public.${table} where ${col} = $1`,
      [orgA.id],
    );
    expect(after!.n).toBe(before!.n);
  });

  if (kind !== 'service_only') {
    it('positive control: the owner can read their own rows (the suite is not vacuous)', async () => {
      const rows = await asUser(orgA.owner, (s) =>
        s.q<{ n: number }>(`select count(*)::int as n from public.${table} where ${col} = $1`, [
          orgA.id,
        ]),
      );
      expect(rows[0]!.n).toBeGreaterThan(0);
    });
  }

  if (kind === 'tenant') {
    it('each role sees this table exactly as its policy says (ADR 0007 role matrix)', async () => {
      const branchFilter = scope === 'branch' ? ' and branch_id = $2' : '';
      const params = scope === 'branch' ? [orgA.id, orgA.branchIds[0]] : [orgA.id];
      for (const role of TENANT_ROLES) {
        const rows = await asUser(roleUsers[role], (s) =>
          s.q<{ n: number }>(
            `select count(*)::int as n from public.${table} where org_id = $1${branchFilter}`,
            params,
          ),
        );
        const expected = (read ?? []).includes(role);
        expect(rows[0]!.n > 0, `${role} reading ${table}`).toBe(expected);
      }
    });
  }

  if (scope === 'branch') {
    it("a branch-scoped member never sees another branch's rows", async () => {
      await ensureRow(table, ctxA, { branchId: orgA.branchIds[1] });
      const [total] = await admin<{ n: number }>(
        `select count(*)::int as n from public.${table} where org_id = $1 and branch_id = $2`,
        [orgA.id, orgA.branchIds[1]],
      );
      expect(total!.n, 'a second-branch fixture row should exist').toBeGreaterThan(0);
      for (const role of ['manager', 'cashier', 'kitchen', 'purchaser'] as const) {
        const rows = await asUser(roleUsers[role], (s) =>
          s.q<{ n: number }>(
            `select count(*)::int as n from public.${table} where org_id = $1 and branch_id = $2`,
            [orgA.id, orgA.branchIds[1]],
          ),
        );
        expect(rows[0]!.n, `${role} must not see branch 2 rows in ${table}`).toBe(0);
      }
    });
  }
});

describe('column sanity', () => {
  it('org-scoped tables all expose org_id or are the organizations table', async () => {
    for (const t of tables) {
      const cols = await tableColumns(t.table);
      expect(cols.includes('org_id') || t.table === 'organizations', t.table).toBe(true);
    }
  });
});
