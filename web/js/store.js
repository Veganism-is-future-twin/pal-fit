// Shared app state + a small on-device cache.
//
// Speed & offline: every screen first draws from data saved on this device
// (instant, works offline), then fetches fresh data and redraws only if it
// changed. Saved data is cleared on sign-out.

import { get } from './api.js';

const ME_KEY = 'pal.me';
const CACHE_PREFIX = 'pal.cache.';

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full/blocked */ }
}

export const state = {
  me: readJson(ME_KEY),   // response of GET /api/me (possibly from cache)
  meAt: 0,                // when `me` was last fetched from the server (0 = from cache)
  config: null,           // response of GET /api/auth/config (localhost only)
};

/** Reload the signed-in user's summary from the server. */
export async function refreshMe() {
  const me = await get('/api/me');
  state.me = me;
  state.meAt = Date.now();
  writeJson(ME_KEY, me);
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

// ---------------------------------------------------------------------------
// Stale-while-revalidate for any GET endpoint.
//
//   await swr('/api/leaderboard?range=week', (data, { fresh }) => draw(data));
//
// Calls `draw` right away with saved data (if any), then again with fresh data
// from the server if it differs. If the server can't be reached but saved data
// exists, the saved data stays on screen. Throws only if there is nothing to show.
// ---------------------------------------------------------------------------
const memo = new Map();   // same-session memory cache (avoids JSON parsing twice)

export function cached(path) {
  if (memo.has(path)) return memo.get(path);
  const hit = readJson(CACHE_PREFIX + path);
  if (hit) memo.set(path, hit);
  return hit;
}

export function putCache(path, data) {
  memo.set(path, data);
  writeJson(CACHE_PREFIX + path, data);
}

export async function swr(path, draw, { isCurrent = () => true } = {}) {
  const saved = cached(path);
  if (saved) draw(saved, { fresh: false });
  try {
    const data = await get(path);
    if (!isCurrent()) return data;
    if (!saved || JSON.stringify(saved) !== JSON.stringify(data)) {
      putCache(path, data);
      draw(data, { fresh: true });
    }
    return data;
  } catch (err) {
    if (saved) return saved;   // offline / server hiccup: keep showing saved data
    throw err;
  }
}

export function clearCache() {
  memo.clear();
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
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
