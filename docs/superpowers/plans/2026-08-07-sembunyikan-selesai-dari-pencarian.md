# Sembunyikan Peserta Selesai dari Pencarian — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Peserta berstatus `selesai` (sudah ambil sertifikat) tidak muncul di dropdown pencarian; jika semua match sebuah query adalah `selesai`, tampilkan modal informasi "Sudah Mengambil Sertifikat".

**Architecture:** Backend `cariPeserta` menambah field `status` + `waktu_selesai` ke SELECT (tanpa filter WHERE — response tetap semua match, supaya tidak merusak tes `data.length` yang ada). Frontend `tampilkanHasilPencarian` memisahkan match jadi `selesai` vs `aktif`; bila hanya `selesai` → `showInfo` modal, bila ada `aktif` → render hanya yang aktif.

**Tech Stack:** Express + better-sqlite3 (backend), vanilla JS + modal.js `showInfo` (frontend), node:test + assert (testing).

## Global Constraints

- Kontrak route `/api/peserta/cari` TIDAK berubah (masih `GET /api/peserta/cari?q=...` → JSON array). Hanya isi tiap objek response dapat field extra `status` & `waktu_selesai`.
- `message` di `showInfo` di-escape HTML (`escapeHtml` di modal.js) → **plain text**, tidak boleh HTML. Tanggal diformat di JS jadi string lalu disisipkan.
- Tidak menambah filter `WHERE status != 'selesai'` di `cariPeserta` — backend kembalikan SEMUA match (termasuk selesai), frontend yang memisahkan. Ini menjaga tes `data.length == 2` untuk `q=andi` tetap lulus.
- Tidak boleh ada footer `Co-Authored-By` di commit (memori `commit-no-co-authored`).
- `data.csv` & data nyata JANGAN di-push (memori `antrian-data-jangan-push`); file test DB `test-*.sqlite*` sudah gitignored.
- Mode terang: modal `showInfo` pakai `bg-white` + `text-gray-800` hardcoded Tailwind (di modal.js) — sudah kontras di kedua tema, TIDAK perlu override.

**Interfaces:**
- Consumes: `cariPeserta(q)` ([db.js:119](src/db.js#L119)) — dipakai route `/peserta/cari` ([routes.js:165](src/routes.js#L165)).
- Produces: `cariPeserta` kini mengembalikan field `status` & `waktu_selesai` per match. `tampilkanHasilPencarian(data)` ([peserta.js:189](public/js/peserta.js#L189)) kini memfilter & panggil `showInfo` bila perlu.

---

## Task 1: Backend — tambah field `status` & `waktu_selesai` ke `cariPeserta`

**Files:**
- Modify: `src/db.js` — fungsi `cariPeserta` (sekitar baris 119-129)
- Test: `test/routes.test.js` — tambah assertion field baru di test `cari?q=andi` yg sudah ada; tambah test baru utk verifikasi peserta selesai tetap direturn.

**Interfaces:**
- Produces: `cariPeserta(q)` return `[{ id, nama_lengkap, tempat_tanggal_lahir, no_seri, status, waktu_selesai }]`. `status` string (`'belum'|'menunggu'|'dipanggil'|'selesai'`), `waktu_selesai` string ISO-ish datetime atau `null`.

- [ ] **Step 1: Tambah assertion field `status` pada test `cari?q=andi` yg sudah ada**

Di `test/routes.test.js`, pada test `GET /api/peserta/cari?q=andi returns 200 + JSON array with matches` (baris ~64-73), tambahkan assertion setelah `const names = ...`:

```js
test('GET /api/peserta/cari?q=andi returns 200 + JSON array with matches', async () => {
  const res = await fetch(`${baseUrl}/api/peserta/cari?q=andi`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data));
  assert.equal(data.length, 2);
  const names = data.map((p) => p.nama_lengkap);
  assert.ok(names.includes('Andi Wijaya'));
  assert.ok(names.includes('Andi Saputra'));
  // Field baru: status & waktu_selesai harus ada di setiap match
  for (const p of data) {
    assert.ok(p.status !== undefined, 'field status harus ada di response cari');
  }
});
```

- [ ] **Step 2: Tambah test baru: peserta selesai TETAP direturn oleh cariPeserta (tidak di-filter backend)**

Tambah test baru di `test/routes.test.js` (setelah test `cari?q=andi`, sekitar baris 73). Butuh import `ambilNomorAntrian`, `updateStatus`, `setWaktuSelesai` di atas file:

```js
test('GET /api/peserta/cari tetap return peserta selesai (filter ada di frontend, bukan backend)', async () => {
  // Jadikan 'Andi Wijaya' selesai: ambil nomor → status selesai → set waktu_selesai
  const cari = await fetch(`${baseUrl}/api/peserta/cari?q=Andi Wijaya`);
  const peserta = (await cari.json())[0];
  const nomor = ambilNomorAntrian(peserta.id);
  updateStatus(nomor, 'selesai');
  setWaktuSelesai(nomor);

  // Cari lagi — Andi Wijaya HARUS tetap muncul (backend tidak filter selesai)
  const res = await fetch(`${baseUrl}/api/peserta/cari?q=Andi Wijaya`);
  const data = await res.json();
  const match = data.find((p) => p.nama_lengkap === 'Andi Wijaya');
  assert.ok(match, 'peserta selesai harus tetap direturn oleh cari (filter di frontend)');
  assert.equal(match.status, 'selesai');
  assert.ok(match.waktu_selesai, 'waktu_selesai harus terisi untuk peserta selesai');
});
```

Update baris import di atas `test/routes.test.js` (baris 7) jadi:
```js
import { initDb, insertPeserta, closeDb, initAuth, getPanitiaAuth, ambilNomorAntrian, updateStatus, setWaktuSelesai } from '../src/db.js';
```

- [ ] **Step 3: Jalankan test — harus FAIL (field `status` undefined)**

Run: `AUTH_SECRET=test-secret-key node --test test/routes.test.js`
Expected: test `cari?q=andi` FAIL (assertion `p.status !== undefined` gagal), test baru FAIL (`match` undefined krn belum ada import/logika). Konfirmasi merah sebelum implementasi.

- [ ] **Step 4: Implementasi — tambah `status` & `waktu_selesai` ke SELECT `cariPeserta`**

Di `src/db.js`, fungsi `cariPeserta` (baris 119-129), ubah SELECT:

```js
export function cariPeserta(q) {
  const stmt = db.prepare(`
    SELECT id, nama_lengkap, tempat_tanggal_lahir, no_seri, status, waktu_selesai
    FROM peserta
    WHERE nama_lengkap LIKE ? COLLATE NOCASE
       OR TRIM(no_seri) LIKE ? COLLATE NOCASE
    ORDER BY nama_lengkap
    LIMIT 20
  `);
  return stmt.all(`%${q}%`, `%${q}%`);
}
```

Hanya tambah `, status, waktu_selesai` setelah `no_seri`. Tidak ubah WHERE/ORDER/LIMIT.

- [ ] **Step 5: Jalankan test — harus PASS**

Run: `AUTH_SECRET=test-secret-key node --test test/routes.test.js`
Expected: semua test routes lulus, termasuk `cari?q=andi` (field `status` defined) & test baru (peserta selesai direturn dgn `status='selesai'` + `waktu_selesai` terisi).

- [ ] **Step 6: Jalankan full suite — pastikan tak ada regresi**

Run: `AUTH_SECRET=test-secret-key PANITIA_TOKEN_TTL_HOURS=8 PANITIA_DEFAULT_PASSWORD=panitiaP@G2026 node --test`
Expected: 65/65 lulus (63 lama + 2 baru).

- [ ] **Step 7: Commit**

```bash
git add src/db.js test/routes.test.js
git commit -m "feat(db): cariPeserta return field status & waktu_selesai"
```
(Tanpa footer Co-Authored-By.)

---

## Task 2: Frontend — filter `selesai` dari dropdown & tampilkan modal

**Files:**
- Modify: `public/js/peserta.js` — fungsi `tampilkanHasilPencarian` (sekitar baris 189-204)
- Test: manual (frontend DOM) — tidak ada test otomatis DOM; verifikasi via `node --check` + smoke server.

**Interfaces:**
- Consumes: response `cariPeserta` dari Task 1 (field `status`, `waktu_selesai`).
- Produces: `tampilkanHasilPencarian(data)` kini: bila `aktif.length === 0 && selesai.length > 0` → `showInfo` modal; else render hanya `aktif`.

- [ ] **Step 1: Tulis fungsi helper format tanggal (plain text, bukan HTML)**

Di `public/js/peserta.js`, tambah helper dekat helper lain (mis. setelah `timelapse`, sekitar baris 53). Fungsi ini format `waktu_selesai` (string dari SQLite `datetime()`, format `YYYY-MM-DD HH:MM:SS`) jadi plain-text "5 Mei 2026, 14.30":

```js
function formatTanggalSelesai(str) {
  if (!str) return '';
  // SQLite datetime('now','localtime') → "YYYY-MM-DD HH:MM:SS"
  const d = new Date(String(str).replace(' ', 'T'));
  if (isNaN(d)) return '';
  const bulan = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const tgl = d.getDate();
  const bln = bulan[d.getMonth()];
  const thn = d.getFullYear();
  const jam = String(d.getHours()).padStart(2, '0');
  const mnt = String(d.getMinutes()).padStart(2, '0');
  return `${tgl} ${bln} ${thn}, ${jam}.${mnt}`;
}
```

- [ ] **Step 2: Ubah `tampilkanHasilPencarian` — filter selesai & panggil modal**

Ganti seluruh fungsi `tampilkanHasilPencarian` (baris 189-204) jadi:

```js
function tampilkanHasilPencarian(data) {
  if (!data || data.length === 0) {
    hasilPencarian.innerHTML = '<div class="result-empty">Nama tidak ditemukan.<br>Coba kata kunci lain.</div>';
    return;
  }

  const selesai = data.filter(p => p.status === 'selesai');
  const aktif   = data.filter(p => p.status !== 'selesai');

  // Semua match sudah selesai → modal informasi, bukan dropdown kosong.
  // Peserta selesai tidak boleh ambil antrian lagi; cukup beri tahu.
  if (aktif.length === 0 && selesai.length > 0) {
    const p = selesai[0];
    inputNama.value = '';
    btnClear.style.display = 'none';
    hasilPencarian.innerHTML = '';
    const tgl = formatTanggalSelesai(p.waktu_selesai);
    showInfo({
      title: 'Sudah Mengambil Sertifikat',
      message: tgl
        ? `${p.nama_lengkap} sudah mengambil sertifikat pada ${tgl}.`
        : `${p.nama_lengkap} sudah mengambil sertifikat.`,
      type: 'success',
      confirmText: 'Tutup',
    });
    return;
  }

  if (aktif.length === 0) {
    hasilPencarian.innerHTML = '<div class="result-empty">Nama tidak ditemukan.<br>Coba kata kunci lain.</div>';
    return;
  }

  // Render hanya peserta yang belum selesai (yang masih bisa ambil antrian).
  hasilPencarian.innerHTML = aktif.map(p => `
    <button type="button" onclick="pilihPeserta(${p.id})" class="result-row">
      <span class="avatar" aria-hidden="true">${esc(initials(p.nama_lengkap))}</span>
      <span class="r-info">
        <span class="r-nama">${esc(p.nama_lengkap)}</span>
        <span class="r-seri">No. Seri: ${esc(p.no_seri || '-')}</span>
      </span>
    </button>
  `).join('');
}
```

Judul modal = "Sudah Mengambil Sertifikat" (ejaan baku Indonesia: "mengambil").

- [ ] **Step 3: Verifikasi syntax**

Run: `node --check public/js/peserta.js`
Expected: `SYNTAX_OK` (tidak ada output error).

- [ ] **Step 4: Smoke test server — pastikan cari masih 200 & response ada field `status`**

Run server:
```
AUTH_SECRET=test-secret-key PANITIA_DEFAULT_PASSWORD=panitiaP@G2026 PORT=3099 node server.js
```
Lalu curl (di shell lain / background):
```
curl -s "http://127.0.0.1:3099/api/peserta/cari?q=Andi" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s);console.log('count',a.length);console.log('fields',Object.keys(a[0]||{}))})"
```
Expected: `count 2` (atau jumlah peserta DB lokal), `fields` mengandung `status` & `waktu_selesai`. Lalu `TaskStop` server.

- [ ] **Step 5: Jalankan full test suite — pastikan tak ada regresi backend**

Run: `AUTH_SECRET=test-secret-key PANITIA_TOKEN_TTL_HOURS=8 PANITIA_DEFAULT_PASSWORD=panitiaP@G2026 node --test`
Expected: 65/65 lulus (frontend perubahan tak menyentuh backend, tapi pastikan).

- [ ] **Step 6: Commit**

```bash
git add public/js/peserta.js
git commit -m "feat(peserta): sembunyikan peserta selesai dari pencarian + modal info"
```
(Tanpa footer Co-Authored-By.)

---

## Self-Review Checklist (jalankan setelah semua task selesai)

- [ ] `cariPeserta` mengembalikan field `status` & `waktu_selesai` (test assertion).
- [ ] Peserta `selesai` TETAP direturn backend (tidak di-filter di query — test baru konfirmasi).
- [ ] Frontend: semua match `selesai` → modal `showInfo` muncul; ada match aktif → dropdown hanya yg aktif.
- [ ] Modal memakai plain-text `message` (tidak HTML, krn `escapeHtml`); tanggal diformat JS.
- [ ] Tidak ada footer `Co-Authored-By` di commit.
- [ ] Full suite 65/65 lulus.
