// The signed-in user's own data: summary, profile, plan, weight.

import { ApiError, json, readJson } from '../http.js';
import { all, first, run } from '../db.js';
import { requireUser, publicUser } from '../auth.js';
import { validateProfile, validateDisplayName, validateWeight } from '../validate.js';
import { todayIST, addDays, istDayStartSql, daysBetween } from '../time.js';
import { currentStreak } from '../scoring.js';
import { targetsFor } from '../ai/context.js';
import { generatePlan } from '../ai/plan.js';
import { newAiRun } from '../ai/providers.js';
import { logView } from './logs.js';

export function planView(plan) {
  if (!plan) return null;
  return {
    id: plan.id,
    targets: {
      steps_target: plan.steps_target, water_target_l: plan.water_target_l,
      sleep_target_h: plan.sleep_target_h, workout_target_min: plan.workout_target_min,
    },
    markdown: plan.plan_markdown,
    provider: plan.ai_provider,
    createdAt: plan.created_at,
  };
}

export async function activeChallenge(env, today = todayIST()) {
  const c = await first(env.DB, 'SELECT * FROM challenges WHERE active = 1 ORDER BY start_date DESC LIMIT 1');
  if (!c) return null;
  return {
    id: c.id, name: c.name, startDate: c.start_date, endDate: c.end_date,
    day: Math.min(daysBetween(c.start_date, today) + 1, daysBetween(c.start_date, c.end_date) + 1),
    totalDays: daysBetween(c.start_date, c.end_date) + 1,
    started: today >= c.start_date, ended: today > c.end_date,
  };
}

const PLAN_FIELDS = ['height_cm', 'weight_kg', 'gender', 'dob', 'activity_level', 'goal', 'goal_note', 'diet_pref'];

export function registerMeRoutes(router) {
  // Everything the Home screen needs, in one call.
  router.get('/api/me', async (ctx) => {
    const user = await requireUser(ctx);
    const { env } = ctx;
    const today = todayIST();
    const [profileR, planR, datesR, todayR, yestR] = await env.DB.batch([
      env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user.id),
      env.DB.prepare('SELECT * FROM plans WHERE user_id = ? AND is_current = 1').bind(user.id),
      env.DB.prepare('SELECT log_date FROM logs WHERE user_id = ? AND log_date >= ? ORDER BY log_date DESC')
        .bind(user.id, addDays(today, -400)),
      env.DB.prepare('SELECT * FROM logs WHERE user_id = ? AND log_date = ?').bind(user.id, today),
      env.DB.prepare('SELECT * FROM logs WHERE user_id = ? AND log_date = ?').bind(user.id, addDays(today, -1)),
    ]);
    const profile = profileR.results[0] || null;
    const plan = planR.results[0] || null;
    const dates = new Set(datesR.results.map((r) => r.log_date));

    return json({
      user: publicUser(user),
      today,
      profile,
      plan: planView(plan),
      targets: targetsFor(profile, plan),
      todayLog: todayR.results[0] ? logView(todayR.results[0]) : null,
      yesterdayLog: yestR.results[0] ? logView(yestR.results[0]) : null,
      streak: currentStreak(dates, today),
      totalDaysLogged: dates.size,
      challenge: await activeChallenge(env, today),
    });
  });

  // Display name and AI opt-in.
  router.patch('/api/me', async (ctx) => {
    const user = await requireUser(ctx);
    const body = await readJson(ctx.request);
    if ('displayName' in body) {
      await run(ctx.env.DB, 'UPDATE users SET display_name = ? WHERE id = ?', validateDisplayName(body.displayName), user.id);
    }
    if ('aiEnabled' in body) {
      await run(ctx.env.DB, 'UPDATE users SET ai_enabled = ? WHERE id = ?', body.aiEnabled ? 1 : 0, user.id);
    }
    const fresh = await first(ctx.env.DB, 'SELECT * FROM users WHERE id = ?', user.id);
    return json({ user: publicUser(fresh) });
  });

  router.get('/api/me/profile', async (ctx) => {
    const user = await requireUser(ctx);
    return json({ profile: await first(ctx.env.DB, 'SELECT * FROM profiles WHERE user_id = ?', user.id) });
  });

  // Save profile. If anything that affects the plan changed, regenerate it in the background.
  router.put('/api/me/profile', async (ctx) => {
    const user = await requireUser(ctx);
    const { env } = ctx;
    const p = validateProfile(await readJson(ctx.request));
    const before = await first(env.DB, 'SELECT * FROM profiles WHERE user_id = ?', user.id);
    await run(env.DB,
      `INSERT INTO profiles (user_id, height_cm, weight_kg, gender, dob, activity_level, goal, goal_note, diet_pref, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET height_cm = excluded.height_cm, weight_kg = excluded.weight_kg,
         gender = excluded.gender, dob = excluded.dob, activity_level = excluded.activity_level, goal = excluded.goal,
         goal_note = excluded.goal_note, diet_pref = excluded.diet_pref, updated_at = excluded.updated_at`,
      user.id, p.height_cm, p.weight_kg, p.gender, p.dob, p.activity_level, p.goal, p.goal_note, p.diet_pref);

    const plan = await first(env.DB, 'SELECT id FROM plans WHERE user_id = ? AND is_current = 1', user.id);
    const changed = !before || PLAN_FIELDS.some((k) => (before[k] ?? null) !== (p[k] ?? null));
    let planUpdating = false;
    if (!plan || changed) {
      planUpdating = true;
      ctx.exec.waitUntil(generatePlan(env, newAiRun({ deadlineMs: 28000 }), user.id)
        .catch((e) => console.error('plan generation failed', e)));
    }
    return json({ profile: p, planUpdating, previousPlanId: plan?.id || null });
  });

  router.get('/api/me/plan', async (ctx) => {
    const user = await requireUser(ctx);
    const plan = await first(ctx.env.DB, 'SELECT * FROM plans WHERE user_id = ? AND is_current = 1', user.id);
    return json({ plan: planView(plan) });
  });

  // Manual "make me a new plan" — max 2 per day (protects AI quota).
  router.post('/api/me/plan/regenerate', async (ctx) => {
    const user = await requireUser(ctx);
    const { env } = ctx;
    const count = await first(env.DB, 'SELECT COUNT(*) AS n FROM plans WHERE user_id = ? AND created_at >= ?',
      user.id, istDayStartSql());
    if (count.n >= 2) throw new ApiError(429, 'limit', 'You can refresh your plan twice a day. Try again tomorrow.');
    const prev = await first(env.DB, 'SELECT id FROM plans WHERE user_id = ? AND is_current = 1', user.id);
    ctx.exec.waitUntil(generatePlan(env, newAiRun({ deadlineMs: 28000 }), user.id)
      .catch((e) => console.error('plan generation failed', e)));
    return json({ planUpdating: true, previousPlanId: prev?.id || null });
  });

  // Optional weekly weigh-ins (private).
  router.get('/api/weight', async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await all(ctx.env.DB,
      'SELECT log_date, weight_kg FROM weight_logs WHERE user_id = ? ORDER BY log_date DESC LIMIT 52', user.id);
    return json({ weights: rows.reverse() });
  });

  router.post('/api/weight', async (ctx) => {
    const user = await requireUser(ctx);
    const body = await readJson(ctx.request);
    const w = validateWeight(body.weight_kg);
    const today = todayIST();
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(
        `INSERT INTO weight_logs (user_id, log_date, weight_kg) VALUES (?, ?, ?)
         ON CONFLICT(user_id, log_date) DO UPDATE SET weight_kg = excluded.weight_kg`).bind(user.id, today, w),
      // Keep the profile's current weight in sync (does not trigger a new plan by itself).
      ctx.env.DB.prepare(
        `INSERT INTO profiles (user_id, weight_kg) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET weight_kg = excluded.weight_kg`).bind(user.id, w),
    ]);
    return json({ ok: true, date: today, weight_kg: w });
  });
}
