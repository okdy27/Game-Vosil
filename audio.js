/* audio.js - efek suara dan musik latar untuk Vosil Runner 3D.
 * Semua suara dibuat lewat WebAudio (tanpa file audio).
 *
 * Pemakaian:
 *   GameAudio.init()                    // panggil dari sentuhan / tombol pertama pemain (aturan browser)
 *   GameAudio.sfx.jump() dst.           // efek suara
 *   GameAudio.music.start() / .stop()   // musik latar
 *   GameAudio.setIntensity(() => 0..1)  // 0 = santai, 1 = secepat-cepatnya (mengatur tempo musik)
 *
 * Tombol dengan id "musicBtn" dan "sfxBtn" (jika ada di halaman) otomatis menjadi saklar ON/OFF.
 */
const GameAudio = (() => {
  'use strict';

  const AUDIO_KEY = 'vosil_runner_audio_v1';
  const prefs = (() => {
    try {
      const a = JSON.parse(localStorage.getItem(AUDIO_KEY));
      if (a) return { music: a.music !== false, sfx: a.sfx !== false };
    } catch (e) { /* abaikan */ }
    return { music: true, sfx: true };
  })();
  function savePrefs() {
    try { localStorage.setItem(AUDIO_KEY, JSON.stringify(prefs)); } catch (e) { /* abaikan */ }
  }

  let actx = null, musicBus = null, sfxBus = null, voiceBus = null, noiseBuf = null;
  let intensityFn = () => 0, dangerFn = () => 0, waryFn = () => 0;

  const musicBtn = document.getElementById('musicBtn');
  const sfxBtn = document.getElementById('sfxBtn');

  function setBtn(btn, on, textOn, textOff) {
    if (!btn) return;
    btn.textContent = on ? ((btn.dataset && btn.dataset.on) || textOn) : ((btn.dataset && btn.dataset.off) || textOff);
    if (btn.classList) btn.classList.toggle('off', !on);
  }

  function applyPrefs() {
    if (musicBus) musicBus.gain.value = prefs.music ? 1.0 : 0;
    if (sfxBus) sfxBus.gain.value = prefs.sfx ? 0.42 : 0;      // efek lebih pelan dari musik agar tidak menutupi / pecah
    setBtn(musicBtn, prefs.music, '🎵 Musik: ON', '🎵 Musik: OFF');
    setBtn(sfxBtn, prefs.sfx, '🔊 Efek: ON', '🔊 Efek: OFF');
  }

  setBtn(musicBtn, prefs.music, '🎵 Musik: ON', '🎵 Musik: OFF');
  setBtn(sfxBtn, prefs.sfx, '🔊 Efek: ON', '🔊 Efek: OFF');

  function init() {
    try {
      if (!actx) {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        // rantai keluaran: high-pass (speaker HP tidak bisa < ~90 Hz, sub-bass hanya membuat pecah)
        // -> kompresor halus -> limiter keras (mencegah clipping / suara sember di speaker)
        const master = actx.createGain();
        master.gain.value = 1.0;
        const hp = actx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 85; hp.Q.value = 0.5;
        const comp = actx.createDynamicsCompressor();
        try {
          comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.22;
        } catch (e) { /* nilai bawaan */ }
        const lim = actx.createDynamicsCompressor();
        try {
          lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1;
        } catch (e) { /* nilai bawaan */ }
        const trim = actx.createGain();                     // sisakan ruang ~3 dB di bawah batas keras speaker
        trim.gain.value = 0.9;
        const pre = actx.createGain(); pre.gain.value = 2.0;            // makeup gain: dorong sinyal ke limiter -> jauh lebih nyaring di volume HP rendah, puncak tetap dikunci
        master.connect(hp); hp.connect(comp); comp.connect(pre); pre.connect(lim); lim.connect(trim); trim.connect(actx.destination);
        musicBus = actx.createGain();
        musicBus.connect(master);
        sfxBus = actx.createGain();
        sfxBus.connect(master);
        // jalur khusus suara dinosaurus: dikompres sendiri dulu sebelum bercampur dengan efek lain,
        // supaya 5-7 dino bersuara bersamaan tidak membuat puncak sinyal (peak) melonjak
        voiceBus = actx.createGain();
        voiceBus.gain.value = 0.8;
        const vcomp = actx.createDynamicsCompressor();
        try { vcomp.threshold.value = -26; vcomp.knee.value = 8; vcomp.ratio.value = 10; vcomp.attack.value = 0.002; vcomp.release.value = 0.15; } catch (e) { /* bawaan */ }
        voiceBus.connect(vcomp); vcomp.connect(sfxBus);
        noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);   // derau untuk drum & desis
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        applyPrefs();
        loadSamples();
      }
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { /* abaikan: game tetap jalan tanpa suara */ }
  }

  if (musicBtn) musicBtn.addEventListener('click', () => {
    init(); prefs.music = !prefs.music; savePrefs(); applyPrefs();
  });
  if (sfxBtn) sfxBtn.addEventListener('click', () => {
    init(); prefs.sfx = !prefs.sfx; savePrefs(); applyPrefs();
  });
  applyPrefs();

  // diam saat tab / aplikasi tidak aktif
  // ---- suara hujan: derau tersaring yang berputar, volume mengikuti intensitas hujan (0..1) ----
  const rain = { src: null, g: null };
  function rainAmbience(level) {
    if (!actx || !sfxBus) return;
    const want = prefs.sfx ? Math.max(0, Math.min(1, level)) : 0, t = actx.currentTime;
    if (!rain.src) {
      if (want <= 0.01 || !noiseBuf) return;
      try {
        const src = actx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.5;
        const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
        const g = actx.createGain(); g.gain.value = 0.0001;
        src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(sfxBus); src.start(t);
        rain.src = src; rain.g = g;
      } catch (err) { rain.src = null; return; }
    }
    try { rain.g.gain.setTargetAtTime(0.0001 + 0.09 * want, t, 0.8); } catch (err) { /* abaikan */ }
  }

  // ----- musik & suara dari FILE: audio/loopskil.ogg (latar halaman Pilih Dino, berulang) dan audio/welcome.ogg (sambutan sekali putar) -----
  const MUSIC_VOL = 0.55;
  function applyLoops() {
    if (!actx || !musicBus) return;
    const t = actx.currentTime;
    for (const key of Object.keys(want)) {
      const e = sampleBufs[key], L = loops[key];
      if (want[key] && e) {
        if (L) { if (L.out) { L.out = false; L.g.gain.cancelScheduledValues(t); L.g.gain.setValueAtTime(L.g.gain.value, t); L.g.gain.linearRampToValueAtTime(Math.min(0.9, MUSIC_VOL * e.g), t + 1.0); } continue; }
        try {
          const src = actx.createBufferSource(); src.buffer = e.buf; src.loop = true;
          const g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(Math.min(0.9, MUSIC_VOL * e.g), t + 1.4);
          src.connect(g); g.connect(musicBus); src.start(t); loops[key] = { src, g, out: false };
        } catch (err) { /* abaikan */ }
      } else if (L && !L.out) {
        L.out = true;
        try { L.g.gain.cancelScheduledValues(t); L.g.gain.setValueAtTime(L.g.gain.value, t); L.g.gain.linearRampToValueAtTime(0.0001, t + 0.9); } catch (err) { /* abaikan */ }
        const ref = L; setTimeout(() => { if (loops[key] === ref && ref.out) { try { ref.src.stop(); } catch (err) { /* abaikan */ } delete loops[key]; } }, 1100);
      }
    }
  }
  function loop(key, on) {
    on = !!on;
    if (want[key] === on && (!on || loops[key] || !sampleBufs[key])) return;
    want[key] = on; applyLoops();
  }
  // putar sekali; mengembalikan { dur, stop } atau null kalau file belum siap
  function once(key, vol) {
    if (!actx || !musicBus || !sampleBufs[key]) return null;
    try {
      const e = sampleBufs[key], t = actx.currentTime, src = actx.createBufferSource(); src.buffer = e.buf;
      const g = actx.createGain(); g.gain.value = Math.min(0.95, (vol || 0.8) * e.g);
      src.connect(g); g.connect(musicBus); src.start(t);
      return { dur: e.buf.duration, stop() { try { g.gain.cancelScheduledValues(actx.currentTime); g.gain.setValueAtTime(g.gain.value, actx.currentTime); g.gain.linearRampToValueAtTime(0.0001, actx.currentTime + 0.4); setTimeout(() => { try { src.stop(); } catch (err) { /* abaikan */ } }, 450); } catch (err) { /* abaikan */ } } };
    } catch (err) { return null; }
  }
  // peramban memblokir suara sebelum ada sentuhan: pada sentuhan pertama, nyalakan audio & musik latar yang sudah diminta
  ['pointerup', 'touchend', 'click', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { try { init(); if (actx && actx.state === 'suspended') actx.resume(); applyLoops(); } catch (e) { /* abaikan */ } }, { passive: true }));

  document.addEventListener('visibilitychange', () => {
    if (!actx) return;
    try { if (document.hidden) actx.suspend(); else actx.resume(); } catch (e) { /* abaikan */ }
  });

  const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

  function tone(bus, freq, t, dur, type, vol, slideTo) {
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function noise(bus, t, dur, vol, ftype, ffreq) {
    const src = actx.createBufferSource();
    src.buffer = noiseBuf;
    const f = actx.createBiquadFilter();
    f.type = ftype;
    f.frequency.value = ffreq;
    const g = actx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(bus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function skillBus(v, pan) {                                  // jalur suara skill: volume (jarak) + panning kiri-kanan
    const g = actx.createGain(); g.gain.value = v;
    try { if (pan && actx.createStereoPanner) { const sp = actx.createStereoPanner(); sp.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(sp); sp.connect(sfxBus); return g; } } catch (e) { /* abaikan */ }
    g.connect(sfxBus); return g;
  }
  function sweepNoise(bus, t, dur, vol, f0, f1, ftype, q) {    // desau: noise lewat filter yang frekuensinya bergeser
    const src = actx.createBufferSource(); src.buffer = noiseBuf;
    const f = actx.createBiquadFilter(); f.type = ftype; f.Q.value = q || 1; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(bus); src.start(t); src.stop(t + dur + 0.05);
  }

  // ----- Efek suara -----
  let footAt = 0, footN = 0;
  const sfxOk = () => !!(actx && sfxBus && noiseBuf && prefs.sfx);
  let coinCombo = 0, lastCoinAt = 0;

  const sfx = {
    start() {
      if (!sfxOk()) return;
      const t = actx.currentTime;
      [60, 64, 67, 72].forEach((n, i) => tone(sfxBus, midiHz(n), t + i * 0.07, 0.14, 'square', 0.12));
    },
    jump() {
      if (!sfxOk()) return;
      tone(sfxBus, 280, actx.currentTime, 0.2, 'triangle', 0.3, 700);
    },
    land() {
      if (!sfxOk()) return;
      const t = actx.currentTime;
      noise(sfxBus, t, 0.12, 0.35, 'lowpass', 500);
      tone(sfxBus, 140, t, 0.12, 'sine', 0.3, 60);
    },
    lane() {
      if (!sfxOk()) return;
      const t = actx.currentTime;
      noise(sfxBus, t, 0.09, 0.2, 'bandpass', 1800);
      tone(sfxBus, 420, t, 0.07, 'triangle', 0.1, 640);
    },
    step() {
      if (!sfxOk()) return;
      const t = actx.currentTime;
      tone(sfxBus, 95, t, 0.08, 'sine', 0.1, 55);
      noise(sfxBus, t, 0.05, 0.05, 'lowpass', 350);
    },
    // langkah kaki dino: kind = walk | run; size = skala tubuh; wet = di air dangkal
    foot(kind, vol, pan, size, wet) {
      if (!sfxOk()) return;
      const t = actx.currentTime;
      if (t - footAt > 0.12) { footAt = t; footN = 0; }
      if (++footN > 3) return;                                // maks 3 langkah per 120 ms (kawanan tidak menumpuk)
      const run = kind === 'run', sz = size || 1, v = Math.min(1, vol == null ? 1 : vol) * (run ? 1 : 0.65);
      if (v < 0.03) return;
      let dest = sfxBus;
      try { if (pan && actx.createStereoPanner) { const sp = actx.createStereoPanner(); sp.pan.value = Math.max(-1, Math.min(1, pan)); sp.connect(sfxBus); dest = sp; } } catch (e) { dest = sfxBus; }
      // file sampel (audio/manifest.json): foot_walk, foot_walk_2.. / foot_run, foot_run_2.. -> acak varian, nada sedikit diubah
      {
        const names = []; const base = 'foot_' + (run ? 'run' : 'walk');
        if (sampleBufs[base]) names.push(base);
        for (let i = 2; i <= 8; i++) if (sampleBufs[base + '_' + i]) names.push(base + '_' + i);
        if (names.length) {
          let nm = names[Math.floor(Math.random() * names.length)];
          if (names.length > 1 && nm === lastFootSample) nm = names[(names.indexOf(nm) + 1) % names.length];
          lastFootSample = nm;
          try {
            const e = sampleBufs[nm], src = actx.createBufferSource(); src.buffer = e.buf;
            src.playbackRate.value = (0.94 + Math.random() * 0.12) * Math.max(0.8, Math.min(1.15, 1.1 - sz * 0.12));   // dino besar = lebih berat
            const hpf = actx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 110; hpf.Q.value = 0.5;
            const g = actx.createGain(); g.gain.value = Math.min(0.5, v * 0.28 * e.g);   // sampel dinormalkan ke puncak 0.8, jadi harus jauh lebih pelan dari suara dino
            src.connect(hpf); hpf.connect(g); g.connect(dest); src.start(t);
            if (wet) noise(dest, t, 0.18, 0.2 * v, 'bandpass', 1500);
            return;
          } catch (err) { /* jatuh ke sintesis */ }
        }
      }
      const f0 = Math.max(105, 165 - sz * 28) * (0.94 + Math.random() * 0.12);   // tidak di bawah ~100 Hz: speaker HP tidak bisa
      tone(dest, f0, t, run ? 0.13 : 0.1, 'sine', 0.55 * v, f0 * 0.7);               // hentakan
      noise(dest, t, run ? 0.1 : 0.07, 0.4 * v, 'bandpass', (run ? 950 : 650) * (0.9 + Math.random() * 0.2));  // gesekan tanah / kerikil
      if (run) noise(dest, t + 0.02, 0.05, 0.18 * v, 'highpass', 2600);                // derak saat berlari
      if (wet) noise(dest, t, 0.18, 0.3 * v, 'bandpass', 1500);                         // cipratan
    },
    coin() {
      if (!sfxOk()) return;
      const now = performance.now();
      coinCombo = now - lastCoinAt < 700 ? Math.min(coinCombo + 1, 5) : 0;   // koin beruntun: nada makin tinggi
      lastCoinAt = now;
      const t = actx.currentTime;
      const base = 83 + coinCombo * 2;
      tone(sfxBus, midiHz(base), t, 0.08, 'square', 0.12);
      tone(sfxBus, midiHz(base + 5), t + 0.07, 0.16, 'square', 0.12);
    },
    crash() {
      if (!sfxOk()) return;
      const t = actx.currentTime;
      noise(sfxBus, t, 0.5, 0.6, 'lowpass', 1200);
      tone(sfxBus, 230, t, 0.55, 'sawtooth', 0.3, 45);
    },
    record() {
      if (!sfxOk()) return;
      const t = actx.currentTime;
      [72, 76, 79, 84].forEach((n, i) => tone(sfxBus, midiHz(n), t + 0.6 + i * 0.1, 0.22, 'square', 0.12));
    },
    power() {                       // ambil telur: raungan naik + arpeggio gagah
      if (!sfxOk()) return;
      const t = actx.currentTime;
      tone(sfxBus, 110, t, 0.5, 'sawtooth', 0.25, 330);
      noise(sfxBus, t, 0.35, 0.25, 'bandpass', 900);
      [60, 64, 67, 72, 76, 79].forEach((n, i) => tone(sfxBus, midiHz(n), t + 0.05 + i * 0.06, 0.16, 'square', 0.12));
    },
    smash() {                       // rintangan hancur
      if (!sfxOk()) return;
      const t = actx.currentTime;
      noise(sfxBus, t, 0.22, 0.45, 'bandpass', 1100);
      tone(sfxBus, 160, t, 0.18, 'sawtooth', 0.22, 55);
    },
    powerEnd() {                    // mode kuat habis: nada turun
      if (!sfxOk()) return;
      const t = actx.currentTime;
      [79, 74, 69, 62].forEach((n, i) => tone(sfxBus, midiHz(n), t + i * 0.08, 0.16, 'triangle', 0.14));
    },
    eat() {                         // makan buah / daging
      if (!sfxOk()) return;
      const t = actx.currentTime;
      noise(sfxBus, t, 0.06, 0.3, 'bandpass', 1500);
      noise(sfxBus, t + 0.09, 0.06, 0.3, 'bandpass', 1300);
      tone(sfxBus, 330, t, 0.1, 'triangle', 0.14, 440);
    },
    drink() {                       // gelembung air
      if (!sfxOk()) return;
      const t = actx.currentTime;
      [0, 0.09, 0.18].forEach((d, i) => tone(sfxBus, 420 + i * 90, t + d, 0.09, 'sine', 0.13, 760 + i * 90));
    },
    // suara skill elemen. v = 0..1 (kekerasan menurut jarak), pan = -1..1.
    // Jika manifest.json memuat "skill_<id>" (roar, pounce, charge, sweep, sonic) -> file itu dipakai; kalau tidak, dibuat lewat sintesis.
    skill(id, v, pan) {
      if (!sfxOk()) return;
      v = Math.max(0, Math.min(1, v == null ? 1 : v)); if (v < 0.04) return;
      const t = actx.currentTime;
      if (playSample('skill_' + id, '', v, pan, t)) return;
      const d = skillBus(v, pan);
      if (id === 'roar') {                                                   // ANGIN + auman rendah
        sweepNoise(d, t, 0.75, 0.5, 350, 1400, 'bandpass', 1.2);
        tone(d, 96, t, 0.65, 'sawtooth', 0.2, 52); tone(d, 144, t + 0.02, 0.6, 'sawtooth', 0.09, 78);
      } else if (id === 'pounce') {                                          // PETIR: retakan tajam + gemuruh
        noise(d, t, 0.09, 0.8, 'highpass', 3500); tone(d, 2300, t, 0.16, 'sawtooth', 0.26, 160);
        noise(d, t + 0.05, 0.55, 0.5, 'lowpass', 240);
        for (let i = 0; i < 4; i++) noise(d, t + 0.1 + i * 0.07 + Math.random() * 0.03, 0.05, 0.3, 'highpass', 4500 + Math.random() * 2500);
      } else if (id === 'charge') {                                          // API: desir + letupan kecil + hentakan
        sweepNoise(d, t, 0.6, 0.55, 500, 1600, 'bandpass', 0.8); tone(d, 72, t, 0.3, 'sine', 0.38, 38);
        for (let i = 0; i < 9; i++) noise(d, t + Math.random() * 0.55, 0.035, 0.12 + Math.random() * 0.2, 'highpass', 2500 + Math.random() * 3000);
      } else if (id === 'sweep') {                                           // AIR: deburan + tetesan
        sweepNoise(d, t, 0.65, 0.4, 2000, 450, 'lowpass', 0.7);
        for (let i = 0; i < 8; i++) { const f = 500 + Math.random() * 1400; tone(d, f, t + 0.1 + Math.random() * 0.5, 0.07, 'sine', 0.12, f * 0.55); }
      } else if (id === 'sonic') {                                           // gelombang suara: nada naik bergetar + desau
        tone(d, 420, t, 0.55, 'triangle', 0.2, 1500); tone(d, 428, t, 0.55, 'triangle', 0.14, 1520);
        sweepNoise(d, t, 0.55, 0.16, 1500, 3200, 'bandpass', 1.5);
      }
    },
    skillHit(id, power, pan) {                                               // skill mengenai target
      if (!sfxOk()) return;
      const t = actx.currentTime, p = Math.max(0.3, Math.min(1, power == null ? 0.6 : power));
      if (playSample('skill_hit', '', p, pan, t)) return;
      const d = skillBus(p, pan);
      tone(d, 160, t, 0.2, 'sine', 0.42, 42); noise(d, t, 0.14, 0.4, 'lowpass', 1100);
      if (id === 'pounce') noise(d, t, 0.08, 0.3, 'highpass', 4000);                    // percikan listrik
      else if (id === 'charge') noise(d, t, 0.2, 0.25, 'bandpass', 900);                // hantaman panas
      else if (id === 'sweep') tone(d, 700, t, 0.1, 'sine', 0.12, 280);                 // cipratan
    },
    hit() {                         // pemain terkena serangan
      if (!sfxOk()) return;
      const t = actx.currentTime;
      noise(sfxBus, t, 0.2, 0.3, 'lowpass', 900);
      tone(sfxBus, 210, t, 0.25, 'triangle', 0.22, 90);
    },
    bite() {                        // pemain menggigit
      if (!sfxOk()) return;
      const t = actx.currentTime;
      noise(sfxBus, t, 0.12, 0.3, 'bandpass', 1400);
      tone(sfxBus, 520, t, 0.12, 'triangle', 0.15, 200);
    },
    roar() {                        // raungan pemain / umum
      if (!sfxOk()) return;
      voiceFor('rex', 'call', 0.7, 0);
    },
    splash() {                      // masuk / keluar air
      if (!sfxOk()) return;
      const t = actx.currentTime;
      noise(sfxBus, t, 0.45, 0.45, 'bandpass', 900);
      noise(sfxBus, t + 0.03, 0.3, 0.3, 'highpass', 3000);
      tone(sfxBus, 180, t, 0.25, 'sine', 0.25, 70);
      [0.1, 0.18, 0.27].forEach((d, i) => tone(sfxBus, 500 + i * 120, t + d, 0.08, 'sine', 0.08, 900 + i * 100));
    },
    swim() {                        // satu ayunan renang
      if (!sfxOk()) return;
      const t = actx.currentTime;
      noise(sfxBus, t, 0.28, 0.16, 'bandpass', 700 + Math.random() * 300);
      tone(sfxBus, 320 + Math.random() * 120, t + 0.05, 0.1, 'sine', 0.05, 620);
    },
    horde() {                       // kawanan menyerbu: gemuruh rendah + detak jantung
      if (!sfxOk()) return;
      const t = actx.currentTime;
      noise(sfxBus, t, 1.6, 0.35, 'lowpass', 260);
      tone(sfxBus, 55, t, 1.8, 'sawtooth', 0.14, 42);
      tone(sfxBus, 58, t, 1.8, 'sawtooth', 0.1, 44);
      [0, 0.45, 0.9, 1.25].forEach((d, i) => { tone(sfxBus, 70, t + d, 0.18, 'sine', 0.5 - i * 0.05, 38); });
      tone(sfxBus, 392, t + 1.3, 0.9, 'sawtooth', 0.05, 420);
    },
    dino(species, kind, vol, pan) {  // suara khas tiap dinosaurus: kind = call | attack | hurt | die
      voiceFor(species, kind, vol, pan);
    }
  };

  // ----- Suara dinosaurus (sintesis: osilator + formant + getaran + parau) -----
  // f: kontur nada [[waktu 0..1, Hz], ...]; lp: filter low-pass awal->akhir; vib: [Hz, kedalaman Hz]; am: [Hz, kedalaman 0..1] = parau/geraman
  const VOICES = {
    raptor:   { dur: 0.42, type: 'sawtooth', f: [[0, 600], [0.25, 1250], [0.6, 950], [1, 520]], lp: [2200, 1300], vib: [28, 30], am: [36, 0.4], noise: [2000, 0.06], vol: 0.16 },
    velo:     { dur: 0.34, type: 'sawtooth', f: [[0, 900], [0.3, 1700], [0.7, 1350], [1, 750]], lp: [2600, 1500], vib: [34, 45], am: [48, 0.45], noise: [2500, 0.05], vol: 0.14 },
    rex:      { dur: 1.35, type: 'sawtooth', f: [[0, 105], [0.2, 170], [0.55, 135], [1, 80]], lp: [1100, 420], vib: [9, 5], am: [34, 0.6], noise: [500, 0.35], sub: 0.5, vol: 0.42 },
    carno:    { dur: 0.85, type: 'sawtooth', f: [[0, 120], [0.3, 190], [1, 80]], lp: [1100, 350], vib: [14, 10], am: [22, 0.55], noise: [700, 0.22], sub: 0.3, vol: 0.34 },
    spino:    { dur: 1.1,  type: 'sawtooth', f: [[0, 160], [0.4, 120], [1, 70]], lp: [1500, 400], vib: [18, 12], am: [58, 0.45], noise: [3200, 0.4], sub: 0.3, vol: 0.34 },
    stego:    { dur: 0.75, type: 'triangle', f: [[0, 130], [0.4, 175], [1, 95]], lp: [900, 400], vib: [6, 7], am: [0, 0], noise: [400, 0.08], vol: 0.3 },
    anky:     { dur: 0.4,  type: 'sawtooth', f: [[0, 95], [0.3, 120], [1, 65]], lp: [700, 300], vib: [0, 0], am: [28, 0.7], noise: [600, 0.5], vol: 0.3 },
    brachio:  { dur: 2.0,  type: 'sawtooth', f: [[0, 95], [0.4, 140], [0.75, 125], [1, 85]], lp: [700, 380], vib: [4.5, 3], am: [0, 0], noise: [200, 0.06], vol: 0.45 },
    diplo:    { dur: 1.6,  type: 'sawtooth', f: [[0, 110], [0.4, 160], [1, 100]], lp: [800, 420], vib: [5, 4], am: [0, 0], noise: [250, 0.05], vol: 0.42 },
    trike:    { dur: 0.95, type: 'sawtooth', f: [[0, 140], [0.35, 175], [1, 100]], lp: [1000, 420], vib: [7, 6], am: [18, 0.3], noise: [500, 0.12], vol: 0.3 },
    gallim:   { dur: 0.26, type: 'triangle', f: [[0, 800], [0.5, 1250], [1, 900]], lp: [3000, 2000], vib: [22, 40], am: [0, 0], noise: [0, 0], vol: 0.16, twice: 0.18 },
    parasaur: { dur: 1.1,  type: 'sawtooth', f: [[0, 210], [0.35, 262], [0.8, 250], [1, 190]], lp: [1400, 700], vib: [6, 6], am: [0, 0], noise: [900, 0.07], vol: 0.3 },
    flyer:    { dur: 0.5,  type: 'sawtooth', f: [[0, 1300], [0.35, 2000], [1, 1100]], lp: [2800, 1800], vib: [26, 60], am: [30, 0.35], noise: [3000, 0.06], vol: 0.1 },
    vosil:    { dur: 0.6,  type: 'sawtooth', f: [[0, 150], [0.3, 260], [1, 110]], lp: [1800, 600], vib: [10, 10], am: [30, 0.45], noise: [900, 0.2], sub: 0.3, vol: 0.3 }
  };
  const KIND = {                       // pengubah per jenis suara
    call:   { d: 1, p: 1, v: 1, end: 1 },
    attack: { d: 0.5, p: 1.12, v: 1.15, end: 0.9 },
    hurt:   { d: 0.38, p: 1.3, v: 0.9, end: 0.7 },
    die:    { d: 1.3, p: 0.85, v: 1, end: 0.45 }
  };
  let duckG = null;
  // musik file mengecil sebentar tiap ada suara dino -> suara dino jelas, musik tetap menyatu (sidechain sederhana)
  function duckMusic(dur) {
    if (!duckG || !actx) return;
    const t = actx.currentTime, g = duckG.gain;
    try { g.cancelScheduledValues(t); g.setTargetAtTime(0.12, t, 0.03); g.setTargetAtTime(1, t + Math.min(2.5, dur) + 0.3, 0.7); } catch (e) { /* abaikan */ }
  }
  const voiceEnds = [], sigAt = {};
  // ----- Suara dinosaurus dari FILE (opsional): letakkan di folder audio/ + audio/manifest.json -----
  // manifest: { "rex_attack": "rex_attack.ogg", "rex": "rex.ogg", ... }  (kunci "spesies_jenis" lebih diutamakan daripada "spesies")
  // Tanpa file / gagal dimuat -> otomatis memakai suara sintesis.
  const sampleBufs = {};
  const loops = {}, want = {};          // musik latar dari file (berulang): kunci manifest -> { src, g }
  let samplesLoading = false;
  function loadSamples() {
    if (samplesLoading || !actx || typeof fetch !== 'function') return;
    samplesLoading = true;
    fetch('audio/manifest.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then((man) => {
      if (!man || typeof man !== 'object') return;
      Object.keys(man).forEach((k) => {
        if (k.charAt(0) === '_' || typeof man[k] !== 'string') return;
        fetch('audio/' + man[k]).then((r) => (r.ok ? r.arrayBuffer() : null)).then((ab) => {
          if (!ab) return null;
          return new Promise((res, rej) => { try { const p = actx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); } catch (e) { rej(e); } });
        }).then((buf) => {
          if (!buf) return;
          let pk = 0;                                              // normalkan puncak -> volume antar-file seragam
          for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > pk) pk = a; } }
          sampleBufs[k] = { buf, g: pk > 0.001 ? 0.8 / pk : 1 };
          if (want[k]) applyLoops();
        }).catch(() => { /* file rusak: pakai sintesis */ });
      });
    }).catch(() => { /* tidak ada manifest: pakai sintesis */ });
  }
  function playSample(species, kind, v, pan, now) {
    const e = sampleBufs[species + '_' + kind] || sampleBufs[species];
    if (!e) return false;
    try {
      const src = actx.createBufferSource(); src.buffer = e.buf;
      const hpf = actx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 110; hpf.Q.value = 0.5;   // buang sub-bass untuk speaker HP
      const out = actx.createGain(); out.gain.value = Math.min(1.2, v * 2.2) * e.g * 2;
      src.connect(hpf); hpf.connect(out);
      if (pan && actx.createStereoPanner) { const sp = actx.createStereoPanner(); sp.pan.value = Math.max(-1, Math.min(1, pan)); out.connect(sp); sp.connect(voiceBus); } else out.connect(voiceBus);
      src.start(now);
      voiceEnds.push(now + Math.min(3, e.buf.duration) + 0.1); voiceEnds.sort((a, b) => a - b);
      return true;
    } catch (err) { return false; }
  }

  let lastVoiceAt = -9, lastFootSample = '';
  function voiceFor(species, kind, vol, pan) {
    if (!actx || !voiceBus || !noiseBuf || !prefs.sfx) return;
    const V = VOICES[species] || VOICES.raptor, K = KIND[kind] || KIND.call;
    const now = actx.currentTime;
    while (voiceEnds.length && voiceEnds[0] < now) voiceEnds.shift();
    // pembatas: maks 3 suara dino serentak, jarak antar-suara >= 0.12 dtk, dan suara yang sama tidak diulang < 0.3 dtk
    if (voiceEnds.length >= 3) return;
    if (now - lastVoiceAt < 0.12) return;
    const sig = species + ':' + kind;
    if (sigAt[sig] && now - sigAt[sig] < 0.3) return;
    lastVoiceAt = now; sigAt[sig] = now;
    const v = Math.min(1.2, vol == null ? 1 : vol) * V.vol * K.v * 0.5;
    if (v < 0.01) return;
    duckMusic(V.dur * K.d);
    if (playSample(species, kind, v, pan, now)) return;     // file suara buatan pengguna (audio/manifest.json) bila ada
    const t = now, d = V.dur * K.d;
    voiceEnds.push(t + d + 0.1); voiceEnds.sort((a, b) => a - b);
    const rep = V.twice && kind === 'call' ? 2 : 1;
    for (let r = 0; r < rep; r++) {
      const t0 = t + r * (V.twice || 0);
      const out = actx.createGain();
      out.gain.setValueAtTime(0.0001, t0);
      out.gain.exponentialRampToValueAtTime(v, t0 + Math.min(0.06, d * 0.25));
      out.gain.setValueAtTime(v, t0 + d * 0.5);
      out.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      let dest = out;
      try {
        if (pan && actx.createStereoPanner) {
          const sp = actx.createStereoPanner(); sp.pan.value = Math.max(-1, Math.min(1, pan));
          out.connect(sp); sp.connect(voiceBus);
        } else out.connect(voiceBus);
      } catch (e) { out.connect(voiceBus); }
      const hpf = actx.createBiquadFilter();                  // buang dengung < 110 Hz (tidak terdengar di HP, hanya menyebabkan pecah)
      hpf.type = 'highpass'; hpf.frequency.value = 110; hpf.Q.value = 0.5;
      hpf.connect(out);
      const lp = actx.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 1.2;
      lp.frequency.setValueAtTime(V.lp[0], t0);
      lp.frequency.exponentialRampToValueAtTime(Math.max(60, V.lp[1]), t0 + d);
      const am = actx.createGain(); am.gain.value = 1 - V.am[1] * 0.5;
      const o = actx.createOscillator(); o.type = V.type;
      V.f.forEach((pt, i) => {
        const fr = pt[1] * K.p * (i === V.f.length - 1 ? K.end : 1);
        if (i === 0) o.frequency.setValueAtTime(fr, t0); else o.frequency.exponentialRampToValueAtTime(Math.max(20, fr), t0 + pt[0] * d);
      });
      o.connect(am); am.connect(lp); lp.connect(hpf);
      const stops = [o];
      if (V.sub) {                                            // lapisan sub-bass untuk bobot
        const o2 = actx.createOscillator(), g2 = actx.createGain(); o2.type = 'triangle';
        V.f.forEach((pt, i) => {
          const fr = pt[1] * K.p * 1.0 * (i === V.f.length - 1 ? K.end : 1);
          if (i === 0) o2.frequency.setValueAtTime(fr, t0); else o2.frequency.exponentialRampToValueAtTime(Math.max(20, fr), t0 + pt[0] * d);
        });
        g2.gain.value = V.sub * 0.6; o2.connect(g2); g2.connect(lp); stops.push(o2);
      }
      if (V.vib[0] > 0) {                                     // getaran nada
        const lf = actx.createOscillator(), lg = actx.createGain();
        lf.frequency.value = V.vib[0]; lg.gain.value = V.vib[1] * K.p;
        lf.connect(lg); lg.connect(o.frequency); stops.push(lf);
      }
      if (V.am[0] > 0) {                                      // parau / geraman (modulasi amplitudo)
        const la = actx.createOscillator(), lag = actx.createGain();
        la.type = 'square'; la.frequency.value = V.am[0]; lag.gain.value = V.am[1] * 0.5;
        la.connect(lag); lag.connect(am.gain); stops.push(la);
      }
      if (V.noise[1] > 0) {                                   // desah napas
        const src = actx.createBufferSource(); src.buffer = noiseBuf;
        const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = V.noise[0]; bp.Q.value = 0.8;
        const ng = actx.createGain(); ng.gain.value = Math.min(0.25, V.noise[1]);
        src.connect(bp); bp.connect(ng); ng.connect(hpf);
        src.start(t0); src.stop(t0 + d + 0.05);
      }
      stops.forEach((n) => { n.start(t0); n.stop(t0 + d + 0.05); });
    }
  }

  // ----- Musik latar: tema "legenda rimba purba" (D minor), tiga fase yang bercampur mulus -----
  //  SIANG / eksplorasi : melodi seruling tipis + pad ringan + petikan lembut, banyak jeda hening (mid-high, memberi ruang suara alam)
  //  MALAM / waspada    : drone rendah, perkusi kayu & detak pelan, harmoni disonan tipis (low-mid, membangun kewaspadaan)
  //  DIKEJAR / combat   : drum tribal penuh, ostinato senar/synth, bas agresif, tempo cepat (full spectrum)
  const procMusic = (() => {
    const PROG = [
      { root: 38, pad: [50, 53, 57, 62] },   // Dm
      { root: 34, pad: [46, 50, 53, 58] },   // Bb
      { root: 31, pad: [43, 46, 50, 55] },   // Gm
      { root: 33, pad: [45, 49, 52, 57] }    // A
    ];
    const MEL = [                              // melodi seruling, 8 birama: [langkah, nada midi, panjang]
      [[0, 69, 3], [3, 67, 1], [4, 65, 2], [6, 62, 2]],
      [[0, 65, 2], [2, 69, 2], [4, 70, 3], [7, 69, 1]],
      [[0, 67, 3], [3, 65, 1], [4, 62, 4]],
      [[0, 64, 2], [2, 69, 2], [4, 73, 3], [7, 74, 1]],
      [[0, 74, 3], [3, 72, 1], [4, 70, 2], [6, 69, 2]],
      [[0, 70, 2], [2, 72, 2], [4, 74, 4]],
      [[0, 74, 2], [2, 70, 2], [4, 67, 3], [7, 65, 1]],
      [[0, 69, 4], [4, 64, 2], [6, 61, 2]]
    ];
    const OSTI = [0, 0, 7, 0, 5, 0, 3, 7];    // pola ostinato (semiton dari root)
    const TOM_LOW = [1, 0, 0.5, 1, 0, 0.5, 1, 0.6];
    const TOM_HI = [0, 0, 0, 0, 0.7, 0, 0.6, 0.8];
    let timer = null, running = false, step = 0, nextTime = 0, danger = 0, wary = 0, prevDanger = 0, stingerAt = -99, reverbIn = null;

    function ensureReverb() {
      if (reverbIn || !actx) return;
      try {
        const len = Math.floor(actx.sampleRate * 2.2), ir = actx.createBuffer(2, len, actx.sampleRate);
        for (let c = 0; c < 2; c++) {
          const d = ir.getChannelData(c);
          for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
        }
        const conv = actx.createConvolver(); conv.buffer = ir;
        const wet = actx.createGain(); wet.gain.value = 0.5;
        reverbIn = actx.createGain(); reverbIn.gain.value = 1;
        reverbIn.connect(conv); conv.connect(wet); wet.connect(musicBus);
      } catch (e) { reverbIn = null; }
    }
    function mTone(freq, t, dur, type, vol, opts) {
      const o = actx.createOscillator(), g = actx.createGain(), f = actx.createBiquadFilter();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (opts && opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur);
      f.type = 'lowpass'; f.frequency.value = (opts && opts.lp) || 1800; f.Q.value = 0.7;
      const at = (opts && opts.attack) || 0.02;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + at);
      g.gain.setValueAtTime(Math.max(0.0002, vol), t + Math.max(at, dur * 0.6));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f); f.connect(g); g.connect(musicBus);
      if (reverbIn && !(opts && opts.dry)) { const w = actx.createGain(); w.gain.value = (opts && opts.wet) || 0.5; g.connect(w); w.connect(reverbIn); }
      if (opts && opts.vib) {
        const lf = actx.createOscillator(), lg = actx.createGain();
        lf.frequency.value = 5.2; lg.gain.value = freq * 0.012;
        lf.connect(lg); lg.connect(o.frequency); lf.start(t + 0.12); lf.stop(t + dur + 0.05);
      }
      o.start(t); o.stop(t + dur + 0.05);
    }
    // drum: bagian nada (terdengar di speaker HP) + sedikit derau
    function tom(t, vol, f0, f1, dur) {
      tone(musicBus, f0, t, dur, 'sine', vol, f1);
      tone(musicBus, f0 * 2, t, dur * 0.5, 'triangle', vol * 0.35, f1 * 2);
      noise(musicBus, t, 0.07, vol * 0.3, 'lowpass', 900);
    }
    function wood(t, vol, pitch) {                           // perkusi kayu: "tok" kering
      tone(musicBus, pitch, t, 0.07, 'triangle', vol, pitch * 0.6);
      noise(musicBus, t, 0.03, vol * 0.5, 'bandpass', 2000);
    }
    function heart(t, vol) {                                 // detak pelan
      tone(musicBus, 120, t, 0.2, 'sine', vol, 62);
      tone(musicBus, 240, t, 0.12, 'triangle', vol * 0.35, 130);
    }

    function playStep(s, t, stepDur) {
      const k = s % 8, bar = Math.floor(s / 8) % 8, ch = PROG[bar % 4];
      const barDur = stepDur * 8;
      const wd = (1 - wary) * (1 - danger);                  // bobot fase siang
      const wn = wary * (1 - danger);                        // bobot fase malam/waspada
      const wc = danger;                                     // bobot fase combat

      // ---------- SIANG: tipis, banyak jeda ----------
      if (wd > 0.08) {
        if (k === 0 && bar % 2 === 0) {                      // pad ringan, oktaf atas
          ch.pad.forEach((n) => mTone(midiHz(n + 12), t, barDur * 2 + 0.6, 'triangle', 0.028 * wd, { attack: 1.6, lp: 1400, wet: 0.8 }));
          mTone(midiHz(ch.root + 12), t, 1.4, 'triangle', 0.07 * wd, { attack: 0.01, lp: 900, wet: 0.5 });   // petikan lembut (gitar)
        }
        if (k === 4 && bar % 2 === 0) mTone(midiHz(ch.pad[2]), t, 0.9, 'triangle', 0.045 * wd, { attack: 0.01, lp: 1100, wet: 0.6 });
        if (bar % 4 !== 2) {                                 // seruling (birama ke-3 & ke-7 sengaja hening)
          for (const n of MEL[bar]) if (n[0] === k) mTone(midiHz(n[1]), t, stepDur * n[2], 'triangle', 0.09 * wd, { attack: 0.08, lp: 2800, vib: true, wet: 0.85 });
        }
        if (k === 0 && wd > 0.5 && Math.random() < 0.4) {    // burung hutan jauh
          const bt = t + stepDur * (1 + Math.floor(Math.random() * 5)), base = 2400 + Math.random() * 900;
          [0, 0.1, 0.2].forEach((d, i) => mTone(base + i * 280, bt + d, 0.08, 'sine', 0.026 * wd, { wet: 0.9, slideTo: base + i * 280 + 500 }));
        }
      }

      // ---------- MALAM / WASPADA: drone, kayu, detak, disonan tipis ----------
      if (wn > 0.08) {
        if (k === 0) {
          mTone(midiHz(ch.root + 12), t, barDur + 0.5, 'sawtooth', 0.055 * wn, { attack: 0.8, lp: 420, dry: true });         // drone rendah (terdengar di HP)
          mTone(midiHz(ch.root + 19), t, barDur + 0.5, 'sawtooth', 0.03 * wn, { attack: 1.0, lp: 380, dry: true });
          if (bar % 2 === 1) mTone(midiHz(ch.root + 13), t, barDur, 'sawtooth', 0.022 * wn, { attack: 1.2, lp: 500, wet: 0.5 });   // disonan tipis (kedua minor)
          heart(t, 0.3 * wn);
        }
        if (k === 2 && bar % 2 === 0) heart(t, 0.18 * wn);
        if (k === 0 || (k === 5 && bar % 2 === 1)) wood(t, 0.22 * wn, k === 0 ? 330 : 260);
        if (k === 3 && bar % 2 === 0) wood(t, 0.14 * wn, 420);
        if (k === 2 && bar % 2 === 1) {                      // nada tinggi tipis yang bergetar (A5 vs Bb5)
          mTone(midiHz(81), t, barDur * 0.8, 'sine', 0.012 * wn, { attack: 1.0, wet: 0.9 });
          mTone(midiHz(82), t, barDur * 0.8, 'sine', 0.009 * wn, { attack: 1.2, wet: 0.9 });
        }
      }

      // ---------- COMBAT: tribal, ostinato, bas ----------
      if (wc > 0.08) {
        if (TOM_LOW[k]) tom(t, 0.36 * wc * TOM_LOW[k], 150, 85, 0.22);
        if (TOM_HI[k]) tom(t, 0.26 * wc * TOM_HI[k], 230, 150, 0.14);
        if (k === 0) { tom(t, 0.4 * wc, 130, 70, 0.4); }
        if (bar % 4 === 3 && k >= 6) tom(t, 0.22 * wc, 190 - (k - 6) * 20, 120, 0.12);       // gulungan di ujung frasa
        const on = OSTI[k];
        mTone(midiHz(ch.root + 24 + on), t, stepDur * 0.85, 'sawtooth', (0.03 + wc * 0.03) * wc, { attack: 0.01, lp: 900 + wc * 1100, wet: 0.25 });
        if (k % 2 === 0) mTone(midiHz(ch.root + 12), t, stepDur * 1.7, 'sawtooth', 0.075 * wc, { attack: 0.01, lp: 330, dry: true });   // bas agresif
        if (k === 0 || k === 4) mTone(midiHz(ch.pad[0] + 12 + (k === 4 ? 7 : 0)), t, stepDur * 3, 'square', 0.02 * wc, { attack: 0.03, lp: 1500, wet: 0.4 });
      }
      // ombak halus di bawah semua fase: bas panjang sangat pelan agar peralihan tidak terasa putus
      if (k === 0) mTone(midiHz(ch.root + 12), t, barDur + 0.3, 'triangle', 0.025, { attack: 0.5, lp: 350, dry: true });
    }

    function stinger(t) {                                    // sambaran saat mulai dikejar
      tom(t, 0.5, 120, 60, 0.6);
      [0, 3, 7].forEach((iv) => mTone(midiHz(50 + iv), t, 1.3, 'sawtooth', 0.045, { attack: 0.02, lp: 1300, wet: 0.7 }));
      noise(musicBus, t, 0.5, 0.18, 'bandpass', 1200);
    }

    function scheduler() {
      if (!actx) return;
      if (nextTime < actx.currentTime - 0.2) nextTime = actx.currentTime + 0.05;
      while (nextTime < actx.currentTime + 0.2) {
        const bpm = 60 - wary * 4 + danger * 52 + Math.max(0, Math.min(1, intensityFn() || 0)) * 2;
        const stepDur = 60 / bpm / 2;
        if (danger > 0.45 && prevDanger <= 0.45 && nextTime - stingerAt > 20) { stinger(nextTime); stingerAt = nextTime; }
        prevDanger = danger;
        playStep(step, nextTime, stepDur);
        nextTime += stepDur;
        step = (step + 1) % 64;
      }
    }

    return {
      start() {
        if (!actx || !musicBus || !noiseBuf || running) return;
        running = true; step = 0; nextTime = actx.currentTime + 0.1;
        ensureReverb();
        timer = setInterval(() => {
          const td = Math.max(0, Math.min(1, dangerFn() || 0)), tw = Math.max(0, Math.min(1, waryFn() || 0));
          danger += (td - danger) * 0.08;
          wary += (tw - wary) * 0.04;
          scheduler();
        }, 25);
      },
      stop() {
        running = false;
        if (timer) clearInterval(timer);
        timer = null;
      }
    };
  })();


  // ----- Musik latar dari FILE (opsional): bgm.ogg / bgm.webm / bgm.m4a / bgm.mp3 di folder game -----
  // Dimuat & didekode ke mesin suara game (bukan elemen <audio>) -> tidak muncul sebagai pemutar media di HP, loop tanpa jeda.
  // Gagal semua -> musik prosedural bawaan tetap dipakai.
  const music = (() => {
    let state = 'idle', gain = null, src = null, duckT = null, fbT = null, wantPlay = false;
    let BGM_G = 0.6;                                     // dihitung ulang dari kenyaringan (RMS) file agar selalu 'pengisi latar'
    const CANDS = ['bgm.ogg', 'bgm.webm', 'bgm.m4a', 'bgm.mp3'];
    const decode = (ab) => new Promise((res, rej) => { try { const p = actx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); } catch (e) { rej(e); } });
    // Unduh file lebih awal (sebelum ketukan pertama) supaya siap secepat mungkin; tidak butuh AudioContext untuk mengunduh.
    let pre = null;
    function prefetch() {
      if (pre || typeof fetch !== 'function') return;
      pre = (function next(i) {
        if (i >= CANDS.length) return Promise.resolve(null);
        return fetch(CANDS[i]).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('404')))).then((ab) => ({ i, ab })).catch(() => next(i + 1));
      })(0);
    }
    prefetch();
    function useProc() {                                  // cadangan: musik bawaan hanya jika file memang tidak ada / gagal
      if (state === 'file') return;
      state = 'proc';
      if (wantPlay) procMusic.start();
    }
    function playBuf(buf) {
      const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70; hp.Q.value = 0.5;   // buang sub-bass untuk speaker HP
      let sum = 0, n = 0;                                 // samakan kenyaringan musik ke target tetap, berapa pun mastering file
      const cd = buf.getChannelData(0);
      for (let k = 0; k < cd.length; k += 4) { sum += cd[k] * cd[k]; n++; }
      BGM_G = Math.max(0.1, Math.min(2.5, 0.07 / (Math.sqrt(sum / Math.max(1, n)) || 0.1)));
      gain = actx.createGain(); gain.gain.value = 0;
      duckG = actx.createGain(); duckG.gain.value = 1;
      src = actx.createBufferSource(); src.buffer = buf; src.loop = true;
      src.connect(hp); hp.connect(gain); gain.connect(duckG); duckG.connect(musicBus);
      src.start(0);
      state = 'file';
      procMusic.stop();                                   // jika musik cadangan sempat jalan karena file lambat
      gain.gain.setTargetAtTime(wantPlay ? BGM_G : 0, actx.currentTime, 1.0);
      duckT = setInterval(() => {                         // saat dikeroyok musik sedikit mengecil agar efek tempur terdengar
        if (!wantPlay) return;
        const dg = Math.max(0, Math.min(1, dangerFn() || 0));
        gain.gain.setTargetAtTime(BGM_G * (1 - 0.25 * dg), actx.currentTime, 0.4);
      }, 120);
    }
    function load() {
      state = 'loading';
      fbT = setTimeout(() => { if (state === 'loading' && wantPlay) procMusic.start(); }, 7000);    // file terlalu lama: baru pakai musik cadangan
      prefetch();
      const tryFrom = (i, got) => {
        const p = got && got.i === i ? Promise.resolve(got.ab) : (i < CANDS.length ? fetch(CANDS[i]).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('404')))) : Promise.reject(new Error('none')));
        p.then((ab) => decode(ab)).then((buf) => { clearTimeout(fbT); playBuf(buf); })
          .catch(() => { if (i + 1 < CANDS.length) tryFrom(i + 1, null); else { clearTimeout(fbT); useProc(); } });
      };
      pre.then((got) => { if (!got) { clearTimeout(fbT); useProc(); } else tryFrom(got.i, got); });
    }
    return {
      start() {
        wantPlay = true;
        if (state === 'file') { gain.gain.setTargetAtTime(BGM_G, actx.currentTime, 0.8); return; }
        if (state === 'proc') { procMusic.start(); return; }
        if (state === 'idle' && actx && musicBus && typeof fetch === 'function') load();
        else if (state === 'idle') { state = 'proc'; procMusic.start(); }
        // state 'loading': diam dulu sampai file siap (tidak memutar musik lain di awal)
      },
      stop() {
        wantPlay = false;
        if (state === 'file') gain.gain.setTargetAtTime(0, actx.currentTime, 0.6); else procMusic.stop();
      }
    };
  })();

  // pembatas efek umum: efek yang sama tidak diputar lebih rapat dari 70 ms, dan maks 7 efek per 100 ms
  (() => {
    let burstAt = 0, burstN = 0;
    const lastAt = {};
    Object.keys(sfx).forEach((k) => {
      if (k === 'dino' || k === 'foot' || typeof sfx[k] !== 'function') return;
      const fn = sfx[k];
      sfx[k] = function () {
        const now = actx ? actx.currentTime : 0;
        if (actx) {
          if (lastAt[k] !== undefined && now - lastAt[k] < 0.07) return;
          if (now - burstAt > 0.1) { burstAt = now; burstN = 0; }
          if (++burstN > 7) return;
          lastAt[k] = now;
        }
        return fn.apply(sfx, arguments);
      };
    });
  })();

  // ---- suasana malam: file audio/malam.ogg (manifest key "malam") dimainkan acak selama malam ----
  const night = { on: false, next: 0, cur: null, n: 0 };
  function nightAmbience(on) {
    if (!actx || !sfxBus) return;
    const t = actx.currentTime;
    if (on && prefs.sfx) {
      if (!night.on) { night.on = true; night.n++; night.next = t + 5 + Math.random() * 10; }   // pertama kali: 5-15 dtk setelah malam tiba
      if (t < night.next || night.cur) return;
      const e = sampleBufs.malam; if (!e) return;
      try {
        const src = actx.createBufferSource(); src.buffer = e.buf;
        src.playbackRate.value = 0.93 + Math.random() * 0.13;
        const far = Math.random() < 0.4;                                   // sebagian terdengar jauh (lebih redup & pelan)
        const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = far ? 1800 : 6000;
        const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 100;
        const g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(Math.min(0.5, (far ? 0.16 : 0.26) * e.g), t + 1.2);
        src.connect(hp); hp.connect(lp); lp.connect(g);
        if (actx.createStereoPanner) { const sp = actx.createStereoPanner(); sp.pan.value = (Math.random() * 2 - 1) * 0.8; g.connect(sp); sp.connect(sfxBus); } else g.connect(sfxBus);
        src.start(t);
        const dur = e.buf.duration / src.playbackRate.value;
        night.cur = { g, src };
        src.onended = () => { night.cur = null; };
        const q = Math.random();                                           // jeda acak: kadang rapat, kadang lama
        night.next = t + dur + (q < 0.25 ? 18 + Math.random() * 14 : q < 0.8 ? 40 + Math.random() * 40 : 90 + Math.random() * 70);
      } catch (err) { night.cur = null; }
    } else if (night.on) {
      night.on = false;
      if (night.cur) { try { night.cur.g.gain.cancelScheduledValues(t); night.cur.g.gain.setValueAtTime(night.cur.g.gain.value, t); night.cur.g.gain.linearRampToValueAtTime(0.0001, t + 1.5); night.cur.src.stop(t + 1.6); } catch (e) { /* abaikan */ } }
    }
  }

  document.addEventListener('visibilitychange', () => {
    try { if (!actx) return; if (document.hidden) actx.suspend(); else actx.resume(); } catch (e) { /* abaikan */ }
  });

  return {
    init,
    nightAmbience,
    loop,
    once,
    rainAmbience,
    refreshLabels() { try { applyPrefs(); } catch (e) { /* abaikan */ } },
    sfx,
    music,
    prefs,
    setIntensity(fn) { intensityFn = fn; },
    setDanger(fn) { dangerFn = fn; },
    setWary(fn) { waryFn = fn; }         // 0 = aman (siang), 1 = waspada (malam / area berbahaya)   // 0 = tenang, 1 = pertarungan panas
  };
})();
