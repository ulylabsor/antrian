# Runbook Deploy Antrian ke Sumopod

Server: `sumoPod` (`root@43.157.227.203`, Ubuntu 24.04). Akses: `ssh sumoPod`.

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

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name _;                 # GANTI ke domain sendiri saat sudah siap

    # Static besar bisa di-cache oleh Nginx; API + socket.io diproxy ke Node.
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
curl http://127.0.0.1:3007/api/statistik     # JSON stats
pm2 status                                    # status online
pm2 logs antrian --lines 20                   # cek error
```
Lalu browser test: `http://43.157.227.203` (peserta), `/panitia.html` (panitia), `/info.html` (layar info). Cek Socket.io connect di console & suara TTS saat panggil.

## Update kode

```bash
ssh sumoPod
cd /var/www/antrian
git pull
npm install                       # hanya kalau dependency berubah
pm2 restart antrian
```

## Ganti ke domain sendiri + HTTPS

1. Arahkan DNS A record domain → `43.157.227.203`.
2. `nano /etc/nginx/sites-available/antrian.conf` — ganti `server_name _;` jadi `server_name antrian.domainanda.id www.antrian.domainanda.id;`
3. `certbot --nginx -d antrian.domainanda.id -d www.antrian.domainanda.id` (SSL otomatis).
4. Update `APP_URL=https://antrian.domainanda.id` di `/var/www/antrian/.env`.
5. `cd /var/www/antrian && npm run qr && pm2 restart antrian`.

## Troubleshooting

| Gejala | Cek |
|---|---|
| Halaman tidak muncul | `pm2 status` (online?), `pm2 logs antrian`, `curl http://127.0.0.1:3007` |
| 502 Bad Gateway | Node tidak jalan atau port salah; cek `pm2 logs`, pastikan `PORT=3007` di `.env` |
| Realtime tidak update | Socket.io tidak connect — cek Nginx pass `Upgrade`/`Connection` header di `location /socket.io/` |
| `better-sqlite3` error saat npm install | `apt install -y build-essential python3 make g++` lalu `npm install --build-from-source` |
| Import gagal | Cek Google credentials di `.env`; fallback `data.csv` otomatis aktif |
| Backup tidak jalan | `cat /var/backups/antrian/backup.log`; jalankan manual `npm run backup` untuk lihat error |
