-- Starting data: the six locations and the visits shared on 15 Nov 2026.
-- Run once after schema.sql:  npx wrangler d1 execute chola-seva --remote --file=seed.sql

INSERT OR IGNORE INTO locations (id, name, target, sort_order) VALUES
  ('igl',           'IGL',           6, 1),
  ('bhatawarpur',   'Bhatawarpur',   6, 2),
  ('nagli',         'Nagli',         6, 3),
  ('5-mukhi',       '5 Mukhi',       6, 4),
  ('jaypee-fmg',    'Jaypee FMG',    6, 5),
  ('bio-diversity', 'Bio Diversity', 6, 6);

INSERT OR IGNORE INTO entries (location_id, date) VALUES
  ('5-mukhi',       '2026-10-13'),
  ('igl',           '2026-10-17'),
  ('nagli',         '2026-10-20'),
  ('bhatawarpur',   '2026-10-24'),
  ('bio-diversity', '2026-10-31'),
  ('5-mukhi',       '2026-11-03'),
  ('nagli',         '2026-11-07'),
  ('igl',           '2026-11-14');  -- shared as "today" just after midnight on Sun 15 Nov
