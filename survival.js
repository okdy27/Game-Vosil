/* Vosil Survival - game survival 3D (Three.js), dunia luas terbentuk otomatis, tampilan horizontal.
 *
 * Kontrol:
 *   HP      : analog kiri = bergerak bebas ke segala arah
 *             tombol kanan = GIGIT (serang), LOMPAT, LARI (tahan)
 *   Komputer: WASD / panah = bergerak, Spasi = lompat, J / K = gigit, Shift = lari
 *
 * Inti permainan:
 *   - Lapar & haus turun terus. Makan buah di semak, minum di kolam, makan daging predator.
 *   - Predator mengejar (lebih banyak & lebih ganas saat malam). Lari, lompat, atau lawan.
 *   - Koin tersebar di dunia, ada telur langka yang memberi MODE KUAT sementara.
 *   - Dunia dibuat per potongan (chunk) dari seed acak, jadi tiap main berbeda dan tidak ada ujungnya.
 *
 * Titik sambung ke backend / smart contract: event "run:end" berisi { coins, days, kills, duration }.
 * JANGAN langsung percaya angka dari browser untuk klaim token (mudah dicurangi); validasi di backend.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const t = (k, v) => L.t(k, v);
  function showFatal(msg) {
    const box = $('fatal'), txt = $('fatalMsg');
    if (txt) txt.textContent = msg;
    if (box) box.style.display = 'flex';
  }

  if (typeof THREE === 'undefined') {
    showFatal(t('fatal_three'));
    return;
  }

  // ---------- Pengaturan ----------
  const CH = 30;                    // ukuran satu potongan dunia (meter)
  let VIEW = 2;                   // radius potongan yang dimuat (5 x 5 potongan)
  const DAY_LEN = 160;              // detik per hari
  const WALK = 6.8, SPRINT = 10.2;   // kecepatan (m/detik)
  const JUMP_V = 8.5, GRAVITY = 24;
  const HUNGER_RATE = 0.35;         // turun per detik (habis dalam ~4,7 menit)
  const THIRST_RATE = 0.5;          // turun per detik (habis dalam ~3,3 menit)
  const STARVE_DMG = 2.2;           // nyawa berkurang per detik jika lapar/haus habis
  const REGEN = 1.6;                // nyawa pulih per detik jika kenyang & tidak diserang
  const COIN_DENSITY = 0.5, KILL_REWARD_MUL = 0.5;   // poin dibuat lebih langka: koin di tanah separuh, hadiah bunuh separuh
  const BUSH_REGROW = 90;           // detik sampai buah tumbuh lagi
  const POWER_TIME = 10;            // detik mode kuat
  const SAVE_KEY = 'vosil_survival_save_v1';
  const FRUIT_HUNGER = 22, WATER_RATE = 32;

  // ---------- Elemen halaman ----------
  const canvas = $('game');
  const hudEl = $('hud'), menuEl = $('menu'), overEl = $('over');
  const fHp = $('fHp'), fHunger = $('fHunger'), fThirst = $('fThirst'), fStam = $('fStam');
  const rowHunger = $('rowHunger'), rowThirst = $('rowThirst');
  const elCoins = $('runCoins'), elDay = $('dayNo'), elTime = $('timeIcon');
  const toastEl = $('toast'), hurtEl = $('hurt');
  const powerEl = $('power'), powerFill = $('powerFill');
  const coinBox = $('coinBox'), lvNo = $('lvNo'), xpFill = $('xpFill'), lvFlash = $('lvFlash'), rotBtn = $('rotBtn');
  const camZone = $('camZone'), charRow = $('charRow'), charInfo = $('charInfo'), charRow2 = $('charRow2'), charInfo2 = $('charInfo2');
  const stickZone = $('stickZone'), stickBase = $('stickBase'), stickKnob = $('stickKnob');
  const btnAttack = $('btnAttack'), btnJump = $('btnJump'), btnSprint = $('btnSprint'), fsBtn = $('fsBtn'), btnRoar = $('btnRoar');

  // ---------- Penyimpanan lokal ----------
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && typeof s.coins === 'number') return Object.assign({ bestDays: 0, kills: 0, runs: 0, seen: {}, kv: {}, tro: {}, pts: 0, ptsTotal: 0, char: 'vosil', q: 'mid' }, s);
    } catch (e) { /* abaikan */ }
    return { coins: 0, bestDays: 0, kills: 0, runs: 0, seen: {}, kv: {}, tro: {}, pts: 0, ptsTotal: 0, char: 'vosil', q: 'mid' };
  }
  const save = loadSave();
  if (!save.seen || typeof save.seen !== 'object') save.seen = {};
  if (!save.kv || typeof save.kv !== 'object') save.kv = {};
  if (!save.tro || typeof save.tro !== 'object') save.tro = {};
  if (typeof save.pts !== 'number') save.pts = 0;
  if (typeof save.ptsTotal !== 'number') save.ptsTotal = 0;
  function writeSave() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* abaikan */ }
  }
  window.addEventListener('pagehide', writeSave);

  // ---------- Bantuan umum ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const angDiff = (a, b) => ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  const lerpAngle = (a, b, t) => a + angDiff(a, b) * t;
  const faceYaw = (dx, dz) => Math.atan2(-dx, -dz);   // model menghadap -Z

  // pembangkit acak yang bisa diulang (supaya potongan dunia selalu sama untuk seed yang sama)
  function hash(a, b, seed) {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let worldSeed = 1;
  function vnoise(x, y, salt) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const r = (i, j) => hash(i, j, worldSeed + salt) / 4294967295;
    return lerp(lerp(r(xi, yi), r(xi + 1, yi), u), lerp(r(xi, yi + 1), r(xi + 1, yi + 1), u), v);
  }

  // ---------- Renderer, scene, kamera ----------
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (e1) {
    try {                                   // coba lagi dengan pengaturan paling ringan
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
    } catch (e2) {
      showFatal(t('fatal_webgl'));
      return;
    }
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fd8f5);
  scene.fog = new THREE.Fog(0x9fd8f5, 26, 68);

  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 130);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x7a9a5a, 0.9);
  scene.add(hemi);
  const sunLight = new THREE.DirectionalLight(0xfff0d2, 0.8);
  sunLight.position.set(-8, 14, 6);
  scene.add(sunLight);

  function resize() {
    const w = window.innerWidth || 800, h = window.innerHeight || 400;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = h > w ? 70 : 52;       // layar sempit-tinggi dibuat lebih lebar pandangannya
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();

  // ---------- Bahan ----------
  // gaya kartun: pencahayaan bertingkat (3-4 nada) seperti game anime
  let toonMap = null;
  try {
    toonMap = new THREE.DataTexture(new Uint8Array([105, 165, 215, 255]), 4, 1, THREE.LuminanceFormat);
    toonMap.minFilter = toonMap.magFilter = THREE.NearestFilter;
    toonMap.generateMipmaps = false;
    toonMap.needsUpdate = true;
  } catch (e) { toonMap = null; }
  const std = (color, extra) => {
    const o = Object.assign({ color }, extra || {});
    delete o.metalness; delete o.roughness; delete o.flatShading;
    if (toonMap) o.gradientMap = toonMap;
    return new THREE.MeshToonMaterial(o);
  };

  const rbox = (a, b, c) => new THREE.SphereGeometry(0.5, 10, 8).scale(a, b, c);      // "kotak" yang dibulatkan
  const smoothStd = (color, extra) => std(color, Object.assign({ flatShading: false }, extra || {}));

  // Gabungkan mesh-mesh statis di dalam satu grup (yang bahannya sama) menjadi satu mesh,
  // supaya jumlah "draw call" kecil dan HP tetap lancar. Gerak sendi tidak terpengaruh karena
  // setiap grup yang bergerak (kaki, rahang, ekor, dst.) digabung terpisah.
  function mergeTree(g) {
    const kids = g.children;
    if (!Array.isArray(kids)) return;
    for (const k of kids.slice()) if (!k.geometry && Array.isArray(k.children)) mergeTree(k);
    const byMat = new Map();
    for (const k of kids.slice()) {
      const geo = k.geometry;
      if (!geo || !geo.attributes || !geo.attributes.position || !geo.attributes.normal) continue;
      if (Array.isArray(k.children) && k.children.length) continue;
      if (!byMat.has(k.material)) byMat.set(k.material, []);
      byMat.get(k.material).push(k);
    }
    byMat.forEach((list, mat) => {
      if (list.length < 2) return;
      let nv = 0, ni = 0;
      for (const m of list) {
        const gm = m.geometry;
        nv += gm.attributes.position.array.length / 3;
        ni += gm.index ? gm.index.array.length : gm.attributes.position.array.length / 3;
      }
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
      const idx = nv < 65535 ? new Uint16Array(ni) : new Uint32Array(ni);
      let vo = 0, io = 0;
      for (const m of list) {
        const gm = m.geometry, pa = gm.attributes.position.array, na = gm.attributes.normal.array;
        const sx = m.scale.x, sy = m.scale.y, sz = m.scale.z;
        const A = Math.cos(m.rotation.x), B = Math.sin(m.rotation.x), C = Math.cos(m.rotation.y), D = Math.sin(m.rotation.y);
        const E = Math.cos(m.rotation.z), F = Math.sin(m.rotation.z);
        const AE = A * E, AF = A * F, BE = B * E, BF = B * F;
        const r00 = C * E, r01 = -C * F, r02 = D, r10 = AF + BE * D, r11 = AE - BF * D, r12 = -B * C, r20 = BF - AE * D, r21 = BE + AF * D, r22 = A * C;
        const n = pa.length / 3;
        for (let i = 0; i < n; i++) {
          const x = pa[i * 3] * sx, y = pa[i * 3 + 1] * sy, z = pa[i * 3 + 2] * sz;
          const o = (vo + i) * 3;
          pos[o] = r00 * x + r01 * y + r02 * z + m.position.x;
          pos[o + 1] = r10 * x + r11 * y + r12 * z + m.position.y;
          pos[o + 2] = r20 * x + r21 * y + r22 * z + m.position.z;
          const nx = na[i * 3] / sx, ny = na[i * 3 + 1] / sy, nz = na[i * 3 + 2] / sz;
          let qx = r00 * nx + r01 * ny + r02 * nz, qy = r10 * nx + r11 * ny + r12 * nz, qz = r20 * nx + r21 * ny + r22 * nz;
          const l = Math.hypot(qx, qy, qz) || 1;
          nor[o] = qx / l; nor[o + 1] = qy / l; nor[o + 2] = qz / l;
        }
        if (gm.index) { const ia = gm.index.array; for (let i = 0; i < ia.length; i++) idx[io++] = ia[i] + vo; }
        else for (let i = 0; i < n; i++) idx[io++] = vo + i;
        vo += n;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      for (const m of list) g.remove(m);
      g.add(new THREE.Mesh(geo, mat));
    });
  }

  // ---------- Bioma ----------
  const BIOMES = {
    plain: { id: 'plain', get name() { return t('biome.plain'); }, color: 0x7bbf52, patch: 0x6dae47, tree: 1, cycad: 0.5, rock: 1, bush: 1.1, pond: 0.2, cactus: 0, coin: 1.1 },
    forest: { id: 'forest', get name() { return t('biome.forest'); }, color: 0x4a9440, patch: 0x3e8537, tree: 4, cycad: 1.2, rock: 0.8, bush: 1.3, pond: 0.3, cactus: 0, coin: 1.0 },
    desert: { id: 'desert', get name() { return t('biome.desert'); }, color: 0xd9b46a, patch: 0xc9a25a, tree: 0, cycad: 0, rock: 3, bush: 0.35, pond: 0.08, cactus: 2.2, coin: 1.7 },
    swamp: { id: 'swamp', get name() { return t('biome.swamp'); }, color: 0x5d7a3a, patch: 0x516b32, tree: 2, cycad: 2, rock: 0.8, bush: 0.9, pond: 0.55, cactus: 0, coin: 1.4 }
  };
  for (const b of Object.values(BIOMES)) {
    b.mat = new THREE.MeshLambertMaterial({ color: b.color });
    b.patchMat = new THREE.MeshLambertMaterial({ color: b.patch });
  }

  function biomeAt(x, z) {
    if (Math.hypot(x, z) < 90) return BIOMES.plain;           // area awal selalu ramah
    const n1 = 0.65 * vnoise(x / 200, z / 200, 11) + 0.35 * vnoise(x / 70, z / 70, 23);
    const n2 = vnoise(x / 150 + 40, z / 150 + 40, 37);
    if (n1 < 0.38) return BIOMES.desert;
    if (n1 > 0.62) return BIOMES.forest;
    if (n2 > 0.66) return BIOMES.swamp;
    return BIOMES.plain;
  }

  // ---------- Medan: bukit dan lembah ----------
  const SEG = 15, CELL = CH / SEG;
  const pondCache = new Map();
  function rawHeight(x, z) {
    const big = (vnoise(x / 66, z / 66, 71) - 0.5) * 12.5;       // bukit dan lembah besar
    const mid = (vnoise(x / 26, z / 26, 72) - 0.5) * 2.8;      // gelombang kecil
    const dist = Math.hypot(x, z);
    const mesa = smooth(0.50, 0.62, vnoise(x / 80, z / 80, 93)) * 4.8 * smooth(30, 65, dist);   // dataran tinggi bertebing
    return (big + mid) * smooth(12, 70, dist) + mesa;         // sekitar titik awal tetap landai
  }
  // permukaan air sungai & danau (tetap di satu ketinggian); sungai mengikis tanah di sepanjang jalurnya
  const WL = -4.2;
  function riverT(x, z) {
    const rv = Math.abs(vnoise(x / 120, z / 120, 91) - 0.5);
    return (1 - smooth(0.008, 0.11, rv)) * smooth(25, 55, Math.hypot(x, z));
  }
  function pondOf(cx, cz) {                                     // satu kolam per potongan (paling banyak), tetap sama setiap dipanggil
    const key = cx + ',' + cz;
    if (pondCache.has(key)) return pondCache.get(key);
    const rng = mulberry(hash(cx, cz, worldSeed + 555));
    const biome = biomeAt(cx * CH + CH / 2, cz * CH + CH / 2);
    let p = null;
    if ((cx === 0 && cz === -1) || rng() < biome.pond) {       // potongan (0,-1): selalu ada kolam dekat awal
      const r = 3 + rng() * 2;
      const x = cx * CH + 11 + rng() * (CH - 22), z = cz * CH + 11 + rng() * (CH - 22);
      const b0 = rawHeight(x, z);
      const guaranteed = cx === 0 && cz === -1;                 // kolam awal selalu ada
      let rough = !guaranteed && (riverT(x, z) > 0 || b0 < WL + 1.2);
      for (let k = 0; k < 4 && !rough && !guaranteed; k++) {                   // kolam hanya di tanah yang cukup rata
        const ax = x + Math.cos(k * 1.571) * 9, az = z + Math.sin(k * 1.571) * 9;
        if (Math.abs(rawHeight(ax, az) - b0) > 1.4 || riverT(ax, az) > 0) rough = true;
      }
      if (!rough) p = { x, z, r, base: b0 - 0.3 };
    }
    if (p && zoneNear(p.x, p.z, 12)) p = null;                  // tidak ada kolam di area tantangan
    pondCache.set(key, p);
    return p;
  }

  // ---------- Area Tantangan Lompat: jurang + batu pijakan + pulau harta ----------
  // Zona berbentuk lingkaran: tepi rata -> jurang (tidak mati, hanya dikembalikan ke tepi) -> pulau harta di tengah.
  // Hanya bisa dicapai dengan melompati deretan batu pijakan (spiral). Di pulau ada peti, koin, dan pintu kembali ke titik awal.
  const ZC = 340, ZR = 62, Z_RIM = 34, Z_ISL = 11.5;
  const zoneCache = new Map();
  function buildZone(ix, iz) {
    const rng = mulberry(hash(ix, iz, worldSeed + 777));
    const first = ix === 0 && iz === 0;                              // satu zona selalu ada ~90 m dari titik awal
    if (!first && rng() > 0.4) return null;
    let cx, cz;
    if (first) { const a = rng() * 6.2832, d = 85 + rng() * 15; cx = Math.cos(a) * d; cz = Math.sin(a) * d; }
    else { cx = ix * ZC + (rng() - 0.5) * 200; cz = iz * ZC + (rng() - 0.5) * 200; }
    const h0 = Math.max(rawHeight(cx, cz), WL + 6);
    const floor = Math.min(h0 - 14, WL - 3);
    const a0 = first ? Math.atan2(-cz, -cx) : rng() * 6.2832;         // pintu masuk menghadap titik awal
    const dir = rng() < 0.5 ? 1 : -1;
    // lompatan awal dibuat mudah (batu besar, jarak dekat, beda tinggi kecil); lompatan terakhir ke pulau harus presisi
    const offs = [0.2, 0.5, 0.3, 0.6, 0.4, 0.7, 0.5], rads = [2.7, 2.7, 2.5, 2.4, 2.2, 2.0, 1.7], gaps = [1.5, 1.6, 1.8, 2.0, 2.2, 2.4];
    const rEnd = 14.0, n = offs.length;
    const pillars = [];
    let r = 29.2, a = a0;
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        const rn = 29.2 + (rEnd - 29.2) * i / (n - 1), sp = rads[i - 1] + rads[i] + gaps[i - 1];
        const c = Math.max(-1, Math.min(1, (r * r + rn * rn - sp * sp) / (2 * r * rn)));
        a += dir * Math.acos(c); r = rn;
      }
      pillars.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, r: rads[i], top: h0 + offs[i] });
    }
    return { id: ix + ':' + iz, cx, cz, h0, floor, isl: h0 + 1.2, a0, pillars, entry: { x: cx + Math.cos(a0) * 38, z: cz + Math.sin(a0) * 38 } };
  }
  let zonesOff = false;                                           // (dipakai tes otomatis)
  function zoneCell(ix, iz) {
    if (zonesOff) return null;
    const key = ix + ',' + iz;
    if (zoneCache.has(key)) return zoneCache.get(key);
    const z = buildZone(ix, iz);
    zoneCache.set(key, z);
    return z;
  }
  let zcIx = 1e9, zcIz = 1e9, zcVal = null;                        // cache sel terakhir (heightAt dipanggil ribuan kali per frame)
  function zoneReset() { zoneCache.clear(); zcIx = 1e9; zcVal = null; }
  function zoneNear(x, z, margin) {
    const zix = Math.floor((x + ZC / 2) / ZC), ziz = Math.floor((z + ZC / 2) / ZC);
    if (zix !== zcIx || ziz !== zcIz) { zcIx = zix; zcIz = ziz; zcVal = zoneCell(zix, ziz); }
    const Zn = zcVal;
    if (!Zn) return null;
    const dx = x - Zn.cx, dz = z - Zn.cz, rr = ZR + (margin || 0);
    return dx * dx + dz * dz < rr * rr ? Zn : null;
  }
  function zoneHeight(Zn, d) {
    const mask = smooth(Z_ISL - 1, Z_ISL + 1, d) * (1 - smooth(Z_RIM - 2.5, Z_RIM, d));
    return lerp(d < 22 ? Zn.isl : Zn.h0, Zn.floor, mask);
  }
  const inChasm = (x, z) => { const Zn = zoneNear(x, z); if (!Zn) return false; const d = Math.hypot(x - Zn.cx, z - Zn.cz); return d > Z_ISL - 1.5 && d < Z_RIM - 0.5; };
  // tinggi pijakan: tanah, atau puncak batu pijakan bila kaki cukup tinggi (bisa berdiri di atas batu)
  function supportAt(x, z, feet) {
    let g = heightAt(x, z);
    const Zn = zoneNear(x, z);
    if (Zn) for (const p of Zn.pillars) {
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz < p.r * p.r && feet >= p.top - 0.45 && p.top > g) g = p.top;
    }
    return g;
  }

  function heightAt(x, z) {
    let h = rawHeight(x, z);
    const rt = riverT(x, z);
    if (rt > 0) h = lerp(h, Math.min(h, Math.max(WL - 0.8, h - 7)), rt);   // alur sungai (di dataran tinggi: jurang kering sedalam 7 m)
    const p = pondOf(Math.floor(x / CH), Math.floor(z / CH));
    if (p) {                                                    // kolam berada di cekungan datar
      const d = Math.hypot(x - p.x, z - p.z);
      h = lerp(h, p.base, 1 - smooth(p.r + 1, p.r + 6, d));
      h -= 0.5 * (1 - smooth(p.r - 0.5, p.r + 1.5, d));
    }
    const Zn = zoneNear(x, z);
    if (Zn) { const d = Math.hypot(x - Zn.cx, z - Zn.cz); h = lerp(h, zoneHeight(Zn, d), 1 - smooth(40, ZR, d)); }
    return h;
  }
  const mGround = new THREE.MeshLambertMaterial({ vertexColors: true });
  for (const b of Object.values(BIOMES)) b.col = new THREE.Color(b.color);
  function buildGround(ox, oz) {
    const n = SEG + 1, m = n + 2;
    const H = new Float32Array(m * m);                          // tinggi dengan satu lapis tepi untuk normal yang mulus antar potongan
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) H[j * m + i] = heightAt(ox + (i - 1) * CELL, oz + (j - 1) * CELL);
    const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = ox + i * CELL, z = oz + j * CELL, k = (j * n + i) * 3, q = (j + 1) * m + (i + 1);
        const h = H[q];
        pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
        const nx = H[q - 1] - H[q + 1], nz = H[q - m] - H[q + m], ny = 2 * CELL;
        const l = Math.hypot(nx, ny, nz);
        nor[k] = nx / l; nor[k + 1] = ny / l; nor[k + 2] = nz / l;
        const bc = biomeAt(x, z).col;
        const v = (0.86 + 0.2 * vnoise(x / 5, z / 5, 9) + 0.1 * (vnoise(x / 17, z / 17, 13) - 0.5)) * Math.min(1.14, Math.max(0.72, 0.93 + h * 0.03));
        let cr = bc.r * v, cg = bc.g * v, cb = bc.b * v;
        const steep = smooth(0.07, 0.3, 1 - nor[k + 1]) * 0.65;          // lereng curam: tanah/batu terbuka, lembah: lebih gelap & lembap
        cr += (0.5 * v - cr) * steep; cg += (0.42 * v - cg) * steep; cb += (0.32 * v - cb) * steep;
        const rock = smooth(0.22, 0.4, 1 - nor[k + 1]) * 0.8;            // dinding tebing: batu abu-abu
        cr += (0.56 * v - cr) * rock; cg += (0.54 * v - cg) * rock; cb += (0.5 * v - cb) * rock;
        const shore = smooth(WL + 1.3, WL + 0.15, h), bed = smooth(WL, WL - 1.2, h);   // tepi air berpasir, dasar berlumpur
        cr += (0.74 * v - cr) * shore * 0.85; cg += (0.66 * v - cg) * shore * 0.85; cb += (0.46 * v - cb) * shore * 0.85;
        cr *= 1 - bed * 0.45; cg *= 1 - bed * 0.4; cb *= 1 - bed * 0.35;
        const damp = smooth(-1.5, -5, h) * 0.25 * (1 - shore);
        cr *= 1 - damp; cg *= 1 - damp * 0.6; cb *= 1 - damp * 0.8;
        col[k] = Math.min(1, cr); col[k + 1] = Math.min(1, cg); col[k + 2] = Math.min(1, cb);
      }
    }
    const idx = [];
    for (let j = 0; j < SEG; j++) {
      for (let i = 0; i < SEG; i++) {
        const a = j * n + i, b = (j + 1) * n + i, c = a + 1, d = b + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
    return geo;
  }

  // ---------- Bentuk bersama untuk isi dunia ----------
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.26, 1.3, 6);
  const coneA = new THREE.ConeGeometry(1.15, 2.1, 7);
  const coneB = new THREE.ConeGeometry(0.8, 1.6, 7);
  const rockGeo = new THREE.DodecahedronGeometry(0.7, 0);
  const stemGeo = new THREE.CylinderGeometry(0.2, 0.3, 1.0, 6);
  const bladeGeo = new THREE.ConeGeometry(0.16, 2.0, 4);
  const cactusGeo = new THREE.CylinderGeometry(0.28, 0.32, 2.0, 7);
  const armGeo = new THREE.CylinderGeometry(0.16, 0.18, 0.8, 6);
  const bushGeo = new THREE.SphereGeometry(0.75, 8, 6);
  const berryGeo = new THREE.SphereGeometry(0.13, 6, 5);
  const coinGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.12, 12);
  coinGeo.rotateX(Math.PI / 2);
  const coinInGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.14, 10);
  coinInGeo.rotateX(Math.PI / 2);
  const pondGeo = new THREE.CircleGeometry(1, 20);
  const riverGeo = new THREE.PlaneGeometry(CH, CH); riverGeo.rotateX(-Math.PI / 2);
  const eggGeo = new THREE.SphereGeometry(0.42, 12, 10);
  const spotGeo = new THREE.SphereGeometry(0.09, 6, 6);
  const ringGeo = new THREE.TorusGeometry(0.62, 0.045, 6, 24);
  const sphereGeo = new THREE.SphereGeometry(1, 8, 6);            // kanopi pohon rindang (diskalakan)
  const palmFrondGeo = new THREE.ConeGeometry(0.22, 2.4, 4);
  const branchGeo = new THREE.CylinderGeometry(0.05, 0.09, 1.0, 5);
  const tuftGeo = new THREE.ConeGeometry(0.3, 0.8, 5);

  const mTrunk = std(0x8d6e63), mLeafA = std(0x2e9e4f), mLeafB = std(0x3cb85e);
  const mRock = std(0x9e9e9e), mRockDry = std(0xb9a58a);
  const mFern1 = std(0x3f9b3f), mFern2 = std(0x5bb347);
  const mCactus = std(0x4f9a52), mBush = std(0x2f8f46);
  const mBerry = std(0xd32f2f, { emissive: 0x330000 });
  const mCoin = std(0xffc107, { metalness: 0.5, roughness: 0.35, emissive: 0x6b4a00 });
  const mCoinIn = std(0xffe082, { emissive: 0x4a3600 });
  const mPond = new THREE.MeshBasicMaterial({ color: 0x3fa7e0, transparent: true, opacity: 0.92 });
  // tekstur air yang bisa diulang mulus: pola gelombang gelap-terang (untuk dasar) dan kilau cahaya (untuk lapisan atas)
  function wrapCanvasTex(size, draw, rep) {
    try {
      const cv = document.createElement('canvas'); cv.width = cv.height = size;
      const c = cv.getContext('2d'); draw(c, size);
      const tx = new THREE.CanvasTexture(cv);
      tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(rep, rep);
      return tx;
    } catch (e) { return null; }
  }
  const waveTex = wrapCanvasTex(128, (c, S) => {
    c.fillStyle = '#d8ecff'; c.fillRect(0, 0, S, S);
    let sd = 7; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 46; i++) {
      const x = rnd() * S, y = rnd() * S, w = 14 + rnd() * 30, h = 2 + rnd() * 4, dark = rnd() < 0.5;
      c.fillStyle = dark ? 'rgba(90,150,200,0.34)' : 'rgba(255,255,255,0.5)';
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { c.beginPath(); c.ellipse(x + ox, y + oy, w, h, 0, 0, Math.PI * 2); c.fill(); }
    }
  }, 3);
  const glintTex = wrapCanvasTex(128, (c, S) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, S, S);
    let sd = 11; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 60; i++) {
      const x = rnd() * S, y = rnd() * S, w = 2 + rnd() * 7, a = 0.35 + rnd() * 0.65;
      c.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')';
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { c.beginPath(); c.ellipse(x + ox, y + oy, w, 1.2, 0, 0, Math.PI * 2); c.fill(); }
    }
  }, 4);
  if (waveTex) { mPond.map = waveTex; mPond.needsUpdate = true; }
  const mGlint = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending });
  if (glintTex) { mGlint.map = glintTex; mGlint.needsUpdate = true; }
  // bayangan lembut: mengikuti arah matahari (cahaya dari kiri-atas-belakang -> bayangan jatuh ke kanan-depan)
  const mShadow = new THREE.MeshBasicMaterial({ color: 0x0a1a12, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
  mShadow.polygonOffset = true; mShadow.polygonOffsetFactor = -2; mShadow.polygonOffsetUnits = -2;
  const SUN_L = Math.hypot(8, 6), SUN_DX = 8 / SUN_L, SUN_DZ = -6 / SUN_L, SUN_PHI = Math.atan2(-SUN_DZ, SUN_DX);
  const shadowDisc = new THREE.CircleGeometry(1, 16);
  // bayangan lembut: tekstur gradasi radial supaya tepinya halus
  try {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const cx2 = cv.getContext('2d'), gr = cx2.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.62, 'rgba(0,0,0,0.92)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    cx2.fillStyle = gr; cx2.fillRect(0, 0, 64, 64);
    mShadow.map = new THREE.CanvasTexture(cv);
    mShadow.needsUpdate = true;
  } catch (e) { /* tanpa tekstur: bayangan tegas biasa */ }
  // garis tepi hitam tipis: salinan bentuk yang digelembungkan sepanjang normal dan hanya sisi belakangnya digambar
  const mOutline = new THREE.MeshBasicMaterial({ color: 0x211a14, side: THREE.BackSide });
  mOutline.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + normalize(normal) * 0.011;');
  };
  function outlineTree(root) {
    try {
      if (!root || typeof root.traverse !== 'function') return;
      const list = [];
      root.traverse((o) => { if (o.geometry && o.material !== mOutline && o.parent) list.push(o); });
      for (const o of list) {
        const ol = new THREE.Mesh(o.geometry, mOutline);
        ol.position.copy(o.position); ol.rotation.copy(o.rotation); ol.scale.copy(o.scale);
        o.parent.add(ol);
      }
    } catch (e) { /* tanpa garis tepi */ }
  }
  const QUAL = {
    // Rendah: untuk HP RAM 4 GB (resolusi lebih kecil, tanpa outline, area dimuat 3x3, kabut dekat, dekorasi & dino lebih sedikit)
    low: { pr: 0.8, ol: false, fx: 0.35, view: 1, fog: 0.45, dens: 0.55, preds: 0.6, name: 'Rendah' },
    mid: { pr: 1.25, ol: true, fx: 1, view: 2, fog: 1, dens: 1, preds: 1, name: 'Sedang' },
    high: { pr: 1.75, ol: true, fx: 1.6, view: 2, fog: 1, dens: 1, preds: 1, name: 'Tinggi' },
  };
  const qName = (k) => t('q_' + (QUAL[k] ? k : 'mid'));
  let fxMul = 1, fogMul = 1, densMul = 1, predMul = 1;
  function applyQuality() {
    const q = QUAL[save.q] || QUAL.mid;
    fxMul = q.fx; fogMul = q.fog; densMul = q.dens; predMul = q.preds; VIEW = q.view;
    mOutline.visible = q.ol;
    try { applyDayNight(); } catch (e) { /* belum siap */ }
    try { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr)); resize(); } catch (e) { /* abaikan */ }
  }
  // bayangan dinamis (dino): elips yang memanjang searah bayangan, ditaruh di tanah
  // bayangan dinamis yang menempel ke kontur tanah (tiap titiknya mengikuti tinggi tanah, jadi tidak patah di tebing/lereng)
  function makeDynShadow() {
    try {
      const g = new THREE.CircleGeometry(1, 14);
      const pa = g.attributes.position.array, n = pa.length / 3, u = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { u[i * 2] = pa[i * 3]; u[i * 2 + 1] = pa[i * 3 + 1]; }
      const m = new THREE.Mesh(g, mShadow);
      m.userData.unit = u; m.frustumCulled = false;
      return m;
    } catch (e) { return new THREE.Mesh(shadowDisc, mShadow); }
  }
  let shadowFlat = null;                               // bayangan di atas batu pijakan: rata, tidak mengikuti dasar jurang
  function placeShadow(mesh, x, z, gy, r, h) {
    const L = h * 0.35, u = mesh.userData.unit;
    if (!u) {
      mesh.position.set(x + SUN_DX * L, gy + 0.1, z + SUN_DZ * L);
      mesh.rotation.set(-Math.PI / 2, 0, SUN_PHI);
      mesh.scale.set(r + L, r, 1);
      return;
    }
    const a = r + L, cx = x + SUN_DX * L, cz = z + SUN_DZ * L, pa = mesh.geometry.attributes.position.array;
    for (let i = 0, n = u.length / 2; i < n; i++) {
      const uu = u[i * 2] * a, vv = -u[i * 2 + 1] * r;
      const wx = cx + uu * SUN_DX - vv * SUN_DZ, wz = cz + uu * SUN_DZ + vv * SUN_DX;
      pa[i * 3] = wx; pa[i * 3 + 1] = (shadowFlat !== null ? shadowFlat : heightAt(wx, wz)) + 0.1; pa[i * 3 + 2] = wz;
    }
    mesh.geometry.attributes.position.needsUpdate = true;
  }
  // bayangan statis satu potongan peta: semua bayangan digabung jadi satu bentuk yang menempel ke kontur tanah
  function buildShadows(list) {
    const N = 10, per = N + 1;
    const pos = new Float32Array(list.length * per * 3);
    const idx = [];
    const uv = new Float32Array(list.length * per * 2);
    list.forEach((e, k) => {
      const x = e[0], z = e[1], r = e[2], L = e[3] * 0.35, a = r + L, base = k * per;
      uv[base * 2] = 0.5; uv[base * 2 + 1] = 0.5;
      for (let i = 0; i < N; i++) {
        uv[(base + 1 + i) * 2] = 0.5 + 0.5 * Math.cos((i / N) * Math.PI * 2);
        uv[(base + 1 + i) * 2 + 1] = 0.5 + 0.5 * Math.sin((i / N) * Math.PI * 2);
      }
      const cx = x + SUN_DX * L, cz = z + SUN_DZ * L;
      let o = base * 3;
      pos[o] = cx; pos[o + 1] = heightAt(cx, cz) + 0.12; pos[o + 2] = cz;
      for (let i = 0; i < N; i++) {
        const th = (i / N) * Math.PI * 2, ux = Math.cos(th) * a, uz = Math.sin(th) * r;
        const vx = cx + ux * SUN_DX - uz * SUN_DZ, vz = cz + ux * SUN_DZ + uz * SUN_DX;
        o = (base + 1 + i) * 3;
        pos[o] = vx; pos[o + 1] = heightAt(vx, vz) + 0.12; pos[o + 2] = vz;
        idx.push(base, base + 1 + i, base + 1 + ((i + 1) % N));
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
    return geo;
  }
  const mLush = std(0x3f9d3a);
  // bentuk "berbenjol": titik yang sama selalu bergeser sama (hash posisi) sehingga tidak retak
  function lumpy(geo, amt) {
    try {
      const p = geo.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) {
        const k = Math.sin(Math.round(p[i] * 40) * 12.9898 + Math.round(p[i + 1] * 40) * 78.233 + Math.round(p[i + 2] * 40) * 37.719) * 43758.5453;
        const f = 1 + ((k - Math.floor(k)) - 0.5) * amt;
        p[i] *= f; p[i + 1] *= f; p[i + 2] *= f;
      }
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals();
    } catch (e) { /* tanpa efek bila tidak didukung */ }
    return geo;
  }
  const rockVars = [0.5, 0.42, 0.55].map((a, i) => lumpy(new THREE.IcosahedronGeometry(0.7, 1), a + i * 0.02));
  const blobVars = [0.35, 0.3].map((a) => lumpy(new THREE.IcosahedronGeometry(1, 1), a));
  const padGeo = new THREE.CircleGeometry(0.34, 10);
  const pebbleGeo = lumpy(new THREE.IcosahedronGeometry(0.16, 0), 0.4);
  const cattailGeo = new THREE.CylinderGeometry(0.035, 0.05, 1.3, 4);
  const cattailTop = new THREE.CylinderGeometry(0.07, 0.07, 0.32, 5);
  const mMoss = std(0x5f8f3f), mMud = new THREE.MeshBasicMaterial({ color: 0x6b5a3c }), mPebble = std(0x8a8d90), mPad = std(0x3d8f3a, { emissive: 0x0a2a0a }), mCat = std(0x7a4b2a);
  const mDeep = new THREE.MeshBasicMaterial({ color: 0x1f6fae, transparent: true, opacity: 0.55, depthWrite: false });
  const mRipple = new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.35, depthWrite: false });
  const ringThin = new THREE.RingGeometry(0.94, 1, 28);
  const mEgg = std(0xfff3d6, { emissive: 0x3a2a10 });
  const mSpot = std(0x6aa84f);
  const mRing = new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.85, depthWrite: false });
  const LEAFS = [0x2e9e4f, 0x3cb85e, 0x1f7a3a, 0x7cb342, 0xa5c13a].map((c) => std(c));   // variasi warna daun
  const mDeadWood = std(0x6d5a4a), mPalmTrunk = std(0x9c7a4d), mFrond = std(0x43a047), mFrond2 = std(0x66bb6a);
  const mTuft = { plain: std(0x5fa83c), forest: std(0x2f7d32), desert: std(0xc2a85e), swamp: std(0x6b8e3a) };

  // jenis pohon: 'pine' (runcing), 'broad' (rindang), 'palm' (palem), 'dead' (pohon mati); v = variasi warna
  function makeTree(s, kind, v) {
    const g = new THREE.Group();
    const leaf = LEAFS[(v || 0) % LEAFS.length], leaf2 = LEAFS[((v || 0) + 1) % LEAFS.length];
    if (kind === 'broad') {
      const t = new THREE.Mesh(trunkGeo, mTrunk); t.position.y = 0.65; t.scale.set(1.4, 1.2, 1.4); g.add(t);
      const bl = blobVars[(v || 0) % 2];
      const fl = new THREE.Mesh(trunkGeo, mTrunk); fl.position.y = 0.12; fl.scale.set(2.2, 0.25, 2.2); g.add(fl);   // pangkal akar melebar
      const br = new THREE.Mesh(branchGeo, mTrunk); br.position.set(0.35, 1.7, 0.1); br.rotation.z = -0.7; br.scale.set(1.4, 1.2, 1.4); g.add(br);
      const c1 = new THREE.Mesh(bl, leaf); c1.position.set(0, 2.7, 0); c1.scale.set(1.5, 1.2, 1.5); g.add(c1);
      const c2 = new THREE.Mesh(bl, leaf2); c2.position.set(0.9, 2.15, 0.3); c2.scale.set(1.0, 0.85, 1.0); g.add(c2);
      const c3 = new THREE.Mesh(bl, leaf2); c3.position.set(-0.8, 2.25, -0.3); c3.scale.set(0.95, 0.8, 0.95); g.add(c3);
      const c4 = new THREE.Mesh(bl, leaf); c4.position.set(0.1, 3.3, -0.25); c4.scale.set(0.9, 0.75, 0.9); g.add(c4);
    } else if (kind === 'dead') {
      const t = new THREE.Mesh(trunkGeo, mDeadWood); t.position.y = 0.9; t.scale.set(0.9, 1.8, 0.9); g.add(t);
      for (const sx of [-1, 1]) {
        const b = new THREE.Mesh(branchGeo, mDeadWood);
        b.position.set(sx * 0.4, 2.0 + (sx > 0 ? 0.25 : -0.1), 0);
        b.rotation.z = -sx * 0.9;
        b.scale.set(1, 1.4, 1);
        g.add(b);
      }
    } else if (kind === 'palm') {
      const t = new THREE.Mesh(trunkGeo, mPalmTrunk); t.position.set(0.15, 1.5, 0); t.rotation.z = -0.12; t.scale.set(0.8, 2.2, 0.8); g.add(t);
      const top = new THREE.Group(); top.position.set(0.3, 3.0, 0); g.add(top);
      for (let i = 0; i < 6; i++) {
        const pv = new THREE.Group(); pv.rotation.y = (i / 6) * Math.PI * 2;
        const tilt = new THREE.Group(); tilt.rotation.z = -1.15;
        const fr = new THREE.Mesh(palmFrondGeo, i % 2 ? mFrond : mFrond2); fr.position.y = 1.2; fr.scale.x = 2.0;
        tilt.add(fr); pv.add(tilt); top.add(pv);
      }
    } else {
      const t = new THREE.Mesh(trunkGeo, mTrunk); t.position.y = 0.65; g.add(t);
      const a = new THREE.Mesh(coneA, LEAFS[(v || 0) % 3]); a.position.y = 2.1; g.add(a);
      const b = new THREE.Mesh(coneB, LEAFS[((v || 0) + 1) % 3]); b.position.y = 3.2; g.add(b);
      const c = new THREE.Mesh(coneB, LEAFS[(v || 0) % 3]); c.position.y = 4.0; c.scale.set(0.6, 0.8, 0.6); g.add(c);
      a.scale.set(1.15, 1, 1.15);
    }
    g.scale.setScalar(s);
    return g;
  }
  function makeCycad(s) {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(stemGeo, mTrunk); stem.position.y = 0.5; g.add(stem);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const pv = new THREE.Group();
      pv.position.y = 1.0;
      pv.rotation.y = (i / n) * Math.PI * 2;
      const tilt = new THREE.Group();
      tilt.rotation.z = -1.05;
      const blade = new THREE.Mesh(bladeGeo, i % 2 ? mFern1 : mFern2);
      blade.position.y = 1.0;
      blade.scale.x = 2.2;
      tilt.add(blade);
      pv.add(tilt);
      g.add(pv);
    }
    g.scale.setScalar(s);
    return g;
  }
  function makeRock(s, dry) {
    const g = new THREE.Group();
    const mat = dry ? mRockDry : mRock;
    const r = new THREE.Mesh(rockVars[Math.floor(rand(0, 3))], mat);
    r.position.y = 0.3 * s;
    r.scale.set(s * rand(0.9, 1.5), s * rand(0.6, 1.0), s * rand(0.9, 1.4));
    r.rotation.y = rand(0, 6);
    g.add(r);
    for (let i = 0, n = 1 + Math.floor(rand(0, 2.5)); i < n; i++) {     // batu kecil di sekelilingnya
      const a = rand(0, 6.28), d = s * rand(0.8, 1.2), q = s * rand(0.3, 0.5);
      const m = new THREE.Mesh(rockVars[(i + 1) % 3], mat);
      m.position.set(Math.cos(a) * d, q * 0.3, Math.sin(a) * d);
      m.scale.set(q, q * 0.7, q); m.rotation.y = rand(0, 6);
      g.add(m);
    }
    if (!dry) {                                                         // lumut di bagian atas
      const mo = new THREE.Mesh(rockVars[0], mMoss);
      mo.position.set(r.position.x, r.position.y + 0.28 * s * r.scale.y / s, r.position.z);
      mo.scale.set(r.scale.x * 0.62, r.scale.y * 0.3, r.scale.z * 0.62);
      g.add(mo);
    }
    return g;
  }
  function makeCactus(s) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(cactusGeo, mCactus); body.position.y = 1.0; g.add(body);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, mCactus);
      arm.position.set(sx * 0.5, 1.1 + sx * 0.15, 0);
      g.add(arm);
    }
    g.scale.setScalar(s);
    return g;
  }
  function makeBush() {
    const g = new THREE.Group();
    const base = new THREE.Mesh(bushGeo, mBush);
    base.position.y = 0.55;
    base.scale.set(1.2, 0.8, 1.2);
    g.add(base);
    const berries = new THREE.Group();
    for (const [x, y, z] of [[0.5, 0.95, 0.3], [-0.45, 0.9, 0.4], [0.1, 1.15, -0.5], [-0.2, 0.75, -0.65]]) {
      const b = new THREE.Mesh(berryGeo, mBerry);
      b.position.set(x, y, z);
      berries.add(b);
    }
    g.add(berries);
    return { group: g, berries };
  }
  const coinShGeo = new THREE.CircleGeometry(0.42, 16); coinShGeo.rotateX(-Math.PI / 2);
  const mCoinSh = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  // bayangan koin: piringan di tanah yang dimiringkan mengikuti lereng (tidak setengah tertanam)
  function tiltShadow(m, x, z, lift) {
    const d = 0.6, h0 = heightAt(x, z);
    const sx = (heightAt(x + d, z) - heightAt(x - d, z)) / (2 * d), sz = (heightAt(x, z + d) - heightAt(x, z - d)) / (2 * d);
    m.position.set(x, Math.max(h0, WL) + lift, z);
    m.rotation.set(-Math.atan(sz), 0, Math.atan(sx));
  }
  function makeCoinShadow(x, z) {
    const m = new THREE.Mesh(coinShGeo, mCoinSh);
    m.renderOrder = 2;
    tiltShadow(m, x, z, 0.14);
    return m;
  }
  // Monumen Vosil: papan batu dengan logo token (media promosi, tersebar langka di dunia)
  let logoTex = null;
  try { if (THREE.TextureLoader) { logoTex = new THREE.TextureLoader().load('vosil-logo-256.png'); } } catch (e) { logoTex = null; }
  const monSlabGeo = new THREE.BoxGeometry(2.3, 3.1, 0.55), monBaseGeo = new THREE.BoxGeometry(2.8, 0.35, 0.95), monPlaqueGeo = new THREE.PlaneGeometry(1.75, 1.75);
  const monFoundGeo = new THREE.BoxGeometry(2.6, 1.6, 0.8);
  const mMonStone = std(0x8d8f8a), mMonBase = std(0x6f716c);
  const mMonLogo = new THREE.MeshBasicMaterial(logoTex ? { map: logoTex } : { color: 0x0e1f1b });
  function makeMonument() {
    const g = new THREE.Group();
    const fnd = new THREE.Mesh(monFoundGeo, mMonBase); fnd.position.y = -0.55; g.add(fnd);      // pondasi tertanam: tidak ada celah di lereng
    const base = new THREE.Mesh(monBaseGeo, mMonBase); base.position.y = 0.17; g.add(base);
    const slab = new THREE.Mesh(monSlabGeo, mMonStone); slab.position.y = 1.9; g.add(slab);
    for (const sgn of [1, -1]) {
      const p = new THREE.Mesh(monPlaqueGeo, mMonLogo);
      p.position.set(0, 1.95, sgn * 0.285); if (sgn < 0) p.rotation.y = Math.PI;
      g.add(p);
    }
    return g;
  }
  function makeCoin() {
    const g = new THREE.Group();

    g.add(new THREE.Mesh(coinGeo, mCoin));
    g.add(new THREE.Mesh(coinInGeo, mCoinIn));
    return g;
  }
  function makeEgg() {
    const g = new THREE.Group();
    const e = new THREE.Mesh(eggGeo, mEgg);
    e.scale.set(0.9, 1.25, 0.9);
    g.add(e);
    const rx = 0.42 * 0.9, ry = 0.42 * 1.25;
    for (const [th, ph] of [[1.3, 1.0], [1.9, 1.5], [1.6, 0.55], [2.5, 0.95], [0.8, 1.45]]) {
      const s = new THREE.Mesh(spotGeo, mSpot);
      s.position.set(rx * Math.sin(ph) * Math.cos(th), ry * Math.cos(ph), rx * Math.sin(ph) * Math.sin(th));
      g.add(s);
    }
    const ring = new THREE.Mesh(ringGeo, mRing);
    g.add(ring);
    return { group: g, ring };
  }

  // ---------- Dunia: potongan (chunk) yang dimuat sesuai posisi pemain ----------
  const chunks = new Map();
  const buildQueue = [];
  let pcx = null, pcz = null;
  const zoneTaken = new Set(), zoneSeen = new Set();     // harta area tantangan yang sudah diambil / zona yang sudah ditemukan (per permainan)
  const taken = new Set();            // koin & telur yang sudah diambil (dalam satu permainan)
  const eatenAt = new Map();          // semak yang buahnya sudah dimakan -> waktu dimakan

  function genChunk(cx, cz) {
    const key = cx + ',' + cz;
    const rng = mulberry(hash(cx, cz, worldSeed + 99));
    const R = (a, b) => a + rng() * (b - a);
    const cnt = (base) => Math.floor(base + rng());
    const cntD = (base) => Math.floor(base * densMul + rng());   // dekorasi: jumlah ikut kualitas grafis (koin tidak)
    const ox = cx * CH, oz = cz * CH;
    const biome = biomeAt(ox + CH / 2, oz + CH / 2);
    const home = (cx === 0 || cx === -1) && (cz === 0 || cz === -1);   // empat potongan di sekitar titik awal

    const group = new THREE.Group();
    scene.add(group);
    const ch = { key, cx, cz, group, biome, colliders: [], bushes: [], coins: [], eggs: [], ponds: [], ripples: [], geos: [] };

    ch.geo = buildGround(ox, oz);
    const groundMesh = new THREE.Mesh(ch.geo, mGround);
    groundMesh.userData.keep = true;
    group.add(groundMesh);
    let lowest = 1e9;                                           // adakah tanah di bawah permukaan air (sungai/danau)?
    for (let j = 0; j <= 8; j++) for (let i = 0; i <= 8; i++) lowest = Math.min(lowest, heightAt(ox + i * CH / 8, oz + j * CH / 8));
    if (lowest < WL + 0.05) {
      const w = new THREE.Mesh(riverGeo, mPond);
      w.position.set(ox + CH / 2, WL, oz + CH / 2);
      w.userData.keep = true;
      group.add(w);
      const gl = new THREE.Mesh(riverGeo, mGlint);               // kilau cahaya yang bergerak
      gl.position.set(ox + CH / 2, WL + 0.03, oz + CH / 2);
      gl.userData.keep = true;
      group.add(gl);
      ch.river = true;
    }

    const shadows = [];
    const sh = (x, z, r, h) => shadows.push([x, z, r, h]);
    const placed = [];
    const tryPlace = (r) => {
      for (let i = 0; i < 10; i++) {
        const x = ox + 1.5 + rng() * (CH - 3), z = oz + 1.5 + rng() * (CH - 3);
        if (heightAt(x, z) < WL + 0.5) continue;
        if (zoneNear(x, z, -18)) continue;                       // jangan menaruh pohon/batu di area tantangan
        if (placed.every((p) => (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) > (p.r + r) * (p.r + r))) {
          placed.push({ x, z, r });
          return { x, z };
        }
      }
      return null;
    };

    // kolam air (selalu ada satu di dekat titik awal supaya pemain tidak langsung kehausan)
    const pd = pondOf(cx, cz);
    if (pd) {
      const r = pd.r;
      placed.push({ x: pd.x, z: pd.z, r: r + 2.5 });
      const wy = pd.base - 0.18;
      const mud = new THREE.Mesh(pondGeo, mMud);                       // tepi lumpur basah
      mud.rotation.x = -Math.PI / 2; mud.position.set(pd.x, wy - 0.02, pd.z); mud.scale.set(r + 1.25, r + 1.25, 1);
      group.add(mud);
      const m = new THREE.Mesh(pondGeo, mPond);
      m.rotation.x = -Math.PI / 2;
      m.position.set(pd.x, wy + 0.01, pd.z);
      m.scale.set(r + 0.7, r + 0.7, 1);
      m.userData.keep = true;
      group.add(m);
      const dp = new THREE.Mesh(pondGeo, mDeep);                       // bagian tengah lebih dalam (lebih gelap)
      dp.rotation.x = -Math.PI / 2; dp.position.set(pd.x, wy + 0.03, pd.z); dp.scale.set(r * 0.62, r * 0.62, 1);
      dp.userData.keep = true;
      group.add(dp);
      for (let k = 0; k < 2; k++) {                                    // riak yang melebar perlahan
        const rp = new THREE.Mesh(ringThin, mRipple);
        rp.rotation.x = -Math.PI / 2; rp.position.set(pd.x, wy + 0.05, pd.z);
        ch.ripples.push({ mesh: rp, ph: k * 0.5 + rng() * 0.2, r: r * 0.9 });
        rp.scale.set(0.1, 0.1, 1);
        rp.userData.keep = true;
        group.add(rp);
      }
      for (let k = 0, ln = 2 + Math.floor(rng() * 3); k < ln; k++) {   // daun teratai
        const a = rng() * Math.PI * 2, dd = rng() * (r * 0.7);
        const pad = new THREE.Mesh(padGeo, mPad);
        pad.rotation.x = -Math.PI / 2; pad.rotation.z = rng() * 6;
        pad.position.set(pd.x + Math.cos(a) * dd, wy + 0.06, pd.z + Math.sin(a) * dd);
        const ps = R(0.7, 1.4); pad.scale.set(ps, ps, 1);
        group.add(pad);
      }
      for (let k = 0, kn = 5 + Math.floor(rng() * 4); k < kn; k++) {   // kerikil di tepi
        const a = rng() * Math.PI * 2, dd = r + R(0.4, 1.1);
        const px = pd.x + Math.cos(a) * dd, pz = pd.z + Math.sin(a) * dd;
        const pb = new THREE.Mesh(pebbleGeo, mPebble), ps = R(0.6, 1.6);
        pb.position.set(px, heightAt(px, pz) + 0.05, pz); pb.scale.set(ps, ps * 0.6, ps); pb.rotation.y = rng() * 6;
        group.add(pb);
      }
      for (let k = 0, cn = 2 + Math.floor(rng() * 3); k < cn; k++) {   // rumput kucai (cattail)
        const a = rng() * Math.PI * 2, dd = r + R(0.2, 0.9);
        const px = pd.x + Math.cos(a) * dd, pz = pd.z + Math.sin(a) * dd, cs = R(0.8, 1.2), gy = heightAt(px, pz);
        const st = new THREE.Mesh(cattailGeo, mLush); st.position.set(px, gy + 0.65 * cs, pz); st.scale.setScalar(cs); group.add(st);
        const tp = new THREE.Mesh(cattailTop, mCat); tp.position.set(px, gy + 1.35 * cs, pz); tp.scale.setScalar(cs); group.add(tp);
        sh(px, pz, 0.2 * cs, 1.4 * cs);
      }
      ch.ponds.push({ x: pd.x, z: pd.z, r });
      if (biome.id !== 'forest') {                      // oasis: palem tumbuh di tepi kolam
        for (let k = 0, pn = 1 + Math.floor(rng() * 3); k < pn; k++) {
          const a = rng() * Math.PI * 2, dd = r + R(0.8, 1.6);
          const px = pd.x + Math.cos(a) * dd, pz = pd.z + Math.sin(a) * dd;
          const s = R(0.9, 1.4), pm = makeTree(s, 'palm', 0);
          pm.position.set(px, heightAt(px, pz), pz);
          group.add(pm);
          ch.colliders.push({ x: px, z: pz, r: 0.3 * s });
          sh(px, pz, 0.7 * s, 3.2 * s);
        }
      }
      for (let k = 0, tn = 11 + Math.floor(rng() * 5); k < tn; k++) {   // rumput kecil dan alang-alang di tepi kolam
        const a = rng() * Math.PI * 2, dd = r + R(0.3, 2.3);
        const px = pd.x + Math.cos(a) * dd, pz = pd.z + Math.sin(a) * dd;
        const reed = k % 3 === 0, sc2 = reed ? R(0.55, 0.9) : R(0.5, 1.1);
        const tf = new THREE.Mesh(reed ? bladeGeo : tuftGeo, mLush);
        tf.position.set(px, heightAt(px, pz) + (reed ? 0.9 : 0.35) * sc2, pz);
        tf.scale.set(sc2 * 1.1, sc2, sc2 * 1.1);
        tf.rotation.y = rng() * 3;
        group.add(tf);
        sh(px, pz, 0.28 * sc2, 0.9 * sc2);
      }
    }

    for (let i = 0, n = cntD(biome.tree); i < n; i++) {
      const pos = tryPlace(1.4); if (!pos) continue;
      const rr = rng();
      const kind = biome.id === 'forest' ? (rr < 0.5 ? 'pine' : 'broad')
        : biome.id === 'swamp' ? (rr < 0.6 ? 'dead' : 'broad')
        : (rr < 0.75 ? 'broad' : 'pine');
      const s = R(0.9, 1.5), t = makeTree(s, kind, Math.floor(rng() * 5));
      t.position.set(pos.x, heightAt(pos.x, pos.z), pos.z);
      group.add(t);
      ch.colliders.push({ x: pos.x, z: pos.z, r: (kind === 'dead' ? 0.4 : 0.55) * s });
      sh(pos.x, pos.z, (kind === 'pine' ? 0.9 : kind === 'dead' ? 0.4 : 1.1) * s, (kind === 'pine' ? 3.6 : kind === 'dead' ? 2.4 : 3.2) * s);
    }
    for (let i = 0, n = cntD(biome.cycad); i < n; i++) {
      const pos = tryPlace(1.2); if (!pos) continue;
      const s = R(0.9, 1.5), t = makeCycad(s);
      t.position.set(pos.x, heightAt(pos.x, pos.z), pos.z);
      group.add(t);
      ch.colliders.push({ x: pos.x, z: pos.z, r: 0.45 * s });
      sh(pos.x, pos.z, 0.8 * s, 1.2 * s);
    }
    for (let i = 0, n = cntD(biome.cactus); i < n; i++) {
      const pos = tryPlace(1.2); if (!pos) continue;
      const s = R(0.9, 1.5), t = makeCactus(s);
      t.position.set(pos.x, heightAt(pos.x, pos.z), pos.z);
      group.add(t);
      ch.colliders.push({ x: pos.x, z: pos.z, r: 0.5 * s });
      sh(pos.x, pos.z, 0.35 * s, 2.0 * s);
    }
    for (let i = 0, n = cntD(biome.rock); i < n; i++) {
      const pos = tryPlace(1.3); if (!pos) continue;
      const s = R(0.8, 1.7), t = makeRock(s, biome.id === 'desert');
      t.position.set(pos.x, heightAt(pos.x, pos.z), pos.z);
      group.add(t);
      ch.colliders.push({ x: pos.x, z: pos.z, r: 0.85 * s });
      sh(pos.x, pos.z, 0.75 * s, 0.9 * s);
    }

    // semak buah
    const bushN = home ? Math.max(2, cntD(biome.bush)) : cntD(biome.bush);
    for (let i = 0; i < bushN; i++) {
      const pos = tryPlace(1.4); if (!pos) continue;
      const b = makeBush();
      b.group.position.set(pos.x, heightAt(pos.x, pos.z), pos.z);
      b.group.userData.keep = true;
      group.add(b.group);
      const id = key + ':b' + i;
      const bush = { id, x: pos.x, z: pos.z, berries: b.berries, has: true };
      if (eatenAt.has(id)) { bush.has = false; b.berries.visible = false; }
      ch.bushes.push(bush);
      sh(pos.x, pos.z, 0.85, 0.8);
    }

    // rumput liar
    for (let i = 0, n = cntD(biome.id === 'desert' ? 1 : 2.2); i < n; i++) {
      const pos = tryPlace(0.6); if (!pos) continue;
      const s = R(0.8, 1.6), tf = new THREE.Mesh(tuftGeo, mTuft[biome.id]);
      tf.position.set(pos.x, heightAt(pos.x, pos.z) + 0.4 * s, pos.z);
      tf.scale.set(s * 1.4, s, s * 1.4);
      group.add(tf);
    }

    // gugusan koin
    let ck = 0;
    for (let i = 0, n = cnt(biome.coin * COIN_DENSITY); i < n; i++) {
      const pos = tryPlace(4.2); if (!pos) continue;          // ruang cukup supaya koin tidak menempel pohon / batu
      const count = 2 + Math.floor(rng() * 3);
      const ang = rng() * Math.PI * 2;
      for (let k = 0; k < count; k++) {
        const id = key + ':c' + (ck++);
        if (taken.has(id)) continue;
        const off = (k - (count - 1) / 2) * 1.3;
        const x = pos.x + Math.cos(ang) * off;
        const z = pos.z + Math.sin(ang) * off;
        const m = makeCoin();
        m.position.set(x, heightAt(x, z) + 0.9, z);
        m.userData.keep = true;
        group.add(m);
        const csh = makeCoinShadow(x, z); csh.userData.keep = true; group.add(csh);
        ch.coins.push({ id, x, z, mesh: m, sh: csh });
      }
    }

    // monumen logo Vosil: satu dekat titik awal, selebihnya jarang
    if ((cx === 0 && cz === 0) || rng() < 0.07) {
      // cari tempat yang benar-benar datar (tepi tebing / lereng bikin papan setengah mengambang)
      let spot = null;
      for (let i = 0; i < (cx === 0 && cz === 0 ? 60 : 18) && !spot; i++) {
        const x = ox + 3 + rng() * (CH - 6), z = oz + 3 + rng() * (CH - 6), rot = rng() * Math.PI * 2;
        if (zoneNear(x, z, -18)) continue;
        if (!placed.every((p) => (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) > (p.r + 2.8) * (p.r + 2.8))) continue;
        const cs = Math.cos(rot), sn = Math.sin(rot);
        let lo = 1e9, hi = -1e9;
        for (const [u, v] of [[0, 0], [1.5, 0.6], [-1.5, 0.6], [1.5, -0.6], [-1.5, -0.6], [2.6, 0], [-2.6, 0], [0, 2.6], [0, -2.6]]) {   // alas papan + sekelilingnya
          const h = heightAt(x + u * cs - v * sn, z + u * sn + v * cs);
          if (h < lo) lo = h; if (h > hi) hi = h;
        }
        if (lo < WL + 0.8 || hi - lo > 0.45) continue;
        spot = { x, z, rot, y: lo };
      }
      if (spot) {
        placed.push({ x: spot.x, z: spot.z, r: 2.8 });
        const mon = makeMonument();
        mon.position.set(spot.x, spot.y, spot.z);        // berdiri di titik terendah alasnya, pondasi tertanam ke tanah
        mon.rotation.y = spot.rot;
        mon.userData.keep = true;                      // jangan digabung (merge) -> tekstur logo hilang menjadi hitam
        group.add(mon);
        ch.colliders.push({ x: spot.x, z: spot.z, r: 1.35 });
        sh(spot.x, spot.z, 1.2, 1.6);
      }
    }

    // telur langka (mode kuat)
    if (!home && rng() < 0.07) {
      const pos = tryPlace(1.5);
      const id = key + ':e0';
      if (pos && !taken.has(id)) {
        const e = makeEgg();
        const by = heightAt(pos.x, pos.z) + 1.1;
        e.group.position.set(pos.x, by, pos.z);
        e.group.userData.keep = true;
        group.add(e.group);
        ch.eggs.push({ id, x: pos.x, z: pos.z, by, mesh: e.group, ring: e.ring });
      }
    }

    bakeStatic(group, ch);
    if (shadows.length) {
      ch.shGeo = buildShadows(shadows);
      group.add(new THREE.Mesh(ch.shGeo, mShadow));
    }
    chunks.set(key, ch);
    return ch;
  }

  // Gabungkan semua pohon, batu, rumput, dsb. yang statis dalam satu potongan menjadi beberapa mesh (satu per bahan).
  // Yang bergerak/bisa diambil (koin, telur, semak, air) diberi userData.keep dan dibiarkan terpisah.
  // Jika terjadi kesalahan, tidak ada yang diubah (adegan asli tetap dipakai).
  function bakeStatic(group, ch) {
    try {
      if (!group.updateMatrixWorld || !Array.isArray(group.children)) return;
      group.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
      const byMat = new Map(), dead = [];
      const walk = (o) => {
        for (const k of o.children.slice()) {
          if (k.userData && k.userData.keep) continue;
          const g = k.geometry;
          if (k.isMesh && g && g.attributes && g.attributes.position && g.attributes.normal && !g.attributes.color) {
            if (!byMat.has(k.material)) byMat.set(k.material, []);
            byMat.get(k.material).push(k); dead.push(k);
          } else if (Array.isArray(k.children) && k.children.length) walk(k);
        }
      };
      walk(group);
      if (!dead.length) return;
      const m4 = new THREE.Matrix4(), n3 = new THREE.Matrix3(), v = new THREE.Vector3();
      const made = [];
      const flush = (mat, list) => {
        let nv = 0, ni = 0;
        for (const m of list) {
          const gm = m.geometry, c = gm.attributes.position.array.length / 3;
          nv += c; ni += gm.index ? gm.index.array.length : c;
        }
        const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = new Uint16Array(ni);
        let vo = 0, io = 0;
        for (const m of list) {
          const gm = m.geometry, pa = gm.attributes.position.array, na = gm.attributes.normal.array, c = pa.length / 3;
          m4.multiplyMatrices(inv, m.matrixWorld);
          n3.getNormalMatrix(m4);
          for (let i = 0; i < c; i++) {
            v.set(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]).applyMatrix4(m4);
            pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
            v.set(na[i * 3], na[i * 3 + 1], na[i * 3 + 2]).applyMatrix3(n3).normalize();
            nor[(vo + i) * 3] = v.x; nor[(vo + i) * 3 + 1] = v.y; nor[(vo + i) * 3 + 2] = v.z;
          }
          if (gm.index) { const ia = gm.index.array; for (let i = 0; i < ia.length; i++) idx[io++] = ia[i] + vo; }
          else for (let i = 0; i < c; i++) idx[io++] = vo + i;
          vo += c;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        made.push({ geo, mat });
      };
      byMat.forEach((list, mat) => {
        let batch = [], cnt = 0;
        for (const m of list) {
          const c = m.geometry.attributes.position.array.length / 3;
          if (cnt + c > 60000 && batch.length) { flush(mat, batch); batch = []; cnt = 0; }
          batch.push(m); cnt += c;
        }
        if (batch.length) flush(mat, batch);
      });
      // semua berhasil dibuat: baru ganti adegan
      for (const k of dead) if (k.parent) k.parent.remove(k);
      for (const e of made) { group.add(new THREE.Mesh(e.geo, e.mat)); ch.geos.push(e.geo); }
    } catch (err) { /* biarkan mesh asli */ }
  }

  function unloadChunk(ch) {
    scene.remove(ch.group);
    if (ch.geo) ch.geo.dispose();
    if (ch.shGeo) ch.shGeo.dispose();
    if (ch.geos) for (const g of ch.geos) g.dispose();
    chunks.delete(ch.key);
  }

  function ensureChunks(force) {
    const cx = Math.floor(player.x / CH), cz = Math.floor(player.z / CH);
    if (!force && cx === pcx && cz === pcz) return;
    pcx = cx; pcz = cz;
    buildQueue.length = 0;
    for (const ch of Array.from(chunks.values())) {
      if (Math.abs(ch.cx - cx) > VIEW || Math.abs(ch.cz - cz) > VIEW) unloadChunk(ch);
    }
    for (let a = -VIEW; a <= VIEW; a++) {
      for (let b = -VIEW; b <= VIEW; b++) {
        const key = (cx + a) + ',' + (cz + b);
        if (!chunks.has(key)) buildQueue.push({ cx: cx + a, cz: cz + b, d: Math.abs(a) + Math.abs(b) });
      }
    }
    buildQueue.sort((p, q) => p.d - q.d);
    if (force) while (buildQueue.length) { const q = buildQueue.shift(); genChunk(q.cx, q.cz); }
  }

  function pumpBuildQueue() {                       // bangun maksimal 2 potongan per frame supaya tidak patah-patah
    for (let i = 0; i < 2 && buildQueue.length; i++) {
      const q = buildQueue.shift();
      if (Math.abs(q.cx - pcx) <= VIEW && Math.abs(q.cz - pcz) <= VIEW && !chunks.has(q.cx + ',' + q.cz)) genChunk(q.cx, q.cz);
    }
  }

  function clearWorld() {
    for (const ch of Array.from(chunks.values())) unloadChunk(ch);
    buildQueue.length = 0;
    pcx = null; pcz = null;
    taken.clear();
    eatenAt.clear();
    pondCache.clear(); zoneReset();
    for (const f of flyCoins) scene.remove(f.mesh);
    flyCoins.length = 0;
    clearZoneObjs();
    clearDrops();
  }

  function pushOut(e, rad) {                        // dorong keluar dari pohon, batu, dan kaktus
    const cx0 = Math.floor(e.x / CH), cz0 = Math.floor(e.z / CH);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const c = chunks.get((cx0 + a) + ',' + (cz0 + b));
        if (!c) continue;
        for (const o of c.colliders) {
          const dx = e.x - o.x, dz = e.z - o.z, r = o.r + rad;
          const d2 = dx * dx + dz * dz;
          if (d2 < r * r) {
            const d = Math.sqrt(d2) || 0.001;
            e.x = o.x + (dx / d) * r;
            e.z = o.z + (dz / d) * r;
          }
        }
      }
    }
  }

  function inPond(x, z) {
    if (heightAt(x, z) < WL - 0.05) return true;
    const cx0 = Math.floor(x / CH), cz0 = Math.floor(z / CH);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const c = chunks.get((cx0 + a) + ',' + (cz0 + b));
        if (!c) continue;
        for (const p of c.ponds) if ((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) < (p.r + 0.4) * (p.r + 0.4)) return true;
      }
    }
    return false;
  }

  // ---------- Makhluk (dino pemain & predator) ----------
  function makeCreature(p) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const green = smoothStd(p.body), dark = smoothStd(p.dark), light = smoothStd(p.light), spikeM = smoothStd(p.spike);
    const white = std(p.eye, { flatShading: false }), black = std(p.pupil, { flatShading: false });
    const bone = smoothStd(0xf3efe2);
    const part = (geo, mat, x, y, z, parent) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      (parent || body).add(m);
      return m;
    };
    const ball = (r, mat, sx, sy, sz, x, y, z, parent, seg) => {                       // seg: jumlah sisi (bagian kecil dibuat lebih sedikit supaya ringan)
      const m = part(new THREE.SphereGeometry(r, seg || 14, seg ? Math.max(5, seg - 3) : 10), mat, x, y, z, parent);
      m.scale.set(sx, sy, sz);
      return m;
    };

    const pink = smoothStd(0xd9656b);
    const plate = (h, w, mat, x, y, z, parent, rx) => { const m = part(new THREE.ConeGeometry(w, h, 4), mat, x, y, z, parent); m.scale.set(0.42, 1, 1.3); if (rx) m.rotation.x = rx; return m; };
    // Proporsi mengikuti referensi theropoda remaja: badan memanjang & mendatar, leher pendek kokoh, kepala ber-moncong panjang,
    // lengan kecil, kaki belakang kuat, ekor panjang meruncing (~40% panjang tubuh), plat krem kecil di sepanjang punggung.
    ball(0.6, green, 0.8, 0.78, 1.3, 0, 1.15, 0);
    ball(0.44, green, 0.85, 0.88, 1.0, 0, 1.25, -0.5);
    ball(0.5, green, 0.9, 0.85, 1.05, 0, 1.12, 0.45);
    ball(0.52, light, 0.72, 0.55, 1.2, 0, 0.97, -0.03);                                   // perut terang
    ball(0.24, light, 0.8, 0.7, 1.2, 0, 1.3, -0.82, undefined, 9);                        // bawah leher
    for (let i = 0; i < 7; i++) {                                                          // plat punggung
      const z = -0.6 + i * 0.25, h = 0.3 - Math.abs(i - 2) * 0.03 - i * 0.01;
      const topY = 1.15 + 0.468 * Math.sqrt(Math.max(0, 1 - (z / 0.78) * (z / 0.78)));
      plate(h, 0.12, spikeM, 0, topY + h / 2 - 0.05, z);
    }
    plate(0.2, 0.09, spikeM, 0, 1.78, -0.7, undefined, -0.3);                              // plat leher
    for (const [x, y, z, r] of [[0.3, 1.5, -0.2, 0.05], [-0.32, 1.45, 0.2, 0.05], [0.36, 1.35, 0.5, 0.05], [-0.3, 1.52, -0.5, 0.045], [0.28, 1.58, 0.05, 0.04], [-0.35, 1.3, 0.55, 0.045], [0.3, 1.2, -0.45, 0.04], [-0.3, 1.18, -0.1, 0.04]]) ball(r, dark, 1.3, 0.4, 1.3, x, y, z, undefined, 6);   // sisik/bercak kulit

    // leher pendek kokoh
    ball(0.3, green, 1, 1, 1, 0, 1.42, -0.68);
    ball(0.26, green, 1, 1, 1, 0, 1.55, -0.8);

    // kepala: tengkorak ramping, moncong panjang (tanpa pipi gembung), alis tegas, mata sedang berkilau
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 1.62, -0.85);
    body.add(headPivot);
    ball(0.38, green, 0.85, 0.82, 1.05, 0, 0, 0, headPivot);
    ball(0.28, green, 0.72, 0.58, 1.7, 0, -0.07, -0.5, headPivot);                       // moncong panjang
    ball(0.1, green, 0.9, 0.75, 1, 0, -0.04, -0.93, headPivot, 9);                        // ujung moncong
    for (const sx of [-1, 1]) {
      ball(0.026, black, 1, 1, 1, sx * 0.06, 0.0, -0.99, headPivot, 6);                   // lubang hidung
      ball(0.13, green, 0.55, 0.8, 1.15, sx * 0.27, -0.1, 0.05, headPivot, 9);            // otot rahang (halus)
      for (let i = 0; i < 4; i++) { const tt = part(new THREE.ConeGeometry(0.028, 0.1, 4), bone, sx * (0.12 - i * 0.004), -0.225, -0.3 - i * 0.17, headPivot); tt.rotation.x = Math.PI; }
    }
    const jaw = new THREE.Group();
    jaw.position.set(0, -0.14, -0.12);
    headPivot.add(jaw);
    ball(0.15, pink, 0.78, 0.28, 2.0, 0, -0.045, -0.42, jaw, 10);                         // isi mulut
    ball(0.17, light, 0.7, 0.36, 2.05, 0, -0.1, -0.42, jaw, 12);                          // rahang bawah
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) part(new THREE.ConeGeometry(0.022, 0.08, 4), bone, sx * 0.1, -0.03, -0.38 - i * 0.18, jaw);
    for (const s2 of [-1, 1]) {
      ball(0.095, white, 1, 1.05, 0.9, s2 * 0.265, 0.1, -0.16, headPivot, 12);             // bola mata
      ball(0.068, black, 1, 1.05, 0.9, s2 * 0.295, 0.1, -0.225, headPivot, 10);            // pupil
      ball(0.022, white, 1, 1, 1, s2 * 0.285, 0.135, -0.275, headPivot, 6);                // kilau
      const br = ball(0.13, dark, 1.0, 0.36, 1.7, s2 * 0.24, 0.21, -0.17, headPivot, 9);   // alis menukik: tampak garang
      br.rotation.z = s2 * 0.42; br.rotation.y = s2 * -0.12;
    }
    plate(0.16, 0.06, spikeM, 0, 0.36, 0.2, headPivot, -0.4);

    // lengan kecil bercakar
    const arms = [];
    for (const s2 of [-1, 1]) {
      const pv = new THREE.Group();
      pv.position.set(s2 * 0.42, 1.2, -0.6);
      body.add(pv);
      const up = part(new THREE.CylinderGeometry(0.05, 0.075, 0.36, 7), green, 0, -0.05, -0.15, pv);
      up.rotation.x = 1.3;
      ball(0.07, green, 1, 1, 1.2, 0, -0.1, -0.33, pv, 9);
      for (const c of [-1, 1]) {
        const cl = part(new THREE.ConeGeometry(0.024, 0.12, 4), bone, c * 0.03, -0.11, -0.43, pv);
        cl.rotation.x = -1.4;
      }
      arms.push(pv);
    }

    // kaki belakang kuat: paha berotot, betis panjang, telapak panjang bercakar
    const legs = [];
    for (const s2 of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s2 * 0.42, 0.99, 0.12);
      body.add(hip);
      ball(0.27, green, 1, 1.15, 1.25, 0, -0.07, 0.03, hip);
      part(new THREE.CylinderGeometry(0.19, 0.14, 0.5, 9), green, 0, -0.27, 0, hip);
      const knee = new THREE.Group();
      knee.position.set(0, -0.5, 0);
      hip.add(knee);
      ball(0.14, green, 1, 1, 1, 0, 0, 0, knee, 10);
      part(new THREE.CylinderGeometry(0.12, 0.075, 0.44, 8), dark, 0, -0.22, 0, knee);
      const foot = new THREE.Group();
      foot.position.set(0, -0.43, 0);
      knee.add(foot);
      ball(0.1, dark, 1, 1, 1, 0, 0, 0, foot, 9);
      ball(0.15, dark, 0.9, 0.5, 2.3, 0, -0.04, -0.14, foot, 10);
      for (const c of [-1, 0, 1]) {
        const toe = part(new THREE.ConeGeometry(0.045, 0.17, 5), bone, c * 0.09, -0.05, -0.4, foot);
        toe.rotation.x = -1.45;
      }
      legs.push({ hip, knee, foot });
    }

    // ekor panjang meruncing, tiga ruas, plat krem mengecil ke ujung
    const tail1 = new THREE.Group();
    tail1.position.set(0, 1.08, 0.7);
    body.add(tail1);
    const t1 = part(new THREE.CylinderGeometry(0.19, 0.33, 1.1, 10), green, 0, 0, 0.55, tail1);
    t1.rotation.x = Math.PI / 2;
    for (let i = 0; i < 4; i++) plate(0.26 - i * 0.04, 0.09, spikeM, 0, 0.3 - i * 0.05 + 0.04, 0.12 + i * 0.26, tail1);
    const tail2 = new THREE.Group();
    tail2.position.set(0, 0, 1.1);
    tail1.add(tail2);
    const t2 = part(new THREE.CylinderGeometry(0.1, 0.19, 0.9, 9), green, 0, 0, 0.45, tail2);
    t2.rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) plate(0.17 - i * 0.035, 0.07, spikeM, 0, 0.17 - i * 0.04 + 0.04, 0.12 + i * 0.27, tail2);
    const tail3 = new THREE.Group();
    tail3.position.set(0, 0, 0.9);
    tail2.add(tail3);
    const t3 = part(new THREE.CylinderGeometry(0.012, 0.1, 0.8, 8), dark, 0, 0, 0.4, tail3);
    t3.rotation.x = Math.PI / 2;

    const v = p.variant;
    if (v === 'velo') {                                   // cakar sabit di kaki + jambul bulu
      for (const L of legs) {
        const claw = part(new THREE.ConeGeometry(0.07, 0.4, 4), white, 0, -0.36, -0.42, L.knee);
        claw.rotation.x = -2.0;
      }
      for (let i = 0; i < 3; i++) {
        const f = part(new THREE.ConeGeometry(0.06, 0.45, 4), spikeM, (i - 1) * 0.12, 0.45, 0.12 + i * 0.03, headPivot);
        f.rotation.x = 0.7;
      }
    } else if (v === 'carno') {                           // dua tanduk di atas mata, lengan sangat kecil
      for (const sx of [-1, 1]) {
        const horn = part(new THREE.ConeGeometry(0.09, 0.5, 5), white, sx * 0.24, 0.44, -0.22, headPivot);
        horn.rotation.z = -sx * 0.35;
        horn.rotation.x = -0.35;
      }
      for (const a of arms) a.scale.setScalar(0.5);
    } else if (v === 'spino') {                           // layar besar di punggung + moncong panjang
      const sail = part(new THREE.BoxGeometry(0.07, 0.95, 1.6), spikeM, 0, 1.78, -0.05);
      sail.rotation.x = 0.08;
      for (let i = 0; i < 7; i++) {
        const z = -0.72 + i * 0.24, h = 0.55 - Math.abs(i - 3) * 0.1;
        part(new THREE.ConeGeometry(0.09, h, 4), spikeM, 0, 2.22 + (h - 0.4) * 0.3, z);
      }
      part(rbox(0.3, 0.2, 0.85), green, 0, -0.1, -0.95, headPivot);
    } else if (v === 'parasaur') {                        // tabung tulang di belakang kepala + paruh bebek
      const tube = part(new THREE.CylinderGeometry(0.06, 0.1, 1.15, 6), spikeM, 0, 0.5, 0.5, headPivot);
      tube.rotation.x = 1.2;
      part(rbox(0.5, 0.14, 0.5), light, 0, -0.17, -0.74, headPivot);
    }

    root.scale.setScalar(p.scale);
    mergeTree(root);
    outlineTree(root);
    return { root, body, headPivot, jaw, arms, legs, tail1, tail2, tail3, mats: [green, dark, light], variant: v };
  }

  function setGlow(c, v, hex) {
    for (const m of c.mats) { m.emissive.setHex(hex); m.emissiveIntensity = v; }
  }

  // atk: kemajuan gigitan 0..1, atau -1 jika tidak menggigit
  let animDt = 0.016;
  const approach = (cur, target, rate) => cur + (target - cur) * Math.min(1, animDt * rate);
  // badan dimiringkan mengikuti kemiringan tanah (naik tebing: moncong naik, kaki tetap menapak)
  function tiltToGround(root, x, z, yaw, len, dt, off) {
    root.rotation.order = 'YXZ';
    const ud = root.userData;
    let tp = 0, tr = 0;
    if (!off) {
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), sx = -fz, sz = fx;
      tp = Math.atan2(heightAt(x + fx * len, z + fz * len) - heightAt(x - fx * len, z - fz * len), 2 * len);
      tr = Math.atan2(heightAt(x + sx * len * 0.6, z + sz * len * 0.6) - heightAt(x - sx * len * 0.6, z - sz * len * 0.6), 1.2 * len);
      tp = clamp(tp, -0.75, 0.75); tr = clamp(tr, -0.5, 0.5);
    }
    ud.tp = approach(ud.tp || 0, tp, 8);
    ud.tr = approach(ud.tr || 0, tr, 8);
    root.rotation.x = ud.tp;
    root.rotation.z = ud.tr * 0.6;
  }
  function poseCreature(c, phase, run, air, vy, atk, t, sk) {
    // nilai dihaluskan supaya perpindahan diam <-> lari <-> lompat tidak patah-patah
    const r = c.runS = approach(c.runS === undefined ? run : c.runS, run, 9);
    const a = c.airS = approach(c.airS === undefined ? 0 : c.airS, air ? 1 : 0, 14);
    for (let i = 0; i < 2; i++) {
      const L = c.legs[i];
      const ph = phase + i * Math.PI;
      const swing = Math.sin(ph);
      const lift = Math.max(0, Math.sin(ph + 1.2));                                 // lutut menekuk hanya saat kaki diayun ke depan
      const hipG = swing * 0.8 * r, kneeG = -0.12 - lift * 0.95 * r;
      const hipA = i === 0 ? 0.75 : -0.45, kneeA = -0.95;
      L.hip.rotation.x = hipG * (1 - a) + hipA * a;
      L.knee.rotation.x = kneeG * (1 - a) + kneeA * a;
      if (L.foot) L.foot.rotation.x = -(L.hip.rotation.x + L.knee.rotation.x) * 0.75 + (1 - a) * lift * 0.35 * r;   // telapak tetap mendatar
    }
    const bob = Math.abs(Math.sin(phase)) * 0.09 * r * (1 - a);
    const breathe = Math.sin(t * 2.1) * 0.022 * (1 - r);
    c.body.position.y = bob + breathe;
    const lean = (-0.07 * r) + (a > 0.5 ? (vy > 0 ? 0.15 : -0.15) * a : 0);
    c.body.rotation.x = approach(c.body.rotation.x, lean, 10);
    c.body.rotation.z = Math.sin(phase) * 0.035 * r * (1 - a);                        // badan miring mengikuti langkah
    c.body.rotation.y = Math.sin(phase) * 0.06 * r * (1 - a);
    const sway = r > 0.05 ? r : 0.25, sp = r > 0.05 ? phase * 0.5 : t * 1.2;
    c.tail1.rotation.y = Math.sin(sp) * 0.26 * sway;
    c.tail2.rotation.y = Math.sin(sp - 0.8) * 0.34 * sway;
    if (c.tail3) c.tail3.rotation.y = Math.sin(sp - 1.6) * 0.4 * sway;
    c.tail1.rotation.x = -0.25 * a + Math.sin(phase) * 0.03 * r;
    if (c.tail3) c.tail3.rotation.x = Math.sin(phase + 1) * 0.08 * r;
    for (let i = 0; i < 2; i++) c.arms[i].rotation.x = Math.sin(phase * 2 + i * Math.PI) * 0.4 * r - 0.2 * a;
    let hy = -c.body.rotation.y * 0.7;                                                // arah kepala (default: melawan putaran badan)
    const b0 = c.body.rotation.x, v = c.variant;
    if (sk) {                                                                         // gerak skill khas: tiap dino berbeda
      const s = Math.sin(Math.PI * clamp(sk.p, 0, 1));
      c.headPivot.position.z = -0.85; c.headPivot.rotation.x = 0; let jaw = -0.06, bx = b0;
      if (sk.id === 'roar') { c.headPivot.rotation.x = -0.75 * s; c.headPivot.position.z = -0.7; jaw = -1.0 * s; bx = b0 - 0.18 * s; }
      else if (sk.id === 'pounce') { bx = b0 + 0.38 * s; c.headPivot.position.z = -0.85 - 0.5 * s; c.headPivot.rotation.x = 0.3 * s; jaw = -0.8 * s; for (let i = 0; i < 2; i++) c.arms[i].rotation.x = -1.2 * s; }
      else if (sk.id === 'charge') { bx = b0 + 0.3 * s; c.headPivot.rotation.x = 0.65 * s; c.headPivot.position.z = -0.85 - 0.4 * s; jaw = -0.3 * s; c.tail1.rotation.x = -0.5 * s; }
      else if (sk.id === 'sweep') { const e = clamp(sk.p, 0, 1); c.body.rotation.y = Math.PI * 2 * e * e * (3 - 2 * e); hy = 0; jaw = -0.5 * s; bx = b0 + 0.1 * s; }
      else if (sk.id === 'sonic') { c.headPivot.rotation.x = -0.55 * s + Math.sin(sk.p * 40) * 0.05 * s; c.headPivot.position.z = -0.85 - 0.25 * s; jaw = -0.7 * s; bx = b0 - 0.1 * s; }
      c.body.rotation.x = bx; if (c.jaw) c.jaw.rotation.x = jaw;
    } else if (atk >= 0) {                            // gigitan: tiap dino punya gaya sendiri
      const s = Math.sin(Math.PI * atk);
      if (v === 'velo') {                             // gigit cepat dua kali + cakar menebas
        const q = Math.abs(Math.sin(Math.PI * 2 * atk));
        c.headPivot.position.z = -0.85 - 0.42 * q; c.headPivot.rotation.x = 0.3 * q;
        if (c.jaw) c.jaw.rotation.x = -0.85 * q;
        c.body.rotation.x = b0 + 0.16 * s;
        for (let i = 0; i < 2; i++) c.arms[i].rotation.x = -0.9 * s * (i ? 0.7 : 1);
      } else if (v === 'carno') {                     // angkat kepala tinggi lalu membanting ke bawah
        const raise = atk < 0.4 ? atk / 0.4 : Math.max(0, 1 - (atk - 0.4) / 0.2), dn = atk < 0.4 ? 0 : Math.sin(Math.PI * Math.min(1, (atk - 0.4) / 0.6) * 0.9);
        c.headPivot.rotation.x = -0.75 * raise + 0.8 * dn; c.headPivot.position.z = -0.85 - 0.7 * dn + 0.1 * raise;
        if (c.jaw) c.jaw.rotation.x = -1.0 * Math.sin(Math.PI * clamp((atk - 0.15) / 0.75, 0, 1));
        c.body.rotation.x = b0 - 0.12 * raise + 0.3 * dn;
      } else if (v === 'spino') {                     // leher memanjang, kepala menyapu dari kiri ke kanan
        c.headPivot.position.z = -0.85 - 1.0 * s; c.headPivot.rotation.x = 0.12 * s;
        if (c.jaw) c.jaw.rotation.x = -0.8 * Math.sin(Math.PI * Math.min(1, atk * 1.15));
        hy = (atk - 0.5) * 1.6; c.body.rotation.y += (atk - 0.5) * -0.35;
      } else if (v === 'parasaur') {                  // tarik kepala ke belakang, lalu menyundul dengan jambul
        const pull = atk < 0.35 ? atk / 0.35 : Math.max(0, 1 - (atk - 0.35) / 0.15), th = atk < 0.35 ? 0 : Math.sin(Math.PI * Math.min(1, (atk - 0.35) / 0.65));
        c.headPivot.position.z = -0.85 + 0.35 * pull - 0.55 * th; c.headPivot.rotation.x = -0.35 * pull + 0.65 * th;
        if (c.jaw) c.jaw.rotation.x = -0.18 * th;
        c.body.rotation.x = b0 - 0.1 * pull + 0.12 * th;
      } else {                                        // Vosil: sodokan lurus standar
        c.headPivot.position.z = -0.85 - 0.5 * s;
        c.headPivot.rotation.x = 0.4 * s;
        if (c.jaw) c.jaw.rotation.x = -0.7 * Math.sin(Math.PI * Math.min(1, atk * 1.15));
      }
    } else {
      c.headPivot.position.z = -0.85;
      c.headPivot.rotation.x = -c.body.rotation.x * 0.8 + Math.sin(phase * 2) * 0.04 * r;       // kepala menyeimbangkan badan
      if (c.jaw) c.jaw.rotation.x = approach(c.jaw.rotation.x, (v ? -0.06 : -0.14) - 0.04 * Math.sin(t * 2.1), 12);       // Vosil: mulut sedikit terbuka seperti referensi
    }
    c.headPivot.rotation.y = hy;
  }

  // Triceratops: berkaki empat, berkepala berpelindung dengan tiga tanduk (menghadap -Z)
  function makeTrike(p, scale) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const mBody = smoothStd(p.body), mDark = smoothStd(p.dark), mFrill = smoothStd(p.light), mHorn = smoothStd(0xf5f0e1);
    const white = std(0xffffff, { flatShading: false }), black = std(0x111111, { flatShading: false });
    const part = (geo, mat, x, y, z, parent) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      (parent || body).add(m);
      return m;
    };
    const torso = part(new THREE.SphereGeometry(0.75, 10, 8), mBody, 0, 1.15, 0.1);
    torso.scale.set(0.95, 0.85, 1.45);
    const belly = part(new THREE.SphereGeometry(0.6, 8, 6), mFrill, 0, 0.95, 0.1);
    belly.scale.set(0.9, 0.6, 1.3);

    const legs4 = [];
    for (const [x, z] of [[-0.5, -0.65], [0.5, -0.65], [-0.5, 0.8], [0.5, 0.8]]) {
      const hip = new THREE.Group();
      hip.position.set(x, 0.85, z);
      body.add(hip);
      part(new THREE.CylinderGeometry(0.2, 0.16, 0.85, 7), mDark, 0, -0.42, 0, hip);
      part(rbox(0.36, 0.14, 0.5), mDark, 0, -0.85, -0.05, hip);
      legs4.push(hip);
    }

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 1.15, -1.25);
    body.add(headPivot);
    part(new THREE.SphereGeometry(0.46, 10, 8), mBody, 0, 0, 0, headPivot);
    part(rbox(0.34, 0.3, 0.5), mDark, 0, -0.12, -0.42, headPivot);     // paruh
    const frill = part(new THREE.CylinderGeometry(0.95, 0.95, 0.1, 14), mFrill, 0, 0.3, 0.4, headPivot);
    frill.rotation.x = -1.2;                                                              // perisai di belakang kepala
    for (const sx of [-1, 1]) {
      const horn = part(new THREE.ConeGeometry(0.09, 0.75, 6), mHorn, sx * 0.3, 0.3, -0.45, headPivot);
      horn.rotation.x = -1.25;                                                            // tanduk menunjuk ke depan
      part(new THREE.SphereGeometry(0.09, 8, 6), white, sx * 0.34, 0.1, -0.2, headPivot);
      part(new THREE.SphereGeometry(0.05, 6, 6), black, sx * 0.4, 0.1, -0.24, headPivot);
    }
    const nose = part(new THREE.ConeGeometry(0.07, 0.35, 6), mHorn, 0, 0.08, -0.72, headPivot);
    nose.rotation.x = -1.0;
    const tail = part(new THREE.ConeGeometry(0.25, 1.2, 6), mDark, 0, 1.0, 1.55);
    tail.rotation.x = 1.45;

    root.scale.setScalar(scale);
    mergeTree(root);
    outlineTree(root);
    return { root, body, headPivot, legs4, tail, mats: [mBody, mDark, mFrill], isTrike: true, hz: -1.25, graze: 0.3, stride: 0.55 };
  }

  function poseTrike(c, phase, run, atk, t) {
    const r = c.runS = approach(c.runS === undefined ? run : c.runS, run, 8);
    const offs = [0, Math.PI, Math.PI, 0];
    const hz = c.hz === undefined ? -1.25 : c.hz, graze = c.graze === undefined ? 0.3 : c.graze;
    for (let i = 0; i < 4; i++) c.legs4[i].rotation.x = Math.sin(phase * 0.9 + offs[i]) * (c.stride || 0.55) * r;
    c.body.position.y = Math.abs(Math.sin(phase * 0.9)) * 0.05 * r + Math.sin(t * 1.5) * 0.015 * (1 - r);
    c.body.rotation.z = Math.sin(phase * 0.9) * 0.03 * r;                       // berat badan berpindah saat melangkah
    c.body.rotation.y = Math.sin(phase * 0.9 + 1.5) * 0.035 * r;
    c.tail.rotation.y = Math.sin(t * 1.4) * 0.2 + Math.sin(phase * 0.9) * 0.15 * r;
    if (atk >= 0) {                                       // menyeruduk dengan tanduk
      const s = Math.sin(Math.PI * atk);
      c.headPivot.position.z = hz - 0.45 * s;
      c.headPivot.rotation.x = 0.35 * s;
    } else {
      c.headPivot.position.z = hz;
      const rest = graze + 0.2 * Math.sin(t * 1.3) * (graze > 0.1 ? 1 : 0.3);     // diam: menunduk makan
      const walk = Math.sin(phase * 0.9) * 0.05;
      c.headPivot.rotation.x = rest * (1 - Math.min(1, r * 3)) + walk * Math.min(1, r * 3);
    }
  }

  // Herbivora berkaki empat: stegosaurus, ankylosaurus, brachiosaurus, diplodocus (menghadap -Z)
  function makeQuad(p, scale, kind) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const mBody = smoothStd(p.body), mDark = smoothStd(p.dark), mLight = smoothStd(p.light), mPlate = smoothStd(p.plate || p.light);
    const white = std(0xffffff, { flatShading: false }), black = std(0x111111, { flatShading: false });
    const part = (geo, mat, x, y, z, parent) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      (parent || body).add(m);
      return m;
    };
    const big = kind === 'brachio' || kind === 'diplo';
    const legL = kind === 'brachio' ? 1.5 : kind === 'diplo' ? 1.25 : kind === 'stego' ? 0.8 : 0.55;
    const ty = legL + 0.35;
    const tsc = { stego: [0.85, 0.8, 1.5], anky: [1.25, 0.6, 1.4], brachio: [0.95, 0.9, 1.5], diplo: [0.85, 0.8, 1.6] }[kind];
    const torso = part(new THREE.SphereGeometry(0.75, 10, 8), mBody, 0, ty, 0.1);
    torso.scale.set(tsc[0], tsc[1], tsc[2]);
    const belly = part(new THREE.SphereGeometry(0.6, 8, 6), mLight, 0, ty - 0.2, 0.1);
    belly.scale.set(tsc[0] * 0.9, 0.55, tsc[2] * 0.88);

    const lx = kind === 'anky' ? 0.7 : 0.5, rT = big ? 0.28 : 0.2;
    const legs4 = [];
    for (const [x, z, f] of [[-lx, -0.7, 1], [lx, -0.7, 1], [-lx, 0.85, 0], [lx, 0.85, 0]]) {
      const L = legL + (kind === 'brachio' && f ? 0.3 : 0);
      const hip = new THREE.Group();
      hip.position.set(x, L, z);
      body.add(hip);
      part(new THREE.CylinderGeometry(rT, rT * 0.8, L, 7), mDark, 0, -L / 2, 0, hip);
      part(rbox(rT * 1.8, 0.16, rT * 2.3), mDark, 0, -L, -0.05, hip);
      legs4.push(hip);
    }

    const headPivot = new THREE.Group();
    const eye = (sx, y, z, r) => {
      part(new THREE.SphereGeometry(r, 8, 6), white, sx, y, z, headPivot);
      part(new THREE.SphereGeometry(r * 0.55, 6, 6), black, sx * 1.15, y, z - r * 0.5, headPivot);
    };
    const tail = new THREE.Group();
    body.add(tail);
    let hz, hy, graze = 0.05, stride = 0.55, tailLen = 1.5;

    if (kind === 'stego') {
      hz = -1.45; hy = 0.95; graze = 0.4;
      headPivot.position.set(0, hy, hz); body.add(headPivot);
      part(new THREE.SphereGeometry(0.32, 8, 6), mBody, 0, 0, 0, headPivot);
      part(rbox(0.26, 0.24, 0.46), mDark, 0, -0.08, -0.34, headPivot);
      eye(0.2, 0.1, -0.15, 0.07);
      eye(-0.2, 0.1, -0.15, 0.07);
      for (let i = 0; i < 7; i++) {                                   // lempengan di sepanjang punggung
        const z = -0.8 + i * 0.3, hh = 0.95 - Math.abs(i - 3) * 0.14;
        const topY = ty + 0.64 * Math.sqrt(Math.max(0.08, 1 - (z / 1.1) * (z / 1.1)));
        const pl = part(new THREE.ConeGeometry(0.36, hh, 4), mPlate, 0, topY + hh * 0.4, z);
        pl.scale.x = 0.22;
        pl.rotation.y = Math.PI / 4;
      }
      tailLen = 1.6;
      for (const [z, sy] of [[0.7, 1], [1.15, 1.1]]) {                // duri di ujung ekor
        for (const sx of [-1, 1]) {
          const sp = part(new THREE.ConeGeometry(0.07, 0.6, 5), mPlate, sx * 0.1, 0.1, z, tail);
          sp.rotation.x = 0.9 * sy; sp.rotation.z = -sx * 0.45;
        }
      }
    } else if (kind === 'anky') {
      hz = -1.4; hy = 0.85; graze = 0.35; stride = 0.45;
      headPivot.position.set(0, hy, hz); body.add(headPivot);
      part(rbox(0.7, 0.32, 0.64), mBody, 0, 0, 0, headPivot);
      part(rbox(0.54, 0.18, 0.34), mDark, 0, -0.12, -0.38, headPivot);
      for (const sx of [-1, 1]) {
        const hn = part(new THREE.ConeGeometry(0.1, 0.4, 5), mPlate, sx * 0.34, 0.12, 0.2, headPivot);
        hn.rotation.z = -sx * 0.9;
        eye(sx * 0.3, 0.1, -0.2, 0.07);
      }
      for (let i = 0; i < 5; i++) {                                   // baju besi: tonjolan tulang
        for (const cx of [-0.5, 0, 0.5]) {
          const z = -0.8 + i * 0.42;
          const topY = ty + 0.45 * Math.sqrt(Math.max(0.2, 1 - (z / 1.05) * (z / 1.05)));
          part(new THREE.ConeGeometry(0.13, 0.3, 5), mPlate, cx * 0.85, topY + 0.05, z);
        }
      }
      tailLen = 1.4;
      const club = part(new THREE.SphereGeometry(0.4, 8, 6), mPlate, 0, 0, 1.55, tail);   // gada di ujung ekor
      club.scale.set(1.5, 0.8, 0.9);
    } else if (kind === 'brachio') {
      const top = 4.4, y0 = ty + 0.2, dz = -1.0;
      const neck = part(new THREE.CylinderGeometry(0.14, 0.3, Math.hypot(top - y0, dz), 7), mBody, 0, (top + y0) / 2, -1.0 + dz / 2 - 0.0);
      neck.rotation.x = -Math.atan2(-dz, top - y0);
      hz = -2.1; hy = top + 0.1; stride = 0.35;
      headPivot.position.set(0, hy, hz); body.add(headPivot);
      part(new THREE.SphereGeometry(0.3, 8, 6), mBody, 0, 0, 0, headPivot);
      part(rbox(0.28, 0.24, 0.44), mDark, 0, -0.08, -0.3, headPivot);
      eye(0.2, 0.1, -0.12, 0.07);
      eye(-0.2, 0.1, -0.12, 0.07);
      tailLen = 2.4;
    } else {                                                          // diplo
      const y0 = ty + 0.1, top = 2.7, z0 = -1.1, z1 = -3.7;
      const len = Math.hypot(top - y0, z1 - z0);
      const neck = part(new THREE.CylinderGeometry(0.12, 0.28, len, 7), mBody, 0, (top + y0) / 2, (z0 + z1) / 2);
      neck.rotation.x = -Math.atan2(z0 - z1, top - y0);
      hz = z1 - 0.1; hy = top + 0.05; stride = 0.4;
      headPivot.position.set(0, hy, hz); body.add(headPivot);
      part(new THREE.SphereGeometry(0.26, 8, 6), mBody, 0, 0, 0, headPivot);
      part(rbox(0.24, 0.22, 0.4), mDark, 0, -0.07, -0.28, headPivot);
      eye(0.17, 0.09, -0.1, 0.06);
      eye(-0.17, 0.09, -0.1, 0.06);
      tailLen = 3.6;
    }

    tail.position.set(0, ty, 0.95);
    const tm = part(new THREE.ConeGeometry(big ? 0.32 : 0.28, tailLen, 6), mDark, 0, 0, tailLen / 2, tail);
    tm.rotation.x = Math.PI / 2;

    root.scale.setScalar(scale);
    mergeTree(root);
    outlineTree(root);
    return { root, body, headPivot, legs4, tail, mats: [mBody, mDark, mLight], isTrike: true, hz, graze, stride };
  }

  const PAL_PLAYER = { body: 0x93b97a, dark: 0x7aa062, light: 0xd8dba8, spike: 0xe6c995, eye: 0xffffff, pupil: 0x111111 };
  const PTYPES = {
    raptor: {
      name: 'Raptor', hp: 34, speed: 7.8, wander: 2.2, dmg: 9, detect: 24, reach: 1.9,
      scale: 0.95, reward: 6, food: 25, windup: 0.35, cd: 1.1,
      pal: { body: 0xe0852d, dark: 0x8f4312, light: 0xffd19a, spike: 0x5d2a0a, eye: 0xffe14d, pupil: 0x111111 }
    },
    rex: {
      name: 'T-Rex', hp: 140, speed: 6.6, wander: 1.8, dmg: 24, detect: 30, reach: 3.3,
      scale: 2.0, reward: 30, food: 60, windup: 0.55, cd: 1.8,
      pal: { body: 0x9a3d30, dark: 0x4d1c15, light: 0xd9a48f, spike: 0x2b0f0b, eye: 0xffe14d, pupil: 0x111111 }
    },
    // hewan lain (tidak ikut dihitung sebagai predator):
    gallim: {                       // penakut: kabur jika didekati, daging enak
      name: 'Gallimimus', hp: 22, speed: 8.6, wander: 1.8, dmg: 0, detect: 0, reach: 0,
      scale: 0.85, reward: 0, food: 30, windup: 0, cd: 0, timid: true, fleeDist: 11,
      pal: { body: 0xd9c48f, dark: 0x8c7a4a, light: 0xf5ead0, spike: 0xc0603f, eye: 0xffffff, pupil: 0x111111 }
    },
    velo: {                         // kecil, sangat gesit, berburu berpasangan
      name: 'Velociraptor', hp: 26, speed: 9.4, wander: 2.4, dmg: 8, detect: 26, reach: 1.9,
      scale: 0.8, reward: 5, food: 20, windup: 0.28, cd: 0.9, variant: 'velo', pack: true,
      pal: { body: 0x607d8b, dark: 0x37474f, light: 0xcfd8dc, spike: 0xff7043, eye: 0xffee58, pupil: 0x111111 }
    },
    carno: {                        // cepat, bertanduk seperti banteng
      name: 'Carnotaurus', hp: 95, speed: 8.0, wander: 2.0, dmg: 18, detect: 28, reach: 2.7,
      scale: 1.5, reward: 18, food: 50, windup: 0.4, cd: 1.4, variant: 'carno',
      pal: { body: 0x5d4037, dark: 0x2e1f1a, light: 0xbcaaa4, spike: 0xd84315, eye: 0xffee58, pupil: 0x111111 }
    },
    spino: {                        // suka air: lebih cepat saat berada di kolam
      name: 'Spinosaurus', hp: 170, speed: 6.2, wander: 1.8, dmg: 26, detect: 30, reach: 3.4,
      scale: 2.2, reward: 36, food: 70, windup: 0.55, cd: 1.8, variant: 'spino', aqua: true,
      pal: { body: 0x2e7d6b, dark: 0x14463b, light: 0xb2dfdb, spike: 0xe65100, eye: 0xffee58, pupil: 0x111111 }
    },
    parasaur: {                     // penakut, kabur kalau didekati
      name: 'Parasaurolophus', hp: 40, speed: 8.0, wander: 1.6, dmg: 0, detect: 0, reach: 0,
      scale: 1.35, reward: 0, food: 45, windup: 0, cd: 0, timid: true, fleeDist: 12, variant: 'parasaur',
      pal: { body: 0x5c9eae, dark: 0x2f5f6e, light: 0xe0f2f1, spike: 0xff8a65, eye: 0xffffff, pupil: 0x111111 }
    },
    stego: {                        // netral: ekornya berduri
      name: 'Stegosaurus', hp: 130, speed: 5.2, wander: 1.3, dmg: 20, detect: 14, reach: 3.2, hitExtra: 0.5,
      scale: 1.3, reward: 0, food: 70, windup: 0.45, cd: 1.8, neutral: true, model: 'stego',
      pal: { body: 0x6d8b3a, dark: 0x3e4f1f, light: 0xd7e3a5, plate: 0xe65100, eye: 0xffffff, pupil: 0x111111 }
    },
    anky: {                         // netral: berbaju zirah, ekor gada
      name: 'Ankylosaurus', hp: 160, speed: 4.8, wander: 1.2, dmg: 22, detect: 14, reach: 3.1, hitExtra: 0.5,
      scale: 1.2, reward: 0, food: 80, windup: 0.5, cd: 2.0, neutral: true, model: 'anky',
      pal: { body: 0x8d6e63, dark: 0x4e342e, light: 0xd7ccc8, plate: 0xa1887f, eye: 0xffffff, pupil: 0x111111 }
    },
    brachio: {                      // raksasa berleher panjang, damai kecuali diserang
      name: 'Brachiosaurus', hp: 260, speed: 4.4, wander: 1.0, dmg: 20, detect: 14, reach: 4.2, hitExtra: 1.4,
      scale: 1.0, reward: 0, food: 100, windup: 0.6, cd: 2.2, neutral: true, model: 'brachio', giant: true,
      pal: { body: 0x9ea65b, dark: 0x5b6133, light: 0xe6e3b3, eye: 0xffffff, pupil: 0x111111 }
    },
    diplo: {                        // leher dan ekor sangat panjang
      name: 'Diplodocus', hp: 220, speed: 4.8, wander: 1.1, dmg: 18, detect: 14, reach: 4.6, hitExtra: 1.8,
      scale: 1.0, reward: 0, food: 90, windup: 0.55, cd: 2.0, neutral: true, model: 'diplo', giant: true,
      pal: { body: 0xb58f6b, dark: 0x6d4f36, light: 0xefe0c8, eye: 0xffffff, pupil: 0x111111 }
    },
    trike: {                        // netral: dibiarkan aman, tapi melawan kalau diserang
      name: 'Triceratops', hp: 90, speed: 6.0, wander: 1.4, dmg: 14, detect: 16, reach: 2.8,
      scale: 1.1, reward: 0, food: 55, windup: 0.5, cd: 1.7, neutral: true, model: 'trike',
      pal: { body: 0x6f8fa8, dark: 0x3e5568, light: 0xc9a46b, spike: 0x000000, eye: 0xffffff, pupil: 0x111111 }
    }
  };

  // ---------- Partikel ----------
  function makePool(n, geo, mat) {
    const arr = [];
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      arr.push({ mesh, life: 1, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, base: 1 });
    }
    return arr;
  }
  function emitTo(pool, x, y, z, o) {
    const p = pool.find((q) => q.life >= q.max);
    if (!p) return;
    p.life = 0; p.max = o.max; p.x = x; p.y = y; p.z = z; p.floor = heightAt(x, z) + 0.05;
    p.vx = o.vx; p.vy = o.vy; p.vz = o.vz; p.base = o.base;
    p.mesh.visible = true;
    p.mesh.position.set(x, y, z);
    p.mesh.scale.setScalar(p.base);
  }
  function stepPool(pool, dt, gravity) {
    for (const p of pool) {
      if (p.life >= p.max) continue;
      p.life += dt;
      if (p.life >= p.max) { p.mesh.visible = false; continue; }
      p.vy -= gravity * dt;
      p.x += p.vx * dt; p.y = Math.max(p.floor || 0.05, p.y + p.vy * dt); p.z += p.vz * dt;
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.scale.setScalar(Math.max(0.01, p.base * (1 - p.life / p.max)));
    }
  }
  const dust = makePool(40, new THREE.IcosahedronGeometry(0.15, 0), new THREE.MeshBasicMaterial({ color: 0xe6d5ae }));
  const sparks = makePool(40, new THREE.IcosahedronGeometry(0.12, 0), new THREE.MeshBasicMaterial({ color: 0xffa726 }));
  function puff(n, x, z, spread) {
    const gy = heightAt(x, z);
    for (let i = 0; i < n; i++) emitTo(dust, x + rand(-spread, spread), gy + 0.12, z + rand(-spread, spread),
      { max: rand(0.35, 0.6), vx: rand(-0.6, 0.6), vy: rand(0.8, 1.8), vz: rand(-0.6, 0.6), base: rand(0.7, 1.4) });
  }
  function burst(n, x, y, z) {
    y += heightAt(x, z);
    for (let i = 0; i < n; i++) emitTo(sparks, x, y, z,
      { max: rand(0.3, 0.6), vx: rand(-3, 3), vy: rand(1.5, 4), vz: rand(-3, 3), base: rand(0.6, 1.3) });
  }

  // ---------- State game ----------
  // gaya serangan tiap spesies:
  //  lunge  = menerkam cepat ke depan,  bite = gigitan berat dengan sedikit maju,
  //  charge = menyeruduk lurus jauh (hindari ke samping / lompat),  sweep = sapuan ke segala arah (lompat atau menjauh)
  Object.assign(PTYPES.raptor, { atk: 'lunge', lunge: 3.0, windup: 0.4, dmg: 11, recover: 0.5 });
  Object.assign(PTYPES.velo, { atk: 'lunge', lunge: 3.4, windup: 0.34, dmg: 9, recover: 0.45 });
  Object.assign(PTYPES.rex, { atk: 'bite', lunge: 2.4, windup: 0.62, dmg: 28, recover: 0.7 });
  Object.assign(PTYPES.carno, { atk: 'charge', lunge: 9, windup: 0.8, dmg: 24, recover: 1.1, cd: 2.4 });
  Object.assign(PTYPES.spino, { atk: 'sweep', sweepR: 4.8, windup: 0.65, dmg: 28, recover: 0.8 });
  Object.assign(PTYPES.stego, { atk: 'sweep', sweepR: 3.8, recover: 0.8 });
  Object.assign(PTYPES.anky, { atk: 'sweep', sweepR: 3.6, recover: 0.8 });
  Object.assign(PTYPES.brachio, { atk: 'sweep', sweepR: 5.0, recover: 0.9 });
  Object.assign(PTYPES.diplo, { atk: 'sweep', sweepR: 5.4, recover: 0.9 });
  Object.assign(PTYPES.trike, { atk: 'lunge', lunge: 2.6, recover: 0.7 });

  // ---------- Arena online (TAHAP UJI 1): pemain lain terlihat; belum ada serangan & poin ----------
  let arenaOn = false;
  const addC = (n) => { if (!arenaOn) save.coins += n; };              // di arena uji koin tidak masuk dompet/poin
  const remoteViews = new Map();
  // tampilan NPC server: dasar model dari PTYPES, ukuran & warna disesuaikan
  const NPC_LOOK = {
    raptor: { pt: 'raptor' }, para: { pt: 'parasaur' }, anky: { pt: 'anky' }, spinoa: { pt: 'spino' },
    deino: { pt: 'velo', sc: 1.0, pal: { body: 0x8d3b2f, dark: 0x4e1f18, light: 0xe8b9a5, spike: 0xffca28, eye: 0xff5252, pupil: 0x111111 } },
    compy: { pt: 'velo', sc: 0.5, pal: { body: 0x9ccc65, dark: 0x558b2f, light: 0xf0f4c3, spike: 0xff7043, eye: 0xffee58, pupil: 0x111111 } },
    micro: { pt: 'velo', sc: 0.45, pal: { body: 0x283593, dark: 0x1a237e, light: 0x90caf9, spike: 0x4dd0e1, eye: 0xffee58, pupil: 0x111111 } },
    allo: { pt: 'carno', sc: 1.7, pal: { body: 0xb5651d, dark: 0x5d3410, light: 0xf3d9b1, spike: 0x3e2723, eye: 0xffc107, pupil: 0x111111 } },
    argen: { pt: 'brachio', sc: 2.4 }
  };
  function npcModel(char) {
    const L = NPC_LOOK[char] || NPC_LOOK.raptor, def = PTYPES[L.pt], pal = L.pal || def.pal, sc = L.sc || def.scale;
    const c = def.model === 'trike' ? makeTrike(pal, sc) : def.model ? makeQuad(pal, sc, def.model) : makeCreature(Object.assign({ scale: sc, variant: def.variant }, pal));
    return { c, sc };
  }
  function nameSprite(txt) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    const g = cv.getContext('2d'); g.font = 'bold 30px sans-serif'; g.textAlign = 'center';
    g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(txt, 128, 42); g.fillStyle = '#fff'; g.fillText(txt, 128, 42);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
    sp.scale.set(3.4, 0.85, 1); sp.renderOrder = 10;
    return sp;
  }
  // ukuran bar nyawa mengikuti ukuran dino (dino kecil -> bar kecil)
  const hpK = (sc) => Math.max(0.46, Math.min(1.0, 0.36 + 0.3 * sc));
  function hpSprite() {                                               // bar nyawa gaya MOBA: lencana level + bar bersegmen
    const cv = document.createElement('canvas'); cv.width = 192; cv.height = 32;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
    sp.scale.set(2.2, 0.37, 1); sp.renderOrder = 10; sp.userData.cv = cv;
    return sp;
  }
  function drawHp(sp, hp, self, lv) {
    const cv = sp.userData.cv, g = cv.getContext('2d'), f = Math.max(0, Math.min(1, hp / 100));
    g.clearRect(0, 0, 192, 32);
    g.fillStyle = 'rgba(6,12,18,.82)'; g.fillRect(28, 6, 160, 20);                 // latar bar
    const col = self ? (f > 0.3 ? '#3ddc5a' : '#ffb300') : (f > 0.3 ? '#e5392f' : '#ff7043');
    g.fillStyle = col; g.fillRect(31, 9, 154 * f, 14);
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(31, 9, 154 * f, 4);
    g.fillStyle = 'rgba(0,0,0,.55)'; for (let i = 1; i < 10; i++) g.fillRect(31 + 15.4 * i, 9, 1.5, 14);   // garis tiap 10 nyawa
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.5; g.strokeRect(28.5, 6.5, 159, 19);
    g.beginPath(); g.arc(16, 16, 14, 0, Math.PI * 2); g.fillStyle = '#16212b'; g.fill(); g.lineWidth = 3; g.strokeStyle = self ? '#ffca28' : '#cfd8dc'; g.stroke();   // lencana level
    g.fillStyle = '#fff'; g.font = 'bold 17px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(lv || 1), 16, 17);
    sp.material.map.needsUpdate = true;
  }
  // nama + bar nyawa di atas dino sendiri (selalu tampil saat bermain)
  const myNameSp = nameSprite('...'), myHb = hpSprite(); let myTagName = '', myTagHp = -1, myTagLv = -1;
  myNameSp.visible = myHb.visible = false; scene.add(myNameSp); scene.add(myHb);
  // timer mode kuat (telur) di atas bar nyawa dino
  const myPow = (() => { const cv = document.createElement('canvas'); cv.width = 160; cv.height = 28; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false })); sp.scale.set(2.6, 0.45, 1); sp.renderOrder = 11; sp.visible = false; sp.userData.cv = cv; scene.add(sp); return sp; })();
  let myPowKey = -1;
  function drawPow(left) {
    const cv = myPow.userData.cv, g = cv.getContext('2d'), f = Math.max(0, Math.min(1, left / POWER_TIME));
    g.clearRect(0, 0, 160, 28); g.fillStyle = 'rgba(6,12,18,.7)'; g.fillRect(2, 4, 156, 20);
    g.fillStyle = left < 2.5 ? '#ff5252' : '#ff9800'; g.fillRect(4, 6, 152 * f, 16);
    g.fillStyle = '#fff'; g.font = 'bold 15px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🥚 ' + Math.ceil(left) + ' s', 80, 15);
    myPow.material.map.needsUpdate = true;
  }
  function updateMyTag() {
    const show = state === 'playing' && !(hero.root.visible === false);
    myNameSp.visible = myHb.visible = show; if (!show) { myPow.visible = false; return; }
    const nm = playerName();
    if (nm !== myTagName) { myTagName = nm; const sp = nameSprite(nm); myNameSp.material.map.dispose(); myNameSp.material.map = sp.material.map; sp.material.dispose(); }
    const hp = Math.round(player.hp);
    if (hp !== myTagHp || player.level !== myTagLv) { myTagHp = hp; myTagLv = player.level; drawHp(myHb, player.hp, true, player.level); }
    const h = (player.gy || 0) + player.y + 2.9 * scaleNow / 1.1;
    const kk = hpK(scaleNow / 1.1); myHb.scale.set(3.3 * kk * 0.68, 0.55 * kk * 0.68, 1);
    myHb.position.set(player.x, h + 0.3 + 0.15 * kk, player.z); myNameSp.position.set(player.x, h + 1.0, player.z);
    myPow.visible = powerLeft > 0;
    if (powerLeft > 0) { const key = Math.round(powerLeft * 5); if (key !== myPowKey) { myPowKey = key; drawPow(powerLeft); } myPow.position.set(player.x, h + 1.55, player.z); }
  }
  // nama pemain pilihan sendiri (disimpan di perangkat, maks 14 huruf/angka/spasi/_-.)
  const NAME_KEY = 'vosil_pname_v1';
// ---- filter nama pemain (kata kasar, pelecehan, dan peniru admin) ----
  const BAD_LONG = 'anjing anjrit bangsat bajingan brengsek keparat kampret sialan kontol memek ngentot entot jembut itil pantek jancok jancuk cuk pelacur lonte jablay bokep tolol goblok idiot  babi bangke tai kimak perek ngewe sange coli fuck fuk shit bitch cunt dick cock pussy nigger nigga fag faggot retard rape rapist whore slut bastard asshole nazi hitler porn sex'.split(' ');
  const BAD_SHORT = ['cuk', 'tai', 'sex', 'dick', 'cock', 'fuk', 'itil', 'coli', 'sange', 'ngewe', 'babi', 'nazi', 'porn'];       // kata pendek: hanya bila berdiri sendiri
  const IMPERSON = 'admin moderator official staff vosilteam'.split(' ');
  function nameAllowed(name) {
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
  // (daftar kata sama dengan server/arena-room.js; server tetap memeriksa ulang)
  const cleanPName = (s) => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 14);
  let pname = ''; try { pname = cleanPName(localStorage.getItem(NAME_KEY)); if (!nameAllowed(pname)) pname = ''; } catch (e) { /* abaikan */ }
  const autoName = 'Dino' + Math.floor(Math.random() * 900 + 100);
  const playerName = () => (pname && nameAllowed(pname) ? pname : '') || (Wallet.address ? Wallet.address.slice(2, 6) + Wallet.address.slice(-3) : autoName);
  { const inp = $('nameIn'); if (inp) { inp.value = pname; inp.addEventListener('input', () => { pname = cleanPName(inp.value); try { localStorage.setItem(NAME_KEY, pname); } catch (e) { /* abaikan */ } }); inp.addEventListener('blur', () => { if (pname && !nameAllowed(pname)) { pname = ''; try { localStorage.setItem(NAME_KEY, ''); } catch (e) { /* abaikan */ } toast(t('nm_bad'), 2.6); } inp.value = pname; }); ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => inp.addEventListener(ev, (e) => e.stopPropagation())); } }
  const pName = (id) => { const r = Arena.remotes.get(id); return r ? r.name : 'Dino'; };
  const remoteRings = [];
  function pvpHurt(m) {                                                            // aku terkena serangan pemain lain (server yang memutuskan)
    if (state !== 'playing' || !arenaOn) return;
    player.hp = Math.max(0, m.hp);
    showDmg(player.x, (player.gy || 0) + player.y + 2.3 * scaleNow / 1.1, player.z, '-' + Math.round(m.dmg), 'hurt', 1 + Math.min(0.5, m.dmg / 40));
    starBurst(player.x, (player.gy || 0) + player.y + 1.3 * scaleNow / 1.1, player.z, 6, 'hurt');
    player.invuln = 0.7; player.lastDmg = 0;
    const dx = player.x - m.x, dz = player.z - m.z, d = Math.hypot(dx, dz) || 1, kb = m.kb > 0 ? m.kb : 0.9;
    player.x += (dx / d) * kb; player.z += (dz / d) * kb;
    if (m.stun > 0) { stunT = m.stun / 1000; skillWind = null; dashS = null; if (aim.on) aimClear(); showDmg(player.x, (player.gy || 0) + player.y + 3.3 * scaleNow / 1.1, player.z, '💫', 'crit', 1.3); }
    if (m.slow > 0) { slowT = (m.slowMs || 2000) / 1000; slowMul = 1 - m.slow; showDmg(player.x, (player.gy || 0) + player.y + 3.1 * scaleNow / 1.1, player.z, '🐌', 'crit', 1.1); }
    hurtT = 0.25; shake = Math.max(shake, m.kb >= 3 ? 0.85 : 0.6);
    if (m.k && m.k !== 'bite') GameAudio.sfx.skillHit(m.k, m.dmg / 18, sndAt(m.x, m.z).pan); else GameAudio.sfx.hit();
    GameAudio.sfx.dino(save.char, 'hurt', 0.9);
    if (player.hp <= 0) die(t('ar_killed', { n: pName(m.by) }));
  }
  function pvpHit(m) {                                                              // seranganku mengenai pemain lain
    const v = remoteViews.get(m.to); if (!v) return;
    const r = Arena.remotes.get(m.to); if (!r) return;
    v.hitT = 0.18;                                                                  // lawan 'tersentak' sesaat
    hitFeel(!!(m.k && m.k !== 'bite'));
    if (m.stun > 0) showDmg(r.x, r.y + 3.2 * v.sc + 0.4, r.z, '💫', 'crit', 1.2);
    showDmg(r.x, r.y + 2.2 * v.sc + 0.4, r.z, '-' + Math.round(m.dmg), m.k === 'roar' ? 'crit' : 'hit', m.k === 'roar' ? 1.2 : 1);
    starBurst(r.x, r.y + 1.3 * v.sc, r.z, 5, 'hit');
    if (m.k && m.k !== 'bite') GameAudio.sfx.skillHit(m.k, m.dmg / 18, sndAt(r.x, r.z).pan); else GameAudio.sfx.hit();
  }
  // ----- kepuasan: ledakan koin + kombo kill beruntun -----
  let comboN = 0, comboAt = -99;
  function celebrateKill(x, y, z, gold) {
    comboN = clock - comboAt < 8 ? comboN + 1 : 1; comboAt = clock;
    starBurst(x, y + 1, z, 10 + Math.min(10, comboN * 2), 'gain');
    showDmg(x, y + 2.0, z, gold ? '🪙 +' + gold : '★', 'gain', 1.2);
    try { GameAudio.sfx.record(); } catch (e) { /* abaikan */ }
    const el = $('combo');
    if (el && comboN >= 2) { el.textContent = t('combo_n', { n: comboN }); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  }
  function pvpKill(m) {
    if (!arenaOn) return;
    const me = Arena.st.id;
    if (m.id === me) die(t('ar_killed', { n: m.bn }));
    else if (m.by === me) { toast(t('ar_you_kill', { n: m.nm }), 3); celebrateKill(player.x, (player.gy || 0) + player.y, player.z, 0); }
    else toast(t('ar_kill', { a: m.bn, b: m.nm }), 2.6);
  }
  function pvpRoar(id) {                                                            // cincin raungan pemain lain
    const r = Arena.remotes.get(id); if (!r || !r.seen) return;
    const mat = mRoar.clone(); mat.opacity = 0.4;
    const m = new THREE.Mesh(roarRingGeo, mat); m.position.set(r.x, r.y + 0.25, r.z); scene.add(m);
    remoteRings.push({ m, t: 0 });
  }
  function updateRemoteRings(dt) {
    for (let i = remoteRings.length - 1; i >= 0; i--) {
      const o = remoteRings[i]; o.t += dt;
      const f = Math.min(1, o.t / 0.6);
      o.m.scale.set(1 + f * 8.2, 1, 1 + f * 8.2); o.m.material.opacity = 0.4 * (1 - f) * (1 - f);
      if (f >= 1) { scene.remove(o.m); o.m.material.dispose(); remoteRings.splice(i, 1); }
    }
  }
  function dropRemote(id) {
    const v = remoteViews.get(id); if (!v) return;
    scene.remove(v.c.root); disposeTree(v.c.root); scene.remove(v.sp); scene.remove(v.hb);
    if (v.hb.material.map) v.hb.material.map.dispose(); v.hb.material.dispose();
    if (v.sp.material.map) v.sp.material.map.dispose(); v.sp.material.dispose();
    if (v.sh) { scene.remove(v.sh); if (v.sh.userData.unit && v.sh.geometry) v.sh.geometry.dispose(); }
    remoteViews.delete(id);
  }
  function clearRemotes() {
    for (const id of [...remoteViews.keys()]) dropRemote(id);
    for (const o of remoteRings) { scene.remove(o.m); o.m.material.dispose(); }
    remoteRings.length = 0;
    for (const b of bubbles) { scene.remove(b.sp); b.sp.material.dispose(); }
    bubbles.length = 0;
    for (const o of ringFx) { scene.remove(o.m); o.m.material.dispose(); }
    ringFx.length = 0;
    myEmote = { e: -1, t: 99 };
    teles.length = 0;
    skillWind = null; dashS = null; slowT = 0; slowMul = 1; stunT = 0;
  }
  function updateRemotes(dt) {
    if (!arenaOn || typeof Arena === 'undefined') { if (remoteViews.size) clearRemotes(); return; }
    for (const id of [...remoteViews.keys()]) if (!Arena.remotes.has(id)) dropRemote(id);
    for (const r of Arena.remotes.values()) {
      let v = remoteViews.get(r.id);
      if (!r.seen || !r.near) { if (v) { v.c.root.visible = false; v.sp.visible = false; v.hb.visible = false; if (v.sh) v.sh.visible = false; } continue; }
      if (!v) {
        const pl = r.npc ? { scale: (NPC_LOOK[r.char] ? (NPC_LOOK[r.char].sc || PTYPES[NPC_LOOK[r.char].pt].scale) : 1) } : (PLAYABLES[r.char] || PLAYABLES.vosil);
        const c = r.npc ? npcModel(r.char).c : makeCreature(Object.assign({ scale: pl.scale, variant: pl.variant }, pl.pal));
        const sp = nameSprite(r.name), sh = makeDynShadow(), hb = hpSprite();
        scene.add(c.root); scene.add(sp); scene.add(sh); scene.add(hb);
        v = { c, sp, sh, hb, hp: -1, pl, phase: 0, sc: r.npc ? pl.scale : pl.scale * lvScale(r.level), name: r.name };
        remoteViews.set(r.id, v);
      }
      v.c.root.visible = true; v.sp.visible = true; v.sh.visible = true; v.hb.visible = true;
      if (r.hp !== undefined && r.hp !== v.hp) { v.hp = r.hp; drawHp(v.hb, r.hp, !!(r.npc && r.fr), r.level); }
      if (r.buf && r.buf.length >= 1) {                              // tampilkan posisi sedikit di masa lalu (110-260 ms, menyesuaikan kestabilan jaringan), diinterpolasi antar data jaringan
        const rt = Arena.renderTime(), b = r.buf;
        let i = b.length - 1; while (i > 0 && b[i].at > rt) i--;
        const a0 = b[i], a1 = b[i + 1];
        if (a1 && rt >= a0.at) {
          const f = clamp((rt - a0.at) / Math.max(1, a1.at - a0.at), 0, 1);
          r.x = a0.x + (a1.x - a0.x) * f; r.y = a0.y + (a1.y - a0.y) * f; r.z = a0.z + (a1.z - a0.z) * f;
          let dy = a1.yaw - a0.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); r.dyaw = a0.yaw + dy * f;
        } else {                                                     // data terlambat: lanjutkan dengan kecepatan terakhir (maks 0,25 detik)
          const last = b[b.length - 1], ex = Math.min(0.25, Math.max(0, (rt - last.at) / 1000));
          r.x = last.x + r.vx * ex; r.z = last.z + r.vz * ex; r.y = last.y; r.dyaw = last.yaw;
        }
      } else {
        const k = Math.min(1, dt * 10);
        r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; r.z += (r.tz - r.z) * k; r.dyaw = r.yaw;
      }
      if (r.npc) r.y = r.char === 'micro' ? Math.max(heightAt(r.x, r.z), WL + 0.6) : heightAt(r.x, r.z);     // NPC server: tinggi tanah dihitung di sini (Microraptor melayang di atas air)
      const want = r.npc ? v.pl.scale : v.pl.scale * lvScale(r.level);
      v.sc += (want - v.sc) * Math.min(1, dt * 5);
      const spd = Math.hypot(r.vx, r.vz);
      v.phase += (spd * 1.5 + 1.2) * dt * (spd > 0.4 ? 1 : 0.3);
      const gnd = heightAt(r.x, r.z), air = r.y - gnd > 0.35 && !r.sw;
      v.c.root.scale.setScalar(v.sc);
      v.c.root.position.set(r.x, r.y, r.z);
      v.c.root.rotation.z = 0; v.c.root.rotation.y = r.dyaw !== undefined ? r.dyaw : r.yaw;
      if (v.skA) { v.skA.t += dt; if (v.skA.t >= v.skA.dur) v.skA = null; }
      if (v.c.isTrike) poseTrike(v.c, v.phase, clamp(spd / 6, 0, 1.3), r.atk >= 0 ? clamp(r.atk / 0.35, 0, 1) : -1, clock);
      else poseCreature(v.c, v.phase, clamp(spd / 6, 0, 1.3), air, 0, r.atk >= 0 ? clamp(r.atk / 0.35, 0, 1) : -1, clock, v.skA ? { id: v.skA.id, p: v.skA.t / v.skA.dur } : null);
      if (r.atk >= 0 && (v.lastAtk === undefined || v.lastAtk < 0)) spawnSlash(r.x, r.y, r.z, v.c.root.rotation.y, v.sc);   // lawan menyerang
      v.lastAtk = r.atk;
      if (v.em) { v.em.t += dt; const o = emoteOff(v.em.e, v.em.t); if (o) { v.c.root.position.y += o.dy * v.sc; v.c.root.rotation.y += o.dyaw; } else if (v.em.t > 2.2) v.em = null; }
      if (v.hitT > 0) { v.hitT -= dt; v.c.root.scale.setScalar(v.sc * (1 + 0.12 * Math.sin(Math.PI * Math.max(0, v.hitT) / 0.18))); }
      v.sp.position.set(r.x, r.y + 2.9 * v.sc + 0.95, r.z);
      { const kk = hpK(v.sc); v.hb.scale.set(3.3 * kk * 0.68, 0.55 * kk * 0.68, 1); v.hb.position.set(r.x, r.y + 2.9 * v.sc + 0.3 + 0.15 * kk, r.z); }
      v.sh.visible = !r.sw;
      placeShadow(v.sh, r.x, r.z, air ? gnd : r.y, 0.75 * v.sc, 1.9 * v.sc);
    }
  }
  const onlineBox = $('onlineBox'), onlineN = $('onlineN'), onlineMax = $('onlineMax'), onlinePing = $('onlinePing'), onlineOf = $('onlineOf');
  let onlineShown = -1;
  // jumlah pemain online di semua mode: detak ringan ke server tiap 40 dtk (tanpa koneksi permanen)
  let presN = 0, presT = 0;
  const presId = (() => { let a = ''; try { a = sessionStorage.getItem('vosil_pid') || ''; } catch (e) { /* abaikan */ } if (a.length < 16) { a = ''; for (let i = 0; i < 24; i++) a += Math.floor(Math.random() * 16).toString(16); try { sessionStorage.setItem('vosil_pid', a); } catch (e) { /* abaikan */ } } return a; })();
  function presBeat() {
    try { fetch('/api/presence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: presId }) }).then((r) => r.json()).then((j) => { if (j && j.ok) presN = j.n | 0; }).catch(() => {}); } catch (e) { /* abaikan */ }
  }

  // ---------- Daftar pemain online (ketuk tulisan Online) ----------
  const plistEl = $('plist');
  function plistRender() {
    if (!plistEl) return;
    const box = $('plistBody'); if (!box) return;
    const rows = [{ me: true, name: playerName() || 'Dino', char: save.char, level: player.level, d: 0 }];
    if (arenaOn && typeof Arena !== 'undefined') for (const r of Arena.remotes.values()) { if (r.npc) continue; rows.push({ me: false, name: r.name || 'Dino', char: r.char, level: r.level || 1, d: r.seen && r.near ? Math.round(Math.hypot(r.x - player.x, r.z - player.z)) : -1 }); }
    $('plistTitle').textContent = t('pl_title', { n: rows.length, m: arenaOn ? Arena.st.max : 1 });
    const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    box.innerHTML = rows.map((r) => '<div class="plRow' + (r.me ? ' me' : '') + '"><i></i><b>' + esc(r.name) + (r.me ? ' (' + esc(t('pl_you')) + ')' : '') + '</b><small>' + esc((PLAYABLES[r.char] || {}).name || '') + ' · Lv ' + (r.level | 0) + (r.d >= 0 && !r.me ? ' · ' + r.d + ' m' : '') + '</small></div>').join('');
    const pg = arenaOn && Arena.st.rtt ? Math.round(Arena.st.rtt) + ' ms' : '';
    $('plistFoot').textContent = arenaOn ? t('pl_foot', { p: pg }) : t('pl_solo');
  }
  let plistT = 0;
  function plistOpen(on) { if (!plistEl) return; plistEl.classList.toggle('on', on); clearInterval(plistT); if (on) { plistRender(); plistT = setInterval(plistRender, 1500); } }
  if (plistEl && onlineBox) {
    onlineBox.addEventListener('pointerdown', (e) => e.stopPropagation());
    onlineBox.addEventListener('click', (e) => { e.stopPropagation(); plistOpen(true); });
    plistEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    plistEl.addEventListener('click', (e) => { e.stopPropagation(); if (e.target === plistEl || e.target.id === 'plistX') plistOpen(false); });
  }
  function updateOnline(dt) {
    if (!onlineBox) return;
    if (dt) { presT -= dt; if (presT <= 0 && !(typeof document !== 'undefined' && document.hidden)) { presT = 40; presBeat(); } }
    const n = arenaOn && typeof Arena !== 'undefined' ? Arena.st.count : 0, pg = n && Arena.st.rtt ? Math.round(Arena.st.rtt / 10) * 10 : 0, shownN = n || (state === 'playing' ? presN : 0), key = n * 100000 + pg + shownN * 7 + (n ? 1 : 0);
    if (key === onlineShown) return;
    onlineShown = key;
    if (onlinePing) onlinePing.textContent = pg ? ' · ' + pg + ' ms' : '';
    onlineBox.classList.toggle('hidden', shownN === 0);
    if (onlineOf) onlineOf.style.display = n ? '' : 'none';
    if (emoteBar) { emoteBar.classList.toggle('hidden', n === 0); if (n === 0) emoOpen(false); }
    if (shownN) { onlineN.textContent = shownN; if (n) onlineMax.textContent = Arena.st.max; }
  }
  // ---------- Efek serangan ringan & emote ----------
  // goresan cakar/gigitan: busur cahaya singkat di depan penyerang (pool 8 mesh, tanpa partikel berat)
  const slashGeo = new THREE.RingGeometry(0.62, 1.0, 28, 1, -1.25, 2.5);       // busur lebar ~143 derajat, cukup tebal agar terlihat jelas
  const slashPool = [];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(slashGeo, new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false, side: THREE.DoubleSide }));
    m.visible = false; m.renderOrder = 9; scene.add(m); slashPool.push({ m, t: 9, sc: 1 });
  }
  let slashFlip = 1;
  function spawnSlash(x, y, z, yaw, sc, col) {
    starBurst(x - Math.sin(yaw) * 2.1 * Math.max(0.6, sc), y + 1.2 * Math.max(0.6, sc), z - Math.cos(yaw) * 2.1 * Math.max(0.6, sc), 4, 'hit');   // percikan selalu terlihat, kena atau tidak
    const o = slashPool.find((q) => q.t >= 0.3); if (!o) return;
    slashFlip = -slashFlip;
    o.t = 0; o.sc = Math.max(0.6, sc);
    o.m.material.color.setHex(col || 0xfff1c8);
    o.m.position.set(x - Math.sin(yaw) * 1.7 * o.sc, y + 1.2 * o.sc, z - Math.cos(yaw) * 1.7 * o.sc);
    o.m.rotation.set(0, yaw, -0.55 * slashFlip);
    o.m.visible = true;
  }
  function updateSlashes(dt) {
    for (const o of slashPool) {
      if (o.t >= 0.3) continue;
      o.t += dt;
      const f = Math.min(1, o.t / 0.3);
      o.m.scale.setScalar(o.sc * (1.1 + 1.0 * f)); o.m.material.opacity = 0.95 * (1 - f * f);
      if (f >= 1) o.m.visible = false;
    }
  }
  // cincin cahaya di kaki (dipakai emote), mengembang lalu memudar
  const ringFx = [];
  const ringFxGeo = new THREE.RingGeometry(0.85, 1, 40); ringFxGeo.rotateX(-Math.PI / 2);
  function fxRing(x, y, z, maxR, col, delay) {
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(ringFxGeo, mat); m.position.set(x, y + 0.2, z); m.visible = !delay; scene.add(m);
    ringFx.push({ m, t: -(delay || 0), maxR });
  }
  function updateRingFx(dt) {
    for (let i = ringFx.length - 1; i >= 0; i--) {
      const o = ringFx[i]; o.t += dt;
      if (o.t < 0) continue;
      o.m.visible = true;
      const f = Math.min(1, o.t / 0.9);
      o.m.scale.set(0.4 + f * o.maxR, 1, 0.4 + f * o.maxR); o.m.material.opacity = 0.7 * (1 - f);
      if (f >= 1) { scene.remove(o.m); o.m.material.dispose(); ringFx.splice(i, 1); }
    }
  }
  // emote: ikon siap pakai di atas kepala + gaya gerak. 2 = meledek (joget lompat), 0 = melambai, 3 = tantang duel
  const EMOTES = ['👋', '👍', '😂', '⚔️', '🏳️', '😱'];
  const bubbles = [];
  function emojiSprite(ch) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d'); g.font = '84px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 64, 70);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
    sp.scale.set(1.5, 1.5, 1); sp.renderOrder = 11;
    return sp;
  }
  // pantulan seperti bola: tiap pantulan lebih rendah & lebih singkat (gravitasi + kehilangan energi); selalu kembali tepat ke tanah
  const hopY = (el, h0, T0, k) => { let t = el, h = h0, T = T0; for (let i = 0; i < 8; i++) { if (t < T) { const u = t / T; return 4 * h * u * (1 - u); } t -= T; h *= k; T *= Math.sqrt(k); } return 0; };
  const emoteOff = (e, el) => {                                                        // el = detik sejak emote mulai -> {dy, dyaw}; semua gerak mulus (tanpa patah)
    if (el > 2.2) return null;
    if (e === 2) return { dy: hopY(el, 0.42, 0.52, 0.62), dyaw: 0.38 * Math.sin(el * 11) * Math.exp(-el * 1.1) };      // joget: memantul + goyang meredam seperti pegas
    if (e === 0) { if (el >= 1.2) return null; const env = Math.sin(Math.PI * el / 1.2); return { dy: 0.14 * env * (0.5 - 0.5 * Math.cos(el * 10.5)), dyaw: 0.14 * env * Math.sin(el * 5.2) }; }   // lambai: naik-turun halus
    if (e === 3) { if (el >= 0.8) return null; const u = el / 0.8; return { dy: 4 * 0.5 * u * (1 - u), dyaw: 0 }; }   // menantang: satu lompatan parabola
    return null;
  };
  function addBubble(ch, id) {
    const sp = emojiSprite(ch); scene.add(sp);
    bubbles.push({ sp, t: 0, id });
  }
  function emoteFx(e, x, y, z, sc, onceOnly) {                                         // efek visual di kaki (mirip "recall" tapi tidak berpindah)
    if (e === 2) { ringWave(x, z, 0.6, 3.4 * sc, 0.9, 0.8, 0.65, 0.2); ringWave(x, z, 0.6, 3.9 * sc, 1.1, 0.75, 0.45, 0.1); }
    else if (e === 3) ringWave(x, z, 0.6, 3.6 * sc, 0.9, 0.85, 0.25, 0.22);
    else if (e === 4) ringWave(x, z, 0.6, 3.2 * sc, 0.9, 0.7, 0.7, 0.7);
    if (e === 2 || e === 3) starBurst(x, y + 1.2 * sc, z, 8, 'gain');
  }
  let myEmote = { e: -1, t: 99 }, emoteCd = 0;
  function doEmote(i) {
    if (!arenaOn || state !== 'playing' || emoteCd > 0 || i < 0 || i >= EMOTES.length) return;
    emoteCd = 2.0;
    myEmote = { e: i, t: 0 };
    addBubble(EMOTES[i], null);
    emoteFx(i, player.x, player.gy || 0, player.z, scaleNow / 1.1);
    Arena.emote(i);
  }
  function remoteEmote(id, e) {
    if (e < 0 || e >= EMOTES.length) return;
    const r = Arena.remotes.get(id), v = remoteViews.get(id); if (!r || !v || !r.seen) return;
    v.em = { e, t: 0 };
    addBubble(EMOTES[e], id);
    emoteFx(e, r.x, r.y, r.z, v.sc);
  }
  function updateBubbles(dt) {
    emoteCd = Math.max(0, emoteCd - dt);
    if (myEmote.t < 9) myEmote.t += dt;
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i]; b.t += dt;
      let x, y, z, ok = true;
      if (b.id === null) { x = hero.root.position.x; y = hero.root.position.y + 2.9 * scaleNow + 1.6; z = hero.root.position.z; }
      else { const v = remoteViews.get(b.id); if (!v) ok = false; else { x = v.c.root.position.x; y = v.c.root.position.y + 2.9 * v.sc + 1.6; z = v.c.root.position.z; } }
      if (!ok || b.t > 2.4) { scene.remove(b.sp); if (b.sp.material.map) b.sp.material.map.dispose(); b.sp.material.dispose(); bubbles.splice(i, 1); continue; }
      const pop = Math.min(1, b.t / 0.18), fade = b.t > 2 ? Math.max(0, (2.4 - b.t) / 0.4) : 1;
      b.sp.position.set(x, y + b.t * 0.18, z);
      b.sp.scale.setScalar(1.5 * (0.5 + 0.5 * pop)); b.sp.material.opacity = fade;
    }
    if (emoteBar) emoteBar.classList.toggle('cd', emoteCd > 0);
    if (emoOpenT > 0) { emoOpenT -= dt; if (emoOpenT <= 0) emoOpen(false); }          // menutup sendiri bila tidak dipakai
  }
  const emoteBar = $('emoteBar');
  let emoOpen = () => {}, emoOpenT = 0;
  if (emoteBar) {
    const emoBtn = $('emoteBtn');
    emoOpen = (on) => { emoOpenT = on ? 5 : 0; emoteBar.classList.toggle('open', on); };       // satu tombol 💬: ketuk -> emote berbaris -> pilih
    if (emoBtn) bindBtn(emoBtn, () => emoOpen(!emoteBar.classList.contains('open')));
    for (let i = 0; i < EMOTES.length; i++) bindBtn($('em' + i), () => { doEmote(i); emoOpen(false); });
  }
  // ---------- Skill khas tiap dino (arena) ----------
  // tanda bahaya di tanah (merah = lawan, oranye = milikku): bentuk area + bilah isi yang menunjukkan sisa waktu persiapan
  const teleGeo = {
    circle: (() => { const g = new THREE.CircleGeometry(1, 40); g.rotateX(-Math.PI / 2); return g; })(),
    line: (() => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); g.translate(0, 0, -0.5); return g; })(),
  };
  const teleCone = {};
  const coneGeo = (arc) => { const k = Math.round(arc * 100); if (!teleCone[k]) { const g = new THREE.CircleGeometry(1, 28, Math.PI / 2 - arc, arc * 2); g.rotateX(-Math.PI / 2); teleCone[k] = g; } return teleCone[k]; };
  const teleMat = (col, op) => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false, depthTest: false, fog: false, side: THREE.DoubleSide });

  // motif tanda skill (digambar sekali di kanvas kecil): cincin rune, garis panah, busur gelombang
  const teleTex = (() => {
    const mk = (w, h, draw) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round'; draw(g); const tx = new THREE.CanvasTexture(cv); return tx; };
    const ring = (g, r, lw, a) => { g.globalAlpha = a; g.lineWidth = lw; g.beginPath(); g.arc(128, 128, r, 0, Math.PI * 2); g.stroke(); };
    const spokes = (g, n, r0, r1, lw, a) => { g.globalAlpha = a; g.lineWidth = lw; for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; g.beginPath(); g.moveTo(128 + Math.cos(t) * r0, 128 + Math.sin(t) * r0); g.lineTo(128 + Math.cos(t) * r1, 128 + Math.sin(t) * r1); g.stroke(); } };
    const glow = (g, r0, a) => { const gr = g.createRadialGradient(128, 128, r0, 128, 128, 126); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,' + a + ')'); g.globalAlpha = 1; g.fillStyle = gr; g.fillRect(0, 0, 256, 256); g.fillStyle = '#fff'; };
    const tri = (g, r, rot) => { g.beginPath(); for (let i = 0; i < 3; i++) { const t = rot + i * Math.PI * 2 / 3; g[i ? 'lineTo' : 'moveTo'](128 + Math.cos(t) * r, 128 + Math.sin(t) * r); } g.closePath(); g.stroke(); };
    const T = {
      circle: mk(256, 256, (g) => {                                              // cincin rune: lingkaran luar tebal, cincin putus-putus, jari-jari, bintang segitiga
        glow(g, 40, 0.2); ring(g, 122, 6, 0.95); ring(g, 110, 1.5, 0.6);
        g.setLineDash([12, 9]); ring(g, 96, 6, 0.75); g.setLineDash([]);
        spokes(g, 16, 46, 84, 2.5, 0.5); ring(g, 42, 3, 0.8); g.globalAlpha = 0.8; g.lineWidth = 4; for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(112 + k * 15, 98); g.quadraticCurveTo(122 + k * 15, 128, 112 + k * 15, 158); g.stroke(); }
      }),
      cone: mk(256, 256, (g) => {                                                // busur gelombang berlapis + garis jari-jari
        glow(g, 20, 0.16); ring(g, 122, 7, 0.95); ring(g, 94, 4, 0.7); ring(g, 66, 3.5, 0.6); ring(g, 38, 3, 0.5);
        spokes(g, 36, 20, 118, 1.8, 0.4);
      }),
      line: mk(128, 256, (g) => {                                                // garis lintasan: tepi + panah chevron menunjuk ke depan (atas = depan)
        const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,0.16)'); gr.addColorStop(1, 'rgba(255,255,255,0.06)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 256); g.fillStyle = '#fff';
        g.globalAlpha = 0.95; g.lineWidth = 5; g.beginPath(); g.moveTo(4, 0); g.lineTo(4, 256); g.moveTo(124, 0); g.lineTo(124, 256); g.stroke();
        g.lineWidth = 11; g.globalAlpha = 0.85; g.beginPath(); g.moveTo(20, 118); g.lineTo(64, 46); g.lineTo(108, 118); g.stroke();
        g.lineWidth = 8; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(26, 214); g.lineTo(64, 152); g.lineTo(102, 214); g.stroke();
      }),
    };
    T.line.wrapT = THREE.RepeatWrapping;
    return T;
  })();
  const teleLineGeo = {};
  const lineGeoFor = (len) => {                                                    // satu bidang per panjang: motif panah berulang tiap ~2,6 m
    const k = Math.round(len * 10);
    if (!teleLineGeo[k]) {
      const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); g.translate(0, 0, -0.5);
      try { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len / 2.6); } catch (e) { /* abaikan */ }
      teleLineGeo[k] = g;
    }
    return teleLineGeo[k];
  };
  const teleMapMat = (map, col, op) => new THREE.MeshBasicMaterial({ map, color: col, transparent: true, opacity: op, depthWrite: false, depthTest: false, fog: false, side: THREE.DoubleSide });
  const teles = [];
  function telegraph(x, z, yaw, sh, wind, mine, fxId) {                           // tanpa gambar di tanah: hanya penjadwal efek elemen lawan (tanda abu-abu hanya muncul saat membidik)
    if (!sh) return;
    teles.push({ t: 0, wind: Math.max(0.08, wind), sh, x, z, yaw, fxId, fired: false });
    if (teles.length > 12) teles.shift();
  }
  function updateTele(dt) {
    for (let i = teles.length - 1; i >= 0; i--) {
      const o = teles[i]; o.t += dt;
      if (!o.fired && o.t >= o.wind) { o.fired = true; if (o.fxId) skillFx(o.fxId, o.x, o.z, o.yaw, o.sh); }          // lawan melepas skill: efek elemen
      if (o.t > o.wind + 0.05) teles.splice(i, 1);
    }
  }
  // ---------- Efek elemen skill: petir, api, air, angin (partikel ringan, mengikuti garis/area tanda abu-abu) ----------
  const softTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(cv); })();
  function mkPool(n, size) {
    const geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos[i * 3 + 1] = -999;
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: softTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false }));
    pts.frustumCulled = false; pts.renderOrder = 6; scene.add(pts);
    return { n, pos, col, geo, p: Array.from({ length: n }, () => ({ l: 0, m: 1, vx: 0, vy: 0, vz: 0, r: 0, g: 0, b: 0, gr: 0, dr: 0, sn: 0 })), i: 0, alive: 0 };
  }
  const FX = { big: mkPool(220, 1.9), small: mkPool(360, 0.6) };
  function emit(pool, x, y, z, vx, vy, vz, life, r, g, b, gr, dr, sn) {
    const o = pool.p[pool.i], k = pool.i * 3; pool.i = (pool.i + 1) % pool.n;
    o.l = o.m = life; o.vx = vx; o.vy = vy; o.vz = vz; o.r = r; o.g = g; o.b = b; o.gr = gr || 0; o.dr = dr || 0; o.sn = sn ? 1 : 0;
    pool.pos[k] = x; pool.pos[k + 1] = y; pool.pos[k + 2] = z; pool.alive++;
  }
  function updateFx(dt) {
    for (const pool of [FX.big, FX.small]) {
      if (!pool.alive) continue;
      let live = 0;
      for (let i = 0; i < pool.n; i++) {
        const o = pool.p[i], k = i * 3;
        if (o.l <= 0) continue;
        o.l -= dt;
        if (o.l <= 0) { pool.pos[k + 1] = -999; pool.col[k] = pool.col[k + 1] = pool.col[k + 2] = 0; continue; }
        live++;
        const d = Math.max(0, 1 - o.dr * dt);
        o.vx *= d; o.vz *= d; o.vy = o.vy * d - o.gr * dt;
        pool.pos[k] += o.vx * dt; pool.pos[k + 1] += o.vy * dt; pool.pos[k + 2] += o.vz * dt;
        if (o.sn) pool.pos[k + 1] = heightAt(pool.pos[k], pool.pos[k + 2]) + 0.25;                 // gelombang menempel di permukaan tanah (tidak tertanam di tebing)
        const f = o.l / o.m, a = f * Math.min(1, (1 - f) * 7);                    // muncul cepat, hilang halus
        pool.col[k] = o.r * a; pool.col[k + 1] = o.g * a; pool.col[k + 2] = o.b * a;
      }
      pool.alive = live;
      pool.geo.attributes.position.needsUpdate = true; pool.geo.attributes.color.needsUpdate = true;
    }
  }
  // gelombang cincin yang menjalar di atas tanah: tiap titik mengikuti tinggi tanah, melambat oleh gesekan (fisika sederhana)
  function ringWave(x, z, r0, r1, life, cr, cg, cb) {
    const n = Math.min(40, Math.max(18, Math.round(r1 * 5))), dr = 2.4, v0 = (r1 - r0) * dr / (1 - Math.exp(-dr * life));
    for (let i = 0; i < n; i++) { const a = i / n * 6.283185, c = Math.cos(a), s = Math.sin(a); emit(FX.big, x + c * r0, heightAt(x + c * r0, z + s * r0) + 0.25, z + s * r0, c * v0, 0, s * v0, life, cr, cg, cb, 0, dr, true); }
  }
  const bolts = [];
  function boltBuild(o) {
    const a = o.geo.attributes.position.array, n = o.n, dx = o.x1 - o.x0, dz = o.z1 - o.z0, len = Math.hypot(dx, o.y1 - o.y0, dz) || 1;
    const hx = Math.hypot(dx, dz), px = hx > 0.01 ? -dz / hx : 1, pz = hx > 0.01 ? dx / hx : 0;       // tegak lurus arah (datar)
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1), j = (i === 0 || i === n - 1) ? 0 : (Math.random() - 0.5) * 2 * o.amp * Math.sin(Math.PI * f);
      a[i * 3] = o.x0 + dx * f + px * j; a[i * 3 + 1] = o.y0 + (o.y1 - o.y0) * f + (Math.random() - 0.5) * o.amp * 0.4; a[i * 3 + 2] = o.z0 + dz * f + pz * j;
      if (i % 2 === 0) emit(FX.small, a[i * 3], a[i * 3 + 1], a[i * 3 + 2], 0, 0, 0, 0.18, o.r, o.g, o.b, 0, 0);       // kilau di tiap sambungan
    }
    o.geo.attributes.position.needsUpdate = true; o.len = len;
  }
  function removeBolt(i) { const o = bolts[i]; scene.remove(o.m); o.geo.dispose(); o.m.material.dispose(); bolts.splice(i, 1); }
  function bolt(x0, y0, z0, x1, y1, z1, life, amp, r, g, b) {
    if (bolts.length >= 12) removeBolt(0);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(13 * 3), 3));
    const m = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(r, g, b), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    m.frustumCulled = false; m.renderOrder = 7; scene.add(m);
    const o = { m, geo, n: 13, x0, y0, z0, x1, y1, z1, life, max: life, amp, tick: 0, r, g, b };
    boltBuild(o); bolts.push(o);
  }
  function updateBolts(dt) {
    for (let i = bolts.length - 1; i >= 0; i--) {
      const o = bolts[i]; o.life -= dt; o.tick -= dt;
      if (o.life <= 0) { removeBolt(i); continue; }
      if (o.tick <= 0) { o.tick = 0.06; boltBuild(o); }                           // berkedip: bentuk zig-zag diacak ulang
      o.m.material.opacity = Math.min(1, o.life / o.max * 2.2) * 0.85;
    }
  }
  function sndAt(x, z) {                                                         // volume menurut jarak + panning kiri/kanan menurut kamera
    const dx = x - player.x, dz = z - player.z, d = Math.hypot(dx, dz);
    return { v: clamp(1 - d / 45, 0.12, 1), pan: clamp((Math.cos(camYaw) * dx - Math.sin(camYaw) * dz) / 18, -1, 1) };
  }
  function skillFx(id, x, z, yaw, sh, mine) {
    if (!sh) return;
    { const sd = sndAt(x, z); GameAudio.sfx.skill(id, sd.v, sd.pan); }                  // suara animasi skill
    const gy = heightAt(x, z), dx = -Math.sin(yaw), dz = -Math.cos(yaw), sx = Math.cos(yaw), sz = -Math.sin(yaw), R = Math.random, big = FX.big, sm = FX.small;
    if (id === 'roar') {                                                          // AUM: gelombang cincin yang melebar (efek lama yang disukai); milik sendiri digambar oleh roarRing
      if (!mine) { ringWave(x, z, 1, sh.r, 0.6, 0.81, 0.85, 0.86); ringWave(x, z, 0.6, sh.r * 0.7, 0.45, 0.9, 0.92, 0.93); }
    } else if (id === 'pounce') {                                                 // PETIR: sambaran zig-zag di sepanjang garis
      const L = sh.len, ex = x + dx * L, ez = z + dz * L;
      for (let k = -1; k <= 1; k++) bolt(x + sx * k * sh.width * 0.25, gy + 0.8, z + sz * k * sh.width * 0.25, ex + sx * k * sh.width * 0.25, gy + 0.8, ez + sz * k * sh.width * 0.25, 0.38, 0.55, 0.62, 0.82, 1);
      for (let k = 0; k < 3; k++) { const f = 0.3 + 0.28 * k + R() * 0.1, px = x + dx * L * f, pz = z + dz * L * f; bolt(px, gy + 9, pz, px, gy, pz, 0.3, 0.9, 0.75, 0.9, 1); emit(big, px, gy + 0.4, pz, 0, 0, 0, 0.3, 0.5, 0.7, 1, 0, 0); }
      for (let i = 0; i < 34; i++) { const f = R(); emit(sm, x + dx * L * f + sx * (R() - 0.5) * sh.width, gy + 0.4, z + dz * L * f + sz * (R() - 0.5) * sh.width, (R() - 0.5) * 3, 2 + R() * 4, (R() - 0.5) * 3, 0.4 + R() * 0.3, 0.7, 0.88, 1, 9, 0); }
    } else if (id === 'charge') {                                                 // API: jejak nyala di sepanjang garis
      const L = sh.len;
      for (let i = 0; i < 70; i++) { const f = R(); emit(big, x + dx * L * f + sx * (R() - 0.5) * sh.width * 0.8, gy + 0.3, z + dz * L * f + sz * (R() - 0.5) * sh.width * 0.8, (R() - 0.5) * 1.2, 2 + R() * 3, (R() - 0.5) * 1.2, 0.45 + R() * 0.4, 1, 0.42 + R() * 0.25, 0.1, -1.5, 0.5); }
      for (let i = 0; i < 36; i++) { const f = R(); emit(sm, x + dx * L * f + sx * (R() - 0.5) * sh.width, gy + 0.5, z + dz * L * f + sz * (R() - 0.5) * sh.width, (R() - 0.5) * 3, 3 + R() * 4, (R() - 0.5) * 3, 0.5 + R() * 0.4, 1, 0.8, 0.3, 9, 0); }
      for (let i = 0; i < 14; i++) emit(big, x + dx * L + (R() - 0.5) * 1.5, gy + 0.4, z + dz * L + (R() - 0.5) * 1.5, dx * 3 + (R() - 0.5) * 3, 2 + R() * 2, dz * 3 + (R() - 0.5) * 3, 0.5, 1, 0.5, 0.12, -1, 0.4);
    } else if (id === 'sweep') {                                                  // AIR: pusaran ekor & percikan di sekeliling lingkaran
      for (let i = 0; i < 40; i++) { const a = i / 40 * 6.283, rr = 1 + sh.r * 0.85 * (i / 40), sp = 8; emit(big, x + Math.cos(a) * rr, gy + 0.5, z + Math.sin(a) * rr, -Math.sin(a) * sp, 0.8, Math.cos(a) * sp, 0.5, 0.3, 0.6, 0.9, 0, 1.5); }
      for (let i = 0; i < 60; i++) { const a = R() * 6.283, sp = 4 + R() * 5; emit(sm, x + Math.cos(a) * sh.r * 0.5, gy + 0.6, z + Math.sin(a) * sh.r * 0.5, Math.cos(a) * sp - Math.sin(a) * 6, 4 + R() * 4, Math.sin(a) * sp + Math.cos(a) * 6, 0.6 + R() * 0.3, 0.4, 0.72, 1, 13, 0); }
      for (let i = 0; i < 24; i++) { const a = i / 24 * 6.283; emit(big, x + Math.cos(a) * sh.r * 0.9, gy + 0.4, z + Math.sin(a) * sh.r * 0.9, 0, 1.5, 0, 0.5, 0.25, 0.5, 0.8, 0, 0); }
    } else if (id === 'sonic') {                                                  // ANGIN + kilau: gelombang suara berlapis di dalam kerucut
      for (let k = 0; k < 5; k++) for (let j = -6; j <= 6; j++) {
        const ang = yaw + (j / 6) * sh.arc * 0.95, ax = -Math.sin(ang), az = -Math.cos(ang), d0 = 0.8 + k * 1.1, sp = (sh.r - d0) / 0.5;
        emit(big, x + ax * d0, gy + 1 + k * 0.1, z + az * d0, ax * sp, 0.4, az * sp, 0.5, 0.55, 0.78, 1, 0, 0);
      }
      for (let i = 0; i < 18; i++) { const ang = yaw + (R() * 2 - 1) * sh.arc, ax = -Math.sin(ang), az = -Math.cos(ang), sp = 8 + R() * 10; emit(sm, x + ax, gy + 0.9 + R(), z + az, ax * sp, R() * 2, az * sp, 0.5, 0.85, 0.95, 1, 0, 0); }
    }
  }
  let stunT = 0, skillWind = null, dashS = null, slowT = 0, slowMul = 1, aimHintT = 0, skAnim = null;
  // skill khas tiap dino: SAMA di arena maupun mode solo (di arena angka resmi dari server, di solo dari tabel ini)
  const LOCAL_KITS = {
    vosil: { id: 'roar', cd: 14000, windup: 150, recover: 250, shape: 'circle', r: 8.2, dmg: 7, kb: 3, stun: 2500 },
    velo: { id: 'pounce', cd: 8000, windup: 130, recover: 700, shape: 'line', len: 7, width: 2.4, dmg: 12, kb: 1.2, dash: 7 },
    carno: { id: 'charge', cd: 10000, windup: 250, recover: 900, shape: 'line', len: 7, width: 3.2, dmg: 18, kb: 5, dash: 6.5 },
    spino: { id: 'sweep', cd: 7000, windup: 180, recover: 350, shape: 'circle', r: 5.2, dmg: 9, kb: 4.5 },
    parasaur: { id: 'sonic', cd: 9000, windup: 160, recover: 300, shape: 'cone', r: 10, arc: 0.85, dmg: 5, kb: 2 }
  };
  const kitSkill = () => (arenaOn && typeof Arena !== 'undefined' && Arena.kits && Arena.kits[save.char] ? Arena.kits[save.char].skill : LOCAL_KITS[save.char] || LOCAL_KITS.vosil);
  const skLabel = () => { const sk = kitSkill(); return t('sk_' + (sk ? sk.id : 'roar')); };
  function aimYaw() {                                                              // bidik otomatis ke lawan terdekat (jika dekat)
    let best = null, bd = 9;
    for (const r of Arena.remotes.values()) {
      if (!r.seen || !r.near) continue;
      const d = Math.hypot(r.x - player.x, r.z - player.z);
      if (d < bd) { bd = d; best = r; }
    }
    return best ? faceYaw(best.x - player.x, best.z - player.z) : player.yaw;
  }
  function arenaSkillPress(yawOv) {
    const sk = kitSkill();
    if (!sk || roarCd > 0 || player.atkCd > 0 || skillWind || stunT > 0) return;
    if (yawOv !== undefined) player.yaw = yawOv; else if (sk.shape !== 'circle') player.yaw = aimYaw();
    hero.root.rotation.y = player.yaw;                                              // langsung menghadap arah serangan (tanpa menunggu putaran halus)
    roarCd = sk.cd / 1000;
    player.atkCd = Math.max(player.atkCd, (sk.windup + sk.recover) / 1000);          // terkunci selama persiapan + pemulihan (kelemahan tiap skill)
    skillWind = { t: sk.windup / 1000, sk, yaw: player.yaw, ox: player.x, oz: player.z };
    if (arenaOn) Arena.skill(player.yaw);
    skAnim = { id: sk.id, t: 0, dur: sk.windup / 1000 + 0.32 };                  // gerak serangan dino (pose khas tiap skill)
  }

  // ---------- Bidik skill: tahan tombol, geser jari untuk mengarahkan, lepas untuk meluncurkan ----------
  const aim = { on: false, yaw: 0, moved: false, cx: 0, cy: 0, mesh: null, fill: null, shape: '' };
  const aimReady = () => state === 'playing' && !!kitSkill() && roarCd <= 0 && player.atkCd <= 0 && !skillWind;
  function aimClear() { for (const k of ['mesh', 'fill']) if (aim[k]) { scene.remove(aim[k]); aim[k].material.dispose(); aim[k] = null; } aim.on = false; }
  function aimBegin(e) {
    if (!aimReady()) return false;
    const sk = kitSkill(), r = btnRoar.getBoundingClientRect();
    aim.cx = r.left + r.width / 2; aim.cy = r.top + r.height / 2; aim.moved = false; aim.yaw = sk.shape === 'circle' ? player.yaw : aimYaw(); aim.shape = sk.shape;
    const geo = sk.shape === 'line' ? teleGeo.line : sk.shape === 'cone' ? coneGeo(sk.arc) : teleGeo.circle;
    const m = new THREE.Mesh(sk.shape === 'line' ? lineGeoFor(sk.len) : geo, teleMapMat(teleTex[sk.shape] || teleTex.circle, 0xeceff1, 0.6)), f = new THREE.Mesh(geo, teleMat(0xeceff1, 0.1));
    m.renderOrder = 4; f.renderOrder = 3;
    for (const o of [m, f]) { if (sk.shape === 'line') o.scale.set(sk.width, 1, sk.len); else o.scale.set(sk.r, 1, sk.r); scene.add(o); }
    aim.mesh = m; aim.fill = f; aim.on = true;
    return true;
  }
  function aimMove(e) {
    if (!aim.on) return;
    const dxs = e.clientX - aim.cx, dys = e.clientY - aim.cy;
    if (Math.hypot(dxs, dys) < 16) return;                                          // zona mati di tengah tombol
    aim.moved = true;
    const sn = Math.sin(camYaw), cs = Math.cos(camYaw);
    aim.yaw = faceYaw(cs * dxs + sn * dys, -sn * dxs + cs * dys);                   // layar atas = arah kamera
  }
  function aimEnd(fire) {
    if (!aim.on) return;
    const y = aim.yaw; aimClear();
    if (fire) arenaSkillPress(y);
  }
  function fireSkill(sk, yaw, ox, oz) {                                                    // efek di sisi saya saat persiapan selesai (kerusakan ditentukan server)
    const gy = player.gy || 0;
    shake = Math.max(shake, 0.6);
    GameAudio.sfx.dino(save.char === 'vosil' ? 'carno' : save.char, sk.id === 'sonic' ? 'call' : 'attack', 1.5);
    if (sk.shape === 'circle') { roarR = sk.r; roarT = 0; }
    if (sk.id === 'roar') showDmg(player.x, gy + player.y + 3.0 * scaleNow / 1.1, player.z, t('roar_pop'), 'crit', 1.3);
    if (sk.dash) dashS = { left: 0.22, dx: -Math.sin(yaw), dz: -Math.cos(yaw), v: sk.dash / 0.22 };
    skillFx(sk.id, ox !== undefined ? ox : player.x, oz !== undefined ? oz : player.z, yaw, { shape: sk.shape, r: sk.r || 0, len: sk.len || 0, width: sk.width || 0, arc: sk.arc || 0 }, true);
    starBurst(player.x, gy + player.y + 1.4 * scaleNow / 1.1, player.z, 8, 'gain');
  }
  // mode solo: kerusakan skill dihitung di sini (di arena ditentukan server)
  function soloSkillHit(sk, yaw, ox, oz) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), mult = 1.5 * (1 + 0.3 * (player.level - 1)) * (1 + bmods().dmg);
    let hit = 0;
    for (const p of preds.slice()) {
      if (p.dead) continue;
      const dx = p.x - ox, dz = p.z - oz, d = Math.hypot(dx, dz) || 1, rad = 0.5 * p.def.scale;
      let inside = false;
      if (sk.shape === 'circle') inside = d <= sk.r + rad;
      else if (sk.shape === 'line') { const pr = dx * fx + dz * fz, pp = Math.abs(dx * fz - dz * fx); inside = pr > -0.5 && pr <= sk.len + rad + (sk.dash ? sk.dash * 0.5 : 0) && pp <= sk.width / 2 + rad; }
      else inside = d <= sk.r + rad && (dx * fx + dz * fz) / d >= Math.cos(sk.arc || 0.85);
      if (!inside) continue;
      hit++;
      const calm = p.def.timid || p.def.neutral, giant = !!p.def.giant;
      const kb = (giant ? 0.3 : 1) * (sk.kb || 2) * (1 - Math.min(0.6, d / (sk.r || sk.len || 8) * 0.4));
      p.x += (dx / d) * kb; p.z += (dz / d) * kb;
      if (!calm) damagePred(p, sk.dmg * mult * (giant ? 0.6 : 1), 'skill');
      if (p.dead) continue;
      if (p.def.timid) { p.state = 'flee'; p.t = 3; }
      else { p.state = 'stun'; p.t = giant ? (sk.stun ? 1.2 : 0.7) : (sk.stun ? sk.stun / 1000 : sk.id === 'sonic' ? 1.4 : 1.2); p.cd = Math.max(p.cd, 1.4); p.warn && (p.warn.visible = false); }
    }
    if (sk.shape === 'circle') player.invuln = Math.max(player.invuln, 0.5);
    if (hit === 0) toast(t('roar_none'), 1.2);
  }
  function updateSkill(dt) {
    slowT = Math.max(0, slowT - dt); if (slowT <= 0) slowMul = 1;
    if (stunT > 0) { stunT = Math.max(0, stunT - dt); if (stunT > 0 && Math.random() < dt * 6) starBurst(player.x, (player.gy || 0) + player.y + 2.6 * scaleNow / 1.1, player.z, 2, 'gain'); }
    if (skAnim) { skAnim.t += dt; if (skAnim.t >= skAnim.dur) skAnim = null; }
    if (state !== 'playing') { skillWind = null; dashS = null; if (aim.on) aimClear(); return; }
    if (aimHintT > 0) { aimHintT -= dt; if (aimHintT <= 0) toast(t('ar_aim'), 6); }
    if (aim.on) {
      if (skillWind) aimClear();
      else { aim.mesh.position.set(player.x, heightAt(player.x, player.z) + 0.3, player.z); aim.mesh.rotation.y = aim.yaw; const pu = Math.sin(clock * 6); aim.mesh.material.opacity = 0.6 + 0.12 * pu; aim.fill.material.opacity = 0.1 + 0.04 * pu; aim.fill.position.copy(aim.mesh.position); aim.fill.rotation.y = aim.yaw; if (aim.shape === 'circle') aim.mesh.rotation.y = clock * 0.9; }
    }
    if (skillWind) { skillWind.t -= dt; if (skillWind.t <= 0) { const w = skillWind; skillWind = null; fireSkill(w.sk, w.yaw, w.ox, w.oz); if (!arenaOn) soloSkillHit(w.sk, w.yaw, w.ox, w.oz); } }
    if (dashS) {
      const step = Math.min(dashS.left, dt); dashS.left -= dt;
      player.x += dashS.dx * dashS.v * step; player.z += dashS.dz * dashS.v * step;
      if (dashS.left <= 0) dashS = null;
    }
  }
  async function startArena() {
    if (state === 'playing' || arenaBusy) return;
    arenaBusy = true; toast(t('ar_connecting'), 8);
    try {
      const r = await Arena.join({ name: playerName(), char: save.char, level: 1 });
      startGame({ arena: true, seed: r.seed, x: r.x, z: r.z });
      const sk = kitSkill(); toast(sk ? t('kit_' + sk.id) : t('ar_old'), sk ? 6 : 9); aimHintT = sk ? 7 : 0;
    } catch (e) { toast(t(e && e.message === 'full' ? 'ar_full' : 'ar_fail'), 4); }
    arenaBusy = false;
  }
  let arenaBusy = false;
  let lastMode = 'arena';                                               // mode terakhir: 'solo' bila pemain memilih solo
  async function playAgain() {                                          // main lagi: utamakan arena online, solo hanya bila penuh/gagal/dipilih solo
    if (state === 'playing' || arenaBusy) return;
    const ab = $('arenaBtn');
    if (lastMode !== 'solo' && ab && !ab.classList.contains('hidden')) { await startArena(); if (state !== 'playing') { toast(t('ar_full_solo'), 4); startGame(); } }
    else startGame();
  }
  const arenaBtn = $('arenaBtn');
  if (arenaBtn) {
    arenaBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    arenaBtn.addEventListener('click', (e) => { e.stopPropagation(); GameAudio.init(); startArena(); });
    try { Wallet.loadConfig().then((c) => { if (c && c.arena) arenaBtn.classList.remove('hidden'); }); } catch (e) { /* abaikan */ }
  }
  if (typeof Arena !== 'undefined') {
    Arena.onFix = (x, z) => { player.x = x; player.z = z; };                       // server mengembalikan posisi (gerak tidak wajar)
    Arena.onLevel = (lv, xp, up) => { if (!arenaOn || state !== 'playing') return; player.level = Math.max(1, Math.min(MAX_LEVEL, lv | 0)); player.xp = xp | 0; if (up) levelUp(); };
    Arena.onHp = (h) => { if (arenaOn && state === 'playing') player.hp = Math.max(0, Math.min(100, h)); };
    Arena.onAlert = (m) => { if (!arenaOn) return; toast(t('ar_alert', { n: m.nm || '?' }), 2.6); GameAudio.sfx.alarm ? GameAudio.sfx.alarm() : GameAudio.sfx.record(); shake = Math.max(shake, 0.12); };
    Arena.onWave = (m) => { if (!arenaOn) return; toast(t('ar_wave', { n: m.n }), 3.2); try { GameAudio.sfx.horde ? GameAudio.sfx.horde() : GameAudio.sfx.power(); } catch (e) { /* abaikan */ } shake = Math.max(shake, 0.25); hurtT = Math.max(hurtT, 0.12); };
    Arena.onDamaged = pvpHurt; Arena.onHit = pvpHit; Arena.onKill = pvpKill; Arena.onRoar = pvpRoar; Arena.onEmote = remoteEmote;
    Arena.onSkill = (m) => { telegraph(m.x, m.z, m.yaw, m.sh, m.w / 1000, false, m.s); const v = remoteViews.get(m.id); if (v) v.skA = { id: m.s, t: 0, dur: m.w / 1000 + 0.32 }; };
    Arena.onJoin = (c) => { if (arenaOn) toast(t('ar_joined', { n: c.name }), 2); };
    Arena.onLeave = (c) => { if (arenaOn) toast(t('ar_left', { n: c.name }), 2); };
    Arena.onEnd = () => { if (arenaOn) { arenaOn = false; clearRemotes(); if (state === 'playing') die(t('ar_lost')); } };
  }

  const player = {
    x: 0, z: 0, y: 0, vy: 0, vx: 0, vz: 0, yaw: Math.PI,
    hp: 100, hunger: 100, thirst: 100, stamina: 100, exhausted: false,
    invuln: 0, atkT: -1, atkCd: 0, atkHit: false, lastDmg: 99, level: 1, xp: 0, counterT: 0
  };
  // dino yang bisa dimainkan: kelebihan dan kekurangan masing-masing
  const PLAYABLES = {
    vosil: { name: 'Vosil', get info() { return t('info.vosil'); }, scale: 1.1, pal: PAL_PLAYER, speed: 1, bite: 1, armor: 1, stam: 1, thirst: 1 },
    velo: { name: 'Velociraptor', get info() { return t('info.velo'); }, scale: 0.95, variant: 'velo', pal: PTYPES.velo.pal, speed: 1.2, bite: 0.75, armor: 1.2, stam: 1, thirst: 1 },
    carno: { name: 'Carnotaurus', get info() { return t('info.carno'); }, scale: 1.25, variant: 'carno', pal: PTYPES.carno.pal, speed: 0.95, bite: 1.4, armor: 0.9, stam: 1.1, thirst: 1 },
    spino: { name: 'Spinosaurus', get info() { return t('info.spino'); }, scale: 1.4, variant: 'spino', pal: PTYPES.spino.pal, speed: 0.88, bite: 1.3, armor: 0.75, stam: 1.15, thirst: 0.5 },
    parasaur: { name: 'Parasaurolophus', get info() { return t('info.parasaur'); }, scale: 1.25, variant: 'parasaur', pal: PTYPES.parasaur.pal, speed: 1.05, bite: 0.6, armor: 1.1, stam: 0.5, thirst: 1 }
  };
  let curChar = PLAYABLES[save.char] || PLAYABLES.vosil;
  const buildHero = () => makeCreature(Object.assign({ scale: curChar.scale, variant: curChar.variant }, curChar.pal));
  let hero = buildHero();
  scene.add(hero.root);

  // ---------- Level dino: dari kecil sampai besar ----------
  const MAX_LEVEL = 10;
  const xpNeed = (l) => 45 + 30 * (l - 1);
  const lvScale = (l) => 0.72 + 0.062 * (l - 1);
  const baseScale = () => curChar.scale * lvScale(player.level);

  // ===== TOKO BUILD (emas dalam permainan; BUKAN poin VOS) =====
  const SHOP_ITEMS = {
    a1: { cat: 'atk', tier: 1, cost: 160, ic: '🦷', dmg: 0.06 }, a2: { cat: 'atk', tier: 2, cost: 360, ic: '🦷', from: ['a1'], dmg: 0.14 }, a3: { cat: 'atk', tier: 3, cost: 780, ic: '👑', from: ['a2'], dmg: 0.24, ls: 0.06 },
    d1: { cat: 'def', tier: 1, cost: 160, ic: '🛡', arm: 0.06 }, d2: { cat: 'def', tier: 2, cost: 360, ic: '🛡', from: ['d1'], arm: 0.14 }, d3: { cat: 'def', tier: 3, cost: 780, ic: '🐢', from: ['d2'], arm: 0.22, reg: 1.5 },
    m1: { cat: 'mov', tier: 1, cost: 150, ic: '👟', spd: 0.06 }, m2: { cat: 'mov', tier: 2, cost: 330, ic: '👟', from: ['m1'], spd: 0.12 }, m3: { cat: 'mov', tier: 3, cost: 700, ic: '🌪', from: ['m2'], spd: 0.18, cdr: 0.1 },
    s1: { cat: 'spc', tier: 1, cost: 160, ic: '🦴', xp: 0.15 }, s2: { cat: 'spc', tier: 2, cost: 360, ic: '🪙', from: ['s1'], xp: 0.15, gold: 0.2 }, s3: { cat: 'spc', tier: 3, cost: 780, ic: '🔮', from: ['s2'], xp: 0.3, gold: 0.25, cdr: 0.12 },
  };

  // ikon item bertema dinosaurus (SVG ringan). Warna naik per tingkat: tulang -> baja -> emas
  const TIER_COL = { 1: ['#efe6cf', '#b9a97f'], 2: ['#8fd3e8', '#3b7fa0'], 3: ['#ffd76a', '#b8791a'] };
  function itemSvg(id) {
    const it = SHOP_ITEMS[id], [f, d] = TIER_COL[it.tier], n = it.tier;
    let g = '';
    if (it.cat === 'atk') {                       // taring / rahang
      const fang = (x, h) => '<path d="M' + (x - 4) + ' 6 Q' + x + ' ' + (6 + h) + ' ' + (x + 4) + ' 6 Q' + (x + 1) + ' ' + (6 + h * 0.5) + ' ' + (x - 4) + ' 6Z" fill="' + f + '" stroke="' + d + '" stroke-width="1.2"/>';
      g = '<path d="M3 5h26v4H3z" fill="' + d + '"/>' + (n === 1 ? fang(16, 20) : n === 2 ? fang(10, 18) + fang(22, 18) : fang(7, 14) + fang(16, 22) + fang(25, 14));
      if (n === 3) g += '<path d="M6 28l3-5 3 5 4-6 4 6 3-5 3 5z" fill="' + f + '" opacity=".0"/>';
    } else if (it.cat === 'def') {                // sisik / lempeng punggung
      g = '<path d="M16 3l11 4v9c0 7-5 11-11 13C10 27 5 23 5 16V7z" fill="' + f + '" stroke="' + d + '" stroke-width="1.6"/>' +
        '<path d="M10 11q3 3 6 0q3 3 6 0M9 17q3.5 3.5 7 0q3.5 3.5 7 0" fill="none" stroke="' + d + '" stroke-width="1.5" stroke-linecap="round"/>' + (n >= 2 ? '<path d="M16 3v26" stroke="' + d + '" stroke-width="1" opacity=".6"/>' : '') + (n === 3 ? '<path d="M7 5l-3-3M25 5l3-3M16 3V0" stroke="' + d + '" stroke-width="2" stroke-linecap="round"/>' : '');
    } else if (it.cat === 'mov') {                // jejak kaki dino 3 jari
      g = '<path d="M16 28c-4 0-6-3-5-6l2-5h6l2 5c1 3-1 6-5 6z" fill="' + f + '" stroke="' + d + '" stroke-width="1.4"/>' +
        '<path d="M8 14l3 5-3 1-3-4zM16 6l2.6 8h-5.2zM24 14l3 2-3 4-3-1z" fill="' + f + '" stroke="' + d + '" stroke-width="1.4" stroke-linejoin="round"/>' +
        (n >= 2 ? '<path d="M2 24h6M1 28h7" stroke="' + d + '" stroke-width="1.6" stroke-linecap="round"/>' : '') + (n === 3 ? '<path d="M25 22l3-5-1 4h3l-4 6 1-5z" fill="' + d + '"/>' : '');
    } else {                                      // fosil: ammonite / amber / telur
      if (n === 1) g = '<path d="M16 4a12 12 0 1 0 0 24a12 12 0 0 0 0-24z" fill="' + f + '" stroke="' + d + '" stroke-width="1.4"/><path d="M16 9a7 7 0 1 1-6 3.5a4 4 0 1 1 6.5 1a1.5 1.5 0 1 1-2 1" fill="none" stroke="' + d + '" stroke-width="1.6" stroke-linecap="round"/>';
      else if (n === 2) g = '<path d="M16 3l9 6v10l-9 10l-9-10V9z" fill="' + f + '" stroke="' + d + '" stroke-width="1.5"/><path d="M12 14c0-2 1-4 3-5M14 24l-3-7" stroke="' + d + '" stroke-width="1.6" stroke-linecap="round" fill="none"/><circle cx="19" cy="12" r="1.6" fill="#fff" opacity=".8"/>';
      else g = '<path d="M16 2c6 0 10 8 10 15c0 7-4 12-10 12S6 24 6 17C6 10 10 2 16 2z" fill="' + f + '" stroke="' + d + '" stroke-width="1.5"/><path d="M10 13l3 3 3-4 3 4 3-3M9 20l4 2 3-3 3 3 4-2" fill="none" stroke="' + d + '" stroke-width="1.4" stroke-linejoin="round"/><path d="M16 0v4M3 8l3 2M29 8l-3 2" stroke="' + f + '" stroke-width="1.6" stroke-linecap="round"/>';
    }
    return '<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">' + g + '</svg>';
  }
  const SHOP_CAPS = { dmg: 0.5, arm: 0.35, spd: 0.2, ls: 0.1, reg: 3, cdr: 0.2, xp: 0.5, gold: 0.5 };
  const SHOP_SLOTS = 6, SHOP_START = 100;
  const build = { gold: SHOP_START, items: [] };
  let shopPing = 0, shopOpen = false, shopTab = 'rec', shopSel = 'a1', shopGoldT = 0, bmodsC = null;
  function bmods() {
    if (bmodsC && bmodsC.k === build.items.join()) return bmodsC.m;
    const m = { dmg: 0, arm: 0, spd: 0, ls: 0, reg: 0, cdr: 0, xp: 0, gold: 0 };
    for (const id of build.items) { const it = SHOP_ITEMS[id]; if (!it) continue; for (const k of Object.keys(m)) m[k] += it[k] || 0; }
    for (const k of Object.keys(m)) m[k] = Math.min(SHOP_CAPS[k], m[k]);
    bmodsC = { k: build.items.join(), m };
    return m;
  }
  function shopPlan(id) {
    const it = SHOP_ITEMS[id]; if (!it) return null;
    const left = build.items.slice(); let price = it.cost;
    for (const c of it.from || []) { const i = left.indexOf(c); if (i >= 0) { left.splice(i, 1); price -= SHOP_ITEMS[c].cost; } }
    left.push(id);
    return { price, items: left };
  }

  // ----- perlengkapan Build yang terlihat di tubuh dino -----
  let gear = null, gearKey = '', gearPop = 0;
  const GEAR_COL = [0, 0xe9dfc2, 0x7fc8e0, 0xffc94a];
  function gearMat(tier) { return new THREE.MeshStandardMaterial({ color: GEAR_COL[tier], roughness: 0.45, metalness: tier > 1 ? 0.5 : 0.1, emissive: tier === 3 ? 0x8a5a00 : tier === 2 ? 0x144a66 : 0x000000, emissiveIntensity: 0.45 }); }
  function syncGear(force) {
    const key = build.items.join();
    if (!force && key === gearKey) return;
    const grew = build.items.length > (gearKey ? gearKey.split(',').length : 0);
    gearKey = key;
    try {
      if (gear) { for (const g of gear.list) { if (g.parent) g.parent.remove(g); disposeTree(g); } }
      gear = null;
      if (!build.items.length) return;
      const tierOf = (cat) => { let m = 0; for (const id of build.items) { const it = SHOP_ITEMS[id]; if (it.cat === cat) m = Math.max(m, it.tier); } return m; };
      const gb = new THREE.Group(), gh = new THREE.Group(), orb = new THREE.Group();
      const add = (par, geo, mat, x, y, z, rx, rz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (rx) m.rotation.x = rx; if (rz) m.rotation.z = rz; par.add(m); return m; };
      const ta = tierOf('atk'), td = tierOf('def'), tm = tierOf('mov'), ts = tierOf('spc');
      if (ta) {                                   // taring besar di rahang + tanduk mahkota
        const mt = gearMat(ta);
        for (const sx of [-1, 1]) for (let i = 0; i < ta + 1; i++) add(gh, new THREE.ConeGeometry(0.05 + 0.012 * ta, 0.16 + 0.06 * ta, 5), mt, sx * 0.17, -0.2, -0.3 - i * 0.2, Math.PI);
        if (ta >= 2) for (let i = 0; i < ta; i++) add(gh, new THREE.ConeGeometry(0.06, 0.28 + 0.05 * i, 5), mt, 0, 0.36, 0.1 - i * 0.2, 0.25);
      }
      if (td) {                                   // lempeng punggung
        const mt = gearMat(td), n = 3 + td * 2;
        for (let i = 0; i < n; i++) { const z = -0.55 + i * (1.5 / (n - 1)); const m = add(gb, new THREE.ConeGeometry(0.17, 0.3 + 0.05 * td, 4), mt, 0, 1.55 - Math.abs(z - 0.1) * 0.12, z); m.scale.set(1, 1, 0.55); m.rotation.y = Math.PI / 4; }
        if (td >= 3) for (const sx of [-1, 1]) add(gb, new THREE.SphereGeometry(0.2, 10, 8), mt, sx * 0.5, 1.28, -0.32);
      }
      if (tm) {                                   // sirip angin di pinggul
        const mt = gearMat(tm);
        for (const sx of [-1, 1]) for (let i = 0; i < tm; i++) add(gb, new THREE.ConeGeometry(0.06, 0.55 + 0.1 * i, 4), mt, sx * (0.52 + 0.06 * i), 1.0 + 0.16 * i, 0.55 + 0.2 * i, Math.PI / 2, sx * 0.25);
      }
      if (ts) {                                   // permata melayang
        const mt = gearMat(ts);
        for (let i = 0; i < ts; i++) { const a = (i / ts) * Math.PI * 2; add(orb, new THREE.OctahedronGeometry(0.13 + 0.02 * ts, 0), mt, Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5); }
        orb.position.set(0, 2.5, -0.35); gb.add(orb);
      }
      hero.body.add(gb); hero.headPivot.add(gh);
      gear = { list: [gb, gh], gb, orb: ts ? orb : null };
      if (grew) gearPop = 1;
    } catch (e) { gear = null; }
  }
  function buyFx(id) {
    gearPop = 1;
    const y = (player.gy || 0) + player.y + 1.5 * scaleNow / 1.1;
    starBurst(player.x, y + 0.6, player.z, 14, 'gain'); burst(18, player.x, y, player.z);
    ringWave(player.x, player.z, 0.6, 5, 0.7, 1, 0.85, 0.3);
    showDmg(player.x, y + 1.4, player.z, '⚙ ' + itName(id), 'gain', 1.3);
    shake = Math.max(shake, 0.2);
  }
  function shopReset() { build.gold = SHOP_START; build.items = []; bmodsC = null; shopGoldT = 0; closeShop(); syncGear(); refreshShopBtn(); }
  function addGold(n) { if (arenaOn || n <= 0) return; build.gold += Math.round(n * (1 + bmods().gold)); refreshShopBtn(); }
  function refreshShopBtn() {
    const b = document.getElementById('shopBtn'); if (b) b.textContent = t('sh_btn', { g: build.gold | 0 });
    syncGear();
    if (shopOpen) renderShop();
  }
  const itName = (id) => t(['it_', id].join(''));
  function itemDesc(id) {
    const it = SHOP_ITEMS[id], out = [];
    const P = (k) => Math.round(it[k] * 100);
    if (it.dmg) out.push(t('sh_dmg', { n: P('dmg') })); if (it.arm) out.push(t('sh_arm', { n: P('arm') })); if (it.spd) out.push(t('sh_spd', { n: P('spd') }));
    if (it.ls) out.push(t('sh_ls', { n: P('ls') })); if (it.reg) out.push(t('sh_reg', { n: it.reg })); if (it.cdr) out.push(t('sh_cdr', { n: P('cdr') }));
    if (it.xp) out.push(t('sh_xp', { n: P('xp') })); if (it.gold) out.push(t('sh_goldb', { n: P('gold') }));
    return out;
  }
  function shopList() {
    if (shopTab === 'rec') { const own = new Set(build.items); return Object.keys(SHOP_ITEMS).filter((id) => { const it = SHOP_ITEMS[id]; return it.tier === 1 || (it.from || []).every((c) => own.has(c)); }); }
    return Object.keys(SHOP_ITEMS).filter((id) => SHOP_ITEMS[id].cat === shopTab);
  }
  function renderShop() {
    const $ = (id) => document.getElementById(id);
    $('shopTitle').textContent = '🛒 ' + t('sh_title');
    $('shopGold').textContent = '🪙 ' + t('sh_gold') + ' ' + (build.gold | 0);
    $('shopHint').textContent = t('sh_hint');
    const tabs = [['rec', 'sh_rec'], ['atk', 'sh_atk'], ['def', 'sh_def'], ['mov', 'sh_mov'], ['spc', 'sh_spc']];
    $('shopTabs').innerHTML = '';
    for (const [k, lk] of tabs) { const b = document.createElement('button'); b.type = 'button'; b.textContent = t(lk); if (k === shopTab) b.className = 'on'; b.onclick = () => { shopTab = k; renderShop(); }; $('shopTabs').appendChild(b); }
    const g = $('shopGrid'); g.innerHTML = '';
    for (const id of shopList()) {
      const it = SHOP_ITEMS[id], b = document.createElement('button'); b.type = 'button';
      b.className = 'shopIt' + (id === shopSel ? ' sel' : '') + (build.items.includes(id) ? ' own' : '');
      b.innerHTML = '<span class="ic">' + itemSvg(id) + '</span><span class="co">' + it.cost + '</span><span>' + itName(id) + '</span>';
      b.onclick = () => { shopSel = id; renderShop(); };
      g.appendChild(b);
    }
    const it = SHOP_ITEMS[shopSel], plan = shopPlan(shopSel), d = $('shopDet');
    const full = plan.items.length > SHOP_SLOTS;
    let html = '<b>' + itemSvg(shopSel).replace('width="30" height="30"', 'width="22" height="22"') + ' ' + itName(shopSel) + '</b><div>' + itemDesc(shopSel).join('<br>') + '</div>';
    if (it.from) html += '<div style="opacity:.8">' + t('sh_from') + ': ' + it.from.map((c) => itemSvg(c).replace('width="30" height="30"', 'width="14" height="14"') + ' ' + itName(c) + (build.items.includes(c) ? ' ✓' : ' (' + SHOP_ITEMS[c].cost + ')')).join(' + ') + '</div>';
    html += '<div style="color:#ffe39a;font-weight:800">🪙 ' + plan.price + '</div><div class="row"><button id="shopBuy" type="button">' + t('sh_buy') + '</button><button id="shopSell" type="button">' + t('sh_sell') + '</button></div>';
    d.innerHTML = html;
    const bb = $('shopBuy'), sb = $('shopSell');
    bb.disabled = build.gold < plan.price || full; sb.disabled = !build.items.includes(shopSel);
    bb.onclick = () => shopBuy(shopSel); sb.onclick = () => shopSellItem(shopSel);
    const sl = $('shopSlots'); sl.innerHTML = '';
    for (let i = 0; i < SHOP_SLOTS; i++) {
      const id = build.items[i], b = document.createElement('button'); b.type = 'button'; b.className = 'sl' + (id ? ' f' : '');
      b.innerHTML = id ? itemSvg(id) : ''; b.title = id ? itName(id) : t('sh_empty');
      if (id) b.onclick = () => { shopSel = id; renderShop(); };
      sl.appendChild(b);
    }
  }
  function shopBuy(id) {
    const plan = shopPlan(id); if (!plan) return;
    if (plan.items.length > SHOP_SLOTS) { toast(t('sh_full'), 1.6); return; }
    if (build.gold < plan.price) { toast(t('sh_poor'), 1.4); return; }
    if (arenaOn) { Arena.buy(id); return; }
    build.gold -= plan.price; build.items = plan.items; bmodsC = null;
    toast(t('sh_bought', { n: itName(id) }), 1.4); GameAudio.sfx.record(); refreshShopBtn(); buyFx(id);
  }
  function shopSellItem(id) {
    if (!build.items.includes(id)) return;
    if (arenaOn) { Arena.sell(id); return; }
    const back = Math.floor(SHOP_ITEMS[id].cost * 7 / 10);
    build.items.splice(build.items.indexOf(id), 1); build.gold += back; bmodsC = null;
    toast(t('sh_sold', { n: itName(id), g: back }), 1.4); refreshShopBtn();
  }
  function openShop() { if (state !== 'playing') return; shopOpen = true; shopPing = 0; if (arenaOn) Arena.shop(true); document.getElementById('shop').classList.remove('hidden'); renderShop(); }
  function closeShop() { if (shopOpen && arenaOn) { try { Arena.shop(false); } catch (e) { /* abaikan */ } } shopOpen = false; const e = document.getElementById('shop'); if (e) e.classList.add('hidden'); }
  function initShop() {
    const b = document.getElementById('shopBtn'); if (!b) return;
    b.addEventListener('click', (e) => { e.stopPropagation(); GameAudio.init(); if (shopOpen) closeShop(); else openShop(); });
    document.getElementById('shopX').addEventListener('click', closeShop);
    window.addEventListener('keydown', (e) => { if ((e.key === 'b' || e.key === 'B') && state === 'playing') { if (shopOpen) closeShop(); else openShop(); } else if (e.key === 'Escape' && shopOpen) closeShop(); });
    if (typeof Arena !== 'undefined') Arena.onGold = (g, items, err) => {
      if (!arenaOn) return;
      const old = build.items.length; build.gold = g | 0; build.items = items.slice(); bmodsC = null;
      if (items.length > old && !err) { buyFx(items[items.length - 1]); GameAudio.sfx.record(); }
      if (err === 'full') toast(t('sh_full'), 1.6); else if (err === 'gold') toast(t('sh_poor'), 1.4);
      refreshShopBtn();
    };
    refreshShopBtn();
  }
  const biteMul = () => curChar.bite * (1 + 0.07 * (player.level - 1)) * (1 + bmods().dmg);
  const armorMul = () => curChar.armor * (1 - 0.025 * (player.level - 1)) * (1 - bmods().arm);
  const speedLv = () => 1 + 0.01 * (player.level - 1);
  function gainXp(n) {
    if (state !== 'playing' || n <= 0 || arenaOn) return;                      // arena: semua pemain level 1 (adil)
    if (player.level >= MAX_LEVEL) { player.xp = 0; return; }
    n = Math.round(n * (1 + bmods().xp));
    player.xp += n;
    let up = 0;
    while (player.level < MAX_LEVEL && player.xp >= xpNeed(player.level)) { player.xp -= xpNeed(player.level); player.level++; up++; }
    if (up) levelUp();
  }
  function levelUp() {
    player.hp = Math.min(100, player.hp + 35);
    toast(t('lvl_toast', { n: player.level }), 2.8);
    GameAudio.sfx.record();
    burst(26, player.x, 1.4 * scaleNow / 1.1, player.z);
    shake = Math.max(shake, 0.25);
    showDmg(player.x, (player.gy || 0) + 3.2 * scaleNow / 1.1, player.z, t('lvl_pop', { n: player.level }), 'gain', 1.5);
    try { if (lvFlash && lvFlash.classList) { lvFlash.classList.remove('on'); void lvFlash.offsetWidth; lvFlash.classList.add('on'); } } catch (e) { /* abaikan */ }
  }
  const heroShadow = makeDynShadow();
  scene.add(heroShadow);

  let dexInit = false, dexHome = false;
  let state = 'menu';               // 'menu' | 'playing' | 'over'
  let time = 0, runTime = 0, clock = 0;
  let runCoins = 0, kills = 0, overAt = 0, startPerf = 0;
  let powerLeft = 0, scaleNow = curChar.scale * lvScale(1), phase = 0, deathReason = '';
  let preds = [], spawnCd = 4, animalCd = 2, chased = false, isNight = false, lastBiome = null;
  let biteVoiceT = -9;
  let swimming = false, swimBlend = 0, swimToastCd = 0, strokeT = 0, ringT = 0;
  let bagOpen = false, lastStepIdx = 0, climbLocked = false, climbToastCd = 0, biomeCd = 0, drinkCd = 0, toastT = 0, saveT = 0, hurtT = 0, shake = 0;
  let camGy = 0, lvDay = 0;
  let camYaw = 0, camPitch = 0.71, camLift = 0;
  let camX = 0, camZ = 0, camLead = { x: 0, z: 0 }, lastWet = false, shown = {}, camZoom = 1, camBx = 0, camBz = 0;

  GameAudio.setIntensity(() => (chased ? 0.95 : isNight ? 0.4 : 0.1));

  // ---------- Koin yang diambil terbang ke dino ----------
  const flyCoins = [];
  let coinStreak = 0, coinStreakT = 0;
  function updateFlyCoins(dt) {
    coinStreakT -= dt;
    if (coinStreakT <= 0) coinStreak = 0;
    for (let i = flyCoins.length - 1; i >= 0; i--) {
      const f = flyCoins[i];
      f.t += dt;
      const u = Math.min(1, f.t / 0.38), e = u * u * (3 - 2 * u);
      const ty = (player.gy || 0) + player.y + 1.5 * scaleNow / 1.1;
      f.mesh.position.set(lerp(f.x0, player.x, e), lerp(f.y0, ty, e) + Math.sin(u * Math.PI) * 1.0, lerp(f.z0, player.z, e));
      f.mesh.rotation.y += dt * 18;
      f.mesh.scale.setScalar(u < 0.4 ? 1 + u * 1.2 : 1.5 * (1 - (u - 0.4) / 0.6) + 0.05);
      if (u >= 1) { scene.remove(f.mesh); flyCoins.splice(i, 1); }
    }
  }


  // ---------- Kantong koin: koin tumpah saat dino diserang ----------
  // Koin hasil perjalanan ini ada di 'kantong'. Terkena serangan -> sebagian tumpah perlahan; HP <= 25% -> semuanya tumpah.
  // Koin yang tumpah dan diambil kembali hanya bernilai 50%.
  const SPILL_HIT = 0.12, SPILL_LOW_HP = 0.25, SPILL_BACK = 0.5, DROP_LIFE = 32;
  const drops = [], spillQ = [];
  let lowSpilled = false;
  const pouch = () => Math.max(0, Math.min(runCoins, save.coins));
  function spillCoins(lost, slow) {
    lost = Math.floor(lost);
    if (lost <= 0) return;
    runCoins -= lost; save.coins -= lost;                  // hilang dari kantong saat itu juga
    if (runCoins < 0) runCoins = 0;
    const k = Math.max(1, Math.min(lost, slow ? 5 : 14));
    let left = lost;
    for (let i = 0; i < k; i++) {
      const portion = i === k - 1 ? left : Math.floor(lost / k);
      left -= portion;
      spillQ.push({ at: clock + i * (slow ? 0.2 : 0.035), val: Math.max(1, Math.round(portion * SPILL_BACK)), n: portion });
    }
    showDmg(player.x, (player.gy || 0) + player.y + 3.3 * scaleNow / 1.1, player.z, '-' + lost + ' 🪙', 'hurt', 1.15);
    writeSave();
  }
  function emitDrop(val) {
    const m = makeCoin();
    m.scale.setScalar(0.9);
    const ang = Math.random() * Math.PI * 2, sp = rand(2.2, 5.2);
    const y0 = (player.gy || 0) + player.y + 1.4 * scaleNow / 1.1;
    m.position.set(player.x, y0, player.z);
    scene.add(m);
    const dsh = new THREE.Mesh(coinShGeo, mCoinSh); dsh.renderOrder = 2; scene.add(dsh);
    drops.push({ sh: dsh, mesh: m, x: player.x, y: y0, z: player.z, vx: Math.cos(ang) * sp, vy: rand(5, 8.5), vz: Math.sin(ang) * sp, val, t: 0, rest: false });
    starBurst(player.x, y0, player.z, 2, 'gain');
    GameAudio.sfx.coin();
  }
  function updateDrops(dt) {
    for (let i = spillQ.length - 1; i >= 0; i--) if (clock >= spillQ[i].at) { emitDrop(spillQ[i].val); spillQ.splice(i, 1); }
    const sc = scaleNow / 1.1;
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.t += dt;
      if (d.fixed) {                                                    // koin harta area tantangan: diam melayang, tidak lenyap
        d.mesh.rotation.y += dt * 3;
        d.mesh.position.y = d.by + Math.sin(clock * 2.6 + d.ph) * 0.16;
        const fx = d.x - player.x, fz = d.z - player.z;
        if (fx * fx + fz * fz < (1.7 * sc) * (1.7 * sc) && Math.abs((player.gnd + player.y + 0.9 * sc) - d.y) < 2.3) {
          runCoins += d.val; addC(d.val); zoneTaken.add(d.zkey);
          flyCoins.push({ mesh: d.mesh, t: 0, x0: d.x, y0: d.mesh.position.y, z0: d.z });
          showDmg(d.x, d.mesh.position.y + 0.5, d.z, '+' + d.val, 'gain', 0.9);
          GameAudio.sfx.coin();
          drops.splice(i, 1);
        }
        continue;
      }
      d.mesh.rotation.y += dt * (d.rest ? 3 : 14);
      if (!d.rest) {
        d.vy -= 24 * dt;
        d.x += d.vx * dt; d.z += d.vz * dt; d.y += d.vy * dt;
        const gnd = Math.max(heightAt(d.x, d.z), WL) + 0.7;
        if (d.y <= gnd) {
          d.y = gnd;
          if (d.vy < -3.5) { d.vy = -d.vy * 0.4; d.vx *= 0.55; d.vz *= 0.55; } else { d.rest = true; d.vx = d.vz = d.vy = 0; }
        }
        d.mesh.position.set(d.x, d.y, d.z);
      } else d.mesh.position.y = Math.max(heightAt(d.x, d.z), WL) + 0.7 + Math.sin(clock * 4 + i) * 0.1;
      if (d.sh) { if (!d.tilted && d.rest) { tiltShadow(d.sh, d.x, d.z, 0.14); d.tilted = true; } else if (!d.tilted) d.sh.position.set(d.x, Math.max(heightAt(d.x, d.z), WL) + 0.14, d.z); const q = clamp(1 - (d.mesh.position.y - Math.max(heightAt(d.x, d.z), WL)) * 0.25, 0.4, 1); d.sh.scale.set(q, 1, q); }
      d.mesh.visible = d.t < DROP_LIFE - 6 || Math.sin(d.t * 22) > -0.2;       // berkedip sebelum lenyap
      const dx = d.x - player.x, dz = d.z - player.z;
      if (d.t > 0.45 && dx * dx + dz * dz < (1.7 * sc) * (1.7 * sc) && player.y < 1.8) {
        runCoins += d.val; addC(d.val);
        flyCoins.push({ mesh: d.mesh, t: 0, x0: d.x, y0: d.mesh.position.y, z0: d.z });
        d.mesh.visible = true; if (d.sh) scene.remove(d.sh);
        showDmg(d.x, d.mesh.position.y + 0.5, d.z, '+' + d.val, 'gain', 0.9);
        GameAudio.sfx.coin();
        drops.splice(i, 1);
      } else if (d.t > DROP_LIFE) { scene.remove(d.mesh); if (d.sh) scene.remove(d.sh); drops.splice(i, 1); }
    }
  }
  function clearDrops() { for (const d of drops) { scene.remove(d.mesh); if (d.sh) scene.remove(d.sh); } drops.length = 0; spillQ.length = 0; lowSpilled = false; }


  // ---------- Area Tantangan: objek (batu pijakan, peti, pintu) yang dimuat saat pemain mendekat ----------
  const zoneObjs = new Map();                                     // id zona -> { group, chests, door, coins, geos }
  const mPillar = new THREE.MeshLambertMaterial({ vertexColors: true });
  // gradasi batu: gelap di dasar -> terang di puncak, lapisan strata halus, bidang atas paling terang
  function stoneShade(geo, hgt, seed) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, cols = new Float32Array(pos.count * 3), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = clamp(pos.getY(i) / hgt + 0.5, 0, 1);
      const band = Math.floor(t * 7), bn = (Math.sin(band * 12.9898 + seed) * 43758.5453) % 1;
      let l = 0.34 + t * 0.30 + (bn - Math.floor(bn) - 0.5) * 0.07;
      if (nor.getY(i) > 0.9) l = 0.78;
      const wx = pos.getX(i), wz = pos.getZ(i), g = Math.sin(wx * 2.3 + wz * 1.7 + seed) * 0.025;
      c.setRGB(l + g + 0.01, l + g, l + g - 0.03); cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  const mPillarOld = std(0x8d8a80), mChestBody = std(0x7b4a1e), mChestGold = std(0xffc107, { emissive: 0x6b4a00 });
  const chestBodyGeo = new THREE.BoxGeometry(1.1, 0.65, 0.75), chestLidGeo = new THREE.BoxGeometry(1.12, 0.3, 0.78), chestBandGeo = new THREE.BoxGeometry(0.16, 0.7, 0.8);
  const doorPostGeo = new THREE.BoxGeometry(0.7, 3.4, 0.7), doorTopGeo = new THREE.BoxGeometry(3.6, 0.7, 0.8), doorDiscGeo = new THREE.CircleGeometry(1.3, 28);
  const mDoorDisc = new THREE.MeshBasicMaterial({ color: 0x7fe9ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
  function makeChest() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(chestBodyGeo, mChestBody); body.position.y = 0.33; g.add(body);
    const band = new THREE.Mesh(chestBandGeo, mChestGold); band.position.y = 0.34; g.add(band);
    const lid = new THREE.Group(); lid.position.set(0, 0.66, -0.37);                // engsel di belakang
    const lm = new THREE.Mesh(chestLidGeo, mChestBody); lm.position.set(0, 0.15, 0.37); lid.add(lm);
    const lb = new THREE.Mesh(chestBandGeo, mChestGold); lb.scale.set(1, 0.45, 1); lb.position.set(0, 0.2, 0.37); lid.add(lb);
    g.add(lid); g.userData.lid = lid;
    return g;
  }
  function buildZoneObjs(Zn) {
    const geos = [], group = new THREE.Group(), O = { Zn, group, chests: [], coins: [], geos, door: null };
    group.userData.keep = true;
    // batu pijakan: tiang batu dari dasar jurang sampai puncak
    Zn.pillars.forEach((p) => {
      const hgt = p.top - Zn.floor + 0.6;
      const geo = new THREE.CylinderGeometry(p.r, p.r + 0.55, hgt, 12, 7); geos.push(geo);
      stoneShade(geo, hgt, p.x * 7.13 + p.z * 3.7);
      const col = new THREE.Mesh(geo, mPillar); col.position.set(p.x, Zn.floor + hgt / 2 - 0.6, p.z); group.add(col);
    });
    // monumen logo di tengah pulau
    const mon = makeMonument(); mon.position.set(Zn.cx, Zn.isl, Zn.cz); mon.rotation.y = Zn.a0 + Math.PI / 2; group.add(mon);
    // peti harta
    for (let i = 0; i < 3; i++) {
      const ang = Zn.a0 + 0.6 + i * 2.0944, cxp = Zn.cx + Math.cos(ang) * 6.3, czp = Zn.cz + Math.sin(ang) * 6.3;
      const ch = makeChest(); ch.position.set(cxp, Zn.isl, czp); ch.rotation.y = -ang + Math.PI / 2; group.add(ch);
      const key = Zn.id + ':chest' + i, open = zoneTaken.has(key);
      if (open) ch.userData.lid.rotation.x = -1.25;
      O.chests.push({ key, x: cxp, z: czp, mesh: ch, open, t: open ? 1 : 0 });
    }
    // pintu kembali ke titik awal
    {
      const ang = Zn.a0 + 3.1416 + 0.9, dx = Zn.cx + Math.cos(ang) * 9.4, dz = Zn.cz + Math.sin(ang) * 9.4;
      const g = new THREE.Group();
      for (const sx of [-1.45, 1.45]) { const p = new THREE.Mesh(doorPostGeo, mPillarOld); p.position.set(sx, 1.7, 0); g.add(p); }
      const top = new THREE.Mesh(doorTopGeo, mPillarOld); top.position.y = 3.55; g.add(top);
      const disc = new THREE.Mesh(doorDiscGeo, mDoorDisc); disc.position.y = 1.75; disc.scale.set(1.0, 1.25, 1); g.add(disc);
      g.position.set(dx, Zn.isl, dz); g.rotation.y = -ang - Math.PI / 2;
      group.add(g);
      O.door = { x: dx, z: dz, mesh: g, disc };
    }
    scene.add(group);
    // koin: di atas tiap batu, di antara batu (menuntun lompatan), dan di pulau
    const addCoin = (key, x, y, z) => {
      if (zoneTaken.has(key)) return;
      const m = makeCoin(); m.scale.setScalar(0.95); m.position.set(x, y, z); scene.add(m);
      const d = { mesh: m, x, y, z, vx: 0, vy: 0, vz: 0, val: 1, t: 0, rest: true, fixed: true, zkey: key, by: y, ph: Math.random() * 6.28 };
      drops.push(d); O.coins.push(d);
    };
    Zn.pillars.forEach((p, i) => {
      addCoin(Zn.id + ':p' + i, p.x, p.top + 1.1, p.z);
      const q = Zn.pillars[i + 1];
      if (q) addCoin(Zn.id + ':g' + i, (p.x + q.x) / 2, Math.max(p.top, q.top) + 2.0, (p.z + q.z) / 2);
    });
    const doorA = Zn.a0 + 3.1416 + 0.9;
    for (let i = 0; i < 14; i++) { const a = i / 14 * 6.2832; if (Math.abs(Math.atan2(Math.sin(a - doorA), Math.cos(a - doorA))) < 0.5) continue; addCoin(Zn.id + ':r' + i, Zn.cx + Math.cos(a) * 8.6, Zn.isl + 0.9, Zn.cz + Math.sin(a) * 8.6); }
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.2832; addCoin(Zn.id + ':s' + i, Zn.cx + Math.cos(a) * 3.8, Zn.isl + 0.9, Zn.cz + Math.sin(a) * 3.8); }
    return O;
  }
  function disposeZoneObjs(O) {
    scene.remove(O.group);
    for (const g of O.geos) g.dispose();
    for (const d of O.coins) { scene.remove(d.mesh); const i = drops.indexOf(d); if (i >= 0) drops.splice(i, 1); }
  }
  function clearZoneObjs() { for (const O of zoneObjs.values()) disposeZoneObjs(O); zoneObjs.clear(); }
  function respawnFromChasm(Zn) {
    player.x = Zn.entry.x; player.z = Zn.entry.z;
    player.vx = player.vz = 0; player.y = 0; player.vy = 0;
    player.gnd = heightAt(player.x, player.z);
    player.yaw = Math.atan2(-(Zn.cx - player.x), -(Zn.cz - player.z));
    player.invuln = Math.max(player.invuln, 1.2);
    player.stamina = Math.min(player.stamina, 45);
    camX = player.x; camZ = player.z; camGy = player.gnd;
    hurtT = 0.15; shake = Math.max(shake, 0.4);
    GameAudio.sfx.splash();
    if (arenaOn) { try { Arena.tp('fall', player.x, player.z); } catch (e) { /* abaikan */ } }
    toast(t('fall_chasm'), 2.6);
  }
  function useDoor() {
    player.x = 2.5; player.z = 2.5;
    if (arenaOn) { try { Arena.tp('door', 2.5, 2.5); } catch (e) { /* abaikan */ } }
    player.vx = player.vz = 0; player.y = 0; player.vy = 0;
    player.gnd = heightAt(player.x, player.z);
    player.invuln = Math.max(player.invuln, 1.0);
    camX = player.x; camZ = player.z; camGy = player.gnd;
    starBurst(player.x, player.gnd + 1.4, player.z, 14, 'gain');
    GameAudio.sfx.power();
    toast(t('door_back'), 2.6);
  }
  let doorCd = 0;
  function updateZones(dt) {
    // muat / buang objek zona sesuai jarak
    const ix = Math.floor((player.x + ZC / 2) / ZC), iz = Math.floor((player.z + ZC / 2) / ZC);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const Zn = zoneCell(ix + a, iz + b);
      if (!Zn) continue;
      const d = Math.hypot(player.x - Zn.cx, player.z - Zn.cz);
      if (d < 100 && !zoneObjs.has(Zn.id)) zoneObjs.set(Zn.id, buildZoneObjs(Zn));
      if (d < 85 && !zoneSeen.has(Zn.id)) { zoneSeen.add(Zn.id); toast(t('zone_tip'), 4); }
    }
    for (const [id, O] of Array.from(zoneObjs)) {
      if (Math.hypot(player.x - O.Zn.cx, player.z - O.Zn.cz) > 135) { disposeZoneObjs(O); zoneObjs.delete(id); continue; }
      // peti: terbuka saat didekati
      for (const c of O.chests) {
        if (!c.open && Math.hypot(player.x - c.x, player.z - c.z) < 2.3 && player.y < 1.5) {
          c.open = true; zoneTaken.add(c.key);
          runCoins += 25; addC(25); writeSave();
          starBurst(c.x, O.Zn.isl + 1.0, c.z, 14, 'gain');
          showDmg(c.x, O.Zn.isl + 2.0, c.z, '+25 🪙', 'gain', 1.3);
          GameAudio.sfx.power();
          toast(t('chest'), 1.8);
        }
        const tgt = c.open ? 1 : 0;
        c.t += (tgt - c.t) * Math.min(1, dt * 6);
        c.mesh.userData.lid.rotation.x = -1.25 * c.t;
      }
      // pintu: kilau berputar; menyentuhnya = kembali ke titik awal
      if (O.door) {
        O.door.disc.rotation.z += dt * 1.6;
        O.door.disc.material.opacity = 0.5 + 0.15 * Math.sin(clock * 3);
        if (doorCd <= 0 && Math.hypot(player.x - O.door.x, player.z - O.door.z) < 2.3 && player.y < 2) { doorCd = 2; useDoor(); }
      }
    }
    doorCd -= dt;
  }

  // ---------- Angka kerusakan melayang ----------
  const fxLayer = $('fx');
  const dmgPool = [];
  try {
    if (fxLayer && document.createElement) {
      for (let i = 0; i < 14; i++) {
        const el = document.createElement('div');
        el.className = 'dmg';
        el.style.opacity = '0';
        fxLayer.appendChild(el);
        dmgPool.push({ el, life: 1, max: 1, x: 0, y: 0, z: 0, big: 1 });
      }
    }
  } catch (e) { dmgPool.length = 0; }
  function showDmg(x, y, z, text, cls, big) {
    if (!dmgPool.length) return;
    let d = dmgPool.find((q) => q.life >= q.max);
    if (!d) d = dmgPool.reduce((a, b) => (a.life / a.max > b.life / b.max ? a : b));
    d.life = 0; d.max = cls === 'crit' ? 1.3 : 1.05;
    d.x = x + rand(-0.35, 0.35); d.y = y; d.z = z; d.big = big || 1;
    d.el.textContent = text;
    d.el.className = 'dmg ' + (cls || '');
  }
  const projV = new THREE.Vector3();
  function updateDmg(dt) {
    if (!dmgPool.length) return;
    const w = window.innerWidth, h = window.innerHeight;
    for (const d of dmgPool) {
      if (d.life >= d.max) continue;
      d.life += dt;
      if (d.life >= d.max) { d.el.style.opacity = '0'; continue; }
      const t = d.life / d.max;
      projV.set(d.x, d.y + t * 1.8, d.z).project(camera);
      const sx = (projV.x * 0.5 + 0.5) * w, sy = (-projV.y * 0.5 + 0.5) * h;
      if (!isFinite(sx) || !isFinite(sy) || projV.z > 1) { d.el.style.opacity = '0'; continue; }
      const pop = t < 0.18 ? 0.5 + (t / 0.18) * 0.9 : 1.4 - Math.min(0.4, (t - 0.18) * 0.5);
      d.el.style.transform = 'translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px) translate(-50%,-50%) scale(' + (pop * d.big).toFixed(2) + ')';
      d.el.style.opacity = t < 0.6 ? '1' : String(Math.max(0, 1 - (t - 0.6) / 0.4));
    }
  }

  // ---------- Bintang efek pukulan & bar HP musuh ----------
  const starPool = [], barPool = [];
  try {
    if (fxLayer && document.createElement) {
      for (let i = 0; i < 28; i++) {
        const el = document.createElement('div');
        el.className = 'star'; el.style.opacity = '0';
        fxLayer.appendChild(el);
        starPool.push({ el, life: 1, max: 1, x: 0, y: 0, z: 0, ox: 0, oy: 0, vx: 0, vy: 0, rot: 0 });
      }
      for (let i = 0; i < 6; i++) {
        const el = document.createElement('div');
        el.className = 'ebar'; el.style.opacity = '0';
        const nm = document.createElement('span'), tr = document.createElement('b'), fi = document.createElement('i');
        tr.appendChild(fi); el.appendChild(nm); el.appendChild(tr);
        fxLayer.appendChild(el);
        barPool.push({ el, nm, fi, last: -1, name: '', cls: '' });
      }
    }
  } catch (e) { starPool.length = 0; barPool.length = 0; }
  // ---------- Rasa puas: hit-stop (jeda sekejap saat pukulan telak), kombo, kupu-kupu emas, bintang jatuh ----------
  let hitStop = 0; const combo = { n: 0, t: 0 };
  function hitFeel(big) {
    if (state !== 'playing') return;
    hitStop = Math.max(hitStop, big ? 0.09 : 0.035);
    combo.n++; combo.t = 3;
    if (combo.n >= 3) showDmg(player.x, (player.gy || 0) + player.y + 3.4 * scaleNow / 1.1, player.z, 'COMBO x' + combo.n, 'crit', 1 + Math.min(0.5, combo.n * 0.04));
    if (combo.n % 5 === 0) {
      starBurst(player.x, (player.gy || 0) + player.y + 1.6 * scaleNow / 1.1, player.z, 12, 'gain'); shake = Math.max(shake, 0.3);
      try { GameAudio.sfx.record(); } catch (e) { /* abaikan */ }
      if (!arenaOn) { runCoins += 3; addC(3); }
    }
  }
  function starBurst(x, y, z, n, cls) {
    if (!starPool.length) return;
    n = Math.max(2, Math.round(n * fxMul));
    const ch = cls === 'water' ? '●' : cls === 'hurt' ? '✸' : cls === 'gain' ? '✦' : '★';
    for (let k = 0; k < n; k++) {
      let d = starPool.find((q) => q.life >= q.max);
      if (!d) return;
      const a = rand(0, Math.PI * 2), sp = rand(60, 170);
      d.life = 0; d.max = rand(0.45, 0.75);
      d.x = x; d.y = y; d.z = z; d.ox = 0; d.oy = 0;
      d.vx = Math.cos(a) * sp; d.vy = Math.sin(a) * sp - 70; d.rot = rand(-180, 180);
      d.el.textContent = ch; d.el.className = 'star ' + (cls || 'hit');
      d.el.style.fontSize = (cls === 'water' ? Math.round(rand(5, 10)) : Math.round(rand(11, 21))) + 'px';
    }
  }
  function updateStars(dt) {
    if (!starPool.length) return;
    const w = window.innerWidth, h = window.innerHeight;
    for (const d of starPool) {
      if (d.life >= d.max) continue;
      d.life += dt;
      if (d.life >= d.max) { d.el.style.opacity = '0'; continue; }
      const t = d.life / d.max;
      d.vy += 420 * dt; d.ox += d.vx * dt; d.oy += d.vy * dt;
      projV.set(d.x, d.y, d.z).project(camera);
      if (!isFinite(projV.x) || projV.z > 1) { d.el.style.opacity = '0'; continue; }
      const sx = (projV.x * 0.5 + 0.5) * w + d.ox, sy = (-projV.y * 0.5 + 0.5) * h + d.oy;
      d.el.style.transform = 'translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px) translate(-50%,-50%) rotate(' + (d.rot * t).toFixed(0) + 'deg) scale(' + (1.2 - t * 0.7).toFixed(2) + ')';
      d.el.style.opacity = t < 0.5 ? '1' : String(Math.max(0, 1 - (t - 0.5) / 0.5));
    }
  }
  function updateBars() {
    if (!barPool.length) return;
    const w = window.innerWidth, h = window.innerHeight;
    const cand = [];
    for (const p of preds) {
      if (p.dead || !(p.hp < p.maxHp)) continue;
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d < 26) cand.push({ p, d });
    }
    cand.sort((a, b) => a.d - b.d);
    barPool.forEach((b, i) => {
      const c = cand[i];
      if (!c || state !== 'playing') { if (b.last !== -2) { b.el.style.opacity = '0'; b.last = -2; } return; }
      const p = c.p;
      projV.set(p.x, heightAt(p.x, p.z) + (p.def.giant ? 5.6 : 2.3 * p.def.scale), p.z).project(camera);
      if (!isFinite(projV.x) || projV.z > 1) { b.el.style.opacity = '0'; b.last = -2; return; }
      const sx = (projV.x * 0.5 + 0.5) * w, sy = (-projV.y * 0.5 + 0.5) * h;
      b.el.style.transform = 'translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px) translate(-50%,-50%)';
      b.el.style.opacity = '1';
      const pct = Math.round(clamp(p.hp / p.maxHp, 0, 1) * 100);
      if (b.last !== pct) { b.last = pct; b.fi.style.width = pct + '%'; }
      if (b.name !== p.def.name) { b.name = p.def.name; b.nm.textContent = p.def.name; }
      const cls = 'ebar' + (p.def.timid || p.def.neutral ? ' calm' : '') + (p.enraged ? ' rage' : '');
      if (b.cls !== cls) { b.cls = cls; b.el.className = cls; }
    });
  }

  // ---------- HUD ----------
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    toastT = ms || 1.8;
  }
  function setW(el, key, v) {
    const p = Math.round(clamp(v, 0, 100));
    if (shown[key] !== p) { shown[key] = p; el.style.width = p + '%'; }
  }
  // ---------- Mini map (arah atas = arah kamera) ----------
  const miniEl = $('miniMap');
  let mmCtx = null;
  try { mmCtx = miniEl && miniEl.getContext ? miniEl.getContext('2d') : null; } catch (e) { mmCtx = null; }
  const MM_N = 34, MM_R = 85;
  let mmTerr = null, mmTerrCtx = null, mmOk = !!mmCtx, mmX = 1e9, mmZ = 1e9, mmYaw = 9, mmT = 0, mmE = 0;
  function mmBuildTerrain() {
    if (!mmTerr) { mmTerr = document.createElement('canvas'); mmTerr.width = mmTerr.height = MM_N; mmTerrCtx = mmTerr.getContext('2d'); }
    const img = mmTerrCtx.createImageData(MM_N, MM_N), d = img.data;
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw), fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    for (let j = 0; j < MM_N; j++) for (let i = 0; i < MM_N; i++) {
      const u = ((i + 0.5) / MM_N * 2 - 1) * MM_R, v = ((j + 0.5) / MM_N * 2 - 1) * MM_R;
      const wx = player.x + rx * u - fx * v, wz = player.z + rz * u - fz * v;
      const h = heightAt(wx, wz), h2 = heightAt(wx + 3, wz + 3);
      let r, g, b;
      if (h < WL - 0.05) { const dp = Math.min(1, (WL - h) / 3); r = 58 - 22 * dp; g = 140 - 40 * dp; b = 200 - 30 * dp; }
      else if (h < WL + 0.5) { r = 206; g = 190; b = 132; }
      else {
        const tt = clamp((h - WL) / 14, 0, 1);
        r = 92 + tt * 70; g = 156 - tt * 22; b = 72 + tt * 12;
        const steep = Math.abs(h2 - h) / 4.2;                  // lereng curam / tebing -> abu-abu batu
        const rk = clamp((steep - 0.55) / 0.4, 0, 1);
        r += (122 - r) * rk; g += (116 - g) * rk; b += (108 - b) * rk;
        const sh = 1 + clamp((h - h2) / 4.2 * 0.5, -0.22, 0.22);
        r *= sh; g *= sh; b *= sh;
      }
      const o = (j * MM_N + i) * 4;
      d[o] = clamp(r, 0, 255); d[o + 1] = clamp(g, 0, 255); d[o + 2] = clamp(b, 0, 255); d[o + 3] = 255;
    }
    mmTerrCtx.putImageData(img, 0, 0);
    mmX = player.x; mmZ = player.z; mmYaw = camYaw;
  }
  function updateMinimap(dt) {
    if (!mmOk || state !== 'playing') return;
    mmE += dt;
    if (mmE < 0.1) return;
    mmT += mmE; mmE = 0;
    try {
      if (!mmTerr || ((Math.hypot(player.x - mmX, player.z - mmZ) > 6 || Math.abs(camYaw - mmYaw) > 0.12) && mmT > 0.25) || mmT > 2) { mmBuildTerrain(); mmT = 0; }
      const S = miniEl.width, c = S / 2, rad = c - 3, k = rad / MM_R;
      const rx = Math.cos(camYaw), rz = -Math.sin(camYaw), fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
      const ctx = mmCtx;
      ctx.clearRect(0, 0, S, S);
      ctx.save();
      ctx.beginPath(); ctx.arc(c, c, c - 1, 0, Math.PI * 2); ctx.clip();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(mmTerr, 0, 0, S, S);
      if (isNight) { ctx.fillStyle = 'rgba(10,20,50,0.38)'; ctx.fillRect(0, 0, S, S); }
      const pt = (x, z) => { const dx = x - player.x, dz = z - player.z; return [c + (dx * rx + dz * rz) * k, c - (dx * fx + dz * fz) * k, Math.hypot(dx, dz)]; };
      // kolam
      ctx.fillStyle = 'rgba(70,160,225,0.95)';
      for (const ch of chunks.values()) for (const pd of ch.ponds) {
        const q = pt(pd.x, pd.z); if (q[2] > MM_R + 8) continue;
        ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(2, (pd.r || 4) * k), 0, Math.PI * 2); ctx.fill();
      }
      // area tantangan lompat: penanda berlian emas
      {
        const mix = Math.floor((player.x + ZC / 2) / ZC), miz = Math.floor((player.z + ZC / 2) / ZC);
        ctx.fillStyle = '#ffeb3b'; ctx.strokeStyle = '#3e2723'; ctx.lineWidth = 1;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const Zm = zoneCell(mix + a, miz + b); if (!Zm) continue;
          const q = pt(Zm.cx, Zm.cz); const edge = q[2] > MM_R - 6;
          let qx = q[0], qy = q[1];
          if (edge) { const f = (MM_R - 6) / q[2]; qx = c + (qx - c) * f; qy = c + (qy - c) * f; }       // di luar jangkauan: ditempel di tepi
          ctx.beginPath(); ctx.moveTo(qx, qy - 5); ctx.lineTo(qx + 4, qy); ctx.lineTo(qx, qy + 5); ctx.lineTo(qx - 4, qy); ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      }
      // koin & telur
      let n = 0;
      ctx.fillStyle = '#ffd54f';
      for (const ch of chunks.values()) for (const cn of ch.coins) {
        if (taken.has(cn.id) || n > 70) continue;
        const q = pt(cn.x, cn.z); if (q[2] > MM_R) continue;
        ctx.fillRect(q[0] - 1, q[1] - 1, 2.2, 2.2); n++;
      }
      for (const ch of chunks.values()) for (const eg of ch.eggs) {
        if (taken.has(eg.id)) continue;
        const q = pt(eg.x, eg.z); if (q[2] > MM_R) continue;
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(q[0], q[1], 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ff9800'; ctx.lineWidth = 1; ctx.stroke();
      }
      // hewan & musuh
      for (const p of preds) {
        if (p.dead) continue;
        const hostile = !p.def.timid && !p.def.neutral;
        let q = pt(p.x, p.z);
        let edge = false;
        if (q[2] > MM_R) { if (!hostile || q[2] > MM_R * 1.8) continue; const a = Math.atan2(q[1] - c, q[0] - c); q = [c + Math.cos(a) * rad, c + Math.sin(a) * rad]; edge = true; }
        const active = hostile && p.state !== 'wander' && p.state !== 'flee';
        ctx.fillStyle = hostile ? (active ? '#ff3b30' : '#ff8a65') : '#c6ff6a';
        ctx.globalAlpha = edge ? 0.6 : 1;
        ctx.beginPath(); ctx.arc(q[0], q[1], active ? 3.4 : 2.6, 0, Math.PI * 2); ctx.fill();
        if (active) { ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1; ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
      // pemain online lain: titik KUNING besar bercincin putih (koin = kotak kecil, area tantangan = berlian)
      if (arenaOn && typeof Arena !== 'undefined') for (const r of Arena.remotes.values()) {
        if (r.npc || !r.seen || !r.near) continue;
        let q = pt(r.x, r.z), edge = false;
        if (q[2] > MM_R) { const a = Math.atan2(q[1] - c, q[0] - c); q = [c + Math.cos(a) * rad, c + Math.sin(a) * rad]; edge = true; }
        ctx.globalAlpha = edge ? 0.75 : 1;
        ctx.fillStyle = '#ffee00'; ctx.strokeStyle = '#4e342e'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(q[0], q[1], 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(q[0], q[1], 6.2, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      // pemain (segitiga menghadap arah jalan)
      const pfx = -Math.sin(player.yaw), pfz = -Math.cos(player.yaw);
      const ax = pfx * rx + pfz * rz, ay = -(pfx * fx + pfz * fz), an = Math.atan2(ay, ax);
      ctx.save(); ctx.translate(c, c); ctx.rotate(an);
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#1b3a10'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4.5, 4.2); ctx.lineTo(-2.2, 0); ctx.lineTo(-4.5, -4.2); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      // utara (-Z)
      const na = Math.atan2(-(-fz), -rz);               // arah layar dari vektor utara
      const nx = c + Math.cos(na) * (c - 9), ny = c + Math.sin(na) * (c - 9);
      ctx.fillStyle = '#ffeb3b'; ctx.font = 'bold ' + Math.round(S * 0.11) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2.5; ctx.strokeText('U', nx, ny); ctx.fillText('U', nx, ny);
    } catch (e) { mmOk = false; }
  }

  function updateHud() {
    setW(fHp, 'hp', player.hp);
    setW(fHunger, 'hu', player.hunger);
    setW(fThirst, 'th', player.thirst);
    setW(fStam, 'st', player.stamina);
    rowHunger.classList.toggle('low', player.hunger < 20);
    rowThirst.classList.toggle('low', player.thirst < 20);
    if (shown.c !== runCoins) {
      shown.c = runCoins; elCoins.textContent = runCoins;
      try { if (coinBox && coinBox.classList) { coinBox.classList.remove('pop'); void coinBox.offsetWidth; coinBox.classList.add('pop'); } } catch (e) { /* abaikan */ }
    }
    if (shown.l !== player.level) { shown.l = player.level; if (lvNo) lvNo.textContent = player.level; }
    const xpPct = player.level >= MAX_LEVEL ? 100 : Math.round(player.xp / xpNeed(player.level) * 100);
    if (shown.x !== xpPct) { shown.x = xpPct; if (xpFill) xpFill.style.width = xpPct + '%'; }
    const day = Math.floor(runTime / DAY_LEN) + 1;
    if (shown.d !== day) { shown.d = day; elDay.textContent = day; }
    const ic = isNight ? '🌙' : '☀️';
    if (shown.i !== ic) { shown.i = ic; elTime.textContent = ic; }
    if (powerEl) {
      const p = powerLeft > 0 ? Math.round(powerLeft / POWER_TIME * 100) : 0;
      if (shown.p !== p) { shown.p = p; powerFill.style.width = p + '%'; }
      powerEl.classList.toggle('warn', powerLeft > 0 && powerLeft < 2.5);
      powerEl.classList.toggle('hidden', powerLeft <= 0);
    }
  }
  function refreshPanels() {
    hudEl.classList.toggle('hidden', state !== 'playing');
    menuEl.classList.add('hidden');                          // halaman utama = layar Pilih Dino (lihat syncDex)
    if (dexInit) syncDex();
    overEl.classList.toggle('hidden', state !== 'over');
    document.body.classList.toggle('playing', state === 'playing');
    $('menuTotal').textContent = save.coins;
    $('menuBest').textContent = save.bestDays;
  }

  // ---------- Hujan (jarang & sebentar; jadwal ditentukan jam dunia, jadi di arena semua pemain mengalaminya bersamaan) ----------
  const RAIN_CYC = 280, RAIN_N = 280;
  function rainTarget(tm) {
    const c = Math.floor(tm / RAIN_CYC); if (c < 1) return 0;
    if (hash(c, 7, worldSeed + 4242) / 4294967296 > 0.4) return 0;                      // ~40% siklus ada hujan
    const st = RAIN_CYC * c + 30 + (hash(c, 8, worldSeed + 4242) / 4294967296) * 100, du = 50 + (hash(c, 9, worldSeed + 4242) / 4294967296) * 70;
    const u = tm - st; if (u < 0 || u > du) return 0;
    return Math.min(1, u / 6, (du - u) / 6);                                            // masuk & keluar perlahan
  }
  let rainK = 0, rainWas = false;
  const rainPos = new Float32Array(RAIN_N * 6), rainOff = new Float32Array(RAIN_N * 3);
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: 0xc6dcef, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const rainMesh = new THREE.LineSegments(rainGeo, rainMat); rainMesh.frustumCulled = false; rainMesh.visible = false; scene.add(rainMesh);
  for (let i = 0; i < RAIN_N; i++) { rainOff[i * 3] = (Math.random() - 0.5) * 30; rainOff[i * 3 + 1] = Math.random() * 14; rainOff[i * 3 + 2] = (Math.random() - 0.5) * 30; }
  function updateRain(dt) {
    const tgt = state === 'playing' ? rainTarget(runTime) : 0;
    rainK += (tgt - rainK) * Math.min(1, dt * 1.5);
    if (rainK < 0.004) rainK = 0;
    const on = rainK > 0;
    if (on !== rainWas) { rainWas = on; if (on && state === 'playing') toast(t('rain_on'), 2.6); }
    rainMesh.visible = on;
    try { GameAudio.rainAmbience(rainK); } catch (e) { /* abaikan */ }
    if (!on) return;
    rainMat.opacity = 0.5 * rainK;
    const gy = player.gy || 0, wind = 0.12, L = 0.95;
    for (let i = 0; i < RAIN_N; i++) {
      const o = i * 3, k = i * 6;
      rainOff[o + 1] -= (24 + (i % 5) * 1.5) * dt;
      if (rainOff[o + 1] < -1) { rainOff[o + 1] += 14; rainOff[o] = (Math.random() - 0.5) * 30; rainOff[o + 2] = (Math.random() - 0.5) * 30; }
      const x = player.x + rainOff[o], y = gy + rainOff[o + 1], z = player.z + rainOff[o + 2];
      rainPos[k] = x; rainPos[k + 1] = y; rainPos[k + 2] = z;
      rainPos[k + 3] = x + wind * L; rainPos[k + 4] = y + L; rainPos[k + 5] = z;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }

  // ---------- Siklus siang-malam ----------
  const SKY_DAY = [0.62, 0.85, 0.96], SKY_NIGHT = [0.03, 0.06, 0.16], SKY_NIGHT_LIT = [0.26, 0.34, 0.55], SKY_DUSK = [0.95, 0.58, 0.38];
  const nightBoost = () => [0.3, 0.65, 1][save.nb === undefined ? 1 : save.nb] || 0.65;      // 0 = Normal, 1 = Terang (bawaan), 2 = Sangat terang (di luar ruangan)
  function applyDayNight() {
    const ang = (runTime / DAY_LEN) * Math.PI * 2 + 0.3;
    const raw = Math.sin(ang);
    const k = smooth(-0.35, 0.2, raw);                       // 0 = malam, 1 = siang
    const dusk = clamp(1 - Math.abs(raw) * 3.2, 0, 1) * 0.5;
    const nb = nightBoost();
    const rgb = [0, 1, 2].map((i) => lerp(lerp(lerp(SKY_NIGHT[i], SKY_NIGHT_LIT[i], nb), SKY_DAY[i], k), SKY_DUSK[i], dusk));
    scene.background.setRGB(rgb[0], rgb[1], rgb[2]);
    scene.fog.color.setRGB(rgb[0], rgb[1], rgb[2]);
    scene.fog.near = lerp(14 + 14 * nb, 26, k) * fogMul;              // malam: pandangan lebih pendek = lebih tegang
    scene.fog.far = lerp(50 + 12 * nb, 68, k) * fogMul;               // lebih pendek dari area yang dimuat (60 m) supaya tepi dunia tersamar
    mPond.color.setRGB(lerp(0.06, 0.25, k), lerp(0.16, 0.66, k), lerp(0.3, 0.88, k));   // air gelap saat malam
    mDeep.opacity = lerp(0.7, 0.55, k);
    mGlint.opacity = 0.12 + 0.4 * k;
    mShadow.opacity = 0.14 + 0.42 * k;               // siang: bayangan tegas, malam: nyaris tak terlihat
    hemi.intensity = lerp(0.3 + 0.62 * nb, 0.72, k);        // malam: cahaya bulan lembut, makin terang bila pengaturan dinaikkan
    sunLight.intensity = lerp(0.12 + 0.5 * nb, 1.07, k);
    if (rainK > 0) {                                                  // hujan: langit kelabu, pandangan lebih pendek, cahaya meredup
      const r = rainK * 0.75;
      for (let i = 0; i < 3; i++) rgb[i] = lerp(rgb[i], rgb[i] * 0.55 + 0.1, r);
      scene.background.setRGB(rgb[0], rgb[1], rgb[2]); scene.fog.color.setRGB(rgb[0], rgb[1], rgb[2]);
      scene.fog.near *= 1 - 0.3 * rainK; scene.fog.far *= 1 - 0.25 * rainK;
      hemi.intensity *= 1 - 0.12 * rainK; sunLight.intensity *= 1 - 0.4 * rainK; mShadow.opacity *= 1 - 0.7 * rainK;
    }
    isNight = k < 0.4;
    try { GameAudio.nightAmbience(isNight && state === 'playing'); } catch (e) { /* abaikan */ }
  }

  // ---------- Mulai / selesai ----------
  function startGame(opts) {
    const AR = opts && opts.arena === true ? opts : null;
    arenaOn = !!AR; if (!AR) { try { Arena.leave(); } catch (e) { /* abaikan */ } clearRemotes(); }
    if (PLAYABLES[save.char] && PLAYABLES[save.char] !== curChar) applyChar(save.char);
    clearWorld();
    for (const p of preds) removePred(p);
    preds = [];
    worldSeed = AR ? AR.seed : 1 + Math.floor(Math.random() * 1e6);
    pondCache.clear(); zoneReset(); zoneTaken.clear(); zoneSeen.clear();
    camGy = 0; camYaw = 0; camPitch = 0.71; camLift = 0;
    Object.assign(player, {
      x: 0, z: 0, y: 0, vy: 0, vx: 0, vz: 0, yaw: Math.PI,
      hp: 100, hunger: 100, thirst: 100, stamina: 100, exhausted: false,
      invuln: 0, atkT: -1, atkCd: 0, atkHit: false, lastDmg: 99, level: 1, xp: 0, counterT: 0
    });
    setLatch(false);
    roarCd = 0; hordeCd = 70; horde = null; dangerNow = 0; waryNow = 0; swimming = false; swimBlend = 0; time = 0; runTime = 0; runCoins = 0; kills = 0; powerLeft = 0; scaleNow = baseScale(); shake = 0; lvDay = 0;
    spawnCd = 8; animalCd = 2; chased = false; lastBiome = null; biomeCd = 0; drinkCd = 0; deathReason = '';
    camX = 0; camZ = 0; camLead = { x: 0, z: 0 }; shown = {}; camZoom = 1; camBx = 0; camBz = 0;
    if (AR) { player.x = AR.x; player.z = AR.z; }
    state = 'playing';
    shopReset();
    if (AR) { runTime = Arena.worldTime(); lvDay = Math.floor(runTime / DAY_LEN); }
    startPerf = performance.now();
    ensureChunks(true);
    save.runs++;
    refreshPanels();
    updateHud();
    toast(t('start_hint'), 3);
    GameAudio.sfx.start();
    GameAudio.music.start();
  }

  function die(reason) {
    if (state !== 'playing') return;
    state = 'over'; closeShop();
    if (arenaOn) { arenaOn = false; try { Arena.leave(); } catch (e) { /* abaikan */ } clearRemotes(); }
    overAt = performance.now();
    deathReason = reason;
    const days = Math.floor(runTime / DAY_LEN);
    const newBest = days > save.bestDays;
    if (newBest) save.bestDays = days;
    save.kills += kills;
    writeSave();
    GameAudio.music.stop();
    GameAudio.sfx.crash();
    GameAudio.sfx.dino(save.char, 'die', 1);
    if (newBest && days > 0) GameAudio.sfx.record();
    shake = 1;
    $('overReason').textContent = reason;
    $('overDays').textContent = days;
    $('overKills').textContent = kills;
    if ($('overLevel')) $('overLevel').textContent = player.level;
    $('overCoins').textContent = runCoins;
    $('overBest').textContent = newBest && days > 0 ? t('rec_new') : t('rec_line', { n: save.bestDays });
    $('overTotal').textContent = save.coins;
    refreshPanels();

    // Titik sambung ke backend / smart contract
    window.dispatchEvent(new CustomEvent('run:end', {
      detail: { coins: runCoins, days, kills, level: player.level, duration: Math.round(performance.now() - startPerf) }
    }));
  }

  // ---------- Input ----------
  const input = { mx: 0, mz: 0, sprint: false, jump: false, attack: false };
  const keys = {};
  let stick = null;
  const STICK_R = 56;

  stickZone.addEventListener('contextmenu', (e) => e.preventDefault());
  stickZone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    GameAudio.init();
    if (stick || state !== 'playing') return;
    try { stickZone.setPointerCapture(e.pointerId); } catch (err) { /* abaikan */ }
    stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
    stickBase.style.left = (e.clientX - 62) + 'px';
    stickBase.style.top = (e.clientY - 62) + 'px';
    stickKnob.style.left = (e.clientX - 29) + 'px';
    stickKnob.style.top = (e.clientY - 29) + 'px';
    stickBase.classList.remove('hidden');
    stickKnob.classList.remove('hidden');
  });
  stickZone.addEventListener('pointermove', (e) => {
    if (!stick || e.pointerId !== stick.id) return;
    const dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
    const len = Math.hypot(dx, dy);
    const m = Math.min(1, len / STICK_R);
    const nx = len ? dx / len : 0, ny = len ? dy / len : 0;
    stickKnob.style.left = (stick.ox - 29 + nx * m * STICK_R) + 'px';
    stickKnob.style.top = (stick.oy - 29 + ny * m * STICK_R) + 'px';
    const dead = 0.14;
    const mm = m < dead ? 0 : (m - dead) / (1 - dead);       // zona mati kecil, sisanya dipetakan 0..1
    input.mx = nx * mm;
    input.mz = ny * mm;
  });
  function stickEnd(e) {
    if (!stick || (e && e.pointerId !== stick.id)) return;
    stick = null;
    input.mx = 0; input.mz = 0;
    stickBase.classList.add('hidden');
    stickKnob.classList.add('hidden');
  }
  stickZone.addEventListener('pointerup', stickEnd);
  stickZone.addEventListener('pointercancel', stickEnd);

  // geser jari di sisi kanan layar: putar kamera 360° (geser atas/bawah: ubah sudut pandang)
  let camDrag = null;
  if (camZone) {
    camZone.addEventListener('contextmenu', (e) => e.preventDefault());
    camZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      GameAudio.init();
      if (camDrag || state !== 'playing') return;
      try { camZone.setPointerCapture(e.pointerId); } catch (err) { /* abaikan */ }
      camDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    camZone.addEventListener('pointermove', (e) => {
      if (!camDrag || e.pointerId !== camDrag.id) return;
      camYaw -= (e.clientX - camDrag.x) * 0.008;
      camPitch = clamp(camPitch + (e.clientY - camDrag.y) * 0.004, 0.38, 1.2);
      camDrag.x = e.clientX; camDrag.y = e.clientY;
    });
    const camEnd = (e) => { if (camDrag && (!e || e.pointerId === camDrag.id)) camDrag = null; };
    camZone.addEventListener('pointerup', camEnd);
    camZone.addEventListener('pointercancel', camEnd);
  }

  // pilih dino yang dimainkan
  function renderChars() {
    const html = Object.keys(PLAYABLES).map((id) => {
      const c = PLAYABLES[id], col = '#' + c.pal.body.toString(16).padStart(6, '0');
      return '<button type="button" class="chr' + (save.char === id ? ' sel' : '') + '" data-id="' + id + '"><i style="background:' + col + '"></i>' + c.name + '</button>';
    }).join('');
    const info = (PLAYABLES[save.char] || curChar).info;
    if (charRow) charRow.innerHTML = html;
    if (charRow2) charRow2.innerHTML = html;
    if (charInfo) charInfo.textContent = info;
    if (charInfo2) charInfo2.textContent = info;
  }
  function applyChar(id) {                                     // ganti model dino sekarang juga (di luar permainan)
    const c = PLAYABLES[id];
    if (!c || c === curChar) return;
    curChar = c;
    scene.remove(hero.root);
    disposeTree(hero.root);
    hero = buildHero();
    scene.add(hero.root);
    gear = null; gearKey = ''; syncGear(true);
    scaleNow = baseScale();
  }
  function selectChar(id) {
    const c = PLAYABLES[id];
    if (!c) return;
    save.char = id;
    writeSave();
    if (state !== 'playing') applyChar(id);                    // saat bermain: berlaku di permainan berikutnya
    else toast(t('char_next', { n: c.name }), 2.2);
    renderChars();
    GameAudio.sfx.coin();
  }
  const charClick = (e) => {
    e.stopPropagation();
    GameAudio.init();
    let el = e.target;
    while (el && !(el.dataset && el.dataset.id)) el = el.parentNode;
    if (el) selectChar(el.dataset.id);
  };
  if (charRow) charRow.addEventListener('click', charClick);
  if (charRow2) charRow2.addEventListener('click', charClick);
  renderChars();

  // ===== layar pilih dino: statistik, ikon skill, keterangan, cara melawan =====
  // Angka skill di bawah HARUS sama dengan KITS di server/arena-room.js (dites otomatis di dex_test.mjs)
  const DEX = {
    vosil: { st: [3, 3, 3, 1], bite: { dmg: 6, cd: 550 }, sk: { id: 'roar', cd: 14000, windup: 150, dmg: 7, shape: 'circle', r: 8.2 } },
    velo: { st: [2, 3, 1, 4], bite: { dmg: 3.5, cd: 330 }, sk: { id: 'pounce', cd: 8000, windup: 130, dmg: 12, shape: 'line', len: 7, width: 2.4 } },
    carno: { st: [3, 5, 1, 3], bite: { dmg: 11, cd: 950 }, sk: { id: 'charge', cd: 10000, windup: 250, dmg: 18, shape: 'line', len: 7, width: 3.2 } },
    spino: { st: [5, 3, 3, 2], bite: { dmg: 6.5, cd: 650 }, sk: { id: 'sweep', cd: 7000, windup: 180, dmg: 9, shape: 'circle', r: 5.2 } },
    parasaur: { st: [2, 1, 5, 4], bite: { dmg: 4.5, cd: 550 }, sk: { id: 'sonic', cd: 9000, windup: 160, dmg: 5, shape: 'cone', r: 10 } }
  };

  // ikon skill bergaya dinosaurus (SVG buatan sendiri, ringan, satu warna mengikuti tema)
  const ICO = {
    bite: '<path d="M6 30Q8 10 32 10Q56 10 58 30L58 34L6 34Z"/><path d="M10 34L15 46L20 34ZM22 34L27 50L32 34ZM32 34L37 50L42 34ZM44 34L49 46L54 34Z"/><path class="d" d="M20 20Q32 14 44 20" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="3"/><path d="M8 54Q32 62 56 54L52 48Q32 56 12 48Z"/>',
    roar: '<path d="M4 30Q4 10 24 8Q40 8 54 20L28 28L4 30Z"/><path d="M8 38L30 34L54 48Q36 58 18 54Q6 50 8 38Z"/><path d="M33 27L36 35L40 26ZM42 24L45 31L48 22Z"/><path d="M37 40L40 33L43 39ZM46 44L49 37L52 43Z"/><circle class="d" cx="20" cy="19" r="3"/><path d="M58 10Q66 32 58 54" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>',
    pounce: '<path d="M18 6Q60 8 54 58Q50 30 18 6Z"/><path d="M18 22Q44 26 48 52Q36 36 18 22Z" opacity=".55"/><path d="M4 30L20 30M4 40L16 40M8 50L18 50" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" fill="none"/>',
    charge: '<path d="M6 4Q4 30 22 38L26 31Q14 24 12 4Z"/><path d="M58 4Q60 30 42 38L38 31Q50 24 52 4Z"/><path d="M18 34Q32 28 46 34L43 52Q32 62 21 52Z"/><path class="d" d="M24 42L30 45L28 48ZM40 42L34 45L36 48Z"/><path d="M12 54L20 60M52 54L44 60M32 60L32 64" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/>',
    sweep: '<path d="M6 50Q8 12 56 12Q28 24 24 52Q14 56 6 50Z"/><path d="M24 20L22 8L32 16ZM36 16L38 4L46 14ZM15 30L6 24L15 22Z" /><path d="M50 36Q56 42 52 52" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>',
    sonic: '<path d="M6 52Q4 24 26 10Q40 2 52 8Q36 12 30 26Q28 36 32 42L40 44L38 52Z"/><circle class="d" cx="30" cy="40" r="2.6"/><path d="M46 28Q54 36 46 46" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><path d="M52 22Q64 36 52 52" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
    pass: '<ellipse cx="14" cy="24" rx="5.5" ry="9" transform="rotate(-25 14 24)"/><ellipse cx="32" cy="14" rx="5.5" ry="10"/><ellipse cx="50" cy="24" rx="5.5" ry="9" transform="rotate(25 50 24)"/><path d="M18 40Q32 32 46 40Q50 58 32 61Q14 58 18 40Z"/>'
  };
  const icon = (k) => '<svg class="ico" viewBox="0 0 64 64" aria-hidden="true">' + ICO[k] + '</svg>';

  // pratinjau 3D di tengah: kanvas + renderer sendiri di dalam kolom tengah (selalu di atas panel lain)
  const pv = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(32, 1, 0.1, 200), c: null, yaw: 0.6, drag: false, lastX: 0, idle: 0, dist: 8, cy: 1.2, r: null, cv: null, w: 0, h: 0, fail: false };
  pv.scene.background = new THREE.Color(0x1b2a34);
  pv.scene.add(new THREE.HemisphereLight(0xffffff, 0x6a7a66, 0.95));
  { const d = new THREE.DirectionalLight(0xfff0d2, 0.9); d.position.set(-6, 10, 8); pv.scene.add(d); }
  { const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0x0e161c, transparent: true, opacity: 0.55 })); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.01; disc.name = 'disc'; pv.scene.add(disc); }
  // latar arena di balik dino: langit, tanah, pohon & batu (dibuat sekali, tetap sederhana)
  pv.scene.background = new THREE.Color(0x9fd0e6); pv.scene.fog = new THREE.Fog(0x9fd0e6, 14, 46);
  { const gm = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshLambertMaterial({ color: 0x6fae4f })); gm.rotation.x = -Math.PI / 2; gm.position.y = -0.02; pv.scene.add(gm);
    let sd = 7; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    const kinds = ['broad', 'pine', 'broad', 'palm', 'pine'];
    for (let i = 0; i < 26; i++) {
      const a = Math.PI * (0.12 + 0.76 * (i / 25)) + (rnd() - 0.5) * 0.12, d = 9 + rnd() * 16;       // setengah lingkaran di belakang dino
      const tr = makeTree(1.1 + rnd() * 0.9, kinds[i % kinds.length], i); tr.position.set(-Math.cos(a) * d * 1.25, 0, -Math.sin(a) * d); pv.scene.add(tr);
    }
    for (let i = 0; i < 7; i++) { const rk = makeRock(0.8 + rnd() * 1.2, false); const a = rnd() * Math.PI * 2, d = 6 + rnd() * 6; rk.position.set(Math.cos(a) * d, 0, -Math.abs(Math.sin(a)) * d - 3); pv.scene.add(rk); }
  }
  const dexStage = $('dexStage');
  function pvEnsure() {
    if (pv.r) return true; if (pv.fail) return false;
    try {
      pv.cv = document.createElement('canvas'); dexStage.appendChild(pv.cv);
      pv.r = new THREE.WebGLRenderer({ canvas: pv.cv, antialias: true });
      pv.r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      return true;
    } catch (e) { pv.fail = true; pv.r = null; try { $('dexHint').textContent = t('dx_no3d'); } catch (x) { /* abaikan */ } return false; }
  }
  function pvBuild(id) {
    if (pv.c) { pv.scene.remove(pv.c.root); disposeTree(pv.c.root); pv.c = null; }
    const c = PLAYABLES[id]; if (!c) return;
    pv.c = makeCreature(Object.assign({ scale: c.scale, variant: c.variant }, c.pal));
    pv.scene.add(pv.c.root);
    const bx = new THREE.Box3().setFromObject(pv.c.root), sz = new THREE.Vector3(), ct = new THREE.Vector3(); bx.getSize(sz); bx.getCenter(ct);
    const r = Math.max(sz.x, sz.y * 1.1, sz.z) * 0.62 + 0.6;
    pv.dist = r / Math.tan(pv.cam.fov * Math.PI / 360); pv.cy = ct.y;
    const disc = pv.scene.getObjectByName('disc'); if (disc) disc.scale.setScalar(Math.max(sz.x, sz.z) * 0.75);
  }
  dexStage.addEventListener('pointerdown', (e) => { pv.drag = true; pv.lastX = e.clientX; pv.idle = 0; try { dexStage.setPointerCapture(e.pointerId); } catch (x) { /* abaikan */ } });
  dexStage.addEventListener('pointermove', (e) => { if (!pv.drag) return; pv.yaw += (e.clientX - pv.lastX) * 0.012; pv.lastX = e.clientX; });
  const pvEnd = () => { pv.drag = false; pv.idle = 0; };
  dexStage.addEventListener('pointerup', pvEnd); dexStage.addEventListener('pointercancel', pvEnd);
  function renderDexStage(dt) {                                         // dipanggil tiap frame saat layar pilih dino terbuka
    if (!pv.c || !pvEnsure()) return;
    pv.idle += dt; if (!pv.drag && pv.idle > 1.2) pv.yaw += dt * 0.5;       // berputar pelan jika tidak disentuh
    pv.c.root.rotation.y = Math.PI + pv.yaw;
    poseCreature(pv.c, clock * 1.5, 0, false, 0, -1, clock);
    const r = dexStage.getBoundingClientRect(), w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
    if (w !== pv.w || h !== pv.h) { pv.w = w; pv.h = h; pv.r.setSize(w, h, false); pv.cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block'; }
    pv.cam.aspect = w / h; pv.cam.setViewOffset(w, h, Math.round(w * 0.08), Math.round(h * 0.12), w, h); pv.cam.updateProjectionMatrix();       // dino sedikit ke kiri: tepat di antara dua panel
    pv.cam.position.set(0, pv.cy + pv.dist * 0.18, pv.dist); pv.cam.lookAt(0, pv.cy * 0.9, 0);
    try { pv.r.render(pv.scene, pv.cam); } catch (e) { pv.fail = true; try { $('dexHint').textContent = t('dx_no3d'); } catch (x) { /* abaikan */ } }
  }
  const dexEl = $('dex');
  let dexId = 'vosil', dexTab = 'sk';
  function dexArea(sk) { return t('dx_' + sk.shape, { r: sk.r, l: sk.len, w: sk.width }); }
  function renderDex() {
    const c = PLAYABLES[dexId], d = DEX[dexId], col = (id) => '#' + PLAYABLES[id].pal.body.toString(16).padStart(6, '0');
    $('dexList').innerHTML = Object.keys(PLAYABLES).map((id) => '<button type="button" class="dxi' + (id === dexId ? ' sel' : '') + '" data-d="' + id + '"><i style="background:' + col(id) + '"></i><span>' + esc(PLAYABLES[id].name) + '<small>' + esc(t('dx_role_' + id)) + '</small></span></button>').join('');
    $('dexName').innerHTML = '<b>' + esc(c.name) + '</b><em>' + esc(t('dx_role_' + dexId)) + '</em>' + t('dx_tags_' + dexId).split(' · ').map((x) => '<span>' + esc(x) + '</span>').join('');
    const labels = ['dx_dur', 'dx_off', 'dx_ctl', 'dx_dif'];
    const stats = '<div class="dxs">' + labels.map((k, i) => '<label>' + t(k) + '</label><div class="bar"><b style="width:' + (d.st[i] * 20) + '%"></b></div>').join('') + '</div>';
    const tabs = [['bite', icon('bite'), 'dx_s_bite'], ['sk', icon(d.sk.id), 'sk_' + d.sk.id], ['pass', icon('pass'), 'dx_s_pass']];
    const keys = '<div class="dxk">' + tabs.map((x) => '<button type="button" class="' + (dexTab === x[0] ? 'sel' : '') + '" data-k="' + x[0] + '"><span>' + x[1] + '</span>' + esc(t(x[2])) + '</button>').join('') + '</div>';
    let body;
    if (dexTab === 'bite') body = '<h4>' + t('dx_s_bite') + '</h4><div class="nums"><b>' + t('dx_dmg') + ' ' + d.bite.dmg + '</b><b>' + t('dx_cd') + ' ' + t('dx_ms', { n: (d.bite.cd / 1000).toFixed(2) }) + '</b><b>' + t('dx_area') + ' ' + t('dx_single') + '</b></div><p>' + esc(t('dx_bite_' + dexId)) + '</p>';
    else if (dexTab === 'pass') body = '<h4>' + t('dx_s_pass') + '</h4><p>' + esc(t('dx_pass_' + dexId)) + '</p>';
    else body = '<h4>' + esc(t('sk_' + d.sk.id)) + '</h4><div class="nums"><b>' + t('dx_cd') + ' ' + t('dx_ms', { n: d.sk.cd / 1000 }) + '</b><b>' + t('dx_cast') + ' ' + t('dx_ms', { n: (d.sk.windup / 1000).toFixed(2) }) + '</b><b>' + t('dx_dmg') + ' ' + d.sk.dmg + '</b><b>' + t('dx_area') + ' ' + esc(dexArea(d.sk)) + '</b></div><p>' + esc(t('dx_sk_' + dexId)) + '</p>';
    body += '<p class="pro">' + t('dx_pro') + ': ' + esc(t('dx_pro_' + dexId)) + '</p><p class="con">' + t('dx_con') + ': ' + esc(t('dx_con_' + dexId)) + '</p><p class="cnt">' + t('dx_cnt') + ': ' + esc(t('dx_cnt_' + dexId)) + '</p>';
    $('dexInfo').innerHTML = stats + keys + '<div class="dxd">' + body + '</div>';
    const pk = $('dexPick'), on = save.char === dexId;
    pk.textContent = dexHome ? t('dx_start') : t(on ? 'dx_picked' : 'dx_pick'); pk.classList.toggle('on', on && !dexHome);
  }
  function dexPreview(id) { dexId = id; pv.idle = 0; pvBuild(id); renderDex(); }
  function openDex() { dexId = save.char in PLAYABLES ? save.char : 'vosil'; dexTab = 'sk'; pv.yaw = 0.6; pv.idle = 0; dexEl.classList.add('on'); pvBuild(dexId); renderDex(); }
  function syncDex() {                                                  // layar Pilih Dino = halaman utama saat state 'menu'
    if (state === 'menu') { if (!dexEl.classList.contains('on') || !dexHome) { dexHome = true; dexEl.classList.add('home'); openDex(); } }
    else if (dexHome) { dexHome = false; dexEl.classList.remove('home'); closeDex(); }
    try { GameAudio.loop('loopskil', state === 'menu' && !welcomeOn); } catch (e) { /* abaikan */ }          // musik latar halaman Pilih Dino
  }
  let starting = false, welcomed = false, welcomeOn = false;
  function welcomeThenStart(solo) {                                     // sambutan: logo memudar, dunia dimuat di baliknya
    if (starting || state !== 'menu') return; starting = true; const stT = setTimeout(() => { starting = false; }, 3500);
    const w = $('welcome');
    try { GameAudio.init(); } catch (e) { /* abaikan */ }
    const launch = () => {
      const ab = $('arenaBtn');
      lastMode = solo ? 'solo' : 'arena';
      if (!solo && ab && !ab.classList.contains('hidden')) startArena().then(() => { if (state !== 'playing') { toast(t('ar_full_solo'), 4); startGame(); } });
      else startGame();
    };
    let snd = null;
    if (!welcomed) { try { GameAudio.loop('loopskil', false); snd = GameAudio.once('welcome', 0.85); } catch (e) { snd = null; } }
    welcomed = true;
    if (snd && w) {                                                  // sambutan panjang bersama audio welcome.ogg; ketuk untuk melewati
      const D = Math.max(2, Math.min(12, snd.dur));
      welcomeOn = true; starting = true; clearTimeout(stT); w.style.setProperty('--wd', D + 's');
      w.classList.remove('on', 'long'); void w.offsetWidth; w.classList.add('on', 'long');
      let fin = false;
      const end = (skip) => {
        if (fin) return; fin = true; clearTimeout(tm); w.onclick = null;
        if (skip) snd.stop();
        w.classList.remove('on', 'long'); welcomeOn = false; starting = false; launch();
      };
      const tm = setTimeout(() => end(false), D * 1000 - 200);
      w.onclick = () => end(true);
      return;
    }
    if (w) { w.classList.remove('on'); void w.offsetWidth; w.classList.add('on'); setTimeout(() => w.classList.remove('on'), 3300); }
    launch();
  }
  function closeDex() { dexEl.classList.remove('on'); if (pv.c) { pv.scene.remove(pv.c.root); disposeTree(pv.c.root); pv.c = null; } }
  ['dexOpen', 'dexOpen2'].forEach((id) => { const b = $(id); if (b) { b.addEventListener('pointerdown', (e) => e.stopPropagation()); b.addEventListener('click', (e) => { e.stopPropagation(); GameAudio.init(); openDex(); }); } });
  dexEl.addEventListener('pointerdown', (e) => e.stopPropagation());
  dexEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const el = e.target.closest ? e.target.closest('button') : null; if (!el) return;
    autoFs();
    if (el.id === 'dexX') closeDex();
    else if (el.id === 'dexPick') { selectChar(dexId); if (dexHome) { welcomeThenStart(false); } else { renderDex(); closeDex(); } }
    else if (el.id === 'dexSolo') { selectChar(dexId); welcomeThenStart(true); }
    else if (el.id === 'dexBag') { tabWanted = 'bag'; openBag(); }
    else if (el.dataset.d) dexPreview(el.dataset.d);
    else if (el.dataset.k) { dexTab = el.dataset.k; renderDex(); }
  });

  function bindBtn(el, down, up) {
    if (!el) return;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      GameAudio.init();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* abaikan */ }
      el.classList.add('on');
      if (down) down();
    });
    const end = () => { el.classList.remove('on'); if (up) up(); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  bindBtn(btnAttack, () => { input.attack = true; atkHeld = true; }, () => { atkHeld = false; });
  bindBtn(btnJump, () => { input.jump = true; });
  if (btnRoar) {                                                  // skill: ketuk = langsung (bidik otomatis); tahan + geser = bidik manual, lepas = luncurkan
    btnRoar.addEventListener('contextmenu', (e) => e.preventDefault());
    btnRoar.addEventListener('pointerdown', (e) => { e.preventDefault(); GameAudio.init(); try { btnRoar.setPointerCapture(e.pointerId); } catch (err) { /* abaikan */ } btnRoar.classList.add('on'); if (!aimBegin(e)) doRoar(); });
    btnRoar.addEventListener('pointermove', aimMove);
    btnRoar.addEventListener('pointerup', () => { btnRoar.classList.remove('on'); aimEnd(true); });
    btnRoar.addEventListener('pointercancel', () => { btnRoar.classList.remove('on'); aimEnd(false); });
  }
  let sprintLatch = false, sprintIdle = 0;                              // lari sekali ketuk: aktif sampai tenaga habis (ketuk lagi untuk berhenti)
  const setLatch = (on) => { sprintLatch = on; sprintIdle = 0; if (btnSprint) btnSprint.classList.toggle('latch', on); };
  if (btnSprint) {
    btnSprint.addEventListener('contextmenu', (e) => e.preventDefault());
    btnSprint.addEventListener('pointerdown', (e) => { e.preventDefault(); GameAudio.init(); if (state !== 'playing') return; if (sprintLatch) setLatch(false); else if (!player.exhausted && player.stamina > 0) setLatch(true); else toast(t('tired'), 1.2); });
  }

  canvas.addEventListener('pointerup', autoFs);             // gesture sentuh yang sah untuk layar penuh
  canvas.addEventListener('click', autoFs);
  // ketuk di mana saja untuk mulai / main lagi
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    GameAudio.init();
    if (state === 'over' && performance.now() - overAt > 700) playAgain();
  });

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (bagOpen) { if (k === 'escape') closeBag(); return; }
    const map = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', shift: 'shift', q: 'camL', e: 'camR' };
    if (map[k]) keys[map[k]] = true;
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'enter'].includes(k)) e.preventDefault();
    GameAudio.init();
    if (state !== 'playing') {
      if ((k === ' ' || k === 'enter') && state === 'over' && performance.now() - overAt > 700) playAgain();
      return;
    }
    if (k === ' ') input.jump = true;
    else if (k === 'j' || k === 'k') { input.attack = true; atkHeld = true; }
    else if (k === 'r' || k === 'l') doRoar();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    const map = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', shift: 'shift', q: 'camL', e: 'camR' };
    if (map[k]) keys[map[k]] = false;
    if (k === 'j' || k === 'k') atkHeld = false;
  });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; stickEnd(null); input.sprint = false; atkHeld = false; });

  // layar penuh + kunci horizontal otomatis (Android Chrome); iPhone tidak mengizinkan, jadi pakai petunjuk
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const isIOS = /iPad|iPhone|iPod/.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  function lockLandscape() {
    try {
      const o = screen.orientation;
      if (o && o.lock) { const r = o.lock('landscape'); if (r && r.catch) r.catch(() => {}); }
    } catch (e) { /* abaikan */ }
  }
  function enterImmersive() {
    try {
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (req && !isFs()) {
        const r = req.call(el);
        if (r && r.then) r.then(lockLandscape).catch(() => lockLandscape()); else lockLandscape();
        return true;
      }
      lockLandscape();
      return !!req;
    } catch (e) { return false; }
  }
  function exitImmersive() {
    try {
      const ex = document.exitFullscreen || document.webkitExitFullscreen;
      if (ex) ex.call(document);
      if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
    } catch (e) { /* abaikan */ }
  }
  function toggleFs() {
    if (isFs()) { exitImmersive(); return; }
    const ok = enterImmersive();
    if (!ok) toast(isIOS ? t('fs_ios') : t('fs_none'), 3.5);
  }
  if (fsBtn) {
    fsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFs(); });
    fsBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  const qBtn = $('qBtn');
  if (qBtn) {
    const lbl = () => { qBtn.textContent = t('quality_lbl', { q: qName(save.q) }); };
    L.onChange(lbl);
    qBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const order = ['low', 'mid', 'high'];
      save.q = order[(order.indexOf(save.q) + 1) % 3];
      writeSave(); applyQuality(); lbl();
      try { for (const ch of Array.from(chunks.values())) unloadChunk(ch); buildQueue.length = 0; if (state === 'playing') ensureChunks(true); else pcx = null; } catch (e) { /* abaikan */ }
      toast(t('q_toast', { q: qName(save.q) }), 1.6);
    });
    qBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    lbl();
  }
  const nbBtn = $('nbBtn');
  if (nbBtn) {
    const nbName = () => t(['nb_0', 'nb_1', 'nb_2'][save.nb === undefined ? 1 : save.nb]);
    const nlbl = () => { nbBtn.textContent = t('nb_lbl', { q: nbName() }); };
    L.onChange(nlbl);
    nbBtn.addEventListener('click', (e) => { e.stopPropagation(); save.nb = ((save.nb === undefined ? 1 : save.nb) + 1) % 3; writeSave(); nlbl(); applyDayNight(); toast(t('nb_lbl', { q: nbName() }), 1.6); });
    nbBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    nlbl();
  }
  if (!QUAL[save.q]) save.q = 'mid';
  applyQuality();

  // ---------- Tas: aset terkumpul + penukaran poin (token Vosil menyusul di tahap wallet) ----------
  // Alur: Koin & Trofi dino --(tukar)--> Poin Tukar --(klaim, tahap wallet/server)--> Token Vosil
  const EXCH = { coinPerPt: 20, tro: { raptor: 1, velo: 1, carno: 3, rex: 5, spino: 6 }, ptPerVosil: 1000, note: '', updated: '' };   // nilai bawaan
  // Kebijakan penukaran bisa diubah kapan saja TANPA ubah kode: edit config.json di repo lalu Commit + Sync (dibaca ulang setiap game dibuka).
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const posNum = (v) => typeof v === 'number' && isFinite(v) && v > 0;
  function applyConfig(c) {
    if (!c || typeof c !== 'object') return;
    if (posNum(c.coinPerPt)) EXCH.coinPerPt = c.coinPerPt;
    if (posNum(c.ptPerVosil)) EXCH.ptPerVosil = c.ptPerVosil;
    if (c.trofi && typeof c.trofi === 'object') Object.keys(c.trofi).forEach((k) => { if (typeof c.trofi[k] === 'number' && c.trofi[k] >= 0 && isFinite(c.trofi[k])) EXCH.tro[k] = c.trofi[k]; });
    if (typeof c.catatan === 'string') EXCH.note = c.catatan.slice(0, 200);
    ['en', 'es'].forEach((l) => { if (typeof c['catatan_' + l] === 'string') EXCH['note_' + l] = c['catatan_' + l].slice(0, 200); });
    if (typeof c.diperbarui === 'string') EXCH.updated = c.diperbarui.slice(0, 40);
    if (bagOpen) renderBag();
  }
  if (typeof fetch === 'function') {
    try { fetch('config.json?t=' + Date.now(), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then(applyConfig).catch(() => { /* pakai nilai bawaan */ }); } catch (e) { /* abaikan */ }
  }
  const bagEl = $('bag'), bagBody = $('bagBody'), bagSum = $('bagSum');
  function bagTroValue() { let v = 0; for (const k in save.tro) v += (save.tro[k] || 0) * (EXCH.tro[k] || 0); return v; }
  const exNote = () => (L.lang === 'id' ? EXCH.note : (EXCH['note_' + L.lang] || EXCH.note_en || ''));   // catatan kebijakan: pakai versi bahasa pemain
  // ---------- Akun & Tukar VOS (server Cloudflare; lihat wallet.js dan server/app.js) ----------
  const W = Wallet.st;
  let cfgTry = false;
  const shortAddr = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');
  const wErr = (e) => { const k = 'err_' + ((e && e.code) || 'unknown'); const m = t(k); const base = m === k ? t('err_unknown') : m; return e && e.why ? base + ' [' + e.why + ']' : base; };
  function acctHtml() {
    const cfg = W.cfg, me = W.me;
    let h = '<h4>' + t('h_acct') + '</h4>';
    const msg = W.msg ? '<p class="aMsg" style="color:' + (W.msgOk ? '#a5d6a7' : '#ef9a9a') + '">' + esc(W.msg) + '</p>' : '';
    if (!cfg) {
      if (W.apiOk === false) return h + '<div class="bRow"><span class="nm">' + t('a_server_off') + '</span><button class="bBtn" data-ex="w-retry">' + t('a_retry') + '</button></div>' + msg;
      return h + '<div class="bRow"><span class="nm">' + t('a_loading') + '</span></div>';
    }
    const busy = W.busy ? ' disabled' : '';
    if (!Wallet.loggedIn) {
      if (Wallet.worldReady()) {
        h += '<button class="bBtn wide" data-ex="w-world"' + busy + '>' + t('a_world') + '</button><p class="aNote">' + t('a_world_note') + '</p>';
      } else if (Wallet.hasProvider()) {
        h += '<button class="bBtn wide" data-ex="w-connect"' + busy + '>' + t('a_conn') + '</button><p class="aNote">' + t('a_conn_note') + '</p>';
      } else if (!W.link) {
        h += '<button class="bBtn wide" data-ex="w-link"' + busy + '>' + t('a_link_btn') + '</button><p class="aNote">' + t('a_link_note') + '</p>';
      } else {
        h += '<div class="bRow"><span class="nm">' + t('a_link_code', { c: '<b>' + esc(W.link.code) + '</b>' }) + '<small>' + t('a_link_wait') + '</small></span></div>' +
          '<p class="aNote">' + t('lk_warn') + '</p>' + '<button class="bBtn wide" data-ex="w-link-mm">' + t('a_link_mm') + '</button><button class="bBtn wide" data-ex="w-link-trust" style="background:#42a5f5">' + t('a_link_trust') + '</button>' +
          '<button class="bBtn wide" data-ex="w-link-check" style="background:#66bb6a"' + busy + '>' + t('a_link_check') + '</button><button class="bBtn wide" data-ex="w-link-cancel" style="background:#8d6e63;color:#fff">' + t('a_link_cancel') + '</button>';
      }
    } else if (!me) {
      h += '<div class="bRow"><span class="nm">' + t('a_wallet', { a: shortAddr(Wallet.address) }) + '</span><button class="bBtn" data-ex="w-disc">' + t('a_disc') + '</button></div><div class="bRow"><span class="nm">' + t('a_loading') + '</span></div>';
    } else {
      const lim = me.limits, canSend = Math.min(save.pts, me.today.available);
      const open = me.redemptions.some((r) => r.status === 'queued' || r.status === 'error' || r.status === 'sending');
      const amt = Math.min(Math.floor(me.points / lim.ptPerVos) * lim.ptPerVos, lim.redeemMaxDay);
      const canRedeem = !open && !me.redeemedToday && amt >= lim.redeemMin;
      h += '<div class="bRow"><span class="nm">' + t('a_wallet', { a: shortAddr(me.address) }) + '<small>' + t('a_points', { n: me.points, m: lim.redeemMin }) + '</small></span><button class="bBtn" data-ex="w-disc">' + t('a_disc') + '</button></div>' +
        '<p class="aNote">' + t('a_today', { a: me.today.available, c: me.today.cap }) + '</p>' +
        '<button class="bBtn wide" data-ex="w-send"' + (canSend > 0 && !W.busy ? '' : ' disabled') + '>' + (canSend > 0 ? t('a_send', { n: canSend }) : t('a_send_none')) + '</button>' +
        '<button class="bBtn wide" data-ex="w-redeem" style="background:#66bb6a"' + (canRedeem && !W.busy ? '' : ' disabled') + '>' + (canRedeem ? t('a_redeem', { n: amt, v: amt / lim.ptPerVos }) : t('a_redeem_none')) + '</button>';
      if (me.redemptions.length) {
        h += '<h4>' + t('a_hist') + '</h4>';
        me.redemptions.slice(0, 4).forEach((r) => {
          const stx = t('st_' + r.status, { p: r.position || '' });
          h += '<div class="bRow"><span class="nm">' + r.vos + ' VOS<small>' + esc(stx) + (r.tx_hash ? ' · <a href="https://worldscan.org/tx/' + encodeURIComponent(r.tx_hash) + '" target="_blank" rel="noopener" style="color:#ffd54f">' + t('a_tx') + '</a>' : '') + '</small></span>' +
            (r.status === 'queued' ? '<button class="bBtn" data-ex="w-cancel:' + r.id + '"' + busy + '>' + t('a_cancel') + '</button>' : '') + '</div>';
        });
      }
    }
    h += msg;
    if (cfg) h += '<p class="aNote">' + t('a_queue', { n: cfg.queueCount, l: cfg.quotaLeft, q: cfg.quotaDay }) + '</p><p class="aNote">' + t('a_rule', { m: cfg.redeemMin, mv: cfg.redeemMin / cfg.ptPerVos, x: cfg.redeemMaxDay, h1: cfg.reviewHours[0], h2: cfg.reviewHours[1] }) + '</p><p class="aNote">' + t('a_free') + '</p>';
    return h;
  }
  async function walletAct(ex) {
    if (W.busy) return;
    const done = (ok, m) => { W.msgOk = ok; W.msg = m || ''; W.busy = false; if (bagOpen) renderBag(); refreshPanels(); };
    W.busy = true; W.msg = ''; renderBag();
    try {
      if (ex === 'w-retry') { cfgTry = false; await Wallet.loadConfig(true); if (Wallet.loggedIn) await Wallet.refresh().catch(() => {}); return done(true, ''); }
      if (ex === 'w-link') { await Wallet.linkStart(); return done(true, ''); }
      if (ex === 'w-link-mm' || ex === 'w-link-trust') { window.open(Wallet.linkUrl(ex === 'w-link-trust' ? 'trust' : 'mm'), '_blank'); return done(true, ''); }
      if (ex === 'w-link-check') { const r = await Wallet.linkPoll(); return done(true, r === 'done' ? t('ok_conn') : ''); }
      if (ex === 'w-link-cancel') { Wallet.linkCancel(); return done(true, ''); }
      if (ex === 'w-world') { await Wallet.connectWorld(); return done(true, t('ok_conn')); }
      if (ex === 'w-connect') { await Wallet.connect(); return done(true, t('ok_conn')); }
      if (ex === 'w-disc') { Wallet.disconnect(); return done(true, ''); }
      if (ex === 'w-send') {
        const n = Math.min(save.pts, W.me ? W.me.today.available : 0);
        const c = await Wallet.credit(n); save.pts = Math.max(0, save.pts - c); writeSave();
        return done(true, t('ok_sent', { n: c }));
      }
      if (ex === 'w-redeem') { const r = await Wallet.redeem(); return done(true, t('ok_redeem', { v: r.vos })); }
      if (ex.startsWith('w-cancel:')) { await Wallet.cancel(Number(ex.slice(9))); return done(true, t('ok_cancel')); }
      done(true, '');
    } catch (e) { done(false, wErr(e)); }
  }
  function acctPrefetch() {
    if (!W.cfg && !cfgTry) { cfgTry = true; Wallet.loadConfig().then((c) => { if (c && c.ptPerVos) EXCH.ptPerVosil = c.ptPerVos; if (bagOpen) renderBag(); }); }
    if (Wallet.loggedIn && !W.me) Wallet.refresh().then(() => { if (bagOpen) renderBag(); }).catch(() => { if (bagOpen) renderBag(); });
    else if (Wallet.loggedIn) Wallet.refresh().then(() => { if (bagOpen) renderBag(); }).catch(() => {});
  }
  // tautan dompet: periksa otomatis tiap 3 dtk (dan segera saat kembali ke peramban ini) sampai tanda tangan masuk
  let linkBusy = false;
  async function linkTick() {
    if (!W.link || linkBusy || Wallet.loggedIn || document.hidden) return;
    linkBusy = true;
    try { const r = await Wallet.linkPoll(); if (r === 'done') { W.msgOk = true; W.msg = t('ok_conn'); refreshPanels(); } }
    catch (e) { W.msgOk = false; W.msg = wErr(e); }
    linkBusy = false; if (bagOpen) renderBag();
  }
  setInterval(linkTick, 3000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) linkTick(); });
  setInterval(() => { if (state === 'playing' && !bagOpen && !document.hidden && Wallet.loggedIn) Wallet.beat(); }, 60e3);   // waktu main yang tercatat server (batas poin harian)
  function renderBag() {
    const coinPts = Math.floor(save.coins / EXCH.coinPerPt);
    let rows = '';
    Object.keys(PTYPES).forEach((k) => {
      const d = PTYPES[k], hunt = !d.timid && !d.neutral, n = save.tro[k] || 0, life = save.kv[k] || 0;
      if (!hunt && !life) return;
      const val = EXCH.tro[k] || 0;
      rows += '<div class="bRow"><span class="nm">🦖 ' + d.name + '<small>' + (hunt ? t('b_trophy', { n, v: val }) : t('b_prey')) + t('b_killed', { n: life }) + '</small></span>' +
        (hunt ? '<button class="bBtn" data-ex="' + k + '"' + (n ? '' : ' disabled') + '>' + t('b_trade_n', { n: n * val }) + '</button>' : '<span class="vl">—</span>') + '</div>';
    });
    if (!rows) rows = '<div class="bRow"><span class="nm">' + t('b_none') + '</span></div>';
    const tv = bagTroValue(), est = (save.pts / EXCH.ptPerVosil).toFixed(3);
    bagSum.textContent = t('b_sum', { c: save.coins, p: save.pts });
    bagBody.innerHTML =
      '<h4>' + t('h_coin') + '</h4><div class="bRow"><span class="nm">' + t('b_coin_row', { n: save.coins }) + '<small>' + t('b_coin_rate', { r: EXCH.coinPerPt }) + '</small></span>' +
      '<button class="bBtn" data-ex="coin"' + (coinPts ? '' : ' disabled') + '>' + t('b_trade_pts', { n: coinPts }) + '</button></div>' +
      '<h4>' + t('h_trophy') + '</h4>' + rows +
      '<button class="bBtn wide" data-ex="all"' + (tv || coinPts ? '' : ' disabled') + '>' + t('b_trade_all', { n: tv + coinPts }) + '</button>' +
      '<h4>' + t('h_token') + '</h4><div class="bRow"><span class="nm">' + t('b_pts_row', { n: save.pts }) + '<small>' + t('b_pts_rate', { r: EXCH.ptPerVosil, e: est }) + '</small></span>' +
      '</div>' + acctHtml() +
      (exNote() ? '<p id="bagNote" style="color:#ffcc80">📢 ' + esc(exNote()) + (EXCH.updated ? ' (' + esc(EXCH.updated) + ')' : '') + '</p>' : '') + (state === 'playing' ? '<button class="bBtn wide" data-ex="resume" style="background:#66bb6a">' + t('b_resume') + '</button>' : '') + '<p id="bagNote">' + t('b_note') + '</p>';
  }
  function doExchange(what) {
    let add = 0;
    if (what === 'coin' || what === 'all') { const c = Math.floor(save.coins / EXCH.coinPerPt); save.coins -= c * EXCH.coinPerPt; add += c; }
    if (what === 'all') { add += bagTroValue(); save.tro = {}; }
    else if (what !== 'coin' && save.tro[what]) { add += save.tro[what] * (EXCH.tro[what] || 0); save.tro[what] = 0; }
    if (add <= 0) return;
    save.pts += add; save.ptsTotal += add;
    runCoins = Math.min(runCoins, Math.max(0, save.coins));     // koin yang sudah ditukar jadi poin = aman, tidak ikut tumpah
    writeSave();
    try { window.dispatchEvent(new CustomEvent('bag:exchange', { detail: { points: add, balance: save.pts } })); } catch (e) { /* abaikan */ }
    renderBag(); refreshPanels();
    GameAudio.sfx.coin();
  }
  let tabWanted = 'bag';
  function showTab(t) {
    $('bagBody').classList.toggle('hidden', t !== 'bag'); $('setBody').classList.toggle('hidden', t !== 'set'); $('chrBody').classList.toggle('hidden', t !== 'chr');
    $('tabBag').classList.toggle('on', t === 'bag'); $('tabSet').classList.toggle('on', t === 'set'); $('tabChr').classList.toggle('on', t === 'chr');
  }
  $('tabBag').addEventListener('click', () => { tabWanted = 'bag'; showTab('bag'); });
  $('tabSet').addEventListener('click', () => { tabWanted = 'set'; showTab('set'); });
  $('tabChr').addEventListener('click', () => { tabWanted = 'chr'; showTab('chr'); });
  // Layar sentuh: jari kedua (mis. saat analog sedang ditahan) tidak memicu 'click' di sebagian browser -> klik disusulkan dari pointerup
  {
    const SEL = '#bag button, #topBtns button, #shop button, #coinBox, #onlineBox, #plistX';
    let downEl = null, synthEl = null, synthT = 0, inSynth = false;
    const find = (e) => (e.target && e.target.closest ? e.target.closest(SEL) : null);
    document.addEventListener('pointerdown', (e) => { downEl = find(e); }, true);
    document.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'touch' || e.isPrimary) return;
      const b = find(e);
      if (!b || b !== downEl || b.disabled) return;
      synthEl = b; synthT = performance.now(); inSynth = true;
      try { b.click(); } finally { inSynth = false; }
    }, true);
    document.addEventListener('click', (e) => {
      if (inSynth) return;
      const b = find(e);
      if (b && b === synthEl && performance.now() - synthT < 450) { e.stopImmediatePropagation(); e.preventDefault(); }   // cegah klik ganda
    }, true);
  }
  // kembali ke halaman pemilih karakter (menu dengan pratinjau dino); koin yang terkumpul tetap tersimpan
  let quitArm = -1e9;
  function quitToMenu() {
    if (state === 'playing') {
      die(t('r_quit'));
      state = 'menu'; overAt = 0;
    }
    closeBag(); refreshPanels();
  }
  const quitBtn = $('quitMenuBtn');
  if (quitBtn) {
    quitBtn.addEventListener('click', () => {
      if (state !== 'playing') { quitToMenu(); return; }
      if (performance.now() - quitArm < 3000) { quitArm = 0; quitBtn.textContent = t('quit_open'); quitToMenu(); }
      else { quitArm = performance.now(); quitBtn.textContent = t('quit_sure'); }
    });
  }
  // keluar dari game: simpan, akhiri permainan berjalan (koin tetap tersimpan), lalu buka halaman perpisahan
  let exitArm = -1e9;
  const exitBtn = $('exitBtn');
  if (exitBtn) {
    exitBtn.addEventListener('click', () => {
      if (performance.now() - exitArm > 3000) { exitArm = performance.now(); exitBtn.textContent = '🚪 ' + t('ex_sure'); return; }
      exitArm = -1e9; exitBtn.textContent = t('ex_btn');
      try { if (state === 'playing') quitToMenu(); } catch (e) { /* abaikan */ }
      writeSave();
      try { window.close(); } catch (e) { /* abaikan */ }                       // berhasil hanya jika tab dibuka oleh skrip / aplikasi terpasang
      setTimeout(() => { location.href = 'keluar.html'; }, 250);
    });
  }
  function openBag() {
    if (state === 'playing') { setLatch(false); input.sprint = false; input.attack = false; input.jump = false; for (const k in keys) keys[k] = false; }
    bagOpen = true; showTab(tabWanted); renderBag(); acctPrefetch(); bagEl.classList.remove('hidden'); }
  function closeBag() { bagOpen = false; bagEl.classList.add('hidden'); }
  if (coinBox) {                                                  // ketuk koin/poin di kanan atas -> halaman Tukar
    coinBox.style.pointerEvents = 'auto'; coinBox.style.cursor = 'pointer';
    coinBox.addEventListener('pointerdown', (e) => e.stopPropagation());
    coinBox.addEventListener('click', (e) => { e.stopPropagation(); GameAudio.init(); tabWanted = 'bag'; openBag(); });
  }
  ['bagBtn', 'bagBtn2', 'bagTop'].forEach((id) => {
    const b = $(id); if (!b) return;
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); GameAudio.init(); if (id !== 'bagTop') tabWanted = 'bag'; openBag(); });
  });
  $('bagX').addEventListener('click', closeBag);
  bagEl.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === bagEl) closeBag(); });
  bagBody.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-ex]'); if (b && !b.disabled) { const ex = b.getAttribute('data-ex'); if (ex === 'resume') closeBag(); else if (ex.startsWith('w-')) walletAct(ex); else doExchange(ex); } });

  // gerbang masuk: logo + tombol MAIN (gesture sentuh) -> layar penuh + kunci horizontal -> halaman Pilih Dino. Jika masih tegak: minta putar HP.
  const gateEl = $('rotate');
  let gateIn = false;
  const isPortraitNow = () => (window.innerHeight || 0) > (window.innerWidth || 0) * 1.05;
  function updateGate() {
    if (!gateEl) return;
    const portrait = isPortraitNow(), show = !gateIn || portrait;
    gateEl.classList.toggle('on', show);
    gateEl.classList.toggle('turn', gateIn && portrait);
    const tt = $('rotTitle'); if (tt && gateIn && portrait) tt.textContent = t('rot_turn');
  }
  if (rotBtn) rotBtn.addEventListener('click', () => { GameAudio.init(); gateIn = true; autoFsTried = true; enterImmersive(); updateGate(); setTimeout(updateGate, 400); setTimeout(updateGate, 1200); });
  window.addEventListener('resize', updateGate); window.addEventListener('orientationchange', () => setTimeout(updateGate, 200));
  updateGate();
  let autoFsTried = false;
  function autoFs() { if (autoFsTried || isFs()) return; autoFsTried = true; enterImmersive(); }
  document.addEventListener('fullscreenchange', () => { try { resize(); } catch (e) { /* abaikan */ } });
  document.addEventListener('webkitfullscreenchange', () => { try { resize(); } catch (e) { /* abaikan */ } });
  // ---------- Bahasa (Indonesia / English / Español; otomatis mengikuti bahasa HP) ----------
  const langBtn = $('langBtn');
  if (langBtn) {
    langBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    langBtn.addEventListener('click', (e) => { e.stopPropagation(); const o = L.order; L.setPref(o[(o.indexOf(L.pref) + 1) % o.length]); GameAudio.sfx.coin(); });
  }
  L.onChange(() => {
    try {
      if (langBtn) langBtn.textContent = t('lang_lbl', { l: L.label() });
      const rn = $('rotNote'); if (rn && isIOS) rn.textContent = t('rot_ios');
      quitArm = -1e9;
      renderChars(); refreshPanels();
      if (bagOpen) renderBag(); else { bagSum.textContent = t('b_sum', { c: save.coins, p: save.pts }); }
    } catch (e) { /* abaikan */ }
  });
  L.apply();

  // ---------- Aksi ----------
  function damagePlayer(amount, reason, fromX, fromZ) {
    if (player.invuln > 0 || powerLeft > 0 || state !== 'playing') return false;
    const real = amount * armorMul();
    player.hp -= real;
    showDmg(player.x, (player.gy || 0) + player.y + 2.3 * scaleNow / 1.1, player.z, '-' + Math.round(real), 'hurt', 1 + Math.min(0.5, real / 40));
    starBurst(player.x, (player.gy || 0) + player.y + 1.3 * scaleNow / 1.1, player.z, 6, 'hurt');
    player.invuln = 0.7;
    player.lastDmg = 0;
    const dx = player.x - fromX, dz = player.z - fromZ, d = Math.hypot(dx, dz) || 1;
    player.x += (dx / d) * 0.9;
    player.z += (dz / d) * 0.9;
    hurtT = 0.25;
    shake = Math.max(shake, 0.6);
    GameAudio.sfx.hit();
    GameAudio.sfx.dino(save.char, 'hurt', 0.9);
    if (player.hp <= 0) { player.hp = 0; die(reason); return true; }
    const pc = pouch();
    if (pc > 0) {
      if (!lowSpilled && player.hp <= 100 * SPILL_LOW_HP) { lowSpilled = true; spillCoins(pc, false); toast(t('hp_crit'), 2.4); }   // sisa kantong tumpah semua
      else if (!lowSpilled) spillCoins(Math.max(1, Math.ceil(pc * SPILL_HIT)), true);                                                                   // terkena serangan: tumpah perlahan
    }
    return true;
  }

  function damagePred(p, dmg, tag) {
    p.hp -= dmg; hitFeel(tag === 'counter' || tag === 'skill' || powerLeft > 0);
    p.flash = 1;
    const big = tag === 'counter' || powerLeft > 0;
    const label = (tag === 'counter' ? '💥' : tag === 'weak' ? '⚡' : '') + '-' + Math.round(dmg) + (powerLeft > 0 ? '!' : '');
    showDmg(p.x, heightAt(p.x, p.z) + (p.def.giant ? 5 : 1.7 * p.def.scale), p.z, label, big ? 'crit' : 'hit', big ? 1.4 : tag === 'weak' ? 1.15 : 1);
    const dx = p.x - player.x, dz = p.z - player.z, d = Math.hypot(dx, dz) || 1, kb = 0.7 / Math.max(1, p.def.scale * 0.8);
    p.x += (dx / d) * kb;
    p.z += (dz / d) * kb;
    p.cd = Math.max(p.cd, 0.35);
    if (p.state === 'wander') p.state = p.def.timid ? 'flee' : 'chase';     // yang netral jadi marah, yang penakut kabur
    else if (p.state === 'windup' && p.def.scale < 1.4 && !p.def.giant) {    // musuh kecil terganggu: serangannya batal
      p.state = 'stun'; p.t = 0.5; p.cd = Math.max(p.cd, 0.6);
      showDmg(p.x, heightAt(p.x, p.z) + 2.4 * p.def.scale, p.z, t('upset'), 'xp', 1);
    }
    burst(8, p.x, 1.0 * p.def.scale, p.z);
    starBurst(p.x, heightAt(p.x, p.z) + 1.3 * p.def.scale, p.z, big ? 9 : 5, big ? 'gain' : 'hit');
    if (p.hp > 0 && !p.enraged && !p.def.timid && !p.def.neutral && p.hp <= p.maxHp * 0.3) {   // hampir kalah: mengamuk
      p.enraged = true;
      toast(t('enraged', { n: p.def.name }), 1.8);
      cry(p.type, 'call', p.x, p.z, 1.4);
    }
    if (p.hp > 0 && clock - (p.cryT || -9) > 0.6) { p.cryT = clock; cry(p.type, 'hurt', p.x, p.z, 1); }
    if (p.hp <= 0) killPred(p);
  }

  function killPred(p) {
    cry(p.type, 'die', p.x, p.z, 1.2);
    p.dead = true;
    p.deadT = 0;
    if (!p.def.timid && !p.def.neutral) kills++;                 // hanya predator yang dihitung
    save.kv[p.type] = (save.kv[p.type] || 0) + 1;                // statistik seumur hidup
    if (!p.def.timid && !p.def.neutral) save.tro[p.type] = (save.tro[p.type] || 0) + 1;   // trofi predator = aset yang bisa ditukar
    const rw = Math.ceil(p.def.reward * KILL_REWARD_MUL);
    runCoins += rw;
    addC(rw);
    { const gg = 12 + Math.round(p.def.hp * 0.22); addGold(gg); celebrateKill(p.x, heightAt(p.x, p.z), p.z, Math.round(gg * (1 + bmods().gold))); }
    player.hunger = Math.min(100, player.hunger + p.def.food);
    burst(14, p.x, 1, p.z);
    starBurst(p.x, heightAt(p.x, p.z) + 1.3 * p.def.scale, p.z, 12, 'gain');
    if (rw) showDmg(p.x, heightAt(p.x, p.z) + 2.2 * p.def.scale, p.z, '+' + rw + ' 🪙', 'gain', 1.1);
    const xp = (p.def.timid || p.def.neutral) ? Math.round(p.def.hp * 0.18) : Math.round(p.def.hp * 0.45 + p.def.reward * 2);
    gainXp(xp);
    showDmg(p.x + 0.6, heightAt(p.x, p.z) + 1.6 * p.def.scale, p.z, '+' + xp + ' XP', 'xp', 1);
    ringWave(p.x, p.z, 0.6, 4.5, 0.6, 1, 0.8, 0.3); hitStop = Math.max(hitStop, 0.1); shake = Math.max(shake, 0.35);
    if (!arenaOn && rw && kills > 0 && kills % 6 === 0) { runCoins += rw; addC(rw); showDmg(p.x, heightAt(p.x, p.z) + 3 * p.def.scale, p.z, t('lucky', { n: rw }), 'gain', 1.3); starBurst(p.x, heightAt(p.x, p.z) + 1.8, p.z, 16, 'gain'); }
    GameAudio.sfx.smash();
    GameAudio.sfx.eat();
    toast((p.def.reward ? t('meat_coins', { n: p.def.reward }) : '') + t('meat', { n: p.def.food }), 2.2);
  }

  // ---------- Renang: riak di permukaan air & pose dayung ----------
  const swimRings = [];
  const swimRingGeo = new THREE.RingGeometry(0.9, 1, 40); swimRingGeo.rotateX(-Math.PI / 2);
  for (let i = 0; i < 8; i++) {
    const m = new THREE.MeshBasicMaterial({ color: 0xeaf7ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(swimRingGeo, m);
    mesh.visible = false; scene.add(mesh);
    swimRings.push({ mesh, m, t: 9, x: 0, z: 0 });
  }
  function spawnSwimRing(x, z, big) {
    const r = swimRings.find((q) => q.t >= 1.2) || swimRings[0];
    r.t = 0; r.x = x; r.z = z; r.big = big || 1; r.mesh.visible = true;
  }
  // busa di sekeliling badan + jejak air berbentuk V di belakang saat berenang
  const foamGeo = new THREE.RingGeometry(0.62, 1, 28); foamGeo.rotateX(-Math.PI / 2);
  const mFoam = new THREE.MeshBasicMaterial({ color: 0xf2fbff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const swimFoam = new THREE.Mesh(foamGeo, mFoam); swimFoam.visible = false; scene.add(swimFoam);
  const wakeGeo = new THREE.PlaneGeometry(1, 1); wakeGeo.rotateX(-Math.PI / 2);
  const mWake = new THREE.MeshBasicMaterial({ color: 0xeaf8ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  try {
    const cv = document.createElement('canvas'); cv.width = 8; cv.height = 64;
    const c2 = cv.getContext('2d'), g = c2.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c2.fillStyle = g; c2.fillRect(0, 0, 8, 64);
    mWake.map = new THREE.CanvasTexture(cv); mWake.needsUpdate = true;
  } catch (e) { /* tanpa gradasi */ }
  const wakes = [new THREE.Mesh(wakeGeo, mWake), new THREE.Mesh(wakeGeo, mWake)];
  wakes.forEach((w) => { w.visible = false; scene.add(w); });
  function updateSwimFx() {
    const on = swimBlend > 0.05;
    swimFoam.visible = on; wakes.forEach((w) => { w.visible = on; });
    if (!on) return;
    const k = scaleNow / 1.1, sp = Math.hypot(player.vx, player.vz), mv = clamp(sp / 3.4, 0, 1.4);
    swimFoam.position.set(player.x, WL + 0.07, player.z);
    swimFoam.rotation.y = player.yaw;
    swimFoam.scale.set((0.85 + Math.sin(clock * 5) * 0.04) * k, 1, (1.45 + mv * 0.3) * k);
    mFoam.opacity = swimBlend * (0.22 + mv * 0.3);
    const bx = Math.sin(player.yaw), bz = Math.cos(player.yaw);       // arah belakang
    for (let i = 0; i < 2; i++) {
      const sd = i ? 1 : -1, w = wakes[i];
      w.position.set(player.x + bx * 2.4 * k - bz * sd * 0.9 * k, WL + 0.06, player.z + bz * 2.4 * k + bx * sd * 0.9 * k);
      w.rotation.y = player.yaw + sd * 0.3;
      w.scale.set(0.45 * k, 1, (3 + mv * 2) * k);
    }
    mWake.opacity = swimBlend * mv * 0.55;
  }
  function updateSwimRings(dt) {
    updateSwimFx();
    for (const r of swimRings) {
      if (r.t >= 1.2) { r.mesh.visible = false; continue; }
      r.t += dt;
      const f = Math.min(1, r.t / 1.2);
      r.mesh.position.set(r.x, WL + 0.06, r.z);
      const sc = (0.5 + f * 2.4) * r.big * (scaleNow / 1.1);
      r.mesh.scale.set(sc, 1, sc);
      r.m.opacity = 0.55 * (1 - f) * (1 - f);
    }
  }
  // dayung: kaki mengayuh cepat, badan agak terangkat, ekor menyapu kiri-kanan
  function applySwim(c, b, spd, t) {
    if (b < 0.01) return;
    // fase diakumulasi (bukan clock*kecepatan): perubahan kecepatan tidak boleh melompatkan fase kaki -> penyebab 'gedek-gedek'
    c.swSpd = approach(c.swSpd === undefined ? spd : c.swSpd, spd, 4);
    c.swPh = (c.swPh || 0) + animDt * (5.5 + c.swSpd * 0.9);
    const ph = c.swPh;
    for (let i = 0; i < 2; i++) {
      const L = c.legs[i], o = ph + i * Math.PI;
      L.hip.rotation.x += (Math.sin(o) * 0.95 - L.hip.rotation.x) * b;
      L.knee.rotation.x += (-0.6 - 0.35 * Math.sin(o + 1) - L.knee.rotation.x) * b;
      if (L.foot) L.foot.rotation.x += (0.4 - L.foot.rotation.x) * b;
    }
    c.body.rotation.x += (0.2 - c.body.rotation.x) * b;
    c.body.rotation.z += (Math.sin(ph * 0.5) * 0.1 - c.body.rotation.z) * b;
    if (c.headPivot) c.headPivot.rotation.x += (-0.35 - c.headPivot.rotation.x) * b;      // kepala terangkat di atas air
    c.body.position.y += (0.05 - c.body.position.y) * b;
    const sw = Math.sin(t * 4.2) * 0.5 * b;
    c.tail1.rotation.y = sw * 0.7; c.tail2.rotation.y = Math.sin(t * 4.2 - 0.9) * 0.6 * b;
    if (c.tail3) c.tail3.rotation.y = Math.sin(t * 4.2 - 1.8) * 0.7 * b;
    for (let i = 0; i < 2; i++) c.arms[i].rotation.x = -0.9 * b;
  }

  // ---------- Skill: Raungan (saat dikeroyok) ----------
  let roarCd = 0, roarT = 99, roarR = 8, roarHint = 0;
  const roarRingGeo = new THREE.RingGeometry(0.9, 1, 48); roarRingGeo.rotateX(-Math.PI / 2);
  const mRoar = new THREE.MeshBasicMaterial({ color: 0xcfd8dc, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const roarRing = new THREE.Mesh(roarRingGeo, mRoar);
  roarRing.visible = false;
  scene.add(roarRing);
  const roarCooldown = () => Math.max(8, 15 - 0.6 * (player.level - 1)) * (1 - bmods().cdr);
  function doRoar() {
    if (state !== 'playing') return;
    arenaSkillPress(); return;
    if (roarCd > 0) return;
    roarCd = roarCooldown();
    roarR = 8 + 0.2 * player.level;
    roarT = 0;
    const dmg = 8 + 3 * player.level;
    let hit = 0;
    for (const p of preds.slice()) {
      if (p.dead) continue;
      const dx = p.x - player.x, dz = p.z - player.z, d = Math.hypot(dx, dz) || 1;
      if (d > roarR) continue;
      hit++;
      const calm = p.def.timid || p.def.neutral, giant = !!p.def.giant;
      const kb = (giant ? 0.8 : 3.2) * (1 - d / roarR * 0.5);
      p.x += (dx / d) * kb; p.z += (dz / d) * kb;
      if (!calm) damagePred(p, dmg * (giant ? 0.6 : 1), 'roar');
      if (p.dead) continue;
      if (p.def.timid) { p.state = 'flee'; p.t = 3; }
      else { p.state = 'stun'; p.t = giant ? 0.9 : 1.9; p.cd = Math.max(p.cd, 1.6); p.warn && (p.warn.visible = false); }
    }
    player.invuln = Math.max(player.invuln, 0.7);
    shake = Math.max(shake, 0.7);
    GameAudio.sfx.dino(save.char === 'vosil' ? 'carno' : save.char, 'call', 1.6);
    showDmg(player.x, (player.gy || 0) + player.y + 3.0 * scaleNow / 1.1, player.z, t('roar_pop'), 'crit', 1.3);
    starBurst(player.x, (player.gy || 0) + player.y + 1.6 * scaleNow / 1.1, player.z, 10, 'gain');
    if (hit === 0) toast(t('roar_none'), 1.4);
  }
  function updateRoar(dt) {
    roarCd = Math.max(0, roarCd - dt);
    roarHint = Math.max(0, roarHint - dt);
    if (roarT < 0.6) {
      roarT += dt;
      const f = Math.min(1, roarT / 0.6);
      roarRing.visible = true;
      roarRing.position.set(player.x, (player.gy || heightAt(player.x, player.z)) + 0.25, player.z);
      roarRing.scale.set(1 + f * roarR, 1, 1 + f * roarR);
      mRoar.opacity = 0.5 * (1 - f) * (1 - f);
    } else roarRing.visible = false;
    if (state !== 'playing') return;
    let swarm = 0;
    for (const p of preds) {
      if (p.dead || p.def.timid || p.def.neutral) continue;
      if (Math.hypot(p.x - player.x, p.z - player.z) < 9 && p.state !== 'wander' && p.state !== 'flee') swarm++;
    }
    if (btnRoar) {
      const ready = roarCd <= 0;
      btnRoar.classList.toggle('cd', !ready);
      btnRoar.classList.toggle('urgent', ready && swarm >= 3);
      const sp = btnRoar.querySelector('span');
      const txt = ready ? skLabel() : Math.ceil(roarCd) + ' ' + t('unit_sec');
      if (sp && sp.textContent !== txt) sp.textContent = txt;
    }
    if (swarm >= 3 && roarCd <= 0 && roarHint <= 0) { toast(t('swarm_hint', { b: t('sk_roar') }), 2.2); roarHint = 14; }
  }

  // ---------- Penanda jangkauan gigitan: cincin tipis di sekeliling dino (membesar mengikuti ukuran; menyala bila ada lawan dalam jangkauan) ----------
  const BR_N = 72, biteArr = new Float32Array((BR_N + 1) * 2 * 3), biteGeo = new THREE.BufferGeometry();
  { const idx = []; for (let k = 0; k < BR_N; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } biteGeo.setIndex(idx); }
  biteGeo.setAttribute('position', new THREE.BufferAttribute(biteArr, 3));
  const mBite = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false, side: THREE.DoubleSide });
  const biteRing = new THREE.Mesh(biteGeo, mBite); biteRing.renderOrder = 3; biteRing.visible = false; biteRing.frustumCulled = false; scene.add(biteRing);
  let biteHot = 0, biteShow = 0, atkHeld = false, atkHoldT = 0;
  const RING_HOLD = 0.5;                                                         // cincin muncul bila tombol gigit ditahan selama ini (ketukan biasa tidak memunculkannya)
  const biteRange = () => { const sk = arenaOn && typeof Arena !== 'undefined' && Arena.kits && Arena.kits[save.char]; return 2.4 * (scaleNow / 1.1) + 0.75 + (sk && sk.bite ? sk.bite.reach || 0 : 0); };
  function updateBiteRing(dt) {                                                    // hanya tampil bila tombol gigit ditahan beberapa saat
    atkHoldT = atkHeld ? atkHoldT + dt : 0;
    const want = state === 'playing' && save.ring !== false && atkHoldT >= RING_HOLD ? 1 : 0;
    biteShow += (want - biteShow) * Math.min(1, dt * 16);
    if (biteShow < 0.02) { biteRing.visible = false; return; }
    biteRing.visible = true;
    const R = biteRange(), w = 0.13;
    let hot = false;
    for (const p of preds) { if (!p.dead && !p.def.timid && !p.def.neutral && Math.hypot(p.x - player.x, p.z - player.z) < R + p.def.scale * 0.6) { hot = true; break; } }
    if (!hot && arenaOn && typeof Arena !== 'undefined') for (const r of Arena.remotes.values()) { if (r.seen && r.near && Math.hypot(r.x - player.x, r.z - player.z) < R + 0.6) { hot = true; break; } }
    biteHot += ((hot ? 1 : 0) - biteHot) * Math.min(1, dt * 10);
    for (let k = 0; k <= BR_N; k++) {                                            // cincin mengikuti permukaan tanah (lembah, lereng) supaya tidak terpotong
      const a = k / BR_N * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a), o = k * 6;
      const xo = player.x + c * R, zo = player.z + sn * R, xi = player.x + c * (R - w), zi = player.z + sn * (R - w);
      biteArr[o] = xi; biteArr[o + 1] = heightAt(xi, zi) + 0.2; biteArr[o + 2] = zi;
      biteArr[o + 3] = xo; biteArr[o + 4] = heightAt(xo, zo) + 0.2; biteArr[o + 5] = zo;
    }
    biteGeo.attributes.position.needsUpdate = true;
    mBite.opacity = (0.55 + 0.3 * biteHot) * biteShow;
    mBite.color.setRGB(1, 1 - 0.55 * biteHot, 1 - 0.7 * biteHot);                  // putih -> oranye saat lawan terjangkau
  }
  function startAttack() {
    if (player.atkCd > 0 || player.atkT >= 0 || stunT > 0) return;
    // bantuan bidik: hadapkan ke predator terdekat jika dekat
    let best = null, bd = 6.5;
    for (const p of preds) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (arenaOn) for (const r of Arena.remotes.values()) {
      if (!r.seen || !r.near) continue;
      const d = Math.hypot(r.x - player.x, r.z - player.z);
      if (d < bd) { bd = d; best = r; }
    }
    if (best) player.yaw = faceYaw(best.x - player.x, best.z - player.z);
    if (arenaOn) Arena.attack(player.yaw);
    spawnSlash(player.x, hero.root.position.y, player.z, player.yaw, scaleNow / 1.1);
    player.atkT = 0;
    player.atkHit = false;
    player.atkCd = 0.55;
    GameAudio.sfx.bite();
    if (clock - biteVoiceT > 2.4) { biteVoiceT = clock; GameAudio.sfx.dino(save.char, 'attack', 0.55); }
  }

  function biteHit() {
    const dmg = 18 * biteMul() * (powerLeft > 0 ? 3 : 1);
    const sc = scaleNow / 1.1;
    for (const p of preds) {
      if (p.dead) continue;
      const dx = p.x - player.x, dz = p.z - player.z, d = Math.hypot(dx, dz);
      if (d > 2.4 * sc + p.def.scale * 0.9 + (p.def.hitExtra || 0)) continue;
      if (d > 1.3 && Math.abs(angDiff(player.yaw, faceYaw(dx, dz))) > 1.1) continue;
      let m = 1, tag = '';
      if (p.state === 'recover' || p.state === 'stun') { m *= p.state === 'stun' ? 1.5 : 1.35; tag = 'weak'; }   // musuh lengah: titik lemah
      if (player.counterT > 0) { m *= 1.6; player.counterT = 0; tag = 'counter'; }                                 // balasan setelah hindar tepat waktu
      damagePred(p, dmg * m, tag);
      if (!arenaOn && bmods().ls > 0) player.hp = Math.min(100, player.hp + dmg * m * bmods().ls);
    }
  }

  // ---------- Predator ----------
  // penanda bahaya di tanah saat musuh bersiap menyerang
  const warnPlane = new THREE.PlaneGeometry(1, 1); warnPlane.rotateX(-Math.PI / 2);
  const warnRing = new THREE.RingGeometry(0.82, 1, 32); warnRing.rotateX(-Math.PI / 2);
  const warnDisc = new THREE.CircleGeometry(1, 32); warnDisc.rotateX(-Math.PI / 2);
  const mkWarnMat = (draw) => {
    const m = new THREE.MeshBasicMaterial({ color: 0xff8a50, transparent: true, opacity: 0, depthWrite: false });
    m.polygonOffset = true; m.polygonOffsetFactor = -3; m.polygonOffsetUnits = -3;
    try {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const c2 = cv.getContext('2d'); draw(c2);
      m.map = new THREE.CanvasTexture(cv); m.needsUpdate = true;
    } catch (e) { m.opacity = 0; }
    return m;
  };
  // lingkaran peringatan: pusat hampir bening, tepi berpendar lembut
  const mWarnDisc = mkWarnMat((c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.12)'); g.addColorStop(0.7, 'rgba(255,255,255,0.4)'); g.addColorStop(0.9, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  });
  // jalur terkaman: tepi kiri-kanan memudar
  const mWarnPlane = mkWarnMat((c) => {
    const g = c.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.3, 'rgba(255,255,255,0.45)'); g.addColorStop(0.7, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  });

  // ---------- Suara dinosaurus (volume & posisi stereo mengikuti jarak/arah dari kamera) ----------
  let dangerNow = 0, waryNow = 0, cryCd = 6, flyCryCd = 14;
  function cry(type, kind, x, z, boost) {
    const dx = x - player.x, dz = z - player.z, d = Math.hypot(dx, dz);
    const range = type === 'brachio' || type === 'diplo' ? 95 : 55;
    const vol = clamp(1 - d / range, 0, 1) * (boost || 1);
    if (vol < 0.05) return;
    const pan = d > 3 ? clamp(((dx * Math.cos(camYaw) - dz * Math.sin(camYaw)) / d) * 0.9, -0.9, 0.9) : 0;
    GameAudio.sfx.dino(type, kind, vol, pan);
  }
  GameAudio.setDanger(() => dangerNow);
  GameAudio.setWary(() => waryNow);
  function updateDanger(dt) {                                    // ketegangan musik: jumlah musuh yang menyerang dan sisa HP
    let n = 0;
    for (const p of preds) {
      if (p.dead || p.def.timid || p.def.neutral || p.state === 'wander' || p.state === 'flee') continue;
      if (Math.hypot(p.x - player.x, p.z - player.z) < 16) n++;
    }
    let target = clamp(n / 4, 0, 1);
    if (n > 0 && player.hp < 35) target = Math.min(1, target + 0.3);
    if (state !== 'playing') target = 0;
    dangerNow += (target - dangerNow) * Math.min(1, dt * 2);
    // "waspada": malam, area berbahaya (musuh dekat belum menyerang), HP rendah, atau kawanan akan datang
    let w = isNight ? 0.85 : 0;
    if (horde && horde.spawned === 0) w = 1;
    if (player.hp < 35) w = Math.max(w, 0.7);
    for (const p of preds) if (!p.dead && !p.def.timid && !p.def.neutral && Math.hypot(p.x - player.x, p.z - player.z) < 40) { w = Math.max(w, 0.6); break; }
    if (state !== 'playing') w = 0;
    waryNow += (w - waryNow) * Math.min(1, dt * 0.8);
    // seruan hewan di sekitar supaya dunia terdengar hidup
    cryCd -= dt;
    if (cryCd <= 0 && state === 'playing') {
      cryCd = rand(5, 11);
      const near = preds.filter((p) => !p.dead && p.state === 'wander' && Math.hypot(p.x - player.x, p.z - player.z) < 60);
      if (near.length) { const p = near[Math.floor(Math.random() * near.length)]; cry(p.type, 'call', p.x, p.z, 0.8); }
    }
    flyCryCd -= dt;
    if (flyCryCd <= 0 && state === 'playing' && !isNight) {
      flyCryCd = rand(12, 24);
      const f = flyers[Math.floor(Math.random() * flyers.length)];
      if (f) cry('flyer', 'call', f.g.position.x, f.g.position.z, 1.3);
    }
  }

  // ---------- Serbuan kawanan: 5 atau 7 musuh sekaligus ----------
  let hordeCd = 70, horde = null;
  function startHorde() {
    const day = Math.floor(runTime / DAY_LEN);
    const n = (day >= 2 || player.level >= 4) ? 7 : 5;
    horde = { t: 0, warn: 2.8, n, spawned: 0, members: [], pulse: -1 };
    toast(t('bush'), 2.8);
    GameAudio.sfx.horde();
    shake = Math.max(shake, 0.3);
  }
  function spawnHordeMember(i) {
    const day = Math.floor(runTime / DAY_LEN);
    const type = horde.n >= 7 && i === 0 && day >= 1 ? 'carno' : i % 2 === 0 ? 'raptor' : 'velo';
    const p = spawnPredator(type);
    const base = horde.base;
    for (let k = 0; k < 8; k++) {                                  // melingkar mengepung, bukan di dalam air
      const a = base + (i / horde.n) * Math.PI * 2 + rand(-0.25, 0.25), d = rand(12, 17);
      p.x = player.x + Math.cos(a) * d; p.z = player.z + Math.sin(a) * d;
      if (WL - heightAt(p.x, p.z) < 0.5) break;
    }
    p.state = 'chase'; p.roared = true; p.horde = true;
    p.hp *= 0.85; p.maxHp *= 0.85; p.dmgMul *= 0.85;
    p.cd = 0.6 + i * 0.3;                                          // serangan tidak serentak, bergelombang
    if (!save.seen[type]) { save.seen[type] = true; writeSave(); }
    puff(8, p.x, p.z, 0.9);
    cry(type, 'call', p.x, p.z, 1.1);
    horde.members.push(p);
  }
  function updateHorde(dt) {
    if (arenaOn) return;
    if (state !== 'playing') return;
    if (!horde) {
      hordeCd -= dt;
      if (hordeCd > 0) return;
      const hostile = preds.filter((p) => !p.dead && !p.def.timid && !p.def.neutral).length;
      if (hostile <= 2 && !swimming && player.hp > 40) startHorde(); else hordeCd = 12;
      if (horde) horde.base = Math.random() * Math.PI * 2;
      return;
    }
    horde.t += dt;
    if (horde.t < horde.warn) {
      const pu = Math.floor(horde.t * 2.5);
      if (pu !== horde.pulse) { horde.pulse = pu; shake = Math.max(shake, 0.18 + pu * 0.04); }
      return;
    }
    if (horde.spawned === 0) { toast(t('horde', { n: horde.n, b: t('sk_roar') }), 3); shake = Math.max(shake, 0.9); }
    while (horde.spawned < horde.n && horde.t >= horde.warn + horde.spawned * 0.2) { spawnHordeMember(horde.spawned); horde.spawned++; }
    if (horde.spawned < horde.n) return;
    const alive = horde.members.filter((p) => !p.dead && preds.includes(p));
    if (!alive.length) {
      const bonus = horde.n * 12;
      gainXp(bonus); runCoins += horde.n * 2; addC(horde.n * 2); writeSave();
      toast(t('horde_won', { x: bonus, c: horde.n * 4 }), 3);
      GameAudio.sfx.record();
      horde = null; hordeCd = rand(100, 160);
    } else if (alive.every((p) => Math.hypot(p.x - player.x, p.z - player.z) > 60)) {
      horde = null; hordeCd = 60;
    }
  }

  function spawnPredator(type) {
    const def = PTYPES[type];
    const a = Math.random() * Math.PI * 2, d = rand(36, 46);
    const c = def.model === 'trike' ? makeTrike(def.pal, def.scale)
      : def.model ? makeQuad(def.pal, def.scale, def.model)
      : makeCreature(Object.assign({ scale: def.scale, variant: def.variant }, def.pal));
    scene.add(c.root);
    const shd = makeDynShadow();
    scene.add(shd);
    const warn = new THREE.Mesh(warnDisc, mWarnDisc);
    warn.visible = false;
    scene.add(warn);
    const dayNow = Math.floor(runTime / DAY_LEN), hostile = !def.timid && !def.neutral;
    const hpMul = hostile ? 1 + 0.1 * dayNow + 0.05 * (player.level - 1) : 1;      // makin lama dan makin besar dinomu, musuh makin tangguh
    const p = {
      sh: shd, warn, type, def, c, x: player.x + Math.cos(a) * d, z: player.z + Math.sin(a) * d, yaw: Math.random() * 6,
      hp: def.hp * hpMul, maxHp: def.hp * hpMul, dmgMul: hostile ? 1 + 0.07 * dayNow : 1, flank: Math.random() < 0.5 ? 1 : -1,
      state: 'wander', t: 0, t0: 1, cd: 1, wdir: null, wanderT: 0, phase: Math.random() * 6,
      lx: 0, lz: 1, st: 0, dur: 0.2, hitDone: false, locked: false, enraged: false,
      flash: 0, dead: false, deadT: 0, roared: false, speedNow: 0
    };
    pushOut(p, 0.8 * def.scale);
    for (let k = 0; k < 10 && !def.aqua && WL - heightAt(p.x, p.z) > 0.7; k++) {   // dinosaurus darat tidak muncul di tengah air
      const a2 = Math.random() * Math.PI * 2, d2 = rand(30, 48);
      p.x = player.x + Math.cos(a2) * d2; p.z = player.z + Math.sin(a2) * d2;
    }
    preds.push(p);
    return p;
  }

  // pilihan spesies berdasarkan hari, malam, dan bioma tempat pemain berada
  function pickPredatorType(day) {
    const bi = biomeAt(player.x, player.z).id;
    const w = { raptor: 3, velo: 3 };
    if (day >= 1) { w.rex = isNight ? 2.5 : 1.2; w.carno = bi === 'desert' ? 2.5 : 1.3; }
    if (bi === 'swamp' && day >= 1) w.spino = 3; else if (day >= 2) w.spino = 0.8;
    return weighted(w);
  }
  function pickAnimalType() {
    const w = { gallim: 3, parasaur: 2.5, trike: 2, stego: 1.6, anky: 1.4, brachio: 0.9, diplo: 0.8 };
    if (preds.some((q) => !q.dead && q.def.giant)) { w.brachio = 0; w.diplo = 0; }    // satu raksasa dalam satu waktu
    return weighted(w);
  }
  function weighted(w) {
    let tot = 0;
    for (const k in w) tot += w[k];
    let r = Math.random() * tot;
    for (const k in w) { r -= w[k]; if (r <= 0) return k; }
    return Object.keys(w)[0];
  }

  function disposeTree(root) {                       // bebaskan memori GPU bentuk milik satu makhluk
    try {
      if (root && typeof root.traverse === 'function') root.traverse((o) => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); });
    } catch (e) { /* abaikan */ }
  }
  function removePred(p) {
    scene.remove(p.c.root);
    disposeTree(p.c.root);
    if (p.sh) { scene.remove(p.sh); if (p.sh.userData.unit && p.sh.geometry) p.sh.geometry.dispose(); }
    if (p.warn) scene.remove(p.warn);
  }

  function chaseSpeed(p) {
    const day = Math.floor(runTime / DAY_LEN);
    return p.def.speed * (isNight ? 1.08 : 1) * (p.def.aqua && inPond(p.x, p.z) ? 1.3 : 1) * (1 + 0.03 * Math.min(6, day)) * (p.enraged ? 1.2 : 1);
  }
  function triggerDist(def) {
    if (def.atk === 'charge') return 11;
    if (def.atk === 'sweep') return (def.sweepR || 4) * 0.92;
    return def.reach + (def.lunge || 0) * 0.55;
  }
  function hitRadius(p) {
    return p.def.atk === 'sweep' ? p.def.sweepR : 0.9 * p.def.scale + 0.6 + 0.35 * (scaleNow / 1.1);
  }
  function beginStrike(p, d) {
    const def = p.def;
    p.state = 'strike';
    p.st = 0;
    p.hitDone = false;
    p.dur = def.atk === 'charge' ? 0.5 : def.atk === 'sweep' ? 0.3 : def.atk === 'bite' ? 0.22 : 0.26;
    cry(p.type, 'attack', p.x, p.z, 1);
    if (def.atk === 'sweep') resolveHitSweep(p);
    else GameAudio.sfx.bite();
  }
  function resolveHitSweep(p) {
    if (Math.hypot(player.x - p.x, player.z - p.z) < p.def.sweepR) resolveHit(p);
  }
  function resolveHit(p) {
    if (p.hitDone) return;
    p.hitDone = true;
    if (player.y > 0.7) {                                  // melompat tepat waktu = hindar sempurna
      perfectDodge(p);
      return;
    }
    damagePlayer(p.def.dmg * p.dmgMul, t('r_eaten', { n: p.def.name }), p.x, p.z);
  }
  function perfectDodge(p) {
    showDmg(player.x, (player.gy || 0) + player.y + 3.0 * scaleNow / 1.1, player.z, t('dodge'), 'crit', 1.3);
    GameAudio.sfx.land();
    player.stamina = Math.min(100, player.stamina + 35);
    player.counterT = 2.2;                                 // gigitan berikutnya jadi balasan keras
    p.state = 'stun';
    p.t = 1.3;
    p.cd = (p.def.cd || 1.2) * 0.6;
    gainXp(4);
  }

  function updateWarn(p, pgy) {
    const w = p.warn, def = p.def;
    if (p.state !== 'windup' || p.dead) { w.visible = false; return; }
    const prog = clamp(1 - p.t / p.t0, 0, 1);
    w.visible = true;
    const ease = prog * prog * (3 - 2 * prog);
    w.rotation.set(0, 0, 0);
    if (def.atk === 'sweep') {                          // lingkaran: seluruh area ini berbahaya
      w.geometry = warnDisc; w.material = mWarnDisc; mWarnDisc.opacity = 0.12 + 0.3 * ease;
      w.position.set(p.x, pgy + 0.16, p.z);
      w.scale.set(def.sweepR, 1, def.sweepR);
    } else {                                            // jalur terkaman
      const len = def.atk === 'charge' ? def.lunge + 1 : (def.lunge || 1.6) + hitRadius(p);
      const wid = hitRadius(p) * 1.6;
      const lx = p.locked ? p.lx : -Math.sin(p.yaw), lz = p.locked ? p.lz : -Math.cos(p.yaw);
      w.geometry = warnPlane; w.material = mWarnPlane; mWarnPlane.opacity = 0.1 + 0.34 * ease;
      w.position.set(p.x + lx * len / 2, pgy + 0.16, p.z + lz * len / 2);
      w.rotation.y = Math.atan2(lx, lz);
      w.scale.set(wid, 1, len);
    }
  }

  function updatePredators(dt) {
    chased = false;
    if (arenaOn) return;                                          // arena uji: belum ada dino bersama
    const day = Math.floor(runTime / DAY_LEN);
    const maxCount = Math.max(2, Math.round(((isNight ? 4 : 2) + Math.min(2, Math.floor(day / 2))) * predMul));
    spawnCd -= dt;
    const alive = preds.filter((p) => !p.dead && !p.def.neutral && !p.def.timid).length;
    if (spawnCd <= 0 && alive < maxCount) {
      spawnCd = rand(4, 8);
      const type = pickPredatorType(day);
      const first = spawnPredator(type);
      if (PTYPES[type].pack && alive + 1 < maxCount) {              // velociraptor berburu berpasangan
        const mate = spawnPredator(type);
        mate.x = first.x + rand(-2.5, 2.5); mate.z = first.z + rand(-2.5, 2.5);
      }
    }
    // hewan lain (herbivora) menjaga dunia terasa hidup
    animalCd -= dt;
    const animals = preds.filter((p) => !p.dead && (p.def.neutral || p.def.timid)).length;
    if (animalCd <= 0 && animals < Math.round(5 * predMul)) {
      animalCd = rand(3, 6);
      spawnPredator(pickAnimalType());
    }

    for (const p of preds) {                                          // dinosaurus darat tidak bisa masuk air dalam
      if (p.dead) continue;
      if (!p.def.aqua && Math.abs(p.x - player.x) < 90 && Math.abs(p.z - player.z) < 90 && (WL - heightAt(p.x, p.z) > 0.9 || inChasm(p.x, p.z))) {
        if (p.px !== undefined && WL - heightAt(p.px, p.pz) <= 0.9 && !inChasm(p.px, p.pz)) { p.x = p.px; p.z = p.pz; p.shoreBlk = 0.25; }   // tertahan di tepi: diam, tidak bergetar
        else {                                                       // terjebak di air (muncul/terdorong): pindah ke daratan terdekat
          for (let k = 0; k < 14; k++) {
            const a2 = Math.random() * Math.PI * 2, d2 = 14 + k * 3;
            const nx = player.x + Math.cos(a2) * d2, nz = player.z + Math.sin(a2) * d2;
            if (WL - heightAt(nx, nz) < 0.3 && !zoneNear(nx, nz, 4)) { p.x = nx; p.z = nz; break; }
          }
          p.px = p.x; p.pz = p.z;
        }
      } else { p.px = p.x; p.pz = p.z; }
    }
    for (const p of preds) {
      const def = p.def;
      if (p.dead) { p.deadT += dt; continue; }
      const dx = player.x - p.x, dz = player.z - p.z;
      const d = Math.hypot(dx, dz) || 0.001;
      p.cd -= dt;
      p.flash = Math.max(0, p.flash - dt * 4);
      const detect = def.detect * (isNight ? 1.35 : 1);
      let sp = 0;

      if (p.state === 'wander') {
        p.wanderT -= dt;
        if (p.wanderT <= 0) { p.wanderT = rand(2, 5); p.wdir = Math.random() < 0.3 ? null : Math.random() * Math.PI * 2; }
        if (p.wdir !== null) {
          const hx = Math.cos(p.wdir), hz = Math.sin(p.wdir);
          p.x += hx * def.wander * dt; p.z += hz * def.wander * dt;
          p.yaw = lerpAngle(p.yaw, faceYaw(hx, hz), Math.min(1, dt * 5));
          sp = def.wander;
        }
        if ((def.timid || def.neutral) && d < 26 && !save.seen[p.type]) {
          save.seen[p.type] = true; writeSave();
          toast(t('new_species', { n: def.name, a: Object.keys(save.seen).length, b: Object.keys(PTYPES).length }), 2.4);
        }
        if (def.timid) {
          if (d < def.fleeDist) p.state = 'flee';
        } else if (!def.neutral && d < detect) {
          p.state = 'chase';
          if (!p.roared) {
            p.roared = true; cry(p.type, 'call', p.x, p.z, 1.3);
            const fresh = !save.seen[p.type];
            if (fresh) { save.seen[p.type] = true; writeSave(); }
            toast(t('chasing', { n: def.name }) + (fresh ? t('fresh_sp') : ''), fresh ? 2.4 : 1.6);
          }
        }
      } else if (p.state === 'flee') {
        const hx = -dx / d, hz = -dz / d;
        sp = def.speed;
        p.x += hx * sp * dt; p.z += hz * sp * dt;
        p.yaw = lerpAngle(p.yaw, faceYaw(hx, hz), Math.min(1, dt * 10));
        if (d > def.fleeDist * 1.9) p.state = 'wander';
      } else if (p.state === 'chase') {
        chased = true;
        let hx = dx / d, hz = dz / d;
        if (def.pack && d > 5) {                           // berburu berpasangan: mengepung dari dua sisi
          const f = p.flank * 0.55, cf = Math.cos(f), sf = Math.sin(f);
          const rx = hx * cf - hz * sf, rz = hx * sf + hz * cf;
          hx = rx; hz = rz;
        }
        if (d > def.reach * 0.75) {
          sp = chaseSpeed(p);
          p.x += hx * sp * dt; p.z += hz * sp * dt;
        }
        p.yaw = lerpAngle(p.yaw, faceYaw(dx / d, dz / d), Math.min(1, dt * 10));
        if (d > detect * 1.9) p.state = 'wander';
        else if (p.cd <= 0 && d < triggerDist(def) && (def.atk !== 'charge' || d > 3.5)) {
          p.state = 'windup';
          p.t0 = p.t = (def.windup || 0.4) * (p.enraged ? 0.8 : 1) * (day >= 3 ? 0.92 : 1);
          p.locked = false;
        }
      } else if (p.state === 'windup') {
        chased = true;
        p.t -= dt;
        const prog = 1 - p.t / p.t0;
        if (!p.locked) {
          p.yaw = lerpAngle(p.yaw, faceYaw(dx / d, dz / d), Math.min(1, dt * 8));
          if (def.atk !== 'sweep' && d > def.reach * 0.6 && prog < 0.5) {   // masih membuntuti sambil membidik
            sp = def.speed * 0.45;
            p.x += (dx / d) * sp * dt; p.z += (dz / d) * sp * dt;
          }
          if (prog >= 0.55) {                              // arah terkunci: setelah ini hanya bisa dihindari
            p.locked = true;
            const px = player.x + (def.atk === 'charge' ? player.vx * 0.25 : 0), pz = player.z + (def.atk === 'charge' ? player.vz * 0.25 : 0);
            const ddx = px - p.x, ddz = pz - p.z, dd = Math.hypot(ddx, ddz) || 1;
            p.lx = ddx / dd; p.lz = ddz / dd;
            p.yaw = faceYaw(p.lx, p.lz);
          }
        }
        if (p.t <= 0) beginStrike(p, d);
      } else if (p.state === 'strike') {
        chased = true;
        p.st += dt;
        if (def.atk !== 'sweep') {
          const spd = (def.lunge || 1.6) / p.dur;
          p.x += p.lx * spd * dt; p.z += p.lz * spd * dt;
          if (!p.hitDone && Math.hypot(player.x - p.x, player.z - p.z) < hitRadius(p)) resolveHit(p);
        }
        if (p.st >= p.dur) {
          p.state = 'recover';
          p.t = (def.recover || 0.55) * (p.hitDone ? 1 : (def.atk === 'charge' ? 1.5 : 1.25));   // meleset = lengah lebih lama
          p.cd = (def.cd || 1.2) * (p.enraged ? 0.8 : 1);
        }
      } else if (p.state === 'stun') {                     // terkejut / terhuyung
        chased = true;
        p.t -= dt;
        if (p.t <= 0) { p.state = 'chase'; p.cd = Math.min(p.cd, (def.cd || 1.2) * 0.6); }
      } else {                                             // recover
        chased = true;
        p.t -= dt;
        if (p.t <= 0) p.state = 'chase';
      }

      pushOut(p, 0.8 * def.scale);
      if (p.shoreBlk > 0) { p.shoreBlk -= dt; sp = 0; }
      p.speedNow = sp;
      if (d > 90) { p.dead = true; p.deadT = 99; }      // terlalu jauh: dibuang
    }

    for (const p of preds) {
      if (p.dead && p.deadT >= 1.6) removePred(p);
    }
    preds = preds.filter((p) => !(p.dead && p.deadT >= 1.6));
  }

  // ---------- Update logika ----------
  function update(dt) {
    if (shopOpen && !arenaOn) dt = 0;
    if (shopOpen && arenaOn) { shopPing += dt; if (shopPing > 4) { shopPing = 0; Arena.shop(true); } }
    if (!arenaOn && state === 'playing') { shopGoldT += dt; if (shopGoldT >= 5) { shopGoldT -= 5; addGold(3); } }
    if (arenaOn) runTime = Arena.worldTime(); else runTime += dt;                  // arena: jam siang-malam mengikuti server
    applyDayNight();
    { const dNow = Math.floor(runTime / DAY_LEN); if (dNow > lvDay) { lvDay = dNow; if (dNow > 0) { gainXp(30); toast(t('day_toast', { n: dNow + 1 }), 2); } } }
    if (keys.camL) camYaw += 1.9 * dt;
    if (keys.camR) camYaw -= 1.9 * dt;

    // arah gerak dari analog / keyboard
    let ix = input.mx, iz = input.mz;
    if (!stick) {
      ix = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      iz = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
      const l = Math.hypot(ix, iz);
      if (l > 1) { ix /= l; iz /= l; }
    }
    if (stunT > 0) { ix = 0; iz = 0; }                                                   // pingsan: tidak bisa bergerak
    const mag = Math.min(1, Math.hypot(ix, iz));
    if (mag > 0) {                                      // arah gerak mengikuti sudut kamera
      const cs = Math.cos(camYaw), sn = Math.sin(camYaw);
      const rx = ix * cs + iz * sn, rz = -ix * sn + iz * cs;
      ix = rx; iz = rz;
    }

    // tenaga & lari
    const wantSprint = (input.sprint || keys.shift || sprintLatch) && mag > 0.2;
    if (player.stamina <= 0) player.exhausted = true;
    else if (player.stamina >= 25) player.exhausted = false;
    const sprinting = wantSprint && !player.exhausted && player.stamina > 0;
    if (swimming) { /* tenaga diatur di blok renang */ }
    else if (sprinting) player.stamina = Math.max(0, player.stamina - 28 * curChar.stam * dt);
    else player.stamina = Math.min(100, player.stamina + (mag > 0.2 ? 12 : 22) * dt);
    if (sprintLatch) { if (player.exhausted || player.stamina <= 0) setLatch(false); else if (mag <= 0.2) { sprintIdle += dt; if (sprintIdle > 0.7) setLatch(false); } else sprintIdle = 0; }

    const weak = player.hunger <= 0 || player.thirst <= 0;
    const speedMul = (powerLeft > 0 ? 1.25 : 1) * (weak ? 0.85 : 1) * curChar.speed * speedLv() * (1 + bmods().spd) * (slowT > 0 ? slowMul : 1);
    // berenang: air cukup dalam -> mode renang (lebih lambat, tanpa lompat, tenaga terkuras pelan)
    const depth = WL - (player.gnd !== undefined ? player.gnd : heightAt(player.x, player.z));
    const wasSwim = swimming;
    if (!swimming && depth > 1.0 && player.y < 0.3) swimming = true; else if (swimming && depth < 0.7) swimming = false;
    if (swimming !== wasSwim) {
      GameAudio.sfx.splash();
      starBurst(player.x, WL + 0.4, player.z, 8, 'water');
      spawnSwimRing(player.x, player.z, 1.6);
      if (swimming && swimToastCd <= 0) { toast(t('swim'), 2.4); swimToastCd = 25; }
    }
    swimToastCd -= dt;
    if (swimming) {
      const dash = wantSprint && player.stamina > 0;
      player.stamina = clamp(player.stamina + (mag > 0.2 ? (dash ? -16 : -3.5) : 6) * dt, 0, 100);
      const tired = player.stamina <= 0.5;
      const st = (dash ? 5.6 : 3.4) * (tired ? 0.55 : 1) * mag * speedMul;
      const sk = Math.min(1, dt * 6);
      player.vx += ((mag > 0 ? (ix / mag) * st : 0) - player.vx) * sk;
      player.vz += ((mag > 0 ? (iz / mag) * st : 0) - player.vz) * sk;
      player.x += player.vx * dt; player.z += player.vz * dt;
      player.y = 0; player.vy = 0; input.jump = false;
      strokeT -= dt; ringT -= dt;
      if (mag > 0.2 && strokeT <= 0) { strokeT = dash ? 0.38 : 0.6; GameAudio.sfx.swim(); starBurst(player.x, WL + 0.3, player.z, 2, 'water'); }
      if (ringT <= 0) { ringT = mag > 0.2 ? 0.45 : 0.9; spawnSwimRing(player.x, player.z, 1); }
    }
    let slopeMul = 1, slide = false;                    // tanjakan memperlambat, turunan sedikit mempercepat
    if (mag > 0.1) {
      const gx = ix / mag, gz = iz / mag;
      const dh = heightAt(player.x + gx, player.z + gz) - (player.gnd !== undefined ? player.gnd : heightAt(player.x, player.z));
      slopeMul = Math.min(1.25, Math.max(0.55, 1 - dh * 0.8));
      if (player.stamina >= 25) climbLocked = false;
      if (dh > 0.85 && !swimming) {                     // tebing curam: memanjat menguras tenaga; tenaga habis = terkunci diam (tanpa getar)
        slopeMul = 0.4;
        player.stamina = Math.max(0, player.stamina - 34 * dt);
        if (player.stamina <= 0.5) climbLocked = true;
        if (climbLocked) { slide = true; slopeMul = 0; }
        if (climbToastCd <= 0) { toast(t('climb'), 2); climbToastCd = 9; }
      }
    }
    climbToastCd -= dt;
    if (lastWet && !swimming) slopeMul *= 0.7;          // mengarungi air dangkal
    const target = (sprinting ? SPRINT : WALK) * mag * speedMul * slopeMul * (player.y > 0 ? (player.airBoost || 1) : 1);
    let tx = mag > 0 ? (ix / mag) * target : 0, tz = mag > 0 ? (iz / mag) * target : 0;
    if (slide) { tx = 0; tz = 0; }
    const k = Math.min(1, dt * 12);
    if (!swimming) {
      player.vx += (tx - player.vx) * k;
      player.vz += (tz - player.vz) * k;
      player.x += player.vx * dt;
      player.z += player.vz * dt;
    }
    pushOut(player, 0.55 * (scaleNow / 1.1));
    {                                                    // pijakan: tanah atau puncak batu; batu pijakan bisa diinjak
      const scp = scaleNow / 1.1;
      const prevG = player.gnd !== undefined ? player.gnd : heightAt(player.x, player.z);
      const Zp = zoneNear(player.x, player.z);
      if (Zp) {
        const f0 = prevG + player.y;
        for (const p of Zp.pillars) {                    // dari bawah/samping, batu pijakan adalah dinding
          const pdx = player.x - p.x, pdz = player.z - p.z, pd = Math.hypot(pdx, pdz) || 0.001, rr = p.r + 0.5 * scp;
          if (pd < rr && f0 < p.top - 0.45) { player.x = p.x + pdx / pd * rr; player.z = p.z + pdz / pd * rr; }
        }
      }
      const feet = prevG + player.y;
      const newG = swimming ? heightAt(player.x, player.z) : supportAt(player.x, player.z, feet);
      let ny;
      if (player.y === 0 && player.vy === 0 && !swimming && prevG - newG > 0.7) ny = prevG - newG;      // melewati tepi: mulai jatuh
      else if (player.y > 0 || player.vy !== 0) ny = feet - newG;                                       // di udara: tinggi dunia tetap
      else ny = 0;
      if (ny <= 0) { ny = 0; if (player.vy < 0) { player.vy = 0; puff(6, player.x, player.z, 0.5); GameAudio.sfx.land(); } }
      player.y = ny; player.gnd = newG;
      const Zf = zoneNear(player.x, player.z);
      if (Zf && player.gnd + player.y < Zf.floor + 3) respawnFromChasm(Zf);                                // jatuh ke jurang: tidak mati
    }

    const spd = Math.hypot(player.vx, player.vz);
    if (spd > 0.4 && player.atkT < 0 && !skillWind && !dashS) player.yaw = lerpAngle(player.yaw, faceYaw(player.vx, player.vz), Math.min(1, dt * 14));

    // lompat
    if (input.jump) {
      input.jump = false;
      if (player.y === 0 && player.vy === 0 && !swimming) {
        const runJump = sprinting && Math.hypot(player.vx, player.vz) > 8.2;        // lari lalu lompat = lompatan tinggi dan jauh
        player.vy = JUMP_V * (runJump ? 1.18 : 1.08);
        player.airBoost = runJump ? 1.35 : 1;
        if (runJump) player.stamina = Math.max(0, player.stamina - 8);
        GameAudio.sfx.jump();
      }
    }
    if (player.y > 0 || player.vy > 0) {
      player.vy -= GRAVITY * dt;
      player.y += player.vy * dt;
      if (player.y <= 0) { player.y = 0; player.vy = 0; puff(6, player.x, player.z, 0.5); GameAudio.sfx.land(); }
    }

    // gigit
    if (input.attack) { input.attack = false; startAttack(); }
    player.atkCd = Math.max(0, player.atkCd - dt);
    if (player.atkT >= 0) {
      player.atkT += dt;
      if (!player.atkHit && player.atkT >= 0.12) { player.atkHit = true; biteHit(); }
      if (player.atkT >= 0.35) player.atkT = -1;
    }

    // mode kuat
    if (powerLeft > 0) {
      powerLeft -= dt;
      if (powerLeft <= 0) { powerLeft = 0; GameAudio.sfx.powerEnd(); }
    }
    player.invuln = Math.max(0, player.invuln - dt);
    player.counterT = Math.max(0, player.counterT - dt);
    player.lastDmg += dt;

    // lapar, haus, nyawa
    player.hunger = Math.max(0, player.hunger - HUNGER_RATE * dt);
    player.thirst = Math.max(0, player.thirst - THIRST_RATE * curChar.thirst * dt);
    if (arenaOn) { /* arena: nyawa diatur server (lihat Arena.onHp) */ }
    else if (player.hunger <= 0 || player.thirst <= 0) {
      player.hp -= STARVE_DMG * dt;
      hurtT = Math.max(hurtT, 0.05);
      if (player.hp <= 0) { player.hp = 0; die(player.thirst <= 0 ? t('r_thirst') : t('r_hunger')); return; }
    } else if (player.lastDmg > 4 && player.hunger > 40 && player.thirst > 40 && player.hp < 100) {
      player.hp = Math.min(100, player.hp + (REGEN + bmods().reg) * dt);
    }

    // minum di kolam
    const wet = inPond(player.x, player.z);
    if (wet) {
      player.thirst = Math.min(100, player.thirst + WATER_RATE * dt);
      drinkCd -= dt;
      if (drinkCd <= 0 && player.thirst < 100) { drinkCd = 0.5; GameAudio.sfx.drink(); }
      if (!lastWet && player.thirst < 90) toast(t('drink'), 1.2);
    }
    lastWet = wet;

    // isi dunia: potongan, semak, koin, telur
    ensureChunks(false);
    pumpBuildQueue();
    updateZones(dt);
    const cx0 = Math.floor(player.x / CH), cz0 = Math.floor(player.z / CH);
    const sc = scaleNow / 1.1;
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const ch = chunks.get((cx0 + a) + ',' + (cz0 + b));
        if (!ch) continue;

        for (const bu of ch.bushes) {
          if (!bu.has) {
            const t0 = eatenAt.get(bu.id);
            if (t0 !== undefined && runTime - t0 > BUSH_REGROW) { bu.has = true; bu.berries.visible = true; eatenAt.delete(bu.id); }
            continue;
          }
          const dx = bu.x - player.x, dz = bu.z - player.z;
          if (dx * dx + dz * dz < (1.7 * sc) * (1.7 * sc) && player.hunger < 92) {
            bu.has = false;
            bu.berries.visible = false;
            eatenAt.set(bu.id, runTime);
            player.hunger = Math.min(100, player.hunger + FRUIT_HUNGER);
            GameAudio.sfx.eat();
            toast(t('fruit', { n: FRUIT_HUNGER }), 1.2);
            gainXp(2);
          }
        }

        for (let i = ch.coins.length - 1; i >= 0; i--) {
          const c = ch.coins[i];
          if (c.by === undefined) { c.by = c.mesh.position.y; c.ph = Math.random() * 6.28; }
          const bob = Math.sin(clock * 2.6 + c.ph) * 0.16;
          c.mesh.position.y = c.by + bob;                                  // melayang naik-turun
          c.mesh.rotation.y += dt * 3.2;                                   // berputar
          if (c.sh) { const q = 1 - bob * 0.9; c.sh.scale.set(q, 1, q); }
          if (Math.random() < dt * 0.1 && (c.x - player.x) ** 2 + (c.z - player.z) ** 2 < 300) starBurst(c.x, c.mesh.position.y + 0.3, c.z, 1, 'gain');   // kilau
          const dx = c.x - player.x, dz = c.z - player.z;
          if (dx * dx + dz * dz < (1.5 * sc) * (1.5 * sc) && player.y < 1.8) {
            taken.add(c.id);
            ch.group.remove(c.mesh);
            scene.add(c.mesh);                                   // koin terbang ke arah dino
            if (c.sh) ch.group.remove(c.sh);
            flyCoins.push({ mesh: c.mesh, t: 0, x0: c.x, y0: c.mesh.position.y, z0: c.z });
            ch.coins.splice(i, 1);
            runCoins++;
            save.coins++;
            burst(5, c.x, c.mesh.position.y - heightAt(c.x, c.z), c.z);
            showDmg(c.x, c.mesh.position.y + 0.5, c.z, '+1', 'gain', 0.9);
            coinStreak = Math.min(8, coinStreak + 1); coinStreakT = 1.2;
            GameAudio.sfx.coin();
          }
        }

        for (let i = ch.eggs.length - 1; i >= 0; i--) {
          const e = ch.eggs[i];
          e.mesh.rotation.y += dt * 2.5;
          e.mesh.position.y = e.by + Math.sin(clock * 4) * 0.12;
          e.ring.rotation.z += dt * 2;
          const dx = e.x - player.x, dz = e.z - player.z;
          if (dx * dx + dz * dz < (1.8 * sc) * (1.8 * sc)) {
            taken.add(e.id);
            ch.group.remove(e.mesh);
            ch.eggs.splice(i, 1);
            powerLeft = POWER_TIME;
            shake = Math.max(shake, 0.3);
            GameAudio.sfx.power();
            toast(t('power'), 2.4);
            gainXp(12);
          }
        }
      }
    }

    updatePredators(dt);

    // nama bioma saat memasuki wilayah baru
    biomeCd -= dt;
    if (biomeCd <= 0) {
      biomeCd = 0.6;
      const bi = biomeAt(player.x, player.z);
      if (lastBiome && lastBiome.id !== bi.id) toast('📍 ' + bi.name, 2.2);
      lastBiome = bi;
    }

    // debu saat berlari
    if (spd > 3 && player.y === 0 && Math.random() < dt * (sprinting ? 14 : 6)) puff(1, player.x, player.z, 0.3);

    // simpan koin berkala
    saveT += dt;
    if (saveT > 8) { saveT = 0; writeSave(); }

    updateHud();
  }

  // ---------- Hiasan hidup: pterosaurus di langit, kunang-kunang di malam hari ----------
  // sayap selaput: bentuk menyapu ke belakang, dengan tulang di tepi depan
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0.3);
  wingShape.lineTo(1.6, 0.16);
  wingShape.lineTo(1.5, -0.1);
  wingShape.lineTo(1.0, -0.3);
  wingShape.lineTo(0.55, -0.52);
  wingShape.lineTo(0, -0.4);
  wingShape.lineTo(0, 0.3);
  const wingGeo = new THREE.ShapeGeometry(wingShape);
  wingGeo.rotateX(-Math.PI / 2);
  const wingBoneGeo = new THREE.CylinderGeometry(0.03, 0.05, 1.6, 5);
  const flyHeadGeo = new THREE.ConeGeometry(0.14, 0.7, 5);
  const flyTailGeo = new THREE.ConeGeometry(0.06, 1, 4);
  const flyShadowGeo = new THREE.CircleGeometry(1, 14);
  const flyShadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false });
  // lima jenis pterosaurus; semuanya menghadap -Z
  const FLY_SPECS = [
    { id: 'pteranodon', name: 'Pteranodon', body: 0xa1887f, wing: 0xd7b98e, sc: 1.2, span: 1.3, crest: 1.0, beak: 1.0, tail: 0, head: 1, r: 26, h: 15, w: 0.22, flap: 3.2 },
    { id: 'quetzal', name: 'Quetzalcoatlus', body: 0x8d8d7a, wing: 0xc9c3a8, sc: 2.5, span: 1.5, crest: 0.4, beak: 1.8, tail: 0, head: 1, r: 40, h: 27, w: 0.1, flap: 1.8 },
    { id: 'dimorph', name: 'Dimorphodon', body: 0x6a8f5a, wing: 0x9cc58a, sc: 0.65, span: 0.8, crest: 0, beak: 0.6, tail: 1.6, head: 1.8, r: 18, h: 8, w: 0.36, flap: 8 },
    { id: 'rhampho', name: 'Rhamphorhynchus', body: 0x7e5a8c, wing: 0xb89ac4, sc: 0.75, span: 0.95, crest: 0, beak: 0.8, tail: 2.2, vane: true, head: 1.1, r: 22, h: 11, w: 0.3, flap: 6.5 },
    { id: 'ptero', name: 'Pterodactylus', body: 0xc77d4a, wing: 0xefb98a, sc: 0.85, span: 1.0, crest: 0.25, beak: 1.2, tail: 0.25, head: 1, r: 31, h: 10, w: 0.27, flap: 5 }
  ];
  const flyers = [];
  FLY_SPECS.forEach((sp, i) => {
    const g = new THREE.Group();
    const inner = new THREE.Group();                         // skala jenis ini, supaya putaran grup luar tidak ikut berubah
    inner.scale.setScalar(sp.sc);
    g.add(inner);
    const mB = std(sp.body), mW = std(sp.wing, { side: THREE.DoubleSide });
    const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); inner.add(mesh); return mesh; };
    const bd = add(new THREE.Mesh(sphereGeo, mB), 0, 0, 0);
    bd.scale.set(0.35, 0.3, 0.9);
    const hd = add(new THREE.Mesh(flyHeadGeo, mB), 0, 0.05, -1.0);
    hd.rotation.x = -1.57;
    hd.scale.set(sp.head, sp.beak, sp.head);
    if (sp.crest > 0) {                                      // jambul di belakang kepala
      const cr = add(new THREE.Mesh(flyHeadGeo, mW), 0, 0.2, -0.75 + 0.35 * sp.crest);
      cr.rotation.x = 1.9; cr.scale.set(0.5, sp.crest * 1.1, 0.5);
    }
    if (sp.tail > 0) {                                       // ekor panjang
      const tl = add(new THREE.Mesh(flyTailGeo, mB), 0, 0, 0.9 + sp.tail * 0.5);
      tl.rotation.x = Math.PI / 2; tl.scale.set(1, sp.tail, 1);
      if (sp.vane) {                                         // ujung ekor berbentuk daun
        const vn = add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.34), mW), 0, 0, 0.95 + sp.tail);
        vn.rotation.y = Math.PI / 4;
      }
    }
    const wl = new THREE.Group(); wl.position.set(-0.25, 0.05, 0); inner.add(wl);
    const wr = new THREE.Group(); wr.position.set(0.25, 0.05, 0); inner.add(wr);
    const wml = new THREE.Mesh(wingGeo, mW); wml.scale.set(-sp.span, 1, 1); wl.add(wml);
    const wmr = new THREE.Mesh(wingGeo, mW); wmr.scale.set(sp.span, 1, 1); wr.add(wmr);
    for (const [grp, sg] of [[wl, -1], [wr, 1]]) {
      const bn = new THREE.Mesh(wingBoneGeo, mB);
      bn.rotation.z = Math.PI / 2;
      bn.scale.y = sp.span;
      bn.position.set(sg * 0.8 * sp.span, 0, -0.2);
      grp.add(bn);
    }
    scene.add(g);
    const sh = new THREE.Mesh(flyShadowGeo, flyShadowMat);
    sh.rotation.x = -Math.PI / 2;
    sh.scale.set(sp.sc * 1.4 * sp.span, sp.sc * 1.4 * sp.span, 1);
    scene.add(sh);
    flyers.push({ g, wl, wr, sh, sp, a: i * 1.26, r: sp.r, h: sp.h, w: sp.w * (i % 2 ? -1 : 1), ph: i });
  });

  const flyGeo = new THREE.SphereGeometry(0.09, 5, 4);
  const flyMat = new THREE.MeshBasicMaterial({ color: 0xd9ff5a });
  const flies = [];
  for (let i = 0; i < 14; i++) {
    const mesh = new THREE.Mesh(flyGeo, flyMat);
    mesh.visible = false;
    scene.add(mesh);
    flies.push({ mesh, bx: Math.random() * 48, bz: Math.random() * 48, by: rand(0.6, 2.4), ph: Math.random() * 6 });
  }

  let waterT = 0;
  function updateWater(dt) {
    waterT += dt;
    mPond.opacity = 0.9 + Math.sin(waterT * 1.6) * 0.04;
    if (waveTex) { waveTex.offset.x = (waterT * 0.035) % 1; waveTex.offset.y = Math.sin(waterT * 0.4) * 0.03; }      // aliran pelan
    if (glintTex) { glintTex.offset.x = (-waterT * 0.05) % 1; glintTex.offset.y = (waterT * 0.03) % 1; }
    for (const ch of chunks.values()) {
      for (const rp of ch.ripples) {
        const f = (waterT * 0.28 + rp.ph) % 1;
        const sc = 0.15 + f * rp.r;
        rp.mesh.scale.set(sc, sc, 1);
        rp.mesh.material === mRipple && (mRipple.opacity = 0.35);
      }
    }
  }
  function updateAmbient(dt) {
    for (const f of flyers) {
      f.a += f.w * dt;
      f.g.position.set(player.x + Math.cos(f.a) * f.r, (player.gy || 0) + f.h + Math.sin(clock * 0.8 + f.ph) * 1.2, player.z + Math.sin(f.a) * f.r);
      const dirx = -Math.sin(f.a) * Math.sign(f.w), dirz = Math.cos(f.a) * Math.sign(f.w);
      f.g.rotation.y = faceYaw(dirx, dirz);                            // menghadap arah terbang
      f.g.rotation.z = 0.18 * Math.sign(f.w);
      const fl = Math.sin(clock * f.sp.flap + f.ph) * 0.6;
      f.wl.rotation.z = -fl;
      f.wr.rotation.z = fl;
      f.g.visible = !isNight;
      const fx = player.x + Math.cos(f.a) * f.r, fz = player.z + Math.sin(f.a) * f.r;
      f.sh.visible = !isNight;
      f.sh.position.set(fx, heightAt(fx, fz) + 0.12, fz);
    }
    for (const f of flies) {
      f.mesh.visible = isNight;
      if (!isNight) continue;
      const x = player.x + ((((f.bx - player.x) % 48) + 48) % 48) - 24;      // tersebar tetap di dunia, bukan ikut pemain
      const z = player.z + ((((f.bz - player.z) % 48) + 48) % 48) - 24;
      f.mesh.position.set(x + Math.sin(clock * 0.9 + f.ph) * 0.8, heightAt(x, z) + f.by + Math.sin(clock * 1.7 + f.ph * 2) * 0.35, z + Math.cos(clock * 0.7 + f.ph) * 0.8);
      f.mesh.scale.setScalar(0.7 + 0.5 * Math.abs(Math.sin(clock * 3 + f.ph)));
    }
  }

  // ---------- Animasi, kamera, render ----------
  function animate(dt) {
    animDt = dt;
    scaleNow += (baseScale() * (powerLeft > 0 ? 1.5 : 1) - scaleNow) * Math.min(1, dt * 5);
    hero.root.scale.setScalar(scaleNow);
    if (gear) { if (gear.orb) gear.orb.rotation.y += dt * 1.8; gearPop = Math.max(0, gearPop - dt * 1.5); gear.gb.scale.setScalar(1 + 0.3 * gearPop * gearPop); }

    let glow = 0;
    if (powerLeft > 0) glow = powerLeft < 2.5 ? 0.25 + 0.25 * Math.sin(clock * 28) : 0.35 + 0.15 * Math.sin(clock * 8);
    else if (player.invuln > 0) glow = 0.45 * Math.sin(clock * 50) > 0 ? 0.4 : 0;
    setGlow(hero, glow, player.invuln > 0 && powerLeft <= 0 ? 0xff0000 : 0xff5a00);

    const spd = Math.hypot(player.vx, player.vz);
    phase += (spd * 1.5 + 1.2) * dt * (spd > 0.4 ? 1 : 0.3);
    const run = clamp(spd / 6, 0, 1.3);
    const air = player.y > 0.001;
    {                                                     // langkah kaki pemain: jalan lebih ringan, lari lebih berat
      const si = Math.floor(phase / Math.PI);
      if (si !== lastStepIdx) {
        lastStepIdx = si;
        if (state === 'playing' && !air && swimBlend < 0.3 && spd > 0.8) GameAudio.sfx.foot(spd > WALK * 1.25 ? 'run' : 'walk', 0.9, 0, scaleNow, lastWet);
      }
    }
    swimBlend = approach(swimBlend, swimming ? 1 : 0, 6);
    const groundY = player.gnd !== undefined ? player.gnd : heightAt(player.x, player.z);
    const onPlat = groundY - heightAt(player.x, player.z) > 0.6;
    const gy = swimBlend > 0.01 ? lerp(groundY, WL - 0.78 * (scaleNow / 1.1) + Math.sin(clock * 2.4) * 0.06, swimBlend) : groundY;
    player.gy = gy;
    hero.root.position.set(player.x, gy + player.y, player.z);
    updateMyTag();
    if (state === 'over') {
      hero.root.rotation.z += (1.4 - hero.root.rotation.z) * Math.min(1, dt * 7);
      hero.root.position.y = gy + 0.15;
    } else {
      hero.root.rotation.z = 0;
      hero.root.rotation.y = player.yaw;
      poseCreature(hero, phase, run, air, player.vy, player.atkT >= 0 ? clamp(player.atkT / 0.35, 0, 1) : -1, clock, skAnim ? { id: skAnim.id, p: skAnim.t / skAnim.dur } : null);
      if (swimBlend > 0.01) applySwim(hero, swimBlend, spd, clock);
      tiltToGround(hero.root, player.x, player.z, player.yaw, 0.9 * scaleNow / 1.1, dt, swimBlend > 0.3 || lastWet || air || onPlat);
      if (myEmote.e >= 0 && arenaOn) { const o = emoteOff(myEmote.e, myEmote.t); if (o) { hero.root.position.y += o.dy * scaleNow / 1.1; hero.root.rotation.y += o.dyaw; } }
    }
    const s = Math.max(0.5, 1 - player.y / 3.2);
    heroShadow.visible = swimBlend < 0.5;
    shadowFlat = onPlat ? gy : null;
    placeShadow(heroShadow, player.x, player.z, gy, 0.75 * scaleNow * s, 1.9 * scaleNow);
    shadowFlat = null;

    for (const p of preds) {
      const c = p.c;
      const pgyG = heightAt(p.x, p.z);
      const deepP = WL - pgyG > 0.9;
      const pgy = deepP ? WL - 0.7 * p.def.scale : pgyG;
      c.root.position.set(p.x, pgy, p.z);
      if (p.sh) {
        const big = p.def.giant ? 1.6 : p.def.model ? 1.15 : 0.8;
        p.sh.visible = !p.dead || p.deadT < 0.8;
        placeShadow(p.sh, p.x, p.z, pgy, big * p.def.scale, (p.def.giant ? 3.2 : 1.6) * p.def.scale);
      }
      if (p.warn) updateWarn(p, pgy);
      if (p.dead) {
        c.root.rotation.z += (1.5 - c.root.rotation.z) * Math.min(1, dt * 6);
        c.root.position.y = pgy + Math.max(-1.5, -0.6 * Math.max(0, p.deadT - 0.8));
        continue;
      }
      c.root.rotation.y = p.yaw;
      p.phase += (p.speedNow * 1.5 + 0.8) * dt;
      {
        const si = Math.floor(p.phase / Math.PI);
        if (si !== p.stepIdx) {
          p.stepIdx = si;
          if (state === 'playing' && p.speedNow > 0.8 && !deepP) {
            const fdx = p.x - player.x, fdz = p.z - player.z, fd = Math.hypot(fdx, fdz);
            const fr = p.def.giant ? 60 : 38, fv = clamp(1 - fd / fr, 0, 1) * (p.def.giant ? 1.3 : 0.8);
            if (fv > 0.05) GameAudio.sfx.foot(p.speedNow > 7 ? 'run' : 'walk', fv, fd > 3 ? clamp(((fdx * Math.cos(camYaw) - fdz * Math.sin(camYaw)) / fd) * 0.9, -0.9, 0.9) : 0, p.def.scale, false);
          }
        }
      }
      let atk = -1;
      const wp = p.state === 'windup' ? clamp(1 - p.t / p.t0, 0, 1) : 0;
      if (p.state === 'strike') atk = clamp(p.st / p.dur, 0, 1);                      // menerkam: kepala menyodok, rahang membuka
      else if (p.state === 'recover') atk = Math.max(0, 1 - (p.t0b || 0));
      const run = p.state === 'strike' ? 1.3 : clamp(p.speedNow / 6, 0, 1.3);
      if (c.isTrike) poseTrike(c, p.phase, run, p.state === 'strike' ? atk : -1, clock);
      else poseCreature(c, p.phase, run, false, 0, p.state === 'strike' ? atk : -1, clock);
      p.swimB = approach(p.swimB || 0, deepP ? 1 : 0, 6);
      if (!c.isTrike && p.swimB > 0.01 && c.legs) applySwim(c, p.swimB, 4, clock);
      tiltToGround(c.root, p.x, p.z, p.yaw, 0.9 * p.def.scale, dt, deepP || p.state === 'stun' && false);
      if (wp > 0) {                                                                    // bersiap: menunduk dan menarik badan ke belakang
        if (c.isTrike) { c.headPivot.rotation.x = 0.5 * wp; c.body.rotation.x = 0.1 * wp; }
        else { c.body.rotation.x = 0.28 * wp; c.body.position.y -= 0.18 * wp; c.headPivot.rotation.x = -0.35 * wp; }
        c.root.scale.setScalar(p.def.scale * (1 + 0.07 * Math.sin(wp * Math.PI * 4)));
      } else if (p.state === 'stun') {
        c.body.rotation.z = Math.sin(clock * 22) * 0.07;                              // terhuyung
        c.root.scale.setScalar(p.def.scale);
      } else c.root.scale.setScalar(p.def.scale);
      setGlow(c, p.flash * 0.8 + (p.enraged ? 0.18 + 0.1 * Math.sin(clock * 10) : 0), p.enraged ? 0xff3b30 : 0xffffff);
    }

    stepPool(dust, dt, 0);
    stepPool(sparks, dt, 9);
    updateAmbient(dt);
    updateWater(dt);
  }

  function updateCamera(dt) {
    // kamera mengikuti dari belakang-atas, sedikit melihat ke arah gerak
    const k = Math.min(1, dt * 5);
    camLead.x += (player.vx * 0.35 - camLead.x) * k;
    camLead.z += (player.vz * 0.35 - camLead.z) * k;
    // kamera otomatis melebar & bergeser agar skill (milik sendiri / lawan di sekitar) terlihat penuh
    let zt = 1, bx = 0, bz = 0;
    if (arenaOn && state === 'playing') {
      if (aim.on || skAnim) zt = 1.32;
      let best = 1e9;
      for (const [id, v] of remoteViews) {
        if (!v.skA) continue;
        const r = Arena.remotes.get(id); if (!r) continue;
        const d = Math.hypot(r.x - player.x, r.z - player.z);
        if (d < 40) { zt = Math.max(zt, 1.2 + Math.min(0.55, d / 26)); if (d < best) { best = d; bx = (r.x - player.x) * 0.3; bz = (r.z - player.z) * 0.3; } }
      }
    }
    camZoom += (zt - camZoom) * Math.min(1, dt * (zt > camZoom ? 4 : 1.1));
    camBx += (bx - camBx) * Math.min(1, dt * 3); camBz += (bz - camBz) * Math.min(1, dt * 3);
    const tx = player.x + camLead.x * 0.6 + camBx, tz = player.z + camLead.z * 0.6 + camBz;
    camX += (tx - camX) * Math.min(1, dt * 8);
    camZ += (tz - camZ) * Math.min(1, dt * 8);
    const grow = Math.max(0.9, scaleNow / 1.1);
    let sx = 0, sy = 0;
    if (shake > 0) {
      sx = (Math.random() - 0.5) * shake * 0.5;
      sy = (Math.random() - 0.5) * shake * 0.5;
      shake = Math.max(0, shake - dt * 2.5);
    }
    // kamera mengikuti tinggi dino sebenarnya (termasuk saat melompat / jatuh), bukan hanya tinggi tanah
    const fy = (player.gy || 0) + (player.y || 0);
    camGy += (fy - camGy) * Math.min(1, dt * ((player.y > 0.05 || player.vy) ? 10 : 4));
    if (state === 'menu') { camYaw = clock * 0.45; camPitch = 0.5; }     // menu: kamera memutari dino pilihan
    const R = 12.6 * grow * camZoom, ce = Math.cos(camPitch), se = Math.sin(camPitch);
    const sy0 = Math.sin(camYaw), cy0 = Math.cos(camYaw);
    const tgx = camX - 1.2 * sy0, tgz = camZ - 1.2 * cy0, tgy = camGy + 0.9;     // titik yang dilihat
    let cxp = camX + R * ce * sy0, czp = camZ + R * ce * cy0, cyp = camGy + R * se;
    // jangan sampai bukit menutupi pandangan atau kamera masuk ke tanah
    let need = Math.max(0, heightAt(cxp, czp) + 2.5 - cyp);
    for (const f of [0.3, 0.55, 0.8]) {
      const px = tgx + (cxp - tgx) * f, pz = tgz + (czp - tgz) * f, py = tgy + (cyp - tgy) * f;
      need = Math.max(need, (heightAt(px, pz) + 1.0 - py) / f);
    }
    camLift += (need - camLift) * Math.min(1, dt * (need > camLift ? 10 : 3));
    camera.position.set(cxp + sx, cyp + camLift + sy, czp);
    camera.lookAt(tgx, tgy, tgz);
  }


  // ---------- Suasana hidup tambahan: serbuk sari / daun halus yang jatuh di siang hari (pterosaurus & kunang-kunang sudah ada di atas) ----------
  const bf = { m: null, t: 0, cd: 45, a: 0, x: 0, z: 0, ph: 0 };
  { const wm = new THREE.MeshBasicMaterial({ color: 0xffd54f, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0.12, 0.5, 0.05, 0.2, 0, 0, -0.12, 0.5, 0.05, -0.2]), 3)); wg.setIndex([0, 1, 2, 2, 1, 3]);
    const g = new THREE.Group(), l = new THREE.Mesh(wg, wm), r = new THREE.Mesh(wg, wm); r.scale.x = -1; g.add(l, r);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0xffe082, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending })); glow.scale.set(1.8, 1.8, 1); g.add(glow);
    g.visible = false; scene.add(g); bf.m = g; bf.l = l; bf.r = r; }
  const sstar = { m: new THREE.Mesh(new THREE.PlaneGeometry(9, 0.14), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })), t: -1, cd: 20, x: 0, y: 0, z: 0, dx: 0, dz: 0 };
  sstar.m.visible = false; scene.add(sstar.m);
  function updateSurprise(dt) {
    if (state !== 'playing') { bf.m.visible = false; bf.t = 0; sstar.m.visible = false; sstar.t = -1; combo.n = 0; return; }
    if (combo.t > 0) { combo.t -= dt; if (combo.t <= 0) combo.n = 0; }
    // kupu-kupu emas: muncul tiap 1-2 menit di siang hari, kejar & sentuh untuk hadiah
    if (bf.t <= 0) {
      bf.cd -= dt;
      if (bf.cd <= 0 && !isNight && !swimming) { bf.cd = 60 + Math.random() * 60; bf.t = 28; bf.a = Math.random() * 6.283; bf.x = player.x + Math.cos(bf.a) * 14; bf.z = player.z + Math.sin(bf.a) * 14; bf.ph = Math.random() * 6; toast(t('bf_spawn'), 3.2); }
    } else {
      bf.t -= dt; bf.ph += dt;
      const fl = Math.hypot(bf.x - player.x, bf.z - player.z) < 7 ? 1 : 0;
      bf.a += dt * (0.9 + Math.sin(bf.ph * 1.7) * 0.6) + (fl ? Math.sin(bf.ph * 3) * dt : 0);
      const sp = fl ? 5.5 : 2.2; bf.x += Math.cos(bf.a) * sp * dt; bf.z += Math.sin(bf.a) * sp * dt;
      if (Math.hypot(bf.x - player.x, bf.z - player.z) > 34) { bf.x = player.x + Math.cos(bf.a + 3) * 16; bf.z = player.z + Math.sin(bf.a + 3) * 16; }
      const y = heightAt(bf.x, bf.z) + 1.6 + Math.sin(bf.ph * 3) * 0.5;
      bf.m.visible = true; bf.m.position.set(bf.x, y, bf.z); bf.m.rotation.y = -bf.a;
      const f = Math.sin(bf.ph * 22) * 0.9; bf.l.rotation.z = f; bf.r.rotation.z = -f;
      bf.m.scale.setScalar(bf.t < 3 ? Math.max(0.1, bf.t / 3) : 1);
      if (Math.random() < dt * 12) emit(FX.small, bf.x, y, bf.z, (Math.random() - 0.5) * 0.5, -0.2, (Math.random() - 0.5) * 0.5, 0.9, 1, 0.85, 0.3, 0, 0.5, false);
      if (Math.hypot(bf.x - player.x, bf.z - player.z) < 2.2 && Math.abs(y - ((player.gy || 0) + player.y + 1)) < 3) {
        bf.t = 0; bf.m.visible = false; const n = 6 + player.level * 2;
        if (arenaOn) toast(t('bf_got0'), 2.4); else { runCoins += n; addC(n); toast(t('bf_got', { n }), 2.6); }
        starBurst(player.x, (player.gy || 0) + player.y + 1.6 * scaleNow / 1.1, player.z, 16, 'gain'); ringWave(player.x, player.z, 0.6, 5, 0.7, 1, 0.9, 0.3);
        try { GameAudio.sfx.power(); } catch (e) { /* abaikan */ }
      }
      if (bf.t <= 0) bf.m.visible = false;
    }
    // bintang jatuh di langit malam
    if (sstar.t < 0) {
      if (isNight) { sstar.cd -= dt; if (sstar.cd <= 0) { sstar.cd = 25 + Math.random() * 30; sstar.t = 0; const a = Math.random() * 6.283; sstar.x = player.x + Math.cos(a) * 70; sstar.z = player.z + Math.sin(a) * 70; sstar.y = 55 + Math.random() * 20; const b = a + 1.57 + (Math.random() - 0.5); sstar.dx = Math.cos(b) * 60; sstar.dz = Math.sin(b) * 60; } }
    } else {
      sstar.t += dt; const k = sstar.t / 1.3;
      if (k >= 1) { sstar.t = -1; sstar.m.visible = false; }
      else { sstar.m.visible = true; sstar.m.position.set(sstar.x + sstar.dx * k, sstar.y - 25 * k, sstar.z + sstar.dz * k); sstar.m.lookAt(camera.position); sstar.m.rotation.z = Math.atan2(-25, Math.hypot(sstar.dx, sstar.dz)) * 0.3; sstar.m.material.opacity = Math.sin(k * Math.PI) * 0.9; }
    }
  }
  let ambAcc2 = 0;
  function updateDrift(dt) {
    if (state !== 'playing' || isNight) return;
    const gy = player.gy || 0;
    ambAcc2 += dt * 2.5;
    while (ambAcc2 >= 1) { ambAcc2 -= 1; const a = Math.random() * 6.283, d = 2 + Math.random() * 15, x = player.x + Math.cos(a) * d, z = player.z + Math.sin(a) * d;
      emit(FX.small, x, gy + 5 + Math.random() * 4, z, 0.6 + Math.random() * 0.5, -0.7 - Math.random() * 0.4, (Math.random() - 0.5) * 0.6, 7, 0.55, 0.75, 0.3, 0, 0.1, false); }
  }
  // ---------- Loop utama ----------
  const isPortrait = () => window.innerHeight > window.innerWidth * 1.05;
  let last = performance.now();
  function frame(now) {
    const paused = bagOpen && state === 'playing';                 // tas dibuka saat bermain = game dijeda
    const dt0 = paused ? 0.0001 : Math.min(0.05, Math.max(0, (now - last) / 1000));
    const dt = hitStop > 0 ? dt0 * 0.12 : dt0; hitStop = Math.max(0, hitStop - dt0);       // hit-stop: dunia melambat sesaat saat pukulan telak
    last = now;
    clock += dt;

    if (state === 'playing' && !isPortrait() && !paused) update(dt);
    if (state !== 'playing') { try { GameAudio.nightAmbience(false); } catch (e) { /* abaikan */ } }
    else if (state === 'menu') { player.yaw = Math.sin(clock * 0.5) * 0.6 + Math.PI; }
    animate(dt);
    updateRemotes(dt);
    updateRemoteRings(dt);
    updateSlashes(dt); updateRingFx(dt); updateBubbles(dt); updateTele(dt); updateSkill(dt); updateFx(dt); updateBolts(dt); updateDrift(dt); updateSurprise(dt); updateRain(dt); updateBiteRing(dt);
    updateOnline(dt);
    if (arenaOn && state === 'playing') Arena.send({ x: player.x, z: player.z, y: hero.root.position.y, yaw: player.yaw, vx: player.vx, vz: player.vz, atk: player.atkT, sw: swimming }, now);
    updateCamera(dt);
    updateDmg(dt);
    updateStars(dt);
    updateBars();
    updateRoar(dt);
    updateDanger(dt);
    updateHorde(dt);
    updateSwimRings(dt);
    updateMinimap(dt);
    updateFlyCoins(dt);
    mCoin.emissiveIntensity = 0.85 + 0.45 * Math.sin(clock * 3.2);         // koin berkilau berdenyut
    updateDrops(dt);
    if (lowSpilled && player.hp > 45) lowSpilled = false;       // pulih -> kantong yang baru bisa tumpah semua lagi

    if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.classList.remove('show'); }
    if (hurtT > 0) { hurtT -= dt; hurtEl.classList.add('on'); } else hurtEl.classList.remove('on');

    if (dexEl.classList.contains('on')) renderDexStage(dt); else renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // tampilan latar menu: dunia awal terlihat di belakang judul
  worldSeed = 1 + Math.floor(Math.random() * 1e6);
  pondCache.clear(); zoneReset();
  ensureChunks(true);
  applyDayNight();
  dexInit = true;
  initShop();
  refreshPanels();
  requestAnimationFrame(frame);

  // Akses untuk tahap berikutnya (wallet / backend)
  window.VosilSurvival = { getSave: () => ({ ...save }) };
})();
