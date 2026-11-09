-- ADR 0043 amendment: the customer writes the complaint; the owner and manager see it and fix it.
--
-- Each branch has one link, printed as a QR code on tables and the counter. The link token is the only
-- credential, as on the feedback and member card pages, so only the service role can use these functions and
-- the page exposes the restaurant's and branch's names and nothing else. Because anyone holding the link can
-- write, a branch takes at most 20 customer complaints an hour, and a new link stops the old one.

alter table public.branches
  add column complaint_token text not null default replace(gen_random_uuid()::text, '-', '');
alter table public.branches add constraint branches_complaint_token_key unique (complaint_token);

alter table public.incidents drop constraint incidents_source;
alter table public.incidents add constraint incidents_source check (source in
  ('in_person', 'phone', 'facebook', 'foodpanda', 'google', 'review', 'feedback', 'daily_check', 'customer', 'other'));

create function public.complaint_link(p_token text)
returns table (restaurant text, branch text)
language sql stable security definer set search_path = '' as $$
  select o.name, b.name
    from public.branches b
    join public.organizations o on o.id = b.org_id
   where b.complaint_token = p_token and b.is_active
$$;

-- Returns 'ok', 'gone' (unknown link), 'busy' (too many this hour) or 'invalid'. Someone sick after eating is
-- the one thing a customer's choice marks serious; the owner can change the seriousness of any case.
create function public.submit_complaint(
  p_token text, p_topic text, p_text text, p_name text, p_phone text, p_now timestamptz
) returns text language plpgsql security definer set search_path = '' as $$
declare
  b public.branches;
  v_text text := regexp_replace(btrim(coalesce(p_text, '')), '\s+', ' ', 'g');
  v_phone text := left(nullif(btrim(p_phone), ''), 30);
begin
  select * into b from public.branches where complaint_token = p_token and is_active;
  if not found then
    return 'gone';
  end if;
  if length(v_text) not between 3 and 1000
     or coalesce(p_topic, '') not in ('food', 'clean', 'service', 'sick', 'other') then
    return 'invalid';
  end if;
  -- One at a time per branch, so a double tap and the hourly limit are both exact.
  perform pg_advisory_xact_lock(hashtextextended(b.id::text, 0));
  if exists (select 1 from public.incidents i
              where i.org_id = b.org_id and i.branch_id = b.id and i.source = 'customer'
                and i.details = v_text and i.opened_at >= p_now - interval '10 minutes') then
    return 'ok';
  end if;
  if (select count(*) from public.incidents i
       where i.org_id = b.org_id and i.branch_id = b.id and i.source = 'customer'
         and i.opened_at >= p_now - interval '1 hour') >= 20 then
    return 'busy';
  end if;
  -- A phone number is only ever left to be called back, as the form says, so giving one is the consent.
  perform private.create_incident(b.org_id, b.id,
    case p_topic when 'clean' then 'hygiene' when 'sick' then 'food_safety' when 'other' then 'other' else 'complaint' end,
    case when p_topic = 'sick' then 'high' else 'medium' end,
    'customer', left(v_text, 160), v_text,
    private.business_date(p_now, private.branch_cutoff(b.org_id, b.id)),
    null, null, null, null, null, p_name, v_phone, v_phone is not null);
  return 'ok';
end $$;

create function public.reset_complaint_link(p_org uuid, p_branch uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_incident_role(p_org, p_branch);
  update public.branches set complaint_token = replace(gen_random_uuid()::text, '-', '')
   where org_id = p_org and id = p_branch;
  if not found then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform private.write_audit(p_org, p_branch, 'incident.link_reset', 'branch', p_branch::text, null, null, null, null, null);
end $$;

revoke execute on function public.complaint_link(text) from public, anon, authenticated;
grant execute on function public.complaint_link(text) to service_role;
revoke execute on function public.submit_complaint(text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.submit_complaint(text, text, text, text, text, timestamptz) to service_role;
revoke execute on function public.reset_complaint_link(uuid, uuid) from public, anon;
grant execute on function public.reset_complaint_link(uuid, uuid) to authenticated, service_role;

comment on column public.branches.complaint_token is
  'The link printed as this branch''s customer complaint QR. Not a secret from staff; a new one stops the old link. ADR 0043.';
comment on function public.complaint_link is 'The restaurant and branch names for a customer complaint link (service role only). ADR 0043.';
comment on function public.submit_complaint is 'A customer writes a complaint through the branch link (service role only; at most 20 an hour per branch). ADR 0043.';
comment on function public.reset_complaint_link is 'Owner or manager replaces a branch''s customer complaint link. ADR 0043.';
