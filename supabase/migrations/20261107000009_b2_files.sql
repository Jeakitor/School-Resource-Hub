-- =============================================================================
-- School Resource Hub — 0009 PDF files move to Backblaze B2
--
-- Files now live in a PRIVATE Backblaze B2 bucket. Supabase still decides
-- everything: the `files` Edge Function (supabase/functions/files) is the only
-- thing that holds B2 keys, and it asks this database before every action.
--
--   public.files      one row per uploaded PDF. Written ONLY by the Edge Function
--                     (service role), after it has checked the user, the size and
--                     the PDF signature. Users cannot insert rows, so a resource
--                     can only point at a file that really was uploaded and checked.
--   resource_file_exists()  now checks public.files instead of Supabase Storage.
--   can_delete_file()       asked by the Edge Function before deleting from B2.
--   admin_orphan_files()    now lists rows in public.files nothing refers to.
--
-- Viewing: the Edge Function reads the resource WITH THE VIEWER'S OWN TOKEN, so
-- the existing resources RLS decides who may get a (1-hour) link. Unchanged rules.
--
-- Before running: withdraw any submission whose PDF is in Supabase Storage
-- (test data). Its file is not in public.files, so it could not be viewed afterwards.
-- The old storage bucket and its policies (0005) are left in place, unused.
-- =============================================================================

create table public.files (
  path       text primary key
             check (path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  size       bigint not null check (size between 5 and 20971520),
  created_at timestamptz not null default now(),
  -- The folder is always the owner's id.
  constraint files_path_in_owner_folder check (split_part(path, '/', 1) = owner_id::text)
);
create index files_owner_idx on public.files (owner_id);

alter table public.files enable row level security;
revoke all on public.files from anon, authenticated;
grant select on public.files to authenticated;

create policy "files: read own or admin"
  on public.files for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_admin());
-- No insert / update / delete policies or grants: only the Edge Function
-- (service role, which bypasses RLS) writes here.

-- A resource may only reference a checked upload in the caller's own folder (or any, for admins).
create or replace function public.resource_file_exists(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.files f
    where f.path = p_path
      and (f.owner_id = (select auth.uid()) or public.is_admin())
  );
$$;

-- Files can be deleted only when no resource refers to them (after a withdrawal or
-- a replacement), by their owner or an admin. A published file can never be deleted
-- this way: unpublish or delete the resource first.
create function public.can_delete_file(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.files f
    where f.path = p_path
      and (f.owner_id = (select auth.uid()) or public.is_admin())
      and not exists (select 1 from public.resources r where r.storage_path = f.path)
  );
$$;
revoke all on function public.can_delete_file(text) from public, anon;
grant execute on function public.can_delete_file(text) to authenticated;

create or replace function public.admin_orphan_files(p_min_age interval default interval '1 day')
returns table (name text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators can list files' using errcode = '42501';
  end if;
  return query
    select f.path, f.created_at
    from public.files f
    where f.created_at < now() - greatest(p_min_age, interval '1 hour')
      and not exists (select 1 from public.resources r where r.storage_path = f.path)
    order by f.created_at;
end $$;
