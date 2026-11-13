-- Notes (ADR 0055): short private notes the owner or a manager keeps about a staff member or about the
-- restaurant, on the Staff records page. Replaces the Advances and Sales-by-staff tabs (the tables and metric
-- functions stay; only those screens were removed).
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  branch_id uuid not null,
  -- Set when the note is about one person; empty for a note about the restaurant. If the person is deleted
  -- the note stays, as a note about the restaurant.
  staff_id uuid,
  body text not null constraint notes_body check (length(btrim(body)) between 1 and 2000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, branch_id) references public.branches (org_id, id) on delete cascade,
  foreign key (org_id, staff_id) references public.staff (org_id, id) on delete set null (staff_id)
);
create index notes_branch_idx on public.notes (org_id, branch_id, created_at desc);
create index notes_staff_idx on public.notes (org_id, staff_id) where staff_id is not null;

do $$
begin
  perform private.apply_policies('notes', 'branch', array['owner', 'manager']::public.app_role[],
    array['owner', 'manager']::public.app_role[], true,
    'private: owner and branch manager only; may be about a staff member, so never shown to cashiers or accountants');
end $$;

comment on table public.notes is
  'Private notes about a staff member or the restaurant, kept by the owner or a manager. | written by: staff | phase: 10';
