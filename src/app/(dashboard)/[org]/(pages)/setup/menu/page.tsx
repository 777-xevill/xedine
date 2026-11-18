import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/button';
import { Alert, Card, PageTitle } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatNumber, type Locale } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import { parseMenuDraft } from '@/modules/menu/import';
import { MenuReview } from '@/modules/menu/menu-review';
import { getOrgContext } from '@/modules/tenancy/context';

/**
 * Setup → Menu review (2026-11-19): the menu read from the owner's photos, category by category, to fix and
 * confirm before anything is added (CLAUDE.md #4). After the import it says what was added.
 */
export default async function MenuReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ created?: string; skipped?: string; unread?: string }>;
}) {
  const [{ org }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getOrgContext(org);
  if (!ctx.isOwner) notFound();
  const [t, locale] = await Promise.all([getTranslations('setup.review'), getLocale()]);
  const n = (v: string | number | undefined) =>
    formatNumber(Math.max(0, Number(v) || 0), locale as Locale);
  const supabase = await createClient();
  const [{ data: drafts }, { data: items }] = await Promise.all([
    supabase
      .from('menu_import_drafts')
      .select('id, csv')
      .eq('org_id', ctx.org.id)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase.from('menu_items').select('name').eq('org_id', ctx.org.id).limit(5000),
  ]);
  const draft = drafts?.[0];

  if (!draft) {
    const done = sp.created !== undefined;
    return (
      <>
        <PageTitle title={t('title')} />
        <Card className="mx-auto max-w-xl space-y-4 text-center">
          {done ? <CheckCircle2 aria-hidden className="mx-auto size-10 text-success" /> : null}
          <p className="text-lg font-bold">{done ? t('doneTitle') : t('emptyTitle')}</p>
          <p className="text-sm text-secondary">
            {done
              ? t('doneBody', { created: n(sp.created), skipped: n(sp.skipped) })
              : t('emptyBody')}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href={`/${ctx.org.slug}/menu`} className={cn(buttonVariants())}>
              {t('openMenu')}
            </Link>
            <Link
              href={`/${ctx.org.slug}/setup`}
              className={cn(buttonVariants({ variant: 'secondary' }))}
            >
              {t('backToSetup')}
            </Link>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      {Number(sp.unread) > 0 ? (
        <Alert tone="warning" className="mb-4">
          {t('unread', { n: n(sp.unread) })}
        </Alert>
      ) : null}
      <MenuReview
        orgId={ctx.org.id}
        orgSlug={ctx.org.slug}
        draftId={draft.id}
        rows={parseMenuDraft(draft.csv)}
        existing={(items ?? []).map((i) => i.name)}
      />
    </>
  );
}
