/**
 * Resources service — the only module that knows where resources come from.
 *
 * Every list function returns { items, source } where source is:
 *   'live'     — from Supabase (Phase 4+), filtered by RLS
 *   'preview'  — labelled sample data, only with ?preview=1
 *   'none'     — no backend connected yet; items is always []
 *
 * Items are "enriched": the service attaches resolved subject/topic/subtopic
 * objects so pages and search don't each repeat that work.
 */

import { isPreviewMode } from '../config/site.js';
import { listSubjects, resolveTopic } from './catalog.js';
import { getSupabase } from './supabase.js';

/*
 * Live data notes
 * - The published list is loaded once per page (newest MAX_LISTED) and searched in the
 *   browser, which lets search cover subject names and topic titles too. If the library
 *   outgrows this, move search to a database function using resources.search (GIN-indexed).
 * - Database ids are mapped back to the slugs/codes used by /data, so pages work
 *   identically with live and preview data.
 */
const MAX_LISTED = 1000;
const LIST_COLUMNS = 'id, title, description, subject_id, topic_id, subtopic_id, level, resource_type, '
  + 'external_url, storage_path, tags, uploader_id, status, teacher_reviewed, created_at, approved_at';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let idMapCache = null;
function loadIdMaps(sb) {
  idMapCache ??= Promise.all([
    sb.from('subjects').select('id, slug'),
    sb.from('topics').select('id, code'),
  ]).then(([s, t]) => {
    if (s.error) throw s.error;
    if (t.error) throw t.error;
    return {
      subjects: new Map(s.data.map((x) => [x.id, x.slug])),
      topics: new Map(t.data.map((x) => [x.id, x.code])),
    };
  });
  idMapCache.catch(() => { idMapCache = null; });
  return idMapCache;
}

/** Display names of contributors (RLS only reveals credited ones). */
async function contributorNames(sb, ids) {
  const names = new Map();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await sb.from('profiles').select('id, display_name').in('id', unique.slice(i, i + 100));
    if (error) throw error;
    for (const p of data) names.set(p.id, p.display_name);
  }
  return names;
}

/** Database rows -> the record shape pages use (slugs, codes, contributor name). */
async function fromRows(sb, rows) {
  const [{ subjects, topics }, names] = await Promise.all([loadIdMaps(sb), contributorNames(sb, rows.map((r) => r.uploader_id))]);
  return rows.map((r) => ({
    ...r,
    subject_slug: subjects.get(r.subject_id),
    topic_code: topics.get(r.topic_id),
    subtopic_code: r.subtopic_id ? topics.get(r.subtopic_id) : null,
    contributor_name: names.get(r.uploader_id) ?? null,
    submitted_at: r.created_at,
    created_at: r.approved_at ?? r.created_at, // lists show when it was published
  }));
}

/** For services/moderation.js: rows -> enriched items, with the same shape as public lists. */
export async function toItems(sb, rows) {
  return enrich(await fromRows(sb, rows));
}
export { LIST_COLUMNS };

let liveCache = null;
async function loadLive(sb) {
  liveCache ??= (async () => {
    const { data, error } = await sb.from('resources')
      .select(LIST_COLUMNS)
      .eq('status', 'approved') // explicit: owners/staff can see more via RLS, but public lists show published only
      .order('approved_at', { ascending: false })
      .limit(MAX_LISTED);
    if (error) throw error;
    return enrich(await fromRows(sb, data));
  })();
  liveCache.catch(() => { liveCache = null; });
  return liveCache;
}

const PREVIEW_URL = new URL('../../../data/preview/resources.json', import.meta.url);
let previewCache = null;

function loadPreview() {
  if (!previewCache) {
    previewCache = fetch(PREVIEW_URL).then((res) => {
      if (!res.ok) throw new Error(`Preview data unavailable (HTTP ${res.status})`);
      return res.json();
    });
  }
  return previewCache;
}

async function enrich(records) {
  const subjects = await listSubjects();
  const bySlug = new Map(subjects.map((s) => [s.slug, s]));
  return Promise.all(records.map(async (r) => {
    const subject = bySlug.get(r.subject_slug) ?? null;
    const { topic, subtopic } = await resolveTopic(subject, r.topic_code, r.subtopic_code);
    return { ...r, subject, topic, subtopic, is_preview: isPreviewMode() };
  }));
}

/** All published resources visible to the current visitor. */
async function allPublished() {
  if (isPreviewMode()) {
    const data = await loadPreview();
    return { items: await enrich(data.resources), source: 'preview' };
  }
  const sb = await getSupabase();
  if (!sb) return { items: [], source: 'none' };
  return { items: await loadLive(sb), source: 'live' };
}

const byNewest = (a, b) => new Date(b.created_at) - new Date(a.created_at);

/**
 * Filtered list of published resources.
 * @param {object} f  { subject, level, type, topic, subtopic, q, sort: 'newest'|'oldest'|'title' }
 *   level: '' (all) | 'SL' (hide HL-only) | 'HL' (HL-only content)
 */
export async function listPublished(f = {}) {
  const { items, source } = await allPublished();
  const terms = tokenize(f.q);

  let out = items.filter((r) =>
    (!f.subject || r.subject_slug === f.subject)
    && (!f.type || r.resource_type === f.type)
    && (!f.topic || r.topic_code === f.topic)
    && (!f.subtopic || r.subtopic_code === f.subtopic)
    && (f.level !== 'SL' || r.level !== 'HL')
    && (f.level !== 'HL' || r.level === 'HL')
    && (!terms.length || matches(r, terms)));

  if (f.sort === 'title') out.sort((a, b) => a.title.localeCompare(b.title));
  else if (f.sort === 'oldest') out.sort((a, b) => -byNewest(a, b));
  else out.sort(byNewest);

  return { items: out, source };
}

export async function listRecent({ limit = 6 } = {}) {
  const { items, source } = await listPublished({ sort: 'newest' });
  return { items: items.slice(0, limit), source };
}

export async function countBySubject() {
  const { items, source } = await allPublished();
  const counts = new Map();
  for (const r of items) counts.set(r.subject_slug, (counts.get(r.subject_slug) ?? 0) + 1);
  return { counts, total: items.length, source };
}

/**
 * One resource with its full content. Live mode fetches by id, so the owner and
 * moderators can also open unpublished items (RLS decides who sees what).
 * PDFs get short-lived signed URLs: one to view, one that downloads.
 * Public correction notes are attached as `corrections`.
 */
export async function getResource(id) {
  if (isPreviewMode()) {
    const { items } = await allPublished();
    return { item: items.find((r) => r.id === id) ?? null, source: 'preview' };
  }
  const sb = await getSupabase();
  if (!sb) return { item: null, source: 'none' };
  if (!UUID_RE.test(id ?? '')) return { item: null, source: 'live' };

  const { data, error } = await sb.from('resources').select(`${LIST_COLUMNS}, body_md`).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return { item: null, source: 'live' };

  const [item] = await enrich(await fromRows(sb, [data]));

  if (item.resource_type === 'pdf' && item.storage_path) {
    // 1-hour links from the files function; it re-checks visibility with the viewer's token.
    try {
      const links = await callFiles(sb, 'sign', { resourceId: item.id });
      item.file_url = links.view;
      item.download_url = links.download;
    } catch (err) {
      console.error('PDF link failed', err);
      item.file_url = null;
      item.download_url = null;
    }
  }

  const notes = await sb.from('resource_reviews')
    .select('body, created_at').eq('resource_id', id).eq('is_public', true).order('created_at');
  item.corrections = notes.error ? [] : notes.data;

  return { item, source: 'live' };
}

/* ---------------- Submissions (account + moderation) ------------------ */

async function signedInClient() {
  const sb = await getSupabase();
  if (!sb) throw new Error('Accounts are not configured on this site yet.');
  const { data } = await sb.auth.getSession();
  const uid = data.session?.user?.id;
  if (!uid) throw new Error('Please sign in first.');
  return { sb, uid };
}

/**
 * The signed-in user's own submissions, every status, newest first.
 * Rejected / removed items carry the moderator's latest feedback as `feedback`.
 */
export async function listMySubmissions() {
  if (isPreviewMode()) {
    const data = await loadPreview();
    return { items: (await enrich(data.submissions)).sort(byNewest), source: 'preview' };
  }
  const sb = await getSupabase();
  if (!sb) return { items: [], source: 'none' };
  const { data: sess } = await sb.auth.getSession();
  const uid = sess.session?.user?.id;
  if (!uid) return { items: [], source: 'live' };

  const { data, error } = await sb.from('resources').select(LIST_COLUMNS)
    .eq('uploader_id', uid).order('created_at', { ascending: false });
  if (error) throw error;
  // Lists of submissions show when they were submitted, not published.
  const items = (await enrich(await fromRows(sb, data))).map((r) => ({ ...r, created_at: r.submitted_at }));

  // Decisions (latest one = feedback) and teacher notes. RLS never returns staff-only flags.
  const latest = new Map();
  const notes = new Map();
  const ids = items.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 100) {
    const { data: reviews, error: rErr } = await sb.from('resource_reviews')
      .select('resource_id, kind, decision, body, created_at')
      .in('kind', ['decision', 'note']).in('resource_id', ids.slice(i, i + 100))
      .order('created_at', { ascending: false });
    if (rErr) throw rErr;
    for (const rv of reviews) {
      if (rv.kind === 'decision') { if (!latest.has(rv.resource_id)) latest.set(rv.resource_id, rv); }
      else if (rv.body) notes.set(rv.resource_id, [...(notes.get(rv.resource_id) ?? []), rv]);
    }
  }
  for (const r of items) {
    const rv = latest.get(r.id);
    if (rv?.body && rv.decision === r.status && (r.status === 'rejected' || r.status === 'removed')) r.feedback = rv.body;
    r.notes = (notes.get(r.id) ?? []).reverse(); // oldest first
  }
  return { items, source: 'live' };
}

/** One of the user's own submissions, with its content, for the edit form. */
export async function getMySubmission(id) {
  if (!UUID_RE.test(id ?? '')) return null;
  const { sb, uid } = await signedInClient();
  const { data, error } = await sb.from('resources').select(`${LIST_COLUMNS}, body_md`)
    .eq('id', id).eq('uploader_id', uid).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [item] = await fromRows(sb, [data]);
  const fb = await sb.from('resource_reviews').select('decision, body')
    .eq('resource_id', id).eq('kind', 'decision').order('created_at', { ascending: false }).limit(1).maybeSingle();
  const feedback = !fb.error && fb.data?.decision === item.status ? fb.data.body : null;
  return { ...item, feedback, editable: item.status === 'pending' || item.status === 'rejected' };
}

/* ------------------------- Contributions (Phase 5) -------------------------
 * The browser does the convenient checks; the database repeats every one of them
 * (status forced to pending, catalog/level rules, file ownership, content shape).
 * Order matters for files: upload first, then write the row (the row's trigger
 * checks the file exists). If the row write fails, the new file is removed again.
 */

/** Map the form's subject slug + topic codes to database ids. */
async function catalogIds(sb, { subject, topic, subtopic }) {
  const s = await sb.from('subjects').select('id').eq('slug', subject).maybeSingle();
  if (s.error) throw s.error;
  if (!s.data) throw new Error('That subject is not in the database yet. An administrator needs to run the latest catalog migration.');
  const codes = subtopic ? [topic, subtopic] : [topic];
  const t = await sb.from('topics').select('id, code, parent_id').eq('subject_id', s.data.id).in('code', codes);
  if (t.error) throw t.error;
  const top = t.data.find((x) => x.code === topic && x.parent_id === null);
  const sub = subtopic ? t.data.find((x) => x.code === subtopic && x.parent_id === top?.id) : null;
  if (!top || (subtopic && !sub)) throw new Error('That topic was not found. Please refresh the page.');
  return { subject_id: s.data.id, topic_id: top.id, subtopic_id: sub?.id ?? null };
}

/**
 * PDFs live in a private Backblaze B2 bucket. The `files` Edge Function holds the B2 keys
 * and asks the database (with the caller's own token) before every action.
 * See supabase/functions/files and docs/storage-b2.md.
 */
export async function callFiles(sb, action, body) {
  const { data, error } = await sb.functions.invoke('files', { body, headers: { 'x-action': action } });
  if (error) {
    let message = error.message;
    const status = error.context?.status;
    try { const j = await error.context?.json(); if (j?.error) message = j.error; } catch { /* not JSON */ }
    if (status === 404 && !/not available/i.test(message)) message = 'File storage is not set up yet (the files function is not deployed).';
    if (/Failed to send a request/i.test(message)) message = 'Could not reach file storage. Check your connection; if this keeps happening, file storage may not be set up yet.';
    throw Object.assign(new Error(message), { status });
  }
  return data;
}

async function uploadPdf(sb, _uid, file) {
  const { path } = await callFiles(sb, 'upload', file);
  return path;
}

/**
 * Best effort: a leftover file is private and harmless, so failures are logged, not thrown.
 * Returns true only if the function confirms the file was deleted.
 */
async function removeFile(sb, path) {
  if (!path) return true;
  try {
    const { deleted } = await callFiles(sb, 'delete', { paths: [path] });
    if (deleted.includes(path)) return true;
    console.warn('File not deleted', path);
  } catch (err) {
    console.warn('Could not remove file', path, err);
  }
  return false;
}

/**
 * Row fields from a form draft. Exactly one content column is set; the others are
 * cleared, matching the database's resources_content_matches_type constraint.
 * @param d { title, description, level, type, notes, url, tags }
 */
function rowFields(d, ids, storagePath) {
  return {
    title: d.title.trim(),
    description: d.description.trim(),
    ...ids,
    level: d.level,
    resource_type: d.type,
    storage_path: d.type === 'pdf' ? storagePath : null,
    body_md: d.type === 'markdown' ? d.notes.trim() : null,
    external_url: d.type === 'link' ? d.url.trim() : null,
    tags: d.tags,
  };
}

/**
 * Submit a new resource. It is always saved as pending: the website never sends a
 * status, and the database forces non-admin inserts to pending regardless.
 * @param d  draft from the contribute form (+ `file` for PDFs, + subject/topic/subtopic codes)
 * @param onStep  optional progress callback: 'upload' | 'save'
 * @returns the new resource id
 */
export async function submitResource(d, onStep = () => {}) {
  const { sb, uid } = await signedInClient();
  const ids = await catalogIds(sb, d);
  let path = null;
  if (d.type === 'pdf') { onStep('upload'); path = await uploadPdf(sb, uid, d.file); }
  onStep('save');
  const { data, error } = await sb.from('resources')
    .insert({ ...rowFields(d, ids, path), uploader_id: uid })
    .select('id').single();
  if (error) { await removeFile(sb, path); throw error; }
  liveCache = null;
  return data.id;
}

/**
 * Revise one's own pending or rejected submission. It goes back to pending.
 * A new PDF replaces the old one, which is then deleted; switching away from PDF
 * deletes the old file too.
 * @param existing  the row from getMySubmission()
 */
export async function updateSubmission(existing, d, onStep = () => {}) {
  const { sb, uid } = await signedInClient();
  const ids = await catalogIds(sb, d);
  let uploaded = null;
  if (d.type === 'pdf' && d.file) { onStep('upload'); uploaded = await uploadPdf(sb, uid, d.file); }
  const path = d.type === 'pdf' ? (uploaded ?? existing.storage_path) : null;
  if (d.type === 'pdf' && !path) throw new Error('Choose a PDF to upload.');

  onStep('save');
  const { data, error } = await sb.from('resources')
    .update({ ...rowFields(d, ids, path), status: 'pending' })
    .eq('id', existing.id).select('id').maybeSingle();
  if (error || !data) {
    await removeFile(sb, uploaded);
    throw error ?? new Error('This submission can no longer be edited. It may have been published or withdrawn.');
  }
  if (existing.storage_path && existing.storage_path !== path) await removeFile(sb, existing.storage_path);
  liveCache = null;
  return existing.id;
}

/** Withdraw (delete) one's own pending or rejected submission, and its file. */
export async function withdrawSubmission(id) {
  const { sb } = await signedInClient();
  const { data, error } = await sb.from('resources').delete().eq('id', id).select('id, storage_path').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This submission can no longer be withdrawn. It may already be published.');
  liveCache = null;
  return { fileRemoved: await removeFile(sb, data.storage_path) };
}

/** Turn upload / database errors into messages a student can act on. */
export function submissionError(err) {
  const msg = String(err?.message ?? err ?? '');
  const status = Number(err?.statusCode ?? err?.status);
  if (/file storage/i.test(msg)) return msg;
  if (status === 413 || /maximum allowed size|too large|payload/i.test(msg)) return 'This file is larger than 20 MB.';
  if (/mime|content type|invalid_mime/i.test(msg)) return 'Only PDF files can be uploaded.';
  if (/jwt|not authenticated|sign in first/i.test(msg)) return 'Your session has expired. Please sign in again (your form will be cleared).';
  if (/row-level security|permission denied|not allowed/i.test(msg)) return 'You do not have permission to do that. Try signing out and in again.';
  // The database's own rule messages are written for people: show them as they are.
  if (/HL-only|not offered at level|could not be found|can no longer|not found\. Please refresh|not in the database yet|Choose a PDF/i.test(msg)) return msg;
  if (/content_matches_type/.test(msg)) return 'The content does not match the resource type. Check Step 3.';
  if (/tags_valid/.test(msg)) return 'Tags must be lower-case, at most 8, each under 30 characters.';
  if (/check constraint|violates/i.test(msg)) return 'One of the fields is not valid. Please check the form and try again.';
  if (/failed to fetch|network/i.test(msg)) return 'Could not reach the server. Check your connection and try again.';
  return msg || 'Something went wrong. Please try again.';
}

/** Moderation queue (Phase 6: only admins/teachers pass RLS). */
export async function listSubmissions({ status } = {}) {
  const { items, source } = await listMySubmissions();
  return { items: status ? items.filter((s) => s.status === status) : items, source };
}

/* ------------------------------ Search -------------------------------- */

function tokenize(q) {
  return String(q ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split(/\s+/).filter(Boolean);
}

/** Every term must appear somewhere in the resource's searchable text. */
function matches(r, terms) {
  const hay = [
    r.title, r.description, r.subject?.name, r.subject?.short_name,
    r.topic?.code, r.topic?.title, r.subtopic?.code, r.subtopic?.title,
    ...(r.tags ?? []), r.level === 'HL' ? 'HL' : 'SL',
  ].join(' ').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return terms.every((t) => hay.includes(t));
}
