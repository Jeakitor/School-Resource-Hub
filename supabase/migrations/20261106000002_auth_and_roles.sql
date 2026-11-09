-- =============================================================================
-- School Resource Hub — 0002 profiles, roles and authorization helpers
-- =============================================================================

-- New auth user -> profile. display_name comes from sign-up metadata, but
-- ONLY the display name: role is never read from user-editable metadata.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  name text := left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 40);
begin
  if char_length(name) < 2 then
    name := 'Student';
  end if;
  insert into public.profiles (id, display_name) values (new.id, btrim(name));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Authorization helpers ------------------------------------------------------------
-- SECURITY DEFINER so they can read user_roles without being blocked by (or
-- recursing into) RLS. They only ever answer questions about the CURRENT user.

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = 'admin'
  );
$$;

create function public.is_teacher() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = 'teacher'
  );
$$;

-- Teacher role AND assigned to this subject.
create function public.is_teacher_for(p_subject_id bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.teacher_subjects ts on ts.user_id = ur.user_id
    where ur.user_id = (select auth.uid())
      and ur.role = 'teacher'
      and ts.subject_id = p_subject_id
  );
$$;

-- Role management guards -------------------------------------------------------------
create function public.user_roles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.granted_by := (select auth.uid());
    new.granted_at := now();
    return new;
  end if;

  -- DELETE: never remove the last administrator.
  if old.role = 'admin'
     and (select count(*) from public.user_roles where role = 'admin') <= 1 then
    raise exception 'Cannot remove the last administrator' using errcode = '42501';
  end if;
  return old;
end $$;

create trigger user_roles_guard
  before insert or delete on public.user_roles
  for each row execute function public.user_roles_guard();

create function public.teacher_subjects_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.user_roles where user_id = new.user_id and role = 'teacher') then
    raise exception 'User must have the teacher role before subjects are assigned' using errcode = '23514';
  end if;
  new.assigned_by := (select auth.uid());
  new.assigned_at := now();
  return new;
end $$;

create trigger teacher_subjects_guard
  before insert on public.teacher_subjects
  for each row execute function public.teacher_subjects_guard();
