# Database design

PostgreSQL on Supabase. Migrations live in `supabase/migrations/` and run in filename order.

| Migration | Contents |
|---|---|
| `…0001_core_schema` | Types, tables, constraints, indexes |
| `…0002_auth_and_roles` | Profile-on-sign-up trigger, role helpers, role guards |
| `…0003_resource_guards` | Per-role field rules, catalog/level checks, `moderate_resource()` |
| `…0004_rls_policies` | Row Level Security on every table, privileges |
| `…0005_storage` | Private `resource-files` bucket and its policies |
| `…0006_seed_catalog` | Subjects and topics, **generated** from `/data` by `tools/generate-seed.mjs` |

## Tables

```
auth.users (Supabase) ─1:1─ profiles ─┬─< user_roles          (admin | teacher; no row = student)
                                      ├─< teacher_subjects >── subjects ─< topics (self-ref parent_id)
                                      └─< resources >──────────┘      │
                                             │  └── topic_id, subtopic_id ──┘
                                             └─< resource_reviews
```

### `profiles`
`id` (= auth user id), `display_name` (2–40 chars), timestamps. Created automatically
on sign-up. **No email and no role**: the email stays in Supabase Auth, and roles live
in a table students cannot write to.

### `user_roles`, `teacher_subjects`
`(user_id, role)` with `granted_by`/`granted_at` stamped by the database.
Teachers get one `teacher_subjects` row per subject they review. The database refuses
to remove the last admin.

### `subjects`, `topics`
Seeded from `data/subjects.json` and `data/syllabi/*.json`. A topic has `parent_id null`;
a subtopic points to its topic. `(subject_id, code)` is unique and `code` matches the JSON.
A composite foreign key guarantees a subtopic's parent is in the same subject.

### `resources`
One row from submission to publication. Key columns: `subject_id`, `topic_id`,
`subtopic_id?`, `level` (`SL` | `HL`), `resource_type` (`pdf` | `markdown` | `link`),
exactly one of `storage_path` / `body_md` / `external_url`, `tags[]`, `uploader_id`,
`status` (`pending` → `approved` | `rejected` → … ; `removed` = unpublished),
`approved_by/at`, `teacher_reviewed(_by/_at)`, and a generated full-text `search` column.

Integrity enforced in the database, not only the form:

| Rule | How |
|---|---|
| Topic is in the subject; subtopic is under the topic | Composite foreign keys |
| `topic_id` is a top-level topic | Trigger |
| HL-only topic/subtopic ⇒ level must be `HL`; SL-only subject ⇒ level `SL` | Trigger |
| Content matches type; links are `https://`; notes 100–50,000 chars | `CHECK` |
| PDF path is `<uploader>/<uuid>.pdf` and the file exists | `CHECK` + trigger |
| Title 5–120, description 20–1000, ≤ 8 lower-case tags | `CHECK` |
| `approved` ⇒ `approved_at` set | `CHECK` |

Markdown notes are stored in `body_md` rather than as files: they are small, searchable,
and simpler to moderate. They are rendered and sanitised in the browser (`services/markdown.js`).

### `resource_reviews`
Moderation history and feedback in one place:
- `decision`: an admin's approve / reject / remove. Feedback is required for reject and remove.
- `note`: a teacher or admin comment. Can be marked `is_public` to show as a correction on the published resource.
- `flag`: a teacher asks for revision. It's a request; only admins change status.

## Moderation API

`moderate_resource(resource_id, decision, feedback?, level?)`. Admin only. In one
transaction it sets the status (optionally correcting the level tag) and records the
decision and feedback.

## Indexes

Status + date (recent lists), subject + status (subject pages), topic, subtopic,
uploader (account page), storage path (storage policies), GIN on `search` and `tags`.

## Updating the syllabus

1. Edit `data/syllabi/<subject>.json`.
2. `node tools/generate-seed.mjs supabase/migrations/<new timestamp>_seed_catalog.sql`
3. Run the new migration. It upserts by code and never deletes topics (removing one that
   resources use must be a deliberate migration).
