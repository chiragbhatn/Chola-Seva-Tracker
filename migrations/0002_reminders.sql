-- Adds what the Monday/Friday reminders need. Safe to run more than once.
-- Paste into the D1 Console, or run
--   npx wrangler d1 execute chola-seva --remote --file=migrations/0002_reminders.sql

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,   -- 'vapid' (push signing keys, made by the Worker), 'site' (the site address)
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   TEXT PRIMARY KEY,                -- one row per phone with reminders turned on
  p256dh     TEXT NOT NULL DEFAULT '',
  auth       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
