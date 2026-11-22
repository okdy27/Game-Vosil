/* wallet.js - sambungan game ke server Vosil (login dompet lewat tanda tangan pesan, poin akun, antrean tukar VOS).
 * Tidak ada transaksi dari pemain dan tidak ada biaya gas. Semua aturan dijaga server (lihat server/app.js). */
const Wallet = (() => {
  'use strict';
  const K_SES = 'vosil_session_v1', K_DEV = 'vosil_device_v1';
  const st = { cfg: null, cfgAt: 0, me: null, session: null, busy: false, msg: '', msgOk: true, apiOk: null };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* abaikan */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* abaikan */ } },
  };
  try { const s = JSON.parse(store.get(K_SES) || 'null'); if (s && s.token && s.address) st.session = s; } catch (e) { /* abaikan */ }
  let device = store.get(K_DEV);
  if (!device || device.length < 16) { device = Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join(''); store.set(K_DEV, device); }
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(16).padStart(2, '0')).join('');

  class WErr extends Error { constructor(code) { super(code); this.code = code; } }

  async function api(path, body) {
    let res;
    try {
      res = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: Object.assign({ 'content-type': 'application/json' }, st.session ? { authorization: 'Bearer ' + st.session.token } : {}),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) { st.apiOk = false; throw new WErr('network'); }
    let j = null; try { j = await res.json(); } catch (e) { st.apiOk = false; throw new WErr(res.status === 404 ? 'server_off' : 'server_error'); }
    st.apiOk = true;
    if (!res.ok || !j || j.ok === false) {
      const code = (j && j.error) || 'server_error';
      if (code === 'not_logged_in' || code === 'session_expired') { st.session = null; st.me = null; store.del(K_SES); }
      throw new WErr(code);
    }
    return j;
  }

  async function loadConfig(force) {
    if (!force && st.cfg && Date.now() - st.cfgAt < 60e3) return st.cfg;
    try { st.cfg = await api('/api/config'); st.cfgAt = Date.now(); } catch (e) { st.cfg = null; }
    return st.cfg;
  }

  // ---- penyedia dompet (MetaMask / Trust Wallet / peramban dompet) ----
  function provider() {
    const e = window.ethereum; if (!e) return null;
    if (Array.isArray(e.providers) && e.providers.length) return e.providers.find((p) => p.isMetaMask) || e.providers[0];
    return e;
  }
  const hasProvider = () => !!provider();
  const toHex = (s) => '0x' + Array.from(new TextEncoder().encode(s)).map((b) => b.toString(16).padStart(2, '0')).join('');
  async function ensureChain(p) {                          // World Chain = 480 (0x1e0); gagal tidak masalah karena hanya menandatangani pesan
    try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1e0' }] }); }
    catch (e) {
      if (e && (e.code === 4902 || e.code === -32603)) {
        try {
          await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x1e0', chainName: 'World Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://worldchain-mainnet.g.alchemy.com/public'], blockExplorerUrls: ['https://worldscan.org'] }] });
        } catch (e2) { /* abaikan */ }
      }
    }
  }

  // ---- Cloudflare Turnstile (hanya bila diaktifkan di server) ----
  let tsLoading = null;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve();
    if (tsLoading) return tsLoading;
    tsLoading = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
      s.onload = () => res(); s.onerror = () => { tsLoading = null; rej(new WErr('captcha_failed')); };
      document.head.appendChild(s);
    });
    return tsLoading;
  }
  async function captcha() {
    const key = st.cfg && st.cfg.turnstileSiteKey;
    if (!key) return undefined;
    await loadTurnstile();
    return new Promise((resolve, reject) => {
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center';
      const box = document.createElement('div'); box.style.cssText = 'background:#2b1d16;padding:16px;border-radius:12px'; ov.appendChild(box); document.body.appendChild(ov);
      const done = (fn, v) => { try { ov.remove(); } catch (e) { /* abaikan */ } fn(v); };
      try { window.turnstile.render(box, { sitekey: key, callback: (tk) => done(resolve, tk), 'error-callback': () => done(reject, new WErr('captcha_failed')), 'expired-callback': () => done(reject, new WErr('captcha_failed')) }); }
      catch (e) { done(reject, new WErr('captcha_failed')); }
    });
  }

  async function connect() {
    const p = provider(); if (!p) throw new WErr('no_wallet');
    await loadConfig(true);
    let accounts;
    try { accounts = await p.request({ method: 'eth_requestAccounts' }); } catch (e) { throw new WErr(e && e.code === 4001 ? 'rejected' : 'no_wallet'); }
    const address = accounts && accounts[0]; if (!address) throw new WErr('no_wallet');
    await ensureChain(p);
    const cf = await captcha();
    const n = await api('/api/nonce', { address, cf });
    let signature;
    try { signature = await p.request({ method: 'personal_sign', params: [toHex(n.message), address] }); } catch (e) { throw new WErr(e && e.code === 4001 ? 'rejected' : 'sign_failed'); }
    const l = await api('/api/login', { address, nonce: n.nonce, signature, device });
    st.session = { address: l.address, token: l.token }; store.set(K_SES, JSON.stringify(st.session));
    await refresh();
    return l.address;
  }
  function disconnect() { st.session = null; st.me = null; store.del(K_SES); }
  async function refresh() { if (!st.session) { st.me = null; return null; } try { st.me = await api('/api/me'); } catch (e) { st.me = null; throw e; } return st.me; }
  async function beat() { if (!st.session) return; try { const r = await api('/api/beat', {}); if (st.me) { st.me.today.available = r.available; st.me.today.allowance = r.allowance; st.me.today.credited = r.credited; } } catch (e) { /* diam */ } }
  async function credit(points) { const r = await api('/api/credit', { reqId: rid(), points }); await refresh(); return r.credited; }
  async function redeem() { const cf = await captcha(); const r = await api('/api/redeem', { cf }); await refresh(); await loadConfig(true); return r; }
  async function cancel(id) { await api('/api/cancel', { id }); await refresh(); }

  return {
    st, loadConfig, hasProvider, connect, disconnect, refresh, beat, credit, redeem, cancel, WErr,
    get loggedIn() { return !!st.session; }, get address() { return st.session ? st.session.address : ''; },
  };
})();
