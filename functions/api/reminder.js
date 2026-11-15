// GET /api/reminder?lang=en|hi: the next Hanuman day's location and a WhatsApp message for it.
// Public. The phone's service worker reads it to fill in the reminder notification.
import { json, fail, noDb, todayIndia } from '../../lib/util.js';
import { loadAll } from '../../lib/data.js';
import { normalizeData, reminderText } from '../../public/logic.js';

export async function onRequestGet({ request, env }) {
  const missing = noDb(env);
  if (missing) return missing;
  const url = new URL(request.url);
  const lang = url.searchParams.get('lang') === 'hi' ? 'hi' : 'en';
  const reminder = reminderText(normalizeData(await loadAll(env)), todayIndia(), { lang, url: url.origin + '/' });
  if (!reminder) return fail(404, 'no_plan', 'There are no active locations to plan.');
  return json(reminder);
}
