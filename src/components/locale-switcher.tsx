import { getLocale, getTranslations } from 'next-intl/server';
import { setLocaleAction } from '@/modules/tenancy/actions';
import { cn } from '@/lib/utils';

/** Server component: two plain form buttons, no client JavaScript needed. */
export async function LocaleSwitcher({ className }: { className?: string }) {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('common')]);
  const option = (value: 'bn' | 'en', label: string) => (
    <form action={setLocaleAction}>
      <input type="hidden" name="locale" value={value} />
      <button
        type="submit"
        lang={value}
        aria-pressed={locale === value}
        className={cn(
          'min-h-9 rounded-input px-3 text-sm transition',
          locale === value
            ? 'bg-surface-elevated text-foreground'
            : 'text-secondary hover:text-foreground',
        )}
      >
        {label}
      </button>
    </form>
  );
  return (
    <div
      role="group"
      aria-label={t('language')}
      className={cn('flex items-center gap-1', className)}
    >
      {option('bn', t('bangla'))}
      {option('en', t('english'))}
    </div>
  );
}
