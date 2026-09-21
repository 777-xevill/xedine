/**
 * A drop-in for the `pg` module backed by an in-process PGlite with the real migrations applied.
 * `pnpm db:test:embedded` aliases `pg` to this file, so the whole DB suite runs with no Docker.
 *
 * What it is: the real schema, real RLS, real triggers and RPCs, on real Postgres semantics.
 * What it is not: Supabase. Auth is a two-table stub, and pg_cron / pg_net / PostgREST are absent.
 * Each test file gets a fresh database. CI against real Supabase is the source of truth (ADR 0011).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const root = join(import.meta.dirname, '..', '..', '..');

// int8 comes back as a string, exactly like node-postgres.
const db = new PGlite({ extensions: { pgcrypto }, parsers: { 20: (value: string) => value } });

await db.exec(readFileSync(join(import.meta.dirname, 'supabase-stub.sql'), 'utf8'));
const migrations = join(root, 'supabase', 'migrations');
for (const file of readdirSync(migrations)
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
  await db.exec(readFileSync(join(migrations, file), 'utf8'));
}

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

class Client {
  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const result = await db.query<Record<string, unknown>>(sql, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  }
  release(): void {}
}

/** One session: tests run sequentially, and a transaction is scoped to the client that opened it. */
export class Pool {
  async connect(): Promise<Client> {
    return new Client();
  }
  query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    return new Client().query(sql, params);
  }
  async end(): Promise<void> {}
}

const pg = { Pool };
export default pg;
