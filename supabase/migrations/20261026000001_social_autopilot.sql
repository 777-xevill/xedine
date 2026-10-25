-- ---------------------------------------------------------------------------------------------
-- Social autopilot (ADR 0040). Xedine makes and publishes the restaurant's Facebook and Instagram
-- posts by itself: a poster (4:5) or a short reel (9:16) built from the restaurant's own dish photo,
-- with captions grounded in its sales. The owner sets it up once and it keeps posting while they are
-- away; the owner or a manager can still add a post of their own or skip one.
--
--  * social_settings  one row per org: autopilot switch, when to post, brand colours, logo, contact.
--  * social_accounts  the Facebook Page / Instagram account the org connected (names and ids only).
--  * social_tokens    the Page access token for each account: service role only, never readable.
--  * social_connect_pending  Pages offered by Facebook during "Connect", until the owner picks one.
--  * social_posts     every planned, made and published post. Clients read it; the job writes it, and
--                     owners/managers change it only through request_social_post / skip_social_post.
-- ---------------------------------------------------------------------------------------------

create table public.social_settings (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  autopilot boolean not null default false,
  -- Local Asia/Dhaka time of day the post goes out, and the weekdays (0 = Sunday … 6 = Saturday).
  post_time time not null default '13:00',
  post_days smallint[] not null default '{0,1,2,3,4,5,6}'
    constraint social_settings_days check (post_days <@ '{0,1,2,3,4,5,6}'::smallint[] and cardinality(post_days) > 0),
  -- 'mix' alternates a poster and a reel; 'image' / 'video' always make one kind.
  format text not null default 'mix' constraint social_settings_format check (format in ('mix', 'image', 'video')),
  language text not null default 'both' constraint social_settings_language check (language in ('bn', 'en', 'both')),
  tone text not null default 'friendly' constraint social_settings_tone check (tone in ('friendly', 'premium', 'fun')),
  color_main text not null default '#C8102E' constraint social_settings_color_main check (color_main ~ '^#[0-9A-Fa-f]{6}$'),
  color_accent text not null default '#FFC72C' constraint social_settings_color_accent check (color_accent ~ '^#[0-9A-Fa-f]{6}$'),
  -- The logo lives in the public menu-photos bucket, inside the org's own folder (ADR 0031).
  logo_path text constraint social_settings_logo_in_org_folder check (logo_path is null or logo_path like org_id::text || '/%'),
  display_name text constraint social_settings_display_name check (display_name is null or length(display_name) <= 60),
  area text constraint social_settings_area check (area is null or length(area) <= 80),
  phone text constraint social_settings_phone check (phone is null or length(phone) <= 30),
  order_link text constraint social_settings_order_link check (order_link is null or length(order_link) <= 200),
  -- Dishes the owner never wants posted.
  never_item_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);
create trigger social_settings_touch before update on public.social_settings
  for each row execute function private.touch_updated_at();
select private.apply_policies('social_settings', 'org',
  array['owner', 'manager']::public.app_role[], array['owner']::public.app_role[], false,
  'the owner sets up the autopilot; managers can see it (ADR 0040)');
comment on table public.social_settings is 'How the social autopilot posts for this org: switch, time, days, colours, logo, contact. | written by: social | phase: 11';

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  platform text not null constraint social_accounts_platform check (platform in ('facebook', 'instagram')),
  external_id text not null constraint social_accounts_external_id check (external_id ~ '^[0-9]{1,40}$'),
  name text not null constraint social_accounts_name check (length(name) <= 200),
  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, platform)
);
-- Read by owner + manager; only the owner may disconnect (delete). Connecting happens server-side with the
-- service role after Facebook's sign-in, because the token must never pass through a client write.
select private.apply_policies('social_accounts', 'org',
  array['owner', 'manager']::public.app_role[], array['owner']::public.app_role[], true,
  'insert by the connect callback (service role); owner may disconnect (ADR 0040)');
comment on table public.social_accounts is 'The Facebook Page and Instagram account an org connected for posting (ids and names only). | written by: social | phase: 11';

create table public.social_tokens (
  account_id uuid primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  access_token text not null,
  updated_at timestamptz not null default now(),
  foreign key (org_id, account_id) references public.social_accounts (org_id, id) on delete cascade
);
create index social_tokens_org_idx on public.social_tokens (org_id);
select private.register_table('social_tokens', 'service_only', 'Meta Page access tokens; jobs only (ADR 0040)');
comment on table public.social_tokens is 'Meta Page access token per connected account; service role only. | written by: social | phase: 11';

create table public.social_connect_pending (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- [{id, name, token, igId, igName}] exactly as Facebook returned them; deleted once one is picked.
  pages jsonb not null,
  created_at timestamptz not null default now()
);
create index social_connect_pending_org_idx on public.social_connect_pending (org_id, user_id, created_at desc);
select private.register_table('social_connect_pending', 'service_only', 'Pages offered during Connect, until one is picked (ADR 0040)');
comment on table public.social_connect_pending is 'Facebook Pages offered during Connect, kept for 30 minutes until the owner picks one. | written by: social | phase: 11';

create type public.social_post_status as enum ('planned', 'ready', 'publishing', 'posted', 'failed', 'skipped');

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  menu_item_id uuid,
  source text not null constraint social_posts_source check (source in ('autopilot', 'owner')),
  angle text not null constraint social_posts_angle check (angle in ('star', 'quiet_time', 'spotlight', 'own')),
  format text not null constraint social_posts_format check (format in ('image', 'video')),
  plan_date date not null,
  scheduled_at timestamptz not null,
  status public.social_post_status not null default 'planned',
  -- The one fact the words may use (CLAUDE.md #1), and the owner's own line for an 'own' post.
  fact text,
  own_text text constraint social_posts_own_text check (own_text is null or length(own_text) <= 300),
  headline text,
  tagline text,
  caption_bn text,
  caption_en text,
  template text,
  ai_image_path text,
  poster_path text,
  video_path text,
  model text,
  prompt_version text,
  fb_id text,
  ig_id text,
  ig_container_id text,
  error text,
  attempts smallint not null default 0,
  posted_at timestamptz,
  media_cleared_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, menu_item_id) references public.menu_items (org_id, id) on delete set null (menu_item_id),
  check (status <> 'posted' or posted_at is not null)
);
-- One autopilot post per org per day; the owner may add more of their own.
create unique index social_posts_autopilot_day on public.social_posts (org_id, plan_date) where source = 'autopilot';
create index social_posts_org_idx on public.social_posts (org_id, scheduled_at desc);
create index social_posts_due_idx on public.social_posts (status, scheduled_at)
  where status in ('planned', 'ready', 'publishing');
create trigger social_posts_touch before update on public.social_posts
  for each row execute function private.touch_updated_at();
select private.apply_policies('social_posts', 'org',
  array['owner', 'manager']::public.app_role[], '{}'::public.app_role[], false,
  'written by the social job (service role) and request_social_post / skip_social_post (ADR 0040)');
comment on table public.social_posts is 'Facebook/Instagram posts the autopilot planned, made and published. | written by: social | phase: 11';

-- ---------------------------------------------------------------------------------------------
-- The owner or a manager adds a post of their own: a dish (with a photo) and, optionally, their own
-- line. It goes out at p_when (or at the next run if that is in the past) with no further approval.
-- ---------------------------------------------------------------------------------------------
create function public.request_social_post(p_org uuid, p_item uuid, p_format text, p_own_text text,
                                           p_when timestamptz, p_plan_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_format not in ('image', 'video') then
    raise exception 'bad format' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.menu_items m
                  where m.org_id = p_org and m.id = p_item and m.photo_path is not null) then
    raise exception 'this dish has no photo' using errcode = 'invalid_parameter_value';
  end if;
  -- The poster needs the org's colours: an org that never opened Settings → Social gets the defaults.
  insert into public.social_settings (org_id) values (p_org) on conflict (org_id) do nothing;
  insert into public.social_posts (org_id, menu_item_id, source, angle, format, plan_date, scheduled_at,
                                   own_text, created_by)
  values (p_org, p_item, 'owner', 'own', p_format, p_plan_date, p_when,
          nullif(btrim(p_own_text), ''), (select auth.uid()))
  returning id into v_id;
  perform private.write_audit(p_org, null, 'social.request', 'social_post', v_id::text, null,
    jsonb_build_object('menu_item_id', p_item, 'format', p_format, 'scheduled_at', p_when), null, null, null);
  return v_id;
end $$;

create function public.skip_social_post(p_post uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  p public.social_posts;
begin
  select * into p from public.social_posts where id = p_post for update;
  if not found or not private.has_role(p.org_id, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p.status not in ('planned', 'ready', 'failed') then
    raise exception 'this post is already out' using errcode = 'invalid_parameter_value';
  end if;
  update public.social_posts set status = 'skipped' where id = p_post;
  perform private.write_audit(p.org_id, null, 'social.skip', 'social_post', p_post::text,
    jsonb_build_object('status', p.status), jsonb_build_object('status', 'skipped'), null, null, null);
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('request_social_post', 'skip_social_post')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
comment on function public.request_social_post is 'Owner/manager adds their own post for a dish with a photo; published by the job (ADR 0040).';
comment on function public.skip_social_post is 'Owner/manager stops a post that has not gone out yet (ADR 0040).';

-- Posters and reels: Facebook and Instagram fetch them by public URL, so the bucket is public. Only the
-- job (service role) writes; files are removed a few days after publishing (social_posts.media_cleared_at).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-media', 'social-media', true, 31457280, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('xedine-social-tick', '*/10 * * * *', $cmd$select private.dispatch_job('social_tick')$cmd$);
    exception when others then
      raise notice 'could not create the pg_cron schedule: %', sqlerrm;
    end;
  end if;
end $$;
