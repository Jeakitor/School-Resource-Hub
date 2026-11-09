/** Search: query-first view of the library. Shares filtering with the library page. */

import { mountShell } from '../components/shell.js';
import { h, $, replaceChildren, icon, ICONS } from '../utils/dom.js';
import { mountResourceBrowser } from '../components/resource-browser.js';

mountShell({ active: 'search' });

const q = h('input', {
  id: 'search-q', type: 'search', autocomplete: 'off', spellcheck: 'false',
  placeholder: 'Search titles, topics, subjects, tags…',
});
const browser = h('div');

replaceChildren($('#main'),
  h('header', { class: 'page-head' },
    h('div', { class: 'container' },
      h('h1', null, 'Search'),
      h('form', { role: 'search', style: 'margin-top: var(--sp-5); max-width: 44rem', onsubmit: (e) => e.preventDefault() },
        h('label', { class: 'visually-hidden', for: 'search-q' }, 'Search resources'),
        h('div', { class: 'search-field' },
          h('span', { class: 'search-field__icon', 'aria-hidden': 'true' }, icon(ICONS.search)),
          q)),
    )),
  h('section', { class: 'section' }, h('div', { class: 'container' }, browser)),
);

await mountResourceBrowser(browser, { mode: 'search', searchInput: q });
q.focus();
