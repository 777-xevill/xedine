import { CheckCircle2, Circle, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, Hint, Input, Label, PageTitle, Textarea } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { aiConfigured } from '@/lib/llm-gateway';
import { formatNumber, type Locale } from '@/lib/i18n/format';
import { now } from '@/lib/time/clock';
import { importMenuAction, readMenuPhotoAction } from '@/modules/menu/import-actions';
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
 * itself (metric_setup_progress), so the list can never claim more than is true. The menu can be pasted
 * as CSV or read from a photo into an editable draft.
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
      .select('id, csv')
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
            <CardTitle>{t('importTitle')}</CardTitle>
            <ActionForm action={importMenuAction} successKey="setup.imported" className="space-y-3">
              {hidden}
              <input type="hidden" name="draftId" value={draft?.id ?? ''} />
              {draft ? (
                <Badge tone="accent" icon={<Sparkles />}>
                  {t('aiDraft')}
                </Badge>
              ) : null}
              <div>
                <Label htmlFor="menu-csv">{t('csvLabel')}</Label>
                <Textarea
                  id="menu-csv"
                  name="csv"
                  rows={12}
                  required
                  maxLength={60000}
                  defaultValue={draft?.csv ?? ''}
                  placeholder={t('csvPlaceholder')}
                  className="font-mono text-xs"
                />
              </div>
              <Hint>{draft ? t('draftHint') : t('csvHint')}</Hint>
              <Button type="submit">{t('import')}</Button>
            </ActionForm>
          </Card>
          <Card>
            <CardTitle>{t('photoTitle')}</CardTitle>
            <ActionForm
              action={readMenuPhotoAction}
              successKey="setup.photoRead"
              className="space-y-3"
            >
              {hidden}
              <div>
                <Label htmlFor="menu-photo">{t('photo')}</Label>
                <Input
                  id="menu-photo"
                  name="photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required
                />
              </div>
              <Button type="submit" variant="secondary" disabled={!aiConfigured()}>
                <Sparkles aria-hidden className="size-4" />
                {t('readPhoto')}
              </Button>
              <Hint>{aiConfigured() ? t('photoHint') : t('aiOff')}</Hint>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
