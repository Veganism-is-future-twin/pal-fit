// Scoring, targets, streaks and points.
//
// Daily score (0–100) = objective part (0–75, computed here by code, identical
// for everyone no matter which AI model is up) + meal part (0–25, judged by AI;
// falls back to the simple rules below).
//
//   Logged everything   10   (code)
//   Steps vs target     20   (code)
//   Water vs target     15   (code)
//   Sleep vs target     20   (code)
//   Workout vs target   10   (code)
//   Meals vs goal/diet  25   (AI, or rules)

import { addDays } from './time.js';

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------
export const BASE_TARGETS = { steps_target: 8000, water_target_l: 2.5, sleep_target_h: 7.5, workout_target_min: 30 };

/** Sensible starting targets from a profile (used before/without an AI plan). */
export function defaultTargets(profile = {}) {
  const t = { ...BASE_TARGETS };
  switch (profile.goal) {
    case 'lose_weight': t.steps_target = 10000; t.workout_target_min = 40; break;
    case 'build_muscle': t.steps_target = 7000; t.workout_target_min = 45; break;
    case 'gain_weight': t.steps_target = 6000; t.workout_target_min = 30; break;
    case 'improve_stamina': t.steps_target = 9000; t.workout_target_min = 40; break;
    case 'better_sleep': t.sleep_target_h = 8; break;
  }
  if (profile.activity_level === 'sedentary') t.steps_target = Math.min(t.steps_target, 6000);
  if (profile.weight_kg) {
    // ~33 ml per kg, rounded to a glass (0.25 L), kept between 2 and 4 L.
    t.water_target_l = Math.min(4, Math.max(2, Math.round(profile.weight_kg * 0.033 * 4) / 4));
  }
  return t;
}

/** Keep any targets (AI plan or user-set) within safe, sane bounds. */
export function clampTargets(t) {
  const c = (v, lo, hi, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, Number(v))) : d);
  return {
    steps_target: Math.round(c(t.steps_target, 1000, 30000, BASE_TARGETS.steps_target) / 100) * 100,
    water_target_l: Math.round(c(t.water_target_l, 0.5, 5, BASE_TARGETS.water_target_l) * 4) / 4,
    sleep_target_h: Math.round(c(t.sleep_target_h, 4, 12, BASE_TARGETS.sleep_target_h) * 2) / 2,
    workout_target_min: Math.round(c(t.workout_target_min, 0, 180, BASE_TARGETS.workout_target_min) / 5) * 5,
  };
}

// ---------------------------------------------------------------------------
// Objective score (0–75)
// ---------------------------------------------------------------------------
export function parseTags(json) {
  try { return json ? JSON.parse(json) : []; } catch { return []; }
}

function mealFilled(log, i) {
  return parseTags(log[`meal${i}_tags`]).length > 0 || !!log[`meal${i}_note`];
}

export function objectiveScore(log, targets) {
  const t = targets || BASE_TARGETS;

  const filled = [log.steps != null, log.water_l != null, log.sleep_h != null,
    mealFilled(log, 1), mealFilled(log, 2), mealFilled(log, 3)].filter(Boolean).length;
  const complete = 10 * (filled / 6);

  const steps = log.steps != null ? 20 * Math.min(1, log.steps / t.steps_target) : 0;
  const water = log.water_l != null ? 15 * Math.min(1, log.water_l / t.water_target_l) : 0;

  let sleep = 0;
  if (log.sleep_h != null) {
    // Full marks from (target − 0.5) to (target + 1.5); lose marks gradually outside that.
    const lo = t.sleep_target_h - 0.5, hi = t.sleep_target_h + 1.5;
    const dev = log.sleep_h < lo ? lo - log.sleep_h : log.sleep_h > hi ? log.sleep_h - hi : 0;
    sleep = 20 * Math.max(0, 1 - dev / 3);
  }

  let workout = 0;
  if (!(t.workout_target_min > 0)) {
    workout = 10;   // target of 0 minutes = rest days are fine
  } else if (log.workout_done) {
    workout = log.workout_min > 0 ? 10 * Math.min(1, log.workout_min / t.workout_target_min) : 5;
  }

  const parts = {
    complete: Math.round(complete), steps: Math.round(steps), water: Math.round(water),
    sleep: Math.round(sleep), workout: Math.round(workout),
  };
  const total = Math.round(complete + steps + water + sleep + workout);
  return { total: Math.min(75, total), parts };
}

// ---------------------------------------------------------------------------
// Rule-based meal score (0–25) — used when AI is unavailable or opted out
// ---------------------------------------------------------------------------
export function ruleMealScore(log) {
  let sum = 0;
  for (let i = 1; i <= 3; i++) {
    const tags = parseTags(log[`meal${i}_tags`]);
    if (!tags.length && !log[`meal${i}_note`]) continue;     // not logged: 0
    if (tags.includes('skipped')) { sum += 1; continue; }
    let s = 4.5;
    if (tags.includes('mess')) s += 1.5;           // typical mess thali: balanced but oily-ish
    if (tags.includes('home_cooked')) s += 2;
    if (tags.includes('high_protein')) s += 1.5;
    if (tags.includes('fruits_veg')) s += 1.5;
    if (tags.includes('outside')) s -= 0.5;
    if (tags.includes('junk')) s -= 3;
    if (tags.includes('sweet')) s -= 1.5;
    sum += Math.max(0, Math.min(25 / 3, s));
  }
  return Math.round(Math.min(25, sum));
}

/** Short, friendly feedback without AI. */
export function ruleFeedback(log, targets) {
  const t = targets || BASE_TARGETS;
  const bits = [];
  if (log.steps != null) bits.push(`Steps ${log.steps.toLocaleString('en-IN')} / ${t.steps_target.toLocaleString('en-IN')}${log.steps >= t.steps_target ? ' ✓' : ''}`);
  if (log.water_l != null) bits.push(`Water ${log.water_l} L${log.water_l >= t.water_target_l ? ' ✓' : ` / ${t.water_target_l} L`}`);
  if (log.sleep_h != null) bits.push(`Sleep ${log.sleep_h} h${log.sleep_h >= t.sleep_target_h - 0.5 ? ' ✓' : ''}`);

  let tip;
  if (log.steps == null || log.steps < t.steps_target * 0.7) tip = 'Try a 20-minute walk after dinner tomorrow.';
  else if (log.water_l == null || log.water_l < t.water_target_l) tip = 'Keep a bottle on your desk and sip through the day.';
  else if (log.sleep_h == null || log.sleep_h < t.sleep_target_h - 0.5) tip = 'Aim to be in bed 30 minutes earlier tonight.';
  else if (!log.workout_done) tip = 'Fit in a short workout tomorrow — even 15 minutes counts.';
  else tip = 'Great balance today — keep the streak going!';

  return (bits.length ? bits.join(' · ') + ' — ' : '') + tip;
}

/** Fingerprint of the inputs that affect grading (to skip re-grading unchanged data). */
export function gradeInputString(log) {
  return JSON.stringify([log.steps, log.water_l, log.sleep_h,
    log.meal1_tags, log.meal1_note, log.meal2_tags, log.meal2_note, log.meal3_tags, log.meal3_note,
    log.workout_done, log.workout_type, log.workout_min, log.mood, log.notes]);
}

// ---------------------------------------------------------------------------
// Streaks & points
// ---------------------------------------------------------------------------

/** Current streak: consecutive logged days ending today (or yesterday, if today isn't logged yet). */
export function currentStreak(dateSet, today) {
  let d = dateSet.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (dateSet.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

export const LOG_POINTS = 20;
export const STREAK_BONUS = 10;   // at every 7th consecutive day

export function dailyPoints(score) {
  return LOG_POINTS + Math.round((score ?? 0) * 0.8);
}

/**
 * Points for one user over [from, to].
 * logs: [{log_date, score}] sorted by date. allDates: Set of every date the
 * user ever logged (so a streak that began before `from` still counts).
 */
export function pointsInRange(logs, allDates, from, to) {
  let points = 0, scoreSum = 0, scored = 0;
  for (const l of logs) {
    if (l.log_date < from || l.log_date > to) continue;
    points += dailyPoints(l.score);
    if (l.score != null) { scoreSum += l.score; scored++; }
    // Length of the run ending on this day; +bonus on every 7th day.
    let run = 0, d = l.log_date;
    while (allDates.has(d) && run < 400) { run++; d = addDays(d, -1); }
    if (run > 0 && run % 7 === 0) points += STREAK_BONUS;
  }
  return {
    points,
    daysLogged: logs.filter((l) => l.log_date >= from && l.log_date <= to).length,
    avgScore: scored ? Math.round(scoreSum / scored) : null,
  };
}
