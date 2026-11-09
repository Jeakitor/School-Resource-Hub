/** Subjects index: every supported subject plus the syllabus version behind it. */

import { mountShell } from '../components/shell.js';
import { h, $, replaceChildren } from '../utils/dom.js';
import { TARGET_SESSION } from '../config/site.js';
import { listSubjects, getSyllabus, levelsLabel, groupLabel } from '../services/catalog.js';
import { countBySubject } from '../services/resources.js';
import { subjectEntry } from '../components/subject-entry.js';
import { errorNotice } from '../components/empty-state.js';

mountShell({ active: 'subjects' });
const main = $('#main');

try {
  const [subjects, { counts }] = await Promise.all([listSubjects(), countBySubject()]);
  const syllabi = await Promise.all(subjects.map(getSyllabus));

  replaceChildren(main,
    h('header', { class: 'page-head' },
      h('div', { class: 'container' },
        h('span', { class: 'eyebrow' }, `${subjects.length} subjects · ${TARGET_SESSION} session`),
        h('h1', null, 'Subjects'),
        h('p', null, 'Each subject is organised by its official IB syllabus. Resources are tagged as core (SL & HL) or HL only, so you can see exactly what applies to your level.'),
      ),
    ),
    h('section', { class: 'section' },
      h('div', { class: 'container' },
        groupOrder(subjects).map(([label, list]) => h('div', { class: 'subject-group' },
          h('h2', { class: 'subject-group__title eyebrow' }, label),
          h('ul', { class: 'subject-index' },
            list.map((s) => subjectEntry(s, { count: counts.get(s.slug) ?? 0 }))))),
      ),
    ),
    h('section', { class: 'section', 'aria-labelledby': 'syl-title' },
      h('div', { class: 'container' },
        h('div', { class: 'section-head' },
          h('div', null,
            h('span', { class: 'eyebrow' }, 'Transparency'),
            h('h2', { id: 'syl-title' }, 'Syllabus versions'),
            h('p', null, 'Which IB subject guide each topic map follows, and whether it has been checked line by line against the official guide.'),
          ),
        ),
        h('div', { class: 'table-wrap' },
          h('table', { class: 'table' },
            h('thead', null, h('tr', null,
              h('th', { scope: 'col' }, 'Subject'),
              h('th', { scope: 'col' }, 'Levels'),
              h('th', { scope: 'col' }, 'Guide first assessed'),
              h('th', { scope: 'col' }, 'Topic map'),
            )),
            h('tbody', null, subjects.map((s, i) => {
              const syl = syllabi[i];
              const verified = syl.review?.status === 'verified';
              return h('tr', null,
                h('td', null, s.name),
                h('td', null, levelsLabel(s)),
                h('td', null, syl.guide.first_assessment ? String(syl.guide.first_assessment) : '—'),
                h('td', null, h('span', { class: `status status--${verified ? 'approved' : 'pending'}` },
                  verified ? 'Verified' : 'Awaiting verification')),
              );
            })),
          ),
        ),
      ),
    ),
  );
} catch (err) {
  console.error(err);
  replaceChildren(main, h('div', { class: 'container section' }, errorNotice('Subjects could not be loaded. Please refresh the page.')));
}

/** [[heading, subjects]] in IB group order, DP core last. */
function groupOrder(subjects) {
  const order = new Map();
  for (const s of subjects) {
    const key = groupLabel(s);
    if (!order.has(key)) order.set(key, []);
    order.get(key).push(s);
  }
  return [...order.entries()].sort(([, a], [, b]) => rank(a[0]) - rank(b[0]));
}
function rank(s) { return s.kind === 'core' ? 99 : s.ib_group; }
