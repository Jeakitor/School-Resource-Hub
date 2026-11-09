# Security model

The website is static and public. Anyone can read its JavaScript and call the
Supabase API directly with the publishable key. So **every rule is enforced in
the database**; the frontend only hides buttons for convenience.

## Who can do what

| | Anonymous | Student | Teacher (assigned subjects) | Admin |
|---|---|---|---|---|
| Read subjects, topics | ✓ | ✓ | ✓ | ✓ |
| Read approved resources and their files | ✓ | ✓ | ✓ | ✓ |
| Read pending / rejected resources and files | ✗ | own only | ✓ | ✓ |
| Submit a resource | ✗ | ✓ (always `pending`) | ✓ | ✓ |
| Edit a submission | ✗ | own, while pending/rejected; resubmits as pending | teacher-reviewed mark only | ✓ |
| Delete a submission | ✗ | own, while pending/rejected | ✗ | ✓ |
| Approve / reject / unpublish | ✗ | ✗ | ✗ | ✓ (feedback required to reject) |
| Review notes | public corrections only | read feedback and teacher notes on own work (never flags) | add notes / flags; see all notes in their subjects | ✓ |
| List users with emails, find leftover files | ✗ | ✗ | ✗ | ✓ (`admin_list_users`, `admin_orphan_files`) |
| Grant roles | ✗ | ✗ | ✗ | ✓ (never the last admin) |

## Layers

1. **Row Level Security** on every table (`0004`): which rows each user can see or touch.
2. **Guard triggers** (`0003`): which fields each role may change. Students, teachers and
   admins share the same `authenticated` database role, so per-role column rules need triggers.
   - Non-admin inserts are forced to `pending` with no approval stamps.
   - Owners can only resubmit (`pending`), never approve, and can't touch moderation fields.
   - Teachers can only toggle `teacher_reviewed`; the database records who and when.
   - `approved_by/at`, `granted_by`, `author_id` are always set from `auth.uid()`, never trusted from the client.
3. **Privileges** (`0004`): Supabase's broad default grants are revoked, then only what is
   needed is granted. For example, profiles can only update `display_name`.
4. **Storage policies** (`0005`): see below.

## Trusted administrative context

Website traffic always runs as the database role `anon` or `authenticated`. The guard
triggers let any other role through (migration `0007`): `postgres` in the Supabase SQL
Editor, or `service_role` on a server. That lets the project owner fix data by hand.
It is not reachable from the website, and the `service_role` key must never be in the frontend.

## Roles and admin provisioning

- Roles are rows in `user_roles`. Only admins can insert or delete them (RLS).
- Sign-up metadata is read for `display_name` **only**. Sending `role: admin` at sign-up does nothing (tested).
- **First admin.** A trusted person runs this once in the Supabase SQL editor, which runs as the database owner and bypasses RLS:
  ```sql
  insert into public.user_roles (user_id, role)
  select id, 'admin' from auth.users where email = 'their-email@school.org';
  ```
- After that, admins grant roles from the app. A teacher also needs subject assignments:
  ```sql
  insert into public.teacher_subjects (user_id, subject_id)
  select u.id, s.id from auth.users u, public.subjects s
  where u.email = 'teacher@school.org' and s.slug in ('physics', 'economics');
  ```

## Files

**Since migration 0009, PDFs are stored in a private Backblaze B2 bucket**, behind the
`files` Edge Function. See [storage-b2.md](storage-b2.md). In summary:
- Only the function holds the B2 keys (as Supabase secrets).
- Uploads are checked on the server: signed in, at most 20 MB, real `%PDF-` signature. This is
  stronger than before, when only the declared type was checked.
- Files are recorded in `public.files`, which users cannot write to.
- View links (1 hour) are issued only if the viewer can read the resource under RLS.
- Files can be deleted only when no resource refers to them, by their owner or an admin.

The rules below describe the previous Supabase Storage setup (migration 0005). That bucket
and its policies are still in place but no longer used by the website.

- One **private** bucket, `resource-files`: 20 MB limit, `application/pdf` only.
- Uploads only into the uploader's own folder (`<user id>/<uuid>.pdf`), no sub-folders, `.pdf` only.
- Read access (and therefore signed URLs) for: the owner, admins, teachers of the subject,
  and **everyone once the resource is approved**. Unpublishing hides the file again. No file copying is needed.
- **No update policy**: a file can't be overwritten, so an approved PDF can't be swapped afterwards.
- Owners can delete their file only while it is not part of a published resource.

**Known limit:** Supabase Storage checks the *declared* MIME type and size. It does not
inspect file contents. Mitigations: the browser checks the `%PDF-` signature before
upload; files are private until a moderator has opened and approved them; files are
served as `application/pdf` via signed URLs. A future Edge Function could verify the
signature server-side if needed.

## Rendering user content

- All UI text goes through `h()`, which creates text nodes, never HTML.
- `href`/`src` values pass through `safeUrl()`, which blocks `javascript:` and `data:`.
- Markdown notes: `marked`, then `DOMPurify` (scripts, event handlers, iframes, forms and
  inline styles stripped; external links get `rel="noopener noreferrer nofollow"`).
- Links must be `https://` (database `CHECK`).

## Keys

| Key | Where |
|---|---|
| Project URL, `sb_publishable_…` | `assets/js/config/supabase.js` (public by design) |
| `sb_secret_…`, `service_role`, DB password | **Never** in this repo. `services/supabase.js` refuses to start if one is configured. |
| Backblaze B2 keyID + applicationKey | Only as Edge Function secrets on Supabase. Never in this repo. |

## Testing

`supabase/tests/run-policy-tests.mjs` runs all migrations on PGlite (PostgreSQL 16 in
WebAssembly) and checks 84 access rules, then unit-tests the `files` Edge Function
(13 tests, with fakes for Supabase and B2) as anonymous, two students, a teacher and an admin.

```bash
cd supabase/tests
npm install
npm test
```

It tests our SQL. It does **not** test Supabase's hosted services, so after setting up the
real project, also check by hand:

- [ ] Uploading a non-PDF or a file over 20 MB through the app is rejected by Storage.
- [ ] A signed URL for a pending file can't be created while signed out.
- [ ] The password reset email arrives and its link opens `auth.html?mode=update`.
- [ ] In Dashboard → Advisors → Security, there are no warnings about tables without RLS.
