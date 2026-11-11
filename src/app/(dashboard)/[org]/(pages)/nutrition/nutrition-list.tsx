'use client';

import { ChevronDown, Sparkles, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import * as React from 'react';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Hint, Input, Label } from '@/components/ui/form';
import { formatNumber, type Locale } from '@/lib/i18n/format';
import { cn } from '@/lib/utils';
import { ALLERGENS, type Allergen } from '@/modules/menu/food-facts';
import {
  approveAllGuessesAction,
  approveNutritionAction,
  clearNutritionAction,
  fillNutritionAction,
} from '@/modules/menu/nutrition-actions';

export interface NutritionDish {
  id: string;
  /** In the reader's language. */
  name: string;
  facts: {
    kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    allergens: Allergen[];
    approved: boolean;
  } | null;
}

const rank = (d: NutritionDish) => (!d.facts ? 1 : d.facts.approved ? 2 : 0);

/**
 * Every dish with its food facts (ADR 0049). AI guesses waiting for a check come first, then dishes with
 * nothing yet, then approved ones — so the page is a to-do list until it is done.
 */
export function NutritionList({
  orgId,
  orgSlug,
  dishes,
  aiReady,
}: {
  orgId: string;
  orgSlug: string;
  dishes: NutritionDish[];
  aiReady: boolean;
}) {
  const t = useTranslations('nutrition');
  const te = useTranslations('errors');
  const loc = useLocale() as Locale;
  const [busy, setBusy] = React.useState<'fill' | 'all' | null>(null);
  const [note, setNote] = React.useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);

  const sorted = [...dishes].sort((a, b) => rank(a) - rank(b));
  const approved = dishes.filter((d) => d.facts?.approved).length;
  const waiting = dishes.filter((d) => d.facts && !d.facts.approved).length;
  const none = dishes.length - approved - waiting;
  const n = (v: number) => formatNumber(v, loc);

  async function fill() {
    setBusy('fill');
    setNote(null);
    const res = await fillNutritionAction({ orgId, orgSlug });
    setBusy(null);
    if (res.ok)
      setNote({ tone: 'success', text: t('filled', { n: n(res.count), left: n(res.left) }) });
    else setNote({ tone: 'danger', text: te(res.error) });
  }

  async function approveAll() {
    setBusy('all');
    setNote(null);
    const res = await approveAllGuessesAction({ orgId, orgSlug });
    setBusy(null);
    if (res.ok) setNote({ tone: 'success', text: t('approvedAll', { n: n(res.count) }) });
    else setNote({ tone: 'danger', text: te(res.error) });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold">
        {t('counts', { approved: n(approved), waiting: n(waiting), none: n(none) })}
      </p>
      <div className="flex flex-wrap gap-2">
        {aiReady && none > 0 ? (
          <Button onClick={fill} disabled={busy !== null}>
            <Sparkles aria-hidden className="size-4" />
            {busy === 'fill' ? t('filling') : t('fill')}
          </Button>
        ) : null}
        {waiting > 0 ? (
          <Button variant="secondary" onClick={approveAll} disabled={busy !== null}>
            {busy === 'all' ? t('saving') : t('approveAll', { n: n(waiting) })}
          </Button>
        ) : null}
      </div>
      {!aiReady ? <Hint>{t('aiOff')}</Hint> : <Hint>{t('fillHint')}</Hint>}
      {note ? <Alert tone={note.tone}>{note.text}</Alert> : null}

      <ul className="divide-y divide-line">
        {sorted.map((d) => (
          <DishRow
            // A new guess or a save on the server remounts the row with the new values.
            key={`${d.id}:${JSON.stringify(d.facts)}`}
            dish={d}
            open={open === d.id}
            onToggle={() => setOpen(open === d.id ? null : d.id)}
            orgId={orgId}
            orgSlug={orgSlug}
            aiReady={aiReady}
          />
        ))}
      </ul>
    </div>
  );
}

function DishRow({
  dish,
  open,
  onToggle,
  orgId,
  orgSlug,
  aiReady,
}: {
  dish: NutritionDish;
  open: boolean;
  onToggle: () => void;
  orgId: string;
  orgSlug: string;
  aiReady: boolean;
}) {
  const t = useTranslations('nutrition');
  const ta = useTranslations('allergens');
  const te = useTranslations('errors');
  const loc = useLocale() as Locale;
  const f = dish.facts;
  const [kcal, setKcal] = React.useState(f ? String(f.kcal) : '');
  const [protein, setProtein] = React.useState(f ? String(f.protein_g) : '');
  const [carbs, setCarbs] = React.useState(f ? String(f.carbs_g) : '');
  const [fat, setFat] = React.useState(f ? String(f.fat_g) : '');
  const [allergens, setAllergens] = React.useState<Allergen[]>(f?.allergens ?? []);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const run = async (task: () => Promise<{ ok?: boolean; error?: string }>) => {
    setBusy(true);
    setError(null);
    const res = await task();
    setBusy(false);
    if (!res.ok) setError(te(res.error ?? 'generic'));
  };

  const approve = () =>
    run(() =>
      approveNutritionAction({
        orgId,
        orgSlug,
        itemId: dish.id,
        kcal: Number(kcal),
        protein_g: Number(protein),
        carbs_g: Number(carbs),
        fat_g: Number(fat),
        allergens,
      }),
    );
  const askAgain = () => run(() => fillNutritionAction({ orgId, orgSlug, itemIds: [dish.id] }));
  const clear = () => run(() => clearNutritionAction({ orgId, orgSlug, itemId: dish.id }));
  const complete = [kcal, protein, carbs, fat].every(
    (v) => v.trim() !== '' && Number.isFinite(Number(v)),
  );

  return (
    <li className="py-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center gap-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{dish.name}</span>
          {f ? (
            <span className="block text-sm text-secondary tabular-nums">
              {t('summary', {
                kcal: formatNumber(f.kcal, loc),
                protein: formatNumber(f.protein_g, loc, {
                  fractionDigits: f.protein_g % 1 ? 1 : 0,
                }),
              })}
            </span>
          ) : null}
        </span>
        {f?.approved ? (
          <StatusBadge tone="success">{t('statusApproved')}</StatusBadge>
        ) : f ? (
          <StatusBadge tone="warning">{t('statusGuess')}</StatusBadge>
        ) : (
          <StatusBadge tone="neutral">{t('statusNone')}</StatusBadge>
        )}
        <ChevronDown
          aria-hidden
          className={cn('size-5 shrink-0 text-secondary transition', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <div className="glass-tile mt-2 space-y-3 rounded-input p-3.5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ['kcal', kcal, setKcal, '1'],
                ['protein', protein, setProtein, '0.1'],
                ['carbs', carbs, setCarbs, '0.1'],
                ['fat', fat, setFat, '0.1'],
              ] as const
            ).map(([key, value, set, step]) => (
              <div key={key}>
                <Label htmlFor={`${dish.id}-${key}`}>{t(key)}</Label>
                <Input
                  id={`${dish.id}-${key}`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={step}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                />
              </div>
            ))}
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{t('allergens')}</legend>
            <div className="flex flex-wrap gap-2">
              {ALLERGENS.map((a) => {
                const on = allergens.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setAllergens(on ? allergens.filter((x) => x !== a) : [...allergens, a])
                    }
                    className={cn(
                      'min-h-9 rounded-full border px-3 text-sm font-medium',
                      on
                        ? 'border-warning/40 bg-warning/10 text-warning'
                        : 'border-line bg-surface text-secondary',
                    )}
                  >
                    {ta(a)}
                  </button>
                );
              })}
            </div>
          </fieldset>
          {f && !f.approved ? <Hint>{t('guessHint')}</Hint> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={approve} disabled={busy || !complete}>
              {busy ? t('saving') : t('approve')}
            </Button>
            {aiReady && !f?.approved ? (
              <Button variant="secondary" onClick={askAgain} disabled={busy}>
                <Sparkles aria-hidden className="size-4" />
                {f ? t('askAgain') : t('askAi')}
              </Button>
            ) : null}
            {f ? (
              <Button variant="ghost" onClick={clear} disabled={busy}>
                <Trash2 aria-hidden className="size-4" />
                {t('clear')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}
