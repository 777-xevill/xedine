-- ADR 0061 (later the same week): a restaurant's country decides the culture of its videos.
--   social_settings  + country (ISO 3166 alpha-2, default 'BD'), timezone (IANA name, default 'Asia/Dhaka')
--   save_social_video_settings also takes the country and the time zone (both optional: null keeps what is saved).
-- The special days, the weekly greeting, the posting hours and the video language follow these (the rules live in
-- src/modules/social/culture.ts). Changing from Bangladesh to another country also puts the post language on
-- English, since the Bangla lines are written for Bangladeshi restaurants; the owner can set Bangla again in
-- Settings → Social (a Bangladeshi restaurant abroad).

alter table public.social_settings
  add column country text not null default 'BD'
    constraint social_settings_country check (country ~ '^[A-Z]{2}$'),
  add column timezone text not null default 'Asia/Dhaka'
    constraint social_settings_timezone check (length(timezone) between 3 and 40
                                               and timezone ~ '^[A-Za-z_]+(/[A-Za-z_+-]+){0,2}$');
comment on column public.social_settings.country is 'ISO 3166 alpha-2 country of the restaurant: its special days, weekly greeting and video language (ADR 0061).';
comment on column public.social_settings.timezone is 'IANA time zone the autopilot''s posting times and days are kept in (ADR 0061).';

drop function public.save_social_video_settings(uuid, smallint, text, text, boolean);
create function public.save_social_video_settings(p_org uuid, p_videos_per_day smallint, p_voice_share text,
                                                  p_voice_gender text, p_greetings boolean,
                                                  p_country text default null, p_timezone text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_old_country text;
  v_country text;
begin
  if not private.has_role(p_org, array['owner', 'manager']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_videos_per_day is null or p_videos_per_day not between 0 and 5
     or p_voice_share not in ('none', 'half', 'all') or p_voice_gender not in ('female', 'male')
     or p_greetings is null
     or (p_country is not null and p_country !~ '^[A-Z]{2}$')
     or (p_timezone is not null and (length(p_timezone) not between 3 and 40
                                     or p_timezone !~ '^[A-Za-z_]+(/[A-Za-z_+-]+){0,2}$')) then
    raise exception 'bad video settings' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.social_settings (org_id) values (p_org) on conflict (org_id) do nothing;
  select jsonb_build_object('videos_per_day', s.videos_per_day, 'voice_share', s.voice_share,
                            'voice_gender', s.voice_gender, 'greetings', s.greetings,
                            'country', s.country, 'timezone', s.timezone, 'language', s.language),
         s.country
    into v_before, v_old_country from public.social_settings s where s.org_id = p_org for update;
  v_country := coalesce(p_country, v_old_country);
  update public.social_settings
     set videos_per_day = p_videos_per_day, voice_share = p_voice_share,
         voice_gender = p_voice_gender, greetings = p_greetings,
         country = v_country, timezone = coalesce(p_timezone, timezone),
         language = case when v_old_country = 'BD' and v_country <> 'BD' then 'en' else language end
   where org_id = p_org;
  perform private.write_audit(p_org, null, 'social.video_settings', 'social_settings', p_org::text, v_before,
    jsonb_build_object('videos_per_day', p_videos_per_day, 'voice_share', p_voice_share,
                       'voice_gender', p_voice_gender, 'greetings', p_greetings,
                       'country', v_country, 'timezone', coalesce(p_timezone, (v_before->>'timezone'))),
    null, null, null);
end $$;
revoke execute on function public.save_social_video_settings(uuid, smallint, text, text, boolean, text, text) from public, anon;
grant execute on function public.save_social_video_settings(uuid, smallint, text, text, boolean, text, text) to authenticated, service_role;
comment on function public.save_social_video_settings is 'Owner/manager sets the autopilot''s videos: how many a day, the AI voice, special-day greetings, the restaurant''s country and time zone (ADR 0061).';
