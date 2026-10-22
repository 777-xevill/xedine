'use client';

import { useTranslations } from 'next-intl';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/form';
import { createTableAction } from '@/modules/branch/actions';
import { requestBranchAction } from '@/modules/settings/actions';

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

/** The owner asks for a new branch; a platform admin approves it before it exists (ADR 0036). */
export function BranchRequestForm({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const t = useTranslations('branch');
  return (
    <ActionForm
      action={requestBranchAction}
      successKey="branch.requestSent"
      className="flex flex-wrap items-end gap-2"
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <div>
        <Label htmlFor="branch-name">{t('requestName')}</Label>
        <Input
          id="branch-name"
          name="name"
          required
          maxLength={80}
          autoComplete="off"
          placeholder={t('requestNamePlaceholder')}
          className="w-44"
        />
      </div>
      <div>
        <Label htmlFor="branch-area">{t('requestArea')}</Label>
        <Input id="branch-area" name="area" maxLength={80} autoComplete="off" className="w-44" />
      </div>
      <Button type="submit">{t('requestSend')}</Button>
    </ActionForm>
  );
}
