-- Ops (costs, staff-lite, licences, reviews), AI + messaging, and billing.

create type public.fixed_cost_kind as enum ('rent', 'utilities', 'gas', 'fuel', 'internet', 'other');
create type public.attendance_status as enum ('present', 'absent', 'leave', 'half_day');
create type public.review_source as enum ('google', 'facebook', 'foodpanda', 'feedback', 'other');
create type public.reply_status as enum ('draft', 'approved', 'posted', 'discarded');
create type public.ai_role as enum ('user', 'assistant', 'tool', 'system');
create type public.numeric_check_result as enum ('ok', 'retried', 'fallback', 'not_applicable');
create type public.message_channel as enum ('whatsapp', 'sms');
create type public.outbox_status as enum ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'cancelled');
create type public.template_status as enum ('draft', 'submitted', 'approved', 'rejected');
create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'canceled');

-- ---------------------------------------------------------------------------------------------
-- Ops. Salaries, advances and fixed costs are cost data: money-gated (ADR 0007).
-- ---------------------------------------------------------------------------------------------
create table public.fixed_costs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid,
  kind public.fixed_cost_kind not null,
  label text,
  monthly_poisha bigint not null check (monthly_poisha >= 0),
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  check (effective_to is null or effective_to >= effective_from)
);

create table public.salary_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  staff_id uuid not null,
  -- First day of the month the salary applies to.
  month date not null,
  salary_poisha bigint not null check (salary_poisha >= 0),
  allowances_poisha bigint not null default 0 check (allowances_poisha >= 0),
  notes text,
  unique (org_id, staff_id, month),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, staff_id) references public.staff (org_id, id) on delete cascade
);

create table public.advances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  staff_id uuid not null,
  -- Positive = advance given; negative = repayment.
  amount_poisha bigint not null check (amount_poisha <> 0),
  occurred_on date not null default current_date,
  note text,
  created_at timestamptz not null default now(),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, staff_id) references public.staff (org_id, id) on delete cascade
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  staff_id uuid not null,
  work_date date not null,
  status public.attendance_status not null default 'present',
  check_in_at timestamptz,
  check_out_at timestamptz,
  unique (org_id, staff_id, work_date),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, staff_id) references public.staff (org_id, id) on delete cascade
);

create table public.licences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid,
  -- Trade, fire, BFSA, environment, others — configurable, never a hardcoded legal list. TODO(verify).
  kind text not null,
  number text,
  issued_on date,
  expires_on date not null,
  reminder_days integer[] not null default '{60,30,7}',
  file_path text,
  notes text,
  created_at timestamptz not null default now(),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade
);
create index licences_expiry_idx on public.licences (org_id, expires_on);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid,
  source public.review_source not null,
  external_id text,
  rating numeric check (rating between 0 and 10),
  body text,
  author text,
  reviewed_at timestamptz,
  themes text[] not null default '{}',
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, source, external_id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade
);

create table public.review_replies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  review_id uuid not null,
  draft_body text not null,
  status public.reply_status not null default 'draft',
  model text,
  prompt_version text,
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (org_id, review_id) references public.reviews (org_id, id) on delete cascade,
  -- Drafts reach people only after a human approves them (CLAUDE.md #4).
  check (status not in ('approved', 'posted') or approved_at is not null)
);

-- ---------------------------------------------------------------------------------------------
-- AI conversations are private to the user who had them.
-- ---------------------------------------------------------------------------------------------
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  language text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null,
  role public.ai_role not null,
  content jsonb not null,
  numeric_check public.numeric_check_result not null default 'not_applicable',
  prompt_version text,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, conversation_id) references public.ai_conversations (org_id, id) on delete cascade
);
create index ai_messages_conv_idx on public.ai_messages (org_id, conversation_id, created_at);

create table public.ai_tool_calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null,
  message_id uuid,
  tool_name text not null,
  args jsonb not null default '{}'::jsonb,
  -- {metric_id, filters, as_of}: what the answer can cite.
  result_meta jsonb not null default '{}'::jsonb,
  duration_ms integer,
  created_at timestamptz not null default now(),
  foreign key (org_id, conversation_id) references public.ai_conversations (org_id, id) on delete cascade,
  foreign key (org_id, message_id) references public.ai_messages (org_id, id) on delete set null (message_id)
);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  usage_date date not null,
  model text not null,
  feature text not null,
  requests integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cost_usd_micros bigint not null default 0,
  unique (org_id, usage_date, model, feature)
);

create table public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  version integer not null,
  body text not null,
  model text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (key, version)
);

-- ---------------------------------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------------------------------
create table public.message_outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  channel public.message_channel not null,
  -- PII: masked in logs, never sent to an LLM.
  to_phone text not null,
  template_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.outbox_status not null default 'queued',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  provider_message_id text,
  error text,
  idempotency_key text,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (org_id, idempotency_key)
);
create index message_outbox_due_idx on public.message_outbox (status, next_attempt_at);

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  channel public.message_channel not null,
  language public.locale_code not null,
  body text not null,
  provider_template_name text,
  variables text[] not null default '{}',
  status public.template_status not null default 'draft',
  created_at timestamptz not null default now(),
  unique (key, channel, language)
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  org_id uuid,
  event_id text not null,
  payload jsonb not null,
  status text not null default 'received',
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

-- ---------------------------------------------------------------------------------------------
-- Billing (provisional plan prices: ADR 0008)
-- ---------------------------------------------------------------------------------------------
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  price_poisha_per_branch_month bigint not null check (price_poisha_per_branch_month >= 0),
  limits jsonb not null default '{}'::jsonb,
  is_active boolean not null default true
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  status public.subscription_status not null default 'trialing',
  branches_count integer not null default 1 check (branches_count > 0),
  pilot_discount_bps integer not null default 0 check (pilot_discount_bps between 0 and 10000),
  started_at timestamptz not null default now(),
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);
create index subscriptions_org_idx on public.subscriptions (org_id);

create table public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  counter text not null,
  period date not null,
  value bigint not null default 0,
  unique (org_id, counter, period)
);

create table public.feature_flags (
  key text primary key,
  description text,
  default_enabled boolean not null default false
);

create table public.org_feature_flags (
  org_id uuid not null references public.organizations (id) on delete cascade,
  key text not null references public.feature_flags (key) on delete cascade,
  enabled boolean not null,
  primary key (org_id, key)
);

insert into public.plans (code, name, price_poisha_per_branch_month, limits) values
  ('starter', 'Starter', 250000, '{"ai": false}'),
  ('growth',  'Growth',  450000, '{"ai": true}'),
  ('chain',   'Chain',   350000, '{"ai": true, "min_branches": 6}');

-- ---------------------------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_owner public.app_role[] := array['owner']::public.app_role[];
  v_money public.app_role[] := array['owner', 'accountant']::public.app_role[];
  v_mgr public.app_role[] := array['owner', 'manager']::public.app_role[];
begin
  perform private.apply_policies('fixed_costs', 'org', v_money, v_owner, true, 'money-gated (ADR 0007)');
  perform private.apply_policies('salary_entries', 'org', v_money, v_owner, true, 'money-gated (ADR 0007)');
  perform private.apply_policies('advances', 'org', v_money, v_owner, false, 'money-gated (ADR 0007)');
  perform private.apply_policies('attendance', 'branch', array['owner', 'manager', 'accountant']::public.app_role[], v_mgr);
  perform private.apply_policies('licences', 'org', array['owner', 'manager', 'accountant']::public.app_role[], v_owner, true);
  perform private.apply_policies('reviews', 'org', v_mgr, v_mgr);
  perform private.apply_policies('review_replies', 'org', v_mgr, v_mgr);
  perform private.apply_policies('ai_usage', 'org', v_owner, '{}', false, 'written by the LLM gateway (service role)');
  perform private.apply_policies('message_outbox', 'org', v_mgr, '{}', false, 'written by the messaging gateway (service role)');
  perform private.apply_policies('subscriptions', 'org', v_owner, '{}', false, 'written by billing (service role)');
  perform private.apply_policies('usage_counters', 'org', v_owner, '{}', false, 'written by jobs (service role)');
end $$;

-- Per-user AI history: only the user who had the conversation reads or writes it.
create policy ai_conversations_select on public.ai_conversations for select to authenticated
  using (user_id = (select auth.uid()) and private.is_org_member(org_id));
create policy ai_conversations_insert on public.ai_conversations for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_org_member(org_id));
create policy ai_conversations_update on public.ai_conversations for update to authenticated
  using (user_id = (select auth.uid()) and private.is_org_member(org_id))
  with check (user_id = (select auth.uid()) and private.is_org_member(org_id));
select private.register_table('ai_conversations', 'custom', 'private to the user who owns the conversation');

create policy ai_messages_select on public.ai_messages for select to authenticated
  using (user_id = (select auth.uid()) and private.is_org_member(org_id));
create policy ai_messages_insert on public.ai_messages for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_org_member(org_id));
select private.register_table('ai_messages', 'custom', 'private to the user who owns the conversation');

create policy ai_tool_calls_select on public.ai_tool_calls for select to authenticated
  using (user_id = (select auth.uid()) and private.is_org_member(org_id));
create policy ai_tool_calls_insert on public.ai_tool_calls for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_org_member(org_id));
select private.register_table('ai_tool_calls', 'custom', 'private to the user who owns the conversation');

create policy org_feature_flags_select on public.org_feature_flags for select to authenticated
  using (private.is_org_member(org_id));
select private.register_table('org_feature_flags', 'custom', 'read: members; written by the service role');

select private.register_table('prompt_versions', 'service_only');
select private.register_table('webhook_events', 'service_only');
select private.register_table('message_templates', 'platform_read');
select private.register_table('plans', 'platform_read');
select private.register_table('feature_flags', 'platform_read');

comment on table public.fixed_costs is 'Monthly fixed costs (rent, utilities, gas, fuel, internet). Money-gated. | written by: metrics | phase: 2';
comment on table public.salary_entries is 'Monthly salary and allowances per staff. Money-gated. | written by: staff | phase: 2';
comment on table public.advances is 'Staff advances ledger. Money-gated. | written by: staff | phase: 10';
comment on table public.attendance is 'Basic attendance per staff per day. | written by: staff | phase: 10';
comment on table public.licences is 'Licences with expiry reminders (60/30/7 days). | written by: compliance | phase: 10';
comment on table public.reviews is 'Imported and pasted reviews with themes. | written by: reviews | phase: 8';
comment on table public.review_replies is 'AI reply drafts; posting needs approval. | written by: reviews | phase: 8';
comment on table public.ai_conversations is 'Assistant conversations, private per user. | written by: assistant | phase: 4';
comment on table public.ai_messages is 'Messages with numeric-validator outcome. | written by: assistant | phase: 4';
comment on table public.ai_tool_calls is 'Tool calls with the metric_id/filters/as_of they cite. | written by: assistant | phase: 4';
comment on table public.ai_usage is 'Tokens and cost per org per day per model. | written by: llm-gateway | phase: 3';
comment on table public.prompt_versions is 'Versioned prompts. Platform, service-only. | written by: llm-gateway | phase: 3';
comment on table public.message_outbox is 'Outbound WhatsApp/SMS queue with retries. | written by: messaging | phase: 4';
comment on table public.message_templates is 'Approved message templates. Platform reference data. | written by: messaging | phase: 4';
comment on table public.webhook_events is 'Inbound webhook log, idempotent per provider event. Service-only. | written by: messaging | phase: 4';
comment on table public.plans is 'Billing plans (provisional prices, ADR 0008). Platform. | written by: billing | phase: 10';
comment on table public.subscriptions is 'Org subscription and pilot discount. | written by: billing | phase: 10';
comment on table public.usage_counters is 'Plan usage counters. | written by: billing | phase: 10';
comment on table public.feature_flags is 'Platform feature flags. | written by: billing | phase: 10';
comment on table public.org_feature_flags is 'Per-org feature flag overrides. | written by: billing | phase: 10';
