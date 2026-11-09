import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/form';
import { COMPLAINT_TOPICS } from '@/modules/reviews/complaint-link';
import { readComplaintLink } from '@/modules/reviews/complaint-link-view';

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

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
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-4 py-6">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {link ? (
            <>
              <p className="truncate text-lg font-bold">{link.restaurant}</p>
              <p className="truncate text-sm text-secondary">{link.branch}</p>
            </>
          ) : null}
        </div>
        <LocaleSwitcher />
      </header>
      <div className="glass rounded-sheet p-6 sm:p-8">
        {message ? (
          <>
            <h1 className="text-2xl font-extrabold tracking-tight">{t(`${message}Title`)}</h1>
            <p className="mt-2 text-secondary">{t(`${message}Body`)}</p>
            {message === 'failed' ? (
              <a
                href={`/c/${token}`}
                className="mt-3 inline-block font-medium text-purple underline"
              >
                {t('tryAgain')}
              </a>
            ) : null}
          </>
        ) : (
          <form method="post" action="/api/webhooks/complaint" className="space-y-5">
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
              <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
              <p className="mt-2 text-secondary">{t('intro')}</p>
            </div>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">{t('topic')}</legend>
              <div className="grid grid-cols-2 gap-2">
                {COMPLAINT_TOPICS.map((v) => (
                  <label
                    key={v}
                    className="glass-tile flex min-h-11 cursor-pointer items-center gap-2 rounded-input px-3 py-2 text-sm has-checked:border-purple"
                  >
                    <input type="radio" name="topic" value={v} defaultChecked={v === 'food'} />
                    {t(`topics.${v}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <Label htmlFor="c-text">{t('what')}</Label>
              <Textarea
                id="c-text"
                name="text"
                rows={4}
                required
                minLength={3}
                maxLength={1000}
                placeholder={t('example')}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="c-name">{t('name')}</Label>
                <Input id="c-name" name="name" maxLength={120} autoComplete="name" />
              </div>
              <div>
                <Label htmlFor="c-phone">{t('phone')}</Label>
                <Input id="c-phone" name="phone" type="tel" maxLength={30} autoComplete="tel" />
              </div>
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
