import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import express from 'express';
import { createRouter } from '../src/routes.js';
import { initDb, insertPeserta, initAuth, closeDb } from '../src/db.js';
import { signToken } from '../src/auth.js';

const TEST_DB = './test-routes-auth.sqlite';
let app, server, baseUrl, token;

// Counter unik per-test untuk X-Forwarded-For. loginRateLimit di auth.js memakai
// Map module-level keyed by IP; semua test login dari 127.0.0.1 yang sama, jadi
// tanpa trust proxy + X-Forwarded-For unik, login ke-6 dst kena 429. Header
// ini memberi tiap test bucket rate-limit sendiri tanpa menyentuh auth.js.
let testCounter = 0;
function fwdIp() { return `10.0.0.${(++testCounter) % 250 + 1}`; }

function startServer() {
  return new Promise((resolve) => {
    app = express();
    // trust proxy supaya req.ip memakai nilai X-Forwarded-For (test hygiene:
    // tiap test login dapat bucket rate-limit terpisah, lihat fwdIp()).
    app.set('trust proxy', true);
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
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': fwdIp() },
    body: JSON.stringify({ password: 'panitiaP@G2026' }),
  });
  token = (await login.json()).token;
});

afterEach(async () => { await stopServer(); closeDb(); });

test('POST /api/panitia/auth sukses kembali token', async () => {
  const res = await fetch(`${baseUrl}/api/panitia/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': fwdIp() },
    body: JSON.stringify({ password: 'panitiaP@G2026' }),
  });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.ok(j.token);
  assert.ok(j.expiresAt);
});

test('POST /api/panitia/auth password salah → 401', async () => {
  const res = await fetch(`${baseUrl}/api/panitia/auth`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': fwdIp() },
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
