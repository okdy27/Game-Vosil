/* arena.js - klien arena online (TAHAP UJI 1). Menyambung ke /api/arena/ws, mengirim posisi sendiri,
 * menerima posisi pemain lain. Tidak menggambar apa pun: survival.js yang menggambar pemain lain dari Arena.remotes. */
const Arena = (() => {
  const st = { ws: null, id: 0, on: false, seed: 0, x: 0, z: 0, room: 0, remotes: new Map(), onFix: null, onEnd: null, lastSend: 0, skew: 0, t0: 0, count: 1, max: 8, onJoin: null, onLeave: null };
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const wsUrl = (room) => (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/arena/ws?room=' + room;
  const WS = () => (typeof WebSocket !== 'undefined' ? WebSocket : null);

  function reset() { st.off = undefined; st.ws = null; st.id = 0; st.on = false; st.remotes.clear(); }

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
          st.count = (m.roster || []).length || 1; st.max = m.max || 8; st.t0 = m.t0 || 0; st.skew = m.ts ? m.ts - (Date.now() - (Date.now() - helloAt) / 2) : 0;      // selisih jam server (perkiraan separuh waktu pulang-pergi)
          for (const c of m.roster || []) if (c.id !== m.id) addCard(c);
          fin(resolve, { id: m.id, seed: m.seed, x: m.x, z: m.z, room });
          return;
        }
        if (st.ws === ws) handle(m);
      };
    });
  }

  function addCard(c) {
    if (!st.remotes.has(c.id)) st.remotes.set(c.id, { id: c.id, name: c.name, char: c.char, level: c.level, x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, atk: -1, seen: false, t: 0 });
    else Object.assign(st.remotes.get(c.id), { name: c.name, char: c.char, level: c.level });
  }

  function handle(m) {
    if (m.t === 'j') { addCard(m.p); st.count = Math.min(st.max, st.count + 1); if (st.onJoin) st.onJoin(m.p); }
    else if (m.t === 'l') { const r = st.remotes.get(m.id); st.remotes.delete(m.id); st.count = Math.max(1, st.count - 1); if (r && st.onLeave) st.onLeave(r); }
    else if (m.t === 'f') { if (st.onFix) st.onFix(m.x, m.z); }
    else if (m.t === 'kick') leave();
    else if (m.t === 'p') {
      if (typeof m.n === 'number') st.count = m.n;
      if (m.ts) { const d = Date.now() - m.ts; st.off = st.off === undefined ? d : Math.min(d, st.off + 0.4); }     // selisih jam terkecil = paket tercepat
      const seen = new Set();
      for (const a of m.p) {
        const r = st.remotes.get(a[0]); if (!r) continue;
        seen.add(r.id);
        r.tx = a[1]; r.ty = a[2]; r.tz = a[3]; r.yaw = a[4]; r.vx = a[5]; r.vz = a[6]; r.atk = a[7]; r.sw = a[8]; r.level = a[9];
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
    if (now - st.lastSend < 60) return;
    st.lastSend = now;
    st.ws.send(JSON.stringify({ t: 's', x: +p.x.toFixed(2), z: +p.z.toFixed(2), y: +p.y.toFixed(2), yaw: +p.yaw.toFixed(2), vx: +p.vx.toFixed(1), vz: +p.vz.toFixed(1), atk: +(p.atk === undefined ? -1 : p.atk).toFixed(2), sw: p.sw ? 1 : 0, lv: p.lv || 1 }));
  }

  // waktu dunia bersama (detik sejak arena dimulai) -> semua pemain melihat siang/malam yang sama
  // waktu server yang sedang ditampilkan (sedikit di masa lalu supaya selalu ada data untuk diinterpolasi)
  const renderTime = () => Date.now() - (st.off || 0) - 180;
  const worldTime = () => Math.max(0, (Date.now() + st.skew - st.t0) / 1000);

  function leave() { const ws = st.ws; reset(); try { ws && ws.close(); } catch (e) { /* abaikan */ } }

  return { st, join, send, leave, worldTime, nowMs, renderTime, get on() { return st.on; }, get remotes() { return st.remotes; }, set onFix(f) { st.onFix = f; }, set onEnd(f) { st.onEnd = f; }, set onJoin(f) { st.onJoin = f; }, set onLeave(f) { st.onLeave = f; } };
})();
if (typeof module !== 'undefined') module.exports = Arena;
