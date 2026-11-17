import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { XedinePreview } from '@/components/landing-3d/xedine-preview';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Hidden look test of the 3D Xedine before the landing page's 3D day is built (ADR 0064). */
export default async function LandingPreviewPage() {
  const t = await getTranslations('landing3d.preview');
  return (
    <XedinePreview
      words={{
        title: t('title'),
        hint: t('hint'),
        wave: t('wave'),
        point: t('point'),
        loading: t('loading'),
        note: t('note'),
      }}
    />
  );
}
