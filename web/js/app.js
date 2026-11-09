// App entry: boot, routing, navigation, service worker.

import { get, getToken, setToken, setUnauthorizedHandler } from './api.js';
import { state, refreshMe, isAdmin, clearMe, staleMe, pref, setPref, clearCache } from './store.js';
import { IS_LOCAL } from './config.js';
import { loadGoogleScript } from './auth.js';
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
  document.getElementById('app').classList.toggle('with-nav', on);
  nav.hidden = !on;
  topbar.hidden = !on;
  view.classList.toggle('no-nav', !on);
}

// Every navigation gets a number. If the user switches tabs before a screen has
// finished loading, the old screen's late result is thrown away (it renders into
// its own container, which is no longer on the page) — so screens never mix.
let renderSeq = 0;

/** Give a screen its own fresh container inside #view and return it. */
function freshScreen() {
  const screen = document.createElement('div');
  screen.className = 'screen';
  view.replaceChildren(screen);
  return screen;
}

async function runScreen(seq, renderFn, args) {
  const screen = freshScreen();
  // Screens that draw from saved data paint immediately; show a spinner only if they don't.
  const spin = setTimeout(() => { if (seq === renderSeq && !screen.firstChild) mount(screen, loadingView()); }, 120);
  let teardown = null;
  try {
    teardown = await renderFn(screen, args);
  } catch (err) {
    console.error(err);
    if (seq === renderSeq) mount(screen, errorView(err, () => render()));
  } finally {
    clearTimeout(spin);
  }
  if (seq !== renderSeq) { try { teardown?.(); } catch { /* ignore */ } return; }   // user already moved on
  cleanup = teardown || null;
}

async function render() {
  const seq = ++renderSeq;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  window.scrollTo(0, 0);

  // Not signed in → login.
  if (!getToken()) {
    showChrome(false);
    await runScreen(seq, renderLogin, { onSignedIn });
    return;
  }

  // First load on this device (nothing saved yet): fetch the user's summary.
  if (!state.me) {
    showChrome(false);
    mount(freshScreen(), loadingView());
    try {
      await refreshMe();
    } catch (err) {
      if (seq !== renderSeq) return;
      if (!getToken()) return render();          // session was rejected → login
      mount(freshScreen(), errorView(err, () => render()));
      return;
    }
    if (seq !== renderSeq) return;
  }

  // Onboarding only right after someone's very FIRST sign-in.
  const name = currentRoute();
  if (pref('onboard') === '1' || name === 'onboarding') {
    if (pref('onboard') !== '1') { location.replace('#/home'); return; }
    if (name !== 'onboarding') { location.replace('#/onboarding'); return; }
    showChrome(false);
    await runScreen(seq, renderOnboarding, { done: () => { setPref('onboard', null); go('home'); } });
    return;
  }

  const route = ROUTES[name];
  if (!route || (route.admin && !isAdmin())) { location.replace('#/home'); return; }

  showChrome(true);
  buildNav(name);
  setTopbar(route.title);
  document.title = `${route.title} · PAL Fitness`;
  await runScreen(seq, route.render, { go, setTopbar });
  if (seq === renderSeq) view.focus({ preventScroll: true });
}

async function onSignedIn() {
  clearMe();
  await render();
}

export function signOut(message) {
  setToken(null);
  clearMe();
  clearCache();          // saved screens belong to this account only
  setPref('onboard', null);
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
    if (istToday !== state.me.today) { staleMe(); render(); }
  }
});

// Service worker: caches the app shell so it opens instantly and works offline.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  });
}

// Not signed in? Start loading Google's sign-in script right away.
if (!getToken()) loadGoogleScript().catch(() => {});
// The developer login only exists on localhost; ask the local API whether it's on.
if (IS_LOCAL) get('/api/auth/config').then((c) => { state.config = c; }).catch(() => {});
render();
