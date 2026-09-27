import { SurfacePlaceholder } from '@/components/surface-placeholder';

/** Optional QR table ordering is deferred past Pilot gate A (ADR 0014 §6). */
export default function QrTablePage() {
  return <SurfacePlaceholder titleKey="qrTitle" bodyKey="qrBody" />;
}
