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
  const stickZone = $('stickZone'), stickBase = $('stickBase'), stickKnob = $('stickKnob');
  const btnAttack = $('btnAttack'), btnJump = $('btnJump'), btnSprint = $('btnSprint'), fsBtn = $('fsBtn');

  // ---------- Penyimpanan lokal ----------
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && typeof s.coins === 'number') return Object.assign({ bestDays: 0, kills: 0, runs: 0, seen: {} }, s);
    } catch (e) { /* abaikan */ }
    return { coins: 0, bestDays: 0, kills: 0, runs: 0, seen: {} };
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
  const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
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
  const std = (color, extra) =>
    new THREE.MeshStandardMaterial(Object.assign({ color, flatShading: true, roughness: 0.85, metalness: 0 }, extra || {}));

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
    const big = (vnoise(x / 75, z / 75, 71) - 0.5) * 10;       // bukit dan lembah besar
    const mid = (vnoise(x / 26, z / 26, 72) - 0.5) * 2.6;      // gelombang kecil
    return (big + mid) * smooth(12, 70, Math.hypot(x, z));     // sekitar titik awal tetap landai
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
      p = { x, z, r, base: rawHeight(x, z) - 0.3 };
    }
    pondCache.set(key, p);
    return p;
  }
  function heightAt(x, z) {
    let h = rawHeight(x, z);
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
        const v = (0.88 + 0.24 * vnoise(x / 5, z / 5, 9)) * Math.min(1.12, Math.max(0.78, 0.95 + h * 0.025));
        col[k] = Math.min(1, bc.r * v); col[k + 1] = Math.min(1, bc.g * v); col[k + 2] = Math.min(1, bc.b * v);
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
      const c1 = new THREE.Mesh(sphereGeo, leaf); c1.position.set(0, 2.6, 0); c1.scale.set(1.5, 1.2, 1.5); g.add(c1);
      const c2 = new THREE.Mesh(sphereGeo, leaf2); c2.position.set(0.8, 2.1, 0.3); c2.scale.set(1.0, 0.85, 1.0); g.add(c2);
      const c3 = new THREE.Mesh(sphereGeo, leaf2); c3.position.set(-0.7, 2.2, -0.3); c3.scale.set(0.9, 0.8, 0.9); g.add(c3);
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
    const r = new THREE.Mesh(rockGeo, dry ? mRockDry : mRock);
    r.position.y = 0.35 * s;
    r.scale.set(s * rand(0.9, 1.5), s * rand(0.6, 1.0), s * rand(0.9, 1.4));
    r.rotation.y = rand(0, 6);
    g.add(r);
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
    const ch = { key, cx, cz, group, biome, colliders: [], bushes: [], coins: [], eggs: [], ponds: [] };

    ch.geo = buildGround(ox, oz);
    group.add(new THREE.Mesh(ch.geo, mGround));

    const placed = [];
    const tryPlace = (r) => {
      for (let i = 0; i < 10; i++) {
        const x = ox + 1.5 + rng() * (CH - 3), z = oz + 1.5 + rng() * (CH - 3);
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
      const m = new THREE.Mesh(pondGeo, mPond);
      m.rotation.x = -Math.PI / 2;
      m.position.set(pd.x, pd.base - 0.18, pd.z);
      m.scale.set(r + 0.7, r + 0.7, 1);
      group.add(m);
      ch.ponds.push({ x: pd.x, z: pd.z, r });
      if (biome.id !== 'forest') {                      // oasis: palem tumbuh di tepi kolam
        for (let k = 0, pn = 1 + Math.floor(rng() * 3); k < pn; k++) {
          const a = rng() * Math.PI * 2, dd = r + R(0.8, 1.6);
          const px = pd.x + Math.cos(a) * dd, pz = pd.z + Math.sin(a) * dd;
          const s = R(0.9, 1.4), pm = makeTree(s, 'palm', 0);
          pm.position.set(px, heightAt(px, pz), pz);
          group.add(pm);
          ch.colliders.push({ x: px, z: pz, r: 0.3 * s });
        }
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
    }
    for (let i = 0, n = cnt(biome.cycad); i < n; i++) {
      const pos = tryPlace(1.2); if (!pos) continue;
      const s = R(0.9, 1.5), t = makeCycad(s);
      t.position.set(pos.x, heightAt(pos.x, pos.z), pos.z);
      group.add(t);
      ch.colliders.push({ x: pos.x, z: pos.z, r: 0.45 * s });
    }
    for (let i = 0, n = cnt(biome.cactus); i < n; i++) {
      const pos = tryPlace(1.2); if (!pos) continue;
      const s = R(0.9, 1.5), t = makeCactus(s);
      t.position.set(pos.x, heightAt(pos.x, pos.z), pos.z);
      group.add(t);
      ch.colliders.push({ x: pos.x, z: pos.z, r: 0.5 * s });
    }
    for (let i = 0, n = cnt(biome.rock); i < n; i++) {
      const pos = tryPlace(1.3); if (!pos) continue;
      const s = R(0.8, 1.7), t = makeRock(s, biome.id === 'desert');
      t.position.set(pos.x, heightAt(pos.x, pos.z), pos.z);
      group.add(t);
      ch.colliders.push({ x: pos.x, z: pos.z, r: 0.85 * s });
    }

    // semak buah
    const bushN = home ? Math.max(2, cnt(biome.bush)) : cnt(biome.bush);
    for (let i = 0; i < bushN; i++) {
      const pos = tryPlace(1.4); if (!pos) continue;
      const b = makeBush();
      b.group.position.set(pos.x, heightAt(pos.x, pos.z), pos.z);
      group.add(b.group);
      const id = key + ':b' + i;
      const bush = { id, x: pos.x, z: pos.z, berries: b.berries, has: true };
      if (eatenAt.has(id)) { bush.has = false; b.berries.visible = false; }
      ch.bushes.push(bush);
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
        group.add(e.group);
        ch.eggs.push({ id, x: pos.x, z: pos.z, by, mesh: e.group, ring: e.ring });
      }
    }

    chunks.set(key, ch);
    return ch;
  }

  function unloadChunk(ch) {
    scene.remove(ch.group);
    if (ch.geo) ch.geo.dispose();
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
    const green = std(p.body), dark = std(p.dark), light = std(p.light), spikeM = std(p.spike);
    const white = std(p.eye, { flatShading: false }), black = std(p.pupil, { flatShading: false });
    const part = (geo, mat, x, y, z, parent) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      (parent || body).add(m);
      return m;
    };

    const torso = part(new THREE.SphereGeometry(0.62, 10, 8), green, 0, 1.15, 0);
    torso.scale.set(0.85, 0.8, 1.25);
    const belly = part(new THREE.SphereGeometry(0.55, 8, 6), light, 0, 0.98, -0.05);
    belly.scale.set(0.8, 0.6, 1.15);

    for (let i = 0; i < 6; i++) {
      const z = -0.6 + i * 0.26, h = 0.42 - i * 0.04;
      const topY = 1.15 + 0.496 * Math.sqrt(Math.max(0, 1 - (z / 0.775) * (z / 0.775)));
      part(new THREE.ConeGeometry(0.14, h, 5), spikeM, 0, topY + h / 2 - 0.04, z);
    }

    part(new THREE.SphereGeometry(0.34, 8, 6), green, 0, 1.45, -0.7);
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 1.62, -0.85);
    body.add(headPivot);
    part(new THREE.SphereGeometry(0.42, 10, 8), green, 0, 0, 0, headPivot);
    part(new THREE.BoxGeometry(0.46, 0.32, 0.6), green, 0, -0.1, -0.42, headPivot);
    part(new THREE.BoxGeometry(0.4, 0.12, 0.5), dark, 0, -0.3, -0.38, headPivot);
    for (const s of [-1, 1]) {
      part(new THREE.SphereGeometry(0.1, 8, 6), white, s * 0.27, 0.12, -0.2, headPivot);
      part(new THREE.SphereGeometry(0.055, 6, 6), black, s * 0.33, 0.12, -0.25, headPivot);
    }

    const arms = [];
    for (const s of [-1, 1]) {
      const pv = new THREE.Group();
      pv.position.set(s * 0.45, 1.25, -0.6);
      body.add(pv);
      part(new THREE.BoxGeometry(0.13, 0.13, 0.34), dark, 0, -0.04, -0.14, pv);
      arms.push(pv);
    }

    const legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.44, 0.99, 0.12);
      body.add(hip);
      part(new THREE.CylinderGeometry(0.2, 0.15, 0.5, 7), dark, 0, -0.25, 0, hip);
      const knee = new THREE.Group();
      knee.position.set(0, -0.5, 0);
      hip.add(knee);
      part(new THREE.CylinderGeometry(0.14, 0.1, 0.42, 7), green, 0, -0.21, 0, knee);
      part(new THREE.BoxGeometry(0.3, 0.14, 0.52), dark, 0, -0.45, -0.12, knee);
      for (const c of [-1, 0, 1]) part(new THREE.BoxGeometry(0.06, 0.06, 0.1), white, c * 0.09, -0.47, -0.4, knee);
      legs.push({ hip, knee });
    }

    const tail1 = new THREE.Group();
    tail1.position.set(0, 1.08, 0.7);
    body.add(tail1);
    const t1 = part(new THREE.CylinderGeometry(0.2, 0.34, 1.1, 7), green, 0, 0, 0.55, tail1);
    t1.rotation.x = Math.PI / 2;
    const tail2 = new THREE.Group();
    tail2.position.set(0, 0, 1.1);
    tail1.add(tail2);
    const t2 = part(new THREE.CylinderGeometry(0.04, 0.2, 1.0, 7), dark, 0, 0, 0.5, tail2);
    t2.rotation.x = Math.PI / 2;

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
      part(new THREE.BoxGeometry(0.3, 0.2, 0.75), green, 0, -0.12, -0.95, headPivot);
    } else if (v === 'parasaur') {                        // tabung tulang di belakang kepala + paruh bebek
      const tube = part(new THREE.CylinderGeometry(0.06, 0.1, 1.15, 6), spikeM, 0, 0.5, 0.5, headPivot);
      tube.rotation.x = 1.2;
      part(new THREE.BoxGeometry(0.5, 0.1, 0.45), light, 0, -0.2, -0.72, headPivot);
    }

    root.scale.setScalar(p.scale);
    return { root, body, headPivot, arms, legs, tail1, tail2, mats: [green, dark, light] };
  }

  function setGlow(c, v, hex) {
    for (const m of c.mats) { m.emissive.setHex(hex); m.emissiveIntensity = v; }
  }

  // atk: kemajuan gigitan 0..1, atau -1 jika tidak menggigit
  function poseCreature(c, phase, run, air, vy, atk, t) {
    for (let i = 0; i < 2; i++) {
      const L = c.legs[i];
      const ph = phase + i * Math.PI;
      if (air) {
        L.hip.rotation.x = i === 0 ? 0.75 : -0.45;
        L.knee.rotation.x = -0.95;
      } else {
        L.hip.rotation.x = Math.sin(ph) * 0.8 * run;
        L.knee.rotation.x = -0.1 - (0.5 + 0.5 * Math.sin(ph + 1.1)) * 0.8 * run;
      }
    }
    c.body.position.y = air ? 0 : (run > 0.05 ? Math.abs(Math.sin(phase)) * 0.09 * run : Math.sin(t * 2) * 0.02);
    c.body.rotation.x = air ? (vy > 0 ? 0.15 : -0.15) : 0;
    const sway = run > 0.05 ? run : 0.25;
    c.tail1.rotation.y = Math.sin(run > 0.05 ? phase * 0.5 : t * 1.2) * 0.3 * sway;
    c.tail2.rotation.y = Math.sin((run > 0.05 ? phase * 0.5 : t * 1.2) - 0.9) * 0.4 * sway;
    c.tail1.rotation.x = air ? -0.25 : 0;
    for (let i = 0; i < 2; i++) c.arms[i].rotation.x = Math.sin(phase * 2 + i) * 0.45 * run;
    if (atk >= 0) {                                   // gigitan: kepala menyodok ke depan
      const s = Math.sin(Math.PI * atk);
      c.headPivot.position.z = -0.85 - 0.5 * s;
      c.headPivot.rotation.x = 0.55 * s;
    } else {
      c.headPivot.position.z = -0.85;
      c.headPivot.rotation.x = Math.sin(phase * 2) * 0.06 * run;
    }
  }

  // Triceratops: berkaki empat, berkepala berpelindung dengan tiga tanduk (menghadap -Z)
  function makeTrike(p, scale) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const mBody = std(p.body), mDark = std(p.dark), mFrill = std(p.light), mHorn = std(0xf5f0e1);
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
      part(new THREE.BoxGeometry(0.34, 0.1, 0.42), mDark, 0, -0.85, -0.05, hip);
      legs4.push(hip);
    }

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 1.15, -1.25);
    body.add(headPivot);
    part(new THREE.SphereGeometry(0.46, 10, 8), mBody, 0, 0, 0, headPivot);
    part(new THREE.BoxGeometry(0.32, 0.28, 0.45), mDark, 0, -0.12, -0.42, headPivot);     // paruh
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
    return { root, body, headPivot, legs4, tail, mats: [mBody, mDark, mFrill], isTrike: true, hz: -1.25, graze: 0.3, stride: 0.55 };
  }

  function poseTrike(c, phase, run, atk, t) {
    const offs = [0, Math.PI, Math.PI, 0];
    const hz = c.hz === undefined ? -1.25 : c.hz, graze = c.graze === undefined ? 0.3 : c.graze;
    for (let i = 0; i < 4; i++) c.legs4[i].rotation.x = Math.sin(phase * 0.9 + offs[i]) * (c.stride || 0.55) * run;
    c.body.position.y = run > 0.05 ? Math.abs(Math.sin(phase * 0.9)) * 0.05 * run : Math.sin(t * 1.5) * 0.015;
    c.tail.rotation.y = Math.sin(t * 1.4) * 0.2;
    if (atk >= 0) {                                       // menyeruduk dengan tanduk
      const s = Math.sin(Math.PI * atk);
      c.headPivot.position.z = hz - 0.45 * s;
      c.headPivot.rotation.x = 0.35 * s;
    } else {
      c.headPivot.position.z = hz;
      c.headPivot.rotation.x = run > 0.05 ? Math.sin(phase * 0.9) * 0.05 : graze + 0.2 * Math.sin(t * 1.3) * (graze > 0.1 ? 1 : 0.3);   // diam: menunduk makan
    }
  }

  // Herbivora berkaki empat: stegosaurus, ankylosaurus, brachiosaurus, diplodocus (menghadap -Z)
  function makeQuad(p, scale, kind) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const mBody = std(p.body), mDark = std(p.dark), mLight = std(p.light), mPlate = std(p.plate || p.light);
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
      part(new THREE.BoxGeometry(rT * 1.7, 0.1, rT * 2.1), mDark, 0, -L, -0.05, hip);
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
      part(new THREE.BoxGeometry(0.24, 0.22, 0.42), mDark, 0, -0.08, -0.34, headPivot);
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
      part(new THREE.BoxGeometry(0.66, 0.3, 0.6), mBody, 0, 0, 0, headPivot);
      part(new THREE.BoxGeometry(0.5, 0.16, 0.3), mDark, 0, -0.12, -0.38, headPivot);
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
      part(new THREE.BoxGeometry(0.26, 0.22, 0.4), mDark, 0, -0.08, -0.3, headPivot);
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
      part(new THREE.BoxGeometry(0.22, 0.2, 0.36), mDark, 0, -0.07, -0.28, headPivot);
      eye(0.17, 0.09, -0.1, 0.06);
      eye(-0.17, 0.09, -0.1, 0.06);
      tailLen = 3.6;
    }

    tail.position.set(0, ty, 0.95);
    const tm = part(new THREE.ConeGeometry(big ? 0.32 : 0.28, tailLen, 6), mDark, 0, 0, tailLen / 2, tail);
    tm.rotation.x = Math.PI / 2;

    root.scale.setScalar(scale);
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
  const player = {
    x: 0, z: 0, y: 0, vy: 0, vx: 0, vz: 0, yaw: Math.PI,
    hp: 100, hunger: 100, thirst: 100, stamina: 100, exhausted: false,
    invuln: 0, atkT: -1, atkCd: 0, atkHit: false, lastDmg: 99
  };
  const hero = makeCreature(Object.assign({ scale: 1.1 }, PAL_PLAYER));
  scene.add(hero.root);
  const heroShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.8, 18),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })
  );
  heroShadow.rotation.x = -Math.PI / 2;
  scene.add(heroShadow);

  let state = 'menu';               // 'menu' | 'playing' | 'over'
  let time = 0, runTime = 0, clock = 0;
  let runCoins = 0, kills = 0, overAt = 0, startPerf = 0;
  let powerLeft = 0, scaleNow = 1.1, phase = 0, deathReason = '';
  let preds = [], spawnCd = 4, animalCd = 2, chased = false, isNight = false, lastBiome = null;
  let biomeCd = 0, drinkCd = 0, toastT = 0, saveT = 0, hurtT = 0, shake = 0;
  let camGy = 0;
  let camX = 0, camZ = 0, camLead = { x: 0, z: 0 }, lastWet = false, shown = {};

  GameAudio.setIntensity(() => (chased ? 0.95 : isNight ? 0.4 : 0.1));

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
    if (shown.c !== runCoins) { shown.c = runCoins; elCoins.textContent = runCoins; }
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
    hemi.intensity = 0.3 + 0.65 * k;
    sunLight.intensity = 0.12 + 0.7 * k;
    isNight = k < 0.4;
  }

  // ---------- Mulai / selesai ----------
  function startGame() {
    clearWorld();
    for (const p of preds) scene.remove(p.c.root);
    preds = [];
    worldSeed = 1 + Math.floor(Math.random() * 1e6);
    pondCache.clear();
    camGy = 0;
    Object.assign(player, {
      x: 0, z: 0, y: 0, vy: 0, vx: 0, vz: 0, yaw: Math.PI,
      hp: 100, hunger: 100, thirst: 100, stamina: 100, exhausted: false,
      invuln: 0, atkT: -1, atkCd: 0, atkHit: false, lastDmg: 99
    });
    time = 0; runTime = 0; runCoins = 0; kills = 0; powerLeft = 0; scaleNow = 1.1; shake = 0;
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
    if (newBest && days > 0) GameAudio.sfx.record();
    shake = 1;
    $('overReason').textContent = reason;
    $('overDays').textContent = days;
    $('overKills').textContent = kills;
    $('overCoins').textContent = runCoins;
    $('overBest').textContent = newBest && days > 0 ? 'Rekor baru!' : 'Rekor: ' + save.bestDays + ' hari';
    $('overTotal').textContent = save.coins;
    refreshPanels();

    // Titik sambung ke backend / smart contract
    window.dispatchEvent(new CustomEvent('run:end', {
      detail: { coins: runCoins, days, kills, duration: Math.round(performance.now() - startPerf) }
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
  bindBtn(btnSprint, () => { input.sprint = true; }, () => { input.sprint = false; });

  // ketuk di mana saja untuk mulai / main lagi
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    GameAudio.init();
    if (state === 'menu') startGame();
    else if (state === 'over' && performance.now() - overAt > 700) startGame();
  });

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const map = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', shift: 'shift' };
    if (map[k]) keys[map[k]] = true;
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' ', 'enter'].includes(k)) e.preventDefault();
    GameAudio.init();
    if (state !== 'playing') {
      if ((k === ' ' || k === 'enter') && (state === 'menu' || performance.now() - overAt > 700)) startGame();
      return;
    }
    if (k === ' ') input.jump = true;
    else if (k === 'j' || k === 'k') input.attack = true;
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    const map = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', shift: 'shift' };
    if (map[k]) keys[map[k]] = false;
  });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; stickEnd(null); input.sprint = false; });

  if (fsBtn) fsBtn.addEventListener('click', () => {
    try {
      const el = document.documentElement;
      if (!document.fullscreenElement) {
        const p = el.requestFullscreen && el.requestFullscreen();
        const lock = () => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* abaikan */ } };
        if (p && p.then) p.then(lock).catch(() => {}); else lock();
      } else if (document.exitFullscreen) document.exitFullscreen();
    } catch (e) { /* abaikan */ }
  });

  // ---------- Aksi ----------
  function damagePlayer(amount, reason, fromX, fromZ) {
    if (player.invuln > 0 || powerLeft > 0 || state !== 'playing') return false;
    player.hp -= amount;
    player.invuln = 0.7;
    player.lastDmg = 0;
    const dx = player.x - fromX, dz = player.z - fromZ, d = Math.hypot(dx, dz) || 1;
    player.x += (dx / d) * 0.9;
    player.z += (dz / d) * 0.9;
    hurtT = 0.25;
    shake = Math.max(shake, 0.6);
    GameAudio.sfx.hit();
    if (player.hp <= 0) { player.hp = 0; die(reason); }
    return true;
  }

  function damagePred(p, dmg) {
    p.hp -= dmg;
    p.flash = 1;
    const dx = p.x - player.x, dz = p.z - player.z, d = Math.hypot(dx, dz) || 1;
    p.x += (dx / d) * 0.7;
    p.z += (dz / d) * 0.7;
    p.cd = Math.max(p.cd, 0.35);
    if (p.state === 'wander') p.state = p.def.timid ? 'flee' : 'chase';     // yang netral jadi marah, yang penakut kabur
    burst(8, p.x, 1.0 * p.def.scale, p.z);
    if (p.hp <= 0) killPred(p);
  }

  function killPred(p) {
    p.dead = true;
    p.deadT = 0;
    if (!p.def.timid && !p.def.neutral) kills++;                 // hanya predator yang dihitung
    runCoins += p.def.reward;
    save.coins += p.def.reward;
    player.hunger = Math.min(100, player.hunger + p.def.food);
    burst(14, p.x, 1, p.z);
    GameAudio.sfx.smash();
    GameAudio.sfx.eat();
    toast((p.def.reward ? '+' + p.def.reward + ' koin · ' : '') + 'daging +' + p.def.food + ' lapar', 2.2);
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
  }

  function biteHit() {
    const dmg = 18 * (powerLeft > 0 ? 3 : 1);
    const sc = scaleNow / 1.1;
    for (const p of preds) {
      if (p.dead) continue;
      const dx = p.x - player.x, dz = p.z - player.z, d = Math.hypot(dx, dz);
      if (d > 2.4 * sc + p.def.scale * 0.9 + (p.def.hitExtra || 0)) continue;
      if (d > 1.3 && Math.abs(angDiff(player.yaw, faceYaw(dx, dz))) > 1.1) continue;
      damagePred(p, dmg);
    }
  }

  // ---------- Predator ----------
  function spawnPredator(type) {
    const def = PTYPES[type];
    const a = Math.random() * Math.PI * 2, d = rand(36, 46);
    const c = def.model === 'trike' ? makeTrike(def.pal, def.scale)
      : def.model ? makeQuad(def.pal, def.scale, def.model)
      : makeCreature(Object.assign({ scale: def.scale, variant: def.variant }, def.pal));
    scene.add(c.root);
    const p = {
      type, def, c, x: player.x + Math.cos(a) * d, z: player.z + Math.sin(a) * d, yaw: Math.random() * 6,
      hp: def.hp, state: 'wander', t: 0, cd: 1, wdir: null, wanderT: 0, phase: Math.random() * 6,
      flash: 0, dead: false, deadT: 0, roared: false, speedNow: 0
    };
    pushOut(p, 0.8 * def.scale);
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
            p.roared = true; GameAudio.sfx.roar();
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
        const hx = dx / d, hz = dz / d;
        if (d > def.reach * 0.75) {
          sp = def.speed * (isNight ? 1.08 : 1) * (def.aqua && inPond(p.x, p.z) ? 1.3 : 1);
          p.x += hx * sp * dt; p.z += hz * sp * dt;
        }
        p.yaw = lerpAngle(p.yaw, faceYaw(hx, hz), Math.min(1, dt * 10));
        if (d > detect * 1.9) p.state = 'wander';
        else if (d < def.reach && p.cd <= 0) { p.state = 'windup'; p.t = def.windup; }
      } else if (p.state === 'windup') {
        chased = true;
        p.t -= dt;
        p.yaw = lerpAngle(p.yaw, faceYaw(dx / d, dz / d), Math.min(1, dt * 8));
        if (p.t <= 0) {
          if (d < def.reach * 1.35 && player.y < 0.9) damagePlayer(def.dmg, 'Dimangsa ' + def.name, p.x, p.z);
          p.state = 'recover';
          p.t = 0.5;
          p.cd = def.cd;
        }
      } else {                                           // recover
        chased = true;
        p.t -= dt;
        if (p.t <= 0) p.state = 'chase';
      }

      pushOut(p, 0.8 * def.scale);
      p.speedNow = sp;
      if (d > 90) { p.dead = true; p.deadT = 99; }      // terlalu jauh: dibuang
    }

    for (const p of preds) {
      if (p.dead && p.deadT >= 1.6) scene.remove(p.c.root);
    }
    preds = preds.filter((p) => !(p.dead && p.deadT >= 1.6));
  }

  // ---------- Update logika ----------
  function update(dt) {
    runTime += dt;
    applyDayNight();

    // arah gerak dari analog / keyboard
    let ix = input.mx, iz = input.mz;
    if (!stick) {
      ix = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      iz = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
      const l = Math.hypot(ix, iz);
      if (l > 1) { ix /= l; iz /= l; }
    }
    const mag = Math.min(1, Math.hypot(ix, iz));

    // tenaga & lari
    const wantSprint = (input.sprint || keys.shift) && mag > 0.2;
    if (player.stamina <= 0) player.exhausted = true;
    else if (player.stamina >= 25) player.exhausted = false;
    const sprinting = wantSprint && !player.exhausted && player.stamina > 0;
    if (sprinting) player.stamina = Math.max(0, player.stamina - 28 * dt);
    else player.stamina = Math.min(100, player.stamina + (mag > 0.2 ? 12 : 22) * dt);

    const weak = player.hunger <= 0 || player.thirst <= 0;
    const speedMul = (powerLeft > 0 ? 1.25 : 1) * (weak ? 0.85 : 1);
    let slopeMul = 1;                                   // tanjakan memperlambat, turunan sedikit mempercepat
    if (mag > 0.1) {
      const gx = ix / mag, gz = iz / mag;
      const dh = heightAt(player.x + gx, player.z + gz) - heightAt(player.x, player.z);
      slopeMul = Math.min(1.15, Math.max(0.65, 1 - dh * 0.6));
    }
    const target = (sprinting ? SPRINT : WALK) * mag * speedMul * slopeMul;
    const tx = mag > 0 ? (ix / mag) * target : 0, tz = mag > 0 ? (iz / mag) * target : 0;
    const k = Math.min(1, dt * 12);
    player.vx += (tx - player.vx) * k;
    player.vz += (tz - player.vz) * k;
    player.x += player.vx * dt;
    player.z += player.vz * dt;
    pushOut(player, 0.55 * (scaleNow / 1.1));

    const spd = Math.hypot(player.vx, player.vz);
    if (spd > 0.4 && player.atkT < 0) player.yaw = lerpAngle(player.yaw, faceYaw(player.vx, player.vz), Math.min(1, dt * 14));

    // lompat
    if (input.jump) {
      input.jump = false;
      if (player.y === 0 && player.vy === 0) { player.vy = JUMP_V; GameAudio.sfx.jump(); }
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
    player.lastDmg += dt;

    // lapar, haus, nyawa
    player.hunger = Math.max(0, player.hunger - HUNGER_RATE * dt);
    player.thirst = Math.max(0, player.thirst - THIRST_RATE * dt);
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
          }
        }

        for (let i = ch.coins.length - 1; i >= 0; i--) {
          const c = ch.coins[i];
          c.mesh.rotation.y += dt * 4;
          const dx = c.x - player.x, dz = c.z - player.z;
          if (dx * dx + dz * dz < (1.5 * sc) * (1.5 * sc) && player.y < 1.8) {
            taken.add(c.id);
            ch.group.remove(c.mesh);
            ch.coins.splice(i, 1);
            runCoins++;
            save.coins++;
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
  const wingGeo = new THREE.BoxGeometry(1.5, 0.05, 0.6);
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
    const wml = new THREE.Mesh(wingGeo, mW); wml.position.set(-0.75 * sp.span, 0, 0); wml.scale.set(sp.span, 1, 1); wl.add(wml);
    const wmr = new THREE.Mesh(wingGeo, mW); wmr.position.set(0.75 * sp.span, 0, 0); wmr.scale.set(sp.span, 1, 1); wr.add(wmr);
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
    scaleNow += ((powerLeft > 0 ? 1.65 : 1.1) - scaleNow) * Math.min(1, dt * 5);
    hero.root.scale.setScalar(scaleNow);

    let glow = 0;
    if (powerLeft > 0) glow = powerLeft < 2.5 ? 0.25 + 0.25 * Math.sin(clock * 28) : 0.35 + 0.15 * Math.sin(clock * 8);
    else if (player.invuln > 0) glow = 0.45 * Math.sin(clock * 50) > 0 ? 0.4 : 0;
    setGlow(hero, glow, player.invuln > 0 && powerLeft <= 0 ? 0xff0000 : 0xff5a00);

    const spd = Math.hypot(player.vx, player.vz);
    phase += (spd * 1.5 + 1.2) * dt * (spd > 0.4 ? 1 : 0.3);
    const run = clamp(spd / 6, 0, 1.3);
    const air = player.y > 0.001;
    const gy = heightAt(player.x, player.z);
    player.gy = gy;
    hero.root.position.set(player.x, gy + player.y, player.z);
    if (state === 'over') {
      hero.root.rotation.z += (1.4 - hero.root.rotation.z) * Math.min(1, dt * 7);
      hero.root.position.y = gy + 0.15;
    } else {
      hero.root.rotation.z = 0;
      hero.root.rotation.y = player.yaw;
      poseCreature(hero, phase, run, air, player.vy, player.atkT >= 0 ? clamp(player.atkT / 0.35, 0, 1) : -1, clock);
    }
    const s = Math.max(0.5, 1 - player.y / 3.2);
    heroShadow.position.set(player.x, gy + 0.1, player.z);
    heroShadow.scale.set(s * scaleNow, s * scaleNow, 1);

    for (const p of preds) {
      const c = p.c;
      const pgy = heightAt(p.x, p.z);
      c.root.position.set(p.x, pgy, p.z);
      if (p.dead) {
        c.root.rotation.z += (1.5 - c.root.rotation.z) * Math.min(1, dt * 6);
        c.root.position.y = pgy + Math.max(-1.5, -0.6 * Math.max(0, p.deadT - 0.8));
        continue;
      }
      c.root.rotation.y = p.yaw;
      p.phase += (p.speedNow * 1.5 + 0.8) * dt;
      let atk = -1;
      if (p.state === 'windup') atk = clamp(1 - p.t / p.def.windup, 0, 1) * 0.5;      // menarik kepala sebelum menggigit
      else if (p.state === 'recover') atk = 0.5 + clamp(1 - p.t / 0.5, 0, 1) * 0.5;   // menyodok lalu kembali
      if (c.isTrike) poseTrike(c, p.phase, clamp(p.speedNow / 6, 0, 1.3), atk, clock);
      else poseCreature(c, p.phase, clamp(p.speedNow / 6, 0, 1.3), false, 0, atk, clock);
      setGlow(c, p.flash * 0.8, 0xffffff);
    }

    stepPool(dust, dt, 0);
    stepPool(sparks, dt, 9);
    updateAmbient(dt);
  }

  function updateCamera(dt) {
    // kamera mengikuti dari belakang-atas, sedikit melihat ke arah gerak
    const k = Math.min(1, dt * 5);
    camLead.x += (player.vx * 0.35 - camLead.x) * k;
    camLead.z += (player.vz * 0.35 - camLead.z) * k;
    const tx = player.x + camLead.x * 0.6, tz = player.z + camLead.z * 0.6;
    camX += (tx - camX) * Math.min(1, dt * 8);
    camZ += (tz - camZ) * Math.min(1, dt * 8);
    const grow = scaleNow / 1.1;
    let sx = 0, sy = 0;
    if (shake > 0) {
      sx = (Math.random() - 0.5) * shake * 0.5;
      sy = (Math.random() - 0.5) * shake * 0.5;
      shake = Math.max(0, shake - dt * 2.5);
    }
    camGy += ((player.gy || 0) - camGy) * Math.min(1, dt * 4);
    const camBack = camZ + 9.6 * grow;
    const camY = Math.max(camGy + 8.2 * grow, heightAt(camX, camBack) + 3);   // jangan sampai tertutup bukit
    camera.position.set(camX + sx, camY + sy, camBack);
    camera.lookAt(camX, camGy + 0.9, camZ - 1.2);
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
