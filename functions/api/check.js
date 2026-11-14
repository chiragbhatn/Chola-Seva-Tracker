// GET /api/check: confirms the owner's logging key (sent in x-admin-key).
import { json, ownerOnly } from '../../lib/util.js';

export async function onRequestGet({ request, env }) {
  const denied = await ownerOnly(request, env);
  return denied || json({ ok: true });
}
