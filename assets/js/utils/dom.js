/**
 * Tiny DOM builder.
 *
 * SECURITY: this is the only way UI code should create elements. Children
 * that are strings become Text nodes, so user-supplied content (resource
 * titles, descriptions, names) can never be interpreted as HTML. Do not use
 * innerHTML with data from the database or URL.
 *
 *   h('a', { href: '/x', class: 'link' }, 'Label')
 *   h('ul', null, items.map(i => h('li', null, i.name)))
 */

const BOOLEAN_ATTRS = new Set(['hidden', 'disabled', 'required', 'checked', 'selected', 'autofocus', 'multiple']);

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);

  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;

      if (key === 'class') {
        el.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
      } else if (key === 'dataset') {
        Object.assign(el.dataset, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'href' || key === 'src') {
        el.setAttribute(key, safeUrl(value));
      } else if (BOOLEAN_ATTRS.has(key)) {
        el.toggleAttribute(key, Boolean(value));
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }

  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }
}

/** Block javascript:, data: and other unsafe URL schemes in href/src. */
export function safeUrl(value) {
  const url = String(value).trim();
  // Relative URLs and fragments are fine.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return /^(https?|mailto):/i.test(url) ? url : '#';
}

/**
 * Build an inline SVG icon from trusted, hard-coded path data only.
 * Never pass user data to this function.
 */
export function icon(pathData, { size = 20, label } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  for (const d of [].concat(pathData)) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

export const ICONS = {
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
};

/** Replace all children of an element. */
export function replaceChildren(el, ...children) {
  el.replaceChildren();
  append(el, children);
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
