// PUT /api/locations/:id: rename, change target, hide or restore a location (owner only).
import { json, fail, noDb, ownerOnly, readJson, checkLocation, toLocation, LOCATION_COLUMNS } from '../../../lib/util.js';

export async function onRequestPut({ request, env, params }) {
  const missing = noDb(env);
  if (missing) return missing;
  const denied = await ownerOnly(request, env);
  if (denied) return denied;
  const checked = checkLocation(await readJson(request), false);
  if (checked.error) return fail(...checked.error);
  const v = checked.value;
  const row = await env.DB
    .prepare(
      'UPDATE locations SET name = COALESCE(?1, name), target = COALESCE(?2, target), active = COALESCE(?3, active) WHERE id = ?4 RETURNING ' +
        LOCATION_COLUMNS
    )
    .bind(v.name ?? null, v.target ?? null, v.active ?? null, String(params.id))
    .first();
  if (!row) return fail(404, 'not_found', 'No such location.');
  return json({ location: toLocation(row) });
}
