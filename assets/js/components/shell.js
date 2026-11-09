/**
 * Site shell — header, navigation, preview banner and footer.
 *
 * Each page contains two mount points:
 *   <div data-shell="header"></div>   (before <main>)
 *   <div data-shell="footer"></div>   (after </main>)
 * and calls mountShell({ active: 'subjects' }).
 *
 * The header's account area ([data-slot="account"]) shows "Sign in" until the
 * session is known, then the user's name, a Moderation link for staff, and Sign out.
 * Showing/hiding links here is cosmetic; the database enforces permissions.
 */

import { h, icon, ICONS, $, $$, replaceChildren } from '../utils/dom.js';
import { SITE_NAME, TARGET_SESSION, NAV, isPreviewMode, routeUrl } from '../config/site.js';
import { getCurrentUser, onAuthChange, signOut } from '../services/auth.js';

// Route hrefs that keep ?preview=1 when it is active.
const ROUTES = new Proxy({}, { get: (_, key) => routeUrl(key) });

/** Resolves to the current user (or null) once the session has been checked. */
let userPromise = null;
export function currentUser() {
  userPromise ??= getCurrentUser().catch((err) => { console.error(err); return null; });
  return userPromise;
}

export function mountShell({ active } = {}) {
  const headerSlot = $('[data-shell="header"]');
  const footerSlot = $('[data-shell="footer"]');
  if (headerSlot) headerSlot.replaceWith(...renderHeader(active));
  if (footerSlot) footerSlot.replaceWith(renderFooter());

  currentUser().then(renderAccount);
  onAuthChange((event) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
      userPromise = null;
      currentUser().then(renderAccount);
    }
  });
}

function renderAccount(user) {
  for (const slot of $$('[data-slot="account"]')) {
    if (!user) {
      replaceChildren(slot, h('a', { class: 'btn btn--sm', href: ROUTES.auth }, 'Sign in'));
      continue;
    }
    replaceChildren(slot,
      (user.isAdmin || user.isTeacher) ? h('a', { class: 'btn btn--sm btn--quiet', href: ROUTES.admin }, 'Moderation') : null,
      h('a', { class: 'btn btn--sm', href: ROUTES.account, title: user.email }, user.displayName),
      h('button', {
        class: 'btn btn--sm btn--quiet', type: 'button',
        onclick: async () => {
          try { await signOut(); } finally { location.href = ROUTES.home; }
        },
      }, 'Sign out'),
    );
  }
}

function brand() {
  return h('a', { class: 'brand', href: ROUTES.home, 'aria-label': `${SITE_NAME}, home` },
    h('span', { class: 'brand__mark', 'aria-hidden': 'true' }, 'R'),
    h('span', { class: 'brand__name' }, SITE_NAME),
  );
}

function accountActions(extraClass) {
  return h('div', { class: ['site-header__actions', extraClass], 'data-slot': 'account' },
    h('a', { class: 'btn btn--sm', href: ROUTES.auth }, 'Sign in'),
  );
}

function renderHeader(active) {
  const navId = 'site-nav';

  const toggle = h('button', {
    class: 'nav-toggle',
    type: 'button',
    'aria-controls': navId,
    'aria-expanded': 'false',
    'aria-label': 'Open menu',
  }, icon(ICONS.menu));

  const nav = h('nav', { class: 'site-nav', id: navId, 'aria-label': 'Primary' },
    h('ul', { class: 'site-nav__list' },
      NAV.map((item) => h('li', null,
        h('a', {
          class: 'site-nav__link',
          href: routeUrl(item.key),
          'aria-current': item.key === active ? 'page' : null,
        }, item.label),
      )),
    ),
    accountActions(), // shown inside the menu on small screens
  );

  const header = h('header', { class: 'site-header' },
    h('div', { class: 'container site-header__inner' },
      brand(),
      nav,
      accountActions('site-header__actions--desktop'),
      toggle,
    ),
  );

  wireMobileNav(toggle, nav);

  const nodes = [header];
  if (isPreviewMode()) nodes.push(renderPreviewBanner());
  return nodes;
}

function wireMobileNav(toggle, nav) {
  const setOpen = (open) => {
    nav.dataset.open = String(open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    toggle.replaceChildren(icon(open ? ICONS.close : ICONS.menu));
  };

  toggle.addEventListener('click', () => setOpen(nav.dataset.open !== 'true'));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.dataset.open === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });

  // Click outside closes the menu. composedPath() is used rather than
  // contains(), because the toggle swaps its icon on click, so e.target may
  // already be detached from the document by the time this runs.
  document.addEventListener('click', (e) => {
    const path = e.composedPath();
    if (nav.dataset.open === 'true' && !path.includes(nav) && !path.includes(toggle)) {
      setOpen(false);
    }
  });

  // Close the menu if the viewport grows past the mobile breakpoint.
  matchMedia('(min-width: 52.01rem)').addEventListener('change', (e) => {
    if (e.matches) setOpen(false);
  });
}

function renderPreviewBanner() {
  const exit = new URL(location.href);
  exit.searchParams.delete('preview');
  return h('div', { class: 'preview-banner', role: 'note' },
    h('div', { class: 'container' },
      h('span', null, 'Preview mode: sample resources shown below are not real and are not stored anywhere.'),
      h('a', { href: exit.pathname + exit.search }, 'Exit preview'),
    ),
  );
}

function renderFooter() {
  const link = (href, label) => h('li', null, h('a', { href }, label));

  return h('footer', { class: 'site-footer' },
    h('div', { class: 'container' },
      h('div', { class: 'site-footer__grid' },
        h('div', { class: 'site-footer__about' },
          brand(),
          h('p', null,
            'A student-built library of IB Diploma Programme resources, organised by syllabus. ',
            'Created as a CAS project. Not affiliated with or endorsed by the International Baccalaureate Organization.',
          ),
        ),
        h('div', null,
          h('h2', null, 'Explore'),
          h('ul', null,
            link(ROUTES.subjects, 'Subjects'),
            link(ROUTES.library, 'Resource library'),
            link(ROUTES.search, 'Search'),
          ),
        ),
        h('div', null,
          h('h2', null, 'Take part'),
          h('ul', null,
            link(ROUTES.contribute, 'Contribute a resource'),
            link(ROUTES.auth, 'Sign in or register'),
            link(ROUTES.account, 'Your submissions'),
          ),
        ),
      ),
      h('div', { class: 'site-footer__base' },
        h('span', null, `Syllabi aligned to the ${TARGET_SESSION} examination session`),
        h('span', null, '© Jeakitor Work'),
      ),
    ),
  );
}
