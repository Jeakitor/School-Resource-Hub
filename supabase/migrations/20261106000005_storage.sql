-- =============================================================================
-- School Resource Hub — 0005 storage
--
-- One PRIVATE bucket. Nothing is ever public by URL. Files are served through
-- short-lived signed URLs, which Supabase only issues when the SELECT policy
-- below allows it. So a file becomes readable by everyone exactly when its
-- resource is approved, and stops being readable when it is removed:
-- publication needs no file copying.
--
-- Path layout: <uploader uuid>/<random uuid>.pdf
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resource-files', 'resource-files', false, 20971520, array['application/pdf'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Upload: signed-in users, only into their own top-level folder, only .pdf.
create policy "resource-files: upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'resource-files'
    and array_length(storage.foldername(name), 1) = 1
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and lower(storage.extension(name)) = 'pdf'
  );

-- Read (and therefore signed URLs): owner, admins, teachers of the subject,
-- or anyone once the resource referencing the file is approved.
create policy "resource-files: read own, staff, or published"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'resource-files'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.is_admin()
      or exists (
        select 1 from public.resources r
        where r.storage_path = objects.name
          and (r.status = 'approved' or public.is_teacher_for(r.subject_id))
      )
    )
  );

-- Delete: admins; owners only while the file is not part of a published resource.
create policy "resource-files: delete own unpublished, admin any"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'resource-files'
    and (
      public.is_admin()
      or (
        (storage.foldername(name))[1] = (select auth.uid())::text
        and not exists (
          select 1 from public.resources r
          where r.storage_path = objects.name and r.status = 'approved'
        )
      )
    )
  );

-- Deliberately NO update policy: files cannot be overwritten or renamed,
-- so an approved PDF can never be swapped for different content.
