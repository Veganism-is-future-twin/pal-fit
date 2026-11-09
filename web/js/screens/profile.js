// Profile: plan, history & charts, weigh-ins, details, settings, install, logout.

import { get, post, patch } from '../api.js';
import { state, refreshMe, isAdmin, pref, setPref } from '../store.js';
import {
  h, mount, icon, avatar, segmented, switchField, field, toast, lineChart, scoreRing,
  fmtInt, fmtDate, disclaimer, loadingView, spinner,
} from '../ui.js';
import { installCard } from '../install.js';
import { googleSignOut } from '../auth.js';
import { planBlock, MEAL_TAG_LABELS } from './common.js';
import { profileForm, GOALS } from './profile-form.js';
import { signOut } from '../app.js';

export async function renderProfile(view, { go }) {
  const me = await refreshMe();
  const timers = [];
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

  // ------------------------------------------------------------ plan
  const planCard = h('div', { class: 'card' });
  const drawPlan = (plan, updating = false) => {
    const regen = h('button', { class: 'btn ghost sm' }, icon('refresh'), 'New plan');
    regen.addEventListener('click', async () => {
      regen.disabled = true;
      try {
        const r = await post('/api/me/plan/regenerate');
        waitForPlan(r.previousPlanId);
      } catch (e) { toast(e.message, { error: true }); regen.disabled = false; }
    });
    mount(planCard,
      h('div', { class: 'card-title' }, icon('sparkle'), h('h2', { class: 'grow' }, 'My plan'), !updating && regen),
      updating ? h('div', { class: 'row muted' }, spinner(true), 'Preparing your personal plan…') : null,
      plan ? planBlock(plan) : (!updating && h('div', { class: 'stack-sm' },
        planBlock(null, me.targets),
        h('p', { class: 'muted small' }, me.profile ? 'Your personal plan will appear here.' : 'Fill in "My details" below to get a personal plan.'))),
      plan?.provider && h('p', { class: 'faint mt-8' }, plan.provider === 'rules' ? 'Standard plan (AI unavailable or off)' : 'Created by your AI coach'),
      disclaimer());
  };
  const waitForPlan = (prevId) => {
    drawPlan(me.plan, true);
    const started = Date.now();
    const poll = async () => {
      try {
        const { plan } = await get('/api/me/plan');
        if (plan && plan.id !== prevId) { me.plan = plan; drawPlan(plan); toast('Your plan is ready'); return; }
      } catch { /* retry */ }
      if (Date.now() - started < 45000) timers.push(setTimeout(poll, 2500));
      else { drawPlan(me.plan); toast('Plan is taking a while — check back in a minute.'); }
    };
    timers.push(setTimeout(poll, 2500));
  };
  drawPlan(me.plan);

  // ------------------------------------------------------------ history
  const historyCard = h('div', { class: 'card' }, h('div', { class: 'card-title' }, icon('chart'), h('h2', null, 'Last 30 days')), loadingView());
  loadHistory(historyCard, me);

  // ------------------------------------------------------------ weight
  const weightCard = h('div', { class: 'card' });
  loadWeights(weightCard);

  // ------------------------------------------------------------ details
  const details = h('details', { class: 'card more' },
    h('summary', null, h('span', { class: 'row' }, icon('user'), h('b', null, 'My details'))),
    h('div', { class: 'mt-8' }, profileForm(me.profile, {
      onSaved: async (res) => {
        await refreshMe();
        if (res.planUpdating) waitForPlan(res.previousPlanId);
        details.open = false;
        planCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    })));
  if (!me.profile) details.open = true;

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
    head, planCard, historyCard, h('div', { class: 'grid-2' }, weightCard, installCard()), details, settings, adminLink,
    h('div', { class: 'footer-note' }, 'PAL Fitness · Pune Animal Liberation · Personhood for all animals')));

  return () => timers.forEach(clearTimeout);
}

// ---------------------------------------------------------------- history
async function loadHistory(card, me) {
  const today = me.today;
  const from = new Date(Date.parse(today + 'T00:00:00Z') - 29 * 86400e3).toISOString().slice(0, 10);
  try {
    const { logs } = await get(`/api/logs?from=${from}&to=${today}`);
    const byDate = new Map(logs.map((l) => [l.date, l]));
    const days = [];
    for (let i = 29; i >= 0; i--) days.push(new Date(Date.parse(today + 'T00:00:00Z') - i * 86400e3).toISOString().slice(0, 10));
    const labels = days.map((d) => fmtDate(d, { day: 'numeric', month: 'short' }));

    const METRICS = {
      score: { label: 'Score', color: 'var(--ink)', get: (l) => l?.score ?? null, min: 0, max: 100 },
      steps: { label: 'Steps', color: 'var(--effort)', get: (l) => l?.steps ?? null, min: 0 },
      sleep: { label: 'Sleep', color: 'var(--sleep)', get: (l) => l?.sleep_h ?? null, min: 0, max: 12, unit: ' h' },
      water: { label: 'Water', color: 'var(--water)', get: (l) => l?.water_l ?? null, min: 0, max: 4, unit: ' L' },
    };
    let metric = 'score';
    const chartBox = h('div', { class: 'mt-8' });
    const drawChart = () => {
      const m = METRICS[metric];
      mount(chartBox, lineChart({
        labels, values: days.map((d) => m.get(byDate.get(d))), color: m.color, min: m.min, max: m.max,
        unit: m.unit || '', width: chartBox.clientWidth,
      }));
    };

    const list = h('div', { class: 'history-list' }, logs.length ? logs.map((l) => historyItem(l)) : h('p', { class: 'muted' }, 'No days logged yet.'));

    mount(card,
      h('div', { class: 'card-title' }, icon('chart'), h('h2', { class: 'grow' }, 'Last 30 days'),
        h('span', { class: 'faint' }, `${logs.length}/30 logged`)),
      segmented(Object.entries(METRICS).map(([value, m]) => ({ value, label: m.label })), metric, (v) => { metric = v; drawChart(); }),
      chartBox,
      h('details', { class: 'more mt-8' }, h('summary', null, 'Day by day'), list));
    drawChart();   // after mounting, so the chart knows its real width
  } catch (e) {
    mount(card, h('p', { class: 'muted' }, "Couldn't load history: " + e.message));
  }
}

function historyItem(l) {
  const d = new Date(l.date + 'T12:00:00');
  const mealTags = [...new Set(l.meals.flatMap((m) => m.tags))].slice(0, 3);
  return h('details', { class: 'history-item' },
    h('summary', null,
      h('div', { class: 'date' }, h('b', null, String(d.getDate())), h('span', null, d.toLocaleDateString('en-IN', { month: 'short' }))),
      h('div', { class: 'grow small' },
        h('div', { class: 'num' }, `${fmtInt(l.steps)} steps · ${l.water_l ?? '–'} L · ${l.sleep_h ?? '–'} h sleep`),
        h('div', { class: 'faint' }, mealTags.map((t) => MEAL_TAG_LABELS[t]).join(', ') || 'No meal tags', l.locked ? ' · final' : '')),
      scoreRing(l.score, { small: true })),
    l.feedback && h('p', { class: 'small muted mt-8', style: 'padding-left:56px' }, l.feedback));
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
      draw((await get('/api/weight')).weights);
    } catch (err) { toast(err.message, { error: true }); }
    btn.disabled = false;
  });

  mount(card, h('div', { class: 'card-title' }, icon('scale'), h('h2', null, 'Weekly weigh-in')), form, h('div', { class: 'mt-8' }, chartBox));
  try { draw((await get('/api/weight')).weights); } catch { draw([]); }
}
