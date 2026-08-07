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
  await res.text(); // drain body so the connection closes
});

test('requirePanitia menerima token valid (200)', async () => {
  const t = signToken({ ver: getPanitiaAuth().token_version });
  const res = await fetch(`${baseUrl}/terproteksi`, { headers: { Authorization: `Bearer ${t}` } });
  assert.equal(res.status, 200);
  await res.text(); // drain body so the connection closes
});

test('loginRateLimit blokir setelah 5 gagal berturut (429)', async () => {
  const a = express();
  a.use(express.json());
  a.post('/rl', loginRateLimit, (req, res) => res.json({ ok: true }));
  const s = a.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const u = `http://127.0.0.1:${s.address().port}`;
  let last = 0;
  try {
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${u}/rl`, { method: 'POST', headers: { 'x-test-ip': '1.2.3.4' }, body: '{}' });
      last = res.status;
      await res.text(); // drain body so the connection closes
    }
    assert.equal(last, 429);
  } finally {
    await new Promise(r => s.close(() => r()));
  }
});
