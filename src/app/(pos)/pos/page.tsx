'use client';

import dynamic from 'next/dynamic';

// ADR 0013: the org/branch come from the paired device, not the URL — and localStorage/PIN state
// is client-only, so this kiosk view never needs (or wants) a server-rendered first pass.
const PosApp = dynamic(() => import('@/modules/pos/PosApp').then((m) => m.PosApp), { ssr: false });

export default function PosPage() {
  // BRAND.md: the till needs denser, higher-contrast glass than the dashboard (bright rooms, cheap tablets).
  return (
    <div data-surface="till" className="min-h-dvh">
      <PosApp />
    </div>
  );
}
