// worker.js (dulu index.js) - pintu masuk Worker. Hanya /api/* yang sampai ke sini (lihat run_worker_first di wrangler.jsonc);
// file game (html/js/audio) dilayani langsung oleh Cloudflare.
import { createApp } from './app.js';
import * as chain from './chain.js';
export { Arena } from './arena-room.js';            // Durable Object untuk arena online (aktif jika ARENA_ENABLED = "1")

const app = createApp({ chain });
export default {
  fetch: (request, env, ctx) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/arena/ws') {
      if (String(env.ARENA_ENABLED || '0') !== '1' || !env.ARENA) return new Response('arena nonaktif', { status: 404 });
      const origin = request.headers.get('Origin');
      if (origin && new URL(origin).host !== url.host) return new Response('asal tidak diizinkan', { status: 403 });   // cegah situs lain menyambung
      const room = Math.min(4, Math.max(1, parseInt(url.searchParams.get('room') || '1', 10) || 1));
      return env.ARENA.get(env.ARENA.idFromName('arena-' + room), { locationHint: 'apac' }).fetch(request);   // buat arena di Asia-Pasifik (lebih dekat ke pemain)
    }
    return app.fetch(request, env, ctx);
  },
  scheduled: (event, env, ctx) => { ctx.waitUntil(app.scheduled(env)); },
};
