// PAL Fitness API — Cloudflare Worker entry point.
//
//   fetch()     -> every HTTP request from the web app
//   scheduled() -> the nightly cron jobs (see [triggers] in wrangler.toml)

import { Router } from './router.js';
import { ApiError, errorResponse, json, corsHeaders, withCors } from './http.js';
import { todayIST, istDate } from './time.js';
import { first } from './db.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerMeRoutes } from './routes/me.js';
import { registerLogRoutes } from './routes/logs.js';
import { registerBoardRoutes } from './routes/board.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerAdminRoutes } from './routes/admin.js';
import { gradeUsers, unlockedUserIds } from './ai/grade.js';
import { newAiRun } from './ai/providers.js';

const router = new Router();

// Health check: is the Worker up, is the DB reachable, what is "today" in IST.
router.get('/api/health', async ({ env }) => {
  let db = 'ok';
  try {
    await first(env.DB, 'SELECT 1 AS ok');
  } catch (err) {
    console.error('health: db check failed', err);
    db = 'error';
  }
  return json({ ok: db === 'ok', today: todayIST(), timezone: env.TIMEZONE, db });
});

registerAuthRoutes(router);
registerMeRoutes(router);
registerLogRoutes(router);
registerBoardRoutes(router);
registerChatRoutes(router);
registerAdminRoutes(router);

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------
async function handleFetch(request, env, exec) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  const url = new URL(request.url);
  const found = router.match(request.method, url.pathname);

  if (!found) return errorResponse(404, 'not_found', 'No such endpoint.');
  if (found.methodNotAllowed) return errorResponse(405, 'method_not_allowed', 'Method not allowed.');

  try {
    return await found.handler({ request, env, exec, params: found.params, url });
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err.status, err.code, err.message);
    console.error('Unhandled error', url.pathname, err);
    return errorResponse(500, 'internal', 'Something went wrong. Please try again.');
  }
}

/**
 * Nightly jobs.
 *   00:00 IST: AI-grade any log whose data changed since its last grade, then
 *              lock every up-to-date log for the day that just ended.
 *   02:00 IST: retry anything still not graded, then lock everything (rules if AI is down).
 */
async function nightly(event, env) {
  const now = new Date(event.scheduledTime);
  // Step back 3 hours: lands on the IST day that just ended for both runs.
  const date = istDate(new Date(now.getTime() - 3 * 60 * 60 * 1000));
  const finalRun = event.cron === '30 20 * * *';
  const userIds = await unlockedUserIds(env, date);
  if (!userIds.length) {
    console.log(`cron ${event.cron}: nothing to lock for ${date}`);
    return;
  }
  const summary = await gradeUsers(env, newAiRun({ externalBudget: 40 }), date, userIds,
    { lock: finalRun ? 'all' : 'if_graded' });
  console.log(`cron ${event.cron}: ${date}`, JSON.stringify(summary));
}

export default {
  async fetch(request, env, exec) {
    const response = await handleFetch(request, env, exec);
    return withCors(response, request, env);
  },

  async scheduled(event, env, exec) {
    exec.waitUntil(nightly(event, env).catch((e) => console.error('cron failed', e)));
  },
};
