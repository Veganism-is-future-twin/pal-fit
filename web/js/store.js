// Shared app state.

import { get } from './api.js';

export const state = {
  me: null,          // response of GET /api/me
  config: null,      // response of GET /api/auth/config
};

/** Reload the signed-in user's summary (Home data, targets, profile…). */
export async function refreshMe() {
  state.me = await get('/api/me');
  return state.me;
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
