-- Phase 10 (4/N) — the Growth module (ROADMAP Phase 10, PRODUCT.md M17, ADR 0023 §7). Optional and
-- Growth/Chain plans only. Content ideas are drafted from real sales data (never invented numbers,
-- CLAUDE.md #1) and approved by a person before use (CLAUDE.md #4); nothing is ever posted automatically.

create type public.growth_draft_kind as enum ('push_item', 'fix_daypart', 'custom');

create table public.growth_content_drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid,
  kind public.growth_draft_kind not null,
  title text not null,
  hook text,
  shot_list text,
  caption_bn text,
  caption_en text,
  based_on jsonb not null default '{}'::jsonb,
  target_date date,
  status public.reply_status not null default 'draft',
  posted_at timestamptz,
  model text,
  prompt_version text,
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  check (status not in ('approved', 'posted') or approved_at is not null)
);
create index growth_drafts_org_idx on public.growth_content_drafts (org_id, created_at desc);
create index growth_drafts_branch_idx on public.growth_content_drafts (org_id, branch_id);
select private.apply_policies('growth_content_drafts', 'org', array['owner', 'manager']::public.app_role[],
                              array['owner', 'manager']::public.app_role[], true);
comment on table public.growth_content_drafts is 'Content ideas grounded in sales data, approved before use. | written by: growth | phase: 10';

-- What the drafts are grounded in: the strongest item (a menu-matrix star when recipes exist, else the
-- top seller by units) and the weakest daypart's share of sales in the last 28 days. Revenue only — no
-- cost or margin figure leaves this function, so it needs no money gate.
create function public.metric_growth_inputs(p_org uuid, p_branch uuid, p_now timestamptz)
returns table (top_item_name text, top_item_qty bigint, top_item_is_star boolean,
               weak_daypart text, weak_daypart_share_bps integer, strong_daypart text, strong_daypart_share_bps integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid[];
  v_to date;
  v_from date;
begin
  if not private.is_service_role()
     and not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  v_scope := private.metric_scope(p_org, p_branch);
  v_to := private.business_date(p_now, private.org_cutoff(p_org));
  v_from := v_to - 27;
  return query
    with stars as (
      select m.name, m.qty, true as is_star from private.m_menu_matrix(p_org, v_scope, v_from, v_to) m
       where m.class = 'star' order by m.qty desc limit 1
    ), top_qty as (
      select q.name, q.qty, false from private.m_item_qty(p_org, v_scope, v_from, v_to, null, null, null, null) q
       order by q.qty desc limit 1
    ), top as (
      select * from stars union all select * from top_qty where not exists (select 1 from stars) limit 1
    ), dp as (
      select s.key, sum(s.net_poisha) as net, sum(s.net_poisha) * 10000.0 / nullif(sum(sum(s.net_poisha)) over (), 0) as share
        from private.m_sales_split(p_org, v_scope, v_from, v_to, 'daypart') s
       group by s.key, s.net_poisha
    ), agg as (
      select key, sum(net) as net, sum(net) * 10000.0 / nullif(sum(sum(net)) over (), 0) as share
        from dp group by key
    )
    select top.name, top.qty, top.is_star,
           (select key from agg order by share asc limit 1), (select round(share)::integer from agg order by share asc limit 1),
           (select key from agg order by share desc limit 1), (select round(share)::integer from agg order by share desc limit 1)
      from top;
end $$;

create function public.approve_growth_draft(p_draft uuid, p_caption_bn text default null, p_caption_en text default null,
                                            p_target_date date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.growth_content_drafts;
begin
  select * into d from public.growth_content_drafts where id = p_draft for update;
  if not found or not private.has_role(d.org_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if d.status <> 'draft' then
    raise exception 'this idea was already reviewed' using errcode = 'invalid_parameter_value';
  end if;
  update public.growth_content_drafts
     set status = 'approved', approved_by = (select auth.uid()), approved_at = now(),
         caption_bn = coalesce(nullif(btrim(p_caption_bn), ''), d.caption_bn),
         caption_en = coalesce(nullif(btrim(p_caption_en), ''), d.caption_en),
         target_date = coalesce(p_target_date, d.target_date)
   where id = p_draft;
  perform private.write_audit(d.org_id, d.branch_id, 'growth.approve', 'growth_content_draft', p_draft::text,
    jsonb_build_object('caption_bn', d.caption_bn, 'caption_en', d.caption_en),
    jsonb_build_object('caption_bn', coalesce(nullif(btrim(p_caption_bn), ''), d.caption_bn),
                        'caption_en', coalesce(nullif(btrim(p_caption_en), ''), d.caption_en)),
    null, null, null);
end $$;

create function public.mark_growth_posted(p_draft uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.growth_content_drafts;
begin
  select * into d from public.growth_content_drafts where id = p_draft for update;
  if not found or not private.has_role(d.org_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if d.status <> 'approved' then
    raise exception 'approve the idea first' using errcode = 'invalid_parameter_value';
  end if;
  update public.growth_content_drafts set status = 'posted', posted_at = now() where id = p_draft;
  perform private.write_audit(d.org_id, d.branch_id, 'growth.posted', 'growth_content_draft', p_draft::text,
    null, null, 'marked posted by hand', null, null);
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('metric_growth_inputs', 'approve_growth_draft', 'mark_growth_posted')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

comment on function public.metric_growth_inputs is 'Revenue-only inputs (no cost) to ground a content draft: top item, weakest/strongest daypart. Phase 10.';
comment on function public.approve_growth_draft is 'Approves a growth draft, editable at approval time; audited by the reply_status check. Phase 10.';
comment on function public.mark_growth_posted is 'Marks an approved draft posted by hand; never posted automatically. Phase 10.';
