/**
 * Auth service — the only module that talks to Supabase Auth.
 *
 * Roles returned here are for SHOWING the right UI only. Every permission is
 * enforced by the database (RLS + triggers); a user who edits this code gains nothing.
 */

import { getSupabase } from './supabase.js';

/** Absolute URL of a page next to the current one (works locally and on GitHub Pages). */
function pageUrl(path) {
  return new URL(path, location.href).href;
}

/** Turn Supabase errors into messages a student can act on. */
export function friendlyError(err) {
  const msg = err?.message ?? String(err);
  if (/invalid login credentials/i.test(msg)) return 'That email and password do not match an account.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox (and spam folder) for the link.';
  if (/user already registered/i.test(msg)) return 'An account with this email already exists. Try signing in or resetting your password.';
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a few minutes and try again.';
  if (/password should be|weak password/i.test(msg)) return 'Please choose a stronger password (at least 10 characters).';
  if (/same.*password|different from the old/i.test(msg)) return 'Your new password must be different from the old one.';
  if (/failed to fetch|network/i.test(msg)) return 'Could not reach the server. Check your connection and try again.';
  return msg;
}

async function client() {
  const sb = await getSupabase();
  if (!sb) throw new Error('Accounts are not configured on this site yet.');
  return sb;
}

export async function getSession() {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session;
}

/** Calls fn(event, session) on sign-in, sign-out, token refresh and PASSWORD_RECOVERY. */
export async function onAuthChange(fn) {
  const sb = await getSupabase();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((event, session) => fn(event, session));
  return () => data.subscription.unsubscribe();
}

export async function signUp({ email, password, displayName }) {
  const sb = await client();
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName }, // only display_name is read by the database
      emailRedirectTo: pageUrl('auth.html?mode=login&confirmed=1'),
    },
  });
  if (error) throw error;
  // With email confirmation on, there is a user but no session until they click the link.
  return { needsConfirmation: !data.session };
}

export async function signIn({ email, password }) {
  const sb = await client();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut() {
  const sb = await client();
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

export async function requestPasswordReset(email) {
  const sb = await client();
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: pageUrl('auth.html?mode=update') });
  if (error) throw error;
}

export async function updatePassword(password) {
  const sb = await client();
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
}

/**
 * Current user's profile + roles, or null when signed out.
 * @returns {{ id, email, displayName, roles: string[], isAdmin, isTeacher, teacherSubjects: number[] } | null}
 */
export async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;
  const sb = await client();
  const uid = session.user.id;

  const [profile, roles, subjects] = await Promise.all([
    sb.from('profiles').select('display_name, created_at').eq('id', uid).maybeSingle(),
    sb.from('user_roles').select('role').eq('user_id', uid),
    sb.from('teacher_subjects').select('subject_id').eq('user_id', uid),
  ]);
  for (const r of [profile, roles, subjects]) if (r.error) throw r.error;

  const roleList = roles.data.map((r) => r.role);
  return {
    id: uid,
    email: session.user.email,
    displayName: profile.data?.display_name ?? 'Student',
    joined: profile.data?.created_at ?? session.user.created_at,
    roles: roleList,
    isAdmin: roleList.includes('admin'),
    isTeacher: roleList.includes('teacher'),
    teacherSubjects: subjects.data.map((s) => s.subject_id),
  };
}

export async function updateDisplayName(name) {
  const session = await getSession();
  if (!session) throw new Error('Please sign in first.');
  const sb = await client();
  const { error } = await sb.from('profiles').update({ display_name: name.trim() }).eq('id', session.user.id);
  if (error) throw error;
}
