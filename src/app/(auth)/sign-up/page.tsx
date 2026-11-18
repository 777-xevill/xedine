import { getTranslations } from 'next-intl/server';
import { QuickSignIn, SignUpForm } from '@/components/auth-forms';
import { parsePlanChoice, TRIAL_DAYS } from '@/components/landing-3d/pricing';
import { PlanChosen, PlanPicker } from '@/components/plan-picker';
import { Card, PageTitle } from '@/components/ui/form';
import { safeNext } from '@/modules/tenancy/form-state';
import {
  facebookSignInEnabled,
  googleSignInEnabled,
  phoneSignInEnabled,
  xSignInEnabled,
} from '@/modules/tenancy/oauth';

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; plan?: string; billing?: string }>;
}) {
  const [t, { next, plan, billing }] = await Promise.all([getTranslations('auth'), searchParams]);
  const safe = safeNext(next);
  const choice = parsePlanChoice(plan, billing);
  // Create account starts with the plans (the founder, 2026-11-19); someone joining by invite skips them.
  if (!choice && !safe?.startsWith('/accept-invite')) {
    return (
      <Card>
        <PageTitle title={t('plan.title')} subtitle={t('plan.subtitle', { days: TRIAL_DAYS })} />
        <PlanPicker next={safe} />
      </Card>
    );
  }
  return (
    <Card>
      <PageTitle title={t('signUpTitle')} subtitle={t('signUpSubtitle')} />
      {choice && <PlanChosen choice={choice} next={safe} />}
      <QuickSignIn
        next={safe}
        google={googleSignInEnabled()}
        facebook={facebookSignInEnabled()}
        x={xSignInEnabled()}
        phone={phoneSignInEnabled()}
      />
      <SignUpForm next={safe} />
    </Card>
  );
}
