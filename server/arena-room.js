// arena-room.js (FOLDER server/, jalan di Cloudflare) - Arena online (TAHAP UJI 2): pemain saling melihat DAN saling menyerang. Belum ada poin/VOS.
// Server yang memutuskan: siapa kena, berapa kerusakan, siapa kalah. Klien hanya meminta ("aku menggigit", "aku meraung").
// ArenaCore = logika murni (bisa diuji tanpa Cloudflare). Arena = pembungkus Durable Object (WebSocket).

export const MAX_PLAYERS = 8;           // pemain per arena
export const TICK_MS = 50;              // 20 siaran per detik (hanya jika ada perubahan)
export const RADIUS = 140;              // hanya pemain dalam jarak ini yang dikirim (interest management)
const KEEPALIVE_MS = 1000;              // tanpa perubahan: tetap kirim 1x per detik (jumlah online, sinkron jam)
// batas kecepatan per dino (m/detik): lari 10.2 x kecepatan dino x dorongan lompat-lari 1.35 x kelonggaran jaringan 1.15
export const SPEED = { vosil: 1, velo: 1.2, carno: 0.95, spino: 0.88, parasaur: 1.05 };
export const maxSpeed = (c) => 10.2 * (SPEED[c] || 1) * 1.35 * 1.15;
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
export const EMOTES = 6, EMOTE_CD_MS = 2000;
const LV1 = 0.72;                       // skala level 1 (lvScale(1))
export const HP_MAX = 100;
export const BITE_ARC = 1.1;
export const HIT_GAP_MS = 300;          // satu penyerang tidak bisa mengenai korban yang sama lebih rapat dari ini (dikeroyok tetap bisa)

// Kit tiap dino: gigitan biasa + SATU skill khas. Semua angka bisa di-tuning di sini.
//  bite  : dmg (sebelum ketahanan korban), cd (ms), reach (tambahan jangkauan, meter)
//  skill : cd, windup (ms jeda persiapan - lawan melihat tanda bahaya di tanah & bisa menghindar), recover (ms terkunci setelahnya),
//          shape circle(r) | line(len,width) | cone(r,arc), dmg, kb (dorong), dash (maju sendiri, meter), slow (0-1) & slowMs
export const KITS = {
  vosil: { bite: { dmg: 6, cd: 550, reach: 0 },
    skill: { id: 'roar', cd: 14000, windup: 150, recover: 250, shape: 'circle', r: 8.2, dmg: 7, kb: 3 } },
  velo: { bite: { dmg: 3.5, cd: 330, reach: -0.3 },
    skill: { id: 'pounce', cd: 8000, windup: 130, recover: 700, shape: 'line', len: 7, width: 2.4, dmg: 12, kb: 1.2, dash: 7 } },
  carno: { bite: { dmg: 11, cd: 950, reach: 0.1 },
    skill: { id: 'charge', cd: 10000, windup: 250, recover: 900, shape: 'line', len: 7, width: 3.2, dmg: 18, kb: 5, dash: 6.5 } },
  spino: { bite: { dmg: 6.5, cd: 650, reach: 0.9 },
    skill: { id: 'sweep', cd: 7000, windup: 180, recover: 350, shape: 'circle', r: 5.2, dmg: 9, kb: 4.5 } },
  parasaur: { bite: { dmg: 4.5, cd: 550, reach: 0 },
    skill: { id: 'sonic', cd: 9000, windup: 160, recover: 300, shape: 'cone', r: 10, arc: 0.85, dmg: 5, kb: 1.5, slow: 0.45, slowMs: 2500 } },
};
const LAG_RANGE = 1.5, LAG_ARC = 0.25;  // toleransi karena data posisi lawan sedikit tertinggal
const REGEN_DELAY = 6000, REGEN_RATE = 1.2;   // nyawa dipulihkan SERVER: setelah 6 detik tidak terkena serangan, +1.2/detik (klien tidak bisa menambah nyawa)

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
    this.dirty = true; this.lastSnap = 0; this.pending = [];
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
      emReady: 0, hp: HP_MAX, dseq: 0, lastHurt: 0, kbUntil: 0, hitGap: new Map(), atkReady: 0, skReady: 0, lockUntil: 0, dashUntil: 0, kills: 0,
    };
    this.players.set(id, p);
    this.dirty = true;
    return id;
  }

  leave(id) {
    const p = this.players.get(id); if (!p) return;
    this.players.delete(id);
    this.pending = this.pending.filter((s) => s.a.id !== id);
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
      p.send(JSON.stringify({ t: 'w', id: p.id, seed: this.seed, ts: this.now(), t0: this.t0, x: r1(p.x), z: r1(p.z), roster, max: MAX_PLAYERS, kits: KITS }));
      if (first) this.broadcast({ t: 'j', p: this.card(p) }, p.id);
      return;
    }
    if (!p.ready || !p.alive) return;
    if (m.t === 's') this.onState(p, m, t);
    else if (m.t === 'a') this.onBite(p, m, t);
    else if (m.t === 'k' || m.t === 'r') this.onSkill(p, m, t);
    else if (m.t === 'e') this.onEmote(p, m, t);
  }

  onState(p, m, t) {
    const x = num(m.x, p.x), z = num(m.z, p.z), y = num(m.y, p.y);
    const dt = Math.max(0.05, Math.min(1, (t - p.lastT) / 1000));
    if (Math.abs(x) > WORLD_LIM || Math.abs(z) > WORLD_LIM || Math.hypot(x - p.x, z - p.z) > maxSpeed(p.char) * dt + 2 + (t < p.dashUntil ? 9 : 0) + (t < p.kbUntil ? 6 : 0) || Math.abs(y - p.y) > 40 + 40 * dt) {
      p.strikes++;                                                 // loncat terlalu jauh -> kembalikan ke posisi terakhir yang sah
      p.send(JSON.stringify({ t: 'f', x: r1(p.x), z: r1(p.z) }));
      if (p.strikes > 30) p.send(JSON.stringify({ t: 'kick' }));
      return;
    }
    p.lastT = t;
    const moved = x !== p.x || z !== p.z || y !== p.y || num(m.yaw, p.yaw) !== p.yaw || num(m.atk, -1) !== p.atk || (m.sw ? 1 : 0) !== p.sw;
    p.x = x; p.z = z; p.y = Math.max(-50, Math.min(400, y));
    p.yaw = num(m.yaw, p.yaw); p.vx = Math.max(-30, Math.min(30, num(m.vx))); p.vz = Math.max(-30, Math.min(30, num(m.vz)));
    p.atk = num(m.atk, -1); p.sw = m.sw ? 1 : 0;
    // nyawa SELURUHNYA diatur server: laporan 'hp' dari klien diabaikan
    if (moved) this.dirty = true;
  }

  // ---- serangan ----
  armor(q) { return STATS[q.char].armor; }
  // lakukan kerusakan; mengembalikan true jika kena. ex = {kb, slow, slowMs}
  strikeTarget(a, q, dmg, t, kind, ex) {
    if (!q.alive || q.id === a.id || !q.ready) return false;
    if ((q.hitGap.get(a.id) || 0) > t) return false;               // baru saja dikenai penyerang yang sama
    q.hitGap.set(a.id, t + HIT_GAP_MS);
    const real = dmg * this.armor(q);
    q.hp = Math.max(0, q.hp - real); q.dseq++; q.lastHurt = t; q.kbUntil = t + 600;
    q.send(JSON.stringify({ t: 'd', by: a.id, k: kind, dmg: r1(real), hp: r1(q.hp), seq: q.dseq, x: r1(a.x), z: r1(a.z), kb: (ex && ex.kb) || 0, slow: (ex && ex.slow) || 0, slowMs: (ex && ex.slowMs) || 0 }));
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
    if (t < a.atkReady || t < a.lockUntil) return;                 // terlalu cepat / sedang terkunci: abaikan
    const kit = KITS[a.char].bite;
    a.atkReady = t + kit.cd;
    if (typeof m.yaw === 'number' && Number.isFinite(m.yaw)) a.yaw = m.yaw;
    const sa = STATS[a.char], sA = (sa.scale * LV1) / 1.1;
    for (const q of this.players.values()) {
      if (q.id === a.id || !q.alive || !q.ready) continue;
      const dx = q.x - a.x, dz = q.z - a.z, d = Math.hypot(dx, dz);
      if (d > 2.4 * sA + STATS[q.char].scale * LV1 * 0.9 + kit.reach + LAG_RANGE) continue;
      if (d > 1.3 && Math.abs(angDiff(a.yaw, faceYaw(dx, dz))) > BITE_ARC + LAG_ARC) continue;
      if (Math.abs(q.y - a.y) > 6) continue;                       // beda ketinggian jauh (tebing)
      this.strikeTarget(a, q, kit.dmg, t, 'bite');
    }
    this.dirty = true;
  }
  // skill khas: ada jeda persiapan (windup). Semua melihat tanda bahaya di tanah; kena atau tidak ditentukan SAAT jeda habis.
  onSkill(a, m, t) {
    const sk = KITS[a.char].skill;
    if (t < a.skReady || t < a.lockUntil) return;
    a.skReady = t + sk.cd;
    a.lockUntil = t + sk.windup + sk.recover;
    a.atkReady = Math.max(a.atkReady, a.lockUntil);
    if (sk.dash) a.dashUntil = t + sk.windup + 500;
    if (typeof m.yaw === 'number' && Number.isFinite(m.yaw)) a.yaw = m.yaw;
    const shape = { shape: sk.shape, r: sk.r || 0, len: sk.len || 0, width: sk.width || 0, arc: sk.arc || 0 };
    this.pending.push({ a, sk, yaw: a.yaw, ox: a.x, oz: a.z, at: t + sk.windup });
    this.broadcast({ t: 'S', id: a.id, s: sk.id, w: sk.windup, yaw: r1(a.yaw * 100) / 100, x: r1(a.x), z: r1(a.z), sh: shape }, a.id);
    this.dirty = true;
  }
  resolveSkill(sp, t) {
    const a = sp.a, sk = sp.sk;
    if (!a.alive || !this.players.has(a.id)) return;
    const dx = -Math.sin(sp.yaw), dz = -Math.cos(sp.yaw);          // arah depan model
    const cx = sk.shape === 'circle' ? a.x : sp.ox, cz = sk.shape === 'circle' ? a.z : sp.oz;
    for (const q of this.players.values()) {
      if (q.id === a.id || !q.alive || !q.ready) continue;
      const body = STATS[q.char].scale * LV1 * 0.9, rx = q.x - cx, rz = q.z - cz, dist = Math.hypot(rx, rz);
      if (Math.abs(q.y - a.y) > 6) continue;
      let hit = false;
      if (sk.shape === 'circle') hit = dist <= sk.r + body * 0.5 + LAG_RANGE;
      else if (sk.shape === 'line') {
        const along = rx * dx + rz * dz, lat = Math.abs(rx * dz - rz * dx);
        hit = along >= -0.8 && along <= sk.len + LAG_RANGE && lat <= sk.width / 2 + body * 0.5 + LAG_RANGE * 0.6;
      } else if (sk.shape === 'cone') hit = dist <= sk.r + body * 0.5 + LAG_RANGE && (dist < 1.3 || Math.abs(angDiff(sp.yaw, faceYaw(rx, rz))) <= sk.arc + LAG_ARC);
      if (hit) this.strikeTarget(a, q, sk.dmg, t, sk.id, { kb: sk.kb, slow: sk.slow, slowMs: sk.slowMs });
    }
    this.dirty = true;
  }

  // emote: pilihan gerakan/ikon siap pakai (bukan teks bebas, jadi aman dari penyalahgunaan)
  onEmote(p, m, t) {
    const e = Math.floor(num(m.e, -1));
    if (e < 0 || e >= EMOTES || t < p.emReady) return;
    p.emReady = t + EMOTE_CD_MS;
    this.broadcast({ t: 'E', id: p.id, e }, p.id);
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
    if (this.pending.length) { const due = this.pending.filter((p) => p.at <= ts); if (due.length) { this.pending = this.pending.filter((p) => p.at > ts); for (const p of due) this.resolveSkill(p, ts); } }
    if (!this.dirty && ts - this.lastSnap < KEEPALIVE_MS) return;
    this.dirty = false; this.lastSnap = ts;
    const ps = [...this.players.values()].filter((p) => p.ready && p.alive);
    const rdt = Math.min(1, (ts - (this.lastRegen || ts)) / 1000); this.lastRegen = ts;
    for (const p of ps) if (p.hp < HP_MAX && ts - p.lastHurt > REGEN_DELAY) { p.hp = Math.min(HP_MAX, p.hp + REGEN_RATE * rdt); }
    for (const a of ps) {
      const list = [];
      for (const b of ps) {
        if (b.id === a.id) continue;
        if (Math.hypot(b.x - a.x, b.z - a.z) > RADIUS) continue;
        list.push([b.id, r1(b.x), r1(b.y), r1(b.z), Math.round(b.yaw * 100) / 100, r1(b.vx), r1(b.vz), Math.round(b.atk * 100) / 100, b.sw, b.level, Math.round(b.hp), b.kills]);
      }
      try { a.send(JSON.stringify({ t: 'p', ts: ts, n: ps.length, hp: r1(a.hp), p: list })); } catch (e) { /* abaikan */ }
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
