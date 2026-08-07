# Modal Password Panitia Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan pengaman password pada halaman `/panitia` berupa modal elegan (logo UIN + PPG) yang harus dilewati sebelum dashboard dapat diakses; validasi password server-side (bcrypt di SQLite) dengan token HMAC signed stateless melindungi endpoint aksi panitia.

**Architecture:** Password panitia di-hash bcrypt, disimpan di tabel `panitia_auth` (1 baris, akun tunggal). Login mengembalikan token HMAC signed (`base64url(payload).base64url(HMAC)`) dengan payload `{role, ver, exp}`. Middleware `requirePanitia` memverifikasi signature + expiry + `token_version` (naik saat ganti password → invalidasi total). Frontend menyimpan token di localStorage (TTL 8 jam), menggate inisialisasi dashboard sampai login, dan membungkus semua fetch aksi panitia via `apiFetch()` yang otomatis menyertakan header Authorization.

**Tech Stack:** Node.js + Express 4 + Socket.io 4, better-sqlite3, `node:test` (built-in), bcryptjs (pure JS), vanilla JS frontend (Tailwind via CDN + design tokens CSS).

## Global Constraints

- Hash password pakai `bcryptjs` cost 10 (pure JS, no native build).
- `AUTH_SECRET` wajib di `.env`; bila kosong saat server start → refuse start dengan pesan jelas.
- Token TTL default 8 jam, configurable via `PANITIA_TOKEN_TTL_HOURS`.
- Pesan commit JANGAN sertakan footer `Co-Authored-By: Claude` (lihat memori proyek).
- File data antrian (`data.csv`, `*.sqlite`) JANGAN di-push ke GitHub (sudah di-gitignore).
- Gunakan `node --test` untuk menjalankan test (sudah ada di `package.json` script `test`).
- Test pakai DB terpisah (`test-auth-db.sqlite` / `test-routes-auth.sqlite`) agar tidak ganggu data nyata.
- Bahasa UI & komentar: Bahasa Indonesia (konsisten dengan codebase).
- Frontend tidak boleh break halaman publik (`index.html`, `info.html`) — GET read-only tetap publik.

---

## File Structure

**Baru:**
- `src/auth.js` — hashing bcrypt, sign/verify HMAC token, `requirePanitia` middleware, rate-limit login.
- `public/js/auth-panitia.js` — gating login client: `apiFetch()`, `isAuthed()`, `showLoginModal()`, modal ganti password. Dimuat sebelum `panitia.js`.
- `test/auth-db.test.js` — unit test tabel `panitia_auth` + accessors.
- `test/auth.test.js` — unit test hash, sign/verify token, middleware, rate-limit.
- `test/routes-panitia-auth.test.js` — integration test endpoint auth + proteksi aksi.

**Ubah:**
- `src/db.js` — tambah tabel `panitia_auth` + `getPanitiaAuth()` / `setPanitiaPassword()` / `initAuth()`.
- `src/routes.js` — import auth, tambah endpoint `/panitia/auth` & `/panitia/change-password`, pasang `requirePanitia` ke 6 endpoint aksi.
- `server.js` — panggil `initAuth()` saat boot; cek `AUTH_SECRET` wajib ada.
- `public/panitia.html` — bungkus dashboard `<div class="page" id="dash" hidden>`, tambah element modal login, tombol "Ganti Password", script `auth-panitia.js` sebelum `panitia.js`, keyframe shake.
- `public/js/panitia.js` — bungkus init ke `window.initPanitiaDashboard()`, pindahkan socket join + listener, ganti `fetch` aksi → `apiFetch`.
- `.env.example` — tambah `AUTH_SECRET`, `PANITIA_DEFAULT_PASSWORD`, `PANITIA_TOKEN_TTL_HOURS`.
- `package.json` — tambah dependency `bcryptjs`.

---

### Task 1: Tambah dependency bcryptjs

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: none
- Produces: `bcryptjs` tersedia untuk `import bcrypt from 'bcryptjs'` di task berikutnya.

- [ ] **Step 1: Install bcryptjs**

Run:
```bash
npm install bcryptjs
```
Expected: `added 1 package` — `bcryptjs` masuk `dependencies` di `package.json` dan `package-lock.json` terupdate.

- [ ] **Step 2: Verifikasi import jalan**

Run:
```bash
node -e "import('bcryptjs').then(b => { const h = b.default.hashSync('test',10); console.log(b.default.compareSync('test',h)); })"
```
Expected: cetak `true`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: tambah dependency bcryptjs untuk hash password panitia"
```

---

### Task 2: Tabel panitia_auth + DB accessors

**Files:**
- Modify: `src/db.js` (tambah tabel di `initDb()`; tambah import bcrypt di atas + 3 export function di akhir)
- Test: `test/auth-db.test.js` (buat baru)

**Interfaces:**
- Consumes: `Database` dari better-sqlite3 (sudah ada di `db.js`).
- Produces:
  - `getPanitiaAuth()` → `{ password_hash: string, token_version: number }` atau `null`.
  - `setPanitiaPassword(newHash)` → void; update baris id=1, `token_version = token_version + 1`, `updated_at = datetime('now')`.
  - `initAuth()` → void; bila `getPanitiaAuth()` null, hash `process.env.PANITIA_DEFAULT_PASSWORD || 'panitiaP@G2026'` pakai bcrypt cost 10, insert baris id=1.

- [ ] **Step 1: Write the failing test**

Buat `test/auth-db.test.js`:
```js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { initDb, closeDb, getPanitiaAuth, setPanitiaPassword, initAuth } from '../src/db.js';

const TEST_DB = './test-auth-db.sqlite';

beforeEach(() => {
  closeDb();
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    try { fs.unlinkSync(f); } catch {}
  }
  process.env.DB_PATH = TEST_DB;
  process.env.PANITIA_DEFAULT_PASSWORD = 'panitiaP@G2026';
  initDb();
});

afterEach(() => { closeDb(); });

test('initAuth men-seed password default bila tabel kosong', () => {
  initAuth();
  const row = getPanitiaAuth();
  assert.ok(row, 'baris panitia_auth harus ada setelah initAuth');
  assert.equal(row.token_version, 1);
  assert.ok(bcrypt.compareSync('panitiaP@G2026', row.password_hash));
});

test('initAuth idempoten — tidak menimpa password yang sudah ada', () => {
  initAuth();
  setPanitiaPassword(bcrypt.hashSync('manual123', 10));
  initAuth();
  const row = getPanitiaAuth();
  assert.ok(bcrypt.compareSync('manual123', row.password_hash));
});

test('setPanitiaPassword naikkan token_version', () => {
  initAuth();
  const v0 = getPanitiaAuth().token_version;
  setPanitiaPassword(bcrypt.hashSync('baru123', 10));
  const v1 = getPanitiaAuth().token_version;
  assert.equal(v1, v0 + 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/auth-db.test.js`
Expected: FAIL — `getPanitiaAuth is not a function` (export belum ada) atau tabel tidak ada.

- [ ] **Step 3: Tambah tabel di initDb()**

Di `src/db.js`, di dalam `initDb()`, setelah blok `CREATE TABLE IF NOT EXISTS settings (...)` dan `INSERT OR IGNORE INTO settings ...` (sekitar baris 64-69), tambah sebelum `CREATE INDEX`:
```js
    CREATE TABLE IF NOT EXISTS panitia_auth (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      token_version INTEGER NOT NULL DEFAULT 1,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
```

- [ ] **Step 4: Tambah import bcrypt + 3 export function di src/db.js**

Di paling atas file (baris 1, bersama import lain), tambah:
```js
import bcrypt from 'bcryptjs';
```
Tambah di akhir file (setelah `getStatistik`):
```js
// ===== Panitia auth (akun tunggal, id=1) =====
export function getPanitiaAuth() {
  return db.prepare('SELECT password_hash, token_version FROM panitia_auth WHERE id = 1').get() || null;
}

export function setPanitiaPassword(newHash) {
  db.prepare(`
    UPDATE panitia_auth
    SET password_hash = ?, token_version = token_version + 1, updated_at = datetime('now')
    WHERE id = 1
  `).run(newHash);
}

export function initAuth() {
  if (getPanitiaAuth()) return; // sudah ada, jangan timpa
  const plain = process.env.PANITIA_DEFAULT_PASSWORD || 'panitiaP@G2026';
  const hash = bcrypt.hashSync(plain, 10);
  db.prepare(`
    INSERT INTO panitia_auth (id, password_hash, token_version)
    VALUES (1, ?, 1)
  `).run(hash);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/auth-db.test.js`
Expected: PASS (3 test).

- [ ] **Step 6: Commit**

```bash
git add src/db.js test/auth-db.test.js
git commit -m "feat(db): tabel panitia_auth + accessor get/set/initAuth (bcrypt, akun tunggal)"
```

---

### Task 3: Modul auth.js — token HMAC + middleware

**Files:**
- Create: `src/auth.js`
- Test: `test/auth.test.js` (buat baru)

**Interfaces:**
- Consumes: `getPanitiaAuth()` dari `src/db.js` (Task 2).
- Produces:
  - `hashPassword(plain)` → string (bcrypt hash cost 10).
  - `comparePassword(plain, hash)` → boolean.
  - `signToken({ ver })` → string token.
  - `verifyToken(token)` → `{ ok: boolean, expired: boolean }`.
  - `requirePanitia` — Express middleware (req, res, next).
  - `loginRateLimit` — Express middleware (req, res, next).

- [ ] **Step 1: Write the failing test**

Buat `test/auth.test.js`:
```js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import express from 'express';
import { initDb, closeDb, initAuth, getPanitiaAuth, setPanitiaPassword } from '../src/db.js';
import { hashPassword, comparePassword, signToken, verifyToken, requirePanitia, loginRateLimit } from '../src/auth.js';

const TEST_DB = './test-auth-mod.sqlite';
let app, server, baseUrl;

function startServer() {
  return new Promise((resolve) => {
    app = express();
    app.use(express.json());
    app.get('/terproteksi', requirePanitia, (req, res) => res.json({ ok: true }));
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}
function stopServer() { return new Promise(r => server ? server.close(() => r()) : r()); }

beforeEach(async () => {
  process.env.AUTH_SECRET = 'test-secret-key';
  process.env.PANITIA_TOKEN_TTL_HOURS = '8';
  closeDb();
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) { try { fs.unlinkSync(f); } catch {} }
  process.env.DB_PATH = TEST_DB;
  process.env.PANITIA_DEFAULT_PASSWORD = 'panitiaP@G2026';
  initDb();
  initAuth();
  await startServer();
});
afterEach(async () => { await stopServer(); closeDb(); });

test('hashPassword/comparePassword roundtrip', () => {
  const h = hashPassword('rahasia');
  assert.ok(comparePassword('rahasia', h));
  assert.ok(!comparePassword('salah', h));
});

test('signToken menghasilkan token terverifikasi', () => {
  const ver = getPanitiaAuth().token_version;
  const t = signToken({ ver });
  assert.ok(verifyToken(t).ok);
});

test('verifyToken menolak token tampered', () => {
  const t = signToken({ ver: 1 });
  const tampered = t.slice(0, -2) + 'XX';
  assert.ok(!verifyToken(tampered).ok);
});

test('verifyToken menolak token version lama', () => {
  const t = signToken({ ver: getPanitiaAuth().token_version });
  setPanitiaPassword(hashPassword('baru123')); // naikkan version
  assert.ok(!verifyToken(t).ok);
});

test('requirePanitia menolak tanpa header (401)', async () => {
  const res = await fetch(`${baseUrl}/terproteksi`);
  assert.equal(res.status, 401);
});

test('requirePanitia menerima token valid (200)', async () => {
  const t = signToken({ ver: getPanitiaAuth().token_version });
  const res = await fetch(`${baseUrl}/terproteksi`, { headers: { Authorization: `Bearer ${t}` } });
  assert.equal(res.status, 200);
});

test('loginRateLimit blokir setelah 5 gagal berturut (429)', async () => {
  const a = express();
  a.use(express.json());
  a.post('/rl', loginRateLimit, (req, res) => res.json({ ok: true }));
  const s = a.listen(0, '127.0.0.1');
  const u = `http://127.0.0.1:${s.address().port}`;
  let last = 0;
  for (let i = 0; i < 6; i++) {
    last = (await fetch(`${u}/rl`, { method: 'POST', headers: { 'x-test-ip': '1.2.3.4' }, body: '{}' })).status;
  }
  s.close();
  assert.equal(last, 429);
});
```
Catatan: rate-limit test pakai header `x-test-ip` agar bisa simulasikan IP; middleware baca `req.ip || req.headers['x-test-ip']`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/auth.test.js`
Expected: FAIL — modul `src/auth.js` belum ada.

- [ ] **Step 3: Buat src/auth.js**

```js
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getPanitiaAuth } from './db.js';

const SECRET = process.env.AUTH_SECRET;
const TTL_HOURS = parseInt(process.env.PANITIA_TOKEN_TTL_HOURS || '8', 10);

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function comparePassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function b64urlDecode(str) { return Buffer.from(str, 'base64url'); }

export function signToken({ ver }) {
  const exp = Date.now() + TTL_HOURS * 3600 * 1000;
  const payload = JSON.stringify({ role: 'panitia', ver, exp });
  const payloadB64 = b64url(payload);
  const sig = crypto.createHmac('sha256', SECRET).update(payloadB64).digest();
  return `${payloadB64}.${b64url(sig)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return { ok: false, expired: false };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, expired: false };
  const [payloadB64, sigB64] = parts;
  const expectedSig = crypto.createHmac('sha256', SECRET).update(payloadB64).digest();
  const sigBuf = b64urlDecode(sigB64);
  if (expectedSig.length !== sigBuf.length || !crypto.timingSafeEqual(expectedSig, sigBuf)) {
    return { ok: false, expired: false };
  }
  let payload;
  try { payload = JSON.parse(b64urlDecode(payloadB64).toString()); }
  catch { return { ok: false, expired: false }; }
  if (payload.role !== 'panitia') return { ok: false, expired: false };
  if (payload.exp <= Date.now()) return { ok: false, expired: true };
  const auth = getPanitiaAuth();
  if (!auth || payload.ver !== auth.token_version) return { ok: false, expired: false };
  return { ok: true, expired: false };
}

export function requirePanitia(req, res, next) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/);
  if (!m) return res.status(401).json({ error: 'Token tidak valid atau sesi habis' });
  const result = verifyToken(m[1]);
  if (!result.ok) return res.status(401).json({ error: 'Token tidak valid atau sesi habis' });
  next();
}

// Rate-limit login: max 5 per 60 detik per IP. In-memory (single-process).
const attempts = new Map();
const WINDOW_MS = 60_000;
const MAX = 5;

export function loginRateLimit(req, res, next) {
  const ip = req.ip || req.headers['x-test-ip'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) {
    rec = { count: 0, first: now };
    attempts.set(ip, rec);
  }
  rec.count++;
  if (rec.count > MAX) {
    return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  }
  next();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/auth.test.js`
Expected: PASS (7 test).

- [ ] **Step 5: Commit**

```bash
git add src/auth.js test/auth.test.js
git commit -m "feat(auth): modul auth — token HMAC signed, requirePanitia middleware, rate-limit login"
```

---

### Task 4: Endpoint auth + pasang requirePanitia ke endpoint aksi

**Files:**
- Modify: `src/routes.js` (import auth + db accessors; tambah 2 endpoint; pasang middleware ke 6 route)
- Test: `test/routes-panitia-auth.test.js` (buat baru)

**Interfaces:**
- Consumes: `requirePanitia`, `comparePassword`, `hashPassword`, `signToken`, `loginRateLimit` dari `src/auth.js`; `getPanitiaAuth`, `setPanitiaPassword` dari `src/db.js`.
- Produces:
  - `POST /api/panitia/auth` body `{ password }` → 200 `{ token, expiresAt }` | 401 `{ error }` | 429.
  - `POST /api/panitia/change-password` (requirePanitia) body `{ currentPassword, newPassword }` → 200 `{ success }` | 400 | 401.
  - 6 endpoint aksi kini 401 tanpa token valid: `/sync/sheets`, `/sync/download`, `/antrian/panggil/:nomor`, `/antrian/panggil-ulang/:nomor`, `/antrian/selesai/:nomor`, `/settings/loket` (POST).

- [ ] **Step 1: Write the failing test**

Buat `test/routes-panitia-auth.test.js`. Test ini mensetup server dengan `createRouter()`, seed `initAuth()`, login untuk dapat `token`, lalu:
- Assert `POST /api/panitia/auth` 200 dengan token + expiresAt; password salah → 401.
- Assert `POST /antrian/panggil/:nomor` 401 tanpa token, 200 dengan token (ambil nomor dulu via `POST /antrian/ambil`).
- Assert `POST /settings/loket` 401 tanpa token, 200 dengan token.
- Assert `GET /antrian/daftar` & `POST /antrian/ambil` tetap publik (200 tanpa token).
- Assert `POST /api/panitia/change-password` sukses (200) dan token LAMA jadi 401 (invalidasi); currentPassword salah → 401; newPassword < 6 char → 400.

Template setup (ikuti pola `test/routes.test.js` yang sudah ada — pakai `node:test`, `express`, `createRouter()` tanpa io, DB `test-routes-auth.sqlite`, cleanup di `afterEach`):
```js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import express from 'express';
import { createRouter } from '../src/routes.js';
import { initDb, insertPeserta, initAuth, closeDb } from '../src/db.js';
import { signToken } from '../src/auth.js';

const TEST_DB = './test-routes-auth.sqlite';
let app, server, baseUrl, token;

function startServer() {
  return new Promise((resolve) => {
    app = express();
    app.use(express.json());
    app.use('/api', createRouter());
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}
function stopServer() { return new Promise(r => server ? server.close(() => r()) : r()); }

beforeEach(async () => {
  process.env.AUTH_SECRET = 'test-secret-key';
  process.env.PANITIA_TOKEN_TTL_HOURS = '8';
  closeDb();
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) { try { fs.unlinkSync(f); } catch {} }
  process.env.DB_PATH = TEST_DB;
  process.env.PANITIA_DEFAULT_PASSWORD = 'panitiaP@G2026';
  initDb();
  initAuth();
  insertPeserta('Andi Wijaya', 'Surabaya, 5 Mei 1990', '0013001', 2);
  await startServer();
  const login = await fetch(`${baseUrl}/api/panitia/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'panitiaP@G2026' }),
  });
  token = (await login.json()).token;
});
afterEach(async () => { await stopServer(); closeDb(); });
```
Lalu tambahkan test-test berikut:

```js
test('POST /api/panitia/auth sukses kembali token', async () => {
  const res = await fetch(`${baseUrl}/api/panitia/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'panitiaP@G2026' }),
  });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.ok(j.token);
  assert.ok(j.expiresAt);
});

test('POST /api/panitia/auth password salah → 401', async () => {
  const res = await fetch(`${baseUrl}/api/panitia/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'salah' }),
  });
  assert.equal(res.status, 401);
});

test('POST /antrian/panggil/:nomor tanpa token → 401', async () => {
  const ambil = await fetch(`${baseUrl}/api/antrian/ambil`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pesertaId: 1 }),
  });
  const nomor = (await ambil.json()).nomor_antrian;
  const res = await fetch(`${baseUrl}/api/antrian/panggil/${nomor}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ counter: 1 }),
  });
  assert.equal(res.status, 401);
});

test('POST /antrian/panggil/:nomor dengan token valid → 200', async () => {
  const ambil = await fetch(`${baseUrl}/api/antrian/ambil`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pesertaId: 1 }),
  });
  const nomor = (await ambil.json()).nomor_antrian;
  const res = await fetch(`${baseUrl}/api/antrian/panggil/${nomor}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ counter: 1 }),
  });
  assert.equal(res.status, 200);
});

test('POST /settings/loket tanpa token → 401', async () => {
  const res = await fetch(`${baseUrl}/api/settings/loket`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jumlah_loket: 5 }),
  });
  assert.equal(res.status, 401);
});

test('POST /settings/loket dengan token → 200', async () => {
  const res = await fetch(`${baseUrl}/api/settings/loket`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jumlah_loket: 5 }),
  });
  assert.equal(res.status, 200);
});

test('GET /antrian/daftar tetap publik (200 tanpa token)', async () => {
  const res = await fetch(`${baseUrl}/api/antrian/daftar?status=menunggu`);
  assert.equal(res.status, 200);
});

test('POST /antrian/ambil tetap publik (200 tanpa token)', async () => {
  const res = await fetch(`${baseUrl}/api/antrian/ambil`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pesertaId: 1 }),
  });
  assert.equal(res.status, 200);
});

test('change-password sukses & invalidasi token lama', async () => {
  const res = await fetch(`${baseUrl}/api/panitia/change-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword: 'panitiaP@G2026', newPassword: 'baru123456' }),
  });
  assert.equal(res.status, 200);
  const res2 = await fetch(`${baseUrl}/api/settings/loket`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jumlah_loket: 4 }),
  });
  assert.equal(res2.status, 401);
});

test('change-password currentPassword salah → 401', async () => {
  const res = await fetch(`${baseUrl}/api/panitia/change-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword: 'salah', newPassword: 'baru123456' }),
  });
  assert.equal(res.status, 401);
});

test('change-password newPassword < 6 char → 400', async () => {
  const res = await fetch(`${baseUrl}/api/panitia/change-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword: 'panitiaP@G2026', newPassword: '123' }),
  });
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/routes-panitia-auth.test.js`
Expected: FAIL — endpoint `/panitia/auth` belum ada (404), POST aksi tanpa token tidak 401.

- [ ] **Step 3: Modifikasi src/routes.js — import**

Di `src/routes.js` atas, gabungkan ke import `./db.js` yang sudah ada (tambah `getPanitiaAuth, setPanitiaPassword`) dan tambah import auth baru:
```js
import { requirePanitia, comparePassword, hashPassword, signToken, loginRateLimit } from './auth.js';
```
(Gabungkan `getPanitiaAuth, setPanitiaPassword` ke statement import `./db.js` yang sudah ada agar tidak duplikat.)

- [ ] **Step 4: Tambah endpoint auth**

Di `src/routes.js`, di dalam `createRouter(io)`, dekat awal (setelah `const router = Router();`), tambah:
```js
  // ===== Panitia auth =====
  router.post('/panitia/auth', loginRateLimit, (req, res) => {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Password wajib diisi' });
    const auth = getPanitiaAuth();
    if (!auth) return res.status(500).json({ error: 'Konfigurasi panitia belum siap' });
    if (!comparePassword(password, auth.password_hash)) {
      return res.status(401).json({ error: 'Password salah' });
    }
    const token = signToken({ ver: auth.token_version });
    const expiresAt = Date.now() + parseInt(process.env.PANITIA_TOKEN_TTL_HOURS || '8', 10) * 3600 * 1000;
    res.json({ token, expiresAt });
  });

  router.post('/panitia/change-password', requirePanitia, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
    }
    const auth = getPanitiaAuth();
    if (!comparePassword(currentPassword, auth.password_hash)) {
      return res.status(401).json({ error: 'Password saat ini salah' });
    }
    setPanitiaPassword(hashPassword(newPassword));
    res.json({ success: true });
  });
```

- [ ] **Step 5: Pasang requirePanitia ke 6 endpoint aksi**

Ganti tiap deklarasi route aksi dengan tambahkan `requirePanitia` sebagai middleware argumen kedua:
- `router.post('/sync/sheets', async (req, res) => {` → `router.post('/sync/sheets', requirePanitia, async (req, res) => {`
- `router.post('/sync/download', async (req, res) => {` → `router.post('/sync/download', requirePanitia, async (req, res) => {`
- `router.post('/antrian/panggil/:nomor', (req, res) => {` → `router.post('/antrian/panggil/:nomor', requirePanitia, (req, res) => {`
- `router.post('/antrian/panggil-ulang/:nomor', (req, res) => {` → `router.post('/antrian/panggil-ulang/:nomor', requirePanitia, (req, res) => {`
- `router.post('/antrian/selesai/:nomor', async (req, res) => {` → `router.post('/antrian/selesai/:nomor', requirePanitia, async (req, res) => {`
- `router.post('/settings/loket', (req, res) => {` → `router.post('/settings/loket', requirePanitia, (req, res) => {`

**PENTING:** JANGAN pasang ke `POST /antrian/ambil` (peserta umum) dan semua GET.

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test test/routes-panitia-auth.test.js`
Expected: PASS (11 test).

- [ ] **Step 7: Jalankan test suite lama untuk cek regresi**

Run: `node --test test/routes.test.js`
Expected: bila PASS → lanjut Step 8. Bila FAIL pada POST aksi → kerjakan Task 6 (suntik token).

- [ ] **Step 8: Commit**

```bash
git add src/routes.js test/routes-panitia-auth.test.js
git commit -m "feat(api): endpoint auth panitia + proteksi requirePanitia pada 6 endpoint aksi"
```

---

### Task 5: Boot server — initAuth + cek AUTH_SECRET

**Files:**
- Modify: `server.js`, `.env.example`

**Interfaces:**
- Consumes: `initAuth()` dari `src/db.js` (Task 2), `process.env.AUTH_SECRET`.
- Produces: server refuse start bila `AUTH_SECRET` kosong; tabel `panitia_auth` ter-seed saat first boot.

- [ ] **Step 1: Tambah cek AUTH_SECRET + initAuth di server.js**

Di `server.js`:
1. Gabungkan import: ubah `import { initDb } from './src/db.js';` menjadi `import { initDb, initAuth } from './src/db.js';`
2. Setelah `dotenv.config();` dan sebelum `initDb();` (atau setelahnya), tambah cek:
```js
// Wajib ada AUTH_SECRET untuk menandatangani token panitia.
if (!process.env.AUTH_SECRET) {
  console.error("FATAL: AUTH_SECRET belum di-set di .env. Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  process.exit(1);
}
```
3. Setelah `initDb();` tambah `initAuth();`.

- [ ] **Step 2: Update .env.example**

Di `.env.example`, tambah setelah `PORT=3000`:
```env

# --- Autentikasi panitia (modal password dashboard) ---
# Secret untuk menandatangani token HMAC. WAJIB di-set. Generate:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
AUTH_SECRET=
# Password default panitia saat first boot (dipakai sekali untuk seed DB).
# Setelah itu, ganti password via UI dashboard.
PANITIA_DEFAULT_PASSWORD=panitiaP@G2026
# Umur token panitia (jam). Default 8.
PANITIA_TOKEN_TTL_HOURS=8
```

- [ ] **Step 3: Verifikasi server jalan dengan AUTH_SECRET**

Run (PowerShell):
```powershell
$env:AUTH_SECRET = (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
node server.js
```
Expected: server start normal, log "Server berjalan". Cek `database.sqlite` — tabel `panitia_auth` berisi 1 baris. Matikan (Ctrl+C).

- [ ] **Step 4: Verifikasi server refuse tanpa AUTH_SECRET**

Run:
```bash
AUTH_SECRET="" node server.js
```
Expected: cetak `FATAL: AUTH_SECRET belum di-set...` lalu exit kode 1.

- [ ] **Step 5: Commit**

```bash
git add server.js .env.example
git commit -m "feat(server): cek AUTH_SECRET wajib + seed initAuth() saat boot"
```

---

### Task 6: Perbaiki test lama yang menyentuh endpoint aksi (jika regresi)

**Files:**
- Modify: `test/routes.test.js` (hanya bila Task 4 Step 7 menemukan kegagalan)

**Interfaces:**
- Consumes: `signToken` dari `src/auth.js`, `initAuth` + `getPanitiaAuth` dari `src/db.js`.
- Produces: `routes.test.js` lama lulus dengan token yang disuntikkan ke POST aksi.

- [ ] **Step 1: Periksa apakah routes.test.js gagal**

Run: `node --test test/routes.test.js`
Bila PASS semua → skip task ini (lanjut Task 7).
Bila FAIL pada POST ke endpoint aksi yang kini diproteksi → lanjut Step 2.

- [ ] **Step 2: Tambah setup auth di routes.test.js**

Di `test/routes.test.js`, import tambahan:
```js
import { initAuth, getPanitiaAuth } from '../src/db.js';
import { signToken } from '../src/auth.js';
```
Tambah variabel helper di top-level: `let panitiaToken;`
Di `beforeEach`, setelah `initDb();` tambah:
```js
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-key';
  process.env.PANITIA_TOKEN_TTL_HOURS = '8';
  process.env.PANITIA_DEFAULT_PASSWORD = 'panitiaP@G2026';
  initAuth();
  panitiaToken = signToken({ ver: getPanitiaAuth().token_version });
```
Pada setiap POST ke endpoint aksi yang diproteksi di test (`/antrian/panggil/:nomor`, `/antrian/selesai/:nomor`, `/settings/loket`, dll), tambah header `Authorization: `Bearer ${panitiaToken}` pada objek fetch.

- [ ] **Step 3: Run test to verify it passes**

Run: `node --test test/routes.test.js`
Expected: PASS semua.

- [ ] **Step 4: Commit**

```bash
git add test/routes.test.js
git commit -m "test: suntik token panitia pada test routes lama pasca-proteksi endpoint aksi"
```

---

### Task 7: Frontend gating — auth-panitia.js + modal login

**Files:**
- Create: `public/js/auth-panitia.js`
- Modify: `public/panitia.html` (tambah element modal + script tag + bungkus dashboard hidden + keyframe shake)

**Interfaces:**
- Consumes: `POST /api/panitia/auth`, `POST /api/panitia/change-password` (Task 4); `window.initPanitiaDashboard` dari `panitia.js` (Task 8).
- Produces (di-expose ke `window`):
  - `apiFetch(url, opts)` — fetch dengan header Authorization otomatis; 401 → bersihkan token + tampilkan modal login + toast.
  - `isAuthed()` — boolean.
  - `showLoginModal()` — render modal login ke overlay.
  - `showChangePasswordModal()` — render modal ganti password.

- [ ] **Step 1: Tambah element modal + bungkus dashboard di panitia.html**

Di `public/panitia.html`:
1. Ubah `<div class="page">` menjadi `<div class="page" id="dash" hidden>`. (Dashboard tersembunyi sampai login.)
2. Tambah overlay modal login tepat setelah pembuka `<body>` (sebelum `<div class="page"...>`), sehingga selalu di atas:
```html
<div id="auth-overlay" class="fixed inset-0 z-[2000] hidden items-center justify-center p-4 bg-black/60 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="auth-title"></div>
```
3. Tambah script **sebelum** `<script src="/js/panitia.js">`:
```html
<script src="/js/auth-panitia.js"></script>
```

- [ ] **Step 2: Tambah keyframe shake + style di panitia.html**

Di `<style>` block `panitia.html`, tambah:
```css
@keyframes auth-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-8px); }
  40% { transform: translateX(8px); }
  60% { transform: translateX(-6px); }
  80% { transform: translateX(6px); }
}
#auth-overlay input::placeholder { color: var(--paper-faint); }
#auth-overlay input:focus { border-color: var(--gold-line); }
```

- [ ] **Step 3: Buat public/js/auth-panitia.js — helper storage + apiFetch + isAuthed**

```js
// ============================================================
// Auth Panitia — gating akses dashboard panitia.
// Dimuat SEBELUM panitia.js. Mengekspos: apiFetch, isAuthed,
// showLoginModal, showChangePasswordModal. Memanggil
// window.initPanitiaDashboard() setelah login sukses.
// ============================================================

const TOKEN_KEY = 'panitia_token';
const EXP_KEY = 'panitia_token_exp';

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function getExp() { return parseInt(localStorage.getItem(EXP_KEY) || '0', 10); }
function setToken(token, expiresAt) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EXP_KEY, String(expiresAt));
}
function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXP_KEY);
}

function isAuthed() {
  const t = getToken();
  if (!t) return false;
  return getExp() > Date.now();
}
window.isAuthed = isAuthed;

// fetch wrapper: otomatis tambah Authorization. 401 → bersihkan + modal login.
async function apiFetch(url, opts = {}) {
  const t = getToken();
  const headers = { ...(opts.headers || {}) };
  if (t) headers['Authorization'] = `Bearer ${t}`;
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) {
    clearToken();
    showLoginModal();
    if (window.showToast) window.showToast('Sesi habis, silakan login ulang', 'warning');
    throw new Error('Unauthorized');
  }
  return res;
}
window.apiFetch = apiFetch;
```

- [ ] **Step 4: Tambah fungsi modal login (lanjutan auth-panitia.js)**

```js
// ===== Modal login =====
function showLoginModal() {
  document.getElementById('dash')?.setAttribute('hidden', '');
  const ov = document.getElementById('auth-overlay');
  ov.classList.remove('hidden');
  ov.classList.add('flex');
  ov.innerHTML = `
    <div class="auth-card" style="transform:scale(0.96);opacity:0;transition:all .3s ease-out;max-width:420px;width:100%;background:var(--card);border:1px solid var(--card-border-strong);border-radius:24px;box-shadow:var(--shadow-hero);padding:40px 36px;">
      <div style="display:flex;justify-content:center;gap:18px;margin-bottom:24px;">
        <img src="logo-radenfatah.png" alt="Logo UIN Raden Fatah Palembang" width="56" height="56" style="border-radius:14px;box-shadow:0 8px 24px -8px rgba(0,0,0,.6);">
        <img src="ppg.png" alt="Logo PPG" width="56" height="56" style="border-radius:14px;box-shadow:0 8px 24px -8px rgba(0,0,0,.6);object-fit:contain;background:rgba(255,255,255,.04);">
      </div>
      <div style="text-align:center;">
        <div style="color:var(--gold);font-size:.8rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px;">Dashboard Panitia</div>
        <h2 id="auth-title" style="color:var(--paper);font-family:var(--font-display);font-size:1.6rem;font-weight:800;margin:0 0 6px;">Akses Terkunci</h2>
        <div style="width:60px;height:3px;background:var(--gold);border-radius:2px;margin:12px auto 22px;"></div>
        <p style="color:var(--paper-dim);font-size:.9rem;margin:0 0 24px;">Masukkan password panitia untuk melanjutkan.</p>
      </div>
      <form id="auth-form" style="display:flex;flex-direction:column;gap:14px;">
        <div style="position:relative;">
          <svg style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--paper-mute);" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <input id="auth-password" type="password" placeholder="Password panitia" autocomplete="current-password"
            style="width:100%;padding:13px 44px 13px 42px;background:rgba(255,255,255,.05);border:1px solid var(--card-border-strong);border-radius:12px;color:var(--paper);font-size:.95rem;outline:none;">
          <button type="button" id="auth-toggle-eye" aria-label="Lihat password" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--paper-mute);cursor:pointer;padding:6px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
        <p id="auth-error" style="color:var(--rose);font-size:.82rem;margin:0;min-height:1em;text-align:center;"></p>
        <button type="submit" id="auth-submit"
          style="padding:13px;border:none;border-radius:12px;background:linear-gradient(135deg,var(--gold),var(--gold-bright));color:#1a1206;font-weight:700;font-size:.95rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 8px 24px -8px var(--gold-glow);">
          Buka Dashboard
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      </form>
      <div style="text-align:center;margin-top:22px;color:var(--paper-faint);font-size:.75rem;">PPG UIN Raden Fatah Palembang</div>
    </div>
  `;
  const card = ov.querySelector('.auth-card');
  requestAnimationFrame(() => { card.style.transform = 'scale(1)'; card.style.opacity = '1'; });
  const pwInput = ov.querySelector('#auth-password');
  const errEl = ov.querySelector('#auth-error');
  pwInput.focus();

  ov.querySelector('#auth-toggle-eye').addEventListener('click', () => {
    pwInput.type = pwInput.type === 'password' ? 'text' : 'password';
  });

  function shake() {
    card.style.animation = 'none';
    void card.offsetWidth;
    card.style.animation = 'auth-shake .4s';
  }

  ov.querySelector('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    const btn = ov.querySelector('#auth-submit');
    btn.disabled = true; btn.style.opacity = '.7';
    try {
      const res = await fetch('/api/panitia/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwInput.value }),
      });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || 'Password salah'; shake(); pwInput.select(); return; }
      setToken(data.token, data.expiresAt);
      closeAuthModal();
      window.initPanitiaDashboard();
    } catch (err) {
      errEl.textContent = 'Koneksi bermasalah';
    } finally {
      btn.disabled = false; btn.style.opacity = '1';
    }
  });
}
window.showLoginModal = showLoginModal;

function closeAuthModal() {
  const ov = document.getElementById('auth-overlay');
  ov.classList.add('hidden');
  ov.classList.remove('flex');
  ov.innerHTML = '';
  document.getElementById('dash')?.removeAttribute('hidden');
}
```

- [ ] **Step 5: Tambah modal ganti password + init gate (lanjutan auth-panitia.js)**

```js
// ===== Modal ganti password =====
function showChangePasswordModal() {
  const ov = document.getElementById('auth-overlay');
  ov.classList.remove('hidden'); ov.classList.add('flex');
  ov.innerHTML = `
    <div class="auth-card" style="max-width:420px;width:100%;background:var(--card);border:1px solid var(--card-border-strong);border-radius:24px;box-shadow:var(--shadow-hero);padding:40px 36px;">
      <h2 style="color:var(--paper);font-family:var(--font-display);font-size:1.4rem;font-weight:800;margin:0 0 20px;text-align:center;">Ganti Password</h2>
      <form id="cp-form" style="display:flex;flex-direction:column;gap:14px;">
        <input id="cp-current" type="password" placeholder="Password saat ini" autocomplete="current-password"
          style="padding:13px 14px;background:rgba(255,255,255,.05);border:1px solid var(--card-border-strong);border-radius:12px;color:var(--paper);outline:none;">
        <input id="cp-new" type="password" placeholder="Password baru (min 6 karakter)" autocomplete="new-password"
          style="padding:13px 14px;background:rgba(255,255,255,.05);border:1px solid var(--card-border-strong);border-radius:12px;color:var(--paper);outline:none;">
        <input id="cp-confirm" type="password" placeholder="Ulangi password baru" autocomplete="new-password"
          style="padding:13px 14px;background:rgba(255,255,255,.05);border:1px solid var(--card-border-strong);border-radius:12px;color:var(--paper);outline:none;">
        <p id="cp-error" style="color:var(--rose);font-size:.82rem;margin:0;min-height:1em;text-align:center;"></p>
        <div style="display:flex;gap:12px;">
          <button type="button" id="cp-cancel" style="flex:1;padding:13px;border:1px solid var(--card-border-strong);border-radius:12px;background:transparent;color:var(--paper-dim);font-weight:600;cursor:pointer;">Batal</button>
          <button type="submit" style="flex:1;padding:13px;border:none;border-radius:12px;background:linear-gradient(135deg,var(--gold),var(--gold-bright));color:#1a1206;font-weight:700;cursor:pointer;">Simpan</button>
        </div>
      </form>
      <p style="text-align:center;margin-top:16px;color:var(--paper-faint);font-size:.78rem;">Setelah ganti, Anda akan diminta login ulang.</p>
    </div>
  `;
  ov.querySelector('#cp-current').focus();
  ov.querySelector('#cp-cancel').addEventListener('click', closeAuthModal);
  ov.querySelector('#cp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cur = ov.querySelector('#cp-current').value;
    const nw = ov.querySelector('#cp-new').value;
    const cf = ov.querySelector('#cp-confirm').value;
    const errEl = ov.querySelector('#cp-error');
    errEl.textContent = '';
    if (nw !== cf) { errEl.textContent = 'Konfirmasi password tidak cocok'; return; }
    if (nw.length < 6) { errEl.textContent = 'Password baru minimal 6 karakter'; return; }
    try {
      const res = await apiFetch('/api/panitia/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: cur, newPassword: nw }),
      });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || 'Gagal'; return; }
      closeAuthModal();
      clearToken();
      if (window.showToast) window.showToast('Password diubah, silakan login ulang', 'success');
      showLoginModal();
    } catch (err) { errEl.textContent = 'Koneksi bermasalah'; }
  });
}
window.showChangePasswordModal = showChangePasswordModal;

// ===== Init: gate dashboard =====
(function initAuthGate() {
  if (isAuthed()) {
    window.initPanitiaDashboard();
  } else {
    clearToken();
    showLoginModal();
  }
})();
```

- [ ] **Step 6: Smoke test manual**

Start server (pastikan `AUTH_SECRET` di-set di `.env` atau env), buka `http://localhost:3000/panitia`. Expected: modal "Akses Terkunci" tampil dengan dua logo (UIN + PPG), dashboard tersembunyi. Masukkan password default (`panitiaP@G2026`) → modal tutup, dashboard tampil. Refresh → tetap masuk (token localStorage). Buka DevTools → Application → Local Storage → hapus `panitia_token` → refresh → modal muncul lagi.

- [ ] **Step 7: Commit**

```bash
git add public/js/auth-panitia.js public/panitia.html
git commit -m "feat(panitia): modal login elegan (logo UIN+PPG) + gating dashboard sebelum auth"
```

---

### Task 8: Refactor panitia.js — initPanitiaDashboard + apiFetch

**Files:**
- Modify: `public/js/panitia.js`, `public/panitia.html` (tambah tombol "Ganti Password")

**Interfaces:**
- Consumes: `window.apiFetch`, `window.showChangePasswordModal` dari `auth-panitia.js` (Task 7).
- Produces: `window.initPanitiaDashboard()` — dipanggil auth-panitia.js setelah login (atau saat sudah authed).

- [ ] **Step 1: Pindahkan socket creation + join + listener ke dalam initPanitiaDashboard**

Di `public/js/panitia.js`:
1. Hapus baris top-level (baris 1-2):
```js
const socket = io();
socket.emit('panitia:join');
```
Ganti dengan deklarasi kosong di top-level:
```js
let socket;
```
2. Pindahkan **seluruh blok listener socket** (baris ~424-450: `socket.on('antrian:baru', ...)`, `'statistik:update'`, `'antrian:selesai'`, `'antrian:panggil'`, `'settings:loket'`) ke dalam `initPanitiaDashboard` (lihat Step 2) — tepat setelah `socket = io(); socket.emit('panitia:join');`. Alasan: `socket` `undefined` sampai login; listener harus aktif hanya setelah auth.

- [ ] **Step 2: Bungkus DOMContentLoaded callback ke initPanitiaDashboard**

Ganti `document.addEventListener('DOMContentLoaded', () => { ... });` menjadi:
```js
window.initPanitiaDashboard = function initPanitiaDashboard() {
  // Inisialisasi socket setelah login (jangan join sebelum auth)
  socket = io();
  socket.emit('panitia:join');

  // Socket listeners (dipindah dari top-level)
  socket.on('antrian:baru', () => { loadDaftar(currentFilter); loadStatistik(); });
  socket.on('statistik:update', () => { loadStatistik(); loadDaftar(currentFilter); });
  socket.on('antrian:selesai', () => { loadDaftar(currentFilter); loadStatistik(); });
  socket.on('antrian:panggil', () => { loadDaftar(currentFilter); loadStatistik(); });
  socket.on('settings:loket', (data) => {
    jumlahLoket = data.jumlah_loket;
    document.getElementById('input-jumlah-loket').value = jumlahLoket;
    renderLoketDropdown();
  });

  // Data loads (dari DOMContentLoaded lama)
  loadMyLoket();
  loadLoketSettings();
  loadStatistik();
  loadDaftar('menunggu');

  setInterval(() => { loadDaftar(currentFilter); }, 30000);

  // ... (pindahkan SEMUA listener & logika lain dari callback lama apa adanya) ...
};
```
**PENTING:** Pindahkan seluruh isi callback `DOMContentLoaded` lama persis seperti aslinya (input-cari-antrian, select-loket, btn-settings, btn-simpan-loket, btn-sync, dll). Jangan potong logika sync sukses yang sudah ada di blok `btn-sync`.

- [ ] **Step 3: Ganti semua fetch aksi panitia → apiFetch**

Cari setiap `fetch(` yang memanggil endpoint aksi panitia (POST), ganti dengan `apiFetch(`:
- `fetch('/api/settings/loket', { method: 'POST', ... })` (btn-simpan-loket) → `apiFetch(...)`.
- `fetch('/api/sync/download', { method: 'POST' })` (btn-sync) → `apiFetch(...)`.
- `fetch(\`/api/antrian/panggil-ulang/${nomor}\`, { method: 'POST' })` → `apiFetch(...)`.
- `fetch(\`/api/antrian/panggil/${nomor}\`, { ... })` → `apiFetch(...)`.
- `fetch(\`/api/antrian/selesai/${nomor}\`, { method: 'POST' })` → `apiFetch(...)`.
- Bila ada `fetch('/api/sync/sheets', ...)` → `apiFetch(...)`.

**JANGAN ganti** fetch GET read-only (`/api/settings/loket` GET, `/api/statistik`, `/api/antrian/daftar`, `/api/tts`) — biarkan `fetch` (atau boleh `apiFetch`, aman karena hanya tambah header).

- [ ] **Step 4: Tambah tombol "Ganti Password" di panel settings panitia.html**

Di `public/panitia.html`, di dalam panel settings (dekat `btn-simpan-loket` / `btn-sync`), tambah:
```html
<button id="btn-change-password" type="button">Ganti Password</button>
```
(Beri styling konsisten dengan tombol lain di panel — ikuti class/komponen yang sudah ada.)
Lalu di `initPanitiaDashboard` (panitia.js), tambah listener:
```js
  const btnCP = document.getElementById('btn-change-password');
  if (btnCP) btnCP.addEventListener('click', () => window.showChangePasswordModal());
```

- [ ] **Step 5: Smoke test end-to-end**

Start server, buka `/panitia`:
1. Modal login tampil. Password salah → shake + pesan.
2. Password benar → dashboard tampil, data antrian termuat, socket connect (cek DevTools Network: ws terhubung).
3. Klik panggil/selesai/panggil-ulang → aksi jalan (token terkirim via apiFetch — cek header Authorization di Network).
4. Klik "Ganti Password" → modal ganti password → isi benar → login ulang diminta.
5. Hapus token di DevTools → refresh → modal login muncul.
6. Buka `http://localhost:3000/info` dan `http://localhost:3000/` → **tetap jalan normal** (GET publik tidak terpengaruh).

- [ ] **Step 6: Commit**

```bash
git add public/js/panitia.js public/panitia.html
git commit -m "feat(panitia): gating initPanitiaDashboard + apiFetch pada aksi panitia"
```

---

### Task 9: Verifikasi penuh & dokumen

**Files:**
- Modify: `README.md` (opsional)

- [ ] **Step 1: Jalankan seluruh test suite**

Run: `npm test`
Expected: semua test lulus (auth-db, auth, routes-panitia-auth, routes, db, backup-db, sheets).

- [ ] **Step 2: Verifikasi halaman publik tidak rusak**

Buka `http://localhost:3000/` (index), `http://localhost:3000/info`, `http://localhost:3000/data`:
- Index: pencarian peserta & ambil nomor antrian jalan (POST `/antrian/ambil` publik).
- Info: layar antrian jalan (GET `/info-antrian`, `/statistik` publik).
- Data: jalan bila perlu (GET `/peserta/all` publik).

- [ ] **Step 3: Update README.md (opsional)**

Tambah di README bagian setup:
```md
## Autentikasi Panitia

Dashboard `/panitia` diproteksi password. Set `.env`:
- `AUTH_SECRET` — secret untuk token (wajib). Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `PANITIA_DEFAULT_PASSWORD` — password default saat first boot (default: `panitiaP@G2026`). Setelah itu ganti via UI.

Ganti password kapan saja via tombol "Ganti Password" di panel settings dashboard.
```

- [ ] **Step 4: Commit final (bila README diubah)**

```bash
git add README.md
git commit -m "docs: catat autentikasi panitia (AUTH_SECRET, password default, ganti password)"
```
(Bila README tidak diubah, skip.)

---

## Self-Review Checklist (jalankan setelah semua task selesai)

- [ ] Semua endpoint aksi panitia 401 tanpa token (verifikasi via test).
- [ ] GET read-only + `/antrian/ambil` tetap publik (verifikasi via test + manual info.html).
- [ ] Modal login tampil otomatis saat belum auth; dashboard hidden.
- [ ] Token disimpan di localStorage; refresh tetap masuk sampai expiry 8 jam.
- [ ] Ganti password → token lama invalid → modal login muncul lagi.
- [ ] `AUTH_SECRET` kosong → server refuse start.
- [ ] Tidak ada footer `Co-Authored-By` di commit.
