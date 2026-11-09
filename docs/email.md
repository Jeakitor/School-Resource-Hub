# Email (custom SMTP)

Supabase sends sign-up confirmations and password resets. Its built-in sender is only
for testing: a few emails per hour, to team members only. Real users need **custom SMTP**.

## Recommended: a dedicated Gmail account (free)

| | |
|---|---|
| Cost | Free |
| Limit | About 500 emails/day (plenty for one school) |
| Needs a domain? | No |
| Deliverability | Good. Gmail sends as itself, so the email passes Gmail's own checks |

Use a **new** Gmail account for the site (e.g. `schoolresourcehub.<school>@gmail.com`),
not a personal one. It keeps your inbox private and lets the CAS group hand it over later.

Alternatives, if the school later gets its own domain: **Brevo** (300/day free) or
**Resend** (100/day free). Both need DNS records on a domain you control.

## Without a phone: Brevo (free, no 2-Step Verification needed)

Brevo (formerly Sendinblue) gives 300 emails/day free. You verify a sender address by
clicking a link in an email, so no phone or app password is needed. (Brevo may still ask
for extra details at sign-up; this can change.)

1. Sign up at <https://www.brevo.com> with an email you can read.
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender**: use an address you own
   (ideally a school address, or a personal Gmail/Outlook one). Click the verification link
   Brevo emails you. **Avoid Yahoo/AOL addresses**: their providers reject mail sent on
   their behalf by other services.
3. **SMTP & API → SMTP → Generate a new SMTP key**. Copy it straight into Supabase.
4. Supabase → **Authentication → Emails → SMTP Settings**:

| Field | Value |
|---|---|
| Sender email | the verified sender address |
| Sender name | `School Resource Hub` |
| Host | `smtp-relay.brevo.com` |
| Port | `587` |
| Username | the **SMTP login** shown on Brevo's SMTP page (looks like `xxxx@smtp-brevo.com`, not your email) |
| Password | the SMTP key |

**Deliverability caveat:** when the sender is a free address (Gmail/Outlook) but Brevo
sends the mail, some inboxes put it in spam, because the sending service doesn't match the
address's domain. Tell testers to check spam at first. The proper fix is a sender on a domain
you control (see below).

**Best long-term option:** ask the school's IT team for either an SMTP relay or permission to
add Brevo's DNS records for a school address (e.g. `resourcehub@yourschool.org`). Mail from
the school's own domain is the most trusted, and it looks official to students.

Then continue with steps 3–5 below (rate limit, templates, test).

## Gmail setup (about 15 minutes)

### 1. Prepare the Gmail account

1. Create the Gmail account.
2. Turn on **2-Step Verification**: <https://myaccount.google.com/security>. App passwords
   need it.
3. Create an **app password**: <https://myaccount.google.com/apppasswords>.
   - Name it `Supabase`.
   - Google shows a 16-character password once. Copy it straight into Supabase (next
     step). Don't save it in any project file, chat or screenshot.
   - This is not the account password. It can only send mail, and you can revoke it any
     time from the same page.

### 2. Enter it in Supabase

Dashboard → **Authentication → Emails → SMTP Settings** → enable **Custom SMTP**:

| Field | Value |
|---|---|
| Sender email | the Gmail address |
| Sender name | `School Resource Hub` |
| Host | `smtp.gmail.com` |
| Port | `465` |
| Username | the Gmail address (in full) |
| Password | the 16-character app password (no spaces) |
| Minimum interval between emails | `60` seconds (default) |

Save.

### 3. Rate limit

Dashboard → **Authentication → Rate Limits** → *Rate limit for sending emails*: Supabase
lowers this to 30/hour when custom SMTP is first turned on. That is fine for a school.
Raise it (e.g. 100/hour) before onboarding a whole year group at once.

### 4. Branded templates (optional, recommended)

Dashboard → **Authentication → Emails → Templates**. For each template, set the subject
and paste the HTML from `docs/email-templates/`:

| Template | Subject | File |
|---|---|---|
| Confirm signup | `Confirm your email for School Resource Hub` | `confirm-signup.html` |
| Reset password | `Reset your School Resource Hub password` | `reset-password.html` |
| Change email address | `Confirm your new email address` | `change-email.html` |
| Magic link | `Your School Resource Hub sign-in link` | `magic-link.html` |

They use `{{ .ConfirmationURL }}`, which Supabase fills in. The redirect after clicking is
set by the site (`auth.html?mode=…`), so nothing else needs changing.

### 5. Test

- [ ] Register a new account with a different email you can read. The confirmation arrives
      within a minute (check spam the first time), the link opens the site, and you can sign in.
- [ ] "Forgot your password?" sends a reset email, and the link opens the "choose a new
      password" page.
- [ ] If nothing arrives: Dashboard → **Logs → Auth** shows SMTP errors. The usual cause is
      a mistyped app password, or 2-Step Verification being off.

## If the app password leaks

Revoke it at <https://myaccount.google.com/apppasswords>, create a new one, and paste it into
Supabase. Nothing in the code changes.
