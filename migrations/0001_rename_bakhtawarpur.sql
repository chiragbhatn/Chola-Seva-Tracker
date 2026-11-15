-- Corrects the spelling of Bakhtawarpur (was entered as "Bhatawarpur"), both the name shown
-- on the site and the location code. Keeps every entry. Safe to run once on the live database:
-- paste into the D1 Console, or run
--   npx wrangler d1 execute chola-seva --remote --file=migrations/0001_rename_bakhtawarpur.sql

INSERT INTO locations (id, name, target, sort_order, active)
  SELECT 'bakhtawarpur', 'Bakhtawarpur', target, sort_order, active FROM locations WHERE id = 'bhatawarpur';
UPDATE entries SET location_id = 'bakhtawarpur' WHERE location_id = 'bhatawarpur';
DELETE FROM locations WHERE id = 'bhatawarpur';
