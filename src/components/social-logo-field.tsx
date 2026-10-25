'use client';

import { ImagePlus, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/form';
import { createClient } from '@/lib/db/supabase-browser';
import { setSocialLogoAction } from '@/modules/social/actions';

const BUCKET = 'menu-photos';
const MAX_EDGE = 600;

/** Shrink to a WebP that keeps transparency (PNG where the browser cannot write WebP). */
async function shrink(file: File): Promise<{ blob: Blob; ext: 'webp' | 'png' }> {
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
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  const webp = await toBlob('image/webp');
  if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp' };
  const png = await toBlob('image/png');
  if (!png) throw new Error('no image');
  return { blob: png, ext: 'png' };
}

/** Owner: the logo printed on every autopilot poster and reel (ADR 0040). */
export function SocialLogoField({
  orgId,
  orgSlug,
  logoPath,
}: {
  orgId: string;
  orgSlug: string;
  logoPath: string | null;
}) {
  const t = useTranslations('social.settings');
  const input = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState(logoPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const sb = createClient();
  const src = path ? sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null;

  const choose = async (file: File) => {
    setBusy(true);
    setError(false);
    let uploaded: string | null = null;
    try {
      const { blob, ext } = await shrink(file);
      const next = `${orgId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await sb.storage
        .from(BUCKET)
        .upload(next, blob, { contentType: blob.type, cacheControl: '31536000' });
      if (upErr) throw upErr;
      uploaded = next;
      const res = await setSocialLogoAction({ orgId, orgSlug, path: next });
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
    const res = await setSocialLogoAction({ orgId, orgSlug, path: null });
    if (res.ok) {
      if (path) void sb.storage.from(BUCKET).remove([path]);
      setPath(null);
    } else setError(true);
    setBusy(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative size-20 shrink-0 overflow-hidden rounded-input bg-surface-elevated">
        {src ? (
          <Image src={src} alt="" fill unoptimized sizes="80px" className="object-contain p-1" />
        ) : (
          <ImagePlus aria-hidden className="absolute inset-0 m-auto size-6 text-muted" />
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        id="social-logo"
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
        <ImagePlus aria-hidden className="size-4" />
        {busy ? t('logoWorking') : path ? t('logoReplace') : t('logoAdd')}
      </Button>
      {path ? (
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={remove}>
          <Trash2 aria-hidden className="size-4" />
          {t('logoRemove')}
        </Button>
      ) : null}
      {error ? (
        <Alert tone="danger" className="w-full">
          {t('logoFailed')}
        </Alert>
      ) : null}
    </div>
  );
}
