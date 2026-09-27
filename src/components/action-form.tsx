'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { Alert } from '@/components/ui/form';
import { initialState, type FormState } from '@/modules/tenancy/form-state';
import { cn } from '@/lib/utils';

/**
 * A server-action form with its error/success alert. Children are plain fields and a submit button,
 * so pages stay server components; React resets the fields after a successful submit.
 */
export function ActionForm({
  action,
  children,
  className,
  successKey,
  testId,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
  /** Full message key shown after success, e.g. "common.saved". */
  successKey?: string;
  testId?: string;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, initialState);
  const success = state.message ? `common.${state.message}` : successKey;
  return (
    <form action={formAction} aria-busy={pending} data-testid={testId} className={cn(className)}>
      {state.error ? (
        <Alert tone="danger" className="col-span-full">
          {t(`errors.${state.error}`, state.data)}
        </Alert>
      ) : null}
      {state.ok && success ? (
        <Alert tone="success" className="col-span-full">
          {t(success, state.data)}
        </Alert>
      ) : null}
      {children}
    </form>
  );
}
