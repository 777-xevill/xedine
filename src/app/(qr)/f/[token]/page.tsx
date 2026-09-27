import { getLocale, getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Button } from '@/components/ui/button';
import { Label, Textarea } from '@/components/ui/form';
import { formatNumber, type Locale } from '@/lib/i18n/format';

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
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-4 py-10">
      <div className="self-end">
        <LocaleSwitcher />
      </div>
      <div className="glass rounded-sheet p-6 sm:p-8">
        {done ? (
          <>
            <h1 className="text-2xl font-extrabold tracking-tight">{t(`${done}Title`)}</h1>
            <p className="mt-2 text-secondary">{t(`${done}Body`)}</p>
          </>
        ) : (
          <form method="post" action="/api/webhooks/feedback" className="space-y-5">
            <input type="hidden" name="token" value={token} />
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
              <p className="mt-2 text-secondary">{t('question')}</p>
            </div>
            <fieldset>
              <legend className="sr-only">{t('question')}</legend>
              <div className="grid grid-cols-6 gap-2 sm:grid-cols-11">
                {SCORES.map((s) => (
                  <label
                    key={s}
                    className="glass-tile flex min-h-11 cursor-pointer items-center justify-center rounded-input text-sm font-semibold tabular-nums has-[:checked]:border has-[:checked]:border-purple"
                  >
                    <input type="radio" name="rating" value={s} required className="sr-only" />
                    {formatNumber(s, locale as Locale)}
                  </label>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-xs text-secondary">
                <span>{t('low')}</span>
                <span>{t('high')}</span>
              </div>
            </fieldset>
            <div>
              <Label htmlFor="fb-comment">{t('comment')}</Label>
              <Textarea id="fb-comment" name="comment" rows={4} maxLength={1000} />
            </div>
            <Button type="submit" className="w-full">
              {t('send')}
            </Button>
            <p className="text-xs text-secondary">{t('privacy')}</p>
          </form>
        )}
      </div>
    </div>
  );
}
