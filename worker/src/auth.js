// Google Sign-In verification + bearer-token sessions.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ApiError } from './http.js';
import { first, run } from './db.js';
import { sqlNow, todayIST } from './time.js';

const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
// Created once per Worker instance; jose caches Google's public keys.
const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

const SESSION_DAYS = 30;

/** Verify a Google ID token (from the Sign-In button) and return its claims. */
export async function verifyGoogleCredential(credential, env) {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new ApiError(503, 'google_not_configured', 'Google Sign-In is not set up on the server yet.');
  }
  try {
    const { payload } = await jwtVerify(credential, googleJwks, {
      issuer: GOOGLE_ISSUERS,
      audience: env.GOOGLE_CLIENT_ID,
    });
    if (payload.email_verified !== true) {
      throw new ApiError(401, 'email_not_verified', 'Your Google email is not verified.');
    }
    return payload; // { sub, email, name, picture, ... }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(401, 'invalid_google_token', 'Google sign-in failed. Please try again.');
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** SHA-256 hex digest of a string. */
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * New session for a user: returns the raw token (only ever sent to the client
 * once) plus the D1 statements that store it — run them in your batch.
 */
export async function sessionStatements(env, userId) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  return {
    token,
    statements: [
      env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
        .bind(await sha256Hex(token), userId, sqlNow(expires)),
      // Housekeeping: drop this user's expired sessions.
      env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').bind(userId, sqlNow()),
    ],
  };
}

export async function deleteSession(env, token) {
  await run(env.DB, 'DELETE FROM sessions WHERE token_hash = ?', await sha256Hex(token));
}

function bearerToken(request) {
  const h = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

/**
 * Resolve the signed-in user for a request or throw 401/403.
 * Returns the users row (+ `token` for logout).
 */
export async function requireUser(ctx) {
  const token = bearerToken(ctx.request);
  if (!token) throw new ApiError(401, 'unauthorized', 'Please sign in.');

  const user = await first(
    ctx.env.DB,
    `SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
    await sha256Hex(token)
  );
  if (!user || user.expires_at < sqlNow()) {
    throw new ApiError(401, 'session_expired', 'Your session has expired. Please sign in again.');
  }
  if (!user.active) {
    throw new ApiError(403, 'account_disabled', 'Your account has been deactivated. Contact the group admin.');
  }

  // Record "last seen" at most once per IST day (saves DB writes), and keep
  // active people signed in: sessions slide forward to 30 days from last use.
  const today = todayIST();
  if (!user.last_seen_at || !user.last_seen_at.startsWith(today)) {
    const newExpiry = sqlNow(new Date(Date.now() + SESSION_DAYS * 86400000));
    ctx.exec.waitUntil(ctx.env.DB.batch([
      ctx.env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(sqlNow(), user.id),
      ctx.env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(newExpiry, await sha256Hex(token)),
    ]));
  }

  user.token = token;
  return user;
}

export async function requireAdmin(ctx) {
  const user = await requireUser(ctx);
  if (user.role !== 'admin') throw new ApiError(403, 'forbidden', 'Admins only.');
  return user;
}

/** Emails listed in the ADMIN_EMAILS secret (lower-cased). */
export function adminEmails(env) {
  return (env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Constant-time string comparison (for the invite code). */
export function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

/** Shape of a user safe to send to the browser. */
export function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    photoUrl: u.photo_url,
    role: u.role,
    aiEnabled: !!u.ai_enabled,
  };
}
