// Server-side validation for everything users send. Never trust the browser.

import { ApiError } from './http.js';
import { isValidYmd, ageOn } from './time.js';

export const MEAL_TAGS = ['mess', 'home_cooked', 'outside', 'skipped', 'high_protein', 'fruits_veg', 'junk', 'sweet'];
export const WORKOUT_TYPES = ['walk', 'gym', 'yoga', 'run', 'sports', 'cycling', 'home', 'other'];
export const GENDERS = ['male', 'female', 'other', 'prefer_not'];
export const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'active'];
export const GOALS = ['lose_weight', 'gain_weight', 'build_muscle', 'stay_fit', 'improve_stamina', 'better_sleep', 'other'];
export const DIETS = ['vegan', 'vegetarian', 'other'];

const bad = (msg) => new ApiError(400, 'invalid', msg);

/** Optional number in [min,max]; returns null when empty. */
function num(v, name, min, max, { integer = false } = {}) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${name} must be between ${min} and ${max}.`);
  if (integer && !Number.isInteger(n)) throw bad(`${name} must be a whole number.`);
  return n;
}

function text(v, name, max) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw bad(`${name} must be text.`);
  const s = v.trim();
  if (s.length > max) throw bad(`${name} is too long (max ${max} characters).`);
  return s || null;
}

function oneOf(v, name, allowed) {
  if (v === null || v === undefined || v === '') return null;
  if (!allowed.includes(v)) throw bad(`${name} is not a valid choice.`);
  return v;
}

/** Validate a daily log body → DB-ready column values. */
export function validateLog(body) {
  if (!body || typeof body !== 'object') throw bad('Missing log data.');

  const meals = Array.isArray(body.meals) ? body.meals : [];
  if (meals.length > 3) throw bad('At most 3 meals.');
  const mealCols = {};
  for (let i = 0; i < 3; i++) {
    const m = meals[i] || {};
    const tags = Array.isArray(m.tags) ? [...new Set(m.tags)] : [];
    for (const t of tags) if (!MEAL_TAGS.includes(t)) throw bad(`Unknown meal tag "${t}".`);
    mealCols[`meal${i + 1}_tags`] = tags.length ? JSON.stringify(tags) : null;
    mealCols[`meal${i + 1}_note`] = text(m.note, `Meal ${i + 1} note`, 200);
  }

  const workoutDone = body.workout_done === true || body.workout_done === 1;
  return {
    steps: num(body.steps, 'Steps', 0, 100000, { integer: true }),
    water_l: num(body.water_l, 'Water', 0, 10),
    sleep_h: num(body.sleep_h, 'Sleep', 0, 16),
    ...mealCols,
    workout_done: workoutDone ? 1 : 0,
    workout_type: workoutDone ? oneOf(body.workout_type, 'Workout type', WORKOUT_TYPES) : null,
    workout_min: workoutDone ? num(body.workout_min, 'Workout minutes', 0, 300, { integer: true }) : null,
    mood: num(body.mood, 'Mood', 1, 5, { integer: true }),
    notes: text(body.notes, 'Notes', 1000),
  };
}

/** Validate a profile body → DB-ready column values. */
export function validateProfile(body) {
  if (!body || typeof body !== 'object') throw bad('Missing profile data.');
  let dob = null;
  if (body.dob) {
    if (!isValidYmd(body.dob)) throw bad('Date of birth is not a valid date.');
    const age = ageOn(body.dob);
    if (age < 10 || age > 100) throw bad('Please check your date of birth.');
    dob = body.dob;
  }
  return {
    height_cm: num(body.height_cm, 'Height', 50, 250),
    weight_kg: num(body.weight_kg, 'Weight', 20, 300),
    gender: oneOf(body.gender, 'Gender', GENDERS),
    dob,
    activity_level: oneOf(body.activity_level, 'Activity level', ACTIVITY_LEVELS),
    goal: oneOf(body.goal, 'Goal', GOALS),
    goal_note: text(body.goal_note, 'Goal note', 200),
    diet_pref: oneOf(body.diet_pref, 'Diet preference', DIETS) || 'vegan',
  };
}

export function validateDisplayName(v) {
  const s = text(v, 'Name', 40);
  if (!s) throw bad('Please enter a name.');
  return s;
}

/** Personal daily targets set by the user. */
export function validateTargets(b) {
  if (!b || typeof b !== 'object') throw bad('Missing targets.');
  const req = (v, name, min, max, opts) => {
    const n = num(v, name, min, max, opts);
    if (n == null) throw bad(`Please enter ${name.toLowerCase()}.`);
    return n;
  };
  return {
    steps_target: req(b.steps_target, 'Steps target', 1000, 30000, { integer: true }),
    water_target_l: Math.round(req(b.water_target_l, 'Water target', 0.5, 5) * 4) / 4,
    sleep_target_h: Math.round(req(b.sleep_target_h, 'Sleep target', 4, 12) * 2) / 2,
    workout_target_min: req(b.workout_target_min, 'Workout target', 0, 180, { integer: true }),
  };
}

export function validateWeight(v) {
  const n = num(v, 'Weight', 20, 300);
  if (n == null) throw bad('Please enter your weight.');
  return Math.round(n * 10) / 10;
}
