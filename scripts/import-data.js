import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, insertPeserta } from '../src/db.js';
import { readAllPeserta } from '../src/sheets.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
        // Escaped quote "" -> literal "
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
      // CRLF -> treat as single line break
      if (content[i + 1] === '\n') {
        i += 2;
      } else {
        i++;
      }
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

  // Flush sisa field/row terakhir
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Fallback: baca peserta dari data.csv lokal (hasil unduhan spreadsheet).
 * Dipakai ketika kredensial Google Service Account tidak tersedia.
 */
function readAllPesertaFromCsv() {
  const csvPath = path.resolve(__dirname, '..', 'data.csv');
  const content = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(content);

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map(h => h.replace(/\n/g, ' ').trim().toUpperCase());

  const namaIdx = headers.findIndex(h => h.includes('NAMA LENGKAP'));
  const ttlIdx = headers.findIndex(h => h.includes('TEMPAT'));
  const seriIdx = headers.findIndex(h => h.includes('NO SERI'));

  if (namaIdx === -1 || seriIdx === -1) {
    throw new Error(
      `CSV header tidak ditemukan: NAMA LENGKAP/NO SERI. Headers: ${headers.join(' | ')}`
    );
  }

  return rows
    .slice(1)
    .map((row, i) => ({
      nama_lengkap: (row[namaIdx] || '').trim(),
      tempat_tanggal_lahir: ttlIdx >= 0 ? (row[ttlIdx] || '').trim() : '',
      no_seri: (row[seriIdx] || '').trim(),
      row_number: i + 2, // +2 mengikuti konvensi Sheets (header di row 1, data mulai row 2)
    }))
    .filter(p => p.nama_lengkap && p.no_seri);
}

async function main() {
  console.log('Inisialisasi database...');
  initDb();

  let pesertaList;
  let source;
  try {
    console.log('Mengambil data dari Google Sheets...');
    pesertaList = await readAllPeserta();
    source = 'Google Sheets';
  } catch (err) {
    console.warn(`Gagal mengambil dari Google Sheets: ${err.message}`);
    console.log('Mencoba fallback: membaca dari data.csv lokal...');
    pesertaList = readAllPesertaFromCsv();
    source = 'data.csv (fallback lokal)';
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
    // result = info.lastInsertRowid (0 untuk duplikat INSERT OR IGNORE, BigInt/Number untuk insert berhasil)
    if (Number(result) > 0) {
      inserted++;
    } else {
      skipped++;
    }
  }

  console.log(`Selesai! Inserted: ${inserted}, Skipped (duplikat): ${skipped}`);
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
