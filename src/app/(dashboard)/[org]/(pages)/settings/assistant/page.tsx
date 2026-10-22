import { Sparkles, X } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { SettingsNav } from '@/components/settings-nav';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardTitle,
  EmptyState,
  Hint,
  Input,
  Label,
  PageTitle,
  Select,
} from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { aiConfigured, aiProvider } from '@/lib/llm-gateway';
import { addContextAction, removeContextAction } from '@/modules/assistant/actions';
import { getOrgContext } from '@/modules/tenancy/context';

/**
 * Settings → Assistant: whether AI answers are on, and the owner's goals and rules the assistant
 * follows in every answer (org_context; owner-only by RLS).
 */
export default async function AssistantSettingsPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.isOwner) notFound();
  const t = await getTranslations('assistantPage');
  const supabase = await createClient();
  const { data: rules } = await supabase
    .from('org_context')
    .select('id, kind, body')
    .eq('org_id', ctx.org.id)
    .eq('is_active', true)
    .order('created_at');
  const on = aiConfigured();
  // One-tap starters: nobody has to think of the words. Ones already added are hidden.
  const EXAMPLES = ['foodCost', 'growth', 'short', 'noRaise', 'noStaff'] as const;
  const EXAMPLE_KIND = {
    foodCost: 'goal',
    growth: 'goal',
    short: 'rule',
    noRaise: 'constraint',
    noStaff: 'constraint',
  } as const;
  const have = new Set((rules ?? []).map((r) => r.body as string));
  const examples = EXAMPLES.map((k) => ({ key: k, body: t(`examples.${k}`) })).filter(
    (e) => !have.has(e.body),
  );

  return (
    <>
      <SettingsNav ctx={ctx} current="assistantRules" />
      <PageTitle title={t('settingsTitle')} subtitle={t('settingsSubtitle')} />

      <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-purple/10 text-purple"
          >
            <Sparkles className="size-4" />
          </span>
          <div>
            <p className="font-medium">{t('aiStatusTitle')}</p>
            <p className="text-sm text-secondary">
              {on ? t('aiOnBody', { provider: aiProvider() }) : t('routerMode')}
            </p>
          </div>
        </div>
        <StatusBadge tone={on ? 'success' : 'neutral'}>{on ? t('aiOn') : t('aiOff')}</StatusBadge>
      </Card>

      <Card>
        <CardTitle className="mb-1">{t('rulesTitle')}</CardTitle>
        <p className="mb-4 text-sm text-secondary">{t('rulesBody')}</p>
        <ul className="mb-4 space-y-1 text-sm text-secondary">
          {(['goal', 'rule', 'constraint'] as const).map((k) => (
            <li key={k}>
              <span className="font-medium text-foreground">{t(`kinds.${k}`)}</span>
              {' — '}
              {t(`kindHelp.${k}`)}
            </li>
          ))}
        </ul>
        {(rules ?? []).length === 0 ? (
          <EmptyState title={t('noRules')} className="py-6" />
        ) : (
          <ul className="divide-y divide-line">
            {(rules ?? []).map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted">{t(`kinds.${r.kind as string}`)}</p>
                  <p className="mt-0.5">{r.body}</p>
                </div>
                <form action={removeContextAction}>
                  <input type="hidden" name="id" value={r.id as string} />
                  <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                  <Button type="submit" size="icon" variant="ghost" aria-label={t('remove')}>
                    <X aria-hidden className="size-4" />
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {examples.length > 0 ? (
          <div className="mt-5 border-t border-line pt-5">
            <p className="text-sm font-medium">{t('examplesTitle')}</p>
            <p className="mb-2 text-sm text-secondary">{t('examplesBody')}</p>
            <ul className="flex flex-wrap gap-2">
              {examples.map((e) => (
                <li key={e.key}>
                  <ActionForm action={addContextAction}>
                    <input type="hidden" name="orgId" value={ctx.org.id} />
                    <input type="hidden" name="orgSlug" value={ctx.org.slug} />
                    <input type="hidden" name="kind" value={EXAMPLE_KIND[e.key]} />
                    <input type="hidden" name="body" value={e.body} />
                    <Button type="submit" variant="secondary" size="sm">
                      + {e.body}
                    </Button>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="mt-5 border-t border-line pt-5 text-sm font-medium">{t('writeOwn')}</p>
        <ActionForm
          action={addContextAction}
          successKey="common.saved"
          className="mt-3 grid gap-3 border-t border-line pt-5 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end"
        >
          <input type="hidden" name="orgId" value={ctx.org.id} />
          <input type="hidden" name="orgSlug" value={ctx.org.slug} />
          <div>
            <Label htmlFor="ctx-kind">{t('kind')}</Label>
            <Select id="ctx-kind" name="kind" defaultValue="goal">
              {(['goal', 'rule', 'constraint'] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="ctx-body">{t('ruleText')}</Label>
            <Input
              id="ctx-body"
              name="body"
              required
              minLength={3}
              maxLength={500}
              placeholder={t('rulePlaceholder')}
            />
          </div>
          <Button type="submit" variant="secondary">
            {t('addRule')}
          </Button>
          <Hint className="col-span-full">{t('ruleHint')}</Hint>
        </ActionForm>
      </Card>
    </>
  );
}
