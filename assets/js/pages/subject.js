/**
 * Subject workspace: topic tree on the left, filtered resources on the right.
 * URL: subject.html?s=<slug>&level=SL|HL&t=<topic code>&st=<subtopic code>&type=&q=
 */

import { mountShell } from '../components/shell.js';
import { h, $, replaceChildren, icon, ICONS } from '../utils/dom.js';
import { plural } from '../utils/format.js';
import { getParams, setParams, debounce } from '../utils/url.js';
import { RESOURCE_TYPES, routeUrl } from '../config/site.js';
import { getSubject, getSyllabus, visibleAtLevel, levelsLabel, topicLabel, groupLabel } from '../services/catalog.js';
import { listPublished } from '../services/resources.js';
import { resourceRow } from '../components/resource-row.js';
import { segmented, select } from '../components/forms.js';
import { emptyState, errorNotice } from '../components/empty-state.js';

mountShell({ active: 'subjects' });
const main = $('#main');
const state = getParams(['s', 'level', 't', 'st', 'type', 'q']);

const subject = await getSubject(state.s).catch(() => null);

if (!subject) {
  document.title = 'Subject not found · School Resource Hub';
  replaceChildren(main, h('div', { class: 'container section' },
    emptyState({
      title: 'That subject could not be found.',
      body: 'The link may be out of date.',
      actions: [{ href: routeUrl('subjects'), label: 'See all subjects' }],
    })));
} else {
  document.title = `${subject.name} · School Resource Hub`;
  await render();
}

async function render() {
  const syllabus = await getSyllabus(subject);
  const hasHL = subject.levels.includes('HL');
  if (!hasHL) state.level = '';

  // All published resources for this subject, used for tree counts.
  const { items: all, source } = await listPublished({ subject: subject.slug });

  const tree = h('div', { class: 'tree-wrap' });
  const list = h('div', { 'aria-live': 'polite' });
  const count = h('span');
  const heading = h('h2', { class: 'visually-hidden' });

  const q = h('input', { type: 'search', placeholder: `Search ${subject.short_name}…`, value: state.q, 'aria-label': `Search within ${subject.name}` });
  const typeSel = select({
    placeholder: 'All types',
    options: Object.entries(RESOURCE_TYPES).map(([value, t]) => ({ value, label: t.label })),
    value: state.type,
    'aria-label': 'Resource type',
  });
  q.addEventListener('input', debounce(() => { state.q = q.value.trim(); refresh(); }, 150));
  typeSel.addEventListener('change', () => { state.type = typeSel.value; refresh(); });

  const levelToggle = hasHL ? segmented({
    label: 'Level',
    value: state.level,
    options: [
      { value: '', label: 'All' },
      { value: 'SL', label: 'SL', title: 'Hide HL-only content' },
      { value: 'HL', label: 'HL only', title: 'Only additional higher level content' },
    ],
    onChange: (v) => { state.level = v; refresh(); },
  }) : h('span', { class: 'chip' }, 'SL only subject');

  const side = h('aside', { class: 'workspace__side', 'aria-label': `${subject.name} topics`, 'data-collapsed': 'true' },
    h('span', { class: 'eyebrow side-title' }, 'Syllabus'),
    h('button', {
      class: 'btn btn--sm side-toggle', type: 'button', 'aria-expanded': 'false',
      onclick: (e) => {
        const collapsed = side.dataset.collapsed === 'true';
        side.dataset.collapsed = String(!collapsed);
        e.currentTarget.setAttribute('aria-expanded', String(collapsed));
        e.currentTarget.textContent = collapsed ? 'Hide topics' : 'Show topics';
      },
    }, 'Show topics'),
    tree,
  );

  const review = syllabus.review?.status !== 'verified'
    ? h('p', { class: 'notice notice--warn' },
        `Topic map based on the ${syllabus.guide.title} (first assessment ${syllabus.guide.first_assessment}). It is awaiting line-by-line verification against the official guide.`)
    : null;

  replaceChildren(main,
    h('div', { class: 'workspace' },
      side,
      h('div', { class: 'workspace__main' },
        h('div', { class: 'inner' },
          h('nav', { class: 'breadcrumbs', 'aria-label': 'Breadcrumb' },
            h('ol', null,
              h('li', null, h('a', { href: routeUrl('subjects') }, 'Subjects')),
              h('li', { 'aria-current': 'page' }, subject.name))),
          h('header', { class: 'subject-head' },
            h('span', { class: 'eyebrow' }, groupLabel(subject)),
            h('h1', null, subject.name),
            h('div', { class: 'subject-head__row' },
              h('span', { class: 'chip' }, levelsLabel(subject)),
              h('span', { class: 'chip' }, `Guide first assessed ${syllabus.guide.first_assessment}`),
              h('span', { class: 'chip' }, plural(all.length, 'published resource'))),
            h('p', null, subject.description),
            review,
          ),
          h('div', { class: 'toolbar' },
            levelToggle,
            h('div', { class: 'search-field' },
              h('span', { class: 'search-field__icon', 'aria-hidden': 'true' }, icon(ICONS.search)), q),
            typeSel,
          ),
          heading,
          h('div', { class: 'results-bar' }, count),
          list,
        ),
      ),
    ),
  );

  async function refresh() {
    setParams({ level: state.level, t: state.t, st: state.st, type: state.type, q: state.q });
    renderTree();

    const { items } = await listPublished({
      subject: subject.slug, level: state.level, topic: state.t, subtopic: state.st, type: state.type, q: state.q,
    });

    const topic = syllabus.topics.find((t) => t.code === state.t);
    const sub = topic?.subtopics.find((s) => s.code === state.st);
    heading.textContent = sub ? topicLabel(sub) : topic ? topicLabel(topic) : 'All resources';
    count.textContent = `${sub ? topicLabel(sub) : topic ? topicLabel(topic) : 'All topics'} · ${plural(items.length, 'resource')}`;

    if (items.length) {
      replaceChildren(list, h('ul', { class: 'resource-list' }, items.map((r) => resourceRow(r, { showSubject: false }))));
    } else {
      replaceChildren(list, emptyState({
        title: all.length ? 'No resources match this view.' : `No ${subject.short_name} resources yet.`,
        body: all.length
          ? 'Try another topic, level or type.'
          : 'This subject is waiting for its first contribution. Notes, PDFs and useful links are all welcome.',
        actions: [{ href: routeUrl('contribute', { subject: subject.slug, topic: state.t, subtopic: state.st }), label: 'Contribute to this topic', primary: !all.length }],
      }));
    }
  }

  function renderTree() {
    const countFor = (pred) => all.filter((r) => pred(r) && visibleAtLevel(r, state.level) && (state.level !== 'HL' || r.level === 'HL')).length;
    const link = (label, code, params, n, hl) => h('a', {
      href: routeUrl('subject', { s: subject.slug, ...params }),
      'aria-current': String(params.t === state.t && (params.st ?? '') === state.st),
      onclick: (e) => { e.preventDefault(); state.t = params.t ?? ''; state.st = params.st ?? ''; refresh(); },
    },
    code ? h('span', { class: 'tree__code' }, code) : null,
    h('span', null, label),
    hl ? h('span', { class: 'tree__hl', title: 'HL only' }, 'HL') : null,
    n ? h('span', { class: 'tree__count' }, n) : null);

    const topics = syllabus.topics.filter((t) => visibleAtLevel(t, state.level));
    replaceChildren(tree,
      h('ul', { class: 'tree' },
        h('li', { class: 'tree__all' }, link('All topics', null, {}, all.length)),
        topics.map((t) => {
          const subs = t.subtopics.filter((st) => visibleAtLevel(st, state.level));
          const n = countFor((r) => r.topic_code === t.code);
          if (!subs.length) return h('li', null, link(t.title, t.code, { t: t.code }, n, t.level === 'HL'));
          return h('li', null,
            h('details', { open: state.t === t.code },
              h('summary', null,
                h('span', { class: 'tree__code' }, t.code), h('span', null, t.title),
                t.level === 'HL' ? h('span', { class: 'tree__hl' }, 'HL') : null,
                n ? h('span', { class: 'tree__count' }, n) : null),
              h('ul', null,
                h('li', null, link(`All of ${t.code}`, null, { t: t.code }, n)),
                subs.map((st) => h('li', null,
                  link(st.title, st.code, { t: t.code, st: st.code },
                    countFor((r) => r.subtopic_code === st.code), st.level === 'HL')))),
            ));
        }),
      ),
      syllabus.subtopics_pending
        ? h('p', { class: 'field__hint', style: 'margin-top: var(--sp-3)' }, 'Subtopics will be added once verified against the official guide.')
        : null,
    );
  }

  await refresh();
}
