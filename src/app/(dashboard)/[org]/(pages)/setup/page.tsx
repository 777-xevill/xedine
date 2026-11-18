import { CheckCircle2, Circle, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, Hint, Label, PageTitle, Textarea } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { aiConfigured } from '@/lib/llm-gateway';
import { formatNumber, type Locale } from '@/lib/i18n/format';
import { now } from '@/lib/time/clock';
import { importMenuAction } from '@/modules/menu/import-actions';
import { MenuPhotoForm } from '@/modules/menu/menu-photo-form';
import { getOrgContext } from '@/modules/tenancy/context';
import { SettingsNav } from '@/components/settings-nav';

const HREF: Record<string, string> = {
  profile: 'settings',
  menu: 'menu',
  channels: 'settings',
  staff_pins: 'staff',
  pos_device: 'staff',
  recipes: 'recipes',
  ingredient_prices: 'purchases',
  fixed_costs: 'costs',
  salaries: 'costs',
  opening_count: 'stock',
  owner_whatsapp: 'settings',
  first_order: '',
};

/**
 * Setup (ROADMAP Phase 10 onboarding, target: live in under two hours). Each step is ticked by the data
 * itself (metric_setup_progress), so the list can never claim more than is true. The menu is read from
 * photos of its pages and confirmed on Setup → Menu review, or pasted as CSV.
 */
export default async function SetupPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.isOwner) notFound();
  const [t, locale] = await Promise.all([getTranslations('setup'), getLocale()]);
  const loc = locale as Locale;
  const supabase = await createClient();
  const [{ data: steps }, { data: drafts }] = await Promise.all([
    supabase.rpc('metric_setup_progress', { p_org: ctx.org.id, p_now: now().toISOString() }),
    supabase
      .from('menu_import_drafts')
      .select('id')
      .eq('org_id', ctx.org.id)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);
  const list = (steps ?? []) as { step: string; done: boolean; have: number; need: number }[];
  const doneCount = list.filter((s) => s.done).length;
  const draft = drafts?.[0];
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );

  return (
    <>
      <SettingsNav ctx={ctx} current="setup" />
      <PageTitle
        title={t('title')}
        subtitle={t('subtitle', {
          done: formatNumber(doneCount, loc),
          total: formatNumber(list.length, loc),
        })}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <CardTitle>{t('checklist')}</CardTitle>
          <ol className="space-y-2">
            {list.map((s, i) => (
              <li key={s.step} className="flex items-start gap-3 border-t border-line pt-2">
                {s.done ? (
                  <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
                ) : (
                  <Circle aria-hidden className="mt-0.5 size-5 shrink-0 text-secondary" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    <span className="sr-only">{s.done ? t('doneLabel') : t('todoLabel')} </span>
                    {t('stepTitle', {
                      n: formatNumber(i + 1, loc),
                      title: t(`steps.${s.step}.title`),
                    })}
                  </p>
                  <p className="text-xs text-secondary">
                    {t(`steps.${s.step}.body`)}{' '}
                    {s.need > 1
                      ? t('progress', {
                          have: formatNumber(Number(s.have), loc),
                          need: formatNumber(Number(s.need), loc),
                        })
                      : null}
                  </p>
                </div>
                {!s.done && HREF[s.step] ? (
                  <Link
                    href={`/${ctx.org.slug}/${HREF[s.step]}`}
                    className="text-sm font-semibold text-info underline-offset-4 hover:underline"
                  >
                    {t('go')}
                  </Link>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardTitle>{t('menuPhotos.title')}</CardTitle>
            <p className="mb-4 text-sm text-secondary">{t('menuPhotos.body')}</p>
            {draft ? (
              <Link
                href={`/${ctx.org.slug}/setup/menu`}
                className="mb-4 flex items-center gap-3 rounded-input border border-warning/45 bg-warning/8 px-3.5 py-3 text-sm font-semibold transition-colors hover:bg-warning/15"
              >
                <Sparkles aria-hidden className="size-4 shrink-0 text-warning" />
                <span className="flex-1">{t('menuPhotos.waiting')}</span>
                <span className="text-warning">{t('menuPhotos.review')}</span>
              </Link>
            ) : null}
            <MenuPhotoForm orgId={ctx.org.id} orgSlug={ctx.org.slug} enabled={aiConfigured()} />
          </Card>
          <Card>
            <CardTitle>{t('importTitle')}</CardTitle>
            <ActionForm action={importMenuAction} successKey="setup.imported" className="space-y-3">
              {hidden}
              <div>
                <Label htmlFor="menu-csv">{t('csvLabel')}</Label>
                <Textarea
                  id="menu-csv"
                  name="csv"
                  rows={8}
                  required
                  maxLength={60000}
                  placeholder={t('csvPlaceholder')}
                  className="font-mono text-xs"
                />
              </div>
              <Hint>{t('csvHint')}</Hint>
              <Button type="submit" variant="secondary">
                {t('import')}
              </Button>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
