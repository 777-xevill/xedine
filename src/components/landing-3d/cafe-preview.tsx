'use client';

import { Hand, MousePointerClick } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import type { TillLine, TillWords } from './till-screen';
import type { XedineHandle } from './xedine';

const CafeStage = dynamic(() => import('./cafe-stage'), { ssr: false });

type Words = { title: string; hint: string; note: string; wave: string; point: string };

/** The hidden look test of one café corner, live in the browser (ADR 0064, approval 2). */
export function CafePreview({
  words,
  till,
  order,
  total,
}: {
  words: Words;
  till: TillWords;
  order: TillLine[];
  total: string;
}) {
  const xedine = useRef<XedineHandle>(null);
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-background">
      <div className="absolute inset-0">
        <CafeStage xedine={xedine} till={till} order={order} total={total} />
      </div>
      <header className="pointer-events-none absolute inset-x-0 top-0 flex justify-center px-4 pt-5">
        <div className="xedine-chip pointer-events-auto max-w-xl rounded-2xl px-5 py-3.5 text-center">
          <h1 className="text-lg font-bold tracking-[-0.02em]">{words.title}</h1>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">{words.hint}</p>
        </div>
      </header>
      <footer className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-4 pb-5">
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
