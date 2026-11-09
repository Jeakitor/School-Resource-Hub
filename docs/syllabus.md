# Syllabus data

## Rules

1. The **official IB subject guide** is authoritative. RevisionDojo may be used
   only as a secondary cross-check of topic organisation.
2. Never invent topics or subtopics. If a title can't be confirmed, leave it out
   and add a review note.
3. Syllabus files contain **syllabus content only**. Textbook chapters live in
   `data/textbooks.json`. Assessment components (Paper 1, IO…) are kept in a
   separate `assessment` array, not mixed into `topics`.
4. Each file records the guide's `first_assessment` year and the session it
   `applies_to_session`.

## Which guide applies to May 2027

| Subject | Guide (first assessment) | Notes |
|---|---|---|
| English A: Lang & Lit | 2021 | Three areas of exploration |
| French B, Hindi B | 2020 (language B) | Five prescribed themes; topics are the guide's *recommended* ones. HL adds literature |
| French ab initio | 2020 | SL only. Five themes, 20 prescribed topics |
| Business Management | 2024 | |
| Economics | 2022 | Confirm no newer guide applies |
| Psychology | 2027 | **New guide**; May 2027 is its first session. Lowest-confidence map: verify first |
| Digital Society | 2024 | Concepts, content, contexts; HL extension |
| ESS | 2026 | **New guide**, first with HL (HL lenses) |
| Biology | 2025 | Themes A–D |
| Chemistry | 2025 | Structure 1–3, Reactivity 1–3 |
| Physics | 2025 | Themes A–E |
| Computer Science | 2027 | May 2027 is this guide's first session |
| Mathematics AA, AI | 2021 | **Not** the new 2029 guide. Subtopics still to transcribe |
| TOK | 2022 | DP core, no SL/HL |
| Extended Essay, CAS | n/a | DP core. **Site categories**, not syllabus topics (`categories_not_syllabus: true`) |

Every subject supports SL and HL except French ab initio (SL only) and the DP core
(TOK, EE, CAS: `kind: "core"`, stored as level SL = "for all students", and the
database refuses HL resources for them). See [roles-and-levels.md](roles-and-levels.md).
## File format (`data/syllabi/<slug>.json`)

```json
{
  "subject_slug": "physics-hl",
  "guide": { "title": "...", "first_assessment": 2025, "applies_to_session": "May 2027" },
  "review": { "status": "unverified | verified", "verified_by": null, "verified_on": null, "notes": [] },
  "topics": [
    { "code": "A", "title": "...", "level": "SL",
      "subtopics": [ { "code": "A.1", "title": "...", "level": "SL" } ] }
  ]
}
```

`level`: `"SL"` means taught at SL and HL; `"HL"` means HL only. The subject
page's SL view hides HL-only items. `"subtopics_pending": true` shows a note that
subtopics are still to be transcribed (Maths AA, Maths AI, Psychology).

`code` is the stable identifier. It becomes the topic key in the database, so
**don't change a code once resources reference it**.

## Review status (as of 7 Nov 2026)

**All 18 files are `unverified`.** They were compiled from knowledge of the
guides and have not yet been checked line-by-line against official PDFs.

- **Maths AA:** topic titles only. Subtopics are intentionally empty and must be
  transcribed from the guide.
- **Business Management:** check 3.6 specifically (recorded as *Debt/equity
  ratio analysis*, HL). Toolkit items not yet entered.
- **English Lang & Lit:** no subtopics by design. Set texts are school-specific
  and do not belong here.

To verify a file: compare against the official guide, fix any differences, then
set `review.status` to `verified` with the reviewer's name and date.

## Adding a subject

1. Add an entry to `data/subjects.json` (slug, name, `abbr` badge, `levels`, `ib_group`, glyph, description, `syllabus_file`; `kind: "core"` for DP core).
2. Create `data/syllabi/<slug>.json` following the format above.
3. Check it: `node tools/check-syllabi.mjs`. It must report no errors. It catches duplicate or misplaced codes, HL content in SL-only subjects, SL subtopics under HL-only topics, database limits, broken preview data, and codes already in the database that vanished from the JSON.
4. Generate a NEW seed migration: `node tools/generate-seed.mjs supabase/migrations/<timestamp>_seed_<name>.sql`. It is idempotent and never deletes. Run the policy tests, which compare the seeded database with the JSON exactly, then run the migration in the Supabase SQL Editor.