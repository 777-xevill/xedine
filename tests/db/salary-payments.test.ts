/**
 * ADR 0060: salaries and rent & bills are sensitive. Only the owner changes them or marks pay paid; an
 * accountant can read but not write; a manager and another restaurant's owner can do neither. Part
 * payments cannot pass the pay, a lower pay cannot undercut what was paid, a changed bill amount starts
 * today so earlier days keep the old one, and every change is audited.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  admin,
  asUser,
  closePool,
  createOrg,
  type TestOrg,
  type TestUser,
} from './harness';

afterAll(closePool);

type Row = Record<string, unknown>;
const code = (r: { ok: true } | { ok: false; code: string }) => (r.ok ? 'ok' : r.code);
const commit = { commit: true };
const MONTH = '2026-11-01';

describe('salary payments', () => {
  let org: TestOrg;
  let other: TestOrg;
  let manager: TestUser;
  let accountant: TestUser;
  let staffId: string;

  beforeAll(async () => {
    org = await createOrg({ branches: ['Main'] });
    other = await createOrg({ branches: ['Main'] });
    manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    accountant = await addMember(org, 'accountant', []);
    const [s] = await admin<{ id: string }>(
      `insert into public.staff (org_id, branch_id, display_name, role) values ($1, $2, 'Anwar', 'cashier') returning id`,
      [org.id, org.branchIds[0]],
    );
    staffId = s!.id;
  });

  const entry = async () =>
    (
      await admin<Row>(
        `select salary_poisha::int as salary, allowances_poisha::int as allowances, paid_poisha::int as paid,
                paid_on::text as paid_on, paid_method
           from public.salary_entries where org_id = $1 and staff_id = $2 and month = $3`,
        [org.id, staffId, MONTH],
      )
    )[0] ?? null;
  const save = (who: TestUser, salary: number, allowances = 0) =>
    asUser(
      who,
      (s) =>
        s.attempt('select public.save_salary($1, $2, $3, $4, $5, $6)', [
          org.id,
          staffId,
          MONTH,
          salary,
          allowances,
          null,
        ]),
      commit,
    );

  it('only the owner can enter pay; manager, accountant and other owners are refused', async () => {
    for (const who of [manager, accountant, other.owner])
      expect(code(await save(who, 1000000))).toBe('42501');
    expect(await entry()).toBeNull();
    // Even a direct write is closed to everyone but the owner.
    const direct = await asUser(accountant, (s) =>
      s.attempt(
        `insert into public.salary_entries (org_id, branch_id, staff_id, month, salary_poisha) values ($1, $2, $3, $4, 5)`,
        [org.id, org.branchIds[0], staffId, MONTH],
      ),
    );
    expect(code(direct)).toBe('42501');
  });

  it('the owner enters pay; managers cannot even read it, the accountant can', async () => {
    await asUser(
      org.owner,
      (s) =>
        s.q('select public.save_salary($1, $2, $3, $4, $5, $6)', [
          org.id,
          staffId,
          MONTH,
          1500000,
          200000,
          'Eid',
        ]),
      commit,
    );
    expect(await entry()).toMatchObject({ salary: 1500000, allowances: 200000, paid: 0 });
    const seen = async (who: TestUser) =>
      (
        await asUser(who, (s) =>
          s.q<Row>('select 1 from public.salary_entries where org_id = $1', [org.id]),
        )
      ).length;
    expect(await seen(manager)).toBe(0);
    expect(await seen(accountant)).toBe(1);
    expect(await seen(other.owner)).toBe(0);
  });

  it('marking paid: owner only; part payments up to the pay; not more; undo', async () => {
    const mark = (
      who: TestUser,
      amount: number | null,
      day: string | null,
      method: string | null,
    ) =>
      asUser(
        who,
        (s) =>
          s.attempt('select public.mark_salary_paid($1, $2, $3, $4, $5, $6)', [
            org.id,
            staffId,
            MONTH,
            amount,
            day,
            method,
          ]),
        commit,
      );
    expect(code(await mark(accountant, null, '2026-11-30', 'cash'))).toBe('42501');
    expect(code(await mark(manager, null, '2026-11-30', 'cash'))).toBe('42501');
    expect(code(await mark(other.owner, null, '2026-11-30', 'cash'))).toBe('42501');
    expect((await entry())?.paid).toBe(0);

    // 1,700,000 is the pay (salary + extra); more than that is refused.
    expect(code(await mark(org.owner, 1700001, '2026-11-30', 'cash'))).toBe('23514');
    expect(code(await mark(org.owner, 500000, null, null))).toBe('22023');
    expect(code(await mark(org.owner, 500000, '2026-11-20', 'bkash'))).toBe('ok');
    expect(await entry()).toMatchObject({
      paid: 500000,
      paid_on: '2026-11-20',
      paid_method: 'bkash',
    });
    expect(code(await mark(org.owner, null, '2026-11-30', 'bank'))).toBe('ok');
    expect(await entry()).toMatchObject({
      paid: 1700000,
      paid_on: '2026-11-30',
      paid_method: 'bank',
    });

    // The pay cannot drop below what was paid; undo first.
    expect(code(await save(org.owner, 1000000))).toBe('23514');
    expect(code(await mark(org.owner, 0, null, null))).toBe('ok');
    expect(await entry()).toMatchObject({ paid: 0, paid_on: null, paid_method: null });
    expect(code(await save(org.owner, 1000000))).toBe('ok');
  });

  it('"mark all paid" and "copy last month" are the owner\'s only and touch only this restaurant', async () => {
    const asOther = await asUser(other.owner, (s) =>
      s.attempt('select public.mark_salaries_paid($1, $2, $3, $4)', [
        org.id,
        MONTH,
        '2026-11-30',
        'cash',
      ]),
    );
    expect(code(asOther)).toBe('42501');
    const asAccountant = await asUser(accountant, (s) =>
      s.attempt('select public.copy_salaries_from_previous_month($1, $2)', [org.id, '2026-12-01']),
    );
    expect(code(asAccountant)).toBe('42501');

    const [n] = await asUser(
      org.owner,
      (s) =>
        s.q<{ n: number }>('select public.mark_salaries_paid($1, $2, $3, $4) as n', [
          org.id,
          MONTH,
          '2026-11-30',
          'cash',
        ]),
      commit,
    );
    expect(n!.n).toBe(1);
    expect((await entry())?.paid).toBe(1000000);

    const [c] = await asUser(
      org.owner,
      (s) =>
        s.q<{ n: number }>('select public.copy_salaries_from_previous_month($1, $2) as n', [
          org.id,
          '2026-12-01',
        ]),
      commit,
    );
    expect(c!.n).toBe(1);
    const dec = await admin<Row>(
      `select salary_poisha::int as salary, paid_poisha::int as paid from public.salary_entries
        where org_id = $1 and staff_id = $2 and month = '2026-12-01'`,
      [org.id, staffId],
    );
    expect(dec).toEqual([{ salary: 1000000, paid: 0 }]);
  });

  it('every pay change is audited with before and after', async () => {
    const log = await admin<Row>(
      `select action from public.audit_log where org_id = $1 and entity = 'salary' order by created_at`,
      [org.id],
    );
    expect(log.length).toBeGreaterThanOrEqual(6);
    expect(new Set(log.map((r) => r.action))).toEqual(new Set(['salary.insert', 'salary.update']));
  });
});

describe('rent and bills edits', () => {
  let org: TestOrg;
  let other: TestOrg;
  let manager: TestUser;
  let costId: string;

  beforeAll(async () => {
    org = await createOrg({ branches: ['Main'] });
    other = await createOrg({ branches: ['Main'] });
    manager = await addMember(org, 'manager', [org.branchIds[0]!]);
    const [c] = await admin<{ id: string }>(
      `insert into public.fixed_costs (org_id, branch_id, kind, label, monthly_poisha, effective_from)
       values ($1, $2, 'rent', 'Shop', 18000000, '2026-10-01') returning id`,
      [org.id, org.branchIds[0]],
    );
    costId = c!.id;
  });

  const edit = (who: TestUser, amount: number, today: string, label = 'Shop') =>
    asUser(
      who,
      (s) =>
        s.attempt('select public.update_fixed_cost($1, $2, $3, $4, $5, $6)', [
          org.id,
          costId,
          'rent',
          label,
          amount,
          today,
        ]),
      commit,
    );
  const rows = () =>
    admin<Row>(
      `select monthly_poisha::int as amount, effective_from::text as from, effective_to::text as to
         from public.fixed_costs where org_id = $1 order by effective_from`,
      [org.id],
    );

  it('only the owner edits; a changed amount starts today and the old one ends yesterday', async () => {
    expect(code(await edit(manager, 20000000, '2026-11-16'))).toBe('42501');
    expect(code(await edit(other.owner, 20000000, '2026-11-16'))).toBe('42501');
    expect(await rows()).toHaveLength(1);

    expect(code(await edit(org.owner, 20000000, '2026-11-16'))).toBe('ok');
    expect(await rows()).toEqual([
      { amount: 18000000, from: '2026-10-01', to: '2026-11-15' },
      { amount: 20000000, from: '2026-11-16', to: null },
    ]);
  });

  it('a new row edited the same day is changed in place; only-words edits keep the amount', async () => {
    const [{ id }] = (await admin<{ id: string }>(
      `select id from public.fixed_costs where org_id = $1 and effective_to is null`,
      [org.id],
    )) as [{ id: string }];
    costId = id;
    expect(code(await edit(org.owner, 21000000, '2026-11-16'))).toBe('ok');
    expect(code(await edit(org.owner, 21000000, '2026-11-20', 'Shop rent'))).toBe('ok');
    expect(await rows()).toEqual([
      { amount: 18000000, from: '2026-10-01', to: '2026-11-15' },
      { amount: 21000000, from: '2026-11-16', to: null },
    ]);
    expect(code(await edit(org.owner, -1, '2026-11-20'))).toBe('22023');
  });

  it('changes are audited', async () => {
    const log = await admin<Row>(
      `select action from public.audit_log where org_id = $1 and entity = 'fixed_cost'`,
      [org.id],
    );
    expect(log.length).toBeGreaterThanOrEqual(3);
  });
});
