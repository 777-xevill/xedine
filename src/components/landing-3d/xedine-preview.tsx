'use client';

import { Hand, MousePointerClick } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import type { XedineHandle } from './xedine';

const XedineStage = dynamic(() => import('./xedine-stage'), { ssr: false });

type Words = {
  title: string;
  hint: string;
  wave: string;
  point: string;
  loading: string;
  note: string;
};

/** The hidden look-test page for the 3D character (ADR 0064, approval 1). */
export function XedinePreview({ words }: { words: Words }) {
  const xedine = useRef<XedineHandle>(null);
  return (
    <main className="xedine-stage-bg relative h-dvh w-full overflow-hidden">
      <div className="absolute inset-0">
        <XedineStage xedine={xedine} />
      </div>
      <header className="pointer-events-none absolute inset-x-0 top-0 flex justify-center px-4 pt-6">
        <div className="xedine-chip pointer-events-auto max-w-xl rounded-2xl px-5 py-4 text-center">
          <h1 className="text-xl font-bold tracking-[-0.02em]">{words.title}</h1>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">{words.hint}</p>
        </div>
      </header>
      <footer className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-4 pb-6">
        <div className="flex gap-2">
          <Button onClick={() => xedine.current?.play('AN_Wave')}>
            <Hand aria-hidden className="size-4" />
            {words.wave}
          </Button>
          <Button variant="secondary" onClick={() => xedine.current?.play('AN_Point')}>
            <MousePointerClick aria-hidden className="size-4" />
            {words.point}
          </Button>
        </div>
        <p className="xedine-chip rounded-full px-3 py-1 text-xs">{words.note}</p>
      </footer>
    </main>
  );
}
