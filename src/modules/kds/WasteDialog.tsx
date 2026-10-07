'use client';

import { Minus, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert, Label, Select } from '@/components/ui/form';
import type { createClient } from '@/lib/db/supabase-browser';
import type { DeviceState, StaffSessionState } from '@/modules/pos/device-storage';

interface Option {
  id: string;
  name: string;
  name_bn: string | null;
}

/**
 * The KDS waste button (ROADMAP Phase 5): a dropped plate or a burnt pot logged in three taps, as the
 * PIN-verified cook on this device. Portions of a dish; the stock maths turns them into ingredients.
 */
export function WasteDialog({
  sb,
  device,
  staff,
  onSessionExpired,
  onClose,
}: {
  sb: ReturnType<typeof createClient>;
  device: DeviceState;
  staff: StaffSessionState;
  /** The database says this cook's session has ended: go back to the PIN screen. */
  onSessionExpired: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('kds');
  const locale = useLocale();
  const [items, setItems] = useState<Option[]>([]);
  const [reasons, setReasons] = useState<{ id: string; label: string; label_bn: string | null }[]>(
    [],
  );
  const [item, setItem] = useState('');
  const [reason, setReason] = useState('');
  const [portions, setPortions] = useState(1);
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const name = (o: {
    name?: string;
    label?: string;
    name_bn?: string | null;
    label_bn?: string | null;
  }) => (locale === 'bn' ? (o.name_bn ?? o.label_bn) : null) ?? o.name ?? o.label ?? '';

  useEffect(() => {
    void Promise.all([
      sb
        .from('menu_items')
        .select('id, name, name_bn')
        .eq('org_id', device.orgId)
        .eq('is_active', true)
        .order('name'),
      sb
        .from('reason_codes')
        .select('id, label, label_bn')
        .eq('org_id', device.orgId)
        .eq('kind', 'waste')
        .eq('is_active', true)
        .order('label'),
    ]).then(([i, r]) => {
      setItems((i.data ?? []) as Option[]);
      setReasons((r.data ?? []) as { id: string; label: string; label_bn: string | null }[]);
    });
  }, [sb, device.orgId]);

  const save = () => {
    setState('saving');
    sb.rpc('log_waste', {
      p_org: device.orgId,
      p_branch: device.branchId,
      p_ingredient: null,
      p_menu_item: item,
      p_qty: portions,
      p_reason: reason,
      p_source: 'kds',
      p_device: device.deviceId,
      p_staff: staff.staffId,
    }).then(({ error }) => {
      // 42501 = no active staff session for this device (it lasts 12 hours), not a connection problem.
      if (error?.code === '42501') onSessionExpired();
      else if (error) setState('error');
      else {
        setState('done');
        setItem('');
        setPortions(1);
      }
    });
  };

  return (
    <Dialog
      title={t('wasteTitle')}
      onClose={onClose}
      closeLabel={t('close')}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('close')}
          </Button>
          <Button disabled={!item || !reason || state === 'saving'} onClick={save}>
            {t('logWaste')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {state === 'done' ? <Alert tone="success">{t('wasteLogged')}</Alert> : null}
        {state === 'error' ? <Alert tone="danger">{t('wasteFailed')}</Alert> : null}
        <div>
          <Label htmlFor="kds-waste-item">{t('wasteDish')}</Label>
          <Select id="kds-waste-item" value={item} onChange={(e) => setItem(e.target.value)}>
            <option value="">{t('choose')}</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {name(i)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">{t('portions')}</p>
          <div className="flex items-center gap-3">
            <Button
              size="icon"
              variant="secondary"
              aria-label={t('less')}
              onClick={() => setPortions((p) => Math.max(1, p - 1))}
            >
              <Minus aria-hidden className="size-4" />
            </Button>
            <span className="w-10 text-center text-2xl font-bold tabular-nums">{portions}</span>
            <Button
              size="icon"
              variant="secondary"
              aria-label={t('more')}
              onClick={() => setPortions((p) => Math.min(50, p + 1))}
            >
              <Plus aria-hidden className="size-4" />
            </Button>
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">{t('wasteReason')}</p>
          <div className="flex flex-wrap gap-2">
            {reasons.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={reason === r.id}
                onClick={() => setReason(r.id)}
                className={`min-h-11 rounded-full border px-4 text-sm font-medium transition ${
                  reason === r.id
                    ? 'border-purple bg-surface-elevated text-foreground'
                    : 'glass-tile text-secondary'
                }`}
              >
                {name(r)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
