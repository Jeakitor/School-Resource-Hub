-- =============================================================================
-- School Resource Hub — 0007 allow the database owner to manage resources
--
-- The guard triggers in 0003 decide permissions from auth.uid(). In the Supabase
-- SQL Editor (or with a server-side service key) there is no signed-in user, so
-- even the project owner was blocked from fixing data.
--
-- Website visitors always run as the database role `anon` or `authenticated`.
-- Any other role (postgres in the SQL Editor, service_role on a server) is a
-- trusted administrative context and is allowed through.
-- These triggers are SECURITY INVOKER, so current_user here is the caller's role.
-- =============================================================================

create or replace function public.resources_before_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_at := now();
  new.updated_at := now();

  if current_user not in ('anon', 'authenticated') then
    -- Trusted context: keep what was sent, but record approval time if approved.
    if new.status = 'approved' and new.approved_at is null then
      new.approved_at := now();
    end if;
    return new;
  end if;

  new.teacher_reviewed := false;
  new.teacher_reviewed_by := null;
  new.teacher_reviewed_at := null;

  if public.is_admin() and new.status = 'approved' then
    new.approved_by := (select auth.uid());
    new.approved_at := now();
  else
    if not public.is_admin() then
      new.status := 'pending';
    end if;
    new.approved_by := null;
    new.approved_at := null;
  end if;
  return new;
end $$;

create or replace function public.resources_before_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  teacher_fields constant text[] := array['teacher_reviewed', 'teacher_reviewed_by', 'teacher_reviewed_at', 'updated_at', 'search'];
begin
  if new.id <> old.id or new.uploader_id <> old.uploader_id or new.created_at <> old.created_at then
    raise exception 'id, uploader and creation time cannot be changed' using errcode = '42501';
  end if;

  -- Trusted administrative context (SQL Editor / service role).
  if current_user not in ('anon', 'authenticated') then
    if new.status = 'approved' and old.status is distinct from 'approved' and new.approved_at is null then
      new.approved_at := now();
    end if;
    return new;
  end if;

  if public.is_admin() then
    if new.status = 'approved' and old.status is distinct from 'approved' then
      new.approved_by := uid;
      new.approved_at := now();
    elsif new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
      new.approved_by := old.approved_by;
      new.approved_at := old.approved_at;
    end if;
    if new.teacher_reviewed is distinct from old.teacher_reviewed then
      new.teacher_reviewed_by := case when new.teacher_reviewed then uid end;
      new.teacher_reviewed_at := case when new.teacher_reviewed then now() end;
    end if;
    return new;
  end if;

  if old.uploader_id = uid then
    if old.status not in ('pending', 'rejected') then
      raise exception 'Published resources can only be changed by a moderator' using errcode = '42501';
    end if;
    if new.status <> 'pending' then
      raise exception 'You can only resubmit for review' using errcode = '42501';
    end if;
    if (new.approved_by, new.approved_at, new.teacher_reviewed, new.teacher_reviewed_by, new.teacher_reviewed_at)
       is distinct from
       (old.approved_by, old.approved_at, old.teacher_reviewed, old.teacher_reviewed_by, old.teacher_reviewed_at) then
      raise exception 'Moderation fields cannot be changed' using errcode = '42501';
    end if;
    return new;
  end if;

  if public.is_teacher_for(old.subject_id) then
    if (to_jsonb(new) - teacher_fields) <> (to_jsonb(old) - teacher_fields) then
      raise exception 'Teachers can only change the teacher-reviewed mark' using errcode = '42501';
    end if;
    new.teacher_reviewed_by := case when new.teacher_reviewed then uid end;
    new.teacher_reviewed_at := case when new.teacher_reviewed then now() end;
    return new;
  end if;

  raise exception 'Not allowed to change this resource' using errcode = '42501';
end $$;
