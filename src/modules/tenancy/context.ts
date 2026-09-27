import 'server-only';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { createClient } from '@/lib/db/supabase-server';

export type Role = 'owner' | 'manager' | 'cashier' | 'kitchen' | 'purchaser' | 'accountant';

export interface OrgContext {
  user: { id: string; email: string };
  fullName: string;
  org: { id: string; name: string; slug: string };
  /** Every role the user holds in this org (one membership per role). */
  roles: Role[];
  isOwner: boolean;
  /** Only branches this user can access; RLS has already filtered them. */
  branches: { id: string; name: string }[];
  /** null = all branches. */
  selectedBranchId: string | null;
  allOrgs: { name: string; slug: string }[];
}

/** Resolve the signed-in user and the org in the URL. Everything comes through RLS, so a stranger's slug is a 404. */
export const getOrgContext = cache(async (slug: string): Promise<OrgContext> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/${slug}`)}`);

  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .order('name');
  const org = orgs?.find((o) => o.slug === slug);
  if (!org) notFound();

  const [{ data: memberships }, { data: branches }, { data: profile }] = await Promise.all([
    supabase
      .from('memberships')
      .select('role')
      .eq('org_id', org.id)
      .eq('user_id', user.id)
      .eq('status', 'active'),
    supabase
      .from('branches')
      .select('id, name')
      .eq('org_id', org.id)
      .eq('is_active', true)
      .order('name'),
    supabase.from('profiles').select('full_name').eq('user_id', user.id).maybeSingle(),
  ]);
  const roles = (memberships ?? []).map((m) => m.role as Role);
  if (roles.length === 0) notFound();

  const cookieBranch = (await cookies()).get(`xedine_branch_${slug}`)?.value;
  const selectedBranchId = branches?.some((b) => b.id === cookieBranch)
    ? (cookieBranch as string)
    : null;

  return {
    user: { id: user.id, email: user.email ?? '' },
    fullName: profile?.full_name ?? user.email ?? '',
    org,
    roles,
    isOwner: roles.includes('owner'),
    branches: branches ?? [],
    selectedBranchId,
    allOrgs: (orgs ?? []).map((o) => ({ name: o.name, slug: o.slug })),
  };
});

/** The branch a branch-level page works on: ?branch=, else the header's selection, else the first. */
export function pickBranch(
  ctx: OrgContext,
  requested?: string,
): { id: string; name: string } | null {
  return (
    ctx.branches.find((b) => b.id === requested) ??
    ctx.branches.find((b) => b.id === ctx.selectedBranchId) ??
    ctx.branches[0] ??
    null
  );
}
