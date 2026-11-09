# Launching before email works

Until custom SMTP is set up ([email.md](email.md)), Supabase can't email students. Its
built-in sender only reaches members of the Supabase project team. This mode lets students
use the site anyway.

## What changes

| | With email | Without email (this mode) |
|---|---|---|
| Sign up | Confirm via emailed link | Account works immediately |
| Forgot password | Emailed reset link | Ask an admin in person; they set a temporary password |
| Change password while signed in | Works | Works |
| Moderation, uploads, everything else | Same | Same |

**Trade-off:** nobody proves they own the email they typed. Someone could sign up with a
made-up or someone else's address. What limits the damage:
- Nothing anyone submits is public until a moderator approves it.
- Accounts get no special rights; only admins can grant roles.
- Display names are chosen by users, so moderators should know who is who before approving.

## Steps

1. **Supabase → Authentication → Sign In / Providers → Email**: turn **off** "Confirm email".
   Save. (Leave "Enable email provider" on.)
2. On the site, `assets/js/config/site.js` has `EMAIL_SENDING = false`, which is already
   the setting while there is no SMTP. "Forgot password" then explains how to get help
   instead of promising an email.
3. Tell students: sign up with their **school email** and a password of at least 10
   characters.

## Resetting a student's password (admin)

Check who is asking (in person). Then in **Supabase → SQL Editor**:

```sql
update auth.users
set encrypted_password = extensions.crypt('Temporary-pass-2026', extensions.gen_salt('bf')),
    updated_at = now()
where email = 'student@school.org';
```

- Use a different temporary password each time.
- Give it to the student privately.
- They sign in, then go to **Account → Change password** and choose their own.
- The query should report `1 row` updated. `0 rows` means the email doesn't match an account.

## When email works

1. Set up SMTP ([email.md](email.md)) and send yourself a test reset.
2. Set `EMAIL_SENDING = true` in `assets/js/config/site.js`, commit and push.
3. Turn **"Confirm email" back on** in Supabase. Existing accounts keep working; new
   sign-ups must confirm.
