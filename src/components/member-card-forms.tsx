'use client';

import { useTranslations } from 'next-intl';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label, Select } from '@/components/ui/form';
import {
  adjustPointsAction,
  resetMemberCardAction,
  saveMemberRulesAction,
} from '@/modules/customers/member-actions';

export interface MemberRules {
  isOn: boolean;
  earnPoints: string;
  earnEvery: string;
  pointValue: string;
  minRedeem: string;
  discountOn: boolean;
  discountPercent: string;
}

function Switch({
  name,
  label,
  hint,
  on,
}: {
  name: string;
  label: string;
  hint: string;
  on: boolean;
}) {
  return (
    <label className="flex items-start gap-3 rounded-input border border-line p-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={on}
        className="mt-0.5 size-5 shrink-0 accent-purple"
      />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-sm text-secondary">{hint}</span>
      </span>
    </label>
  );
}

/** The owner's rules: card on/off, how points are earned and what they are worth, member discount. */
export function MemberRulesForm({
  orgId,
  orgSlug,
  rules,
}: {
  orgId: string;
  orgSlug: string;
  rules: MemberRules;
}) {
  const t = useTranslations('memberSettings');
  return (
    <ActionForm action={saveMemberRulesAction} successKey="common.saved" className="space-y-5">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <Switch name="isOn" label={t('isOn')} hint={t('isOnHint')} on={rules.isOn} />

      <fieldset className="space-y-3">
        <legend className="mb-1 font-semibold">{t('pointsTitle')}</legend>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <div className="w-24">
            <Label htmlFor="mc-earn">{t('give')}</Label>
            <Input
              id="mc-earn"
              name="earnPoints"
              inputMode="numeric"
              required
              defaultValue={rules.earnPoints}
            />
          </div>
          <span className="pb-2.5">{t('pointsForEvery')}</span>
          <div className="w-32">
            <Label htmlFor="mc-every">{t('takaOnBill')}</Label>
            <Input
              id="mc-every"
              name="earnEvery"
              inputMode="decimal"
              required
              defaultValue={rules.earnEvery}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="mc-value">{t('pointValue')}</Label>
            <Input
              id="mc-value"
              name="pointValue"
              inputMode="decimal"
              required
              defaultValue={rules.pointValue}
            />
            <Hint>{t('pointValueHint')}</Hint>
          </div>
          <div>
            <Label htmlFor="mc-min">{t('minRedeem')}</Label>
            <Input
              id="mc-min"
              name="minRedeem"
              inputMode="numeric"
              required
              defaultValue={rules.minRedeem}
            />
            <Hint>{t('minRedeemHint')}</Hint>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 font-semibold">{t('discountTitle')}</legend>
        <Switch
          name="discountOn"
          label={t('discountOn')}
          hint={t('discountOnHint')}
          on={rules.discountOn}
        />
        <div className="w-40">
          <Label htmlFor="mc-pct">{t('discountPercent')}</Label>
          <Input
            id="mc-pct"
            name="discountPercent"
            inputMode="decimal"
            required
            defaultValue={rules.discountPercent}
          />
        </div>
      </fieldset>

      <Button type="submit">{t('save')}</Button>
    </ActionForm>
  );
}

/** Give or take away points by hand; a reason is required and the change is audited. */
export function AdjustPointsForm({
  orgId,
  orgSlug,
  customerId,
}: {
  orgId: string;
  orgSlug: string;
  customerId: string;
}) {
  const t = useTranslations('memberSettings');
  const id = customerId.slice(0, 8);
  return (
    <ActionForm
      action={adjustPointsAction}
      successKey="memberSettings.adjusted"
      className="grid gap-2 sm:grid-cols-[8rem_7rem_minmax(0,1fr)_auto] sm:items-end"
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="customerId" value={customerId} />
      <div>
        <Label htmlFor={`adj-dir-${id}`}>{t('change')}</Label>
        <Select id={`adj-dir-${id}`} name="direction" defaultValue="add">
          <option value="add">{t('add')}</option>
          <option value="remove">{t('remove')}</option>
        </Select>
      </div>
      <div>
        <Label htmlFor={`adj-pts-${id}`}>{t('points')}</Label>
        <Input id={`adj-pts-${id}`} name="points" inputMode="numeric" required maxLength={7} />
      </div>
      <div>
        <Label htmlFor={`adj-note-${id}`}>{t('reason')}</Label>
        <Input
          id={`adj-note-${id}`}
          name="note"
          required
          maxLength={200}
          placeholder={t('reasonPlaceholder')}
        />
      </div>
      <Button type="submit" variant="secondary">
        {t('apply')}
      </Button>
    </ActionForm>
  );
}

/** A new card link (the old one stops working), or the first one for a customer who has none. */
export function ResetCardButton({
  orgId,
  orgSlug,
  customerId,
  hasCard,
}: {
  orgId: string;
  orgSlug: string;
  customerId: string;
  hasCard: boolean;
}) {
  const t = useTranslations('memberSettings');
  return (
    <form
      action={resetMemberCardAction}
      onSubmit={(e) => {
        if (hasCard && !window.confirm(t('resetConfirm'))) e.preventDefault();
      }}
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="customerId" value={customerId} />
      <Button type="submit" variant="ghost" size="sm">
        {hasCard ? t('newLink') : t('makeLink')}
      </Button>
    </form>
  );
}
