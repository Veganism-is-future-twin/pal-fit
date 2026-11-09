// App entry: boot, routing, navigation, service worker.

import { get, getToken, setToken, setUnauthorizedHandler } from './api.js';
import { state, refreshMe, isAdmin } from './store.js';
import { h, icon, mount, loadingView, errorView, toast } from './ui.js';
import './install.js';

import { renderLogin } from './screens/login.js';
import { renderOnboarding } from './screens/onboarding.js';
import { renderHome } from './screens/home.js';
import { renderLog } from './screens/log.js';
import { renderCoach } from './screens/coach.js';
import { renderBoard } from './screens/board.js';
import { renderProfile } from './screens/profile.js';
import { renderAdmin } from './screens/admin.js';

const view = document.getElementById('view');
const nav = document.getElementById('nav');
const topbar = document.getElementById('topbar');

const ROUTES = {
  home: { render: renderHome, title: 'Home' },
  log: { render: renderLog, title: "Today's log" },
  coach: { render: renderCoach, title: 'Coach' },
  board: { render: renderBoard, title: 'Leaderboard' },
  profile: { render: renderProfile, title: 'Profile' },
  admin: { render: renderAdmin, title: 'Admin', admin: true },
};

let cleanup = null;    // the current screen's teardown (stops timers etc.)

export function go(route) {
  if (location.hash === '#/' + route) render();
  else location.hash = '#/' + route;
}

function currentRoute() {
  const r = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
  return r;
}

function buildNav(active) {
  const link = (route, label, iconName, extraClass = '') => h('a', {
    href: '#/' + route, class: `${extraClass} ${active === route ? 'active' : ''}`,
    'aria-current': active === route ? 'page' : null,
  }, extraClass.includes('log-tab') ? h('span', { class: 'plus' }, icon(iconName)) : icon(iconName), h('span', null, label));

  mount(nav,
    h('a', { href: '#/home', class: 'brand' }, h('img', { src: 'icons/pal-logo.png', alt: '', class: 'logo' }),
      h('div', null, h('b', null, 'PAL Fitness'), h('span', null, 'Pune Animal Liberation'))),
    link('home', 'Home', 'home'),
    link('board', 'Board', 'trophy'),
    link('log', 'Log', 'plus', 'log-tab'),
    link('coach', 'Coach', 'chat'),
    link('profile', 'Profile', 'user'),
    isAdmin() && link('admin', 'Admin', 'shield', 'nav-extra'),
    h('div', { class: 'nav-foot' }, 'Personhood for all animals'),
  );
  nav.hidden = false;
}

/** Set the top bar for the current screen. */
export function setTopbar(title, ...actions) {
  mount(topbar,
    h('img', { src: 'icons/pal-logo.png', alt: '', class: 'brand-mark logo' }),
    h('div', { class: 'title' }, title),
    ...actions);
  topbar.hidden = false;
}

function showChrome(on) {
  nav.hidden = !on;
  topbar.hidden = !on;
  view.classList.toggle('no-nav', !on);
}

async function render() {
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  window.scrollTo(0, 0);

  // Not signed in → login.
  if (!getToken()) {
    showChrome(false);
    cleanup = await renderLogin(view, { onSignedIn });
    return;
  }

  // Load the user's summary once (and after sign-in).
  if (!state.me) {
    showChrome(false);
    mount(view, loadingView());
    try {
      await refreshMe();
    } catch (err) {
      if (!getToken()) return render();          // session was rejected → login
      mount(view, errorView(err, () => render()));
      return;
    }
  }

  const name = currentRoute();
  if (name === 'onboarding' || (!state.me.profile && !sessionStorage.getItem('pal.skipOnboarding') && name !== 'profile')) {
    if (name !== 'onboarding') { location.replace('#/onboarding'); return; }
    showChrome(false);
    cleanup = await renderOnboarding(view, { done: () => go('home') });
    return;
  }

  let route = ROUTES[name];
  if (!route || (route.admin && !isAdmin())) { location.replace('#/home'); return; }

  showChrome(true);
  buildNav(name);
  setTopbar(route.title);
  document.title = `${route.title} · PAL Fitness`;
  mount(view, loadingView());
  try {
    cleanup = await route.render(view, { go, setTopbar });
  } catch (err) {
    console.error(err);
    mount(view, errorView(err, () => render()));
  }
  view.focus({ preventScroll: true });
}

async function onSignedIn() {
  state.me = null;
  await render();
}

export function signOut(message) {
  setToken(null);
  state.me = null;
  sessionStorage.removeItem('pal.skipOnboarding');
  if (message) toast(message, { error: true });
  location.hash = '#/home';
  render();
}

setUnauthorizedHandler((code, message) => {
  if (getToken()) signOut(code === 'account_disabled' ? message : 'Please sign in again.');
});

window.addEventListener('hashchange', render);

// Re-check today's status when the app comes back to the foreground
// (e.g. it was open overnight).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.me && state.me.today) {
    const istToday = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    if (istToday !== state.me.today) { state.me = null; render(); }
  }
});

// Service worker: caches the app shell so it opens instantly and works offline.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  });
}

// Fetch public config (Google client id) in the background, then render.
get('/api/auth/config').then((c) => { state.config = c; }).catch(() => {}).finally(() => {});
render();
