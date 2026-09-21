/**
 * Generic fixture-row builder. Every table is introspected, so a new table is covered by the
 * isolation suite automatically ("every new table ships with an isolation test"). If a table needs
 * a value the builder cannot guess (a CHECK across columns, a second parent), add an override below
 * — the suite fails loudly rather than skipping the table.
 */
import { randomUUID } from 'node:crypto';
import { admin, type Row } from './harness';

interface Column {
  name: string;
  udt: string;
  isEnum: boolean;
  nullable: boolean;
  hasDefault: boolean;
}

interface ForeignKey {
  cols: string[];
  refTable: string;
  refSchema: string;
  refCols: string[];
}

interface TableMeta {
  columns: Column[];
  fks: ForeignKey[];
  pk: string[];
}

export interface BuildContext {
  orgId: string;
  /** The auth user that owns per-user rows (AI conversations) and satisfies FKs to auth.users. */
  userId: string;
  branchIds: string[];
}

let metaPromise:
  Promise<{ tables: Map<string, TableMeta>; enums: Map<string, string[]> }> | undefined;

async function loadMeta() {
  metaPromise ??= (async () => {
    const tables = new Map<string, TableMeta>();
    const get = (t: string) => {
      let m = tables.get(t);
      if (!m) tables.set(t, (m = { columns: [], fks: [], pk: [] }));
      return m;
    };

    const enumRows = await admin<{ typname: string; labels: string[] }>(
      `select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels
       from pg_type t join pg_enum e on e.enumtypid = t.oid group by t.typname`,
    );
    const enums = new Map(enumRows.map((r) => [r.typname, r.labels]));

    const cols = await admin<{
      table_name: string;
      column_name: string;
      is_nullable: string;
      column_default: string | null;
      udt_name: string;
      data_type: string;
      is_generated: string;
    }>(
      `select c.table_name, c.column_name, c.is_nullable, c.column_default, c.udt_name, c.data_type, c.is_generated
       from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
       where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
       order by c.table_name, c.ordinal_position`,
    );
    for (const c of cols) {
      get(c.table_name).columns.push({
        name: c.column_name,
        udt: c.udt_name,
        isEnum: c.data_type === 'USER-DEFINED' && enums.has(c.udt_name),
        nullable: c.is_nullable === 'YES',
        hasDefault: c.column_default !== null || c.is_generated === 'ALWAYS',
      });
    }

    const fks = await admin<{
      tbl: string;
      cols: string[];
      ref_tbl: string;
      ref_schema: string;
      ref_cols: string[];
    }>(
      `select cl.relname as tbl,
              array(select a.attname from unnest(con.conkey) with ordinality k(n, o)
                    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.o) as cols,
              fcl.relname as ref_tbl, fns.nspname as ref_schema,
              array(select a.attname from unnest(con.confkey) with ordinality k(n, o)
                    join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.o) as ref_cols
       from pg_constraint con
       join pg_class cl on cl.oid = con.conrelid
       join pg_namespace ns on ns.oid = cl.relnamespace
       join pg_class fcl on fcl.oid = con.confrelid
       join pg_namespace fns on fns.oid = fcl.relnamespace
       where con.contype = 'f' and ns.nspname = 'public'`,
    );
    for (const f of fks) {
      get(f.tbl).fks.push({
        cols: f.cols,
        refTable: f.ref_tbl,
        refSchema: f.ref_schema,
        refCols: f.ref_cols,
      });
    }

    const pks = await admin<{ tbl: string; cols: string[] }>(
      `select cl.relname as tbl,
              array(select a.attname from unnest(con.conkey) with ordinality k(n, o)
                    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.o) as cols
       from pg_constraint con
       join pg_class cl on cl.oid = con.conrelid
       join pg_namespace ns on ns.oid = cl.relnamespace
       where con.contype = 'p' and ns.nspname = 'public'`,
    );
    for (const p of pks) get(p.tbl).pk = p.cols;

    return { tables, enums };
  })();
  return metaPromise;
}

export async function tableColumns(table: string): Promise<string[]> {
  const { tables } = await loadMeta();
  return (tables.get(table)?.columns ?? []).map((c) => c.name);
}

/** Per-table values the generic builder cannot infer. Return null to force a column to null. */
type Override = (ctx: BuildContext) => Record<string, unknown>;
const OVERRIDES: Record<string, Override> = {
  // exactly one of ingredient_id / sub_recipe_id
  recipe_lines: () => ({ sub_recipe_id: null }),
  // from_branch_id <> to_branch_id
  transfers: (ctx) => ({ from_branch_id: ctx.branchIds[0], to_branch_id: ctx.branchIds[1] }),
};

let counter = 0;
const next = () => ++counter;

function dummy(col: Column, enums: Map<string, string[]>): unknown {
  if (col.isEnum) return enums.get(col.udt)![0];
  switch (col.udt) {
    case 'uuid':
      return randomUUID();
    case 'text':
    case 'varchar':
    case 'bpchar':
    case 'citext':
      return `fixture-${next()}`;
    case 'int2':
    case 'int4':
    case 'int8':
    case 'numeric':
    case 'float4':
    case 'float8':
      return 1;
    case 'bool':
      return false;
    case 'timestamptz':
    case 'timestamp':
      return new Date().toISOString();
    case 'date':
      return new Date().toISOString().slice(0, 10);
    case 'time':
      return '04:00';
    case 'jsonb':
    case 'json':
      return '{}';
    case 'interval':
      return '1 hour';
    case 'bytea':
      return '\\x00';
    case 'inet':
      return '127.0.0.1';
    default:
      if (col.udt.startsWith('_')) return '{}';
      throw new Error(
        `fixture-builder: no dummy value for ${col.name} (${col.udt}); add an override`,
      );
  }
}

// Memo of rows already built, keyed by org + table + branch, so parents are shared.
const memo = new Map<string, Row>();

/**
 * Ensure exactly one fixture row exists for (org, table[, branch]) and return it. Rows created by
 * create_organization() (org_settings, branches, memberships, …) are reused, not duplicated.
 */
export async function ensureRow(
  table: string,
  ctx: BuildContext,
  opts: { branchId?: string } = {},
  depth = 0,
): Promise<Row> {
  if (depth > 12) throw new Error(`fixture-builder: FK cycle while building ${table}`);
  const { tables, enums } = await loadMeta();
  const meta = tables.get(table);
  if (!meta) throw new Error(`fixture-builder: unknown table ${table}`);

  const hasOrg = meta.columns.some((c) => c.name === 'org_id');
  const hasBranch = meta.columns.some((c) => c.name === 'branch_id');
  const key = `${ctx.orgId}|${table}|${hasBranch ? (opts.branchId ?? ctx.branchIds[0]) : ''}`;
  const cached = memo.get(key);
  if (cached) return cached;

  // Reuse an existing row for this tenant if there is one.
  if (table === 'organizations') {
    const [row] = await admin('select * from public.organizations where id = $1', [ctx.orgId]);
    if (row) return remember(key, row);
  } else if (hasOrg) {
    const branchFilter = hasBranch ? ' and branch_id = $2' : '';
    const params: unknown[] = hasBranch
      ? [ctx.orgId, opts.branchId ?? ctx.branchIds[0]]
      : [ctx.orgId];
    const [row] = await admin(
      `select * from public.${table} where org_id = $1${branchFilter} limit 1`,
      params,
    );
    if (row) return remember(key, row);
  } else {
    // Platform / reference table (plans, feature_flags): any existing row will do.
    const [row] = await admin(`select * from public.${table} limit 1`);
    if (row) return remember(key, row);
  }

  const override = OVERRIDES[table]?.(ctx) ?? {};
  const values: Record<string, unknown> = {};

  // FK columns first: point each at a parent row in the same tenant.
  for (const fk of meta.fks) {
    if (fk.cols.every((c) => c in override && override[c] === null)) continue;
    let parent: Row;
    if (fk.refSchema !== 'public') {
      // auth.users → the fixture user.
      parent = { id: ctx.userId };
    } else if (fk.refTable === 'organizations') {
      parent = { id: ctx.orgId };
    } else if (fk.refTable === 'branches') {
      // Deterministic: the requested branch, else the org's first branch.
      parent = { id: opts.branchId ?? ctx.branchIds[0] };
    } else {
      // Carry the branch down so a second-branch row gets its own parents (staff, stock count, …) rather
      // than colliding on a unique constraint with the first branch's row.
      parent = await ensureRow(
        fk.refTable,
        ctx,
        opts.branchId ? { branchId: opts.branchId } : {},
        depth + 1,
      );
    }
    fk.cols.forEach((c, i) => {
      values[c] = c === 'org_id' ? ctx.orgId : parent[fk.refCols[i]!];
    });
  }

  for (const col of meta.columns) {
    if (col.name in override) {
      values[col.name] = override[col.name];
      continue;
    }
    if (col.name in values) continue;
    if (col.name === 'org_id') {
      values.org_id = ctx.orgId;
      continue;
    }
    if (col.name === 'branch_id' && hasBranch) {
      values.branch_id = opts.branchId ?? ctx.branchIds[0];
      continue;
    }
    if (col.nullable || col.hasDefault) continue;
    values[col.name] = dummy(col, enums);
  }

  const names = Object.keys(values);
  const inserted = await admin(
    `insert into public.${table} (${names.map((n) => `"${n}"`).join(', ')})
     values (${names.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    names.map((n) => values[n]),
  );
  return remember(key, inserted[0]!);
}

function remember(key: string, row: Row): Row {
  memo.set(key, row);
  return row;
}
