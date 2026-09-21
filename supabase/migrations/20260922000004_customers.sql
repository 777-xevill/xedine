-- Customers, consent, feedback, campaigns. PII care (CLAUDE.md #8): phones/names are consent-flagged,
-- masked in logs and excluded from LLM prompts unless essential. Accountants do not read customer PII.

create type public.consent_channel as enum ('whatsapp', 'sms');
create type public.consent_purpose as enum ('transactional', 'marketing');
create type public.campaign_kind as enum ('thank_you', 'second_visit', 'win_back', 'custom');
create type public.campaign_status as enum ('draft', 'approved', 'running', 'paused', 'done');
create type public.send_status as enum ('queued', 'sent', 'delivered', 'read', 'failed', 'suppressed');

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- E.164, e.g. +8801712345678. Visits are derived from orders, not stored here.
  phone text not null,
  name text,
  notes text,
  first_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, phone)
);
create trigger customers_touch before update on public.customers for each row execute function private.touch_updated_at();

alter table public.orders
  add constraint orders_customer_fk foreign key (org_id, customer_id)
  references public.customers (org_id, id) on delete set null (customer_id);
create index orders_customer_idx on public.orders (org_id, customer_id) where customer_id is not null;

-- One row per consent change; the latest row per (customer, channel, purpose) wins.
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  channel public.consent_channel not null,
  purpose public.consent_purpose not null,
  granted boolean not null,
  source text,
  recorded_by_staff_id uuid,
  recorded_at timestamptz not null default now(),
  foreign key (org_id, customer_id) references public.customers (org_id, id) on delete cascade,
  foreign key (org_id, recorded_by_staff_id) references public.staff (org_id, id) on delete set null (recorded_by_staff_id)
);
create index consents_customer_idx on public.consents (org_id, customer_id, channel, purpose, recorded_at desc);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  order_id uuid,
  customer_id uuid,
  -- The link sent after payment carries an unguessable token; only its hash is stored.
  token_hash text unique,
  rating smallint check (rating between 0 and 10),
  comment text,
  sent_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, order_id) references public.orders (org_id, id) on delete set null (order_id),
  foreign key (org_id, customer_id) references public.customers (org_id, id) on delete set null (customer_id)
);
create index feedback_branch_idx on public.feedback (org_id, branch_id, submitted_at desc);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  kind public.campaign_kind not null default 'custom',
  status public.campaign_status not null default 'draft',
  template_key text,
  audience jsonb not null default '{}'::jsonb,
  holdout_pct integer not null default 10 check (holdout_pct between 0 and 50),
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);
create trigger campaigns_touch before update on public.campaigns for each row execute function private.touch_updated_at();

create table public.campaign_sends (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  campaign_id uuid not null,
  customer_id uuid not null,
  status public.send_status not null default 'queued',
  is_holdout boolean not null default false,
  outbox_id uuid,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (org_id, campaign_id) references public.campaigns (org_id, id) on delete cascade,
  foreign key (org_id, customer_id) references public.customers (org_id, id) on delete cascade
);
create index campaign_sends_campaign_idx on public.campaign_sends (org_id, campaign_id);

create table public.holdouts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  campaign_id uuid not null,
  customer_id uuid not null,
  assigned_at timestamptz not null default now(),
  unique (campaign_id, customer_id),
  foreign key (org_id, campaign_id) references public.campaigns (org_id, id) on delete cascade,
  foreign key (org_id, customer_id) references public.customers (org_id, id) on delete cascade
);

do $$
declare
  v_pii_read public.app_role[] := array['owner', 'manager', 'cashier']::public.app_role[];
  v_mgr public.app_role[] := array['owner', 'manager']::public.app_role[];
begin
  perform private.apply_policies('customers', 'org', v_pii_read, v_pii_read, false, 'PII: accountants excluded');
  perform private.apply_policies('consents', 'org', v_pii_read, v_pii_read, false, 'append a row per change');
  perform private.apply_policies('feedback', 'branch', v_mgr, '{}', false, 'submitted through a public link by the service role');
  perform private.apply_policies('campaigns', 'org', v_mgr, v_mgr);
  perform private.apply_policies('campaign_sends', 'org', v_mgr, '{}', false, 'written by messaging jobs');
  perform private.apply_policies('holdouts', 'org', v_mgr, '{}', false, 'written by messaging jobs');
end $$;

comment on table public.customers is 'Customer by phone (+880), PII. | written by: customers | phase: 8';
comment on table public.consents is 'Consent history per channel and purpose. | written by: customers | phase: 8';
comment on table public.feedback is 'Post-meal rating 0-10 and comment via link. | written by: customers | phase: 8';
comment on table public.campaigns is 'Retention campaigns with holdout share. | written by: customers | phase: 8';
comment on table public.campaign_sends is 'Per-customer send record incl. holdout flag. | written by: messaging | phase: 8';
comment on table public.holdouts is 'Customers withheld to measure real lift. | written by: messaging | phase: 8';
