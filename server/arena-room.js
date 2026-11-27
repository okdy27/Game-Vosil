import { makeTerrain } from './terrain.js';
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
  raptor: { scale: 0.85, bite: 1, armor: 1 },          // NPC yang dijalankan server (ukuran badan untuk hitungan kena)
  deino: { scale: 0.9, bite: 1, armor: 1 }, compy: { scale: 0.5, bite: 1, armor: 1 }, micro: { scale: 0.4, bite: 1, armor: 1 },
  anky: { scale: 1.3, bite: 1, armor: 0.6 }, spinoa: { scale: 1.6, bite: 1, armor: 0.8 }, allo: { scale: 1.5, bite: 1, armor: 0.8 },
  argen: { scale: 2.6, bite: 1, armor: 0.5 }, para: { scale: 1.2, bite: 1, armor: 1 },
};
export const EMOTES = 6, EMOTE_CD_MS = 2000;
const LV1 = 0.72;                       // skala level 1 (lvScale(1))
export const HP_MAX = 100;
export const MAX_LEVEL = 10;
// ===== Toko "Build": item dibeli dengan EMAS selama satu kehidupan (bukan poin VOS). Salinan katalog ada di survival.js (tes membandingkan keduanya). =====
export const ITEMS = {
  a1: { cat: 'atk', tier: 1, cost: 160, dmg: 0.06 },
  a2: { cat: 'atk', tier: 2, cost: 360, from: ['a1'], dmg: 0.14 },
  a3: { cat: 'atk', tier: 3, cost: 780, from: ['a2'], dmg: 0.24, ls: 0.06 },
  d1: { cat: 'def', tier: 1, cost: 160, arm: 0.06 },
  d2: { cat: 'def', tier: 2, cost: 360, from: ['d1'], arm: 0.14 },
  d3: { cat: 'def', tier: 3, cost: 780, from: ['d2'], arm: 0.22, reg: 1.5 },
  m1: { cat: 'mov', tier: 1, cost: 150, spd: 0.06 },
  m2: { cat: 'mov', tier: 2, cost: 330, from: ['m1'], spd: 0.12 },
  m3: { cat: 'mov', tier: 3, cost: 700, from: ['m2'], spd: 0.18, cdr: 0.1 },
  s1: { cat: 'spc', tier: 1, cost: 160, xp: 0.15 },
  s2: { cat: 'spc', tier: 2, cost: 360, from: ['s1'], xp: 0.15, gold: 0.2 },
  s3: { cat: 'spc', tier: 3, cost: 780, from: ['s2'], xp: 0.3, gold: 0.25, cdr: 0.12 },
};
export const MAX_SLOTS = 6, SELL_BACK = 0.7, START_GOLD = 100;
export const CAPS = { dmg: 0.5, arm: 0.35, spd: 0.2, ls: 0.1, reg: 3, cdr: 0.2, xp: 0.5, gold: 0.5 };
export function buildMods(items) {
  const m = { dmg: 0, arm: 0, spd: 0, ls: 0, reg: 0, cdr: 0, xp: 0, gold: 0 };
  for (const id of items) { const it = ITEMS[id]; if (!it) continue; for (const k of Object.keys(m)) m[k] += it[k] || 0; }
  for (const k of Object.keys(m)) m[k] = Math.min(CAPS[k], m[k]);
  return m;
}
// harga bayar: komponen yang sudah dimiliki dipakai & dikurangkan (seperti di MOBA)
export function buyPlan(items, id) {
  const it = ITEMS[id]; if (!it) return null;
  const left = items.slice(); let price = it.cost; const used = [];
  for (const c of it.from || []) { const i = left.indexOf(c); if (i >= 0) { left.splice(i, 1); price -= ITEMS[c].cost; used.push(c); } }
  left.push(id);
  return { price, items: left, used };
}
export const xpNeed = (l) => 45 + 30 * (l - 1);
export const lvDmg = (l) => 1 + 0.07 * (l - 1);           // level naik -> gigitan makin kuat
export const lvArmor = (l) => 1 - 0.025 * (l - 1);         // ... dan makin tahan
export const BITE_ARC = 1.1;
export const HIT_GAP_MS = 300;          // satu penyerang tidak bisa mengenai korban yang sama lebih rapat dari ini (dikeroyok tetap bisa)

// Kit tiap dino: gigitan biasa + SATU skill khas. Semua angka bisa di-tuning di sini.
//  bite  : dmg (sebelum ketahanan korban), cd (ms), reach (tambahan jangkauan, meter)
//  skill : cd, windup (ms jeda persiapan - lawan melihat tanda bahaya di tanah & bisa menghindar), recover (ms terkunci setelahnya),
//          shape circle(r) | line(len,width) | cone(r,arc), dmg, kb (dorong), dash (maju sendiri, meter), slow (0-1) & slowMs
export const KITS = {
  vosil: { bite: { dmg: 6, cd: 550, reach: 0 },
    skill: { id: 'roar', cd: 14000, windup: 150, recover: 250, shape: 'circle', r: 8.2, dmg: 7, kb: 3, stun: 2500 } },
  velo: { bite: { dmg: 3.5, cd: 330, reach: -0.3 },
    skill: { id: 'pounce', cd: 8000, windup: 130, recover: 700, shape: 'line', len: 7, width: 2.4, dmg: 12, kb: 1.2, dash: 7 } },
  carno: { bite: { dmg: 11, cd: 950, reach: 0.1 },
    skill: { id: 'charge', cd: 10000, windup: 250, recover: 900, shape: 'line', len: 7, width: 3.2, dmg: 18, kb: 5, dash: 6.5 } },
  spino: { bite: { dmg: 6.5, cd: 650, reach: 0.9 },
    skill: { id: 'sweep', cd: 7000, windup: 180, recover: 350, shape: 'circle', r: 5.2, dmg: 9, kb: 4.5 } },
  parasaur: { bite: { dmg: 4.5, cd: 550, reach: 0 },
    skill: { id: 'sonic', cd: 9000, windup: 160, recover: 300, shape: 'cone', r: 10, arc: 0.85, dmg: 5, kb: 1.5, slow: 0.45, slowMs: 2500 } },
};
// ---- NPC dunia bersama: dijalankan server, sama untuk semua pemain ----
// kind: hunter (pemburu tunggal) | pack (berkelompok, mengincar yang nyawanya paling tipis) | guard (menjaga titik, membalas keras) | ambush (diam lalu menerkam)
//       territory (menantang di wilayahnya) | giant (berjalan lurus, bahaya injakan) | sentinel (berseru jika ada predator) | scav (pengintai sisa makanan) | healer (memulihkan pemain)
export const NPCT = {
  raptor: { name: 'Raptor', kind: 'hunter', hp: 60, chase: 6.6, wander: 2, detect: 28, dmg: 6, cd: 1050, reach: 2.3, lv: 2 },
  deino: { name: 'Deinonychus', kind: 'pack', hp: 55, chase: 7.5, wander: 2.2, detect: 30, dmg: 5, cd: 950, reach: 2.2, lv: 3 },
  compy: { name: 'Compsognathus', kind: 'scav', hp: 14, wander: 2.4, flee: 7.5, lv: 1 },
  micro: { name: 'Microraptor', kind: 'healer', hp: 18, speed: 7, heal: 2.2, lv: 1 },
  anky: { name: 'Ankylosaurus', kind: 'guard', hp: 220, chase: 4.8, wander: 1.4, dmg: 10, cd: 1400, reach: 3.2, kb: 8, leash: 24, lv: 3 },
  spinoa: { name: 'Spinosaurus', kind: 'ambush', hp: 160, dash: 14, dmg: 13, cd: 2600, reach: 3.2, trig: 11, lv: 5 },
  allo: { name: 'Allosaurus', kind: 'territory', hp: 190, chase: 7.2, wander: 1.6, detect: 22, dmg: 13, cd: 1300, reach: 3.0, leash: 55, lv: 5 },
  argen: { name: 'Argentinosaurus', kind: 'giant', hp: 520, wander: 2.3, dmg: 12, cd: 1100, reach: 5.6, kb: 6, lv: 6 },
  para: { name: 'Parasaurolophus', kind: 'sentinel', hp: 40, wander: 1.8, flee: 7, lv: 1 },
};
export const NPC = { spawnMin: 45, spawnMax: 70, despawn: 170, respawnMs: 6000, cap: 12, hardCap: 22, packLifeMs: 75000, packEveryMs: [65000, 95000], packFirstMs: 45000 };
const LAG_RANGE = 1.5, LAG_ARC = 0.25;  // toleransi karena data posisi lawan sedikit tertinggal
const REGEN_DELAY = 6000, REGEN_RATE = 1.2;   // nyawa dipulihkan SERVER: setelah 6 detik tidak terkena serangan, +1.2/detik (klien tidak bisa menambah nyawa)

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const r1 = (v) => Math.round(v * 10) / 10;
// ---- filter nama pemain (kata kasar, pelecehan, dan peniru admin) ----
const BAD_LONG = 'anjing anjrit bangsat bajingan brengsek keparat kampret sialan kontol memek ngentot entot jembut itil pantek jancok jancuk cuk pelacur lonte jablay bokep tolol goblok idiot  babi bangke tai kimak perek ngewe sange coli fuck fuk shit bitch cunt dick cock pussy nigger nigga fag faggot retard rape rapist whore slut bastard asshole nazi hitler porn sex'.split(' ');
const BAD_SHORT = ['cuk', 'tai', 'sex', 'dick', 'cock', 'fuk', 'itil', 'coli', 'sange', 'ngewe', 'babi', 'nazi', 'porn'];       // kata pendek: hanya bila berdiri sendiri
const IMPERSON = 'admin moderator official staff vosilteam'.split(' ');
export function nameAllowed(name) {
  const raw = String(name || '').toLowerCase();
  const leet = raw.replace(/[@]/g, 'a').replace(/[$]/g, 's').replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't');
  const tight = leet.replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');                 // tanpa spasi/simbol, huruf berulang diringkas
  const words = leet.split(/[^a-z]+/).filter(Boolean).map((w) => w.replace(/(.)\1+/g, '$1'));
  for (const b of BAD_LONG) { const bb = b.replace(/(.)\1+/g, '$1'); if (bb.length >= 5 && tight.includes(bb)) return false; if (words.includes(bb)) return false; }
  for (const b of ['fuck', 'shit', 'cunt', 'anjing', 'ngentot']) if (tight.includes(b.replace(/(.)\1+/g, '$1'))) return false;
  for (const b of BAD_SHORT) if (words.includes(b.replace(/(.)\1+/g, '$1'))) return false;
  for (const w of IMPERSON) if (tight.includes(w.replace(/[^a-z]/g, ''))) return false;
  return true;
}
const cleanName0 = (s) => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14) || 'Dino';
const cleanName = (s) => { const n = cleanName0(s); return nameAllowed(n) ? n : 'Dino'; };
const faceYaw = (dx, dz) => Math.atan2(-dx, -dz);                   // model menghadap -Z (sama dengan game)
const angDiff = (a, b) => ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

export class ArenaCore {
  constructor(now = () => Date.now(), rnd = Math.random) {
    this.now = now; this.rnd = rnd;
    this.players = new Map();
    this.nextId = 1;
    this.seed = this.newSeed(); this.terr = makeTerrain(this.seed); this.t0 = this.now();            // t0 = awal "hari pertama" arena (jam siang-malam bersama)
    this.dirty = true; this.lastSnap = 0; this.pending = [];
    this.npcOn = true; this.npcs = new Map(); this.nextNpc = 1; this.npcSpawnAt = 0; this.lastNpc = 0; this.packAt = 0; this.born = 0;
  }
  everyone() { return [...this.players.values(), ...this.npcs.values()]; }
  newSeed() { return 1 + Math.floor(this.rnd() * 1e6); }

  // send(str) mengirim teks ke pemain itu. Mengembalikan id, atau null jika penuh.
  join(send) {
    if (this.players.size >= MAX_PLAYERS) return null;
    if (this.players.size === 0) { this.seed = this.newSeed(); this.terr = makeTerrain(this.seed); this.t0 = this.now(); }      // arena kosong -> dunia & jam baru
    const id = this.nextId++;
    const ang = (id * 2.399963) % (Math.PI * 2), d = 18;           // titik awal melingkar, tersebar
    const p = {
      id, send, name: 'Dino', char: 'vosil', level: 1, ready: false, alive: true,
      x: Math.cos(ang) * d, y: 0, z: Math.sin(ang) * d, yaw: 0, vx: 0, vz: 0, atk: -1, sw: 0,
      lastT: this.now(), bucket: RATE, bucketT: this.now(), strikes: 0,
      emReady: 0, hp: HP_MAX, xp: 0, xpT: 0, gold: START_GOLD, goldT: 0, items: [], mods: buildMods([]), shopUntil: 0, shopCool: 0, shopSince: 0, bornT: 0, dseq: 0, lastHurt: 0, kbUntil: 0, hitGap: new Map(), atkReady: 0, skReady: 0, lockUntil: 0, dashUntil: 0, kills: 0,
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
      p.level = 1; p.xp = 0; p.gold = START_GOLD; p.items = []; p.mods = buildMods([]); p.bornT = this.now(); p.shopUntil = 0; p.shopCool = 0; p.shopSince = 0;
      // setiap hidup baru mulai dari level 1, lalu naik lewat XP
      const first = !p.ready; p.ready = true; this.dirty = true;
      const roster = this.everyone().filter((q) => q.ready).map((q) => this.card(q));
      p.send(JSON.stringify({ t: 'w', id: p.id, seed: this.seed, ts: this.now(), t0: this.t0, x: r1(p.x), z: r1(p.z), roster, max: MAX_PLAYERS, kits: KITS }));
      this.sendGold(p);
      if (first) this.broadcast({ t: 'j', p: this.card(p) }, p.id);
      return;
    }
    if (!p.ready || !p.alive) return;
    if (m.t === 's') this.onState(p, m, t);
    else if (m.t === 'a') this.onBite(p, m, t);
    else if (m.t === 'k' || m.t === 'r') this.onSkill(p, m, t);
    else if (m.t === 'e') this.onEmote(p, m, t);
    else if (m.t === 'tp') this.onTeleport(p, m, t);
    else if (m.t === 'by') this.onBuy(p, m, t);
    else if (m.t === 'sl') this.onSell(p, m, t);
    else if (m.t === 'sh') this.onShop(p, m, t);
  }

  // teleport resmi dari game (pintu pulau harta / jatuh ke jurang): dibatasi supaya tidak bisa dipakai curang
  onTeleport(p, m, t) {
    if (t < (p.tpReady || 0)) { p.send(JSON.stringify({ t: 'f', x: r1(p.x), z: r1(p.z) })); return; }
    const x = num(m.x, p.x), z = num(m.z, p.z), k = m.k === 'door' ? 'door' : 'fall';
    if (k === 'door') { if (Math.hypot(x - 2.5, z - 2.5) > 1) { p.send(JSON.stringify({ t: 'f', x: r1(p.x), z: r1(p.z) })); return; } p.tpReady = t + 8000; }
    else { if (Math.hypot(x - p.x, z - p.z) > 80) { p.send(JSON.stringify({ t: 'f', x: r1(p.x), z: r1(p.z) })); return; } p.tpReady = t + 5000; }
    p.x = x; p.z = z; p.lastT = t; this.dirty = true;
  }
  onState(p, m, t) {
    const x = num(m.x, p.x), z = num(m.z, p.z), y = num(m.y, p.y);
    const dt = Math.max(0.05, Math.min(1, (t - p.lastT) / 1000));
    if (p.strikes > 0) p.strikes = Math.max(0, p.strikes - 0.5 * Math.max(0, (t - (p.strikeT || t)) / 1000)); p.strikeT = t;     // pelanggaran lama memudar
    if (Math.abs(x) > WORLD_LIM || Math.abs(z) > WORLD_LIM || Math.hypot(x - p.x, z - p.z) > maxSpeed(p.char) * (1 + p.mods.spd) * dt + 2 + (t < p.dashUntil ? 9 : 0) + (t < p.kbUntil ? 6 : 0) || Math.abs(y - p.y) > 40 + 40 * dt) {
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

  // ---- toko Build ----
  sendGold(p, err) { try { p.send(JSON.stringify({ t: 'g', g: Math.floor(p.gold), it: p.items, err: err || '' })); } catch (e) { /* abaikan */ } }
  addGold(p, n) { if (p.npc || !p.alive || n <= 0) return; p.gold += n * (1 + p.mods.gold); this.sendGold(p); }
  onBuy(p, m, t) {
    if (!p.alive || !p.ready) return;
    if (t < (p.shopReady || 0)) return; p.shopReady = t + 250;
    const plan = buyPlan(p.items, String(m.id));
    if (!plan) return;
    if (plan.items.length > MAX_SLOTS) { this.sendGold(p, 'full'); return; }
    if (p.gold < plan.price) { this.sendGold(p, 'gold'); return; }
    p.gold -= plan.price; p.items = plan.items; p.mods = buildMods(p.items);
    this.sendGold(p); this.dirty = true;
  }
  // menu Build terbuka: NPC tidak bisa melukai (maks 25 dtk per pembukaan, lalu jeda 8 dtk agar tidak disalahgunakan)
  onShop(p, m, t) {
    if (m.o) {
      if (!(p.shopUntil > t)) { if (t < (p.shopCool || 0) || t < p.shopUntil + 8000) return; p.shopSince = t; }
      p.shopUntil = t + 8000;
    } else { if (p.shopUntil > t) p.shopCool = t + 8000; p.shopUntil = 0; }
  }
  onSell(p, m, t) {
    if (!p.alive || !p.ready) return;
    if (t < (p.shopReady || 0)) return; p.shopReady = t + 250;
    const id = String(m.id), i = p.items.indexOf(id); if (i < 0) return;
    p.items.splice(i, 1); p.gold += Math.floor(ITEMS[id].cost * 7 / 10); p.mods = buildMods(p.items);
    this.sendGold(p); this.dirty = true;
  }

  // ---- serangan ----
  armor(q) { return STATS[q.char].armor * (q.npc ? 1 : lvArmor(q.level) * (1 - q.mods.arm)); }
  // XP milik server (anti-curang): naik level mempengaruhi kekuatan & ketahanan
  gainXp(p, n) {
    if (p.npc || !p.alive || p.level >= MAX_LEVEL || n <= 0) return;
    p.xp += n * (1 + p.mods.xp); let up = 0;
    while (p.level < MAX_LEVEL && p.xp >= xpNeed(p.level)) { p.xp -= xpNeed(p.level); p.level++; up++; }
    if (p.level >= MAX_LEVEL) p.xp = 0;
    if (up) { p.hp = Math.min(HP_MAX, p.hp + 35); this.dirty = true; }
    try { p.send(JSON.stringify({ t: 'xp', lv: p.level, xp: Math.round(p.xp), up })); } catch (e) { /* abaikan */ }
  }
  // lakukan kerusakan; mengembalikan true jika kena. ex = {kb, slow, slowMs}
  strikeTarget(a, q, dmg, t, kind, ex) {
    if (!q.alive || q.id === a.id || !q.ready) return false;
    if (a.npc && !q.npc && q.shopUntil > t && t - q.shopSince < 25000) return false;           // sedang di menu Build
    if ((q.hitGap.get(a.id) || 0) > t) return false;               // baru saja dikenai penyerang yang sama
    q.hitGap.set(a.id, t + HIT_GAP_MS);
    if (a.npc && !q.npc) dmg *= 0.5 + 0.5 * Math.min(1, (t - (q.bornT || t)) / 150000);     // awal kehidupan: serangan NPC lebih lemah, naik pelan sampai ~2,5 menit
    const real = dmg * this.armor(q);
    if (!a.npc && a.mods.ls > 0 && a.alive) a.hp = Math.min(HP_MAX, a.hp + real * a.mods.ls);       // curi nyawa (item Gigi Raja)
    q.hp = Math.max(0, q.hp - real); q.dseq++; q.lastHurt = t; q.kbUntil = t + 600;
    let stunMs = 0;
    if (ex && ex.stun > 0) { stunMs = q.npc ? ex.stun : Math.min(ex.stun, 1200); q.stunUntil = Math.max(q.stunUntil || 0, t + stunMs); }       // pingsan: NPC penuh, pemain dibatasi 1,2 dtk (adil)
    if (q.npc) { q.anger = t + 9000; q.lastAtt = a; }
    q.send(JSON.stringify({ t: 'd', by: a.id, k: kind, dmg: r1(real), hp: r1(q.hp), seq: q.dseq, x: r1(a.x), z: r1(a.z), kb: (ex && ex.kb) || 0, slow: (ex && ex.slow) || 0, slowMs: (ex && ex.slowMs) || 0, stun: stunMs }));
    a.send(JSON.stringify({ t: 'h', to: q.id, k: kind, dmg: r1(real), hp: r1(q.hp), stun: stunMs }));
    this.dirty = true;
    if (q.hp <= 0) this.kill(q, a);
    return true;
  }
  kill(q, a) {
    q.alive = false; a.kills++;
    if (!a.npc) { this.gainXp(a, q.npc ? Math.min(70, Math.round(q.maxHp * 0.35) + 8) : 30 + 8 * q.level); this.addGold(a, q.npc ? 12 + Math.round(q.maxHp * 0.22) : 40 + 10 * q.level); }
    if (q.npc) { this.npcSpawnAt = Math.max(this.npcSpawnAt, this.now() + (q.pack ? 0 : NPC.respawnMs)); this.broadcast({ t: 'k', id: q.id, by: a.id, nm: q.name, bn: a.name }); this.dropNpc(q); return; }
    this.broadcast({ t: 'k', id: q.id, by: a.id, nm: q.name, bn: a.name });
  }
  onBite(a, m, t) {
    if (t < a.atkReady || t < a.lockUntil || t < (a.stunUntil || 0)) return;                 // terlalu cepat / pingsan / sedang terkunci: abaikan
    const kit = KITS[a.char].bite;
    a.atkReady = t + kit.cd;
    if (typeof m.yaw === 'number' && Number.isFinite(m.yaw)) a.yaw = m.yaw;
    const sa = STATS[a.char], sA = (sa.scale * LV1) / 1.1;
    for (const q of this.everyone()) {
      if (q.id === a.id || !q.alive || !q.ready) continue;
      const dx = q.x - a.x, dz = q.z - a.z, d = Math.hypot(dx, dz);
      if (d > 2.4 * sA + STATS[q.char].scale * LV1 * 0.9 + kit.reach + LAG_RANGE) continue;
      if (d > 1.3 && Math.abs(angDiff(a.yaw, faceYaw(dx, dz))) > BITE_ARC + LAG_ARC) continue;
      if (Math.abs(q.y - a.y) > 6) continue;                       // beda ketinggian jauh (tebing)
      this.strikeTarget(a, q, kit.dmg * lvDmg(a.level) * (1 + a.mods.dmg), t, 'bite');
    }
    this.dirty = true;
  }
  // skill khas: ada jeda persiapan (windup). Semua melihat tanda bahaya di tanah; kena atau tidak ditentukan SAAT jeda habis.
  onSkill(a, m, t) {
    const sk = KITS[a.char].skill;
    if (t < a.skReady || t < a.lockUntil || t < (a.stunUntil || 0)) return;
    a.skReady = t + sk.cd * (1 - a.mods.cdr);
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
    for (const q of this.everyone()) {
      if (q.id === a.id || !q.alive || !q.ready) continue;
      const body = STATS[q.char].scale * LV1 * 0.9, rx = q.x - cx, rz = q.z - cz, dist = Math.hypot(rx, rz);
      if (Math.abs(q.y - a.y) > 6) continue;
      let hit = false;
      if (sk.shape === 'circle') hit = dist <= sk.r + body * 0.5 + LAG_RANGE;
      else if (sk.shape === 'line') {
        const along = rx * dx + rz * dz, lat = Math.abs(rx * dz - rz * dx);
        hit = along >= -0.8 && along <= sk.len + LAG_RANGE && lat <= sk.width / 2 + body * 0.5 + LAG_RANGE * 0.6;
      } else if (sk.shape === 'cone') hit = dist <= sk.r + body * 0.5 + LAG_RANGE && (dist < 1.3 || Math.abs(angDiff(sp.yaw, faceYaw(rx, rz))) <= sk.arc + LAG_ARC);
      if (hit) this.strikeTarget(a, q, sk.dmg * lvDmg(a.level) * (1 + a.mods.dmg), t, sk.id, { kb: sk.kb, slow: sk.slow, slowMs: sk.slowMs, stun: sk.stun });
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

  card(p) { return p.npc ? { id: p.id, name: p.name, char: p.char, level: p.level, npc: 1, fr: p.fr ? 1 : 0 } : { id: p.id, name: p.name, char: p.char, level: p.level }; }
  broadcast(obj, exceptId) {
    const s = JSON.stringify(obj);
    for (const q of this.players.values()) if (q.id !== exceptId && q.ready) { try { q.send(s); } catch (e) { /* abaikan */ } }
  }

  dropNpc(n) { if (!this.npcs.delete(n.id)) return; this.broadcast({ t: 'l', id: n.id, npc: 1 }); this.dirty = true; }
  spawnNpc(t, type, o = {}) {
    const ps = [...this.players.values()].filter((p) => p.ready && p.alive); if (!ps.length) return null;
    const ambient = [...this.npcs.values()].filter((n) => !n.pack).length;
    if (this.npcs.size >= NPC.hardCap || (!o.pack && ambient >= (this.capNow || NPC.cap))) return null;                // kawanan punya jatah sendiri di luar batas NPC biasa
    const sp = NPCT[type], base = o.base || ps[Math.floor(this.rnd() * ps.length)], ang0 = o.ang !== undefined ? o.ang : this.rnd() * Math.PI * 2;
    let x = 0, z = 0, ang = ang0, found = false;
    for (let a = 0; a < 12 && !found; a++) {                                           // cari tempat yang wajar: geser sudut/jarak bila air, jurang, atau area lompat
      ang = ang0 + (a % 2 ? 1 : -1) * Math.ceil(a / 2) * 0.45;
      const d = (o.d !== undefined ? o.d : NPC.spawnMin + this.rnd() * (NPC.spawnMax - NPC.spawnMin)) + (a > 5 ? (a - 5) * 3 : 0);
      x = base.x + Math.cos(ang) * d + (o.jx || 0) + (this.rnd() - 0.5) * 3; z = base.z + Math.sin(ang) * d + (o.jz || 0) + (this.rnd() - 0.5) * 3;
      if (!o.force && ps.some((p) => Math.hypot(p.x - x, p.z - z) < NPC.spawnMin - 8)) continue;
      if (this.terr && !this.terr.walkable(x, z)) continue;       // tidak muncul di air / jurang / dekat area harta karun
      found = true;
    }
    if (!found) return null;
    const id = 'n' + (this.nextNpc++), hpm = Math.round(sp.hp * (1 + this.diff() * 0.5));
    const n = { id, npc: true, type, kind: sp.kind, sp, name: sp.name, char: type, level: sp.lv, fr: ['scav', 'healer', 'sentinel'].includes(sp.kind), ready: true, alive: true, x, y: base.y, z, yaw: 0, vx: 0, vz: 0, atk: -1, sw: 0, hp: hpm, maxHp: hpm,
      dseq: 0, lastHurt: 0, kbUntil: 0, hitGap: new Map(), kills: 0, send: () => {}, atkReady: t + 1200, wanderT: 0, wyaw: ang, hx: x, hz: z, phase: 'idle', until: 0, anger: 0, alertAt: 0, pack: o.pack || 0, idx: o.idx || 0, bornAt: t, cs: 0, hd: undefined, wst: 'walk', leaving: false, fleeing: false, avs: 0 };
    this.npcs.set(id, n); this.broadcast({ t: 'j', p: this.card(n) }); this.dirty = true; return n;
  }
  diff() { return Math.min(1, Math.max(0, (this.now() - this.born) / 360000)); }       // 0 -> 1 selama 6 menit: musuh makin tangguh
  startPack(t, ps) {
    const base = ps[Math.floor(this.rnd() * ps.length)], ang = this.rnd() * Math.PI * 2, n = 4 + Math.floor(this.rnd() * 3) + Math.min(2, Math.floor(this.diff() * 2) + (ps.length >= 3 ? 1 : 0));   // 4-8 ekor
    const pid = this.nextNpc; let made = 0;
    for (let i = 0; i < n; i++) {
      const type = i % 3 === 2 ? 'deino' : 'raptor';
      if (this.spawnNpc(t, type, { base, ang: ang + (i - n / 2) * 0.16, d: 50 + (i % 3) * 4, pack: pid, idx: i, force: true })) made++;
    }
    if (made) this.broadcast({ t: 'W', n: made, x: r1(base.x + Math.cos(ang) * 52), z: r1(base.z + Math.sin(ang) * 52) });
  }
  count(type) { let c = 0; for (const n of this.npcs.values()) if (n.type === type) c++; return c; }
  manageNpcs(t, ps) {
    const P = ps.length, el = t - this.born, d = this.diff();
    if (!this.packAt) this.packAt = t + NPC.packFirstMs;
    const grace = ps.reduce((a, p) => a + Math.min(1, (t - (p.bornT || t)) / 150000), 0) / P;     // 0 = pemain baru, 1 = sudah ~2,5 menit
    this.capNow = Math.max(4, Math.round(NPC.cap * (0.35 + 0.65 * grace)));                       // awal permainan: lebih sedikit musuh
    if (t >= this.packAt && grace < 0.5) this.packAt = t + 8000;                                   // kawanan tidak muncul pada ~75 detik pertama
    else if (t >= this.packAt) { this.packAt = t + NPC.packEveryMs[0] + this.rnd() * (NPC.packEveryMs[1] - NPC.packEveryMs[0]) * (1 - d * 0.4); this.startPack(t, ps); }
    if (t < this.npcSpawnAt) return;
    this.npcSpawnAt = t + 1200;
    const want = { raptor: Math.min(5, 1 + P + Math.floor(d * 2)), compy: 2, micro: 1, para: 1, anky: 1, spinoa: el > 30000 ? 1 : 0, allo: el > 60000 ? 1 : 0, argen: el > 90000 ? 1 : 0 };
    for (const type of Object.keys(want)) if (this.count(type) < want[type]) { const o = (NPCT[type].kind === 'scav' || NPCT[type].kind === 'healer' || NPCT[type].kind === 'sentinel') ? { d: 28 + this.rnd() * 14 } : {}; if (this.spawnNpc(t, type, o)) break; }
  }
  stepNpcs(t) {
    const dt = Math.min(0.2, Math.max(0, (t - (this.lastNpc || t)) / 1000)); this.lastNpc = t;
    const ps = [...this.players.values()].filter((p) => p.ready && p.alive);
    if (!ps.length) { for (const n of [...this.npcs.values()]) this.dropNpc(n); this.packAt = 0; this.born = 0; return; }
    if (!this.born) this.born = t;
    if (this.npcOn) this.manageNpcs(t, ps);
    const hostile = [...this.npcs.values()].filter((n) => ['hunter', 'pack', 'territory', 'ambush'].includes(n.kind));
    const diff = this.diff();
    const inZone = (x, z) => !!(this.terr && this.terr.zoneNear(x, z, 8));       // area tantangan lompat (+ pinggiran): NPC tidak masuk ke sana
    for (const n of [...this.npcs.values()]) {
      const sp = n.sp;
      let nearest = 1e9, np = null;
      let nearAny = 1e9;
      for (const p of ps) { const dd = Math.hypot(p.x - n.x, p.z - n.z); if (dd < nearAny) { nearAny = dd; n.y = p.y; } if (dd < nearest && !inZone(p.x, p.z)) { nearest = dd; np = p; } }     // pemain di dalam area harta karun tidak dikejar
      if (nearAny > NPC.despawn && !n.pack) { this.dropNpc(n); continue; }
      if (nearAny > NPC.despawn * 1.6) { this.dropNpc(n); continue; }
      if (t < (n.stunUntil || 0)) { n.cs = 0; n.vx = 0; n.vz = 0; if (n.atk >= 0) { n.atk += dt; if (n.atk > 0.35) n.atk = -1; } this.dirty = true; continue; }     // pingsan: diam total
      let dx = 0, dz = 0, spd = 0;
      const toward = (x, z, v) => { const ex = x - n.x, ez = z - n.z, dd = Math.max(0.001, Math.hypot(ex, ez)); dx = ex / dd; dz = ez / dd; spd = v; n.yaw = faceYaw(ex, ez); return dd; };
      const away = (x, z, v) => { const ex = n.x - x, ez = n.z - z, dd = Math.max(0.001, Math.hypot(ex, ez)); dx = ex / dd; dz = ez / dd; spd = v; n.yaw = faceYaw(dx, dz); };
      const wander = (v, hx, hz, rad) => {                       // berjalan santai - berhenti merumput - berjalan lagi (perubahan arah kecil, bukan acak liar)
        if (t >= n.wanderT) {
          if (n.wst === 'walk' && this.rnd() < 0.6) { n.wst = 'graze'; n.wanderT = t + 2500 + this.rnd() * 3500; }
          else { n.wst = 'walk'; n.wanderT = t + 4000 + this.rnd() * 5000; n.wyaw += (this.rnd() - 0.5) * 1.8; }
          if (hx !== undefined && Math.hypot(n.x - hx, n.z - hz) > rad) { n.wyaw = Math.atan2(hz - n.z, hx - n.x); n.wst = 'walk'; }
        }
        if (n.wst === 'walk') { spd = v; dx = Math.cos(n.wyaw); dz = Math.sin(n.wyaw); }
      };
      const bite = (tg, dmg, kb) => { if (t >= n.atkReady && tg) { n.atkReady = t + sp.cd; n.atk = 0; this.strikeTarget(n, tg, dmg * (1 + diff * 0.2), t, 'bite', { kb }); } };
      const k = n.kind;
      if (n.pack && !n.leaving && t - n.bornAt > NPC.packLifeMs) n.leaving = true;      // kawanan tidak mengejar selamanya: setelah ~75 dtk mereka pergi
      if (n.leaving) { if (nearAny > 70) { this.dropNpc(n); continue; } if (np) away(np.x, np.z, sp.chase * 0.9); }
      else if (k === 'hunter' || k === 'pack') {
        let tg = null, bd = sp.detect * (1 + diff * 0.25);
        for (const p of ps) {
          const dd = Math.hypot(p.x - n.x, p.z - n.z);
          if (dd > bd || inZone(p.x, p.z)) continue;
          if (k === 'pack') { if (!tg || p.hp < tg.hp - 5 || (Math.abs(p.hp - tg.hp) <= 5 && dd < Math.hypot(tg.x - n.x, tg.z - n.z))) tg = p; }
          else if (!tg || dd < Math.hypot(tg.x - n.x, tg.z - n.z)) tg = p;
        }
        if (n.pack && !tg) tg = np;                                   // anggota kawanan terus mencari pemain terdekat
        if (tg) {
          const sideways = (n.idx % 3 - 1) * 4, ex = tg.x - n.x, ez = tg.z - n.z, dd = Math.max(0.001, Math.hypot(ex, ez));
          const px = tg.x + (-ez / dd) * sideways * (dd > 7 ? 1 : 0), pz = tg.z + (ex / dd) * sideways * (dd > 7 ? 1 : 0);     // mengepung dari sisi berbeda
          const real = toward(px, pz, sp.chase * (1 + diff * 0.15));
          if (dd <= sp.reach * 0.8) spd = 0;
          if (dd <= sp.reach) bite(tg, sp.dmg, 1);
        } else wander(sp.wander);
      } else if (k === 'guard') {
        const prov = t < n.anger && n.lastAtt && n.lastAtt.alive ? n.lastAtt : null;
        if (prov && Math.hypot(n.x - n.hx, n.z - n.hz) < sp.leash + 8) { const dd = toward(prov.x, prov.z, sp.chase); if (dd <= sp.reach) { spd = 0; bite(prov, sp.dmg, sp.kb); } }
        else {
          const close = ps.find((p) => Math.hypot(p.x - n.x, p.z - n.z) < 3.4);
          if (close) { n.yaw = faceYaw(close.x - n.x, close.z - n.z); bite(close, sp.dmg * 0.7, sp.kb); }
          else wander(sp.wander, n.hx, n.hz, 10);
        }
      } else if (k === 'ambush') {
        if (n.phase === 'idle') { if (np && nearest < sp.trig && t >= n.atkReady) { n.phase = 'wind'; n.until = t + 550; n.tgt = np; n.yaw = faceYaw(np.x - n.x, np.z - n.z); } }
        else if (n.phase === 'wind') { if (n.tgt) n.yaw = faceYaw(n.tgt.x - n.x, n.tgt.z - n.z); if (t >= n.until) { n.phase = 'dash'; n.until = t + 1000; } }
        else if (n.phase === 'dash') {
          spd = sp.dash; dx = -Math.sin(n.yaw); dz = -Math.cos(n.yaw);
          const hit = ps.find((p) => Math.hypot(p.x - n.x, p.z - n.z) < sp.reach);
          if (hit) { n.atk = 0; this.strikeTarget(n, hit, sp.dmg * (1 + diff * 0.2), t, 'bite', { kb: 5 }); n.phase = 'rest'; n.until = t + 1500; n.atkReady = t + sp.cd; }
          else if (t >= n.until) { n.phase = 'rest'; n.until = t + 1500; n.atkReady = t + sp.cd; }
        } else if (t >= n.until) n.phase = 'idle';
      } else if (k === 'territory') {
        const inT = np && nearest < sp.detect && Math.hypot(np.x - n.hx, np.z - n.hz) < sp.leash;
        if (inT && n.phase !== 'chase') {
          if (n.phase !== 'roar') { n.phase = 'roar'; n.until = t + 700; this.broadcast({ t: 'R', id: n.id }); n.yaw = faceYaw(np.x - n.x, np.z - n.z); }
          else if (t >= n.until) n.phase = 'chase';
        } else if (n.phase === 'chase') {
          if (np && Math.hypot(n.x - n.hx, n.z - n.hz) < sp.leash && nearest < sp.detect * 1.6) { const dd = toward(np.x, np.z, sp.chase * (1 + diff * 0.1)); if (dd <= sp.reach * 0.8) spd = 0; if (dd <= sp.reach) bite(np, sp.dmg, 2); }
          else n.phase = 'idle';
        } else if (n.phase === 'idle' || n.phase === 'roar') { n.phase = 'idle'; wander(sp.wander, n.hx, n.hz, 14); }
      } else if (k === 'giant') {
        if (t >= n.wanderT) { n.wanderT = t + 12000 + this.rnd() * 8000; n.wyaw += (this.rnd() - 0.5) * 1.4; }
        spd = sp.wander; dx = Math.cos(n.wyaw); dz = Math.sin(n.wyaw); n.yaw = faceYaw(dx, dz);
        for (const p of ps) if (Math.hypot(p.x - n.x, p.z - n.z) < sp.reach && t >= n.atkReady) { n.atkReady = t + sp.cd; n.atk = 0; this.strikeTarget(n, p, sp.dmg * (1 + diff * 0.2), t, 'bite', { kb: sp.kb }); }     // injakan
      } else if (k === 'sentinel') {                              // herbivora waspada: merumput, lari bila melihat pemain / predator, menyerukan bahaya
        const h = hostile.find((q) => Math.hypot(q.x - n.x, q.z - n.z) < 38);
        n.fleeing = !!np && nearest < (n.fleeing ? 46 : 30);
        if (h && t >= n.alertAt) { n.alertAt = t + 9000; this.broadcast({ t: 'A', id: n.id, x: r1(h.x), z: r1(h.z), nm: h.name }); }
        if (n.fleeing) away(np.x, np.z, sp.flee);
        else if (h && Math.hypot(h.x - n.x, h.z - n.z) < 22) away(h.x, h.z, sp.flee);
        else wander(sp.wander, n.hx, n.hz, 40);
      } else if (k === 'scav') {
        n.fleeing = !!np && nearest < (n.fleeing ? 22 : 13);
        if (n.fleeing) away(np.x, np.z, sp.flee); else wander(sp.wander, n.hx, n.hz, 25);
      } else if (k === 'healer') {
        let tg = null; for (const p of ps) if (!tg || p.hp < tg.hp - 8) tg = p;
        if (tg) { const dd = Math.hypot(tg.x - n.x, tg.z - n.z); if (dd > 3.5) toward(tg.x, tg.z, sp.speed); else { wander(1.2); } }
        for (const p of ps) if (p.hp < HP_MAX && Math.hypot(p.x - n.x, p.z - n.z) < 6) { p.hp = Math.min(HP_MAX, p.hp + sp.heal * dt); this.dirty = true; }
      }
      { // gerak: bebas ke mana saja (air, lembah, bukit) - satu-satunya batas: tidak masuk area harta karun. Menoleh & berlari naik-turun dengan halus.
        const a = spd > 0 ? Math.atan2(dz, dx) : null;
        if (a !== null) {
          if (n.hd === undefined || n.kind === 'ambush') n.hd = a;
          else { const df = angDiff(n.hd, a), tr = (n.kind === 'giant' ? 1.6 : 7) * dt; n.hd += Math.max(-tr, Math.min(tr, df)); }
        }
        const want = a === null ? 0 : spd;
        if (n.kind === 'ambush') n.cs = want;
        else { const acc = (want > n.cs ? 18 : 30) * dt; n.cs += Math.max(-acc, Math.min(acc, want - n.cs)); }
        if (n.cs < 0.05) n.cs = 0;
        let mx = 0, mz = 0;
        if (n.cs > 0 && n.hd !== undefined) {
          mx = Math.cos(n.hd) * n.cs * dt; mz = Math.sin(n.hd) * n.cs * dt;
          if (inZone(n.x + mx, n.z + mz) && !inZone(n.x, n.z)) {          // sampai di batas area harta karun: berhenti total (animasi diam), lalu menjauh / merumput
            mx = 0; mz = 0; n.cs = 0;
            n.wyaw = n.hd + Math.PI * (0.7 + this.rnd() * 0.6); n.wst = 'graze'; n.wanderT = t + 1500 + this.rnd() * 1500;
          }
        }
        n.x += mx; n.z += mz; n.vx = dt > 0 ? mx / dt : 0; n.vz = dt > 0 ? mz / dt : 0;
        if (n.cs > 0.4 && n.hd !== undefined) n.yaw = faceYaw(Math.cos(n.hd), Math.sin(n.hd));
      }
      if (n.atk >= 0) { n.atk += dt; if (n.atk > 0.35) n.atk = -1; }
      this.dirty = true;
    }
    // jangan bertumpuk: NPC yang terlalu dekat saling mendorong pelan (mencegah model menumpuk & berkedip, juga kawanan terlihat mengepung)
    const arr = [...this.npcs.values()], pushK = Math.min(1, dt * 7);
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const A = arr[i], B = arr[j];
      const minD = (STATS[A.char].scale + STATS[B.char].scale) * 0.55 + 0.5;
      let ex = B.x - A.x, ez = B.z - A.z, d = Math.hypot(ex, ez);
      if (d >= minD) continue;
      if (d < 0.01) { const ang = this.rnd() * Math.PI * 2; ex = Math.cos(ang); ez = Math.sin(ang); d = 0.01; }
      const push = (minD - d) * 0.5 * pushK, ux = ex / d, uz = ez / d;
      const aw = A.kind === 'giant' ? 0.2 : 1, bw = B.kind === 'giant' ? 0.2 : 1, tw = aw + bw;
      if (!inZone(A.x - ux * push * 2 * bw / tw, A.z - uz * push * 2 * bw / tw)) { A.x -= ux * push * 2 * bw / tw; A.z -= uz * push * 2 * bw / tw; }
      if (!inZone(B.x + ux * push * 2 * aw / tw, B.z + uz * push * 2 * aw / tw)) { B.x += ux * push * 2 * aw / tw; B.z += uz * push * 2 * aw / tw; }
    }
  }

  // siaran berkala: hanya jika ada perubahan (atau 1x per detik); tiap pemain hanya menerima pemain lain yang dekat
  tick() {
    const ts = this.now();
    this.stepNpcs(ts);
    if (this.pending.length) { const due = this.pending.filter((p) => p.at <= ts); if (due.length) { this.pending = this.pending.filter((p) => p.at > ts); for (const p of due) this.resolveSkill(p, ts); } }
    if (!this.dirty && ts - this.lastSnap < KEEPALIVE_MS) return;
    this.dirty = false; this.lastSnap = ts;
    const ps = [...this.players.values()].filter((p) => p.ready && p.alive);
    const everyone = [...ps, ...this.npcs.values()];
    const rdt = Math.min(1, (ts - (this.lastRegen || ts)) / 1000); this.lastRegen = ts;
    for (const p of ps) { if (p.alive && ts - (p.xpT || (p.xpT = ts)) >= 10000) { p.xpT = ts; this.gainXp(p, 3); } if (p.alive && ts - (p.goldT || (p.goldT = ts)) >= 5000) { p.goldT = ts; this.addGold(p, 3); } }     // bertahan hidup = XP perlahan
    for (const p of ps) if (p.hp < HP_MAX && ts - p.lastHurt > REGEN_DELAY) { p.hp = Math.min(HP_MAX, p.hp + (REGEN_RATE + p.mods.reg) * rdt); }
    for (const a of ps) {
      const list = [];
      for (const b of everyone) {
        if (b.id === a.id) continue;
        if (Math.hypot(b.x - a.x, b.z - a.z) > RADIUS) continue;
        list.push([b.id, r1(b.x), r1(b.y), r1(b.z), Math.round(b.yaw * 100) / 100, r1(b.vx), r1(b.vz), Math.round(b.atk * 100) / 100, b.sw, b.level, b.npc ? Math.round(100 * b.hp / b.maxHp) : Math.round(b.hp), b.kills]);
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
