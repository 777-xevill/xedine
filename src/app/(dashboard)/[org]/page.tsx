import { getTranslations } from 'next-intl/server';
import { Card, PageTitle } from '@/components/ui/form';
import { getOrgContext } from '@/modules/tenancy/context';

export default async function OverviewPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const [ctx, t, roles] = await Promise.all([
    getOrgContext(org),
    getTranslations('dashboard'),
    getTranslations('roles'),
  ]);
  const isAllBranches = ctx.branches.length > 0 && ctx.isOwner;
  return (
    <>
      <PageTitle title={t('welcome', { name: ctx.fullName })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="text-sm font-medium text-secondary">{t('yourRole')}</h2>
          <p className="mt-1 text-lg font-semibold" data-testid="role">
            {ctx.roles.map((r) => roles(r)).join(' · ')}
          </p>
        </Card>
        <Card>
          <h2 className="text-sm font-medium text-secondary">{t('yourBranches')}</h2>
          <p className="mt-1 text-lg font-semibold" data-testid="branches">
            {isAllBranches ? t('everyBranch') : ctx.branches.map((b) => b.name).join(' · ')}
          </p>
          <ul className="mt-2 text-sm text-secondary">
            {ctx.branches.map((b) => (
              <li key={b.id}>{b.name}</li>
            ))}
          </ul>
        </Card>
      </div>
      <Card className="mt-4">
        <h2 className="text-lg font-semibold">{t('emptyTitle')}</h2>
        <p className="mt-1 text-secondary">{t('emptyBody')}</p>
      </Card>
    </>
  );
}
