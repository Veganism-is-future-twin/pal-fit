// The "My details" form, shared by onboarding and the Profile screen.

import { put } from '../api.js';
import { h, field, choiceChips, toast } from '../ui.js';

export const GOALS = [
  { value: 'lose_weight', label: 'Lose weight' },
  { value: 'build_muscle', label: 'Build muscle' },
  { value: 'gain_weight', label: 'Gain weight' },
  { value: 'stay_fit', label: 'Stay fit' },
  { value: 'improve_stamina', label: 'Improve stamina' },
  { value: 'better_sleep', label: 'Sleep better' },
  { value: 'other', label: 'Other' },
];
const GENDERS = [
  { value: 'male', label: 'Male' }, { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' }, { value: 'prefer_not', label: 'Prefer not to say' },
];
const ACTIVITY = [
  { value: 'sedentary', label: 'Mostly sitting' }, { value: 'light', label: 'Lightly active' },
  { value: 'moderate', label: 'Moderately active' }, { value: 'active', label: 'Very active' },
];
const DIETS = [
  { value: 'vegan', label: 'Vegan' }, { value: 'vegetarian', label: 'Vegetarian' }, { value: 'other', label: 'Other' },
];

/**
 * Build the form. onSaved(response) runs after a successful save.
 * Returns the <form> element.
 */
export function profileForm(profile, { submitLabel = 'Save', onSaved } = {}) {
  const p = { diet_pref: 'vegan', ...(profile || {}) };
  const today = new Date().toISOString().slice(0, 10);

  const height = h('input', { class: 'input', type: 'number', inputmode: 'decimal', min: 50, max: 250, step: 'any', placeholder: 'cm', value: p.height_cm ?? '' });
  const weight = h('input', { class: 'input', type: 'number', inputmode: 'decimal', min: 20, max: 300, step: 'any', placeholder: 'kg', value: p.weight_kg ?? '' });
  const dob = h('input', { class: 'input', type: 'date', max: today, min: '1925-01-01', value: p.dob ?? '' });
  const goalNote = h('input', { class: 'input', maxlength: 200, placeholder: 'e.g. run 5 km without stopping', value: p.goal_note ?? '' });
  const err = h('div', { class: 'error-text', role: 'alert' });
  const btn = h('button', { class: 'btn block lg', type: 'submit' }, submitLabel);

  const form = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'form-grid' },
      field('Height (cm)', height),
      field('Weight (kg)', weight),
      h('div', { class: 'full' }, field('Date of birth', dob, 'Used to work out your age. Never shown to others.'))),
    field('Gender', choiceChips(GENDERS, p.gender, (v) => { p.gender = v; }, { small: true })),
    field('How active is your normal day?', choiceChips(ACTIVITY, p.activity_level, (v) => { p.activity_level = v; }, { small: true })),
    field('Main goal', choiceChips(GOALS, p.goal, (v) => { p.goal = v; })),
    field('Anything specific? (optional)', goalNote),
    field('Diet', choiceChips(DIETS, p.diet_pref, (v) => { p.diet_pref = v; }, { allowNone: false })),
    h('p', { class: 'faint' }, 'Your body details are private — only you can see them. The leaderboard shows just your name, points and streak.'),
    err, btn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const res = await put('/api/me/profile', {
        height_cm: height.value || null, weight_kg: weight.value || null, dob: dob.value || null,
        gender: p.gender || null, activity_level: p.activity_level || null, goal: p.goal || null,
        goal_note: goalNote.value || null, diet_pref: p.diet_pref || 'vegan',
      });
      toast('Saved');
      await onSaved?.(res);
    } catch (e2) {
      err.textContent = e2.message;
    } finally {
      btn.disabled = false;
      btn.textContent = submitLabel;
    }
  });
  return form;
}
