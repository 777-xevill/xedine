'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/db/supabase-server';
import { publicEnv } from '@/lib/env';
import { isLocale } from '@/lib/i18n/format';
import { LOCALE_COOKIE, resolveLocale } from '@/lib/i18n/request';
import { mapDbError, safeNext, type FormState } from './form-state';

const ROLES = ['manager', 'cashier', 'kitchen', 'purchaser', 'accountant'] as const;
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

const credentials = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = credentials
    .extend({ fullName: z.string().trim().min(1).max(120) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: parsed.error.issues.some((i) => i.path[0] === 'password')
        ? 'weakPassword'
        : 'invalidInput',
    };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.fullName } },
  });
  if (error)
    return {
      error:
        error.code === 'user_already_exists' || /already/i.test(error.message)
          ? 'emailTaken'
          : 'generic',
    };
  if (!data.session) return { ok: true, message: 'checkEmail' };
  redirect(safeNext(formData.get('next')) ?? '/onboarding');
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidCredentials' };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: 'invalidCredentials' };
  redirect(safeNext(formData.get('next')) ?? '/');
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/sign-in');
}

const orgSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().toLowerCase().regex(SLUG),
});

export async function createOrganizationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = orgSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return {
      error: parsed.error.issues.some((i) => i.path[0] === 'slug') ? 'slugInvalid' : 'invalidInput',
    };

  const names = formData.getAll('branchName').map(String);
  const areas = formData.getAll('branchArea').map(String);
  const branches = names
    .map((name, i) => ({ name: name.trim(), area: (areas[i] ?? '').trim() }))
    .filter((b) => b.name !== '');
  if (branches.length === 0) return { error: 'invalidInput' };

  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc('create_organization', {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_branches: branches,
    p_locale: await resolveLocale(),
  });
  if (error) return { error: mapDbError(error) };
  // Day-one channels, reason codes and a kitchen station, so the till works immediately (ADR 0014).
  const { error: defaultsError } = await supabase.rpc('ensure_org_defaults', {
    p_org: orgId as string,
  });
  if (defaultsError) console.error('ensure_org_defaults', defaultsError.code);
  redirect(`/${parsed.data.slug}`);
}

const inviteSchema = z.object({
  orgId: z.uuid(),
  orgSlug: z.string().regex(SLUG),
  email: z.email(),
  role: z.enum(ROLES),
});

export async function inviteMemberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const branchIds = formData
    .getAll('branchIds')
    .map(String)
    .filter((id) => z.uuid().safeParse(id).success);
  if (parsed.data.role !== 'accountant' && branchIds.length === 0) return { error: 'invalidInput' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_invitation', {
    p_org: parsed.data.orgId,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
    p_branch_ids: parsed.data.role === 'accountant' ? [] : branchIds,
  });
  if (error) return { error: mapDbError(error) };
  const token = (data as { token?: string } | null)?.token;
  if (!token) return { error: 'generic' };

  revalidatePath(`/${parsed.data.orgSlug}/team`);
  return {
    ok: true,
    data: { link: `${publicEnv().NEXT_PUBLIC_SITE_URL}/accept-invite?token=${token}` },
  };
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const id = z.uuid().safeParse(formData.get('invitationId'));
  const slug = z.string().regex(SLUG).safeParse(formData.get('orgSlug'));
  if (!id.success || !slug.success) return;
  const supabase = await createClient();
  await supabase.rpc('revoke_invitation', { p_invitation: id.data });
  revalidatePath(`/${slug.data}/team`);
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const id = z.uuid().safeParse(formData.get('membershipId'));
  const slug = z.string().regex(SLUG).safeParse(formData.get('orgSlug'));
  if (!id.success || !slug.success) return;
  const supabase = await createClient();
  await supabase.rpc('remove_membership', { p_membership: id.data });
  revalidatePath(`/${slug.data}/team`);
}

export async function acceptInvitationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = z.string().min(20).max(200).safeParse(formData.get('token'));
  if (!token.success) return { error: 'inviteInvalid' };
  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc('accept_invitation', { p_token: token.data });
  if (error) return { error: mapDbError(error) };
  const { data: org } = await supabase
    .from('organizations')
    .select('slug')
    .eq('id', orgId as string)
    .single();
  redirect(org ? `/${org.slug}` : '/');
}

const settingsSchema = z.object({
  orgId: z.uuid(),
  orgSlug: z.string().regex(SLUG),
  priceIncludesVat: z.enum(['true', 'false']),
  vatRate: z.coerce.number().min(0).max(100),
  serviceCharge: z.coerce.number().min(0).max(100),
  cutoff: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  weekStart: z.coerce.number().int().min(0).max(6),
});

export async function updateSettingsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: 'invalidInput' };
  const [hh, mm] = parsed.data.cutoff.split(':').map(Number) as [number, number];

  const supabase = await createClient();
  const { error, data } = await supabase
    .from('org_settings')
    .update({
      price_includes_vat: parsed.data.priceIncludesVat === 'true',
      // Percent → basis points, rounded so 12.5% is exactly 1250.
      vat_rate_bps: Math.round(parsed.data.vatRate * 100),
      service_charge_bps: Math.round(parsed.data.serviceCharge * 100),
      default_cutoff_minutes: hh * 60 + mm,
      week_start: parsed.data.weekStart,
    })
    .eq('org_id', parsed.data.orgId)
    .select('org_id');
  if (error) return { error: mapDbError(error) };
  if (!data || data.length === 0) return { error: 'notAllowed' };
  revalidatePath(`/${parsed.data.orgSlug}`, 'layout');
  return { ok: true };
}

export async function setLocaleAction(formData: FormData): Promise<void> {
  const locale = formData.get('locale');
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) await supabase.from('profiles').update({ locale }).eq('user_id', user.id);
  revalidatePath('/', 'layout');
}

export async function setBranchAction(formData: FormData): Promise<void> {
  const slug = z.string().regex(SLUG).safeParse(formData.get('orgSlug'));
  const branch = z.union([z.literal('all'), z.uuid()]).safeParse(formData.get('branchId'));
  if (!slug.success || !branch.success) return;
  (await cookies()).set(`xedine_branch_${slug.data}`, branch.data, {
    path: '/',
    maxAge: 60 * 60 * 24 * 90,
    sameSite: 'lax',
  });
  revalidatePath(`/${slug.data}`, 'layout');
}
