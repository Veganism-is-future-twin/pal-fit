// Sign-in screen: Google button, optional invite code, dev login on localhost.

import { get, post, setToken } from '../api.js';
import { state, setPref } from '../store.js';
import { GOOGLE_CLIENT_ID, IS_LOCAL } from '../config.js';
import { h, mount, icon, spinner, field } from '../ui.js';
import { renderGoogleButton } from '../auth.js';

export async function renderLogin(view, { onSignedIn }) {
  let pendingCredential = null;   // Google token kept while we ask for an invite code
  let pendingDev = null;

  const status = h('div', { class: 'error-text', role: 'alert' });
  const gsiSlot = h('div', { class: 'gsi-slot' }, spinner(true));
  const busy = h('div', { class: 'row muted', style: 'justify-content:center', hidden: true },
    spinner(true), h('span', null, 'Signing you in…'));
  const inviteInput = h('input', {
    class: 'input', placeholder: 'Invite code', autocomplete: 'off', autocapitalize: 'none',
    spellcheck: 'false', 'aria-label': 'Invite code',
  });
  const inviteBtn = h('button', { class: 'btn block', type: 'submit' }, 'Join the group');
  const inviteBox = h('form', { class: 'card stack-sm', hidden: true },
    h('h3', null, 'Invite code'),
    h('p', { class: 'muted small' }, 'Enter the invite code you got from the group admin.'),
    inviteInput, inviteBtn);

  const setBusy = (on) => { busy.hidden = !on; gsiSlot.style.display = on ? 'none' : ''; };

  async function finish(path, body) {
    status.textContent = '';
    inviteBtn.disabled = true;
    setBusy(true);   // instant feedback while the server signs you in
    try {
      const res = await post(path, body);
      setToken(res.token);
      // Brand-new account → short welcome/onboarding once. Returning people go straight Home.
      if (res.needsOnboarding) setPref('onboard', '1');
      await onSignedIn();
    } catch (err) {
      setBusy(false);
      if (err.code === 'invite_required' || err.code === 'invite_invalid') {
        inviteBox.hidden = false;
        if (err.code === 'invite_invalid') status.textContent = err.message;
        inviteInput.focus();
      } else {
        status.textContent = err.message;
      }
    } finally {
      inviteBtn.disabled = false;
    }
  }

  inviteBox.addEventListener('submit', (e) => {
    e.preventDefault();
    const inviteCode = inviteInput.value.trim();
    if (!inviteCode) { inviteInput.focus(); return; }
    if (pendingCredential) finish('/api/auth/google', { credential: pendingCredential, inviteCode });
    else if (pendingDev) finish('/api/auth/dev', { ...pendingDev, inviteCode });
  });

  const devBox = h('div');

  mount(view,
    h('div', { class: 'login' },
      h('div', { class: 'login-card' },
        h('img', { src: 'icons/pal-logo.png', class: 'login-logo logo', alt: 'Pune Animal Liberation' }),
        h('div', { class: 'stack-sm' },
          h('h1', null, 'PAL Fitness'),
          h('p', { class: 'muted' }, 'The Pune Animal Liberation fitness challenge. Log your day in 30 seconds, get coached, and keep each other going.')),
        h('div', { class: 'feature-list card flat' },
          h('div', null, icon('zap'), h('span', null, 'Quick daily log — mostly taps')),
          h('div', null, icon('sparkle'), h('span', null, 'Personal AI coach and daily score')),
          h('div', null, icon('trophy'), h('span', null, 'Leaderboard and streaks with the group'))),
        gsiSlot,
        busy,
        inviteBox,
        status,
        devBox,
        h('p', { class: 'faint' },
          'Your daily entries are analysed by AI services to give you feedback. You can turn the AI coach off anytime in your profile.'))));

  // Google button — no server round trip needed (client id is public config).
  renderGoogleButton(gsiSlot, GOOGLE_CLIENT_ID, (credential) => {
    pendingCredential = credential;
    pendingDev = null;
    finish('/api/auth/google', { credential });
  }).then(() => gsiSlot.querySelector('.spinner')?.remove())
    .catch((err) => { mount(gsiSlot); status.textContent = err.message; });

  // Local testing only (the server refuses this outside localhost).
  if (IS_LOCAL) {
    try { if (!state.config) state.config = await get('/api/auth/config'); } catch { return; }
    if (!state.config?.devLogin) return;
    const email = h('input', { class: 'input', type: 'email', placeholder: 'test@example.com', value: 'tester@example.com' });
    const name = h('input', { class: 'input', placeholder: 'Name', value: 'Test User' });
    mount(devBox, h('form', {
      class: 'card soft stack-sm',
      onsubmit: (e) => {
        e.preventDefault();
        pendingDev = { email: email.value, name: name.value };
        pendingCredential = null;
        finish('/api/auth/dev', pendingDev);
      },
      style: 'text-align:left',
    }, h('div', { class: 'eyebrow' }, 'Developer login · localhost only'), field('Email', email), field('Name', name),
    h('button', { class: 'btn secondary block' }, 'Sign in for testing')));
  }
}
