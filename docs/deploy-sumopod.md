# Runbook Deploy Antrian ke Sumopod

Server: `sumoPod` (`root@43.157.227.203`, Ubuntu 24.04). Akses: `ssh sumoPod`.

**URL produksi: `https://ngantri.web.id`** (via Cloudflare Proxy + Origin Certificate, SSL mode Full strict). Akses darurat via IP: `http://43.157.227.203`.

## Prasyarat server (sudah terpenuhi)

- Node v22, npm 10, PM2 7, Nginx 1.28, Git, build-essential, python3, g++, make, node-gyp.
- Port 3007 bebas. Port 3000 (evaluasi.site) & 8080 (mwwi) dipakai app lain — jangan sentuh.

## Deploy (sekali jalan)

```bash
ssh sumoPod

# 1. Clone & install
git clone <repo-url> /var/www/antrian
cd /var/www/antrian
npm install                       # build better-sqlite3 native module di server

# 2. Buat .env (TIDAK di-git)
cp .env.example .env
nano .env                         # isi: PORT=3007, APP_URL=http://43.157.227.203,
                                  #      GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL,
                                  #      GOOGLE_PRIVATE_KEY (dari service account JSON)

# 3. Import peserta & generate QR
npm run import                    # tarik dari Google Sheets (fallback data.csv)
npm run qr                        # generate qr-code.png memakai APP_URL

# 4. Jalankan dengan PM2
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup                       # ikuti instruksi yang muncul (auto-start saat reboot)
```

## Nginx reverse proxy

Buat `/etc/nginx/sites-available/antrian.conf` (lihat blok config di bawah), lalu:

```bash
ln -s /etc/nginx/sites-available/antrian.conf /etc/nginx/sites-enabled/antrian.conf
nginx -t                           # WAJIB: test config sebelum reload
systemctl reload nginx
```

### Config Nginx (`antrian.conf`)

Tiga server block: (1) 443 SSL untuk domain, (2) 80 redirect domain → HTTPS, (3) 80 untuk akses IP langsung (darurat). Origin Certificate dari Cloudflare (`/etc/nginx/ssl-certificates/ngantri.web.id.crt` + `.key`).

```nginx
# === HTTPS untuk ngantri.web.id (via Cloudflare proxy, Full strict) ===
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ngantri.web.id www.ngantri.web.id;

    ssl_certificate     /etc/nginx/ssl-certificates/ngantri.web.id.crt;
    ssl_certificate_key /etc/nginx/ssl-certificates/ngantri.web.id.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_session_cache shared:antrianSSL:10m;
    ssl_session_timeout 1d;

    # Socket.io WebSocket — WAJIB untuk realtime antrian
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3007;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass http://127.0.0.1:3007;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# === Redirect HTTP -> HTTPS untuk domain ===
server {
    listen 80;
    listen [::]:80;
    server_name ngantri.web.id www.ngantri.web.id;
    return 301 https://$host$request_uri;
}

# === Akses langsung via IP (HTTP, tanpa SSL — cert tidak cover IP) ===
server {
    listen 80;
    listen [::]:80;
    server_name 43.157.227.203;

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3007;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass http://127.0.0.1:3007;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Pasang Origin Certificate Cloudflare** (sekali, saat setup domain):
```bash
mkdir -p /etc/nginx/ssl-certificates
nano /etc/nginx/ssl-certificates/ngantri.web.id.crt   # paste Origin Certificate (cert-only) dari dashboard Cloudflare
nano /etc/nginx/ssl-certificates/ngantri.web.id.key   # paste Private Key
chmod 600 /etc/nginx/ssl-certificates/ngantri.web.id.key
# Verifikasi cert & key match (MD5 modulus harus sama):
openssl x509 -noout -modulus -in /etc/nginx/ssl-certificates/ngantri.web.id.crt | openssl md5
openssl rsa  -noout -modulus -in /etc/nginx/ssl-certificates/ngantri.web.id.key | openssl md5
```
Di dashboard Cloudflare: **SSL/TLS → Origin Server → Create Certificate** (RSA 2048, 15 tahun, hostnames `*.ngantri.web.id,ngantri.web.id`). Lalu **SSL/TLS → Overview → Full (strict)**. Aktifkan juga **Always Use HTTPS** + **Automatic HTTPS Rewrites** (Edge Certificates). Cloudflare free plan mendukung WebSocket — proxy tetap melewatkan Socket.io WSS.

## Backup SQLite (otomatis)

Buat folder & cron:

```bash
mkdir -p /var/backups/antrian
crontab -e
# tambah baris ini (jam 2 pagi tiap hari, waktu server):
0 2 * * * cd /var/www/antrian && /usr/bin/npm run backup >> /var/backups/antrian/backup.log 2>&1
```

`npm run backup` memakai env default: `DB_PATH=./database.sqlite`, `BACKUP_DIR=/var/backups/antrian`, retensi 7 hari. Backup manual: `cd /var/www/antrian && npm run backup`.

Restore: salin file backup ke tempat DB, matikan PM2 (`pm2 stop antrian`), ganti `database.sqlite`, jalankan lagi (`pm2 start antrian`).

## Verifikasi setelah deploy

```bash
# Origin langsung (localhost, skip Cloudflare)
curl http://127.0.0.1:3007/api/statistik     # JSON stats

# Edge Cloudflare (produksi)
curl https://ngantri.web.id/api/statistik    # harus 200 JSON (kalau 301 loop → SSL mode masih Flexible, ganti ke Full strict)
curl -sI http://ngantri.web.id/ | grep -i location   # harus 301 -> https (dari Cloudflare)

pm2 status                                    # status online
pm2 logs antrian --lines 20                   # cek error
```
Lalu browser test: `https://ngantri.web.id` (peserta), `/panitia.html` (panitia), `/info.html` (layar info). Cek Socket.io connect di console (transport `websocket`) & suara TTS saat panggil.

**Verifikasi Socket.io WebSocket lewat Cloudflare** (dari server, E2E):
```bash
cd /var/www/antrian
npm install socket.io-client@4 --no-save       # temp, untuk test
node --input-type=module -e "
import { io } from 'socket.io-client';
const s = io('https://ngantri.web.id', { transports: ['websocket'] });
s.on('connect', () => console.log('connected, transport:', s.io.engine.transport.name));
s.on('antrian:baru', d => console.log('antrian:baru', d?.nomor_antrian));
s.on('statistik:update', d => console.log('statistik:update', JSON.stringify(d)));
setTimeout(() => process.exit(0), 5000);
"
# Harus: connected, transport: websocket. Picu ambil nomor di browser → event realtime muncul.
```

## Update kode

```bash
ssh sumoPod
cd /var/www/antrian
git pull
npm install                       # hanya kalau dependency berubah
pm2 restart antrian
```

## Setup domain sendiri + HTTPS (SUDAH SELESAI — ngantri.web.id)

Dilakukan 2026-08-06. Pendekatan: **Cloudflare Proxy + Origin Certificate** (bukan Let's Encrypt/certbot), SSL mode **Full (strict)**.

1. Domain `ngantri.web.id` dibeli & di-klaim di Cloudflare. DNS A record `ngantri.web.id` + `www` → `43.157.227.203`, **Proxy ON** (oranye). DNS resolve ke IP Cloudflare (`104.21.x`, `172.67.x`), bukan langsung ke origin.
2. **Origin Certificate** dibuat di Cloudflare (SSL/TLS → Origin Server → Create Certificate, RSA 2048, 15 tahun, `*.ngantri.web.id,ngantri.web.id`). Cert + key dipasang di `/etc/nginx/ssl-certificates/` (chmod 600 key). Verifikasi modulus cert & key match.
3. Nginx config diupdate jadi 3 server block (443 SSL domain, 80 redirect domain, 80 IP darurat) — lihat config di atas. `nginx -t` OK, reload OK.
4. **SSL mode Cloudflare di-set ke Full (strict)** (SSL/TLS → Overview). Flexible akan menyebabkan redirect loop karena edge teruskan HTTP ke origin, padahal origin 80 redirect ke HTTPS.
5. `APP_URL=https://ngantri.web.id` di `/var/www/antrian/.env`, regen QR (`npm run qr`), `pm2 restart antrian`.
6. Verifikasi E2E: `curl https://ngantri.web.id/api/statistik` → 200 JSON; Socket.io WebSocket connect (transport `websocket`) lewat edge; event `antrian:baru` + `statistik:update` realtime mengalir saat ambil nomor.

Ganti domain lain kalau perlu: ulangi langkah 1–5 dengan domain baru (ganti `server_name`, cert paths, dan `APP_URL`).

## Troubleshooting

| Gejala | Cek |
|---|---|
| Halaman tidak muncul | `pm2 status` (online?), `pm2 logs antrian`, `curl http://127.0.0.1:3007` (origin), `curl https://ngantri.web.id/api/statistik` (edge) |
| 502 Bad Gateway | Node tidak jalan atau port salah; cek `pm2 logs`, pastikan `PORT=3007` di `.env` |
| `301 Moved Permanently` loop (HTTP 000 / redirect ke diri sendiri) | SSL mode Cloudflare masih **Flexible** — ganti ke **Full (strict)**. Edge teruskan HTTP ke origin, origin redirect ke HTTPS → loop |
| Realtime tidak update | Socket.io tidak connect — cek Nginx pass `Upgrade`/`Connection` header di `location /socket.io/`; cek transport di console (harus `websocket`, bukan `polling`); jalankan test WS E2E di bagian Verifikasi |
| WebSocket 525/526 (Cloudflare) | Origin cert tidak valid/expired → Cloudflare menolak koneksi origin. Re-issue Origin Certificate, pastikan Full (strict) + cert match |
| `better-sqlite3` error saat npm install | `apt install -y build-essential python3 make g++` lalu `npm install --build-from-source` |
| Import gagal | Cek Google credentials di `.env`; fallback `data.csv` otomatis aktif |
| Backup tidak jalan | `cat /var/backups/antrian/backup.log`; jalankan manual `npm run backup` untuk lihat error |
