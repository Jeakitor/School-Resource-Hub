/**
 * The content of a resource: PDF viewer, rendered notes, or an external link card.
 * Shared by the resource page and the moderation panel, so moderators see exactly
 * what the public will see.
 */

import { h, safeUrl } from '../utils/dom.js';
import { renderMarkdown } from '../services/markdown.js';
import { errorNotice } from './empty-state.js';

export async function resourceContent(r) {
  if (r.resource_type === 'markdown') {
    const prose = h('div', { class: 'prose' });
    prose.appendChild(await renderMarkdown(r.body_md ?? r.body ?? ''));
    return prose;
  }

  if (r.resource_type === 'link') {
    const href = safeUrl(r.external_url ?? '');
    let host = '';
    try { host = new URL(href).host; } catch { /* invalid URL: no card */ }
    if (!host) return errorNotice('This link is invalid.');
    return h('div', { class: 'link-card' },
      h('span', { class: 'eyebrow' }, 'External website'),
      h('span', { class: 'link-card__host' }, href),
      h('p', { class: 'field__hint' }, `This opens ${host}, which is not part of School Resource Hub.`),
      h('div', null, h('a', { class: 'btn btn--primary', href, target: '_blank', rel: 'noopener noreferrer nofollow' }, `Open ${host} ↗`)),
    );
  }

  if (r.resource_type === 'pdf') {
    // r.file_url is a short-lived signed URL from Supabase Storage.
    if (!r.file_url) {
      return h('p', { class: 'notice notice--info' },
        r.is_preview
          ? 'Preview resource: there is no real file. Published PDFs will display here with a download button.'
          : 'The file for this resource is not available.');
    }
    return h('div', null,
      h('div', { class: 'resource-actions' },
        h('a', { class: 'btn btn--primary', href: r.download_url ?? r.file_url, download: '' }, 'Download PDF'),
        h('a', { class: 'btn', href: r.file_url, target: '_blank', rel: 'noopener' }, 'Open in new tab'),
      ),
      h('iframe', { class: 'pdf-frame', src: r.file_url, title: `PDF: ${r.title}`, loading: 'lazy' }),
    );
  }

  return errorNotice('Unknown resource type.');
}
