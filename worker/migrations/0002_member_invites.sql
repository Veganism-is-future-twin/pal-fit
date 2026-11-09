-- People an admin has added by email before they first sign in.
-- When that email signs in with Google for the first time, they get this role
-- and the row is removed.
CREATE TABLE member_invites (
  email       TEXT PRIMARY KEY,          -- lower-case
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  added_by    TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The invite-code feature was removed (sign-up is open); drop any saved code.
DELETE FROM app_settings WHERE key = 'invite_code';
