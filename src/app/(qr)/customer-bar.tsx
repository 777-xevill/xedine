import { LocaleSwitcher } from '@/components/locale-switcher';
import { cn } from '@/lib/utils';

/**
 * The customer pages' top bar (ADR 0063): clear over the page's top, frosted grey glass once the page
 * slides under it. With `fold`, its title waits until the page's own large title has scrolled away
 * (Apple's large title); browsers without scroll timelines simply show it.
 */
export function CustomerBar({
  children,
  fold = false,
}: {
  children?: React.ReactNode;
  fold?: boolean;
}) {
  return (
    <header className={cn('cust-bar', fold && 'cust-bar--fold')}>
      <div className="cust-bar-title">{children}</div>
      <LocaleSwitcher />
    </header>
  );
}
