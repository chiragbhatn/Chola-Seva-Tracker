// POST /api/locations: add a location (owner only).
import { json, fail, noDb, ownerOnly, readJson, checkLocation, toLocation, LOCATION_COLUMNS } from '../../../lib/util.js';

const slug = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'location';

export async function onRequestPost({ request, env }) {
  const missing = noDb(env);
  if (missing) return missing;
  const denied = await ownerOnly(request, env);
  if (denied) return denied;
  const checked = checkLocation(await readJson(request), true);
  if (checked.error) return fail(...checked.error);
  const v = checked.value;
  const base = slug(v.name);
  const taken = await env.DB.prepare("SELECT id FROM locations WHERE id = ?1 OR id LIKE ?1 || '-%'").bind(base).all();
  const ids = new Set(taken.results.map((r) => r.id));
  let id = base;
  for (let n = 2; ids.has(id); n++) id = base + '-' + n;
  const row = await env.DB
    .prepare('INSERT INTO locations (id, name, target, sort_order) VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM locations)) RETURNING ' + LOCATION_COLUMNS)
    .bind(id, v.name, v.target || 6)
    .first();
  return json({ location: toLocation(row) }, 201);
}
