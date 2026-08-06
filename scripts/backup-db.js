import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Format tanggal YYYY-MM-DD (lokal). `now` di-inject supaya testable tanpa Date.now().
 */
function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Backup DB SQLite via hot-copy (db.backup), lalu purge backup berusia > retentionDays.
 * @param {object} opts
 * @param {string} opts.dbPath - path DB sumber
 * @param {string} opts.backupDir - folder tujuan backup
 * @param {number} opts.retentionDays - hapus backup lebih tua dari ini (hari)
 * @param {Date} opts.now - timestamp acuan (inject untuk test)
 * @returns {Promise<{backed: string, purged: number}>}
 */
export async function runBackup({ dbPath, backupDir, retentionDays, now }) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`database tidak ditemukan: ${dbPath}`);
  }
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = formatDate(now);
  const target = path.join(backupDir, `antrian-${stamp}.sqlite`);

  // Hot backup — db.backup mengembalikan Promise, tidak perlu matikan app.
  const db = new Database(dbPath, { readonly: true });
  try {
    await db.backup(target);
  } finally {
    db.close();
  }

  // Purge backup > retentionDays berdasarkan tanggal di nama file (antrian-YYYY-MM-DD.sqlite).
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - retentionDays);
  let purged = 0;
  for (const entry of fs.readdirSync(backupDir)) {
    const m = entry.match(/^antrian-(\d{4})-(\d{2})-(\d{2})\.sqlite$/);
    if (!m) continue;
    const fileDate = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
    if (fileDate < cutoff) {
      try { fs.rmSync(path.join(backupDir, entry), { force: true }); purged++; } catch { /* ignore */ }
    }
  }

  return { backed: target, purged };
}

const __scriptPath = fileURLToPath(import.meta.url);

// Entry point saat dijalankan langsung: node scripts/backup-db.js
if (process.argv[1] && path.resolve(process.argv[1]) === __scriptPath) {
  const dbPath = process.env.DB_PATH || './database.sqlite';
  const backupDir = process.env.BACKUP_DIR || '/var/backups/antrian';
  const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || '7', 10);
  runBackup({ dbPath, backupDir, retentionDays, now: new Date() })
    .then(({ backed, purged }) => {
      console.log(`Backup selesai: ${backed} (purged ${purged} backup lama)`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Backup gagal:', err.message);
      process.exit(1);
    });
}
