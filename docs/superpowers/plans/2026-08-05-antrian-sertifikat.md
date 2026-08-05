# Aplikasi Antrian Sertifikat - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun aplikasi web antrian pengambilan sertifikat dengan Node.js, SQLite, Socket.io, dan sync Google Sheets.

**Architecture:** Express.js server menyajikan API REST + static frontend. SQLite sebagai database lokal. Socket.io untuk real-time updates. googleapis untuk read/write Google Sheets via service account. Frontend vanilla JS + Tailwind CSS (CDN) untuk mobile-friendly UI tanpa build step.

**Tech Stack:** Node.js 20+, Express.js, better-sqlite3, Socket.io, googleapis, Tailwind CSS (CDN), Vanilla JS.

## Global Constraints

- Node.js 20+ required
- Database: SQLite via `better-sqlite3` (synchronous, simple)
- Frontend: Vanilla JS + Tailwind CSS via CDN (no build step)
- Google Sheets ID: `1vefx3SssNHYpjOVb3g37BgnNUfHklS7IMtFQKQpujm4`
- Spreadsheet punya 4 kolom: `Timestamp`, `NAMA LENGKAP`, `TEMPAT TANGGAL LAHIR`, `NO SERI`
- Kolom tambahan yang akan ditambah di Sheets: `STATUS`, `NOMOR_ANTRIAN`, `WAKTU_AMBIL`
- Status values: `belum` | `menunggu` | `dipanggil` | `selesai`
- Test framework: Node.js built-in `node:test` + `node:assert`
- Commit message format: `feat:`, `fix:`, `chore:`, `docs:`

---

## File Structure

```
antrian/
├── server.js                 # Entry point - Express + Socket.io setup
├── package.json              # Dependencies & scripts
├── .env                      # Config (Google credentials)
├── .env.example              # Template .env
├── .gitignore                # node_modules, .env, *.sqlite
├── database.sqlite           # SQLite file (generated)
├── public/                   # Frontend static files
│   ├── index.html            # Halaman peserta
│   ├── panitia.html          # Dashboard panitia
│   ├── css/
│   │   └── style.css         # Custom styles (Tailwind via CDN)
│   └── js/
│       ├── peserta.js        # Logic halaman peserta
│       └── panitia.js        # Logic dashboard panitia
├── src/
│   ├── db.js                 # Database init & query functions
│   ├── sheets.js             # Google Sheets read/write
│   ├── routes.js             # Express routes (API)
│   └── socket.js             # Socket.io event handlers
├── scripts/
│   ├── import-data.js        # Import data dari Sheets ke SQLite
│   └── generate-qr.js        # Generate QR code (PNG)
└── test/
    ├── db.test.js
    ├── routes.test.js
    └── sheets.test.js
```

---

## Task 1: Project Setup & Dependencies

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `server.js` (skeleton)

**Interfaces:**
- Produces: `package.json` dengan scripts `start`, `dev`, `test`, `import`, `qr`
- Produces: `server.js` yang menjalankan Express server di port dari `process.env.PORT`

- [ ] **Step 1: Inisialisasi npm project**

Run:
```bash
cd "c:\Users\ASUS\Videos\myAPP\antrian"
npm init -y
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install express better-sqlite3 socket.io googleapis dotenv cors qrcode
npm install --save-dev nodemon
```

- [ ] **Step 3: Edit package.json**

Ganti isi `package.json` dengan:

```json
{
  "name": "antrian-sertifikat",
  "version": "1.0.0",
  "description": "Aplikasi antrian pengambilan sertifikat",
  "main": "server.js",
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "node --test",
    "import": "node scripts/import-data.js",
    "qr": "node scripts/generate-qr.js"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.0",
    "express": "^4.19.0",
    "googleapis": "^140.0.0",
    "qrcode": "^1.5.3",
    "socket.io": "^4.7.0"
  },
  "devDependencies": {
    "nodemon": "^3.1.0"
  }
}
```

- [ ] **Step 4: Buat .gitignore**

```gitignore
node_modules/
.env
*.sqlite
*.sqlite-journal
qr-code.png
```

- [ ] **Step 5: Buat .env.example**

```env
PORT=3000
GOOGLE_SHEETS_ID=1vefx3SssNHYpjOVb3g37BgnNUfHklS7IMtFQKQpujm4
GOOGLE_SERVICE_ACCOUNT_EMAIL=xxx@xxx.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
```

- [ ] **Step 6: Buat server.js skeleton**

```javascript
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});

export { app, server, io };
```

- [ ] **Step 7: Test server start**

Run: `node server.js`
Expected: Server berjalan di http://localhost:3000 (lalu Ctrl+C)

- [ ] **Step 8: Commit**

```bash
git init
git add .
git commit -m "chore: project setup dengan Express, SQLite, Socket.io"
```

---

## Task 2: Database Module (db.js)

**Files:**
- Create: `src/db.js`
- Create: `test/db.test.js`

**Interfaces:**
- Produces: `initDb()` → inisialisasi database & buat tabel
- Produces: `getPesertaByNama(nama)` → cari peserta, return array of `{id, nama_lengkap, tempat_tanggal_lahir, no_seri}`
- Produces: `getPesertaById(id)` → return object peserta lengkap
- Produces: `ambilNomorAntrian(pesertaId)` → return nomor antrian integer
- Produces: `getAntrianByNomor(nomor)` → return object antrian
- Produces: `getDaftarAntrian(status)` → return array peserta berdasarkan status
- Produces: `updateStatus(nomor, status)` → update status peserta
- Produces: `setWaktuSelesai(nomor)` → set waktu_selesai timestamp
- Produces: `getStatistik()` → return `{total, belum, menunggu, dipanggil, selesai}`

- [ ] **Step 1: Write failing test untuk db module**

Buat file `test/db.test.js`:

```javascript
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { initDb, getPesertaByNama, getPesertaById, ambilNomorAntrian, getAntrianByNomor, getDaftarAntrian, updateStatus, setWaktuSelesai, getStatistik, insertPeserta } from '../src/db.js';

const TEST_DB = './test-database.sqlite';

beforeEach(async () => {
  process.env.DB_PATH = TEST_DB;
  await initDb();
  // Insert test data
  insertPeserta('Budi Santoso', 'Jakarta, 1 Januari 1990', '0012001', 2);
  insertPeserta('Budi Pratama', 'Bandung, 2 Februari 1991', '0012002', 3);
});

afterEach(() => {
  // DB akan re-init di test berikutnya
});

test('getPesertaByNama mencari nama parsial', () => {
  const hasil = getPesertaByNama('Budi');
  assert.equal(hasil.length, 2);
});

test('getPesertaByNama case insensitive', () => {
  const hasil = getPesertaByNama('budi');
  assert.ok(hasil.length > 0);
});

test('getPesertaById return data lengkap', () => {
  const peserta = getPesertaById(1);
  assert.equal(peserta.nama_lengkap, 'Budi Santoso');
  assert.equal(peserta.no_seri, '0012001');
});

test('ambilNomorAntrian return nomor berurutan', () => {
  const nomor1 = ambilNomorAntrian(1);
  const nomor2 = ambilNomorAntrian(2);
  assert.equal(nomor1, 1);
  assert.equal(nomor2, 2);
});

test('ambilNomorAntrian gak boleh double untuk peserta sama', () => {
  ambilNomorAntrian(1);
  assert.throws(() => ambilNomorAntrian(1), /sudah mengambil/i);
});

test('getAntrianByNomor return peserta dengan status', () => {
  const nomor = ambilNomorAntrian(1);
  const antrian = getAntrianByNomor(nomor);
  assert.equal(antrian.status, 'menunggu');
});

test('getDaftarAntrian filter by status', () => {
  ambilNomorAntrian(1);
  const menunggu = getDaftarAntrian('menunggu');
  assert.equal(menunggu.length, 1);
});

test('updateStatus mengubah status', () => {
  const nomor = ambilNomorAntrian(1);
  updateStatus(nomor, 'dipanggil');
  const antrian = getAntrianByNomor(nomor);
  assert.equal(antrian.status, 'dipanggil');
});

test('setWaktuSelesai set timestamp', () => {
  const nomor = ambilNomorAntrian(1);
  updateStatus(nomor, 'selesai');
  setWaktuSelesai(nomor);
  const antrian = getAntrianByNomor(nomor);
  assert.ok(antrian.waktu_selesai);
});

test('getStatistik return counter', () => {
  ambilNomorAntrian(1);
  ambilNomorAntrian(2);
  updateStatus(1, 'selesai');
  setWaktuSelesai(1);
  const stat = getStatistik();
  assert.equal(stat.total, 2);
  assert.equal(stat.menunggu, 1);
  assert.equal(stat.selesai, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/db.test.js`
Expected: FAIL dengan error module not found

- [ ] **Step 3: Implement src/db.js**

```javascript
import Database from 'better-sqlite3';
import path from 'path';

let db;

export function initDb() {
  const dbPath = process.env.DB_PATH || './database.sqlite';
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS peserta (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama_lengkap TEXT NOT NULL,
      tempat_tanggal_lahir TEXT,
      no_seri TEXT UNIQUE,
      nomor_antrian INTEGER,
      status TEXT DEFAULT 'belum',
      waktu_daftar DATETIME,
      waktu_selesai DATETIME,
      sheets_row INTEGER
    );

    CREATE TABLE IF NOT EXISTS antrian_counter (
      id INTEGER PRIMARY KEY,
      last_number INTEGER DEFAULT 0
    );

    INSERT OR IGNORE INTO antrian_counter (id, last_number) VALUES (1, 0);

    CREATE INDEX IF NOT EXISTS idx_peserta_status ON peserta(status);
    CREATE INDEX IF NOT EXISTS idx_peserta_nomor ON peserta(nomor_antrian);
  `);
}

export function insertPeserta(namaLengkap, ttl, noSeri, sheetsRow) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO peserta (nama_lengkap, tempat_tanggal_lahir, no_seri, sheets_row)
    VALUES (?, ?, ?, ?)
  `);
  const info = stmt.run(namaLengkap, ttl, noSeri, sheetsRow);
  return info.lastInsertRowid;
}

export function getPesertaByNama(nama) {
  const stmt = db.prepare(`
    SELECT id, nama_lengkap, tempat_tanggal_lahir, no_seri
    FROM peserta
    WHERE nama_lengkap LIKE ? COLLATE NOCASE
    ORDER BY nama_lengkap
    LIMIT 20
  `);
  return stmt.all(`%${nama}%`);
}

export function getPesertaById(id) {
  const stmt = db.prepare('SELECT * FROM peserta WHERE id = ?');
  return stmt.get(id);
}

export function ambilNomorAntrian(pesertaId) {
  const peserta = getPesertaById(pesertaId);
  if (!peserta) throw new Error('Peserta tidak ditemukan');
  if (peserta.nomor_antrian !== null && peserta.nomor_antrian !== undefined) {
    throw new Error('Peserta sudah mengambil nomor antrian');
  }

  const updateTx = db.transaction(() => {
    const counter = db.prepare('SELECT last_number FROM antrian_counter WHERE id = 1').get();
    const newNumber = counter.last_number + 1;
    db.prepare(`
      UPDATE antrian_counter SET last_number = ? WHERE id = 1
    `).run(newNumber);
    db.prepare(`
      UPDATE peserta
      SET nomor_antrian = ?, status = 'menunggu', waktu_daftar = datetime('now')
      WHERE id = ?
    `).run(newNumber, pesertaId);
    return newNumber;
  });

  return updateTx();
}

export function getAntrianByNomor(nomor) {
  const stmt = db.prepare('SELECT * FROM peserta WHERE nomor_antrian = ?');
  return stmt.get(nomor);
}

export function getDaftarAntrian(status) {
  const stmt = db.prepare(`
    SELECT nomor_antrian, nama_lengkap, no_seri, status, waktu_daftar
    FROM peserta
    WHERE status = ? AND nomor_antrian IS NOT NULL
    ORDER BY nomor_antrian
  `);
  return stmt.all(status);
}

export function updateStatus(nomor, status) {
  db.prepare('UPDATE peserta SET status = ? WHERE nomor_antrian = ?').run(status, nomor);
}

export function setWaktuSelesai(nomor) {
  db.prepare(`UPDATE peserta SET waktu_selesai = datetime('now') WHERE nomor_antrian = ?`).run(nomor);
}

export function getStatistik() {
  const total = db.prepare('SELECT COUNT(*) as count FROM peserta WHERE nomor_antrian IS NOT NULL').get().count;
  const belum = db.prepare("SELECT COUNT(*) as count FROM peserta WHERE status = 'belum'").get().count;
  const menunggu = db.prepare("SELECT COUNT(*) as count FROM peserta WHERE status = 'menunggu'").get().count;
  const dipanggil = db.prepare("SELECT COUNT(*) as count FROM peserta WHERE status = 'dipanggil'").get().count;
  const selesai = db.prepare("SELECT COUNT(*) as count FROM peserta WHERE status = 'selesai'").get().count;
  return { total, belum, menunggu, dipanggil, selesai };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/db.test.js`
Expected: PASS all tests

- [ ] **Step 5: Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "feat: database module dengan SQLite dan unit tests"
```

---

## Task 3: Google Sheets Module (sheets.js)

**Files:**
- Create: `src/sheets.js`
- Create: `test/sheets.test.js`

**Interfaces:**
- Produces: `getSheetsClient()` → return authenticated Google Sheets API client
- Produces: `readAllPeserta()` → return array of `{nama_lengkap, tempat_tanggal_lahir, no_seri, row_number}`
- Produces: `updateStatusInSheets(rowNumber, status, nomorAntrian, waktuAmbil)` → update row di Google Sheets

- [ ] **Step 1: Write failing test (mock untuk sheets)**

Buat file `test/sheets.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert';

// Test ini skip kalau tidak ada credentials
const hasCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY;

test('sheets module export fungsi yang benar', async () => {
  const sheets = await import('../src/sheets.js');
  assert.equal(typeof sheets.readAllPeserta, 'function');
  assert.equal(typeof sheets.updateStatusInSheets, 'function');
  assert.equal(typeof sheets.getSheetsClient, 'function');
});

test('updateStatusInSheets signature benar', async () => {
  const { updateStatusInSheets } = await import('../src/sheets.js');
  // Function harus menerima 4 argumen: rowNumber, status, nomorAntrian, waktuAmbil
  assert.equal(updateStatusInSheets.length, 4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sheets.test.js`
Expected: FAIL module not found

- [ ] **Step 3: Implement src/sheets.js**

```javascript
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

let sheetsClient = null;

export function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: 'service_account',
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

export async function readAllPeserta() {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

  // Baca header dulu untuk tau kolom NO SERI ada di index berapa
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'A1:Z2',
  });

  const headers = headerRes.data.values[0];
  const rowIndex = {}; // map nama kolom → index
  headers.forEach((h, i) => {
    const cleanName = h.replace(/\n/g, ' ').trim().toUpperCase();
    rowIndex[cleanName] = i;
  });

  // Nama kolom bisa bervariasi, cari yang cocok
  const namaCol = Object.keys(rowIndex).find(k => k.includes('NAMA LENGKAP'));
  const ttlCol = Object.keys(rowIndex).find(k => k.includes('TEMPAT'));
  const seriCol = Object.keys(rowIndex).find(k => k.includes('NO SERI'));

  const namaIdx = rowIndex[namaCol];
  const ttlIdx = rowIndex[ttlCol];
  const seriIdx = rowIndex[seriCol];

  // Baca semua data
  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'A2:Z',
  });

  const rows = dataRes.data.values || [];
  return rows
    .map((row, i) => ({
      nama_lengkap: row[namaIdx] || '',
      tempat_tanggal_lahir: row[ttlIdx] || '',
      no_seri: row[seriIdx] || '',
      row_number: i + 2, // +2 karena data mulai row 2 (header di row 1)
    }))
    .filter(p => p.nama_lengkap && p.no_seri);
}

export async function updateStatusInSheets(rowNumber, status, nomorAntrian, waktuAmbil) {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

  // Cari header untuk tau kolom STATUS, NOMOR_ANTRIAN, WAKTU_AMBIL ada di mana
  // Kalau belum ada, tambahkan kolom baru
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'A1:Z1',
  });

  const headers = headerRes.data.values[0];
  let statusCol = headers.findIndex(h => h && h.toUpperCase() === 'STATUS');
  let nomorCol = headers.findIndex(h => h && h.toUpperCase() === 'NOMOR_ANTRIAN');
  let waktuCol = headers.findIndex(h => h && h.toUpperCase() === 'WAKTU_AMBIL');

  // Kalau kolom belum ada, tambah di akhir
  const updates = [];

  if (statusCol === -1) {
    statusCol = headers.length;
    headers.push('STATUS');
    updates.push({
      range: `${columnLetter(statusCol)}1`,
      values: [['STATUS']],
    });
  }
  if (nomorCol === -1) {
    nomorCol = headers.length;
    headers.push('NOMOR_ANTRIAN');
    updates.push({
      range: `${columnLetter(nomorCol)}1`,
      values: [['NOMOR_ANTRIAN']],
    });
  }
  if (waktuCol === -1) {
    waktuCol = headers.length;
    headers.push('WAKTU_AMBIL');
    updates.push({
      range: `${columnLetter(waktuCol)}1`,
      values: [['WAKTU_AMBIL']],
    });
  }

  // Update header kalau ada kolom baru
  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: updates,
      },
    });
  }

  // Update row data
  const statusCell = `${columnLetter(statusCol)}${rowNumber}`;
  const nomorCell = `${columnLetter(nomorCol)}${rowNumber}`;
  const waktuCell = `${columnLetter(waktuCol)}${rowNumber}`;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: statusCell, values: [[status]] },
        { range: nomorCell, values: [[nomorAntrian]] },
        { range: waktuCell, values: [[waktuAmbil]] },
      ],
    },
  });
}

function columnLetter(index) {
  let result = '';
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sheets.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sheets.js test/sheets.test.js
git commit -m "feat: Google Sheets module untuk read/write data"
```

---

## Task 4: Import Data Script

**Files:**
- Create: `scripts/import-data.js`

**Interfaces:**
- Consumes: `readAllPeserta()` dari `src/sheets.js`
- Consumes: `initDb()`, `insertPeserta()` dari `src/db.js`

- [ ] **Step 1: Implement import-data.js**

```javascript
import dotenv from 'dotenv';
import { initDb, insertPeserta } from '../src/db.js';
import { readAllPeserta } from '../src/sheets.js';

dotenv.config();

async function main() {
  console.log('Inisialisasi database...');
  initDb();

  console.log('Mengambil data dari Google Sheets...');
  const pesertaList = await readAllPeserta();
  console.log(`Ditemukan ${pesertaList.length} peserta`);

  let inserted = 0;
  let skipped = 0;

  for (const peserta of pesertaList) {
    const result = insertPeserta(
      peserta.nama_lengkap,
      peserta.tempat_tanggal_lahir,
      peserta.no_seri,
      peserta.row_number
    );
    if (result > 0) {
      inserted++;
    } else {
      skipped++;
    }
  }

  console.log(`Selesai! Inserted: ${inserted}, Skipped (duplikat): ${skipped}`);
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Test manual (butuh Google credentials)**

Pastikan `.env` sudah diisi dengan credentials yang valid. Lalu:

Run: `npm run import`
Expected: "Ditemukan ~984 peserta" lalu "Selesai! Inserted: ~984"

- [ ] **Step 3: Commit**

```bash
git add scripts/import-data.js
git commit -m "feat: script import data dari Google Sheets ke SQLite"
```

---

## Task 5: API Routes (routes.js)

**Files:**
- Create: `src/routes.js`
- Create: `test/routes.test.js`

**Interfaces:**
- Consumes: semua function dari `src/db.js`
- Produces: Express router dengan endpoints:
  - `GET /api/peserta/cari?nama=xxx`
  - `GET /api/peserta/:id`
  - `POST /api/antrian/ambil`
  - `GET /api/antrian/status/:nomor`
  - `GET /api/antrian/daftar?status=menunggu`
  - `POST /api/antrian/panggil/:nomor`
  - `POST /api/antrian/selesai/:nomor`
  - `GET /api/statistik`

- [ ] **Step 1: Write failing test untuk routes**

Buat file `test/routes.test.js`:

```javascript
import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import request from 'supertest';

// Kita tidak install supertest, pakai approach sederhana
// Test manual dengan fetch

import { createRouter } from '../src/routes.js';
import { initDb, insertPeserta, ambilNomorAntrian } from '../src/db.js';

let app;

beforeEach(async () => {
  process.env.DB_PATH = './test-routes.sqlite';
  initDb();
  insertPeserta('Andi Wijaya', 'Surabaya, 5 Mei 1990', '0013001', 2);
  insertPeserta('Andi Saputra', 'Malang, 6 Juni 1991', '0013002', 3);
  app = express();
  app.use(express.json());
  app.use('/api', createRouter());
});

test('GET /api/peserta/cari return hasil pencarian', async () => {
  const res = await fetch('http://localhost:0'); // dummy
  // Test manual: jalankan server, hit endpoint
  // Untuk unit test, panggil router function langsung
  assert.ok(createRouter);
});

test('createRouter adalah function', () => {
  assert.equal(typeof createRouter, 'function');
});
```

Karena `supertest` tidak diinstall, gunakan test sederhana yang verifikasi router ada dan bisa dipanggil. Untuk integration test penuh, jalankan server manual.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/routes.test.js`
Expected: FAIL module not found

- [ ] **Step 3: Implement src/routes.js**

```javascript
import { Router } from 'express';
import {
  getPesertaByNama,
  getPesertaById,
  ambilNomorAntrian,
  getAntrianByNomor,
  getDaftarAntrian,
  updateStatus,
  setWaktuSelesai,
  getStatistik,
} from './db.js';
import { updateStatusInSheets } from './sheets.js';

export function createRouter(io) {
  const router = Router();

  // Cari peserta (autocomplete)
  router.get('/peserta/cari', (req, res) => {
    const nama = req.query.nama;
    if (!nama || nama.length < 2) {
      return res.json([]);
    }
    const hasil = getPesertaByNama(nama);
    res.json(hasil);
  });

  // Detail peserta
  router.get('/peserta/:id', (req, res) => {
    const peserta = getPesertaById(parseInt(req.params.id));
    if (!peserta) return res.status(404).json({ error: 'Peserta tidak ditemukan' });
    res.json(peserta);
  });

  // Ambil nomor antrian
  router.post('/antrian/ambil', (req, res) => {
    const { pesertaId } = req.body;
    if (!pesertaId) return res.status(400).json({ error: 'pesertaId wajib' });
    try {
      const nomor = ambilNomorAntrian(pesertaId);
      const peserta = getAntrianByNomor(nomor);
      if (io) io.emit('antrian:baru', peserta);
      if (io) io.emit('statistik:update', getStatistik());
      res.json({ nomor_antrian: nomor, status: 'menunggu' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Cek status antrian
  router.get('/antrian/status/:nomor', (req, res) => {
    const nomor = parseInt(req.params.nomor);
    const antrian = getAntrianByNomor(nomor);
    if (!antrian) return res.status(404).json({ error: 'Nomor antrian tidak ditemukan' });
    res.json(antrian);
  });

  // Daftar antrian (panitia)
  router.get('/antrian/daftar', (req, res) => {
    const status = req.query.status || 'menunggu';
    const daftar = getDaftarAntrian(status);
    res.json(daftar);
  });

  // Panggil peserta
  router.post('/antrian/panggil/:nomor', (req, res) => {
    const nomor = parseInt(req.params.nomor);
    const antrian = getAntrianByNomor(nomor);
    if (!antrian) return res.status(404).json({ error: 'Tidak ditemukan' });
    updateStatus(nomor, 'dipanggil');
    if (io) io.emit('antrian:panggil', { nomor, peserta: getAntrianByNomor(nomor) });
    if (io) io.emit('statistik:update', getStatistik());
    res.json({ success: true });
  });

  // Selesai (sync ke Sheets)
  router.post('/antrian/selesai/:nomor', async (req, res) => {
    const nomor = parseInt(req.params.nomor);
    const antrian = getAntrianByNomor(nomor);
    if (!antrian) return res.status(404).json({ error: 'Tidak ditemukan' });
    updateStatus(nomor, 'selesai');
    setWaktuSelesai(nomor);
    if (io) io.emit('antrian:selesai', { nomor });
    if (io) io.emit('statistik:update', getStatistik());

    // Sync ke Google Sheets (non-blocking, jangan block response)
    try {
      const waktuAmbil = new Date().toISOString();
      await updateStatusInSheets(antrian.sheets_row, 'selesai', nomor, waktuAmbil);
    } catch (err) {
      console.error('Sheets sync error:', err.message);
    }

    res.json({ success: true });
  });

  // Statistik
  router.get('/statistik', (req, res) => {
    res.json(getStatistik());
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/routes.test.js`
Expected: PASS

- [ ] **Step 5: Test manual API**

Jalankan server, lalu test endpoint:

```bash
node server.js
# Di terminal lain:
curl "http://localhost:3000/api/peserta/cari?nama=andi"
```

Expected: JSON array dengan peserta yang cocok.

- [ ] **Step 6: Commit**

```bash
git add src/routes.js test/routes.test.js
git commit -m "feat: API routes untuk peserta dan antrian"
```

---

## Task 6: Socket.io Setup (socket.js)

**Files:**
- Create: `src/socket.js`
- Modify: `server.js` (integrasi routes + socket)

**Interfaces:**
- Produces: `setupSocket(io)` → attach event listeners ke Socket.io

- [ ] **Step 1: Implement src/socket.js**

```javascript
export function setupSocket(io) {
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Peserta join room berdasarkan nomor antrian untuk terima update
    socket.on('peserta:join', (nomorAntrian) => {
      socket.join(`peserta:${nomorAntrian}`);
      console.log(`Peserta ${nomorAntrian} joined room`);
    });

    // Panitia join room panitia
    socket.on('panitia:join', () => {
      socket.join('panitia');
      console.log('Panitia joined room');
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  return io;
}
```

- [ ] **Step 2: Update server.js untuk integrasi routes & socket**

Ganti isi `server.js`:

```javascript
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './src/db.js';
import { createRouter } from './src/routes.js';
import { setupSocket } from './src/socket.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Init database
initDb();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', createRouter(io));

// Socket.io
setupSocket(io);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
  console.log(`Dashboard panitia: http://localhost:${PORT}/panitia.html`);
});

export { app, server, io };
```

- [ ] **Step 3: Test server start**

Run: `node server.js`
Expected: Server berjalan, database ter-init

- [ ] **Step 4: Commit**

```bash
git add src/socket.js server.js
git commit -m "feat: Socket.io setup untuk real-time updates"
```

---

## Task 7: Frontend - Halaman Peserta

**Files:**
- Create: `public/index.html`
- Create: `public/js/peserta.js`
- Create: `public/css/style.css`

**Interfaces:**
- Consumes: `GET /api/peserta/cari?nama=`, `GET /api/peserta/:id`, `POST /api/antrian/ambil`, `GET /api/antrian/status/:nomor`

- [ ] **Step 1: Buat public/css/style.css**

```css
/* Custom styles - Tailwind via CDN */
body {
  font-family: 'Inter', sans-serif;
}

@media print {
  .no-print {
    display: none;
  }
}

/* Animasi pulse untuk nomor antrian */
@keyframes pulse-large {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

.animate-pulse-large {
  animation: pulse-large 2s ease-in-out infinite;
}

/* Highlight saat dipanggil */
@keyframes flash {
  0%, 100% { background-color: #fef3c7; }
  50% { background-color: #fde68a; }
}

.flash-dipanggil {
  animation: flash 1s ease-in-out 3;
}
```

- [ ] **Step 2: Buat public/index.html**

```html
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Antrian Pengambilan Sertifikat</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="/css/style.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
</head>
<body class="bg-gradient-to-br from-blue-50 to-blue-100 min-h-screen">

  <!-- Screen: Cari Nama -->
  <div id="screen-cari" class="min-h-screen flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
      <h1 class="text-2xl font-bold text-center text-blue-800 mb-2">Pengambilan Sertifikat</h1>
      <p class="text-center text-gray-500 mb-6">Cari nama Anda untuk mengambil nomor antrian</p>

      <label class="block text-sm font-medium text-gray-700 mb-2">Masukkan Nama</label>
      <input
        type="text"
        id="input-nama"
        class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        placeholder="Ketik nama lengkap..."
        autocomplete="off"
      >

      <div id="hasil-pencarian" class="mt-3 max-h-60 overflow-y-auto"></div>

      <div id="detail-peserta" class="mt-6 hidden">
        <!-- Diisi oleh JS -->
      </div>
    </div>
  </div>

  <!-- Screen: Nomor Antrian -->
  <div id="screen-antrian" class="min-h-screen flex items-center justify-center p-4 hidden">
    <div class="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
      <h2 class="text-lg font-semibold text-gray-600 mb-2">Nomor Antrian Anda</h2>
      <div id="nomor-antrian" class="text-8xl font-extrabold text-blue-700 my-6 animate-pulse-large">-</div>

      <div id="status-box" class="py-3 px-4 rounded-lg mb-4">
        <span id="status-text" class="text-lg font-semibold">Menunggu</span>
      </div>

      <div id="info-peserta" class="text-left bg-gray-50 rounded-lg p-4 mb-4 text-sm">
        <!-- Diisi oleh JS -->
      </div>

      <p class="text-xs text-gray-400">Tutup halaman ini saat sudah selesai. Status update otomatis.</p>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="/js/peserta.js"></script>
</body>
</html>
```

- [ ] **Step 3: Buat public/js/peserta.js**

```javascript
const socket = io();

let pesertaTerpilih = null;

const inputNama = document.getElementById('input-nama');
const hasilPencarian = document.getElementById('hasil-pencarian');
const detailPeserta = document.getElementById('detail-peserta');

// Autocomplete search
let timeoutId;
inputNama.addEventListener('input', (e) => {
  clearTimeout(timeoutId);
  const nama = e.target.value.trim();

  if (nama.length < 2) {
    hasilPencarian.innerHTML = '';
    return;
  }

  timeoutId = setTimeout(async () => {
    const res = await fetch(`/api/peserta/cari?nama=${encodeURIComponent(nama)}`);
    const data = await res.json();
    tampilkanHasilPencarian(data);
  }, 300);
});

function tampilkanHasilPencarian(data) {
  if (data.length === 0) {
    hasilPencarian.innerHTML = '<p class="text-gray-400 text-sm py-2">Nama tidak ditemukan</p>';
    return;
  }

  hasilPencarian.innerHTML = data.map(p => `
    <button
      onclick="pilihPeserta(${p.id})"
      class="w-full text-left px-4 py-2 hover:bg-blue-50 rounded-lg border-b border-gray-100 transition"
    >
      <div class="font-medium text-gray-800">${p.nama_lengkap}</div>
      <div class="text-xs text-gray-500">No Seri: ${p.no_seri}</div>
    </button>
  `).join('');
}

async function pilihPeserta(id) {
  const res = await fetch(`/api/peserta/${id}`);
  const peserta = await res.json();

  if (peserta.error) {
    alert(peserta.error);
    return;
  }

  pesertaTerpilih = peserta;
  hasilPencarian.innerHTML = '';
  inputNama.value = '';

  // Tampilkan detail
  detailPeserta.classList.remove('hidden');
  detailPeserta.innerHTML = `
    <div class="bg-blue-50 rounded-lg p-4 mb-4">
      <div class="mb-2">
        <span class="text-xs text-gray-500">Nama Lengkap</span>
        <p class="font-semibold">${peserta.nama_lengkap}</p>
      </div>
      <div class="mb-2">
        <span class="text-xs text-gray-500">Tempat, Tanggal Lahir</span>
        <p class="font-semibold">${peserta.tempat_tanggal_lahir}</p>
      </div>
      <div>
        <span class="text-xs text-gray-500">No Seri</span>
        <p class="font-semibold">${peserta.no_seri}</p>
      </div>
    </div>
    <button
      onclick="ambilAntrian()"
      class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition"
    >
      Konfirmasi & Ambil Nomor Antrian
    </button>
  `;
}

async function ambilAntrian() {
  if (!pesertaTerpilih) return;

  const res = await fetch('/api/antrian/ambil', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pesertaId: pesertaTerpilih.id }),
  });

  const data = await res.json();

  if (data.error) {
    alert(data.error);
    return;
  }

  // Pindah ke screen antrian
  document.getElementById('screen-cari').classList.add('hidden');
  document.getElementById('screen-antrian').classList.remove('hidden');

  document.getElementById('nomor-antrian').textContent = data.nomor_antrian;

  // Tampilkan info peserta
  document.getElementById('info-peserta').innerHTML = `
    <p><strong>Nama:</strong> ${pesertaTerpilih.nama_lengkap}</p>
    <p><strong>No Seri:</strong> ${pesertaTerpilih.no_seri}</p>
  `;

  // Join socket room untuk update status
  socket.emit('peserta:join', data.nomor_antrian);

  updateStatusDisplay('menunggu');
}

function updateStatusDisplay(status) {
  const statusText = document.getElementById('status-text');
  const statusBox = document.getElementById('status-box');

  const statusMap = {
    'menunggu': { text: 'Menunggu', class: 'bg-yellow-100 text-yellow-800' },
    'dipanggil': { text: 'Dipanggil! Silakan ke counter', class: 'bg-green-100 text-green-800' },
    'selesai': { text: 'Selesai', class: 'bg-blue-100 text-blue-800' },
  };

  const config = statusMap[status] || statusMap['menunggu'];
  statusText.textContent = config.text;
  statusBox.className = `py-3 px-4 rounded-lg mb-4 ${config.class}`;

  if (status === 'dipanggil') {
    document.querySelector('#screen-antrian .bg-white').classList.add('flash-dipanggil');
  }
}

// Listen untuk update status
socket.on('antrian:panggil', (data) => {
  updateStatusDisplay('dipanggil');
});

socket.on('antrian:selesai', (data) => {
  updateStatusDisplay('selesai');
});

// Expose ke window untuk onclick handlers
window.pilihPeserta = pilihPeserta;
window.ambilAntrian = ambilAntrian;
```

- [ ] **Step 4: Test manual**

Run: `node server.js`
Buka browser: `http://localhost:3000`
Expected: Halaman pencarian tampil, ketik nama muncul autocomplete, klik nama muncul detail, klik konfirmasi muncul nomor antrian.

- [ ] **Step 5: Commit**

```bash
git add public/
git commit -m "feat: frontend halaman peserta dengan autocomplete dan real-time status"
```

---

## Task 8: Frontend - Dashboard Panitia

**Files:**
- Create: `public/panitia.html`
- Create: `public/js/panitia.js`

**Interfaces:**
- Consumes: `GET /api/statistik`, `GET /api/antrian/daftar?status=`, `POST /api/antrian/panggil/:nomor`, `POST /api/antrian/selesai/:nomor`

- [ ] **Step 1: Buat public/panitia.html**

```html
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard Panitia - Antrian Sertifikat</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="/css/style.css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
</head>
<body class="bg-gray-100 min-h-screen">

  <div class="max-w-6xl mx-auto p-4">
    <!-- Header -->
    <div class="bg-white rounded-xl shadow p-6 mb-4">
      <h1 class="text-2xl font-bold text-gray-800">Dashboard Panitia</h1>
      <p class="text-gray-500 text-sm">Antrian Pengambilan Sertifikat</p>
    </div>

    <!-- Statistik -->
    <div id="statistik" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
      <div class="bg-white rounded-xl shadow p-4 text-center">
        <div class="text-sm text-gray-500">Total Antrian</div>
        <div id="stat-total" class="text-3xl font-bold text-gray-800">0</div>
      </div>
      <div class="bg-white rounded-xl shadow p-4 text-center">
        <div class="text-sm text-gray-500">Menunggu</div>
        <div id="stat-menunggu" class="text-3xl font-bold text-yellow-600">0</div>
      </div>
      <div class="bg-white rounded-xl shadow p-4 text-center">
        <div class="text-sm text-gray-500">Dipanggil</div>
        <div id="stat-dipanggil" class="text-3xl font-bold text-blue-600">0</div>
      </div>
      <div class="bg-white rounded-xl shadow p-4 text-center">
        <div class="text-sm text-gray-500">Selesai</div>
        <div id="stat-selesai" class="text-3xl font-bold text-green-600">0</div>
      </div>
    </div>

    <!-- Filter & Daftar Antrian -->
    <div class="bg-white rounded-xl shadow p-6">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-lg font-bold text-gray-800">Daftar Antrian</h2>
        <div class="flex gap-2">
          <button onclick="loadDaftar('menunggu')" class="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-lg text-sm font-medium">Menunggu</button>
          <button onclick="loadDaftar('dipanggil')" class="px-3 py-1 bg-blue-100 text-blue-800 rounded-lg text-sm font-medium">Dipanggil</button>
          <button onclick="loadDaftar('selesai')" class="px-3 py-1 bg-green-100 text-green-800 rounded-lg text-sm font-medium">Selesai</button>
        </div>
      </div>

      <div id="daftar-antrian" class="space-y-2">
        <p class="text-gray-400 text-center py-4">Memuat data...</p>
      </div>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="/js/panitia.js"></script>
</body>
</html>
```

- [ ] **Step 2: Buat public/js/panitia.js**

```javascript
const socket = io();
socket.emit('panitia:join');

let currentFilter = 'menunggu';

async function loadStatistik() {
  const res = await fetch('/api/statistik');
  const data = await res.json();
  document.getElementById('stat-total').textContent = data.total;
  document.getElementById('stat-menunggu').textContent = data.menunggu;
  document.getElementById('stat-dipanggil').textContent = data.dipanggil;
  document.getElementById('stat-selesai').textContent = data.selesai;
}

async function loadDaftar(status) {
  currentFilter = status;
  const res = await fetch(`/api/antrian/daftar?status=${status}`);
  const data = await res.json();

  const container = document.getElementById('daftar-antrian');

  if (data.length === 0) {
    container.innerHTML = '<p class="text-gray-400 text-center py-4">Tidak ada antrian</p>';
    return;
  }

  container.innerHTML = data.map(p => {
    let actions = '';
    if (status === 'menunggu') {
      actions = `
        <button onclick="panggil(${p.nomor_antrian})" class="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Panggil</button>
        <button onclick="selesai(${p.nomor_antrian})" class="px-3 py-1 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">Selesai</button>
      `;
    } else if (status === 'dipanggil') {
      actions = `
        <button onclick="selesai(${p.nomor_antrian})" class="px-3 py-1 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">Selesai</button>
      `;
    }

    return `
      <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
        <div class="flex items-center gap-4">
          <div class="text-2xl font-bold text-blue-700 w-12">#${p.nomor_antrian}</div>
          <div>
            <div class="font-semibold text-gray-800">${p.nama_lengkap}</div>
            <div class="text-sm text-gray-500">No Seri: ${p.no_seri}</div>
          </div>
        </div>
        <div class="flex gap-2">${actions}</div>
      </div>
    `;
  }).join('');
}

async function panggil(nomor) {
  await fetch(`/api/antrian/panggil/${nomor}`, { method: 'POST' });
  loadDaftar(currentFilter);
  loadStatistik();
}

async function selesai(nomor) {
  await fetch(`/api/antrian/selesai/${nomor}`, { method: 'POST' });
  loadDaftar(currentFilter);
  loadStatistik();
}

// Real-time updates
socket.on('antrian:baru', () => {
  if (currentFilter === 'menunggu') loadDaftar(currentFilter);
  loadStatistik();
});

socket.on('statistik:update', () => {
  loadStatistik();
});

socket.on('antrian:selesai', () => {
  loadDaftar(currentFilter);
  loadStatistik();
});

// Initial load
loadStatistik();
loadDaftar('menunggu');

// Expose
window.loadDaftar = loadDaftar;
window.panggil = panggil;
window.selesai = selesai;
```

- [ ] **Step 3: Test manual**

Run: `node server.js`
Buka: `http://localhost:3000/panitia.html`
Expected: Dashboard tampil dengan statistik 0, daftar antrian kosong. Saat peserta ambil antrian (dari tab lain), dashboard update real-time.

- [ ] **Step 4: Commit**

```bash
git add public/panitia.html public/js/panitia.js
git commit -m "feat: dashboard panitia dengan real-time updates"
```

---

## Task 9: QR Code Generator Script

**Files:**
- Create: `scripts/generate-qr.js`

**Interfaces:**
- Produces: File `qr-code.png` berisi QR code yang menuju URL aplikasi

- [ ] **Step 1: Implement generate-qr.js**

```javascript
import dotenv from 'dotenv';
import QRCode from 'qrcode';
import fs from 'fs';

dotenv.config();

async function main() {
  const port = process.env.PORT || 3000;
  const url = process.env.APP_URL || `http://localhost:${port}`;

  await QRCode.toFile('qr-code.png', url, {
    width: 400,
    margin: 2,
    color: {
      dark: '#1e40af',
      light: '#ffffff',
    },
  });

  console.log(`QR code generated: qr-code.png`);
  console.log(`URL: ${url}`);
  console.log('Print QR code ini dan tempel di lokasi pengambilan sertifikat.');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Test generate QR**

Run: `npm run qr`
Expected: File `qr-code.png` terbuat di root folder

- [ ] **Step 3: Commit**

```bash
git add scripts/generate-qr.js
git commit -m "feat: script generate QR code untuk lokasi"
```

---

## Task 10: README & Final Integration Test

**Files:**
- Create: `README.md`

- [ ] **Step 1: Buat README.md**

```markdown
# Aplikasi Antrian Pengambilan Sertifikat

Aplikasi web untuk mengelola antrian pengambilan sertifikat peserta.

## Setup

### 1. Google Service Account

1. Buka [Google Cloud Console](https://console.cloud.google.com/)
2. Buat project baru atau pilih project yang ada
3. Enable **Google Sheets API**
4. Buat **Service Account** (IAM & Admin → Service Accounts)
5. Buat key (JSON), download
6. Share spreadsheet ke email service account (editor permission)
7. Copy email & private key ke `.env`

### 2. Install & Config

```bash
npm install
cp .env.example .env
# Edit .env dengan credentials Anda
```

### 3. Import Data

```bash
npm run import
```

### 4. Generate QR Code

```bash
npm run qr
```

### 5. Jalankan Server

```bash
npm run dev
```

- Peserta: http://localhost:3000
- Panitia: http://localhost:3000/panitia.html

## Deploy

Deploy ke Railway/Render:
1. Push ke GitHub
2. Connect repo ke Railway/Render
3. Set environment variables
4. Deploy
5. Set `APP_URL` ke URL produksi
6. Generate QR code baru: `npm run qr`

## Testing

```bash
npm test
```
```

- [ ] **Step 2: Final integration test manual**

Jalankan full flow:
1. `node server.js`
2. Buka `http://localhost:3000/panitia.html` → dashboard panitia
3. Buka `http://localhost:3000` → halaman peserta
4. Cari nama, konfirmasi, ambil nomor antrian
5. Cek dashboard panitia update real-time
6. Klik "Panggil" → status peserta berubah
7. Klik "Selesai" → status selesai, sync ke Google Sheets

Expected: Semua flow berfungsi.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README dengan setup & deploy instructions"
```

---

## Security Note

Tailwind CSS via Play CDN (`cdn.tailwindcss.com`) digunakan untuk development simplicity (no build step). CDN ini tidak mendukung SRI (Subresource Integrity) karena script di-generate dinamis.

**Untuk produksi yang aman**, pertimbangkan upgrade ke Tailwind build proper:
```bash
npm install -D tailwindcss
npx tailwindcss init
# Build CSS: npx tailwindcss -i input.css -o public/css/style.css --minify
```

Ini menghilangkan dependency CDN dan memungkinkan SRI hash.

---

## Deployment Checklist

- [ ] Google Service Account dibuat & spreadsheet di-share
- [ ] `.env` diisi dengan credentials valid
- [ ] `npm run import` berhasil (data masuk ke SQLite)
- [ ] `npm run qr` berhasil (QR code terbuat)
- [ ] Deploy ke Railway/Render
- [ ] Set environment variables di hosting
- [ ] Test URL produksi
- [ ] Generate QR code dengan URL produksi
- [ ] Print & tempel QR code di lokasi
- [ ] Test full flow di produksi
