/* arena-client.js - klien arena online (JALAN DI HP PEMAIN; folder utama) (TAHAP UJI 1). Menyambung ke /api/arena/ws, mengirim posisi sendiri,
 * menerima posisi pemain lain. Tidak menggambar apa pun: survival.js yang menggambar pemain lain dari Arena.remotes. */
const Arena = (() => {
  const st = { ws: null, id: 0, on: false, seed: 0, x: 0, z: 0, room: 0, remotes: new Map(), onFix: null, onEnd: null, lastSend: 0, skew: 0, t0: 0, count: 1, max: 8, rtt: 0, jit: 0, lastPing: 0, ds: 0, lastKey: '', onDamaged: null, onHit: null, onKill: null, onRoar: null, onEmote: null, onSkill: null, onHp: null, kits: null, onJoin: null, onLeave: null };
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const wsUrl = (room) => (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/arena/ws?room=' + room;
  const WS = () => (typeof WebSocket !== 'undefined' ? WebSocket : null);

  function reset() { st.ds = 0; st.lastKey = ''; st.off = undefined; st.ws = null; st.id = 0; st.on = false; st.remotes.clear(); }

  // coba arena 1..4 sampai ada yang masih punya tempat. Mengembalikan {seed, x, z, id} atau melempar Error('full'|'fail')
  async function join(info, maxRooms = 4) {
    if (!WS()) throw new Error('fail');
    leave();
    for (let room = 1; room <= maxRooms; room++) {
      let res;
      try { res = await tryRoom(room, info); } catch (e) { throw new Error('fail'); }
      if (res) return res;
    }
    throw new Error('full');
  }

  function tryRoom(room, info) {
    return new Promise((resolve, reject) => {
      let ws, done = false, helloAt = 0;
      const fin = (fn, v) => { if (!done) { done = true; clearTimeout(to); fn(v); } };
      const to = setTimeout(() => { try { ws && ws.close(); } catch (e) { /* abaikan */ } fin(reject, new Error('timeout')); }, 8000);
      try { ws = new (WS())(wsUrl(room)); } catch (e) { fin(reject, e); return; }
      ws.onopen = () => { helloAt = Date.now(); ws.send(JSON.stringify({ t: 'h', name: info.name, char: info.char, level: info.level })); };
      ws.onerror = () => fin(reject, new Error('ws'));
      ws.onclose = () => { if (!done) fin(resolve, null); else if (st.ws === ws) { const was = st.on; reset(); if (was && st.onEnd) st.onEnd(); } };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'full') { fin(resolve, null); return; }
        if (m.t === 'w' && !done) {
          st.ws = ws; st.id = m.id; st.on = true; st.seed = m.seed; st.x = m.x; st.z = m.z; st.room = room; st.remotes.clear();
          st.kits = m.kits || null; st.count = (m.roster || []).filter((c) => !c.npc).length || 1; st.max = m.max || 8; st.t0 = m.t0 || 0; st.skew = m.ts ? m.ts - (Date.now() - (Date.now() - helloAt) / 2) : 0;      // selisih jam server (perkiraan separuh waktu pulang-pergi)
          for (const c of m.roster || []) if (c.id !== m.id) addCard(c);
          fin(resolve, { id: m.id, seed: m.seed, x: m.x, z: m.z, room });
          return;
        }
        if (st.ws === ws) handle(m);
      };
    });
  }

  function addCard(c) {
    if (!st.remotes.has(c.id)) st.remotes.set(c.id, { id: c.id, name: c.name, char: c.char, level: c.level, npc: !!c.npc, x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, atk: -1, seen: false, t: 0 });
    else Object.assign(st.remotes.get(c.id), { name: c.name, char: c.char, level: c.level });
  }

  function handle(m) {
    if (m.t === 'j') { addCard(m.p); if (!m.p.npc) { st.count = Math.min(st.max, st.count + 1); if (st.onJoin) st.onJoin(m.p); } }
    else if (m.t === 'l') { const r = st.remotes.get(m.id); st.remotes.delete(m.id); if (!m.npc && !(r && r.npc)) { st.count = Math.max(1, st.count - 1); if (r && st.onLeave) st.onLeave(r); } }
    else if (m.t === 'f') { if (st.onFix) st.onFix(m.x, m.z); }
    else if (m.t === 'd') { st.ds = m.seq || 0; if (st.onDamaged) st.onDamaged(m); }          // aku terkena serangan (server yang memutuskan)
    else if (m.t === 'h') { if (st.onHit) st.onHit(m); }                                       // seranganku mengenai lawan
    else if (m.t === 'k') { const r = st.remotes.get(m.id); if (r && m.id !== st.id) st.remotes.delete(m.id); if (st.onKill) st.onKill(m); }
    else if (m.t === 'S') { if (st.onSkill) st.onSkill(m); }                                    // lawan mulai skill: tanda bahaya di tanah
    else if (m.t === 'A') { if (st.onAlert) st.onAlert(m); }
    else if (m.t === 'W') { if (st.onWave) st.onWave(m); }
    else if (m.t === 'E') { if (st.onEmote) st.onEmote(m.id, m.e); }
    else if (m.t === 'R') { if (st.onRoar) st.onRoar(m.id); }
    else if (m.t === 'o') { const r = Date.now() - m.c; if (r >= 0 && r < 10000) st.rtt = st.rtt ? st.rtt * 0.7 + r * 0.3 : r; }
    else if (m.t === 'kick') leave();
    else if (m.t === 'p') {
      if (typeof m.n === 'number') st.count = m.n;
      if (typeof m.hp === 'number' && st.onHp) st.onHp(m.hp);                 // nyawaku menurut server
      if (m.ts) { const d = Date.now() - m.ts; if (st.off === undefined) st.off = d; else { st.jit += (Math.abs(d - st.off) - st.jit) * 0.1; st.off = Math.min(d, st.off + 1); } }     // selisih jam terkecil = paket tercepat
      const seen = new Set();
      for (const a of m.p) {
        const r = st.remotes.get(a[0]); if (!r) continue;
        seen.add(r.id);
        r.tx = a[1]; r.ty = a[2]; r.tz = a[3]; r.yaw = a[4]; r.vx = a[5]; r.vz = a[6]; r.atk = a[7]; r.sw = a[8]; r.level = a[9]; r.hp = a[10]; r.kills = a[11];
        if (!r.seen) { r.x = r.tx; r.y = r.ty; r.z = r.tz; r.seen = true; r.buf = []; }
        (r.buf = r.buf || []).push({ at: m.ts || Date.now(), x: r.tx, y: r.ty, z: r.tz, yaw: r.yaw });
        if (r.buf.length > 10) r.buf.shift();
        r.near = true; r.t = 0;
      }
      for (const r of st.remotes.values()) if (!seen.has(r.id)) { r.near = false; r.seen = false; r.buf = []; }         // di luar jarak: tidak digambar
    }
  }

  // kirim posisi sendiri, paling sering 10 kali per detik
  function send(p, now) {
    if (!st.on || !st.ws || st.ws.readyState !== 1) return;
    if (now - st.lastSend < 80) return;
    const key = [p.x.toFixed(2), p.z.toFixed(2), p.y.toFixed(2), p.yaw.toFixed(2), p.vx.toFixed(1), p.vz.toFixed(1), (p.atk === undefined ? -1 : p.atk).toFixed(2), p.sw ? 1 : 0, 0].join('|');
    if (key === st.lastKey && now - st.lastSend < 1000) return;       // tidak ada perubahan: hemat kuota (cukup 1x per detik)
    st.lastKey = key;
    st.lastSend = now;
    if (now - st.lastPing > 2000) { st.lastPing = now; st.ws.send(JSON.stringify({ t: 'q', c: Date.now() })); }
    st.ws.send(JSON.stringify({ t: 's', x: +p.x.toFixed(2), z: +p.z.toFixed(2), y: +p.y.toFixed(2), yaw: +p.yaw.toFixed(2), vx: +p.vx.toFixed(1), vz: +p.vz.toFixed(1), atk: +(p.atk === undefined ? -1 : p.atk).toFixed(2), sw: p.sw ? 1 : 0, lv: 1, ds: st.ds }));
  }

  // waktu dunia bersama (detik sejak arena dimulai) -> semua pemain melihat siang/malam yang sama
  // waktu server yang sedang ditampilkan (sedikit di masa lalu supaya selalu ada data untuk diinterpolasi)
  const delayMs = () => Math.min(260, Math.max(110, 100 + 2 * st.jit));       // jaringan stabil -> jeda tampil kecil; tidak stabil -> lebih besar agar tetap halus
  const renderTime = () => Date.now() - (st.off || 0) - delayMs();
  const worldTime = () => Math.max(0, (Date.now() + st.skew - st.t0) / 1000);

  const attack = (yaw) => { if (st.on && st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify({ t: 'a', yaw: +yaw.toFixed(3) })); };
  const tp = (k, x, z) => { if (st.on && st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify({ t: 'tp', k, x: +x.toFixed(2), z: +z.toFixed(2) })); };
  const emote = (e) => { if (st.on && st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify({ t: 'e', e })); };
  const skill = (yaw) => { if (st.on && st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify({ t: 'k', yaw: +yaw.toFixed(3) })); };
  const roar = () => { if (st.on && st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify({ t: 'r' })); };

  function leave() { const ws = st.ws; reset(); try { ws && ws.close(); } catch (e) { /* abaikan */ } }

  return { st, join, send, tp, attack, roar, skill, emote, leave, worldTime, nowMs, renderTime, delayMs, get on() { return st.on; }, get remotes() { return st.remotes; }, set onFix(f) { st.onFix = f; }, set onEnd(f) { st.onEnd = f; }, set onDamaged(f) { st.onDamaged = f; }, set onHit(f) { st.onHit = f; }, set onKill(f) { st.onKill = f; }, set onRoar(f) { st.onRoar = f; }, set onEmote(f) { st.onEmote = f; }, set onSkill(f) { st.onSkill = f; }, set onHp(f) { st.onHp = f; }, set onAlert(f) { st.onAlert = f; }, set onWave(f) { st.onWave = f; }, get kits() { return st.kits; }, set onJoin(f) { st.onJoin = f; }, set onLeave(f) { st.onLeave = f; } };
})();
if (typeof module !== 'undefined') module.exports = Arena;
