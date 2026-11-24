# Server Vosil Game (Cloudflare Worker + D1)

- `server/app.js`: semua logika (login dompet, poin, antrean, kuota, pembayaran). Diuji tanpa jaringan.
- `server/chain.js`: bagian blockchain (viem): cek tanda tangan, saldo, transfer VOS di World Chain (chain id 480).
- `server/worker.js`: pintu masuk Worker (hanya `/api/*`; file game dilayani Cloudflare langsung).
- Rahasia (JANGAN masuk repo): `SESSION_SECRET`, `ADMIN_KEY`, `TURNSTILE_SECRET`, `GAME_WALLET_KEY`.
- Pengaturan non-rahasia ada di `vars` pada `wrangler.jsonc`.
