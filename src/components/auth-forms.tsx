'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { Alert, Hint, Input, Label } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import {
  createOrganizationAction,
  signInAction,
  signUpAction,
  acceptInvitationAction,
  joinWithInviteAction,
} from '@/modules/tenancy/actions';
import { initialState } from '@/modules/tenancy/form-state';

export function ErrorAlert({ error }: { error?: string }) {
  const t = useTranslations('errors');
  if (!error) return null;
  return <Alert tone="danger">{t(error)}</Alert>;
}

export function SignInForm({ next }: { next?: string }) {
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
      <ErrorAlert error={state.error} />
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

export function OnboardingForm() {
  const t = useTranslations();
  const [state, action, pending] = useActionState(createOrganizationAction, initialState);
  const [rows, setRows] = useState<BranchRow[]>([{ key: 1 }]);
  const [nextKey, setNextKey] = useState(2);
  return (
    <form action={action} className="space-y-6">
      <ErrorAlert error={state.error} />
      <div>
        <Label htmlFor="name">{t('onboarding.orgName')}</Label>
        <Input id="name" name="name" required maxLength={120} />
      </div>
      <div>
        <Label htmlFor="slug">{t('onboarding.orgSlug')}</Label>
        <Input
          id="slug"
          name="slug"
          required
          pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
          spellCheck={false}
          autoCapitalize="none"
        />
        <Hint>{t('onboarding.slugHelp')}</Hint>
      </div>
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
