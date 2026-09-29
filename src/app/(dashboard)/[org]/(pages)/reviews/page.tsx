import { Sparkles } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Alert,
  Card,
  CardTitle,
  EmptyState,
  Input,
  Label,
  PageTitle,
  Select,
  Stat,
  Textarea,
} from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-server';
import { formatBps, formatNumber, type Locale } from '@/lib/i18n/format';
import { aiConfigured } from '@/lib/llm-gateway';
import { addDays } from '@/lib/time/business-date';
import {
  addReviewAction,
  approveReplyAction,
  draftReplyAction,
  writeReplyAction,
} from '@/modules/customers/actions';
import { businessToday } from '@/modules/metrics/queries';
import { getOrgContext } from '@/modules/tenancy/context';

/**
 * Reviews and feedback (ROADMAP Phase 8): every source in one place, tagged by theme, linked to what the
 * kitchen and floor were doing that day, and answered with a reply a person approves.
 */
export default async function ReviewsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  if (!ctx.roles.includes('owner') && !ctx.roles.includes('manager')) notFound();
  const [t, locale] = await Promise.all([getTranslations('reviews'), getLocale()]);
  const loc = locale as Locale;
  const { date: today } = await businessToday(ctx.org.id);
  const supabase = await createClient();
  const [{ data: ratings }, { data: reviews }, { data: feedback }] = await Promise.all([
    supabase.rpc('metric_ratings', {
      p_org: ctx.org.id,
      p_branch: ctx.selectedBranchId,
      p_from: addDays(today, -29),
      p_to: today,
    }),
    supabase
      .from('reviews')
      .select(
        'id, branch_id, source, rating, body, author, reviewed_at, themes, review_replies(id, draft_body, status, approved_at, model)',
      )
      .eq('org_id', ctx.org.id)
      .order('reviewed_at', { ascending: false })
      .limit(30),
    supabase
      .from('feedback')
      .select('id, branch_id, rating, comment, submitted_at, themes')
      .eq('org_id', ctx.org.id)
      .not('submitted_at', 'is', null)
      .not('comment', 'is', null)
      .order('submitted_at', { ascending: false })
      .limit(20),
  ]);
  const list = (reviews ?? []) as unknown as {
    id: string;
    branch_id: string | null;
    source: string;
    rating: number | null;
    body: string | null;
    author: string | null;
    reviewed_at: string | null;
    themes: string[];
    review_replies: { id: string; draft_body: string; status: string; model: string | null }[];
  }[];
  const contexts = new Map<string, Record<string, unknown>>();
  for (const r of list.slice(0, 10)) {
    if ((r.rating ?? 10) > 6) continue;
    const { data } = await supabase.rpc('metric_review_context', { p_review: r.id });
    const row = ((data ?? []) as Record<string, unknown>[])[0];
    if (row) contexts.set(r.id, row);
  }
  const branchName = (id: string | null) =>
    id ? (ctx.branches.find((b) => b.id === id)?.name ?? '') : t('allBranches');
  const stars = (rating: number | null) =>
    rating === null ? '—' : formatNumber(rating / 2, loc, { fractionDigits: rating % 2 ? 1 : 0 });
  const hidden = (
    <>
      <input type="hidden" name="orgId" value={ctx.org.id} />
      <input type="hidden" name="orgSlug" value={ctx.org.slug} />
    </>
  );

  return (
    <>
      <PageTitle title={t('title')} subtitle={t('subtitle')} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          (ratings ?? []) as { source: string; n: number; avg_rating: number; net_bps: number }[]
        ).map((r) => (
          <Stat
            key={r.source}
            label={t('ratingOf', {
              source: t(`sources.${r.source}`),
              n: formatNumber(Number(r.n), loc),
            })}
            value={`${formatNumber(Number(r.avg_rating), loc, { fractionDigits: 1 })}/10 · ${formatBps(Number(r.net_bps), loc)}`}
          />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="space-y-6">
          <Card>
            <CardTitle>{t('addTitle')}</CardTitle>
            <ActionForm action={addReviewAction} successKey="common.saved" className="space-y-3">
              {hidden}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="rv-src">{t('source')}</Label>
                  <Select id="rv-src" name="source" defaultValue="facebook">
                    {(['facebook', 'foodpanda', 'google', 'other'] as const).map((s) => (
                      <option key={s} value={s}>
                        {t(`sources.${s}`)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="rv-stars">{t('stars')}</Label>
                  <Select id="rv-stars" name="stars" defaultValue="5">
                    {[5, 4, 3, 2, 1].map((s) => (
                      <option key={s} value={s}>
                        {formatNumber(s, loc)}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="rv-branch">{t('branch')}</Label>
                  <Select id="rv-branch" name="branchId" defaultValue={ctx.branches[0]?.id ?? ''}>
                    {ctx.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                    <option value="">{t('allBranches')}</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="rv-date">{t('date')}</Label>
                  <Input
                    id="rv-date"
                    name="reviewedOn"
                    type="date"
                    max={today}
                    defaultValue={today}
                    required
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="rv-author">{t('author')}</Label>
                <Input id="rv-author" name="author" maxLength={120} />
              </div>
              <div>
                <Label htmlFor="rv-body">{t('text')}</Label>
                <Textarea id="rv-body" name="body" rows={4} required maxLength={4000} />
              </div>
              <Button type="submit">{t('add')}</Button>
            </ActionForm>
            <p className="mt-3 text-xs text-secondary">{t('googleNote')}</p>
          </Card>
          <Card>
            <CardTitle>{t('feedbackTitle')}</CardTitle>
            {(feedback ?? []).length === 0 ? (
              <EmptyState title={t('noFeedback')} />
            ) : (
              <ul className="space-y-2">
                {(feedback ?? []).map((f) => (
                  <li key={f.id} className="glass-tile rounded-input p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold tabular-nums">
                        {t('score', { score: formatNumber(Number(f.rating), loc) })}
                      </span>
                      <span className="text-xs text-secondary">
                        {branchName(f.branch_id as string)}
                      </span>
                    </div>
                    <p className="mt-1">{f.comment as string}</p>
                    <Themes themes={(f.themes as string[]) ?? []} label={(k) => t(`themes.${k}`)} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {!aiConfigured() ? <Alert tone="warning">{t('aiNotConfigured')}</Alert> : null}
          {list.length === 0 ? (
            <EmptyState title={t('none')} />
          ) : (
            list.map((r) => {
              const cx = contexts.get(r.id);
              const draft = r.review_replies.find((x) => x.status === 'draft');
              const approved = r.review_replies.find(
                (x) => x.status === 'approved' || x.status === 'posted',
              );
              return (
                <Card key={r.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        {t(`sources.${r.source}`)} · {t('starsOf', { stars: stars(r.rating) })}
                      </p>
                      <p className="text-xs text-secondary">
                        {branchName(r.branch_id)} · {r.author ?? t('anonymous')} ·{' '}
                        {(r.reviewed_at ?? '').slice(0, 10)}
                      </p>
                    </div>
                    <Themes themes={r.themes} label={(k) => t(`themes.${k}`)} />
                  </div>
                  <p className="mt-3 text-sm">{r.body}</p>
                  {cx ? (
                    <p className="glass-tile mt-3 rounded-input p-3 text-xs text-secondary">
                      {t('context', {
                        date: String(cx.business_date),
                        ticket:
                          cx.median_ticket_seconds == null
                            ? '—'
                            : formatNumber(Math.round(Number(cx.median_ticket_seconds) / 60), loc),
                        usual:
                          cx.branch_median_ticket_seconds == null
                            ? '—'
                            : formatNumber(
                                Math.round(Number(cx.branch_median_ticket_seconds) / 60),
                                loc,
                              ),
                        staff: ((cx.staff_on_duty as string[]) ?? []).join(', ') || '—',
                        items: ((cx.items_mentioned as string[]) ?? []).join(', ') || '—',
                      })}
                    </p>
                  ) : null}
                  {approved ? (
                    <div className="mt-3 border-t border-line pt-3 text-sm">
                      <StatusBadge tone="success">{t('replyApproved')}</StatusBadge>
                      <p className="mt-2 whitespace-pre-wrap">{approved.draft_body}</p>
                    </div>
                  ) : draft ? (
                    <ActionForm
                      action={approveReplyAction}
                      successKey="reviews.replyApprovedOk"
                      className="mt-3 space-y-2 border-t border-line pt-3"
                    >
                      {hidden}
                      <input type="hidden" name="replyId" value={draft.id} />
                      {draft.model ? (
                        <Badge tone="accent" icon={<Sparkles />}>
                          {t('aiDraft')}
                        </Badge>
                      ) : null}
                      <Textarea
                        name="body"
                        rows={3}
                        defaultValue={draft.draft_body}
                        aria-label={t('reply')}
                        maxLength={2000}
                      />
                      <Button type="submit" size="sm">
                        {t('approveReply')}
                      </Button>
                    </ActionForm>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                      <ActionForm action={draftReplyAction} successKey="reviews.drafted">
                        {hidden}
                        <input type="hidden" name="reviewId" value={r.id} />
                        <Button
                          type="submit"
                          size="sm"
                          variant="secondary"
                          disabled={!aiConfigured()}
                        >
                          <Sparkles aria-hidden className="size-4" />
                          {t('draftWithAi')}
                        </Button>
                      </ActionForm>
                      <details className="w-full">
                        <summary className="cursor-pointer text-sm text-secondary">
                          {t('writeOwn')}
                        </summary>
                        <ActionForm
                          action={writeReplyAction}
                          successKey="reviews.drafted"
                          className="mt-2 space-y-2"
                        >
                          {hidden}
                          <input type="hidden" name="reviewId" value={r.id} />
                          <Textarea
                            name="body"
                            rows={3}
                            maxLength={2000}
                            required
                            aria-label={t('reply')}
                          />
                          <Button type="submit" size="sm" variant="secondary">
                            {t('saveDraft')}
                          </Button>
                        </ActionForm>
                      </details>
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

function Themes({ themes, label }: { themes: string[]; label: (k: string) => string }) {
  if (themes.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {themes.map((k) => (
        <StatusBadge key={k} tone={k === 'praise' ? 'success' : k === 'taste' ? 'info' : 'warning'}>
          {label(k)}
        </StatusBadge>
      ))}
    </div>
  );
}
