-- Offer notifications on the customer's own phone (ADR 0048).
-- A customer who ticks "Get notified when you get a personal offer" on the table page gives two things:
-- the usual WhatsApp/SMS marketing consent (ADR 0045) and a browser push subscription (Chrome and the other
-- browsers on Android and desktop). A campaign the owner approved is then also pushed to that phone.
-- Everything here is service role only: the subscription's endpoint is a capability to ring that phone.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null,
  -- Where the browser's push service takes a message for this phone (always https).
  endpoint text not null
    constraint push_subscriptions_endpoint check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  -- The phone's public key (65 bytes) and its auth secret (16 bytes), URL-safe base64.
  p256dh text not null constraint push_subscriptions_p256dh check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth text not null constraint push_subscriptions_auth check (auth ~ '^[A-Za-z0-9_-]{20,30}$'),
  -- Switched off when the browser says the subscription is gone (the customer blocked or cleared it).
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  unique (org_id, endpoint),
  foreign key (org_id, customer_id) references public.customers (org_id, id) on delete cascade
);
create index push_subscriptions_customer_idx on public.push_subscriptions (org_id, customer_id) where is_active;
select private.register_table('push_subscriptions', 'service_only',
  'browser push subscriptions of customers who asked for offers; jobs and the join route only (ADR 0048)');
comment on table public.push_subscriptions is
  'A customer''s phone that agreed to offer notifications (endpoint and keys); service role only. | written by: customers | phase: 11';

-- The server''s own VAPID key pair (identifies Xedine to the browsers'' push services). One row, made the
-- first time a table page needs it, so there is no secret to set by hand. Only the service role can call
-- the two functions below.
create table private.web_push_keys (
  id boolean primary key default true constraint web_push_keys_one_row check (id),
  public_key text not null,
  private_jwk text not null,
  created_at timestamptz not null default now()
);
comment on table private.web_push_keys is 'The VAPID key pair used to send browser push (ADR 0048). One row.';

create function public.web_push_keys_get() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('public_key', public_key, 'private_jwk', private_jwk)
    from private.web_push_keys where id;
$$;

-- Stores the pair if there is none yet and returns the stored pair (the first writer wins).
create function public.web_push_keys_put(p_public text, p_private_jwk text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.web_push_keys (public_key, private_jwk) values (p_public, p_private_jwk)
  on conflict (id) do nothing;
  return (select jsonb_build_object('public_key', public_key, 'private_jwk', private_jwk)
            from private.web_push_keys where id);
end $$;

-- Saves a phone's subscription for the member whose card token is given (the card token is the credential,
-- as on the card page). Only a customer who has agreed to offers is saved. A customer keeps at most 5 phones.
create function public.save_push_subscription(
  p_card_token text, p_endpoint text, p_p256dh text, p_auth text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.member_cards;
begin
  if coalesce(p_card_token, '') !~ '^[A-Za-z0-9_-]{24}$' then return jsonb_build_object('status', 'gone'); end if;
  select * into c from public.member_cards where token = p_card_token;
  if not found then return jsonb_build_object('status', 'gone'); end if;
  if not private.marketing_ok(c.org_id, c.customer_id) then return jsonb_build_object('status', 'no_consent'); end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000
     or coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_-]{80,100}$' or coalesce(p_auth, '') !~ '^[A-Za-z0-9_-]{20,30}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  insert into public.push_subscriptions (org_id, customer_id, endpoint, p256dh, auth)
  values (c.org_id, c.customer_id, p_endpoint, p_p256dh, p_auth)
  on conflict (org_id, endpoint) do update
    set customer_id = excluded.customer_id, p256dh = excluded.p256dh, auth = excluded.auth, is_active = true;
  delete from public.push_subscriptions
   where org_id = c.org_id and customer_id = c.customer_id
     and id in (select id from public.push_subscriptions
                 where org_id = c.org_id and customer_id = c.customer_id
                 order by created_at desc offset 5);
  return jsonb_build_object('status', 'saved');
end $$;

revoke execute on function public.web_push_keys_get() from public, anon, authenticated;
grant execute on function public.web_push_keys_get() to service_role;
revoke execute on function public.web_push_keys_put(text, text) from public, anon, authenticated;
grant execute on function public.web_push_keys_put(text, text) to service_role;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_push_subscription(text, text, text, text) to service_role;

comment on function public.web_push_keys_get is 'The server''s VAPID key pair, or null (service role only). ADR 0048.';
comment on function public.web_push_keys_put is 'Stores the VAPID key pair if none exists and returns the stored one (service role only). ADR 0048.';
comment on function public.save_push_subscription is 'Saves a member''s phone for offer notifications; needs their marketing consent (service role only). ADR 0048.';
