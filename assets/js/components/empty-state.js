import { h } from '../utils/dom.js';

/**
 * @param title    short headline
 * @param body     one or two sentences
 * @param actions  array of { href, label, primary? }
 */
export function emptyState({ title, body, actions = [] }) {
  return h('div', { class: 'empty-state' },
    h('p', { class: 'empty-state__title' }, title),
    body ? h('p', null, body) : null,
    actions.length
      ? h('div', { class: 'empty-state__actions' },
          actions.map((a) => h('a', { class: ['btn', a.primary && 'btn--primary'], href: a.href }, a.label)))
      : null,
  );
}

export function errorNotice(message) {
  return h('p', { class: 'notice notice--error', role: 'alert' }, message);
}
