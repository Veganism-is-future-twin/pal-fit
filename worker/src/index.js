// PAL Fitness API — Cloudflare Worker entry point.
//
//   fetch()     -> every HTTP request from the web app
//   scheduled() -> the nightly cron jobs (see [triggers] in wrangler.toml)

import { Router } from './router.js';
import { ApiError, errorResponse, json, corsHeaders, withCors } from './http.js';
import { todayIST, istDate } from './time.js';
import { first } from './db.js';

const router = new Router();

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check: confirms the Worker is up, the DB is reachable and shows the
// server's idea of "today" in IST. Safe to call without signing in.
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

// More route groups (auth, me, logs, leaderboard, admin) get registered here
// in the next milestones.

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------
async function handleFetch(request, env, exec) {
  // Browser CORS preflight.
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  const url = new URL(request.url);
  const found = router.match(request.method, url.pathname);

  if (!found) return errorResponse(404, 'not_found', 'No such endpoint.');
  if (found.methodNotAllowed) {
    return errorResponse(405, 'method_not_allowed', 'Method not allowed.');
  }

  try {
    return await found.handler({ request, env, exec, params: found.params, url });
  } catch (err) {
    if (err instanceof ApiError) return errorResponse(err.status, err.code, err.message);
    console.error('Unhandled error', url.pathname, err);
    return errorResponse(500, 'internal', 'Something went wrong. Please try again.');
  }
}

export default {
  async fetch(request, env, exec) {
    const response = await handleFetch(request, env, exec);
    return withCors(response, request, env);
  },

  // Cron: '30 18 * * *' (00:00 IST) = grade the day that just ended,
  //       '30 20 * * *' (02:00 IST) = retry anything still ungraded.
  // Grading is built after the AI coach design is agreed.
  async scheduled(event, env, exec) {
    const now = new Date(event.scheduledTime);
    // Step back 3 hours: works for both the 00:00 and 02:00 IST runs and
    // always lands on the IST day that just ended.
    const dayToGrade = istDate(new Date(now.getTime() - 3 * 60 * 60 * 1000));
    console.log(`cron ${event.cron}: would grade ${dayToGrade} (grading not implemented yet)`);
  },
};
