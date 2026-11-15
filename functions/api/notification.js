// GET /api/notification: what a phone should show when a reminder push arrives. Public.
// Returns { kind, tag, title, body, url }.
import { json, noDb, todayIndia } from '../../lib/util.js';
import { loadAll } from '../../lib/data.js';
import { getConfig } from '../../lib/push.js';
import { normalizeData, reminderText, logCheckText } from '../../public/logic.js';

export async function onRequestGet({ request, env }) {
  const missing = noDb(env);
  if (missing) return missing;
  const d = normalizeData(await loadAll(env));
  const today = todayIndia();
  let kind = 'plan';
  try {
    const raw = await getConfig(env, 'last_push');
    const last = raw ? JSON.parse(raw) : null;
    if (last && last.kind === 'logcheck' && Date.now() - last.at < 3 * 3600 * 1000) kind = 'logcheck';
  } catch (e) {
    // config table not created yet: fall back to the plan reminder
  }
  if (kind === 'logcheck') return json({ kind, tag: 'chola-log', ...logCheckText(d, today) });
  const r = reminderText(d, today, { lang: 'en', url: new URL(request.url).origin + '/' });
  return json(r
    ? { kind, tag: 'chola-plan', title: r.title, body: r.body, url: '/?share=1' }
    : { kind, tag: 'chola-plan', title: 'Chola Seva Tracker', body: 'Open the tracker.', url: '/' });
}
