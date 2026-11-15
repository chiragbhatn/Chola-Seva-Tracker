// Phone reminders with Web Push (RFC 8030) signed with VAPID (RFC 8292).
// The push carries no data, so nothing needs encrypting: when it arrives, the phone's service
// worker (public/sw.js) fetches /api/reminder and shows "Tomorrow: <location>".
// The signing keys are made by the Worker on first use and kept in the D1 `config` table.
import { fail, isHanumanDay, todayIndia } from './util.js';

// The two schedules in wrangler.toml. Times are UTC: 13:30 = 7 pm and 14:30 = 8 pm in India.
export const PLAN_CRON = '30 13 * * MON,FRI'; // evening before each Hanuman day: tomorrow's plan
export const LOG_CRON = '30 14 * * TUE,SAT';  // the Hanuman day itself: nudge if nothing is logged

const enc = new TextEncoder();

export function b64url(bytes) {
  const a = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// D1 says "no such table" until migrations/0002_reminders.sql has been run.
export function missingTables(e) {
  return /no such table/i.test(String((e && e.message) || e))
    ? fail(503, 'needs_update', 'Reminders need a one-time database update: run migrations/0002_reminders.sql in the D1 console.')
    : null;
}

export async function getConfig(env, key) {
  const row = await env.DB.prepare('SELECT value FROM config WHERE key = ?1').bind(key).first();
  return row ? row.value : null;
}

export async function setConfig(env, key, value) {
  await env.DB
    .prepare('INSERT INTO config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}

export async function vapidKeys(env) {
  const saved = await getConfig(env, 'vapid');
  if (saved) return JSON.parse(saved);
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const keys = {
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
    publicKey: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)),
  };
  await env.DB.prepare("INSERT OR IGNORE INTO config (key, value) VALUES ('vapid', ?1)").bind(JSON.stringify(keys)).run();
  return JSON.parse(await getConfig(env, 'vapid')); // whichever request saved first wins
}

export async function vapidHeader(endpoint, keys, subject) {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })));
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + claims));
  return 'vapid t=' + header + '.' + claims + '.' + b64url(sig) + ', k=' + keys.publicKey;
}

// kind 'plan' = tomorrow's location (opens the WhatsApp share screen);
// kind 'logcheck' = today's chola isn't logged yet (opens the log sheet).
// The phone asks /api/notification what to show, which reads `last_push`.
export async function sendKind(env, kind, { force = false } = {}) {
  if (kind === 'logcheck' && !force) {
    const today = todayIndia();
    if (!isHanumanDay(today)) return { skipped: 'not a Tuesday or Saturday' };
    const logged = await env.DB.prepare('SELECT 1 AS x FROM entries WHERE date = ?1').bind(today).first();
    if (logged) return { skipped: 'already logged' };
  }
  await setConfig(env, 'last_push', JSON.stringify({ kind, at: Date.now() }));
  return sendReminders(env);
}

// Sends one reminder push to every phone that turned reminders on.
export async function sendReminders(env) {
  const subs = (await env.DB.prepare('SELECT endpoint FROM push_subscriptions ORDER BY created_at LIMIT 40').all()).results;
  const result = { phones: subs.length, sent: 0, removed: 0, failed: 0 };
  if (!subs.length) return result;
  const keys = await vapidKeys(env);
  const subject = (await getConfig(env, 'site')) || 'https://workers.dev';
  for (const s of subs) {
    try {
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: { TTL: '43200', Urgency: 'high', Authorization: await vapidHeader(s.endpoint, keys, subject) },
        body: new Uint8Array(0),
      });
      if (res.status === 404 || res.status === 410) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?1').bind(s.endpoint).run();
        result.removed++;
      } else if (res.ok) {
        result.sent++;
      } else {
        result.failed++;
        result.lastStatus = res.status;
      }
    } catch (e) {
      result.failed++;
    }
  }
  return result;
}
