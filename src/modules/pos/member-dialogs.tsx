'use client';

import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { QrCode } from '@/components/qr-code';
import { Button } from '@/components/ui/button';
import { Alert, Hint, Input, Label } from '@/components/ui/form';
import { formatBDT, formatNumber } from '@/lib/i18n/format';
import { parseMemberToken } from '@/modules/customers/member-card';
import type { TillMember } from './client';
import { DialogShell } from './dialogs';
import { useTill } from './till-context';

/**
 * Member card at the till (ADR 0042): scan a customer's card QR, show a new member their card QR to
 * open on their phone, and use points as money off the bill. Every number shown is the server's.
 */

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type DetectorClass = new (options: { formats: string[] }) => Detector;

/** Chrome on Android has a QR reader built in; elsewhere (Chrome on Windows) the ZXing ponyfill loads. */
async function makeDetector(): Promise<Detector> {
  const native = (globalThis as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (native) return new native({ formats: ['qr_code'] });
  const { BarcodeDetector } = await import('barcode-detector/ponyfill');
  return new BarcodeDetector({ formats: ['qr_code'] });
}

export function ScanCardDialog({
  onClose,
  onToken,
}: {
  onClose: () => void;
  onToken: (token: string) => void;
}) {
  const t = useTranslations('pos');
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<'camera' | 'notCard' | null>(null);
  const found = useRef(onToken);
  useEffect(() => {
    found.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const stop = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (stopped || !video.current) return stop();
        video.current.srcObject = stream;
        await video.current.play();
        const detector = await makeDetector();
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            for (const c of codes) {
              const token = parseMemberToken(c.rawValue);
              if (token) {
                stop();
                found.current(token);
                return;
              }
              setProblem('notCard');
            }
          } catch {
            // A frame that is not ready yet: try the next one.
          }
          timer = setTimeout(() => void tick(), 250);
        };
        void tick();
      } catch {
        setProblem('camera');
      }
    })();
    return stop;
  }, []);

  return (
    <DialogShell title={t('scanCard')} onClose={onClose}>
      {problem === 'camera' ? (
        <Alert tone="warning">{t('cameraProblem')}</Alert>
      ) : (
        <>
          <video
            ref={video}
            muted
            playsInline
            aria-label={t('scanCard')}
            className="aspect-square w-full rounded-input bg-foreground/10 object-cover"
          />
          {problem === 'notCard' ? <Alert tone="warning">{t('notMemberCard')}</Alert> : null}
          <Hint>{t('scanHint')}</Hint>
        </>
      )}
    </DialogShell>
  );
}

/** A big QR on the till screen: the customer points their phone camera at it and their card opens. */
export function MemberCardDialog({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string | null;
  onClose: () => void;
}) {
  const t = useTranslations('pos');
  const [copied, setCopied] = useState(false);
  return (
    <DialogShell title={name ? t('cardFor', { name }) : t('memberCard')} onClose={onClose}>
      <div className="mx-auto w-full max-w-64 rounded-input bg-surface p-2">
        <QrCode value={url} label={t('memberCard')} className="w-full" />
      </div>
      <p className="text-center text-sm">{t('cardScanByPhone')}</p>
      <Button
        variant="secondary"
        className="w-full"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => setCopied(true));
        }}
      >
        <Copy aria-hidden className="size-4" />
        {copied ? t('linkCopied') : t('copyLink')}
      </Button>
    </DialogShell>
  );
}

export function UsePointsDialog({
  member,
  onClose,
  onConfirm,
}: {
  member: TillMember;
  onClose: () => void;
  onConfirm: (points: number) => void;
}) {
  const t = useTranslations('pos');
  const { locale } = useTill();
  const usable = member.usable ?? 0;
  const used = member.used_here ?? 0;
  const [points, setPoints] = useState(String(usable || ''));
  const n = Number(points.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))));
  const valid = Number.isInteger(n) && n >= (member.min_redeem_points ?? 1) && n <= usable;
  return (
    <DialogShell title={t('usePoints')} onClose={onClose}>
      <p className="text-sm">
        {t('pointsBalance', {
          points: formatNumber(member.points ?? 0, locale),
          worth: formatBDT(member.point_value_poisha ?? 0, locale),
        })}
      </p>
      {usable > 0 ? (
        <>
          <p className="text-sm text-secondary">
            {t('pointsUsable', {
              points: formatNumber(usable, locale),
              amount: formatBDT(member.usable_worth_poisha ?? 0, locale),
            })}
          </p>
          <div>
            <Label htmlFor="use-pts">{t('pointsToUse')}</Label>
            <Input
              id="use-pts"
              inputMode="numeric"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
            />
            <Hint>
              {t('pointsMin', { min: formatNumber(member.min_redeem_points ?? 0, locale) })}
            </Hint>
          </div>
          <Button className="w-full" disabled={!valid} onClick={() => onConfirm(n)}>
            {t('usePointsConfirm', { points: formatNumber(valid ? n : 0, locale) })}
          </Button>
        </>
      ) : (
        <Alert tone="info">
          {t('pointsNotYet', { min: formatNumber(member.min_redeem_points ?? 0, locale) })}
        </Alert>
      )}
      {used > 0 ? (
        <Button variant="ghost" className="w-full" onClick={() => onConfirm(0)}>
          {t('givePointsBack', { points: formatNumber(used, locale) })}
        </Button>
      ) : null}
    </DialogShell>
  );
}
