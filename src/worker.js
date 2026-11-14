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
import { fail } from '../lib/util.js';

const routes = [
  [/^\/api\/data\/?$/, data],
  [/^\/api\/check\/?$/, check],
  [/^\/api\/entries\/?$/, entries],
  [/^\/api\/entries\/([^/]+)\/?$/, entry],
  [/^\/api\/locations\/?$/, locations],
  [/^\/api\/locations\/([^/]+)\/?$/, location],
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
};
