import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { GamesApp } from '@/components/games/games-app';
import { parseGameNames } from '@/modules/games/catalog';
import { readTablePage } from '@/modules/customers/table-page-view';
import { CustomerBar } from '../../../customer-bar';

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
    <div className="cust-page mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 pb-8">
      <CustomerBar>
        <Link href={`/t/${token}`} className="cust-back">
          <span className="cust-back-icon">
            <ArrowLeft aria-hidden className="size-4" />
          </span>
          <span className="truncate">{page.restaurant}</span>
        </Link>
      </CustomerBar>
      <h1 className="sr-only">{t('gamesTitle')}</h1>
      <GamesApp
        token={token}
        restaurant={page.restaurant}
        names={parseGameNames(page.game_names)}
      />
    </div>
  );
}
