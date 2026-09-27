'use client';

import { useTranslations } from 'next-intl';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/form';
import { insightAction, scanFindingsAction, setFindingStatusAction } from '@/modules/leaks/actions';

export function ScanForm({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const t = useTranslations('leaks');
  return (
    <ActionForm
      action={scanFindingsAction}
      successKey="leaks.scanned"
      className="flex flex-col items-end gap-2"
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <Button type="submit" variant="secondary">
        {t('scanNow')}
      </Button>
    </ActionForm>
  );
}

/** Acknowledge, resolve, snooze (with a date) or dismiss (with a reason). Audited in SQL. */
export function FindingActions({
  findingId,
  orgSlug,
  status,
}: {
  findingId: string;
  orgSlug: string;
  status: string;
}) {
  const t = useTranslations('leaks');
  const hidden = (
    <>
      <input type="hidden" name="findingId" value={findingId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
    </>
  );
  const quick = (next: string, label: string, variant: 'secondary' | 'ghost' = 'secondary') => (
    <ActionForm action={setFindingStatusAction}>
      {hidden}
      <input type="hidden" name="status" value={next} />
      <Button type="submit" size="sm" variant={variant}>
        {label}
      </Button>
    </ActionForm>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === 'new' ? quick('acknowledged', t('acknowledge')) : null}
        {status !== 'resolved'
          ? quick('resolved', t('resolve'))
          : quick('new', t('reopen'), 'ghost')}
      </div>
      <details className="group">
        <summary className="cursor-pointer text-sm text-secondary hover:text-foreground">
          {t('moreOptions')}
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <ActionForm action={setFindingStatusAction} className="space-y-2">
            {hidden}
            <input type="hidden" name="status" value="snoozed" />
            <Label htmlFor={`snooze-${findingId}`}>{t('snoozeUntil')}</Label>
            <Input id={`snooze-${findingId}`} name="snoozeUntil" type="date" required />
            <Button type="submit" size="sm" variant="secondary">
              {t('snooze')}
            </Button>
          </ActionForm>
          <ActionForm action={setFindingStatusAction} className="space-y-2">
            {hidden}
            <input type="hidden" name="status" value="dismissed" />
            <Label htmlFor={`reason-${findingId}`}>{t('dismissReason')}</Label>
            <Input id={`reason-${findingId}`} name="reason" required maxLength={500} />
            <Button type="submit" size="sm" variant="danger">
              {t('dismiss')}
            </Button>
          </ActionForm>
        </div>
      </details>
    </div>
  );
}

/** Dismiss one of today's insights (with a reason) or snooze it (until a date). */
export function InsightActions({ insightId, orgSlug }: { insightId: string; orgSlug: string }) {
  const t = useTranslations('leaks');
  const hidden = (
    <>
      <input type="hidden" name="insightId" value={insightId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
    </>
  );
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-secondary hover:text-foreground">
        {t('moreOptions')}
      </summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <ActionForm action={insightAction} className="flex items-end gap-2">
          {hidden}
          <input type="hidden" name="action" value="snooze" />
          <Input
            name="until"
            type="date"
            required
            aria-label={t('snoozeUntil')}
            className="min-h-9"
          />
          <Button type="submit" size="sm" variant="secondary">
            {t('snooze')}
          </Button>
        </ActionForm>
        <ActionForm action={insightAction} className="flex items-end gap-2">
          {hidden}
          <input type="hidden" name="action" value="dismiss" />
          <Input
            name="reason"
            required
            aria-label={t('dismissReason')}
            placeholder={t('dismissReason')}
            className="min-h-9"
          />
          <Button type="submit" size="sm" variant="danger">
            {t('dismiss')}
          </Button>
        </ActionForm>
      </div>
    </details>
  );
}
