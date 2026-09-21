-- Planning (calendar, forecasts, bazar lists) and Intelligence (findings, insight feed, benchmarks).
-- Findings carry ৳ impact, so they are money-gated: owner + accountant only (ADR 0007).

create type public.calendar_kind as enum (
  'ramadan', 'iftar_window', 'eid', 'holiday', 'salary_week', 'weather', 'hartal', 'cricket', 'custom'
);
create type public.forecast_scope as enum ('item_group', 'branch');
create type public.bazar_status as enum ('draft', 'approved', 'sent', 'reconciled');
create type public.confidence_level as enum ('low', 'medium', 'high');
create type public.finding_status as enum ('new', 'acknowledged', 'snoozed', 'resolved', 'dismissed');
create type public.insight_status as enum ('queued', 'shown', 'snoozed', 'dismissed');

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  kind public.calendar_kind not null default 'custom',
  starts_on date not null,
  ends_on date not null,
  note text,
  -- TODO(verify): religious and national dates are seeded estimates until confirmed each year.
  source text,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index calendar_events_org_date_idx on public.calendar_events (org_id, starts_on, ends_on);

create table public.forecasts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  menu_item_id uuid not null,
  business_date date not null,
  daypart text not null,
  forecast_qty numeric not null check (forecast_qty >= 0),
  model_version text not null,
  generated_at timestamptz not null default now(),
  unique (org_id, branch_id, menu_item_id, business_date, daypart, model_version),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, menu_item_id) references public.menu_items (org_id, id) on delete cascade
);

create table public.forecast_accuracy (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid,
  scope public.forecast_scope not null,
  scope_key text not null,
  window_days integer not null default 28,
  wape numeric,
  naive_wape numeric,
  -- METRICS.md: show the model forecast only if WAPE improves ≥ 10% vs the naive baseline.
  is_shown boolean not null default false,
  computed_on date not null default current_date,
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade
);

create table public.bazar_lists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  for_date date not null,
  status public.bazar_status not null default 'draft',
  generated_at timestamptz not null default now(),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  notes text,
  unique (org_id, id),
  unique (org_id, branch_id, for_date),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade
);

create table public.bazar_list_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  bazar_list_id uuid not null,
  ingredient_id uuid not null,
  supplier_id uuid,
  suggested_qty_base numeric not null check (suggested_qty_base >= 0),
  approved_qty_base numeric check (approved_qty_base >= 0),
  note text,
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, bazar_list_id) references public.bazar_lists (org_id, id) on delete cascade,
  foreign key (org_id, ingredient_id) references public.ingredients (org_id, id) on delete restrict,
  foreign key (org_id, supplier_id) references public.suppliers (org_id, id) on delete set null (supplier_id)
);

-- ---------------------------------------------------------------------------------------------
-- Intelligence
-- ---------------------------------------------------------------------------------------------
create table public.findings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid,
  type text not null,
  period_start date not null,
  period_end date not null,
  impact_poisha bigint not null,
  confidence public.confidence_level not null default 'medium',
  status public.finding_status not null default 'new',
  reason text,
  snoozed_until date,
  novelty numeric not null default 1,
  detector_version text,
  metric_refs jsonb not null default '[]'::jsonb,
  suggested_actions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  check (period_end >= period_start)
);
create index findings_org_status_idx on public.findings (org_id, status, impact_poisha desc);
create trigger findings_touch before update on public.findings for each row execute function private.touch_updated_at();

create table public.finding_evidence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  finding_id uuid not null,
  evidence_type text not null,
  ref_table text,
  ref_id uuid,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (org_id, finding_id) references public.findings (org_id, id) on delete cascade
);
create index finding_evidence_finding_idx on public.finding_evidence (org_id, finding_id);

create table public.insight_feed (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  finding_id uuid,
  headline_key text not null,
  payload jsonb not null default '{}'::jsonb,
  rank numeric not null default 0,
  shown_on date,
  status public.insight_status not null default 'queued',
  dismissed_reason text,
  created_at timestamptz not null default now(),
  foreign key (org_id, finding_id) references public.findings (org_id, id) on delete cascade
);
create index insight_feed_org_idx on public.insight_feed (org_id, status, rank desc);

-- Cross-tenant aggregates only. No org_id: a snapshot cannot point at a tenant, and the k ≥ 5 rule
-- is enforced structurally so no row can describe fewer than five restaurants (ADR / METRICS.md).
create table public.benchmark_snapshots (
  id uuid primary key default gen_random_uuid(),
  period date not null,
  segment jsonb not null,
  metric_id text not null,
  p25 numeric,
  p50 numeric,
  p75 numeric,
  k integer,
  is_reference boolean not null default false,
  source_note text,
  created_at timestamptz not null default now(),
  -- "industry reference" seed ranges are labelled and exempt; every peer-derived row needs k >= 5.
  -- coalesce: a CHECK passes on NULL, so a missing k must not slip through.
  constraint benchmark_min_peers check (is_reference or coalesce(k, 0) >= 5)
);
create index benchmark_snapshots_lookup_idx on public.benchmark_snapshots (metric_id, period);

do $$
declare
  v_owner public.app_role[] := array['owner']::public.app_role[];
  v_ops public.app_role[] := array['owner', 'manager', 'kitchen', 'purchaser', 'accountant']::public.app_role[];
  v_bazar public.app_role[] := array['owner', 'manager', 'kitchen', 'purchaser']::public.app_role[];
  v_money public.app_role[] := array['owner', 'accountant']::public.app_role[];
begin
  perform private.apply_policies('calendar_events', 'org', private.roles_all(), v_owner, true);
  perform private.apply_policies('forecasts', 'branch', v_ops, '{}', false, 'written by forecasting jobs');
  perform private.apply_policies('forecast_accuracy', 'org', v_money, '{}', false, 'written by forecasting jobs');
  perform private.apply_policies('bazar_lists', 'branch', v_bazar, array['owner', 'manager', 'purchaser']::public.app_role[]);
  perform private.apply_policies('bazar_list_lines', 'branch', v_bazar, array['owner', 'manager', 'purchaser']::public.app_role[]);
  perform private.apply_policies('findings', 'org', v_money, v_owner, false, 'inserted by detectors (service role); owner updates workflow fields only');
  perform private.apply_policies('finding_evidence', 'org', v_money, '{}', false, 'written by detectors');
  perform private.apply_policies('insight_feed', 'org', v_money, v_owner);
end $$;

-- Owners may only move a finding through its workflow; the analytics fields are the detector's.
revoke update on public.findings from authenticated;
grant update (status, reason, snoozed_until) on public.findings to authenticated;
revoke update on public.insight_feed from authenticated;
grant update (status, dismissed_reason, shown_on) on public.insight_feed to authenticated;
-- insight_feed rows are created by jobs, never by clients.
drop policy insight_feed_insert on public.insight_feed;
revoke insert, delete, truncate on public.insight_feed from authenticated;
revoke insert, delete, truncate on public.findings from authenticated;
drop policy findings_insert on public.findings;

select private.register_table('benchmark_snapshots', 'platform_read', 'aggregates only; k >= 5 enforced by CHECK');

comment on table public.calendar_events is 'Ramadan, Eid, holidays, salary week, manual flags (rain, hartal, cricket). | written by: forecasting | phase: 7';
comment on table public.forecasts is 'Item x daypart x branch forecast per model version. | written by: forecasting | phase: 7';
comment on table public.forecast_accuracy is 'WAPE vs naive baseline; is_shown gates display. | written by: forecasting | phase: 7';
comment on table public.bazar_lists is 'Tomorrow''s bazar list draft, approval and send state. | written by: purchasing | phase: 7';
comment on table public.bazar_list_lines is 'Suggested and approved quantities per ingredient/supplier. | written by: purchasing | phase: 7';
comment on table public.findings is 'Leak/anomaly findings with ৳ impact, confidence and workflow status. Money-gated. | written by: leaks | phase: 2';
comment on table public.finding_evidence is 'Evidence rows behind each finding. Money-gated. | written by: leaks | phase: 2';
comment on table public.insight_feed is 'Ranked proactive insights; max 3 per owner per day. | written by: assistant | phase: 4';
comment on table public.benchmark_snapshots is 'Anonymised percentile snapshots, k >= 5 or labelled reference. Platform table. | written by: benchmarking | phase: 9';
