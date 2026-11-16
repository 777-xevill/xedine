'use client';

import { ImageUp, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/db/supabase-browser';
import { setDishHqPhotoAction } from '@/modules/social/actions';

const BUCKET = 'menu-photos';
/** The bucket takes files up to 512 KB; a big phone photo is shrunk until it fits. */
const MAX_BYTES = 500_000;

/** A JPEG/WebP no bigger than the bucket allows: 1600 px first, smaller and softer until it fits. */
async function shrink(file: File): Promise<{ blob: Blob; ext: 'webp' | 'jpg' }> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const [edge, quality] of [
      [1600, 0.85],
      [1400, 0.8],
      [1200, 0.75],
      [1000, 0.72],
    ] as const) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', quality),
      );
      const ok = blob && blob.type === 'image/webp' ? blob : null;
      const out =
        ok ??
        (await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/jpeg', quality),
        ));
      if (out && out.size <= MAX_BYTES) return { blob: out, ext: ok ? 'webp' : 'jpg' };
    }
    throw new Error('too big');
  } finally {
    bitmap.close();
  }
}

/**
 * Owner or manager: a bigger, clearer photo of a dish for posts and videos (ADR 0061). The till keeps its
 * small menu photo; the social job uses this one when there is one.
 */
export function DishHqPhotoField({
  orgId,
  orgSlug,
  itemId,
  path: initial,
}: {
  orgId: string;
  orgSlug: string;
  itemId: string;
  path: string | null;
}) {
  const t = useTranslations('social.video.photos');
  const input = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const sb = createClient();

  const choose = async (file: File) => {
    setBusy(true);
    setError(false);
    let uploaded: string | null = null;
    try {
      const { blob, ext } = await shrink(file);
      const next = `${orgId}/hq/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await sb.storage
        .from(BUCKET)
        .upload(next, blob, { contentType: blob.type, cacheControl: '31536000' });
      if (upErr) throw upErr;
      uploaded = next;
      const res = await setDishHqPhotoAction({ orgId, orgSlug, itemId, path: next });
      if (!res.ok) throw new Error(res.error);
      if (path) void sb.storage.from(BUCKET).remove([path]);
      setPath(next);
    } catch {
      if (uploaded) void sb.storage.from(BUCKET).remove([uploaded]);
      setError(true);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    const res = await setDishHqPhotoAction({ orgId, orgSlug, itemId, path: null });
    if (res.ok) {
      if (path) void sb.storage.from(BUCKET).remove([path]);
      setPath(null);
    } else setError(true);
    setBusy(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label={t('upload')}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void choose(file);
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        <ImageUp aria-hidden className="size-4" />
        {busy ? t('working') : path ? t('replace') : t('upload')}
      </Button>
      {path ? (
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={remove}>
          <Trash2 aria-hidden className="size-4" />
          {t('remove')}
        </Button>
      ) : null}
      {error ? <span className="text-sm text-danger">{t('failed')}</span> : null}
    </div>
  );
}
