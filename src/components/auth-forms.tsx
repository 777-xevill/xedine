'use client';

import Link from 'next/link';
import { Phone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { Alert, Hint, Input, Label } from '@/components/ui/form';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  createOrganizationAction,
  signInAction,
  signUpAction,
  acceptInvitationAction,
  joinWithInviteAction,
  signInWithProviderAction,
  phoneSignInAction,
  resendSignUpEmailAction,
  signUpConfirmedAction,
  continueAfterConfirmAction,
} from '@/modules/tenancy/actions';
import { initialState } from '@/modules/tenancy/form-state';
import { fallbackSlug, slugFromName } from '@/modules/tenancy/slug';
import { PlaceFields } from '@/components/place-fields';
import type { PlaceOptions } from '@/modules/social/culture';

type IconProps = { className?: string };

/** The three brands' marks in one ink (currentColor), so the page keeps its grey, silver and yellow (ADR 0063). */
const PROVIDER_ICONS = {
  google: ({ className }: IconProps) => (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
    </svg>
  ),
  facebook: ({ className }: IconProps) => (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  ),
  x: ({ className }: IconProps) => (
    <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  ),
} as const;

export function ErrorAlert({ error }: { error?: string }) {
  const t = useTranslations('errors');
  if (!error) return null;
  return <Alert tone="danger">{t(error)}</Alert>;
}

/**
 * "Continue with Google / Facebook / phone number" (ADR 0041, 0050). Each provider is its own form, so it
 * never submits the email fields; only the providers switched on are shown.
 */
export function QuickSignIn({
  next,
  google,
  facebook,
  x = false,
  phone,
}: {
  next?: string;
  google: boolean;
  facebook: boolean;
  x?: boolean;
  phone: boolean;
}) {
  const t = useTranslations('auth');
  if (!google && !facebook && !x && !phone) return null;
  const shown = { google, facebook, x };
  const label = {
    google: 'continueWithGoogle',
    facebook: 'continueWithFacebook',
    x: 'continueWithX',
  } as const;
  const phoneHref = next ? `/sign-in/phone?next=${encodeURIComponent(next)}` : '/sign-in/phone';
  return (
    <div className="mb-4 space-y-3">
      {(['google', 'facebook', 'x'] as const)
        .filter((p) => shown[p])
        .map((provider) => {
          const Icon = PROVIDER_ICONS[provider];
          return (
            <form key={provider} action={signInWithProviderAction}>
              <input type="hidden" name="provider" value={provider} />
              <input type="hidden" name="next" value={next ?? ''} />
              <Button type="submit" variant="secondary" className="w-full">
                <span className="flex items-center justify-center gap-2.5">
                  <Icon className="size-[18px] shrink-0" />
                  {t(label[provider])}
                </span>
              </Button>
            </form>
          );
        })}
      {phone ? (
        <Link href={phoneHref} className={cn(buttonVariants({ variant: 'secondary' }), 'w-full')}>
          <span className="flex items-center justify-center gap-2.5">
            <Phone aria-hidden className="size-[18px] shrink-0" />
            {t('continueWithPhone')}
          </span>
        </Link>
      ) : null}
      <p className="flex items-center gap-3 text-xs text-secondary before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
        {t('orWithEmail')}
      </p>
    </div>
  );
}

/**
 * Phone sign-in (ADR 0050): 1) open the Xedine bot on Telegram and share your number, 2) type the phone and
 * the 6-digit code the bot sends. Free: Telegram proves the number, no SMS is bought.
 */
export function PhoneSignInForm({ next, botLink }: { next?: string; botLink: string }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(phoneSignInAction, initialState);
  return (
    <div className="space-y-5">
      <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground">
        <li>{t('auth.phoneStep1')}</li>
        <li>{t('auth.phoneStep2')}</li>
        <li>{t('auth.phoneStep3')}</li>
      </ol>
      <a
        href={botLink}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-11 w-full items-center justify-center rounded-full bg-action px-4 text-sm font-semibold text-on-action"
      >
        {t('auth.phoneOpenTelegram')}
      </a>
      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={next ?? ''} />
        <ErrorAlert error={state.error} />
        <div className="space-y-1">
          <Label htmlFor="phone">{t('auth.phoneNumber')}</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="01712345678"
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="code">{t('auth.phoneCode')}</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={12}
            required
          />
          <Hint>{t('auth.phoneCodeHint')}</Hint>
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {t('auth.phoneSignIn')}
        </Button>
      </form>
      <Link
        href={next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in'}
        className="block text-center text-sm text-secondary underline"
      >
        {t('auth.phoneBack')}
      </Link>
    </div>
  );
}

export function SignInForm({ next, urlError }: { next?: string; urlError?: string }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(signInAction, initialState);
  const signUpHref = next ? `/sign-up?next=${encodeURIComponent(next)}` : '/sign-up';
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ''} />
      {next?.startsWith('/accept-invite') ? (
        <Alert tone="info">
          <p className="font-medium">{t('auth.inviteSignInTitle')}</p>
          <p className="mt-1 text-sm">{t('auth.inviteSignInBody')}</p>
          <Link
            href={signUpHref}
            className="mt-3 inline-flex min-h-10 items-center rounded-full bg-action px-4 text-sm font-semibold text-on-action"
          >
            {t('auth.inviteCreateAccount')}
          </Link>
        </Alert>
      ) : null}
      <ErrorAlert error={state.error ?? urlError} />
      <div>
        <Label htmlFor="email">{t('common.email')}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <Label htmlFor="password">{t('common.password')}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t('common.loading') : t('common.signIn')}
      </Button>
      <p className="text-center text-sm text-secondary">
        {t('auth.noAccount')}{' '}
        <Link href={signUpHref} className="text-purple underline-offset-4 hover:underline">
          {t('common.signUp')}
        </Link>
      </p>
    </form>
  );
}

/**
 * Watches for the confirmation while the check-email page is open: every few seconds and whenever the
 * person comes back to this tab. Once the link is tapped anywhere that shares this browser's sign-in, the
 * page goes on to restaurant set-up by itself. The button covers a link opened in a different browser.
 */
export function ConfirmWatcher() {
  const t = useTranslations('auth');
  const router = useRouter();
  useEffect(() => {
    let done = false;
    const check = async () => {
      if (done || document.visibilityState !== 'visible') return;
      if (await signUpConfirmedAction()) {
        done = true;
        router.replace('/onboarding');
      }
    };
    const timer = window.setInterval(check, 4000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      done = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [router]);
  return (
    <form action={continueAfterConfirmAction} className="mb-3">
      <Button type="submit" variant="secondary" className="w-full">
        {t('confirmedContinue')}
      </Button>
    </form>
  );
}

/** "Didn't get it? Send again" on the check-your-email page. */
export function ResendSignUpEmail() {
  const t = useTranslations('auth');
  const [state, action, pending] = useActionState(resendSignUpEmailAction, initialState);
  return (
    <form action={action} className="space-y-3">
      <ErrorAlert error={state.error} />
      {state.ok ? <Alert tone="success">{t('emailResent')}</Alert> : null}
      <Button type="submit" variant="secondary" className="w-full" disabled={pending}>
        {pending ? t('sending') : t('sendAgain')}
      </Button>
    </form>
  );
}

export function SignUpForm({ next }: { next?: string }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(signUpAction, initialState);
  const signInHref = next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in';
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ''} />
      <ErrorAlert error={state.error} />
      {state.ok && state.message ? (
        <Alert tone="success">{t(`auth.${state.message}`)}</Alert>
      ) : null}
      {next?.startsWith('/accept-invite') ? (
        <Alert tone="info">{t('auth.inviteHint')}</Alert>
      ) : null}
      <div>
        <Label htmlFor="fullName">{t('common.fullName')}</Label>
        <Input id="fullName" name="fullName" autoComplete="name" required />
      </div>
      <div>
        <Label htmlFor="email">{t('common.email')}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <Label htmlFor="password">{t('common.password')}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <Hint>{t('auth.passwordHint')}</Hint>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t('common.loading') : t('common.signUp')}
      </Button>
      <p className="text-center text-sm text-secondary">
        {t('auth.haveAccount')}{' '}
        <Link href={signInHref} className="text-purple underline-offset-4 hover:underline">
          {t('common.signIn')}
        </Link>
      </p>
    </form>
  );
}

interface BranchRow {
  key: number;
}

export function OnboardingForm({ place }: { place: PlaceOptions }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(createOrganizationAction, initialState);
  const [rows, setRows] = useState<BranchRow[]>([{ key: 1 }]);
  const [nextKey, setNextKey] = useState(2);
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  // A name with no English letters (Bangla) gets a numbered link; the digits are chosen once, on typing.
  const [fallbackDigits, setFallbackDigits] = useState<number | null>(null);
  const fallbackFor = (name: string) => {
    if (!name.trim()) return '';
    const digits = fallbackDigits ?? Math.floor(Math.random() * 10000);
    if (fallbackDigits === null) setFallbackDigits(digits);
    return fallbackSlug(digits);
  };
  return (
    <form action={action} className="space-y-6">
      <ErrorAlert error={state.error} />
      <div>
        <Label htmlFor="name">{t('onboarding.orgName')}</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={120}
          onChange={(e) => {
            // The link follows the name until the owner types their own.
            if (!slugEdited) setSlug(slugFromName(e.target.value) || fallbackFor(e.target.value));
          }}
        />
      </div>
      <div>
        <Label htmlFor="slug">{t('onboarding.orgSlug')}</Label>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-sm text-secondary">{t('onboarding.slugPrefix')}</span>
          <Input
            id="slug"
            name="slug"
            required
            value={slug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value.toLowerCase());
            }}
            pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
            spellCheck={false}
            autoCapitalize="none"
          />
        </div>
        <Hint>{t('onboarding.slugHelp')}</Hint>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">{t('place.title')}</legend>
        <PlaceFields options={place} country="BD" timezone="Asia/Dhaka" currency="BDT" />
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-1.5 text-sm font-medium">{t('onboarding.branches')}</legend>
        {rows.map((row, index) => (
          <div key={row.key} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <div>
              <Label htmlFor={`branchName-${row.key}`}>{t('onboarding.branchName')}</Label>
              <Input id={`branchName-${row.key}`} name="branchName" required />
            </div>
            <div>
              <Label htmlFor={`branchArea-${row.key}`}>{t('onboarding.branchArea')}</Label>
              <Input id={`branchArea-${row.key}`} name="branchArea" />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={rows.length === 1}
              aria-label={`${t('onboarding.removeBranch')} ${index + 1}`}
              onClick={() => setRows((r) => r.filter((x) => x.key !== row.key))}
            >
              {t('common.remove')}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            setRows((r) => [...r, { key: nextKey }]);
            setNextKey((k) => k + 1);
          }}
        >
          {t('onboarding.addBranch')}
        </Button>
      </fieldset>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t('common.loading') : t('onboarding.submit')}
      </Button>
    </form>
  );
}

/** For an invited person who has no account yet: name and password, one button. */
export function JoinInviteForm({ token, email }: { token: string; email?: string }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(joinWithInviteAction, initialState);
  const next = `/accept-invite?token=${token}${email ? `&email=${encodeURIComponent(email)}` : ''}`;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <ErrorAlert error={state.error} />
      {state.error === 'emailTaken' ? (
        <Link
          href={`/sign-in?next=${encodeURIComponent(next)}`}
          className="block text-center text-sm text-purple underline-offset-4 hover:underline"
        >
          {t('auth.joinHaveAccount')}
        </Link>
      ) : null}
      {state.ok && state.message ? (
        <Alert tone="success">{t(`auth.${state.message}`)}</Alert>
      ) : null}
      <div>
        <Label htmlFor="join-name">{t('auth.joinName')}</Label>
        <Input id="join-name" name="fullName" autoComplete="name" required />
      </div>
      <div>
        <Label htmlFor="join-email">{t('common.email')}</Label>
        <Input
          id="join-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={email ?? ''}
          readOnly={Boolean(email)}
        />
        <Hint>{t('auth.inviteHint')}</Hint>
      </div>
      <div>
        <Label htmlFor="join-password">{t('auth.joinPassword')}</Label>
        <Input
          id="join-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <Hint>{t('auth.joinPasswordHint')}</Hint>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t('common.loading') : t('auth.joinButton')}
      </Button>
      <p className="text-center text-sm text-secondary">
        {t('auth.haveAccount')}{' '}
        <Link
          href={`/sign-in?next=${encodeURIComponent(next)}`}
          className="text-purple underline-offset-4 hover:underline"
        >
          {t('common.signIn')}
        </Link>
      </p>
    </form>
  );
}

export function AcceptInviteForm({ token }: { token: string }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(acceptInvitationAction, initialState);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <ErrorAlert error={state.error} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t('common.loading') : t('team.acceptInvite')}
      </Button>
    </form>
  );
}
