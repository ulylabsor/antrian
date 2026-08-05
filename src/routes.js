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
} from './db.js';
import { updateStatusInSheets } from './sheets.js';

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
  // Mengembalikan URL audio yang bisa diputar di <audio> / new Audio()
  router.get('/tts', async (req, res) => {
    const nomor = req.query.nomor;
    const loket = req.query.loket;
    if (nomor === undefined || loket === undefined) {
      return res.status(400).json({ error: 'nomor dan loket wajib' });
    }
    const teks = `Panggilan nomor ${nomor}, harap menuju ke loket ${loket}`;
    try {
      // Import dinamis agar tidak crash jika package bermasalah
      const { getAudioUrl } = await import('google-tts-api');
      const url = await getAudioUrl(teks, { lang: 'id', slow: false });
      // Redirect ke URL audio Google — browser stream langsung
      res.redirect(url);
    } catch (err) {
      console.error('TTS error:', err.message);
      res.status(503).json({ error: 'Gagal generate suara' });
    }
  });

  return router;
}
