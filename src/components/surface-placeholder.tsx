import { getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';

/** Route-group shells for the surfaces built in later phases (ROADMAP Phase 0: "App shell with route groups"). */
export async function SurfacePlaceholder({
  titleKey,
  phase,
  bodyKey,
  dark = false,
}: {
  titleKey: 'posTitle' | 'kdsTitle' | 'qrTitle' | 'adminTitle';
  phase: number;
  bodyKey?: 'adminBody';
  dark?: boolean;
}) {
  const t = await getTranslations('surfaces');
  return (
    <div className={dark ? 'min-h-dvh bg-background' : 'min-h-dvh bg-background-secondary'}>
      <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-4 py-10">
        <div className="self-end">
          <LocaleSwitcher />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{t(titleKey)}</h1>
        <p className="text-secondary">{bodyKey ? t(bodyKey) : t('comingIn', { phase })}</p>
      </div>
    </div>
  );
}
