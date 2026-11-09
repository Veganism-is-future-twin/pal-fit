// Home: greeting, challenge, today's card, coach feedback, streak, who logged today.

import { get } from '../api.js';
import { state, refreshMe, pref, setPref } from '../store.js';
import { h, mount, icon, avatar, scoreRing, greetingWord, firstName, fmtDate } from '../ui.js';
import { installBanner } from '../install.js';
import { statGrid, coachCard, mealsLogged } from './common.js';

export async function renderHome(view, { go }) {
  const me = await refreshMe();
  const { user, todayLog, yesterdayLog, streak, targets, challenge } = me;
  const stops = [];

  // --- greeting
  const greeting = h('div', { class: 'greeting' },
    avatar(user.displayName, user.photoUrl, 'lg'),
    h('div', { class: 'grow' },
      h('div', { class: 'eyebrow' }, fmtDate(me.today, { weekday: 'long', day: 'numeric', month: 'long' })),
      h('h1', null, `${greetingWord()}, ${firstName(user.displayName)}`)));

  // --- challenge
  let challengeEl = null;
  if (challenge && !challenge.ended) {
    const pct = challenge.started ? Math.round((challenge.day / challenge.totalDays) * 100) : 0;
    challengeEl = h('div', { class: 'card' },
      h('div', { class: 'spread' },
        h('div', { class: 'row', style: 'gap:10px' }, icon('flag'), h('b', null, challenge.name)),
        h('span', { class: 'faint num' }, challenge.started ? `Day ${challenge.day} of ${challenge.totalDays}` : `Starts ${fmtDate(challenge.startDate)}`)),
      h('div', { class: 'progress' }, h('div', { style: `width:${pct}%` })));
  }

  // --- today
  let todayEl;
  if (!todayLog) {
    todayEl = h('div', { class: 'card stack' },
      h('div', { class: 'row' },
        h('div', { class: 'big-icon' }, icon('note')),
        h('div', { class: 'grow' }, h('h2', null, "Today isn't logged yet"),
          h('p', { class: 'muted small' }, 'About 30 seconds — mostly taps.'))),
      h('button', { class: 'btn block lg', onclick: () => go('log') }, icon('plus'), 'Log today'));
  } else {
    todayEl = h('div', { class: 'card stack' },
      h('div', { class: 'row' },
        scoreRing(todayLog.score, { label: 'TODAY' }),
        h('div', { class: 'grow' },
          h('div', { class: 'row', style: 'gap:8px' }, h('h2', null, 'Today is logged'), h('span', { class: 'tag good' }, icon('check'), 'Saved')),
          h('p', { class: 'muted small' }, `${mealsLogged(todayLog)} of 3 meals logged · editable until midnight`))),
      statGrid(todayLog, targets),
      h('button', { class: 'btn secondary block', onclick: () => go('log') }, icon('edit'), 'Update today'));
  }

  // --- coach
  let coachEl = null;
  if (todayLog?.feedback || todayLog?.gradeStatus === 'pending') {
    const c = coachCard(todayLog, {
      title: 'Coach feedback',
      onUpdate: (l) => {
        state.me.todayLog = l;
        const ring = todayEl.querySelector('.score-ring');
        if (ring) ring.replaceWith(scoreRing(l.score, { label: 'TODAY' }));
      },
    });
    stops.push(c.stop);
    coachEl = c.el;
  }
  let yesterdayEl = null;
  if (yesterdayLog) {
    yesterdayEl = h('div', { class: 'card' },
      h('div', { class: 'card-title' }, icon('calendar'), h('h2', { class: 'grow' }, 'Yesterday'),
        scoreRing(yesterdayLog.score, { small: true })),
      yesterdayLog.feedback ? h('p', { class: 'coach-text muted small' }, yesterdayLog.feedback) : null,
      h('p', { class: 'faint mt-8' }, yesterdayLog.locked ? 'Final score' : 'Final score locks at midnight.'));
  }

  // --- streak
  const toBonus = 7 - (streak % 7);
  const streakEl = h('div', { class: 'card streak-card' },
    h('div', { class: 'big-icon' + (streak > 0 ? ' good' : '') }, icon('flame')),
    h('div', { class: 'grow' },
      h('div', { class: 'streak-num' }, `${streak} day${streak === 1 ? '' : 's'}`),
      h('p', { class: 'muted small' }, streak === 0 ? 'Log today to start a streak.'
        : !todayLog ? 'Log today to keep your streak.'
          : streak % 7 === 0 ? 'Weekly streak bonus earned.' : `${toBonus} more day${toBonus === 1 ? '' : 's'} to a +10 bonus`)),
    h('div', { class: 'center' }, h('div', { class: 'num', style: 'font-weight:700;font-size:1.15rem' }, String(me.totalDaysLogged)), h('div', { class: 'faint' }, 'days logged')));

  // --- who logged
  const whoEl = h('div', { class: 'card' },
    h('div', { class: 'card-title' }, icon('users'), h('h2', { class: 'grow' }, 'Logged today'),
      h('a', { href: '#/board', class: 'small' }, 'Leaderboard')),
    h('div', { class: 'skeleton' }));
  get('/api/today/status').then((s) => {
    const done = s.people.filter((p) => p.logged);
    const notYet = s.people.filter((p) => !p.logged);
    whoEl.lastChild.replaceWith(h('div', { class: 'stack-sm' },
      h('p', { class: 'small muted' }, `${done.length} of ${s.people.length} members`),
      h('div', { class: 'avatar-row' },
        ...done.map((p) => h('span', { title: p.name }, avatar(p.name, p.photoUrl, 'sm'))),
        ...notYet.map((p) => h('span', { title: `${p.name} (not yet)` }, avatar(p.name, p.photoUrl, 'sm', 'dim'))))));
  }).catch(() => whoEl.lastChild.replaceWith(h('p', { class: 'faint' }, "Couldn't load right now.")));

  // --- install banner (until dismissed)
  let installEl = null;
  if (!pref('installDismissed')) {
    installEl = installBanner(() => { setPref('installDismissed', '1'); installEl?.remove(); });
  }

  // --- profile nudge
  const nudge = !me.profile ? h('a', { href: '#/profile', class: 'banner warn', style: 'text-decoration:none;color:inherit' },
    icon('info'), h('div', { class: 'grow small' }, h('b', null, 'Complete your profile'), h('br'),
      'Add your goal so the coach can personalise your plan and scores.')) : null;

  mount(view, h('div', { class: 'stack' },
    greeting, challengeEl, nudge, todayEl, coachEl, h('div', { class: 'grid-2' }, streakEl, yesterdayEl || whoEl),
    yesterdayEl ? whoEl : null, installEl));

  return () => stops.forEach((s) => s());
}
