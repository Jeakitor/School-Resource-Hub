-- =============================================================================
-- School Resource Hub — 0008 moderation (Phase 6)
--
-- 1. Teacher flags are staff-only. Contributors still see decisions (feedback)
--    and teacher notes on their own work, but not flags.
-- 2. Only notes can be public corrections (flags and decisions can't be made public).
-- 3. admin_list_users(): admins need emails to manage roles; emails live in
--    auth.users, which the website cannot read. Admin-only, checked inside.
-- 4. admin_orphan_files(): uploaded files no resource refers to (e.g. the browser
--    closed between upload and save). Admin-only. Deleting them uses the existing
--    storage delete policy (admins may delete any file).
-- Safe to run on a project that already has 0001–0007. Changes no data.
-- =============================================================================

-- 1. Review visibility ----------------------------------------------------------
drop policy "reviews: read" on public.resource_reviews;

create policy "reviews: read"
  on public.resource_reviews for select to anon, authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.resources r
      where r.id = resource_reviews.resource_id
        and (
          public.is_teacher_for(r.subject_id)
          or (r.uploader_id = (select auth.uid()) and resource_reviews.kind <> 'flag')
          or (resource_reviews.is_public and resource_reviews.kind = 'note' and r.status = 'approved')
        )
    )
  );

-- 2. Only notes can be public ----------------------------------------------------
-- NOT VALID first so the statement never fails on old rows; then validate.
alter table public.resource_reviews
  add constraint reviews_only_notes_public check (not is_public or kind = 'note') not valid;
alter table public.resource_reviews validate constraint reviews_only_notes_public;

-- 3. Users list for administrators -------------------------------------------------
create function public.admin_list_users()
returns table (
  id uuid, email text, display_name text, joined timestamptz,
  roles text[], teacher_subjects bigint[]
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators can list users' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text, p.display_name, u.created_at,
           array(select r.role::text from public.user_roles r where r.user_id = u.id order by 1),
           array(select ts.subject_id from public.teacher_subjects ts where ts.user_id = u.id order by 1)
    from auth.users u
    join public.profiles p on p.id = u.id
    order by u.created_at;
end $$;

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

-- 4. Files no resource refers to -----------------------------------------------------
create function public.admin_orphan_files(p_min_age interval default interval '1 day')
returns table (name text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Only administrators can list files' using errcode = '42501';
  end if;
  return query
    select o.name, o.created_at
    from storage.objects o
    where o.bucket_id = 'resource-files'
      and o.created_at < now() - greatest(p_min_age, interval '1 hour') -- never touch uploads in progress
      and not exists (select 1 from public.resources r where r.storage_path = o.name)
    order by o.created_at;
end $$;

revoke all on function public.admin_orphan_files(interval) from public, anon;
grant execute on function public.admin_orphan_files(interval) to authenticated;
