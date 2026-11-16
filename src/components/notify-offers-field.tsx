'use client';

import { BellOff, BellRing, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { b64urlDecode } from '@/lib/messaging/web-push';

type Status = 'idle' | 'on' | 'blocked' | 'failed';

/**
 * "Get notified when you get a personal offer" on the table page (ADR 0048). One tick gives the usual
 * WhatsApp/SMS offers consent AND asks this browser to allow notifications: the tick is the tap the browser
 * needs before it will show its "Allow notifications?" question. The phone's subscription goes along with
 * the form in a hidden field; the server keeps it only for a customer who ticked. A browser that cannot do
 * notifications (an iPhone's Safari outside the home screen) simply keeps the WhatsApp/SMS offers.
 */
export function NotifyOffersField({ publicKey }: { publicKey: string | null }) {
  const t = useTranslations('tablePage');
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [subscription, setSubscription] = useState('');

  async function subscribe(): Promise<void> {
    const supported =
      publicKey !== null &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      'serviceWorker' in navigator &&
      'PushManager' in window;
    if (!supported) return;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'blocked' : 'idle');
        return;
      }
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64urlDecode(publicKey),
        }));
      setSubscription(JSON.stringify(sub.toJSON()));
      setStatus('on');
    } catch {
      setStatus('failed');
    }
  }

  function toggle(next: boolean): void {
    setChecked(next);
    if (!next) {
      setSubscription('');
      setStatus('idle');
      return;
    }
    void subscribe();
  }

  // ADR 0063: a lit panel with a tick that fills yellow; the status line keeps an icon with its words.
  const StatusIcon =
    status === 'on'
      ? BellRing
      : status === 'blocked'
        ? BellOff
        : status === 'failed'
          ? TriangleAlert
          : null;
  return (
    <div className="cust-consent">
      <label className="flex cursor-pointer items-start gap-3 text-[0.9375rem] leading-snug font-semibold">
        <input
          type="checkbox"
          name="offers"
          className="cust-tick"
          checked={checked}
          onChange={(e) => toggle(e.target.checked)}
        />
        <span className="flex items-start gap-1.5 pt-0.5">
          <BellRing aria-hidden className="mt-0.5 size-4 shrink-0 text-purple" />
          {t('offers')}
        </span>
      </label>
      <input type="hidden" name="push" value={subscription} />
      <p
        role="status"
        className="mt-1.5 flex items-start gap-1.5 ps-9 text-xs leading-relaxed text-secondary"
      >
        {StatusIcon ? (
          <StatusIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-purple" />
        ) : null}
        {status === 'on'
          ? t('offersOn')
          : status === 'blocked'
            ? t('offersBlocked')
            : status === 'failed'
              ? t('offersFailed')
              : t('offersHint')}
      </p>
    </div>
  );
}
