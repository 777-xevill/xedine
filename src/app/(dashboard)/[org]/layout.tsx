import { AppHeader } from '@/components/app-header';
import { getOrgContext } from '@/modules/tenancy/context';

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const ctx = await getOrgContext(org);
  return (
    <>
      <AppHeader ctx={ctx} />
      <main className="mx-auto max-w-6xl px-4 py-10">{children}</main>
    </>
  );
}
