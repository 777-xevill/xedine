'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { ErrorAlert } from '@/components/auth-forms';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/form';
import {
  createStationAction,
  createTableAction,
  setBranchPriceAction,
} from '@/modules/branch/actions';
import { initialState } from '@/modules/tenancy/form-state';

export function TableForm({
  orgId,
  orgSlug,
  branchId,
}: {
  orgId: string;
  orgSlug: string;
  branchId: string;
}) {
  const t = useTranslations('branch');
  return (
    <ActionForm action={createTableAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="branchId" value={branchId} />
      <div>
        <Label htmlFor="table-name">{t('tableName')}</Label>
        <Input id="table-name" name="name" required maxLength={40} className="w-32" />
      </div>
      <div>
        <Label htmlFor="table-seats">{t('seats')}</Label>
        <Input id="table-seats" name="seats" type="number" min={1} max={99} className="w-20" />
      </div>
      <Button type="submit">{t('addTable')}</Button>
    </ActionForm>
  );
}

export function StationForm({
  orgId,
  orgSlug,
  branchId,
}: {
  orgId: string;
  orgSlug: string;
  branchId: string;
}) {
  const t = useTranslations('branch');
  return (
    <ActionForm action={createStationAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="branchId" value={branchId} />
      <div>
        <Label htmlFor="station-name">{t('stationName')}</Label>
        <Input id="station-name" name="name" required maxLength={40} className="w-40" />
      </div>
      <Button type="submit">{t('addStation')}</Button>
    </ActionForm>
  );
}

/** Inline branch-price override, editable in place; an empty value clears back to the base price. */
export function BranchPriceForm({
  orgId,
  orgSlug,
  branchId,
  itemId,
  currentPrice,
}: {
  orgId: string;
  orgSlug: string;
  branchId: string;
  itemId: string;
  currentPrice: string;
}) {
  const t = useTranslations('branch');
  const [state, action, pending] = useActionState(setBranchPriceAction, initialState);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {t('overridePrice')}
      </Button>
    );
  }
  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="itemId" value={itemId} />
      <Input
        name="price"
        inputMode="decimal"
        defaultValue={currentPrice}
        placeholder={t('useBasePrice')}
        className="min-h-9 w-24"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {t('save')}
      </Button>
      {state.error ? <ErrorAlert error={state.error} /> : null}
    </form>
  );
}
