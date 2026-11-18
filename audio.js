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
  let intensityFn = () => 0;

  const musicBtn = document.getElementById('musicBtn');
  const sfxBtn = document.getElementById('sfxBtn');

  function setBtn(btn, on, textOn, textOff) {
    if (!btn) return;
    btn.textContent = on ? ((btn.dataset && btn.dataset.on) || textOn) : ((btn.dataset && btn.dataset.off) || textOff);
    if (btn.classList) btn.classList.toggle('off', !on);
  }

  function applyPrefs() {
    if (musicBus) musicBus.gain.value = prefs.music ? 0.5 : 0;
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
    roar() {                        // predator mulai mengejar
      if (!sfxOk()) return;
      const t = actx.currentTime;
      tone(sfxBus, 95, t, 0.7, 'sawtooth', 0.22, 55);
      tone(sfxBus, 140, t + 0.05, 0.6, 'square', 0.08, 70);
      noise(sfxBus, t, 0.55, 0.25, 'lowpass', 450);
    }
  };

  // ----- Musik latar (lagu asli, 4 birama berulang: C - Am - F - G) -----
  const music = (() => {
    const CHORDS = [
      { bass: 48, arp: [60, 64, 67, 72] },   // C
      { bass: 45, arp: [57, 60, 64, 69] },   // Am
      { bass: 41, arp: [57, 60, 65, 69] },   // F
      { bass: 43, arp: [59, 62, 67, 71] }    // G
    ];
    const MELODY = [
      [76, 0, 0, 74, 72, 0, 74, 0, 76, 0, 79, 0, 76, 74, 72, 0],
      [69, 0, 72, 0, 76, 0, 0, 72, 69, 0, 72, 0, 74, 72, 69, 0],
      [72, 0, 77, 0, 76, 0, 72, 0, 69, 0, 72, 0, 77, 0, 76, 0],
      [74, 0, 79, 0, 77, 0, 74, 0, 71, 0, 74, 0, 79, 77, 74, 71]
    ];
    let timer = null, running = false, step = 0, nextTime = 0;

    function playStep(s, t) {
      const bar = Math.floor(s / 16) % 4;
      const k = s % 16;
      const ch = CHORDS[bar];

      // drum: kick, snare, hi-hat
      if (k % 4 === 0) tone(musicBus, 150, t, 0.14, 'sine', 0.9, 45);
      if (k === 4 || k === 12) {
        noise(musicBus, t, 0.12, 0.35, 'bandpass', 2000);
        tone(musicBus, 200, t, 0.07, 'triangle', 0.25, 120);
      }
      if (k % 2 === 0) noise(musicBus, t, 0.03, 0.12, 'highpass', 7000);

      // bass
      if (k % 2 === 0) tone(musicBus, midiHz(ch.bass + (k % 8 === 6 ? 7 : 0)), t, 0.2, 'triangle', 0.5);
      // arpeggio
      if (k % 2 === 1) tone(musicBus, midiHz(ch.arp[(k >> 1) % 4]), t, 0.08, 'square', 0.07);
      // melodi
      const m = MELODY[bar][k];
      if (m) tone(musicBus, midiHz(m), t, 0.2, 'square', 0.13);
    }

    function scheduler() {
      if (!actx) return;
      if (nextTime < actx.currentTime - 0.2) nextTime = actx.currentTime + 0.05;   // setelah tab tidak aktif
      while (nextTime < actx.currentTime + 0.15) {
        playStep(step, nextTime);
        const inten = Math.max(0, Math.min(1, intensityFn() || 0));
        const bpm = 124 + inten * 24;                      // makin cepat lari, makin cepat musik
        nextTime += 60 / bpm / 4;
        step = (step + 1) % 64;
      }
    }

    return {
      start() {
        if (!actx || !musicBus || !noiseBuf || running) return;
        running = true;
        step = 0;
        nextTime = actx.currentTime + 0.1;
        timer = setInterval(scheduler, 25);
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
    setIntensity(fn) { intensityFn = fn; }
  };
})();
