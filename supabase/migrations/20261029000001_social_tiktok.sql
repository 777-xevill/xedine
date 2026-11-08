-- ---------------------------------------------------------------------------------------------
-- TikTok for the social autopilot (ADR 0041). The org connects a TikTok account next to its Facebook
-- Page and Instagram; every post also goes to TikTok as a video (TikTok takes no posters from us).
--
--  * social_accounts  may now hold a 'tiktok' row. TikTok's account id (open_id) is not a number, so the
--                     digits-only check applies to Facebook and Instagram only.
--  * social_tokens    TikTok access tokens live 24 hours: the job refreshes them with the refresh token.
--  * social_settings  tiktok_mode: 'draft' sends the video to the owner's TikTok inbox to post with one
--                     tap (TikTok's rules for an audited app); 'direct' posts by itself.
--  * social_posts     tiktok_publish_id while TikTok processes the upload, tiktok_id once it is done.
-- ---------------------------------------------------------------------------------------------

alter table public.social_accounts drop constraint social_accounts_platform;
alter table public.social_accounts add constraint social_accounts_platform
  check (platform in ('facebook', 'instagram', 'tiktok'));
alter table public.social_accounts drop constraint social_accounts_external_id;
alter table public.social_accounts add constraint social_accounts_external_id check (
  (platform in ('facebook', 'instagram') and external_id ~ '^[0-9]{1,40}$')
  or (platform = 'tiktok' and external_id ~ '^[A-Za-z0-9_.-]{1,100}$')
);
comment on table public.social_accounts is 'The Facebook Page, Instagram and TikTok account an org connected for posting (ids and names only). | written by: social | phase: 11';

alter table public.social_tokens
  add column refresh_token text,
  add column expires_at timestamptz;
comment on table public.social_tokens is 'Access token per connected account (Meta Page token; TikTok token + refresh token); service role only. | written by: social | phase: 11';

alter table public.social_settings
  add column tiktok_mode text not null default 'draft'
    constraint social_settings_tiktok_mode check (tiktok_mode in ('draft', 'direct'));

alter table public.social_posts
  add column tiktok_publish_id text,
  add column tiktok_id text;
comment on table public.social_posts is 'Facebook/Instagram/TikTok posts the autopilot planned, made and published. | written by: social | phase: 11';
