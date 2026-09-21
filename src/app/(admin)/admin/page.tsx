import { SurfacePlaceholder } from '@/components/surface-placeholder';

/** Platform admins have no tenant data access by default (ARCHITECTURE.md); this shell holds no data. */
export default function AdminPage() {
  return <SurfacePlaceholder titleKey="adminTitle" phase={10} bodyKey="adminBody" />;
}
