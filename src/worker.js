// Cloudflare Worker entry point.
// Requests for files in public/ are served straight from the ASSETS binding (configured in
// wrangler.toml); everything else reaches this script, which answers /api/* with the handlers
// in functions/api (written in the Pages Functions style: ({ request, env, params })).
import * as data from '../functions/api/data.js';
import * as check from '../functions/api/check.js';
import * as entries from '../functions/api/entries/index.js';
import * as entry from '../functions/api/entries/[id].js';
import * as locations from '../functions/api/locations/index.js';
import * as location from '../functions/api/locations/[id].js';
import * as reminder from '../functions/api/reminder.js';
import * as notification from '../functions/api/notification.js';
import * as pushKey from '../functions/api/push/key.js';
import * as pushSubscribe from '../functions/api/push/subscribe.js';
import * as pushTest from '../functions/api/push/test.js';
import { fail } from '../lib/util.js';
import { sendKind, LOG_CRON } from '../lib/push.js';

const routes = [
  [/^\/api\/data\/?$/, data],
  [/^\/api\/check\/?$/, check],
  [/^\/api\/entries\/?$/, entries],
  [/^\/api\/entries\/([^/]+)\/?$/, entry],
  [/^\/api\/locations\/?$/, locations],
  [/^\/api\/locations\/([^/]+)\/?$/, location],
  [/^\/api\/reminder\/?$/, reminder],
  [/^\/api\/notification\/?$/, notification],
  [/^\/api\/push\/key\/?$/, pushKey],
  [/^\/api\/push\/subscribe\/?$/, pushSubscribe],
  [/^\/api\/push\/test\/?$/, pushTest],
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }
    for (const [pattern, mod] of routes) {
      const match = url.pathname.match(pattern);
      if (!match) continue;
      const method = request.method.toUpperCase();
      const handler = mod['onRequest' + method.charAt(0) + method.slice(1).toLowerCase()];
      if (typeof handler !== 'function') {
        return fail(405, 'method_not_allowed', 'This address does not accept ' + method + ' requests.');
      }
      try {
        return await handler({ request, env, ctx, params: match[1] ? { id: decodeURIComponent(match[1]) } : {} });
      } catch (e) {
        console.error(e);
        return fail(500, 'server_error', 'Something went wrong on the server. Try again.');
      }
    }
    return fail(404, 'not_found', 'No such API route.');
  },

  // Cron triggers (wrangler.toml):
  //   7 pm India time, Monday and Friday: tomorrow's location, to share on WhatsApp.
  //   8 pm India time, Tuesday and Saturday: a nudge, only if today's chola isn't logged yet.
  async scheduled(controller, env, ctx) {
    const kind = controller.cron === LOG_CRON ? 'logcheck' : 'plan';
    ctx.waitUntil(
      sendKind(env, kind)
        .then((r) => console.log('reminders', kind, JSON.stringify(r)))
        .catch((e) => console.error('reminders failed', kind, e))
    );
  },
};
