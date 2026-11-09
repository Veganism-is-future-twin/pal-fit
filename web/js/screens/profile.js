// Profile: who you are, your details, weigh-ins, app settings, install, sign out.
// (Your plan and progress charts live on Home.)

import { get, post, patch } from '../api.js';
import { state, refreshMe, isAdmin, pref, setPref, swr, putCache } from '../store.js';
import { h, mount, icon, avatar, segmented, switchField, field, toast, lineChart, fmtDate } from '../ui.js';
import { installCard } from '../install.js';
import { googleSignOut } from '../auth.js';
import { profileForm, GOALS } from './profile-form.js';
import { signOut } from '../app.js';

export async function renderProfile(view, { go }) {
  // Speed: use what we already have; only fetch if nothing is loaded yet.
  const me = state.me || await refreshMe();
  const user = me.user;

  // ------------------------------------------------------------ header
  const goal = GOALS.find((g) => g.value === me.profile?.goal);
  const head = h('div', { class: 'card profile-head' },
    avatar(user.displayName, user.photoUrl, 'xl'),
    h('div', { class: 'grow', style: 'min-width:0' },
      h('h1', { style: 'overflow-wrap:anywhere' }, user.displayName),
      h('p', { class: 'muted small', style: 'overflow-wrap:anywhere' }, user.email),
      h('div', { class: 'row-wrap mt-8' },
        goal && h('span', { class: 'tag good' }, goal.label),
        h('span', { class: 'tag' }, icon('flame'), `${me.streak} streak`),
        h('span', { class: 'tag' }, icon('calendar'), `${me.totalDaysLogged} day${me.totalDaysLogged === 1 ? '' : 's'}`),
        user.role === 'admin' && h('span', { class: 'tag ink' }, 'Admin'))));

  // ------------------------------------------------------------ details
  const details = h('div', { class: 'card' },
    h('div', { class: 'card-title' }, icon('user'), h('h2', null, 'My details')),
    profileForm(me.profile, {
      onSaved: async (res) => {
        await refreshMe();
        if (res.planUpdating) toast('Saved. Your personal plan is being updated — see Home.', { ms: 4500 });
      },
    }));

  // ------------------------------------------------------------ weight
  const weightCard = h('div', { class: 'card' });
  loadWeights(weightCard);

  // ------------------------------------------------------------ settings
  const nameInput = h('input', { class: 'input', maxlength: 40, value: user.displayName });
  const saveName = h('button', { class: 'btn secondary', type: 'submit' }, 'Save');
  const nameForm = h('form', { class: 'input-row' }, nameInput, saveName);
  nameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await patch('/api/me', { displayName: nameInput.value }); await refreshMe(); toast('Name updated'); }
    catch (err) { toast(err.message, { error: true }); }
  });

  const theme = pref('theme', 'auto');
  const settings = h('div', { class: 'card stack' },
    h('div', { class: 'card-title' }, icon('key'), h('h2', null, 'Settings')),
    field('Display name', nameForm),
    switchField('AI coach', user.aiEnabled, async (on) => {
      try { await patch('/api/me', { aiEnabled: on }); await refreshMe(); toast(on ? 'AI coach on' : 'AI coach off'); }
      catch (err) { toast(err.message, { error: true }); }
    }, 'Personal AI score, feedback, plan and chat. When off, you get a simple automatic score.'),
    field('Theme', segmented([
      { value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' },
    ], theme, (v) => {
      setPref('theme', v === 'auto' ? null : v);
      if (v === 'auto') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = v;
    })),
    h('button', {
      class: 'btn danger block', onclick: async () => {
        try { await post('/api/auth/logout'); } catch { /* sign out locally anyway */ }
        googleSignOut();
        signOut();
      },
    }, icon('logout'), 'Sign out'));

  const adminLink = isAdmin() ? h('button', { class: 'btn secondary block', onclick: () => go('admin') }, icon('shield'), 'Admin tools') : null;

  mount(view, h('div', { class: 'stack' },
    head, details, h('div', { class: 'grid-2' }, weightCard, installCard()), settings, adminLink,
    h('div', { class: 'footer-note' }, 'PAL Fitness · Pune Animal Liberation · Personhood for all animals')));
}

// ---------------------------------------------------------------- weight
async function loadWeights(card) {
  const input = h('input', { class: 'input', type: 'number', inputmode: 'decimal', min: 20, max: 300, step: 0.1, placeholder: 'kg' });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Save');
  const chartBox = h('div');
  const form = h('form', { class: 'input-row' }, input, btn);

  const draw = (weights) => {
    if (weights.length >= 2) {
      mount(chartBox, lineChart({
        labels: weights.map((w) => fmtDate(w.log_date, { day: 'numeric', month: 'short' })),
        values: weights.map((w) => w.weight_kg), color: 'var(--water)', unit: ' kg',
        min: Math.floor(Math.min(...weights.map((w) => w.weight_kg)) - 2),
        max: Math.ceil(Math.max(...weights.map((w) => w.weight_kg)) + 2), height: 150, width: chartBox.clientWidth,
      }));
    } else if (weights.length === 1) {
      mount(chartBox, h('p', { class: 'muted small' }, `Last: ${weights[0].weight_kg} kg on ${fmtDate(weights[0].log_date)}`));
    } else {
      mount(chartBox, h('p', { class: 'faint' }, 'Weigh in once a week (same time of day) to see your trend. Private to you.'));
    }
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!input.value) return input.focus();
    btn.disabled = true;
    try {
      await post('/api/weight', { weight_kg: input.value });
      input.value = '';
      toast('Weight saved');
      const fresh = await get('/api/weight');
      putCache('/api/weight', fresh);
      draw(fresh.weights);
    } catch (err) { toast(err.message, { error: true }); }
    btn.disabled = false;
  });

  mount(card, h('div', { class: 'card-title' }, icon('scale'), h('h2', null, 'Weekly weigh-in')), form, h('div', { class: 'mt-8' }, chartBox));
  try { await swr('/api/weight', (d) => draw(d.weights)); } catch { draw([]); }
}
