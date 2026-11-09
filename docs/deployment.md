# Deployment

The live site: **https://jeakitor.github.io/School-Resource-Hub/**

| Part | Where it runs | How it updates |
|---|---|---|
| Website (HTML/CSS/JS, `/data`) | GitHub Pages, from `main` | `git push`. Live in 1–2 minutes |
| Database, auth, roles | Supabase project `xxchnhjydpsxizzjpcfy` | Run new files in `supabase/migrations/` in the SQL Editor |
| PDF files | Backblaze B2 (private bucket) | Nothing to deploy |
| `files` Edge Function | Supabase | `npx supabase@2 functions deploy files --project-ref xxchnhjydpsxizzjpcfy --no-verify-jwt` |

There is no build step: the files in the repo are the site.

## Updating the website

```bash
git add -A
```

```bash
git commit -m "Describe the change"
```

```bash
git push
```

GitHub Pages republishes automatically (repo → **Actions** shows progress). Hard-refresh
the browser (Ctrl+F5) if you still see the old version.

Before pushing, run the checks:

```bash
node tools/check-syllabi.mjs
```

```bash
cd supabase/tests && npm install && npm test
```

## Changing the database

1. Add a NEW file in `supabase/migrations/` with a later timestamp. Never edit one that has
   already been run on the real project.
2. Run the tests (above). They apply every migration to a throwaway database.
3. Run the new file in Supabase → SQL Editor.
4. Commit and push.

For syllabus or subject changes: edit `/data`, run `tools/check-syllabi.mjs`, then generate
a new seed migration (see [syllabus.md](syllabus.md)).

## Settings that mention the site address

If the address ever changes (new repo name or a custom domain), update all of these:

- Supabase → **Authentication → URL Configuration**:
  - Site URL: `https://jeakitor.github.io/School-Resource-Hub/`
  - Redirect URLs: `https://jeakitor.github.io/School-Resource-Hub/**` (plus `http://127.0.0.1:5173/**`
    and `http://localhost:5173/**` for local development)
- Supabase → **Edge Functions → Secrets → `ALLOWED_ORIGINS`**:
  `http://127.0.0.1:5173,http://localhost:5173,https://jeakitor.github.io`
  (the origin only: no path, no trailing slash)

## Secrets: where they live

| Secret | Location |
|---|---|
| Supabase publishable key + URL | `assets/js/config/supabase.js`. Public by design |
| Supabase secret / service-role key, DB password | Supabase dashboard only |
| Backblaze keyID + applicationKey | Edge Function secrets only ([storage-b2.md](storage-b2.md)) |

Nothing secret is in this repository. Keep it that way: GitHub repos are public, and
history is permanent. If a secret is ever committed, **rotate it immediately** (removing
the commit is not enough).

## Before launch (checklist)

- [ ] Verify the remaining syllabus maps against the official IB guides ([syllabus.md](syllabus.md)). Psychology done (9 Nov 2026).
- [ ] Set up custom SMTP ([email.md](email.md)) so confirmation and reset emails arrive reliably. Until then: [launch-without-email.md](launch-without-email.md).
- [ ] Delete test resources (Moderation, or the SQL Editor) and leftover test files (Moderation → Files).
- [ ] Decide who else gets admin; give teachers their subjects (Moderation → People & roles).
- [x] Backblaze: $0 caps set (confirmed 9 Nov 2026).
- [ ] Supabase: Dashboard → Advisors → Security shows no warnings.
- [ ] Optional: copy `marked` and `DOMPurify` into `assets/vendor/` to remove the CDN dependency.

## Run locally

```bash
node tools/dev-server.mjs
```

Then open http://127.0.0.1:5173/. It uses the same live Supabase project, so test
carefully and label test data clearly.
