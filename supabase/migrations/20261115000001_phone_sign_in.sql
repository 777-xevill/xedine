-- Sign in with a phone number, at no cost (ADR 0050).
-- SMS costs money, so the phone is proven by Telegram instead: the person shares their own contact with the
-- Xedine bot (Telegram only lets a person share the number of their own account), the bot replies with a
-- 6-digit code, and the person types the phone and the code on the sign-in page. Everything lives in the
-- private schema and is reached only through the service-role functions below.

create table private.phone_sign_in_codes (
  id uuid primary key default gen_random_uuid(),
  -- +8801XXXXXXXXX (normalizeBdPhone).
  phone text not null constraint phone_sign_in_codes_phone check (phone ~ '^\+8801[3-9][0-9]{8}$'),
  -- HMAC of phone + code with a server secret; the code itself is never stored.
  code_hash text not null constraint phone_sign_in_codes_hash check (code_hash ~ '^[0-9a-f]{64}$'),
  full_name text constraint phone_sign_in_codes_name check (length(full_name) <= 120),
  attempts int not null default 0,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index phone_sign_in_codes_phone_idx on private.phone_sign_in_codes (phone, created_at desc);
comment on table private.phone_sign_in_codes is
  'One-time sign-in codes sent by the Telegram bot to a phone it verified (ADR 0050). Service role only.';

-- Which account a phone signs in to. Made on the first successful sign-in.
create table private.phone_accounts (
  phone text primary key constraint phone_accounts_phone check (phone ~ '^\+8801[3-9][0-9]{8}$'),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table private.phone_accounts is 'The account a verified phone number signs in to (ADR 0050).';

-- A new code for a phone. Earlier unused codes stop working; at most 5 codes per phone per hour.
create function public.phone_sign_in_issue(
  p_phone text, p_code_hash text, p_full_name text, p_now timestamptz
) returns text language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(p_phone, '') !~ '^\+8801[3-9][0-9]{8}$' then return 'invalid'; end if;
  if (select count(*) from private.phone_sign_in_codes
       where phone = p_phone and created_at > p_now - interval '1 hour') >= 5 then
    return 'too_many';
  end if;
  update private.phone_sign_in_codes set used_at = p_now where phone = p_phone and used_at is null;
  insert into private.phone_sign_in_codes (phone, code_hash, full_name, created_at, expires_at)
  values (p_phone, p_code_hash, nullif(left(trim(p_full_name), 120), ''), p_now, p_now + interval '10 minutes');
  return 'sent';
end $$;

-- Checks a typed code. The newest live code for the phone gets at most 5 tries. On success the code is used
-- up and the result carries the phone's account (null for a first sign-in) and the name Telegram gave.
create function public.phone_sign_in_check(p_phone text, p_code_hash text, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c private.phone_sign_in_codes;
begin
  select * into c from private.phone_sign_in_codes
   where phone = p_phone and used_at is null and expires_at > p_now
   order by created_at desc limit 1 for update;
  if not found then return jsonb_build_object('status', 'no_code'); end if;
  if c.attempts >= 5 then return jsonb_build_object('status', 'locked'); end if;
  if c.code_hash <> p_code_hash then
    update private.phone_sign_in_codes set attempts = attempts + 1 where id = c.id;
    return jsonb_build_object('status', case when c.attempts + 1 >= 5 then 'locked' else 'wrong' end);
  end if;
  update private.phone_sign_in_codes set used_at = p_now where id = c.id;
  return jsonb_build_object(
    'status', 'ok',
    'full_name', c.full_name,
    'user_id', (select user_id from private.phone_accounts where phone = p_phone)
  );
end $$;

-- Remembers the account made for a phone on its first sign-in, and puts the phone on the profile.
create function public.phone_account_link(p_phone text, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.phone_accounts (phone, user_id) values (p_phone, p_user_id)
  on conflict (phone) do nothing;
  update public.profiles set phone = p_phone where user_id = p_user_id and phone is null;
end $$;

revoke execute on function public.phone_sign_in_issue(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.phone_sign_in_issue(text, text, text, timestamptz) to service_role;
revoke execute on function public.phone_sign_in_check(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.phone_sign_in_check(text, text, timestamptz) to service_role;
revoke execute on function public.phone_account_link(text, uuid) from public, anon, authenticated;
grant execute on function public.phone_account_link(text, uuid) to service_role;

comment on function public.phone_sign_in_issue is 'Stores a new sign-in code for a phone the Telegram bot verified (service role only). ADR 0050.';
comment on function public.phone_sign_in_check is 'Checks a typed phone sign-in code, 5 tries (service role only). ADR 0050.';
comment on function public.phone_account_link is 'Links a phone to the account made on its first sign-in (service role only). ADR 0050.';
