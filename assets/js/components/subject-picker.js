/**
 * Subject picker: a searchable, grouped menu with a coloured badge per subject,
 * layered on top of a normal <select>.
 *
 * Why enhance a <select> instead of replacing it: the select stays the single source
 * of truth (its value, its 'change' events, form validation via setError), so pages
 * keep working unchanged, and setting `select.value = …` in code updates the picker.
 *
 * Accessibility: the trigger is a button (aria-haspopup="listbox"); the panel has a
 * search box that controls a listbox via aria-activedescendant. Keys: ↑/↓ move,
 * Enter picks, Esc closes, typing filters, Home/End jump.
 */

import { h } from '../utils/dom.js';

let uid = 0;
const GROUP_ORDER = ['1', '2', '3', '4', '5', '6', 'core'];
const groupKey = (s) => (s.kind === 'core' ? 'core' : String(s.ib_group));

/** Small coloured initials badge. */
export function subjectBadge(subject, { size = '' } = {}) {
  return h('span', {
    class: ['subject-badge', size && `subject-badge--${size}`],
    'data-group': groupKey(subject),
    'aria-hidden': 'true',
  }, subject.abbr ?? subject.short_name.slice(0, 2));
}

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/**
 * @param select    a <select> whose option values are subject slugs (an option with value '' = "all"/placeholder)
 * @param subjects  subject records from catalog.listSubjects()
 * @param options   { groups: { '1': 'Studies in…', core: 'DP core' } }
 */
export function enhanceSubjectSelect(select, subjects, { groups = {} } = {}) {
  const id = `sp-${++uid}`;
  const bySlug = new Map(subjects.map((s) => [s.slug, s]));
  const emptyOption = [...select.options].find((o) => o.value === '');
  const emptyLabel = emptyOption?.textContent ?? 'Choose a subject';
  const allowEmptyChoice = Boolean(emptyOption) && !select.required;

  const triggerLabel = h('span', { class: 'subject-picker__value' });
  const trigger = h('button', {
    type: 'button', class: 'subject-picker__trigger select', id: `${id}-trigger`,
    'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': `${id}-panel`,
  }, triggerLabel); // the .select class draws the caret

  const search = h('input', {
    type: 'search', class: 'input subject-picker__search', placeholder: 'Search subjects…',
    autocomplete: 'off', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': `${id}-list`,
    'aria-autocomplete': 'list', 'aria-label': 'Search subjects',
  });
  const list = h('div', { class: 'subject-picker__list', role: 'listbox', id: `${id}-list`, 'aria-label': 'Subjects' });
  const panel = h('div', { class: 'subject-picker__panel', id: `${id}-panel`, hidden: true }, search, list);
  const root = h('div', { class: 'subject-picker' }, trigger, panel);

  // Hide the native select but keep it in the form and in the DOM.
  select.classList.add('visually-hidden');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  select.after(root);

  // The field label and messages now belong to the trigger.
  const label = select.id ? document.querySelector(`label[for="${CSS.escape(select.id)}"]`) : null;
  if (label) label.htmlFor = trigger.id;
  if (select.getAttribute('aria-describedby')) trigger.setAttribute('aria-describedby', select.getAttribute('aria-describedby'));
  new MutationObserver(() => {
    if (select.getAttribute('aria-invalid') === 'true') trigger.setAttribute('aria-invalid', 'true');
    else trigger.removeAttribute('aria-invalid');
    trigger.disabled = select.disabled;
  }).observe(select, { attributes: true, attributeFilter: ['aria-invalid', 'disabled'] });
  select.focus = () => trigger.focus(); // validation focuses the first invalid control

  // Keep the trigger in sync when code sets select.value directly.
  const native = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() { return native.get.call(this); },
    set(v) { native.set.call(this, v); sync(); },
  });

  function sync() {
    const s = bySlug.get(select.value);
    triggerLabel.replaceChildren(...(s
      ? [subjectBadge(s), h('span', { class: 'subject-picker__name' }, s.name)]
      : [h('span', { class: 'subject-picker__placeholder' }, emptyLabel)]));
  }

  /* ------------------------------- Options ------------------------------- */
  let items = [];   // currently visible option elements, in order
  let active = -1;

  function render() {
    const term = norm(search.value.trim());
    const match = (s) => !term || norm(`${s.name} ${s.short_name} ${s.abbr} ${s.ib_group_name}`).includes(term);
    const chunks = [];
    items = [];

    if (allowEmptyChoice && !term) chunks.push(optionEl({ value: '', label: emptyLabel }));
    for (const g of GROUP_ORDER) {
      const inGroup = subjects.filter((s) => groupKey(s) === g && match(s));
      if (!inGroup.length) continue;
      chunks.push(h('div', { role: 'group', class: 'subject-picker__group', 'aria-labelledby': `${id}-g${g}` },
        h('div', { class: 'subject-picker__group-label', id: `${id}-g${g}` },
          g === 'core' ? (groups.core ?? 'DP core') : `Group ${g} · ${groups[g] ?? ''}`),
        inGroup.map((s) => optionEl({ value: s.slug, subject: s }))));
    }
    if (!chunks.length) chunks.push(h('p', { class: 'subject-picker__empty' }, `No subject matches “${search.value.trim()}”.`));
    list.replaceChildren(...chunks);

    const current = items.findIndex((el) => el.dataset.value === select.value);
    setActive(term ? 0 : Math.max(current, 0));
  }

  function optionEl({ value, label, subject }) {
    const el = h('div', {
      role: 'option', class: 'subject-picker__option', id: `${id}-o${items.length}`,
      'data-value': value, 'aria-selected': String(select.value === value),
    },
    subject ? subjectBadge(subject) : h('span', { class: 'subject-badge subject-badge--all', 'aria-hidden': 'true' }, '∗'),
    h('span', { class: 'subject-picker__option-text' },
      h('span', null, subject ? subject.name : label),
      subject ? h('small', null, subject.kind === 'core' ? 'Core · all students' : subject.levels.join(' · ')) : null));
    el.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the search box
    el.addEventListener('click', () => choose(value));
    el.addEventListener('mousemove', () => setActive(items.indexOf(el), false));
    items.push(el);
    return el;
  }

  function setActive(i, scroll = true) {
    items[active]?.classList.remove('is-active');
    active = items.length ? Math.min(Math.max(i, 0), items.length - 1) : -1;
    const el = items[active];
    if (!el) { search.removeAttribute('aria-activedescendant'); return; }
    el.classList.add('is-active');
    search.setAttribute('aria-activedescendant', el.id);
    if (scroll) el.scrollIntoView({ block: 'nearest' });
  }

  /* ---------------------------- Open / close ----------------------------- */
  function open() {
    if (!panel.hidden || trigger.disabled) return;
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    root.classList.add('is-open');
    search.value = '';
    render();
    search.focus();
    document.addEventListener('pointerdown', outside, true);
  }
  function close({ focus = true } = {}) {
    if (panel.hidden) return;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    root.classList.remove('is-open');
    document.removeEventListener('pointerdown', outside, true);
    if (focus) trigger.focus();
  }
  function outside(e) { if (!root.contains(e.target)) close({ focus: false }); }

  function choose(value) {
    const changed = select.value !== value;
    select.value = value;
    close();
    if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  trigger.addEventListener('click', () => (panel.hidden ? open() : close()));
  trigger.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); }
  });
  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => {
    const keys = {
      ArrowDown: () => setActive(active + 1),
      ArrowUp: () => setActive(active - 1),
      Home: () => setActive(0),
      End: () => setActive(items.length - 1),
      PageDown: () => setActive(active + 6),
      PageUp: () => setActive(active - 6),
      Enter: () => { if (items[active]) choose(items[active].dataset.value); },
      Escape: () => close(),
    };
    if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
    else if (e.key === 'Tab') close({ focus: false });
  });

  sync();
  return { root, trigger, sync, open, close };
}
