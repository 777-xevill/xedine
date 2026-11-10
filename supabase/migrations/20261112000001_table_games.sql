-- ADR 0046: games on the table page. Customers play while they wait, on one phone or each on their own
-- phone (live through Realtime broadcast: no table, no account, nothing stored). No prizes. The owner
-- switches games on or off and can give each game, and the game's host character, the restaurant's own
-- name ("Kacchi Bhai Quiz").

alter table public.org_settings
  add column games_on boolean not null default true,
  add column game_names jsonb not null default '{}'::jsonb
    constraint org_settings_game_names check (jsonb_typeof(game_names) = 'object' and length(game_names::text) <= 2000);

comment on column public.org_settings.games_on is 'Games on the customer''s table page (ADR 0046).';
comment on column public.org_settings.game_names is
  'The owner''s own name for each table game and its host character, by game key; empty uses the default (ADR 0046).';

-- The table page now also says whether games are on and what the owner calls them.
create or replace function public.table_page(p_token text, p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.dining_tables;
  b public.branches;
  s public.loyalty_settings;
  g public.org_settings;
  v_today date;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{32}$' then return null; end if;
  select * into t from public.dining_tables where qr_token = p_token and is_active;
  if not found then return null; end if;
  select * into b from public.branches where org_id = t.org_id and id = t.branch_id and is_active;
  if not found then return null; end if;
  select * into s from public.loyalty_settings where org_id = t.org_id;
  select * into g from public.org_settings where org_id = t.org_id;
  v_today := private.business_date(p_now, private.branch_cutoff(t.org_id, t.branch_id));

  return jsonb_build_object(
    'org_id', t.org_id,
    'restaurant', (select name from public.organizations where id = t.org_id),
    'branch', b.name,
    'address', concat_ws(', ', nullif(b.address, ''), nullif(b.area, '')),
    'table', t.name,
    'member_on', coalesce(s.is_on, false),
    'earn_points', s.earn_points,
    'earn_every_poisha', s.earn_every_poisha,
    'point_value_poisha', s.point_value_poisha,
    'discount_bps', case when s.is_on and s.discount_on then s.discount_bps end,
    'google_review_url', b.google_review_url,
    'complaint_token', b.complaint_token,
    'games_on', coalesce(g.games_on, true),
    'game_names', coalesce(g.game_names, '{}'::jsonb),
    'menu', coalesce((
      select jsonb_agg(m order by m.cat_sort, m.cat, m.sort_order, m.name) from (
        select mi.name, mi.name_bn, mi.description,
               coalesce(case when p.has_price_override then p.price_poisha end, mi.base_price_poisha) as price_poisha,
               mi.photo_path, mi.sort_order, coalesce(mc.sort_order, 1000000) as cat_sort,
               coalesce(mc.name, '') as cat, mc.name_bn as cat_bn
          from public.menu_items mi
          left join public.menu_categories mc on mc.org_id = mi.org_id and mc.id = mi.category_id
          left join public.branch_item_prices p
            on p.org_id = mi.org_id and p.branch_id = t.branch_id and p.menu_item_id = mi.id and p.variant_id is null
         where mi.org_id = t.org_id and mi.is_active and (mc.id is null or mc.is_active)
           and coalesce(p.is_available, true)
           and not exists (select 1 from private.m_blocked_items(t.org_id, t.branch_id, v_today) x
                            where x.menu_item_id = mi.id and x.variant_id is null)
         limit 300) m), '[]'::jsonb));
end $$;

revoke execute on function public.table_page(text, timestamptz) from public, anon, authenticated;
grant execute on function public.table_page(text, timestamptz) to service_role;
