// arena.js - Arena online (TAHAP UJI 1): pemain saling melihat di satu dunia yang sama.
// Belum ada serangan antar pemain, belum ada poin/VOS. Server yang memegang daftar pemain, dunia (seed) dan batas gerak.
// ArenaCore = logika murni (bisa diuji tanpa Cloudflare). Arena = pembungkus Durable Object (WebSocket).

export const MAX_PLAYERS = 8;           // pemain per arena
export const TICK_MS = 50;              // 20 siaran per detik
export const RADIUS = 140;              // hanya pemain dalam jarak ini yang dikirim (interest management)
const MAX_SPEED = 32;                   // m/detik; di atas ini dianggap teleport -> dikembalikan (lari 10, lompat jauh sekitar 20)
const WORLD_LIM = 4000;
const MSG_MAX = 400;                    // byte per pesan
const RATE = 30;                        // pesan per detik per pemain
const CHARS = ['vosil', 'velo', 'carno', 'spino', 'parasaur'];

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const r1 = (v) => Math.round(v * 10) / 10;
const cleanName = (s) => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14) || 'Dino';

export class ArenaCore {
  constructor(now = () => Date.now(), rnd = Math.random) {
    this.now = now; this.rnd = rnd;
    this.players = new Map();
    this.nextId = 1;
    this.seed = this.newSeed(); this.t0 = this.now();            // t0 = awal "hari pertama" arena (jam siang-malam bersama)
  }
  newSeed() { return 1 + Math.floor(this.rnd() * 1e6); }

  // send(str) mengirim teks ke pemain itu. Mengembalikan id, atau null jika penuh.
  join(send) {
    if (this.players.size >= MAX_PLAYERS) return null;
    if (this.players.size === 0) { this.seed = this.newSeed(); this.t0 = this.now(); }      // arena kosong -> dunia & jam baru
    const id = this.nextId++;
    const ang = (id * 2.399963) % (Math.PI * 2), d = 18;           // titik awal melingkar, tersebar
    const p = {
      id, send, name: 'Dino', char: 'vosil', level: 1, ready: false,
      x: Math.cos(ang) * d, y: 0, z: Math.sin(ang) * d, yaw: 0, vx: 0, vz: 0, atk: -1, sw: 0,
      lastT: this.now(), bucket: RATE, bucketT: this.now(), strikes: 0,
    };
    this.players.set(id, p);
    return id;
  }

  leave(id) {
    const p = this.players.get(id); if (!p) return;
    this.players.delete(id);
    if (p.ready) this.broadcast({ t: 'l', id });
  }

  message(id, raw) {
    const p = this.players.get(id); if (!p) return;
    if (typeof raw !== 'string' || raw.length > MSG_MAX) { this.strike(p); return; }
    const t = this.now();
    p.bucket = Math.min(RATE, p.bucket + ((t - p.bucketT) / 1000) * RATE); p.bucketT = t;
    if (p.bucket < 1) { this.strike(p); return; }                  // terlalu cepat -> abaikan
    p.bucket -= 1;
    let m; try { m = JSON.parse(raw); } catch (e) { this.strike(p); return; }
    if (!m || typeof m !== 'object') { this.strike(p); return; }
    if (m.t === 'q') { p.send(JSON.stringify({ t: 'o', c: num(m.c) })); return; }         // ping -> pong (klien mengukur jeda)
    if (m.t === 'h') {                                             // hello: identitas tampilan
      p.name = cleanName(m.name); p.char = CHARS.includes(m.char) ? m.char : 'vosil';
      p.level = Math.min(10, Math.max(1, Math.floor(num(m.level, 1))));
      const first = !p.ready; p.ready = true;
      const roster = [...this.players.values()].filter((q) => q.ready).map((q) => this.card(q));
      p.send(JSON.stringify({ t: 'w', id: p.id, seed: this.seed, ts: this.now(), t0: this.t0, x: r1(p.x), z: r1(p.z), roster, max: MAX_PLAYERS }));
      if (first) this.broadcast({ t: 'j', p: this.card(p) }, p.id);
    } else if (m.t === 's' && p.ready) {                           // state: posisi sendiri
      const x = num(m.x, p.x), z = num(m.z, p.z), y = num(m.y, p.y);
      const dt = Math.max(0.05, Math.min(1, (t - p.lastT) / 1000));
      if (Math.abs(x) > WORLD_LIM || Math.abs(z) > WORLD_LIM || Math.hypot(x - p.x, z - p.z) > MAX_SPEED * dt + 2) {
        p.strikes++;                                               // loncat terlalu jauh -> kembalikan ke posisi terakhir yang sah
        p.send(JSON.stringify({ t: 'f', x: r1(p.x), z: r1(p.z) }));
        if (p.strikes > 30) p.send(JSON.stringify({ t: 'kick' }));
        return;
      }
      p.lastT = t; p.x = x; p.z = z; p.y = Math.max(-50, Math.min(400, y));
      p.yaw = num(m.yaw, p.yaw); p.vx = Math.max(-30, Math.min(30, num(m.vx))); p.vz = Math.max(-30, Math.min(30, num(m.vz)));
      p.atk = num(m.atk, -1); p.sw = m.sw ? 1 : 0;
      p.level = Math.min(10, Math.max(1, Math.floor(num(m.lv, p.level))));
    }
  }

  strike(p) { p.strikes++; if (p.strikes > 60) { try { p.send(JSON.stringify({ t: 'kick' })); } catch (e) { /* abaikan */ } } }
  shouldKick(id) { const p = this.players.get(id); return !!p && p.strikes > 60; }

  card(p) { return { id: p.id, name: p.name, char: p.char, level: p.level }; }
  broadcast(obj, exceptId) {
    const s = JSON.stringify(obj);
    for (const q of this.players.values()) if (q.id !== exceptId && q.ready) { try { q.send(s); } catch (e) { /* abaikan */ } }
  }

  // siaran berkala: tiap pemain hanya menerima pemain lain yang dekat
  tick() {
    const ps = [...this.players.values()].filter((p) => p.ready), ts = this.now();
    for (const a of ps) {
      const list = [];
      for (const b of ps) {
        if (b.id === a.id) continue;
        if (Math.hypot(b.x - a.x, b.z - a.z) > RADIUS) continue;
        list.push([b.id, r1(b.x), r1(b.y), r1(b.z), Math.round(b.yaw * 100) / 100, r1(b.vx), r1(b.vz), Math.round(b.atk * 100) / 100, b.sw, b.level]);
      }
      try { a.send(JSON.stringify({ t: 'p', ts: ts, n: ps.length, p: list })); } catch (e) { /* abaikan */ }
    }
  }
  size() { return this.players.size; }
}

// ---- pembungkus Durable Object ----
export class Arena {
  constructor(state, env) { this.core = new ArenaCore(); this.timer = null; this.env = env; }

  async fetch(request) {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return new Response('perlu WebSocket', { status: 426 });
    const pair = new WebSocketPair(), client = pair[0], server = pair[1];
    server.accept();
    const id = this.core.join((s) => server.send(s));
    if (id === null) {
      server.send(JSON.stringify({ t: 'full' })); server.close(1013, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }
    server.addEventListener('message', (e) => {
      this.core.message(id, typeof e.data === 'string' ? e.data : '');
      if (this.core.shouldKick(id)) { try { server.close(1008, 'abuse'); } catch (x) { /* abaikan */ } }
    });
    const gone = () => { this.core.leave(id); if (this.core.size() === 0 && this.timer) { clearInterval(this.timer); this.timer = null; } };
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    if (!this.timer) this.timer = setInterval(() => this.core.tick(), TICK_MS);
    return new Response(null, { status: 101, webSocket: client });
  }
}
