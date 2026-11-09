/**
 * Site-wide constants. No secrets belong here (or anywhere in the frontend).
 * Supabase settings will live in config/supabase.js, added in Phase 2.
 */

export const SITE_NAME = 'School Resource Hub';
export const TARGET_SESSION = 'May 2027';

/**
 * Routes. All pages live at the site root, and links are relative, so the site
 * works both at https://user.github.io/repo/ and on a custom domain.
 */
export const ROUTES = {
  home: 'index.html',
  subjects: 'subjects.html',
  subject: 'subject.html',
  library: 'library.html',
  resource: 'resource.html',
  search: 'search.html',
  contribute: 'contribute.html',
  auth: 'auth.html',
  account: 'account.html',
  admin: 'admin.html',
};

/** Primary navigation, in display order. Admin is NOT here: it appears only for admins. */
export const NAV = [
  { key: 'subjects', label: 'Subjects', href: ROUTES.subjects },
  { key: 'library', label: 'Library', href: ROUTES.library },
  { key: 'search', label: 'Search', href: ROUTES.search },
  { key: 'contribute', label: 'Contribute', href: ROUTES.contribute },
];

/** Resource types supported by the platform. Keys match the DB enum (Phase 2). */
export const RESOURCE_TYPES = {
  pdf: { label: 'PDF', description: 'A PDF document you upload' },
  markdown: { label: 'Notes', description: 'Written notes, rendered on the site' },
  link: { label: 'Link', description: 'An external educational website' },
};

/**
 * Level tags. IB content is either core (studied by SL and HL students) or
 * additional higher level (HL students only). Every resource carries one.
 */
export const LEVELS = {
  SL: { label: 'SL & HL', short: 'SL', description: 'Core content, studied by SL and HL students' },
  HL: { label: 'HL only', short: 'HL', description: 'Additional higher level content' },
};

/**
 * Can Supabase send email (custom SMTP set up, docs/email.md)? While false, the site
 * doesn't promise emails: "Forgot password" tells students to ask an administrator,
 * and sign-up doesn't say "check your inbox". Set to true once SMTP works.
 */
export const EMAIL_SENDING = false;

/** Contribution limits. The database and storage policies enforce the same limits (Phase 2). */
export const LIMITS = {
  pdfMaxBytes: 20 * 1024 * 1024,
  titleMin: 5, titleMax: 120,
  descriptionMin: 20, descriptionMax: 1000,
  notesMin: 100, notesMax: 50000,
  tagsMax: 8, tagMaxLength: 30,
};

/** Moderation states. Keys match the DB enum (Phase 2). */
export const STATUSES = {
  pending: { label: 'Pending review' },
  approved: { label: 'Published' },
  rejected: { label: 'Needs changes' },
  removed: { label: 'Unpublished' },
};

/** Build a relative URL with query parameters. */
export function routeUrl(key, params = {}) {
  const base = ROUTES[key] ?? key;
  if (isPreviewMode()) params = { ...params, preview: '1' }; // keep preview across links
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ).toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Preview mode loads clearly-labelled sample resources so layouts can be
 * reviewed before real data exists. It is opt-in per page load (?preview=1)
 * and never active by default.
 */
export function isPreviewMode() {
  return new URLSearchParams(location.search).get('preview') === '1';
}
