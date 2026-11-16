-- Restaurants outside Bangladesh, step 1 (the founder, 2026-11-16: "any country's restaurant owner can use it").
-- Each restaurant has a country, a time zone and a currency, set at sign-up and by the owner in Settings:
--   org_settings + country (ISO 3166 alpha-2, default 'BD'), timezone (IANA, default 'Asia/Dhaka'),
--                  currency (ISO 4217, default 'BDT')
-- The currency cannot change once the restaurant has orders (every stored amount is in its minor unit), like the
-- price basis (ADR 0005). The owner writes org_settings already (RLS) and every change is audited (trigger).
-- Videos read the country and the time zone from here; the copy on social_settings (20261125000001) is moved
-- here and dropped in 20261126000002 once the app no longer reads it.
-- Money, the business day and the metrics still use taka and Asia/Dhaka: later steps carry these through.

alter table public.org_settings
  add column country text not null default 'BD'
    constraint org_settings_country check (country ~ '^[A-Z]{2}$'),
  add column timezone text not null default 'Asia/Dhaka'
    constraint org_settings_timezone check (length(timezone) between 3 and 40
                                            and timezone ~ '^[A-Za-z_]+(/[A-Za-z_+-]+){0,2}$'),
  add column currency text not null default 'BDT'
    constraint org_settings_currency check (currency ~ '^[A-Z]{3}$');
comment on column public.org_settings.country is 'ISO 3166 alpha-2 country of the restaurant: its special days, calendar and wording.';
comment on column public.org_settings.timezone is 'IANA time zone of the restaurant: posting times (and, in later steps, its business day).';
comment on column public.org_settings.currency is 'ISO 4217 currency of every amount the restaurant stores; fixed once it has orders.';

-- What a manager may already have picked for the videos becomes the restaurant's own.
update public.org_settings o
   set country = s.country, timezone = s.timezone
  from public.social_settings s
 where s.org_id = o.org_id and (s.country <> o.country or s.timezone <> o.timezone);

create function private.guard_currency() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.currency is distinct from old.currency
     and exists (select 1 from public.orders o where o.org_id = new.org_id limit 1) then
    raise exception 'currency cannot change after the organization has orders'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger org_settings_guard_currency before update on public.org_settings
  for each row execute function private.guard_currency();

comment on table public.org_settings is 'VAT/service-charge config, price basis, cutoff, dayparts, week start, locale, country, time zone, currency. | written by: tenancy | phase: 0';
