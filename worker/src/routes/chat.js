// AI coach chat. Uses the light "chat" model chain so it never eats the grading quota.

import { ApiError, json, readJson } from '../http.js';
import { all, first, newId } from '../db.js';
import { requireUser } from '../auth.js';
import { todayIST } from '../time.js';
import { getSetting } from '../settings.js';
import { loadUserData, buildContext } from '../ai/context.js';
import { runChain, newAiRun, usageStatements } from '../ai/providers.js';
import { chatSystem } from '../ai/prompts.js';

const HISTORY_TURNS = 10;   // previous messages sent to the AI for context

async function remaining(env, userId, today) {
  const limit = await getSetting(env, 'chat_daily_limit');
  const used = await first(env.DB,
    `SELECT COUNT(*) AS n FROM chat_messages WHERE user_id = ? AND chat_date = ? AND role = 'user'`, userId, today);
  return { limit, used: used.n, left: Math.max(0, limit - used.n) };
}

export function registerChatRoutes(router) {
  router.get('/api/chat', async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await all(ctx.env.DB,
      `SELECT id, role, content, created_at FROM chat_messages WHERE user_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT 60`, user.id);
    return json({
      messages: rows.reverse(),
      quota: await remaining(ctx.env, user.id, todayIST()),
      aiEnabled: !!user.ai_enabled,
    });
  });

  router.post('/api/chat', async (ctx) => {
    const user = await requireUser(ctx);
    const { env } = ctx;
    if (!user.ai_enabled) throw new ApiError(403, 'ai_off', 'Turn on the AI coach in your Profile to chat.');
    const body = await readJson(ctx.request);
    const message = String(body.message || '').trim();
    if (!message) throw new ApiError(400, 'invalid', 'Type a message first.');
    if (message.length > 600) throw new ApiError(400, 'invalid', 'Please keep messages under 600 characters.');

    const today = todayIST();
    const quota = await remaining(env, user.id, today);
    if (quota.left <= 0) {
      throw new ApiError(429, 'limit', quota.limit === 0
        ? 'Coach chat is turned off right now.'
        : `You've used today's ${quota.limit} coach messages. Chat resets at midnight.`);
    }

    const [data, history] = await Promise.all([
      loadUserData(env, [user.id], today),
      all(env.DB, `SELECT role, content FROM chat_messages WHERE user_id = ?
                   ORDER BY created_at DESC, rowid DESC LIMIT ?`, user.id, HISTORY_TURNS),
    ]);
    const context = buildContext(data.get(user.id), today);
    const messages = [
      ...history.reverse().map((m) => ({ role: m.role === 'coach' ? 'assistant' : 'user', content: m.content })),
      { role: 'user', content: message },
    ];

    const aiRun = newAiRun({ externalBudget: 8 });
    const result = await runChain(env, aiRun, 'chain_chat',
      { system: chatSystem(context), messages, maxTokens: 1024 },
      (text) => {
        const t = text.trim();
        if (t.length < 2) throw new Error('empty');
        return t.slice(0, 3000);
      });

    const reply = result?.value
      || "Sorry, the coach is taking a break right now (all AI services are busy). Please try again in a little while.";
    const userMsg = { id: newId(), role: 'user', content: message };
    const coachMsg = { id: newId(), role: 'coach', content: reply };

    // Only a successful answer is saved (and counts towards the daily limit).
    const stmts = usageStatements(aiRun).map(([sql, ...b]) => env.DB.prepare(sql).bind(...b));
    if (result) {
      stmts.push(
        env.DB.prepare(`INSERT INTO chat_messages (id, user_id, chat_date, role, content, created_at)
                        VALUES (?, ?, ?, 'user', ?, datetime('now'))`).bind(userMsg.id, user.id, today, message),
        env.DB.prepare(`INSERT INTO chat_messages (id, user_id, chat_date, role, content, provider, created_at)
                        VALUES (?, ?, ?, 'coach', ?, ?, datetime('now', '+1 second'))`)
          .bind(coachMsg.id, user.id, today, reply, result.provider));
    }
    if (stmts.length) await env.DB.batch(stmts);

    return json({
      messages: [userMsg, coachMsg],
      quota: result ? { ...quota, used: quota.used + 1, left: quota.left - 1 } : quota,
      ok: !!result,
    });
  });
}
