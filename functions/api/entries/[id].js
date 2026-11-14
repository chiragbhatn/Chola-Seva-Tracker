// PUT /api/entries/:id (edit) and DELETE /api/entries/:id (remove). Owner only.
import { json, fail, noDb, ownerOnly, readJson, checkEntry, toEntry, ENTRY_COLUMNS, isUniqueError } from '../../../lib/util.js';

const entryId = (params) => (/^\d+$/.test(String(params.id)) ? Number(params.id) : null);

async function guard(request, env, params) {
  const missing = noDb(env);
  if (missing) return { response: missing };
  const denied = await ownerOnly(request, env);
  if (denied) return { response: denied };
  const id = entryId(params);
  if (id === null) return { response: fail(404, 'not_found', 'No such entry.') };
  return { id };
}

export async function onRequestPut({ request, env, params }) {
  const g = await guard(request, env, params);
  if (g.response) return g.response;
  const checked = await checkEntry(await readJson(request), env);
  if (checked.error) return fail(...checked.error);
  const v = checked.value;
  try {
    const row = await env.DB
      .prepare('UPDATE entries SET location_id = ?1, date = ?2, note = ?3, special = ?4 WHERE id = ?5 RETURNING ' + ENTRY_COLUMNS)
      .bind(v.loc, v.date, v.note, v.special, g.id)
      .first();
    if (!row) return fail(404, 'not_found', 'That entry no longer exists.');
    return json({ entry: toEntry(row) });
  } catch (e) {
    if (isUniqueError(e)) return fail(409, 'date_taken', 'That date already has another entry.');
    return fail(500, 'db_error', 'The database could not save the change.');
  }
}

export async function onRequestDelete({ request, env, params }) {
  const g = await guard(request, env, params);
  if (g.response) return g.response;
  const row = await env.DB.prepare('DELETE FROM entries WHERE id = ?1 RETURNING ' + ENTRY_COLUMNS).bind(g.id).first();
  if (!row) return fail(404, 'not_found', 'That entry no longer exists.');
  return json({ entry: toEntry(row) });
}
