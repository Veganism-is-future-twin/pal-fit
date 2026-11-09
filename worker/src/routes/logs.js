// Daily logs. Only TODAY (IST) can be edited; past days are read-only.

import { ApiError, json, readJson } from '../http.js';
import { all, first, run, newId } from '../db.js';
import { requireUser, sha256Hex } from '../auth.js';
import { validateLog } from '../validate.js';
import { todayIST, isValidYmd, addDays, daysBetween } from '../time.js';
import { objectiveScore, ruleMealScore, ruleFeedback, gradeInputString, parseTags } from '../scoring.js';
import { targetsFor } from '../ai/context.js';
import { gradeUsers } from '../ai/grade.js';
import { newAiRun } from '../ai/providers.js';
import { getSetting } from '../settings.js';

/** Shape of a log for the browser. */
export function logView(l) {
  if (!l) return null;
  return {
    date: l.log_date,
    steps: l.steps,
    water_l: l.water_l,
    sleep_h: l.sleep_h,
    meals: [1, 2, 3].map((i) => ({ tags: parseTags(l[`meal${i}_tags`]), note: l[`meal${i}_note`] || '' })),
    workout_done: !!l.workout_done,
    workout_type: l.workout_type,
    workout_min: l.workout_min,
    mood: l.mood,
    notes: l.notes || '',
    score: l.score,
    objScore: l.obj_score,
    mealScore: l.meal_score,
    feedback: l.feedback,
    gradeProvider: l.grade_provider,
    gradeStatus: l.grade_status,
    gradesUsed: l.grade_count,
    locked: !!l.locked,
    updatedAt: l.updated_at,
  };
}

const MEAL_COLS = ['meal1_tags', 'meal1_note', 'meal2_tags', 'meal2_note', 'meal3_tags', 'meal3_note'];

export function registerLogRoutes(router) {
  router.get('/api/logs/today', async (ctx) => {
    const user = await requireUser(ctx);
    const today = todayIST();
    const log = await first(ctx.env.DB, 'SELECT * FROM logs WHERE user_id = ? AND log_date = ?', user.id, today);
    return json({ date: today, log: logView(log) });
  });

  // Save (create or update) today's log, score it instantly with code,
  // and ask the AI for the meal score + feedback in the background.
  router.put('/api/logs/today', async (ctx) => {
    const user = await requireUser(ctx);
    const { env } = ctx;
    const today = todayIST();
    const v = validateLog(await readJson(ctx.request));

    const [existingR, profileR, planR] = await env.DB.batch([
      env.DB.prepare('SELECT * FROM logs WHERE user_id = ? AND log_date = ?').bind(user.id, today),
      env.DB.prepare('SELECT * FROM profiles WHERE user_id = ?').bind(user.id),
      env.DB.prepare('SELECT * FROM plans WHERE user_id = ? AND is_current = 1').bind(user.id),
    ]);
    const existing = existingR.results[0] || null;
    if (existing?.locked) throw new ApiError(409, 'locked', 'This day is already final.');

    const targets = targetsFor(profileR.results[0], planR.results[0]);
    const dataHash = await sha256Hex(gradeInputString(v));
    const obj = objectiveScore(v, targets);

    const limit = await getSetting(env, 'grade_daily_limit');
    const gradeCount = existing?.grade_count || 0;
    const unchanged = existing && existing.grade_hash === dataHash;
    const needsAi = !!user.ai_enabled && !unchanged && gradeCount < limit;

    // Meal score shown right away: keep the AI's if meals didn't change, else rules.
    const mealsSame = existing && existing.meal_score != null && existing.grade_provider !== 'rules'
      && MEAL_COLS.every((c) => (existing[c] ?? null) === (v[c] ?? null));
    const meal = mealsSame ? existing.meal_score : ruleMealScore(v);
    let feedback = existing?.feedback || null;
    let provider = existing?.grade_provider || 'rules';
    let status;
    if (needsAi) status = 'pending';
    else if (unchanged) status = existing.grade_status;
    else if (!user.ai_enabled || !existing?.feedback) {
      status = 'rule_based'; feedback = ruleFeedback(v, targets); provider = 'rules';
    } else {
      // Cap reached: keep the last feedback; scores still update. The midnight
      // job gives it one more AI grade if the data changed since.
      status = provider === 'rules' ? 'rule_based' : 'done';
    }

    const id = existing?.id || newId();
    await run(env.DB,
      `INSERT INTO logs (id, user_id, log_date, steps, water_l, sleep_h, meal1_tags, meal1_note, meal2_tags, meal2_note,
         meal3_tags, meal3_note, workout_done, workout_type, workout_min, mood, notes,
         obj_score, meal_score, score, feedback, grade_provider, grade_status, data_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, log_date) DO UPDATE SET
         steps = excluded.steps, water_l = excluded.water_l, sleep_h = excluded.sleep_h,
         meal1_tags = excluded.meal1_tags, meal1_note = excluded.meal1_note,
         meal2_tags = excluded.meal2_tags, meal2_note = excluded.meal2_note,
         meal3_tags = excluded.meal3_tags, meal3_note = excluded.meal3_note,
         workout_done = excluded.workout_done, workout_type = excluded.workout_type, workout_min = excluded.workout_min,
         mood = excluded.mood, notes = excluded.notes,
         obj_score = excluded.obj_score, meal_score = excluded.meal_score, score = excluded.score,
         feedback = excluded.feedback, grade_provider = excluded.grade_provider, grade_status = excluded.grade_status,
         data_hash = excluded.data_hash, updated_at = excluded.updated_at
       WHERE logs.locked = 0`,
      id, user.id, today, v.steps, v.water_l, v.sleep_h, v.meal1_tags, v.meal1_note, v.meal2_tags, v.meal2_note,
      v.meal3_tags, v.meal3_note, v.workout_done, v.workout_type, v.workout_min, v.mood, v.notes,
      obj.total, meal, obj.total + meal, feedback, provider, status, dataHash);

    if (needsAi) {
      ctx.exec.waitUntil(
        gradeUsers(env, newAiRun({ deadlineMs: 27000 }), today, [user.id], { countIt: true })
          .catch(async (e) => {
            console.error('instant grading failed', e);
            await run(env.DB, `UPDATE logs SET grade_status = 'rule_based', feedback = COALESCE(feedback, ?),
              grade_provider = COALESCE(grade_provider, 'rules') WHERE id = ? AND grade_status = 'pending'`,
              ruleFeedback(v, targets), id);
          })
      );
    }

    const saved = await first(env.DB, 'SELECT * FROM logs WHERE id = ?', id);
    return json({
      log: logView(saved),
      targets,
      grading: needsAi ? 'pending'
        : (!user.ai_enabled ? 'ai_off' : unchanged ? 'unchanged' : gradeCount >= limit ? 'limit_reached' : 'done'),
      gradeLimit: limit,
    });
  });

  // Own history (read-only).
  router.get('/api/logs', async (ctx) => {
    const user = await requireUser(ctx);
    const today = todayIST();
    const to = ctx.url.searchParams.get('to') || today;
    const from = ctx.url.searchParams.get('from') || addDays(to, -29);
    if (!isValidYmd(from) || !isValidYmd(to) || from > to) throw new ApiError(400, 'invalid', 'Bad date range.');
    if (daysBetween(from, to) > 366) throw new ApiError(400, 'invalid', 'Date range too long (max 1 year).');
    const rows = await all(ctx.env.DB,
      'SELECT * FROM logs WHERE user_id = ? AND log_date BETWEEN ? AND ? ORDER BY log_date DESC', user.id, from, to);
    return json({ from, to, logs: rows.map(logView) });
  });
}
