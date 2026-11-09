// Pieces shared by several screens.

import { get } from '../api.js';
import { h, icon, fmtInt, scoreRing, markdown, disclaimer, spinner } from '../ui.js';

export const MEAL_TAG_LABELS = {
  mess: 'Mess thali', home_cooked: 'Home-cooked', outside: 'Outside', skipped: 'Skipped',
  high_protein: 'High-protein', fruits_veg: 'Fruits / veg', junk: 'Junk', sweet: 'Sweet',
};
export const WORKOUT_LABELS = {
  walk: 'Walk', gym: 'Gym', yoga: 'Yoga', run: 'Run', sports: 'Sports',
  cycling: 'Cycling', home: 'Home workout', other: 'Other',
};
export const MOODS = ['😫', '😕', '😐', '🙂', '😄'];

/** 2×2 / 1×4 grid of today's key numbers. */
export function statGrid(log, targets) {
  const stat = (iconName, k, v, sub) => h('div', { class: 'stat' },
    h('div', { class: 'k' }, icon(iconName), k), h('div', { class: 'v' }, v, sub && h('span', { class: 'faint' }, ' ' + sub)));
  return h('div', { class: 'stat-grid' },
    stat('steps', 'Steps', fmtInt(log.steps), targets && `/ ${fmtInt(targets.steps_target)}`),
    stat('drop', 'Water', log.water_l != null ? `${log.water_l} L` : '–'),
    stat('moon', 'Sleep', log.sleep_h != null ? `${log.sleep_h} h` : '–'),
    stat('dumbbell', 'Workout', log.workout_done ? (log.workout_min ? `${log.workout_min} min` : 'Yes') : '–'));
}

export const mealsLogged = (log) => log.meals.filter((m) => m.tags.length || m.note).length;

/** Score breakdown line. */
export function scoreBreakdown(log) {
  if (log.score == null) return null;
  return h('p', { class: 'faint' },
    `Habits ${log.objScore ?? '–'}/75 · Meals ${log.mealScore ?? '–'}/25`,
    log.gradeProvider && log.gradeProvider !== 'rules' ? ' · AI coach' : log.gradeProvider === 'rules' ? ' · automatic score' : '');
}

/**
 * Coach feedback card for a log. If grading is pending, shows a skeleton and
 * polls until done; `onUpdate(log)` is called with the graded log.
 * Returns { el, stop }.
 */
export function coachCard(log, { title = 'Coach feedback', onUpdate } = {}) {
  const el = h('div', { class: 'card coach-card' });
  let timer = null, stopped = false;

  const draw = (l) => {
    el.replaceChildren(
      h('div', { class: 'card-title' }, icon('sparkle'), h('h2', { class: 'grow' }, title),
        l.score != null && scoreRing(l.score, { small: true })));
    if (l.gradeStatus === 'pending') {
      el.append(h('div', { class: 'row muted small' }, spinner(true), 'Your coach is reviewing your day…'),
        h('div', { class: 'stack-sm mt-16' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton', style: 'width:75%' })));
    } else if (l.feedback) {
      el.append(h('p', { class: 'coach-text' }, l.feedback));
      const b = scoreBreakdown(l);
      if (b) el.append(h('div', { class: 'mt-8' }, b));
    } else {
      el.append(h('p', { class: 'muted' }, 'No feedback yet.'));
    }
    el.append(disclaimer());
  };

  draw(log);

  if (log.gradeStatus === 'pending') {
    const started = Date.now();
    const poll = async () => {
      if (stopped) return;
      try {
        const res = await get('/api/logs/today');
        if (res.log && res.log.gradeStatus !== 'pending') {
          draw(res.log);
          onUpdate?.(res.log);
          return;
        }
      } catch { /* keep trying */ }
      if (Date.now() - started < 40000) timer = setTimeout(poll, 2000);
      else draw({ ...log, gradeStatus: 'done', feedback: log.feedback || 'Your coach is busy — feedback will appear shortly. Your score is already saved.' });
    };
    timer = setTimeout(poll, 1500);
  }

  return { el, stop: () => { stopped = true; clearTimeout(timer); } };
}

export function planBlock(plan, targets) {
  const t = targets || plan?.targets;
  const tile = (v, k) => h('div', { class: 'target' }, h('div', { class: 'v' }, v), h('div', { class: 'k' }, k));
  return h('div', { class: 'stack-sm' },
    t && h('div', { class: 'targets' },
      tile(fmtInt(t.steps_target), 'steps / day'),
      tile(`${t.water_target_l} L`, 'water / day'),
      tile(`${t.sleep_target_h} h`, 'sleep / night'),
      tile(`${t.workout_target_min} min`, 'workout / day')),
    plan?.markdown && markdown(plan.markdown));
}
