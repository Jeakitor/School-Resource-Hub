/**
 * Sign in / register / forgot password / set new password.
 * URL: auth.html?mode=login|register|reset|update
 * Client-side validation is for helpfulness; Supabase Auth re-validates everything.
 */

import { mountShell } from '../components/shell.js';
import { h, $, replaceChildren } from '../utils/dom.js';
import { getParams, setParams } from '../utils/url.js';
import { routeUrl, ROUTES, EMAIL_SENDING } from '../config/site.js';
import { field, setError, input } from '../components/forms.js';
import {
  signIn, signUp, requestPasswordReset, updatePassword, getSession, onAuthChange, friendlyError,
} from '../services/auth.js';

mountShell({});
const main = $('#main');
const params = getParams(['mode', 'next', 'confirmed']);
let { mode } = params;
if (!['login', 'register', 'reset', 'update'].includes(mode)) mode = 'login';
const confirmed = params.confirmed === '1';

// Where to go after signing in. Only our own page names are accepted (no open redirects).
const next = () => (Object.values(ROUTES).includes(params.next) ? params.next : routeUrl('account'));

// A password-reset link signs the user in with a temporary "recovery" session.
let recovering = false;
onAuthChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    recovering = true;
    if (mode !== 'update') { mode = 'update'; setParams({ mode }); render(); }
  }
});

// Already signed in? Sign-in and register pages send you on.
if (mode === 'login' || mode === 'register') {
  const session = await getSession();
  if (session) location.replace(next());
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 10;

const MODES = {
  login: { title: 'Sign in', lede: 'Welcome back.', submit: 'Sign in' },
  register: { title: 'Create an account', lede: 'Free, and only needed to contribute. Browsing never requires an account.', submit: 'Create account' },
  reset: { title: 'Reset your password', lede: 'Enter your email and we will send you a link to choose a new password.', submit: 'Send reset link' },
  update: { title: 'Choose a new password', lede: 'You followed a password reset link. Choose a new password below.', submit: 'Save new password' },
};

render();

function render() {
  const m = MODES[mode];
  document.title = `${m.title} · School Resource Hub`;
  const status = h('div', { 'aria-live': 'assertive' });

  const name = input({ autocomplete: 'nickname', maxlength: 40, placeholder: 'How your name appears on contributions' });
  const email = input({ type: 'email', autocomplete: 'email', inputmode: 'email' });
  const password = input({ type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password' });
  const confirm = input({ type: 'password', autocomplete: 'new-password' });

  // Builders, not elements: each control can only live in one place in the DOM.
  const fields = {
    login: () => [field({ label: 'Email', control: email }), field({ label: 'Password', control: password })],
    register: () => [
      field({ label: 'Display name', control: name, hint: 'Shown on resources you contribute. You can use a first name or nickname.' }),
      field({ label: 'Email', control: email, hint: EMAIL_SENDING ? 'Used to sign in and to reset your password. Never shown publicly.' : 'Use your school email. It is your sign-in name and is never shown publicly.' }),
      field({ label: 'Password', control: password, hint: `At least ${PASSWORD_MIN} characters.` }),
      field({ label: 'Confirm password', control: confirm }),
    ],
    reset: () => [field({ label: 'Email', control: email })],
    update: () => [
      field({ label: 'New password', control: password, hint: `At least ${PASSWORD_MIN} characters.` }),
      field({ label: 'Confirm new password', control: confirm }),
    ],
  }[mode]();

  function validate() {
    const errs = [];
    const check = (c, msg) => { setError(c, msg); if (msg) errs.push(c); };
    if (mode === 'register') {
      const n = name.value.trim();
      check(name, n.length < 2 ? 'Enter a display name of at least 2 characters.' : '');
    }
    if (mode !== 'update') check(email, EMAIL_RE.test(email.value.trim()) ? '' : 'Enter a valid email address.');
    if (mode === 'login') check(password, password.value ? '' : 'Enter your password.');
    if (mode === 'register' || mode === 'update') {
      check(password, password.value.length < PASSWORD_MIN ? `Use at least ${PASSWORD_MIN} characters.` : '');
      check(confirm, confirm.value !== password.value ? 'Passwords do not match.' : '');
    }
    return errs;
  }

  const submitBtn = h('button', { class: 'btn btn--primary btn--lg', type: 'submit' }, m.submit);
  const say = (kind, text) => replaceChildren(status,
    h('p', { class: `notice notice--${kind}`, role: kind === 'error' ? 'alert' : 'status', style: 'margin-top: var(--sp-4)' }, text));

  const form = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const errs = validate();
      if (errs.length) { errs[0].focus(); replaceChildren(status); return; }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Please wait…';
      try {
        if (mode === 'login') {
          await signIn({ email: email.value.trim(), password: password.value });
          location.href = next();
          return;
        }
        if (mode === 'register') {
          const { needsConfirmation } = await signUp({ email: email.value.trim(), password: password.value, displayName: name.value.trim() });
          if (!needsConfirmation) { location.href = next(); return; }
          form.reset();
          say('info', 'Almost done: we have sent a confirmation link to your email. Open it to activate your account, then sign in.');
        }
        if (mode === 'reset') {
          await requestPasswordReset(email.value.trim());
          say('info', 'If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.');
        }
        if (mode === 'update') {
          await updatePassword(password.value);
          say('info', 'Your password has been changed.');
          setTimeout(() => { location.href = routeUrl('account'); }, 1200);
        }
      } catch (err) {
        say('error', friendlyError(err));
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = m.submit;
      }
    },
  },
  fields,
  h('div', { class: 'form-actions' }, submitBtn),
  status);

  if (mode === 'update' && !recovering) {
    getSession().then((s) => {
      if (!s) say('warn', 'This link has expired or was already used. Request a new reset link from the sign-in page.');
    });
  }
  if (confirmed && mode === 'login') say('info', 'Your email is confirmed. You can sign in now.');

  const tab = (key, label) => h('a', {
    href: routeUrl('auth', { mode: key }), role: 'tab', 'aria-selected': String(mode === key),
    onclick: (e) => { e.preventDefault(); mode = key; setParams({ mode: key }); render(); },
  }, label);

  // Without email sending, password resets are done by an administrator in person.
  const noEmailReset = mode === 'reset' && !EMAIL_SENDING;

  replaceChildren(main, h('div', { class: 'container' }, h('div', { class: 'auth-wrap' },
    (mode === 'login' || mode === 'register')
      ? h('div', { class: 'tabs', role: 'tablist' }, tab('login', 'Sign in'), tab('register', 'Create account'))
      : null,
    h('h1', null, m.title),
    noEmailReset
      ? h('p', { class: 'notice notice--info' },
        'Password reset emails are not available yet. Ask a site administrator (the CAS team) in person: they will set a temporary password for you, which you can change from your account page after signing in.')
      : h('p', null, m.lede),
    noEmailReset ? null : form,
    h('p', { class: 'auth-alt' },
      mode === 'login' ? h('a', { href: routeUrl('auth', { mode: 'reset' }), onclick: (e) => { e.preventDefault(); mode = 'reset'; setParams({ mode }); render(); } }, 'Forgot your password?')
        : mode === 'reset' ? h('a', { href: routeUrl('auth', { mode: 'login' }), onclick: (e) => { e.preventDefault(); mode = 'login'; setParams({ mode }); render(); } }, 'Back to sign in')
        : mode === 'register' ? 'We only ask for what is needed: a display name, an email and a password.'
        : null),
  )));
}
