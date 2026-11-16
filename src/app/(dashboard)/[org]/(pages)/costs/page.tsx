import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PillNav } from '@/components/ui/pill-nav';
import { PageTitle } from '@/components/ui/form';
import { SettingsNav } from '@/components/settings-nav';
import { createClient } from '@/lib/db/supabase-server';
import { businessDate } from '@/lib/time/business-date';
import { now } from '@/lib/time/clock';
import { getOrgContext } from '@/modules/tenancy/context';
import { BillsSection, type FixedCostRow } from './bills-section';
import { SalariesSection, type SalaryEntryRow, type StaffRow } from './salaries-section';

const TABS = ['bills', 'salaries'] as const;
type Tab = (typeof TABS)[number];

/** "2026-11" ± n months, as text (no wall clock needed). */
function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * Costs (ROADMAP Phase 2, ADR 0060): two sections. Rent & bills, and Salaries with who has been paid.
 * Owner-only: every row here is money (ADR 0007), and every change is audited.
 */
export default async function CostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ tab?: string; month?: string }>;
}) {
  const [{ org }, query] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  if (!ctx.isOwner) notFound();

  const t = await getTranslations('costs');
  const tab: Tab = (TABS as readonly string[]).includes(query.tab ?? '')
    ? (query.tab as Tab)
    : 'bills';
  const today = businessDate(now(), ctx.place.cutoffMinutes, ctx.place.tz);
  const thisMonth = today.slice(0, 7);
  const asked = /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month ?? '') ? query.month! : thisMonth;
  // Pay can be entered up to the current month, and back as far as the owner wants.
  const month = asked > thisMonth ? thisMonth : asked;
  const supabase = await createClient();
  const branches = ctx.branches.map((b) => ({ id: b.id, name: b.name }));

  const nav = (
    <>
      <SettingsNav ctx={ctx} current="costs" />
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <PillNav
        label={t('sections')}
        className="mb-6"
        items={TABS.map((k) => ({
          href: `/${ctx.org.slug}/costs?tab=${k}`,
          active: tab === k,
          label: k === 'bills' ? t('tabBills') : t('tabSalaries'),
        }))}
      />
    </>
  );

  if (tab === 'bills') {
    const { data: fixed } = await supabase
      .from('fixed_costs')
      .select('id, branch_id, kind, label, monthly_poisha, effective_from, effective_to')
      .eq('org_id', ctx.org.id)
      .order('effective_from', { ascending: false });
    const rows = (fixed ?? []).filter((f) => !f.effective_to || f.effective_to >= today);
    return (
      <>
        {nav}
        <BillsSection
          orgId={ctx.org.id}
          orgSlug={ctx.org.slug}
          branches={branches}
          rows={rows as unknown as FixedCostRow[]}
          place={ctx.place}
        />
      </>
    );
  }

  const [{ data: staff }, { data: entries }, { count: previous }] = await Promise.all([
    supabase
      .from('staff')
      .select('id, display_name, role, branch_id')
      .eq('org_id', ctx.org.id)
      .eq('is_active', true)
      .order('display_name'),
    supabase
      .from('salary_entries')
      .select(
        'staff_id, salary_poisha, allowances_poisha, paid_poisha, paid_on, paid_method, notes',
      )
      .eq('org_id', ctx.org.id)
      .eq('month', `${month}-01`),
    supabase
      .from('salary_entries')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', ctx.org.id)
      .eq('month', `${shiftMonth(month, -1)}-01`),
  ]);
  return (
    <>
      {nav}
      <SalariesSection
        orgId={ctx.org.id}
        orgSlug={ctx.org.slug}
        month={month}
        prevMonth={shiftMonth(month, -1)}
        nextMonth={month < thisMonth ? shiftMonth(month, 1) : null}
        today={today}
        hasPrevious={(previous ?? 0) > 0}
        staff={(staff ?? []) as unknown as StaffRow[]}
        entries={(entries ?? []) as unknown as SalaryEntryRow[]}
        branches={branches}
        place={ctx.place}
      />
    </>
  );
}
