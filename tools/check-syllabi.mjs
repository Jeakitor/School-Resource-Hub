#!/usr/bin/env node
/**
 * Consistency checks for data/subjects.json, data/syllabi/*.json and the preview data.
 *
 *   node tools/check-syllabi.mjs
 *
 * It checks STRUCTURE, not content: it can't tell whether a title matches the
 * official IB guide (that is the human verification step, docs/syllabus.md). It
 * catches the mistakes that break the site or the database:
 *   - duplicate / malformed slugs, codes, badges; values the database would reject
 *   - subtopics whose code doesn't belong to their topic (e.g. "3.1" under topic "2")
 *   - HL-only content in a subject not offered at HL; SL subtopics under an HL-only topic
 *   - core components (TOK, EE, CAS) with levels
 *   - preview resources pointing at topics that don't exist
 *   - topics already seeded into the database that are missing from the JSON
 *     (the seed never deletes, so they would linger in the database)
 * Exit code 1 if any ERROR; warnings are printed but don't fail.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
// Strip a UTF-8 byte-order mark (some Windows editors add one; browsers ignore it too).
const json = (p) => JSON.parse(readFileSync(root(p), 'utf8').replace(/^﻿/, ''));

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

const LEVELS = new Set(['SL', 'HL']);
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const registry = json('data/subjects.json');
const subjects = registry.subjects;
const groups = registry.groups ?? {};

/* ------------------------------- Registry ------------------------------- */
const seen = { slug: new Set(), abbr: new Set(), name: new Set() };
for (const s of subjects) {
  const at = `subjects.json › ${s.slug ?? '(no slug)'}`;
  if (!SLUG_RE.test(s.slug ?? '')) err(at, 'slug must be lower-case words joined by hyphens');
  for (const k of ['slug', 'abbr', 'name']) {
    if (seen[k].has(s[k])) err(at, `duplicate ${k} "${s[k]}"`);
    seen[k].add(s[k]);
  }
  if (!(s.name?.length >= 2 && s.name.length <= 120)) err(at, 'name must be 2–120 characters (database limit)');
  if (!(s.short_name?.length >= 2 && s.short_name.length <= 60)) err(at, 'short_name must be 2–60 characters (database limit)');
  if (!/^[A-Za-z]{1,3}$/.test(s.abbr ?? '')) err(at, 'abbr (picker badge) must be 1–3 letters');
  if (!s.glyph) err(at, 'glyph missing');
  if (!Array.isArray(s.levels) || !s.levels.length || s.levels.length > 2 || !s.levels.every((l) => LEVELS.has(l))) {
    err(at, 'levels must be ["SL"], ["HL"] or ["SL","HL"]');
  }
  if (s.kind === 'core') {
    if (s.ib_group !== null) err(at, 'core components have ib_group null');
    if (JSON.stringify(s.levels) !== '["SL"]') err(at, 'core components are stored as ["SL"] (for all students)');
    if (s.ib_group_name !== groups.core) err(at, `ib_group_name should be "${groups.core}"`);
  } else {
    if (!(Number.isInteger(s.ib_group) && s.ib_group >= 1 && s.ib_group <= 6)) err(at, 'ib_group must be 1–6');
    else if (groups[s.ib_group] && s.ib_group_name !== groups[s.ib_group]) err(at, `ib_group_name should be "${groups[s.ib_group]}"`);
  }
  if (!s.syllabus_file || !existsSync(root(`data/${s.syllabus_file}`))) err(at, `syllabus file ${s.syllabus_file} not found`);
}

/* ------------------------------- Syllabi -------------------------------- */
const codesBySubject = new Map();

/** Does a subtopic code belong to its topic? "2.3" ⊂ "2", "A1.1" ⊂ "A", "HL.a" ⊂ "HL", but "10.1" ⊄ "1". */
function belongs(sub, top) {
  if (!sub.startsWith(top) || sub === top) return false;
  const next = sub[top.length];
  return next === '.' || (/[A-Za-z]$/.test(top) && /\d/.test(next));
}

for (const s of subjects) {
  const file = `data/${s.syllabus_file}`;
  if (!existsSync(root(file))) continue;
  let syl;
  try { syl = json(file); } catch (e) { err(file, `invalid JSON: ${e.message}`); continue; }
  const at = file.replace('data/', '');

  if (syl.subject_slug !== s.slug) err(at, `subject_slug "${syl.subject_slug}" should be "${s.slug}"`);
  if (!syl.guide?.title) err(at, 'guide.title missing');
  const fa = syl.guide?.first_assessment;
  if (fa === null) { if (!syl.guide?.note) err(at, 'guide.note must explain a missing first_assessment'); }
  else if (!(Number.isInteger(fa) && fa >= 2014 && fa <= 2027)) err(at, `guide.first_assessment ${fa} can't apply to the May 2027 session`);
  if (!['unverified', 'verified'].includes(syl.review?.status)) err(at, 'review.status must be unverified or verified');
  if (syl.review?.status === 'verified' && !(syl.review.verified_by && syl.review.verified_on)) err(at, 'verified maps need verified_by and verified_on');
  if (!Array.isArray(syl.topics) || !syl.topics.length) { err(at, 'no topics'); continue; }

  const codes = new Map(); // code -> 'topic' | parent code
  const offersHL = s.levels.includes('HL');
  for (const t of syl.topics) {
    const tAt = `${at} › ${t.code}`;
    for (const item of [t, ...(t.subtopics ?? [])]) {
      const iAt = item === t ? tAt : `${tAt} › ${item.code}`;
      if (!(typeof item.code === 'string' && item.code.length >= 1 && item.code.length <= 12)) err(iAt, 'code must be 1–12 characters');
      if (!(typeof item.title === 'string' && item.title.trim().length >= 1 && item.title.length <= 200)) err(iAt, 'title must be 1–200 characters');
      if (item.title !== item.title?.trim()) err(iAt, 'title has leading/trailing spaces');
      if (!LEVELS.has(item.level)) err(iAt, `level "${item.level}" must be SL or HL`);
      if (item.level === 'HL' && !offersHL) err(iAt, `HL-only content, but ${s.name} is not offered at HL`);
      if (codes.has(item.code)) err(iAt, `duplicate code "${item.code}"`);
      codes.set(item.code, item === t ? null : t.code);
    }
    const subs = t.subtopics ?? [];
    if (!Array.isArray(t.subtopics)) err(tAt, 'subtopics must be an array (use [] when none)');
    const titles = new Set();
    for (const st of subs) {
      if (!belongs(st.code, t.code)) err(`${tAt} › ${st.code}`, `subtopic code doesn't belong to topic "${t.code}"`);
      if (t.level === 'HL' && st.level !== 'HL') err(`${tAt} › ${st.code}`, 'SL subtopic under an HL-only topic');
      if (titles.has(st.title)) warn(`${tAt} › ${st.code}`, `duplicate title "${st.title}" in this topic`);
      titles.add(st.title);
    }
    if (subs.length && subs.every((st) => st.level === 'HL') && t.level !== 'HL') {
      warn(tAt, 'every subtopic is HL-only; should the topic itself be HL?');
    }
    if (!subs.length && !syl.subtopics_pending && !syl.categories_not_syllabus) {
      warn(tAt, 'no subtopics (fine for themes without numbered subtopics)');
    }
  }
  if (syl.review?.status !== 'verified') warn(at, 'awaiting verification against the official guide');
  codesBySubject.set(s.slug, codes);
}

/* ---------------------------- Preview data ------------------------------ */
const preview = json('data/preview/resources.json');
for (const r of [...(preview.resources ?? []), ...(preview.submissions ?? [])]) {
  const at = `preview › ${r.id}`;
  const codes = codesBySubject.get(r.subject_slug);
  if (!codes) { err(at, `unknown subject "${r.subject_slug}"`); continue; }
  if (!codes.has(r.topic_code) || codes.get(r.topic_code) !== null) err(at, `"${r.topic_code}" is not a topic of ${r.subject_slug}`);
  if (r.subtopic_code && codes.get(r.subtopic_code) !== r.topic_code) err(at, `"${r.subtopic_code}" is not a subtopic of ${r.topic_code}`);
}

/* ---------------- Codes already in the database (seed files) ------------ */
// The seed never deletes, so a code removed from the JSON would linger in the database.
const migDir = root('supabase/migrations/');
for (const f of readdirSync(migDir).filter((n) => /seed/.test(n) && n.endsWith('.sql'))) {
  const sql = readFileSync(migDir + f, 'utf8');
  for (const stmt of sql.split('insert into public.topics').slice(1)) {
    const code = stmt.match(/select s\.id, (?:null|p\.id), '((?:[^']|'')*)'/)?.[1]?.replace(/''/g, "'");
    const slug = stmt.match(/where s\.slug = '([^']+)'/)?.[1];
    // Subjects whose file failed to load are already reported above.
    if (code && slug && codesBySubject.has(slug) && !codesBySubject.get(slug).has(code)) {
      err(`${f} › ${slug} › ${code}`, 'seeded into the database but missing from the JSON (renaming a code needs a deliberate migration)');
    }
  }
}

/* -------------------------------- Report -------------------------------- */
const total = [...codesBySubject.values()].reduce((n, m) => n + m.size, 0);
console.log(`Checked ${subjects.length} subjects, ${total} topics and subtopics.`);
if (warnings.length) console.log(`\n${warnings.length} warning(s):\n` + warnings.map((w) => `  · ${w}`).join('\n'));
if (errors.length) {
  console.log(`\n${errors.length} ERROR(S):\n` + errors.map((e) => `  ✗ ${e}`).join('\n'));
  process.exit(1);
}
console.log('\nNo errors.');
