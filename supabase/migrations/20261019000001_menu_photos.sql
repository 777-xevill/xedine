-- ADR 0031: dish photos for the till. menu_items.photo_path (there since Phase 0, never used) now points at
-- an object in a public `menu-photos` bucket. A dish photo is the same thing a QR menu shows to anyone, so
-- reading is public; WRITING is owner-only and only inside the org's own folder (`<org_id>/<file>`).
-- Paths carry a random suffix, so a replaced photo is a new URL and the till's cache never serves a stale one.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-photos', 'menu-photos', true, 524288, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy menu_photos_owner_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'menu-photos'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and private.has_role(((storage.foldername(name))[1])::uuid, array['owner']::public.app_role[])
  );
create policy menu_photos_owner_update on storage.objects for update to authenticated
  using (
    bucket_id = 'menu-photos'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and private.has_role(((storage.foldername(name))[1])::uuid, array['owner']::public.app_role[])
  );
create policy menu_photos_owner_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'menu-photos'
    and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
    and private.has_role(((storage.foldername(name))[1])::uuid, array['owner']::public.app_role[])
  );
-- Reads need no policy: a public bucket serves its objects by URL. Listing stays closed (no select policy).

-- An item can only point at a file in its own org's folder.
alter table public.menu_items
  add constraint menu_items_photo_in_org_folder
  check (photo_path is null or photo_path like org_id::text || '/%');
