// App settings that an admin can change from the app (stored in app_settings).
// Secret settings (API keys, invite code) are AES-GCM encrypted with the
// SETTINGS_KEY Worker secret and are never returned to the browser.
//
// Lookup order for every setting: database value -> Worker env var/secret -> default.

import { ApiError } from './http.js';
import { all, first, run } from './db.js';
import { sqlNow } from './time.js';

// Every setting the admin screen knows about.
export const SETTINGS = {
  invite_code: {
    label: 'Group invite code (optional)', secret: true, env: 'GROUP_INVITE_CODE',
    help: 'Leave empty to let anyone with a Google account join. If set, new members must enter it on their first sign-in.',
  },
  gemini_api_key: {
    label: 'Gemini API key', secret: true, env: 'GEMINI_API_KEY',
    help: 'From aistudio.google.com → Get API key.',
  },
  groq_api_key: {
    label: 'Groq API key', secret: true, env: 'GROQ_API_KEY',
    help: 'From console.groq.com → API Keys.',
  },
  openrouter_api_key: {
    label: 'OpenRouter API key', secret: true, env: 'OPENROUTER_API_KEY',
    help: 'Optional. From openrouter.ai → Keys.',
  },
  chain_grade: {
    label: 'AI chain: grading & plans', type: 'json',
    help: 'Tried in order. Strong models first.',
    default: [
      { provider: 'gemini', model: 'gemini-3.8-flash' },
      { provider: 'gemini', model: 'gemini-3.6-flash' },
      { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
      { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
      { provider: 'groq', model: 'openai/gpt-oss-120b' },
      { provider: 'workers-ai', model: '@cf/google/gemma-4-26b-a4b-it' },
    ],
  },
  chain_chat: {
    label: 'AI chain: coach chat', type: 'json',
    help: 'Light models only, so chat never uses the grading quota.',
    default: [
      { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
      { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
      { provider: 'groq', model: 'openai/gpt-oss-120b' },
      { provider: 'workers-ai', model: '@cf/google/gemma-4-26b-a4b-it' },
    ],
  },
  grade_daily_limit: {
    label: 'AI grades per person per day', type: 'int', default: 3, min: 1, max: 10,
    help: 'Saving again with changed data re-grades, up to this many times.',
  },
  chat_daily_limit: {
    label: 'Coach chat messages per person per day', type: 'int', default: 20, min: 0, max: 100,
    help: '0 turns chat off.',
  },
};

// ---------------------------------------------------------------------------
// Encryption (AES-GCM, 256-bit key from the SETTINGS_KEY secret)
// ---------------------------------------------------------------------------
async function cryptoKey(env) {
  if (!env.SETTINGS_KEY) {
    throw new ApiError(503, 'settings_key_missing',
      'SETTINGS_KEY secret is not set on the Worker, so secrets cannot be saved yet.');
  }
  // Hash the secret so any length/format of SETTINGS_KEY gives a 256-bit key.
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.SETTINGS_KEY));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function encrypt(env, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptoKey(env),
    new TextEncoder().encode(plaintext));
  return b64(iv) + '.' + b64(ct);
}

async function decrypt(env, stored) {
  const [iv, ct] = stored.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await cryptoKey(env), unb64(ct));
  return new TextDecoder().decode(pt);
}

function maskHint(value) {
  const s = String(value);
  return s.length <= 4 ? '••••' : '••••' + s.slice(-4);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Get one setting's effective value (decrypted / parsed). */
export async function getSetting(env, key) {
  const def = SETTINGS[key];
  if (!def) throw new Error('Unknown setting ' + key);

  const row = await first(env.DB, 'SELECT value, is_secret FROM app_settings WHERE key = ?', key);
  if (row && row.value != null && row.value !== '') {
    try {
      const raw = row.is_secret ? await decrypt(env, row.value) : row.value;
      if (def.type === 'json') return JSON.parse(raw);
      if (def.type === 'int') return parseInt(raw, 10);
      return raw;
    } catch (err) {
      console.error('settings: could not read', key, err.message);
      // fall through to env/default
    }
  }
  if (def.env && env[def.env]) return env[def.env];
  return def.default ?? null;
}

/** Describe all settings for the admin screen — never includes secret values. */
export async function listSettings(env) {
  const rows = await all(env.DB, 'SELECT key, value, is_secret, hint, updated_at FROM app_settings');
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  const out = [];
  for (const [key, def] of Object.entries(SETTINGS)) {
    const row = byKey[key];
    const item = { key, label: def.label, help: def.help, secret: !!def.secret, type: def.type || 'text' };
    if (def.secret) {
      if (row?.value) { item.status = 'set'; item.hint = row.hint; item.source = 'app'; }
      else if (def.env && env[def.env]) { item.status = 'set'; item.hint = maskHint(env[def.env]); item.source = 'worker secret'; }
      else { item.status = 'not set'; }
    } else {
      item.value = await getSetting(env, key);
      item.source = row?.value ? 'app' : 'default';
      if (def.min != null) { item.min = def.min; item.max = def.max; }
    }
    item.updatedAt = row?.updated_at || null;
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/** Validate and save a setting. `value` null/'' clears it (back to env/default). */
export async function saveSetting(env, key, value, adminId) {
  const def = SETTINGS[key];
  if (!def) throw new ApiError(400, 'unknown_setting', 'Unknown setting.');

  if (value == null || value === '') {
    await run(env.DB, 'DELETE FROM app_settings WHERE key = ?', key);
    return;
  }

  let stored;
  if (def.type === 'json') {
    let parsed = value;
    if (typeof value === 'string') {
      try { parsed = JSON.parse(value); } catch { throw new ApiError(400, 'bad_value', 'Not valid JSON.'); }
    }
    validateChain(parsed);
    stored = JSON.stringify(parsed);
  } else if (def.type === 'int') {
    const n = Number(value);
    if (!Number.isInteger(n) || n < def.min || n > def.max) {
      throw new ApiError(400, 'bad_value', `Must be a whole number from ${def.min} to ${def.max}.`);
    }
    stored = String(n);
  } else {
    stored = String(value).trim();
    if (stored.length > 500) throw new ApiError(400, 'bad_value', 'Value is too long.');
  }

  const isSecret = def.secret ? 1 : 0;
  const finalValue = isSecret ? await encrypt(env, stored) : stored;
  const hint = isSecret ? maskHint(stored) : null;

  await run(env.DB,
    `INSERT INTO app_settings (key, value, is_secret, hint, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret,
       hint = excluded.hint, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    key, finalValue, isSecret, hint, adminId, sqlNow());
}

const PROVIDERS = ['gemini', 'groq', 'openrouter', 'workers-ai'];

function validateChain(chain) {
  if (!Array.isArray(chain) || chain.length === 0 || chain.length > 10) {
    throw new ApiError(400, 'bad_value', 'Chain must be a list of 1–10 models.');
  }
  for (const step of chain) {
    if (!step || !PROVIDERS.includes(step.provider) || typeof step.model !== 'string' || !step.model.trim()) {
      throw new ApiError(400, 'bad_value',
        `Each step needs "provider" (${PROVIDERS.join(', ')}) and "model".`);
    }
  }
}
