// arena.js - Arena online (TAHAP UJI 2): pemain saling melihat DAN saling menyerang. Belum ada poin/VOS.
// Server yang memutuskan: siapa kena, berapa kerusakan, siapa kalah. Klien hanya meminta ("aku menggigit", "aku meraung").
// ArenaCore = logika murni (bisa diuji tanpa Cloudflare). Arena = pembungkus Durable Object (WebSocket).

export const MAX_PLAYERS = 8;           // pemain per arena
export const TICK_MS = 50;              // 20 siaran per detik (hanya jika ada perubahan)
export const RADIUS = 140;              // hanya pemain dalam jarak ini yang dikirim (interest management)
const KEEPALIVE_MS = 1000;              // tanpa perubahan: tetap kirim 1x per detik (jumlah online, sinkron jam)
const MAX_SPEED = 32;                   // m/detik; di atas ini dianggap teleport -> dikembalikan (lari 10, lompat jauh sekitar 20)
const WORLD_LIM = 4000;
const MSG_MAX = 400;                    // byte per pesan
const RATE = 40;                        // pesan per detik per pemain
const CHARS = ['vosil', 'velo', 'carno', 'spino', 'parasaur'];

// ---- aturan pertarungan (semua pemain arena setara: level 1) ----
// scale/bite/armor sama dengan karakter di game (survival.js)
export const STATS = {
  vosil: { scale: 1.1, bite: 1, armor: 1 },
  velo: { scale: 0.95, bite: 0.75, armor: 1.2 },
  carno: { scale: 1.25, bite: 1.4, armor: 0.9 },
  spino: { scale: 1.4, bite: 1.3, armor: 0.75 },
  parasaur: { scale: 1.25, bite: 0.6, armor: 1.1 },
};
const LV1 = 0.72;                       // skala level 1 (lvScale(1))
export const HP_MAX = 100;
export const BITE_DMG = 18, BITE_CD_MS = 450, BITE_ARC = 1.1;
export const ROAR_DMG = 11, ROAR_CD_MS = 14000, ROAR_R = 8.2;
export const INVULN_MS = 700;           // kebal sebentar setelah terkena (sama seperti di game)
const LAG_RANGE = 1.5, LAG_ARC = 0.25;  // toleransi karena data posisi lawan sedikit tertinggal
const HEAL_CAP = 40, HEAL_RATE = 13;    // pemulihan yang dilaporkan klien: maks 40 nyawa, terisi 13/detik (makan buah, pulih alami)

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const r1 = (v) => Math.round(v * 10) / 10;
const cleanName = (s) => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14) || 'Dino';
const faceYaw = (dx, dz) => Math.atan2(-dx, -dz);                   // model menghadap -Z (sama dengan game)
const angDiff = (a, b) => ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

export class ArenaCore {
  constructor(now = () => Date.now(), rnd = Math.random) {
    this.now = now; this.rnd = rnd;
    this.players = new Map();
    this.nextId = 1;
    this.seed = this.newSeed(); this.t0 = this.now();            // t0 = awal "hari pertama" arena (jam siang-malam bersama)
    this.dirty = true; this.lastSnap = 0;
  }
  newSeed() { return 1 + Math.floor(this.rnd() * 1e6); }

  // send(str) mengirim teks ke pemain itu. Mengembalikan id, atau null jika penuh.
  join(send) {
    if (this.players.size >= MAX_PLAYERS) return null;
    if (this.players.size === 0) { this.seed = this.newSeed(); this.t0 = this.now(); }      // arena kosong -> dunia & jam baru
    const id = this.nextId++;
    const ang = (id * 2.399963) % (Math.PI * 2), d = 18;           // titik awal melingkar, tersebar
    const p = {
      id, send, name: 'Dino', char: 'vosil', level: 1, ready: false, alive: true,
      x: Math.cos(ang) * d, y: 0, z: Math.sin(ang) * d, yaw: 0, vx: 0, vz: 0, atk: -1, sw: 0,
      lastT: this.now(), bucket: RATE, bucketT: this.now(), strikes: 0,
      hp: HP_MAX, dseq: 0, heal: HEAL_CAP, invUntil: 0, atkReady: 0, roarReady: 0, kills: 0,
    };
    this.players.set(id, p);
    this.dirty = true;
    return id;
  }

  leave(id) {
    const p = this.players.get(id); if (!p) return;
    this.players.delete(id);
    this.dirty = true;
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
      p.level = 1;                                                 // arena: semua level 1 (adil)
      const first = !p.ready; p.ready = true; this.dirty = true;
      const roster = [...this.players.values()].filter((q) => q.ready).map((q) => this.card(q));
      p.send(JSON.stringify({ t: 'w', id: p.id, seed: this.seed, ts: this.now(), t0: this.t0, x: r1(p.x), z: r1(p.z), roster, max: MAX_PLAYERS }));
      if (first) this.broadcast({ t: 'j', p: this.card(p) }, p.id);
      return;
    }
    if (!p.ready || !p.alive) return;
    if (m.t === 's') this.onState(p, m, t);
    else if (m.t === 'a') this.onBite(p, m, t);
    else if (m.t === 'r') this.onRoar(p, t);
  }

  onState(p, m, t) {
    const x = num(m.x, p.x), z = num(m.z, p.z), y = num(m.y, p.y);
    const dt = Math.max(0.05, Math.min(1, (t - p.lastT) / 1000));
    if (Math.abs(x) > WORLD_LIM || Math.abs(z) > WORLD_LIM || Math.hypot(x - p.x, z - p.z) > MAX_SPEED * dt + 2) {
      p.strikes++;                                                 // loncat terlalu jauh -> kembalikan ke posisi terakhir yang sah
      p.send(JSON.stringify({ t: 'f', x: r1(p.x), z: r1(p.z) }));
      if (p.strikes > 30) p.send(JSON.stringify({ t: 'kick' }));
      return;
    }
    p.heal = Math.min(HEAL_CAP, p.heal + HEAL_RATE * dt);
    p.lastT = t;
    const moved = x !== p.x || z !== p.z || y !== p.y || num(m.yaw, p.yaw) !== p.yaw || num(m.atk, -1) !== p.atk || (m.sw ? 1 : 0) !== p.sw;
    p.x = x; p.z = z; p.y = Math.max(-50, Math.min(400, y));
    p.yaw = num(m.yaw, p.yaw); p.vx = Math.max(-30, Math.min(30, num(m.vx))); p.vz = Math.max(-30, Math.min(30, num(m.vz)));
    p.atk = num(m.atk, -1); p.sw = m.sw ? 1 : 0;
    // nyawa yang dilaporkan klien: boleh turun (lapar/haus), naik dibatasi; abaikan laporan yang belum menerima serangan terakhir
    if (m.hp !== undefined && num(m.ds, 0) >= p.dseq) {
      const h = Math.max(0, Math.min(HP_MAX, num(m.hp, p.hp)));
      if (h <= p.hp) p.hp = h;
      else { const inc = Math.min(h - p.hp, p.heal); p.hp += inc; p.heal -= inc; }
    }
    if (moved) this.dirty = true;
  }

  // ---- serangan ----
  armor(q) { return STATS[q.char].armor; }
  // lakukan kerusakan; mengembalikan true jika kena
  strikeTarget(a, q, dmg, t, kind) {
    if (!q.alive || q.id === a.id || !q.ready || t < q.invUntil) return false;
    const real = dmg * this.armor(q);
    q.hp = Math.max(0, q.hp - real); q.dseq++; q.invUntil = t + INVULN_MS;
    q.send(JSON.stringify({ t: 'd', by: a.id, k: kind, dmg: r1(real), hp: r1(q.hp), seq: q.dseq, x: r1(a.x), z: r1(a.z) }));
    a.send(JSON.stringify({ t: 'h', to: q.id, k: kind, dmg: r1(real), hp: r1(q.hp) }));
    this.dirty = true;
    if (q.hp <= 0) this.kill(q, a);
    return true;
  }
  kill(q, a) {
    q.alive = false; a.kills++;
    this.broadcast({ t: 'k', id: q.id, by: a.id, nm: q.name, bn: a.name });
  }
  onBite(a, m, t) {
    if (t < a.atkReady) return;                                    // terlalu cepat: abaikan
    a.atkReady = t + BITE_CD_MS;
    if (typeof m.yaw === 'number' && Number.isFinite(m.yaw)) a.yaw = m.yaw;
    const sa = STATS[a.char], sA = (sa.scale * LV1) / 1.1;
    const dmg = BITE_DMG * sa.bite;
    for (const q of this.players.values()) {
      if (q.id === a.id || !q.alive || !q.ready) continue;
      const dx = q.x - a.x, dz = q.z - a.z, d = Math.hypot(dx, dz);
      if (d > 2.4 * sA + STATS[q.char].scale * LV1 * 0.9 + LAG_RANGE) continue;
      if (d > 1.3 && Math.abs(angDiff(a.yaw, faceYaw(dx, dz))) > BITE_ARC + LAG_ARC) continue;
      if (Math.abs(q.y - a.y) > 6) continue;                       // beda ketinggian jauh (tebing)
      this.strikeTarget(a, q, dmg, t, 'bite');
    }
    this.dirty = true;
  }
  onRoar(a, t) {
    if (t < a.roarReady) return;
    a.roarReady = t + ROAR_CD_MS;
    a.invUntil = Math.max(a.invUntil, t + INVULN_MS);
    for (const q of this.players.values()) {
      if (q.id === a.id || !q.alive || !q.ready) continue;
      if (Math.hypot(q.x - a.x, q.z - a.z) > ROAR_R) continue;
      this.strikeTarget(a, q, ROAR_DMG, t, 'roar');
    }
    this.broadcast({ t: 'R', id: a.id });                          // semua melihat cincin raungan
    this.dirty = true;
  }

  strike(p) { p.strikes++; if (p.strikes > 60) { try { p.send(JSON.stringify({ t: 'kick' })); } catch (e) { /* abaikan */ } } }
  shouldKick(id) { const p = this.players.get(id); return !!p && p.strikes > 60; }

  card(p) { return { id: p.id, name: p.name, char: p.char, level: p.level }; }
  broadcast(obj, exceptId) {
    const s = JSON.stringify(obj);
    for (const q of this.players.values()) if (q.id !== exceptId && q.ready) { try { q.send(s); } catch (e) { /* abaikan */ } }
  }

  // siaran berkala: hanya jika ada perubahan (atau 1x per detik); tiap pemain hanya menerima pemain lain yang dekat
  tick() {
    const ts = this.now();
    if (!this.dirty && ts - this.lastSnap < KEEPALIVE_MS) return;
    this.dirty = false; this.lastSnap = ts;
    const ps = [...this.players.values()].filter((p) => p.ready && p.alive);
    for (const a of ps) {
      const list = [];
      for (const b of ps) {
        if (b.id === a.id) continue;
        if (Math.hypot(b.x - a.x, b.z - a.z) > RADIUS) continue;
        list.push([b.id, r1(b.x), r1(b.y), r1(b.z), Math.round(b.yaw * 100) / 100, r1(b.vx), r1(b.vz), Math.round(b.atk * 100) / 100, b.sw, b.level, Math.round(b.hp), b.kills]);
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
