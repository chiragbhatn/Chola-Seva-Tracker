// POST /api/push/test { kind: 'plan' | 'logcheck' }: send that reminder to every subscribed phone
// right now, even if today is already logged (owner only).
import { json, noDb, ownerOnly, readJson } from '../../../lib/util.js';
import { sendKind, missingTables } from '../../../lib/push.js';

export async function onRequestPost({ request, env }) {
  const denied = noDb(env) || (await ownerOnly(request, env));
  if (denied) return denied;
  const body = await readJson(request);
  const kind = body && body.kind === 'logcheck' ? 'logcheck' : 'plan';
  try {
    return json(await sendKind(env, kind, { force: true }));
  } catch (e) {
    const m = missingTables(e);
    if (m) return m;
    throw e;
  }
}
