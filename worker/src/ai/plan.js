// Personal plan generation (targets + diet & routine guidance).

import { runChain, parseJsonLoose, usageStatements } from './providers.js';
import { planPrompt, validatePlan } from './prompts.js';
import { describeProfile } from './context.js';
import { defaultTargets, clampTargets } from '../scoring.js';
import { first, newId } from '../db.js';
import { todayIST } from '../time.js';

const GOAL_TEXT = {
  lose_weight: 'lose weight steadily', gain_weight: 'gain weight healthily', build_muscle: 'build muscle',
  stay_fit: 'stay fit', improve_stamina: 'improve stamina', better_sleep: 'sleep better', other: 'feel healthier',
};

/** A decent plan without AI (used when AI is off or every model failed). */
export function rulePlan(profile, t) {
  const diet = profile?.diet_pref || 'vegan';
  const protein = diet === 'vegetarian'
    ? 'dal, chana, rajma, paneer, curd, soy chunks, peanuts'
    : 'dal, chana, rajma, tofu, soy chunks, sprouts, peanuts';
  const goal = GOAL_TEXT[profile?.goal] || 'feel healthier';
  return [
    '## Daily targets',
    `- **${t.steps_target.toLocaleString('en-IN')} steps** — split into 2–3 walks if that's easier`,
    `- **${t.water_target_l} L water** — about ${Math.round(t.water_target_l / 0.25)} glasses`,
    `- **${t.sleep_target_h} h sleep** — same bedtime every night`,
    `- **${t.workout_target_min} min workout** — walking, yoga, home workout or gym`,
    '',
    '## Diet guidance',
    `- Your goal: ${goal}. Build each meal around a protein: ${protein}`,
    '- Fill half your plate with vegetables or salad',
    '- Prefer home-cooked food; keep fried snacks and sweets occasional',
    '- Choose roti, brown rice or millets (jowar, bajra, ragi) for lasting energy',
    '',
    '## Sample day of meals',
    '- Breakfast: poha or upma with peanuts, plus a fruit',
    '- Lunch: 2 roti, dal or rajma, sabzi, salad',
    '- Snack: roasted chana or sprouts chaat',
    `- Dinner: rice or roti with ${diet === 'vegetarian' ? 'paneer or dal' : 'tofu or soy chunks'} and vegetables`,
    '',
    '## Routine',
    '- Drink a glass of water right after waking up',
    '- Take a 10-minute walk after lunch and dinner',
    '- Screens off 30 minutes before bed',
    '- Log your day every evening — it takes 30 seconds',
  ].join('\n');
}

/**
 * Create a new current plan for a user. Uses AI if the user allows it,
 * otherwise (or if every model fails) the rule-based plan.
 */
export async function generatePlan(env, run, userId) {
  const user = await first(env.DB, 'SELECT ai_enabled FROM users WHERE id = ?', userId);
  const profile = await first(env.DB, 'SELECT * FROM profiles WHERE user_id = ?', userId);
  const defaults = defaultTargets(profile || {});

  let targets = defaults, markdown, provider = 'rules';
  if (user?.ai_enabled) {
    const result = await runChain(env, run, 'chain_grade',
      planPrompt(describeProfile(profile, todayIST()), defaults),
      (text) => validatePlan(parseJsonLoose(text)));
    if (result) {
      targets = clampTargets(result.value);
      markdown = result.value.plan_markdown;
      provider = result.provider;
    }
  }
  if (!markdown) markdown = rulePlan(profile, targets);

  const statements = [
    env.DB.prepare('UPDATE plans SET is_current = 0 WHERE user_id = ? AND is_current = 1').bind(userId),
    env.DB.prepare(
      `INSERT INTO plans (id, user_id, steps_target, water_target_l, sleep_target_h, workout_target_min,
         plan_markdown, ai_provider, is_current) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).bind(newId(), userId, targets.steps_target, targets.water_target_l, targets.sleep_target_h,
      targets.workout_target_min, markdown, provider),
    ...usageStatements(run).map(([sql, ...b]) => env.DB.prepare(sql).bind(...b)),
  ];
  await env.DB.batch(statements);
  return { targets, provider };
}
