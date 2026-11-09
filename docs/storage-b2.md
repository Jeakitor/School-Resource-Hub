# PDF storage: Backblaze B2

PDFs are kept in a **private** Backblaze B2 bucket (10 GB free). Supabase still manages
everything else: accounts, permissions, the review queue and which file belongs to
which resource.

```
browser ──(upload / "give me a link" / delete)──▶ Supabase Edge Function `files`
                                                    │  1. who is this? (their session token)
                                                    │  2. may they? (asks the database, RLS)
                                                    │  3. acts on B2 with keys only it holds
browser ◀──────── 1-hour private link ──────────────┘
browser ──(views PDF directly)──▶ Backblaze B2
```

- **Upload:** the function checks that the user is signed in, that the file is at most 20 MB,
  and that it really starts with `%PDF-`. Then it stores the file at `<user id>/<random id>.pdf`
  and records it in `public.files`. Users can't write to `public.files` themselves.
- **View:** the function reads the resource with the viewer's own token, so the usual rules
  apply (published: everyone; pending: owner, admins, subject teachers). Only then does it
  sign a 1-hour link.
- **Delete:** allowed only for files no resource refers to, by their owner or an admin
  (`can_delete_file()`).
- **Keys:** the B2 keys exist only in the function's secrets on Supabase. They are never
  in the website, never in git.

Code: `supabase/functions/files/` (logic in `handler.js`, unit-tested in
`supabase/tests/files-function.test.mjs`); database part: migration `0009`.

## Free-tier limits to know

- 10 GB stored free.
- Downloads are free up to about 3× your stored amount per month.
- Download requests have a daily free allowance (roughly 2,500 a day at the time of
  writing). Browsers may make several range requests for one large PDF.
- Check current terms on backblaze.com. Your B2 dashboard shows usage; you can set caps
  and alerts there (**Caps & Alerts**) so you are never billed.

## One-time setup (about 20 minutes)

### 1. Backblaze

1. Create a free account at <https://www.backblaze.com/sign-up/cloud-storage>.
2. Go to **Caps & Alerts**. Set every daily cap to **$0**. This guarantees no charges; at worst,
   downloads pause until the next day.
3. Go to **Buckets → Create a Bucket**:
   - Name: anything unique, e.g. `school-resource-hub-files-<random>`
   - Files in bucket: **Private**
   - Encryption: enable if offered. Object lock: off.
4. On the bucket's card, note the **Endpoint**, e.g. `s3.us-east-005.backblazeb2.com`.
   The **region** is the middle part: `us-east-005`.
5. Go to **Application Keys → Add a New Application Key**:
   - Name: `hub-files-function`
   - Allow access to: **only this bucket**
   - Type: **Read and Write**
   - Copy the **keyID** and **applicationKey** now. The application key is shown only once.
     Keep it in a password manager, **not** in any project file.

No CORS settings are needed: uploads go through the function, and PDFs are opened as
normal page links.

### 2. Run migration 0009

Withdraw any test submission that still has a PDF (it was stored the old way). Then run
`supabase/migrations/20261107000009_b2_files.sql` in the SQL Editor.

### 3. Set the function's secrets

Dashboard → **Edge Functions → Secrets** (or *Project Settings → Edge Functions*). Add:

| Name | Value |
|---|---|
| `B2_KEY_ID` | the keyID |
| `B2_APPLICATION_KEY` | the applicationKey |
| `B2_BUCKET` | your bucket name |
| `B2_ENDPOINT` | `https://` + the endpoint, e.g. `https://s3.us-east-005.backblazeb2.com` |
| `B2_REGION` | e.g. `us-east-005` |
| `ALLOWED_ORIGINS` | `http://127.0.0.1:5173,http://localhost:5173` (add your GitHub Pages address at launch, e.g. `https://<user>.github.io`) |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to
functions automatically. If the function log says one is missing (projects that use only
the new API keys), also add `SB_PUBLISHABLE_KEY` (your `sb_publishable_…`) and
`SB_SECRET_KEY` (an `sb_secret_…` key). These are secrets on Supabase's servers only.

### 4. Deploy the function

Node is already installed, so the Supabase CLI runs through `npx`. In a terminal in the
`school-resource-hub` folder:

```bash
npx supabase@2 login
```

```bash
npx supabase@2 functions deploy files --project-ref xxchnhjydpsxizzjpcfy --no-verify-jwt
```

`login` opens your browser to authorise the CLI. Deploying needs no Docker.
`--no-verify-jwt` is intended: the function checks tokens itself, because anonymous
visitors must be able to request links to published PDFs.

### 5. Check it works

- [ ] Submit a small PDF from the Contribute page. The bucket shows a file under your user id folder.
- [ ] The moderation panel shows the PDF.
- [ ] Signed out, a **pending** PDF's resource page says "not available".
- [ ] After approval, the PDF opens signed out. The link stops working after an hour.
- [ ] Withdraw a submission: its file disappears from the bucket.
- [ ] Renaming a `.txt` to `.pdf` and uploading it is refused ("does not appear to be a valid PDF").

If something fails, Dashboard → **Edge Functions → files → Logs** shows the function's errors.

## Rotating the key

If the application key may have leaked:
1. Create a new key in Backblaze.
2. Update the two secrets.
3. Delete the old key.

No code changes are needed.
