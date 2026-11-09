// Shared app state.
//
// Speed: the last /api/me response is kept on this device so the app can draw
// instantly on the next open, then refresh in the background.

import { get } from './api.js';

const ME_KEY = 'pal.me';

function loadCachedMe() {
  try { return JSON.parse(localStorage.getItem(ME_KEY) || 'null'); } catch { return null; }
}

export const state = {
  me: loadCachedMe(),   // response of GET /api/me (possibly from cache)
  meAt: 0,              // when `me` was last fetched from the server (0 = from cache)
  config: null,         // response of GET /api/auth/config (localhost only)
};

/** Reload the signed-in user's summary from the server. */
export async function refreshMe() {
  const me = await get('/api/me');
  state.me = me;
  state.meAt = Date.now();
  try { localStorage.setItem(ME_KEY, JSON.stringify(me)); } catch { /* storage full/blocked */ }
  return me;
}

/** `me` if it was fetched recently, otherwise fetch it. */
export async function getMe(maxAgeMs = 15000) {
  if (state.me && Date.now() - state.meAt < maxAgeMs) return state.me;
  return refreshMe();
}

/** Mark `me` as stale (e.g. after saving a log) without throwing it away. */
export function staleMe() { state.meAt = 0; }

export function clearMe() {
  state.me = null;
  state.meAt = 0;
  try { localStorage.removeItem(ME_KEY); } catch { /* ignore */ }
}

export const isAdmin = () => state.me?.user?.role === 'admin';

// Small helpers for per-device preferences (theme, dismissed banners).
export function pref(key, fallback = null) {
  try { return localStorage.getItem('pal.' + key) ?? fallback; } catch { return fallback; }
}
export function setPref(key, value) {
  try {
    if (value == null) localStorage.removeItem('pal.' + key);
    else localStorage.setItem('pal.' + key, value);
  } catch { /* storage unavailable */ }
}
