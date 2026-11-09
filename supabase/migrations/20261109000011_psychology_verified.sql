-- =============================================================================
-- School Resource Hub — 0011 Psychology topic map verified
-- Checked against the official guide by Jeakitor on 2026-11-09 (data/syllabi/psychology.json).
-- Only changes the review status shown on the Subjects page. Safe to re-run.
-- =============================================================================
update public.subjects set syllabus_review_status = 'verified' where slug = 'psychology';
