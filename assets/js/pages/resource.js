/**
 * Resource detail: metadata + the content itself (PDF viewer, rendered notes or external link).
 * URL: resource.html?id=<id>
 */

import { mountShell, currentUser } from '../components/shell.js';
import { h, $, replaceChildren } from '../utils/dom.js';
import { formatDate } from '../utils/format.js';
import { getParams } from '../utils/url.js';
import { RESOURCE_TYPES, LEVELS, STATUSES, routeUrl } from '../config/site.js';
import { topicLabel } from '../services/catalog.js';
import { getResource } from '../services/resources.js';
import { resourceContent } from '../components/resource-content.js';
import { levelChip, reviewedChip } from '../components/resource-row.js';
import { emptyState, errorNotice } from '../components/empty-state.js';

mountShell({ active: 'library' });
const main = $('#main');
const { id } = getParams(['id']);

try {
  const { item: r } = id ? await getResource(id) : { item: null };
  if (!r) {
    replaceChildren(main, h('div', { class: 'container section' }, emptyState({
      title: 'This resource is not available.',
      body: 'It may have been removed, may still be awaiting review, or the link may be incorrect.',
      actions: [{ href: routeUrl('library'), label: 'Browse the library' }],
    })));
  } else {
    document.title = `${r.title} · School Resource Hub`;
    await render(r);
  }
} catch (err) {
  console.error(err);
  replaceChildren(main, h('div', { class: 'container section' }, errorNotice('This resource could not be loaded. Please refresh the page.')));
}

async function render(r) {
  const type = RESOURCE_TYPES[r.resource_type];
  const body = h('div', { class: 'resource-body' }, await contentFor(r));

  const row = (label, value) => (value ? h('div', null, h('dt', null, label), h('dd', null, value)) : null);
  const viewer = r.is_preview || !(r.status === 'pending' || r.status === 'rejected') ? null : await currentUser().catch(() => null);
  const ownerCanEdit = Boolean(viewer && viewer.id === r.uploader_id);

  replaceChildren(main, h('div', { class: 'container' },
    h('div', { class: 'resource-layout' },
      h('article', null,
        h('nav', { class: 'breadcrumbs', 'aria-label': 'Breadcrumb' }, h('ol', null,
          h('li', null, h('a', { href: routeUrl('subjects') }, 'Subjects')),
          r.subject ? h('li', null, h('a', { href: routeUrl('subject', { s: r.subject.slug }) }, r.subject.short_name)) : null,
          r.topic ? h('li', null, h('a', { href: routeUrl('subject', { s: r.subject.slug, t: r.topic.code }) }, r.topic.code)) : null,
          r.subtopic ? h('li', null, h('a', { href: routeUrl('subject', { s: r.subject.slug, t: r.topic.code, st: r.subtopic.code }) }, r.subtopic.code)) : null,
        )),
        h('span', { class: 'eyebrow' }, type?.label ?? r.resource_type),
        h('h1', null, r.title),
        h('div', { class: 'resource-chips' },
          levelChip(r.level),
          r.teacher_reviewed ? reviewedChip() : null,
          ...(r.tags ?? []).map((t) => h('span', { class: 'chip' }, `#${t}`)),
        ),
        r.status && r.status !== 'approved'
          ? h('p', { class: 'notice notice--warn', style: 'margin-top: var(--sp-4)' },
              `${STATUSES[r.status]?.label ?? r.status}: only you and moderators can see this page.`,
              ownerCanEdit ? [' ', h('a', { href: routeUrl('contribute', { edit: r.id }) }, 'Edit this submission')] : null)
          : null,
        r.description ? h('p', { class: 'resource-desc' }, r.description) : null,
        r.corrections?.length
          ? h('div', { class: 'notice notice--info', style: 'margin-top: var(--sp-4)', role: 'note' },
              h('strong', null, r.corrections.length === 1 ? 'Correction from a reviewer' : 'Corrections from reviewers'),
              r.corrections.map((c) => h('p', { style: 'margin-top: var(--sp-2)' }, c.body, ' ',
                h('span', { class: 'field__hint' }, `(${formatDate(c.created_at)})`))))
          : null,
        body,
      ),
      h('aside', null,
        h('div', { class: 'panel' },
          h('span', { class: 'eyebrow' }, 'Details'),
          h('dl', { class: 'meta-list' },
            row('Subject', r.subject?.name),
            row('Topic', r.topic && topicLabel(r.topic)),
            row('Subtopic', r.subtopic && topicLabel(r.subtopic)),
            row('Level', LEVELS[r.level]?.label),
            row('Type', type?.label),
            row('Contributor', r.contributor_name),
            r.status && r.status !== 'approved'
              ? row('Submitted', formatDate(r.submitted_at ?? r.created_at))
              : row('Published', formatDate(r.created_at)),
          ),
        ),
        h('div', { class: 'panel' },
          h('span', { class: 'eyebrow' }, 'Spotted a mistake?'),
          h('p', { style: 'font-size: var(--fs-sm); color: var(--text-2)' },
            'Reporting is coming soon. Teachers and moderators can already add correction notes during review.'),
        ),
      ),
    ),
  ));
}

// Function declaration (hoisted): render() runs above, before this line is reached.
function contentFor(r) { return resourceContent(r); }
