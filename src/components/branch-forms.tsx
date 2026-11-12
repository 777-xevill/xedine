'use client';

import { MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Hint, Input, Label } from '@/components/ui/form';
import { createTableAction, setBranchLocationAction } from '@/modules/branch/actions';
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

/**
 * Where the branch is, for its weather (ADR 0051). "Use this phone's location" fills the boxes from the
 * browser when the owner is standing in the branch; both boxes empty = follow the branch's area.
 */
export function BranchLocationForm({
  orgId,
  orgSlug,
  branchId,
  latitude,
  longitude,
}: {
  orgId: string;
  orgSlug: string;
  branchId: string;
  latitude: number | null;
  longitude: number | null;
}) {
  const t = useTranslations('branch');
  const [lat, setLat] = React.useState(latitude === null ? '' : String(latitude));
  const [lon, setLon] = React.useState(longitude === null ? '' : String(longitude));
  const [status, setStatus] = React.useState<'idle' | 'finding' | 'failed'>('idle');
  const locate = () => {
    if (!('geolocation' in navigator)) {
      setStatus('failed');
      return;
    }
    setStatus('finding');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(4));
        setLon(pos.coords.longitude.toFixed(4));
        setStatus('idle');
      },
      () => setStatus('failed'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  return (
    <ActionForm action={setBranchLocationAction} successKey="common.saved" className="space-y-3">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <input type="hidden" name="branchId" value={branchId} />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={locate}
        disabled={status === 'finding'}
      >
        <MapPin aria-hidden className="size-4" />
        {status === 'finding' ? t('locating') : t('useMyLocation')}
      </Button>
      {status === 'failed' ? <p className="text-sm text-warning">{t('locateFailed')}</p> : null}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="b-lat">{t('latitude')}</Label>
          <Input
            id="b-lat"
            name="latitude"
            inputMode="decimal"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            className="w-32"
          />
        </div>
        <div>
          <Label htmlFor="b-lon">{t('longitude')}</Label>
          <Input
            id="b-lon"
            name="longitude"
            inputMode="decimal"
            value={lon}
            onChange={(e) => setLon(e.target.value)}
            className="w-32"
          />
        </div>
        <Button type="submit">{t('saveLocation')}</Button>
      </div>
      <Hint>{t('locationHint')}</Hint>
    </ActionForm>
  );
}
