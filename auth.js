import { createAuthClient } from '@neondatabase/auth';

const controls = document.querySelector('#account-controls');
const url = import.meta.env.VITE_NEON_AUTH_URL;
const dialog = document.createElement('dialog');
dialog.id = 'account-dialog';
dialog.setAttribute('aria-labelledby', 'account-title');
dialog.innerHTML = `
  <button type="button" class="close" aria-label="Close account window">×</button>
  <p class="eyebrow">YOUR EVERYDAY KITCHEN</p>
  <h2 id="account-title">Welcome back.</h2>
  <p id="account-intro">Log in to your Planted & Plated account.</p>
  <form id="account-form">
    <div id="name-field" hidden><label for="account-name">Your name</label><input id="account-name" name="name" autocomplete="name" maxlength="100"></div>
    <label for="account-email">Email address</label>
    <input id="account-email" name="email" type="email" autocomplete="email" required maxlength="254">
    <label for="account-password">Password</label>
    <input id="account-password" name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128">
    <p id="account-message" role="status" aria-live="polite"></p>
    <button class="btn" id="account-submit" type="submit">Log in →</button>
  </form>
  <button type="button" class="account-link" id="switch-account">New here? Create an account</button>`;
document.body.append(dialog);

const form = dialog.querySelector('form');
const message = dialog.querySelector('#account-message');
const submit = dialog.querySelector('#account-submit');
const email = dialog.querySelector('#account-email');
const password = dialog.querySelector('#account-password');
const name = dialog.querySelector('#account-name');
let mode = 'login';
let busy = false;
let auth;

try {
  if (!url || !url.startsWith('https://') || url.includes('=')) throw new Error('Invalid auth URL');
  auth = createAuthClient(url);
} catch {
  // The public homepage remains usable if deployment configuration is missing.
}

function setMode(next) {
  mode = next;
  const signup = mode === 'signup';
  dialog.querySelector('#account-title').textContent = signup ? 'A place at the table.' : 'Welcome back.';
  dialog.querySelector('#account-intro').textContent = signup ? 'Create your Planted & Plated account.' : 'Log in to your Planted & Plated account.';
  dialog.querySelector('#name-field').hidden = !signup;
  name.required = signup;
  password.autocomplete = signup ? 'new-password' : 'current-password';
  submit.textContent = signup ? 'Create account →' : 'Log in →';
  dialog.querySelector('#switch-account').textContent = signup ? 'Already a member? Log in' : 'New here? Create an account';
  password.value = '';
  message.textContent = '';
}

function open(next) {
  if (busy) return;
  setMode(next);
  dialog.showModal();
  (next === 'signup' ? name : email).focus();
}

function showUser(user) {
  controls.replaceChildren();
  if (!user) {
    for (const [label, next, style] of [['Log in', 'login', 'account-link'], ['Join the kitchen →', 'signup', 'btn']]) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = style; button.textContent = label;
      button.addEventListener('click', () => open(next)); controls.append(button);
    }
    return;
  }
  const greeting = document.createElement('span');
  greeting.className = 'account-greeting';
  greeting.textContent = `Hello, ${user.name || user.email}`;
  const logout = document.createElement('button');
  logout.type = 'button'; logout.className = 'account-link'; logout.textContent = 'Log out';
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      const result = await auth.signOut();
      if (result.error) throw new Error('Sign-out failed');
      showUser(null);
    } catch {
      logout.disabled = false;
      logout.textContent = 'Couldn’t log out. Try again';
    }
  });
  controls.append(greeting, logout);
}

async function refreshSession() {
  if (!auth || busy) return;
  try {
    const result = await auth.getSession();
    if (result.error) return;
    showUser(result.data?.user || null);
  } catch {
    // Do not invent a signed-in state when the service is unreachable.
  }
}

function explain(error) {
  const code = String(error?.code || '');
  if (/ORIGIN|DOMAIN/.test(code)) return 'Login setup needs attention. Please try again later.';
  if (/VERIF/.test(code)) return 'Please verify your email using the link in your inbox, then log in.';
  if (/EXIST|TAKEN/.test(code)) return 'An account with this email may already exist. Try logging in.';
  if (/INVALID_EMAIL_OR_PASSWORD|INVALID_PASSWORD|USER_NOT_FOUND/.test(code)) return 'Check your email and password and try again.';
  if (/RATE|TOO_MANY/.test(code)) return 'Too many attempts. Please wait a moment and try again.';
  return 'We couldn’t complete that request. Check your connection and try again.';
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !form.reportValidity()) return;
  if (!auth) { message.textContent = 'Login is being set up. Please try again later.'; return; }
  if (mode === 'signup' && !name.value.trim()) { name.focus(); return; }
  busy = true;
  for (const field of form.elements) field.disabled = true;
  dialog.querySelector('#switch-account').disabled = true;
  message.textContent = mode === 'signup' ? 'Creating your account…' : 'Logging in…';
  try {
    const credentials = { email: email.value.trim(), password: password.value, callbackURL: window.location.origin + '/' };
    const result = mode === 'signup'
      ? await auth.signUp.email({ ...credentials, name: name.value.trim() })
      : await auth.signIn.email(credentials);
    if (result.error) { message.textContent = explain(result.error); return; }
    const session = await auth.getSession();
    password.value = '';
    if (session.error) { message.textContent = 'Your request was accepted, but we couldn’t check your session. Please try logging in.'; return; }
    if (session.data?.user) {
      showUser(session.data.user);
      dialog.close();
    } else {
      message.textContent = mode === 'signup'
        ? 'Your account was created. Check your inbox for a verification email, then log in.'
        : 'Please check your inbox for a verification email, then try logging in.';
    }
  } catch {
    message.textContent = 'We couldn’t reach the login service. Check your connection and try again.';
  } finally {
    busy = false;
    for (const field of form.elements) field.disabled = false;
    dialog.querySelector('#switch-account').disabled = false;
  }
});

dialog.querySelector('.close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { password.value = ''; });
dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
dialog.querySelector('#switch-account').addEventListener('click', () => setMode(mode === 'login' ? 'signup' : 'login'));
window.addEventListener('focus', refreshSession);
showUser(null);
refreshSession();
