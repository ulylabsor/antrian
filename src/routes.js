import { Router } from 'express';
import {
  getPesertaByNama,
  getPesertaById,
  ambilNomorAntrian,
  getAntrianByNomor,
  getDaftarAntrian,
  updateStatus,
  setWaktuSelesai,
  getStatistik,
  setCounter,
  getJumlahLoket,
  setJumlahLoket,
  getAllPeserta,
  getPesertaNeedSync,
  insertPeserta,
} from './db.js';
import { updateStatusInSheets, syncAllToSheets } from './sheets.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_CSV_PATH = path.resolve(__dirname, '..', 'data.csv');

/**
 * Parse CSV content into rows of fields.
 * Menghandle quoted fields dengan embedded comma, newline, dan CRLF.
 */
function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') {
      row.push(field); field = ''; rows.push(row); row = [];
      if (content[i + 1] === '\n') i += 2; else i++;
      continue;
    }
    if (ch === '\n') { row.push(field); field = ''; rows.push(row); row = []; i++; continue; }
    field += ch; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function readAllPesertaFromCsvContent(content) {
  const rows = parseCsv(content);
  if (rows.length === 0) return [];
  const headers = rows[0].map(h => h.replace(/\n/g, ' ').trim().toUpperCase());
  const namaIdx = headers.findIndex(h => h.includes('NAMA LENGKAP'));
  const ttlIdx = headers.findIndex(h => h.includes('TEMPAT'));
  const seriIdx = headers.findIndex(h => h.includes('NO SERI'));
  if (namaIdx === -1 || seriIdx === -1) {
    throw new Error(`CSV header tidak ditemukan: NAMA LENGKAP/NO SERI. Headers: ${headers.join(' | ')}`);
  }
  return rows.slice(1).map((row, i) => ({
    nama_lengkap: (row[namaIdx] || '').trim(),
    tempat_tanggal_lahir: ttlIdx >= 0 ? (row[ttlIdx] || '').trim() : '',
    no_seri: (row[seriIdx] || '').trim(),
    row_number: i + 2,
  })).filter(p => p.nama_lengkap); // Tampilkan semua — termasuk yang no_seri kosong/invalid
}

export function createRouter(io) {
  const router = Router();

  // Cari peserta (autocomplete)
  router.get('/peserta/cari', (req, res) => {
    const nama = req.query.nama;
    if (!nama || nama.length < 2) {
      return res.json([]);
    }
    const hasil = getPesertaByNama(nama);
    res.json(hasil);
  });

  // Semua peserta (untuk halaman data keseluruhan) — HARUS sebelum /peserta/:id
  router.get('/peserta/all', (req, res) => {
    res.json(getAllPeserta());
  });

  // Sync semua data ke Google Sheets (manual trigger dari dashboard)
  router.post('/sync/sheets', async (req, res) => {
    // Cek credentials Google Sheets dulu
    if (!process.env.GOOGLE_SHEETS_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
      return res.status(400).json({
        error: 'Google Sheets belum di-setup. Isi GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, dan GOOGLE_PRIVATE_KEY di file .env dulu.',
        needSetup: true,
      });
    }
    try {
      const pesertaList = getPesertaNeedSync();
      if (pesertaList.length === 0) {
        return res.json({ success: true, synced: 0, errors: 0, message: 'Tidak ada data untuk disinkronkan. Import data dulu dengan npm run import.' });
      }
      const result = await syncAllToSheets(pesertaList);
      res.json({ success: true, ...result });
    } catch (err) {
      console.error('Sync sheets error:', err.message);
      res.status(503).json({ error: 'Gagal sync ke Google Sheets: ' + err.message });
    }
  });

  // Download data terbaru dari Google Sheets publik → simpan ke data.csv → import ke SQLite
  // Abaikan duplikat (INSERT OR IGNORE). Dipakai untuk refresh data dari dashboard.
  router.post('/sync/download', async (req, res) => {
    const SHEETS_ID = process.env.GOOGLE_SHEETS_ID || '1vefx3SssNHYpjOVb3g37BgnNUfHklS7IMtFQKQpujm4';
    const url = `https://docs.google.com/spreadsheets/d/${SHEETS_ID}/export?format=csv`;
    try {
      // Download CSV dari link publik (follow redirect)
      const csvRes = await fetch(url, { redirect: 'follow' });
      if (!csvRes.ok) {
        return res.status(502).json({ error: `Gagal download dari Google Sheets: HTTP ${csvRes.status}` });
      }
      const csvContent = await csvRes.text();

      // Simpan ke data.csv (backup lama jika ada)
      try {
        if (fs.existsSync(DATA_CSV_PATH)) {
          fs.copyFileSync(DATA_CSV_PATH, DATA_CSV_PATH + '.bak');
        }
      } catch { /* ignore */ }
      fs.writeFileSync(DATA_CSV_PATH, csvContent, 'utf8');

      // Parse & import (skip duplikat — cek no_seri sudah ada atau belum)
      const pesertaList = readAllPesertaFromCsvContent(csvContent);
      let inserted = 0, skipped = 0;
      const existing = new Set();
      // Ambil semua no_seri yang sudah ada di DB untuk cek duplikat
      const dbAll = getAllPeserta();
      for (const row of dbAll) existing.add(String(row.no_seri));
      for (const p of pesertaList) {
        if (existing.has(String(p.no_seri))) {
          skipped++;
          continue;
        }
        insertPeserta(p.nama_lengkap, p.tempat_tanggal_lahir, p.no_seri, p.row_number);
        inserted++;
      }

      res.json({
        success: true,
        total: pesertaList.length,
        inserted,
        skipped,
        message: `Download selesai! ${inserted} peserta baru ditambahkan, ${skipped} duplikat diabaikan. Total ${pesertaList.length} peserta di CSV.`,
      });
    } catch (err) {
      console.error('Sync download error:', err.message);
      res.status(503).json({ error: 'Gagal sync: ' + err.message });
    }
  });

  // Detail peserta
  router.get('/peserta/:id', (req, res) => {
    const peserta = getPesertaById(parseInt(req.params.id));
    if (!peserta) return res.status(404).json({ error: 'Peserta tidak ditemukan' });
    res.json(peserta);
  });

  // Ambil nomor antrian
  router.post('/antrian/ambil', (req, res) => {
    const { pesertaId } = req.body;
    if (!pesertaId) return res.status(400).json({ error: 'pesertaId wajib' });
    try {
      const nomor = ambilNomorAntrian(pesertaId);
      const peserta = getAntrianByNomor(nomor);
      if (io) io.emit('antrian:baru', peserta);
      if (io) io.emit('statistik:update', getStatistik());
      res.json({ nomor_antrian: nomor, status: 'menunggu' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Cek status antrian
  router.get('/antrian/status/:nomor', (req, res) => {
    const nomor = parseInt(req.params.nomor);
    const antrian = getAntrianByNomor(nomor);
    if (!antrian) return res.status(404).json({ error: 'Nomor antrian tidak ditemukan' });
    res.json(antrian);
  });

  // Daftar antrian (panitia)
  router.get('/antrian/daftar', (req, res) => {
    const status = req.query.status || 'menunggu';
    const daftar = getDaftarAntrian(status);
    res.json(daftar);
  });

  // Panggil peserta
  router.post('/antrian/panggil/:nomor', (req, res) => {
    const nomor = parseInt(req.params.nomor);
    const antrian = getAntrianByNomor(nomor);
    if (!antrian) return res.status(404).json({ error: 'Tidak ditemukan' });

    // Validasi counter jika diberikan
    let counter = null;
    if (req.body && req.body.counter !== undefined && req.body.counter !== null) {
      const c = parseInt(req.body.counter);
      const max = getJumlahLoket();
      if (!Number.isInteger(c) || c < 1 || c > max) {
        return res.status(400).json({ error: 'counter tidak valid' });
      }
      counter = c;
    }

    updateStatus(nomor, 'dipanggil');
    setCounter(nomor, counter);

    const payload = { nomor, counter, peserta: getAntrianByNomor(nomor) };
    if (io) io.to(`peserta:${nomor}`).emit('antrian:panggil', payload);
    if (io) io.emit('antrian:panggil', { nomor, counter }); // broadcast ke dashboard panitia lain
    if (io) io.emit('statistik:update', getStatistik());
    res.json({ success: true, nomor, counter });
  });

  // Panggil ulang — emit event ke peserta agar animasi + putar audio lagi
  router.post('/antrian/panggil-ulang/:nomor', (req, res) => {
    const nomor = parseInt(req.params.nomor);
    const antrian = getAntrianByNomor(nomor);
    if (!antrian) return res.status(404).json({ error: 'Tidak ditemukan' });
    if (antrian.status !== 'dipanggil') {
      return res.status(400).json({ error: 'Peserta belum dipanggil' });
    }
    const counter = antrian.counter;
    // Emit ke peserta agar animasi lagi + putar audio
    if (io) io.to(`peserta:${nomor}`).emit('antrian:panggil-ulang', { nomor, counter });
    res.json({ success: true, nomor, counter });
  });

  // Selesai (sync ke Sheets)
  router.post('/antrian/selesai/:nomor', async (req, res) => {
    const nomor = parseInt(req.params.nomor);
    const antrian = getAntrianByNomor(nomor);
    if (!antrian) return res.status(404).json({ error: 'Tidak ditemukan' });
    updateStatus(nomor, 'selesai');
    setWaktuSelesai(nomor);
    if (io) io.to(`peserta:${nomor}`).emit('antrian:selesai', { nomor });
    if (io) io.emit('statistik:update', getStatistik());

    // Sync ke Google Sheets (non-blocking, jangan block response)
    try {
      const waktuAmbil = new Date().toISOString();
      await updateStatusInSheets(antrian.sheets_row, 'selesai', nomor, waktuAmbil);
    } catch (err) {
      console.error('Sheets sync error:', err.message);
    }

    res.json({ success: true });
  });

  // Settings loket
  router.get('/settings/loket', (req, res) => {
    res.json({ jumlah_loket: getJumlahLoket() });
  });

  router.post('/settings/loket', (req, res) => {
    const n = parseInt(req.body?.jumlah_loket);
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      return res.status(400).json({ error: 'jumlah_loket harus integer 1-20' });
    }
    setJumlahLoket(n);
    if (io) io.emit('settings:loket', { jumlah_loket: n });
    res.json({ success: true, jumlah_loket: n });
  });

  // Statistik
  router.get('/statistik', (req, res) => {
    res.json(getStatistik());
  });

  // TTS — generate audio panggilan bahasa Indonesia via Google TTS
  // Stream audio buffer langsung dari server (hindari CORS redirect)
  router.get('/tts', async (req, res) => {
    const nomor = req.query.nomor;
    const loket = req.query.loket;
    if (nomor === undefined || loket === undefined) {
      return res.status(400).json({ error: 'nomor dan loket wajib' });
    }
    const teks = `Panggilan nomor ${nomor}, harap menuju ke loket ${loket}`;
    try {
      const { getAudioBase64 } = await import('google-tts-api');
      const result = await getAudioBase64(teks, { lang: 'id', slow: false });
      const buffer = Buffer.from(result, 'base64');
      res.set('Content-Type', 'audio/mpeg');
      res.set('Content-Length', buffer.length);
      res.set('Cache-Control', 'public, max-age=3600');
      return res.send(buffer);
    } catch (err) {
      console.error('TTS error:', err.message);
      return res.status(503).json({ error: 'Gagal generate suara' });
    }
  });

  return router;
}
