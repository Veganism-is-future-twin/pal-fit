// Service worker: caches the app shell so the app opens instantly and works
// offline. API calls (different origin) and Google sign-in are never cached.
// Bump VERSION whenever you deploy front-end changes.

const VERSION = 'pal-v8';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/api.js', './js/charts.js', './js/auth.js', './js/config.js', './js/install.js', './js/store.js', './js/ui.js',
  './js/screens/admin.js', './js/screens/board.js', './js/screens/coach.js', './js/screens/common.js',
  './js/screens/home.js', './js/screens/log.js', './js/screens/login.js', './js/screens/onboarding.js',
  './js/screens/profile.js', './js/screens/profile-form.js',
  './icons/pal-logo.png', './icons/favicon-64.png', './icons/icon-192.png', './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (so updates show up right away), cache as offline fallback.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // API, Google, etc.

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
