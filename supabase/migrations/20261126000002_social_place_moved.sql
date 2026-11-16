-- The restaurant's country and time zone now live on org_settings (20261126000001), set by the owner in
-- Settings. The video settings go back to how many, the voice and the greetings (owner or manager).

drop function public.save_social_video_settings(uuid, smallint, text, text, boolean, text, text);
alter table public.social_settings drop column country, drop column timezone;

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
                       'voice_gender', p_voice_gender, 'greetings', p_greetings),
    null, null, null);
end $$;
revoke execute on function public.save_social_video_settings(uuid, smallint, text, text, boolean) from public, anon;
grant execute on function public.save_social_video_settings(uuid, smallint, text, text, boolean) to authenticated, service_role;
comment on function public.save_social_video_settings is 'Owner/manager sets the autopilot''s videos: how many a day, the AI voice and special-day greetings (ADR 0061).';
