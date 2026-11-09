-- PAL Fitness — initial D1 (SQLite) schema.
--
-- Schema changes are made with numbered migration files in this folder.
-- Apply with:
--   npm run db:migrate:local     (your PC's test database)
--   npm run db:migrate:remote    (the live Cloudflare database)
-- Never edit a migration that has already been applied remotely; add a new
-- file (0002_xxx.sql, ...) instead.
--
-- Conventions:
--   * ids are UUID strings
--   * "*_date" columns are IST calendar dates 'YYYY-MM-DD'
--   * "*_at" columns are UTC timestamps 'YYYY-MM-DD HH:MM:SS'
--   * D1 enforces foreign keys by default

-- ---------------------------------------------------------------------------
-- People & sessions
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  google_sub    TEXT UNIQUE NOT NULL,          -- Google's stable account id
  email         TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  photo_url     TEXT,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  active        INTEGER NOT NULL DEFAULT 1,    -- 0 = deactivated by an admin
  ai_enabled    INTEGER NOT NULL DEFAULT 1,    -- 0 = user opted out of AI (code-only scoring, no chat)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT
);
CREATE INDEX idx_users_email ON users(email);

CREATE TABLE sessions (
  token_hash    TEXT PRIMARY KEY,              -- SHA-256 hex of the bearer token (raw token never stored)
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- ---------------------------------------------------------------------------
-- Private profile + plan (visible only to the owner and the admin CSV export)
-- ---------------------------------------------------------------------------
CREATE TABLE profiles (
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

CREATE TABLE plans (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  steps_target        INTEGER NOT NULL,
  water_target_l      REAL NOT NULL,
  sleep_target_h      REAL NOT NULL,
  workout_target_min  INTEGER NOT NULL,
  plan_markdown       TEXT NOT NULL,
  ai_provider         TEXT,                    -- e.g. 'gemini:gemini-3.8-flash' or 'rules'
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  is_current          INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_plans_user_current ON plans(user_id, is_current);

-- ---------------------------------------------------------------------------
-- Challenges & daily logs
-- ---------------------------------------------------------------------------
CREATE TABLE challenges (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,            -- e.g. "November 2026 Challenge"
  start_date  TEXT NOT NULL,            -- IST YYYY-MM-DD
  end_date    TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 0,  -- only one active at a time
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Scoring (0..100) = obj_score (0..75, computed by code from steps/water/sleep/
-- workout/completeness vs the user's plan) + meal_score (0..25, judged by AI,
-- or by simple rules if AI is unavailable/opted out).
-- The day's score is live while the day is open and LOCKED at midnight IST.
CREATE TABLE logs (
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
  workout_done    INTEGER NOT NULL DEFAULT 0,
  workout_type    TEXT,                 -- walk | gym | yoga | run | sports | cycling | home | other
  workout_min     INTEGER,
  mood            INTEGER,              -- 1..5, optional
  notes           TEXT,
  -- grading
  score           INTEGER,              -- 0..100 (obj_score + meal_score)
  obj_score       INTEGER,              -- 0..75
  meal_score      INTEGER,              -- 0..25
  feedback        TEXT,                 -- 2–3 sentence coach feedback
  grade_provider  TEXT,                 -- which model wrote the feedback ('rules' if none)
  grade_status    TEXT,                 -- pending | done | rule_based
  grade_count     INTEGER NOT NULL DEFAULT 0,   -- AI grades used today (capped)
  data_hash       TEXT,                 -- hash of the log's current inputs
  grade_hash      TEXT,                 -- hash of the inputs the AI last graded
  graded_at       TEXT,
  locked          INTEGER NOT NULL DEFAULT 0,   -- 1 after midnight IST: final, read-only
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, log_date)
);
CREATE INDEX idx_logs_date ON logs(log_date);
CREATE INDEX idx_logs_user_date ON logs(user_id, log_date);

CREATE TABLE weight_logs (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date  TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  PRIMARY KEY (user_id, log_date)
);

-- ---------------------------------------------------------------------------
-- AI coach chat
-- ---------------------------------------------------------------------------
CREATE TABLE chat_messages (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_date   TEXT NOT NULL,            -- IST date (for the daily message cap)
  role        TEXT NOT NULL CHECK (role IN ('user','coach')),
  content     TEXT NOT NULL,
  provider    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_chat_user_time ON chat_messages(user_id, created_at);

-- ---------------------------------------------------------------------------
-- Admin: settings, audit trail, AI usage
-- ---------------------------------------------------------------------------

-- Settings an admin can change from the app without redeploying
-- (invite code, AI model chains, AI provider API keys, limits).
-- When is_secret = 1, `value` is AES-GCM ciphertext (key = Worker secret
-- SETTINGS_KEY) and is never sent to the browser; admins see only `hint`.
CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  is_secret   INTEGER NOT NULL DEFAULT 0,
  hint        TEXT,                     -- masked preview for secrets, e.g. "••••abcd"
  updated_by  TEXT REFERENCES users(id),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE admin_audit (
  id          TEXT PRIMARY KEY,
  admin_id    TEXT NOT NULL REFERENCES users(id),
  action      TEXT NOT NULL,            -- e.g. 'setting.update', 'user.update', 'grade.rerun'
  target      TEXT,
  detail      TEXT,                     -- short JSON, never secret values
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_admin_audit_time ON admin_audit(created_at);

CREATE TABLE ai_usage (
  day        TEXT NOT NULL,             -- IST YYYY-MM-DD
  provider   TEXT NOT NULL,             -- e.g. 'gemini:gemini-3.8-flash'
  calls      INTEGER NOT NULL DEFAULT 0,
  failures   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider)
);
