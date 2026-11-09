// Log today — the most important screen. Fast, thumb-friendly, mostly taps.

import { get, put } from '../api.js';
import { state, staleMe } from '../store.js';
import {
  h, mount, icon, chip, choiceChips, slider, switchField, toast, fmtInt, fmtDate,
} from '../ui.js';
import { MEAL_TAG_LABELS, WORKOUT_LABELS, MOODS } from './common.js';

const STEP_BUCKETS = [
  { value: 2000, label: '< 3k' },
  { value: 4000, label: '3–5k' },
  { value: 6500, label: '5–8k' },
  { value: 9000, label: '8–10k' },
  { value: 11000, label: '10k+' },
];
const MEAL_NAMES = ['Breakfast', 'Lunch', 'Dinner'];
const MEAL_HINTS = ['e.g. poha + peanuts', 'e.g. 2 roti, dal, sabzi', 'e.g. rice, rajma, salad'];

export async function renderLog(view, { go }) {
  const res = await get('/api/logs/today');
  const existing = res.log;
  const targets = state.me?.targets;

  if (existing?.locked) {
    mount(view, h('div', { class: 'card empty' }, h('div', { class: 'empty-icon' }, icon('lock')),
      h('p', null, 'Today is already final.')));
    return;
  }

  // Form state (prefilled when editing).
  const f = {
    steps: existing?.steps ?? null,
    water_l: existing?.water_l ?? null,
    sleep_h: existing?.sleep_h ?? 7,
    meals: existing?.meals?.map((m) => ({ tags: [...m.tags], note: m.note || '' }))
      || [0, 1, 2].map(() => ({ tags: [], note: '' })),
    workout_done: existing?.workout_done ?? false,
    workout_type: existing?.workout_type ?? null,
    workout_min: existing?.workout_min ?? 30,
    mood: existing?.mood ?? null,
    notes: existing?.notes ?? '',
  };
  let dirty = false;
  const touch = () => { dirty = true; };

  // ---------------------------------------------------------------- steps
  const stepsHint = h('span', { class: 'hint' });
  const exact = h('input', {
    class: 'input', type: 'number', inputmode: 'numeric', min: 0, max: 100000, step: 1,
    placeholder: 'Exact steps (optional)', 'aria-label': 'Exact step count',
  });
  const bucketOf = (n) => (n == null ? null : n < 3000 ? 2000 : n < 5000 ? 4000 : n < 8000 ? 6500 : n < 10000 ? 9000 : 11000);
  const isBucketValue = STEP_BUCKETS.some((b) => b.value === f.steps);
  if (f.steps != null && !isBucketValue) exact.value = f.steps;
  const stepChips = choiceChips(STEP_BUCKETS, bucketOf(f.steps), (v) => {
    f.steps = v; exact.value = ''; touch(); paintSteps();
  });
  exact.addEventListener('input', () => {
    const n = exact.value === '' ? null : Math.max(0, Math.min(100000, Math.round(Number(exact.value))));
    f.steps = n;
    stepChips.setValue(bucketOf(n));
    touch(); paintSteps();
  });
  const paintSteps = () => { stepsHint.textContent = f.steps == null ? '' : (exact.value ? fmtInt(f.steps) : '≈ ' + fmtInt(f.steps)); };
  paintSteps();

  // ---------------------------------------------------------------- water
  const waterHint = h('span', { class: 'hint' });
  const glasses = [];
  const paintWater = () => {
    const n = f.water_l == null ? 0 : Math.round(f.water_l / 0.25);
    glasses.forEach((g, i) => { g.classList.toggle('full', i < n); g.setAttribute('aria-pressed', String(i < n)); });
    waterHint.textContent = f.water_l == null ? '' : `${f.water_l} L`;
  };
  for (let i = 0; i < 12; i++) {
    const g = h('button', { type: 'button', class: 'glass', 'aria-label': `${(i + 1) * 250} ml` });
    g.addEventListener('click', () => {
      const n = f.water_l == null ? 0 : Math.round(f.water_l / 0.25);
      // Tapping the last full glass empties it; otherwise fill up to this glass.
      const next = n === i + 1 ? i : i + 1;
      f.water_l = next * 0.25;
      touch(); paintWater();
    });
    glasses.push(g);
  }
  paintWater();

  // ---------------------------------------------------------------- sleep
  const sleepSlider = slider({
    min: 3, max: 12, step: 0.5, value: f.sleep_h, color: 'var(--sleep)', label: 'Hours of sleep',
    format: (v) => [String(v), h('small', null, ' hours')],
    onInput: (v) => { f.sleep_h = v; touch(); },
  });

  // ---------------------------------------------------------------- meals
  const mealCards = f.meals.map((meal, idx) => {
    const tagButtons = {};
    const note = h('input', {
      class: 'input', maxlength: 200, placeholder: MEAL_HINTS[idx], value: meal.note,
      'aria-label': `${MEAL_NAMES[idx]} note`, enterkeyhint: 'done',
    });
    note.addEventListener('input', () => { meal.note = note.value; touch(); });
    const sync = () => Object.entries(tagButtons).forEach(([t, b]) => b.setAttribute('aria-pressed', String(meal.tags.includes(t))));
    const chips = Object.entries(MEAL_TAG_LABELS).map(([tag, label]) => {
      const b = chip(label, meal.tags.includes(tag), (on) => {
        if (on) {
          // "Skipped" excludes everything else, and vice versa.
          meal.tags = tag === 'skipped' ? ['skipped'] : [...meal.tags.filter((t) => t !== 'skipped'), tag];
        } else {
          meal.tags = meal.tags.filter((t) => t !== tag);
        }
        sync(); touch();
      }, 'sm');
      tagButtons[tag] = b;
      return b;
    });
    return h('div', { class: 'meal-card' },
      h('h3', null, MEAL_NAMES[idx]),
      h('div', { class: 'chips' }, chips),
      note);
  });

  // ---------------------------------------------------------------- workout
  const workoutDetails = h('div', { class: 'stack', hidden: !f.workout_done },
    choiceChips(Object.entries(WORKOUT_LABELS).map(([value, label]) => ({ value, label })), f.workout_type,
      (v) => { f.workout_type = v; touch(); }, { small: true }),
    slider({
      min: 0, max: 120, step: 5, value: f.workout_min ?? 30, color: 'var(--effort)', label: 'Workout minutes',
      format: (v) => [String(v), h('small', null, v >= 120 ? '+ minutes' : ' minutes')],
      onInput: (v) => { f.workout_min = v; touch(); },
    }));
  const workoutSwitch = switchField('Did you work out today?', f.workout_done, (on) => {
    f.workout_done = on; workoutDetails.hidden = !on; touch();
  });

  // ---------------------------------------------------------------- mood + notes
  const moodButtons = MOODS.map((emo, i) => {
    const b = h('button', { type: 'button', class: 'mood', 'aria-pressed': String(f.mood === i + 1), 'aria-label': `Mood ${i + 1} of 5` }, emo);
    b.addEventListener('click', () => {
      f.mood = f.mood === i + 1 ? null : i + 1;
      moodButtons.forEach((x, j) => x.setAttribute('aria-pressed', String(f.mood === j + 1)));
      touch();
    });
    return b;
  });
  const notes = h('textarea', { class: 'input', maxlength: 1000, placeholder: 'Anything else about today? (optional)', value: f.notes });
  notes.addEventListener('input', () => { f.notes = notes.value; touch(); });

  // ---------------------------------------------------------------- save
  const saveBtn = h('button', { class: 'btn block lg', type: 'button' }, icon('check'), existing ? 'Save changes' : 'Save my day');
  const err = h('div', { class: 'error-text', role: 'alert' });

  saveBtn.addEventListener('click', async () => {
    err.textContent = '';
    saveBtn.disabled = true;
    saveBtn.replaceChildren('Saving…');
    try {
      const out = await put('/api/logs/today', {
        steps: f.steps, water_l: f.water_l, sleep_h: f.sleep_h,
        meals: f.meals.map((m) => ({ tags: m.tags, note: m.note.trim() })),
        workout_done: f.workout_done, workout_type: f.workout_type,
        workout_min: f.workout_done ? f.workout_min : null,
        mood: f.mood, notes: f.notes.trim(),
      });
      dirty = false;
      if (state.me) state.me.todayLog = out.log;
      staleMe();   // Home shows the new log instantly, then refreshes streak/charts
      toast(out.grading === 'pending' ? 'Saved. Your coach is reviewing your day.'
        : out.grading === 'limit_reached' ? `Saved. Today's ${out.gradeLimit} AI reviews are used up — your score still updated.`
          : 'Saved', { ms: 4000 });
      go('home');
    } catch (e) {
      err.textContent = e.message;
      saveBtn.disabled = false;
      saveBtn.replaceChildren(icon('check'), 'Try again');
    }
  });

  const section = (iconName, title, hint, ...body) => h('section', { class: 'card log-section' },
    h('div', { class: 'card-title' }, icon(iconName), h('h2', null, title), hint), ...body);

  mount(view, h('div', { class: 'stack' },
    h('div', { class: 'spread' },
      h('div', null, h('h1', { class: 'page-title' }, existing ? 'Update today' : 'Log today'),
        h('div', { class: 'eyebrow' }, fmtDate(res.date, { weekday: 'long', day: 'numeric', month: 'long' })))),
    section('steps', 'Steps', stepsHint,
      stepChips, exact,
      targets && h('p', { class: 'faint' }, `Your target: ${fmtInt(targets.steps_target)} steps. Check your phone's health app for the exact number.`)),
    section('drop', 'Water', waterHint,
      h('div', { class: 'glasses' }, glasses),
      h('p', { class: 'faint' }, `Each glass = 250 ml${targets ? ` · Target ${targets.water_target_l} L` : ''}`)),
    section('moon', 'Sleep last night', null, sleepSlider),
    section('meal', 'Meals', null,
      h('p', { class: 'faint' }, 'Tip: a short note on what you ate makes the coach\'s feedback much better.'),
      ...mealCards),
    section('dumbbell', 'Workout', null, workoutSwitch, workoutDetails),
    section('mood', 'Mood & energy', h('span', { class: 'hint faint' }, 'optional'), h('div', { class: 'moods' }, moodButtons)),
    h('details', { class: 'card more', open: !!f.notes },
      h('summary', null, icon('note'), 'Notes (optional)'), notes),
    err,
    h('div', { class: 'save-bar' }, saveBtn)));

  // Warn before leaving with unsaved changes.
  const beforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  return () => window.removeEventListener('beforeunload', beforeUnload);
}
