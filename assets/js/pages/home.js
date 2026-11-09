/**
 * Homepage controller.
 * Static structure lives in index.html; this module fills the data slots.
 * Each section loads independently so one failure never blanks the page.
 */

import { mountShell } from '../components/shell.js';
import { h, $, replaceChildren } from '../utils/dom.js';
import { routeUrl } from '../config/site.js';
import { listSubjects, syllabusTotals } from '../services/catalog.js';
import { listRecent, countBySubject } from '../services/resources.js';
import { resourceRow } from '../components/resource-row.js';
import { subjectEntry, subjectEntryCompact } from '../components/subject-entry.js';
import { emptyState, errorNotice } from '../components/empty-state.js';

mountShell({ active: 'home' });
wireSearchShortcut();

const subjectsPromise = listSubjects();
const countsPromise = countBySubject();

renderJumpLinks();
renderLedger();
renderSubjects();
renderRecent();

/* ------------------------------------------------------------------------ */

async function renderJumpLinks() {
  const slot = $('[data-slot="jump"]');
  try {
    const subjects = await subjectsPromise;
    replaceChildren(slot,
      h('span', null, 'Jump to'),
      subjects.map((s) => h('a', { href: routeUrl('subject', { s: s.slug }) }, s.short_name)),
    );
  } catch {
    slot.remove();
  }
}

async function renderLedger() {
  const slot = $('[data-slot="ledger"]');
  const row = (label, value) => h('div', { class: 'ledger__row' }, h('dt', null, label), h('dd', null, value));
  try {
    const [totals, { total, source }] = await Promise.all([syllabusTotals(), countsPromise]);
    replaceChildren(slot,
      row('Subjects supported', totals.subjects),
      row('Syllabus topics mapped', totals.topics + totals.subtopics),
      row(source === 'preview' ? 'Published resources (preview)' : 'Published resources', total),
    );
    if (source === 'preview') {
      $('.hero__aside-note').textContent = 'The resource count includes preview samples only. Exit preview to see real figures.';
    }
  } catch (err) {
    console.error(err);
    replaceChildren(slot, errorNotice('Library statistics could not be loaded.'));
  }
}

async function renderSubjects() {
  const publishedSlot = $('[data-slot="subjects-published"]');
  const awaitingWrap = $('[data-slot="awaiting-wrap"]');
  const awaitingList = $('[data-slot="subjects-awaiting"]');

  try {
    const [subjects, { counts }] = await Promise.all([subjectsPromise, countsPromise]);
    const published = subjects.filter((s) => (counts.get(s.slug) ?? 0) > 0);
    const awaiting = subjects.filter((s) => !counts.get(s.slug));

    if (published.length) {
      replaceChildren(publishedSlot,
        h('ul', { class: 'subject-index' },
          published.map((s) => subjectEntry(s, { count: counts.get(s.slug) }))),
      );
    } else {
      replaceChildren(publishedSlot, emptyState({
        title: 'Nothing has been published yet.',
        body: 'The library is new. Every subject below is ready for its first resource. Yours could be the one that starts it.',
        actions: [{ href: routeUrl('contribute'), label: 'Contribute the first resource', primary: true }],
      }));
    }

    awaitingWrap.hidden = awaiting.length === 0;
    replaceChildren(awaitingList, awaiting.map(subjectEntryCompact));
  } catch (err) {
    console.error(err);
    replaceChildren(publishedSlot, errorNotice('Subjects could not be loaded. Please refresh the page.'));
  }
}

async function renderRecent() {
  const slot = $('[data-slot="recent"]');
  try {
    const { items } = await listRecent({ limit: 6 });
    if (!items.length) {
      replaceChildren(slot, emptyState({
        title: 'No resources yet.',
        body: 'Newly approved resources will appear here as soon as they are published.',
      }));
      return;
    }
    replaceChildren(slot, h('ul', { class: 'resource-list' }, items.map((r) => resourceRow(r))));
  } catch (err) {
    console.error(err);
    replaceChildren(slot, errorNotice('Recent resources could not be loaded.'));
  }
}

/** Press "/" anywhere (outside a text field) to focus the search box. */
function wireSearchShortcut() {
  const input = $('#hero-q');
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
    e.preventDefault();
    input?.focus();
  });
}
