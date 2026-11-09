# School Resource Hub

A student-built library of IB Diploma Programme resources, organised by the
syllabi examined in the **May 2027** session. Built as a CAS project.

- **Frontend:** HTML, CSS, vanilla JavaScript (ES modules). No build step.
- **Backend (from Phase 2):** Supabase: Postgres, Auth, Storage, Row Level Security.
- **Hosting:** GitHub Pages (static) + Supabase.

## Run locally

ES modules and `fetch()` do not work from `file://`, so serve the folder over HTTP:

```bash
node tools/dev-server.mjs
```

Then open <http://127.0.0.1:5173/>. Add `?preview=1` to any page to see
clearly labelled **sample** resources, submissions and the moderation workspace
(for reviewing layouts before real data exists). Preview mode follows you across links
until you click "Exit preview".

## Project layout

```
index.html, subjects.html, …   one HTML file per route (all at the root)
assets/css/                    tokens → base → layout → components → pages
assets/js/config/              site constants (no secrets)
assets/js/utils/               dom builder, formatting
assets/js/services/            the ONLY modules that load data
assets/js/components/          shared UI (shell, rows, entries, empty states)
assets/js/pages/               one controller per page
data/subjects.json             subject registry
data/syllabi/*.json            one syllabus map per subject (versioned, review status)
data/textbooks.json            textbook references, separate from syllabi
data/preview/                  labelled sample data for ?preview=1
docs/                          architecture, design system, syllabus process
tools/dev-server.mjs           zero-dependency local server
```

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Foundation, design system, shell | Done |
| 1 | Visual frontend | Done: all pages built; forms validate but send nothing yet |
| 2 | Supabase schema, RLS, storage | Done: migrations 0001–0010 applied (0010 = 18-subject catalog); 87 policy tests + 15 function tests passing. PDFs stored in Backblaze B2, upload confirmed working ([setup](docs/storage-b2.md)) |
| 3 | Authentication | Done: sign-in confirmed working with a real admin account |
| 4 | Resource browsing, search, PDF delivery | Done: live on every page; signed PDF links confirmed with a real upload |
| 5 | Contributions | Done: submit and edit confirmed; withdraw fixed (inline confirmation), awaiting retest |
| 6 | Administration | Built: live review queue, decisions, teacher notes/flags/reviewed mark, roles, leftover files; needs migration 0008 |
| 7 | Testing and deployment | Not started |

See [docs/architecture.md](docs/architecture.md) for how the pieces fit together.

## Not affiliated with the IB

This project is not affiliated with or endorsed by the International Baccalaureate Organization.
