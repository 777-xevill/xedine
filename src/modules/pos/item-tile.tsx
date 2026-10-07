'use client';

import { Image as ImageIcon } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';
import { formatBDT } from '@/lib/i18n/format';
import type { MenuItem } from './client';
import { itemUnitPrice } from './dialogs';
import { useTill } from './till-context';
import type { TillView } from './device-storage';

/** The public address of a dish photo (ADR 0031); null when the dish has none. */
function photoSrc(sb: ReturnType<typeof useTill>['sb'], path: string | null): string | null {
  if (!path) return null;
  return sb.storage.from('menu-photos').getPublicUrl(path).data.publicUrl;
}

/**
 * One dish on the till. `text` is the compact word-only tile; `photo` puts the picture above the words so
 * a cashier can tap by sight. A missing photo, or one that will not load (offline, deleted), falls back to
 * a plain placeholder — the dish stays sellable either way.
 */
export function ItemTile({
  item,
  label,
  view,
  onTap,
}: {
  item: MenuItem;
  label: string;
  view: TillView;
  onTap: () => void;
}) {
  const { sb, locale } = useTill();
  const [broken, setBroken] = useState(false);
  const src = view === 'photo' && !broken ? photoSrc(sb, item.photo_path) : null;
  const hasChoices = item.variants.length > 0 || item.modifier_groups.length > 0;
  const price = `${formatBDT(itemUnitPrice(item, null), locale)}${hasChoices ? ' +' : ''}`;

  if (view === 'text') {
    return (
      <button
        type="button"
        onClick={onTap}
        className="glass-tile flex min-h-20 flex-col items-start justify-between rounded-input p-3 text-start transition hover:border-purple active:scale-[0.98]"
      >
        <span className="text-sm leading-snug font-semibold">{label}</span>
        <span className="text-xs text-secondary tabular-nums">{price}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onTap}
      className="glass-tile flex flex-col overflow-hidden rounded-input text-start transition hover:border-purple active:scale-[0.98]"
    >
      <span className="relative block aspect-[4/3] w-full bg-surface-elevated">
        {src ? (
          // unoptimized: the file is already a small WebP, and this keeps the browser's own HTTP cache
          // in charge, which is what makes photos work on a flaky connection.
          <Image
            src={src}
            alt=""
            fill
            unoptimized
            sizes="(min-width: 1024px) 25vw, 50vw"
            onError={() => setBroken(true)}
            className="object-cover"
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-muted">
            <ImageIcon aria-hidden className="size-8" />
          </span>
        )}
      </span>
      <span className="flex flex-1 flex-col justify-between gap-1 p-2.5">
        <span className="text-sm leading-snug font-semibold">{label}</span>
        <span className="text-xs text-secondary tabular-nums">{price}</span>
      </span>
    </button>
  );
}
