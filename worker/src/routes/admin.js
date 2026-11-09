// Admin-only endpoints. Every change is written to admin_audit.

import { ApiError, json, readJson } from '../http.js';
import { all, first, run, newId } from '../db.js';
import { requireAdmin } from '../auth.js';
import { listSettings, saveSetting, getSetting, SETTINGS } from '../settings.js';
import { todayIST, addDays, isValidYmd, daysBetween } from '../time.js';
import { gradeUsers } from '../ai/grade.js';
import { newAiRun, callProvider } from '../ai/providers.js';

async function audit(env, adminId, action, target, detail) {
  await run(env.DB, 'INSERT INTO admin_audit (id, admin_id, action, target, detail) VALUES (?, ?, ?, ?, ?)',
    newId(), adminId, action, target ?? null, detail ? JSON.stringify(detail).slice(0, 500) : null);
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  // Neutralise spreadsheet formulas and quote everything that needs it.
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

export function registerAdminRoutes(router) {
  // Overview: members, challenges, AI usage, recent admin actions.
  router.get('/api/admin/overview', async (ctx) => {
    await requireAdmin(ctx);
    const { env } = ctx;
    const today = todayIST();
    const [users, challenges, usage, auditRows] = await env.DB.batch([
      env.DB.prepare(`SELECT u.id, u.display_name, u.email, u.photo_url, u.role, u.active, u.ai_enabled,
                        u.created_at, u.last_seen_at,
                        (SELECT COUNT(*) FROM logs l WHERE l.user_id = u.id) AS days_logged,
                        (SELECT MAX(log_date) FROM logs l WHERE l.user_id = u.id) AS last_log
                      FROM users u ORDER BY u.active DESC, u.display_name`),
      env.DB.prepare('SELECT * FROM challenges ORDER BY start_date DESC'),
      env.DB.prepare('SELECT * FROM ai_usage WHERE day >= ? ORDER BY day DESC, calls DESC').bind(addDays(today, -6)),
      env.DB.prepare(`SELECT a.action, a.target, a.detail, a.created_at, u.display_name AS admin
                      FROM admin_audit a JOIN users u ON u.id = a.admin_id ORDER BY a.created_at DESC LIMIT 30`),
    ]);
    return json({
      today,
      users: users.results,
      challenges: challenges.results,
      aiUsage: usage.results,
      audit: auditRows.results,
    });
  });

  // --- Settings (API keys, invite code, model chains, limits) ---------------
  router.get('/api/admin/settings', async (ctx) => {
    await requireAdmin(ctx);
    return json({ settings: await listSettings(ctx.env), settingsKeyConfigured: !!ctx.env.SETTINGS_KEY });
  });

  router.put('/api/admin/settings/:key', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const body = await readJson(ctx.request);
    const key = ctx.params.key;
    await saveSetting(ctx.env, key, body.value, admin.id);
    await audit(ctx.env, admin.id, body.value == null || body.value === '' ? 'setting.clear' : 'setting.update', key,
      SETTINGS[key]?.secret ? null : { value: body.value });
    return json({ settings: await listSettings(ctx.env) });
  });

  // Try every model in a chain with a tiny prompt and report which ones work.
  router.post('/api/admin/ai/test', async (ctx) => {
    await requireAdmin(ctx);
    const body = await readJson(ctx.request);
    const chainKey = body.chain === 'chat' ? 'chain_chat' : 'chain_grade';
    const chain = await getSetting(ctx.env, chainKey);
    const aiRun = newAiRun({ externalBudget: 12 });
    const prompt = {
      system: 'Reply with ONLY this JSON: {"ok": true, "tip": "<one short healthy-habit tip>"}',
      messages: [{ role: 'user', content: 'Test' }],
      json: true, maxTokens: 512,
    };
    const results = [];
    for (const step of chain) {
      const started = Date.now();
      try {
        const text = await callProvider(ctx.env, aiRun, step, prompt);
        results.push({ ...step, ok: true, ms: Date.now() - started, sample: text.slice(0, 160) });
      } catch (err) {
        results.push({ ...step, ok: false, ms: Date.now() - started, error: err.message.slice(0, 200) });
      }
    }
    return json({ chain: chainKey, results });
  });

  // List Gemini models this API key can use (to pick exact model ids).
  router.get('/api/admin/ai/gemini-models', async (ctx) => {
    await requireAdmin(ctx);
    const key = await getSetting(ctx.env, 'gemini_api_key');
    if (!key) throw new ApiError(400, 'no_key', 'Save a Gemini API key first.');
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
      { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new ApiError(502, 'gemini_error', `Gemini said HTTP ${res.status}. Check the key.`);
    const data = await res.json();
    const models = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName }))
      .filter((m) => /gemini|gemma/i.test(m.id));
    return json({ models });
  });

  // --- Members ---------------------------------------------------------------
  router.patch('/api/admin/users/:id', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const body = await readJson(ctx.request);
    const target = await first(ctx.env.DB, 'SELECT * FROM users WHERE id = ?', ctx.params.id);
    if (!target) throw new ApiError(404, 'not_found', 'No such member.');
    if (target.id === admin.id && (body.active === false || body.role === 'member')) {
      throw new ApiError(400, 'invalid', "You can't deactivate or demote yourself.");
    }
    const changes = {};
    if ('active' in body) changes.active = body.active ? 1 : 0;
    if ('role' in body) {
      if (!['member', 'admin'].includes(body.role)) throw new ApiError(400, 'invalid', 'Bad role.');
      changes.role = body.role;
    }
    if ('aiEnabled' in body) changes.ai_enabled = body.aiEnabled ? 1 : 0;
    if (!Object.keys(changes).length) throw new ApiError(400, 'invalid', 'Nothing to change.');

    const stmts = [];
    for (const [col, val] of Object.entries(changes)) {
      stmts.push(ctx.env.DB.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).bind(val, target.id));
    }
    if (changes.active === 0) stmts.push(ctx.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(target.id));
    await ctx.env.DB.batch(stmts);
    await audit(ctx.env, admin.id, 'user.update', target.id, { name: target.display_name, ...changes });
    return json({ ok: true });
  });

  // --- Challenges ------------------------------------------------------------
  router.post('/api/admin/challenges', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const b = await readJson(ctx.request);
    const name = String(b.name || '').trim().slice(0, 60);
    if (!name) throw new ApiError(400, 'invalid', 'Give the challenge a name.');
    if (!isValidYmd(b.startDate) || !isValidYmd(b.endDate) || b.endDate < b.startDate) {
      throw new ApiError(400, 'invalid', 'Check the start and end dates.');
    }
    if (daysBetween(b.startDate, b.endDate) > 120) throw new ApiError(400, 'invalid', 'Max 120 days.');
    const id = newId();
    const stmts = [];
    if (b.active !== false) stmts.push(ctx.env.DB.prepare('UPDATE challenges SET active = 0'));
    stmts.push(ctx.env.DB.prepare('INSERT INTO challenges (id, name, start_date, end_date, active) VALUES (?, ?, ?, ?, ?)')
      .bind(id, name, b.startDate, b.endDate, b.active !== false ? 1 : 0));
    await ctx.env.DB.batch(stmts);
    await audit(ctx.env, admin.id, 'challenge.create', id, { name, start: b.startDate, end: b.endDate });
    return json({ ok: true, id });
  });

  router.patch('/api/admin/challenges/:id', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const b = await readJson(ctx.request);
    const c = await first(ctx.env.DB, 'SELECT * FROM challenges WHERE id = ?', ctx.params.id);
    if (!c) throw new ApiError(404, 'not_found', 'No such challenge.');
    const stmts = [];
    if (b.active) stmts.push(ctx.env.DB.prepare('UPDATE challenges SET active = 0'));
    stmts.push(ctx.env.DB.prepare('UPDATE challenges SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, c.id));
    await ctx.env.DB.batch(stmts);
    await audit(ctx.env, admin.id, b.active ? 'challenge.activate' : 'challenge.deactivate', c.id, { name: c.name });
    return json({ ok: true });
  });

  router.delete('/api/admin/challenges/:id', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const c = await first(ctx.env.DB, 'SELECT * FROM challenges WHERE id = ?', ctx.params.id);
    if (!c) throw new ApiError(404, 'not_found', 'No such challenge.');
    await run(ctx.env.DB, 'DELETE FROM challenges WHERE id = ?', c.id);   // logs are not touched
    await audit(ctx.env, admin.id, 'challenge.delete', c.id, { name: c.name });
    return json({ ok: true });
  });

  // --- Re-grade a day ----------------------------------------------------------
  router.post('/api/admin/grade', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const date = ctx.url.searchParams.get('date');
    const today = todayIST();
    if (!isValidYmd(date) || date > today) throw new ApiError(400, 'invalid', 'Pick today or a past date.');
    const rows = await all(ctx.env.DB, 'SELECT user_id FROM logs WHERE log_date = ?', date);
    const aiRun = newAiRun({ externalBudget: 40 });
    const summary = await gradeUsers(ctx.env, aiRun, date, rows.map((r) => r.user_id),
      { force: true, lock: date < today ? 'all' : 'none' });
    await audit(ctx.env, admin.id, 'grade.rerun', date, { logs: summary.length });
    return json({ date, graded: summary.length, summary });
  });

  // --- CSV export of every log -------------------------------------------------
  router.get('/api/admin/export.csv', async (ctx) => {
    const admin = await requireAdmin(ctx);
    const rows = await all(ctx.env.DB,
      `SELECT u.display_name AS name, u.email, l.log_date, l.steps, l.water_l, l.sleep_h,
              l.meal1_tags, l.meal1_note, l.meal2_tags, l.meal2_note, l.meal3_tags, l.meal3_note,
              l.workout_done, l.workout_type, l.workout_min, l.mood, l.notes,
              l.score, l.obj_score, l.meal_score, l.feedback, l.grade_provider, l.locked
       FROM logs l JOIN users u ON u.id = l.user_id ORDER BY l.log_date, u.display_name`);
    const cols = rows.length ? Object.keys(rows[0]) : ['name', 'email', 'log_date'];
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n');
    await audit(ctx.env, admin.id, 'export.csv', null, { rows: rows.length });
    return new Response('﻿' + csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="pal-fitness-logs-${todayIST()}.csv"`,
      },
    });
  });
}
