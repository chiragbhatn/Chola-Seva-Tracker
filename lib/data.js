// Reads every location and entry from D1, in the shape the site uses.
import { ENTRY_COLUMNS, LOCATION_COLUMNS, toEntry, toLocation } from './util.js';

export async function loadAll(env) {
  const [locations, entries] = await env.DB.batch([
    env.DB.prepare('SELECT ' + LOCATION_COLUMNS + ' FROM locations ORDER BY sort_order, name'),
    env.DB.prepare('SELECT ' + ENTRY_COLUMNS + ' FROM entries ORDER BY date DESC'),
  ]);
  return {
    locations: locations.results.map(toLocation),
    entries: entries.results.map(toEntry),
  };
}
