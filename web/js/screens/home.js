// Home: greeting, today, coach feedback, progress charts, streak, group, plan.
//
// Speed: draws instantly from the last saved data on this device, then
// refreshes from the server in the background and redraws only if something changed.

import { get, post } from '../api.js';
import { state, refreshMe, pref, setPref } from '../store.js';
import {
  h, mount, icon, avatar, scoreRing, greetingWord, firstName, fmtDate, fmtInt, segmented,
  lineChart, barChart, progressBars, toast, spinner, disclaimer,
} from '../ui.js';
import { installBanner } from '../install.js';
import { coachCard, mealsLogged, planBlock } from './common.js';

const scoreColor = (v) => (v >= 75 ? 'var(--good)' : v >= 50 ? 'var(--warn)' : 'var(--danger)');
let trendMetric = 'score';   // remembered while the app is open

export async function renderHome(view, { go }) {
  let stops = [];
  let lastJson = null;
  let timers = [];

  const draw = (me) => {
    const json = JSON.stringify(me);
    if (json === lastJson) return;          // nothing changed — keep the page as is
    lastJson = json;
    stops.forEach((s) => s()); stops = [];
    mount(view, buildHome(me, { go, stops, timers }));
    drawCharts(view, me);
  };

  const fresh = state.me && Date.now() - state.meAt < 15000;
  if (state.me) draw(state.me);
  if (!fresh) {
    try { draw(await refreshMe()); } catch (e) { if (!state.me) throw e; }
  }

  // Redraw charts when the window size changes (e.g. phone rotated).
  let rt;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(() => state.me && drawCharts(view, state.me), 150); };
  window.addEventListener('resize', onResize);

  return () => {
    stops.forEach((s) => s());
    timers.forEach(clearTimeout);
    window.removeEventListener('resize', onResize);
  };
}

// ---------------------------------------------------------------------------
function buildHome(me, { go, stops, timers }) {
  const { user, todayLog, yesterdayLog, streak, targets, challenge } = me;

  // --- greeting
  const greeting = h('div', { class: 'greeting' },
    avatar(user.displayName, user.photoUrl, 'lg'),
    h('div', { class: 'grow' },
      h('div', { class: 'eyebrow' }, fmtDate(me.today, { weekday: 'long', day: 'numeric', month: 'long' })),
      h('h1', null, `${greetingWord()}, ${firstName(user.displayName)}`)));

  // --- challenge
  let challengeEl = null;
  if (challenge && !challenge.ended) {
    const pct = challenge.started ? Math.round((challenge.day / challenge.totalDays) * 100) : 0;
    challengeEl = h('div', { class: 'card' },
      h('div', { class: 'spread' },
        h('div', { class: 'row', style: 'gap:10px' }, icon('flag'), h('b', null, challenge.name)),
        h('span', { class: 'faint num' }, challenge.started ? `Day ${challenge.day} of ${challenge.totalDays}` : `Starts ${fmtDate(challenge.startDate)}`)),
      h('div', { class: 'progress' }, h('div', { style: `width:${pct}%` })));
  }

  // --- today
  let todayEl;
  if (!todayLog) {
    todayEl = h('div', { class: 'card stack' },
      h('div', { class: 'row' },
        h('div', { class: 'big-icon' }, icon('note')),
        h('div', { class: 'grow' }, h('h2', null, "Today isn't logged yet"),
          h('p', { class: 'muted small' }, 'About 30 seconds — mostly taps.'))),
      h('button', { class: 'btn block lg', onclick: () => go('log') }, icon('plus'), 'Log today'));
  } else {
    todayEl = h('div', { class: 'card stack' },
      h('div', { class: 'row' },
        scoreRing(todayLog.score, { label: 'TODAY' }),
        h('div', { class: 'grow' },
          h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, h('h2', null, 'Today is logged'), h('span', { class: 'tag good' }, icon('check'), 'Saved')),
          h('p', { class: 'muted small' }, `${mealsLogged(todayLog)} of 3 meals · editable until midnight`))),
      progressBars([
        { label: 'Steps', value: todayLog.steps, target: targets.steps_target, color: 'var(--effort)', format: fmtInt },
        { label: 'Water', value: todayLog.water_l, target: targets.water_target_l, unit: ' L', color: 'var(--water)' },
        { label: 'Sleep', value: todayLog.sleep_h, target: targets.sleep_target_h, unit: ' h', color: 'var(--sleep)' },
        { label: 'Workout', value: todayLog.workout_done ? (todayLog.workout_min || 0) : 0, target: targets.workout_target_min, unit: ' min', color: 'var(--good)' },
      ]),
      h('button', { class: 'btn secondary block', onclick: () => go('log') }, icon('edit'), 'Update today'));
  }

  // --- coach feedback
  let coachEl = null;
  if (todayLog?.feedback || todayLog?.gradeStatus === 'pending') {
    const c = coachCard(todayLog, {
      title: 'Coach feedback',
      onUpdate: (l) => {
        if (state.me) state.me.todayLog = l;
        const ring = todayEl.querySelector('.score-ring');
        if (ring) ring.replaceWith(scoreRing(l.score, { label: 'TODAY' }));
      },
    });
    stops.push(c.stop);
    coachEl = c.el;
  }

  // --- this week (bar chart + KPIs)
  const weekEl = h('div', { class: 'card' },
    h('div', { class: 'card-title' }, icon('chart'), h('h2', { class: 'grow' }, 'Last 7 days')),
    h('div', { class: 'chart-slot', 'data-chart': 'week' }),
    h('div', { class: 'kpis mt-16', 'data-kpis': 'week' }));

  // --- 30-day trends (line chart with metric switch + target line)
  const trendEl = h('div', { class: 'card' },
    h('div', { class: 'card-title' }, icon('chart'), h('h2', { class: 'grow' }, 'Last 30 days'),
      h('span', { class: 'faint', 'data-count': '30' })),
    segmented([
      { value: 'score', label: 'Score' }, { value: 'steps', label: 'Steps' },
      { value: 'sleep', label: 'Sleep' }, { value: 'water', label: 'Water' },
    ], trendMetric, (v) => { trendMetric = v; drawTrend(trendEl, me); }),
    h('div', { class: 'chart-slot mt-8', 'data-chart': 'trend' }));

  // --- streak
  const toBonus = 7 - (streak % 7);
  const streakEl = h('div', { class: 'card streak-card' },
    h('div', { class: 'big-icon' + (streak > 0 ? ' good' : '') }, icon('flame')),
    h('div', { class: 'grow' },
      h('div', { class: 'streak-num' }, `${streak} day${streak === 1 ? '' : 's'}`),
      h('p', { class: 'muted small' }, streak === 0 ? 'Log today to start a streak.'
        : !todayLog ? 'Log today to keep your streak.'
          : streak % 7 === 0 ? 'Weekly streak bonus earned.' : `${toBonus} more day${toBonus === 1 ? '' : 's'} to a +10 bonus`)),
    h('div', { class: 'center' }, h('div', { class: 'num', style: 'font-weight:700;font-size:1.15rem' }, String(me.totalDaysLogged)), h('div', { class: 'faint' }, 'days logged')));

  let yesterdayEl = null;
  if (yesterdayLog) {
    yesterdayEl = h('div', { class: 'card' },
      h('div', { class: 'card-title' }, icon('calendar'), h('h2', { class: 'grow' }, 'Yesterday'),
        scoreRing(yesterdayLog.score, { small: true })),
      yesterdayLog.feedback ? h('p', { class: 'coach-text muted small' }, yesterdayLog.feedback) : null,
      h('p', { class: 'faint mt-8' }, yesterdayLog.locked ? 'Final score' : 'Final score locks at midnight.'));
  }

  // --- who logged today
  const whoEl = h('div', { class: 'card' },
    h('div', { class: 'card-title' }, icon('users'), h('h2', { class: 'grow' }, 'Logged today'),
      h('a', { href: '#/board', class: 'small' }, 'Leaderboard')),
    h('div', { class: 'skeleton' }));
  get('/api/today/status').then((s) => {
    const done = s.people.filter((p) => p.logged);
    const notYet = s.people.filter((p) => !p.logged);
    whoEl.lastChild.replaceWith(h('div', { class: 'stack-sm' },
      h('p', { class: 'small muted' }, `${done.length} of ${s.people.length} members`),
      h('div', { class: 'avatar-row' },
        ...done.map((p) => h('span', { title: p.name }, avatar(p.name, p.photoUrl, 'sm'))),
        ...notYet.map((p) => h('span', { title: `${p.name} (not yet)` }, avatar(p.name, p.photoUrl, 'sm', 'dim'))))));
  }).catch(() => whoEl.lastChild.replaceWith(h('p', { class: 'faint' }, "Couldn't load right now.")));

  // --- my plan (collapsed)
  const planEl = planCard(me, timers);

  // --- install banner (until dismissed)
  let installEl = null;
  if (!pref('installDismissed')) {
    installEl = installBanner(() => { setPref('installDismissed', '1'); installEl?.remove(); });
  }

  const nudge = !me.profile ? h('a', { href: '#/profile', class: 'banner warn', style: 'text-decoration:none;color:inherit' },
    icon('info'), h('div', { class: 'grow small' }, h('b', null, 'Complete your profile'), h('br'),
      'Add your goal so the coach can personalise your targets and scores.')) : null;

  return h('div', { class: 'stack' },
    greeting, challengeEl, nudge, todayEl, coachEl,
    h('div', { class: 'grid-2' }, streakEl, yesterdayEl || whoEl),
    weekEl, trendEl,
    yesterdayEl ? whoEl : null,
    planEl, installEl);
}

// ---------------------------------------------------------------------------
// Charts (drawn after mounting so they know their real width)
// ---------------------------------------------------------------------------
function lastNDates(today, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.parse(today + 'T00:00:00Z') - i * 86400e3).toISOString().slice(0, 10));
  return out;
}

function drawCharts(view, me) {
  const byDate = new Map((me.recent || []).map((r) => [r.date, r]));
  // Today's log may be newer than `recent` (just saved).
  if (me.todayLog) byDate.set(me.today, { ...byDate.get(me.today), date: me.today, score: me.todayLog.score, steps: me.todayLog.steps, water_l: me.todayLog.water_l, sleep_h: me.todayLog.sleep_h });

  // Week bars
  const weekSlot = view.querySelector('[data-chart="week"]');
  if (weekSlot) {
    const days = lastNDates(me.today, 7);
    const values = days.map((d) => byDate.get(d)?.score ?? null);
    weekSlot.replaceChildren(barChart({
      labels: days.map((d) => (d === me.today ? 'Today' : new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short' }))),
      values, max: 100, colorFor: scoreColor, width: weekSlot.clientWidth,
    }));
    const logged = values.filter((v) => v != null);
    const avg = logged.length ? Math.round(logged.reduce((a, b) => a + b, 0) / logged.length) : null;
    const points = logged.reduce((a, v) => a + 20 + Math.round(v * 0.8), 0);
    const kpi = (v, k) => h('div', { class: 'kpi' }, h('div', { class: 'v' }, v), h('div', { class: 'k' }, k));
    view.querySelector('[data-kpis="week"]')?.replaceChildren(
      kpi(`${logged.length}/7`, 'days logged'),
      kpi(avg == null ? '–' : String(avg), 'average score'),
      kpi(fmtInt(points), 'points (approx.)'));
  }

  const trendEl = view.querySelector('[data-chart="trend"]')?.closest('.card');
  if (trendEl) drawTrend(trendEl, me, byDate);
}

function drawTrend(card, me, byDate) {
  byDate = byDate || new Map((me.recent || []).map((r) => [r.date, r]));
  const slot = card.querySelector('[data-chart="trend"]');
  const days = lastNDates(me.today, 30);
  const t = me.targets || {};
  const METRICS = {
    score: { get: (r) => r?.score, color: 'var(--ink)', min: 0, max: 100 },
    steps: { get: (r) => r?.steps, color: 'var(--effort)', min: 0, target: t.steps_target },
    sleep: { get: (r) => r?.sleep_h, color: 'var(--sleep)', min: 0, max: 12, unit: ' h', target: t.sleep_target_h },
    water: { get: (r) => r?.water_l, color: 'var(--water)', min: 0, unit: ' L', target: t.water_target_l },
  };
  const m = METRICS[trendMetric];
  const values = days.map((d) => m.get(byDate.get(d)) ?? null);
  slot.replaceChildren(lineChart({
    labels: days.map((d) => fmtDate(d, { day: 'numeric', month: 'short' })),
    values, color: m.color, min: m.min, max: m.max, unit: m.unit || '', target: m.target ?? null,
    width: slot.clientWidth,
  }));
  const count = card.querySelector('[data-count]');
  if (count) count.textContent = `${days.filter((d) => byDate.has(d)).length}/30 logged`;
}

// ---------------------------------------------------------------------------
// My plan (collapsed by default)
// ---------------------------------------------------------------------------
function planCard(me, timers) {
  const body = h('div', { class: 'mt-8' });
  const card = h('details', { class: 'card more' },
    h('summary', null, icon('sparkle'), h('b', null, 'My plan & targets')), body);

  const draw = (plan, updating = false) => {
    const regen = h('button', { class: 'btn secondary sm' }, icon('refresh'), 'New plan');
    regen.addEventListener('click', async () => {
      regen.disabled = true;
      try {
        const r = await post('/api/me/plan/regenerate');
        wait(r.previousPlanId);
      } catch (e) { toast(e.message, { error: true }); regen.disabled = false; }
    });
    mount(body,
      updating ? h('div', { class: 'row muted small' }, spinner(true), 'Preparing your personal plan…') : null,
      planBlock(plan, plan ? null : me.targets),
      !plan && !updating ? h('p', { class: 'muted small mt-8' }, me.profile ? 'Your personal plan will appear here soon.' : 'Fill in your details in Profile to get a personal plan.') : null,
      h('div', { class: 'spread mt-16' },
        h('span', { class: 'faint' }, plan?.provider ? (plan.provider === 'rules' ? 'Standard plan' : 'Made by your AI coach') : ''),
        !updating && regen),
      disclaimer());
  };
  const wait = (prevId) => {
    draw(me.plan, true);
    const started = Date.now();
    const poll = async () => {
      try {
        const { plan } = await get('/api/me/plan');
        if (plan && plan.id !== prevId) { me.plan = plan; if (state.me) state.me.plan = plan; draw(plan); toast('Your new plan is ready'); return; }
      } catch { /* retry */ }
      if (Date.now() - started < 45000) timers.push(setTimeout(poll, 2500));
      else { draw(me.plan); toast('The plan is taking a while — check back in a minute.'); }
    };
    timers.push(setTimeout(poll, 2500));
  };
  draw(me.plan);
  return card;
}
