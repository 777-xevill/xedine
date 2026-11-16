import {
  Check,
  Hourglass,
  Link2Off,
  Lock,
  MessageCircle,
  MessageSquareWarning,
  Receipt,
  SprayCan,
  Thermometer,
  TriangleAlert,
  UtensilsCrossed,
} from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/form';
import { COMPLAINT_TOPICS } from '@/modules/reviews/complaint-link';
import { readComplaintLink } from '@/modules/reviews/complaint-link-view';
import { CustomerBar } from '../../customer-bar';
import { SuccessMark } from '../../success-mark';

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** Each topic with a picture beside its words (ADR 0063). */
const TOPIC_ICON = {
  food: UtensilsCrossed,
  clean: SprayCan,
  service: Receipt,
  sick: Thermometer,
  other: MessageCircle,
} as const;

/** The mark above each whole-page message: a silver tick for sent, a yellow sign for trouble. */
const TROUBLE_ICON = { failed: TriangleAlert, busy: Hourglass, gone: Link2Off } as const;

/**
 * A customer's complaint (ADR 0043): opened from the QR code on the table or counter, no account. Tap what it
 * is about, say what happened, send. It appears on the restaurant's Complaints page.
 */
export default async function CustomerComplaintPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const [t, link] = await Promise.all([getTranslations('complaintForm'), readComplaintLink(token)]);
  const message = !link
    ? 'gone'
    : sp.done === '1'
      ? 'thanks'
      : sp.done === '2'
        ? 'busy'
        : sp.done === '0'
          ? 'failed'
          : null;

  return (
    <div className="cust-page mx-auto flex min-h-dvh max-w-xl flex-col px-4 pb-8">
      <CustomerBar>
        {link ? (
          <>
            <p className="truncate text-[0.9375rem] leading-tight font-semibold">
              {link.restaurant}
            </p>
            <p className="truncate text-xs text-muted">{link.branch}</p>
          </>
        ) : null}
      </CustomerBar>
      <main className="flex flex-1 flex-col justify-center pt-5">
        {message ? (
          <section className="cust-card cust-state">
            {message === 'thanks' ? (
              <SuccessMark />
            ) : (
              <span className="cust-alert">
                {(() => {
                  const Icon = TROUBLE_ICON[message];
                  return <Icon aria-hidden />;
                })()}
              </span>
            )}
            <h1 className="cust-title mt-5">{t(`${message}Title`)}</h1>
            <p className="mt-2 max-w-sm text-secondary">{t(`${message}Body`)}</p>
            {message === 'failed' ? (
              <a href={`/c/${token}`} className="cust-cta mt-6">
                {t('tryAgain')}
              </a>
            ) : null}
          </section>
        ) : (
          <form
            method="post"
            action="/api/webhooks/complaint"
            className="cust-card animate-rise-in space-y-6 p-5 sm:p-7"
          >
            <input type="hidden" name="token" value={token} />
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              className="sr-only"
            />
            <div>
              <span className="cust-icon">
                <MessageSquareWarning aria-hidden className="size-[1.375rem]" />
              </span>
              <h1 className="cust-title mt-4">{t('title')}</h1>
              <p className="mt-2 leading-relaxed text-secondary">{t('intro')}</p>
            </div>
            <fieldset>
              <legend className="cust-label">{t('topic')}</legend>
              <div className="cust-choices">
                {COMPLAINT_TOPICS.map((v) => {
                  const Icon = TOPIC_ICON[v] ?? MessageCircle;
                  return (
                    <label key={v} className="cust-choice cust-choice--stack">
                      <input
                        type="radio"
                        name="topic"
                        value={v}
                        defaultChecked={v === 'food'}
                        className="sr-only"
                      />
                      <Icon aria-hidden className="cust-choice-icon size-[1.375rem]" />
                      <span className="pe-6">{t(`topics.${v}`)}</span>
                      <span aria-hidden className="cust-choice-check">
                        <Check />
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div>
              <Label htmlFor="c-text" className="cust-label">
                {t('what')}
              </Label>
              <Textarea
                id="c-text"
                name="text"
                rows={4}
                required
                minLength={3}
                maxLength={1000}
                placeholder={t('example')}
                className="cust-field"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="c-name" className="cust-label">
                  {t('name')}
                </Label>
                <Input
                  id="c-name"
                  name="name"
                  maxLength={120}
                  autoComplete="name"
                  className="cust-field"
                />
              </div>
              <div>
                <Label htmlFor="c-phone" className="cust-label">
                  {t('phone')}
                </Label>
                <Input
                  id="c-phone"
                  name="phone"
                  type="tel"
                  maxLength={30}
                  autoComplete="tel"
                  className="cust-field"
                />
              </div>
            </div>
            <Button type="submit" size="lg" className="w-full">
              {t('send')}
            </Button>
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
              <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {t('privacy')}
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
