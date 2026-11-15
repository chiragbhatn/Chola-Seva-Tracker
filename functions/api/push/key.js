// GET /api/push/key: the public key a phone needs to turn reminders on (owner only).
import { json, noDb, ownerOnly } from '../../../lib/util.js';
import { vapidKeys, setConfig, missingTables } from '../../../lib/push.js';

export async function onRequestGet({ request, env }) {
  const missing = noDb(env);
  if (missing) return missing;
  const denied = await ownerOnly(request, env);
  if (denied) return denied;
  try {
    await setConfig(env, 'site', new URL(request.url).origin);
    const keys = await vapidKeys(env);
    return json({ publicKey: keys.publicKey });
  } catch (e) {
    const m = missingTables(e);
    if (m) return m;
    throw e;
  }
}
