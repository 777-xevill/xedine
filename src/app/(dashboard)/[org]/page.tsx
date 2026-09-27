import { ChefHat, ClipboardList, MonitorSmartphone, Store, Users } from 'lucide-react';
import Link from 'next/link';
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
  const has = (r: (typeof ctx.roles)[number]) => ctx.roles.includes(r);
  const base = `/${ctx.org.slug}`;

  const actions = [
    ...(ctx.isOwner || has('manager') || has('cashier')
      ? [
          {
            href: '/pos',
            icon: <MonitorSmartphone />,
            title: t('actionPos'),
            body: t('actionPosBody'),
          },
        ]
      : []),
    ...(ctx.isOwner || has('manager') || has('kitchen')
      ? [{ href: '/kds', icon: <ChefHat />, title: t('actionKds'), body: t('actionKdsBody') }]
      : []),
    ...(ctx.isOwner
      ? [
          {
            href: `${base}/menu`,
            icon: <ClipboardList />,
            title: t('actionMenu'),
            body: t('actionMenuBody'),
          },
        ]
      : []),
    ...(ctx.isOwner || has('manager')
      ? [
          {
            href: `${base}/staff`,
            icon: <Users />,
            title: t('actionStaff'),
            body: t('actionStaffBody'),
          },
          {
            href: `${base}/branch`,
            icon: <Store />,
            title: t('actionBranch'),
            body: t('actionBranchBody'),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageTitle title={t('welcome', { name: ctx.fullName })} subtitle={t('subtitle')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="text-sm font-medium text-secondary">{t('yourRole')}</h2>
          <p className="mt-1 text-xl font-bold" data-testid="role">
            {ctx.roles.map((r) => roles(r)).join(' · ')}
          </p>
        </Card>
        <Card>
          <h2 className="text-sm font-medium text-secondary">{t('yourBranches')}</h2>
          <p className="mt-1 text-xl font-bold" data-testid="branches">
            {isAllBranches ? t('everyBranch') : ctx.branches.map((b) => b.name).join(' · ')}
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5 text-sm text-secondary">
            {ctx.branches.map((b) => (
              <li key={b.id} className="glass-tile rounded-full px-2.5 py-0.5">
                {b.name}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {actions.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-bold tracking-tight">{t('quickActions')}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {actions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="glass group rounded-card p-5 transition hover:border-edge-strong"
              >
                <span
                  aria-hidden
                  className="glass-tile inline-flex size-11 items-center justify-center rounded-input text-cyan transition group-hover:text-foreground [&>svg]:size-5"
                >
                  {a.icon}
                </span>
                <p className="mt-4 font-bold">{a.title}</p>
                <p className="mt-1 text-sm text-secondary">{a.body}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <Card className="mt-8">
        <h2 className="text-lg font-bold">{t('emptyTitle')}</h2>
        <p className="mt-1 text-secondary">{t('emptyBody')}</p>
      </Card>
    </>
  );
}
