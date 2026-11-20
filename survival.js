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

  function showFatal(msg) {
    const box = $('fatal'), txt = $('fatalMsg');
    if (txt) txt.textContent = msg;
    if (box) box.style.display = 'flex';
  }

  if (typeof THREE === 'undefined') {
    showFatal('Three.js gagal dimuat. Pastikan internet aktif, atau unduh three.min.js (versi r128) dan taruh di folder yang sama dengan survival.html.');
    return;
  }

  // ---------- Pengaturan ----------
  const CH = 30;                    // ukuran satu potongan dunia (meter)
  const VIEW = 2;                   // radius potongan yang dimuat (5 x 5 potongan)
  const DAY_LEN = 160;              // detik per hari
  const WALK = 5.5, SPRINT = 9.5;   // kecepatan (m/detik)
  const JUMP_V = 8.5, GRAVITY = 24;
  const HUNGER_RATE = 0.35;         // turun per detik (habis dalam ~4,7 menit)
  const THIRST_RATE = 0.5;          // turun per detik (habis dalam ~3,3 menit)
  const STARVE_DMG = 2.2;           // nyawa berkurang per detik jika lapar/haus habis
  const REGEN = 1.6;                // nyawa pulih per detik jika kenyang & tidak diserang
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
  const camZone = $('camZone'), charRow = $('charRow'), charInfo = $('charInfo');
  const stickZone = $('stickZone'), stickBase = $('stickBase'), stickKnob = $('stickKnob');
  const btnAttack = $('btnAttack'), btnJump = $('btnJump'), btnSprint = $('btnSprint'), fsBtn = $('fsBtn'), btnRoar = $('btnRoar');

  // ---------- Penyimpanan lokal ----------
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && typeof s.coins === 'number') return Object.assign({ bestDays: 0, kills: 0, runs: 0, seen: {}, char: 'vosil', q: 'mid' }, s);
    } catch (e) { /* abaikan */ }
    return { coins: 0, bestDays: 0, kills: 0, runs: 0, seen: {}, char: 'vosil', q: 'mid' };
  }
  const save = loadSave();
  if (!save.seen || typeof save.seen !== 'object') save.seen = {};
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
      showFatal('WebGL tidak bisa dijalankan di browser ini. Buka lewat Chrome atau Safari langsung (bukan dari dalam WhatsApp/Instagram/Telegram), matikan mode hemat baterai, lalu buka webgl-test.html untuk diagnosis.');
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
    plain: { id: 'plain', name: 'Padang Rumput', color: 0x7bbf52, patch: 0x6dae47, tree: 1, cycad: 0.5, rock: 1, bush: 1.1, pond: 0.2, cactus: 0, coin: 1.1 },
    forest: { id: 'forest', name: 'Hutan Lebat', color: 0x4a9440, patch: 0x3e8537, tree: 4, cycad: 1.2, rock: 0.8, bush: 1.3, pond: 0.3, cactus: 0, coin: 1.0 },
    desert: { id: 'desert', name: 'Gurun Berbatu', color: 0xd9b46a, patch: 0xc9a25a, tree: 0, cycad: 0, rock: 3, bush: 0.35, pond: 0.08, cactus: 2.2, coin: 1.7 },
    swamp: { id: 'swamp', name: 'Rawa Berkabut', color: 0x5d7a3a, patch: 0x516b32, tree: 2, cycad: 2, rock: 0.8, bush: 0.9, pond: 0.55, cactus: 0, coin: 1.4 }
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
    pondCache.set(key, p);
    return p;
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
  const mShadow = new THREE.MeshBasicMaterial({ color: 0x0a1a12, transparent: true, opacity: 0.5, depthWrite: false });
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
    low: { pr: 1, ol: false, fx: 0.5, name: 'Rendah' },
    mid: { pr: 1.25, ol: true, fx: 1, name: 'Sedang' },
    high: { pr: 1.75, ol: true, fx: 1.6, name: 'Tinggi' },
  };
  let fxMul = 1;
  function applyQuality() {
    const q = QUAL[save.q] || QUAL.mid;
    fxMul = q.fx;
    mOutline.visible = q.ol;
    try { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr)); resize(); } catch (e) { /* abaikan */ }
  }
  // bayangan dinamis (dino): elips yang memanjang searah bayangan, ditaruh di tanah
  function placeShadow(mesh, x, z, gy, r, h) {
    const L = h * 0.35;
    mesh.position.set(x + SUN_DX * L, gy + 0.1, z + SUN_DZ * L);
    mesh.rotation.set(-Math.PI / 2, 0, SUN_PHI);
    mesh.scale.set(r + L, r, 1);
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
  const taken = new Set();            // koin & telur yang sudah diambil (dalam satu permainan)
  const eatenAt = new Map();          // semak yang buahnya sudah dimakan -> waktu dimakan

  function genChunk(cx, cz) {
    const key = cx + ',' + cz;
    const rng = mulberry(hash(cx, cz, worldSeed + 99));
    const R = (a, b) => a + rng() * (b - a);
    const cnt = (base) => Math.floor(base + rng());
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

    for (let i = 0, n = cnt(biome.tree); i < n; i++) {
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
    for (let i = 0, n = cnt(biome.cycad); i < n; i++) {
      const pos = tryPlace(1.2); if (!pos) continue;
      const s = R(0.9, 1.5), t = makeCycad(s);
      t.position.set(pos.x, heightAt(pos.x, pos.z), pos.z);
      group.add(t);
      ch.colliders.push({ x: pos.x, z: pos.z, r: 0.45 * s });
      sh(pos.x, pos.z, 0.8 * s, 1.2 * s);
    }
    for (let i = 0, n = cnt(biome.cactus); i < n; i++) {
      const pos = tryPlace(1.2); if (!pos) continue;
      const s = R(0.9, 1.5), t = makeCactus(s);
      t.position.set(pos.x, heightAt(pos.x, pos.z), pos.z);
      group.add(t);
      ch.colliders.push({ x: pos.x, z: pos.z, r: 0.5 * s });
      sh(pos.x, pos.z, 0.35 * s, 2.0 * s);
    }
    for (let i = 0, n = cnt(biome.rock); i < n; i++) {
      const pos = tryPlace(1.3); if (!pos) continue;
      const s = R(0.8, 1.7), t = makeRock(s, biome.id === 'desert');
      t.position.set(pos.x, heightAt(pos.x, pos.z), pos.z);
      group.add(t);
      ch.colliders.push({ x: pos.x, z: pos.z, r: 0.85 * s });
      sh(pos.x, pos.z, 0.75 * s, 0.9 * s);
    }

    // semak buah
    const bushN = home ? Math.max(2, cnt(biome.bush)) : cnt(biome.bush);
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
    for (let i = 0, n = cnt(biome.id === 'desert' ? 1 : 2.2); i < n; i++) {
      const pos = tryPlace(0.6); if (!pos) continue;
      const s = R(0.8, 1.6), tf = new THREE.Mesh(tuftGeo, mTuft[biome.id]);
      tf.position.set(pos.x, heightAt(pos.x, pos.z) + 0.4 * s, pos.z);
      tf.scale.set(s * 1.4, s, s * 1.4);
      group.add(tf);
    }

    // gugusan koin
    let ck = 0;
    for (let i = 0, n = cnt(biome.coin); i < n; i++) {
      const pos = tryPlace(4.2); if (!pos) continue;          // ruang cukup supaya koin tidak menempel pohon / batu
      const count = 3 + Math.floor(rng() * 4);
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
        ch.coins.push({ id, x, z, mesh: m });
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
    pondCache.clear();
    for (const f of flyCoins) scene.remove(f.mesh);
    flyCoins.length = 0;
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
    const ball = (r, mat, sx, sy, sz, x, y, z, parent) => {
      const m = part(new THREE.SphereGeometry(r, 14, 10), mat, x, y, z, parent);
      m.scale.set(sx, sy, sz);
      return m;
    };

    // badan: dada, perut, dan pinggul yang menyatu
    ball(0.62, green, 0.85, 0.8, 1.25, 0, 1.15, 0);
    ball(0.46, green, 0.9, 0.9, 1.0, 0, 1.28, -0.48);
    ball(0.52, green, 0.95, 0.85, 1.0, 0, 1.1, 0.42);
    ball(0.55, light, 0.8, 0.6, 1.15, 0, 0.98, -0.05);

    for (let i = 0; i < 6; i++) {
      const z = -0.6 + i * 0.26, h = 0.42 - i * 0.04;
      const topY = 1.15 + 0.496 * Math.sqrt(Math.max(0, 1 - (z / 0.775) * (z / 0.775)));
      part(new THREE.ConeGeometry(0.14, h, 6), spikeM, 0, topY + h / 2 - 0.04, z);
    }

    // leher
    ball(0.3, green, 1, 1, 1, 0, 1.42, -0.68);
    ball(0.26, green, 1, 1, 1, 0, 1.55, -0.8);

    // kepala: tengkorak, moncong, rahang bawah yang bisa membuka
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 1.62, -0.85);
    body.add(headPivot);
    ball(0.4, green, 0.85, 0.82, 1.0, 0, 0, 0, headPivot);
    ball(0.3, green, 0.78, 0.6, 1.55, 0, -0.07, -0.42, headPivot);
    ball(0.12, dark, 1, 0.7, 1, 0, 0.0, -0.78, headPivot);                               // ujung hidung
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {                                                       // gigi atas
        const tooth = part(new THREE.ConeGeometry(0.03, 0.11, 4), bone, sx * (0.13 - i * 0.01), -0.21, -0.3 - i * 0.14, headPivot);
        tooth.rotation.x = Math.PI;
      }
    }
    const jaw = new THREE.Group();
    jaw.position.set(0, -0.14, -0.12);
    headPivot.add(jaw);
    ball(0.2, light, 0.75, 0.38, 1.6, 0, -0.1, -0.32, jaw);
    for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) part(new THREE.ConeGeometry(0.025, 0.09, 4), bone, sx * 0.11, -0.03, -0.35 - i * 0.16, jaw);
    for (const s2 of [-1, 1]) {
      part(new THREE.SphereGeometry(0.1, 10, 8), white, s2 * 0.26, 0.12, -0.17, headPivot);
      part(new THREE.SphereGeometry(0.055, 8, 6), black, s2 * 0.325, 0.12, -0.23, headPivot);
      ball(0.1, dark, 1.2, 0.45, 1.5, s2 * 0.25, 0.23, -0.17, headPivot);                  // alis
    }

    // lengan kecil bercakar
    const arms = [];
    for (const s2 of [-1, 1]) {
      const pv = new THREE.Group();
      pv.position.set(s2 * 0.45, 1.2, -0.6);
      body.add(pv);
      const up = part(new THREE.CylinderGeometry(0.05, 0.08, 0.36, 7), dark, 0, -0.05, -0.15, pv);
      up.rotation.x = 1.3;
      ball(0.075, dark, 1, 1, 1.2, 0, -0.1, -0.33, pv);
      for (const c of [-1, 0, 1]) {
        const cl = part(new THREE.ConeGeometry(0.025, 0.12, 4), bone, c * 0.035, -0.11, -0.43, pv);
        cl.rotation.x = -1.4;
      }
      arms.push(pv);
    }

    // kaki: paha berotot, betis ramping, telapak bercakar
    const legs = [];
    for (const s2 of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s2 * 0.44, 0.99, 0.12);
      body.add(hip);
      ball(0.27, dark, 1, 1.15, 1.25, 0, -0.07, 0.03, hip);
      part(new THREE.CylinderGeometry(0.19, 0.14, 0.5, 9), dark, 0, -0.27, 0, hip);
      const knee = new THREE.Group();
      knee.position.set(0, -0.5, 0);
      hip.add(knee);
      ball(0.14, dark, 1, 1, 1, 0, 0, 0, knee);
      part(new THREE.CylinderGeometry(0.13, 0.08, 0.44, 8), green, 0, -0.22, 0, knee);
      const foot = new THREE.Group();
      foot.position.set(0, -0.43, 0);
      knee.add(foot);
      ball(0.1, green, 1, 1, 1, 0, 0, 0, foot);
      ball(0.16, dark, 1, 0.5, 2.1, 0, -0.04, -0.13, foot);
      for (const c of [-1, 0, 1]) {
        const toe = part(new THREE.ConeGeometry(0.045, 0.16, 5), white, c * 0.09, -0.05, -0.38, foot);
        toe.rotation.x = -1.45;
      }
      legs.push({ hip, knee, foot });
    }

    // ekor tiga ruas supaya meliuk halus
    const tail1 = new THREE.Group();
    tail1.position.set(0, 1.08, 0.7);
    body.add(tail1);
    const t1 = part(new THREE.CylinderGeometry(0.2, 0.34, 1.1, 10), green, 0, 0, 0.55, tail1);
    t1.rotation.x = Math.PI / 2;
    const tail2 = new THREE.Group();
    tail2.position.set(0, 0, 1.1);
    tail1.add(tail2);
    const t2 = part(new THREE.CylinderGeometry(0.1, 0.2, 0.9, 9), dark, 0, 0, 0.45, tail2);
    t2.rotation.x = Math.PI / 2;
    const tail3 = new THREE.Group();
    tail3.position.set(0, 0, 0.9);
    tail2.add(tail3);
    const t3 = part(new THREE.CylinderGeometry(0.015, 0.1, 0.8, 8), dark, 0, 0, 0.4, tail3);
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
    return { root, body, headPivot, jaw, arms, legs, tail1, tail2, tail3, mats: [green, dark, light] };
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
  function poseCreature(c, phase, run, air, vy, atk, t) {
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
    if (atk >= 0) {                                   // gigitan: kepala menyodok, rahang membuka lalu menutup
      const s = Math.sin(Math.PI * atk);
      c.headPivot.position.z = -0.85 - 0.5 * s;
      c.headPivot.rotation.x = 0.4 * s;
      if (c.jaw) c.jaw.rotation.x = -0.7 * Math.sin(Math.PI * Math.min(1, atk * 1.15));
    } else {
      c.headPivot.position.z = -0.85;
      c.headPivot.rotation.x = -c.body.rotation.x * 0.8 + Math.sin(phase * 2) * 0.04 * r;       // kepala menyeimbangkan badan
      if (c.jaw) c.jaw.rotation.x = approach(c.jaw.rotation.x, -0.06 - 0.04 * Math.sin(t * 2.1), 12);
    }
    c.headPivot.rotation.y = -c.body.rotation.y * 0.7;
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

  const PAL_PLAYER = { body: 0x4caf50, dark: 0x2e7d32, light: 0xaed581, spike: 0xffb300, eye: 0xffffff, pupil: 0x111111 };
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

  const player = {
    x: 0, z: 0, y: 0, vy: 0, vx: 0, vz: 0, yaw: Math.PI,
    hp: 100, hunger: 100, thirst: 100, stamina: 100, exhausted: false,
    invuln: 0, atkT: -1, atkCd: 0, atkHit: false, lastDmg: 99, level: 1, xp: 0, counterT: 0
  };
  // dino yang bisa dimainkan: kelebihan dan kekurangan masing-masing
  const PLAYABLES = {
    vosil: { name: 'Vosil', info: 'Seimbang untuk segala keadaan', scale: 1.1, pal: PAL_PLAYER, speed: 1, bite: 1, armor: 1, stam: 1, thirst: 1 },
    velo: { name: 'Velociraptor', info: 'Sangat cepat, tapi gigitan lemah dan mudah terluka', scale: 0.95, variant: 'velo', pal: PTYPES.velo.pal, speed: 1.2, bite: 0.75, armor: 1.2, stam: 1, thirst: 1 },
    carno: { name: 'Carnotaurus', info: 'Gigitan kuat dan tangguh, tapi agak lambat', scale: 1.25, variant: 'carno', pal: PTYPES.carno.pal, speed: 0.95, bite: 1.4, armor: 0.9, stam: 1.1, thirst: 1 },
    spino: { name: 'Spinosaurus', info: 'Sangat tangguh dan tahan haus, tapi lambat', scale: 1.4, variant: 'spino', pal: PTYPES.spino.pal, speed: 0.88, bite: 1.3, armor: 0.75, stam: 1.15, thirst: 0.5 },
    parasaur: { name: 'Parasaurolophus', info: 'Tenaga besar untuk lari jauh, tapi gigitan lemah', scale: 1.25, variant: 'parasaur', pal: PTYPES.parasaur.pal, speed: 1.05, bite: 0.6, armor: 1.1, stam: 0.5, thirst: 1 }
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
  const biteMul = () => curChar.bite * (1 + 0.07 * (player.level - 1));
  const armorMul = () => curChar.armor * (1 - 0.025 * (player.level - 1));
  const speedLv = () => 1 + 0.01 * (player.level - 1);
  function gainXp(n) {
    if (state !== 'playing' || n <= 0) return;
    if (player.level >= MAX_LEVEL) { player.xp = 0; return; }
    player.xp += n;
    let up = 0;
    while (player.level < MAX_LEVEL && player.xp >= xpNeed(player.level)) { player.xp -= xpNeed(player.level); player.level++; up++; }
    if (up) levelUp();
  }
  function levelUp() {
    player.hp = Math.min(100, player.hp + 35);
    toast('⬆ LEVEL ' + player.level + '! Dino makin besar dan kuat', 2.8);
    GameAudio.sfx.record();
    burst(26, player.x, 1.4 * scaleNow / 1.1, player.z);
    shake = Math.max(shake, 0.25);
    showDmg(player.x, (player.gy || 0) + 3.2 * scaleNow / 1.1, player.z, 'LEVEL ' + player.level + '!', 'gain', 1.5);
    try { if (lvFlash && lvFlash.classList) { lvFlash.classList.remove('on'); void lvFlash.offsetWidth; lvFlash.classList.add('on'); } } catch (e) { /* abaikan */ }
  }
  const heroShadow = new THREE.Mesh(shadowDisc, mShadow);
  scene.add(heroShadow);

  let state = 'menu';               // 'menu' | 'playing' | 'over'
  let time = 0, runTime = 0, clock = 0;
  let runCoins = 0, kills = 0, overAt = 0, startPerf = 0;
  let powerLeft = 0, scaleNow = curChar.scale * lvScale(1), phase = 0, deathReason = '';
  let preds = [], spawnCd = 4, animalCd = 2, chased = false, isNight = false, lastBiome = null;
  let biteVoiceT = -9;
  let swimming = false, swimBlend = 0, swimToastCd = 0, strokeT = 0, ringT = 0;
  let climbToastCd = 0, biomeCd = 0, drinkCd = 0, toastT = 0, saveT = 0, hurtT = 0, shake = 0;
  let camGy = 0, lvDay = 0;
  let camYaw = 0, camPitch = 0.71, camLift = 0;
  let camX = 0, camZ = 0, camLead = { x: 0, z: 0 }, lastWet = false, shown = {};

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
    menuEl.classList.toggle('hidden', state !== 'menu');
    overEl.classList.toggle('hidden', state !== 'over');
    document.body.classList.toggle('playing', state === 'playing');
    $('menuTotal').textContent = save.coins;
    $('menuBest').textContent = save.bestDays;
  }

  // ---------- Siklus siang-malam ----------
  const SKY_DAY = [0.62, 0.85, 0.96], SKY_NIGHT = [0.03, 0.06, 0.16], SKY_DUSK = [0.95, 0.58, 0.38];
  function applyDayNight() {
    const ang = (runTime / DAY_LEN) * Math.PI * 2 + 0.3;
    const raw = Math.sin(ang);
    const k = smooth(-0.35, 0.2, raw);                       // 0 = malam, 1 = siang
    const dusk = clamp(1 - Math.abs(raw) * 3.2, 0, 1) * 0.5;
    const rgb = [0, 1, 2].map((i) => lerp(lerp(SKY_NIGHT[i], SKY_DAY[i], k), SKY_DUSK[i], dusk));
    scene.background.setRGB(rgb[0], rgb[1], rgb[2]);
    scene.fog.color.setRGB(rgb[0], rgb[1], rgb[2]);
    scene.fog.near = lerp(14, 26, k);              // malam: pandangan lebih pendek = lebih tegang
    scene.fog.far = lerp(50, 68, k);               // lebih pendek dari area yang dimuat (60 m) supaya tepi dunia tersamar
    mPond.color.setRGB(lerp(0.06, 0.25, k), lerp(0.16, 0.66, k), lerp(0.3, 0.88, k));   // air gelap saat malam
    mDeep.opacity = lerp(0.7, 0.55, k);
    mGlint.opacity = 0.12 + 0.4 * k;
    mShadow.opacity = 0.14 + 0.42 * k;               // siang: bayangan tegas, malam: nyaris tak terlihat
    hemi.intensity = 0.3 + 0.42 * k;
    sunLight.intensity = 0.12 + 0.95 * k;
    isNight = k < 0.4;
  }

  // ---------- Mulai / selesai ----------
  function startGame() {
    clearWorld();
    for (const p of preds) removePred(p);
    preds = [];
    worldSeed = 1 + Math.floor(Math.random() * 1e6);
    pondCache.clear();
    camGy = 0; camYaw = 0; camPitch = 0.71; camLift = 0;
    Object.assign(player, {
      x: 0, z: 0, y: 0, vy: 0, vx: 0, vz: 0, yaw: Math.PI,
      hp: 100, hunger: 100, thirst: 100, stamina: 100, exhausted: false,
      invuln: 0, atkT: -1, atkCd: 0, atkHit: false, lastDmg: 99, level: 1, xp: 0, counterT: 0
    });
    roarCd = 0; hordeCd = 70; horde = null; dangerNow = 0; swimming = false; swimBlend = 0; time = 0; runTime = 0; runCoins = 0; kills = 0; powerLeft = 0; scaleNow = baseScale(); shake = 0; lvDay = 0;
    spawnCd = 8; animalCd = 2; chased = false; lastBiome = null; biomeCd = 0; drinkCd = 0; deathReason = '';
    camX = 0; camZ = 0; camLead = { x: 0, z: 0 }; shown = {};
    state = 'playing';
    startPerf = performance.now();
    ensureChunks(true);
    save.runs++;
    refreshPanels();
    updateHud();
    toast('Cari air dan buah. Hati-hati predator!', 3);
    GameAudio.sfx.start();
    GameAudio.music.start();
  }

  function die(reason) {
    if (state !== 'playing') return;
    state = 'over';
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
    $('overBest').textContent = newBest && days > 0 ? 'Rekor baru!' : 'Rekor: ' + save.bestDays + ' hari';
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
    if (!charRow) return;
    charRow.innerHTML = Object.keys(PLAYABLES).map((id) => {
      const c = PLAYABLES[id], col = '#' + c.pal.body.toString(16).padStart(6, '0');
      return '<button type="button" class="chr' + (curChar === c ? ' sel' : '') + '" data-id="' + id + '"><i style="background:' + col + '"></i>' + c.name + '</button>';
    }).join('');
    if (charInfo) charInfo.textContent = curChar.info;
  }
  function selectChar(id) {
    const c = PLAYABLES[id];
    if (!c || c === curChar) return;
    curChar = c;
    save.char = id;
    writeSave();
    scene.remove(hero.root);
    disposeTree(hero.root);
    hero = buildHero();
    scene.add(hero.root);
    scaleNow = baseScale();
    renderChars();
    GameAudio.sfx.coin();
  }
  if (charRow) charRow.addEventListener('click', (e) => {
    e.stopPropagation();
    GameAudio.init();
    let el = e.target;
    while (el && !(el.dataset && el.dataset.id)) el = el.parentNode;
    if (el && state === 'menu') selectChar(el.dataset.id);
  });
  renderChars();

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
  bindBtn(btnAttack, () => { input.attack = true; });
  bindBtn(btnJump, () => { input.jump = true; });
  if (btnRoar) bindBtn(btnRoar, () => { doRoar(); });
  bindBtn(btnSprint, () => { input.sprint = true; }, () => { input.sprint = false; });

  canvas.addEventListener('pointerup', autoFs);             // gesture sentuh yang sah untuk layar penuh
  canvas.addEventListener('click', autoFs);
  // ketuk di mana saja untuk mulai / main lagi
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    GameAudio.init();
    if (state === 'menu') startGame();
    else if (state === 'over' && performance.now() - overAt > 700) startGame();
  });

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const map = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', shift: 'shift', q: 'camL', e: 'camR' };
    if (map[k]) keys[map[k]] = true;
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'enter'].includes(k)) e.preventDefault();
    GameAudio.init();
    if (state !== 'playing') {
      if ((k === ' ' || k === 'enter') && (state === 'menu' || performance.now() - overAt > 700)) startGame();
      return;
    }
    if (k === ' ') input.jump = true;
    else if (k === 'j' || k === 'k') input.attack = true;
    else if (k === 'r' || k === 'l') doRoar();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    const map = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', shift: 'shift', q: 'camL', e: 'camR' };
    if (map[k]) keys[map[k]] = false;
  });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; stickEnd(null); input.sprint = false; });

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
    if (!ok) toast(isIOS ? 'iPhone: ketuk Bagikan → Tambahkan ke Layar Utama untuk layar penuh' : 'Browser ini tidak mendukung layar penuh', 3.5);
  }
  if (fsBtn) {
    fsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFs(); });
    fsBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  const qBtn = $('qBtn');
  if (qBtn) {
    const lbl = () => { qBtn.textContent = ({ low: '▫', mid: '◪', high: '◼' })[save.q] || '◪'; };
    qBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const order = ['low', 'mid', 'high'];
      save.q = order[(order.indexOf(save.q) + 1) % 3];
      writeSave(); applyQuality(); lbl();
      toast('Kualitas grafis: ' + QUAL[save.q].name, 1.6);
    });
    qBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    lbl();
  }
  if (!QUAL[save.q]) save.q = 'mid';
  applyQuality();
  if (rotBtn) rotBtn.addEventListener('click', () => { enterImmersive(); });
  let autoFsTried = false;
  function autoFs() { if (autoFsTried || isFs()) return; autoFsTried = true; enterImmersive(); }
  document.addEventListener('fullscreenchange', () => { try { resize(); } catch (e) { /* abaikan */ } });
  document.addEventListener('webkitfullscreenchange', () => { try { resize(); } catch (e) { /* abaikan */ } });
  try {
    const rn = $('rotNote');
    if (rn && isIOS) rn.textContent = 'iPhone belum mengizinkan putar otomatis. Putar HP secara manual, atau pakai Safari → Bagikan → Tambahkan ke Layar Utama untuk layar penuh.';
  } catch (e) { /* abaikan */ }

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
    if (player.hp <= 0) { player.hp = 0; die(reason); }
    return true;
  }

  function damagePred(p, dmg, tag) {
    p.hp -= dmg;
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
      showDmg(p.x, heightAt(p.x, p.z) + 2.4 * p.def.scale, p.z, 'TERGANGGU', 'xp', 1);
    }
    burst(8, p.x, 1.0 * p.def.scale, p.z);
    starBurst(p.x, heightAt(p.x, p.z) + 1.3 * p.def.scale, p.z, big ? 9 : 5, big ? 'gain' : 'hit');
    if (p.hp > 0 && !p.enraged && !p.def.timid && !p.def.neutral && p.hp <= p.maxHp * 0.3) {   // hampir kalah: mengamuk
      p.enraged = true;
      toast('💢 ' + p.def.name + ' mengamuk!', 1.8);
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
    runCoins += p.def.reward;
    save.coins += p.def.reward;
    player.hunger = Math.min(100, player.hunger + p.def.food);
    burst(14, p.x, 1, p.z);
    starBurst(p.x, heightAt(p.x, p.z) + 1.3 * p.def.scale, p.z, 12, 'gain');
    if (p.def.reward) showDmg(p.x, heightAt(p.x, p.z) + 2.2 * p.def.scale, p.z, '+' + p.def.reward + ' 🪙', 'gain', 1.1);
    const xp = (p.def.timid || p.def.neutral) ? Math.round(p.def.hp * 0.18) : Math.round(p.def.hp * 0.45 + p.def.reward * 2);
    gainXp(xp);
    showDmg(p.x + 0.6, heightAt(p.x, p.z) + 1.6 * p.def.scale, p.z, '+' + xp + ' XP', 'xp', 1);
    GameAudio.sfx.smash();
    GameAudio.sfx.eat();
    toast((p.def.reward ? '+' + p.def.reward + ' koin · ' : '') + 'daging +' + p.def.food + ' lapar', 2.2);
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
  function updateSwimRings(dt) {
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
    const ph = t * (5.5 + spd * 0.9);
    for (let i = 0; i < 2; i++) {
      const L = c.legs[i], o = ph + i * Math.PI;
      L.hip.rotation.x += (Math.sin(o) * 0.95 - L.hip.rotation.x) * b;
      L.knee.rotation.x += (-0.6 - 0.35 * Math.sin(o + 1) - L.knee.rotation.x) * b;
      if (L.foot) L.foot.rotation.x += (0.4 - L.foot.rotation.x) * b;
    }
    c.body.rotation.x += (0.2 - c.body.rotation.x) * b;
    c.body.rotation.z += (Math.sin(ph * 0.5) * 0.05 - c.body.rotation.z) * b;
    c.body.position.y += (0.05 - c.body.position.y) * b;
    const sw = Math.sin(t * 4.2) * 0.5 * b;
    c.tail1.rotation.y = sw * 0.7; c.tail2.rotation.y = Math.sin(t * 4.2 - 0.9) * 0.6 * b;
    if (c.tail3) c.tail3.rotation.y = Math.sin(t * 4.2 - 1.8) * 0.7 * b;
    for (let i = 0; i < 2; i++) c.arms[i].rotation.x = -0.9 * b;
  }

  // ---------- Skill: Raungan (saat dikeroyok) ----------
  let roarCd = 0, roarT = 99, roarR = 8, roarHint = 0;
  const roarRingGeo = new THREE.RingGeometry(0.9, 1, 48); roarRingGeo.rotateX(-Math.PI / 2);
  const mRoar = new THREE.MeshBasicMaterial({ color: 0xffe0b2, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const roarRing = new THREE.Mesh(roarRingGeo, mRoar);
  roarRing.visible = false;
  scene.add(roarRing);
  const roarCooldown = () => Math.max(8, 15 - 0.6 * (player.level - 1));
  function doRoar() {
    if (state !== 'playing' || roarCd > 0) return;
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
    showDmg(player.x, (player.gy || 0) + player.y + 3.0 * scaleNow / 1.1, player.z, 'RAUNGAN!', 'crit', 1.3);
    starBurst(player.x, (player.gy || 0) + player.y + 1.6 * scaleNow / 1.1, player.z, 10, 'gain');
    if (hit === 0) toast('Raungan... tidak ada musuh dekat', 1.4);
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
      mRoar.opacity = 0.7 * (1 - f) * (1 - f);
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
      const txt = ready ? 'RAUNG' : Math.ceil(roarCd) + ' dtk';
      if (sp && sp.textContent !== txt) sp.textContent = txt;
    }
    if (swarm >= 3 && roarCd <= 0 && roarHint <= 0) { toast('Dikeroyok! Tekan RAUNG 📢', 2.2); roarHint = 14; }
  }

  function startAttack() {
    if (player.atkCd > 0 || player.atkT >= 0) return;
    // bantuan bidik: hadapkan ke predator terdekat jika dekat
    let best = null, bd = 6.5;
    for (const p of preds) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) player.yaw = faceYaw(best.x - player.x, best.z - player.z);
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
  let dangerNow = 0, cryCd = 6, flyCryCd = 14;
  function cry(type, kind, x, z, boost) {
    const dx = x - player.x, dz = z - player.z, d = Math.hypot(dx, dz);
    const range = type === 'brachio' || type === 'diplo' ? 95 : 55;
    const vol = clamp(1 - d / range, 0, 1) * (boost || 1);
    if (vol < 0.05) return;
    const pan = d > 3 ? clamp(((dx * Math.cos(camYaw) - dz * Math.sin(camYaw)) / d) * 0.9, -0.9, 0.9) : 0;
    GameAudio.sfx.dino(type, kind, vol, pan);
  }
  GameAudio.setDanger(() => dangerNow);
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
    toast('🐾 Semak-semak bergetar... SESUATU MENDEKAT!', 2.8);
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
    if (horde.spawned === 0) { toast('🔥 KAWANAN MENYERBU! ' + horde.n + ' musuh! Tekan RAUNG 📢', 3); shake = Math.max(shake, 0.9); }
    while (horde.spawned < horde.n && horde.t >= horde.warn + horde.spawned * 0.2) { spawnHordeMember(horde.spawned); horde.spawned++; }
    if (horde.spawned < horde.n) return;
    const alive = horde.members.filter((p) => !p.dead && preds.includes(p));
    if (!alive.length) {
      const bonus = horde.n * 12;
      gainXp(bonus); runCoins += horde.n * 4; save.coins += horde.n * 4; writeSave();
      toast('🏆 Kawanan dikalahkan! +' + bonus + ' XP, +' + horde.n * 4 + ' koin', 3);
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
    const shd = new THREE.Mesh(shadowDisc, mShadow);
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
    if (p.sh) scene.remove(p.sh);
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
    damagePlayer(p.def.dmg * p.dmgMul, 'Dimangsa ' + p.def.name, p.x, p.z);
  }
  function perfectDodge(p) {
    showDmg(player.x, (player.gy || 0) + player.y + 3.0 * scaleNow / 1.1, player.z, 'HINDAR!', 'crit', 1.3);
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
    const day = Math.floor(runTime / DAY_LEN);
    const maxCount = (isNight ? 4 : 2) + Math.min(2, Math.floor(day / 2));
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
    if (animalCd <= 0 && animals < 5) {
      animalCd = rand(3, 6);
      spawnPredator(pickAnimalType());
    }

    for (const p of preds) {                                          // dinosaurus darat tidak bisa masuk air dalam
      if (p.dead) continue;
      if (!p.def.aqua && WL - heightAt(p.x, p.z) > 0.9) {
        if (p.px !== undefined && WL - heightAt(p.px, p.pz) <= 0.9) { p.x = p.px; p.z = p.pz; }
        else {                                                       // terjebak di air (muncul/terdorong): pindah ke daratan terdekat
          for (let k = 0; k < 14; k++) {
            const a2 = Math.random() * Math.PI * 2, d2 = 14 + k * 3;
            const nx = player.x + Math.cos(a2) * d2, nz = player.z + Math.sin(a2) * d2;
            if (WL - heightAt(nx, nz) < 0.3) { p.x = nx; p.z = nz; break; }
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
          toast('📖 Spesies baru: ' + def.name + ' (' + Object.keys(save.seen).length + '/' + Object.keys(PTYPES).length + ')', 2.4);
        }
        if (def.timid) {
          if (d < def.fleeDist) p.state = 'flee';
        } else if (!def.neutral && d < detect) {
          p.state = 'chase';
          if (!p.roared) {
            p.roared = true; cry(p.type, 'call', p.x, p.z, 1.3);
            const fresh = !save.seen[p.type];
            if (fresh) { save.seen[p.type] = true; writeSave(); }
            toast('⚠ ' + def.name + ' mengejar!' + (fresh ? ' 📖 spesies baru' : ''), fresh ? 2.4 : 1.6);
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
    runTime += dt;
    applyDayNight();
    { const dNow = Math.floor(runTime / DAY_LEN); if (dNow > lvDay) { lvDay = dNow; if (dNow > 0) { gainXp(30); toast('☀ Hari ke-' + (dNow + 1) + '! +30 XP', 2); } } }
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
    const mag = Math.min(1, Math.hypot(ix, iz));
    if (mag > 0) {                                      // arah gerak mengikuti sudut kamera
      const cs = Math.cos(camYaw), sn = Math.sin(camYaw);
      const rx = ix * cs + iz * sn, rz = -ix * sn + iz * cs;
      ix = rx; iz = rz;
    }

    // tenaga & lari
    const wantSprint = (input.sprint || keys.shift) && mag > 0.2;
    if (player.stamina <= 0) player.exhausted = true;
    else if (player.stamina >= 25) player.exhausted = false;
    const sprinting = wantSprint && !player.exhausted && player.stamina > 0;
    if (swimming) { /* tenaga diatur di blok renang */ }
    else if (sprinting) player.stamina = Math.max(0, player.stamina - 28 * curChar.stam * dt);
    else player.stamina = Math.min(100, player.stamina + (mag > 0.2 ? 12 : 22) * dt);

    const weak = player.hunger <= 0 || player.thirst <= 0;
    const speedMul = (powerLeft > 0 ? 1.25 : 1) * (weak ? 0.85 : 1) * curChar.speed * speedLv();
    // berenang: air cukup dalam -> mode renang (lebih lambat, tanpa lompat, tenaga terkuras pelan)
    const depth = WL - heightAt(player.x, player.z);
    const wasSwim = swimming;
    if (!swimming && depth > 1.0) swimming = true; else if (swimming && depth < 0.7) swimming = false;
    if (swimming !== wasSwim) {
      GameAudio.sfx.splash();
      starBurst(player.x, WL + 0.4, player.z, 8, 'water');
      spawnSwimRing(player.x, player.z, 1.6);
      if (swimming && swimToastCd <= 0) { toast('🏊 Berenang! Dinosaurus darat tidak bisa mengikuti', 2.4); swimToastCd = 25; }
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
      const dh = heightAt(player.x + gx, player.z + gz) - heightAt(player.x, player.z);
      slopeMul = Math.min(1.25, Math.max(0.55, 1 - dh * 0.8));
      if (dh > 0.85) {                                  // tebing curam: memanjat menguras tenaga, tenaga habis = merosot
        slopeMul = 0.4;
        player.stamina = Math.max(0, player.stamina - 34 * dt);
        if (player.stamina <= 0.5) slide = true;
        if (climbToastCd <= 0) { toast('🧗 Tebing curam! Memanjat menguras tenaga', 2); climbToastCd = 9; }
      }
    }
    climbToastCd -= dt;
    if (lastWet && !swimming) slopeMul *= 0.7;          // mengarungi air dangkal
    const target = (sprinting ? SPRINT : WALK) * mag * speedMul * slopeMul;
    let tx = mag > 0 ? (ix / mag) * target : 0, tz = mag > 0 ? (iz / mag) * target : 0;
    if (slide) { tx = -(ix / mag) * 3; tz = -(iz / mag) * 3; }
    const k = Math.min(1, dt * 12);
    if (!swimming) {
      player.vx += (tx - player.vx) * k;
      player.vz += (tz - player.vz) * k;
      player.x += player.vx * dt;
      player.z += player.vz * dt;
    }
    pushOut(player, 0.55 * (scaleNow / 1.1));

    const spd = Math.hypot(player.vx, player.vz);
    if (spd > 0.4 && player.atkT < 0) player.yaw = lerpAngle(player.yaw, faceYaw(player.vx, player.vz), Math.min(1, dt * 14));

    // lompat
    if (input.jump) {
      input.jump = false;
      if (player.y === 0 && player.vy === 0 && !swimming) { player.vy = JUMP_V; GameAudio.sfx.jump(); }
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
    if (player.hunger <= 0 || player.thirst <= 0) {
      player.hp -= STARVE_DMG * dt;
      hurtT = Math.max(hurtT, 0.05);
      if (player.hp <= 0) { player.hp = 0; die(player.thirst <= 0 ? 'Mati kehausan' : 'Mati kelaparan'); return; }
    } else if (player.lastDmg > 4 && player.hunger > 40 && player.thirst > 40 && player.hp < 100) {
      player.hp = Math.min(100, player.hp + REGEN * dt);
    }

    // minum di kolam
    const wet = inPond(player.x, player.z);
    if (wet) {
      player.thirst = Math.min(100, player.thirst + WATER_RATE * dt);
      drinkCd -= dt;
      if (drinkCd <= 0 && player.thirst < 100) { drinkCd = 0.5; GameAudio.sfx.drink(); }
      if (!lastWet && player.thirst < 90) toast('Minum air 💧', 1.2);
    }
    lastWet = wet;

    // isi dunia: potongan, semak, koin, telur
    ensureChunks(false);
    pumpBuildQueue();
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
            toast('Buah 🍒 +' + FRUIT_HUNGER + ' lapar', 1.2);
            gainXp(2);
          }
        }

        for (let i = ch.coins.length - 1; i >= 0; i--) {
          const c = ch.coins[i];
          c.mesh.rotation.y += dt * 4;
          const dx = c.x - player.x, dz = c.z - player.z;
          if (dx * dx + dz * dz < (1.5 * sc) * (1.5 * sc) && player.y < 1.8) {
            taken.add(c.id);
            ch.group.remove(c.mesh);
            scene.add(c.mesh);                                   // koin terbang ke arah dino
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
            toast('🥚 MODE KUAT! Gigitan 3x lebih sakit, kebal serangan', 2.4);
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

    let glow = 0;
    if (powerLeft > 0) glow = powerLeft < 2.5 ? 0.25 + 0.25 * Math.sin(clock * 28) : 0.35 + 0.15 * Math.sin(clock * 8);
    else if (player.invuln > 0) glow = 0.45 * Math.sin(clock * 50) > 0 ? 0.4 : 0;
    setGlow(hero, glow, player.invuln > 0 && powerLeft <= 0 ? 0xff0000 : 0xff5a00);

    const spd = Math.hypot(player.vx, player.vz);
    phase += (spd * 1.5 + 1.2) * dt * (spd > 0.4 ? 1 : 0.3);
    const run = clamp(spd / 6, 0, 1.3);
    const air = player.y > 0.001;
    swimBlend = approach(swimBlend, swimming ? 1 : 0, 6);
    const groundY = heightAt(player.x, player.z);
    const gy = swimBlend > 0.01 ? lerp(groundY, WL - 0.42 * (scaleNow / 1.1) + Math.sin(clock * 2.4) * 0.05, swimBlend) : groundY;
    player.gy = gy;
    hero.root.position.set(player.x, gy + player.y, player.z);
    if (state === 'over') {
      hero.root.rotation.z += (1.4 - hero.root.rotation.z) * Math.min(1, dt * 7);
      hero.root.position.y = gy + 0.15;
    } else {
      hero.root.rotation.z = 0;
      hero.root.rotation.y = player.yaw;
      poseCreature(hero, phase, run, air, player.vy, player.atkT >= 0 ? clamp(player.atkT / 0.35, 0, 1) : -1, clock);
      if (swimBlend > 0.01) applySwim(hero, swimBlend, spd, clock);
      tiltToGround(hero.root, player.x, player.z, player.yaw, 0.9 * scaleNow / 1.1, dt, swimBlend > 0.5 || air);
    }
    const s = Math.max(0.5, 1 - player.y / 3.2);
    heroShadow.visible = swimBlend < 0.5;
    placeShadow(heroShadow, player.x, player.z, gy, 0.75 * scaleNow * s, 1.9 * scaleNow);

    for (const p of preds) {
      const c = p.c;
      const pgyG = heightAt(p.x, p.z);
      const deepP = WL - pgyG > 0.9;
      const pgy = deepP ? WL - 0.4 * p.def.scale : pgyG;
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
      let atk = -1;
      const wp = p.state === 'windup' ? clamp(1 - p.t / p.t0, 0, 1) : 0;
      if (p.state === 'strike') atk = clamp(p.st / p.dur, 0, 1);                      // menerkam: kepala menyodok, rahang membuka
      else if (p.state === 'recover') atk = Math.max(0, 1 - (p.t0b || 0));
      const run = p.state === 'strike' ? 1.3 : clamp(p.speedNow / 6, 0, 1.3);
      if (c.isTrike) poseTrike(c, p.phase, run, p.state === 'strike' ? atk : -1, clock);
      else poseCreature(c, p.phase, run, false, 0, p.state === 'strike' ? atk : -1, clock);
      p.swimB = approach(p.swimB || 0, deepP ? 1 : 0, 6);
      if (!c.isTrike && p.swimB > 0.01 && c.legs) applySwim(c, p.swimB, p.speedNow, clock);
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
    const tx = player.x + camLead.x * 0.6, tz = player.z + camLead.z * 0.6;
    camX += (tx - camX) * Math.min(1, dt * 8);
    camZ += (tz - camZ) * Math.min(1, dt * 8);
    const grow = Math.max(0.9, scaleNow / 1.1);
    let sx = 0, sy = 0;
    if (shake > 0) {
      sx = (Math.random() - 0.5) * shake * 0.5;
      sy = (Math.random() - 0.5) * shake * 0.5;
      shake = Math.max(0, shake - dt * 2.5);
    }
    camGy += ((player.gy || 0) - camGy) * Math.min(1, dt * 4);
    if (state === 'menu') { camYaw = clock * 0.45; camPitch = 0.5; }     // menu: kamera memutari dino pilihan
    const R = 12.6 * grow, ce = Math.cos(camPitch), se = Math.sin(camPitch);
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

  // ---------- Loop utama ----------
  const isPortrait = () => window.innerHeight > window.innerWidth * 1.05;
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    clock += dt;

    if (state === 'playing' && !isPortrait()) update(dt);
    else if (state === 'menu') { player.yaw = Math.sin(clock * 0.5) * 0.6 + Math.PI; }
    animate(dt);
    updateCamera(dt);
    updateDmg(dt);
    updateStars(dt);
    updateBars();
    updateRoar(dt);
    updateDanger(dt);
    updateHorde(dt);
    updateSwimRings(dt);
    updateFlyCoins(dt);

    if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.classList.remove('show'); }
    if (hurtT > 0) { hurtT -= dt; hurtEl.classList.add('on'); } else hurtEl.classList.remove('on');

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // tampilan latar menu: dunia awal terlihat di belakang judul
  worldSeed = 1 + Math.floor(Math.random() * 1e6);
  pondCache.clear();
  ensureChunks(true);
  applyDayNight();
  refreshPanels();
  requestAnimationFrame(frame);

  // Akses untuk tahap berikutnya (wallet / backend)
  window.VosilSurvival = { getSave: () => ({ ...save }) };
})();
