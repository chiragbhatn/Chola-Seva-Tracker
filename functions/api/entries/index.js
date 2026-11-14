// POST /api/entries: log a chola visit (owner only).
import { json, fail, noDb, ownerOnly, readJson, checkEntry, toEntry, ENTRY_COLUMNS, isUniqueError } from '../../../lib/util.js';

export async function onRequestPost({ request, env }) {
  const missing = noDb(env);
  if (missing) return missing;
  const denied = await ownerOnly(request, env);
  if (denied) return denied;
  const checked = await checkEntry(await readJson(request), env);
  if (checked.error) return fail(...checked.error);
  const v = checked.value;
  try {
    const row = await env.DB
      .prepare('INSERT INTO entries (location_id, date, note, special) VALUES (?1, ?2, ?3, ?4) RETURNING ' + ENTRY_COLUMNS)
      .bind(v.loc, v.date, v.note, v.special)
      .first();
    return json({ entry: toEntry(row) }, 201);
  } catch (e) {
    if (isUniqueError(e)) return fail(409, 'date_taken', 'That date already has an entry. Edit that entry instead.');
    return fail(500, 'db_error', 'The database could not save the entry.');
  }
}
