-- Chola Seva Tracker: D1 database schema.
-- Run once:  npx wrangler d1 execute chola-seva --remote --file=schema.sql
-- or paste into the Console tab of the D1 database in the Cloudflare dashboard.

CREATE TABLE IF NOT EXISTS locations (
  id          TEXT PRIMARY KEY,                       -- short code used in entries, e.g. 'nagli'
  name        TEXT NOT NULL,                          -- name shown on the site
  target      INTEGER NOT NULL DEFAULT 6              -- Hanuman days until the location is due again
              CHECK (target BETWEEN 1 AND 52),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1              -- 0 hides the location but keeps its history
              CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id TEXT NOT NULL REFERENCES locations(id),
  date        TEXT NOT NULL UNIQUE                    -- YYYY-MM-DD; UNIQUE = one location per day
              CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  note        TEXT NOT NULL DEFAULT '',
  special     TEXT NOT NULL DEFAULT '',               -- occasion name, required when the date is not a Tuesday or Saturday
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (strftime('%w', date) IN ('2', '6') OR special <> '')
);

CREATE INDEX IF NOT EXISTS entries_by_location ON entries (location_id, date);

-- Reminders (also in migrations/0002_reminders.sql for databases created before them).
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
