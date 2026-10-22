'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Input, Label, Select } from '@/components/ui/form';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  fetchActiveStaff,
  fetchBranches,
  registerAndClaimDevice,
  startStaffSession,
  type Branch,
  type createClient,
  type StaffMember,
} from './client';
import { getTillSnapshot, type DeviceState } from './device-storage';
import { isNetworkError } from './outbox';

// -------------------------------------------------------------------------------------------
// Pairing: the manager/owner currently signed into this browser (ADR 0013) registers the device.
// -------------------------------------------------------------------------------------------
export function PairingScreen({
  sb,
  onPaired,
}: {
  sb: ReturnType<typeof createClient>;
  onPaired: (d: DeviceState) => void;
}) {
  const t = useTranslations('pos');
  const tn = useTranslations('nav');
  const te = useTranslations('errors');
  const [orgs, setOrgs] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [orgId, setOrgId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [name, setName] = useState(() => t('defaultDeviceName'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void sb
      .from('organizations')
      .select('id, name, slug')
      .order('name')
      .then(({ data }) => {
        setOrgs(data ?? []);
        if (data?.[0]) setOrgId(data[0].id);
      });
  }, [sb]);
  useEffect(() => {
    if (!orgId) return;
    void fetchBranches(sb, orgId).then((b) => {
      setBranches(b);
      setBranchId(b[0]?.id ?? '');
    });
  }, [sb, orgId]);

  const submit = async () => {
    setError(null);
    if (!orgId || !branchId || !name.trim()) return;
    setBusy(true);
    try {
      const org = orgs.find((o) => o.id === orgId)!;
      const branch = branches.find((b) => b.id === branchId)!;
      const deviceId = await registerAndClaimDevice(sb, orgId, branchId, name.trim());
      onPaired({ deviceId, orgId, orgSlug: org.slug, branchId, branchName: branch.name });
    } catch (e) {
      // 42501: only an owner or a manager of the branch may pair a till.
      setError((e as { code?: string })?.code === '42501' ? t('pairNotAllowed') : te('generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">{t('pairTitle')}</h1>
      <p className="text-secondary">{t('pairSubtitle')}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div>
        <Label htmlFor="org">{tn('organization')}</Label>
        <Select id="org" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="branch">{t('selectBranch')}</Label>
        <Select id="branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="deviceName">{t('deviceName')}</Label>
        <Input id="deviceName" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <Button onClick={() => void submit()} disabled={busy || !orgId || !branchId}>
        {busy ? t('pairing') : t('pairButton')}
      </Button>
    </div>
  );
}

// -------------------------------------------------------------------------------------------
// Staff gate: pick your name, then your PIN (Phase 0 start_staff_session).
// -------------------------------------------------------------------------------------------
export function StaffGate({
  sb,
  device,
  onSignedIn,
  onReset,
  notice,
}: {
  sb: ReturnType<typeof createClient>;
  device: DeviceState;
  /** Why the person is back at the PIN screen (e.g. their 12-hour session ended). */
  notice?: string | null;
  onSignedIn: (s: { sessionId: string; staffId: string; staffName: string }) => void;
  /** Forget this till's setup and go back to the pairing screen. */
  onReset: () => void;
}) {
  const t = useTranslations('pos');
  const te = useTranslations('errors');
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [picked, setPicked] = useState<StaffMember | null>(null);
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  // Whether the account signed into this browser can open the restaurant the till was set up for.
  // When it cannot (someone signed in with another restaurant's account), RLS hides its staff and
  // its Staff page is a 404, so the till says so instead of showing an empty list.
  const [other, setOther] = useState<{ email: string } | null>(null);

  useEffect(() => {
    void Promise.all([
      sb.from('organizations').select('id').eq('id', device.orgId).maybeSingle(),
      sb.auth.getUser(),
    ])
      .then(([org, user]) => {
        // Offline or an error: keep going with the till's snapshot; only a clear "not yours" counts.
        if (!org.error && !org.data) setOther({ email: user.data.user?.email ?? '' });
      })
      .catch(() => undefined);
  }, [sb, device.orgId]);

  useEffect(() => {
    // Offline, the names come from the till's last snapshot; the PIN itself still needs the server.
    fetchActiveStaff(sb, device.orgId, device.branchId)
      .then(setStaff)
      .catch(() => setStaff(getTillSnapshot(device.deviceId)?.staff ?? []));
  }, [sb, device]);

  const tryPin = useCallback(
    async (nextPin: string) => {
      if (!picked || nextPin.length < 4) return;
      let result: Awaited<ReturnType<typeof startStaffSession>>;
      try {
        result = await startStaffSession(sb, device.deviceId, picked.id, nextPin);
      } catch (e) {
        setPin('');
        setMessage(isNetworkError(e) ? t('needsInternet') : te('generic'));
        return;
      }
      if (result.ok) {
        onSignedIn({
          sessionId: result.session_id,
          staffId: picked.id,
          staffName: picked.display_name,
        });
        return;
      }
      setPin('');
      if (result.reason === 'no_pin') setMessage(t('noPin', { name: picked.display_name }));
      else if (result.reason === 'locked') setMessage(t('pinLocked'));
      else if (result.reason === 'wrong_pin')
        setMessage(t('pinWrong', { attempts: result.attempts_left ?? 0 }));
      else setMessage(te('generic'));
    },
    [sb, device, picked, onSignedIn, t, te],
  );

  const footer = (
    <p className="text-center text-sm text-secondary">
      {t('tillFor', { org: device.orgSlug, branch: device.branchName })} ·{' '}
      <button type="button" className="font-medium text-purple underline" onClick={onReset}>
        {t('resetTill')}
      </button>
    </p>
  );

  if (other) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
        <h1 className="text-2xl font-semibold">{t('otherTitle')}</h1>
        <Alert tone="warning">
          {t('otherBody', {
            org: device.orgSlug,
            branch: device.branchName,
            email: other.email,
          })}
        </Alert>
        <Button className="w-full" onClick={onReset}>
          {t('resetTill')}
        </Button>
        <Link
          href="/sign-in?next=%2Fpos"
          className={`${buttonVariants({ variant: 'ghost' })} w-full`}
        >
          {t('otherSignIn')}
        </Link>
      </div>
    );
  }

  if (!picked) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
        <h1 className="text-2xl font-semibold">{t('chooseStaff')}</h1>
        {staff && staff.length === 0 ? (
          <div className="space-y-3">
            <Alert tone="warning">
              <p className="font-semibold">{t('noStaffTitle')}</p>
              <p className="mt-1">{t('noStaffBody', { branch: device.branchName })}</p>
            </Alert>
            <Link
              href={`/${device.orgSlug}/staff?branch=${device.branchId}`}
              className={`${buttonVariants()} w-full`}
            >
              {t('noStaffAction')}
            </Link>
            <Button variant="ghost" className="w-full" onClick={() => window.location.reload()}>
              {t('noStaffReload')}
            </Button>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          {(staff ?? []).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setPicked(s);
                setMessage(null);
              }}
              className="glass-tile min-h-16 rounded-card px-4 text-lg font-medium transition hover:border-purple"
            >
              {s.display_name}
            </button>
          ))}
        </div>
        {footer}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-xs flex-col justify-center gap-4 px-4">
      <h1 className="text-center text-xl font-semibold">{picked.display_name}</h1>
      <p className="text-center text-secondary">{t('enterPin')}</p>
      {notice && !message ? <Alert tone="warning">{notice}</Alert> : null}
      {message ? <Alert tone="danger">{message}</Alert> : null}
      <div className="text-center text-3xl tracking-[0.5em]">
        {'•'.repeat(pin.length).padEnd(6, '·')}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) =>
          d === '' ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              aria-label={d === '⌫' ? t('backspace') : d}
              className="glass-tile min-h-16 rounded-full text-2xl font-medium transition active:scale-95"
              onClick={() => {
                if (d === '⌫') return setPin((p) => p.slice(0, -1));
                const next = pin.length < 6 ? pin + d : pin;
                setPin(next);
                if (next.length >= 4) void tryPin(next);
              }}
            >
              {d}
            </button>
          ),
        )}
      </div>
      <Button variant="ghost" onClick={() => setPicked(null)}>
        {t('switchStaff')}
      </Button>
    </div>
  );
}
