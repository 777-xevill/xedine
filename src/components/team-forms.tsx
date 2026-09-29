'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { Alert, Hint, Input, Label, Select } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { inviteMemberAction, updateSettingsAction } from '@/modules/tenancy/actions';
import { initialState } from '@/modules/tenancy/form-state';
import { ErrorAlert } from '@/components/auth-forms';

const INVITE_ROLES = ['manager', 'cashier', 'kitchen', 'purchaser', 'accountant'] as const;

export function InviteForm({
  orgId,
  orgSlug,
  branches,
}: {
  orgId: string;
  orgSlug: string;
  branches: { id: string; name: string }[];
}) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(inviteMemberAction, initialState);
  const [role, setRole] = useState<(typeof INVITE_ROLES)[number]>('manager');
  const [copied, setCopied] = useState(false);
  const needsBranches = role !== 'accountant';

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <ErrorAlert error={state.error} />
      {state.ok && state.data?.link ? (
        <Alert tone="success">
          <p>{t('team.inviteReady')}</p>
          <div className="mt-2 flex gap-2">
            <Input
              readOnly
              value={state.data.link}
              aria-label={t('common.copy')}
              data-testid="invite-link"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(state.data!.link!);
                setCopied(true);
              }}
            >
              {copied ? t('common.copied') : t('common.copy')}
            </Button>
          </div>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="invite-email">{t('team.inviteEmail')}</Label>
          <Input id="invite-email" name="email" type="email" required autoComplete="off" />
        </div>
        <div>
          <Label htmlFor="invite-role">{t('team.inviteRole')}</Label>
          <Select
            id="invite-role"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            {INVITE_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {needsBranches ? (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">{t('team.inviteBranches')}</legend>
          <div className="flex flex-wrap gap-3">
            {branches.map((b) => (
              <label
                key={b.id}
                className="flex min-h-11 items-center gap-2 rounded-input border border-line px-3 text-sm"
              >
                <input
                  type="checkbox"
                  name="branchIds"
                  value={b.id}
                  className="size-4 accent-purple"
                />
                {b.name}
              </label>
            ))}
          </div>
          <Hint>{t('team.roleNeedsBranch')}</Hint>
        </fieldset>
      ) : (
        <p className="text-sm text-secondary">{t('team.allBranchesScope')}</p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t('common.loading') : t('team.sendInvite')}
      </Button>
    </form>
  );
}

export function SettingsForm({
  orgId,
  orgSlug,
  settings,
}: {
  orgId: string;
  orgSlug: string;
  settings: {
    priceIncludesVat: boolean;
    vatRatePct: string;
    serviceChargePct: string;
    cutoff: string;
    weekStart: number;
  };
}) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(updateSettingsAction, initialState);
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <ErrorAlert error={state.error} />
      {state.ok ? <Alert tone="success">{t('common.saved')}</Alert> : null}

      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t('settings.priceBasis')}</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name="priceIncludesVat"
            value="true"
            defaultChecked={settings.priceIncludesVat}
            className="size-4 accent-purple"
          />
          {t('settings.priceInclusive')}
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name="priceIncludesVat"
            value="false"
            defaultChecked={!settings.priceIncludesVat}
            className="size-4 accent-purple"
          />
          {t('settings.priceExclusive')}
        </label>
        <Hint>{t('settings.priceBasisHelp')}</Hint>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="vatRate">{t('settings.vatRate')}</Label>
          <Input
            id="vatRate"
            name="vatRate"
            type="number"
            min={0}
            max={100}
            step="0.01"
            defaultValue={settings.vatRatePct}
            required
          />
        </div>
        <div>
          <Label htmlFor="serviceCharge">{t('settings.serviceCharge')}</Label>
          <Input
            id="serviceCharge"
            name="serviceCharge"
            type="number"
            min={0}
            max={100}
            step="0.01"
            defaultValue={settings.serviceChargePct}
            required
          />
        </div>
      </div>
      <Hint>{t('settings.regulatoryNote')}</Hint>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="cutoff">{t('settings.cutoff')}</Label>
          <Input id="cutoff" name="cutoff" type="time" defaultValue={settings.cutoff} required />
          <Hint>{t('settings.cutoffHelp')}</Hint>
        </div>
        <div>
          <Label htmlFor="weekStart">{t('settings.weekStart')}</Label>
          <Select id="weekStart" name="weekStart" defaultValue={String(settings.weekStart)}>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <option key={d} value={d}>
                {t(`weekdays.${d}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? t('common.loading') : t('common.save')}
      </Button>
    </form>
  );
}
