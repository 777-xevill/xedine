-- ADR 0025: the bazar by chat. A purchaser texts or voices the day's purchases to the Xedine Telegram
-- bot; the bot answers with the lines it understood and a ✅ button; only that tap moves stock.
--
-- The bot runs as the service role, but it never acts with the service role's powers on tenant data:
-- every chat_* function resolves the chat to the one person the owner linked it to, then acts as that
-- person (private.act_as), so the existing role checks (owner/purchaser of the branch) and the audit
-- trail (actor = that person) apply exactly as on the web. A membership removed or a role changed
-- takes effect in the chat at once.

create type public.chat_channel as enum ('telegram', 'whatsapp');

-- One row per link the owner makes for a person. Pending while code_hash is set; active once a chat
-- redeemed it (external_id set); revoked_at ends it. The link code travels only in the t.me deep link
-- the owner sends; only its hash is stored.
create table public.chat_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  channel public.chat_channel not null,
  code_hash text unique,
  code_expires_at timestamptz,
  external_id text,
  linked_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade
);
-- A chat speaks for one person at a time.
create unique index chat_links_active_chat on public.chat_links (channel, external_id)
  where revoked_at is null and external_id is not null;
create index chat_links_org_idx on public.chat_links (org_id, branch_id);
create index chat_links_user_idx on public.chat_links (user_id);

alter table public.chat_links enable row level security;
create policy chat_links_select on public.chat_links for select to authenticated
  using (user_id = (select auth.uid()) or private.has_role(org_id, array['owner']::public.app_role[]));
revoke insert, update, delete, truncate on table public.chat_links from anon, authenticated;
select private.register_table('chat_links', 'custom',
  'select: the linked person or the owner; written only by the chat_* / *_chat_link RPCs (audited)');
comment on table public.chat_links is
  'Which chat (Telegram) speaks for which purchaser, and the one-time link code that connects it. | written by: messaging | phase: 11';

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------

-- The rest of this transaction runs as p_user: auth.uid() returns them, so role checks and the audit
-- log see the person, not the bot. Transaction-local; only the service-role chat_* functions call it.
create function private.act_as(p_user uuid) returns void
language sql volatile set search_path = '' as $$
  select set_config('request.jwt.claims',
                    jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_user::text, true);
$$;
revoke execute on function private.act_as(uuid) from public, anon, authenticated;

-- The active link for a chat, or an error the bot turns into "connect first".
create function private.chat_link_for(p_channel public.chat_channel, p_external_id text)
returns public.chat_links language plpgsql stable security definer set search_path = '' as $$
declare
  l public.chat_links;
begin
  select * into l from public.chat_links
   where channel = p_channel and external_id = p_external_id and revoked_at is null;
  if not found then
    raise exception 'this chat is not connected' using errcode = 'P0002';
  end if;
  return l;
end $$;
revoke execute on function private.chat_link_for(public.chat_channel, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The owner's side (web)
-- ---------------------------------------------------------------------------------------------

-- The owner makes a link for someone who may buy for the branch (an owner or that branch's purchaser).
-- Returns the one-time code; an earlier unused link for the same person and channel stops working.
create function public.create_chat_link(p_org uuid, p_user uuid, p_branch uuid, p_channel public.chat_channel)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_code text := replace(gen_random_uuid()::text, '-', '');
  v_id uuid;
begin
  if not private.has_role(p_org, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from public.memberships m
     where m.org_id = p_org and m.user_id = p_user and m.status = 'active'
       and m.role = any (array['owner', 'purchaser']::public.app_role[])
       and (m.branch_scope = 'all' or exists (
         select 1 from public.membership_branches mb where mb.membership_id = m.id and mb.branch_id = p_branch))
  ) then
    raise exception 'that person cannot record purchases for this branch' using errcode = 'invalid_parameter_value';
  end if;
  update public.chat_links set revoked_at = now()
   where org_id = p_org and user_id = p_user and channel = p_channel
     and external_id is null and revoked_at is null;
  insert into public.chat_links (org_id, branch_id, user_id, channel, code_hash, code_expires_at, created_by)
  values (p_org, p_branch, p_user, p_channel, encode(sha256(convert_to(v_code, 'utf8')), 'hex'),
          now() + interval '48 hours', (select auth.uid()))
  returning id into v_id;
  perform private.write_audit(p_org, p_branch, 'chat.link_created', 'chat_link', v_id::text,
    null, jsonb_build_object('user_id', p_user, 'channel', p_channel), null, null, null);
  return v_code;
end $$;

-- The owner, or the linked person, disconnects a chat (or cancels an unused link).
create function public.revoke_chat_link(p_link uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  l public.chat_links;
begin
  select * into l from public.chat_links where id = p_link for update;
  if not found or not (l.user_id = (select auth.uid())
                       or private.has_role(l.org_id, array['owner']::public.app_role[])) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if l.revoked_at is not null then return; end if;
  update public.chat_links set revoked_at = now(), code_hash = null where id = p_link;
  perform private.write_audit(l.org_id, l.branch_id, 'chat.link_revoked', 'chat_link', p_link::text,
    null, null, null, null, null);
end $$;

-- ---------------------------------------------------------------------------------------------
-- The bot's side (service role only)
-- ---------------------------------------------------------------------------------------------

-- A chat sends the code from its t.me link. The chat now speaks for that person; if it spoke for
-- someone else before, that link ends. Returns who and where, for the welcome message.
create function public.chat_redeem_link(p_channel public.chat_channel, p_external_id text, p_code text)
returns table (org_id uuid, branch_id uuid, user_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  l public.chat_links;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_external_id), '') = '' then
    raise exception 'no chat id' using errcode = 'invalid_parameter_value';
  end if;
  select * into l from public.chat_links c
   where c.code_hash = encode(sha256(convert_to(coalesce(p_code, ''), 'utf8')), 'hex')
     and c.channel = p_channel and c.revoked_at is null and c.external_id is null
     and c.code_expires_at > now()
   for update;
  if not found then
    raise exception 'this link is used, expired or unknown' using errcode = 'P0002';
  end if;
  update public.chat_links c set revoked_at = now()
   where c.channel = p_channel and c.external_id = p_external_id and c.revoked_at is null;
  update public.chat_links c set external_id = p_external_id, linked_at = now(), code_hash = null
   where c.id = l.id;
  perform private.act_as(l.user_id);
  perform private.write_audit(l.org_id, l.branch_id, 'chat.linked', 'chat_link', l.id::text,
    null, jsonb_build_object('channel', p_channel), null, null, null);
  return query select l.org_id, l.branch_id, l.user_id;
end $$;

-- "/stop" in the chat.
create function public.chat_unlink(p_channel public.chat_channel, p_external_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  l public.chat_links;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into l from public.chat_links c
   where c.channel = p_channel and c.external_id = p_external_id and c.revoked_at is null;
  if not found then return false; end if;
  update public.chat_links set revoked_at = now() where id = l.id;
  perform private.act_as(l.user_id);
  perform private.write_audit(l.org_id, l.branch_id, 'chat.link_revoked', 'chat_link', l.id::text,
    null, null, 'stopped from the chat', null, null);
  return true;
end $$;

-- What the bot read from a message, saved as a draft by the linked person. Moves nothing.
create function public.chat_create_purchase_draft(
  p_channel public.chat_channel, p_external_id text, p_source public.purchase_source,
  p_raw_text text, p_extracted jsonb, p_confidence jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  l public.chat_links;
  v_id uuid;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  l := private.chat_link_for(p_channel, p_external_id);
  perform private.act_as(l.user_id);
  if not private.can_access_branch_role(l.org_id, l.branch_id, array['owner', 'purchaser']::public.app_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  insert into public.purchase_drafts (org_id, branch_id, source, raw_text, extracted, confidence, created_by)
  values (l.org_id, l.branch_id, p_source, left(p_raw_text, 4000), coalesce(p_extracted, '{}'),
          coalesce(p_confidence, '{}'), l.user_id)
  returning id into v_id;
  return v_id;
end $$;

-- A draft this chat made, if it is still this chat's to decide on.
create function private.chat_own_draft(l public.chat_links, p_draft uuid)
returns public.purchase_drafts language plpgsql stable security definer set search_path = '' as $$
declare
  d public.purchase_drafts;
begin
  select * into d from public.purchase_drafts
   where id = p_draft and org_id = l.org_id and created_by = l.user_id;
  if not found then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return d;
end $$;
revoke execute on function private.chat_own_draft(public.chat_links, uuid) from public, anon, authenticated;

-- ✅ in the chat. The lines come from the draft itself — exactly what the bot showed — and every line
-- must be complete (a known ingredient, a quantity in base units, a price); anything the bot flagged
-- has to be fixed first. The purchase is dated the branch business day the list was sent, even if the
-- tap comes after midnight. Then the same audited confirm_purchase_draft the web uses, as that person.
create function public.chat_confirm_purchase_draft(
  p_channel public.chat_channel, p_external_id text, p_draft uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  l public.chat_links;
  d public.purchase_drafts;
  v_lines jsonb;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  l := private.chat_link_for(p_channel, p_external_id);
  d := private.chat_own_draft(l, p_draft);
  if jsonb_typeof(d.extracted -> 'lines') <> 'array' or jsonb_array_length(d.extracted -> 'lines') = 0
     or exists (
       select 1 from jsonb_array_elements(d.extracted -> 'lines') x
        where coalesce(jsonb_array_length(x -> 'flags'), 0) > 0
           or nullif(x ->> 'ingredient_id', '') is null
           or (x ->> 'qty_base') is null or (x ->> 'line_total_poisha') is null)
  then
    raise exception 'this draft needs fixing before it can be confirmed' using errcode = 'invalid_parameter_value';
  end if;
  select jsonb_agg(jsonb_build_object('ingredient_id', x ->> 'ingredient_id',
                                      'qty_base', (x ->> 'qty_base')::numeric,
                                      'line_total_poisha', (x ->> 'line_total_poisha')::bigint))
    into v_lines from jsonb_array_elements(d.extracted -> 'lines') x;
  perform private.act_as(l.user_id);
  return public.confirm_purchase_draft(p_draft, null, nullif(btrim(d.extracted ->> 'supplier'), ''),
    private.business_date(d.created_at, private.branch_cutoff(d.org_id, d.branch_id)), v_lines);
end $$;

-- ❌ in the chat.
create function public.chat_discard_purchase_draft(
  p_channel public.chat_channel, p_external_id text, p_draft uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare
  l public.chat_links;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  l := private.chat_link_for(p_channel, p_external_id);
  perform private.chat_own_draft(l, p_draft);
  perform private.act_as(l.user_id);
  perform public.discard_purchase_draft(p_draft, 'cancelled in the chat');
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('create_chat_link', 'revoke_chat_link')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('chat_redeem_link', 'chat_unlink', 'chat_create_purchase_draft',
                         'chat_confirm_purchase_draft', 'chat_discard_purchase_draft')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

comment on function public.create_chat_link is 'Owner makes a one-time link that connects a purchaser''s chat to Xedine; audited. Phase 11.';
comment on function public.revoke_chat_link is 'Owner or the linked person disconnects a chat; audited. Phase 11.';
comment on function public.chat_redeem_link is 'Bot (service role): a chat redeems its link code and speaks for that person from then on. Phase 11.';
comment on function public.chat_unlink is 'Bot (service role): /stop disconnects the chat. Phase 11.';
comment on function public.chat_create_purchase_draft is 'Bot (service role): saves what a chat message said as a purchase draft, as the linked person. Phase 11.';
comment on function public.chat_confirm_purchase_draft is 'Bot (service role): ✅ confirms the chat''s own complete draft through confirm_purchase_draft, as the linked person. Phase 11.';
comment on function public.chat_discard_purchase_draft is 'Bot (service role): ❌ discards the chat''s own draft, as the linked person. Phase 11.';
