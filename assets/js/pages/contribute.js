/**
 * Contribution form. One page, four short sections, no technical knowledge needed.
 *
 * - Signed in: submits for real. PDFs are uploaded to the private bucket first, then a
 *   pending row is inserted (services/resources.js).
 * - ?edit=<id>: revise your own pending / rejected submission; it goes back to pending.
 * - ?preview=1: checks the form but sends nothing.
 *
 * Client validation is for helpfulness only; the database and storage policies re-check everything.
 */

import { mountShell, currentUser } from '../components/shell.js';
import { h, $, replaceChildren } from '../utils/dom.js';
import { plural } from '../utils/format.js';
import { getParams } from '../utils/url.js';
import { RESOURCE_TYPES, LEVELS, LIMITS, STATUSES, routeUrl, isPreviewMode, ROUTES } from '../config/site.js';
import { listSubjects, listGroups, getSyllabus, topicLabel } from '../services/catalog.js';
import { enhanceSubjectSelect } from '../components/subject-picker.js';
import { submitResource, updateSubmission, getMySubmission, submissionError } from '../services/resources.js';
import { field, setError, input, textarea, select, setOptions } from '../components/forms.js';
import { emptyState, errorNotice } from '../components/empty-state.js';

mountShell({ active: 'contribute' });
const main = $('#main');
const pre = getParams(['subject', 'topic', 'subtopic', 'edit']);
const preview = isPreviewMode();
const subjects = await listSubjects();
let syllabus = null;

const user = preview ? null : await currentUser().catch(() => null);

/* --------------------------- Edit mode lookup --------------------------- */
let editing = null;
let editProblem = '';
if (!preview && user && pre.edit) {
  try {
    editing = await getMySubmission(pre.edit);
    if (!editing) editProblem = 'This submission was not found. It may have been withdrawn.';
    else if (!editing.editable) editProblem = 'This resource is published, so it can only be changed by a moderator. You can submit a corrected version as a new resource.';
  } catch (err) {
    console.error(err);
    editProblem = submissionError(err);
  }
  if (editProblem) editing = null;
}

/* ----------------------------- Controls -------------------------------- */
const title = input({ name: 'title', maxlength: LIMITS.titleMax, required: true, placeholder: 'e.g. Elasticity of demand: one-page summary' });
const description = textarea({ name: 'description', maxlength: LIMITS.descriptionMax, rows: 4, required: true, placeholder: 'What does it cover, and who is it useful for?' });
const subjectSel = select({ name: 'subject', placeholder: 'Choose a subject', required: true, options: subjects.map((s) => ({ value: s.slug, label: s.name })), value: editing?.subject_slug ?? pre.subject });
const topicSel = select({ name: 'topic', placeholder: 'Choose a subject first', disabled: true, required: true });
const subtopicSel = select({ name: 'subtopic', placeholder: '—', disabled: true });
const levelHint = h('p', { class: 'field__hint', 'aria-live': 'polite' });

const levelRadios = Object.entries(LEVELS).map(([value, l]) =>
  h('label', { class: 'choice' },
    h('input', { type: 'radio', name: 'level', value, checked: value === (editing?.level ?? 'SL') }),
    h('span', { class: 'choice__title' }, l.label),
    h('span', { class: 'choice__desc' }, l.description)));
const levelGroup = h('fieldset', { class: 'choice-group', 'aria-describedby': 'level-hint' }, h('legend', { class: 'visually-hidden' }, 'Level'), levelRadios);
levelHint.id = 'level-hint';

const typeRadios = Object.entries(RESOURCE_TYPES).map(([value, t], i) =>
  h('label', { class: 'choice' },
    h('input', { type: 'radio', name: 'type', value, checked: editing ? editing.resource_type === value : i === 0 }),
    h('span', { class: 'choice__title' }, t.label),
    h('span', { class: 'choice__desc' }, t.description)));

const hasExistingPdf = () => Boolean(editing?.resource_type === 'pdf' && editing.storage_path);
const fileInput = h('input', { type: 'file', name: 'file', accept: 'application/pdf,.pdf', id: 'f-file' });
const fileName = h('span', { class: 'dropzone__file' });
const fileErr = h('p', { class: 'field__error', id: 'f-file-err', 'aria-live': 'polite' });
const dropzone = h('label', { class: 'dropzone', for: 'f-file' },
  fileInput,
  h('span', null, hasExistingPdf() ? 'Drop a new PDF here to replace the current one, or ' : 'Drop a PDF here, or ', h('u', null, 'choose a file')),
  h('span', { class: 'field__hint' }, `PDF only · up to ${LIMITS.pdfMaxBytes / 1024 / 1024} MB`),
  fileName);

const notes = textarea({ name: 'notes', rows: 14, maxlength: LIMITS.notesMax, placeholder: 'Write or paste your notes here.\n\nTip: start a line with ## for a heading, - for a bullet point, and wrap words in **double asterisks** for bold. Plain text works fine too.' });
const url = input({ name: 'url', type: 'url', inputmode: 'url', placeholder: 'https://…' });
const tags = input({ name: 'tags', placeholder: 'e.g. diagrams, paper 2, flashcards' });
const agree = h('input', { type: 'checkbox', name: 'agree', id: 'f-agree' });
const agreeErr = h('p', { class: 'field__error', id: 'f-agree-err', 'aria-live': 'polite' });

if (editing) {
  title.value = editing.title;
  description.value = editing.description;
  notes.value = editing.body_md ?? '';
  url.value = editing.external_url ?? '';
  tags.value = (editing.tags ?? []).join(', ');
}

const contentSlots = {
  pdf: h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Upload your PDF'),
    hasExistingPdf() ? h('p', { class: 'field__hint', style: 'margin-bottom: var(--sp-2)' }, 'Your current PDF is kept unless you choose a new one.') : null,
    dropzone, fileErr),
  markdown: field({ label: 'Your notes', control: notes, hint: `At least ${LIMITS.notesMin} characters. Formatting is optional.` }),
  link: field({ label: 'Website address', control: url, hint: 'Must start with https://. Link to the page itself, not a search result.' }),
};
const contentArea = h('div');

const formStatus = h('div', { 'aria-live': 'assertive' });
const submitBtn = h('button', { class: 'btn btn--primary btn--lg', type: 'submit' }, editing ? 'Resubmit for review' : 'Submit for review');

/* ------------------------------- Layout -------------------------------- */
const topNotice = preview
  ? h('p', { class: 'notice notice--info', style: 'margin-bottom: var(--sp-6)' },
    'Preview mode: the form checks your entries, but nothing is sent.')
  : editing?.feedback
    ? h('div', { class: 'feedback', style: 'margin: 0 0 var(--sp-6)' },
      h('strong', null, 'Feedback from the reviewer'), editing.feedback)
    : null;

const form = h('form', { novalidate: true, onsubmit: onSubmit },
  topNotice,

  h('fieldset', { class: 'form-section' },
    h('legend', null, h('span', { class: 'eyebrow' }, 'Step 1'), 'About the resource'),
    field({ label: 'Title', control: title, hint: `${LIMITS.titleMin}–${LIMITS.titleMax} characters. Be specific.` }),
    field({ label: 'Description', control: description, hint: `${LIMITS.descriptionMin}–${LIMITS.descriptionMax} characters.` }),
  ),

  h('fieldset', { class: 'form-section' },
    h('legend', null, h('span', { class: 'eyebrow' }, 'Step 2'), 'Where it fits in the syllabus'),
    field({ label: 'Subject', control: subjectSel }),
    field({ label: 'Topic', control: topicSel }),
    field({ label: 'Subtopic', control: subtopicSel, optional: true, hint: 'Choose one if your resource focuses on a single subtopic.' }),
    h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Level'), levelGroup, levelHint),
  ),

  h('fieldset', { class: 'form-section' },
    h('legend', null, h('span', { class: 'eyebrow' }, 'Step 3'), 'The resource itself'),
    h('fieldset', { class: 'choice-group', style: 'margin-bottom: var(--sp-5)' }, h('legend', { class: 'visually-hidden' }, 'Resource type'), typeRadios),
    contentArea,
  ),

  h('fieldset', { class: 'form-section' },
    h('legend', null, h('span', { class: 'eyebrow' }, 'Step 4'), 'Finish'),
    field({ label: 'Tags', control: tags, optional: true, hint: `Up to ${LIMITS.tagsMax}, separated by commas.` }),
    h('div', { class: 'field' },
      h('label', { for: 'f-agree', style: 'display:flex; gap: var(--sp-3); align-items: baseline; cursor: pointer' },
        agree,
        h('span', null, 'This is my own work, or I have permission to share it. It does not contain IB past papers, markschemes or other copyrighted material.')),
      agreeErr),
    h('div', { class: 'form-actions' },
      submitBtn,
      h('span', { class: 'field__hint' }, 'A moderator reviews every submission.')),
    formStatus,
  ),
);

const formSlot = h('div', null, form);

const aside = h('aside', { class: 'form-page__aside' }, h('div', { class: 'panel' },
  h('h2', null, 'What makes a good resource'),
  h('ul', null,
    h('li', null, 'Focused on one topic or subtopic, rather than a whole course.'),
    h('li', null, 'Accurate, and checked against your class notes or textbook.'),
    h('li', null, 'Your own words. Summaries are great; copied textbook pages are not.'),
    h('li', null, 'Tagged “HL only” if it covers additional higher level content.')),
  h('hr'),
  h('h2', null, 'Not allowed'),
  h('ul', null,
    h('li', null, 'IB past papers or markschemes'),
    h('li', null, 'Other students’ IAs, EEs or graded coursework'),
    h('li', null, 'Scanned textbook pages'))));

const pageHead = (eyebrow, heading, intro) => h('header', { class: 'page-head' }, h('div', { class: 'container' },
  h('span', { class: 'eyebrow' }, eyebrow), h('h1', null, heading), intro ? h('p', null, intro) : null));

if (!preview && !user) {
  replaceChildren(main,
    pageHead('Contribute', 'Share a resource', 'Anyone can browse without an account. To contribute, sign in so you can follow your submission’s review.'),
    h('div', { class: 'container' }, emptyState({
      title: 'Sign in to contribute.',
      body: 'Accounts are free for students and teachers at the school. Every submission is checked by a moderator before it is published.',
      actions: [
        { href: routeUrl('auth', { next: ROUTES.contribute }), label: 'Sign in', primary: true },
        { href: routeUrl('auth', { mode: 'register', next: ROUTES.contribute }), label: 'Create an account' },
      ],
    })));
} else if (editProblem) {
  replaceChildren(main,
    pageHead('Contribute', 'Revise a submission'),
    h('div', { class: 'container' },
      errorNotice(editProblem),
      h('p', { style: 'margin-top: var(--sp-4)' }, h('a', { class: 'btn', href: routeUrl('account') }, 'Back to your submissions'))));
} else {
  replaceChildren(main,
    editing
      ? pageHead('Contribute', 'Revise your submission',
        `Currently: ${STATUSES[editing.status]?.label ?? editing.status}. Saving sends it back to the review queue as “Pending review”.`)
      : pageHead('Contribute', 'Share a resource',
        'Four short steps. A moderator checks every submission before it is published, and you can follow its status from your account.'),
    h('div', { class: 'container form-page' }, formSlot, aside),
  );
  // After mounting, so the picker can take over the field's label.
  enhanceSubjectSelect(subjectSel, subjects, { groups: await listGroups() });
}

/* ------------------------------ Behaviour ------------------------------ */
async function onSubjectChange(keepTopic = '', keepSub = '') {
  const subject = subjects.find((s) => s.slug === subjectSel.value);
  syllabus = subject ? await getSyllabus(subject) : null;
  if (!syllabus) {
    setOptions(topicSel, [], { placeholder: 'Choose a subject first' });
    topicSel.disabled = true;
  } else {
    setOptions(topicSel, syllabus.topics.map((t) => ({ value: t.code, label: topicLabel(t) + (t.level === 'HL' ? ' (HL)' : '') })),
      { placeholder: 'Choose a topic', value: keepTopic });
    topicSel.disabled = false;
  }
  onTopicChange(keepSub);
}

function onTopicChange(keepSub = '') {
  const topic = syllabus?.topics.find((t) => t.code === topicSel.value);
  const subs = topic?.subtopics ?? [];
  setOptions(subtopicSel, subs.map((s) => ({ value: s.code, label: topicLabel(s) + (s.level === 'HL' ? ' (HL)' : '') })),
    { placeholder: subs.length ? 'Whole topic' : 'No subtopics listed', value: keepSub });
  subtopicSel.disabled = !subs.length;
  syncLevel();
}

/** HL-only topics/subtopics force "HL only"; SL-only subjects force "SL & HL". */
function syncLevel() {
  const subject = subjects.find((s) => s.slug === subjectSel.value);
  const topic = syllabus?.topics.find((t) => t.code === topicSel.value);
  const sub = topic?.subtopics.find((s) => s.code === subtopicSel.value);
  const [slRadio, hlRadio] = levelRadios.map((l) => l.querySelector('input'));

  slRadio.disabled = false;
  hlRadio.disabled = false;
  if (subject?.kind === 'core') {
    slRadio.checked = true; hlRadio.disabled = true;
    levelHint.textContent = `${subject.name} is part of the DP core, taken by every student, so there is no HL-only option.`;
  } else if (subject && !subject.levels.includes('HL')) {
    slRadio.checked = true; hlRadio.disabled = true;
    levelHint.textContent = `${subject.name} is only offered at SL.`;
  } else if (sub?.level === 'HL' || topic?.level === 'HL') {
    hlRadio.checked = true; slRadio.disabled = true;
    levelHint.textContent = `${topicLabel(sub?.level === 'HL' ? sub : topic)} is HL-only content, so this is set to “HL only”.`;
  } else {
    levelHint.textContent = 'Choose “HL only” if your resource covers additional higher level material.';
  }
}

function currentType() {
  return typeRadios.map((l) => l.querySelector('input')).find((i) => i.checked).value;
}
function onTypeChange() {
  replaceChildren(contentArea, contentSlots[currentType()]);
}

subjectSel.addEventListener('change', () => onSubjectChange());
topicSel.addEventListener('change', () => onTopicChange());
subtopicSel.addEventListener('change', syncLevel);
typeRadios.forEach((l) => l.querySelector('input').addEventListener('change', onTypeChange));

fileInput.addEventListener('change', () => checkFile());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.dataset.drag = 'true'; });
dropzone.addEventListener('dragleave', () => { dropzone.dataset.drag = 'false'; });
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.dataset.drag = 'false';
  if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; checkFile(); }
});

/**
 * PDF checks: size, declared type, and the file's first bytes ("%PDF-").
 * The extension and MIME type are claims by the browser; the signature reflects the content.
 * Storage re-checks size and type server-side.
 */
async function checkFile() {
  const file = fileInput.files[0];
  fileName.textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : '';
  let msg = '';
  if (!file) msg = hasExistingPdf() ? '' : 'Choose a PDF to upload.';
  else if (file.size > LIMITS.pdfMaxBytes) msg = `This file is larger than ${LIMITS.pdfMaxBytes / 1024 / 1024} MB.`;
  else if (file.size === 0) msg = 'This file is empty.';
  else if (file.type && file.type !== 'application/pdf') msg = 'Only PDF files can be uploaded.';
  else {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...head) !== '%PDF-') msg = 'This file does not appear to be a valid PDF.';
  }
  fileErr.textContent = msg;
  return !msg;
}

function parseTags() {
  return [...new Set(tags.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

async function validate() {
  const errors = [];
  const check = (control, msg) => { setError(control, msg); if (msg) errors.push(control); };

  const t = title.value.trim();
  check(title, t.length < LIMITS.titleMin ? `Add a title of at least ${LIMITS.titleMin} characters.` : '');
  const d = description.value.trim();
  check(description, d.length < LIMITS.descriptionMin ? `Add a description of at least ${LIMITS.descriptionMin} characters.` : '');
  check(subjectSel, subjectSel.value ? '' : 'Choose a subject.');
  check(topicSel, !subjectSel.value || topicSel.value ? '' : 'Choose a topic.');

  const type = currentType();
  if (type === 'pdf' && !(await checkFile())) errors.push(fileInput);
  if (type === 'markdown') {
    check(notes, notes.value.trim().length < LIMITS.notesMin ? `Notes need at least ${LIMITS.notesMin} characters (currently ${notes.value.trim().length}).` : '');
  }
  if (type === 'link') {
    let ok = false;
    try { ok = new URL(url.value.trim()).protocol === 'https:'; } catch { ok = false; }
    check(url, ok ? '' : 'Enter a full web address starting with https://');
  }

  const tagList = parseTags();
  check(tags, tagList.length > LIMITS.tagsMax ? `Use at most ${LIMITS.tagsMax} tags.`
    : tagList.some((x) => x.length > LIMITS.tagMaxLength) ? `Each tag must be under ${LIMITS.tagMaxLength} characters.` : '');

  agreeErr.textContent = agree.checked ? '' : 'Please confirm you have the right to share this.';
  if (!agree.checked) errors.push(agree);

  return errors;
}

function showError(text) {
  replaceChildren(formStatus, h('p', { class: 'notice notice--error', role: 'alert', style: 'margin-top: var(--sp-4)' }, text));
}

let busy = false;
async function onSubmit(e) {
  e.preventDefault();
  if (busy) return;
  const errors = await validate();
  if (errors.length) {
    showError(`Please fix ${plural(errors.length, 'problem')} above.`);
    errors[0].focus();
    return;
  }
  const subject = subjects.find((s) => s.slug === subjectSel.value);
  const topic = syllabus.topics.find((x) => x.code === topicSel.value);
  const sub = topic.subtopics.find((x) => x.code === subtopicSel.value);
  const level = levelRadios.map((l) => l.querySelector('input')).find((i) => i.checked).value;
  const type = currentType();

  if (preview) {
    replaceChildren(formStatus, h('div', { class: 'panel summary-box', role: 'status' },
      h('span', { class: 'eyebrow' }, 'Everything checks out'),
      h('p', null, `“${title.value.trim()}” · ${subject.name} · ${topicLabel(sub ?? topic)} · ${LEVELS[level].label} · ${RESOURCE_TYPES[type].label}`),
      h('p', { class: 'field__hint', style: 'margin-top: var(--sp-2)' }, 'Preview mode: nothing was sent.')));
    return;
  }

  const draft = {
    title: title.value, description: description.value,
    subject: subject.slug, topic: topic.code, subtopic: sub?.code ?? null,
    level, type, notes: notes.value, url: url.value, tags: parseTags(),
    file: type === 'pdf' ? fileInput.files[0] ?? null : null,
  };

  busy = true;
  submitBtn.disabled = true;
  const label = submitBtn.textContent;
  const onStep = (step) => {
    submitBtn.textContent = step === 'upload' ? 'Uploading PDF…' : 'Saving…';
    replaceChildren(formStatus, h('p', { class: 'field__hint', role: 'status', style: 'margin-top: var(--sp-3)' },
      step === 'upload' ? 'Uploading your PDF. Larger files can take a minute; please keep this page open.' : 'Saving your submission…'));
  };

  try {
    const id = editing ? await updateSubmission(editing, draft, onStep) : await submitResource(draft, onStep);
    showSuccess(id, draft.title.trim());
  } catch (err) {
    console.error(err);
    showError(submissionError(err));
    submitBtn.textContent = label;
    submitBtn.disabled = false;
    busy = false;
  }
}

function showSuccess(id, name) {
  replaceChildren(formSlot, h('div', { class: 'panel', role: 'status' },
    h('span', { class: 'eyebrow' }, editing ? 'Resubmitted' : 'Submitted'),
    h('h2', { style: 'margin-top: var(--sp-2)' }, `“${name}” is waiting for review.`),
    h('p', { style: 'margin-top: var(--sp-3)' },
      'A moderator will check it before it appears in the library. You can follow its status, and edit or withdraw it while it waits, from your account.'),
    h('div', { class: 'form-actions', style: 'margin-top: var(--sp-5)' },
      h('a', { class: 'btn btn--primary', href: routeUrl('account') }, 'Go to your submissions'),
      h('a', { class: 'btn', href: routeUrl('resource', { id }) }, 'View it'),
      editing ? null : h('a', { class: 'btn btn--quiet', href: routeUrl('contribute') }, 'Submit another'))));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

await onSubjectChange(editing?.topic_code ?? pre.topic, editing?.subtopic_code ?? pre.subtopic);
if (editing) {
  // syncLevel may have forced a level; otherwise restore the saved one.
  const saved = levelRadios.map((l) => l.querySelector('input')).find((i) => i.value === editing.level);
  if (saved && !saved.disabled) saved.checked = true;
}
onTypeChange();
