/**
 * Supabase connection settings — PUBLIC values only.
 *
 * Fill these in from Supabase Dashboard → Project Settings → API:
 *   url            : https://<project-ref>.supabase.co
 *   publishableKey : the key starting with  sb_publishable_
 *
 * These are safe to commit: they ship to every visitor's browser anyway, and all
 * access is controlled by Row Level Security (see docs/security.md).
 *
 * NEVER put an  sb_secret_  key, a  service_role  key or the database password
 * here or anywhere else in this repository. services/supabase.js refuses to start
 * if it detects one.
 */
export const SUPABASE = {
  url: 'https://xxchnhjydpsxizzjpcfy.supabase.co',
  publishableKey: 'sb_publishable_sEq3TTFUSkVVOvYz2Z-qrA_pl7XmueB',
};

export function isSupabaseConfigured() {
  return Boolean(SUPABASE.url && SUPABASE.publishableKey);
}
