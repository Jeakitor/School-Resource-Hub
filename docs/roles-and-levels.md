# Roles and level tagging

Two product decisions made on 6 Nov 2026 that shape the database (Phase 2).

## SL / HL level tags

IB subjects are taken at SL or HL. HL students study everything SL students do,
plus additional higher level (AHL) content. So a resource is tagged one of:

| Tag (DB value) | Label | Meaning |
|---|---|---|
| `SL` | SL & HL | Core content, useful to both SL and HL students |
| `HL` | HL only | Additional higher level content |

- Subjects are **level-independent** (`physics`, not `physics-hl`). `subjects.json`
  lists which levels the IB offers (`French ab initio` is SL only).
- Syllabus topics and subtopics carry the same `SL`/`HL` tag.
- **Contribute form:** choosing an HL-only topic or subtopic forces `HL only`.
  An SL-only subject forces `SL & HL`. Otherwise the student chooses.
- **Moderation:** admins can correct a wrong tag before approving.
- **Browsing:** "SL" view hides HL-only resources and topics. "HL only" shows only AHL material. "All" shows everything.
- Phase 2 enforces this in the database with a `CHECK (level IN ('SL','HL'))` constraint
  and a trigger that rejects `SL` on an HL-only topic.

## Roles

| Role | Granted by | Can |
|---|---|---|
| `student` | Default on sign-up | Browse; submit; see own submissions and feedback; revise and resubmit |
| `teacher` | An admin, per subject | For assigned subjects: add review notes (corrections, optionally public), mark *Teacher reviewed*, flag published work for revision (a request to admins; teachers never change status themselves) |
| `admin` | Manually (first admin via the Supabase SQL editor) | Approve / request changes, edit metadata (incl. level tag), unpublish, assign roles |

Design choices:

- **One site, not a separate teacher portal.** Teachers use the same login and
  the same moderation workspace (`admin.html`), and see only their subjects.
  A second portal would mean a second auth system and twice the security surface
  for the same data.
- **Teachers are optional, not a gate.** Student admins can publish without a
  teacher review. A *Teacher reviewed* badge adds trust when a teacher has checked it.
- **Roles live in a separate table** (`user_roles` / `teacher_subjects`) that only
  admins can write to, enforced by RLS. Never in editable profile fields or user metadata.
- The page hides controls by role for convenience only. **Security comes from RLS.**

## Preview

`admin.html?preview=1` has a role switch (Admin / Teacher for Physics and Economics),
so both experiences can be reviewed before Supabase is connected.
