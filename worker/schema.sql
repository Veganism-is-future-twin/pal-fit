-- PAL Fitness — D1 (SQLite) schema
-- Apply locally:  npm run db:init:local
-- Apply remotely: npm run db:init:remote
--
-- Conventions:
--   * ids are UUID strings
--   * all "log_date" style columns are IST dates as 'YYYY-MM-DD'
--   * timestamps are UTC 'YYYY-MM-DD HH:MM:SS' (SQLite datetime('now'))
--   * every statement uses IF NOT EXISTS so re-running this file is harmless
--   * D1 enforces foreign keys by default, so no PRAGMA is needed

-- ---------------------------------------------------------------------------
-- People & sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  google_sub    TEXT UNIQUE NOT NULL,          -- Google's stable user id
  email         TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  photo_url     TEXT,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  active        INTEGER NOT NULL DEFAULT 1,    -- 0 = deactivated by an admin
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash    TEXT PRIMARY KEY,              -- SHA-256 hex of the bearer token (raw token never stored)
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ---------------------------------------------------------------------------
-- Private profile + AI plan (visible only to the owner and admin export)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  height_cm       REAL,
  weight_kg       REAL,
  gender          TEXT,          -- male | female | other | prefer_not
  dob             TEXT,          -- YYYY-MM-DD (age is computed, never stored)
  activity_level  TEXT,          -- sedentary | light | moderate | active
  goal            TEXT,          -- lose_weight | gain_weight | build_muscle | stay_fit | improve_stamina | better_sleep | other
  goal_note       TEXT,
  diet_pref       TEXT DEFAULT 'vegan',   -- vegan | vegetarian | other
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plans (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  steps_target        INTEGER,
  water_target_l      REAL,
  sleep_target_h      REAL,
  workout_target_min  INTEGER,
  plan_markdown       TEXT NOT NULL,
  ai_provider         TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  is_current          INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_plans_user_current ON plans(user_id, is_current);

-- ---------------------------------------------------------------------------
-- Challenges & daily logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS challenges (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,            -- e.g. "November 2026 Challenge"
  start_date  TEXT NOT NULL,            -- IST YYYY-MM-DD
  end_date    TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS logs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date        TEXT NOT NULL,        -- IST YYYY-MM-DD
  steps           INTEGER,
  water_l         REAL,
  sleep_h         REAL,
  meal1_tags      TEXT,                 -- JSON array, e.g. ["home_cooked","high_protein"]
  meal1_note      TEXT,
  meal2_tags      TEXT,
  meal2_note      TEXT,
  meal3_tags      TEXT,
  meal3_note      TEXT,
  workout_done    INTEGER DEFAULT 0,
  workout_type    TEXT,                 -- walk | gym | yoga | run | sports | cycling | home | other
  workout_min     INTEGER,
  mood            INTEGER,              -- 1..5, optional
  notes           TEXT,
  -- instant (provisional) AI tip — does NOT count for the leaderboard
  tip_score       INTEGER,
  tip_text        TEXT,
  tip_provider    TEXT,
  tip_count       INTEGER NOT NULL DEFAULT 0,
  tip_status      TEXT,                 -- pending | done | failed | rule_based
  tip_updated_at  TEXT,
  -- nightly final grade — this is what counts
  final_score     INTEGER,
  final_feedback  TEXT,
  final_provider  TEXT,
  graded_at       TEXT,
  locked          INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, log_date)
);
CREATE INDEX IF NOT EXISTS idx_logs_date ON logs(log_date);
CREATE INDEX IF NOT EXISTS idx_logs_user_date ON logs(user_id, log_date);

CREATE TABLE IF NOT EXISTS weight_logs (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date  TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  PRIMARY KEY (user_id, log_date)
);

-- ---------------------------------------------------------------------------
-- Admin: app settings, audit trail, AI usage monitoring
-- ---------------------------------------------------------------------------

-- Settings an admin can change from the app without redeploying
-- (e.g. invite code, AI model chain, AI provider API keys).
-- When is_secret = 1 the value is stored ENCRYPTED (AES-GCM, key = Worker secret
-- SETTINGS_KEY) and is never sent back to the browser — admins only see a
-- masked hint like "••••abcd". If a key is missing here the Worker falls back
-- to the matching Worker secret / env var.
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,                     -- plain text, or base64 ciphertext when is_secret = 1
  is_secret   INTEGER NOT NULL DEFAULT 0,
  hint        TEXT,                     -- masked preview for secrets, e.g. "••••abcd"
  updated_by  TEXT REFERENCES users(id),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every admin action is recorded (who changed what, when). Never stores secret values.
CREATE TABLE IF NOT EXISTS admin_audit (
  id          TEXT PRIMARY KEY,
  admin_id    TEXT NOT NULL REFERENCES users(id),
  action      TEXT NOT NULL,            -- e.g. 'setting.update', 'user.deactivate', 'grade.rerun'
  target      TEXT,                     -- e.g. setting key or user id
  detail      TEXT,                     -- short JSON, no secrets
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_time ON admin_audit(created_at);

-- Free-tier usage monitoring per provider per day.
CREATE TABLE IF NOT EXISTS ai_usage (
  day        TEXT NOT NULL,             -- IST YYYY-MM-DD
  provider   TEXT NOT NULL,             -- e.g. 'gemini:<model>'
  calls      INTEGER NOT NULL DEFAULT 0,
  failures   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider)
);
