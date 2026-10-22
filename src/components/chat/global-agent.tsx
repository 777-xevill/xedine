'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { pageKeyFromPath } from '@/modules/tenancy/page-key';
import { PageAgent } from './page-agent';

/** Pages that carry their own, richer helper (or are the chat itself). */
const OWN_HELPER = new Set(['sales', 'stock', 'recipes', 'chat']);

/**
 * The assistant on every dashboard page, one tap away. It lives in the layout, so an open
 * conversation follows the person from page to page, and each question carries the page they are
 * on. The first tap asks what matters on that page; the chips cover the whole restaurant.
 */
export function GlobalAgent({
  orgId,
  orgSlug,
  aiOn,
  canSeeMoney,
}: {
  orgId: string;
  orgSlug: string;
  aiOn: boolean;
  canSeeMoney: boolean;
}) {
  const t = useTranslations('agent');
  const tn = useTranslations('nav');
  const key = pageKeyFromPath(orgSlug, usePathname());
  if (key && OWN_HELPER.has(key)) return null;

  const todo = t('global.todo');
  const summaryQuestion = key && key !== 'home' ? t('global.page', { page: tn(key) }) : todo;
  const followUps = [
    todo,
    ...(canSeeMoney ? [t('global.leaks')] : []),
    t('global.sales'),
    t('global.stock'),
    t('global.tour'),
  ].filter((q) => q !== summaryQuestion);

  return (
    <>
      <div className="h-20" aria-hidden />
      <PageAgent
        orgId={orgId}
        orgSlug={orgSlug}
        aiOn={aiOn}
        {...(key ? { page: key } : {})}
        labels={{
          open: t('global.open'),
          title: t('global.title'),
          subtitle: t('global.subtitle'),
          placeholder: t('global.placeholder'),
        }}
        summaryQuestion={summaryQuestion}
        followUps={followUps}
      />
    </>
  );
}
