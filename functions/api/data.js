// GET /api/data: every location and every chola entry. Public, read-only.
import { json, noDb, todayIndia } from '../../lib/util.js';
import { loadAll } from '../../lib/data.js';

export async function onRequestGet({ env }) {
  const missing = noDb(env);
  if (missing) return missing;
  return json({ ...(await loadAll(env)), serverToday: todayIndia() });
}
