-- ---------------------------------------------------------------------------------------------
-- Short videos (ADR 0061): 10–12 second motion-graphics videos from the restaurant's own dish photos,
-- with free-licence music, food sounds and (on some) a free AI voice reading the hook. The autopilot makes
-- up to five a day besides its daily post; the owner or a manager makes one on Growth any time, for any
-- dish (1–3 dishes), any kind, and any special day (Eid, Jummah, Pohela Boishakh … or their own words).
--
--  * social_settings  + videos_per_day (0–5), voice_share (none/half/all), voice_gender, greetings.
--                     Owner and managers change these through save_social_video_settings (audited).
--  * social_posts     + slot (0 = the daily post, 1–5 = the day's videos), occasion and its own words,
--                     video_kind, video_spec (the look), offer_poisha (the owner's own offer price),
--                     voice and music (what the video carried, for the record of licences).
--  * social_dish_art  + photo_width / photo_height: a photo too small for a video is skipped, and Growth
--                     asks for a clearer one.
--  * request_social_video  the owner's or a manager's video.
--  * metric_item_pairs     growth.pairs: dishes bought together, so two dishes in one video go together
--                          the way customers order them.
-- ---------------------------------------------------------------------------------------------

alter table public.social_settings
  add column videos_per_day smallint not null default 1
    constraint social_settings_videos_per_day check (videos_per_day between 0 and 5),
  add column voice_share text not null default 'half'
    constraint social_settings_voice_share check (voice_share in ('none', 'half', 'all')),
  add column voice_gender text not null default 'female'
    constraint social_settings_voice_gender check (voice_gender in ('female', 'male')),
  add column greetings boolean not null default true;
comment on column public.social_settings.videos_per_day is 'Autopilot videos each posting day besides the daily post, 0–5 (ADR 0061).';
comment on column public.social_settings.voice_share is 'Which videos get the AI voice on the hook: none, half (every other) or all (ADR 0061).';
comment on column public.social_settings.voice_gender is 'The AI voice: female or male (ADR 0061).';
comment on column public.social_settings.greetings is 'On special days (Eid, Jummah, national days) the autopilot''s videos greet (ADR 0061).';

alter table public.social_posts
  add column slot smallint not null default 0
    constraint social_posts_slot check (slot between 0 and 5),
  add column occasion text
    constraint social_posts_occasion check (occasion is null or occasion ~ '^[a-z][a-z_]{1,29}$'),
  add column occasion_text text
    constraint social_posts_occasion_text check (occasion_text is null or length(occasion_text) <= 80),
  add column video_kind text
    constraint social_posts_video_kind
    check (video_kind is null or video_kind in ('showcase', 'versus', 'combo', 'carousel', 'ring', 'search', 'offer')),
  add column video_spec jsonb
    constraint social_posts_video_spec
    check (video_spec is null or (jsonb_typeof(video_spec) = 'object' and length(video_spec::text) <= 2000)),
  add column offer_poisha bigint
    constraint social_posts_offer check (offer_poisha is null or offer_poisha > 0),
  add column voice boolean not null default false,
  add column music text
    constraint social_posts_music check (music is null or length(music) <= 120);
comment on column public.social_posts.slot is '0 = the autopilot''s daily post; 1–5 = that day''s videos (ADR 0061). Owner posts keep 0.';
comment on column public.social_posts.occasion is 'Special day the video greets (eid_fitr, jummah, custom …); null = none (ADR 0061).';
comment on column public.social_posts.occasion_text is 'The owner''s own words for a custom special day (ADR 0061).';
comment on column public.social_posts.video_kind is 'What the video says: showcase, versus, combo, carousel, ring, search or offer; null = the job picks (ADR 0061).';
comment on column public.social_posts.video_spec is 'The video''s look (kind, scheme, type, stage, motion, seed); null = the job picks one (ADR 0061).';
comment on column public.social_posts.offer_poisha is 'The owner''s own offer price for an offer video, below the menu price (ADR 0061).';
comment on column public.social_posts.voice is 'The video carries the AI voice reading its hook (ADR 0061).';
comment on column public.social_posts.music is 'The free-licence track under the video (its id in the music library), kept as the licence record (ADR 0061).';

-- One autopilot post per org, day and slot (the daily post is slot 0).
drop index public.social_posts_autopilot_day;
create unique index social_posts_autopilot_day on public.social_posts (org_id, plan_date, slot)
  where source = 'autopilot';

alter table public.social_dish_art
  add column photo_width integer constraint social_dish_art_photo_width check (photo_width is null or photo_width > 0),
  add column photo_height integer constraint social_dish_art_photo_height check (photo_height is null or photo_height > 0);
comment on column public.social_dish_art.photo_width is 'Width of the dish photo in pixels; a photo whose short side is under 360 px is not used in videos (ADR 0061).';
comment on column public.social_dish_art.photo_height is 'Height of the dish photo in pixels (ADR 0061).';

-- ---------------------------------------------------------------------------------------------
-- Video settings: the owner or a manager (the founder's choice: both run the restaurant's videos).
-- ---------------------------------------------------------------------------------------------
create function public.save_social_video_settings(p_org uuid, p_videos_per_day smallint, p_voice_share text,
                                                  p_voice_gender text, p_greetings boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_videos_per_day is null or p_videos_per_day not between 0 and 5
     or p_voice_share not in ('none', 'half', 'all') or p_voice_gender not in ('female', 'male')
     or p_greetings is null then
    raise exception 'bad video settings' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.social_settings (org_id) values (p_org) on conflict (org_id) do nothing;
  select jsonb_build_object('videos_per_day', s.videos_per_day, 'voice_share', s.voice_share,
                            'voice_gender', s.voice_gender, 'greetings', s.greetings)
    into v_before from public.social_settings s where s.org_id = p_org for update;
  update public.social_settings
     set videos_per_day = p_videos_per_day, voice_share = p_voice_share,
         voice_gender = p_voice_gender, greetings = p_greetings
   where org_id = p_org;
  perform private.write_audit(p_org, null, 'social.video_settings', 'social_settings', p_org::text, v_before,
    jsonb_build_object('videos_per_day', p_videos_per_day, 'voice_share', p_voice_share,
                       'voice_gender', p_voice_gender, 'greetings', p_greetings), null, null, null);
end $$;
revoke execute on function public.save_social_video_settings(uuid, smallint, text, text, boolean) from public, anon;
grant execute on function public.save_social_video_settings(uuid, smallint, text, text, boolean) to authenticated, service_role;
comment on function public.save_social_video_settings is 'Owner/manager sets the autopilot''s videos: how many a day, the AI voice, special-day greetings (ADR 0061).';

-- ---------------------------------------------------------------------------------------------
-- The owner's or a manager's own video: 1–3 dishes with photos, an optional kind, special day, idea,
-- approved words and look. An offer video names one dish and an offer price below its menu price.
-- ---------------------------------------------------------------------------------------------
create function public.request_social_video(p_org uuid, p_items uuid[], p_kind text, p_occasion text,
                                            p_occasion_text text, p_own_text text, p_offer_poisha bigint,
                                            p_when timestamptz, p_plan_date date,
                                            p_words jsonb default null, p_spec jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_items uuid[];
  v_n int;
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  -- Distinct dishes, in the order given.
  select coalesce(array_agg(x order by i), '{}') into v_items
    from (select distinct on (x) x, i from unnest(p_items) with ordinality u(x, i) where x is not null order by x, i) d;
  v_n := cardinality(v_items);
  if v_n < 1 or v_n > 3 then
    raise exception 'pick one to three dishes' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from unnest(v_items) x
              where not exists (select 1 from public.menu_items m
                                 where m.org_id = p_org and m.id = x and m.photo_path is not null)) then
    raise exception 'this dish has no photo' using errcode = 'invalid_parameter_value';
  end if;
  if p_kind is not null and not (
       (p_kind in ('showcase', 'offer') and v_n = 1) or
       (p_kind in ('versus', 'combo') and v_n = 2) or
       (p_kind in ('carousel', 'ring') and v_n = 3) or
       (p_kind = 'search' and v_n >= 2)) then
    raise exception 'this kind needs another number of dishes' using errcode = 'invalid_parameter_value';
  end if;
  if p_kind = 'offer' then
    -- Below the menu price and below every branch's own price for the dish (the video shows the agreed one).
    if p_offer_poisha is null or p_offer_poisha <= 0 or p_offer_poisha >= (
         select least(m.base_price_poisha,
                      coalesce((select min(b.price_poisha) from public.branch_item_prices b
                                 where b.org_id = p_org and b.menu_item_id = m.id and b.variant_id is null
                                   and b.is_available), m.base_price_poisha))
           from public.menu_items m where m.org_id = p_org and m.id = v_items[1]) then
      raise exception 'the offer price must be below the menu price' using errcode = 'check_violation';
    end if;
  elsif p_offer_poisha is not null then
    raise exception 'an offer price needs an offer video' using errcode = 'invalid_parameter_value';
  end if;
  if p_occasion is not null and p_occasion !~ '^[a-z][a-z_]{1,29}$' then
    raise exception 'bad occasion' using errcode = 'invalid_parameter_value';
  end if;
  if p_occasion = 'custom' and coalesce(btrim(p_occasion_text), '') = '' then
    raise exception 'write the special day' using errcode = 'invalid_parameter_value';
  end if;
  if length(coalesce(p_occasion_text, '')) > 80 or length(coalesce(p_own_text, '')) > 300 then
    raise exception 'too long' using errcode = 'invalid_parameter_value';
  end if;
  if p_words is not null and (jsonb_typeof(p_words) <> 'object' or length(p_words::text) > 6000) then
    raise exception 'bad words' using errcode = 'invalid_parameter_value';
  end if;
  if p_spec is not null and (jsonb_typeof(p_spec) <> 'object' or length(p_spec::text) > 2000) then
    raise exception 'bad look' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.social_settings (org_id) values (p_org) on conflict (org_id) do nothing;
  insert into public.social_posts (org_id, menu_item_id, extra_item_ids, source, angle, format, plan_date,
                                   scheduled_at, own_text, video_kind, occasion, occasion_text, offer_poisha,
                                   design_words, video_spec, created_by)
  values (p_org, v_items[1], v_items[2:], 'owner', 'own', 'video', p_plan_date, p_when,
          nullif(btrim(p_own_text), ''), p_kind, p_occasion,
          case when p_occasion = 'custom' then btrim(p_occasion_text) end, p_offer_poisha,
          p_words, p_spec, (select auth.uid()))
  returning id into v_id;
  perform private.write_audit(p_org, null, 'social.request_video', 'social_post', v_id::text, null,
    jsonb_build_object('items', to_jsonb(v_items), 'kind', p_kind, 'occasion', p_occasion,
                       'offer_poisha', p_offer_poisha, 'scheduled_at', p_when, 'words', p_words is not null),
    null, null, null);
  return v_id;
end $$;
revoke execute on function public.request_social_video(uuid, uuid[], text, text, text, text, bigint, timestamptz, date, jsonb, jsonb) from public, anon;
grant execute on function public.request_social_video(uuid, uuid[], text, text, text, text, bigint, timestamptz, date, jsonb, jsonb) to authenticated, service_role;
comment on function public.request_social_video is 'Owner/manager adds their own short video (1–3 dishes, kind, special day, idea, offer price); published by the job (ADR 0061).';

-- ---------------------------------------------------------------------------------------------
-- growth.pairs (METRICS.md): for each two dishes, how many orders in the last 60 business days held both
-- (active lines of orders that were not cancelled, like items.qty_sold). Counts only, no money.
-- ---------------------------------------------------------------------------------------------
create function private.m_item_pairs(p_org uuid, p_branches uuid[], p_from date, p_to date,
                                     p_item uuid default null)
returns table (item_a uuid, item_b uuid, orders bigint)
language sql stable security definer set search_path = '' as $$
  with lines as (
    select distinct oi.order_id, oi.menu_item_id
      from public.order_items oi
      join public.orders o on o.org_id = oi.org_id and o.id = oi.order_id
     where oi.org_id = p_org and oi.branch_id = any (p_branches) and oi.status = 'active'
       and oi.menu_item_id is not null and o.order_status <> 'cancelled'
       and o.business_date between p_from and p_to
  )
  select a.menu_item_id, b.menu_item_id, count(*)::bigint
    from lines a
    join lines b on b.order_id = a.order_id and b.menu_item_id > a.menu_item_id
   where p_item is null or p_item in (a.menu_item_id, b.menu_item_id)
   group by 1, 2
   order by 3 desc, 1, 2
$$;
revoke execute on function private.m_item_pairs(uuid, uuid[], date, date, uuid) from public, anon, authenticated;

create function public.metric_item_pairs(p_org uuid, p_now timestamptz, p_item uuid default null)
returns table (item_a uuid, item_b uuid, orders bigint)
language sql stable security definer set search_path = '' as $$
  select p.*
    from (select private.business_date(p_now, private.org_cutoff(p_org)) as today) d
    cross join lateral private.m_item_pairs(p_org, private.metric_scope(p_org, null), d.today - 59, d.today,
                                            p_item) p
$$;
revoke execute on function public.metric_item_pairs(uuid, timestamptz, uuid) from public, anon;
grant execute on function public.metric_item_pairs(uuid, timestamptz, uuid) to authenticated, service_role;
comment on function public.metric_item_pairs is 'growth.pairs: orders holding both dishes over the last 60 business days; p_item = only that dish''s partners (ADR 0061).';

-- ---------------------------------------------------------------------------------------------
-- A high-quality photo per dish for posts and videos. Menu photos are shrunk for the till (≤640 px,
-- ADR 0031); the owner or a manager may add a bigger one here, and the social job uses it when there is
-- one. It lives in the org's own folder of menu-photos, under hq/, where managers may write too.
-- ---------------------------------------------------------------------------------------------
alter table public.menu_items
  add column hq_photo_path text
    constraint menu_items_hq_photo_in_org_folder check (hq_photo_path is null or hq_photo_path like org_id::text || '/hq/%');
comment on column public.menu_items.hq_photo_path is 'A bigger photo of the dish for posts and videos (menu-photos/<org>/hq/…); null = the menu photo (ADR 0061).';

create policy menu_photos_hq_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'menu-photos'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and (storage.foldername(name))[2] = 'hq'
    and private.has_role(((storage.foldername(name))[1])::uuid, array['owner', 'manager']::public.app_role[])
  );
-- Storage removes an object only when it may also see it: owners and managers may see their own hq/ files
-- (they are public by URL anyway), so a replaced photo is really deleted.
create policy menu_photos_hq_select on storage.objects for select to authenticated
  using (
    bucket_id = 'menu-photos'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and (storage.foldername(name))[2] = 'hq'
    and private.has_role(((storage.foldername(name))[1])::uuid, array['owner', 'manager']::public.app_role[])
  );
create policy menu_photos_hq_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'menu-photos'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and (storage.foldername(name))[2] = 'hq'
    and private.has_role(((storage.foldername(name))[1])::uuid, array['owner', 'manager']::public.app_role[])
  );

create function public.set_dish_hq_photo(p_org uuid, p_item uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before text;
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_path is not null and p_path !~ ('^' || p_org::text || '/hq/[A-Za-z0-9-]{8,80}\.(webp|jpg)$') then
    raise exception 'bad photo path' using errcode = 'invalid_parameter_value';
  end if;
  select m.hq_photo_path into v_before from public.menu_items m
   where m.org_id = p_org and m.id = p_item for update;
  if not found then
    raise exception 'unknown dish' using errcode = 'invalid_parameter_value';
  end if;
  update public.menu_items set hq_photo_path = p_path where org_id = p_org and id = p_item;
  perform private.write_audit(p_org, null, 'social.hq_photo', 'menu_item', p_item::text,
    jsonb_build_object('hq_photo_path', v_before), jsonb_build_object('hq_photo_path', p_path), null, null, null);
end $$;
revoke execute on function public.set_dish_hq_photo(uuid, uuid, text) from public, anon;
grant execute on function public.set_dish_hq_photo(uuid, uuid, text) to authenticated, service_role;
comment on function public.set_dish_hq_photo is 'Owner/manager sets (or clears) a dish''s high-quality photo for posts and videos (ADR 0061).';
