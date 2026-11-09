// Grading: combines the code-computed objective score with the AI meal score
// and feedback, and saves everything in ONE D1 batch.

import { loadUserData, buildContext, targetsFor } from './context.js';
import { runChain, parseJsonLoose, usageStatements } from './providers.js';
import { gradePrompt, validateGrade } from './prompts.js';
import { objectiveScore, ruleMealScore, ruleFeedback } from '../scoring.js';
import { all } from '../db.js';
import { sqlNow } from '../time.js';

/**
 * Grade the logs of `userIds` for IST `date`.
 *
 * options:
 *   countIt  true  -> this AI grade counts towards the user's daily cap (save-time grading)
 *   force    true  -> ask the AI even if the data hasn't changed since the last grade (admin re-grade)
 *   lock     'none' | 'if_graded' | 'all'
 *            'if_graded': lock logs whose grade is up to date (used at 00:00 IST)
 *            'all': lock everything, using rules where AI failed (used at 02:00 IST)
 *
 * Returns [{ userId, status }].
 */
export async function gradeUsers(env, run, date, userIds, { countIt = false, force = false, lock = 'none' } = {}) {
  const data = await loadUserData(env, userIds, date);
  const statements = [];
  const summary = [];
  const now = sqlNow();

  for (const userId of userIds) {
    const d = data.get(userId);
    const log = d?.logs.find((l) => l.log_date === date);
    if (!log || !d.user) continue;
    if (log.locked && !force) { summary.push({ userId, status: 'already_locked' }); continue; }

    const targets = targetsFor(d.profile, d.plan);
    const obj = objectiveScore(log, targets);
    const aiAllowed = !!d.user.ai_enabled;
    const needsAi = aiAllowed && (force || log.grade_hash !== log.data_hash);

    let meal, feedback, provider, status, gradeHash = log.grade_hash, countDelta = 0, gradedAt = log.graded_at;

    let result = null;
    if (needsAi) {
      const context = buildContext(d, date);
      result = await runChain(env, run, 'chain_grade', gradePrompt(context, { ...obj.parts, total: obj.total }),
        (text) => validateGrade(parseJsonLoose(text)));
    }

    if (result) {
      meal = result.value.meal_score;
      feedback = result.value.feedback;
      provider = result.provider;
      status = 'done';
      gradeHash = log.data_hash;
      countDelta = countIt ? 1 : 0;
      gradedAt = now;
    } else if (needsAi || !aiAllowed || log.meal_score == null) {
      // AI failed, or user opted out: simple rules.
      meal = ruleMealScore(log);
      feedback = ruleFeedback(log, targets);
      provider = 'rules';
      status = 'rule_based';
    } else {
      // AI grade is already up to date — keep it, just refresh the objective part.
      meal = log.meal_score;
      feedback = log.feedback;
      provider = log.grade_provider;
      status = log.grade_status === 'pending' ? 'done' : log.grade_status;
    }

    const upToDate = !aiAllowed || gradeHash === log.data_hash;
    const doLock = lock === 'all' || (lock === 'if_graded' && upToDate) ? 1 : log.locked;

    statements.push(env.DB.prepare(
      `UPDATE logs SET obj_score = ?, meal_score = ?, score = ?, feedback = ?, grade_provider = ?,
         grade_status = ?, grade_hash = ?, grade_count = grade_count + ?, graded_at = ?, locked = ?
       WHERE id = ? AND data_hash = ?`
    ).bind(obj.total, meal, obj.total + meal, feedback, provider, status, gradeHash, countDelta, gradedAt,
      doLock, log.id, log.data_hash));
    summary.push({ userId, status, locked: !!doLock });
  }

  for (const [sql, ...binds] of usageStatements(run)) statements.push(env.DB.prepare(sql).bind(...binds));
  if (statements.length) await env.DB.batch(statements);
  return summary;
}

/** Ids of users with an unlocked log on `date`. */
export async function unlockedUserIds(env, date) {
  const rows = await all(env.DB, 'SELECT user_id FROM logs WHERE log_date = ? AND locked = 0', date);
  return rows.map((r) => r.user_id);
}
