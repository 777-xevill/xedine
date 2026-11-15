-- ---------------------------------------------------------------------------------------------
-- Posters without limits, dishes by sales or the owner's marks (ADR 0058).
--
--  * social_posts.design_spec   the look the poster is drawn in (layout, colour scheme, typeface,
--                               background, dish treatment, decorations, seed); template keeps the layout.
--  * social_posts.template      any layout name (the fixed list of ten designs is gone).
--  * social_settings.post_item_ids  dishes the owner or a manager marked "post this": the autopilot posts
--                               only these, taking turns. Empty = it posts the best sellers.
--  * social_settings.designs    no longer read (the autopilot varies the look by itself); kept so the app
--                               running during the switch keeps working.
--  * mark_social_dish           owner or manager marks a dish: post / never / auto (audited).
--  * request_social_post        + p_spec (optional).
-- ---------------------------------------------------------------------------------------------

alter table public.social_posts drop constraint social_posts_template;
alter table public.social_posts add constraint social_posts_template
  check (template is null or template ~ '^[a-z][a-z0-9_]{1,30}$');
alter table public.social_posts
  add column design_spec jsonb
    constraint social_posts_design_spec
    check (design_spec is null or (jsonb_typeof(design_spec) = 'object' and length(design_spec::text) <= 2000));
comment on column public.social_posts.design_spec is 'The look the poster is drawn in (layout, scheme, type, backdrop, plate, deco, head, mirror, seed); null = the job picks one (ADR 0058).';

alter table public.social_settings
  add column post_item_ids uuid[] not null default '{}'
    constraint social_settings_post_items check (cardinality(post_item_ids) <= 100);
comment on column public.social_settings.post_item_ids is 'Dishes marked "post this": the autopilot posts only these, taking turns; empty = best sellers (ADR 0058).';
comment on column public.social_settings.designs is 'No longer read (ADR 0058): the autopilot varies the look by itself.';

create function public.mark_social_dish(p_org uuid, p_item uuid, p_mark text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before text;
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_mark not in ('post', 'never', 'auto') then
    raise exception 'bad mark' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.menu_items m where m.org_id = p_org and m.id = p_item) then
    raise exception 'unknown dish' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.social_settings (org_id) values (p_org) on conflict (org_id) do nothing;
  select case when p_item = any (s.post_item_ids) then 'post'
              when p_item = any (s.never_item_ids) then 'never' else 'auto' end
    into v_before from public.social_settings s where s.org_id = p_org for update;
  update public.social_settings s
     set post_item_ids = case when p_mark = 'post' then array_append(array_remove(s.post_item_ids, p_item), p_item)
                              else array_remove(s.post_item_ids, p_item) end,
         never_item_ids = case when p_mark = 'never' then array_append(array_remove(s.never_item_ids, p_item), p_item)
                               else array_remove(s.never_item_ids, p_item) end
   where s.org_id = p_org;
  perform private.write_audit(p_org, null, 'social.mark', 'menu_item', p_item::text,
    jsonb_build_object('mark', v_before), jsonb_build_object('mark', p_mark), null, null, null);
end $$;
revoke execute on function public.mark_social_dish(uuid, uuid, text) from public, anon;
grant execute on function public.mark_social_dish(uuid, uuid, text) to authenticated, service_role;
comment on function public.mark_social_dish is 'Owner/manager marks a dish for the social autopilot: post (only marked dishes go), never, or auto (ADR 0058).';

drop function public.request_social_post(uuid, uuid, text, text, timestamptz, date, text, jsonb, uuid[]);
create function public.request_social_post(p_org uuid, p_item uuid, p_format text, p_own_text text,
                                           p_when timestamptz, p_plan_date date,
                                           p_design text default null, p_words jsonb default null,
                                           p_extra_items uuid[] default '{}', p_spec jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_extra uuid[] := array(select distinct x from unnest(coalesce(p_extra_items, '{}'::uuid[])) x where x <> p_item);
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_format not in ('image', 'video') then
    raise exception 'bad format' using errcode = 'invalid_parameter_value';
  end if;
  if p_design is not null and p_design !~ '^[a-z][a-z0-9_]{1,30}$' then
    raise exception 'bad design' using errcode = 'invalid_parameter_value';
  end if;
  if p_words is not null and (jsonb_typeof(p_words) <> 'object' or length(p_words::text) > 6000) then
    raise exception 'bad words' using errcode = 'invalid_parameter_value';
  end if;
  if p_spec is not null and (jsonb_typeof(p_spec) <> 'object' or length(p_spec::text) > 2000) then
    raise exception 'bad look' using errcode = 'invalid_parameter_value';
  end if;
  if cardinality(v_extra) > 3 then
    raise exception 'too many dishes' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.menu_items m
                  where m.org_id = p_org and m.id = p_item and m.photo_path is not null) then
    raise exception 'this dish has no photo' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from unnest(v_extra) x
              where not exists (select 1 from public.menu_items m
                                 where m.org_id = p_org and m.id = x and m.photo_path is not null)) then
    raise exception 'this dish has no photo' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.social_settings (org_id) values (p_org) on conflict (org_id) do nothing;
  insert into public.social_posts (org_id, menu_item_id, source, angle, format, plan_date, scheduled_at,
                                   own_text, template, design_words, extra_item_ids, design_spec, created_by)
  values (p_org, p_item, 'owner', 'own', p_format, p_plan_date, p_when,
          nullif(btrim(p_own_text), ''), p_design, p_words, v_extra, p_spec, (select auth.uid()))
  returning id into v_id;
  perform private.write_audit(p_org, null, 'social.request', 'social_post', v_id::text, null,
    jsonb_build_object('menu_item_id', p_item, 'format', p_format, 'scheduled_at', p_when,
                       'design', p_design, 'extra_item_ids', to_jsonb(v_extra), 'words', p_words is not null),
    null, null, null);
  return v_id;
end $$;
revoke execute on function public.request_social_post(uuid, uuid, text, text, timestamptz, date, text, jsonb, uuid[], jsonb) from public, anon;
grant execute on function public.request_social_post(uuid, uuid, text, text, timestamptz, date, text, jsonb, uuid[], jsonb) to authenticated, service_role;
comment on function public.request_social_post is 'Owner/manager adds their own post (dish with a photo, optional look, approved words and up to three more dishes); published by the job (ADR 0040, 0057, 0058).';
