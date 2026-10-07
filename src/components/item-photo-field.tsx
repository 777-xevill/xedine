'use client';

import { Camera, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-browser';
import { setItemPhotoAction } from '@/modules/menu/photo-actions';

const BUCKET = 'menu-photos';
/** The longest side, in pixels. A till tile is never bigger than this, and the file stays around 30–60 KB. */
const MAX_EDGE = 640;

/** Shrink a phone photo to a small WebP (JPEG where the browser cannot write WebP) before it is uploaded. */
async function shrink(file: File): Promise<{ blob: Blob; ext: 'webp' | 'jpg' }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const toBlob = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.8));
  const webp = await toBlob('image/webp');
  if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp' };
  const jpeg = await toBlob('image/jpeg');
  if (!jpeg) throw new Error('no image');
  return { blob: jpeg, ext: 'jpg' };
}

/** Owner: add, replace or remove the photo a dish shows on the till (ADR 0031). */
export function ItemPhotoField({
  orgId,
  orgSlug,
  itemId,
  photoPath,
}: {
  orgId: string;
  orgSlug: string;
  itemId: string;
  photoPath: string | null;
}) {
  const t = useTranslations('menu');
  const input = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState(photoPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sb = createClient();
  const src = path ? sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null;

  const forget = (old: string | null) => {
    // The old file is orphaned once nothing points at it; failing to delete it only wastes a few KB.
    if (old) void sb.storage.from(BUCKET).remove([old]);
  };

  const choose = async (file: File) => {
    setBusy(true);
    setError(null);
    let uploaded: string | null = null;
    try {
      const { blob, ext } = await shrink(file);
      const next = `${orgId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await sb.storage.from(BUCKET).upload(next, blob, {
        contentType: blob.type,
        cacheControl: '31536000',
      });
      if (upErr) throw upErr;
      uploaded = next;
      const res = await setItemPhotoAction({ orgId, orgSlug, itemId, path: next });
      if (!res.ok) throw new Error(res.error);
      forget(path);
      setPath(next);
    } catch {
      forget(uploaded);
      setError(t('photoFailed'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    const res = await setItemPhotoAction({ orgId, orgSlug, itemId, path: null });
    if (res.ok) {
      forget(path);
      setPath(null);
    } else setError(t('photoFailed'));
    setBusy(false);
  };

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-secondary">{t('photoTitle')}</h3>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative size-20 shrink-0 overflow-hidden rounded-input bg-surface-elevated">
          {src ? (
            <Image src={src} alt="" fill unoptimized sizes="80px" className="object-cover" />
          ) : (
            <Camera aria-hidden className="absolute inset-0 m-auto size-6 text-muted" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/*"
            className="sr-only"
            id={`photo-${itemId}`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void choose(file);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Camera aria-hidden className="size-4" />
            {busy ? t('photoWorking') : path ? t('photoReplace') : t('photoAdd')}
          </Button>
          {path ? (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={remove}>
              <Trash2 aria-hidden className="size-4" />
              {t('photoRemove')}
            </Button>
          ) : null}
        </div>
      </div>
      <p className="mt-1 text-xs text-secondary">{t('photoHint')}</p>
      {error ? (
        <Alert tone="danger" className="mt-2">
          {error}
        </Alert>
      ) : null}
    </div>
  );
}
