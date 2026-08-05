import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import { unlinkSync, existsSync } from 'node:fs';

import { createRouter } from '../src/routes.js';
import { initDb, insertPeserta, closeDb } from '../src/db.js';

const TEST_DB = './test-routes.sqlite';

let app;
let server;
let baseUrl;

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

test('GET /api/peserta/cari?nama=andi returns 200 + JSON array with matches', async () => {
  const res = await fetch(`${baseUrl}/api/peserta/cari?nama=andi`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data));
  assert.equal(data.length, 2);
  const names = data.map((p) => p.nama_lengkap);
  assert.ok(names.includes('Andi Wijaya'));
  assert.ok(names.includes('Andi Saputra'));
});

test('GET /api/peserta/cari with nama < 2 chars returns []', async () => {
  const res = await fetch(`${baseUrl}/api/peserta/cari?nama=a`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data, []);
});

test('GET /api/peserta/cari without nama returns []', async () => {
  const res = await fetch(`${baseUrl}/api/peserta/cari`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data, []);
});

test('POST /api/antrian/ambil with valid pesertaId returns nomor_antrian', async () => {
  // First find a peserta
  const cari = await fetch(`${baseUrl}/api/peserta/cari?nama=Andi Wijaya`);
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
  const cari = await fetch(`${baseUrl}/api/peserta/cari?nama=Budi`);
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
  const cari = await fetch(`${baseUrl}/api/peserta/cari?nama=Andi Wijaya`);
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
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
});
