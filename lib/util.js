// Shared helpers for the API handlers under /functions/api (routed by src/worker.js).

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function fail(status, code, message) {
  return json({ error: { code, message } }, status);
}

export function noDb(env) {
  return env.DB ? null : fail(500, 'no_database', 'No D1 database is bound as DB. Check the binding in wrangler.toml.');
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// The owner sends the key in the x-admin-key header. ADMIN_KEY is a secret set in Cloudflare.
export async function isOwner(request, env) {
  const expected = env.ADMIN_KEY;
  const given = request.headers.get('x-admin-key');
  if (!expected || !given) return false;
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  if (typeof crypto.subtle.timingSafeEqual === 'function') return crypto.subtle.timingSafeEqual(a, b);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function ownerOnly(request, env) {
  if (!env.ADMIN_KEY) return fail(503, 'no_key_set', 'Logging is not set up yet. Add an ADMIN_KEY secret to the chola-seva Worker in Cloudflare.');
  if (!(await isOwner(request, env))) return fail(401, 'wrong_key', 'Your logging key was not accepted. Unlock logging again.');
  return null;
}

export async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export function isYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const isHanumanDay = (s) => {
  const w = new Date(s + 'T00:00:00Z').getUTCDay();
  return w === 2 || w === 6;
};

// Today's date in India (UTC+5:30), so "no future dates" matches the phone's calendar.
export const todayIndia = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);

export const ENTRY_COLUMNS = 'id, location_id AS loc, date, note, special, created_at AS createdAt';

export const toEntry = (r) => ({
  id: String(r.id),
  loc: r.loc,
  date: r.date,
  note: r.note || '',
  special: r.special || '',
  createdAt: r.createdAt || '',
});

export const toLocation = (l) => ({
  id: l.id,
  name: l.name,
  target: l.target,
  sortOrder: l.sortOrder,
  active: !!l.active,
});

export const LOCATION_COLUMNS = 'id, name, target, sort_order AS sortOrder, active';

export const isUniqueError = (e) => /UNIQUE/i.test(String((e && e.message) || e));

// Validates an entry body: { loc, date, note?, special? }.
export async function checkEntry(body, env) {
  if (!body) return { error: [400, 'bad_request', 'Send the entry as JSON.'] };
  const loc = typeof body.loc === 'string' ? body.loc : '';
  const date = typeof body.date === 'string' ? body.date : '';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';
  let special = typeof body.special === 'string' ? body.special.trim().slice(0, 60) : '';
  if (!isYmd(date)) return { error: [400, 'bad_date', 'Pick a valid date.'] };
  if (date > todayIndia()) return { error: [400, 'future_date', 'That date is in the future. Pick today or an earlier date.'] };
  if (isHanumanDay(date)) special = '';
  else if (!special) {
    return { error: [400, 'not_hanuman_day', 'Chola dates are Tuesdays and Saturdays. For another day, mark it as a special day and name the occasion.'] };
  }
  const row = await env.DB.prepare('SELECT id FROM locations WHERE id = ?1').bind(loc).first();
  if (!row) return { error: [400, 'bad_location', 'Pick one of the locations.'] };
  return { value: { loc, date, note, special } };
}

// Validates a location body: { name?, target?, active? }. `creating` makes name required.
export function checkLocation(body, creating) {
  if (!body) return { error: [400, 'bad_request', 'Send the location as JSON.'] };
  const out = {};
  if (body.name !== undefined || creating) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
    if (!name) return { error: [400, 'bad_name', 'Give the location a name.'] };
    out.name = name;
  }
  if (body.target !== undefined) {
    const t = Number(body.target);
    if (!Number.isInteger(t) || t < 1 || t > 52) return { error: [400, 'bad_target', 'The target must be a whole number of Hanuman days from 1 to 52.'] };
    out.target = t;
  }
  if (body.active !== undefined) out.active = body.active ? 1 : 0;
  return { value: out };
}
