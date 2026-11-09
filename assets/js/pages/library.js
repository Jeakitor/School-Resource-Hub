/** Resource library: browse everything with filters. */

import { mountShell } from '../components/shell.js';
import { h, $, replaceChildren } from '../utils/dom.js';
import { mountResourceBrowser } from '../components/resource-browser.js';

mountShell({ active: 'library' });

const browser = h('div');
replaceChildren($('#main'),
  h('header', { class: 'page-head' },
    h('div', { class: 'container' },
      h('span', { class: 'eyebrow' }, 'All subjects'),
      h('h1', null, 'Resource library'),
      h('p', null, 'Every published resource in one place. Narrow it down by subject, topic, level or type.'),
    )),
  h('section', { class: 'section' }, h('div', { class: 'container' }, browser)),
);

mountResourceBrowser(browser, { mode: 'library' });
