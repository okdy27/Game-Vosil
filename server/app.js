// app.js - logika server Vosil Game (Cloudflare Worker + D1). Tidak bergantung pada pustaka blockchain:
// semua hal on-chain lewat `chain` (chain.js) sehingga logika ini bisa diuji tanpa jaringan.
// Aturan mengikuti dokumen "Game Vosil - Spesifikasi Anggaran dan Penukaran".

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (address TEXT PRIMARY KEY, created_at INTEGER NOT NULL, points INTEGER NOT NULL DEFAULT 0, total_credited INTEGER NOT NULL DEFAULT 0, last_beat INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0, note TEXT)`,
  `CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, address TEXT NOT NULL, message TEXT NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS beats (address TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (address, day))`,
  `CREATE TABLE IF NOT EXISTS credits (req_id TEXT PRIMARY KEY, address TEXT NOT NULL, day TEXT NOT NULL, points INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS credits_addr_day ON credits (address, day)`,
  `CREATE TABLE IF NOT EXISTS redemptions (id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL, points INTEGER NOT NULL, vos INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, created_day TEXT NOT NULL, review_after INTEGER NOT NULL, processed_at INTEGER, processed_day TEXT, tx_hash TEXT, note TEXT)`,
  `CREATE INDEX IF NOT EXISTS red_status ON redemptions (status, created_at)`,
  `CREATE INDEX IF NOT EXISTS red_addr ON redemptions (address, created_at)`,
  `CREATE TABLE IF NOT EXISTS ips (day TEXT NOT NULL, ip_hash TEXT NOT NULL, address TEXT NOT NULL, PRIMARY KEY (day, ip_hash, address))`,
  `CREATE TABLE IF NOT EXISTS devices (device_hash TEXT NOT NULL, address TEXT NOT NULL, PRIMARY KEY (device_hash, address))`,
  `CREATE TABLE IF NOT EXISTS links (code TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, status TEXT NOT NULL, address TEXT, token TEXT, expires INTEGER NOT NULL, ip_hash TEXT)`,
  `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT)`,
  `CREATE TABLE IF NOT EXISTS presence (id TEXT PRIMARY KEY, ts INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS presence_ts ON presence (ts)`,
];

// ---- pengaturan (bisa diubah lewat "vars" di wrangler.jsonc) ----
export function settings(env) {
  const n = (k, d) => { const v = Number(env[k]); return Number.isFinite(v) && env[k] !== '' && env[k] != null ? v : d; };
  return {
    ptPerVos: n('PT_PER_VOS', 1000),
    earnCapDay: n('EARN_CAP_DAY', 1000),            // batas poin yang boleh masuk ke akun per dompet per hari (= 1 VOS)
    earnPerMin: n('EARN_PTS_PER_MIN', 30),          // poin yang boleh masuk per menit waktu main yang diamati server
    redeemMin: n('REDEEM_MIN', 5000),               // minimum penukaran (poin)
    redeemMaxDay: n('REDEEM_MAX_DAY', 5000),        // maksimum penukaran per dompet per hari (poin)
    reviewMinH: n('REVIEW_MIN_HOURS', 24),          // jeda tinjauan 24-48 jam
    reviewMaxH: n('REVIEW_MAX_HOURS', 48),
    dailyQuotaVos: n('DAILY_QUOTA_VOS', 335),       // kuota penukaran global per hari = jatah kuartal / 90
    quarterBudgetVos: n('QUARTER_BUDGET_VOS', 30185),
    maxWalletsIp: n('MAX_WALLETS_PER_IP_DAY', 5),
    maxWalletsDevice: n('MAX_WALLETS_PER_DEVICE', 2),
    batch: n('PAYOUT_BATCH', 5),
    dayOffsetH: n('DAY_OFFSET_HOURS', 7),           // batas hari = tengah malam WIB
    payoutEnabled: String(env.PAYOUT_ENABLED || '0') === '1',
    sessionDays: n('SESSION_DAYS', 30),
  };
}

class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const J = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const enc = new TextEncoder();
const b64u = (buf) => { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmac(secret, data) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
async function sha(text) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(text))); }
function safeEq(a, b) { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

export function createApp(deps) {
  const chain = deps.chain;
  const nowFn = deps.now || (() => Date.now());
  let schemaReady = null;
  const ensureSchema = (env) => (schemaReady = schemaReady || env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))).catch((e) => { schemaReady = null; throw e; }));
  const dayKey = (env, t) => new Date((t ?? nowFn()) + settings(env).dayOffsetH * 3600e3).toISOString().slice(0, 10);

  const first = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).first();
  const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results || [];
  const run = (env, sql, ...args) => env.DB.prepare(sql).bind(...args).run();
  const event = (env, kind, detail) => run(env, 'INSERT INTO events (ts, kind, detail) VALUES (?,?,?)', nowFn(), kind, String(detail || '').slice(0, 300)).catch(() => {});

  async function readBody(req) { try { const t = await req.text(); if (t.length > 4000) throw 0; return t ? JSON.parse(t) : {}; } catch (e) { throw new HttpError(400, 'bad_request'); } }
  const normAddr = (a) => { if (typeof a !== 'string' || !chain.isAddress(a)) throw new HttpError(400, 'bad_address'); return a.toLowerCase(); };

  async function verifyTurnstile(env, token, ip) {
    if (!env.TURNSTILE_SECRET) return true;                       // belum dikonfigurasi -> dilewati
    if (!token || typeof token !== 'string') return false;
    try {
      const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token }); if (ip) body.set('remoteip', ip);
      const r = await (deps.fetch || fetch)('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
      const j = await r.json(); return !!j.success;
    } catch (e) { return false; }
  }

  // ---- sesi: token bertanda tangan HMAC (tanpa penyimpanan) ----
  async function makeToken(env, address) {
    if (!env.SESSION_SECRET) throw new HttpError(500, 'server_not_configured');
    const payload = b64u(enc.encode(JSON.stringify({ a: address, e: nowFn() + settings(env).sessionDays * 86400e3 })));
    return payload + '.' + (await hmac(env.SESSION_SECRET, payload));
  }
  async function auth(env, req) {
    const h = req.headers.get('authorization') || '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : '';
    const [p, sig] = t.split('.');
    if (!p || !sig || !env.SESSION_SECRET) throw new HttpError(401, 'not_logged_in');
    if (!safeEq(sig, await hmac(env.SESSION_SECRET, p))) throw new HttpError(401, 'not_logged_in');
    let d; try { d = JSON.parse(unb64u(p)); } catch (e) { throw new HttpError(401, 'not_logged_in'); }
    if (!d.a || d.e < nowFn()) throw new HttpError(401, 'session_expired');
    const acc = await first(env, 'SELECT * FROM accounts WHERE address = ?', d.a);
    if (!acc) throw new HttpError(401, 'not_logged_in');
    if (acc.blocked) throw new HttpError(403, 'blocked');
    return acc;
  }
  function requireAdmin(env, req) {
    const h = req.headers.get('authorization') || '';
    if (!env.ADMIN_KEY || !safeEq(h, 'Bearer ' + env.ADMIN_KEY)) throw new HttpError(401, 'admin_only');
  }

  // ---- hitungan hari ini ----
  async function todayState(env, acc) {
    const S = settings(env), day = dayKey(env);
    const b = await first(env, 'SELECT n FROM beats WHERE address = ? AND day = ?', acc.address, day);
    const c = await first(env, 'SELECT COALESCE(SUM(points),0) AS s FROM credits WHERE address = ? AND day = ?', acc.address, day);
    const allowance = Math.min(S.earnCapDay, Math.floor(((b && b.n) || 0) * S.earnPerMin));
    const credited = (c && c.s) || 0;
    return { day, cap: S.earnCapDay, allowance, credited, available: Math.max(0, allowance - credited) };
  }
  async function queueInfo(env) {
    const S = settings(env), day = dayKey(env);
    const q = await first(env, `SELECT COUNT(*) AS n, COALESCE(SUM(vos),0) AS v FROM redemptions WHERE status IN ('queued','error')`);
    const p = await first(env, `SELECT COALESCE(SUM(vos),0) AS v FROM redemptions WHERE processed_day = ? AND status IN ('sent','paid')`, day);
    return { queueCount: q.n, queueVos: q.v, quotaDay: S.dailyQuotaVos, paidToday: p.v, quotaLeft: Math.max(0, S.dailyQuotaVos - p.v) };
  }

  // ================= rute publik =================
  async function routeConfig(env) {
    const S = settings(env);
    return J({
      ok: true, chainId: Number(env.CHAIN_ID || 480), token: env.TOKEN_ADDRESS || '', symbol: 'VOS',
      ptPerVos: S.ptPerVos, earnCapDay: S.earnCapDay, redeemMin: S.redeemMin, redeemMaxDay: S.redeemMaxDay,
      reviewHours: [S.reviewMinH, S.reviewMaxH], payoutEnabled: S.payoutEnabled,
      arena: String(env.ARENA_ENABLED || '0') === '1' && !!env.ARENA,
      turnstileSiteKey: env.TURNSTILE_SECRET ? (env.TURNSTILE_SITEKEY || '') : '',
      ...(await queueInfo(env)),
    });
  }

  async function routeNonce(env, req) {
    const b = await readBody(req), ip = req.headers.get('cf-connecting-ip') || '';
    const address = normAddr(b.address);
    let linkCode = '';
    if (typeof b.code === 'string' && b.code) {                              // tautan dari halaman wallet.html (captcha sudah dicek di link/start)
      linkCode = b.code.toUpperCase().slice(0, 12);
      const lk = await first(env, 'SELECT status, expires FROM links WHERE code = ?', linkCode);
      if (!lk || lk.status !== 'pending' || lk.expires < nowFn()) throw new HttpError(400, 'link_expired');
    } else if (!(await verifyTurnstile(env, b.cf, ip))) throw new HttpError(403, 'captcha_failed');
    const acc = await first(env, 'SELECT blocked FROM accounts WHERE address = ?', address);
    if (acc && acc.blocked) throw new HttpError(403, 'blocked');
    const nonce = hex(crypto.getRandomValues(new Uint8Array(16))), exp = nowFn() + 10 * 60e3;
    // format standar EIP-4361 (Sign-In with Ethereum): MetaMask mengenalinya & menampilkannya sebagai "Permintaan masuk" yang rapi
    const host = new URL(req.url).host, ck = chain.toChecksum ? chain.toChecksum(address) : address;
    const message = [
      host + ' wants you to sign in with your Ethereum account:', ck, '',
      'Sign in to Vosil Game. Signature only: no transaction, no fee.', '',
      'URI: https://' + host, 'Version: 1', 'Chain ID: ' + Number(env.CHAIN_ID || 480), 'Nonce: ' + nonce,
      'Issued At: ' + new Date(nowFn()).toISOString(), 'Expiration Time: ' + new Date(exp).toISOString(),
    ].concat(linkCode ? ['Request ID: ' + linkCode] : []).join('\n');
    await run(env, 'DELETE FROM nonces WHERE expires < ?', nowFn());
    await run(env, 'INSERT INTO nonces (nonce, address, message, expires) VALUES (?,?,?,?)', nonce, address, message, exp);
    return J({ ok: true, nonce, message });
  }

  async function routeLogin(env, req) {
    const b = await readBody(req), ip = req.headers.get('cf-connecting-ip') || '';
    const r = await doLogin(env, b, ip);
    return J({ ok: true, address: r.address, token: r.token });
  }
  async function doLogin(env, b, ip, linkCode) {
    const S = settings(env);
    const address = normAddr(b.address);
    if (typeof b.nonce !== 'string' || typeof b.signature !== 'string') throw new HttpError(400, 'bad_request');
    const row = await first(env, 'SELECT * FROM nonces WHERE nonce = ?', b.nonce);
    if (!row || row.address !== address || row.expires < nowFn()) throw new HttpError(400, 'nonce_invalid');
    if (linkCode && !row.message.endsWith('\nRequest ID: ' + linkCode)) throw new HttpError(400, 'nonce_invalid');   // tanda tangan harus untuk kode tautan ini
    await run(env, 'DELETE FROM nonces WHERE nonce = ?', b.nonce);                      // sekali pakai
    if (!(await chain.verifySignature(address, row.message, b.signature))) throw new HttpError(401, 'signature_invalid');
    const acc0 = await first(env, 'SELECT blocked FROM accounts WHERE address = ?', address);
    if (acc0 && acc0.blocked) throw new HttpError(403, 'blocked');
    // batas dompet per jaringan (IP) dan per perangkat -> menyulitkan akun ganda
    const salt = env.SESSION_SECRET || '', day = dayKey(env);
    const ipH = await sha(salt + '|ip|' + ip), devH = typeof b.device === 'string' && b.device.length >= 8 ? await sha(salt + '|dev|' + b.device.slice(0, 80)) : '';
    const ipSeen = await first(env, 'SELECT 1 AS x FROM ips WHERE day = ? AND ip_hash = ? AND address = ?', day, ipH, address);
    if (!ipSeen) {
      const n = await first(env, 'SELECT COUNT(*) AS n FROM ips WHERE day = ? AND ip_hash = ?', day, ipH);
      if (n.n >= S.maxWalletsIp) { await event(env, 'limit_ip', address); throw new HttpError(429, 'too_many_wallets_network'); }
      await run(env, 'INSERT OR IGNORE INTO ips (day, ip_hash, address) VALUES (?,?,?)', day, ipH, address);
    }
    if (devH) {
      const seen = await first(env, 'SELECT 1 AS x FROM devices WHERE device_hash = ? AND address = ?', devH, address);
      if (!seen) {
        const n = await first(env, 'SELECT COUNT(*) AS n FROM devices WHERE device_hash = ?', devH);
        if (n.n >= S.maxWalletsDevice) { await event(env, 'limit_device', address); throw new HttpError(429, 'too_many_wallets_device'); }
        await run(env, 'INSERT OR IGNORE INTO devices (device_hash, address) VALUES (?,?)', devH, address);
      }
    }
    await run(env, 'INSERT OR IGNORE INTO accounts (address, created_at) VALUES (?,?)', address, nowFn());
    return { address, token: await makeToken(env, address) };
  }

  // ---- tautan dompet: game di Chrome <-> tanda tangan di peramban MetaMask/Trust (tanpa perlu landscape) ----
  async function routeLinkStart(env, req) {
    const b = await readBody(req), ip = req.headers.get('cf-connecting-ip') || '';
    if (typeof b.secretHash !== 'string' || !/^[0-9a-f]{64}$/.test(b.secretHash)) throw new HttpError(400, 'bad_request');
    if (!(await verifyTurnstile(env, b.cf, ip))) throw new HttpError(403, 'captcha_failed');
    const ipH = await sha((env.SESSION_SECRET || '') + '|ip|' + ip), t = nowFn();
    await run(env, 'DELETE FROM links WHERE expires < ?', t);
    const open = await first(env, 'SELECT COUNT(*) AS n FROM links WHERE ip_hash = ?', ipH);
    if (open.n >= 10) throw new HttpError(429, 'too_many_links');
    const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = ''; for (const x of crypto.getRandomValues(new Uint8Array(8))) code += ALPHA[x % ALPHA.length];
    await run(env, 'INSERT INTO links (code, secret_hash, status, expires, ip_hash) VALUES (?,?,?,?,?)', code, b.secretHash, 'pending', t + 10 * 60e3, ipH);
    return J({ ok: true, code, expires: t + 10 * 60e3 });
  }
  async function routeLinkComplete(env, req) {
    const b = await readBody(req), ip = req.headers.get('cf-connecting-ip') || '';
    const code = typeof b.code === 'string' ? b.code.toUpperCase().slice(0, 12) : '';
    const lk = code ? await first(env, 'SELECT * FROM links WHERE code = ?', code) : null;
    if (!lk || lk.status !== 'pending' || lk.expires < nowFn()) throw new HttpError(400, 'link_expired');
    const r = await doLogin(env, b, ip, code);
    await run(env, "UPDATE links SET status = 'done', address = ?, token = ? WHERE code = ?", r.address, r.token, code);
    return J({ ok: true, address: r.address });
  }
  async function routeLinkPoll(env, req) {
    const b = await readBody(req), code = typeof b.code === 'string' ? b.code.toUpperCase().slice(0, 12) : '';
    const lk = code ? await first(env, 'SELECT * FROM links WHERE code = ?', code) : null;
    if (!lk || lk.expires < nowFn()) throw new HttpError(400, 'link_expired');
    if (typeof b.secret !== 'string' || !safeEq(await sha(b.secret), lk.secret_hash)) throw new HttpError(403, 'link_invalid');
    if (lk.status !== 'done') return J({ ok: true, status: 'pending' });
    await run(env, 'DELETE FROM links WHERE code = ?', code);                              // token diserahkan sekali
    return J({ ok: true, status: 'done', address: lk.address, token: lk.token });
  }

  async function redemptionList(env, acc) {
    const rows = await all(env, 'SELECT id, points, vos, status, created_at, review_after, tx_hash FROM redemptions WHERE address = ? ORDER BY id DESC LIMIT 8', acc.address);
    for (const r of rows) {
      if (r.status === 'queued' || r.status === 'error') {
        const p = await first(env, `SELECT COUNT(*) AS n FROM redemptions WHERE status IN ('queued','error') AND id < ?`, r.id);
        r.position = p.n + 1;
      }
    }
    return rows;
  }

  async function routeMe(env, req) {
    const acc = await auth(env, req), S = settings(env), day = dayKey(env);
    const t = await todayState(env, acc);
    const rd = await first(env, 'SELECT COUNT(*) AS n FROM redemptions WHERE address = ? AND created_day = ?', acc.address, day);
    return J({ ok: true, address: acc.address, points: acc.points, today: t, redeemedToday: rd.n > 0, redemptions: await redemptionList(env, acc), limits: { redeemMin: S.redeemMin, redeemMaxDay: S.redeemMaxDay, ptPerVos: S.ptPerVos } });
  }

  async function routeBeat(env, req) {
    const acc = await auth(env, req), S = settings(env), t = nowFn();
    if (t - acc.last_beat >= 50e3) {                                          // maksimal 1 detak per ~menit
      await run(env, 'UPDATE accounts SET last_beat = ? WHERE address = ?', t, acc.address);
      await run(env, 'INSERT INTO beats (address, day, n) VALUES (?,?,1) ON CONFLICT(address, day) DO UPDATE SET n = n + 1', acc.address, dayKey(env));
    }
    const st = await todayState(env, acc);
    return J({ ok: true, available: st.available, allowance: st.allowance, credited: st.credited, cap: st.cap, perMin: S.earnPerMin });
  }

  async function routeCredit(env, req) {
    const acc = await auth(env, req), b = await readBody(req);
    const reqId = typeof b.reqId === 'string' ? b.reqId.slice(0, 64) : '', want = Math.floor(Number(b.points));
    if (reqId.length < 8 || !(want > 0) || want > 1e7) throw new HttpError(400, 'bad_request');
    const dup = await first(env, 'SELECT points FROM credits WHERE req_id = ?', reqId);
    if (dup) { const a = await first(env, 'SELECT points FROM accounts WHERE address = ?', acc.address); return J({ ok: true, dup: true, credited: dup.points, points: a.points }); }
    const st = await todayState(env, acc);
    const amt = Math.min(want, st.available);
    if (amt <= 0) throw new HttpError(429, 'no_allowance');
    await run(env, 'INSERT INTO credits (req_id, address, day, points, created_at) VALUES (?,?,?,?,?)', reqId, acc.address, st.day, amt, nowFn());
    await run(env, 'UPDATE accounts SET points = points + ?, total_credited = total_credited + ? WHERE address = ?', amt, amt, acc.address);
    const a = await first(env, 'SELECT points FROM accounts WHERE address = ?', acc.address);
    return J({ ok: true, credited: amt, points: a.points, available: st.available - amt });
  }

  async function routeRedeem(env, req) {
    const S = settings(env), acc = await auth(env, req), b = await readBody(req), ip = req.headers.get('cf-connecting-ip') || '', day = dayKey(env);
    if (!(await verifyTurnstile(env, b.cf, ip))) throw new HttpError(403, 'captcha_failed');
    const rd = await first(env, 'SELECT COUNT(*) AS n FROM redemptions WHERE address = ? AND created_day = ? AND status != ?', acc.address, day, 'cancelled');
    if (rd.n > 0) throw new HttpError(429, 'one_per_day');
    const open = await first(env, `SELECT COUNT(*) AS n FROM redemptions WHERE address = ? AND status IN ('queued','error','sending')`, acc.address);
    if (open.n > 0) throw new HttpError(429, 'already_queued');
    let pts = b.points == null ? Math.min(acc.points, S.redeemMaxDay) : Math.floor(Number(b.points));
    pts = Math.floor(pts / S.ptPerVos) * S.ptPerVos;                          // kelipatan 1 VOS
    if (!(pts >= S.redeemMin)) throw new HttpError(400, acc.points < S.redeemMin ? 'below_min' : 'bad_amount');
    if (pts > S.redeemMaxDay) throw new HttpError(400, 'above_max');
    const dec = await run(env, 'UPDATE accounts SET points = points - ? WHERE address = ? AND points >= ?', pts, acc.address, pts);
    if (!dec.meta || dec.meta.changes !== 1) throw new HttpError(400, 'insufficient_points');
    const t = nowFn(), reviewMs = (S.reviewMinH + Math.random() * Math.max(0, S.reviewMaxH - S.reviewMinH)) * 3600e3;
    try {
      const r = await run(env, 'INSERT INTO redemptions (address, points, vos, status, created_at, created_day, review_after) VALUES (?,?,?,?,?,?,?)', acc.address, pts, pts / S.ptPerVos, 'queued', t, day, t + reviewMs);
      return J({ ok: true, id: r.meta.last_row_id, points: pts, vos: pts / S.ptPerVos, reviewAfter: t + reviewMs });
    } catch (e) {
      await run(env, 'UPDATE accounts SET points = points + ? WHERE address = ?', pts, acc.address);   // kembalikan poin
      throw e;
    }
  }

  async function routeCancel(env, req) {
    const acc = await auth(env, req), b = await readBody(req), id = Math.floor(Number(b.id));
    const r = await run(env, `UPDATE redemptions SET status = 'cancelled', processed_at = ? WHERE id = ? AND address = ? AND status = 'queued'`, nowFn(), id, acc.address);
    if (!r.meta || r.meta.changes !== 1) throw new HttpError(400, 'cannot_cancel');
    const row = await first(env, 'SELECT points FROM redemptions WHERE id = ?', id);
    await run(env, 'UPDATE accounts SET points = points + ? WHERE address = ?', row.points, acc.address);
    return J({ ok: true });
  }

  async function routeReport(env) {
    const day = dayKey(env), q = await queueInfo(env);
    const tot = await first(env, `SELECT COUNT(*) AS n, COALESCE(SUM(vos),0) AS v, COUNT(DISTINCT address) AS w FROM redemptions WHERE status = 'paid'`);
    const wk = await first(env, `SELECT COALESCE(SUM(vos),0) AS v, COUNT(DISTINCT address) AS w FROM redemptions WHERE status = 'paid' AND processed_at > ?`, nowFn() - 7 * 86400e3);
    const last = await all(env, `SELECT vos, processed_at, tx_hash FROM redemptions WHERE status = 'paid' ORDER BY id DESC LIMIT 20`);
    let balance = null; try { if (env.GAME_WALLET_ADDRESS) balance = await chain.getBalance(env); } catch (e) { /* abaikan */ }
    return J({ ok: true, day, ...q, totalPaidVos: tot.v, totalPayments: tot.n, uniqueWalletsPaid: tot.w, week: { paidVos: wk.v, uniqueWallets: wk.w }, gameWallet: env.GAME_WALLET_ADDRESS || '', gameWalletVos: balance, last });
  }

  // ================= admin =================
  async function routeAdmin(env, req, path) {
    requireAdmin(env, req);
    if (path === '/api/admin/summary') {
      const q = await queueInfo(env);
      const list = await all(env, `SELECT r.*, a.blocked, a.total_credited, a.created_at AS acc_created FROM redemptions r LEFT JOIN accounts a ON a.address = r.address WHERE r.status IN ('queued','error','sending','sent') ORDER BY r.id ASC LIMIT 200`);
      const ev = await all(env, 'SELECT ts, kind, detail FROM events ORDER BY id DESC LIMIT 30');
      const acc = await first(env, 'SELECT COUNT(*) AS n FROM accounts');
      const lim = await first(env, `SELECT COUNT(*) AS n FROM events WHERE kind LIKE 'limit_%' AND ts > ?`, nowFn() - 7 * 86400e3);
      const rej = await first(env, `SELECT COUNT(*) AS n FROM redemptions WHERE status = 'rejected' AND processed_at > ?`, nowFn() - 7 * 86400e3);
      const newRed = await first(env, `SELECT COUNT(DISTINCT address) AS n FROM redemptions WHERE created_at > ?`, nowFn() - 7 * 86400e3);
      let balance = null; try { balance = await chain.getBalance(env); } catch (e) { /* abaikan */ }
      const S = settings(env);
      return J({ ok: true, settings: S, queue: q, list, events: ev, accounts: acc.n, week: { limitHits: lim.n, rejected: rej.n, walletsRequesting: newRed.n }, gameWalletVos: balance, weeklyNeed: Math.round(S.quarterBudgetVos / 13) });
    }
    const b = await readBody(req);
    if (path === '/api/admin/action') {
      const id = Math.floor(Number(b.id)), row = await first(env, 'SELECT * FROM redemptions WHERE id = ?', id);
      if (!row) throw new HttpError(404, 'not_found');
      if (b.action === 'reject') {
        if (!['queued', 'error'].includes(row.status)) throw new HttpError(400, 'bad_state');
        await run(env, `UPDATE redemptions SET status = 'rejected', processed_at = ?, note = ? WHERE id = ?`, nowFn(), String(b.note || '').slice(0, 200), id);
        if (b.refund !== false) await run(env, 'UPDATE accounts SET points = points + ? WHERE address = ?', row.points, row.address);
      } else if (b.action === 'requeue') {
        if (!['error'].includes(row.status)) throw new HttpError(400, 'bad_state');
        await run(env, `UPDATE redemptions SET status = 'queued', note = NULL WHERE id = ?`, id);
      } else if (b.action === 'approve-now') {
        await run(env, `UPDATE redemptions SET review_after = ? WHERE id = ? AND status = 'queued'`, nowFn(), id);
      } else if (b.action === 'mark-paid') {
        await run(env, `UPDATE redemptions SET status = 'paid', tx_hash = ?, processed_at = ?, processed_day = ? WHERE id = ?`, String(b.tx || '').slice(0, 80), nowFn(), dayKey(env), id);
      } else throw new HttpError(400, 'bad_action');
      await event(env, 'admin_' + b.action, 'id=' + id);
      return J({ ok: true });
    }
    if (path === '/api/admin/block') {
      const address = normAddr(b.address);
      await run(env, 'UPDATE accounts SET blocked = ?, note = ? WHERE address = ?', b.blocked === false ? 0 : 1, String(b.note || '').slice(0, 200), address);
      await event(env, 'admin_block', address + ' ' + (b.blocked === false ? 'unblock' : 'block'));
      return J({ ok: true });
    }
    if (path === '/api/admin/payout-now') { const r = await scheduled(env); return J({ ok: true, result: r }); }
    throw new HttpError(404, 'not_found');
  }

  // ================= pembayaran (dijalankan cron pada jam tetap) =================
  async function scheduled(env) {
    await ensureSchema(env);
    const S = settings(env), t = nowFn(), day = dayKey(env), out = { reconciled: 0, sent: 0, note: '' };
    // 1) cek transaksi yang sudah dikirim
    const sentRows = await all(env, `SELECT id, tx_hash FROM redemptions WHERE status = 'sent' AND tx_hash IS NOT NULL LIMIT 10`);
    for (const r of sentRows) {
      try {
        const st = await chain.getReceipt(env, r.tx_hash);
        if (st === 'success') { await run(env, `UPDATE redemptions SET status = 'paid' WHERE id = ?`, r.id); out.reconciled++; }
        else if (st === 'reverted') { await run(env, `UPDATE redemptions SET status = 'error', note = 'tx reverted' WHERE id = ?`, r.id); await event(env, 'tx_reverted', 'id=' + r.id); }
      } catch (e) { /* coba lagi di putaran berikutnya */ }
    }
    if (!S.payoutEnabled) { out.note = 'payout nonaktif'; return out; }
    // 2) kuota hari ini
    const paid = await first(env, `SELECT COALESCE(SUM(vos),0) AS v FROM redemptions WHERE processed_day = ? AND status IN ('sent','paid','sending')`, day);
    let left = S.dailyQuotaVos - paid.v;
    let balance = null; try { balance = await chain.getBalance(env); } catch (e) { out.note = 'gagal baca saldo'; await event(env, 'balance_error', String(e.message || e)); return out; }
    const weekly = S.quarterBudgetVos / 13;
    if (balance < weekly * 0.2) await event(env, 'low_balance', 'saldo dompet game ' + balance + ' VOS < 20% jatah mingguan');
    const rows = await all(env, `SELECT r.* FROM redemptions r JOIN accounts a ON a.address = r.address WHERE r.status = 'queued' AND r.review_after <= ? AND a.blocked = 0 ORDER BY r.created_at ASC, r.id ASC LIMIT ?`, t, S.batch);
    for (const r of rows) {
      if (r.vos > left) { out.note = 'kuota harian habis'; break; }                  // antrean FIFO: sisanya besok
      if (r.vos > balance) { out.note = 'saldo dompet game kurang'; await event(env, 'insufficient_balance', 'id=' + r.id); break; }
      const paidW = await first(env, `SELECT COALESCE(SUM(vos),0) AS v FROM redemptions WHERE address = ? AND processed_day = ? AND status IN ('sent','paid','sending')`, r.address, day);
      if (paidW.v + r.vos > S.redeemMaxDay / S.ptPerVos) { await event(env, 'wallet_cap', 'id=' + r.id); continue; }
      const lock = await run(env, `UPDATE redemptions SET status = 'sending', processed_day = ?, processed_at = ? WHERE id = ? AND status = 'queued'`, day, t, r.id);
      if (!lock.meta || lock.meta.changes !== 1) continue;
      try {
        const hash = await chain.sendPayout(env, r.address, BigInt(r.vos) * 10n ** 18n);
        await run(env, `UPDATE redemptions SET status = 'sent', tx_hash = ? WHERE id = ?`, hash, r.id);
        left -= r.vos; balance -= r.vos; out.sent++;
      } catch (e) {
        // status tidak pasti (mungkin sudah terkirim) -> jangan kirim ulang otomatis; periksa manual di worldscan
        await run(env, `UPDATE redemptions SET status = 'error', note = ? WHERE id = ?`, String(e.message || e).slice(0, 160), r.id);
        await event(env, 'payout_error', 'id=' + r.id + ' ' + String(e.message || e).slice(0, 120));
        out.note = 'error pembayaran'; break;
      }
    }
    return out;
  }

  // jumlah pemain online (semua mode): tiap pemain mengirim detak ~40 dtk sekali; dihitung yang aktif 90 dtk terakhir
  async function routePresence(env, request) {
    const origin = request.headers.get('Origin');
    if (origin) { let ok = false; try { ok = new URL(origin).host === new URL(request.url).host; } catch (e) { /* abaikan */ } if (!ok) throw new HttpError(403, 'forbidden'); }
    const b = await readBody(request), id = String(b.id || '').replace(/[^a-f0-9]/gi, '').toLowerCase().slice(0, 32);
    if (id.length < 12) throw new HttpError(400, 'bad_request');
    const t = nowFn();
    await run(env, 'INSERT INTO presence (id, ts) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET ts = excluded.ts', id, t);
    const r = await first(env, 'SELECT COUNT(*) AS n FROM presence WHERE ts > ?', t - 90e3);
    if (Math.random() < 0.03) await run(env, 'DELETE FROM presence WHERE ts < ?', t - 600e3).catch(() => {});      // bersih-bersih baris lama
    return J({ ok: true, n: Math.max(1, (r && r.n) || 1) });
  }

  async function fetchHandler(request, env) {
    const url = new URL(request.url), path = url.pathname.replace(/\/+$/, '');
    try {
      if (!env.DB) throw new HttpError(500, 'server_not_configured');
      await ensureSchema(env);
      const m = request.method;
      if (m === 'GET' && path === '/api/config') return await routeConfig(env);
      if (m === 'GET' && path === '/api/report') return await routeReport(env);
      if (m === 'GET' && path === '/api/me') return await routeMe(env, request);
      if (m === 'POST' && path === '/api/nonce') return await routeNonce(env, request);
      if (m === 'POST' && path === '/api/login') return await routeLogin(env, request);
      if (m === 'POST' && path === '/api/link/start') return await routeLinkStart(env, request);
      if (m === 'POST' && path === '/api/link/complete') return await routeLinkComplete(env, request);
      if (m === 'POST' && path === '/api/link/poll') return await routeLinkPoll(env, request);
      if (m === 'POST' && path === '/api/presence') return await routePresence(env, request);
      if (m === 'POST' && path === '/api/beat') return await routeBeat(env, request);
      if (m === 'POST' && path === '/api/credit') return await routeCredit(env, request);
      if (m === 'POST' && path === '/api/redeem') return await routeRedeem(env, request);
      if (m === 'POST' && path === '/api/cancel') return await routeCancel(env, request);
      if (path.startsWith('/api/admin/')) return await routeAdmin(env, request, path);
      throw new HttpError(404, 'not_found');
    } catch (e) {
      if (e instanceof HttpError) return J({ ok: false, error: e.code }, e.status);
      return J({ ok: false, error: 'server_error' }, 500);
    }
  }
  return { fetch: fetchHandler, scheduled, dayKey };
}
