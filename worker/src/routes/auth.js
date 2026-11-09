// Sign-in / sign-out.

import { ApiError, json, readJson } from '../http.js';
import { first, run, newId } from '../db.js';
import {
  verifyGoogleCredential, createSession, deleteSession, requireUser,
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

  let user = await first(env.DB, 'SELECT * FROM users WHERE google_sub = ?', identity.sub);

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
    const id = newId();
    await run(env.DB,
      `INSERT INTO users (id, google_sub, email, display_name, photo_url, role) VALUES (?, ?, ?, ?, ?, ?)`,
      id, identity.sub, email, (identity.name || email.split('@')[0]).slice(0, 40), identity.picture || null,
      isAdminEmail ? 'admin' : 'member');
    user = await first(env.DB, 'SELECT * FROM users WHERE id = ?', id);
  } else {
    if (!user.active) throw new ApiError(403, 'account_disabled', 'Your account has been deactivated. Contact the group admin.');
    // Keep email/photo fresh; promote if newly listed as admin.
    const role = isAdminEmail ? 'admin' : user.role;
    await run(env.DB, 'UPDATE users SET email = ?, photo_url = ?, role = ? WHERE id = ?',
      email, identity.picture || user.photo_url, role, user.id);
    Object.assign(user, { email, photo_url: identity.picture || user.photo_url, role });
  }

  const token = await createSession(env, user.id);
  const profile = await first(env.DB, 'SELECT user_id FROM profiles WHERE user_id = ?', user.id);
  return json({ token, user: publicUser(user), needsOnboarding: !profile });
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
