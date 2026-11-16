import { cn } from '@/lib/utils';

/**
 * "It worked" on the customer pages (ADR 0063): a silver ring that draws itself and a tick that follows,
 * on a soft pop. Silver is calm (BRAND.md); the words next to it say what happened.
 */
export function SuccessMark({ small = false }: { small?: boolean }) {
  return (
    <span aria-hidden className={cn('cust-done', small && 'cust-done--sm')}>
      <svg viewBox="0 0 52 52">
        <circle cx="26" cy="26" r="24" className="cust-done-ring" />
        <path d="M15.5 27l7 7 14.5-15" className="cust-done-tick" />
      </svg>
    </span>
  );
}
