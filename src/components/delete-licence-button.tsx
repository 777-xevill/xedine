'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { deleteLicenceAction } from '@/modules/compliance/actions';

/** Remove a licence. Warns first and only goes ahead if the person confirms. */
export function DeleteLicenceButton({
  orgId,
  orgSlug,
  licenceId,
  name,
}: {
  orgId: string;
  orgSlug: string;
  licenceId: string;
  name: string;
}) {
  const t = useTranslations('compliance');
  return (
    <form
      action={deleteLicenceAction}
      onSubmit={(e) => {
        if (!window.confirm(t('removeConfirm', { name }))) e.preventDefault();
      }}
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="licenceId" value={licenceId} />
      <Button type="submit" size="sm" variant="ghost">
        {t('remove')}
      </Button>
    </form>
  );
}
