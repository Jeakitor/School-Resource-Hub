/** Accessible form building blocks. */

import { h } from '../utils/dom.js';

let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

/**
 * Labelled field wrapper. Wires aria-describedby to the hint and error.
 * @param control  an <input>/<select>/<textarea>; gets an id if missing
 */
export function field({ label, control, hint, optional = false }) {
  if (!control.id) control.id = nextId('f');
  const hintId = hint ? `${control.id}-hint` : null;
  const errId = `${control.id}-err`;
  control.setAttribute('aria-describedby', [hintId, errId].filter(Boolean).join(' '));
  return h('div', { class: 'field' },
    h('label', { class: 'field__label', for: control.id },
      label, optional ? h('span', { class: 'optional' }, 'optional') : null),
    control,
    hint ? h('p', { class: 'field__hint', id: hintId }, hint) : null,
    h('p', { class: 'field__error', id: errId, 'aria-live': 'polite' }),
  );
}

/** Show/clear a validation message for a control created via field(). */
export function setError(control, message) {
  const err = document.getElementById(`${control.id}-err`);
  if (err) err.textContent = message || '';
  control.toggleAttribute('aria-invalid', Boolean(message));
  if (message) control.setAttribute('aria-invalid', 'true');
}

export function input(attrs = {}) {
  return h('input', { class: 'input', type: 'text', ...attrs });
}

export function textarea(attrs = {}) {
  return h('textarea', { class: 'textarea', ...attrs });
}

/**
 * @param options  [{ value, label, disabled? }]
 * @param placeholder  label for the empty first option (value '')
 */
export function select({ options = [], value = '', placeholder, ...attrs } = {}) {
  const el = h('select', { class: 'select', ...attrs });
  setOptions(el, options, { value, placeholder });
  return el;
}

export function setOptions(el, options, { value = '', placeholder } = {}) {
  el.replaceChildren(
    ...(placeholder !== undefined ? [h('option', { value: '' }, placeholder)] : []),
    ...options.map((o) => h('option', { value: o.value, disabled: o.disabled }, o.label)),
  );
  el.value = options.some((o) => o.value === value) ? value : '';
}

/** Segmented toggle (e.g. All / SL / HL). Calls onChange(value). */
export function segmented({ label, options, value, onChange }) {
  const wrap = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  const render = (current) => {
    wrap.replaceChildren(...options.map((o) => h('button', {
      type: 'button',
      'aria-pressed': String(o.value === current),
      title: o.title,
      onclick: () => { render(o.value); onChange(o.value); },
    }, o.label)));
  };
  render(value);
  return wrap;
}
