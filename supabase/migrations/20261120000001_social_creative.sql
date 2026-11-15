-- ---------------------------------------------------------------------------------------------
-- Creative poster engine (ADR 0057). The social job lifts each dish off its photo once (a transparent
-- cut-out made by an open model on the CPU) and keeps it, so a poster can stand the dish on a colour, a
-- band or a frame the way a designer would; the owner's live preview on Growth draws with the same art.
-- A post now carries the design it uses, the words the owner approved in the preview, and the other
-- dishes a menu-style poster shows.
--
--  * social_dish_art        one row per dish: the cut-out of its menu photo (and of the AI studio plate)
--  * social_posts           + design_words, extra_item_ids (template already holds the design)
--  * social_settings        + designs (which designs the autopilot may use), show_price
--  * request_social_post    + p_design, p_words, p_extra_items (all optional: old calls still work)
-- ---------------------------------------------------------------------------------------------

create table public.social_dish_art (
  org_id uuid not null references public.organizations (id) on delete cascade,
  menu_item_id uuid not null,
  -- The menu photo the art was made from: when the dish gets a new photo, the art is made again.
  source_path text not null constraint social_dish_art_source check (length(source_path) <= 300),
  -- Transparent WebP files in the public social-media bucket, inside the org's own folder.
  cutout_path text constraint social_dish_art_cutout_in_org
    check (cutout_path is null or cutout_path like org_id::text || '/%'),
  -- Usable = the whole dish is in the photo; a close-up whose plate runs off the frame is not, and the
  -- poster then shows the photo itself in a round or framed card.
  cutout_usable boolean not null default false,
  -- The AI studio plate (Cloudflare FLUX.2 [klein] from the real photo, ADR 0040), cut out the same way.
  studio_path text constraint social_dish_art_studio_in_org
    check (studio_path is null or studio_path like org_id::text || '/%'),
  studio_usable boolean not null default false,
  studio_tried_at timestamptz,
  -- Share of the photo that is dish, and share of its edge the dish touches (0–1).
  coverage real,
  edge real,
  -- The AI photo check of this photo (ADR 0040), kept so each photo is checked once: 'ok', 'not_food',
  -- 'blurry', or null when not checked yet.
  photo_check text constraint social_dish_art_photo_check
    check (photo_check is null or photo_check in ('ok', 'not_food', 'blurry')),
  error text constraint social_dish_art_error check (error is null or length(error) <= 300),
  made_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, menu_item_id),
  foreign key (org_id, menu_item_id) references public.menu_items (org_id, id) on delete cascade
);
create trigger social_dish_art_touch before update on public.social_dish_art
  for each row execute function private.touch_updated_at();
select private.apply_policies('social_dish_art', 'org',
  array['owner', 'manager']::public.app_role[], '{}'::public.app_role[], false,
  'written by the social job (service role); read by the Growth preview (ADR 0057)');
comment on table public.social_dish_art is 'Each dish photo lifted off its background (and the AI studio plate), for posters. | written by: social | phase: 11';

-- ---------------------------------------------------------------------------------------------
-- Posts: the design, the approved words and the other dishes on the poster.
-- ---------------------------------------------------------------------------------------------
alter table public.social_posts
  add column design_words jsonb
    constraint social_posts_design_words
    check (design_words is null or (jsonb_typeof(design_words) = 'object' and length(design_words::text) <= 6000)),
  add column extra_item_ids uuid[] not null default '{}'
    constraint social_posts_extra_items check (cardinality(extra_item_ids) <= 3);
alter table public.social_posts add constraint social_posts_template
  check (template is null or template in ('band', 'centre', 'frame', 'split', 'status', 'mood', 'giant',
                                          'menu', 'breakout', 'minimal'));
comment on column public.social_posts.design_words is 'Poster words the owner approved in the Growth preview (headline_en, tagline_bn, …); null = the job writes them (ADR 0057).';
comment on column public.social_posts.extra_item_ids is 'Other dishes a menu-style poster shows, besides menu_item_id (ADR 0057).';

alter table public.social_settings
  add column designs text[] not null
    default '{band,centre,frame,split,status,mood,giant,menu,breakout,minimal}'
    constraint social_settings_designs
    check (designs <@ '{band,centre,frame,split,status,mood,giant,menu,breakout,minimal}'::text[]
           and cardinality(designs) > 0),
  add column show_price boolean not null default true;
comment on column public.social_settings.designs is 'Poster designs the autopilot may rotate through (ADR 0057).';
comment on column public.social_settings.show_price is 'Print the menu price on posters that have room for it (ADR 0057).';

-- ---------------------------------------------------------------------------------------------
-- request_social_post: the owner's own post may now name its design, carry the words the owner approved
-- in the preview, and add up to three more dishes. The new arguments are optional, so a call with the
-- original six still works.
-- ---------------------------------------------------------------------------------------------
drop function public.request_social_post(uuid, uuid, text, text, timestamptz, date);
create function public.request_social_post(p_org uuid, p_item uuid, p_format text, p_own_text text,
                                           p_when timestamptz, p_plan_date date,
                                           p_design text default null, p_words jsonb default null,
                                           p_extra_items uuid[] default '{}')
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
  if p_design is not null and p_design not in ('band', 'centre', 'frame', 'split', 'status', 'mood', 'giant',
                                               'menu', 'breakout', 'minimal') then
    raise exception 'bad design' using errcode = 'invalid_parameter_value';
  end if;
  if p_words is not null and (jsonb_typeof(p_words) <> 'object' or length(p_words::text) > 6000) then
    raise exception 'bad words' using errcode = 'invalid_parameter_value';
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
  -- The poster needs the org's colours: an org that never opened Settings → Social gets the defaults.
  insert into public.social_settings (org_id) values (p_org) on conflict (org_id) do nothing;
  insert into public.social_posts (org_id, menu_item_id, source, angle, format, plan_date, scheduled_at,
                                   own_text, template, design_words, extra_item_ids, created_by)
  values (p_org, p_item, 'owner', 'own', p_format, p_plan_date, p_when,
          nullif(btrim(p_own_text), ''), p_design, p_words, v_extra, (select auth.uid()))
  returning id into v_id;
  perform private.write_audit(p_org, null, 'social.request', 'social_post', v_id::text, null,
    jsonb_build_object('menu_item_id', p_item, 'format', p_format, 'scheduled_at', p_when,
                       'design', p_design, 'extra_item_ids', to_jsonb(v_extra), 'words', p_words is not null),
    null, null, null);
  return v_id;
end $$;
revoke execute on function public.request_social_post(uuid, uuid, text, text, timestamptz, date, text, jsonb, uuid[]) from public, anon;
grant execute on function public.request_social_post(uuid, uuid, text, text, timestamptz, date, text, jsonb, uuid[]) to authenticated, service_role;
comment on function public.request_social_post is 'Owner/manager adds their own post (dish with a photo, optional design, approved words and up to three more dishes); published by the job (ADR 0040, 0057).';
