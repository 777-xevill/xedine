'use client';

import { Plus } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';
import { formatMoney } from '@/lib/i18n/format';
import { tillPlace } from './till-place';
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
 * The tile's corner: a quiet "+" until the dish is in the cart, then how many are in it (yellow, and
 * it pops when the number changes). Decoration only: the cart itself is the record.
 */
function CountMark({ count, className = '' }: { count: number; className?: string }) {
  return (
    <span aria-hidden className={`till-mark ${className}`}>
      {count > 0 ? (
        <span key={count} className="till-pop">
          {count}
        </span>
      ) : (
        <Plus className="size-3.5" />
      )}
    </span>
  );
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
  inCart = 0,
  onTap,
}: {
  item: MenuItem;
  label: string;
  view: TillView;
  /** How many of this dish the cart holds now (all sizes together): rings the tile in yellow. */
  inCart?: number;
  onTap: () => void;
}) {
  const { sb, locale } = useTill();
  const [broken, setBroken] = useState(false);
  const src = view === 'photo' && !broken ? photoSrc(sb, item.photo_path) : null;
  const hasChoices = item.variants.length > 0 || item.modifier_groups.length > 0;
  const price = `${formatMoney(itemUnitPrice(item, null), locale, tillPlace().currency)}${hasChoices ? ' +' : ''}`;
  const selected = inCart > 0;

  if (view === 'text') {
    return (
      <button
        type="button"
        onClick={onTap}
        data-selected={selected}
        className="till-tile flex min-h-[5.75rem] flex-col justify-between gap-2 rounded-[1.125rem] p-3.5 text-start"
      >
        <span className="text-[0.9375rem] leading-snug font-semibold text-foreground">{label}</span>
        <span className="flex w-full items-end justify-between gap-2">
          <span className="text-sm font-medium text-secondary tabular-nums">{price}</span>
          <CountMark count={inCart} />
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onTap}
      data-selected={selected}
      className="till-tile flex flex-col overflow-hidden rounded-[1.125rem] text-start"
    >
      <span className="relative block aspect-[4/3] w-full overflow-hidden bg-surface-hover">
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
          <span
            aria-hidden
            className="till-monogram absolute inset-0 flex items-center justify-center text-5xl font-bold tracking-tight"
          >
            {Array.from(label.trim())[0] ?? ''}
          </span>
        )}
        <CountMark count={inCart} className="absolute end-2 top-2" />
      </span>
      <span className="flex flex-1 flex-col justify-between gap-1 px-3 pt-2.5 pb-3">
        <span className="text-[0.9375rem] leading-snug font-semibold text-foreground">{label}</span>
        <span className="text-sm font-medium text-secondary tabular-nums">{price}</span>
      </span>
    </button>
  );
}
