// Leaderboard + "who has logged today". Shows ONLY public info:
// name, photo, points, streak, days logged, average score. Never body data or goals.

import { ApiError, json } from '../http.js';
import { all } from '../db.js';
import { requireUser } from '../auth.js';
import { todayIST, addDays, weekStart } from '../time.js';
import { currentStreak, pointsInRange } from '../scoring.js';
import { activeChallenge } from './me.js';

export function registerBoardRoutes(router) {
  router.get('/api/leaderboard', async (ctx) => {
    const me = await requireUser(ctx);
    const { env } = ctx;
    const today = todayIST();
    const range = ctx.url.searchParams.get('range') || 'challenge';

    let from, to = today, label;
    const challenge = await activeChallenge(env, today);
    if (range === 'today') { from = today; label = 'Today'; }
    else if (range === 'week') { from = weekStart(today); label = 'This week'; }
    else if (range === 'challenge') {
      if (challenge) {
        from = challenge.startDate;
        to = challenge.endDate < today ? challenge.endDate : today;
        label = challenge.name;
      } else {
        from = today.slice(0, 8) + '01';     // no challenge set: this calendar month
        label = 'This month';
      }
    } else throw new ApiError(400, 'invalid', 'Unknown range.');

    // Streaks need history before `from`, so load a little extra (max ~13 users × 120 days).
    const histFrom = addDays(from, -60);
    const [users, logs] = await Promise.all([
      all(env.DB, 'SELECT id, display_name, photo_url FROM users WHERE active = 1'),
      all(env.DB, `SELECT l.user_id, l.log_date, l.score FROM logs l JOIN users u ON u.id = l.user_id
                   WHERE u.active = 1 AND l.log_date BETWEEN ? AND ? ORDER BY l.log_date`, histFrom, today),
    ]);

    const byUser = new Map(users.map((u) => [u.id, []]));
    for (const l of logs) byUser.get(l.user_id)?.push(l);

    const rows = users.map((u) => {
      const ul = byUser.get(u.id);
      const dates = new Set(ul.map((l) => l.log_date));
      const p = pointsInRange(ul, dates, from, to);
      return {
        userId: u.id,
        name: u.display_name,
        photoUrl: u.photo_url,
        points: p.points,
        daysLogged: p.daysLogged,
        avgScore: p.avgScore,
        streak: currentStreak(dates, today),
        loggedToday: dates.has(today),
        isMe: u.id === me.id,
      };
    });

    rows.sort((a, b) => b.points - a.points || b.daysLogged - a.daysLogged
      || (b.avgScore ?? -1) - (a.avgScore ?? -1) || a.name.localeCompare(b.name));
    let rank = 0, prev = null;
    rows.forEach((r, i) => {
      const key = `${r.points}|${r.daysLogged}|${r.avgScore}`;
      if (key !== prev) rank = i + 1;
      r.rank = rank; prev = key;
    });

    return json({ range, label, from, to, today, challenge, rows });
  });

  router.get('/api/today/status', async (ctx) => {
    await requireUser(ctx);
    const today = todayIST();
    const rows = await all(ctx.env.DB,
      `SELECT u.id, u.display_name, u.photo_url, (l.id IS NOT NULL) AS logged
       FROM users u LEFT JOIN logs l ON l.user_id = u.id AND l.log_date = ?
       WHERE u.active = 1 ORDER BY u.display_name`, today);
    return json({
      today,
      people: rows.map((r) => ({ userId: r.id, name: r.display_name, photoUrl: r.photo_url, logged: !!r.logged })),
    });
  });
}
