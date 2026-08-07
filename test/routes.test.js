import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { unlinkSync, existsSync } from 'node:fs';

import { createRouter } from '../src/routes.js';
import { initDb, insertPeserta, closeDb, initAuth, getPanitiaAuth } from '../src/db.js';
import { signToken } from '../src/auth.js';

const TEST_DB = './test-routes.sqlite';

let app;
let server;
let baseUrl;
let panitiaToken;

function startServer() {
  return new Promise((resolve) => {
    app = express();
    app.use(express.json());
    app.use('/api', createRouter()); // io is undefined — verifies guarded emits
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (server) server.close(() => resolve());
    else resolve();
  });
}

beforeEach(async () => {
  process.env.DB_PATH = TEST_DB;
  initDb();
  // Setup auth untuk endpoint aksi yang diproteksi requirePanitia
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-key';
  process.env.PANITIA_TOKEN_TTL_HOURS = '8';
  process.env.PANITIA_DEFAULT_PASSWORD = 'panitiaP@G2026';
  initAuth();
  panitiaToken = signToken({ ver: getPanitiaAuth().token_version });
  insertPeserta('Andi Wijaya', 'Surabaya, 5 Mei 1990', '0013001', 2);
  insertPeserta('Andi Saputra', 'Malang, 6 Juni 1991', '0013002', 3);
  insertPeserta('Budi Santoso', 'Jakarta, 1 Januari 1992', '0013003', 4);
  await startServer();
});

afterEach(async () => {
  await stopServer();
  closeDb();
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  if (existsSync(TEST_DB + '-wal')) unlinkSync(TEST_DB + '-wal');
  if (existsSync(TEST_DB + '-shm')) unlinkSync(TEST_DB + '-shm');
});

test('createRouter adalah function', () => {
  assert.equal(typeof createRouter, 'function');
});

test('GET /api/peserta/cari?q=andi returns 200 + JSON array with matches', async () => {
  const res = await fetch(`${baseUrl}/api/peserta/cari?q=andi`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data));
  assert.equal(data.length, 2);
  const names = data.map((p) => p.nama_lengkap);
  assert.ok(names.includes('Andi Wijaya'));
  assert.ok(names.includes('Andi Saputra'));
});

test('GET /api/peserta/cari with q < 2 chars returns []', async () => {
  const res = await fetch(`${baseUrl}/api/peserta/cari?q=a`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data, []);
});

test('GET /api/peserta/cari without q returns []', async () => {
  const res = await fetch(`${baseUrl}/api/peserta/cari`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data, []);
});

test('POST /api/antrian/ambil with valid pesertaId returns nomor_antrian', async () => {
  // First find a peserta
  const cari = await fetch(`${baseUrl}/api/peserta/cari?q=Andi Wijaya`);
  const pesertaList = await cari.json();
  const peserta = pesertaList[0];

  const res = await fetch(`${baseUrl}/api/antrian/ambil`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pesertaId: peserta.id }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(typeof data.nomor_antrian, 'number');
  assert.equal(data.status, 'menunggu');
});

test('POST /api/antrian/ambil for same peserta twice returns 400', async () => {
  const cari = await fetch(`${baseUrl}/api/peserta/cari?q=Budi`);
  const pesertaList = await cari.json();
  const peserta = pesertaList[0];

  const first = await fetch(`${baseUrl}/api/antrian/ambil`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pesertaId: peserta.id }),
  });
  assert.equal(first.status, 200);

  const second = await fetch(`${baseUrl}/api/antrian/ambil`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pesertaId: peserta.id }),
  });
  assert.equal(second.status, 400);
  const err = await second.json();
  assert.ok(err.error);
});

test('POST /api/antrian/ambil without pesertaId returns 400', async () => {
  const res = await fetch(`${baseUrl}/api/antrian/ambil`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test('GET /api/statistik returns the 5 counters', async () => {
  const res = await fetch(`${baseUrl}/api/statistik`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(typeof data.total, 'number');
  assert.equal(typeof data.belum, 'number');
  assert.equal(typeof data.menunggu, 'number');
  assert.equal(typeof data.dipanggil, 'number');
  assert.equal(typeof data.selesai, 'number');
  // Initial state: 3 peserta, all 'belum'
  assert.equal(data.belum, 3);
  assert.equal(data.total, 0);
});

test('POST /api/antrian/selesai/:nomor returns success even when Sheets sync fails', async () => {
  // Take a number first
  const cari = await fetch(`${baseUrl}/api/peserta/cari?q=Andi Wijaya`);
  const peserta = (await cari.json())[0];
  const ambil = await fetch(`${baseUrl}/api/antrian/ambil`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pesertaId: peserta.id }),
  });
  const { nomor_antrian } = await ambil.json();

  // Mark selesai — Sheets sync will fail (no credentials) but route must still succeed
  const res = await fetch(`${baseUrl}/api/antrian/selesai/${nomor_antrian}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${panitiaToken}` },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
});

// === Tests untuk fitur loket (counter) ===

test('GET /api/settings/loket returns 200 dengan jumlah_loket default 3', async () => {
  const res = await fetch(`${baseUrl}/api/settings/loket`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.jumlah_loket, 3);
});

test('POST /api/settings/loket dengan valid value persists', async () => {
  const res = await fetch(`${baseUrl}/api/settings/loket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${panitiaToken}` },
    body: JSON.stringify({ jumlah_loket: 5 }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.jumlah_loket, 5);

  // Verify persisted
  const get = await fetch(`${baseUrl}/api/settings/loket`);
  const getData = await get.json();
  assert.equal(getData.jumlah_loket, 5);
});

test('POST /api/settings/loket dengan invalid value returns 400', async () => {
  const res = await fetch(`${baseUrl}/api/settings/loket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${panitiaToken}` },
    body: JSON.stringify({ jumlah_loket: 0 }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/antrian/panggil/:nomor dengan counter valid returns 200 dan set counter', async () => {
  // Ambil nomor dulu
  const cari = await fetch(`${baseUrl}/api/peserta/cari?q=Andi Wijaya`);
  const peserta = (await cari.json())[0];
  const ambil = await fetch(`${baseUrl}/api/antrian/ambil`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pesertaId: peserta.id }),
  });
  const { nomor_antrian } = await ambil.json();

  // Panggil dengan counter 2
  const res = await fetch(`${baseUrl}/api/antrian/panggil/${nomor_antrian}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${panitiaToken}` },
    body: JSON.stringify({ counter: 2 }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.counter, 2);

  // Verify counter tersimpan — cek via daftar dipanggil
  const daftar = await fetch(`${baseUrl}/api/antrian/daftar?status=dipanggil`);
  const daftarData = await daftar.json();
  const row = daftarData.find((d) => d.nomor_antrian === nomor_antrian);
  assert.ok(row);
  assert.equal(row.counter, 2);
});

test('POST /api/antrian/panggil/:nomor dengan counter di atas jumlah_loket returns 400', async () => {
  const cari = await fetch(`${baseUrl}/api/peserta/cari?q=Andi Saputra`);
  const peserta = (await cari.json())[0];
  const ambil = await fetch(`${baseUrl}/api/antrian/ambil`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pesertaId: peserta.id }),
  });
  const { nomor_antrian } = await ambil.json();

  // counter 99 jauh di atas default jumlah_loket=3
  const res = await fetch(`${baseUrl}/api/antrian/panggil/${nomor_antrian}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${panitiaToken}` },
    body: JSON.stringify({ counter: 99 }),
  });
  assert.equal(res.status, 400);
});

test('POST /api/antrian/panggil/:nomor tanpa body returns 200 dengan counter null (legacy)', async () => {
  const cari = await fetch(`${baseUrl}/api/peserta/cari?q=Budi Santoso`);
  const peserta = (await cari.json())[0];
  const ambil = await fetch(`${baseUrl}/api/antrian/ambil`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pesertaId: peserta.id }),
  });
  const { nomor_antrian } = await ambil.json();

  // Panggil tanpa body (legacy)
  const res = await fetch(`${baseUrl}/api/antrian/panggil/${nomor_antrian}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${panitiaToken}` },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.counter, null);
});

test('GET /api/peserta/cari?q=<no_seri> return hasil berdasarkan no seri', async () => {
  const res = await fetch(`${baseUrl}/api/peserta/cari?q=0013001`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data));
  assert.equal(data.length, 1);
  assert.equal(data[0].nama_lengkap, 'Andi Wijaya');
  assert.equal(data[0].no_seri, '0013001');
});

test('GET /api/peserta/cari?q=<prefix seri> return semua peserta dengan prefix itu', async () => {
  const res = await fetch(`${baseUrl}/api/peserta/cari?q=0013`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data));
  assert.ok(data.length >= 2);
  const names = data.map(p => p.nama_lengkap);
  assert.ok(names.includes('Andi Wijaya'));
  assert.ok(names.includes('Andi Saputra'));
});

test('GET /api/peserta/cari?q=<substring seri tengah> return peserta yang no_seri-nya memuat substring itu', async () => {
  // '13' muncul di tengah '0013001','0013002','0013003' — bukan prefix, bukan akhir
  const res = await fetch(`${baseUrl}/api/peserta/cari?q=13`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data));
  assert.ok(data.length >= 3);
  const names = data.map(p => p.nama_lengkap);
  assert.ok(names.includes('Andi Wijaya'));
  assert.ok(names.includes('Andi Saputra'));
  assert.ok(names.includes('Budi Santoso'));
});
