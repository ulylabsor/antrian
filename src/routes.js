import { Router } from 'express';
import {
  cariPeserta,
  getPesertaById,
  ambilNomorAntrian,
  getAntrianByNomor,
  getDaftarAntrian,
  getDaftarAntrianCount,
  getDaftarAntrianPaged,
  updateStatus,
  setWaktuSelesai,
  getStatistik,
  setCounter,
  getJumlahLoket,
  setJumlahLoket,
  getAllPeserta,
  getPesertaNeedSync,
  insertPeserta,
  incrementJumlahDipanggil,
  getPanitiaAuth,
  setPanitiaPassword,
  setBerkasSiap,
  resetAntrianData,
} from './db.js';
import { updateStatusInSheets, syncAllToSheets } from './sheets.js';
import { generatePanggilanAudio } from './tts.js';
import { requirePanitia, comparePassword, hashPassword, signToken, verifyToken, loginRateLimit } from './auth.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_CSV_PATH = path.resolve(__dirname, '..', 'data.csv');
const DATA_XLSX_PATH = path.resolve(__dirname, '..', 'ABSENSI PENGAMBILAN SERTIFIKAT.xlsx');

function normalizeNoSeri(raw) {
  let s = String(raw ?? '').trim().replace(/\s+/g, '');
  if (!s) return '';
  if (/^\d+$/.test(s) && s.length < 7) s = s.padStart(7, '0');
  return s;
}

function readAllPesertaFromXlsxFile(xlsxPath) {
  const require = createRequire(import.meta.url);
  let XLSX;
  try {
    XLSX = require('xlsx');
  } catch (e) {
    throw new Error(`Dependency 'xlsx' belum ter-install. Jalankan: npm install xlsx — ${e.message}`);
  }
  const wb = XLSX.readFile(xlsxPath);
  const sheetName = wb.SheetNames.includes('Sheet1') ? 'Sheet1' : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true });
  if (rows.length === 0) throw new Error('XLSX kosong');
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const upper = rows[i].map(v => String(v).toUpperCase());
    if (upper.some(h => h.includes('NAMA')) && upper.some(h => h.includes('NO. SERI') || h.includes('NO SERI'))) { headerIdx = i; break; }
  }
  if (headerIdx === -1) throw new Error('Header XLSX tidak ditemukan (harus ada kolom Nama & No. Seri)');
  const headers = rows[headerIdx].map(h => String(h).replace(/\n/g, ' ').trim().toUpperCase());
  const namaIdx = headers.findIndex(h => h.includes('NAMA'));
  const seriIdx = headers.findIndex(h => h.includes('NO. SERI') || h.includes('NO SERI'));
  const ttlIdx = headers.findIndex(h => h.includes('TEMPAT'));
  if (namaIdx === -1 || seriIdx === -1) throw new Error(`Kolom Nama/No. Seri tidak ditemukan di header XLSX: ${headers.join(' | ')}`);
  return rows.slice(headerIdx + 1).map((row, i) => ({
    nama_lengkap: String(row[namaIdx] ?? '').trim(),
    tempat_tanggal_lahir: ttlIdx >= 0 ? String(row[ttlIdx] ?? '').trim() : '',
    no_seri: normalizeNoSeri(row[seriIdx]),
    row_number: headerIdx + 2 + i,
  })).filter(p => p.nama_lengkap && p.no_seri);
}

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
    no_seri: normalizeNoSeri((row[seriIdx] || '').trim()),
    row_number: i + 2,
  })).filter(p => p.nama_lengkap && p.no_seri);
}

/**
 * Pecah sebuah kata menjadi suku-kata berbasis aturan ejaan Indonesia.
 * Tujuan: mencegah mesin TTS mengeja nama asing/OOV per huruf. Dengan memecah
 * per suku (mis. "fazaria" → "fa-za-ri-a"), tiap suku dibaca sebagai kata pendek
 * yang valid sehingga nama terdengar utuh.
 *
 * Heuristik: tarik satu atau dua konsonan awal (termasuk digraf ng/ny/kh/sy) +
 * vokal, lalu kembangkan sampai habis. Sederhana tapi cukup untuk nama umum.
 */
const VOKAL = 'aeiouAEIOU';
const DIGRAF = ['ng', 'ny', 'kh', 'sy', 'ts', 'ch', 'sh', 'th'];
function sukukan(kata) {
  if (!kata) return kata;
  // Jangan pecah yang sudah pendek (≤3 huruf) atau mengandung non-huruf (angka/simbol).
  if (kata.length <= 3 || /[^A-Za-z]/.test(kata)) return kata;
  const adaVokal = (s) => s.split('').some(c => VOKAL.includes(c));
  const suku = [];
  let i = 0;
  while (i < kata.length) {
    let mulai = i;
    // Ambil 1-2 konsonan awal (cek digraf dulu, lalu konsonan tunggal)
    const dua = kata.slice(i, i + 2).toLowerCase();
    if (DIGRAF.includes(dua)) { i += 2; }
    else if (!VOKAL.includes(kata[i])) { i += 1; }
    // Ambil vokal (rangkap vokal seperti "ai"/"au" ikut dalam satu suku)
    while (i < kata.length && VOKAL.includes(kata[i])) i += 1;
    // Konsonan penutup:
    if (i < kata.length && !VOKAL.includes(kata[i])) {
      // Bila tidak ada vokal lagi di sisa kata → semua konsonan sisanya jadi
      // penutup akhir kata (mis. "fusdan" → "fus-dan", bukan "fus-da-n").
      if (!adaVokal(kata.slice(i))) {
        i = kata.length;
      } else if (i + 1 < kata.length && !VOKAL.includes(kata[i + 1])) {
        // Dua konsonan beruntun sebelum vokal berikutnya → ambil 1 sebagai penutup
        i += 1;
      }
    }
    const potong = kata.slice(mulai, i);
    if (potong) suku.push(potong);
    if (i === mulai) i++; // jaga agar tidak loop forever pada karakter aneh
  }
  // Gabung suku tanpa vokal (mis. "gg" di "anggraini") ke suku sebelumnya,
  // supaya tidak ada potongan konsonan-murni yang bisa memicu eja per huruf.
  const hasil = [];
  for (const s of suku) {
    if (hasil.length > 0 && !adaVokal(s)) hasil[hasil.length - 1] += s;
    else hasil.push(s);
  }
  return hasil.length > 1 ? hasil.join('-') : kata;
}

export function createRouter(io) {
  const router = Router();

  // ===== Panitia auth =====
  router.post('/panitia/auth', loginRateLimit, (req, res) => {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Password wajib diisi' });
    const auth = getPanitiaAuth();
    if (!auth) return res.status(500).json({ error: 'Konfigurasi panitia belum siap' });
    if (!comparePassword(password, auth.password_hash)) {
      return res.status(401).json({ error: 'Password salah' });
    }
    const token = signToken({ ver: auth.token_version });
    const expiresAt = Date.now() + parseInt(process.env.PANITIA_TOKEN_TTL_HOURS || '8', 10) * 3600 * 1000;
    res.json({ token, expiresAt });
  });

  router.post('/panitia/change-password', requirePanitia, (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
    }
    const auth = getPanitiaAuth();
    if (!comparePassword(currentPassword, auth.password_hash)) {
      return res.status(401).json({ error: 'Password saat ini salah' });
    }
    setPanitiaPassword(hashPassword(newPassword));
    res.json({ success: true });
  });

  // Reset data antrian: hapus semua nomor_antrian & status kembali ke belum.
  // WAJIB kirim { password } yang dicocokkan ke panitia_auth.password_hash.
  // Auth ganda: bila ada Bearer valid (panitia sudah login di /panitia),
  // boleh reset tanpa password lagi — convenient untuk panitia yang
  // membuka /data dari tab yang masih authed. Pengunjung publik tetap
  // wajib kirim password untuk lolos.
  router.post('/admin/reset', (req, res) => {
    const { password } = req.body || {};
    const header = req.headers.authorization || '';
    const m = header.match(/^Bearer\s+(.+)$/);
    let bearerOk = false;
    if (m) {
      try { bearerOk = verifyToken(m[1]).ok; } catch {}
    }
    if (!bearerOk) {
      if (!password) return res.status(401).json({ error: 'Password panitia wajib diisi untuk reset data' });
      const auth = getPanitiaAuth();
      if (!auth) return res.status(500).json({ error: 'Konfigurasi panitia belum siap' });
      if (!comparePassword(String(password), auth.password_hash)) {
        return res.status(401).json({ error: 'Password salah — reset dibatalkan' });
      }
    }
    try {
      resetAntrianData();
      if (io) {
        io.emit('statistik:update', getStatistik());
        io.emit('antrian:reset');
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Gagal reset: ' + err.message });
    }
  });

  // Cari peserta (autocomplete) — by nama OR no_seri via satu kotak pintar
  router.get('/peserta/cari', (req, res) => {
    const q = req.query.q;
    if (!q || q.length < 2) {
      return res.json([]);
    }
    const hasil = cariPeserta(q);
    res.json(hasil);
  });

  // Semua peserta (untuk halaman data keseluruhan) — HARUS sebelum /peserta/:id
  router.get('/peserta/all', (req, res) => {
    res.json(getAllPeserta());
  });

  // Sync semua data ke Google Sheets (manual trigger dari dashboard)
  router.post('/sync/sheets', requirePanitia, async (req, res) => {
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

  // Download/sync data terbaru → import ke SQLite (skip duplikat no_seri).
  // Prioritas sumber: (1) file lokal ABSENSI PENGAMBILAN SERTIFIKAT.xlsx (887 peserta, master baru),
  // (2) Google Sheets publik sebagai fallback. Dipakai untuk refresh data dari dashboard.
  router.post('/sync/download', requirePanitia, async (req, res) => {
    let pesertaList;
    let sourceLabel;
    // 1) Coba file XLSX lokal dulu (master baru)
    if (fs.existsSync(DATA_XLSX_PATH)) {
      try {
        pesertaList = readAllPesertaFromXlsxFile(DATA_XLSX_PATH);
        sourceLabel = 'ABSENSI PENGAMBILAN SERTIFIKAT.xlsx';
      } catch (e) {
        console.warn('Sync: gagal baca XLSX lokal, fallback ke Sheets:', e.message);
      }
    }
    // 2) Fallback: download CSV dari Google Sheets publik
    if (!pesertaList) {
      const SHEETS_ID = process.env.GOOGLE_SHEETS_ID || '1vefx3SssNHYpjOVb3g37BgnNUfHklS7IMtFQKQpujm4';
      const url = `https://docs.google.com/spreadsheets/d/${SHEETS_ID}/export?format=csv`;
      try {
        const csvRes = await fetch(url, { redirect: 'follow' });
        if (!csvRes.ok) {
          return res.status(502).json({ error: `Gagal download dari Google Sheets: HTTP ${csvRes.status}` });
        }
        const csvContent = await csvRes.text();
        try {
          if (fs.existsSync(DATA_CSV_PATH)) fs.copyFileSync(DATA_CSV_PATH, DATA_CSV_PATH + '.bak');
        } catch { /* ignore */ }
        fs.writeFileSync(DATA_CSV_PATH, csvContent, 'utf8');
        pesertaList = readAllPesertaFromCsvContent(csvContent);
        sourceLabel = 'Google Sheets (CSV)';
      } catch (err) {
        console.error('Sync download error:', err.message);
        return res.status(503).json({ error: 'Gagal sync: ' + err.message });
      }
    }

    // Normalisasi no_seri untuk cek duplikat (pad 7 digit agar '9575' == '0009575')
    let inserted = 0, skipped = 0;
    const existing = new Set(getAllPeserta().map(r => normalizeNoSeri(String(r.no_seri))));
    for (const p of pesertaList) {
      const normSeri = normalizeNoSeri(String(p.no_seri));
      if (existing.has(normSeri)) { skipped++; continue; }
      insertPeserta(p.nama_lengkap, p.tempat_tanggal_lahir, normSeri, p.row_number);
      existing.add(normSeri);
      inserted++;
    }

    res.json({
      success: true,
      total: pesertaList.length,
      inserted,
      skipped,
      message: `Sync dari ${sourceLabel}: ${inserted} peserta baru ditambahkan, ${skipped} duplikat diabaikan. Total ${pesertaList.length} peserta di sumber.`,
    });
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
  // - Tanpa pagination param: legacy array (kompatibel Menunggu/Dipanggil + info-antrian).
  // - Dengan ?page=&perPage=  atau  tab=selesai → response { data, page, perPage, total, totalPages }
  router.get('/antrian/daftar', (req, res) => {
    const status = req.query.status || 'menunggu';
    const qParam = req.query.q != null ? String(req.query.q).trim() : '';
    const hasPage = req.query.page !== undefined || req.query.perPage !== undefined;
    const needsPaged = hasPage || (status === 'selesai' && (req.query.page !== undefined || qParam !== ''));
    if (needsPaged) {
      const perPageRaw = parseInt(req.query.perPage, 10);
      const pageRaw = parseInt(req.query.page, 10);
      const perPage = Number.isFinite(perPageRaw) ? Math.min(Math.max(perPageRaw, 1), 100) : 20;
      const page = Number.isFinite(pageRaw) ? Math.max(pageRaw, 1) : 1;
      const q = qParam || undefined;
      const total = getDaftarAntrianCount(status, q);
      const totalPages = Math.max(1, Math.ceil(total / perPage));
      const safePage = Math.min(page, totalPages);
      const data = getDaftarAntrianPaged(status, safePage, perPage, q);
      return res.json({ data, page: safePage, perPage, total, totalPages });
    }
    const daftar = getDaftarAntrian(status);
    res.json(daftar);
  });

  // Panggil peserta — hanya jika status menunggu & berkas sudah Siap.
  router.post('/antrian/panggil/:nomor', requirePanitia, (req, res) => {
    const nomor = parseInt(req.params.nomor);
    const antrian = getAntrianByNomor(nomor);
    if (!antrian) return res.status(404).json({ error: 'Tidak ditemukan' });
    if (antrian.status !== 'menunggu') {
      return res.status(400).json({ error: 'Hanya peserta menunggu yang bisa dipanggil' });
    }
    if (!antrian.berkas_siap) {
      return res.status(400).json({ error: 'Berkas belum siap — tandai Siap dulu sebelum memanggil peserta' });
    }

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
    incrementJumlahDipanggil(nomor);

    const payload = { nomor, counter, peserta: getAntrianByNomor(nomor) };
    if (io) io.to(`peserta:${nomor}`).emit('antrian:panggil', payload);
    if (io) io.emit('antrian:panggil', { nomor, counter }); // broadcast ke dashboard panitia lain
    if (io) io.emit('statistik:update', getStatistik());
    res.json({ success: true, nomor, counter });
  });

  // Panggil ulang — emit event ke peserta agar animasi + putar audio lagi
  router.post('/antrian/panggil-ulang/:nomor', requirePanitia, (req, res) => {
    const nomor = parseInt(req.params.nomor);
    const antrian = getAntrianByNomor(nomor);
    if (!antrian) return res.status(404).json({ error: 'Tidak ditemukan' });
    if (antrian.status !== 'dipanggil') {
      return res.status(400).json({ error: 'Peserta belum dipanggil' });
    }
    const counter = antrian.counter;
    incrementJumlahDipanggil(nomor);
    // Emit ke peserta agar animasi lagi + putar audio
    if (io) io.to(`peserta:${nomor}`).emit('antrian:panggil-ulang', { nomor, counter });
    // Broadcast global agar layar info.html juga putar ulang panggilan suara
    if (io) io.emit('antrian:panggil-ulang', { nomor, counter });
    res.json({ success: true, nomor, counter });
  });

  // Toggle berkas siap/belum — hanya untuk status menunggu, tidak pindah tab (checklist panitia).
  // Body: { berkas_siap: 0|1 } atau tanpa body = toggle. Default Belum (0) = berkas belum ditemukan.
  router.post('/antrian/berkas/:nomor', requirePanitia, (req, res) => {
    const nomor = parseInt(req.params.nomor);
    const antrian = getAntrianByNomor(nomor);
    if (!antrian) return res.status(404).json({ error: 'Tidak ditemukan' });
    if (antrian.status !== 'menunggu') {
      return res.status(400).json({ error: 'Hanya peserta menunggu yang bisa di-toggle berkasnya' });
    }
    const raw = req.body?.berkas_siap;
    let next;
    if (raw === undefined || raw === null) {
      next = antrian.berkas_siap ? 0 : 1; // toggle
    } else {
      const v = parseInt(raw, 10);
      if (v !== 0 && v !== 1) return res.status(400).json({ error: 'berkas_siap harus 0 atau 1' });
      next = v;
    }
    setBerkasSiap(nomor, next);
    if (io) io.emit('antrian:berkas', { nomor, berkas_siap: next });
    res.json({ success: true, nomor, berkas_siap: next });
  });

  // Selesai (sync ke Sheets)
  router.post('/antrian/selesai/:nomor', requirePanitia, async (req, res) => {
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

  router.post('/settings/loket', requirePanitia, (req, res) => {
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

  // Data untuk layar informasi publik (nomor yang dipanggil + antrian berikutnya)
  // Anti-cache: layar info harus selalu fresh — jangan biarkan browser/Cloudflare
  // menyajikan response lama sehingga Sedang Dipanggil tampak "stuck".
  router.get('/info-antrian', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    const dipanggil = getDaftarAntrian('dipanggil');
    const menunggu = getDaftarAntrian('menunggu');
    const statistik = getStatistik();
    res.json({ dipanggil, menunggu: menunggu.slice(0, 10), statistik });
  });

  // TTS — generate audio panggilan bahasa Indonesia via Google TTS
  // Stream audio buffer langsung dari server (hindari CORS redirect)
  // Termasuk nama peserta setelah nomor antrian (diambil dari DB via nomor).
  router.get('/tts', async (req, res) => {
    const nomor = req.query.nomor;
    const loket = req.query.loket;
    if (nomor === undefined || loket === undefined) {
      return res.status(400).json({ error: 'nomor dan loket wajib' });
    }
    // Ambil nama peserta dari database berdasarkan nomor antrian.
    // Potong nama terlalu panjang supaya audio tidak bertele-tele (maks ~4 kata).
    let namaBagian = '';
    try {
      const peserta = getAntrianByNomor(parseInt(nomor));
      if (peserta && peserta.nama_lengkap) {
        const kata = String(peserta.nama_lengkap).trim().split(/\s+/);
        namaBagian = kata.length > 4 ? kata.slice(0, 4).join(' ') : peserta.nama_lengkap.trim();
      }
    } catch { /* abaikan — audio tetap dihasilkan tanpa nama */ }

    // Pecah nama menjadi suku-kata dipisah tanda hubung (mis. "fazaria" → "fa-za-ri-a",
    // "fusdan" → "fus-dan"). Mesin TTS kerap mengeja per huruf nama yang tidak ada di
    // kamus (OOV); memecah per suku membuat tiap suku dibaca sebagai kata pendek yang
    // valid, sehingga namanya terdengar menyatu seperti diucapkan, bukan dieja.
    if (namaBagian) {
      namaBagian = namaBagian.split(/\s+/).map(sukukan).join(' ');
    }

    // Format panggilan gaya bandara: "Panggilan untuk nomor X, [nama], menuju ruangan Y"
    // Repetisi 2x + jeda ditangani di sisi client (mainkan audio dua kali dengan jeda).
    const teks = namaBagian
      ? `Panggilan untuk nomor ${nomor}, ${namaBagian}, silakan menuju ruangan ${loket}`
      : `Panggilan untuk nomor ${nomor}, silakan menuju ruangan ${loket}`;
    try {
      // generatePanggilanAudio: Cloud TTS neural voice (bila dikonfigurasi) atau
      // fallback ke Google Translate TTS — keduanya kembalikan buffer audio/mpeg.
      const { buffer, contentType } = await generatePanggilanAudio(teks);
      res.set('Content-Type', contentType);
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
