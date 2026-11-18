'use client';

import { ImagePlus, Loader2, Sparkles, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Hint } from '@/components/ui/form';
import { DEFAULT_LOCALE, formatNumber, isLocale } from '@/lib/i18n/format';
import { readMenuPhotoAction } from '@/modules/menu/import-actions';
import { initialState } from '@/modules/tenancy/form-state';

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
  const [state, action, pending] = useActionState(readMenuPhotoAction, initialState);
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

  function submit() {
    const fd = new FormData();
    fd.set('orgId', orgId);
    fd.set('orgSlug', orgSlug);
    for (const p of pages) fd.append('photo', p.file);
    startTransition(() => action(fd));
  }

  const working = pending || busy;
  return (
    <div className="space-y-4" aria-busy={working}>
      {state.error ? <Alert tone="danger">{t(`errors.${state.error}`, state.data)}</Alert> : null}
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
      <Button type="button" onClick={submit} disabled={!enabled || working || pages.length === 0}>
        {pending ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <Sparkles aria-hidden className="size-4" />
        )}
        {pending
          ? t('setup.menuPhotos.reading', { n: n(pages.length) })
          : t('setup.menuPhotos.read', { n: n(pages.length) })}
      </Button>
      <Hint>{enabled ? t('setup.menuPhotos.hint') : t('setup.aiOff')}</Hint>
    </div>
  );
}
