/* Vosil Runner 3D - game endless runner 3D (Three.js), kamera di belakang dinosaurus.
 *
 * Kontrol:
 *   HP      : geser kiri/kanan = pindah jalur, geser ke atas = lompat,
 *             geser serong = lompat sambil pindah jalur (juga saat di udara),
 *             ketuk sisi kiri / kanan layar = pindah jalur
 *   Komputer: panah kiri/kanan (atau A/D) = pindah jalur, Spasi / panah atas / W = lompat
 *
 * Mode kuat: ambil TELUR yang muncul sesekali. Dino jadi lebih besar dan lebih cepat selama
 * POWER_TIME detik, dan menghancurkan semua rintangan yang ditabrak.
 *
 * Sistem koordinat: jalan memanjang ke arah -Z (menjauhi kamera), dino di z = 0,
 * kamera berada di belakang dan di atas dino (+Z, +Y). Satuan dunia = "meter".
 *
 * Titik sambung ke backend / smart contract (Tahap 3-4): event "run:end"
 * berisi { coins, score, distance, duration }. JANGAN langsung percaya angka koin dari browser.
 * (Mode kuat tidak memberi koin tambahan, supaya ekonomi token tidak terganggu.)
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
    showFatal('Three.js gagal dimuat. Pastikan internet aktif, atau unduh three.min.js (versi r128) dan taruh di folder yang sama dengan index3d.html.');
    return;
  }

  // ---------- Pengaturan ----------
  const LANE_W = 1.9;
  const LANES = [-LANE_W, 0, LANE_W];
  const ROAD_W = LANE_W * 3;
  const ROAD_LEN = 170;
  const SPAWN_Z = -82;            // objek muncul jauh di depan (tersembunyi kabut)
  const DESPAWN_Z = 8;            // objek dibuang setelah lewat di belakang dino
  const START_SPEED = 14;         // meter per detik
  const MAX_SPEED = 32;
  const ACCEL = 0.17;             // tambahan kecepatan per detik
  const GRAVITY = 26;
  const JUMP_V = 9;
  const HIT_CENTER_Z = -0.3;      // titik tengah area tabrakan dino (badan sampai kepala)
  const HIT_HALF_Z = 1.0;
  const HIT_HALF_X = 0.8;
  const LOW_CLEAR = 0.65;         // tinggi lompatan minimal untuk melewati rintangan rendah
  const TAP_MAX_MOVE = 12;        // jari bergeser < 12 px = ketukan
  const TAP_MAX_MS = 450;
  const SAVE_KEY = 'vosil_runner_save_v1';   // dipakai bersama versi 2D (total koin ikut sama)
  const SKY = 0x9fd8f5;

  // mode kuat (telur)
  const POWER_TIME = 8;           // detik lamanya mode kuat
  const POWER_SPEED = 1.4;        // pengali kecepatan saat mode kuat
  const BASE_SCALE = 1.15;        // ukuran dino normal
  const POWER_SCALE = 1.55;       // ukuran dino saat mode kuat
  const POWER_GRACE = 0.6;        // detik tambahan "kebal" setelah mode kuat habis
  const EGG_FIRST_M = [180, 260]; // telur pertama muncul setelah sekian meter
  const EGG_EVERY_M = [420, 650]; // jarak antar telur berikutnya (meter)

  // kamera
  const CAM_H = 6.2, CAM_Z = 8.5, LOOK_Z = -7;

  // ---------- Elemen halaman ----------
  const canvas = $('game');
  const hudEl = $('hud'), menuEl = $('menu'), overEl = $('over');
  const powerEl = $('power'), powerFill = $('powerFill');
  const elRunCoins = $('runCoins'), elDist = $('dist');
  const elMenuTotal = $('menuTotal'), elMenuBest = $('menuBest');
  const elOverDist = $('overDist'), elOverCoins = $('overCoins');
  const elOverBest = $('overBest'), elOverTotal = $('overTotal');

  // ---------- Penyimpanan lokal ----------
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && typeof s.totalCoins === 'number') {
        if (typeof s.best3d !== 'number') s.best3d = 0;
        return s;
      }
    } catch (e) { /* abaikan */ }
    return { totalCoins: 0, best: 0, best3d: 0 };
  }
  function writeSave() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* abaikan */ }
  }
  const save = loadSave();

  // ---------- Renderer, scene, kamera ----------
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (e1) {
    try {                                   // coba lagi dengan pengaturan paling ringan
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
    } catch (e2) {
      showFatal('WebGL tidak bisa dijalankan di browser ini. Buka lewat Chrome atau Safari langsung (bukan dari dalam WhatsApp/Instagram/Telegram), matikan mode hemat baterai, lalu buka webgl-test.html untuk diagnosis. Versi 2D (index.html) tetap bisa dimainkan.');
      return;
    }
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(SKY);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 32, 85);

  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 160);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7a9a5a, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(-6, 12, 8);
  scene.add(sun);

  let baseFov = 65, shownFov = 65;
  function resize() {
    const w = window.innerWidth || 400, h = window.innerHeight || 700;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // atur sudut pandang supaya ketiga jalur selalu terlihat penuh (HP portrait maupun layar lebar)
    const d = Math.hypot(CAM_H, CAM_Z);
    const need = 7.8;
    const fov = 2 * Math.atan(need / (2 * d * camera.aspect)) * 180 / Math.PI;
    baseFov = Math.max(48, Math.min(78, fov));
    camera.fov = baseFov;
    shownFov = baseFov;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();

  // ---------- Bahan & bantuan ----------
  const std = (color, extra) =>
    new THREE.MeshStandardMaterial(Object.assign({ color, flatShading: true, roughness: 0.85, metalness: 0 }, extra || {}));
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------- Dunia: jalan tanah, rumput, pemandangan prasejarah ----------
  function makeRoadTexture() {
    const W = 192, H = 128;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');

    // tanah dasar
    g.fillStyle = '#8a6a46';
    g.fillRect(0, 0, W, H);

    // semua gambar diulang di sisi atas/bawah supaya pola menyambung mulus saat diulang sepanjang jalan
    const wrapY = (y, r, fn) => { fn(y); if (y - r < 0) fn(y + H); if (y + r > H) fn(y - H); };
    const blob = (x, y, r, rgb, a) => wrapY(y, r, (yy) => {
      const grad = g.createRadialGradient(x, yy, 0, x, yy, r);
      grad.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
      grad.addColorStop(1, 'rgba(' + rgb + ',0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, yy, r, 0, Math.PI * 2); g.fill();
    });

    for (let i = 0; i < 34; i++) blob(rand(0, W), rand(0, H), rand(10, 26), '58,38,20', rand(0.10, 0.22));      // tanah gelap
    for (let i = 0; i < 30; i++) blob(rand(0, W), rand(0, H), rand(8, 22), '205,165,115', rand(0.08, 0.18));   // tanah berdebu

    for (let i = 0; i < 900; i++) {                          // butiran halus
      g.fillStyle = Math.random() < 0.5 ? 'rgba(40,25,10,0.18)' : 'rgba(230,200,150,0.14)';
      g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }

    for (let i = 0; i < 70; i++) {                           // kerikil
      const x = rand(10, W - 10), y = rand(0, H), r = rand(1.5, 4);
      const col = Math.random() < 0.5 ? '#9b8a76' : '#7d6c58';
      wrapY(y, r, (yy) => {
        g.fillStyle = 'rgba(40,28,16,0.35)';
        g.beginPath(); g.ellipse(x + 1, yy + 1.5, r, r * 0.7, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = col;
        g.beginPath(); g.ellipse(x, yy, r, r * 0.75, 0, 0, Math.PI * 2); g.fill();
      });
    }

    g.strokeStyle = 'rgba(40,25,10,0.45)';                   // retakan tanah kering
    g.lineWidth = 1.5;
    g.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      let x = rand(12, W - 12), y = rand(6, H - 60);
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += rand(-8, 8); y += rand(5, 10); g.lineTo(x, y); }
      g.stroke();
    }

    // jejak kaki dinosaurus berjari tiga
    const print = (cx, cy, rot, s) => {
      g.save();
      g.translate(cx, cy);
      g.rotate(rot);
      g.scale(s, s);
      g.fillStyle = 'rgba(45,28,12,0.40)';
      g.beginPath(); g.ellipse(0, 6, 6, 7, 0, 0, Math.PI * 2); g.fill();
      for (const a of [-0.65, 0, 0.65]) {
        g.save();
        g.rotate(a);
        g.beginPath(); g.ellipse(0, -7, 2.6, 7, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      g.restore();
    };
    print(32, 36, 0.10, 1.0);
    print(96, 100, -0.08, 1.15);
    print(160, 64, 0.12, 1.0);
    print(96, 34, 0.05, 1.1);

    for (const lx of [64, 128]) {                            // garis pemisah jalur: alur debu terang putus-putus
      g.fillStyle = 'rgba(235,205,155,0.55)';
      g.fillRect(lx - 2, 4, 4, 56);
      g.fillStyle = 'rgba(40,25,10,0.28)';
      g.fillRect(lx + 2, 4, 2, 56);
    }

    g.fillStyle = 'rgba(35,22,10,0.45)';                     // tepi jalan berbatu
    g.fillRect(0, 0, 8, H);
    g.fillRect(W - 8, 0, 8, H);
    for (let i = 0; i < 26; i++) {
      const y = (i / 26) * H + rand(-2, 2), r = rand(3, 5.5);
      for (const x of [rand(3, 7), W - rand(3, 7)]) {
        const col = Math.random() < 0.5 ? '#8d7f70' : '#6f6256';
        wrapY(y, r, (yy) => {
          g.fillStyle = col;
          g.beginPath(); g.ellipse(x, yy, r, r * 0.8, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = 'rgba(255,255,255,0.18)';
          g.beginPath(); g.ellipse(x - 1, yy - 1, r * 0.45, r * 0.35, 0, 0, Math.PI * 2); g.fill();
        });
      }
    }

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, ROAD_LEN / 8);                        // satu pola = 8 meter
    try { tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); } catch (e) { /* abaikan */ }
    return tex;
  }
  const roadTex = makeRoadTexture();

  const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, ROAD_LEN), new THREE.MeshBasicMaterial({ map: roadTex }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, 20 - ROAD_LEN / 2);
  scene.add(road);

  const grass = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), new THREE.MeshLambertMaterial({ color: 0x66a84a }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(0, -0.05, -90);
  scene.add(grass);

  // matahari hangat & gunung berapi di kejauhan
  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffe9a8, fog: false }));
  sunDisc.position.set(-40, 30, -130);
  scene.add(sunDisc);

  const volcano = new THREE.Mesh(new THREE.ConeGeometry(28, 36, 10), new THREE.MeshBasicMaterial({ color: 0x7b5e57, fog: false }));
  volcano.position.set(30, 13, -120);
  scene.add(volcano);
  const crater = new THREE.Mesh(new THREE.ConeGeometry(7, 7, 10), new THREE.MeshBasicMaterial({ color: 0xff7a2f, fog: false }));
  crater.position.set(30, 28.5, -120);
  scene.add(crater);

  // pohon, pakis purba (cycad) & batu di kiri-kanan jalan (bergerak mendekat lalu dipakai ulang)
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.24, 1.2, 6);
  const leafGeo1 = new THREE.ConeGeometry(1.1, 2.0, 7);
  const leafGeo2 = new THREE.ConeGeometry(0.8, 1.6, 7);
  const rockGeo = new THREE.DodecahedronGeometry(0.7, 0);
  const stemGeo = new THREE.CylinderGeometry(0.2, 0.3, 1.0, 6);
  const bladeGeo = new THREE.ConeGeometry(0.16, 2.0, 4);
  const trunkMat = std(0x8d6e63), leafMat1 = std(0x2e9e4f), leafMat2 = std(0x3cb85e), rockMat = std(0x9e9e9e);
  const fernMat1 = std(0x3f9b3f), fernMat2 = std(0x5bb347);

  function makeTree() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat); trunk.position.y = 0.6; g.add(trunk);
    const l1 = new THREE.Mesh(leafGeo1, leafMat1); l1.position.y = 1.9; g.add(l1);
    const l2 = new THREE.Mesh(leafGeo2, leafMat2); l2.position.y = 3.0; g.add(l2);
    g.scale.setScalar(rand(0.8, 1.4));
    return g;
  }
  function makeCycad() {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(stemGeo, trunkMat);
    stem.position.y = 0.5;
    g.add(stem);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const pv = new THREE.Group();
      pv.position.y = 1.0;
      pv.rotation.y = (i / n) * Math.PI * 2;
      const tilt = new THREE.Group();
      tilt.rotation.z = -1.05;                     // daun melengkung keluar
      const blade = new THREE.Mesh(bladeGeo, i % 2 ? fernMat1 : fernMat2);
      blade.position.y = 1.0;
      blade.scale.x = 2.2;
      tilt.add(blade);
      pv.add(tilt);
      g.add(pv);
    }
    g.scale.setScalar(rand(0.9, 1.6));
    return g;
  }
  function makeRock() {
    const g = new THREE.Group();
    const r = new THREE.Mesh(rockGeo, rockMat);
    r.position.y = 0.35;
    r.scale.set(rand(0.8, 1.6), rand(0.6, 1.0), rand(0.8, 1.4));
    r.rotation.y = rand(0, 6);
    g.add(r);
    return g;
  }

  const SCEN_LEN = 140;
  const SCEN_PER_SIDE = 18;
  const scenery = [];
  const sceneryX = (side) => side * (ROAD_W / 2 + 2.2 + Math.random() * 12);
  for (const side of [-1, 1]) {
    for (let i = 0; i < SCEN_PER_SIDE; i++) {
      const r = Math.random();
      const obj = r < 0.2 ? makeRock() : (r < 0.55 ? makeCycad() : makeTree());
      obj.position.set(sceneryX(side), 0, 14 - (i + Math.random() * 0.8) * (SCEN_LEN / SCEN_PER_SIDE));
      scene.add(obj);
      scenery.push({ obj, side });
    }
  }

  // ---------- Dinosaurus low-poly (dibangun dari bentuk sederhana) ----------
  function buildDino() {
    const root = new THREE.Group();     // posisi dunia, miring, belok, ukuran
    const body = new THREE.Group();     // naik-turun saat berlari
    root.add(body);

    const green = std(0x4caf50), dark = std(0x2e7d32), light = std(0xaed581), spikeM = std(0xffb300);
    const white = std(0xffffff, { flatShading: false }), black = std(0x111111, { flatShading: false });
    const part = (geo, mat, x, y, z, parent) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      (parent || body).add(m);
      return m;
    };

    // badan
    const torso = part(new THREE.SphereGeometry(0.62, 10, 8), green, 0, 1.15, 0);
    torso.scale.set(0.85, 0.8, 1.25);
    const belly = part(new THREE.SphereGeometry(0.55, 8, 6), light, 0, 0.98, -0.05);
    belly.scale.set(0.8, 0.6, 1.15);

    // duri punggung (terlihat jelas dari belakang)
    for (let i = 0; i < 6; i++) {
      const z = -0.6 + i * 0.26;
      const h = 0.42 - i * 0.04;
      const topY = 1.15 + 0.496 * Math.sqrt(Math.max(0, 1 - (z / 0.775) * (z / 0.775)));
      part(new THREE.ConeGeometry(0.14, h, 5), spikeM, 0, topY + h / 2 - 0.04, z);
    }

    // leher & kepala
    part(new THREE.SphereGeometry(0.34, 8, 6), green, 0, 1.45, -0.7);
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 1.62, -0.85);
    body.add(headPivot);
    part(new THREE.SphereGeometry(0.42, 10, 8), green, 0, 0, 0, headPivot);
    part(new THREE.BoxGeometry(0.46, 0.32, 0.6), green, 0, -0.1, -0.42, headPivot);   // moncong
    part(new THREE.BoxGeometry(0.4, 0.12, 0.5), dark, 0, -0.3, -0.38, headPivot);     // rahang
    for (const s of [-1, 1]) {
      part(new THREE.SphereGeometry(0.1, 8, 6), white, s * 0.27, 0.12, -0.2, headPivot);
      part(new THREE.SphereGeometry(0.055, 6, 6), black, s * 0.33, 0.12, -0.25, headPivot);
    }

    // tangan kecil
    const arms = [];
    for (const s of [-1, 1]) {
      const pv = new THREE.Group();
      pv.position.set(s * 0.45, 1.25, -0.6);
      body.add(pv);
      part(new THREE.BoxGeometry(0.13, 0.13, 0.34), dark, 0, -0.04, -0.14, pv);
      arms.push(pv);
    }

    // kaki (paha + betis + telapak), diputar dari pangkal paha dan lutut
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

    // ekor dua ruas supaya bisa melengkung saat bergoyang
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

    root.scale.setScalar(BASE_SCALE);
    return { root, body, headPivot, arms, legs, tail1, tail2, mats: [green, dark, light] };
  }
  const dino = buildDino();
  scene.add(dino.root);

  // bayangan bulat di jalan
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.75, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, 0.03, 0.1);
  scene.add(shadow);

  // ---------- Partikel: debu, percikan api, serpihan ----------
  function makePool(n, geo, mat) {
    const arr = [];
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      arr.push({ mesh, life: 1, max: 1, vx: 0, vy: 0, vz: 0, base: 1, spin: 0 });
    }
    return arr;
  }
  function emitTo(pool, x, y, z, o) {
    const p = pool.find((q) => q.life >= q.max);
    if (!p) return null;
    p.life = 0;
    p.max = o.max;
    p.vx = o.vx; p.vy = o.vy; p.vz = o.vz || 0;
    p.base = o.base;
    p.spin = o.spin || 0;
    p.mesh.visible = true;
    p.mesh.position.set(x, y, z);
    p.mesh.scale.setScalar(p.base);
    return p;
  }
  function stepPool(pool, dt, worldSpeed, follow, gravity) {
    for (const p of pool) {
      if (p.life >= p.max) continue;
      p.life += dt;
      if (p.life >= p.max) { p.mesh.visible = false; continue; }
      p.vy -= gravity * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y = Math.max(0.05, p.mesh.position.y + p.vy * dt);
      p.mesh.position.z += (worldSpeed * follow + p.vz) * dt;
      if (p.spin) { p.mesh.rotation.x += p.spin * dt; p.mesh.rotation.y += p.spin * 0.7 * dt; }
      const f = p.life / p.max;
      p.mesh.scale.setScalar(Math.max(0.01, p.base * (1 - f)));
    }
  }

  const dust = makePool(48, new THREE.IcosahedronGeometry(0.16, 0), new THREE.MeshBasicMaterial({ color: 0xe6d5ae }));
  const sparks = makePool(48, new THREE.IcosahedronGeometry(0.12, 0), new THREE.MeshBasicMaterial({ color: 0xffa726 }));
  const debris = makePool(48, new THREE.BoxGeometry(0.35, 0.35, 0.35), std(0xffffff));

  function emitDust(n, x, z, spread) {
    for (let i = 0; i < n; i++) {
      emitTo(dust, x + rand(-spread, spread) / 2, 0.12, z + rand(-0.2, 0.2),
        { max: rand(0.35, 0.65), vx: rand(-0.6, 0.6), vy: rand(0.8, 2.0), base: rand(0.7, 1.5) });
    }
  }
  function emitSparks(n, x, y, z) {
    for (let i = 0; i < n; i++) {
      emitTo(sparks, x + rand(-0.5, 0.5), y + rand(-0.3, 0.6), z + rand(0, 0.8),
        { max: rand(0.3, 0.6), vx: rand(-1.5, 1.5), vy: rand(1, 3), vz: rand(2, 6), base: rand(0.6, 1.3) });
    }
  }

  // ---------- Rintangan, koin, telur ----------
  const geoLow = new THREE.BoxGeometry(LANE_W * 0.86, 0.9, 0.7);
  const geoStripe = new THREE.BoxGeometry(0.3, 0.92, 0.72);
  const geoHigh = new THREE.BoxGeometry(LANE_W * 0.86, 2.0, 1.3);
  const geoBand = new THREE.BoxGeometry(LANE_W * 0.9, 0.2, 1.34);
  const geoTop = new THREE.BoxGeometry(LANE_W * 0.9, 0.1, 1.34);
  const matOrange = std(0xff7043), matWhite = std(0xfafafa), matBrown = std(0x8d6e63);
  const matDark = std(0x4e342e), matLightBrown = std(0xa1887f);

  const coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.12, 14);
  const coinInGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.14, 12);
  const coinMat = std(0xffc107, { metalness: 0.5, roughness: 0.35, emissive: 0x6b4a00 });
  const coinInMat = std(0xffe082, { emissive: 0x4a3600 });

  const eggGeo = new THREE.SphereGeometry(0.42, 12, 10);
  const eggMat = std(0xfff3d6, { emissive: 0x3a2a10 });
  const spotGeo = new THREE.SphereGeometry(0.09, 6, 6);
  const spotMat = std(0x6aa84f);
  const ringGeo = new THREE.TorusGeometry(0.62, 0.045, 6, 24);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.85, depthWrite: false });

  let obstacles = [], coins = [];

  function addObstacle(type, lane, z) {
    const g = new THREE.Group();
    let depth;
    if (type === 'low') {                    // pagar belang: bisa dilompati
      depth = 0.7;
      const base = new THREE.Mesh(geoLow, matOrange); base.position.y = 0.45; g.add(base);
      for (const sx of [-0.6, 0, 0.6]) {
        const s = new THREE.Mesh(geoStripe, matWhite); s.position.set(sx, 0.45, 0); g.add(s);
      }
    } else {                                 // peti kayu tinggi: harus dihindari
      depth = 1.3;
      const crate = new THREE.Mesh(geoHigh, matBrown); crate.position.y = 1.0; g.add(crate);
      for (const by of [0.45, 1.55]) {
        const b = new THREE.Mesh(geoBand, matDark); b.position.y = by; g.add(b);
      }
      const top = new THREE.Mesh(geoTop, matLightBrown); top.position.y = 2.04; g.add(top);
    }
    g.position.set(LANES[lane], 0, z);
    scene.add(g);
    obstacles.push({ mesh: g, lane, type, z, depth, dead: false });
  }

  function addCoin(lane, z, y) {
    const g = new THREE.Group();
    const a = new THREE.Mesh(coinGeo, coinMat); a.rotation.x = Math.PI / 2; g.add(a);
    const b = new THREE.Mesh(coinInGeo, coinInMat); b.rotation.x = Math.PI / 2; g.add(b);
    g.position.set(LANES[lane], y, z);
    scene.add(g);
    coins.push({ mesh: g, lane, z, y, egg: false, ring: null });
  }
  function coinLine(lane, z, n) {
    for (let i = 0; i < n; i++) addCoin(lane, z - i * 2.0, 1.0);
  }

  function addEgg(lane, z) {
    const g = new THREE.Group();
    const e = new THREE.Mesh(eggGeo, eggMat);
    e.scale.set(0.9, 1.25, 0.9);
    g.add(e);
    const rx = 0.42 * 0.9, ry = 0.42 * 1.25;
    for (const [th, ph] of [[1.3, 1.0], [1.9, 1.5], [1.6, 0.55], [2.5, 0.95], [0.8, 1.45]]) {   // bintik hijau
      const s = new THREE.Mesh(spotGeo, spotMat);
      s.position.set(rx * Math.sin(ph) * Math.cos(th), ry * Math.cos(ph), rx * Math.sin(ph) * Math.sin(th));
      g.add(s);
    }
    const ring = new THREE.Mesh(ringGeo, ringMat);          // cincin cahaya penanda barang spesial
    g.add(ring);
    g.position.set(LANES[lane], 1.15, z);
    scene.add(g);
    coins.push({ mesh: g, lane, z, y: 1.15, egg: true, ring });
  }

  function spawnPattern() {
    const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);
    // jalur yang berisi telur dibiarkan bebas rintangan
    const egg = coins.find((c) => c.egg && c.z < SPAWN_Z + 14);
    if (egg) { lanes.splice(lanes.indexOf(egg.lane), 1); lanes.push(egg.lane); }

    const r = Math.random();
    if (r < 0.5) {
      // rintangan di 1-2 jalur, minimal satu jalur selalu kosong
      const count = Math.random() < 0.4 ? 2 : 1;
      for (let i = 0; i < count; i++) addObstacle(Math.random() < 0.5 ? 'low' : 'high', lanes[i], SPAWN_Z);
      if (!egg && Math.random() < 0.6) coinLine(lanes[2], SPAWN_Z, 4);
    } else if (r < 0.8) {
      coinLine(lanes[0], SPAWN_Z, 5);
    } else {
      // pagar rendah dengan koin melayang di atasnya (hadiah untuk yang melompat)
      addObstacle('low', lanes[0], SPAWN_Z);
      for (let i = -1; i <= 1; i++) addCoin(lanes[0], SPAWN_Z + i * 1.8, 1.9);
    }
  }

  // hancurkan rintangan jadi serpihan (dipakai saat mode kuat)
  function smashObstacle(o) {
    const mats = o.type === 'low' ? [matOrange, matWhite] : [matBrown, matDark, matLightBrown];
    const x = LANES[o.lane];
    for (let i = 0; i < 9; i++) {
      const p = emitTo(debris, x + rand(-0.6, 0.6), rand(0.3, 1.6), o.z + rand(-0.4, 0.4),
        { max: rand(0.7, 1.1), vx: rand(-5, 5), vy: rand(4, 9), vz: -rand(4, 14), base: rand(0.6, 1.3), spin: rand(-12, 12) });
      if (p) p.mesh.material = mats[i % mats.length];
    }
    scene.remove(o.mesh);
    shake = Math.max(shake, 0.35);
    GameAudio.sfx.smash();
  }

  // ---------- State game ----------
  let state = 'menu';             // 'menu' | 'playing' | 'over'
  const player = { lane: 1, x: 0, y: 0, vy: 0 };
  let speed = START_SPEED, effSpeed = START_SPEED, boost = 1;
  let distance = 0, runCoins = 0, nextSpawn = 0, smashed = 0;
  let startTime = 0, overAt = 0, overT = 0, newBest = false;
  let gesture = null, shake = 0, time = 0;
  let phase = 0, lastCycle = 0, dustTimer = 0, dustSide = 1;
  let powerLeft = 0, grace = 0, eggDist = 0, curScale = BASE_SCALE, sparkTimer = 0;
  let fovKick = 0, camZ = CAM_Z;
  let shownCoins = -1, shownDist = -1, shownPower = -1;

  GameAudio.setIntensity(() =>
    Math.min(1, (speed - START_SPEED) / (MAX_SPEED - START_SPEED) + (powerLeft > 0 ? 0.35 : 0)));

  function clearObjects() {
    for (const o of obstacles) scene.remove(o.mesh);
    for (const c of coins) scene.remove(c.mesh);
    obstacles = [];
    coins = [];
    for (const pool of [dust, sparks, debris]) {
      for (const p of pool) { p.life = p.max; p.mesh.visible = false; }
    }
  }

  function refreshPanels() {
    hudEl.classList.toggle('hidden', state !== 'playing');
    menuEl.classList.toggle('hidden', state !== 'menu');
    overEl.classList.toggle('hidden', state !== 'over');
    if (powerEl && state !== 'playing') powerEl.classList.add('hidden');
    elMenuTotal.textContent = save.totalCoins;
    elMenuBest.textContent = save.best3d;
  }

  function updateHud() {
    const d = Math.floor(distance);
    if (runCoins !== shownCoins) { elRunCoins.textContent = runCoins; shownCoins = runCoins; }
    if (d !== shownDist) { elDist.textContent = d; shownDist = d; }
    if (powerEl) {
      const p = powerLeft > 0 ? Math.max(0, Math.min(100, Math.round(powerLeft / POWER_TIME * 100))) : 0;
      if (p !== shownPower) {
        shownPower = p;
        if (powerFill) powerFill.style.width = p + '%';
      }
      powerEl.classList.toggle('warn', powerLeft > 0 && powerLeft < 2);   // berkedip saat hampir habis
    }
  }

  function startPower() {
    const wasActive = powerLeft > 0;
    powerLeft = POWER_TIME;
    grace = 0;
    eggDist = rand(EGG_EVERY_M[0], EGG_EVERY_M[1]);
    shake = Math.max(shake, 0.3);
    if (!wasActive) GameAudio.sfx.power();
    if (powerEl) powerEl.classList.remove('hidden');
  }
  function endPower() {
    powerLeft = 0;
    grace = POWER_GRACE;
    GameAudio.sfx.powerEnd();
    if (powerEl) powerEl.classList.add('hidden');
  }

  function startGame() {
    clearObjects();
    player.lane = 1; player.x = 0; player.y = 0; player.vy = 0;
    speed = START_SPEED; effSpeed = START_SPEED; boost = 1;
    distance = 0; runCoins = 0; nextSpawn = 0; smashed = 0;
    newBest = false; shake = 0; overT = 0; dustTimer = 0; sparkTimer = 0;
    powerLeft = 0; grace = 0; curScale = BASE_SCALE; fovKick = 0; camZ = CAM_Z;
    eggDist = rand(EGG_FIRST_M[0], EGG_FIRST_M[1]);
    lastCycle = Math.floor(phase / (Math.PI * 2));
    dino.root.rotation.set(0, 0, 0);
    dino.body.rotation.x = 0;
    state = 'playing';
    startTime = performance.now();
    gesture = null;
    shownCoins = -1; shownDist = -1; shownPower = -1;
    refreshPanels();
    updateHud();
    GameAudio.sfx.start();
    GameAudio.music.start();
  }

  function gameOver() {
    state = 'over';
    overAt = performance.now();
    overT = 0;
    shake = 1;
    powerLeft = 0; grace = 0;
    GameAudio.music.stop();
    GameAudio.sfx.crash();

    const finalScore = Math.floor(distance);
    if (finalScore > save.best3d) { save.best3d = finalScore; newBest = true; }
    if (newBest) GameAudio.sfx.record();
    save.totalCoins += runCoins;
    writeSave();

    elOverDist.textContent = finalScore;
    elOverCoins.textContent = runCoins;
    elOverBest.textContent = newBest ? 'Rekor baru!' : 'Rekor: ' + save.best3d + ' m';
    elOverTotal.textContent = save.totalCoins;
    refreshPanels();

    // Titik sambung ke backend / smart contract (Tahap 3-4)
    window.dispatchEvent(new CustomEvent('run:end', {
      detail: {
        coins: runCoins,
        score: finalScore,
        distance: Math.floor(distance),
        duration: Math.round(performance.now() - startTime)
      }
    }));
  }

  // ---------- Aksi pemain ----------
  function moveLane(dir) {
    const before = player.lane;
    player.lane = Math.max(0, Math.min(2, player.lane + dir));
    if (player.lane !== before) GameAudio.sfx.lane();
  }
  function jump() {
    if (player.y === 0 && player.vy === 0) {
      player.vy = JUMP_V;
      GameAudio.sfx.jump();
    }
  }

  // ---------- Input sentuh / mouse ----------
  // Geser kiri / kanan = pindah jalur (bisa berkali-kali dalam satu geseran)
  // Geser ke atas      = lompat
  // Geser serong       = lompat sambil pindah jalur (boleh juga saat di udara)
  // Ketuk kiri / kanan = pindah jalur
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    GameAudio.init();

    if (state === 'menu') { startGame(); gesture = null; return; }
    if (state === 'over') {
      if (performance.now() - overAt > 500) startGame();
      gesture = null;
      return;
    }

    gesture = {
      id: e.pointerId,
      x0: e.clientX, y0: e.clientY,          // titik sentuh awal (untuk ketukan)
      ax: e.clientX, ay: e.clientY,          // titik acuan geseran (digeser ulang tiap aksi)
      t: performance.now(),
      acted: false,
      thx: Math.max(14, window.innerWidth * 0.055),    // jarak geser menyamping untuk 1 kali pindah jalur
      thy: Math.max(18, window.innerHeight * 0.035)    // jarak geser ke atas untuk lompat
    };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* abaikan */ }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!gesture || e.pointerId !== gesture.id || state !== 'playing') return;
    const g = gesture;
    const dx = e.clientX - g.ax;
    const dy = e.clientY - g.ay;

    // ke atas = lompat (serong tetap dihitung), langsung saat jari bergeser tanpa menunggu jari diangkat
    if (dy < -g.thy && -dy > Math.abs(dx) * 0.5) {
      jump();
      g.acted = true;
      g.ay = e.clientY;
    }
    // menyamping = pindah jalur; terus bergeser = pindah lagi
    if (Math.abs(dx) >= g.thx) {
      moveLane(dx < 0 ? -1 : 1);
      g.acted = true;
      g.ax = e.clientX;
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!gesture || e.pointerId !== gesture.id) return;
    const g = gesture;
    gesture = null;
    if (state !== 'playing' || g.acted) return;

    const moved = Math.hypot(e.clientX - g.x0, e.clientY - g.y0);
    if (moved <= TAP_MAX_MOVE && performance.now() - g.t <= TAP_MAX_MS) {
      moveLane(g.x0 < window.innerWidth / 2 ? -1 : 1);
    }
  });

  canvas.addEventListener('pointercancel', () => { gesture = null; });

  // ---------- Input keyboard ----------
  window.addEventListener('keydown', (e) => {
    const k = e.key;
    const handled = ['ArrowLeft', 'ArrowRight', 'ArrowUp', ' ', 'a', 'A', 'd', 'D', 'w', 'W', 'Enter'].includes(k);
    if (handled) e.preventDefault();
    GameAudio.init();

    if (state !== 'playing') {
      if ((k === ' ' || k === 'Enter') && (state === 'menu' || performance.now() - overAt > 500)) startGame();
      return;
    }
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') moveLane(-1);
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') moveLane(1);
    else if (k === 'ArrowUp' || k === ' ' || k === 'w' || k === 'W') jump();
  });

  // ---------- Update logika ----------
  function update(dt) {
    speed = Math.min(MAX_SPEED, speed + ACCEL * dt);

    // mode kuat: hitung mundur, kecepatan naik-turun dengan mulus
    if (powerLeft > 0) {
      powerLeft -= dt;
      if (powerLeft <= 0) endPower();
    } else if (grace > 0) {
      grace = Math.max(0, grace - dt);
    }
    boost += ((powerLeft > 0 ? POWER_SPEED : 1) - boost) * Math.min(1, dt * 3);
    effSpeed = speed * boost;
    const dz = effSpeed * dt;
    distance += dz;

    const scaleK = curScale / BASE_SCALE;                 // dino besar = area tabrakan & jangkauan lebih besar
    const cz = HIT_CENTER_Z * scaleK;

    // gerak halus ke jalur tujuan
    player.x += (LANES[player.lane] - player.x) * Math.min(1, 16 * dt);

    // lompat & gravitasi
    if (player.y > 0 || player.vy > 0) {
      player.vy -= GRAVITY * dt;
      player.y += player.vy * dt;
      if (player.y <= 0) {
        player.y = 0;
        player.vy = 0;
        emitDust(8, player.x, 0.6, 1.0);
        GameAudio.sfx.land();
      }
    }

    // debu saat berlari, percikan api saat mode kuat
    dustTimer += dz;
    if (player.y === 0 && dustTimer > 5) {
      dustTimer = 0;
      dustSide = -dustSide;
      emitDust(1, player.x + dustSide * 0.4, 0.6, 0.2);
    }
    if (powerLeft > 0) {
      sparkTimer -= dt;
      if (sparkTimer <= 0) {
        sparkTimer = 0.04;
        emitSparks(2, player.x, player.y + 0.7 * scaleK, 0.8);
      }
    }

    // munculkan pola baru
    nextSpawn -= dz;
    if (nextSpawn <= 0) {
      spawnPattern();
      nextSpawn = Math.max(16, effSpeed * rand(0.85, 1.3));
    }

    // munculkan telur sesekali (tidak saat mode kuat, dan tidak menumpuk dengan objek lain)
    eggDist -= dz;
    if (eggDist <= 0 && powerLeft <= 0 && !coins.some((c) => c.egg)) {
      const z = SPAWN_Z - 6;
      const lane = [0, 1, 2].sort(() => Math.random() - 0.5).find((l) =>
        !obstacles.some((o) => o.lane === l && Math.abs(o.z - z) < 7) &&
        !coins.some((c) => c.lane === l && Math.abs(c.z - z) < 7));
      if (lane !== undefined) {
        addEgg(lane, z);
        eggDist = rand(EGG_EVERY_M[0], EGG_EVERY_M[1]);
      }
    }

    // gerakkan rintangan
    obstacles = obstacles.filter((o) => {
      o.z += dz;
      o.mesh.position.z = o.z;
      if (o.z > DESPAWN_Z) { scene.remove(o.mesh); return false; }
      return true;
    });

    // gerakkan & ambil koin / telur
    coins = coins.filter((c) => {
      c.z += dz;
      c.mesh.position.z = c.z;
      if (c.egg) {
        c.mesh.rotation.y += dt * 2.5;
        c.mesh.position.y = c.y + Math.sin(time * 4 + c.z * 0.3) * 0.12;
        if (c.ring) c.ring.rotation.z += dt * 2;
      } else {
        c.mesh.rotation.y += dt * 4;
      }
      if (c.z > DESPAWN_Z) { scene.remove(c.mesh); return false; }
      const reachZ = (c.egg ? 1.5 : 1.2) * scaleK;
      const reachX = (c.egg ? 1.1 : 0.95) * scaleK;
      const reachY = c.egg ? 1.0 : 0.75;
      if (Math.abs(c.z - cz) < reachZ &&
          Math.abs(player.x - LANES[c.lane]) < reachX &&
          Math.abs(player.y + 0.9 * scaleK - c.y) < reachY) {
        if (c.egg) startPower();
        else { runCoins++; GameAudio.sfx.coin(); }
        scene.remove(c.mesh);
        return false;
      }
      return true;
    });

    // tabrakan: biasa = game over, mode kuat = rintangan hancur
    const hz = HIT_HALF_Z * scaleK, hx = HIT_HALF_X * scaleK;
    const unstoppable = powerLeft > 0 || grace > 0;
    for (const o of obstacles) {
      if (Math.abs(o.z - cz) < o.depth / 2 + hz && Math.abs(player.x - LANES[o.lane]) < hx) {
        if (unstoppable) {
          o.dead = true;
          smashed++;
          smashObstacle(o);
        } else if (o.type === 'high' || player.y < LOW_CLEAR) {
          gameOver();
          return;
        }
      }
    }
    if (obstacles.some((o) => o.dead)) obstacles = obstacles.filter((o) => !o.dead);

    updateHud();
  }

  // ---------- Animasi (dino, dunia, kamera) ----------
  function advancePhase(dt) {
    if (state === 'playing') {
      phase += Math.min(46, 12 + effSpeed) * dt;     // irama langkah ikut kecepatan
      const cyc = Math.floor(phase / (Math.PI * 2));
      if (cyc !== lastCycle) {
        lastCycle = cyc;
        if (player.y === 0) GameAudio.sfx.step();
      }
    } else if (state === 'menu') {
      phase += 5 * dt;
    }
  }

  function animateDino(dt) {
    // ukuran: membesar saat mode kuat, mengecil lagi setelah habis
    curScale += ((powerLeft > 0 ? POWER_SCALE : BASE_SCALE) - curScale) * Math.min(1, dt * 5);
    dino.root.scale.setScalar(curScale);
    const sc = curScale / BASE_SCALE;

    // cahaya oranye berdenyut saat mode kuat (berkedip cepat jika hampir habis)
    let glow = 0;
    if (powerLeft > 0) glow = powerLeft < 2 ? 0.25 + 0.25 * Math.sin(time * 28) : 0.35 + 0.15 * Math.sin(time * 8);
    else if (grace > 0) glow = 0.2;
    for (const m of dino.mats) {
      m.emissive.setHex(0xff5a00);
      m.emissiveIntensity = glow;
    }

    dino.root.position.set(player.x, player.y, 0);

    // bayangan mengecil saat melompat
    const s = Math.max(0.5, 1 - player.y / 3.2);
    shadow.position.x = player.x;
    shadow.scale.set(s * sc, s * 1.4 * sc, 1);

    const k = Math.min(1, dt * 12);

    if (state === 'over') {                          // jatuh ke samping setelah menabrak
      overT += dt;
      dino.root.position.y = 0.15;
      dino.root.rotation.z += (1.4 - dino.root.rotation.z) * Math.min(1, dt * 7);
      dino.root.rotation.y += (0.4 - dino.root.rotation.y) * Math.min(1, dt * 7);
      dino.body.position.y = 0;
      return;
    }

    const air = player.y > 0.001;
    const run = state === 'playing' ? 1 : 0.5;       // besar gerakan (di menu pelan)
    const sw = Math.sin(phase);

    // kaki bergantian; saat di udara kaki ditekuk
    for (let i = 0; i < 2; i++) {
      const L = dino.legs[i];
      const ph = phase + i * Math.PI;
      if (air) {
        L.hip.rotation.x = i === 0 ? 0.75 : -0.45;
        L.knee.rotation.x = -0.95;
      } else {
        L.hip.rotation.x = Math.sin(ph) * 0.8 * run;
        L.knee.rotation.x = -0.1 - (0.5 + 0.5 * Math.sin(ph + 1.1)) * 0.8 * run;
      }
    }

    dino.body.position.y = air ? 0 : Math.abs(sw) * 0.09 * run;                        // badan naik-turun
    const pitch = air ? (player.vy > 0 ? 0.18 : -0.18) : 0;                            // hidung naik saat melompat
    dino.body.rotation.x += (pitch - dino.body.rotation.x) * k;
    dino.headPivot.rotation.x = Math.sin(phase * 2) * 0.06 * run + (air ? -0.15 : 0);
    dino.tail1.rotation.y = Math.sin(phase * 0.5) * 0.3 * run;
    dino.tail2.rotation.y = Math.sin(phase * 0.5 - 0.9) * 0.4 * run;
    dino.tail1.rotation.x = air ? -0.25 : 0;
    for (let i = 0; i < 2; i++) dino.arms[i].rotation.x = Math.sin(phase * 2 + i) * 0.45 * run;

    // miring & menoleh ke arah jalur tujuan
    const dx = LANES[player.lane] - player.x;
    const ty = Math.max(-0.45, Math.min(0.45, -dx * 0.14));
    const tz = Math.max(-0.35, Math.min(0.35, -dx * 0.10));
    dino.root.rotation.y += (ty - dino.root.rotation.y) * k;
    dino.root.rotation.z += (tz - dino.root.rotation.z) * k;
  }

  function updateWorld(dt) {
    const worldSpeed = state === 'playing' ? effSpeed : (state === 'menu' ? 5 : 0);
    const dz = worldSpeed * dt;

    roadTex.offset.y = (roadTex.offset.y + dz / 8) % 1;      // jalan tanah bergerak mendekat

    for (const s of scenery) {
      s.obj.position.z += dz;
      if (s.obj.position.z > 14) {
        s.obj.position.z -= SCEN_LEN;
        s.obj.position.x = sceneryX(s.side);
      }
    }

    stepPool(dust, dt, worldSpeed, 0.9, 0);                  // debu, percikan, serpihan
    stepPool(sparks, dt, worldSpeed, 1.0, 0);
    stepPool(debris, dt, worldSpeed, 1.0, 18);
  }

  const camBase = { x: 0, y: CAM_H };
  function updateCamera(dt) {
    const k = Math.min(1, dt * 6);
    camBase.x += (player.x * 0.55 - camBase.x) * k;
    camBase.y += (CAM_H + player.y * 0.25 - camBase.y) * k;
    camZ += ((powerLeft > 0 ? CAM_Z + 1.2 : CAM_Z) - camZ) * k;               // kamera mundur sedikit saat mode kuat
    fovKick += ((powerLeft > 0 ? 8 : 0) - fovKick) * k;                       // sudut pandang melebar = kesan ngebut
    const f = baseFov + fovKick;
    if (Math.abs(f - shownFov) > 0.02) {
      camera.fov = f;
      camera.updateProjectionMatrix();
      shownFov = f;
    }
    let sx = 0, sy = 0;
    if (shake > 0) {                                         // getar saat menabrak / menghancurkan
      sx = (Math.random() - 0.5) * shake * 0.6;
      sy = (Math.random() - 0.5) * shake * 0.6;
      shake = Math.max(0, shake - dt * 2.5);
    }
    camera.position.set(camBase.x + sx, camBase.y + sy, camZ);
    camera.lookAt(player.x * 0.35, 0.8, LOOK_Z);
  }

  // ---------- Loop utama ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));   // batasi supaya tidak "loncat" saat tab tidak aktif
    last = now;
    time += dt;

    if (state === 'playing') update(dt);
    advancePhase(dt);
    animateDino(dt);
    updateWorld(dt);
    updateCamera(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  refreshPanels();
  requestAnimationFrame(frame);

  // Akses untuk tahap berikutnya (wallet / backend)
  window.VosilRunner = { getSave: () => ({ ...save }) };
})();
