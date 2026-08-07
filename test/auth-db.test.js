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
