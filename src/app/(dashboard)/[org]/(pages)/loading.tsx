import { getTranslations } from 'next-intl/server';

/**
 * Shown the moment a page is tapped, while its numbers load (ADR 0063): the shape of a page in grey
 * glass with a slow silver sheen, so the app answers at once instead of seeming to wait.
 */
export default async function Loading() {
  const t = await getTranslations('common');
  return (
    <div role="status" aria-busy="true" className="animate-[fade-in_0.4s_var(--ease-smooth)_both]">
      <span className="sr-only">{t('loading')}</span>
      <div className="mb-9 space-y-3">
        <div className="skeleton h-9 w-56 max-w-full rounded-xl" />
        <div className="skeleton h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-24 rounded-card" />
        ))}
      </div>
      <div className="skeleton mt-6 h-64 rounded-card" />
    </div>
  );
}
