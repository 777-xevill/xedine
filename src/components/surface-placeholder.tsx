import { getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/locale-switcher';

/** Shells for surfaces that are not built yet (admin; optional QR table ordering). */
export async function SurfacePlaceholder({
  titleKey,
  bodyKey,
}: {
  titleKey: 'qrTitle' | 'adminTitle';
  bodyKey: 'adminBody' | 'qrBody';
}) {
  const t = await getTranslations('surfaces');
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-4 py-10">
      <div className="self-end">
        <LocaleSwitcher />
      </div>
      <div className="glass rounded-sheet p-8">
        <h1 className="text-3xl font-extrabold tracking-tight">{t(titleKey)}</h1>
        <p className="mt-2 text-secondary">{t(bodyKey)}</p>
      </div>
    </div>
  );
}
