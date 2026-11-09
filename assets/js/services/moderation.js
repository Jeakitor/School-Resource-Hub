/**
 * Moderation service (Phase 6): the review queue, decisions, teacher notes, roles and files.
 *
 * Nothing here grants power. Every call is checked by the database:
 *  - RLS limits which resources each moderator sees (admins: all; teachers: assigned subjects).
 *  - moderate_resource() refuses anyone who is not an admin.
 *  - Guard triggers limit teachers to the teacher-reviewed mark.
 *  - admin_list_users() / admin_orphan_files() check is_admin() inside.
 */

import { getSupabase } from './supabase.js';
import { toItems, LIST_COLUMNS, callFiles } from './resources.js';

async function sbOrThrow() {
  const sb = await getSupabase();
  if (!sb) throw new Error('Accounts are not configured on this site yet.');
  return sb;
}
const check = ({ data, error }) => { if (error) throw error; return data; };

/** Subjects with database ids (for role assignment). */
export async function listSubjectRows() {
  const sb = await sbOrThrow();
  return check(await sb.from('subjects').select('id, slug, name, short_name').order('name'));
}

/** Every resource this moderator may see, newest first. Pages split it by status. */
export async function listForReview() {
  const sb = await sbOrThrow();
  const rows = check(await sb.from('resources').select(LIST_COLUMNS)
    .order('created_at', { ascending: false }).limit(1000));
  return (await toItems(sb, rows)).map((r) => ({ ...r, created_at: r.submitted_at }));
}

/** Review history of one resource, with author names. */
export async function listReviews(resourceId) {
  const sb = await sbOrThrow();
  const rows = check(await sb.from('resource_reviews')
    .select('id, kind, decision, body, is_public, author_id, created_at')
    .eq('resource_id', resourceId).order('created_at', { ascending: false }));
  const ids = [...new Set(rows.map((r) => r.author_id).filter(Boolean))];
  const names = new Map();
  if (ids.length) {
    for (const p of check(await sb.from('profiles').select('id, display_name').in('id', ids))) names.set(p.id, p.display_name);
  }
  return rows.map((r) => ({ ...r, author_name: names.get(r.author_id) ?? null }));
}

/** Admin decision: 'approved' | 'rejected' | 'removed'. Feedback is required unless approving. */
export async function moderate(resourceId, decision, { feedback = null, level = null } = {}) {
  const sb = await sbOrThrow();
  return check(await sb.rpc('moderate_resource', {
    p_resource_id: resourceId, p_decision: decision,
    p_feedback: feedback?.trim() || null, p_level: level || null,
  }));
}

/** Teacher (or admin): set / clear the "teacher reviewed" mark. The database records who. */
export async function setTeacherReviewed(resourceId, value) {
  const sb = await sbOrThrow();
  const rows = check(await sb.from('resources').update({ teacher_reviewed: value }).eq('id', resourceId).select('id'));
  if (!rows.length) throw new Error('You cannot change this resource.');
}

/** kind: 'note' (visible to the contributor) | 'flag' (staff only). Only notes can be public. */
export async function addReview(resourceId, { kind, body, isPublic = false }) {
  const sb = await sbOrThrow();
  check(await sb.from('resource_reviews').insert({
    resource_id: resourceId, kind, body: body.trim(), is_public: kind === 'note' && isPublic,
  }));
}

export async function deleteReview(reviewId) {
  const sb = await sbOrThrow();
  const rows = check(await sb.from('resource_reviews').delete().eq('id', reviewId).select('id'));
  if (!rows.length) throw new Error('You cannot delete this note.');
}

/* ------------------------------ People & roles ------------------------------ */

export async function listUsers() {
  const sb = await sbOrThrow();
  return check(await sb.rpc('admin_list_users'));
}

export async function grantRole(userId, role) {
  const sb = await sbOrThrow();
  check(await sb.from('user_roles').insert({ user_id: userId, role }));
}

/** Removing the teacher role also clears their subject assignments. */
export async function revokeRole(userId, role) {
  const sb = await sbOrThrow();
  const rows = check(await sb.from('user_roles').delete().eq('user_id', userId).eq('role', role).select('role'));
  if (!rows.length) throw new Error('That role could not be removed.');
  if (role === 'teacher') check(await sb.from('teacher_subjects').delete().eq('user_id', userId));
}

export async function assignSubject(userId, subjectId) {
  const sb = await sbOrThrow();
  check(await sb.from('teacher_subjects').insert({ user_id: userId, subject_id: subjectId }));
}

export async function unassignSubject(userId, subjectId) {
  const sb = await sbOrThrow();
  check(await sb.from('teacher_subjects').delete().eq('user_id', userId).eq('subject_id', subjectId));
}

/* ---------------------------------- Files ---------------------------------- */

/** Files older than a day that no resource refers to (admin only). */
export async function listOrphanFiles() {
  const sb = await sbOrThrow();
  return check(await sb.rpc('admin_orphan_files'));
}

/** Deletes via the files function (100 per call). Returns how many were actually deleted. */
export async function deleteFiles(paths) {
  const sb = await sbOrThrow();
  let n = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const { deleted } = await callFiles(sb, 'delete', { paths: paths.slice(i, i + 100) });
    n += deleted.length;
  }
  return n;
}

/** Turn moderation errors into plain messages. */
export function moderationError(err) {
  const msg = String(err?.message ?? err ?? '');
  if (/Could not find the function public\.admin_/i.test(msg)) return 'This needs database migration 0008 (supabase/migrations/20261107000008_moderation.sql). Run it in the Supabase SQL Editor, then refresh.';
  if (/Feedback of at least/i.test(msg)) return 'Write feedback of at least 10 characters for the contributor.';
  if (/last administrator/i.test(msg)) return 'You cannot remove the last administrator.';
  if (/teacher role before subjects/i.test(msg)) return 'Give this person the teacher role first.';
  if (/duplicate key/i.test(msg)) return 'That is already set. Refresh the page to see the latest state.';
  if (/HL-only|not offered at level/i.test(msg)) return msg;
  if (/Only administrators|row-level security|permission denied|not allowed|Teachers can only/i.test(msg)) return 'You do not have permission to do that.';
  if (/failed to fetch|network/i.test(msg)) return 'Could not reach the server. Check your connection and try again.';
  return msg || 'Something went wrong. Please try again.';
}
