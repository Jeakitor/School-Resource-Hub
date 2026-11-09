/**
 * Catalog service — subjects and syllabus structure.
 *
 * Source of truth: /data/subjects.json and /data/syllabi/*.json.
 * In Phase 2 these files also seed the Supabase `subjects` and `topics`
 * tables, so codes in the database match the codes used here.
 *
 * Subjects are level-independent. Topics/subtopics carry level 'SL' (core)
 * or 'HL' (HL only); pages filter by the visitor's chosen level.
 */

import { slugify } from '../utils/format.js';

const DATA_ROOT = new URL('../../../data/', import.meta.url);
const cache = new Map();

async function fetchJson(relativePath) {
  if (!cache.has(relativePath)) {
    const request = fetch(new URL(relativePath, DATA_ROOT)).then((res) => {
      if (!res.ok) throw new Error(`Could not load ${relativePath} (HTTP ${res.status})`);
      return res.json();
    });
    cache.set(relativePath, request);
    request.catch(() => cache.delete(relativePath));
  }
  return cache.get(relativePath);
}

export async function listSubjects() {
  const data = await fetchJson('subjects.json');
  return data.subjects;
}

export async function getSubject(slug) {
  const subjects = await listSubjects();
  return subjects.find((s) => s.slug === slug) ?? null;
}

/** IB group names keyed '1'–'6' and 'core'. */
export async function listGroups() {
  const data = await fetchJson('subjects.json');
  return data.groups ?? {};
}

/** "SL · HL", "SL", or "Core" for TOK / EE / CAS. */
export function levelsLabel(subject) {
  if (subject?.kind === 'core') return 'Core';
  return subject?.levels.join(' · ') ?? '';
}

/** "Group 4 · Sciences" or "DP core". */
export function groupLabel(subject) {
  return subject?.kind === 'core' ? subject.ib_group_name : `Group ${subject.ib_group} · ${subject.ib_group_name}`;
}

/** Full syllabus with slugs added. Not filtered by level. */
export async function getSyllabus(subject) {
  const raw = await fetchJson(subject.syllabus_file);
  const topics = raw.topics.map((topic) => ({
    ...topic,
    slug: slugify(`${topic.code} ${topic.title}`),
    subtopics: (topic.subtopics ?? []).map((st) => ({
      ...st,
      slug: slugify(`${st.code} ${st.title}`),
    })),
  }));
  return { ...raw, topics };
}

/** Is a syllabus item visible for a level filter ('' = all, 'SL' = hide HL-only, 'HL' = all)? */
export function visibleAtLevel(item, level) {
  return level !== 'SL' || item.level !== 'HL';
}

/** Count topics + subtopics across all subjects (real numbers for the homepage). */
export async function syllabusTotals() {
  const subjects = await listSubjects();
  const syllabi = await Promise.all(subjects.map(getSyllabus));
  let topics = 0;
  let subtopics = 0;
  for (const s of syllabi) {
    topics += s.topics.length;
    subtopics += s.topics.reduce((n, t) => n + t.subtopics.length, 0);
  }
  return { subjects: subjects.length, topics, subtopics };
}

/** Find topic/subtopic records for a resource's codes. */
export async function resolveTopic(subject, topicCode, subtopicCode) {
  if (!subject) return { topic: null, subtopic: null };
  const { topics } = await getSyllabus(subject);
  const topic = topics.find((t) => t.code === topicCode) ?? null;
  const subtopic = topic?.subtopics.find((s) => s.code === subtopicCode) ?? null;
  return { topic, subtopic };
}

/** "A.1 Kinematics" */
export function topicLabel(item) {
  return item ? `${item.code} ${item.title}` : '';
}
