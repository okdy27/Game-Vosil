/* lang.js - bahasa game: Indonesia (id), English (en), Español (es).
 * Bahasa otomatis mengikuti bahasa HP; jika tidak tersedia -> English. Pemain bisa memilih manual di Tas > Seting.
 * Pemakaian: L.t('kunci', { n: 5 }) ; elemen HTML: data-i18n="kunci" (teks) / data-i18n-aria="kunci" */
const L = (() => {
  'use strict';
  const KEY = 'vosil_lang_v1';
  const NAMES = { id: 'Bahasa Indonesia', en: 'English', es: 'Español' };
  const D = {
    id: {
      hud_day: 'Hari', power_mode: '🥚 MODE KUAT', top_btn: '⚙ Tukar & Seting', top_aria: 'Tukar dan seting',
      sk_roar: 'RAUNG', sk_run: 'LARI', sk_jump: 'LOMPAT', sk_bite: 'GIGIT', unit_sec: 'dtk',
      menu_lead: 'Jelajahi lembah prasejarah, bertahan hidup, kumpulkan koin',
      help1: '🕹️ Analog kiri: bergerak bebas', help2: '👆 Geser kanan: putar kamera 360°', help3: '🦖 Gigit: serang predator',
      help4: '⤴ Lompat: hindari gigitan', help5: '🏃⤴ Lari + Lompat: jauh & tinggi', help6: '🏃 Lari: kabur (menguras tenaga)',
      help7: '🍒 Semak buah: isi lapar', help8: '💧 Kolam: isi haus',
      total_coins: 'Total koin', record: 'Rekor', days_unit: 'hari', cta_start: 'Ketuk untuk mulai', cta_again: 'Ketuk untuk main lagi',
      bag_btn: '🎒 Tas & Tukar Poin', claim_soon: 'Klaim Vosil (segera)', over_title: 'KAMU TUMBANG',
      survived: 'Bertahan', predators: 'Predator', level: 'Level', coins_earned: 'Koin didapat',
      tab_ex: '🎒 Tukar', tab_chr: '🦖 Karakter', tab_set: '⚙ Seting', close: 'Tutup',
      quit_open: '🦖 Buka halaman pilih karakter', quit_sure: 'Yakin? Permainan ini berakhir. Ketuk lagi',
      chr_note: 'Memilih di sini: dino baru dipakai di permainan berikutnya. Tombol hijau di atas mengakhiri permainan ini dan membuka halaman utama dengan pratinjau dino (koin tetap tersimpan).',
      music_on: '🎵 Musik: ON', music_off: '🎵 Musik: OFF', sfx_on: '🔊 Efek suara: ON', sfx_off: '🔊 Efek suara: OFF',
      quality_lbl: '◪ Kualitas grafis: {q}', q_low: 'Rendah', q_mid: 'Sedang', q_high: 'Tinggi', fs_btn: '⛶ Layar penuh',
      set_note: 'Kualitas grafis: Rendah = paling ringan, Tinggi = paling bagus. Perubahan langsung berlaku.',
      lang_lbl: '🌐 Bahasa: {l}', lang_auto: 'Otomatis ({l})',
      rot_title: 'Vosil Survival dimainkan horizontal', rot_btn: '⛶ MASUK GAME (layar penuh)',
      rot_note: 'Ketuk untuk layar penuh horizontal, lalu pilih dino dan mulai. Jika layar tidak berputar sendiri, putar HP secara manual.',
      rot_ios: 'iPhone belum mengizinkan putar otomatis. Putar HP secara manual, atau pakai Safari → Bagikan → Tambahkan ke Layar Utama untuk layar penuh.',
      fatal_link: 'Tes WebGL untuk mencari penyebabnya',
      fatal_three: 'Three.js gagal dimuat. Pastikan internet aktif, atau unduh three.min.js (versi r128) dan taruh di folder yang sama dengan survival.html.',
      fatal_webgl: 'WebGL tidak bisa dijalankan di browser ini. Buka lewat Chrome atau Safari langsung (bukan dari dalam WhatsApp/Instagram/Telegram), matikan mode hemat baterai, lalu buka webgl-test.html untuk diagnosis.',
      'biome.plain': 'Padang Rumput', 'biome.forest': 'Hutan Lebat', 'biome.desert': 'Gurun Berbatu', 'biome.swamp': 'Rawa Berkabut',
      'info.vosil': 'Seimbang untuk segala keadaan', 'info.velo': 'Sangat cepat, tapi gigitan lemah dan mudah terluka',
      'info.carno': 'Gigitan kuat dan tangguh, tapi agak lambat', 'info.spino': 'Sangat tangguh dan tahan haus, tapi lambat',
      'info.parasaur': 'Tenaga besar untuk lari jauh, tapi gigitan lemah',
      lvl_toast: '⬆ LEVEL {n}! Dino makin besar dan kuat', lvl_pop: 'LEVEL {n}!',
      fall_chasm: '🕳️ Jatuh ke jurang! Kamu tidak mati, kembali ke tepi', door_back: '🚪 Kamu kembali ke titik awal membawa harta!',
      zone_tip: '🪨 Area Tantangan Lompat! Tips: LARI lalu LOMPAT = lompatan jauh', chest: '🎁 Peti harta! +25 koin',
      start_hint: 'Cari air dan buah. Hati-hati predator!', rec_new: 'Rekor baru!', rec_line: 'Rekor: {n} hari',
      fs_ios: 'iPhone: ketuk Bagikan → Tambahkan ke Layar Utama untuk layar penuh', fs_none: 'Browser ini tidak mendukung layar penuh',
      q_toast: 'Kualitas grafis: {q}', char_next: '🦖 {n} dipakai di permainan berikutnya',
      b_trophy: 'Trofi: {n} · bernilai {v} poin/ekor · ', b_prey: 'Hewan buruan · ', b_killed: 'total dikalahkan {n}', b_trade_n: 'Tukar +{n}',
      b_none: 'Belum ada. Kalahkan dinosaurus untuk mendapat trofi.', b_sum: '🪙 {c}  ·  ⭐ {p} poin',
      h_coin: 'Koin', b_coin_row: '🪙 {n} koin', b_coin_rate: '{r} koin = 1 poin tukar', b_trade_pts: 'Tukar +{n} poin',
      h_trophy: 'Trofi dinosaurus', b_trade_all: 'Tukar semua aset (+{n} poin)', h_token: 'Poin tukar → Token Vosil',
      b_pts_row: '⭐ {n} poin tukar', b_pts_rate: '{r} poin = 1 VOSIL · estimasi {e} VOSIL', b_claim_soon: 'Klaim (segera)',
      b_resume: '▶ Lanjut bermain (game dijeda)',
      b_note: 'Nilai tukar dapat berubah sewaktu-waktu sesuai kebijakan. Poin tukar tersimpan di perangkat ini. Klaim token akan aktif di tahap wallet World Chain dan diverifikasi server sebelum dikirim.',
      r_quit: 'Keluar ke menu', r_thirst: 'Mati kehausan', r_hunger: 'Mati kelaparan', r_eaten: 'Dimangsa {n}',
      hp_crit: '😱 HP kritis! Semua koin di kantong tumpah', upset: 'TERGANGGU', enraged: '💢 {n} mengamuk!',
      meat_coins: '+{n} koin · ', meat: 'daging +{n} lapar',
      roar_pop: 'RAUNGAN!', roar_none: 'Raungan... tidak ada musuh dekat', swarm_hint: 'Dikeroyok! Tekan {b} 📢',
      bush: '🐾 Semak-semak bergetar... SESUATU MENDEKAT!', horde: '🔥 KAWANAN MENYERBU! {n} musuh! Tekan {b} 📢',
      horde_won: '🏆 Kawanan dikalahkan! +{x} XP, +{c} koin', dodge: 'HINDAR!',
      new_species: '📖 Spesies baru: {n} ({a}/{b})', chasing: '⚠ {n} mengejar!', fresh_sp: ' 📖 spesies baru',
      day_toast: '☀ Hari ke-{n}! +30 XP', swim: '🏊 Berenang! Dinosaurus darat tidak bisa mengikuti',
      climb: '🧗 Tebing curam! Memanjat menguras tenaga', drink: 'Minum air 💧', fruit: 'Buah 🍒 +{n} lapar',
      power: '🥚 MODE KUAT! Gigitan 3x lebih sakit, kebal serangan'
    },
    en: {
      hud_day: 'Day', power_mode: '🥚 POWER MODE', top_btn: '⚙ Trade & Settings', top_aria: 'Trade and settings',
      sk_roar: 'ROAR', sk_run: 'RUN', sk_jump: 'JUMP', sk_bite: 'BITE', unit_sec: 's',
      menu_lead: 'Explore the prehistoric valley, survive and collect coins',
      help1: '🕹️ Left stick: move freely', help2: '👆 Swipe right side: rotate camera 360°', help3: '🦖 Bite: attack predators',
      help4: '⤴ Jump: dodge bites', help5: '🏃⤴ Run + Jump: far & high', help6: '🏃 Run: escape (drains stamina)',
      help7: '🍒 Fruit bush: restores hunger', help8: '💧 Pond: quenches thirst',
      total_coins: 'Total coins', record: 'Record', days_unit: 'days', cta_start: 'Tap to start', cta_again: 'Tap to play again',
      bag_btn: '🎒 Bag & Exchange Points', claim_soon: 'Claim Vosil (soon)', over_title: 'YOU FELL',
      survived: 'Survived', predators: 'Predators', level: 'Level', coins_earned: 'Coins earned',
      tab_ex: '🎒 Trade', tab_chr: '🦖 Character', tab_set: '⚙ Settings', close: 'Close',
      quit_open: '🦖 Open character selection', quit_sure: 'Sure? This run will end. Tap again',
      chr_note: 'Picking here: the new dino is used in the next run. The green button above ends this run and opens the main page with the dino preview (coins stay saved).',
      music_on: '🎵 Music: ON', music_off: '🎵 Music: OFF', sfx_on: '🔊 Sound effects: ON', sfx_off: '🔊 Sound effects: OFF',
      quality_lbl: '◪ Graphics quality: {q}', q_low: 'Low', q_mid: 'Medium', q_high: 'High', fs_btn: '⛶ Fullscreen',
      set_note: 'Graphics quality: Low = lightest, High = best looking. Changes apply instantly.',
      lang_lbl: '🌐 Language: {l}', lang_auto: 'Automatic ({l})',
      rot_title: 'Vosil Survival is played in landscape', rot_btn: '⛶ ENTER GAME (fullscreen)',
      rot_note: 'Tap for landscape fullscreen, then pick a dino and start. If the screen does not rotate by itself, turn your phone manually.',
      rot_ios: 'iPhone does not allow auto-rotate. Turn your phone manually, or use Safari → Share → Add to Home Screen for fullscreen.',
      fatal_link: 'WebGL test to find the cause',
      fatal_three: 'Three.js failed to load. Make sure you are online, or download three.min.js (version r128) and put it in the same folder as survival.html.',
      fatal_webgl: 'WebGL cannot run in this browser. Open it directly in Chrome or Safari (not inside WhatsApp/Instagram/Telegram), turn off battery saver, then open webgl-test.html to diagnose.',
      'biome.plain': 'Grassland', 'biome.forest': 'Dense Forest', 'biome.desert': 'Rocky Desert', 'biome.swamp': 'Misty Swamp',
      'info.vosil': 'Balanced for any situation', 'info.velo': 'Very fast, but weak bite and fragile',
      'info.carno': 'Strong bite and tough, but a bit slow', 'info.spino': 'Very tough and thirst-resistant, but slow',
      'info.parasaur': 'Great stamina for long runs, but weak bite',
      lvl_toast: '⬆ LEVEL {n}! Your dino grows bigger and stronger', lvl_pop: 'LEVEL {n}!',
      fall_chasm: "🕳️ You fell into the chasm! You're fine, back at the edge", door_back: '🚪 You returned to the start with the treasure!',
      zone_tip: '🪨 Jump Challenge Area! Tip: RUN then JUMP = long jump', chest: '🎁 Treasure chest! +25 coins',
      start_hint: 'Find water and fruit. Beware of predators!', rec_new: 'New record!', rec_line: 'Record: {n} days',
      fs_ios: 'iPhone: tap Share → Add to Home Screen for fullscreen', fs_none: "This browser doesn't support fullscreen",
      q_toast: 'Graphics quality: {q}', char_next: '🦖 {n} will be used in the next run',
      b_trophy: 'Trophies: {n} · worth {v} pts each · ', b_prey: 'Game animal · ', b_killed: 'total defeated {n}', b_trade_n: 'Trade +{n}',
      b_none: 'None yet. Defeat dinosaurs to earn trophies.', b_sum: '🪙 {c}  ·  ⭐ {p} pts',
      h_coin: 'Coins', b_coin_row: '🪙 {n} coins', b_coin_rate: '{r} coins = 1 exchange point', b_trade_pts: 'Trade +{n} points',
      h_trophy: 'Dinosaur trophies', b_trade_all: 'Trade all assets (+{n} points)', h_token: 'Exchange points → Vosil Token',
      b_pts_row: '⭐ {n} exchange points', b_pts_rate: '{r} points = 1 VOSIL · estimate {e} VOSIL', b_claim_soon: 'Claim (soon)',
      b_resume: '▶ Resume (game paused)',
      b_note: 'Exchange rates may change at any time according to policy. Exchange points are stored on this device. Token claims will go live with the World Chain wallet stage and are verified by the server before being sent.',
      r_quit: 'Left to menu', r_thirst: 'Died of thirst', r_hunger: 'Died of hunger', r_eaten: 'Eaten by {n}',
      hp_crit: '😱 Critical HP! All pouch coins spilled', upset: 'DISTURBED', enraged: '💢 {n} is enraged!',
      meat_coins: '+{n} coins · ', meat: 'meat +{n} hunger',
      roar_pop: 'ROAR!', roar_none: 'Roar... no enemies nearby', swarm_hint: 'Swarmed! Press {b} 📢',
      bush: '🐾 The bushes are shaking... SOMETHING IS COMING!', horde: '🔥 PACK ATTACK! {n} enemies! Press {b} 📢',
      horde_won: '🏆 Pack defeated! +{x} XP, +{c} coins', dodge: 'DODGE!',
      new_species: '📖 New species: {n} ({a}/{b})', chasing: '⚠ {n} is chasing you!', fresh_sp: ' 📖 new species',
      day_toast: '☀ Day {n}! +30 XP', swim: "🏊 Swimming! Land dinosaurs can't follow",
      climb: '🧗 Steep cliff! Climbing drains stamina', drink: 'Drinking water 💧', fruit: 'Fruit 🍒 +{n} hunger',
      power: '🥚 POWER MODE! Bites hurt 3x more, immune to attacks'
    },
    es: {
      hud_day: 'Día', power_mode: '🥚 MODO FUERTE', top_btn: '⚙ Canje y Ajustes', top_aria: 'Canje y ajustes',
      sk_roar: 'RUGIR', sk_run: 'CORRER', sk_jump: 'SALTAR', sk_bite: 'MORDER', unit_sec: 's',
      menu_lead: 'Explora el valle prehistórico, sobrevive y reúne monedas',
      help1: '🕹️ Palanca izquierda: muévete libremente', help2: '👆 Desliza a la derecha: girar la cámara 360°', help3: '🦖 Morder: ataca a los depredadores',
      help4: '⤴ Saltar: esquiva los mordiscos', help5: '🏃⤴ Correr + Saltar: lejos y alto', help6: '🏃 Correr: huye (gasta energía)',
      help7: '🍒 Arbusto de fruta: calma el hambre', help8: '💧 Estanque: calma la sed',
      total_coins: 'Monedas totales', record: 'Récord', days_unit: 'días', cta_start: 'Toca para empezar', cta_again: 'Toca para jugar otra vez',
      bag_btn: '🎒 Bolsa y Canje de puntos', claim_soon: 'Reclamar Vosil (pronto)', over_title: 'HAS CAÍDO',
      survived: 'Sobreviviste', predators: 'Depredadores', level: 'Nivel', coins_earned: 'Monedas ganadas',
      tab_ex: '🎒 Canje', tab_chr: '🦖 Personaje', tab_set: '⚙ Ajustes', close: 'Cerrar',
      quit_open: '🦖 Abrir selección de personaje', quit_sure: '¿Seguro? Esta partida terminará. Toca otra vez',
      chr_note: 'Elegir aquí: el nuevo dino se usa en la siguiente partida. El botón verde de arriba termina esta partida y abre la página principal con la vista previa del dino (las monedas se conservan).',
      music_on: '🎵 Música: ON', music_off: '🎵 Música: OFF', sfx_on: '🔊 Efectos de sonido: ON', sfx_off: '🔊 Efectos de sonido: OFF',
      quality_lbl: '◪ Calidad gráfica: {q}', q_low: 'Baja', q_mid: 'Media', q_high: 'Alta', fs_btn: '⛶ Pantalla completa',
      set_note: 'Calidad gráfica: Baja = más ligera, Alta = mejor aspecto. Los cambios se aplican al instante.',
      lang_lbl: '🌐 Idioma: {l}', lang_auto: 'Automático ({l})',
      rot_title: 'Vosil Survival se juega en horizontal', rot_btn: '⛶ ENTRAR AL JUEGO (pantalla completa)',
      rot_note: 'Toca para pantalla completa en horizontal, luego elige un dino y empieza. Si la pantalla no gira sola, gira el teléfono manualmente.',
      rot_ios: 'El iPhone no permite girar automáticamente. Gira el teléfono manualmente, o usa Safari → Compartir → Añadir a pantalla de inicio para pantalla completa.',
      fatal_link: 'Prueba de WebGL para encontrar la causa',
      fatal_three: 'No se pudo cargar Three.js. Comprueba tu conexión, o descarga three.min.js (versión r128) y ponlo en la misma carpeta que survival.html.',
      fatal_webgl: 'WebGL no puede ejecutarse en este navegador. Ábrelo directamente en Chrome o Safari (no dentro de WhatsApp/Instagram/Telegram), desactiva el ahorro de batería y abre webgl-test.html para diagnosticar.',
      'biome.plain': 'Pradera', 'biome.forest': 'Bosque denso', 'biome.desert': 'Desierto rocoso', 'biome.swamp': 'Pantano brumoso',
      'info.vosil': 'Equilibrado para cualquier situación', 'info.velo': 'Muy rápido, pero mordida débil y frágil',
      'info.carno': 'Mordida fuerte y resistente, pero algo lento', 'info.spino': 'Muy resistente y aguanta la sed, pero lento',
      'info.parasaur': 'Mucha energía para correr lejos, pero mordida débil',
      lvl_toast: '⬆ ¡NIVEL {n}! Tu dino crece y se fortalece', lvl_pop: '¡NIVEL {n}!',
      fall_chasm: '🕳️ ¡Caíste al abismo! No moriste, vuelves al borde', door_back: '🚪 ¡Volviste al inicio con el tesoro!',
      zone_tip: '🪨 ¡Zona de desafío de saltos! Consejo: CORRER y luego SALTAR = salto largo', chest: '🎁 ¡Cofre del tesoro! +25 monedas',
      start_hint: 'Busca agua y fruta. ¡Cuidado con los depredadores!', rec_new: '¡Nuevo récord!', rec_line: 'Récord: {n} días',
      fs_ios: 'iPhone: toca Compartir → Añadir a pantalla de inicio para pantalla completa', fs_none: 'Este navegador no admite pantalla completa',
      q_toast: 'Calidad gráfica: {q}', char_next: '🦖 {n} se usará en la próxima partida',
      b_trophy: 'Trofeos: {n} · valen {v} pts c/u · ', b_prey: 'Animal de caza · ', b_killed: 'total derrotados {n}', b_trade_n: 'Canjear +{n}',
      b_none: 'Aún nada. Derrota dinosaurios para ganar trofeos.', b_sum: '🪙 {c}  ·  ⭐ {p} pts',
      h_coin: 'Monedas', b_coin_row: '🪙 {n} monedas', b_coin_rate: '{r} monedas = 1 punto de canje', b_trade_pts: 'Canjear +{n} puntos',
      h_trophy: 'Trofeos de dinosaurio', b_trade_all: 'Canjear todo (+{n} puntos)', h_token: 'Puntos de canje → Token Vosil',
      b_pts_row: '⭐ {n} puntos de canje', b_pts_rate: '{r} puntos = 1 VOSIL · estimado {e} VOSIL', b_claim_soon: 'Reclamar (pronto)',
      b_resume: '▶ Seguir jugando (juego en pausa)',
      b_note: 'Las tasas de canje pueden cambiar en cualquier momento según la política. Los puntos de canje se guardan en este dispositivo. El reclamo de tokens se activará en la etapa de la billetera World Chain y el servidor lo verificará antes de enviarlo.',
      r_quit: 'Salió al menú', r_thirst: 'Murió de sed', r_hunger: 'Murió de hambre', r_eaten: 'Devorado por {n}',
      hp_crit: '😱 ¡HP crítico! Se derramaron todas las monedas de la bolsa', upset: 'MOLESTO', enraged: '💢 ¡{n} está furioso!',
      meat_coins: '+{n} monedas · ', meat: 'carne +{n} hambre',
      roar_pop: '¡RUGIDO!', roar_none: 'Rugido... no hay enemigos cerca', swarm_hint: '¡Te rodean! Pulsa {b} 📢',
      bush: '🐾 Los arbustos tiemblan... ¡ALGO SE ACERCA!', horde: '🔥 ¡MANADA ATACANDO! ¡{n} enemigos! Pulsa {b} 📢',
      horde_won: '🏆 ¡Manada derrotada! +{x} XP, +{c} monedas', dodge: '¡ESQUIVA!',
      new_species: '📖 Nueva especie: {n} ({a}/{b})', chasing: '⚠ ¡{n} te persigue!', fresh_sp: ' 📖 nueva especie',
      day_toast: '☀ ¡Día {n}! +30 XP', swim: '🏊 ¡Nadando! Los dinosaurios terrestres no pueden seguirte',
      climb: '🧗 ¡Acantilado empinado! Trepar gasta energía', drink: 'Bebiendo agua 💧', fruit: 'Fruta 🍒 +{n} hambre',
      power: '🥚 ¡MODO FUERTE! Mordiscos 3x más fuertes, inmune a ataques'
    }
  };

  function deviceLang() {                                  // bahasa HP; tidak didukung -> English
    let list = [];
    try { list = (navigator.languages && navigator.languages.length ? Array.from(navigator.languages) : [navigator.language || navigator.userLanguage || 'en']); } catch (e) { list = ['en']; }
    for (const raw of list) {
      const c = String(raw || '').toLowerCase().split(/[-_]/)[0];
      if (c === 'in') return 'id';                        // kode lama Android untuk Indonesia
      if (D[c]) return c;
    }
    return 'en';
  }
  let pref = 'auto';
  try { const s = localStorage.getItem(KEY); if (s === 'auto' || D[s]) pref = s; } catch (e) { /* abaikan */ }
  let cur = pref === 'auto' ? deviceLang() : pref;
  const listeners = [];

  function t(key, v) {
    let s = (D[cur] && D[cur][key] != null) ? D[cur][key] : (D.en[key] != null ? D.en[key] : (D.id[key] != null ? D.id[key] : key));
    if (v) s = s.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m));
    return s;
  }
  function apply() {
    try {
      document.documentElement.lang = cur;
      document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
      document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
      const m = document.getElementById('musicBtn'), s = document.getElementById('sfxBtn');
      if (m) { m.dataset.on = t('music_on'); m.dataset.off = t('music_off'); }
      if (s) { s.dataset.on = t('sfx_on'); s.dataset.off = t('sfx_off'); }
      if (typeof GameAudio !== 'undefined' && GameAudio.refreshLabels) GameAudio.refreshLabels();
    } catch (e) { /* abaikan */ }
    listeners.forEach((fn) => { try { fn(cur); } catch (e) { /* abaikan */ } });
  }
  function setPref(p) {
    pref = (p === 'auto' || D[p]) ? p : 'auto';
    try { localStorage.setItem(KEY, pref); } catch (e) { /* abaikan */ }
    cur = pref === 'auto' ? deviceLang() : pref;
    apply();
  }
  return {
    t, apply, setPref, onChange(fn) { listeners.push(fn); },
    get lang() { return cur; }, get pref() { return pref; }, NAMES, order: ['auto', 'id', 'en', 'es'],
    label() { return pref === 'auto' ? t('lang_auto', { l: NAMES[cur] }) : NAMES[pref]; }
  };
})();
