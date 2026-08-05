import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { initDb, closeDb, getPesertaByNama, getPesertaById, ambilNomorAntrian, getAntrianByNomor, getDaftarAntrian, updateStatus, setWaktuSelesai, getStatistik, insertPeserta } from '../src/db.js';

const TEST_DB = './test-database.sqlite';

beforeEach(async () => {
  // Tutup koneksi sebelumnya dan hapus DB test agar tiap test mulai dari state bersih.
  // CREATE TABLE IF NOT EXISTS di initDb tidak menghapus data lama, dan INSERT OR IGNORE
  // melewatkan baris yang sudah ada — tanpa ini, ambilNomorAntrian(1) gagal di test berikutnya
  // karena peserta sudah memiliki nomor_antrian dari test sebelumnya.
  closeDb();
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    try { fs.unlinkSync(f); } catch { /* file tidak ada, abaikan */ }
  }
  process.env.DB_PATH = TEST_DB;
  await initDb();
  // Insert test data
  insertPeserta('Budi Santoso', 'Jakarta, 1 Januari 1990', '0012001', 2);
  insertPeserta('Budi Pratama', 'Bandung, 2 Februari 1991', '0012002', 3);
});

afterEach(() => {
  // Tutus koneksi DB supaya file bisa dihapus oleh beforeEach test berikutnya.
  closeDb();
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
