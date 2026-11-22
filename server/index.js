// index.js - pintu masuk Worker. Hanya /api/* yang sampai ke sini (lihat run_worker_first di wrangler.jsonc);
// file game (html/js/audio) dilayani langsung oleh Cloudflare.
import { createApp } from './app.js';
import * as chain from './chain.js';

const app = createApp({ chain });
export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  scheduled: (event, env, ctx) => { ctx.waitUntil(app.scheduled(env)); },
};
