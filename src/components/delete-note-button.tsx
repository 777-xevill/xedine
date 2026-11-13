'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { deleteNoteAction } from '@/modules/staff/actions';

/** Delete a note. Warns first and only goes ahead if the person confirms. */
export function DeleteNoteButton({
  orgId,
  orgSlug,
  noteId,
}: {
  orgId: string;
  orgSlug: string;
  noteId: string;
}) {
  const t = useTranslations('staffRecords');
  return (
    <form
      action={deleteNoteAction}
      onSubmit={(e) => {
        if (!window.confirm(t('deleteNoteConfirm'))) e.preventDefault();
      }}
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="noteId" value={noteId} />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        aria-label={t('deleteNote')}
        title={t('deleteNote')}
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </form>
  );
}
