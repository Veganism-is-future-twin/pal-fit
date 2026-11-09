// Fetch wrapper: adds the session token, parses JSON, turns errors into ApiError.

import { API_BASE } from './config.js';

const TOKEN_KEY = 'pal.token';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* private mode: session lasts until the tab closes */ }
  memoryToken = token || null;
}
let memoryToken = null;

// Called when the server says the session is no longer valid.
let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(method, path, body, { raw = false } = {}) {
  const token = getToken() || memoryToken;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', "Can't reach the server. Check your internet connection and try again.");
  }

  if (raw && res.ok) return res;

  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }

  if (!res.ok) {
    const code = data?.error?.code || 'error';
    const message = data?.error?.message || `Something went wrong (HTTP ${res.status}).`;
    if (res.status === 401 || code === 'account_disabled') onUnauthorized(code, message);
    throw new ApiError(res.status, code, message);
  }
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b = {}) => api('PUT', p, b);
export const patch = (p, b = {}) => api('PATCH', p, b);
export const del = (p) => api('DELETE', p);
