-- Phase 4 (ADR 0017): the owner assistant's data access, the insight feed, and the WhatsApp rhythm.

-- ---------------------------------------------------------------------------------------------
-- Jobs and webhooks read metrics as the service role, always for one explicit org (CLAUDE.md #2).
-- A signed-in person still goes through branch access and can_see_money exactly as before.
-- ---------------------------------------------------------------------------------------------
create function private.is_service_role() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
$$;

create or replace function private.metric_scope(p_org uuid, p_branch uuid) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid[];
begin
  if private.is_service_role() then
    select coalesce(array_agg(b.id order by b.name), '{}') into v
      from public.branches b
     where b.org_id = p_org and (p_branch is null or b.id = p_branch);
    if cardinality(v) = 0 then
      raise exception 'unknown organization or branch' using errcode = 'invalid_parameter_value';
    end if;
    return v;
  end if;
  if p_branch is not null then
    if not private.can_access_branch(p_org, p_branch) then
      raise exception 'not allowed' using errcode = 'insufficient_privilege';
    end if;
    return array[p_branch];
  end if;
  select coalesce(array_agg(b.id order by b.name), '{}') into v
    from public.branches b
   where b.org_id = p_org and private.can_access_branch(p_org, b.id);
  if cardinality(v) = 0 then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return v;
end $$;

create or replace function private.require_money(p_org uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_service_role() and not private.can_see_money(p_org) then
    raise exception 'cost and profit figures are for the owner and accountant' using errcode = 'insufficient_privilege';
  end if;
end $$;

revoke execute on function private.is_service_role() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The owner's WhatsApp: briefs go only to a number that opted in (CLAUDE.md #8, PRODUCT.md M10).
-- ---------------------------------------------------------------------------------------------
alter table public.org_profile
  add column owner_whatsapp_opt_in_at timestamptz,
  add column brief_language public.locale_code not null default 'bn';

-- ---------------------------------------------------------------------------------------------
-- Insight feed (PRODUCT.md principle 7): at most three proactive insights per owner per day, ranked by
-- ৳ impact × confidence × novelty, where novelty falls each time the same kind of thing was shown in
-- the last 28 days. Snoozed and dismissed findings never come back on their own.
-- ---------------------------------------------------------------------------------------------
create unique index insight_feed_finding_day_idx on public.insight_feed (org_id, finding_id, shown_on);

create function private.refresh_insights(p_org uuid, p_date date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_room integer;
  v_n integer;
begin
  select 3 - count(*) into v_room from public.insight_feed where org_id = p_org and shown_on = p_date;
  if v_room <= 0 then return 0; end if;
  with seen as (
    select f.type, f.subject_key, count(*) as times
      from public.insight_feed i join public.findings f on f.org_id = i.org_id and f.id = i.finding_id
     where i.org_id = p_org and i.shown_on between p_date - 28 and p_date - 1
     group by f.type, f.subject_key
  ), candidates as (
    select f.id, f.type, f.impact_poisha, f.branch_id, f.subject,
           f.impact_poisha * (case f.confidence when 'high' then 1.0 when 'medium' then 0.7 else 0.4 end)
             / (1 + coalesce(s.times, 0)) as rank
      from public.findings f
      left join seen s on s.type = f.type and s.subject_key = f.subject_key
     where f.org_id = p_org and f.status = 'new'
       and (f.snoozed_until is null or f.snoozed_until <= p_date)
       and not exists (select 1 from public.insight_feed i where i.org_id = p_org and i.finding_id = f.id)
     order by 6 desc
     limit v_room
  ), ins as (
    insert into public.insight_feed (org_id, finding_id, headline_key, payload, rank, shown_on, status)
    select p_org, c.id, 'finding.' || c.type,
           jsonb_build_object('type', c.type, 'impact_poisha', c.impact_poisha, 'branch_id', c.branch_id, 'subject', c.subject),
           c.rank, p_date, 'shown'
      from candidates c
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end $$;

-- The owner answers an insight: dismissing needs a reason and dismisses the finding too; snoozing
-- needs a date and snoozes the finding. Both are audited through set_finding_status.
create function public.insight_action(p_insight uuid, p_action text, p_reason text default null, p_until date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  i public.insight_feed;
begin
  select * into i from public.insight_feed where id = p_insight;
  if not found or not private.has_role(i.org_id, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_action = 'dismiss' then
    perform public.set_finding_status(i.finding_id, 'dismissed', p_reason, null);
    update public.insight_feed set status = 'dismissed', dismissed_reason = left(btrim(p_reason), 500) where id = p_insight;
  elsif p_action = 'snooze' then
    perform public.set_finding_status(i.finding_id, 'snoozed', p_reason, p_until);
    update public.insight_feed set status = 'snoozed' where id = p_insight;
  else
    raise exception 'unknown action' using errcode = 'invalid_parameter_value';
  end if;
end $$;

create function public.job_refresh_insights(p_org uuid, p_date date) returns integer
language sql security definer set search_path = '' as $$
  select private.refresh_insights(p_org, p_date)
$$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'private' and p.proname = 'refresh_insights')
        or (n.nspname = 'public' and p.proname in ('insight_action', 'job_refresh_insights'))
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.proname = 'job_refresh_insights' then
      execute format('revoke execute on function %s from authenticated', f.sig);
      execute format('grant execute on function %s to service_role', f.sig);
    elsif f.nspname = 'public' then
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    else
      execute format('revoke execute on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- WhatsApp templates. Meta must approve each one before it can open a conversation (ADR 0010); until
-- then they are drafts, and the outbox's mock transport stands in.
-- ---------------------------------------------------------------------------------------------
insert into public.message_templates (key, channel, language, body, provider_template_name, variables, status)
values
  ('brief_morning', 'whatsapp', 'en', 'Good morning from Xedine. {{1}}', 'xedine_brief_morning_en', '{body}', 'draft'),
  ('brief_morning', 'whatsapp', 'bn', 'Xedine থেকে সুপ্রভাত। {{1}}', 'xedine_brief_morning_bn', '{body}', 'draft'),
  ('brief_evening', 'whatsapp', 'en', 'Today at your restaurant: {{1}}', 'xedine_brief_evening_en', '{body}', 'draft'),
  ('brief_evening', 'whatsapp', 'bn', 'আজ আপনার রেস্টুরেন্টে: {{1}}', 'xedine_brief_evening_bn', '{body}', 'draft'),
  ('brief_weekly', 'whatsapp', 'en', 'Your week with Xedine: {{1}}', 'xedine_brief_weekly_en', '{body}', 'draft'),
  ('brief_weekly', 'whatsapp', 'bn', 'Xedine-এ আপনার সপ্তাহ: {{1}}', 'xedine_brief_weekly_bn', '{body}', 'draft'),
  ('assistant_reply', 'whatsapp', 'en', '{{1}}', null, '{body}', 'draft'),
  ('assistant_reply', 'whatsapp', 'bn', '{{1}}', null, '{body}', 'draft')
on conflict (key, channel, language) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Schedules (UTC; Asia/Dhaka = UTC+6): morning brief 09:00, evening close 23:00, outbox every 2 min.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('xedine-morning-brief', '0 3 * * *', $cmd$select private.dispatch_job('morning_brief')$cmd$);
      perform cron.schedule('xedine-evening-close', '0 17 * * *', $cmd$select private.dispatch_job('evening_close')$cmd$);
      perform cron.schedule('xedine-send-outbox', '*/2 * * * *', $cmd$select private.dispatch_job('send_outbox')$cmd$);
    exception when others then
      raise notice 'could not create pg_cron schedules: %', sqlerrm;
    end;
  end if;
end $$;

comment on function public.insight_action is 'Owner dismisses (with reason) or snoozes (with date) a proactive insight; audited. Phase 4.';

-- A named window's business dates, for assistant tools and briefs (same rules as metric_item_qty).
create function public.metric_window(p_org uuid, p_window text, p_now timestamptz)
returns table (from_date date, to_date date)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_service_role() and not private.is_org_member(p_org) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query select w.from_date, w.to_date from private.window_bounds(p_org, p_window, p_now) w;
end $$;
revoke execute on function public.metric_window(uuid, text, timestamptz) from public, anon;
grant execute on function public.metric_window(uuid, text, timestamptz) to authenticated, service_role;

-- An owner's on-demand scan also refreshes today's insights, so new findings surface immediately.
create or replace function public.scan_findings(p_org uuid, p_now timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.business_date(p_now, private.org_cutoff(p_org));
  v_week_start integer := coalesce((select week_start from public.org_settings where org_id = p_org), 6);
  v_this_week date;
  v_month date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_n integer := 0;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  v_this_week := v_today - ((extract(dow from v_today)::integer - v_week_start + 7) % 7);
  for k in 1..4 loop
    v_n := v_n + private.save_findings(p_org, v_this_week - 7 * k, v_this_week - 7 * k + 6,
                                       array['staff', 'cash_share', 'over_short']);
  end loop;
  v_n := v_n + private.save_findings(p_org, v_month, (v_month + interval '1 month - 1 day')::date,
                                     array['commission', 'margin']);
  perform private.refresh_insights(p_org, v_today);
  perform private.write_audit(p_org, null, 'findings.scan', 'finding', null, null,
    jsonb_build_object('findings', v_n), null, null, null);
  return v_n;
end $$;
