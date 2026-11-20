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

  let actx = null, musicBus = null, sfxBus = null, noiseBuf = null;
  let intensityFn = () => 0, dangerFn = () => 0;

  const musicBtn = document.getElementById('musicBtn');
  const sfxBtn = document.getElementById('sfxBtn');

  function setBtn(btn, on, textOn, textOff) {
    if (!btn) return;
    btn.textContent = on ? ((btn.dataset && btn.dataset.on) || textOn) : ((btn.dataset && btn.dataset.off) || textOff);
    if (btn.classList) btn.classList.toggle('off', !on);
  }

  function applyPrefs() {
    if (musicBus) musicBus.gain.value = prefs.music ? 0.75 : 0;
    if (sfxBus) sfxBus.gain.value = prefs.sfx ? 0.9 : 0;
    setBtn(musicBtn, prefs.music, '🎵 Musik: ON', '🎵 Musik: OFF');
    setBtn(sfxBtn, prefs.sfx, '🔊 Efek: ON', '🔊 Efek: OFF');
  }

  function init() {
    try {
      if (!actx) {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        const master = actx.createGain();
        master.gain.value = 0.8;
        const comp = actx.createDynamicsCompressor();     // supaya tidak pecah saat banyak suara
        master.connect(comp);
        comp.connect(actx.destination);
        musicBus = actx.createGain();
        musicBus.connect(master);
        sfxBus = actx.createGain();
        sfxBus.connect(master);
        noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);   // derau untuk drum & desis
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        applyPrefs();
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

  // ----- Efek suara -----
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
    hit() {                         // pemain terkena serangan
      if (!sfxOk()) return;
      const t = actx.currentTime;
      noise(sfxBus, t, 0.2, 0.5, 'lowpass', 900);
      tone(sfxBus, 210, t, 0.25, 'sawtooth', 0.25, 70);
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
    raptor:   { dur: 0.42, type: 'square',   f: [[0, 700], [0.25, 1500], [0.6, 1100], [1, 600]], lp: [3200, 1800], vib: [28, 40], am: [36, 0.5], noise: [2500, 0.1], vol: 0.2 },
    velo:     { dur: 0.34, type: 'square',   f: [[0, 1100], [0.3, 2200], [0.7, 1700], [1, 900]], lp: [4200, 2200], vib: [34, 60], am: [48, 0.55], noise: [3500, 0.08], vol: 0.17 },
    rex:      { dur: 1.35, type: 'sawtooth', f: [[0, 70], [0.2, 118], [0.55, 90], [1, 46]], lp: [900, 260], vib: [9, 5], am: [34, 0.6], noise: [500, 0.35], sub: 0.5, vol: 0.42 },
    carno:    { dur: 0.85, type: 'sawtooth', f: [[0, 120], [0.3, 190], [1, 80]], lp: [1100, 350], vib: [14, 10], am: [22, 0.55], noise: [700, 0.22], sub: 0.3, vol: 0.34 },
    spino:    { dur: 1.1,  type: 'sawtooth', f: [[0, 160], [0.4, 120], [1, 70]], lp: [1500, 400], vib: [18, 12], am: [58, 0.45], noise: [3200, 0.4], sub: 0.3, vol: 0.34 },
    stego:    { dur: 0.75, type: 'triangle', f: [[0, 130], [0.4, 175], [1, 95]], lp: [900, 400], vib: [6, 7], am: [0, 0], noise: [400, 0.08], vol: 0.3 },
    anky:     { dur: 0.4,  type: 'sawtooth', f: [[0, 95], [0.3, 120], [1, 65]], lp: [700, 300], vib: [0, 0], am: [28, 0.7], noise: [600, 0.5], vol: 0.3 },
    brachio:  { dur: 2.0,  type: 'sine',     f: [[0, 52], [0.4, 78], [0.75, 70], [1, 46]], lp: [500, 220], vib: [4.5, 3], am: [0, 0], noise: [200, 0.06], vol: 0.45 },
    diplo:    { dur: 1.6,  type: 'sine',     f: [[0, 66], [0.4, 100], [1, 60]], lp: [600, 260], vib: [5, 4], am: [0, 0], noise: [250, 0.05], vol: 0.42 },
    trike:    { dur: 0.95, type: 'sawtooth', f: [[0, 140], [0.35, 175], [1, 100]], lp: [1000, 420], vib: [7, 6], am: [18, 0.3], noise: [500, 0.12], vol: 0.3 },
    gallim:   { dur: 0.26, type: 'triangle', f: [[0, 800], [0.5, 1250], [1, 900]], lp: [3000, 2000], vib: [22, 40], am: [0, 0], noise: [0, 0], vol: 0.16, twice: 0.18 },
    parasaur: { dur: 1.1,  type: 'sawtooth', f: [[0, 210], [0.35, 262], [0.8, 250], [1, 190]], lp: [1400, 700], vib: [6, 6], am: [0, 0], noise: [900, 0.07], vol: 0.3 },
    flyer:    { dur: 0.5,  type: 'sawtooth', f: [[0, 1500], [0.35, 2500], [1, 1300]], lp: [4000, 2500], vib: [26, 80], am: [30, 0.4], noise: [4000, 0.12], vol: 0.12 },
    vosil:    { dur: 0.6,  type: 'sawtooth', f: [[0, 150], [0.3, 260], [1, 110]], lp: [1800, 600], vib: [10, 10], am: [30, 0.45], noise: [900, 0.2], sub: 0.3, vol: 0.3 }
  };
  const KIND = {                       // pengubah per jenis suara
    call:   { d: 1, p: 1, v: 1, end: 1 },
    attack: { d: 0.5, p: 1.12, v: 1.15, end: 0.9 },
    hurt:   { d: 0.38, p: 1.3, v: 0.9, end: 0.7 },
    die:    { d: 1.3, p: 0.85, v: 1, end: 0.45 }
  };
  const voiceEnds = [];
  function voiceFor(species, kind, vol, pan) {
    if (!actx || !sfxBus || !noiseBuf || !prefs.sfx) return;
    const V = VOICES[species] || VOICES.raptor, K = KIND[kind] || KIND.call;
    const now = actx.currentTime;
    while (voiceEnds.length && voiceEnds[0] < now) voiceEnds.shift();
    if (voiceEnds.length >= 6) return;                        // batasi suara serentak
    const v = (vol == null ? 1 : vol) * V.vol * K.v;
    if (v < 0.01) return;
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
          out.connect(sp); sp.connect(sfxBus);
        } else out.connect(sfxBus);
      } catch (e) { out.connect(sfxBus); }
      const lp = actx.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 3;
      lp.frequency.setValueAtTime(V.lp[0], t0);
      lp.frequency.exponentialRampToValueAtTime(Math.max(60, V.lp[1]), t0 + d);
      const am = actx.createGain(); am.gain.value = 1 - V.am[1] * 0.5;
      const o = actx.createOscillator(); o.type = V.type;
      V.f.forEach((pt, i) => {
        const fr = pt[1] * K.p * (i === V.f.length - 1 ? K.end : 1);
        if (i === 0) o.frequency.setValueAtTime(fr, t0); else o.frequency.exponentialRampToValueAtTime(Math.max(20, fr), t0 + pt[0] * d);
      });
      o.connect(am); am.connect(lp); lp.connect(out);
      const stops = [o];
      if (V.sub) {                                            // lapisan sub-bass untuk bobot
        const o2 = actx.createOscillator(), g2 = actx.createGain(); o2.type = 'sine';
        V.f.forEach((pt, i) => {
          const fr = pt[1] * K.p * 0.5 * (i === V.f.length - 1 ? K.end : 1);
          if (i === 0) o2.frequency.setValueAtTime(fr, t0); else o2.frequency.exponentialRampToValueAtTime(Math.max(20, fr), t0 + pt[0] * d);
        });
        g2.gain.value = V.sub; o2.connect(g2); g2.connect(lp); stops.push(o2);
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
        const ng = actx.createGain(); ng.gain.value = V.noise[1];
        src.connect(bp); bp.connect(ng); ng.connect(out);
        src.start(t0); src.stop(t0 + d + 0.05);
      }
      stops.forEach((n) => { n.start(t0); n.stop(t0 + d + 0.05); });
    }
  }

  // ----- Musik latar: tema "legenda rimba purba" (D minor, tenang tapi menegangkan) -----
  // Lapisan: pad hangat + drone bas, seruling melodi pendek, drum taiko rendah, burung hutan (saat tenang),
  // dan senar tremolo + drum rapat yang masuk bertahap saat bahaya naik (setDanger).
  const music = (() => {
    // Dm - Bb - Gm - A  (tiap akor 1 birama = 4 ketuk = 8 langkah)
    const PROG = [
      { root: 38, pad: [50, 53, 57, 62] },
      { root: 34, pad: [46, 50, 53, 58] },
      { root: 31, pad: [43, 46, 50, 55] },
      { root: 33, pad: [45, 49, 52, 57] }
    ];
    // melodi seruling 8 birama: [langkah, nada midi, panjang(langkah)]
    const MEL = [
      [[0, 69, 3], [3, 67, 1], [4, 65, 2], [6, 62, 2]],
      [[0, 65, 2], [2, 69, 2], [4, 70, 3], [7, 69, 1]],
      [[0, 67, 3], [3, 65, 1], [4, 62, 4]],
      [[0, 64, 2], [2, 69, 2], [4, 73, 3], [7, 74, 1]],
      [[0, 74, 3], [3, 72, 1], [4, 70, 2], [6, 69, 2]],
      [[0, 70, 2], [2, 72, 2], [4, 74, 4]],
      [[0, 74, 2], [2, 70, 2], [4, 67, 3], [7, 65, 1]],
      [[0, 69, 4], [4, 64, 2], [6, 61, 2]]
    ];
    let timer = null, running = false, step = 0, nextTime = 0, danger = 0, reverbIn = null;

    function ensureReverb() {                              // gema gua/hutan buatan
      if (reverbIn || !actx) return;
      try {
        const len = Math.floor(actx.sampleRate * 2.4), ir = actx.createBuffer(2, len, actx.sampleRate);
        for (let c = 0; c < 2; c++) {
          const d = ir.getChannelData(c);
          for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
        }
        const conv = actx.createConvolver(); conv.buffer = ir;
        const wet = actx.createGain(); wet.gain.value = 0.55;
        reverbIn = actx.createGain(); reverbIn.gain.value = 1;
        reverbIn.connect(conv); conv.connect(wet); wet.connect(musicBus);
      } catch (e) { reverbIn = null; }
    }
    function mTone(freq, t, dur, type, vol, opts) {          // nada dengan attack/release lembut + kirim ke reverb
      const o = actx.createOscillator(), g = actx.createGain(), f = actx.createBiquadFilter();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (opts && opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, t + dur);
      f.type = 'lowpass'; f.frequency.value = (opts && opts.lp) || 1800; f.Q.value = 0.7;
      const at = (opts && opts.attack) || 0.02;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + at);
      g.gain.setValueAtTime(vol, t + Math.max(at, dur * 0.6));
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
    function taiko(t, vol) {
      tone(musicBus, 110, t, 0.35, 'sine', vol, 42);
      noise(musicBus, t, 0.18, vol * 0.35, 'lowpass', 380);
    }

    function playStep(s, t, stepDur) {
      const k = s % 8, bar = Math.floor(s / 8) % 8, ch = PROG[bar % 4];
      const beat = stepDur * 2, barDur = stepDur * 8;
      if (k === 0) {
        ch.pad.forEach((n) => {                             // pad hangat (dua osilator sedikit sumbang)
          mTone(midiHz(n), t, barDur + 0.9, 'sawtooth', 0.045, { attack: 1.0, lp: 650 + danger * 500, wet: 0.7 });
          mTone(midiHz(n) * 1.006, t, barDur + 0.9, 'triangle', 0.05, { attack: 1.2, lp: 900, wet: 0.7 });
        });
        mTone(midiHz(ch.root), t, barDur + 0.4, 'sine', 0.3, { attack: 0.3, lp: 300, dry: true });   // drone bas
        taiko(t, 0.5 + danger * 0.3);
        if (danger < 0.3 && Math.random() < 0.45) {         // burung hutan jauh
          const bt = t + stepDur * (1 + Math.floor(Math.random() * 5));
          const base = 2400 + Math.random() * 900;
          [0, 0.1, 0.2].forEach((d, i) => mTone(base + i * 280, bt + d, 0.08, 'sine', 0.03, { wet: 0.9, slideTo: base + i * 280 + 500 }));
        }
      }
      if (k === 4 && (danger > 0.12 || bar % 2 === 1)) taiko(t, 0.22 + danger * 0.3);
      if (danger > 0.4 && (k === 3 || k === 7 || k === 5)) taiko(t, 0.18 + danger * 0.25);
      if (danger > 0.55) {                                  // senar tremolo menegangkan
        const root = ch.root + 24 + (k % 4 === 2 ? 7 : 0);
        mTone(midiHz(root), t, stepDur * 0.9, 'sawtooth', 0.025 + danger * 0.03, { lp: 900 + danger * 900, dry: true });
      }
      if (danger > 0.75 && k % 2 === 0) mTone(midiHz(ch.root + 36 + (bar % 2 ? 1 : 0)), t, stepDur * 1.6, 'sawtooth', 0.02, { lp: 2200, wet: 0.4 });   // dissonan tinggi

      // seruling melodi (berhenti saat bahaya tinggi supaya terasa tegang)
      if (danger < 0.7) {
        for (const n of MEL[bar]) {
          if (n[0] === k) mTone(midiHz(n[1]), t, stepDur * n[2], 'triangle', 0.1 * (1 - danger * 0.8), { attack: 0.08, lp: 2600, vib: true, wet: 0.85 });
        }
      }
    }

    function scheduler() {
      if (!actx) return;
      if (nextTime < actx.currentTime - 0.2) nextTime = actx.currentTime + 0.05;
      while (nextTime < actx.currentTime + 0.2) {
        const bpm = 66 + danger * 30 + Math.max(0, Math.min(1, intensityFn() || 0)) * 4;
        const stepDur = 60 / bpm / 2;                        // langkah = 1/8
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
          const target = Math.max(0, Math.min(1, dangerFn() || 0));
          danger += (target - danger) * 0.06;                // naik/turun mulus
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

  return {
    init,
    sfx,
    music,
    prefs,
    setIntensity(fn) { intensityFn = fn; },
    setDanger(fn) { dangerFn = fn; }   // 0 = tenang, 1 = pertarungan panas
  };
})();
