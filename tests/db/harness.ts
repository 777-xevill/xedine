/**
 * Database test harness. Talks to a real Supabase Postgres (DATABASE_URL — local `pnpm db:start`, or CI).
 * Row-level security is exercised as a real signed-in user: `set local role authenticated` plus the
 * JWT claims Supabase's auth.uid()/auth.jwt() read.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX ?? 4),
  });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export type Row = Record<string, unknown>;

/** Superuser query: bypasses RLS. Fixtures and assertions about ground truth only. */
export async function admin<T extends Row = Row>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query(sql, params);
  return res.rows as T[];
}

export type TryResult<T> =
  { ok: true; rows: T[]; rowCount: number } | { ok: false; code: string; message: string };

export interface Session {
  /** Run a query; throws on error. */
  q<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run a query inside a savepoint and report the error instead of throwing (keeps the txn usable). */
  attempt<T extends Row = Row>(sql: string, params?: unknown[]): Promise<TryResult<T>>;
}

type DbRole = 'authenticated' | 'anon' | 'service_role';

async function inRole<T>(
  role: DbRole,
  claims: Record<string, unknown>,
  fn: (s: Session) => Promise<T>,
  commit: boolean,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    await client.query(
      "select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)",
      [JSON.stringify(claims), String(claims.sub ?? '')],
    );
    const session: Session = {
      async q(sql, params = []) {
        return (await client.query(sql, params)).rows;
      },
      async attempt(sql, params = []) {
        await client.query('savepoint attempt');
        try {
          const res = await client.query(sql, params);
          await client.query('release savepoint attempt');
          return { ok: true, rows: res.rows, rowCount: res.rowCount ?? 0 };
        } catch (e) {
          await client.query('rollback to savepoint attempt');
          const err = e as { code?: string; message?: string };
          return { ok: false, code: err.code ?? 'unknown', message: err.message ?? String(e) };
        }
      },
    };
    const result = await fn(session);
    await client.query(commit ? 'commit' : 'rollback');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export interface TestUser {
  id: string;
  email: string;
}

/** A signed-in user. Rolled back by default; pass commit:true for RPCs whose effects later steps rely on. */
export function asUser<T>(
  user: TestUser,
  fn: (s: Session) => Promise<T>,
  opts: { commit?: boolean } = {},
): Promise<T> {
  return inRole(
    'authenticated',
    { sub: user.id, role: 'authenticated', email: user.email },
    fn,
    opts.commit ?? false,
  );
}

export function asAnon<T>(fn: (s: Session) => Promise<T>): Promise<T> {
  return inRole('anon', { role: 'anon' }, fn, false);
}

export function asService<T>(
  fn: (s: Session) => Promise<T>,
  opts: { commit?: boolean } = {},
): Promise<T> {
  return inRole('service_role', { role: 'service_role' }, fn, opts.commit ?? false);
}

const short = () => randomUUID().slice(0, 8);

export async function createUser(prefix = 'user'): Promise<TestUser> {
  const id = randomUUID();
  const email = `${prefix}-${short()}@test.xedine.example`;
  await admin(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                             raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
             extensions.crypt('test-password-1', extensions.gen_salt('bf', 4)), now(),
             '{"provider":"email","providers":["email"]}', $3::jsonb, now(), now())`,
    [id, email, JSON.stringify({ full_name: prefix })],
  );
  return { id, email };
}

export interface TestOrg {
  id: string;
  slug: string;
  owner: TestUser;
  branchIds: string[];
}

export async function createOrg(
  opts: { branches?: string[]; name?: string; owner?: TestUser } = {},
): Promise<TestOrg> {
  const owner = opts.owner ?? (await createUser('owner'));
  const slug = `t-${short()}`;
  const branches = (opts.branches ?? ['Main', 'Second']).map((name) => ({ name }));
  const orgId = await asUser(
    owner,
    async (s) => {
      const [row] = await s.q<{ id: string }>(
        'select public.create_organization($1, $2, $3::jsonb) as id',
        [opts.name ?? `Org ${slug}`, slug, JSON.stringify(branches)],
      );
      return row!.id;
    },
    { commit: true },
  );
  // Return branch ids in the requested order.
  const byName = new Map(
    (
      await admin<{ id: string; name: string }>(
        'select id, name from public.branches where org_id = $1',
        [orgId],
      )
    ).map((b) => [b.name, b.id]),
  );
  const ordered = (opts.branches ?? ['Main', 'Second']).map((n) => byName.get(n)!);
  return { id: orgId, slug, owner, branchIds: ordered };
}

export type MemberRole = 'manager' | 'cashier' | 'kitchen' | 'purchaser' | 'accountant';

/** Full invitation flow through the real RPCs: owner invites, the new user accepts. */
export async function addMember(
  org: TestOrg,
  role: MemberRole,
  branchIds: string[] = [],
): Promise<TestUser> {
  const user = await createUser(role);
  const inv = await asUser(
    org.owner,
    async (s) => {
      const [row] = await s.q<{ r: { token: string } }>(
        'select public.create_invitation($1, $2, $3::public.app_role, $4::uuid[]) as r',
        [org.id, user.email, role, `{${branchIds.join(',')}}`],
      );
      return row!.r;
    },
    { commit: true },
  );
  await asUser(user, (s) => s.q('select public.accept_invitation($1)', [inv.token]), {
    commit: true,
  });
  return user;
}

export async function membershipId(orgId: string, userId: string): Promise<string> {
  const [row] = await admin<{ id: string }>(
    'select id from public.memberships where org_id = $1 and user_id = $2',
    [orgId, userId],
  );
  return row!.id;
}
