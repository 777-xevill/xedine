'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { deleteCustomerAction } from '@/modules/customers/member-actions';

/** Delete a customer's number. Warns first and only goes ahead if the person confirms (ADR 0053). */
export function DeleteCustomerButton({
  orgId,
  orgSlug,
  customerId,
  phone,
  visits,
}: {
  orgId: string;
  orgSlug: string;
  customerId: string;
  phone: string;
  visits: number;
}) {
  const t = useTranslations('customers');
  return (
    <form
      action={deleteCustomerAction}
      onSubmit={(e) => {
        if (!window.confirm(t('deleteConfirm', { phone, visits }))) e.preventDefault();
      }}
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="customerId" value={customerId} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        aria-label={t('deleteNumber')}
        title={t('deleteNumber')}
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </form>
  );
}
