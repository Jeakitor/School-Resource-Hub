/**
 * Moderation workspace for admins and teachers.
 *
 * Roles (enforced by RLS from Phase 2, never by this page):
 *   admin   — approve / reject with feedback, edit metadata, remove resources, see all subjects
 *   teacher — for their assigned subjects only: add review notes (corrections),
 *             mark "teacher reviewed", flag a resource back for revision
 *
 * Signed-in staff get the live workspace (mountLive, below). ?preview=1 shows the screens
 * with sample data and a role switch; preview actions send nothing.
 * admin.html?id=<resource id> opens a specific item.
 */

import { mountShell, currentUser } from '../components/shell.js';
import { h, $, replaceChildren } from '../utils/dom.js';
import { formatDate, plural } from '../utils/format.js';
import { isPreviewMode, routeUrl, LEVELS, RESOURCE_TYPES, STATUSES } from '../config/site.js';
import { topicLabel } from '../services/catalog.js';
import { listSubmissions, listPublished } from '../services/resources.js';
import { field, textarea, select, setError, segmented, input } from '../components/forms.js';
import { levelChip, reviewedChip } from '../components/resource-row.js';
import { emptyState, errorNotice } from '../components/empty-state.js';
import { getResource } from '../services/resources.js';
import { resourceContent } from '../components/resource-content.js';
import { getParams } from '../utils/url.js';
import {
  listForReview, listReviews, moderate, setTeacherReviewed, addReview, deleteReview,
  listUsers, grantRole, revokeRole, assignSubject, unassignSubject,
  listOrphanFiles, deleteFiles, listSubjectRows, moderationError,
} from '../services/moderation.js';

mountShell({});
const main = $('#main');

const viewer = isPreviewMode() ? null : await currentUser();

if (viewer && (viewer.isAdmin || viewer.isTeacher)) {
  try {
    await mountLive(viewer);
  } catch (err) {
    console.error(err);
    replaceChildren(main, h('div', { class: 'container section' }, errorNotice('The review workspace could not be loaded. Please refresh the page.')));
  }
} else if (!isPreviewMode()) {
  replaceChildren(main, h('div', { class: 'container' }, h('div', { class: 'auth-wrap' },
    h('h1', null, 'Moderation'),
    h('p', null, 'This area is for moderators and subject teachers.'),
    emptyState({
      title: 'You do not have access to this page.',
      body: 'Moderator and teacher access is granted by an administrator. It cannot be requested from here.',
      actions: [{ href: routeUrl('home'), label: 'Back to the homepage' }],
    }))));
} else {
  await mountPreview();
}

async function mountPreview() {
  const PREVIEW_TEACHER_SUBJECTS = ['physics', 'economics'];
  let role = 'admin';
  let tab = 'queue';
  let selectedId = null;

  const [{ items: submissions }, { items: published }] = await Promise.all([listSubmissions(), listPublished()]);
  const view = h('div');

  const inScope = (r) => role === 'admin' || PREVIEW_TEACHER_SUBJECTS.includes(r.subject_slug);

  function render() {
    const pending = submissions.filter((s) => s.status === 'pending' && inScope(s));
    const pub = published.filter(inScope);
    const tabs = [
      ['queue', 'Review queue', pending.length],
      ['published', 'Published', pub.length],
      ...(role === 'admin' ? [['people', 'People & roles', null]] : []),
    ];
    if (!tabs.some(([k]) => k === tab)) tab = 'queue';

    replaceChildren(view,
      h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, label, n]) =>
        h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; selectedId = null; render(); } },
          label, n !== null ? h('span', { class: 'count' }, String(n)) : null))),
      tab === 'queue' ? reviewView(pending)
        : tab === 'published' ? reviewView(pub)
        : peopleView(),
    );
  }

  function reviewView(items) {
    if (!items.length) return emptyState({ title: 'Nothing to review.', body: 'New items will appear here.' });
    const selected = items.find((i) => i.id === selectedId) ?? items[0];
    selectedId = selected.id;
    return h('div', { class: 'review-layout' },
      h('ul', { class: 'queue', 'aria-label': 'Items' }, items.map((s) => h('li', null,
        h('button', { type: 'button', 'aria-current': String(s.id === selectedId), onclick: () => { selectedId = s.id; render(); } },
          h('span', { class: 'queue__title' }, s.title),
          h('span', { class: 'meta' },
            h('span', null, s.subject?.short_name),
            h('span', null, topicLabel(s.subtopic ?? s.topic)),
            h('span', null, formatDate(s.created_at))))))),
      reviewPanel(selected),
    );
  }

  function reviewPanel(s) {
    const status = h('div', { 'aria-live': 'polite' });
    const say = (msg) => replaceChildren(status, h('p', { class: 'notice notice--info', style: 'margin-top: var(--sp-3)' }, msg));
    const note = textarea({ rows: 4, placeholder: role === 'admin' ? 'Explain what needs to change (shown to the contributor)…' : 'Correction or comment for the contributor…' });
    const levelFix = select({ options: Object.entries(LEVELS).map(([v, l]) => ({ value: v, label: l.label })), value: s.level });

    const isPending = s.status === 'pending';
    const adminActions = [
      isPending ? h('button', { class: 'btn btn--primary', type: 'button', onclick: () => say('Would approve and publish. (Not connected yet.)') }, 'Approve & publish') : null,
      isPending ? h('button', { class: 'btn btn--danger', type: 'button', onclick: () => {
        const msg = note.value.trim().length < 10 ? 'Feedback is required when rejecting (at least 10 characters).' : '';
        setError(note, msg);
        if (!msg) say('Would mark as “Needs changes” and send this feedback. (Not connected yet.)');
      } }, 'Request changes') : null,
      !isPending ? h('button', { class: 'btn btn--danger', type: 'button', onclick: () => say('Would unpublish this resource. (Not connected yet.)') }, 'Unpublish') : null,
    ];
    const teacherActions = [
      h('button', { class: 'btn btn--primary', type: 'button', onclick: () => say('Would mark as teacher reviewed. (Not connected yet.)') }, 'Mark as teacher reviewed'),
      h('button', { class: 'btn', type: 'button', onclick: () => {
        const msg = note.value.trim().length < 10 ? 'Write a note of at least 10 characters.' : '';
        setError(note, msg);
        if (!msg) say('Would add this review note for the contributor. (Not connected yet.)');
      } }, 'Add review note'),
      !isPending ? h('button', { class: 'btn btn--danger', type: 'button', onclick: () => say('Would flag for revision and notify the contributor. (Not connected yet.)') }, 'Flag for revision') : null,
    ];

    return h('section', { class: 'review-panel panel', 'aria-label': 'Review' },
      h('span', { class: 'eyebrow' }, s.status ? STATUSES[s.status].label : 'Published'),
      h('h2', null, s.title),
      h('div', { class: 'resource-row__tags', style: 'margin-bottom: var(--sp-4)' },
        levelChip(s.level), s.teacher_reviewed ? reviewedChip() : null),
      h('dl', { class: 'meta-list' },
        h('div', null, h('dt', null, 'Subject'), h('dd', null, s.subject?.name ?? '—')),
        h('div', null, h('dt', null, 'Topic'), h('dd', null, topicLabel(s.topic) || '—')),
        h('div', null, h('dt', null, 'Subtopic'), h('dd', null, topicLabel(s.subtopic) || '—')),
        h('div', null, h('dt', null, 'Type'), h('dd', null, RESOURCE_TYPES[s.resource_type]?.label)),
        h('div', null, h('dt', null, 'Contributor'), h('dd', null, s.contributor_name)),
        h('div', null, h('dt', null, 'Submitted'), h('dd', null, formatDate(s.created_at)))),
      h('p', { class: 'notice', style: 'margin-top: var(--sp-4)' },
        'File preview: submitted PDFs will open here through a short-lived private link.'),
      h('div', { style: 'margin-top: var(--sp-4)' },
        role === 'admin' ? field({ label: 'Level tag', control: levelFix, hint: 'Correct it if the contributor chose the wrong level.' }) : null,
        field({ label: role === 'admin' ? 'Feedback' : 'Review note', control: note, optional: role === 'admin' && !isPending })),
      h('div', { class: 'form-actions' }, role === 'admin' ? adminActions : teacherActions),
      status,
    );
  }

  function peopleView() {
    return h('div', { style: 'max-width: var(--prose)' },
      h('p', { class: 'notice notice--info' },
        'Roles are assigned only by an existing administrator, and are stored in a table students cannot write to. Teachers are linked to the subjects they may review.'),
      h('div', { class: 'table-wrap', style: 'margin-top: var(--sp-4)' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'Role'), h('th', null, 'Can do'))),
        h('tbody', null,
          h('tr', null, h('td', null, 'Student'), h('td', null, 'Browse, submit resources, see own submissions and feedback')),
          h('tr', null, h('td', null, 'Teacher'), h('td', null, 'For assigned subjects: review notes, mark teacher reviewed, flag for revision')),
          h('tr', null, h('td', null, 'Admin'), h('td', null, 'Approve and reject, edit metadata, unpublish, assign roles')))),
      ),
    );
  }

  replaceChildren(main,
    h('header', { class: 'page-head' }, h('div', { class: 'container' },
      h('span', { class: 'eyebrow' }, 'Moderation'),
      h('h1', null, 'Review workspace'),
      h('div', { class: 'role-switch', style: 'margin-top: var(--sp-4)' },
        h('span', null, 'Preview as'),
        segmented({
          label: 'Preview role', value: role,
          options: [{ value: 'admin', label: 'Admin' }, { value: 'teacher', label: 'Teacher (Physics, Economics)' }],
          onChange: (v) => { role = v; selectedId = null; render(); },
        })))),
    h('section', { class: 'section', style: 'padding-top: var(--sp-6)' }, h('div', { class: 'container' }, view)),
  );
  render();
}

/* =============================================================================
   Live workspace (Phase 6)
   Shows only what RLS returns for this user. Buttons are shown per role for
   convenience; the database refuses anything a role may not do.
   ========================================================================== */
async function mountLive(viewer) {
  const isAdmin = viewer.isAdmin;
  const subjectRows = await listSubjectRows();
  const subjectName = new Map(subjectRows.map((s) => [s.id, s.name]));
  const teachesSubject = (id) => viewer.isTeacher && viewer.teacherSubjects.includes(id);

  const TABS = [
    ['queue', 'Review queue', (r) => r.status === 'pending'],
    ['rejected', 'Needs changes', (r) => r.status === 'rejected'],
    ['published', 'Published', (r) => r.status === 'approved'],
    ...(isAdmin ? [
      ['removed', 'Unpublished', (r) => r.status === 'removed'],
      ['people', 'People & roles', null],
      ['files', 'Files', null],
    ] : []),
  ];

  let items = [];
  let tab = 'queue';
  let selectedId = getParams(['id']).id || null;
  let subjectFilter = '';
  const message = h('div', { 'aria-live': 'polite' });
  const view = h('div');

  const say = (text, kind = 'info') => replaceChildren(message,
    h('p', { class: `notice notice--${kind}`, role: kind === 'error' ? 'alert' : 'status', style: 'margin-bottom: var(--sp-4)' }, text));

  /** Run an action with the button disabled; show the result; reload the data. */
  async function act(btn, fn, success) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Working…';
    try {
      await fn();
      say(success);
      await reload();
    } catch (err) {
      console.error(err);
      say(moderationError(err), 'error');
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async function reload() {
    items = await listForReview();
    if (selectedId) {
      const hit = items.find((r) => r.id === selectedId);
      const owner = hit && TABS.find(([, , f]) => f && f(hit));
      if (owner && tab !== 'people' && tab !== 'files') tab = owner[0];
    }
    render();
  }

  function render() {
    const scoped = items.filter((r) => !subjectFilter || String(r.subject_id) === subjectFilter);
    replaceChildren(view,
      h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, label, f]) =>
        h('button', {
          type: 'button', role: 'tab', 'aria-selected': String(tab === k),
          onclick: () => { tab = k; selectedId = null; replaceChildren(message); render(); },
        }, label, f ? h('span', { class: 'count' }, String(scoped.filter(f).length)) : null))),
      tab === 'people' ? peopleView()
        : tab === 'files' ? filesView()
        : reviewView(scoped.filter(TABS.find(([k]) => k === tab)[2])),
    );
  }

  /* ------------------------------ Review lists ------------------------------ */
  function subjectPicker() {
    const ids = [...new Set(items.map((r) => r.subject_id))];
    if (ids.length < 2) return null;
    const sel = select({
      placeholder: 'All subjects',
      options: ids.map((id) => ({ value: String(id), label: subjectName.get(id) ?? String(id) })).sort((a, b) => a.label.localeCompare(b.label)),
      value: subjectFilter,
    });
    sel.addEventListener('change', () => { subjectFilter = sel.value; selectedId = null; render(); });
    return h('div', { class: 'toolbar', style: 'margin-bottom: var(--sp-3)' }, sel);
  }

  function reviewView(list) {
    const empty = {
      queue: ['Nothing waiting for review.', 'New submissions appear here.'],
      rejected: ['Nothing is waiting for changes.', 'Submissions sent back with feedback appear here until the contributor resubmits.'],
      published: ['Nothing published yet.', 'Approved resources appear here.'],
      removed: ['Nothing has been unpublished.', 'Resources taken down appear here.'],
    }[tab];
    if (!list.length) return h('div', null, subjectPicker(), emptyState({ title: empty[0], body: empty[1] }));
    const selected = list.find((i) => i.id === selectedId) ?? list[0];
    selectedId = selected.id;
    return h('div', null, subjectPicker(), h('div', { class: 'review-layout' },
      h('ul', { class: 'queue', 'aria-label': 'Items' }, list.map((s) => h('li', null,
        h('button', { type: 'button', 'aria-current': String(s.id === selectedId), onclick: () => { selectedId = s.id; replaceChildren(message); render(); } },
          h('span', { class: 'queue__title' }, s.title),
          h('span', { class: 'meta' },
            h('span', null, s.subject?.short_name),
            h('span', null, topicLabel(s.subtopic ?? s.topic)),
            h('span', null, s.contributor_name ?? 'Unknown'),
            h('span', null, formatDate(s.created_at))))))),
      livePanel(selected)));
  }

  /* ------------------------------ Review panel ------------------------------ */
  function livePanel(s) {
    const content = h('div', { class: 'review-content' }, h('p', { class: 'field__hint' }, 'Loading content…'));
    const history = h('div', null, h('p', { class: 'field__hint' }, 'Loading…'));

    getResource(s.id).then(async ({ item }) => {
      replaceChildren(content, item ? await resourceContent(item) : errorNotice('The content could not be loaded.'));
    }).catch((err) => { console.error(err); replaceChildren(content, errorNotice('The content could not be loaded.')); });
    loadHistory();

    async function loadHistory() {
      try {
        const reviews = await listReviews(s.id);
        replaceChildren(history, reviews.length ? h('ul', { class: 'history' }, reviews.map(historyItem))
          : h('p', { class: 'field__hint' }, 'No decisions or notes yet.'));
      } catch (err) {
        console.error(err);
        replaceChildren(history, errorNotice('The review history could not be loaded.'));
      }
    }

    function historyItem(rv) {
      const label = rv.kind === 'decision' ? `Decision: ${STATUSES[rv.decision]?.label ?? rv.decision}`
        : rv.kind === 'flag' ? 'Flag · staff only'
        : rv.is_public ? 'Public correction' : 'Note to contributor';
      const canDelete = rv.kind !== 'decision' && (isAdmin || rv.author_id === viewer.id);
      const del = canDelete ? h('button', { class: 'btn btn--sm btn--quiet', type: 'button' }, 'Delete') : null;
      del?.addEventListener('click', async () => {
        del.disabled = true;
        try { await deleteReview(rv.id); await loadHistory(); }
        catch (err) { console.error(err); say(moderationError(err), 'error'); del.disabled = false; }
      });
      return h('li', null,
        h('div', null,
          h('span', { class: ['kind', rv.kind === 'flag' && 'kind--flag'] }, label),
          h('span', { class: 'field__hint' }, `${rv.author_name ?? 'Unknown'} · ${formatDate(rv.created_at)}`),
          del),
        rv.body ? h('p', null, rv.body) : null);
    }

    return h('section', { class: 'review-panel panel', 'aria-label': 'Review' },
      h('span', { class: 'eyebrow' }, STATUSES[s.status]?.label ?? s.status),
      h('h2', null, s.title),
      h('div', { class: 'resource-row__tags', style: 'margin-bottom: var(--sp-4)' },
        levelChip(s.level), s.teacher_reviewed ? reviewedChip() : null,
        ...(s.tags ?? []).map((t) => h('span', { class: 'chip' }, `#${t}`))),
      h('dl', { class: 'meta-list' },
        h('div', null, h('dt', null, 'Subject'), h('dd', null, s.subject?.name ?? '—')),
        h('div', null, h('dt', null, 'Topic'), h('dd', null, topicLabel(s.topic) || '—')),
        h('div', null, h('dt', null, 'Subtopic'), h('dd', null, topicLabel(s.subtopic) || '—')),
        h('div', null, h('dt', null, 'Type'), h('dd', null, RESOURCE_TYPES[s.resource_type]?.label)),
        h('div', null, h('dt', null, 'Contributor'), h('dd', null, s.contributor_name ?? 'Unknown')),
        h('div', null, h('dt', null, 'Submitted'), h('dd', null, formatDate(s.submitted_at))),
        s.approved_at ? h('div', null, h('dt', null, 'Published'), h('dd', null, formatDate(s.approved_at))) : null),
      h('p', { style: 'margin-top: var(--sp-4); color: var(--text-2)' }, s.description),
      h('p', { style: 'margin-top: var(--sp-2)' },
        h('a', { href: routeUrl('resource', { id: s.id }), target: '_blank', rel: 'noopener' }, 'Open the full page ↗')),
      content,
      isAdmin ? adminSection(s) : null,
      teachesSubject(s.subject_id) ? teacherSection(s) : null,
      noteSection(s, loadHistory),
      h('div', { class: 'panel-section' }, h('h3', null, 'History'), history),
    );
  }

  function adminSection(s) {
    const levelFix = select({ options: Object.entries(LEVELS).map(([v, l]) => ({ value: v, label: l.label })), value: s.level });
    const feedback = textarea({ rows: 3, placeholder: 'Shown to the contributor. Required when requesting changes or unpublishing.' });
    const needFeedback = () => {
      const bad = feedback.value.trim().length < 10;
      setError(feedback, bad ? 'Write at least 10 characters for the contributor.' : '');
      if (bad) feedback.focus();
      return !bad;
    };
    const btn = (label, cls, onClick) => {
      const b = h('button', { class: `btn ${cls}`, type: 'button' }, label);
      b.addEventListener('click', () => onClick(b));
      return b;
    };
    const level = () => (levelFix.value !== s.level ? levelFix.value : null);

    let actions = [];
    if (s.status === 'pending' || s.status === 'rejected') {
      actions = [
        btn(s.status === 'pending' ? 'Approve & publish' : 'Approve anyway', 'btn--primary', (b) =>
          act(b, () => moderate(s.id, 'approved', { feedback: feedback.value, level: level() }), `Published “${s.title}”.`)),
        s.status === 'pending' ? btn('Request changes', 'btn--danger', (b) => {
          if (needFeedback()) act(b, () => moderate(s.id, 'rejected', { feedback: feedback.value, level: level() }), `Sent “${s.title}” back to the contributor with your feedback.`);
        }) : null,
      ];
    } else if (s.status === 'approved') {
      actions = [btn('Unpublish', 'btn--danger', (b) => {
        if (needFeedback()) act(b, () => moderate(s.id, 'removed', { feedback: feedback.value }), `Unpublished “${s.title}”. It is no longer visible to the public.`);
      })];
    } else if (s.status === 'removed') {
      actions = [btn('Publish again', 'btn--primary', (b) =>
        act(b, () => moderate(s.id, 'approved', { feedback: feedback.value, level: level() }), `Published “${s.title}” again.`))];
    }

    return h('div', { class: 'panel-section' },
      h('h3', null, 'Decision'),
      s.status === 'rejected' ? h('p', { class: 'field__hint' }, 'Waiting for the contributor to revise. It returns to the review queue when they resubmit.') : null,
      s.status !== 'approved' ? field({ label: 'Level tag', control: levelFix, hint: 'Correct it if the contributor chose the wrong level.' }) : null,
      field({ label: 'Feedback', control: feedback, optional: s.status !== 'approved' && s.status !== 'pending' }),
      h('div', { class: 'form-actions' }, actions));
  }

  function teacherSection(s) {
    const b = h('button', { class: s.teacher_reviewed ? 'btn' : 'btn btn--primary', type: 'button' },
      s.teacher_reviewed ? 'Remove teacher-reviewed mark' : 'Mark as teacher reviewed');
    b.addEventListener('click', () => act(b, () => setTeacherReviewed(s.id, !s.teacher_reviewed),
      s.teacher_reviewed ? 'Removed the teacher-reviewed mark.' : `Marked “${s.title}” as teacher reviewed.`));
    return h('div', { class: 'panel-section' },
      h('h3', null, 'Teacher review'),
      h('p', { class: 'field__hint' }, 'The mark shows on the resource once it is published, and records that you checked it.'),
      h('div', { class: 'form-actions' }, b));
  }

  function noteSection(s, after) {
    const isTeacherHere = teachesSubject(s.subject_id);
    if (!isAdmin && !isTeacherHere) return null;
    const body = textarea({ rows: 3, maxlength: 2000, placeholder: 'A correction or suggestion for the contributor…' });
    const kindRadios = [
      ['note', 'Note to the contributor', 'They see it in their account.'],
      ...(isTeacherHere ? [['flag', 'Flag for administrators', 'Staff only. The contributor never sees flags.']] : []),
    ].map(([value, title, desc], i) => h('label', { class: 'choice' },
      h('input', { type: 'radio', name: `kind-${s.id}`, value, checked: i === 0 }),
      h('span', { class: 'choice__title' }, title), h('span', { class: 'choice__desc' }, desc)));
    const pub = h('input', { type: 'checkbox' });
    const pubLabel = h('label', { class: 'inline-check', style: 'margin-top: var(--sp-2)' }, pub,
      h('span', null, 'Also show it on the public resource page as a correction (once published)'));
    const kind = () => kindRadios.map((l) => l.querySelector('input')).find((i) => i.checked).value;
    kindRadios.forEach((l) => l.querySelector('input').addEventListener('change', () => {
      pubLabel.hidden = kind() !== 'note';
    }));

    const add = h('button', { class: 'btn', type: 'button' }, 'Add');
    add.addEventListener('click', async () => {
      const text = body.value.trim();
      setError(body, text.length < 10 ? 'Write at least 10 characters.' : '');
      if (text.length < 10) return;
      add.disabled = true;
      try {
        await addReview(s.id, { kind: kind(), body: text, isPublic: pub.checked });
        body.value = ''; pub.checked = false;
        say(kind() === 'flag' ? 'Flag added. Administrators will see it here.' : 'Note added. The contributor can see it in their account.');
        await after();
      } catch (err) {
        console.error(err);
        say(moderationError(err), 'error');
      } finally {
        add.disabled = false;
      }
    });

    return h('div', { class: 'panel-section' },
      h('h3', null, 'Add a note'),
      kindRadios.length > 1 ? h('fieldset', { class: 'choice-group', style: 'margin: var(--sp-2) 0 var(--sp-3)' },
        h('legend', { class: 'visually-hidden' }, 'Note type'), kindRadios) : null,
      field({ label: 'Note', control: body }),
      pubLabel,
      h('div', { class: 'form-actions' }, add));
  }

  /* ----------------------------- People & roles ----------------------------- */
  function peopleView() {
    const wrap = h('div', null, h('p', { class: 'field__hint' }, 'Loading people…'));
    const search = input({ type: 'search', placeholder: 'Filter by name or email…', autocomplete: 'off' });
    let users = [];

    async function load() {
      try {
        users = await listUsers();
        draw();
      } catch (err) {
        console.error(err);
        replaceChildren(wrap, errorNotice(moderationError(err)));
      }
    }

    async function change(btn, fn, success) {
      btn.disabled = true;
      try { await fn(); say(success); await load(); }
      catch (err) { console.error(err); say(moderationError(err), 'error'); draw(); } // redraw restores the controls
    }

    function roleButton(u, role, label) {
      const has = u.roles.includes(role);
      const b = h('button', { class: 'btn btn--sm', type: 'button', 'aria-pressed': String(has) }, has ? `✓ ${label}` : label);
      b.addEventListener('click', () => {
        if (has && role === 'admin' && u.id === viewer.id) {
          // Two-step confirmation for removing your own admin access.
          b.textContent = 'Click again to remove your own admin access';
          b.classList.add('btn--danger');
          b.addEventListener('click', () => change(b, () => revokeRole(u.id, role), 'You are no longer an administrator.'), { once: true });
          return;
        }
        change(b, () => (has ? revokeRole(u.id, role) : grantRole(u.id, role)),
          `${has ? 'Removed' : 'Gave'} ${label.toLowerCase()} access ${has ? 'from' : 'to'} ${u.display_name}.`);
      }, { once: true });
      return b;
    }

    function subjectsBox(u) {
      if (!u.roles.includes('teacher')) return null;
      return h('div', { class: 'subjects' },
        h('span', { class: 'field__hint' }, u.teacher_subjects.length ? 'Reviews these subjects:' : 'No subjects assigned yet. Choose the subjects this teacher reviews:'),
        h('div', { class: 'check-grid' }, subjectRows.map((s) => {
          const box = h('input', { type: 'checkbox', checked: u.teacher_subjects.includes(s.id) });
          box.addEventListener('change', () => change(box,
            () => (box.checked ? assignSubject(u.id, s.id) : unassignSubject(u.id, s.id)),
            `${box.checked ? 'Assigned' : 'Unassigned'} ${s.short_name} ${box.checked ? 'to' : 'from'} ${u.display_name}.`));
          return h('label', null, box, h('span', null, s.short_name));
        })));
    }

    function draw() {
      const term = search.value.trim().toLowerCase();
      const shown = users.filter((u) => !term || `${u.display_name} ${u.email}`.toLowerCase().includes(term));
      replaceChildren(wrap,
        h('p', { class: 'notice notice--info', style: 'margin-bottom: var(--sp-4)' },
          'Everyone starts as a student. Teachers review only the subjects you assign them. Admins can approve, reject and manage roles. The database refuses these changes from anyone who is not an admin.'),
        h('div', { class: 'toolbar', style: 'margin-bottom: var(--sp-3)' }, search),
        h('p', { class: 'field__hint', style: 'margin-bottom: var(--sp-2)' }, `${shown.length} of ${users.length} people`),
        h('ul', { class: 'people-list' }, shown.map((u) => h('li', null,
          h('div', { class: 'who' }, u.display_name, u.id === viewer.id ? ' (you)' : '',
            h('small', null, u.email ?? ''), h('small', null, `Joined ${formatDate(u.joined)}`)),
          h('div', { class: 'roles' }, roleButton(u, 'teacher', 'Teacher'), roleButton(u, 'admin', 'Admin')),
          subjectsBox(u)))));
      search.focus();
    }
    search.addEventListener('input', () => draw());

    load();
    return wrap;
  }

  /* ---------------------------------- Files ---------------------------------- */
  function filesView() {
    const wrap = h('div', null, h('p', { class: 'field__hint' }, 'Checking for leftover files…'));
    (async () => {
      try {
        const files = await listOrphanFiles();
        const intro = h('p', { class: 'notice notice--info', style: 'margin-bottom: var(--sp-4)' },
          'Uploaded PDFs that no submission refers to, for example when someone closed the page between uploading and saving. They are private. Only files older than a day are listed, so uploads in progress are never shown.');
        if (!files.length) { replaceChildren(wrap, intro, emptyState({ title: 'No leftover files.', body: 'Storage is tidy.' })); return; }
        const delAll = h('button', { class: 'btn btn--danger', type: 'button' }, `Delete ${plural(files.length, 'file')}`);
        delAll.addEventListener('click', () => {
          delAll.textContent = `Click again to permanently delete ${plural(files.length, 'file')}`;
          delAll.addEventListener('click', async () => {
            delAll.disabled = true;
            try {
              const n = await deleteFiles(files.map((f) => f.name));
              say(n === files.length ? `Deleted ${plural(n, 'file')}.` : `Deleted ${n} of ${files.length} files. Refresh to see what is left.`, n === files.length ? 'info' : 'error');
              render();
            } catch (err) { console.error(err); say(moderationError(err), 'error'); delAll.disabled = false; }
          }, { once: true });
        }, { once: true });
        replaceChildren(wrap, intro,
          h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
            h('thead', null, h('tr', null, h('th', null, 'File'), h('th', null, 'Uploaded'))),
            h('tbody', null, files.map((f) => h('tr', null,
              h('td', { style: 'font-family: var(--font-mono); font-size: var(--fs-xs); overflow-wrap: anywhere' }, f.name),
              h('td', null, formatDate(f.created_at))))))),
          h('div', { class: 'form-actions', style: 'margin-top: var(--sp-4)' }, delAll));
      } catch (err) {
        console.error(err);
        replaceChildren(wrap, errorNotice(moderationError(err)));
      }
    })();
    return wrap;
  }

  /* --------------------------------- Mount --------------------------------- */
  const scope = isAdmin ? 'All subjects'
    : viewer.teacherSubjects.map((id) => subjectName.get(id)).filter(Boolean).join(', ') || 'No subjects assigned yet';

  replaceChildren(main,
    h('header', { class: 'page-head' }, h('div', { class: 'container' },
      h('span', { class: 'eyebrow' }, isAdmin ? 'Administrator' : 'Teacher'),
      h('h1', null, 'Review workspace'),
      h('p', null, isAdmin
        ? 'Approve or send back submissions, unpublish resources, and manage who can moderate.'
        : `You review: ${scope}. Add notes for contributors, flag problems for administrators, and mark resources as teacher reviewed.`))),
    h('section', { class: 'section', style: 'padding-top: var(--sp-6)' }, h('div', { class: 'container' }, message, view)),
  );
  await reload();
}
