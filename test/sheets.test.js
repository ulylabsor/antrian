import { test } from 'node:test';
import assert from 'node:assert';

// Test ini skip kalau tidak ada credentials
const hasCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY;

test('sheets module export fungsi yang benar', async () => {
  const sheets = await import('../src/sheets.js');
  assert.equal(typeof sheets.readAllPeserta, 'function');
  assert.equal(typeof sheets.updateStatusInSheets, 'function');
  assert.equal(typeof sheets.getSheetsClient, 'function');
});

test('updateStatusInSheets signature benar', async () => {
  const { updateStatusInSheets } = await import('../src/sheets.js');
  // Function harus menerima 4 argumen: rowNumber, status, nomorAntrian, waktuAmbil
  assert.equal(updateStatusInSheets.length, 4);
});
