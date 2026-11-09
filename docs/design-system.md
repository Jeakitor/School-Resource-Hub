# Design system

Calm, academic, dark. Inspired by Obsidian's knowledge-base aesthetic and a
library catalogue. All values live in `assets/css/tokens.css`. Never hard-code a colour.

## Colour

| Token | Value | Use |
|---|---|---|
| `--bg` | `#1b1b1f` | Page background |
| `--bg-2` | `#232329` | Header, footer, bands, row hover |
| `--surface` | `#2a2a32` | Inputs, panels, menus |
| `--text` | `#eeeae2` | Primary text |
| `--text-2` | `#aaa7a0` | Secondary text |
| `--text-3` | `#8d8a83` | Metadata (still ≥ 4.5:1 contrast on `--bg`) |
| `--accent` | `#b2f07b` | **Sparingly:** primary action, active nav, focus ring, counts, progress |

Moderation statuses use muted amber, lime and terracotta (`--status-*`), each
shown with a text label so colour is never the only signal.

## Type

- **Times New Roman** throughout, with fallbacks. Body text is 18px because
  Times has a small x-height.
- Headings are regular weight (400), tight leading and slightly negative
  tracking. They read as editorial rather than shouting.
- A **monospace** face is reserved for small uppercase metadata: eyebrows,
  type badges, dates and codes.

## Shape and depth

- Radii are 3–5px. Rows and indexes are separated by 1px hairlines rather
  than boxed in cards.
- One shadow (`--shadow-pop`), used only for floating menus.
- Motion is 140ms colour/position transitions only. `prefers-reduced-motion` disables it.

## Components

`components.css`: `.btn` (default, `--primary`, `--quiet`, `--sm`, `--lg`),
`.search-field`, `.chip`, `.type-badge`, `.status--*`, `.meta`,
`.resource-list` / `.resource-row`, `.subject-index` / `.subject-entry`
(and `--compact`), `.empty-state`, `.panel`, `.ledger`, `.notice`, `.skeleton`.

**Subject badge and picker** (`components/subject-picker.js`):
- **Badge:** `.subject-badge` is a small mono initials tile (`abbr` from `subjects.json`), tinted by IB group with the muted `--group-1…5` / `--group-core` tokens. The accent stays reserved for focus and the selected item.
- **Picker:** `enhanceSubjectSelect(select, subjects, { groups })` layers a searchable, grouped menu over an ordinary `<select>`. The select stays the source of truth, so values, `change` events and validation work unchanged, and setting `select.value` in code updates the picker.
- **Keyboard:** ↑/↓, Home/End, Enter, Esc, and type to filter.
- **Phones:** below 36rem the menu becomes a bottom sheet.
- **Where:** used on Contribute, Library and Search.

## Accessibility

- Visible lime focus ring on every interactive element (`:focus-visible`).
- Skip link, landmark elements and `aria-current` on the active nav item.
- The mobile menu is a real `<button>` with `aria-expanded`; Escape closes it
  and returns focus to the button.
- Whole-row click targets use a stretched link, so there is only one link per
  row for screen readers.

## Breakpoints

- `52rem` (~832px): navigation collapses to the menu button.
- `60rem`: two-column page sections stack.
- `44rem`, `36rem`: grids collapse to one column.
