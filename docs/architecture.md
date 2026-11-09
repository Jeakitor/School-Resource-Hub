# Architecture

## Goals that shaped it

1. **Static hosting.** GitHub Pages serves files; there is no server we run.
2. **No build step.** Anyone in the CAS group can edit a file and refresh.
3. **Security lives in the database.** The browser is untrusted. Every rule
   that matters (who can publish, who can see pending files) is enforced by
   Supabase Row Level Security and Storage policies, not by hiding buttons.

## Multi-page, module-per-page

Each route is its own HTML file at the site root (`index.html`, `subject.html`, …).
Each loads exactly one controller from `assets/js/pages/`.

Why not a single-page app? A multi-page site needs no client-side router and
no 404 redirect tricks on GitHub Pages. Every URL is shareable, and each page's
code stays small and readable.

Query strings carry state: `subject.html?s=physics-hl`, `resource.html?id=…`,
`search.html?q=…`. All links are **relative**, so the site works both at
`https://<user>.github.io/<repo>/` and on a custom domain.

## Layers

```
pages/        controllers: read the URL, call services, render with components
components/   reusable UI built with h(); no data access
services/     the only code that loads or writes data
config/       constants; Supabase URL + publishable key (Phase 2)
utils/        dom builder, formatting
```

Rule: **pages never call `fetch()` or Supabase directly.** When Phase 4
connects the database, only `services/resources.js` changes. The homepage and
other pages keep working unchanged.

## Rendering and XSS

All DOM is built with `h()` in `utils/dom.js`. Strings become text nodes, so
titles, descriptions and names typed by students can never become HTML.
`href`/`src` values pass through `safeUrl()`, which blocks `javascript:` and
`data:` URLs. Markdown notes (Phase 4) will be rendered with a parser and then
sanitised with DOMPurify before insertion. That is the only place HTML from
content is allowed.

## The shell

`components/shell.js` renders the header, navigation, preview banner and footer
into `<div data-shell="header|footer">` placeholders. The account area of the
header (`data-slot="account"`) will be updated by the auth service in Phase 3.
The Admin link only appears for admins, and that is purely cosmetic:
admin data is protected by RLS.

## Honest data states

`services/resources.js` returns `{ items, source }` where `source` is
`live`, `preview` or `none`. Pages render exactly what they receive, including
empty states. Sample data only appears with `?preview=1`, under a banner.

## Data that is not code

Subjects, syllabi and textbook mappings are JSON in `/data`. They are versioned
with the code, reviewed like content, and in Phase 2 they seed the
`subjects`/`topics` tables, so topic codes match between the files and the database.
See [syllabus.md](syllabus.md).

## Shared pieces worth knowing

- `components/resource-browser.js`: the filter + results UI used by both
  Library and Search, with state in the URL.
- `services/markdown.js`: notes rendering. `marked@12.0.2` and
  `dompurify@3.1.6` are loaded from jsDelivr, pinned to exact versions, and
  only on the resource page. Tested against `<script>`, `onerror`,
  `javascript:` links, iframes and inline styles; all are stripped. If the CDN
  fails, notes show as plain text, never as unsanitised HTML. Consider
  vendoring both files into `assets/vendor/` before launch, to remove the CDN dependency.
- Roles and SL/HL tagging: [roles-and-levels.md](roles-and-levels.md).

## Live data (Phase 4)

- `services/resources.js` loads the newest 1,000 **approved** resources once per page,
  maps database ids back to the slugs and codes used in `/data`, and attaches contributor
  display names. Library, search and subject pages filter that list in the browser, so
  search also matches subject names and topic titles.
  **Scaling:** past about 1,000 published resources, move search to a database function
  using the GIN-indexed `resources.search` column.
- The resource page fetches one row by id, so RLS lets owners and moderators open
  unpublished items; a banner marks them. PDFs get two 1-hour signed URLs (view and download).
  Public correction notes are shown above the content.

## PDF storage

PDFs live in a private Backblaze B2 bucket. The browser never talks to B2 with keys: it
calls the `files` Supabase Edge Function (`callFiles()` in `services/resources.js`) to
upload, get 1-hour view/download links, or delete. The function checks with the database
first. Details: [storage-b2.md](storage-b2.md).

## Contributions (Phase 5)

All writes live in `services/resources.js`; the pages only collect input.

- **Submit:** `submitResource()` looks up the database ids for the chosen subject/topic,
  uploads a PDF (if any) to `resource-files/<user id>/<random uuid>.pdf`, then inserts the row.
  The website never sends a `status`; the database stores every non-admin insert as
  `pending` anyway. If the insert fails, the just-uploaded file is deleted again.
- **Edit and resubmit:** `contribute.html?edit=<id>` loads your own pending or rejected
  submission. `updateSubmission()` uploads a replacement PDF first (files can't be
  overwritten), updates the row back to `pending`, then deletes the old file. Switching
  away from PDF also deletes the old file.
- **Withdraw:** `withdrawSubmission()` deletes the row (only allowed while pending or
  rejected), then its file.
- **History:** `listMySubmissions()` returns every one of your submissions, with the
  latest moderator feedback on rejected or unpublished items.
- **Leftover files:** if the browser closes between upload and save, a private file can
  be left without a resource. It is visible only to its owner and admins; an admin can
  clear these up later.
- **Not built yet:** rate limiting. Supabase Auth limits sign-ups; submissions are
  limited in practice by moderation. If spam becomes a problem, add a database
  check (e.g. at most N pending submissions per user).

## Moderation (Phase 6)

`admin.html` shows signed-in staff the live workspace; `services/moderation.js` makes every call.

- **Who sees what:** the queue is simply every resource RLS returns. Admins see all subjects;
  teachers see only their assigned subjects. The page never filters for security.
- **Admins:** approve (optionally correcting the level tag), request changes with feedback,
  unpublish with a reason, publish again. All go through `moderate_resource()`, which
  records the decision in `resource_reviews`.
- **Teachers:** mark or unmark "teacher reviewed", add notes for the contributor (optionally
  shown publicly as a correction once published), and add **flags**, which are staff-only
  (migration `0008`).
- **People & roles (admin):** `admin_list_users()` returns emails, which live in
  `auth.users` and are otherwise unreadable from the website. Granting and revoking roles and
  subjects are ordinary inserts/deletes that RLS allows only for admins; the last admin can't
  be removed.
- **Files (admin):** `admin_orphan_files()` lists uploads older than a day that no resource
  refers to; admins can delete them.
- The panel renders content with `components/resource-content.js`, the same code as the
  public resource page, so moderators see exactly what the public will see.
- Students see feedback and teacher notes on the Account page.

## Backend

- [database.md](database.md): schema, constraints, indexes, syllabus seeding
- [security.md](security.md): RLS, guard triggers, storage, keys, admin provisioning, tests
- [../supabase/README.md](../supabase/README.md): project setup steps
- `services/supabase.js`: lazy, shared client (`@supabase/supabase-js@2.45.4`, pinned).
  It refuses secret or `service_role` keys.

## Still to document

- [deployment.md](deployment.md): GitHub Pages, Supabase settings, secrets, launch checklist
