'use client';

import { RotateCw } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/**
 * When a page fails to load (ADR 0063): a calm glass card in the workspace instead of a white error
 * screen, with "Try again". The sidebar stays, so every other page is one tap away.
 */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations('pageStates');
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <div
        role="alert"
        className="card-glass animate-[sheet-in_0.6s_var(--ease-spring)_both] w-full max-w-md rounded-sheet border p-8 text-center"
      >
        <Image
          src="/brand/logo-chef-192.png"
          alt=""
          width={64}
          height={64}
          className="mx-auto rounded-[24%] shadow-soft ring-1 ring-edge"
        />
        <h1 className="mt-5 text-xl font-bold tracking-[-0.02em]">{t('errorTitle')}</h1>
        <p className="mt-2 text-sm text-secondary">{t('errorBody')}</p>
        <Button onClick={() => retry()} className="mt-6">
          <RotateCw aria-hidden className="size-4" />
          {t('retry')}
        </Button>
      </div>
    </div>
  );
}
