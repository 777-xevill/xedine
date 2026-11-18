'use client';

import { ImagePlus, Loader2, Sparkles, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Hint } from '@/components/ui/form';
import { DEFAULT_LOCALE, formatNumber, isLocale } from '@/lib/i18n/format';
import { readMenuPageAction, saveMenuReadingAction } from '@/modules/menu/import-actions';

const MAX_PHOTOS = 8;
/** Long enough an edge for small print to stay sharp; one page comes to about 300–700 KB. */
const MAX_EDGE = 2000;

/** A phone photo shrunk to a JPEG the AI reads as well as the original, so eight pages fit one upload. */
async function shrink(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.86),
  );
  if (!blob) throw new Error('no image');
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

type Page = { file: File; url: string };

/**
 * Setup → "Read your menu from photos": one photo per page (up to eight), in order. The AI reads each page
 * into categories and dishes and the owner lands on the review page; nothing is added before that.
 */
export function MenuPhotoForm({
  orgId,
  orgSlug,
  enabled,
}: {
  orgId: string;
  orgSlug: string;
  enabled: boolean;
}) {
  const t = useTranslations();
  const raw = useLocale();
  const n = (v: number) => formatNumber(v, isLocale(raw) ? raw : DEFAULT_LOCALE);
  const [error, setError] = useState<{ key: string; data?: Record<string, string> } | null>(null);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<{ page: number; waiting: boolean } | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  async function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setBad(false);
    const room = MAX_PHOTOS - pages.length;
    const next: Page[] = [];
    for (const f of Array.from(files).slice(0, room)) {
      try {
        const file = await shrink(f);
        const url = URL.createObjectURL(file);
        urls.current.push(url);
        next.push({ file, url });
      } catch {
        setBad(true);
      }
    }
    setPages((p) => [...p, ...next]);
    setBusy(false);
    if (input.current) input.current.value = '';
  }

  function remove(i: number) {
    setPages((p) => p.filter((_, j) => j !== i));
  }

  /**
   * The pages go one by one: each request stays short, and when the free AI says "too many this minute"
   * the form waits and tries that page again (up to three times) instead of failing the whole menu.
   */
  async function submit() {
    setPending(true);
    setError(null);
    const read: string[][] = [];
    let unread = 0;
    let model = '';
    let v = '';
    let lastError: { key: string; data?: Record<string, string> } | null = null;
    for (const [i, p] of pages.entries()) {
      let lines: string[] | null = null;
      for (let attempt = 0; attempt < 4 && lines === null; attempt++) {
        setProgress({ page: i + 1, waiting: attempt > 0 });
        if (attempt > 0) await new Promise((r) => setTimeout(r, 20_000));
        const fd = new FormData();
        fd.set('orgId', orgId);
        fd.set('orgSlug', orgSlug);
        fd.set('page', String(i + 1));
        fd.set('pages', String(pages.length));
        fd.set('photo', p.file);
        let res;
        try {
          res = await readMenuPageAction(fd);
        } catch {
          res = { error: 'aiFailed', data: { busy: '1' } };
        }
        if (res.ok && res.data?.lines) {
          lines = JSON.parse(res.data.lines) as string[];
          model = res.data.model ?? model;
          v = res.data.v ?? v;
        } else {
          lastError = { key: res.error ?? 'aiFailed', data: res.data };
          // Only a busy AI is worth waiting for; a wrong photo or a missing key is not.
          if (res.data?.busy !== '1' && res.error !== 'aiFailed') break;
        }
      }
      if (lines === null) unread++;
      read.push(lines ?? []);
    }
    setProgress(null);
    if (unread === pages.length) {
      setError(lastError ?? { key: 'aiFailed' });
      setPending(false);
      return;
    }
    const fd = new FormData();
    fd.set('orgId', orgId);
    fd.set('orgSlug', orgSlug);
    fd.set('pages', JSON.stringify(read));
    fd.set('unread', String(unread));
    fd.set('model', model);
    fd.set('v', v);
    // On success the action opens the review page.
    const res = await saveMenuReadingAction(fd).catch(() => null);
    if (res?.error) setError({ key: res.error, data: res.data });
    setPending(false);
  }

  const working = pending || busy;
  return (
    <div className="space-y-4" aria-busy={working}>
      {error ? <Alert tone="danger">{t(`errors.${error.key}`, error.data)}</Alert> : null}
      {bad ? <Alert tone="danger">{t('errors.photoInvalid')}</Alert> : null}
      <ol className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {pages.map((p, i) => (
          <li
            key={p.url}
            className="relative aspect-[3/4] overflow-hidden rounded-input border border-edge bg-surface-elevated"
          >
            {/* A local preview of the user's own photo: next/image cannot optimise a blob: URL. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" className="size-full object-cover" />
            <span className="absolute top-1.5 left-1.5 rounded-full bg-surface px-2 py-0.5 text-[11px] font-bold">
              {t('setup.menuPhotos.page', { n: n(i + 1) })}
            </span>
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={pending}
              aria-label={t('setup.menuPhotos.remove', { n: n(i + 1) })}
              className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-surface text-foreground hover:text-warning"
            >
              <X aria-hidden className="size-4" />
            </button>
          </li>
        ))}
        {pages.length < MAX_PHOTOS ? (
          <li>
            <label
              className={`flex aspect-[3/4] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-input border border-dashed border-edge-strong p-2 text-center text-xs font-semibold text-secondary transition-colors hover:border-warning hover:text-foreground ${!enabled || pending ? 'pointer-events-none opacity-50' : ''}`}
            >
              {busy ? (
                <Loader2 aria-hidden className="size-6 animate-spin" />
              ) : (
                <ImagePlus aria-hidden className="size-6" />
              )}
              {pages.length === 0 ? t('setup.menuPhotos.add') : t('setup.menuPhotos.addMore')}
              <input
                ref={input}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="sr-only"
                disabled={!enabled || pending}
                onChange={(e) => void add(e.target.files)}
              />
            </label>
          </li>
        ) : null}
      </ol>
      <Button
        type="button"
        onClick={() => void submit()}
        disabled={!enabled || working || pages.length === 0}
      >
        {pending ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <Sparkles aria-hidden className="size-4" />
        )}
        {progress
          ? t('setup.menuPhotos.reading', { page: n(progress.page), n: n(pages.length) })
          : pending
            ? t('setup.menuPhotos.saving')
            : pages.length === 0
              ? t('setup.menuPhotos.readNone')
              : t('setup.menuPhotos.read', { n: n(pages.length) })}
      </Button>
      {progress?.waiting ? (
        <p role="status" className="text-sm font-semibold text-warning">
          {t('setup.menuPhotos.waitingAi')}
        </p>
      ) : null}
      <Hint>{enabled ? t('setup.menuPhotos.hint') : t('setup.aiOff')}</Hint>
    </div>
  );
}
