// Leaderboard with ranges, podium, and a WhatsApp nudge for people who haven't logged.

import { get } from '../api.js';
import { APP_URL } from '../config.js';
import { h, mount, icon, avatar, segmented, loadingView, errorView, fmtInt, fmtDate, firstName } from '../ui.js';

let lastRange = 'challenge';

export async function renderBoard(view) {
  const body = h('div', { class: 'stack' });
  const header = h('div', { class: 'stack-sm' },
    h('h1', { class: 'page-title' }, 'Leaderboard'),
    segmented([
      { value: 'challenge', label: 'Challenge' },
      { value: 'week', label: 'This week' },
      { value: 'today', label: 'Today' },
    ], lastRange, (v) => { lastRange = v; load(); }));

  mount(view, h('div', { class: 'stack' }, header, body));

  async function load() {
    mount(body, loadingView());
    try {
      const data = await get('/api/leaderboard?range=' + lastRange);
      draw(data);
    } catch (e) {
      mount(body, errorView(e, load));
    }
  }

  function draw(data) {
    const rows = data.rows;
    const notLogged = rows.filter((r) => !r.loggedToday);
    const subtitle = data.from === data.to ? fmtDate(data.from)
      : `${fmtDate(data.from, { day: 'numeric', month: 'short' })} – ${fmtDate(data.to, { day: 'numeric', month: 'short' })}`;

    const PLACES = ['1ST', '2ND', '3RD'];
    const top = rows.filter((r) => r.points > 0).slice(0, 3);
    const podium = top.length >= 3 ? h('div', { class: 'podium' },
      [top[1], top[0], top[2]].map((r, i) => h('div', { class: 'p' + (i === 1 ? ' first' : '') },
        h('div', { class: 'place' }, PLACES[[1, 0, 2][i]]),
        avatar(r.name, r.photoUrl, i === 1 ? 'lg' : ''),
        h('div', { class: 'n' }, firstName(r.name)),
        h('b', null, fmtInt(r.points))))) : null;

    const meta = (iconName, text) => h('span', null, icon(iconName), text);
    const list = h('div', { class: 'board-list' }, rows.map((r) => h('div', { class: 'board-row' + (r.isMe ? ' me' : '') },
      h('div', { class: 'board-rank' + (r.rank <= 3 && r.points > 0 ? ' top' : '') }, String(r.rank)),
      avatar(r.name, r.photoUrl),
      h('div', { style: 'min-width:0' },
        h('div', { class: 'board-name' }, r.name, r.isMe ? ' (you)' : ''),
        h('div', { class: 'board-meta' },
          meta('flame', `${r.streak} streak`),
          meta('calendar', `${r.daysLogged} day${r.daysLogged === 1 ? '' : 's'}`),
          r.avgScore != null && meta('star', `${r.avgScore} avg`))),
      h('div', { class: 'board-points' }, fmtInt(r.points), h('small', null, 'pts')))));

    const nudge = notLogged.length ? h('div', { class: 'card stack-sm' },
      h('div', { class: 'card-title' }, icon('users'), h('h2', null, 'Not logged today')),
      h('div', { class: 'row-wrap' }, notLogged.map((r) => h('span', { class: 'tag' }, firstName(r.name)))),
      h('a', {
        class: 'btn whatsapp block mt-8', target: '_blank', rel: 'noopener',
        href: 'https://wa.me/?text=' + encodeURIComponent(
          `Hi PAL fam 💚 Friendly reminder to log today in PAL Fitness — it takes 30 seconds.\n\nStill to log: ${notLogged.map((r) => firstName(r.name)).join(', ')}\n\n${APP_URL}`),
      }, icon('share'), 'Send reminder on WhatsApp')) : h('div', { class: 'banner good' }, icon('check'),
      h('div', null, h('b', null, 'Everyone has logged today.')));

    mount(body,
      h('p', { class: 'muted small' }, `${data.label} · ${subtitle}`),
      podium,
      h('div', { class: 'card' }, rows.length ? list : h('p', { class: 'muted' }, 'No members yet.')),
      h('p', { class: 'faint' }, 'Points: 20 for logging a day + up to 80 from your score (score × 0.8). +10 bonus every 7-day streak.'),
      nudge);
  }

  await load();
}
