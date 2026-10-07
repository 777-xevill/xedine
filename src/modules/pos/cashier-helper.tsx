'use client';

import { Mic, Minus, Plus, Sparkles, Square, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { useSpeech } from '@/components/use-speech';
import { Button } from '@/components/ui/button';
import { Alert, Textarea } from '@/components/ui/form';
import { formatBDT } from '@/lib/i18n/format';
import type { MenuCategory, MenuItem } from './client';
import { ItemPicker, itemUnitPrice, type PickedItem } from './dialogs';
import { cashierHelperAction } from './helper-actions';
import { helperMenu, type HelperLine } from './helper-lines';
import { useTill } from './till-context';

/** AI error codes (aiErrorKey) → the helper's own plain messages. */
const ERROR_KEY: Record<string, 'helperOff' | 'helperCap' | 'helperFailed'> = {
  aiNotConfigured: 'helperOff',
  aiNotInPlan: 'helperOff',
  aiCapExceeded: 'helperCap',
};

/**
 * "Quick order" (ADR 0031): the cashier types or dictates what the customer said; the AI proposes cart
 * lines; nothing enters the cart until the cashier taps Add. The AI picks dishes — prices are the till's
 * own, looked up here from the menu already on the device.
 */
export function CashierHelper({
  menu,
  onAdd,
  toolbar,
}: {
  menu: MenuCategory[];
  onAdd: (item: MenuItem, picked: PickedItem) => void;
  /** Shown at the end of the Quick order row (the till's Words/Photos switch). */
  toolbar?: ReactNode;
}) {
  const t = useTranslations('pos');
  const { device, locale, online } = useTill();
  const money = (p: number) => formatBDT(p, locale);
  const label = (x: { name: string; name_bn: string | null }) =>
    locale === 'bn' && x.name_bn ? x.name_bn : x.name;

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const speech = useSpeech(locale === 'bn' ? 'bn-BD' : 'en-US', (said) =>
    setText((prev) => `${prev}${prev ? ', ' : ''}${said}`.slice(0, 500)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<HelperLine[] | null>(null);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [choosing, setChoosing] = useState<number | null>(null);

  const itemsById = useMemo(
    () => new Map(menu.flatMap((c) => c.items).map((i) => [i.id, i])),
    [menu],
  );

  const toPicked = (item: MenuItem, line: HelperLine): PickedItem => {
    const variant = item.variants.find((v) => v.id === line.variantId) ?? null;
    const mods = item.modifier_groups
      .flatMap((g) => g.modifiers)
      .filter((m) => line.modifierIds.includes(m.id));
    return {
      variantId: line.variantId,
      variantName: variant ? label(variant) : null,
      modifierIds: mods.map((m) => m.id),
      modifiersLabel: mods.map(label).join(', '),
      unitPricePoisha:
        itemUnitPrice(item, line.variantId) + mods.reduce((s, m) => s + m.price_poisha, 0),
      note: line.note,
      quantity: line.quantity,
    };
  };

  const read = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await cashierHelperAction({
        orgId: device.orgId,
        text,
        menu: helperMenu(menu),
      });
      if (!res.ok) {
        setLines(null);
        setError(t(ERROR_KEY[res.error] ?? 'helperFailed'));
        return;
      }
      setLines(res.lines);
      setUnmatched(res.unmatched);
    } catch {
      // No connection, or the server could not be reached.
      setLines(null);
      setError(t('helperFailed'));
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    setLines(null);
    setUnmatched([]);
    setError(null);
    setText('');
  };

  const setQty = (index: number, delta: number) =>
    setLines((prev) =>
      prev
        ? prev.map((l, i) =>
            i === index ? { ...l, quantity: Math.min(99, Math.max(1, l.quantity + delta)) } : l,
          )
        : prev,
    );
  const removeAt = (index: number) =>
    setLines((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));

  const addComplete = () => {
    if (!lines) return;
    for (const line of lines) {
      const item = itemsById.get(line.menuItemId);
      if (item && !line.needsChoice) onAdd(item, toPicked(item, line));
    }
    const rest = lines.filter((l) => l.needsChoice);
    if (rest.length === 0 && unmatched.length === 0) clear();
    else setLines(rest);
  };

  const ready = lines?.filter((l) => !l.needsChoice).length ?? 0;
  const choosingLine = choosing !== null ? lines?.[choosing] : undefined;
  const choosingItem = choosingLine ? itemsById.get(choosingLine.menuItemId) : undefined;

  const bar = (
    <div className="mb-2 flex items-center justify-between gap-2">
      <Button variant="secondary" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Sparkles aria-hidden className="size-4" />
        {t('helperOpen')}
      </Button>
      {toolbar}
    </div>
  );

  if (!open) return bar;

  return (
    <>
      {bar}
      <div className="glass-tile mb-3 rounded-input p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{t('helperTitle')}</p>
            <Badge tone="info" icon={<Sparkles />}>
              {t('helperBadge')}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t('close')}
            onClick={() => setOpen(false)}
          >
            <X aria-hidden className="size-4" />
          </Button>
        </div>

        <Textarea
          rows={2}
          maxLength={500}
          value={text}
          aria-label={t('helperTitle')}
          placeholder={t('helperPlaceholder')}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy || !online || text.trim() === ''} onClick={read}>
            <Sparkles aria-hidden className="size-4" />
            {busy ? t('helperReading') : t('helperRead')}
          </Button>
          {speech.supported ? (
            <Button
              variant={speech.listening ? 'danger' : 'secondary'}
              size="sm"
              aria-pressed={speech.listening}
              disabled={!online}
              onClick={speech.toggle}
            >
              {speech.listening ? (
                <Square aria-hidden className="size-4" />
              ) : (
                <Mic aria-hidden className="size-4" />
              )}
              {speech.listening ? t('helperStop') : t('helperSpeak')}
            </Button>
          ) : null}
          {!online ? <span className="text-xs text-secondary">{t('helperOffline')}</span> : null}
          {lines || text ? (
            <Button variant="ghost" size="sm" onClick={clear}>
              {t('helperClear')}
            </Button>
          ) : null}
        </div>

        {error ? (
          <Alert tone="danger" className="mt-2">
            {error}
          </Alert>
        ) : null}

        {lines ? (
          <div className="mt-3 space-y-2">
            {lines.length === 0 ? (
              <p className="text-sm text-secondary">{t('helperEmpty')}</p>
            ) : null}
            <ul className="space-y-2">
              {lines.map((line, index) => {
                const item = itemsById.get(line.menuItemId);
                if (!item) return null;
                const picked = toPicked(item, line);
                return (
                  <li
                    key={`${line.menuItemId}-${index}`}
                    className="glass flex items-start gap-2 rounded-input p-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {label(item)}
                        {picked.variantName ? ` (${picked.variantName})` : ''}
                      </p>
                      {picked.modifiersLabel ? (
                        <p className="text-xs text-secondary">{picked.modifiersLabel}</p>
                      ) : null}
                      {line.note ? <p className="text-xs text-muted italic">{line.note}</p> : null}
                      {line.needsChoice ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="mt-1"
                          onClick={() => setChoosing(index)}
                        >
                          {t('helperChoose')}
                        </Button>
                      ) : (
                        <p className="text-xs text-muted tabular-nums">
                          {money(picked.unitPricePoisha)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="subtle"
                        size="icon"
                        className="size-9"
                        aria-label={t('less')}
                        onClick={() => setQty(index, -1)}
                      >
                        <Minus aria-hidden className="size-4" />
                      </Button>
                      <span className="w-6 text-center font-semibold tabular-nums">
                        {line.quantity}
                      </span>
                      <Button
                        variant="subtle"
                        size="icon"
                        className="size-9"
                        aria-label={t('more')}
                        onClick={() => setQty(index, 1)}
                      >
                        <Plus aria-hidden className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9"
                        aria-label={t('helperRemove')}
                        onClick={() => removeAt(index)}
                      >
                        <X aria-hidden className="size-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {unmatched.length > 0 ? (
              <Alert tone="warning">{t('helperNotFound', { items: unmatched.join(', ') })}</Alert>
            ) : null}
            {ready > 0 ? (
              <Button className="w-full" onClick={addComplete}>
                {t('helperAdd')}
              </Button>
            ) : null}
          </div>
        ) : null}

        {choosing !== null && choosingItem && choosingLine ? (
          <ItemPicker
            item={choosingItem}
            onClose={() => setChoosing(null)}
            onAdd={(picked) => {
              onAdd(choosingItem, {
                ...picked,
                quantity: picked.quantity * choosingLine.quantity,
                note: picked.note || choosingLine.note,
              });
              removeAt(choosing);
              setChoosing(null);
            }}
          />
        ) : null}
      </div>
    </>
  );
}
