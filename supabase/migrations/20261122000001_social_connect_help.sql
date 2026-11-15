-- ADR 0059: until Meta verifies Xedine, a restaurant can ask Xedine to help it connect Facebook.
-- Two ways, the owner picks one:
--   * page_access — the owner gives Xedine's Facebook account access to their Page (in the Facebook app,
--                   Page → Settings → Page access); a platform admin then connects the Page for them.
--   * tester      — the owner sends the link to their own Facebook profile; a platform admin adds it as a
--                   Tester of the Meta app, then the owner accepts the invite and presses Connect.
-- One open request per restaurant. The owner reads their own; every write goes through the functions below.

create table public.social_connect_requests (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  way text not null constraint social_connect_requests_way check (way in ('page_access', 'tester')),
  -- The owner's Page link (page_access, optional) or their own profile link (tester, required).
  facebook_link text constraint social_connect_requests_link check (
    facebook_link is null
    or (char_length(facebook_link) <= 300
        and facebook_link ~* '^https://([a-z0-9-]+\.)*(facebook\.com|fb\.com|fb\.me)/')),
  -- waiting → invited (tester only: the admin sent the invite) → done (the Page is connected).
  status text not null default 'waiting'
    constraint social_connect_requests_status check (status in ('waiting', 'invited', 'done')),
  requested_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger social_connect_requests_touch before update on public.social_connect_requests
  for each row execute function private.touch_updated_at();

create policy social_connect_requests_select on public.social_connect_requests for select to authenticated
  using (private.has_role(org_id, array['owner']::public.app_role[]));
select private.register_table('social_connect_requests', 'custom',
  'select: owner; writes only via request_social_connect / cancel_social_connect / admin_mark_social_connect (ADR 0059)');
revoke insert, update, delete, truncate on table public.social_connect_requests from anon, authenticated;
comment on table public.social_connect_requests is 'A restaurant''s ask for help connecting Facebook (Page access or Tester invite), handled by a platform admin. | written by: social | phase: 11';

create function public.request_social_connect(p_org uuid, p_way text, p_link text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_link text := nullif(btrim(coalesce(p_link, '')), '');
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'only the owner can ask for help connecting' using errcode = 'insufficient_privilege';
  end if;
  if p_way not in ('page_access', 'tester') or (p_way = 'tester' and v_link is null) then
    raise exception 'a Facebook link is needed' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.social_connect_requests (org_id, way, facebook_link, status, requested_by, updated_by)
  values (p_org, p_way, v_link, 'waiting', (select auth.uid()), (select auth.uid()))
  on conflict (org_id) do update
     set way = excluded.way, facebook_link = excluded.facebook_link, status = 'waiting',
         requested_by = excluded.requested_by, updated_by = excluded.updated_by, created_at = now();
  perform private.write_audit(p_org, null, 'social.connect_request', 'social_connect_request', p_org::text, null,
    jsonb_build_object('way', p_way, 'link', v_link), null);
end $$;

create function public.cancel_social_connect(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  delete from public.social_connect_requests where org_id = p_org;
  perform private.write_audit(p_org, null, 'social.connect_cancel', 'social_connect_request', p_org::text, null, null, null);
end $$;

-- The operator's inbox: open requests, and the ones finished in the last 14 days. Metadata only.
create function public.admin_social_connect_requests(p_now timestamptz)
returns table (org_id uuid, org_name text, slug text, way text, facebook_link text, status text,
               created_at timestamptz, connected_page text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_platform_admin() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    select r.org_id, o.name, o.slug, r.way, r.facebook_link, r.status, r.created_at,
           (select a.name from public.social_accounts a where a.org_id = r.org_id and a.platform = 'facebook')
      from public.social_connect_requests r
      join public.organizations o on o.id = r.org_id
     where r.status <> 'done' or r.updated_at > p_now - interval '14 days'
     order by (r.status = 'done'), r.created_at;
end $$;

create function public.admin_mark_social_connect(p_org uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.social_connect_requests;
begin
  if not private.is_platform_admin() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('waiting', 'invited', 'done') then
    raise exception 'unknown status' using errcode = 'invalid_parameter_value';
  end if;
  select * into r from public.social_connect_requests where org_id = p_org for update;
  if not found then
    raise exception 'request not found' using errcode = 'invalid_parameter_value';
  end if;
  update public.social_connect_requests
     set status = p_status, updated_by = (select auth.uid())
   where org_id = p_org;
  perform private.write_audit(p_org, null, 'social.connect_mark', 'social_connect_request', p_org::text,
    jsonb_build_object('status', r.status), jsonb_build_object('status', p_status), 'platform admin');
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('request_social_connect', 'cancel_social_connect', 'admin_social_connect_requests',
                         'admin_mark_social_connect')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

comment on function public.request_social_connect is 'Owner asks Xedine to help connect Facebook: page_access or tester; audited. ADR 0059.';
comment on function public.admin_mark_social_connect is 'Platform admin moves a connect request to invited or done; audited. ADR 0059.';
