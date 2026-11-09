#!/usr/bin/env node
/**
 * Database access-rule tests.
 *
 * Runs the real migrations (supabase/migrations/*.sql) on PGlite (PostgreSQL 16
 * compiled to WebAssembly) on top of a small shim of Supabase's auth/storage
 * schemas, then acts as anon / students / a teacher / an admin and checks
 * what each can and cannot do.
 *
 *   cd supabase/tests && npm install && npm test
 *
 * Limits: this tests OUR SQL (tables, triggers, RLS, storage policies). It does not
 * test Supabase's own services (Auth emails, the Storage API's MIME/size checks,
 * signed-URL issuing). Those are covered by the manual checklist in docs/security.md.
 */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const db = new PGlite();

/* ------------------------------- Setup ---------------------------------- */
await db.exec(readFileSync(here('./supabase-shim.sql'), 'utf8'));
// MIGRATIONS_DIR lets you run the suite against a modified copy (e.g. to prove a test catches a broken policy).
const migrationsDir = process.env.MIGRATIONS_DIR ? process.env.MIGRATIONS_DIR.replace(/[\\/]?$/, '/') : here('../migrations/');
for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await db.exec(readFileSync(migrationsDir + file, 'utf8'));
  } catch (err) {
    console.error(`Migration failed: ${file}\n${err.message}`);
    process.exit(1);
  }
  console.log(`migrated  ${file}`);
}

// The JSON catalog, to check the seeded database against it.
const dataPath = (p) => here(`../../data/${p}`);
const registry = JSON.parse(readFileSync(dataPath('subjects.json'), 'utf8'));
const jsonTopicKeys = registry.subjects.flatMap((s) => {
  const syl = JSON.parse(readFileSync(dataPath(s.syllabus_file), 'utf8'));
  return syl.topics.flatMap((t) => [`${s.slug}|${t.code}|${t.level}|`, ...(t.subtopics ?? []).map((st) => `${s.slug}|${st.code}|${st.level}|${t.code}`)]);
});
const jsonTopicCount = jsonTopicKeys.length;

const users = {};
for (const name of ['admin', 'teacher', 'alice', 'bob']) {
  const { rows } = await db.query(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${name}@example.test`, { display_name: name[0].toUpperCase() + name.slice(1), role: 'admin' /* must be ignored */ }],
  );
  users[name] = rows[0].id;
}
// Bootstrap roles as the database owner (this is the documented manual process).
await db.query(`insert into public.user_roles (user_id, role) values ($1, 'admin'), ($2, 'teacher')`, [users.admin, users.teacher]);
await db.query(
  `insert into public.teacher_subjects (user_id, subject_id) select $1, id from public.subjects where slug = 'physics'`,
  [users.teacher],
);

const subjectId = async (slug) => (await db.query(`select id from public.subjects where slug = $1`, [slug])).rows[0].id;
const topicId = async (slug, code) => (await db.query(
  `select t.id from public.topics t join public.subjects s on s.id = t.subject_id where s.slug = $1 and t.code = $2`, [slug, code],
)).rows[0].id;
const S = { physics: await subjectId('physics'), economics: await subjectId('economics'), french: await subjectId('french-ab-initio') };
const T = {
  pA: await topicId('physics', 'A'), pA1: await topicId('physics', 'A.1'), pA4: await topicId('physics', 'A.4'), pB1: await topicId('physics', 'B.1'),
  e2: await topicId('economics', '2'), e25: await topicId('economics', '2.5'), f1: await topicId('french-ab-initio', 'T1'),
};

/* ------------------------------ Helpers --------------------------------- */
let current = null;
async function as(who) {
  current = who;
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${who ? users[who] : ''}', false);`);
  await db.exec(`set role ${who ? 'authenticated' : 'anon'};`);
}
async function asOwner() {
  current = undefined;
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
}
const q = async (sql, params) => (await db.query(sql, params)).rows;

async function rejects(sql, params, re) {
  try {
    await db.query(sql, params);
  } catch (err) {
    if (re && !re.test(err.message)) throw new Error(`failed for the wrong reason: ${err.message}`);
    return err.message;
  }
  throw new Error('expected this to be refused, but it succeeded');
}
function eq(actual, expected, what = 'value') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const NOTES = 'These notes summarise the SUVAT equations, with two worked examples and a short list of common mistakes to avoid.';
async function submit(over = {}) {
  const r = {
    title: 'Kinematics summary sheet', description: 'A short summary of the kinematics equations.',
    subject_id: S.physics, topic_id: T.pA, subtopic_id: T.pA1, level: 'SL', resource_type: 'markdown',
    body_md: NOTES, storage_path: null, external_url: null, tags: [], status: undefined, uploader_id: undefined, ...over,
  };
  const cols = ['title', 'description', 'subject_id', 'topic_id', 'subtopic_id', 'level', 'resource_type', 'body_md', 'storage_path', 'external_url', 'tags', 'uploader_id'];
  const vals = [r.title, r.description, r.subject_id, r.topic_id, r.subtopic_id, r.level, r.resource_type, r.body_md, r.storage_path, r.external_url, r.tags,
    r.uploader_id ?? (await q(`select auth.uid() as id`))[0].id];
  if (r.status) { cols.push('status'); vals.push(r.status); }
  const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
  return (await q(`insert into public.resources (${cols.join(', ')}) values (${ph}) returning *`, vals))[0];
}
const visible = async (id) => (await q(`select id from public.resources where id = $1`, [id])).length === 1;
const newPath = (who) => `${users[who]}/${randomUUID()}.pdf`;
// Uploads are recorded by the `files` Edge Function with the service role (trusted),
// after it has checked the user, size and PDF signature. Simulate that, then return
// to whoever the test was acting as.
async function upload(who, path) {
  const was = current;
  await asOwner();
  await q(`insert into public.files (path, owner_id, size) values ($1, $2, 1000)`, [path, users[who]]);
  if (was !== undefined) await as(was);
}
const canDelete = async (path) => (await q(`select public.can_delete_file($1) as ok`, [path]))[0].ok;

let passed = 0;
const failures = [];
let section = '';
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(`${section} › ${name}: ${err.message}`);
    console.log(`  ✗ ${name}\n      ${err.message}`);
  } finally {
    await asOwner();
  }
}
const describe = (name) => { section = name; console.log(`\n${name}`); };

/* -------------------------------- Tests --------------------------------- */
describe('Sign-up and profiles');

await test('sign-up creates a profile from display_name only', async () => {
  const rows = await q(`select display_name from public.profiles where id = $1`, [users.alice]);
  eq(rows[0].display_name, 'Alice', 'display name');
});

await test('role in sign-up metadata is ignored (no self-made admins)', async () => {
  eq((await q(`select count(*)::int as n from public.user_roles where user_id = $1`, [users.alice]))[0].n, 0, 'roles for alice');
});

await test('a student can rename themselves', async () => {
  await as('alice');
  eq((await q(`update public.profiles set display_name = 'Alice B' where id = auth.uid() returning id`)).length, 1, 'rows updated');
});

await test("a student cannot rename someone else", async () => {
  await as('alice');
  eq((await q(`update public.profiles set display_name = 'Hacked' where id = $1 returning id`, [users.bob])).length, 0, 'rows updated');
});

await test('a student cannot change their profile id', async () => {
  await as('alice');
  await rejects(`update public.profiles set id = gen_random_uuid() where id = auth.uid()`, [], /permission denied/);
});

describe('Roles cannot be self-granted');

await test('a student cannot make themselves admin', async () => {
  await as('alice');
  await rejects(`insert into public.user_roles (user_id, role) values (auth.uid(), 'admin')`, [], /row-level security/);
});

await test('a student cannot assign themselves a teaching subject', async () => {
  await as('alice');
  await rejects(`insert into public.teacher_subjects (user_id, subject_id) values (auth.uid(), $1)`, [S.physics], /row-level security|teacher role/);
});

await test('a teacher cannot grant roles', async () => {
  await as('teacher');
  await rejects(`insert into public.user_roles (user_id, role) values ($1, 'teacher')`, [users.bob], /row-level security/);
});

await test('a student cannot read other people\'s roles', async () => {
  await as('alice');
  eq((await q(`select * from public.user_roles`)).length, 0, 'visible roles');
});

await test('an admin can grant a role, and granted_by is recorded', async () => {
  await as('admin');
  const r = await q(`insert into public.user_roles (user_id, role) values ($1, 'teacher') returning granted_by`, [users.bob]);
  eq(r[0].granted_by, users.admin, 'granted_by');
  await q(`delete from public.user_roles where user_id = $1`, [users.bob]);
});

await test('the last admin cannot be removed', async () => {
  await as('admin');
  await rejects(`delete from public.user_roles where user_id = auth.uid() and role = 'admin'`, [], /last administrator/);
});

describe('Submitting resources');

let alicePending;
await test('a student can submit; status is forced to pending even if they send "approved"', async () => {
  await as('alice');
  alicePending = await submit({ status: 'approved' });
  eq(alicePending.status, 'pending', 'status');
  eq(alicePending.approved_at, null, 'approved_at');
});

await test('anonymous visitors cannot submit', async () => {
  await as(null);
  await rejects(`insert into public.resources (title) values ('x')`, [], /permission denied/);
});

await test('a student cannot submit in someone else\'s name', async () => {
  await as('alice');
  try { await submit({ uploader_id: users.bob }); } catch (e) { if (/row-level security/.test(e.message)) return; throw e; }
  throw new Error('expected refusal');
});

await test('SL tag on an HL-only subtopic is refused', async () => {
  await as('alice');
  try { await submit({ subtopic_id: T.pA4, level: 'SL' }); } catch (e) { if (/HL-only/.test(e.message)) return; throw e; }
  throw new Error('expected refusal');
});

await test('HL tag on an HL-only subtopic is accepted', async () => {
  await as('alice');
  const r = await submit({ subtopic_id: T.pA4, level: 'HL' });
  eq(r.level, 'HL', 'level');
});

await test('HL tag on an SL-only subject (French ab initio) is refused', async () => {
  await as('alice');
  try { await submit({ subject_id: S.french, topic_id: T.f1, subtopic_id: null, level: 'HL' }); } catch (e) { if (/not offered at level/.test(e.message)) return; throw e; }
  throw new Error('expected refusal');
});

await test('a topic from another subject is refused', async () => {
  await as('alice');
  try { await submit({ topic_id: T.e2, subtopic_id: null }); } catch (e) { if (/foreign key/.test(e.message)) return; throw e; }
  throw new Error('expected refusal');
});

await test('a subtopic that is not under the chosen topic is refused', async () => {
  await as('alice');
  try { await submit({ subtopic_id: T.pB1 }); } catch (e) { if (/foreign key/.test(e.message)) return; throw e; }
  throw new Error('expected refusal');
});

await test('a link must be https', async () => {
  await as('alice');
  try { await submit({ resource_type: 'link', body_md: null, external_url: 'http://example.com' }); } catch (e) { if (/content_matches_type/.test(e.message)) return; throw e; }
  throw new Error('expected refusal');
});

await test('javascript: URLs are refused', async () => {
  await as('alice');
  try { await submit({ resource_type: 'link', body_md: null, external_url: 'javascript:alert(1)' }); } catch (e) { if (/content_matches_type/.test(e.message)) return; throw e; }
  throw new Error('expected refusal');
});

await test('notes shorter than 100 characters are refused', async () => {
  await as('alice');
  try { await submit({ body_md: 'too short' }); } catch (e) { if (/content_matches_type/.test(e.message)) return; throw e; }
  throw new Error('expected refusal');
});

await test('invalid tags (too many / not lower-case) are refused', async () => {
  await as('alice');
  for (const tags of [['Upper'], Array.from({ length: 9 }, (_, i) => `t${i}`)]) {
    try { await submit({ tags }); throw new Error(`accepted ${JSON.stringify(tags)}`); } catch (e) { if (!/tags_valid/.test(e.message)) throw e; }
  }
});

describe('Uploads and storage');

let alicePdf;
await test('a student can upload a PDF into their own folder', async () => {
  await as('alice');
  alicePdf = newPath('alice');
  await upload('alice', alicePdf);
});

await test('students cannot record files themselves (only the Edge Function can)', async () => {
  await as('alice');
  await rejects(`insert into public.files (path, owner_id, size) values ($1, $2, 10)`, [newPath('alice'), users.alice], /permission denied/);
});

await test('anonymous visitors cannot record files', async () => {
  await as(null);
  await rejects(`insert into public.files (path, owner_id, size) values ($1, $2, 10)`, [newPath('alice'), users.alice], /permission denied/);
});

await test('even trusted code cannot record a file outside the owner\'s folder', async () => {
  await rejects(`insert into public.files (path, owner_id, size) values ($1, $2, 10)`, [newPath('bob'), users.alice], /files_path_in_owner_folder/);
});

await test('non-PDF names, nested folders and oversized files are refused', async () => {
  await rejects(`insert into public.files (path, owner_id, size) values ($1, $2, 10)`, [`${users.alice}/${randomUUID()}.html`, users.alice], /files_path_check/);
  await rejects(`insert into public.files (path, owner_id, size) values ($1, $2, 10)`, [`${users.alice}/x/${randomUUID()}.pdf`, users.alice], /files_path_check/);
  await rejects(`insert into public.files (path, owner_id, size) values ($1, $2, 20971521)`, [newPath('alice'), users.alice], /files_size_check/);
});

let alicePdfResource;
await test('a PDF resource can reference the student\'s own uploaded file', async () => {
  await as('alice');
  alicePdfResource = await submit({ resource_type: 'pdf', body_md: null, storage_path: alicePdf, title: 'Kinematics PDF worksheet' });
});

await test('a PDF resource cannot reference a file that was never uploaded', async () => {
  await as('alice');
  try { await submit({ resource_type: 'pdf', body_md: null, storage_path: newPath('alice') }); } catch (e) { if (/could not be found/.test(e.message)) return; throw e; }
  throw new Error('expected refusal');
});

let bobPdf;
await test('a PDF resource cannot reference another student\'s file', async () => {
  await as('bob');
  bobPdf = newPath('bob');
  await upload('bob', bobPdf);
  await as('alice');
  // Refused by the trigger (file not in caller's folder) before the CHECK constraint runs; either is correct.
  try { await submit({ resource_type: 'pdf', body_md: null, storage_path: bobPdf }); } catch (e) { if (/storage_path_owned|could not be found/.test(e.message)) return; throw e; }
  throw new Error('expected refusal');
});

// View links are issued only for resources the caller can read under RLS, so
// "who can open a pending PDF" = "who can see the pending resource row".
await test('another student cannot get a link to a pending PDF (resource invisible)', async () => {
  await as('bob');
  eq(await visible(alicePdfResource.id), false, 'resource visible');
  eq((await q(`select path from public.files where path = $1`, [alicePdf])).length, 0, 'file row visible');
});

await test('anonymous visitors cannot get a link to a pending PDF', async () => {
  await as(null);
  eq(await visible(alicePdfResource.id), false, 'resource visible');
  await rejects(`select path from public.files`, [], /permission denied/);
});

await test('the owner can open their own pending PDF and see its file record', async () => {
  await as('alice');
  eq(await visible(alicePdfResource.id), true, 'resource visible');
  eq((await q(`select path from public.files where path = $1`, [alicePdf])).length, 1, 'file row visible');
});

await test('the teacher of the subject can open the pending PDF', async () => {
  await as('teacher');
  eq(await visible(alicePdfResource.id), true, 'resource visible');
});

await test('file records cannot be changed by users (no update grant)', async () => {
  await as('alice');
  await rejects(`update public.files set size = 1 where path = $1`, [alicePdf], /permission denied/);
});

await test('a file in use by a submission cannot be deleted, even by its owner', async () => {
  await as('alice');
  eq(await canDelete(alicePdf), false, 'can delete');
});

describe('Visibility of submissions');

await test('anonymous visitors cannot see pending submissions', async () => {
  await as(null);
  eq(await visible(alicePending.id), false, 'visible');
});

await test('another student cannot see a pending submission', async () => {
  await as('bob');
  eq(await visible(alicePending.id), false, 'visible');
});

await test('the owner can see their pending submission', async () => {
  await as('alice');
  eq(await visible(alicePending.id), true, 'visible');
});

let bobEconomics;
await test('a teacher sees pending work in their subject but not in others', async () => {
  await as('bob');
  bobEconomics = await submit({ subject_id: S.economics, topic_id: T.e2, subtopic_id: T.e25, title: 'Elasticity of demand notes' });
  await as('teacher');
  eq(await visible(alicePending.id), true, 'physics visible');
  eq(await visible(bobEconomics.id), false, 'economics visible');
});

describe('Students cannot moderate');

await test('a student cannot approve their own submission by updating it', async () => {
  await as('alice');
  await rejects(`update public.resources set status = 'approved' where id = $1`, [alicePending.id], /resubmit|row-level security/);
});

await test('a student cannot set approved_by / teacher_reviewed', async () => {
  await as('alice');
  await rejects(`update public.resources set teacher_reviewed = true where id = $1`, [alicePending.id], /Moderation fields/);
});

await test('a student cannot call moderate_resource', async () => {
  await as('alice');
  await rejects(`select public.moderate_resource($1, 'approved')`, [alicePending.id], /Only administrators/);
});

await test('a student cannot write review notes', async () => {
  await as('alice');
  await rejects(`insert into public.resource_reviews (resource_id, kind, body) values ($1, 'note', 'Looks great to me!')`, [alicePending.id], /row-level security/);
});

await test('a student cannot edit someone else\'s submission', async () => {
  await as('bob');
  eq((await q(`update public.resources set title = 'Hijacked title' where id = $1 returning id`, [alicePending.id])).length, 0, 'rows updated');
});

describe('Teachers');

await test('a teacher cannot approve (RPC)', async () => {
  await as('teacher');
  await rejects(`select public.moderate_resource($1, 'approved')`, [alicePending.id], /Only administrators/);
});

await test('a teacher cannot change status directly', async () => {
  await as('teacher');
  await rejects(`update public.resources set status = 'approved' where id = $1`, [alicePending.id], /only change the teacher-reviewed mark/);
});

await test('a teacher can mark a resource in their subject as reviewed; the database records who', async () => {
  await as('teacher');
  const r = await q(`update public.resources set teacher_reviewed = true, teacher_reviewed_by = $2 where id = $1 returning teacher_reviewed, teacher_reviewed_by`, [alicePending.id, users.bob]);
  eq(r[0], { teacher_reviewed: true, teacher_reviewed_by: users.teacher }, 'review stamp');
});

await test('a teacher can add a review note in their subject', async () => {
  await as('teacher');
  const r = await q(`insert into public.resource_reviews (resource_id, kind, body, author_id) values ($1, 'note', 'Check the sign in example 2.', $2) returning author_id`, [alicePending.id, users.bob]);
  eq(r[0].author_id, users.teacher, 'author forced to caller');
});

await test('a teacher cannot add notes outside their subject', async () => {
  await as('teacher');
  await rejects(`insert into public.resource_reviews (resource_id, kind, body) values ($1, 'note', 'Not my subject though.')`, [bobEconomics.id], /row-level security/);
});

await test('a teacher cannot record moderation decisions', async () => {
  await as('teacher');
  await rejects(`insert into public.resource_reviews (resource_id, kind, decision, body) values ($1, 'decision', 'approved', null)`, [alicePending.id], /row-level security/);
});

describe('Admin moderation');

await test('rejecting requires feedback', async () => {
  await as('admin');
  await rejects(`select public.moderate_resource($1, 'rejected', 'no')`, [bobEconomics.id], /Feedback/);
});

await test('an admin can reject with feedback', async () => {
  await as('admin');
  const r = await q(`select (public.moderate_resource($1, 'rejected', 'Please add a diagram for each case.')).status`, [bobEconomics.id]);
  eq(r[0].status, 'rejected', 'status');
});

await test('the contributor sees the feedback; another student does not', async () => {
  await as('bob');
  eq((await q(`select body from public.resource_reviews where resource_id = $1 and kind = 'decision'`, [bobEconomics.id]))[0]?.body, 'Please add a diagram for each case.', 'feedback for owner');
  await as('alice');
  eq((await q(`select body from public.resource_reviews where resource_id = $1`, [bobEconomics.id])).length, 0, 'feedback for others');
});

await test('the contributor can revise a rejected submission, which returns it to pending', async () => {
  await as('bob');
  const r = await q(`update public.resources set description = 'Now with a diagram for each elasticity case.', status = 'pending' where id = $1 returning status`, [bobEconomics.id]);
  eq(r[0]?.status, 'pending', 'status');
});

await test('an admin approves via RPC; approved_by/at are stamped by the database', async () => {
  await as('admin');
  await q(`select public.moderate_resource($1, 'approved')`, [alicePdfResource.id]);
  const r = await q(`select status, approved_by, approved_at is not null as stamped from public.resources where id = $1`, [alicePdfResource.id]);
  eq(r[0], { status: 'approved', approved_by: users.admin, stamped: true }, 'approval');
});

await test('an admin can correct the level tag while approving', async () => {
  await as('admin');
  const r = await q(`select (public.moderate_resource($1, 'approved', null, 'SL')).level`, [alicePending.id]);
  eq(r[0].level, 'SL', 'level');
});

describe('After publication');

await test('anonymous visitors can see approved resources', async () => {
  await as(null);
  eq(await visible(alicePdfResource.id), true, 'visible');
});

await test('anonymous visitors can now read the approved file', async () => {
  await as(null);
  eq(await visible(alicePdfResource.id), true, 'published resource (and so its PDF link) visible');
});

await test('the contributor\'s display name is now public; non-contributors stay hidden', async () => {
  await as(null);
  const names = (await q(`select display_name from public.profiles order by display_name`)).map((r) => r.display_name);
  eq(names, ['Alice B'], 'visible profiles');
});

await test('internal review notes stay private; public notes are visible', async () => {
  await as('admin');
  await q(`insert into public.resource_reviews (resource_id, kind, body, is_public) values ($1, 'note', 'Correction: the graph on page 1 uses m/s, not km/h.', true)`, [alicePdfResource.id]);
  await as(null);
  const rows = await q(`select kind, is_public from public.resource_reviews where resource_id = $1`, [alicePdfResource.id]);
  eq(rows, [{ kind: 'note', is_public: true }], 'public reviews');
});

await test('the owner can no longer edit a published resource', async () => {
  await as('alice');
  eq((await q(`update public.resources set title = 'Changed after approval' where id = $1 returning id`, [alicePdfResource.id])).length, 0, 'rows updated');
});

await test('the owner cannot delete a published resource', async () => {
  await as('alice');
  eq((await q(`delete from public.resources where id = $1 returning id`, [alicePdfResource.id])).length, 0, 'rows deleted');
});

await test('the owner cannot delete the file of a published resource', async () => {
  await as('alice');
  eq(await canDelete(alicePdf), false, 'can delete');
});

await test('an admin can unpublish; the resource and file disappear for the public', async () => {
  await as('admin');
  await q(`select public.moderate_resource($1, 'removed', 'Duplicate of an existing resource.')`, [alicePdfResource.id]);
  await as(null);
  eq(await visible(alicePdfResource.id), false, 'resource visible');
  // No resource visible = the files function issues no link.
  await as('alice');
  eq(await canDelete(alicePdf), false, 'file still protected while the resource exists');
});

await test('the owner can withdraw a pending submission', async () => {
  await as('alice');
  const r = await submit({ title: 'A submission to withdraw' });
  eq((await q(`delete from public.resources where id = $1 returning id`, [r.id])).length, 1, 'rows deleted');
});

describe('Contribution flows used by the website (Phase 5)');
// These mirror services/resources.js step by step: upload, then insert/update, then tidy up files.

const contentUpdate = `update public.resources
  set resource_type = $2, storage_path = $3, body_md = $4, external_url = $5, status = 'pending'
  where id = $1 returning id`;

await test('an admin using the website also submits as pending (no status is sent)', async () => {
  await as('admin');
  const r = await submit({ title: 'Admin submission via the form' });
  eq(r.status, 'pending', 'status');
});

let flowPdf, flowRes;
await test('the owner can replace the PDF of a pending submission and delete the old file', async () => {
  await as('alice');
  flowPdf = newPath('alice');
  await upload('alice', flowPdf);
  flowRes = await submit({ resource_type: 'pdf', body_md: null, storage_path: flowPdf, title: 'Projectile motion worksheet' });
  const replacement = newPath('alice');
  await upload('alice', replacement);
  eq((await q(contentUpdate, [flowRes.id, 'pdf', replacement, null, null])).length, 1, 'rows updated');
  eq(await canDelete(flowPdf), true, 'old file deletable');
  flowPdf = replacement;
});

await test('the owner cannot swap in a file that is not theirs while editing', async () => {
  await as('alice');
  await rejects(contentUpdate, [flowRes.id, 'pdf', bobPdf, null, null], /storage_path_owned|could not be found/);
});

await test('the owner can switch a pending PDF submission to a link, then delete the old file', async () => {
  await as('alice');
  eq((await q(contentUpdate, [flowRes.id, 'link', null, null, 'https://phys.example.org/projectiles'])).length, 1, 'rows updated');
  eq(await canDelete(flowPdf), true, 'old file deletable');
});

await test('withdrawing a pending PDF submission lets the owner delete its file', async () => {
  await as('alice');
  const path = newPath('alice');
  await upload('alice', path);
  const r = await submit({ resource_type: 'pdf', body_md: null, storage_path: path, title: 'A PDF to withdraw' });
  const del = await q(`delete from public.resources where id = $1 returning storage_path`, [r.id]);
  eq(del[0]?.storage_path, path, 'returned path');
  eq(await canDelete(path), true, 'file deletable');
});

await test('another student cannot withdraw someone else\'s submission', async () => {
  await as('bob');
  eq((await q(`delete from public.resources where id = $1 returning id`, [flowRes.id])).length, 0, 'rows deleted');
});

describe('Moderation (Phase 6)');

await test('teacher flags are hidden from the contributor; teacher notes are visible', async () => {
  await as('teacher');
  await q(`insert into public.resource_reviews (resource_id, kind, body) values ($1, 'flag', 'Admins: possible copied textbook page.')`, [flowRes.id]);
  await q(`insert into public.resource_reviews (resource_id, kind, body) values ($1, 'note', 'Nice work. Add units to the final answer.')`, [flowRes.id]);
  await as('alice');
  eq((await q(`select kind from public.resource_reviews where resource_id = $1 order by kind`, [flowRes.id])).map((r) => r.kind), ['note'], 'kinds the contributor sees');
});

await test('admins and the subject teacher still see the flag', async () => {
  for (const who of ['admin', 'teacher']) {
    await as(who);
    eq((await q(`select count(*)::int as n from public.resource_reviews where resource_id = $1 and kind = 'flag'`, [flowRes.id]))[0].n, 1, `${who} flags`);
  }
});

await test('flags and decisions cannot be made public', async () => {
  await as('teacher');
  await rejects(`insert into public.resource_reviews (resource_id, kind, body, is_public) values ($1, 'flag', 'Public flag?', true)`, [flowRes.id], /only_notes_public/);
});

await test('admins can list users with emails and roles', async () => {
  await as('admin');
  const rows = await q(`select email, roles from public.admin_list_users() order by email`);
  eq(rows.find((r) => r.email === 'teacher@example.test')?.roles, ['teacher'], 'teacher roles');
  eq(rows.length, 4, 'users');
});

await test('students and visitors cannot list users', async () => {
  await as('alice');
  await rejects(`select * from public.admin_list_users()`, [], /Only administrators/);
  await as(null);
  await rejects(`select * from public.admin_list_users()`, [], /permission denied/);
});

await test('admins can find files no resource refers to (older than a day only)', async () => {
  await as('alice');
  const old = newPath('alice'); const fresh = newPath('alice');
  await upload('alice', old); await upload('alice', fresh);
  await asOwner();
  await q(`update public.files set created_at = now() - interval '2 days' where path = $1`, [old]);
  await as('admin');
  const names = (await q(`select name from public.admin_orphan_files()`)).map((r) => r.name);
  eq([names.includes(old), names.includes(fresh)], [true, false], 'old listed, fresh not');
  eq(await canDelete(old), true, 'admin may delete orphan');
});

await test('students cannot list orphan files', async () => {
  await as('alice');
  await rejects(`select * from public.admin_orphan_files()`, [], /Only administrators/);
});

describe('Catalog');

await test('anyone can read subjects and topics', async () => {
  await as(null);
  eq((await q(`select count(*)::int as n from public.subjects`))[0].n, registry.subjects.length, 'subjects');
  eq((await q(`select count(*)::int as n from public.topics`))[0].n, jsonTopicCount, 'topics');
});

await test('the database catalog matches the JSON files exactly (codes, parents, levels)', async () => {
  await as(null);
  const rows = await q(`select s.slug, t.code, t.level, p.code as parent from public.topics t
    join public.subjects s on s.id = t.subject_id left join public.topics p on p.id = t.parent_id`);
  const db = new Set(rows.map((r) => `${r.slug}|${r.code}|${r.level}|${r.parent ?? ''}`));
  const missing = jsonTopicKeys.filter((k) => !db.has(k));
  eq(missing, [], 'JSON topics missing or different in the database');
  eq(db.size, jsonTopicKeys.length, 'no extra topics in the database');
});

await test('core components (TOK) refuse HL-tagged resources', async () => {
  await as('alice');
  const tok = await subjectId('theory-of-knowledge');
  const aok = await topicId('theory-of-knowledge', 'AOK');
  try { await submit({ subject_id: tok, topic_id: aok, subtopic_id: null, level: 'HL', title: 'TOK essay planning' }); }
  catch (e) { if (/not offered at level/.test(e.message)) return; throw e; }
  throw new Error('expected refusal');
});

await test('a student can submit to a new subject (Chemistry R1.4, HL-only subtopic, tagged HL)', async () => {
  await as('alice');
  const r = await submit({ subject_id: await subjectId('chemistry'), topic_id: await topicId('chemistry', 'R1'),
    subtopic_id: await topicId('chemistry', 'R1.4'), level: 'HL', title: 'Entropy and Gibbs energy summary' });
  eq(r.status, 'pending', 'status');
});

await test('students cannot change the catalog', async () => {
  await as('alice');
  await rejects(`insert into public.subjects (slug, name, short_name, levels) values ('x-y', 'Xy', 'Xy', '{SL}')`, [], /row-level security/);
  eq((await q(`update public.topics set title = 'Hacked' returning id`)).length, 0, 'topics updated');
});

describe('Trusted administrative context (SQL Editor)');

await test('the database owner can publish directly; approved_at is stamped', async () => {
  await as('bob');
  const r = await submit({ title: 'Published from the SQL editor' });
  await asOwner();
  const out = await q(`update public.resources set status = 'approved' where id = $1 returning status, approved_at is not null as stamped`, [r.id]);
  eq(out[0], { status: 'approved', stamped: true }, 'result');
});

await test('website users still cannot use that path', async () => {
  await as('bob');
  const r = await submit({ title: 'Trying to self-publish again' });
  await rejects(`update public.resources set status = 'approved' where id = $1`, [r.id], /resubmit|row-level security/);
});

/* ------------------------------- Report --------------------------------- */
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
