import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { GamesApp } from '@/components/games/games-app';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { parseGameNames } from '@/modules/games/catalog';
import { readTablePage } from '@/modules/customers/table-page-view';

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Games at the table (ADR 0046, 0047): opened from the table page. Played in the browser, no app; nothing
 * about the customer is stored. The games use fun pictures and questions (not the menu) and the names the
 * owner gave them.
 */
export default async function TableGamesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [t, page] = await Promise.all([getTranslations('tablePage'), readTablePage(token)]);
  if (!page || !page.games_on) notFound();

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 py-5">
      <header className="flex items-center justify-between gap-3">
        <Link
          href={`/t/${token}`}
          className="flex min-w-0 items-center gap-2 text-sm font-semibold text-secondary"
        >
          <ArrowLeft aria-hidden className="size-4 shrink-0" />
          <span className="truncate">{page.restaurant}</span>
        </Link>
        <LocaleSwitcher />
      </header>
      <h1 className="sr-only">{t('gamesTitle')}</h1>
      <GamesApp
        token={token}
        restaurant={page.restaurant}
        names={parseGameNames(page.game_names)}
      />
    </div>
  );
}
