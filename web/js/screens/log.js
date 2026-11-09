// Log today — the most important screen. Fast, thumb-friendly, mostly taps.
//
// Speed & offline: draws instantly from today's log saved on this device, then
// checks the server; it only redraws if the server has something newer AND you
// haven't started editing.

import { get, put } from '../api.js';
import { state, staleMe } from '../store.js';
import {
  h, mount, icon, chip, choiceChips, slider, switchField, toast, fmtInt, fmtDate, field,
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
const MESS_DEFAULT = '2 roti, 2 sabzi, dal, rice';
const WATER_MAX_L = 5;

const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

export async function renderLog(view, ctx) {
  let current = null;
  const draw = (date, log) => {
    current?.teardown();
    current = buildLog(view, date, log, ctx);
  };

  const today = istToday();
  const haveSaved = state.me && state.me.today === today;
  if (haveSaved) draw(today, state.me.todayLog);

  let res = null;
  try {
    res = await get('/api/logs/today');
  } catch (e) {
    if (!haveSaved) throw e;      // offline with nothing saved → error screen
  }
  if (res && view.isConnected) {
    const changed = !haveSaved || JSON.stringify(res.log) !== JSON.stringify(state.me.todayLog);
    if (changed && !current?.isDirty()) draw(res.date, res.log);
  }
  return () => current?.teardown();
}

// ---------------------------------------------------------------------------
function buildLog(view, date, existing, { go }) {
  if (existing?.locked) {
    mount(view, h('div', { class: 'card empty' }, h('div', { class: 'empty-icon' }, icon('lock')),
      h('p', null, 'Today is already final.')));
    return { isDirty: () => false, teardown() {} };
  }

  let targets = state.me?.targets || { steps_target: 8000, water_target_l: 2.5, sleep_target_h: 7.5, workout_target_min: 30 };

  // Form state (prefilled when editing).
  const f = {
    steps: existing?.steps ?? null,
    water_l: existing?.water_l != null ? Math.min(WATER_MAX_L, Math.round(existing.water_l * 2) / 2) : null,
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
  const stepsTarget = h('p', { class: 'faint' });
  const exact = h('input', {
    class: 'input', type: 'number', inputmode: 'numeric', min: 0, max: 100000, step: 1,
    placeholder: 'Exact steps (optional)', 'aria-label': 'Exact step count',
  });
  const bucketOf = (n) => (n == null ? null : n < 3000 ? 2000 : n < 5000 ? 4000 : n < 8000 ? 6500 : n < 10000 ? 9000 : 11000);
  if (f.steps != null && !STEP_BUCKETS.some((b) => b.value === f.steps)) exact.value = f.steps;
  const stepChips = choiceChips(STEP_BUCKETS, bucketOf(f.steps), (v) => {
    f.steps = v; exact.value = ''; touch(); paintSteps();
  });
  exact.addEventListener('input', () => {
    const n = exact.value === '' ? null : Math.max(0, Math.min(100000, Math.round(Number(exact.value))));
    f.steps = n;
    stepChips.setValue(bucketOf(n));
    touch(); paintSteps();
  });
  const paintSteps = () => {
    stepsHint.textContent = f.steps == null ? '' : (exact.value ? fmtInt(f.steps) : '≈ ' + fmtInt(f.steps));
    stepsTarget.textContent = `Your target: ${fmtInt(targets.steps_target)} steps. Check your phone's health app for the exact number.`;
  };
  paintSteps();

  // ---------------------------------------------------------------- water (5 × 1 L bars)
  // Tap a bar to fill up to it. Tap the top bar again for half a litre less.
  const waterHint = h('span', { class: 'hint' });
  const waterTarget = h('p', { class: 'faint' });
  const bars = [];
  const paintWater = () => {
    const w = f.water_l ?? 0;
    bars.forEach((b, i) => {
      const level = Math.max(0, Math.min(1, w - i));   // 0, 0.5 or 1
      b.style.setProperty('--level', String(level));
      b.setAttribute('aria-pressed', String(level > 0));
    });
    waterHint.textContent = f.water_l == null ? '' : `${f.water_l} L`;
    waterTarget.textContent = `Each bar = 1 litre · tap the top bar again for ½ L · Target ${targets.water_target_l} L`;
  };
  for (let i = 0; i < WATER_MAX_L; i++) {
    const litres = i + 1;
    const b = h('button', { type: 'button', class: 'water-bar', 'aria-label': `${litres} litre${litres > 1 ? 's' : ''}` },
      h('span', { class: 'water-fill' }), h('span', { class: 'water-label' }, `${litres} L`));
    b.addEventListener('click', () => {
      const w = f.water_l ?? 0;
      f.water_l = w === litres ? litres - 0.5 : w === litres - 0.5 ? litres - 1 : litres;
      if (f.water_l === 0) f.water_l = 0;
      touch(); paintWater();
    });
    bars.push(b);
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

    // "Mess" only for lunch & dinner: one tap fills a typical mess thali (editable).
    const labels = Object.entries(MEAL_TAG_LABELS).filter(([tag]) => tag !== 'mess' || idx > 0);
    const chips = labels.map(([tag, label]) => {
      const b = chip(label, meal.tags.includes(tag), (on) => {
        if (on) {
          // "Skipped" excludes everything else, and vice versa.
          meal.tags = tag === 'skipped' ? ['skipped'] : [...meal.tags.filter((t) => t !== 'skipped'), tag];
          if (tag === 'mess' && !meal.note.trim()) { meal.note = MESS_DEFAULT; note.value = MESS_DEFAULT; }
        } else {
          meal.tags = meal.tags.filter((t) => t !== tag);
          if (tag === 'mess' && meal.note === MESS_DEFAULT) { meal.note = ''; note.value = ''; }
        }
        sync(); touch();
      }, 'sm' + (tag === 'mess' ? ' mess-chip' : ''));
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

  // ---------------------------------------------------------------- targets
  const targetsBtn = h('button', { type: 'button', class: 'btn secondary sm' }, icon('flag'), 'My targets');
  targetsBtn.addEventListener('click', () => openTargets(targets, (t) => { targets = t; paintSteps(); paintWater(); }));

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
      err.textContent = e.code === 'offline' ? "You're offline — nothing was lost. Tap save again when you're connected." : e.message;
      saveBtn.disabled = false;
      saveBtn.replaceChildren(icon('check'), 'Try again');
    }
  });

  const section = (iconName, title, hint, ...body) => h('section', { class: 'card log-section' },
    h('div', { class: 'card-title' }, icon(iconName), h('h2', null, title), hint), ...body);

  mount(view, h('div', { class: 'stack' },
    h('div', { class: 'spread' },
      h('div', null, h('h1', { class: 'page-title' }, existing ? 'Update today' : 'Log today'),
        h('div', { class: 'eyebrow' }, fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' }))),
      targetsBtn),
    section('steps', 'Steps', stepsHint, stepChips, exact, stepsTarget),
    section('drop', 'Water', waterHint, h('div', { class: 'water-bars' }, bars), waterTarget),
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
  return {
    isDirty: () => dirty,
    teardown: () => window.removeEventListener('beforeunload', beforeUnload),
  };
}

// ---------------------------------------------------------------------------
// "My targets" sheet
// ---------------------------------------------------------------------------
function openTargets(t, onSaved) {
  const num = (value, attrs) => h('input', { class: 'input', type: 'number', inputmode: 'decimal', value, ...attrs });
  const steps = num(t.steps_target, { min: 1000, max: 30000, step: 500 });
  const water = num(t.water_target_l, { min: 0.5, max: WATER_MAX_L, step: 0.5 });
  const sleep = num(t.sleep_target_h, { min: 4, max: 12, step: 0.5 });
  const workout = num(t.workout_target_min, { min: 0, max: 180, step: 5 });
  const err = h('div', { class: 'error-text', role: 'alert' });
  const save = h('button', { class: 'btn block', type: 'submit' }, 'Save targets');

  const dialog = h('dialog', { class: 'sheet', 'aria-label': 'My daily targets' });
  const close = () => { dialog.close(); dialog.remove(); };
  const form = h('form', { class: 'stack' },
    h('div', { class: 'spread' }, h('h2', null, 'My daily targets'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('x'))),
    h('p', { class: 'muted small' }, 'Your scores are measured against these. A new AI plan may suggest different ones later.'),
    h('div', { class: 'form-grid' },
      field('Steps / day', steps), field('Water (L) / day', water),
      field('Sleep (h) / night', sleep), field('Workout (min) / day', workout)),
    err, save);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    save.disabled = true;
    try {
      const res = await put('/api/me/targets', {
        steps_target: steps.value, water_target_l: water.value,
        sleep_target_h: sleep.value, workout_target_min: workout.value,
      });
      if (state.me) { state.me.targets = res.targets; if (state.me.plan) state.me.plan.targets = res.targets; }
      staleMe();
      onSaved(res.targets);
      toast('Targets saved');
      close();
    } catch (e2) {
      err.textContent = e2.message;
      save.disabled = false;
    }
  });

  dialog.appendChild(form);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });   // tap outside to close
  document.body.appendChild(dialog);
  dialog.showModal();
}
