-- ADR 0024: the redesigned app shows only core sections by default; the owner switches extra modules
-- (recipes, purchasing, planning, customers, reviews, branches, compliance, staff records) on in
-- Settings → Features. This is presentation only: hiding a link never changes access, which RLS and
-- the pages still decide. The allowed keys live in src/modules/tenancy/navigation.ts (validated there
-- with Zod) so a new module needs no migration; unknown keys are ignored when read.
--
-- org_settings already has RLS (read: every member; write: owner), the touch trigger and the audit
-- trigger, so a feature switch is owner-only and audited with no new policy.
alter table public.org_settings
  add column enabled_features text[] not null default '{}';

comment on column public.org_settings.enabled_features is
  'Optional modules shown in the sidebar (ADR 0024). Presentation only; keys validated in the app.';
