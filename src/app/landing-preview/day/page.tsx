import type { Metadata } from 'next';
import { DayPage } from '@/components/landing-3d/day-page';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The 3D day's preview (ADR 0064), now also the home page; `?country=GB` tries another market. */
export default async function DayPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string }>;
}) {
  const { country } = await searchParams;
  return <DayPage country={country} />;
}
