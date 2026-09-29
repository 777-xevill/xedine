'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label, Select } from '@/components/ui/form';
import {
  createChannelAction,
  createReasonCodeAction,
  setChannelCommissionAction,
  updateReceiptSettingsAction,
} from '@/modules/settings/actions';

export function ReceiptSettingsForm({
  orgId,
  orgSlug,
  settings,
}: {
  orgId: string;
  orgSlug: string;
  settings: {
    legalName: string;
    bin: string;
    address: string;
    phone: string;
    footer: string;
  };
}) {
  const t = useTranslations('settings');
  return (
    <ActionForm
      action={updateReceiptSettingsAction}
      successKey="common.saved"
      className="space-y-4"
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="legalName">{t('legalName')}</Label>
          <Input
            id="legalName"
            name="legalName"
            defaultValue={settings.legalName}
            maxLength={160}
          />
        </div>
        <div>
          <Label htmlFor="bin">{t('bin')}</Label>
          <Input id="bin" name="bin" defaultValue={settings.bin} maxLength={40} />
          <Hint>{t('binHelp')}</Hint>
        </div>
      </div>
      <div>
        <Label htmlFor="address">{t('address')}</Label>
        <Input id="address" name="address" defaultValue={settings.address} maxLength={300} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="phone">{t('receiptPhone')}</Label>
          <Input id="phone" name="phone" defaultValue={settings.phone} maxLength={40} />
        </div>
        <div>
          <Label htmlFor="footer">{t('receiptFooter')}</Label>
          <Input id="footer" name="footer" defaultValue={settings.footer} maxLength={300} />
        </div>
      </div>
      <Button type="submit">{t('save')}</Button>
    </ActionForm>
  );
}

const CHANNEL_KINDS = [
  'dine_in',
  'takeaway',
  'own_delivery',
  'foodpanda',
  'pathao_food',
  'custom',
] as const;

export function ChannelForm({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const t = useTranslations('settings');
  return (
    <ActionForm action={createChannelAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <div>
        <Label htmlFor="channel-name">{t('channelName')}</Label>
        <Input id="channel-name" name="name" required maxLength={60} className="w-40" />
      </div>
      <div>
        <Label htmlFor="channel-kind">{t('channelKind')}</Label>
        <Select id="channel-kind" name="kind" defaultValue="custom">
          {CHANNEL_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`channelKindOptions.${k}`)}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit">{t('addChannel')}</Button>
    </ActionForm>
  );
}

/** Money-gated: only rendered for owner/accountant callers (the page itself is owner-only). */
export function CommissionForm({
  orgId,
  orgSlug,
  channelId,
  current,
}: {
  orgId: string;
  orgSlug: string;
  channelId: string;
  current: { commissionPct: string; fixedFee: string; packaging: string } | null;
}) {
  const t = useTranslations('settings');
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {current ? t('editCommission') : t('setCommission')}
      </Button>
    );
  }
  return (
    <ActionForm
      action={setChannelCommissionAction}
      successKey="common.saved"
      className="glass-tile mt-2 grid gap-3 rounded-input p-3 sm:grid-cols-3"
    >
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="channelId" value={channelId} />
      <div>
        <Label htmlFor={`comm-${channelId}`}>{t('commissionPct')}</Label>
        <Input
          id={`comm-${channelId}`}
          name="commissionPct"
          type="number"
          min={0}
          max={100}
          step="0.01"
          defaultValue={current?.commissionPct ?? '0'}
        />
      </div>
      <div>
        <Label htmlFor={`fee-${channelId}`}>{t('fixedFee')}</Label>
        <Input
          id={`fee-${channelId}`}
          name="fixedFee"
          inputMode="decimal"
          defaultValue={current?.fixedFee ?? ''}
        />
      </div>
      <div>
        <Label htmlFor={`pack-${channelId}`}>{t('packaging')}</Label>
        <Input
          id={`pack-${channelId}`}
          name="packaging"
          inputMode="decimal"
          defaultValue={current?.packaging ?? ''}
        />
      </div>
      <Button type="submit" size="sm" className="sm:col-span-3">
        {t('save')}
      </Button>
    </ActionForm>
  );
}

const REASON_KINDS = ['void', 'discount', 'refund'] as const;

export function ReasonCodeForm({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const t = useTranslations('settings');
  return (
    <ActionForm action={createReasonCodeAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <div>
        <Label htmlFor="reason-kind">{t('reasonKind')}</Label>
        <Select id="reason-kind" name="kind" defaultValue="void">
          {REASON_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`reasonKindOptions.${k}`)}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="reason-label">{t('reasonLabel')}</Label>
        <Input id="reason-label" name="label" required maxLength={80} className="w-48" />
      </div>
      <label className="mb-0.5 flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="requiresApproval" className="size-4 accent-purple" />
        {t('requiresApproval')}
      </label>
      <Button type="submit">{t('addReason')}</Button>
    </ActionForm>
  );
}
