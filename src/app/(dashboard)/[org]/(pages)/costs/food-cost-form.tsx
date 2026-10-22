'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label } from '@/components/ui/form';
import { formatNumber, type Locale } from '@/lib/i18n/format';
import { setAssumedFoodCostAction } from '@/modules/costs/actions';

const PRESETS = [30, 35, 40, 45] as const;

/**
 * The food-cost guess as plain words: pick a common share or type your own, and a live sentence
 * shows what it means on every ৳100 sold. Illustration only; the saved value is the percentage.
 */
export function FoodCostForm({
  orgId,
  orgSlug,
  currentPct,
}: {
  orgId: string;
  orgSlug: string;
  currentPct: number | null;
}) {
  const t = useTranslations('costs');
  const loc = useLocale() as Locale;
  const [value, setValue] = useState(currentPct != null ? String(currentPct) : '');
  const pct = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(pct) && pct >= 0 && pct <= 100;

  return (
    <ActionForm
      action={setAssumedFoodCostAction}
      successKey="common.saved"
      className="grid max-w-xl gap-4"
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <div>
        <p className="mb-2 text-sm font-semibold">{t('foodCostPick')}</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={valid && pct === p ? 'primary' : 'secondary'}
              aria-pressed={valid && pct === p}
              onClick={() => setValue(String(p))}
            >
              {`৳${formatNumber(p, loc)}`}
            </Button>
          ))}
        </div>
      </div>
      <div>
        <Label htmlFor="pct">{t('foodCostPct')}</Label>
        <Input
          id="pct"
          name="pct"
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step="0.1"
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-32"
        />
        <Hint className="mt-1">{t('foodCostTip')}</Hint>
      </div>
      {valid ? (
        <p className="glass-tile rounded-input p-3 text-sm" aria-live="polite">
          {t('foodCostExample', {
            cost: formatNumber(pct, loc, { fractionDigits: Number.isInteger(pct) ? 0 : 1 }),
            left: formatNumber(100 - pct, loc, { fractionDigits: Number.isInteger(pct) ? 0 : 1 }),
          })}
        </p>
      ) : null}
      <div>
        <Button type="submit">{t('save')}</Button>
      </div>
    </ActionForm>
  );
}
