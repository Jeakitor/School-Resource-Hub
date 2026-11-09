-- =============================================================================
-- School Resource Hub — 0004 Row Level Security and privileges
--
-- Model (see docs/security.md):
--   anon      : read catalog + approved resources + names of credited contributors
--   student   : + submit; see/edit/withdraw OWN pending or rejected submissions
--   teacher   : + see and annotate resources in ASSIGNED subjects
--   admin     : everything; roles are granted only by admins
-- `(select auth.uid())` is wrapped in a sub-select so Postgres evaluates it once per query.
-- =============================================================================

alter table public.profiles         enable row level security;
alter table public.user_roles       enable row level security;
alter table public.subjects         enable row level security;
alter table public.teacher_subjects enable row level security;
alter table public.topics           enable row level security;
alter table public.resources        enable row level security;
alter table public.resource_reviews enable row level security;

-- Privileges: start from nothing, then grant only what each role needs.
-- (Supabase grants broad defaults to anon/authenticated; we narrow them.)
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.subjects, public.topics, public.resources, public.profiles, public.resource_reviews
  to anon, authenticated;
grant select, insert, delete on public.user_roles, public.teacher_subjects to authenticated;
grant insert, update, delete on public.subjects, public.topics            to authenticated;
grant insert, update, delete on public.resources                          to authenticated;
grant insert, delete         on public.resource_reviews                   to authenticated;
grant update (display_name)  on public.profiles                           to authenticated;
grant usage on all sequences in schema public to authenticated;

grant execute on function public.is_admin(), public.is_teacher(), public.is_teacher_for(bigint)
  to anon, authenticated;
grant execute on function public.moderate_resource(uuid, public.resource_status, text, public.resource_level)
  to authenticated;
grant execute on function public.tags_valid(text[]), public.tags_text(text[]) to anon, authenticated;
-- Called by the resources guard trigger, which runs with the caller's rights.
grant execute on function public.resource_file_exists(text) to authenticated;

-- profiles --------------------------------------------------------------------------
-- Visible: yourself; staff; and anyone credited on a published resource.
create policy "profiles: read own, staff, or credited contributors"
  on public.profiles for select to anon, authenticated
  using (
    id = (select auth.uid())
    or public.is_admin()
    or public.is_teacher()
    or exists (select 1 from public.resources r where r.uploader_id = profiles.id and r.status = 'approved')
  );

create policy "profiles: update own display name"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- user_roles / teacher_subjects: read own, admins manage --------------------------
create policy "user_roles: read own or admin"
  on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy "user_roles: admin grants"
  on public.user_roles for insert to authenticated
  with check (public.is_admin());
create policy "user_roles: admin revokes"
  on public.user_roles for delete to authenticated
  using (public.is_admin());

create policy "teacher_subjects: read own or admin"
  on public.teacher_subjects for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy "teacher_subjects: admin assigns"
  on public.teacher_subjects for insert to authenticated
  with check (public.is_admin());
create policy "teacher_subjects: admin unassigns"
  on public.teacher_subjects for delete to authenticated
  using (public.is_admin());

-- subjects / topics: public catalog, admin-managed ------------------------------------
create policy "subjects: public read" on public.subjects for select to anon, authenticated using (true);
create policy "subjects: admin insert" on public.subjects for insert to authenticated with check (public.is_admin());
create policy "subjects: admin update" on public.subjects for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "subjects: admin delete" on public.subjects for delete to authenticated using (public.is_admin());

create policy "topics: public read" on public.topics for select to anon, authenticated using (true);
create policy "topics: admin insert" on public.topics for insert to authenticated with check (public.is_admin());
create policy "topics: admin update" on public.topics for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "topics: admin delete" on public.topics for delete to authenticated using (public.is_admin());

-- resources ----------------------------------------------------------------------------
create policy "resources: read published, own, or as staff"
  on public.resources for select to anon, authenticated
  using (
    status = 'approved'
    or uploader_id = (select auth.uid())
    or public.is_admin()
    or public.is_teacher_for(subject_id)
  );

create policy "resources: students submit as themselves"
  on public.resources for insert to authenticated
  with check (uploader_id = (select auth.uid()));

-- Field-level rules for each role are enforced by resources_before_update (0003).
create policy "resources: owner edits unpublished, staff moderate"
  on public.resources for update to authenticated
  using (
    public.is_admin()
    or public.is_teacher_for(subject_id)
    or (uploader_id = (select auth.uid()) and status in ('pending', 'rejected'))
  )
  with check (
    public.is_admin()
    or public.is_teacher_for(subject_id)
    or (uploader_id = (select auth.uid()) and status = 'pending')
  );

create policy "resources: owner withdraws unpublished, admin removes"
  on public.resources for delete to authenticated
  using (
    public.is_admin()
    or (uploader_id = (select auth.uid()) and status in ('pending', 'rejected'))
  );

-- resource_reviews ----------------------------------------------------------------------
-- Owners see feedback on their own work; staff see their subjects; public sees
-- only notes marked public on published resources.
create policy "reviews: read"
  on public.resource_reviews for select to anon, authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.resources r
      where r.id = resource_reviews.resource_id
        and (
          r.uploader_id = (select auth.uid())
          or public.is_teacher_for(r.subject_id)
          or (resource_reviews.is_public and r.status = 'approved')
        )
    )
  );

create policy "reviews: admins decide, teachers annotate their subjects"
  on public.resource_reviews for insert to authenticated
  with check (
    public.is_admin()
    or (
      kind in ('note', 'flag')
      and exists (
        select 1 from public.resources r
        where r.id = resource_reviews.resource_id and public.is_teacher_for(r.subject_id)
      )
    )
  );

create policy "reviews: admin or author deletes"
  on public.resource_reviews for delete to authenticated
  using (public.is_admin() or author_id = (select auth.uid()));
