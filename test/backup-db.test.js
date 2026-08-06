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
