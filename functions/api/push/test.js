// POST /api/push/test: send a reminder to every subscribed phone right now (owner only).
import { json, noDb, ownerOnly } from '../../../lib/util.js';
import { sendReminders, missingTables } from '../../../lib/push.js';

export async function onRequestPost({ request, env }) {
  const denied = noDb(env) || (await ownerOnly(request, env));
  if (denied) return denied;
  try {
    return json(await sendReminders(env));
  } catch (e) {
    const m = missingTables(e);
    if (m) return m;
    throw e;
  }
}
