# Deploy Antrian ke Server Sumopod — Design Spec

**Tanggal:** 2026-08-06
**Status:** Approved (brainstorming selesai, siap untuk implementation plan)
**Pendekatan:** A — Manual klasik (Nginx + PM2 + git clone)

## Konteks & Keputusan

Deploy aplikasi antrian pengambilan sertifikat (Node.js + Express + Socket.io + SQLite + Google Sheets/Cloud TTS) ke VPS sumopod.

Keputusan yang dibuat selama brainstorming:

| Aspek | Keputusan | Alasan |
|---|---|---|
| Server | VPS sumopod (`root@43.157.227.203`), Ubuntu 24.04 LTS x86_64 | Akses SSH root sudah dikonfigurasi di `~/.ssh/config` sebagai `sumoPod` |
| Database | **Tetap SQLite** (better-sqlite3, WAL mode) | App trafik sedang, single instance — SQLite cukup & risiko rendah di VPS yang dikontrol penuh |
| Backup | Backup SQLite otomatis harian, retensi 7 hari | Menutup risiko data antrian hilang/corrupt |
| Data peserta | Import ulang di server dari **Google Sheets** (905 peserta) | `*.sqlite` di-gitignore, tidak ikut push; Sheets sumber terbaru |
| URL | Domain sendiri nanti; sementara akses via IP + Nginx config dengan `server_name` placeholder | Domain belum siap; hindari DNS blocker |
| Kode ke server | Push ke **GitHub** (repo baru, dibuat manual user) → clone di server | gh CLI belum login; user buat repo kosong sendiri |
| Kredensial Google | Di-set manual di `.env` server | `.env` di-gitignore, tidak pernah masuk git |
| Port | Node bind `127.0.0.1:3007` (localhost only), Nginx proxy `:80/:443` → `:3007` | Port 3000 & 8080 sudah dipakai app lain (`evaluasi.site`, `mwwi.web.id`); 3007 diverifikasi bebas |

## Lingkungan Server (diverifikasi via SSH)

- **OS:** Ubuntu 24.04.4 LTS x86_64
- **Node.js:** v22.22.2, npm 10.9.7
- **MySQL:** 8.4.8 (Percona) — *tidak dipakai untuk app ini, tetap SQLite*
- **Nginx:** 1.28.3 (sudah melayani `evaluasi.site`, `asesmen.pondok.com`, `mwwi.web.id`)
- **PM2:** 7.0.1
- **Git:** 2.43.0
- **Docker:** 29.6.0 (tidak dipakai)
- **Resource:** RAM 3.6GB (2.4GB bebas), Disk 59GB (28GB bebas)
- **Build tools untuk better-sqlite3:** `build-essential` 12.10, `python3` 3.12.3, `g++` 13.3.0, `make` 4.3, `node-gyp` 11.5.0 — semua tersedia, native module akan compile bersih
- **Port 3007:** bebas

## Arsitektur

```
Browser ──HTTP/HTTPS──> Nginx (:80/:443) ──proxy──> Node+Express (:3007, PM2, 127.0.0.1 only)
                                                        │
                                                        ├── SQLite (database.sqlite, WAL mode)
                                                        ├── Google Sheets sync (via .env)
                                                        └── Google Cloud TTS (via .env, fallback google-tts-api)
```

- **Node app** jalan di `127.0.0.1:3007` (hanya localhost, tidak expose langsung ke publik) diawasi **PM2** (auto-restart, auto-start saat boot via `pm2 startup`).
- **Nginx** di port 80/443 jadi reverse proxy ke `127.0.0.1:3007`; pass header WebSocket untuk Socket.io.
- **SQLite** file persisten di `/var/www/antrian/database.sqlite`, WAL mode on.
- **Backup** berkala via cron: hot backup SQLite ke `/var/backups/antrian/` (retensi 7 hari).
- **Akses sementara:** `http://43.157.227.203` lewat Nginx config dengan `server_name` placeholder. Saat domain sendiri siap, ganti `server_name` + jalankan `certbot --nginx` untuk HTTPS.

## Struktur & Lokasi File di Server

```
/var/www/antrian/                       ← home aplikasi (git repo di-clone ke sini)
├── server.js, src/, public/, scripts/, package.json, .env.example, data.csv
├── .env                                ← dibuat manual, TIDAK di-git (PORT=3007 + Google creds)
├── database.sqlite                     ← dibuat otomatis saat initDb(), persisten
├── database.sqlite-wal / -shm          ← file WAL (WAL mode), persisten
├── ecosystem.config.cjs                ← config PM2 (baru, di-git)
├── logs/                               ← log PM2 (di-gitignore)
└── qr-code.png                         ← di-generate oleh npm run qr (di-gitignore)

/etc/nginx/sites-available/antrian.conf ← config Nginx baru (dibuat via SSH, tidak di-git)
/etc/nginx/sites-enabled/antrian.conf   ← symlink ke atas

/var/backups/antrian/                   ← folder backup SQLite (cron, retention 7 hari)
└── antrian-YYYY-MM-DD.sqlite

cron job: 0 2 * * *  cd /var/www/antrian && npm run backup   (tiap jam 2 pagi, waktu server)
```

- Repo di-clone ke `/var/www/antrian` (konsisten dengan `/var/www/html` yang sudah ada).
- `.env` dibuat manual di server dari template `.env.example` (isi `PORT=3007` + Google credentials). Tidak pernah masuk git.
- `ecosystem.config.cjs` — ekstensi `.cjs` karena `package.json` memakai `"type":"module"`; PM2 config pakai `module.exports` (CommonJS).

## File Baru & Perubahan Kode

### File baru (di-git, ikut saat clone)

1. **`ecosystem.config.cjs`** — config PM2:
   - `name: 'antrian'`, `script: 'server.js'`, `instances: 1`, `exec_mode: 'fork'`
   - `max_memory_restart: '300M'`
   - `env: { PORT: 3007, NODE_ENV: 'production' }`
   - `watch: false`, auto-restart on crash.

2. **`scripts/backup-db.js`** — script backup SQLite:
   - Pakai `better-sqlite3` API `.backup()` (hot backup, tidak perlu matikan app) ke `/var/backups/antrian/antrian-YYYY-MM-DD.sqlite`.
   - Hapus backup berusia >7 hari (retensi).
   - Bisa dijalankan manual `npm run backup` atau via cron.
   - Path tujuan & retensi configurable via env (`BACKUP_DIR`, `BACKUP_RETENTION_DAYS`) dengan default.

3. **`docs/deploy-sumopod.md`** — runbook deploy step-by-step (single source of truth): persiapan, deploy, Nginx, backup, ganti domain, troubleshooting.

### Perubahan `package.json`

Tambah script:
```json
"backup": "node scripts/backup-db.js"
```

### Perubahan `server.js`

Bind ke `127.0.0.1` saja (bukan `0.0.0.0`) supaya Node tidak expose langsung ke publik; hanya Nginx yang reachable:
```js
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
  console.log(`Dashboard panitia: http://localhost:${PORT}/panitia.html`);
});
```
Selebihnya kode tidak diubah — SQLite tetap, sync/async tidak diubah.

### File Nginx baru (dibuat langsung di server via SSH, tidak di-git)

`/etc/nginx/sites-available/antrian.conf`:
- `server_name` placeholder `_` + `43.157.227.203.nip.io` (sementara, sebelum domain sendiri).
- `location /` → proxy_pass `http://127.0.0.1:3007`, dengan header `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`.
- **Socket.io support:** `location /socket.io/` dengan `proxy_http_version 1.1`, `proxy_set_header Upgrade $http_upgrade`, `proxy_set_header Connection "upgrade"` — tanpa ini WebSocket realtime antrian tidak jalan.
- Placeholder blok SSL (commented) siap di-uncomment setelah certbot.

## Langkah Deploy (urutan eksekusi)

### Tahap 1 — Persiapan repo (saya di lokal)
1. Buat file baru: `ecosystem.config.cjs`, `scripts/backup-db.js`, `docs/deploy-sumopod.md`
2. Ubah `package.json` (tambah script `backup`) & `server.js` (bind `127.0.0.1`)
3. Commit perubahan di branch `master`

### Tahap 2 — Push ke GitHub (Anda + saya)
4. **Anda** buat repo kosong di GitHub (tanpa README/license), beri saya URL
5. Saya tambahkan remote & push `master`

### Tahap 3 — Deploy ke server (saya via SSH `sumoPod`)
6. `git clone <repo-url> /var/www/antrian`
7. `cd /var/www/antrian && npm install` (build `better-sqlite3` di server — build tools sudah lengkap)
8. Buat `.env` di server: copy dari `.env.example`, isi `PORT=3007`, `APP_URL=http://43.157.227.203` (URL produksi sementara, untuk QR code), dan Google credentials (`GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`). User menempelkan nilai Google credentials ke `.env` sendiri via SSH (saya berikan template & lokasi; credentials tidak pernah lewat saya).
9. `npm run import` — tarik 905 peserta dari Google Sheets (fallback `data.csv` bila creds belum siap)
10. `npm run qr` — generate QR code memakai `APP_URL` dari `.env` (sudah diset di langkah 8)
11. `pm2 start ecosystem.config.cjs` → `pm2 save` → `pm2 startup` (auto-start saat reboot)

### Tahap 4 — Nginx reverse proxy (saya via SSH)
12. Tulis `/etc/nginx/sites-available/antrian.conf` (proxy + Socket.io WebSocket support, port 3007)
13. `ln -s` ke `sites-enabled`, `nginx -t` (test config), `systemctl reload nginx`
14. Test akses `http://43.157.227.203` (lewat Nginx) — halaman peserta tampil, Socket.io connect

### Tahap 5 — Backup & verifikasi
15. Buat folder `/var/backups/antrian`, tambah cron job jalankan `npm run backup` tiap jam 2 pagi
16. Test backup manual sekali, pastikan file `.sqlite` terbentuk & valid
17. Verifikasi end-to-end (lihat bagian Testing)

### Tahap 6 — Domain sendiri & HTTPS (nanti, kalau sudah siap)
18. Anda arahkan DNS A record domain → `43.157.227.203`
19. Saya ganti `server_name` di Nginx config, jalankan `certbot --nginx` untuk SSL otomatis
20. Update `APP_URL` di `.env`, regenerate QR (`npm run qr`)

## Error Handling, Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| `better-sqlite3` gagal build di server | Build tools sudah diverifikasi ada. Kalau gagal, cek log `npm install`; fallback `npm install --build-from-source`. |
| Socket.io WebSocket tidak connect lewat Nginx | Config Nginx pass `Upgrade`/`Connection` header + `proxy_http_version 1.1` di location `/socket.io/`. Verifikasi via browser console (`socket.io connected`) di Tahap 4. |
| Google credentials salah → import gagal | Script import sudah ada fallback ke `data.csv` lokal. Cek log saat `npm run import`. Cloud TTS juga fallback ke google-tts-api bila API belum di-enable. |
| `database.sqlite` hilang/corrupt | Backup harian otomatis (retensi 7 hari) + backup manual sebelum deploy besar. WAL mode sudah on. |
| Port 3007 bentrok di masa depan | Diverifikasi sekarang bebas; didokumentasikan di runbook. |
| Nginx config salah → crash semua site di server | Saya **tidak sentuh** config site lain. Pakai `nginx -t` sebelum reload. Kalau test gagal, reload tidak jalan — server tetap aman. |
| PM2 tidak auto-start setelah reboot | `pm2 startup` + `pm2 save` dicatat di runbook. |

## Testing / Verifikasi Setelah Deploy

- **Smoke test:** `curl http://127.0.0.1:3007/api/statistik` → JSON stats kembali.
- **Browser test end-to-end** (lewat Chrome DevTools MCP):
  - Buka `http://43.157.227.203` → halaman peserta, cari nama, ambil nomor antrian.
  - Buka `/panitia.html` → panggil nomor, cek nomor pindah ke kolom "Dipanggil".
  - Buka `/info.html` → layar info realtime update via Socket.io.
  - Cek suara TTS/chime diputar saat panggil.
- **Backup test:** jalankan `npm run backup`, pastikan file muncul di `/var/backups/antrian/` dan bisa dibuka (`sqlite3 <file> ".tables"`).

## Out of Scope

- Migrasi ke MySQL (dipertimbangkan lalu diputuskan tidak jadi — SQLite cukup).
- Setup domain sendiri & HTTPS (Tahap 6, dilakukan terpisah setelah DNS siap).
- Load balancing / multiple instance (tidak dibutuhkan untuk app ini).
- Monitoring eksternal / alerting (PM2 + log cukup untuk skala ini).
