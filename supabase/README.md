# Supabase setup

Everything the backend needs is in `migrations/`. Read `docs/database.md` and
`docs/security.md` first.

## 1. Create the project

1. <https://supabase.com/dashboard> → **New project**. Choose a region near your school.
2. Save the database password in a password manager. It is **not** needed by the website.

## 2. Run the migrations

**Option A: SQL editor (no tools needed).** Dashboard → SQL Editor → New query. Paste and
run each file in `migrations/` **in filename order**, one at a time. Stop if one fails.

**Option B: Supabase CLI.**

```bash
supabase link --project-ref <your-project-ref>
```

```bash
supabase db push
```

Migrations are written for a **fresh** project. Do not reset an existing project with data in it.

## 3. Make the first administrator

1. Sign up on the website (once Phase 3 is live), or add a user in Dashboard → Authentication → Users.
2. In the SQL editor:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'your-email@school.org';
```

## 4. Connect the website

Dashboard → Project Settings → API. Copy the **Project URL** and the **publishable key**
(`sb_publishable_…`) into `assets/js/config/supabase.js`.
Never copy the secret / `service_role` key anywhere in this repo.

## 5. Auth settings (Phase 3)

Dashboard → Authentication → URL Configuration:
- Site URL: your GitHub Pages URL, e.g. `https://<user>.github.io/<repo>/`
- Redirect URLs: add that URL plus `http://127.0.0.1:5173/**` and `http://localhost:5173/**` for local development.

Email: Supabase's built-in email sender is limited to a few messages per hour and is meant
for testing. Before launch, set up custom SMTP (Authentication → Emails → SMTP Settings),
or students may not receive confirmation and reset emails.

## Testing the policies locally

```bash
cd supabase/tests
npm install
npm test
```

Runs every migration on an in-process PostgreSQL 16 (PGlite) with a shim of Supabase's
`auth`/`storage` schemas (`tests/supabase-shim.sql`, test-only), then checks 84 access rules. It then unit-tests the `files` Edge Function
(`files-function.test.mjs`).

## PDF storage (Backblaze B2)

Migration 0009 plus the `functions/files` Edge Function. Setup: [../docs/storage-b2.md](../docs/storage-b2.md).

## Changing the schema later

Never edit a migration that has already been run on the real project. Add a new file with
a later timestamp, run the tests, then apply it.
