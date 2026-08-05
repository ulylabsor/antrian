import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

let sheetsClient = null;

export function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: 'service_account',
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

export async function readAllPeserta() {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

  // Baca header dulu untuk tau kolom NO SERI ada di index berapa
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'A1:Z2',
  });

  const headers = headerRes.data.values[0];
  const rowIndex = {}; // map nama kolom → index
  headers.forEach((h, i) => {
    const cleanName = h.replace(/\n/g, ' ').trim().toUpperCase();
    rowIndex[cleanName] = i;
  });

  // Nama kolom bisa bervariasi, cari yang cocok
  const namaCol = Object.keys(rowIndex).find(k => k.includes('NAMA LENGKAP'));
  const ttlCol = Object.keys(rowIndex).find(k => k.includes('TEMPAT'));
  const seriCol = Object.keys(rowIndex).find(k => k.includes('NO SERI'));

  const namaIdx = rowIndex[namaCol];
  const ttlIdx = rowIndex[ttlCol];
  const seriIdx = rowIndex[seriCol];

  // Baca semua data
  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'A2:Z',
  });

  const rows = dataRes.data.values || [];
  return rows
    .map((row, i) => ({
      nama_lengkap: row[namaIdx] || '',
      tempat_tanggal_lahir: row[ttlIdx] || '',
      no_seri: row[seriIdx] || '',
      row_number: i + 2, // +2 karena data mulai row 2 (header di row 1)
    }))
    .filter(p => p.nama_lengkap && p.no_seri);
}

export async function updateStatusInSheets(rowNumber, status, nomorAntrian, waktuAmbil) {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

  // Cari header untuk tau kolom STATUS, NOMOR_ANTRIAN, WAKTU_AMBIL ada di mana
  // Kalau belum ada, tambahkan kolom baru
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'A1:Z1',
  });

  const headers = headerRes.data.values[0];
  let statusCol = headers.findIndex(h => h && h.toUpperCase() === 'STATUS');
  let nomorCol = headers.findIndex(h => h && h.toUpperCase() === 'NOMOR_ANTRIAN');
  let waktuCol = headers.findIndex(h => h && h.toUpperCase() === 'WAKTU_AMBIL');

  // Kalau kolom belum ada, tambah di akhir
  const updates = [];

  if (statusCol === -1) {
    statusCol = headers.length;
    headers.push('STATUS');
    updates.push({
      range: `${columnLetter(statusCol)}1`,
      values: [['STATUS']],
    });
  }
  if (nomorCol === -1) {
    nomorCol = headers.length;
    headers.push('NOMOR_ANTRIAN');
    updates.push({
      range: `${columnLetter(nomorCol)}1`,
      values: [['NOMOR_ANTRIAN']],
    });
  }
  if (waktuCol === -1) {
    waktuCol = headers.length;
    headers.push('WAKTU_AMBIL');
    updates.push({
      range: `${columnLetter(waktuCol)}1`,
      values: [['WAKTU_AMBIL']],
    });
  }

  // Update header kalau ada kolom baru
  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: updates,
      },
    });
  }

  // Update row data
  const statusCell = `${columnLetter(statusCol)}${rowNumber}`;
  const nomorCell = `${columnLetter(nomorCol)}${rowNumber}`;
  const waktuCell = `${columnLetter(waktuCol)}${rowNumber}`;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: statusCell, values: [[status]] },
        { range: nomorCell, values: [[nomorAntrian]] },
        { range: waktuCell, values: [[waktuAmbil]] },
      ],
    },
  });
}

// Sync semua peserta yang perlu ke Sheets (status, nomor_antrian, waktu_ambil)
// Dipanggil manual lewat tombol di dashboard. Return {synced: N, errors: M}.
export async function syncAllToSheets(pesertaList) {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

  // Pastikan kolom STATUS/NOMOR_ANTRIAN/WAKTU_AMBIL ada
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'A1:Z1',
  });
  const headers = headerRes.data.values[0];
  let statusCol = headers.findIndex(h => h && h.toUpperCase() === 'STATUS');
  let nomorCol = headers.findIndex(h => h && h.toUpperCase() === 'NOMOR_ANTRIAN');
  let waktuCol = headers.findIndex(h => h && h.toUpperCase() === 'WAKTU_AMBIL');

  const headerUpdates = [];
  if (statusCol === -1) {
    statusCol = headers.length; headers.push('STATUS');
    headerUpdates.push({ range: `${columnLetter(statusCol)}1`, values: [['STATUS']] });
  }
  if (nomorCol === -1) {
    nomorCol = headers.length; headers.push('NOMOR_ANTRIAN');
    headerUpdates.push({ range: `${columnLetter(nomorCol)}1`, values: [['NOMOR_ANTRIAN']] });
  }
  if (waktuCol === -1) {
    waktuCol = headers.length; headers.push('WAKTU_AMBIL');
    headerUpdates.push({ range: `${columnLetter(waktuCol)}1`, values: [['WAKTU_AMBIL']] });
  }
  if (headerUpdates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data: headerUpdates },
    });
  }

  // Siapkan data updates untuk semua peserta
  const dataUpdates = [];
  for (const p of pesertaList) {
    const row = p.sheets_row;
    if (!row) continue;
    dataUpdates.push({ range: `${columnLetter(statusCol)}${row}`, values: [[p.status || '']] });
    dataUpdates.push({ range: `${columnLetter(nomorCol)}${row}`, values: [[p.nomor_antrian ?? '']] });
    dataUpdates.push({ range: `${columnLetter(waktuCol)}${row}`, values: [[p.waktu_selesai || '']] });
  }

  // Sheets batchUpdate max ~1000 value ranges per request — pecah jadi chunks
  let synced = 0;
  let errors = 0;
  const CHUNK = 200;
  for (let i = 0; i < dataUpdates.length; i += CHUNK) {
    const chunk = dataUpdates.slice(i, i + CHUNK);
    try {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data: chunk },
      });
      synced += chunk.length / 3; // 3 kolom per peserta
    } catch (err) {
      console.error('Sheets sync chunk error:', err.message);
      errors += chunk.length / 3;
    }
  }

  return { synced: Math.round(synced), errors: Math.round(errors) };
}

function columnLetter(index) {
  let result = '';
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}
