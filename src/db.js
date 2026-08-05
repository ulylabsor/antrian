import Database from 'better-sqlite3';
import path from 'path';

let db;

export function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}

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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT OR IGNORE INTO settings (key, value) VALUES ('jumlah_loket', '3');

    CREATE INDEX IF NOT EXISTS idx_peserta_status ON peserta(status);
    CREATE INDEX IF NOT EXISTS idx_peserta_nomor ON peserta(nomor_antrian);
  `);

  // Guarded migration — ALTER tidak idempoten, cek dulu kolom counter ada atau belum
  const cols = db.prepare(`PRAGMA table_info(peserta)`).all();
  if (!cols.some(c => c.name === 'counter')) {
    db.exec(`ALTER TABLE peserta ADD COLUMN counter INTEGER`);
  }
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
    SELECT nomor_antrian, nama_lengkap, no_seri, status, waktu_daftar, counter
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

export function setCounter(nomor, counter) {
  db.prepare('UPDATE peserta SET counter = ? WHERE nomor_antrian = ?').run(counter, nomor);
}

export function getJumlahLoket() {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'jumlah_loket'`).get();
  const n = parseInt(row?.value, 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

export function getAllPeserta() {
  const stmt = db.prepare(`
    SELECT id, nama_lengkap, tempat_tanggal_lahir, no_seri, nomor_antrian,
           status, waktu_daftar, waktu_selesai, counter
    FROM peserta
    ORDER BY
      CASE WHEN nomor_antrian IS NOT NULL THEN 0 ELSE 1 END,
      nomor_antrian ASC
  `);
  return stmt.all();
}

export function setJumlahLoket(n) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('jumlah_loket', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(n));
}

export function getStatistik() {
  const total = db.prepare('SELECT COUNT(*) as count FROM peserta WHERE nomor_antrian IS NOT NULL').get().count;
  const belum = db.prepare("SELECT COUNT(*) as count FROM peserta WHERE status = 'belum'").get().count;
  const menunggu = db.prepare("SELECT COUNT(*) as count FROM peserta WHERE status = 'menunggu'").get().count;
  const dipanggil = db.prepare("SELECT COUNT(*) as count FROM peserta WHERE status = 'dipanggil'").get().count;
  const selesai = db.prepare("SELECT COUNT(*) as count FROM peserta WHERE status = 'selesai'").get().count;
  return { total, belum, menunggu, dipanggil, selesai };
}
