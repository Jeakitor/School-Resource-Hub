/**
 * Account: profile summary and the user's own submissions with status + feedback.
 * Signed in: live profile and submissions from Supabase (RLS shows only your own).
 * ?preview=1 shows sample submissions.
 */

import { mountShell, currentUser } from '../components/shell.js';
import { updateDisplayName, friendlyError } from '../services/auth.js';
import { formatDate, plural } from '../utils/format.js';
import { field, input, setError } from '../components/forms.js';
import { h, $, $$, replaceChildren } from '../utils/dom.js';
import { routeUrl, isPreviewMode, STATUSES } from '../config/site.js';
import { listMySubmissions, withdrawSubmission, submissionError } from '../services/resources.js';
import { resourceRow } from '../components/resource-row.js';
import { emptyState, errorNotice } from '../components/empty-state.js';

mountShell({});
const main = $('#main');
const preview = isPreviewMode();

const user = preview ? null : await currentUser();

if (preview) {
  const { items } = await listMySubmissions();
  renderPage({
    name: 'Preview contributor',
    profile: [['Display name', 'Preview contributor'], ['Role', 'Student'], ['Submissions', plural(items.length, 'resource')]],
    extra: null,
    submissions: submissionsSection(items, { live: false }),
  });
} else if (user) {
  renderLive(user);
} else {
  replaceChildren(main, h('div', { class: 'container' }, h('div', { class: 'auth-wrap' },
    h('h1', null, 'Your account'),
    h('p', null, 'Sign in to see your profile and follow the status of everything you have submitted.'),
    emptyState({
      title: 'You are not signed in.',
      body: 'Browsing never needs an account. You only need one to contribute.',
      actions: [
        { href: routeUrl('auth'), label: 'Sign in', primary: true },
        { href: routeUrl('auth', { mode: 'register' }), label: 'Create an account' },
      ],
    }),
  )));
}

/* ------------------------------ Page layout ------------------------------ */
function renderPage({ name, profile, extra, submissions }) {
  replaceChildren(main,
    h('header', { class: 'page-head' }, h('div', { class: 'container' },
      h('span', { class: 'eyebrow' }, 'Account'),
      h('h1', null, name))),
    h('div', { class: 'container account-grid' },
      h('aside', null, h('div', { class: 'panel' },
        h('span', { class: 'eyebrow' }, 'Profile'),
        h('dl', { class: 'meta-list' },
          profile.map(([dt, dd, style]) => h('div', null, h('dt', null, dt), h('dd', style ? { style } : null, dd)))),
        extra,
        h('div', { class: 'form-actions', style: 'margin-top: var(--sp-4)' },
          h('a', { class: 'btn btn--sm btn--quiet', href: routeUrl('auth', { mode: 'update' }) }, 'Change password')))),
      h('section', { 'aria-labelledby': 'subs-title' },
        h('div', { class: 'section-head', style: 'margin-bottom: var(--sp-4)' },
          h('h2', { id: 'subs-title' }, 'Your submissions'),
          h('a', { class: 'btn btn--primary', href: routeUrl('contribute') }, 'New submission')),
        submissions)),
  );
}

/* ---------------------------- Submissions list ---------------------------- */
/**
 * Tabs by status + rows. In live mode, pending / rejected rows get Edit and Withdraw;
 * the database is what actually allows or refuses those actions.
 */
function submissionsSection(initial, { live }) {
  let items = initial;
  let filter = '';
  const wrap = h('div');
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const list = h('div');
  const status = h('div', { 'aria-live': 'polite' });

  if (!items.length) {
    return emptyState({
      title: 'You have not submitted anything yet.',
      body: 'Share notes, a PDF or a useful link. Each submission appears here with its review status and any feedback.',
      actions: [{ href: routeUrl('contribute'), label: 'Contribute a resource', primary: true }],
    });
  }

  /*
   * Two-step inline confirmation instead of window.confirm(): some embedded browsers
   * (including in-app previews) silently answer "Cancel" to confirm(), so nothing happened.
   */
  function askWithdraw(r, actions, btn) {
    const yes = h('button', { class: 'btn btn--sm btn--danger', type: 'button' }, 'Yes, withdraw');
    const no = h('button', { class: 'btn btn--sm btn--quiet', type: 'button' }, 'Cancel');
    const prompt = h('span', { class: 'field__hint' }, 'Delete this submission and its file? This cannot be undone.');
    const original = [...actions.childNodes];
    replaceChildren(actions, prompt, yes, no);
    no.addEventListener('click', () => replaceChildren(actions, ...original));
    yes.addEventListener('click', () => withdraw(r, yes, no));
    yes.focus();
  }

  async function withdraw(r, yes, no) {
    yes.disabled = true; no.disabled = true;
    yes.textContent = 'Withdrawing…';
    try {
      const { fileRemoved } = await withdrawSubmission(r.id);
      items = items.filter((x) => x.id !== r.id);
      replaceChildren(status, h('p', { class: 'notice notice--info', style: 'margin-bottom: var(--sp-4)' },
        fileRemoved ? `Withdrew “${r.title}”.`
          : `Withdrew “${r.title}”, but its file could not be deleted. It stays private (only you and admins can see it); an admin can remove it.`));
      render();
    } catch (err) {
      console.error(err);
      replaceChildren(status, errorNotice(submissionError(err)));
      yes.disabled = false; no.disabled = false;
      yes.textContent = 'Yes, withdraw';
    }
    status.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function row(r) {
    const editable = r.status === 'pending' || r.status === 'rejected';
    const href = live ? routeUrl('resource', { id: r.id }) : (r.status === 'approved' ? routeUrl('resource', { id: 'preview-1' }) : false);
    const el = resourceRow(r, { status: true, href });

    if (r.feedback) {
      el.appendChild(h('div', { class: 'feedback resource-row__extra' },
        h('strong', null, r.status === 'removed' ? 'Why it was unpublished' : 'Feedback from the reviewer'), r.feedback));
    }
    if (r.notes?.length) {
      el.appendChild(h('div', { class: 'feedback feedback--note resource-row__extra' },
        h('strong', null, r.notes.length === 1 ? 'Note from a teacher' : 'Notes from teachers'),
        r.notes.map((n) => h('p', { style: 'margin-top: var(--sp-1)' }, n.body, ' ',
          h('span', { class: 'field__hint' }, `(${formatDate(n.created_at)})`)))));
    }
    if (editable) {
      const withdrawBtn = h('button', { class: 'btn btn--sm btn--quiet', type: 'button' }, 'Withdraw');
      const actions = h('div', { class: 'row-actions resource-row__extra' },
        h('a', { class: 'btn btn--sm', href: live ? routeUrl('contribute', { edit: r.id }) : routeUrl('contribute') },
          r.status === 'rejected' ? 'Revise and resubmit' : 'Edit'),
        withdrawBtn);
      withdrawBtn.addEventListener('click', () => askWithdraw(r, actions, withdrawBtn));
      el.appendChild(actions);
    }
    return el;
  }

  function render() {
    const count = (k) => (k ? items.filter((s) => s.status === k).length : items.length);
    const keys = ['', ...Object.keys(STATUSES).filter((k) => k !== 'removed' || count(k))];
    if (filter && !count(filter)) filter = '';
    replaceChildren(tabs, keys.map((k) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(filter === k), onclick: () => { filter = k; render(); } },
        k ? STATUSES[k].label : 'All', h('span', { class: 'count' }, String(count(k))))));
    const shown = filter ? items.filter((s) => s.status === filter) : items;
    replaceChildren(list, shown.length
      ? h('ul', { class: 'resource-list' }, shown.map(row))
      : emptyState({ title: 'Nothing here.', body: 'Submissions with this status will appear here.' }));
  }

  render();
  replaceChildren(wrap, status, tabs, list);
  return wrap;
}

/* ------------------------------ Signed in (live) ------------------------------ */
async function renderLive(u) {
  const roleLabel = u.isAdmin ? 'Administrator' : u.isTeacher ? 'Teacher' : 'Student';
  const nameInput = input({ value: u.displayName, maxlength: 40, autocomplete: 'nickname' });
  const saved = h('div', { 'aria-live': 'polite' });
  const save = h('button', { class: 'btn btn--sm', type: 'submit' }, 'Save name');

  const nameForm = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const n = nameInput.value.trim();
      setError(nameInput, n.length < 2 ? 'Use at least 2 characters.' : '');
      if (n.length < 2) return;
      save.disabled = true;
      try {
        await updateDisplayName(n);
        replaceChildren(saved, h('p', { class: 'field__hint' }, 'Saved.'));
        $$('[data-slot="account"] a[href*="account"]').forEach((a) => { a.textContent = n; });
      } catch (err) {
        setError(nameInput, friendlyError(err));
      } finally {
        save.disabled = false;
      }
    },
  },
  field({ label: 'Display name', control: nameInput, hint: 'Shown on resources you contribute.' }),
  h('div', { class: 'form-actions', style: 'margin-top: var(--sp-3)' }, save, saved));

  let submissions;
  try {
    const { items } = await listMySubmissions();
    submissions = submissionsSection(items, { live: true });
  } catch (err) {
    console.error(err);
    submissions = errorNotice('Your submissions could not be loaded. Please refresh the page.');
  }

  renderPage({
    name: u.displayName,
    profile: [['Email', u.email, 'word-break: break-all'], ['Role', roleLabel], ['Joined', formatDate(u.joined)]],
    extra: h('div', { style: 'margin-top: var(--sp-5)' }, nameForm),
    submissions,
  });
}
