// POST /api/push/subscribe: remember a phone for reminders. DELETE: forget it. Owner only.
import { json, fail, noDb, ownerOnly, readJson } from '../../../lib/util.js';
import { setConfig, missingTables } from '../../../lib/push.js';

function endpointOf(body) {
  const endpoint = body && typeof body.endpoint === 'string' ? body.endpoint : '';
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && endpoint.length <= 1000 ? endpoint : null;
  } catch {
    return null;
  }
}

async function guard(request, env) {
  return noDb(env) || (await ownerOnly(request, env));
}

export async function onRequestPost({ request, env }) {
  const denied = await guard(request, env);
  if (denied) return denied;
  const body = await readJson(request);
  const endpoint = endpointOf(body);
  if (!endpoint) return fail(400, 'bad_subscription', 'This phone sent an invalid reminder subscription.');
  const keys = body.keys && typeof body.keys === 'object' ? body.keys : {};
  try {
    await env.DB
      .prepare('INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?1, ?2, ?3) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth')
      .bind(endpoint, String(keys.p256dh || '').slice(0, 200), String(keys.auth || '').slice(0, 100))
      .run();
    await setConfig(env, 'site', new URL(request.url).origin);
    return json({ ok: true }, 201);
  } catch (e) {
    const m = missingTables(e);
    if (m) return m;
    throw e;
  }
}

export async function onRequestDelete({ request, env }) {
  const denied = await guard(request, env);
  if (denied) return denied;
  const endpoint = endpointOf(await readJson(request));
  if (!endpoint) return fail(400, 'bad_subscription', 'Send the subscription endpoint to remove.');
  try {
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1').bind(endpoint).run();
    return json({ ok: true });
  } catch (e) {
    const m = missingTables(e);
    if (m) return m;
    throw e;
  }
}
