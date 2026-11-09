/** Subject entries for the subject index (full and compact variants). */

import { h } from '../utils/dom.js';
import { plural } from '../utils/format.js';
import { routeUrl } from '../config/site.js';
import { levelsLabel } from '../services/catalog.js';

export function subjectEntry(subject, { count = 0 } = {}) {
  return h('li', { class: 'subject-entry' },
    h('span', { class: 'subject-entry__glyph', 'aria-hidden': 'true' }, subject.glyph),
    h('h3', { class: 'subject-entry__name' },
      h('a', { href: routeUrl('subject', { s: subject.slug }) }, subject.name),
    ),
    h('p', { class: 'subject-entry__desc' }, subject.description),
    h('div', { class: 'subject-entry__foot' },
      h('span', { class: 'chip' }, levelsLabel(subject)),
      h('span', { class: 'subject-entry__count' }, plural(count, 'resource')),
    ),
  );
}

export function subjectEntryCompact(subject) {
  return h('li', { class: 'subject-entry' },
    h('span', { class: 'subject-entry__glyph', 'aria-hidden': 'true' }, subject.glyph),
    h('span', { class: 'subject-entry__name' },
      h('a', { href: routeUrl('subject', { s: subject.slug }) }, subject.name),
    ),
    h('span', { class: 'chip' }, levelsLabel(subject)),
  );
}
