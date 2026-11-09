-- =============================================================================
-- School Resource Hub — 0001 core schema
-- Tables, types, constraints and indexes. Security (RLS, guards) follows in
-- later migrations; every table here gets RLS enabled in 0004.
-- See docs/database.md for the design.
-- =============================================================================

-- Types -----------------------------------------------------------------------
create type public.resource_type   as enum ('pdf', 'markdown', 'link');
create type public.resource_level  as enum ('SL', 'HL');          -- SL = core (SL & HL), HL = HL only
create type public.resource_status as enum ('pending', 'approved', 'rejected', 'removed');
create type public.app_role        as enum ('admin', 'teacher');  -- no row = student
create type public.review_kind     as enum ('decision', 'note', 'flag');

-- Helpers used by constraints (must be IMMUTABLE) -------------------------------
create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Tags: at most 8, each 1–30 chars, lower-case and trimmed.
create function public.tags_valid(tags text[]) returns boolean
language sql immutable set search_path = '' as $$
  select cardinality(tags) <= 8
     and not exists (
       select 1 from unnest(tags) as t(tag)
       where char_length(t.tag) not between 1 and 30 or t.tag <> lower(btrim(t.tag))
     );
$$;

create function public.tags_text(tags text[]) returns text
language sql immutable set search_path = '' as $$
  select coalesce(array_to_string(tags, ' '), '');
$$;

-- Profiles ----------------------------------------------------------------------
-- One row per auth user, created by trigger (0002). No email, no role here:
-- roles live in user_roles, which students cannot write to.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
               check (char_length(display_name) between 2 and 40 and display_name = btrim(display_name)),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.user_roles (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.app_role not null,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- Catalog -----------------------------------------------------------------------
create table public.subjects (
  id                        bigint generated always as identity primary key,
  slug                      text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name                      text not null check (char_length(name) between 2 and 120),
  short_name                text not null check (char_length(short_name) between 2 and 60),
  levels                    public.resource_level[] not null check (cardinality(levels) between 1 and 2),
  ib_group                  smallint check (ib_group between 1 and 6),
  description               text,
  syllabus_title            text,
  syllabus_first_assessment smallint,
  syllabus_review_status    text not null default 'unverified'
                            check (syllabus_review_status in ('unverified', 'verified')),
  target_session            text not null default 'May 2027',
  sort_order                integer not null default 0,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- Teachers review only the subjects assigned to them.
create table public.teacher_subjects (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  subject_id  bigint not null references public.subjects (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, subject_id)
);
create index teacher_subjects_subject_idx on public.teacher_subjects (subject_id);

-- Topics and subtopics in one table (parent_id null = topic).
-- `code` is the stable key shared with data/syllabi/*.json.
create table public.topics (
  id         bigint generated always as identity primary key,
  subject_id bigint not null references public.subjects (id) on delete cascade,
  parent_id  bigint,
  code       text not null check (char_length(code) between 1 and 12),
  title      text not null check (char_length(title) between 1 and 200),
  level      public.resource_level not null default 'SL',
  sort_order integer not null default 0,
  unique (subject_id, code),
  unique (subject_id, id),   -- target for (subject_id, parent_id) and resources (subject_id, topic_id)
  unique (parent_id, id),    -- target for resources (topic_id, subtopic_id)
  -- A subtopic's parent must belong to the same subject.
  foreign key (subject_id, parent_id) references public.topics (subject_id, id) on delete cascade
);
create index topics_subject_parent_idx on public.topics (subject_id, parent_id, sort_order);

-- Resources (submissions and published resources are the same row) -------------
create table public.resources (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null check (char_length(btrim(title)) between 5 and 120),
  description         text not null check (char_length(btrim(description)) between 20 and 1000),
  subject_id          bigint not null references public.subjects (id) on delete restrict,
  topic_id            bigint not null,
  subtopic_id         bigint,
  level               public.resource_level not null,
  resource_type       public.resource_type not null,
  storage_path        text,          -- '<uploader uuid>/<uuid>.pdf' in bucket resource-files
  external_url        text,
  body_md             text,          -- Markdown notes, rendered + sanitised client-side
  tags                text[] not null default '{}',
  uploader_id         uuid not null references public.profiles (id) on delete cascade,
  status              public.resource_status not null default 'pending',
  approved_by         uuid references public.profiles (id) on delete set null,
  approved_at         timestamptz,
  teacher_reviewed    boolean not null default false,
  teacher_reviewed_by uuid references public.profiles (id) on delete set null,
  teacher_reviewed_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  search              tsvector generated always as (
                        setweight(to_tsvector('simple', coalesce(title, '')), 'A')
                        || setweight(to_tsvector('simple', public.tags_text(tags)), 'A')
                        || setweight(to_tsvector('simple', coalesce(description, '')), 'B')
                      ) stored,

  -- Topic belongs to the subject; subtopic belongs to the topic.
  foreign key (subject_id, topic_id)  references public.topics (subject_id, id),
  foreign key (topic_id, subtopic_id) references public.topics (parent_id, id),

  -- Exactly one kind of content, matching the type.
  constraint resources_content_matches_type check (
       (resource_type = 'pdf'      and storage_path is not null and external_url is null and body_md is null)
    or (resource_type = 'link'     and storage_path is null and body_md is null
                                   and external_url ~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:[0-9]+)?(/\S*)?$'
                                   and char_length(external_url) <= 2000)
    or (resource_type = 'markdown' and storage_path is null and external_url is null
                                   and char_length(body_md) between 100 and 50000)
  ),
  -- Files can only be referenced from the uploader's own folder.
  constraint resources_storage_path_owned check (
    storage_path is null
    or storage_path ~ ('^' || uploader_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$')
  ),
  constraint resources_tags_valid check (public.tags_valid(tags)),
  constraint resources_approval_recorded check (status <> 'approved' or approved_at is not null)
);

create index resources_status_created_idx on public.resources (status, created_at desc);
create index resources_subject_status_idx on public.resources (subject_id, status);
create index resources_topic_idx          on public.resources (topic_id);
create index resources_subtopic_idx       on public.resources (subtopic_id) where subtopic_id is not null;
create index resources_uploader_idx       on public.resources (uploader_id);
create index resources_storage_path_idx   on public.resources (storage_path) where storage_path is not null;
create index resources_search_idx         on public.resources using gin (search);
create index resources_tags_idx           on public.resources using gin (tags);

-- Moderation history, rejection feedback and teacher review notes -------------
--   decision : admin approve / reject / remove (body required unless approving)
--   note     : teacher or admin comment / correction
--   flag     : teacher asks for revision of a published resource
create table public.resource_reviews (
  id          bigint generated always as identity primary key,
  resource_id uuid not null references public.resources (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  kind        public.review_kind not null,
  decision    public.resource_status,
  body        text check (body is null or char_length(btrim(body)) between 1 and 2000),
  is_public   boolean not null default false,   -- public correction note on the resource page
  created_at  timestamptz not null default now(),
  constraint reviews_decision_shape check (
       (kind = 'decision' and decision in ('approved', 'rejected', 'removed')
          and (decision = 'approved' or char_length(btrim(coalesce(body, ''))) >= 10))
    or (kind in ('note', 'flag') and decision is null and char_length(btrim(coalesce(body, ''))) >= 10)
  )
);
create index resource_reviews_resource_idx on public.resource_reviews (resource_id, created_at);

-- updated_at triggers -------------------------------------------------------------
create trigger profiles_updated_at  before update on public.profiles  for each row execute function public.set_updated_at();
create trigger subjects_updated_at  before update on public.subjects  for each row execute function public.set_updated_at();
create trigger resources_updated_at before update on public.resources for each row execute function public.set_updated_at();
