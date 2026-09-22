'use client';

import dynamic from 'next/dynamic';

// ADR 0013: the org/branch come from the paired device. Client-only, same reasoning as /pos.
const KdsApp = dynamic(() => import('@/modules/kds/KdsApp').then((m) => m.KdsApp), { ssr: false });

export default function KdsPage() {
  return <KdsApp />;
}
