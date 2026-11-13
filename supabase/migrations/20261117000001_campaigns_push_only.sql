-- Customer messages by browser notification only (ADR 0052).
-- The founder's choice: Xedine sends nothing to customers on WhatsApp. A campaign and the post-meal feedback
-- link reach a customer only as a notification on the phone where they allowed it (table QR, ADR 0048).
-- A customer who consented but has no phone with notifications on is skipped and counted as 'no_push'.

create or replace function public.run_campaign(p_campaign uuid, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.campaigns;
  v_asof date;
  x record;
  v_sent integer := 0;
  v_hold integer := 0;
  v_consent integer := 0;
  v_push integer := 0;
  v_cap integer := 0;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found or not (private.is_service_role() and c.auto_run
                       or private.has_role(c.org_id, array['owner', 'manager']::public.app_role[])) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if c.status not in ('approved', 'running') then
    raise exception 'approve the campaign first' using errcode = 'invalid_parameter_value';
  end if;
  v_asof := private.business_date(p_now, private.org_cutoff(c.org_id));
  for x in select * from private.campaign_candidates(p_campaign, v_asof) loop
    if ('x' || substr(md5(p_campaign::text || x.customer_id::text), 1, 8))::bit(32)::bigint % 100 < c.holdout_pct then
      insert into public.holdouts (org_id, campaign_id, customer_id) values (c.org_id, c.id, x.customer_id)
      on conflict (campaign_id, customer_id) do nothing;
      insert into public.campaign_sends (org_id, campaign_id, customer_id, status, is_holdout, reason, created_at)
      values (c.org_id, c.id, x.customer_id, 'suppressed', true, 'holdout', p_now);
      v_hold := v_hold + 1;
    elsif not private.marketing_ok(c.org_id, x.customer_id) then
      insert into public.campaign_sends (org_id, campaign_id, customer_id, status, reason, created_at)
      values (c.org_id, c.id, x.customer_id, 'suppressed', 'no_consent', p_now);
      v_consent := v_consent + 1;
    elsif not exists (select 1 from public.push_subscriptions ps
                       where ps.org_id = c.org_id and ps.customer_id = x.customer_id and ps.is_active) then
      insert into public.campaign_sends (org_id, campaign_id, customer_id, status, reason, created_at)
      values (c.org_id, c.id, x.customer_id, 'suppressed', 'no_push', p_now);
      v_push := v_push + 1;
    elsif private.capped(c.org_id, x.customer_id, p_now) then
      insert into public.campaign_sends (org_id, campaign_id, customer_id, status, reason, created_at)
      values (c.org_id, c.id, x.customer_id, 'suppressed', 'frequency_cap', p_now);
      v_cap := v_cap + 1;
    else
      -- Queued for the notification sender (pushCampaign), which reads exactly these rows; no WhatsApp outbox.
      insert into public.campaign_sends (org_id, campaign_id, customer_id, status, sent_at, created_at)
      values (c.org_id, c.id, x.customer_id, 'queued', p_now, p_now);
      v_sent := v_sent + 1;
    end if;
  end loop;
  update public.campaigns set status = 'running', last_run_at = p_now where id = p_campaign;
  perform private.write_audit(c.org_id, null, 'campaign.run', 'campaign', p_campaign::text, null,
    jsonb_build_object('queued', v_sent, 'holdout', v_hold, 'no_consent', v_consent, 'no_push', v_push, 'capped', v_cap),
    null, null, null);
  return jsonb_build_object('queued', v_sent, 'holdout', v_hold, 'no_consent', v_consent, 'no_push', v_push, 'capped', v_cap);
end $$;
comment on function public.run_campaign is
  'Runs an approved campaign once: holdout, consent, notifications on, caps; queues browser notifications (no WhatsApp); audited. ADR 0052.';

-- Post-meal feedback: only customers who can get it as a notification (same signature and columns as before).
create or replace function public.job_feedback_requests(p_org uuid, p_now timestamptz)
returns table (feedback_id uuid, to_phone text, token text, lang text)
language plpgsql security definer set search_path = '' as $$
declare
  x record;
  v_token text;
  v_id uuid;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  for x in
    select distinct on (o.customer_id) o.id as order_id, o.branch_id, o.customer_id, cu.phone
      from public.orders o join public.customers cu on cu.org_id = o.org_id and cu.id = o.customer_id
     where o.org_id = p_org and o.order_status = 'completed' and o.placed_at between p_now - interval '3 hours' and p_now
       and private.marketing_ok(p_org, o.customer_id)
       and exists (select 1 from public.push_subscriptions ps
                    where ps.org_id = p_org and ps.customer_id = o.customer_id and ps.is_active)
       and not exists (select 1 from public.feedback f where f.org_id = p_org and f.customer_id = o.customer_id
                        and f.sent_at > p_now - interval '7 days')
       and not exists (select 1 from public.feedback f where f.org_id = p_org and f.order_id = o.id)
     order by o.customer_id, o.placed_at desc
  loop
    v_token := encode(extensions.gen_random_bytes(18), 'hex');
    insert into public.feedback (org_id, branch_id, order_id, customer_id, token_hash, sent_at)
    values (p_org, x.branch_id, x.order_id, x.customer_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), p_now)
    returning id into v_id;
    feedback_id := v_id;
    to_phone := x.phone;
    token := v_token;
    lang := coalesce((select default_locale::text from public.org_settings where org_id = p_org), 'bn');
    return next;
  end loop;
end $$;
revoke execute on function public.job_feedback_requests(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.job_feedback_requests(uuid, timestamptz) to service_role;
