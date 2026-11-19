-- X7 and the assistant that acts (ADR 0067).
--
--  1. X7, the strongest model, is counted per restaurant per week: the plans' `x7_per_week` (the home page's
--     pricing: Starter 3, Pro 20; Growth and Chain are this database's Pro). One X7 question = one use,
--     however many tools it calls. The week is the business week starting Monday (the restaurant's business
--     date, as Settings → Usage counts the daily AI allowance). `use_x7` counts a question atomically and
--     refuses past the limit; `x7_allowance` is what the composer and Usage show. Both for the roles that
--     may chat (owner, manager, accountant).
--  2. `ai_actions`: changes the assistant prepared in a chat ("add Chicken Tehari at ৳220", "a party of 40 on
--     Friday"). Nothing changes when they are written: the person who asked sees them as a list and taps
--     "Do these changes" (CLAUDE.md #4). The app then makes each change through the same RPC or table write
--     the page would use, with that person's own session, so RLS, roles and the usual audit apply; the row
--     moves proposed → running → done | failed, or proposed → dismissed (`decide_ai_action`, audited when done).
--     A proposal is good for 24 hours. Private to the person who asked, like the conversation.
--  3. `numeric_check_result` gains 'general': an answer whose money amounts and percentages all come from the
--     tools, with other figures from general knowledge (a cooking temperature, a recipe's cups of yoghurt).
--     It is shown as "general knowledge", never as "verified".

alter type public.numeric_check_result add value if not exists 'general';

-- ---------------------------------------------------------------------------------------------
-- 1. X7 per week
-- ---------------------------------------------------------------------------------------------
update public.plans set limits = limits || jsonb_build_object('x7_per_week',
  case code when 'starter' then 3 when 'growth' then 20 when 'chain' then 20 else 0 end);

-- Monday of the business week p_now falls in.
create function private.x7_week(p_now timestamptz) returns date
language sql stable set search_path = '' as $$
  select date_trunc('week', private.business_date(p_now, 240)::timestamp)::date
$$;

create function private.x7_per_week(p_org uuid, p_now timestamptz) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select case when private.plan_allows(p_org, 'ai', p_now)
                               then coalesce((x.limits ->> 'x7_per_week')::integer, 0) else 0 end
                     from private.org_plan(p_org, p_now) x), 0)
$$;

create function public.x7_allowance(p_org uuid, p_now timestamptz)
returns table (per_week integer, used integer, left_count integer, resets_on date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_week date := private.x7_week(p_now);
  v_per integer;
  v_used integer;
begin
  if not private.is_service_role()
     and not private.has_role(p_org, array['owner', 'manager', 'accountant']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  v_per := private.x7_per_week(p_org, p_now);
  select coalesce((select c.value from public.usage_counters c
                    where c.org_id = p_org and c.counter = 'x7_questions' and c.period = v_week), 0)::integer
    into v_used;
  return query select v_per, v_used, greatest(0, v_per - v_used), v_week + 7;
end $$;

-- Counts one X7 question; false when the week's X7 is used up (or the plan has none). The assistant counts it,
-- with the asker's session, after X7 has answered. Only the roles that may chat can count; calling it by hand
-- only uses up one's own restaurant's allowance.
create function public.use_x7(p_org uuid, p_now timestamptz) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_week date := private.x7_week(p_now);
  v_per integer;
  v_value bigint;
begin
  if not private.is_service_role()
     and not private.has_role(p_org, array['owner', 'manager', 'accountant']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  v_per := private.x7_per_week(p_org, p_now);
  if v_per <= 0 then
    return false;
  end if;
  insert into public.usage_counters as c (org_id, counter, period, value)
  values (p_org, 'x7_questions', v_week, 1)
  on conflict (org_id, counter, period) do update set value = c.value + 1 where c.value < v_per
  returning c.value into v_value;
  return v_value is not null;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Changes the assistant prepared
-- ---------------------------------------------------------------------------------------------
create type public.ai_action_status as enum ('proposed', 'running', 'done', 'failed', 'dismissed');

create table public.ai_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null,
  message_id uuid not null,
  -- Its place in the list the person sees.
  seq smallint not null constraint ai_actions_seq check (seq between 0 and 49),
  kind text not null constraint ai_actions_kind check (kind ~ '^[a-z][a-z_]{2,39}$'),
  -- What the app will send (ids already resolved), and what the list shows (names, amounts in minor units).
  params jsonb not null constraint ai_actions_params check (jsonb_typeof(params) = 'object' and pg_column_size(params) <= 8000),
  view jsonb not null default '{}'::jsonb
    constraint ai_actions_view check (jsonb_typeof(view) = 'object' and pg_column_size(view) <= 8000),
  model text constraint ai_actions_model check (char_length(model) <= 80),
  status public.ai_action_status not null default 'proposed',
  -- The errors.* key when it failed.
  error text constraint ai_actions_error check (char_length(error) <= 60),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (org_id, id),
  unique (message_id, seq),
  foreign key (org_id, conversation_id) references public.ai_conversations (org_id, id) on delete cascade,
  foreign key (org_id, message_id) references public.ai_messages (org_id, id) on delete cascade
);
create index ai_actions_message_idx on public.ai_actions (org_id, message_id);

create policy ai_actions_select on public.ai_actions for select to authenticated
  using (user_id = (select auth.uid()) and private.is_org_member(org_id));
create policy ai_actions_insert on public.ai_actions for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_org_member(org_id)
              and status = 'proposed' and decided_at is null and error is null);
select private.register_table('ai_actions', 'custom',
  'private to the user who asked; inserted as proposed, moved only by decide_ai_action (ADR 0067)');
comment on table public.ai_actions is
  'Changes the assistant prepared in a chat, made only when the person taps "Do these changes". | written by: assistant | phase: 4';

-- proposed → running | dismissed, running → done | failed. Only the person who asked, within 24 hours of the
-- proposal; a change made is audited with what was sent.
create function public.decide_ai_action(p_id uuid, p_status public.ai_action_status, p_error text,
                                        p_now timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.ai_actions;
begin
  select * into a from public.ai_actions where id = p_id for update;
  if not found or a.user_id is distinct from (select auth.uid()) or not private.is_org_member(a.org_id) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if not ((a.status = 'proposed' and p_status in ('running', 'dismissed'))
          or (a.status = 'running' and p_status in ('done', 'failed'))) then
    raise exception 'ai_action_state' using errcode = 'invalid_parameter_value';
  end if;
  if p_status = 'running' and a.created_at < p_now - interval '24 hours' then
    raise exception 'ai_action_expired' using errcode = 'invalid_parameter_value';
  end if;
  update public.ai_actions
     set status = p_status,
         error = case when p_status = 'failed' then left(coalesce(p_error, 'failed'), 60) end,
         decided_at = case when p_status = 'running' then null else p_now end
   where id = p_id;
  if p_status = 'done' then
    perform private.write_audit(a.org_id, null, 'ai.action', 'ai_action', a.id::text, null,
      jsonb_build_object('kind', a.kind, 'params', a.params, 'model', a.model),
      'prepared by the assistant, approved in the chat', null, null);
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------
revoke execute on function private.x7_week(timestamptz) from public, anon, authenticated;
revoke execute on function private.x7_per_week(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.x7_allowance(uuid, timestamptz) from public, anon;
grant execute on function public.x7_allowance(uuid, timestamptz) to authenticated, service_role;
revoke execute on function public.use_x7(uuid, timestamptz) from public, anon;
grant execute on function public.use_x7(uuid, timestamptz) to authenticated, service_role;
revoke execute on function public.decide_ai_action(uuid, public.ai_action_status, text, timestamptz) from public, anon;
grant execute on function public.decide_ai_action(uuid, public.ai_action_status, text, timestamptz)
  to authenticated, service_role;

comment on function public.x7_allowance is
  'X7 questions this business week: the plan''s allowance, used, left, and the Monday it resets (owner, manager, accountant). ADR 0067.';
comment on function public.use_x7 is 'Counts one X7 question for the week; false when none are left (owner, manager, accountant). ADR 0067.';
comment on function public.decide_ai_action is
  'Moves an assistant-prepared change: proposed → running/dismissed, running → done/failed; the asker only, 24 h. ADR 0067.';
