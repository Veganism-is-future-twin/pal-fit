// Builds the compact, anonymous summary the AI sees.
// Never includes name, email or Google id — the AI only knows "the user".

import { addDays, ageOn } from '../time.js';
import { defaultTargets, clampTargets, parseTags, currentStreak } from '../scoring.js';

/**
 * Load everything needed to grade/advise several users for `date`, in ONE
 * D1 batch (counts as a single query on the free plan).
 * Returns Map userId -> { user, profile, plan, logs (oldest→newest, last 30 days) }.
 */
export async function loadUserData(env, userIds, date) {
  if (!userIds.length) return new Map();
  const ph = userIds.map(() => '?').join(',');
  const from = addDays(date, -30);
  const [users, profiles, plans, logs] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM users WHERE id IN (${ph})`).bind(...userIds),
    env.DB.prepare(`SELECT * FROM profiles WHERE user_id IN (${ph})`).bind(...userIds),
    env.DB.prepare(`SELECT * FROM plans WHERE is_current = 1 AND user_id IN (${ph})`).bind(...userIds),
    env.DB.prepare(`SELECT * FROM logs WHERE user_id IN (${ph}) AND log_date BETWEEN ? AND ? ORDER BY log_date`)
      .bind(...userIds, from, date),
  ]);
  const map = new Map(userIds.map((id) => [id, { user: null, profile: null, plan: null, logs: [] }]));
  for (const u of users.results) map.get(u.id).user = u;
  for (const p of profiles.results) map.get(p.user_id).profile = p;
  for (const p of plans.results) map.get(p.user_id).plan = p;
  for (const l of logs.results) map.get(l.user_id).logs.push(l);
  return map;
}

/** The targets a user is graded against: their current plan, else sensible defaults. */
export function targetsFor(profile, plan) {
  if (plan) return clampTargets(plan);
  return defaultTargets(profile || {});
}

const avg = (xs) => {
  const v = xs.filter((x) => x != null);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};

function trend(recent, earlier) {
  const a = avg(recent), b = avg(earlier);
  if (a == null || b == null || b === 0) return 'unknown';
  const change = (a - b) / Math.abs(b);
  return change > 0.08 ? 'improving' : change < -0.08 ? 'slipping' : 'steady';
}

function meals(l) {
  return [1, 2, 3].map((i) => ({
    tags: parseTags(l[`meal${i}_tags`]),
    note: l[`meal${i}_note`] || null,
  })).filter((m) => m.tags.length || m.note);
}

/** Readable version of one day's log for the AI. */
export function describeLog(l) {
  if (!l) return null;
  return {
    date: l.log_date,
    steps: l.steps,
    water_l: l.water_l,
    sleep_h: l.sleep_h,
    meals: [1, 2, 3].map((i) => ({
      meal: i,
      tags: parseTags(l[`meal${i}_tags`]),
      note: l[`meal${i}_note`] || null,
    })),
    workout: l.workout_done ? { type: l.workout_type, minutes: l.workout_min } : 'none',
    mood_1_to_5: l.mood,
    notes: l.notes,
  };
}

/** Compact profile (no identifiers). */
export function describeProfile(profile, date) {
  if (!profile) return { note: 'profile not filled yet — give general advice' };
  return {
    age: profile.dob ? ageOn(profile.dob, date) : null,
    gender: profile.gender,
    height_cm: profile.height_cm,
    weight_kg: profile.weight_kg,
    activity_level: profile.activity_level,
    goal: profile.goal,
    goal_note: profile.goal_note,
    diet: profile.diet_pref || 'vegan',
  };
}

/**
 * Full context for grading/chat on `date`.
 * data = one entry from loadUserData().
 */
export function buildContext(data, date) {
  const { profile, plan, logs } = data;
  const today = logs.find((l) => l.log_date === date) || null;
  const past = logs.filter((l) => l.log_date < date);
  const last7 = past.slice(-7);
  const dates = new Set(logs.map((l) => l.log_date));

  const recent3 = past.slice(-3), earlier = past.slice(-7, -3);
  const yesterday = past.find((l) => l.log_date === addDays(date, -1));

  return {
    profile: describeProfile(profile, date),
    targets: targetsFor(profile, plan),
    today: describeLog(today),
    last_7_days: last7.map((l) => ({
      date: l.log_date, steps: l.steps, water_l: l.water_l, sleep_h: l.sleep_h,
      meals: meals(l),
      workout: l.workout_done ? `${l.workout_type || 'yes'} ${l.workout_min ?? '?'}min` : 'none',
      mood: l.mood, score: l.score,
    })),
    last_30_days: {
      days_logged: past.length,
      avg_steps: avg(past.map((l) => l.steps)),
      avg_water_l: avg(past.map((l) => l.water_l)),
      avg_sleep_h: avg(past.map((l) => l.sleep_h)),
      avg_workout_min: avg(past.map((l) => (l.workout_done ? l.workout_min || 0 : 0))),
      avg_score: avg(past.map((l) => l.score)),
      trend: {
        steps: trend(recent3.map((l) => l.steps), earlier.map((l) => l.steps)),
        water: trend(recent3.map((l) => l.water_l), earlier.map((l) => l.water_l)),
        sleep: trend(recent3.map((l) => l.sleep_h), earlier.map((l) => l.sleep_h)),
      },
    },
    current_streak_days: currentStreak(dates, date),
    yesterdays_feedback: yesterday?.feedback || null,
  };
}
