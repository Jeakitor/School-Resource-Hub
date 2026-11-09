/**
 * Shared Supabase client. Loaded lazily, so pages that never touch the backend
 * (and every page while it is not configured) don't download the library.
 *
 * Only services/*.js should import this module.
 */

import { SUPABASE, isSupabaseConfigured } from '../config/supabase.js';

// Pinned exact version; ESM build from jsDelivr.
const SUPABASE_JS_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

let clientPromise = null;

/** Refuse privileged keys: they bypass Row Level Security. */
function assertPublicKey(key) {
  if (/^sb_secret_/.test(key)) {
    throw new Error('A Supabase SECRET key was found in the frontend config. Remove it and rotate it in the dashboard.');
  }
  // Legacy JWT keys: decode the payload and reject service_role.
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.role === 'service_role') {
        throw new Error('A Supabase service_role key was found in the frontend config. Remove it and rotate it in the dashboard.');
      }
    } catch (err) {
      if (/service_role/.test(err.message)) throw err;
    }
  }
}

/** @returns {Promise<import('@supabase/supabase-js').SupabaseClient | null>} null when not configured */
export function getSupabase() {
  if (!isSupabaseConfigured()) return Promise.resolve(null);
  if (!clientPromise) {
    assertPublicKey(SUPABASE.publishableKey);
    clientPromise = import(SUPABASE_JS_URL).then(({ createClient }) =>
      createClient(SUPABASE.url, SUPABASE.publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      }));
  }
  return clientPromise;
}

/** Storage bucket for PDFs (see supabase/migrations/*_storage.sql). */
export const RESOURCE_BUCKET = 'resource-files';
