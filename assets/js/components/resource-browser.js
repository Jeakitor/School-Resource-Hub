/**
 * Filterable resource list shared by the Library and Search pages.
 * State lives in the URL (q, subject, level, type, topic, sort), so results are shareable.
 */

import { h, replaceChildren } from '../utils/dom.js';
import { plural } from '../utils/format.js';
import { getParams, setParams, debounce } from '../utils/url.js';
import { RESOURCE_TYPES, LEVELS, routeUrl } from '../config/site.js';
import { listSubjects, listGroups, getSyllabus, topicLabel } from '../services/catalog.js';
import { enhanceSubjectSelect } from './subject-picker.js';
import { listPublished } from '../services/resources.js';
import { field, select, setOptions, input } from './forms.js';
import { resourceRow } from './resource-row.js';
import { emptyState, errorNotice } from './empty-state.js';

const KEYS = ['q', 'subject', 'level', 'type', 'topic', 'sort'];

/**
 * @param root   container element
 * @param mode   'library' | 'search'  (search shows a prompt until a query or filter is set)
 * @param searchInput  optional existing <input> to use as the query box (search page hero)
 */
export async function mountResourceBrowser(root, { mode = 'library', searchInput } = {}) {
  const state = getParams(KEYS);
  const subjects = await listSubjects();

  const q = searchInput ?? input({ type: 'search', placeholder: 'Filter by keyword…', autocomplete: 'off' });
  q.value = state.q;

  const subjectSel = select({
    placeholder: 'All subjects',
    options: subjects.map((s) => ({ value: s.slug, label: s.name })),
    value: state.subject,
  });
  const levelSel = select({
    placeholder: 'All levels',
    options: [
      { value: 'SL', label: 'SL view (hide HL only)' },
      { value: 'HL', label: `${LEVELS.HL.label}` },
    ],
    value: state.level,
  });
  const typeSel = select({
    placeholder: 'All types',
    options: Object.entries(RESOURCE_TYPES).map(([value, t]) => ({ value, label: t.label })),
    value: state.type,
  });
  const topicSel = select({ placeholder: 'All topics', options: [], disabled: true });
  const sortSel = select({
    options: [
      { value: 'newest', label: 'Newest first' },
      { value: 'oldest', label: 'Oldest first' },
      { value: 'title', label: 'Title A–Z' },
    ],
    value: state.sort || 'newest',
  });

  const results = h('div', { 'aria-live': 'polite' });
  const countEl = h('span');

  replaceChildren(root,
    h('form', { class: 'filters', role: 'search', onsubmit: (e) => e.preventDefault() },
      searchInput ? null : field({ label: 'Keyword', control: q }),
      field({ label: 'Subject', control: subjectSel }),
      field({ label: 'Topic', control: topicSel }),
      field({ label: 'Level', control: levelSel }),
      field({ label: 'Type', control: typeSel }),
      field({ label: 'Sort', control: sortSel }),
    ),
    h('div', { class: 'results-bar' }, countEl,
      h('button', { class: 'btn btn--sm btn--quiet', type: 'button', onclick: reset }, 'Clear filters')),
    results,
  );
  enhanceSubjectSelect(subjectSel, subjects, { groups: await listGroups() });

  async function loadTopics(keep) {
    const subject = subjects.find((s) => s.slug === subjectSel.value);
    if (!subject) {
      setOptions(topicSel, [], { placeholder: 'All topics' });
      topicSel.disabled = true;
      return;
    }
    const { topics } = await getSyllabus(subject);
    setOptions(topicSel, topics.map((t) => ({ value: t.code, label: topicLabel(t) })),
      { placeholder: 'All topics', value: keep });
    topicSel.disabled = false;
  }

  function current() {
    return {
      q: q.value.trim(), subject: subjectSel.value, level: levelSel.value,
      type: typeSel.value, topic: topicSel.value, sort: sortSel.value === 'newest' ? '' : sortSel.value,
    };
  }

  async function update() {
    const f = current();
    setParams(f);
    const active = f.q || f.subject || f.level || f.type || f.topic;

    if (mode === 'search' && !active) {
      countEl.textContent = '';
      replaceChildren(results, emptyState({
        title: 'Search the whole library.',
        body: 'Search matches titles, descriptions, subjects, topics, subtopics and tags. Try a topic code like “A.1” or a word like “elasticity”.',
      }));
      return;
    }

    try {
      const { items, source } = await listPublished(f);
      countEl.textContent = source === 'none' ? 'Library not connected yet' : plural(items.length, 'result');
      if (items.length) {
        replaceChildren(results, h('ul', { class: 'resource-list' }, items.map((r) => resourceRow(r))));
      } else if (source === 'none' || !active) {
        replaceChildren(results, emptyState({
          title: 'No resources have been published yet.',
          body: 'Once contributions are approved, they will be searchable here.',
          actions: [{ href: routeUrl('contribute'), label: 'Contribute a resource', primary: true }],
        }));
      } else {
        replaceChildren(results, emptyState({
          title: 'Nothing matches those filters.',
          body: 'Try fewer words, another topic, or clear the filters.',
        }));
      }
    } catch (err) {
      console.error(err);
      replaceChildren(results, errorNotice('Resources could not be loaded. Please refresh the page.'));
    }
  }

  function reset() {
    q.value = '';
    for (const s of [subjectSel, levelSel, typeSel]) s.value = '';
    sortSel.value = 'newest';
    loadTopics('').then(update);
  }

  q.addEventListener('input', debounce(update, 150));
  subjectSel.addEventListener('change', () => loadTopics('').then(update));
  for (const s of [levelSel, typeSel, topicSel, sortSel]) s.addEventListener('change', update);

  await loadTopics(state.topic);
  await update();
}
