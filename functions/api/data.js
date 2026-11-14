// GET /api/data: every location and every chola entry. Public, read-only.
import { json, noDb, toEntry, toLocation, ENTRY_COLUMNS, LOCATION_COLUMNS, todayIndia } from '../../lib/util.js';

export async function onRequestGet({ env }) {
  const missing = noDb(env);
  if (missing) return missing;
  const [locations, entries] = await env.DB.batch([
    env.DB.prepare('SELECT ' + LOCATION_COLUMNS + ' FROM locations ORDER BY sort_order, name'),
    env.DB.prepare('SELECT ' + ENTRY_COLUMNS + ' FROM entries ORDER BY date DESC'),
  ]);
  return json({
    locations: locations.results.map(toLocation),
    entries: entries.results.map(toEntry),
    serverToday: todayIndia(),
  });
}
