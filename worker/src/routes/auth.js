// Sign-in / sign-out.

import { ApiError, json, readJson } from '../http.js';
import { first, run, newId } from '../db.js';
import {
  verifyGoogleCredential, sessionStatements, deleteSession, requireUser,
  adminEmails, safeEqual, publicUser,
} from '../auth.js';
import { getSetting } from '../settings.js';

/** Dev-only login: enabled ONLY when DEV_LOGIN=1 (set in .dev.vars) AND the request is to localhost. */
function devLoginAllowed(ctx) {
  return ctx.env.DEV_LOGIN === '1' && ['localhost', '127.0.0.1'].includes(ctx.url.hostname);
}

/** Find-or-create the user for a verified identity and start a session. */
async function signIn(ctx, identity, inviteCode) {
  const { env } = ctx;
  const email = String(identity.email || '').toLowerCase();
  const isAdminEmail = adminEmails(env).includes(email);

  // Speed: everything after this first lookup happens in ONE database round trip.
  let user = await first(env.DB, 'SELECT * FROM users WHERE google_sub = ?', identity.sub);
  const writes = [];

  if (!user) {
    // New member. Sign-ups are OPEN to any Google account by default.
    // If an admin sets an invite code (Admin → AI & keys), new members must enter it
    // (admins listed in ADMIN_EMAILS always skip it).
    const expected = isAdminEmail ? null : await getSetting(env, 'invite_code');
    if (expected) {
      if (!inviteCode) throw new ApiError(403, 'invite_required', 'Enter the group invite code to join.');
      if (!safeEqual(String(inviteCode).trim(), expected)) {
        throw new ApiError(403, 'invite_invalid', 'That invite code is not right. Check with the group admin.');
      }
    }
    user = {
      id: newId(), google_sub: identity.sub, email,
      display_name: (identity.name || email.split('@')[0]).slice(0, 40),
      photo_url: identity.picture || null, role: isAdminEmail ? 'admin' : 'member', active: 1, ai_enabled: 1,
    };
    writes.push(env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, display_name, photo_url, role) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(user.id, user.google_sub, user.email, user.display_name, user.photo_url, user.role));
  } else {
    if (!user.active) throw new ApiError(403, 'account_disabled', 'Your account has been deactivated. Contact the group admin.');
    // Keep email/photo fresh; promote if newly listed as admin.
    const role = isAdminEmail ? 'admin' : user.role;
    Object.assign(user, { email, photo_url: identity.picture || user.photo_url, role });
    writes.push(env.DB.prepare('UPDATE users SET email = ?, photo_url = ?, role = ? WHERE id = ?')
      .bind(email, user.photo_url, role, user.id));
  }

  const session = await sessionStatements(env, user.id);
  const results = await env.DB.batch([
    ...writes,
    ...session.statements,
    env.DB.prepare('SELECT user_id FROM profiles WHERE user_id = ?').bind(user.id),
  ]);
  const hasProfile = results[results.length - 1].results.length > 0;
  return json({ token: session.token, user: publicUser(user), needsOnboarding: !hasProfile });
}

export function registerAuthRoutes(router) {
  // Public config the login screen needs.
  router.get('/api/auth/config', async (ctx) =>
    json({ googleClientId: ctx.env.GOOGLE_CLIENT_ID || null, devLogin: devLoginAllowed(ctx) }));

  router.post('/api/auth/google', async (ctx) => {
    const body = await readJson(ctx.request);
    if (!body.credential) throw new ApiError(400, 'invalid', 'Missing Google credential.');
    const claims = await verifyGoogleCredential(body.credential, ctx.env);
    return signIn(ctx, claims, body.inviteCode);
  });

  // Local testing without Google. Disabled in production.
  router.post('/api/auth/dev', async (ctx) => {
    if (!devLoginAllowed(ctx)) throw new ApiError(404, 'not_found', 'No such endpoint.');
    const body = await readJson(ctx.request);
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new ApiError(400, 'invalid', 'Enter an email.');
    return signIn(ctx, { sub: 'dev:' + email, email, name: body.name || email.split('@')[0] }, body.inviteCode);
  });

  router.post('/api/auth/logout', async (ctx) => {
    const user = await requireUser(ctx);
    await deleteSession(ctx.env, user.token);
    return json({ ok: true });
  });
}
