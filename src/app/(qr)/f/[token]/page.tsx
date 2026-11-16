import { Lock, MessageSquareHeart, TimerOff } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Label, Textarea } from '@/components/ui/form';
import { formatNumber, type Locale } from '@/lib/i18n/format';
import { CustomerBar } from '../../customer-bar';
import { SuccessMark } from '../../success-mark';

const TOKEN = /^[0-9a-f]{36}$/;
const SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/**
 * Post-meal feedback (ROADMAP Phase 8): the link a consenting customer receives on WhatsApp. The page
 * reads nothing; the token is checked when the form is submitted (/api/webhooks/feedback), so a guessed
 * or used link only ever shows the thank-you or "link expired" message.
 */
export default async function FeedbackPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const [t, locale] = await Promise.all([getTranslations('feedbackPage'), getLocale()]);
  const done =
    sp.done === '1' ? 'thanks' : sp.done === '0' || !TOKEN.test(token) ? 'expired' : null;

  return (
    <div className="cust-page mx-auto flex min-h-dvh max-w-xl flex-col px-4 pb-8">
      <CustomerBar />
      <main className="flex flex-1 flex-col justify-center pt-5">
        {done ? (
          <section className="cust-card cust-state">
            {done === 'thanks' ? (
              <SuccessMark />
            ) : (
              <span className="cust-alert">
                <TimerOff aria-hidden />
              </span>
            )}
            <h1 className="cust-title mt-5">{t(`${done}Title`)}</h1>
            <p className="mt-2 max-w-sm text-secondary">{t(`${done}Body`)}</p>
          </section>
        ) : (
          <form
            method="post"
            action="/api/webhooks/feedback"
            className="cust-card animate-rise-in space-y-6 p-5 sm:p-7"
          >
            <input type="hidden" name="token" value={token} />
            <div>
              <span className="cust-icon">
                <MessageSquareHeart aria-hidden className="size-[1.375rem]" />
              </span>
              <h1 className="cust-title mt-4">{t('title')}</h1>
              <p className="mt-2 leading-relaxed text-secondary">{t('question')}</p>
            </div>
            <fieldset>
              <legend className="sr-only">{t('question')}</legend>
              <div className="cust-scores">
                {SCORES.map((s) => (
                  <label key={s} className="cust-score">
                    <input type="radio" name="rating" value={s} required className="sr-only" />
                    {formatNumber(s, locale as Locale)}
                  </label>
                ))}
              </div>
              <div aria-hidden className="cust-scale mt-3.5" />
              <div className="mt-2 flex justify-between text-xs text-muted">
                <span>{t('low')}</span>
                <span>{t('high')}</span>
              </div>
            </fieldset>
            <div>
              <Label htmlFor="fb-comment" className="cust-label">
                {t('comment')}
              </Label>
              <Textarea
                id="fb-comment"
                name="comment"
                rows={4}
                maxLength={1000}
                className="cust-field"
              />
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
