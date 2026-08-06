# Deploy Antrian ke Sumopod — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy aplikasi antrian pengambilan sertifikat ke VPS sumopod (root@43.157.227.203) dengan Nginx reverse proxy + PM2, tetap memakai SQLite, plus backup harian otomatis.

**Architecture:** Kode di-push ke GitHub lalu di-clone ke `/var/www/antrian` di server. Node+Express jalan di `127.0.0.1:3007` diawasi PM2 (auto-restart + startup). Nginx reverse proxy `:80` → `:3007` dengan WebSocket support untuk Socket.io. SQLite file persisten; backup hot-copy harian via cron. Domain sendiri & HTTPS ditangani terpisah nanti.

**Tech Stack:** Node.js v22 (server) / v24 (lokal), Express, Socket.io, better-sqlite3 (native module), PM2 7, Nginx 1.28, Ubuntu 24.04, node:test untuk testing.

## Global Constraints

- Server: VPS sumopod, akses SSH via `~/.ssh/config` alias `sumoPod` (`root@43.157.227.203`).
- Node app **harus** bind `127.0.0.1:3007` (localhost only) — port 3000 & 8080 sudah dipakai app lain di server.
- Database **tetap SQLite** (`better-sqlite3`); tidak ada migrasi MySQL; tidak ada perubahan sync/async di `src/db.js`.
- `.env` tidak masuk git (sudah di-gitignore); credentials Google diisi manual di server.
- `*.sqlite` tidak masuk git (sudah di-gitignore); data peserta di-import ulang di server dari Google Sheets.
- Nginx config site lain (`evaluasi.site`, `asesmen.pondok.com`, `mwwi.web.id`) **tidak boleh disentuh**; selalu `nginx -t` sebelum reload.
- `package.json` memakai `"type":"module"` — file config PM2 pakai ekstensi `.cjs` (CommonJS `module.exports`).
- Build tools untuk `better-sqlite3` sudah diverifikasi ada di server (build-essential, python3, g++, make, node-gyp).
- Setiap task kode diakhiri commit di branch `master`.

---

## File Structure

**File baru (di-git):**
- `ecosystem.config.cjs` — config PM2 (CommonJS, karena `type:module`). Responsibility: mendefinisikan proses `antrian` (script, port, env, restart policy).
- `scripts/backup-db.js` — script backup SQLite hot-copy. Responsibility: `.backup()` DB ke folder backup + purge file >7 hari. Dipanggil `npm run backup` atau cron.
- `docs/deploy-sumopod.md` — runbook deploy. Responsibility: catatan operasional lengkap (deploy, Nginx, backup, ganti domain, troubleshooting).

**File diubah (di-git):**
- `package.json` — tambah script `"backup": "node scripts/backup-db.js"`.
- `server.js` — bind `127.0.0.1` (bukan `0.0.0.0`).

**File baru di server saja (tidak di-git, dibuat via SSH):**
- `/var/www/antrian/.env` — dari `.env.example`, isi `PORT=3007`, `APP_URL`, Google credentials.
- `/etc/nginx/sites-available/antrian.conf` + symlink `sites-enabled` — reverse proxy.

**File test:**
- `test/backup-db.test.js` — test script backup (hot-copy valid + purge retensi).

---

### Task 1: Ubah `server.js` bind ke `127.0.0.1`

**Files:**
- Modify: `server.js:36-39`

**Interfaces:**
- Consumes: `process.env.PORT` (default 3000, akan jadi 3007 via `.env` di server).
- Produces: server Express yang hanya listen di localhost; Nginx jadi satu-satunya pintu publik.

- [ ] **Step 1: Ubah `server.listen` agar bind `127.0.0.1`**

Ganti blok `server.listen` di `server.js` (baris 36-39) dari:

```js
server.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
  console.log(`Dashboard panitia: http://localhost:${PORT}/panitia.html`);
});
```

menjadi:

```js
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
  console.log(`Dashboard panitia: http://localhost:${PORT}/panitia.html`);
});
```

- [ ] **Step 2: Verifikasi server jalan di localhost**

Run: `node server.js` (di terminal sementara, lalu Ctrl-C)
Expected: log `Server berjalan di http://localhost:3000` muncul tanpa error.

- [ ] **Step 3: Verifikasi tidak ada binding 0.0.0.0**

Run (PowerShell): `Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object LocalAddress`
Expected: `LocalAddress` = `127.0.0.1` (bukan `0.0.0.0` / `::`). Lalu hentikan server (Ctrl-C).

- [ ] **Step 4: Jalankan test suite existing (pastikan tidak break)**

Run: `npm test`
Expected: semua test di `test/db.test.js`, `test/routes.test.js`, `test/sheets.test.js` PASS.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "refactor: bind server ke 127.0.0.1 (localhost only) untuk deploy di balik Nginx"
```

---

### Task 2: Tambah script `backup` ke `package.json`

**Files:**
- Modify: `package.json:7-13` (blok `scripts`)

**Interfaces:**
- Produces: perintah `npm run backup` yang memanggil `node scripts/backup-db.js` (dibuat di Task 3).

- [ ] **Step 1: Tambah entry `backup` ke `scripts`**

Di `package.json`, ubah blok `scripts` dari:

```json
"scripts": {
  "start": "node server.js",
  "dev": "nodemon server.js",
  "test": "node --test",
  "import": "node scripts/import-data.js",
  "qr": "node scripts/generate-qr.js"
},
```

menjadi:

```json
"scripts": {
  "start": "node server.js",
  "dev": "nodemon server.js",
  "test": "node --test",
  "import": "node scripts/import-data.js",
  "qr": "node scripts/generate-qr.js",
  "backup": "node scripts/backup-db.js"
},
```

- [ ] **Step 2: Verifikasi script terdaftar**

Run: `npm run | findstr backup` (PowerShell: `npm run | Select-String backup`)
Expected: baris `backup` muncul dengan perintah `node scripts/backup-db.js`. (Script belum jalan karena file belum dibuat — itu wajar, dibuat di Task 3.)

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: tambah script npm run backup untuk backup SQLite"
```

---

### Task 3: Buat `scripts/backup-db.js` (TDD)

**Files:**
- Create: `scripts/backup-db.js`
- Test: `test/backup-db.test.js`

**Interfaces:**
- Consumes: `process.env.DB_PATH` (default `./database.sqlite`) — path DB sumber; `process.env.BACKUP_DIR` (default `./backups`) — folder tujuan; `process.env.BACKUP_RETENTION_DAYS` (default `7`) — retensi.
- Produces: fungsi `runBackup({ dbPath, backupDir, retentionDays, now })` yang mengembalikan `{ backed: <path>, purged: <count> }`. Eksport default tetap menjalankan `runBackup` memakai env saat dipanggil langsung (`node scripts/backup-db.js`).

**Catatan API:** `better-sqlite3` `db.backup(targetPath)` mengembalikan **Promise** yang resolve saat hot-copy selesai (tidak perlu matikan app). Diverifikasi: backup copy bisa dibuka & berisi data terbaru.

- [ ] **Step 1: Tulis test failing**

Buat `test/backup-db.test.js`:

```js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runBackup } from '../scripts/backup-db.js';

const TMP = './test-backup-tmp';

function rimraf(p) {
  if (!fs.existsSync(p)) return;
  for (const entry of fs.readdirSync(p)) {
    const full = path.join(p, entry);
    try { fs.rmSync(full, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  fs.rmSync(p, { recursive: true, force: true });
}

beforeEach(() => {
  rimraf(TMP);
  fs.mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rimraf(TMP);
});

test('runBackup membuat copy DB yang valid & berisi data', async () => {
  const dbPath = path.join(TMP, 'src.sqlite');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE peserta (id INTEGER PRIMARY KEY, nama TEXT)');
  db.prepare('INSERT INTO peserta (nama) VALUES (?)').run('Andi');
  db.close();

  const res = await runBackup({ dbPath, backupDir: path.join(TMP, 'bak'), retentionDays: 7, now: new Date('2026-08-06T02:00:00') });

  assert.ok(fs.existsSync(res.backed), 'file backup harus ada');
  const copy = new Database(res.backed, { readonly: true });
  assert.equal(copy.prepare('SELECT COUNT(*) c FROM peserta').get().c, 1);
  assert.equal(copy.prepare('SELECT nama FROM peserta LIMIT 1').get().nama, 'Andi');
  copy.close();
  assert.equal(res.purged, 0);
});

test('runBackup menghapus backup lebih tua dari retentionDays', async () => {
  const backupDir = path.join(TMP, 'bak');
  fs.mkdirSync(backupDir, { recursive: true });
  // Buat 2 file backup lama (usia >7 hari) + 1 baru
  fs.writeFileSync(path.join(backupDir, 'antrian-2026-07-20.sqlite'), 'old1');
  fs.writeFileSync(path.join(backupDir, 'antrian-2026-07-25.sqlite'), 'old2');
  fs.writeFileSync(path.join(backupDir, 'antrian-2026-08-05.sqlite'), 'recent');

  const dbPath = path.join(TMP, 'src.sqlite');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE peserta (id INTEGER PRIMARY KEY, nama TEXT)');
  db.close();

  const res = await runBackup({ dbPath, backupDir, retentionDays: 7, now: new Date('2026-08-06T02:00:00') });

  // 2 file lama ter-purge, file recent tetap, +1 file baru hari ini
  assert.equal(res.purged, 2);
  assert.ok(!fs.existsSync(path.join(backupDir, 'antrian-2026-07-20.sqlite')));
  assert.ok(!fs.existsSync(path.join(backupDir, 'antrian-2026-07-25.sqlite')));
  assert.ok(fs.existsSync(path.join(backupDir, 'antrian-2026-08-05.sqlite')));
});

test('runBackup melempar error bila DB sumber tidak ada', async () => {
  await assert.rejects(
    () => runBackup({ dbPath: path.join(TMP, 'nope.sqlite'), backupDir: path.join(TMP, 'bak'), retentionDays: 7, now: new Date('2026-08-06T02:00:00') }),
    /database|does not exist|unable/i
  );
});
```

- [ ] **Step 2: Run test untuk verifikasi gagal**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../scripts/backup-db.js'` atau `runBackup is not a function`.

- [ ] **Step 3: Implementasi minimal `scripts/backup-db.js`**

Buat `scripts/backup-db.js`:

```js
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Format tanggal YYYY-MM-DD (lokal). `now` di-inject supaya testable tanpa Date.now().
 */
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Backup DB SQLite via hot-copy (db.backup), lalu purge backup berusia > retentionDays.
 * @param {object} opts
 * @param {string} opts.dbPath - path DB sumber
 * @param {string} opts.backupDir - folder tujuan backup
 * @param {number} opts.retentionDays - hapus backup lebih tua dari ini (hari)
 * @param {Date} opts.now - timestamp acuan (inject untuk test)
 * @returns {Promise<{backed: string, purged: number}>}
 */
export async function runBackup({ dbPath, backupDir, retentionDays, now }) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`database tidak ditemukan: ${dbPath}`);
  }
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = formatDate(now);
  const target = path.join(backupDir, `antrian-${stamp}.sqlite`);

  // Hot backup — db.backup mengembalikan Promise, tidak perlu matikan app.
  const db = new Database(dbPath, { readonly: true });
  try {
    await db.backup(target);
  } finally {
    db.close();
  }

  // Purge backup > retentionDays berdasarkan tanggal di nama file (antrian-YYYY-MM-DD.sqlite).
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - retentionDays);
  let purged = 0;
  for (const entry of fs.readdirSync(backupDir)) {
    const m = entry.match(/^antrian-(\d{4})-(\d{2})-(\d{2})\.sqlite$/);
    if (!m) continue;
    const fileDate = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
    if (fileDate < cutoff) {
      try { fs.rmSync(path.join(backupDir, entry), { force: true }); purged++; } catch { /* ignore */ }
    }
  }

  return { backed: target, purged };
}

// Entry point saat dijalankan langsung: node scripts/backup-db.js
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  const dbPath = process.env.DB_PATH || './database.sqlite';
  const backupDir = process.env.BACKUP_DIR || '/var/backups/antrian';
  const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || '7', 10);
  runBackup({ dbPath, backupDir, retentionDays, now: new Date() })
    .then(({ backed, purged }) => {
      console.log(`Backup selesai: ${backed} (purged ${purged} backup lama)`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Backup gagal:', err.message);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run test untuk verifikasi lulus**

Run: `npm test`
Expected: semua test PASS, termasuk 3 test baru di `test/backup-db.test.js`.

- [ ] **Step 5: Test manual entry point (simulasi pemanggilan langsung)**

Run (PowerShell, Bash tool):
```bash
node -e "const fs=require('fs');const D=require('better-sqlite3');const db=new D('./probe.sqlite');db.exec('CREATE TABLE peserta(id INTEGER PRIMARY KEY,nama TEXT)');db.prepare('INSERT INTO peserta(nama) VALUES(?)').run('x');db.close();"
DB_PATH=./probe.sqlite BACKUP_DIR=./probe-bak node scripts/backup-db.js
```
Expected: log `Backup selesai: ./probe-bak/antrian-<tanggal>.sqlite (purged 0 backup lama)`, file ada & bisa dibuka.
Lalu bersihkan: `rm -f probe.sqlite probe.sqlite-wal probe.sqlite-shm; rm -rf probe-bak`

- [ ] **Step 6: Commit**

```bash
git add scripts/backup-db.js test/backup-db.test.js
git commit -m "feat: script backup SQLite hot-copy dengan retensi 7 hari (npm run backup)"
```

---

### Task 4: Buat `ecosystem.config.cjs` (config PM2)

**Files:**
- Create: `ecosystem.config.cjs`

**Interfaces:**
- Produces: config PM2 yang saat `pm2 start ecosystem.config.cjs` menjalankan `server.js` sebagai proses bernama `antrian` di port 3007, auto-restart, dengan env `NODE_ENV=production`.

**Catatan:** Ekstensi `.cjs` wajib karena `package.json` memakai `"type":"module"`. PM2 memuat config ini sebagai CommonJS (`module.exports`).

- [ ] **Step 1: Buat `ecosystem.config.cjs`**

```js
// PM2 config untuk aplikasi antrian.
// Ekstensi .cjs karena package.json memakai type:module — PM2 memuat config sebagai CommonJS.
module.exports = {
  apps: [
    {
      name: 'antrian',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: '300M',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3007,
      },
      out_file: './logs/out.log',
      error_file: './logs/err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
```

- [ ] **Step 2: Validasi syntax config secara lokal**

Run (Bash tool): `node --check ecosystem.config.cjs`
Expected: tidak ada output / exit 0 (syntax valid).

- [ ] **Step 3: Commit**

```bash
git add ecosystem.config.cjs
git commit -m "chore: tambah ecosystem.config.cjs untuk PM2 (proses antrian, port 3007)"
```

---

### Task 5: Buat runbook `docs/deploy-sumopod.md`

**Files:**
- Create: `docs/deploy-sumopod.md`

**Interfaces:**
- Produces: dokumen operasional yang merangkum semua langkah deploy, Nginx, backup, ganti domain, troubleshooting. Single source of truth untuk siapa pun yang mengelola app di server.

- [ ] **Step 1: Buat `docs/deploy-sumopod.md`**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/deploy-sumopod.md
git commit -m "docs: runbook deploy antrian ke sumopod (Nginx, PM2, backup, domain)"
```

---

### Task 6: Push ke GitHub

**Catatan:** Task ini butuh input user (URL repo). gh CLI belum login — user membuat repo kosong manual.

- [ ] **Step 1: Minta user buat repo GitHub kosong**

User membuat repo kosong (tanpa README/license/.gitignore) di GitHub, lalu memberi URL-nya (mis. `https://github.com/user/antrian.git`).

- [ ] **Step 2: Tambah remote & push**

```bash
git remote add origin <repo-url>
git branch -M main          # pastikan branch utama konsisten (master -> main bila perlu)
git push -u origin main
```
Catatan: bila repo lokal masih `master` dan user ingin `main`, `git branch -M main` merename. Bila user ingin tetap `master`, ganti baris di atas dengan `git push -u origin master`.

- [ ] **Step 3: Verifikasi push berhasil**

Run: `git remote -v && git log --oneline -3`
Expected: remote `origin` terdaftar; log menampilkan commit Task 1-5.

---

### Task 7: Deploy ke server (clone, install, .env, import, QR, PM2)

**Catatan:** Semua via `ssh sumoPod`. Task ini butuh Google credentials dari user (diisi ke `.env` di server — credentials tidak lewat asisten).

- [ ] **Step 1: Clone repo ke server**

```bash
ssh sumoPod 'git clone <repo-url> /var/www/antrian'
```
Expected: repo ter-clone. Bila `/var/www/antrian` sudah ada, backup dulu atau pilih lokasi lain.

- [ ] **Step 2: Install dependency (build better-sqlite3)**

```bash
ssh sumoPod 'cd /var/www/antrian && npm install 2>&1 | tail -20'
```
Expected: `better-sqlite3` ter-build tanpa error (build tools sudah lengkap). Bila gagal, lihat log & jalankan `npm install --build-from-source`.

- [ ] **Step 3: Siapkan `.env` di server**

Buat `.env` dari template (credentials diisi oleh user, bukan asisten):

```bash
ssh sumoPod 'cd /var/www/antrian && cp .env.example .env && mkdir -p logs'
```
Kasih user instruksi untuk mengisi (via `ssh sumoPod` lalu `nano /var/www/antrian/.env`):
- `PORT=3007`
- `APP_URL=http://43.157.227.203`
- `GOOGLE_SHEETS_ID=...`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL=...`
- `GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n`

- [ ] **Step 4: Import peserta dari Google Sheets**

```bash
ssh sumoPod 'cd /var/www/antrian && npm run import 2>&1 | tail -15'
```
Expected: `Ditemukan 905 peserta` (atau jumlah terbaru) + `Selesai! Inserted: ...`. Bila creds belum siap, fallback `data.csv` aktif (log: `Sumber data: data.csv (fallback lokal)`).

- [ ] **Step 5: Generate QR code**

```bash
ssh sumoPod 'cd /var/www/antrian && npm run qr 2>&1 | tail -5'
```
Expected: `QR code generated: qr-code.png` + `URL: http://43.157.227.203`.

- [ ] **Step 6: Jalankan dengan PM2 + startup**

```bash
ssh sumoPod 'cd /var/www/antrian && pm2 start ecosystem.config.cjs && pm2 save && pm2 startup 2>&1 | tail -15'
```
Expected: proses `antrian` status `online`. `pm2 startup` mencetak perintah `systemctl ...` — jalankan perintah itu sekali untuk enable auto-start saat reboot.

- [ ] **Step 7: Verifikasi app jalan di localhost server**

```bash
ssh sumoPod 'curl -s http://127.0.0.1:3007/api/statistik; echo; pm2 status 2>&1 | grep antrian'
```
Expected: JSON `{"total":...,"belum":...,...}` + baris `antrian` status `online`.

---

### Task 8: Nginx reverse proxy

**Catatan:** Tidak sentuh config site lain. Selalu `nginx -t` sebelum reload.

- [ ] **Step 1: Tulis config Nginx baru**

Buat `/etc/nginx/sites-available/antrian.conf` di server (via heredoc lewat SSH) dengan isi config dari `docs/deploy-sumopod.md` bagian "Config Nginx". Skrip:

```bash
ssh sumoPod 'cat > /etc/nginx/sites-available/antrian.conf <<"NGINX"
server {
    listen 80;
    listen [::]:80;
    server_name _;

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
NGINX'
```

- [ ] **Step 2: Enable site & test config**

```bash
ssh sumoPod 'ln -s /etc/nginx/sites-available/antrian.conf /etc/nginx/sites-enabled/antrian.conf && nginx -t 2>&1'
```
Expected: `syntax is ok` + `test is successful`. Bila gagal, **jangan reload** — perbaiki config dulu.

- [ ] **Step 3: Reload Nginx**

```bash
ssh sumoPod 'systemctl reload nginx && echo RELOADED'
```
Expected: `RELOADED` tanpa error.

- [ ] **Step 4: Verifikasi lewat Nginx (dari server)**

```bash
ssh sumoPod 'curl -s -I http://127.0.0.1/api/statistik; echo; curl -s http://127.0.0.1/api/statistik'
```
Expected: header `HTTP/1.1 200` + JSON stats (Nginx memproxy ke Node:3007 dengan benar).

---

### Task 9: Setup backup otomatis + verifikasi end-to-end

- [ ] **Step 1: Buat folder backup & test backup manual**

```bash
ssh sumoPod 'mkdir -p /var/backups/antrian && cd /var/www/antrian && npm run backup 2>&1 | tail -3'
```
Expected: `Backup selesai: /var/backups/antrian/antrian-<tanggal>.sqlite (purged 0 backup lama)`.

- [ ] **Step 2: Verifikasi file backup valid**

```bash
ssh sumoPod 'ls -la /var/backups/antrian/ && sqlite3 /var/backups/antrian/antrian-*.sqlite "SELECT COUNT(*) FROM peserta;" 2>&1 | tail -3'
```
Expected: file backup ada (ukuran >0) + query cetak jumlah peserta (mis. 905). (Bila `sqlite3` CLI tidak ada, skip — cukup file ada & `npm run backup` sukses.)

- [ ] **Step 3: Tambah cron job backup harian**

```bash
ssh sumoPod '(crontab -l 2>/dev/null; echo "0 2 * * * cd /var/www/antrian && /usr/bin/npm run backup >> /var/backups/antrian/backup.log 2>&1") | sort -u | crontab - && crontab -l | grep antrian'
```
Expected: baris cron muncul. (Jam 2 pagi waktu server.)

- [ ] **Step 4: Verifikasi end-to-end lewat browser (Chrome DevTools MCP)**

Buka `http://43.157.227.203` di browser via MCP:
- Halaman peserta tampil, cari nama (mis. "Budi"), ambil nomor antrian — nomor muncul.
- Buka `/panitia.html` → panggil nomor → nomor pindah ke kolom "Dipanggil".
- Buka `/info.html` → layar info update realtime (Socket.io).
- Saat panggil, chime + suara TTS diputar.
- Console browser: tidak ada error Socket.io (`socket connected`).

- [ ] **Step 5: Catat hasil verifikasi**

Report ke user: status deploy, URL akses, hasil smoke test & browser test, jadwal backup. Sebut bahwa domain sendiri & HTTPS (Tahap 6 di spec) dilakukan terpisah setelah DNS siap.

---

## Self-Review Notes

- **Spec coverage:** Semua bagian spec ter-cover — Task 1 (bind 127.0.0.1), Task 2+3 (backup), Task 4 (PM2), Task 5 (runbook), Task 6 (push GitHub), Task 7 (deploy+import+QR+PM2), Task 8 (Nginx+Socket.io), Task 9 (backup cron+verifikasi). Tahap 6 spec (domain/HTTPS) sengaja di-luar plan ini (di-spec sebagai "ditangani terpisah nanti") — runbook Task 5 tetap mendokumentasikan caranya.
- **Type consistency:** `runBackup({ dbPath, backupDir, retentionDays, now })` → `{ backed, purged }` konsisten antara test & implementasi. Nama proses PM2 `antrian` & port `3007` konsisten di `ecosystem.config.cjs`, runbook, Nginx, dan langkah deploy.
- **Placeholder:** Tidak ada "TBD"/"TODO". `<repo-url>` muncul sebagai placeholder eksplisit yang di-supply user di Task 6 step 1 — itu input yang ditunggu, bukan gap dokumen.
- **TDD:** Task 3 (backup script) memakai siklus tulis-test → fail → implementasi → pass. Task lain adalah refactor/config/infra (1 baris bind, JSON config, doc, SSH commands) yang diverifikasi via command eksplisit, bukan unit test — sesuai sifatnya.
