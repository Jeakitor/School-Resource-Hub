/**
 * Safe Markdown rendering for student notes.
 *
 * 1. `marked` converts Markdown to HTML.
 * 2. `DOMPurify` removes anything executable (scripts, event handlers,
 *    javascript: URLs, iframes, styles) before it touches the page.
 * Both are pinned to exact versions and loaded only on pages that need them.
 * If either fails to load, the notes are shown as plain text instead (never unsanitised HTML).
 */

const MARKED_URL = 'https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js';
const PURIFY_URL = 'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.es.mjs';

let libs = null;
function load() {
  libs ??= Promise.all([import(MARKED_URL), import(PURIFY_URL)]).then(([m, p]) => {
    const DOMPurify = p.default;
    // External links open in a new tab without giving the target page access to ours.
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href') ?? '')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer nofollow');
      }
    });
    return { marked: m.marked, DOMPurify };
  });
  return libs;
}

/** Returns a DocumentFragment that is safe to insert. */
export async function renderMarkdown(source) {
  try {
    const { marked, DOMPurify } = await load();
    const html = marked.parse(String(source ?? ''), { gfm: true, breaks: false });
    return DOMPurify.sanitize(html, {
      RETURN_DOM_FRAGMENT: true,
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button', 'object', 'embed'],
      FORBID_ATTR: ['style'],
    });
  } catch (err) {
    console.error('Markdown renderer unavailable; showing plain text.', err);
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.textContent = String(source ?? '');
    const frag = document.createDocumentFragment();
    frag.appendChild(pre);
    return frag;
  }
}
