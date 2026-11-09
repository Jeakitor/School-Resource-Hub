/**
 * Catalogue row for a single (enriched) resource or submission.
 * All text goes through h(), so resource fields are always plain text.
 */

import { h } from '../utils/dom.js';
import { formatDate } from '../utils/format.js';
import { RESOURCE_TYPES, LEVELS, STATUSES, routeUrl } from '../config/site.js';
import { topicLabel } from '../services/catalog.js';

export function levelChip(level) {
  if (!LEVELS[level]) return null;
  return h('span', { class: ['chip', level === 'HL' && 'chip--hl'], title: LEVELS[level].description },
    LEVELS[level].label);
}

export function reviewedChip() {
  return h('span', { class: 'chip chip--accent', title: 'Checked by a subject teacher' }, '✓ Teacher reviewed');
}

/**
 * @param r        enriched resource from services/resources.js
 * @param options  { showSubject = true, status = false, href }
 */
export function resourceRow(r, { showSubject = true, status = false, href } = {}) {
  const type = RESOURCE_TYPES[r.resource_type];
  const where = r.subtopic ?? r.topic;

  return h('li', { class: 'resource-row' },
    h('span', { class: 'resource-row__type type-badge' }, type?.label ?? r.resource_type),
    h('h3', { class: 'resource-row__title' },
      href === false ? r.title : h('a', { href: href ?? routeUrl('resource', { id: r.id }) }, r.title),
    ),
    h('div', { class: 'resource-row__meta meta' },
      showSubject && r.subject ? h('span', null, r.subject.short_name) : null,
      where ? h('span', null, topicLabel(where)) : null,
      r.contributor_name ? h('span', null, r.contributor_name) : null,
    ),
    h('div', { class: 'resource-row__tags' },
      levelChip(r.level),
      r.teacher_reviewed ? reviewedChip() : null,
      status ? h('span', { class: `status status--${r.status}` }, STATUSES[r.status]?.label ?? r.status) : null,
    ),
    h('time', { class: 'resource-row__date', datetime: r.created_at }, formatDate(r.created_at)),
  );
}
