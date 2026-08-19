import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { initDb, insertPeserta } from '../src/db.js';
import { readAllPeserta } from '../src/sheets.js';

dotenv.config();

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeNoSeri(raw) {
  let s = String(raw ?? '').trim().replace(/\s+/g, '');
  if (!s) return '';
  if (/^\d+$/.test(s) && s.length < 7) s = s.padStart(7, '0');
  return s;
}

/**
 * Parse CSV content into rows of fields.
 * Menghandle quoted fields dengan embedded comma, newline, dan CRLF line endings.
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
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }

    if (ch === '\r') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      if (content[i + 1] === '\n') i += 2;
      else i++;
      continue;
    }

    if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function readAllPesertaFromCsv() {
  const csvPath = path.resolve(__dirname, '..', 'data.csv');
  const content = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(content);
  if (rows.length === 0) return [];
  const headers = rows[0].map(h => h.replace(/\n/g, ' ').trim().toUpperCase());
  const namaIdx = headers.findIndex(h => h.includes('NAMA LENGKAP'));
  const ttlIdx = headers.findIndex(h => h.includes('TEMPAT'));
  const seriIdx = headers.findIndex(h => h.includes('NO SERI'));
  if (namaIdx === -1 || seriIdx === -1) {
    throw new Error(`CSV header tidak ditemukan: NAMA LENGKAP/NO SERI. Headers: ${headers.join(' | ')}`);
  }
  return rows
    .slice(1)
    .map((row, i) => ({
      nama_lengkap: (row[namaIdx] || '').trim(),
      tempat_tanggal_lahir: ttlIdx >= 0 ? (row[ttlIdx] || '').trim() : '',
      no_seri: normalizeNoSeri(row[seriIdx] || ''),
      row_number: i + 2,
    }))
    .filter(p => p.nama_lengkap && p.no_seri);
}

/**
 * Sumber baru: ABSENSI PENGAMBILAN SERTIFIKAT.xlsx
 * Sheet1: baris 1-2 judul, baris 5 header (No., Nama, No Akun, NIM, No. Seri, ...),
 *         data mulai baris 6 s.d. 892 (887 peserta). Kolom B=Nama, E=No. Seri.
 */
function readAllPesertaFromXlsx() {
  const xlsxPath = path.resolve(__dirname, '..', 'ABSENSI PENGAMBILAN SERTIFIKAT.xlsx');
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`File tidak ditemukan: ${xlsxPath}`);
  }
  let XLSX;
  try {
    XLSX = require('xlsx');
  } catch (e) {
    throw new Error(`Dependency 'xlsx' belum ter-install. Jalankan: npm install xlsx — ${e.message}`);
  }
  const wb = XLSX.readFile(xlsxPath);
  const sheetName = wb.SheetNames.includes('Sheet1') ? 'Sheet1' : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  // blankrows:true agar row_number selaras dengan nomor baris Excel asli
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true });
  if (rows.length === 0) throw new Error('XLSX kosong');

  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const upper = rows[i].map(v => String(v).toUpperCase());
    const hasNama = upper.some(h => h.includes('NAMA'));
    const hasSeri = upper.some(h => h.includes('NO. SERI') || h.includes('NO SERI'));
    if (hasNama && hasSeri) { headerIdx = i; break; }
  }
  if (headerIdx === -1) {
    throw new Error(`Header XLSX tidak ditemukan (harus ada kolom Nama & No. Seri). Baris 1-10: ${JSON.stringify(rows.slice(0, 5))}`);
  }
  const headers = rows[headerIdx].map(h => String(h).replace(/\n/g, ' ').trim().toUpperCase());
  const namaIdx = headers.findIndex(h => h.includes('NAMA'));
  const seriIdx = headers.findIndex(h => h.includes('NO. SERI') || h.includes('NO SERI'));
  const ttlIdx = headers.findIndex(h => h.includes('TEMPAT'));

  if (namaIdx === -1 || seriIdx === -1) {
    throw new Error(`Kolom Nama/No. Seri tidak ditemukan di header XLSX: ${headers.join(' | ')}`);
  }

  return rows
    .slice(headerIdx + 1)
    .map((row, i) => ({
      nama_lengkap: String(row[namaIdx] ?? '').trim(),
      tempat_tanggal_lahir: ttlIdx >= 0 ? String(row[ttlIdx] ?? '').trim() : '',
      no_seri: normalizeNoSeri(row[seriIdx]),
      row_number: headerIdx + 2 + i, // 1-based Excel row number
    }))
    .filter(p => p.nama_lengkap && p.no_seri);
}

async function main() {
  console.log('Inisialisasi database...');
  initDb();

  let pesertaList;
  let source;
  // Urutan sumber: Google Sheets -> XLSX ABSENSI -> CSV fallback
  try {
    console.log('Mengambil data dari Google Sheets...');
    pesertaList = await readAllPeserta();
    source = 'Google Sheets';
  } catch (err) {
    console.warn(`Gagal mengambil dari Google Sheets: ${err.message}`);
    const xlsxPath = path.resolve(__dirname, '..', 'ABSENSI PENGAMBILAN SERTIFIKAT.xlsx');
    if (fs.existsSync(xlsxPath)) {
      try {
        console.log('Mencoba membaca dari ABSENSI PENGAMBILAN SERTIFIKAT.xlsx ...');
        pesertaList = readAllPesertaFromXlsx();
        source = 'ABSENSI PENGAMBILAN SERTIFIKAT.xlsx (lokal)';
      } catch (err2) {
        console.warn(`Gagal membaca XLSX: ${err2.message}`);
        console.log('Mencoba fallback: membaca dari data.csv lokal...');
        pesertaList = readAllPesertaFromCsv();
        source = 'data.csv (fallback lokal)';
      }
    } else {
      console.log('File XLSX tidak ditemukan, fallback ke data.csv ...');
      pesertaList = readAllPesertaFromCsv();
      source = 'data.csv (fallback lokal)';
    }
  }
  console.log(`Sumber data: ${source}`);
  console.log(`Ditemukan ${pesertaList.length} peserta`);

  let inserted = 0;
  let skipped = 0;

  for (const peserta of pesertaList) {
    const result = insertPeserta(
      peserta.nama_lengkap,
      peserta.tempat_tanggal_lahir,
      peserta.no_seri,
      peserta.row_number
    );
    if (Number(result) > 0) inserted++;
    else skipped++;
  }

  console.log(`Selesai! Inserted: ${inserted}, Skipped (duplikat): ${skipped}`);
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
