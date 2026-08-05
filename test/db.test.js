import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { initDb, closeDb, getPesertaByNama, getPesertaById, ambilNomorAntrian, getAntrianByNomor, getDaftarAntrian, updateStatus, setWaktuSelesai, getStatistik, insertPeserta, setCounter, getJumlahLoket, setJumlahLoket } from '../src/db.js';

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

// === Tests untuk fitur loket (counter) ===

test('initDb seeds settings table dengan jumlah_loket=3', () => {
  // initDb sudah dipanggil di beforeEach; cek default value
  assert.equal(getJumlahLoket(), 3);
});

test('initDb idempoten — kolom counter tidak diduplikasi', () => {
  // Panggil initDb lagi (DB sudah ada). Tidak boleh throw "duplicate column".
  assert.doesNotThrow(() => initDb());
  // Verifikasi kolom counter ada — pakai peserta 2 yang belum di-ambil nomornya di test ini
  const peserta = ambilNomorAntrian(2);
  const antrian = getAntrianByNomor(peserta);
  assert.equal(antrian.counter, null); // kolom ada, value null sebelum dipanggil
});

test('getJumlahLoket return 3 default', () => {
  assert.equal(getJumlahLoket(), 3);
});

test('setJumlahLoket lalu getJumlahLoket return nilai baru', () => {
  setJumlahLoket(5);
  assert.equal(getJumlahLoket(), 5);
});

test('setCounter persist counter peserta', () => {
  // Pakai peserta baru agar tidak bentrok dengan test lain yang ambil nomor peserta 1/2
  const id = insertPeserta('Cici Lestari', 'Semarang, 3 Maret 1992', '0012099', 99);
  const nomor = ambilNomorAntrian(id);
  setCounter(nomor, 2);
  const antrian = getAntrianByNomor(nomor);
  assert.equal(antrian.counter, 2);
});

test('getDaftarAntrian include kolom counter', () => {
  const id = insertPeserta('Dodi Wibowo', 'Tegal, 4 April 1993', '0012100', 100);
  const nomor = ambilNomorAntrian(id);
  updateStatus(nomor, 'dipanggil');
  setCounter(nomor, 3);
  const daftar = getDaftarAntrian('dipanggil');
  // Filter hanya peserta ini (mungkin ada peserta dipanggil lain dari test concurrent)
  const row = daftar.find(d => d.nomor_antrian === nomor);
  assert.ok(row, 'peserta harus muncul di daftar dipanggil');
  assert.equal(row.counter, 3);
});

test('setCounter dengan null clear counter', () => {
  const id = insertPeserta('Eka Putri', 'Pekalongan, 5 Mei 1994', '0012101', 101);
  const nomor = ambilNomorAntrian(id);
  setCounter(nomor, 2);
  setCounter(nomor, null);
  const antrian = getAntrianByNomor(nomor);
  assert.equal(antrian.counter, null);
});
