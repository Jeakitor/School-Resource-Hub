-- =============================================================================
-- School Resource Hub — 0003 resource guards and moderation
--
-- RLS decides WHICH ROWS a user may touch. These triggers decide WHICH
-- FIELDS they may change, because students, teachers and admins all use the
-- same `authenticated` database role and RLS cannot restrict columns per role.
-- =============================================================================

-- Does a file exist in the resource bucket? (SECURITY DEFINER: storage.objects has its own RLS.)
-- Only answers for the caller's own folder (or for admins), so it cannot be used
-- to probe for other people's files.
create function public.resource_file_exists(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from storage.objects
    where bucket_id = 'resource-files'
      and name = p_path
      and (split_part(p_path, '/', 1) = (select auth.uid())::text or public.is_admin())
  );
$$;

-- Catalog consistency + level rules, on insert and on any change of the relevant fields.
create function public.resources_check_catalog() returns trigger
language plpgsql set search_path = '' as $$
declare
  t_parent   bigint;
  t_level    public.resource_level;
  st_level   public.resource_level;
  s_levels   public.resource_level[];
begin
  select parent_id, level into t_parent, t_level from public.topics where id = new.topic_id;
  if t_parent is not null then
    raise exception 'topic_id must be a top-level topic; put subtopics in subtopic_id' using errcode = '23514';
  end if;

  if new.subtopic_id is not null then
    select level into st_level from public.topics where id = new.subtopic_id;
  end if;

  if (t_level = 'HL' or st_level = 'HL') and new.level <> 'HL' then
    raise exception 'This topic is HL-only content, so the level must be HL' using errcode = '23514';
  end if;

  select levels into s_levels from public.subjects where id = new.subject_id;
  if not (new.level = any (s_levels)) then
    raise exception 'This subject is not offered at level %', new.level using errcode = '23514';
  end if;

  if new.resource_type = 'pdf'
     and (tg_op = 'INSERT' or new.storage_path is distinct from old.storage_path)
     and not public.resource_file_exists(new.storage_path) then
    raise exception 'The uploaded file could not be found' using errcode = '23503';
  end if;

  return new;
end $$;

create trigger resources_check_catalog
  before insert or update of subject_id, topic_id, subtopic_id, level, resource_type, storage_path
  on public.resources
  for each row execute function public.resources_check_catalog();

-- Insert: non-admins always create a pending submission, whatever they send.
create function public.resources_before_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_at := now();
  new.updated_at := now();
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

create trigger resources_before_insert
  before insert on public.resources
  for each row execute function public.resources_before_insert();

-- Update: per-role field rules.
create function public.resources_before_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  teacher_fields constant text[] := array['teacher_reviewed', 'teacher_reviewed_by', 'teacher_reviewed_at', 'updated_at', 'search'];
begin
  if new.id <> old.id or new.uploader_id <> old.uploader_id or new.created_at <> old.created_at then
    raise exception 'id, uploader and creation time cannot be changed' using errcode = '42501';
  end if;

  -- Administrators: anything, but approval/review stamps are always set by the database.
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

  -- Owner: may edit and resubmit their own pending / rejected submission.
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

  -- Teacher for this subject: may only set / clear the teacher-reviewed mark.
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

create trigger resources_before_update
  before update on public.resources
  for each row execute function public.resources_before_update();

-- Review notes: the author is always the caller.
create function public.resource_reviews_before_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.author_id := (select auth.uid());
  new.created_at := now();
  return new;
end $$;

create trigger resource_reviews_before_insert
  before insert on public.resource_reviews
  for each row execute function public.resource_reviews_before_insert();

-- Moderation in one transaction: change status + record the decision/feedback.
-- SECURITY INVOKER: runs with the caller's rights, so RLS and the guards above still apply.
create function public.moderate_resource(
  p_resource_id uuid,
  p_decision    public.resource_status,
  p_feedback    text default null,
  p_level       public.resource_level default null
) returns public.resources
language plpgsql security invoker set search_path = '' as $$
declare
  result public.resources;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can moderate resources' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected', 'removed') then
    raise exception 'Decision must be approved, rejected or removed' using errcode = '22023';
  end if;
  if p_decision <> 'approved' and char_length(btrim(coalesce(p_feedback, ''))) < 10 then
    raise exception 'Feedback of at least 10 characters is required' using errcode = '23514';
  end if;

  update public.resources
     set status = p_decision,
         level  = coalesce(p_level, level)
   where id = p_resource_id
  returning * into result;

  if not found then
    raise exception 'Resource not found' using errcode = 'P0002';
  end if;

  insert into public.resource_reviews (resource_id, kind, decision, body)
  values (p_resource_id, 'decision', p_decision, nullif(btrim(coalesce(p_feedback, '')), ''));

  return result;
end $$;
