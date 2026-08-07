# Pencarian Peserta by No. Seri Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Halaman peserta bisa mencari dirinya lewat no. seri maupun nama lewat satu kotak pencarian pintar.

**Architecture:** Satu kotak input mengirim parameter `q` ke endpoint `/api/peserta/cari`. Backend menjalankan satu query `WHERE nama_lengkap LIKE '%q%' OR TRIM(no_seri) LIKE 'q%'` — nama cocok sebagai substring, no. seri sebagai prefix. Tidak ada deteksi digit/huruf; kedua kondisi dievaluasi bersamaan.

**Tech Stack:** Node.js (ESM), Express, better-sqlite3, vanilla JS frontend, `node:test`.

## Global Constraints

- Bahasa UI & copy: Indonesia (sesuai halaman yang ada).
- Jangan tambah footer `Co-Authored-By: Claude` di pesan commit (preferensi user).
- Jangan push `data.csv` / data nyata (sudah gitignore).
- Parameter pencarian berubah dari `nama` → `q`; endpoint `/api/peserta/cari` hanya dipakai `public/js/peserta.js` + test (panitia/data.html tidak memakainya) — tidak perlu fallback kompatibilitas.
- Pertahankan fungsi `getPesertaByNama` (masih dipakai `test/db.test.js`); `cariPeserta` jadi satu-satunya pemanggil produksi.
- Minimal 2 karakter untuk mencari (guard di route, sama seperti perilaku lama).

---

## File Structure

| File | Tanggung jawab | Aksi |
|---|---|---|
| `src/db.js` | Akses data. Tambah `cariPeserta(q)` — query nama OR no_seri. | Modify (tambah fungsi) |
| `src/routes.js` | API. Handler `/peserta/cari` baca `req.query.q` → `cariPeserta(q)`. | Modify |
| `public/js/peserta.js` | Frontend. URL fetch pakai `?q=`. | Modify (1 baris) |
| `public/index.html` | Frontend. Label/placeholder/hint pencarian. | Modify (3 teks) |
| `test/routes.test.js` | Test. Update call site + 2 test baru (cari by seri). | Modify |

---

### Task 1: Fungsi `cariPeserta(q)` di db.js

**Files:**
- Modify: `src/db.js` (tambah fungsi baru setelah `getPesertaByNama`, ~baris 109)
- Test: `test/db.test.js`

**Interfaces:**
- Produces: `cariPeserta(q: string) -> Array<{id, nama_lengkap, tempat_tanggal_lahir, no_seri}>` — query nama substring OR no_seri prefix, LIMIT 20, urut nama.

- [ ] **Step 1: Write the failing test**

Tambah di `test/db.test.js` (setelah blok import, di area `beforeEach`/test yang sudah ada). Pastikan import `cariPeserta` ditambahkan ke import statement di baris 4:

```js
// Baris 4 — tambahkan cariPeserta ke import:
import { initDb, closeDb, getPesertaByNama, getPesertaById, ambilNomorAntrian, getAntrianByNomor, getDaftarAntrian, updateStatus, setWaktuSelesai, getStatistik, insertPeserta, setCounter, getJumlahLoket, setJumlahLoket, cariPeserta } from '../src/db.js';
```

Lalu tambah test ini (tempatkan di antara test yang ada, di luar `beforeEach`):

```js
test('cariPeserta by no_seri prefix mengembalikan peserta yang cocok', () => {
  insertPeserta('Andi Wijaya', 'Surabaya, 5 Mei 1990', '0013001', 2);
  insertPeserta('Andi Saputra', 'Malang, 6 Juni 1991', '0013002', 3);
  insertPeserta('Budi Santoso', 'Jakarta, 1 Januari 1992', '0013003', 4);

  // Prefix seri unik → 1 hasil exact
  const satu = cariPeserta('0013001');
  assert.equal(satu.length, 1);
  assert.equal(satu[0].nama_lengkap, 'Andi Wijaya');
  assert.equal(satu[0].no_seri, '0013001');

  // Prefix seri parsial → beberapa hasil
  const parsial = cariPeserta('0013');
  assert.ok(parsial.length >= 2);
  const nama = parsial.map(p => p.nama_lengkap);
  assert.ok(nama.includes('Andi Wijaya'));
  assert.ok(nama.includes('Andi Saputra'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx node --test test/db.test.js`
Expected: FAIL — `cariPeserta is not defined` (belum di-export dari `src/db.js`).

- [ ] **Step 3: Write minimal implementation**

Tambah di `src/db.js` setelah fungsi `getPesertaByNama` (baris ~109):

```js
export function cariPeserta(q) {
  const stmt = db.prepare(`
    SELECT id, nama_lengkap, tempat_tanggal_lahir, no_seri
    FROM peserta
    WHERE nama_lengkap LIKE ? COLLATE NOCASE
       OR TRIM(no_seri) LIKE ? COLLATE NOCASE
    ORDER BY nama_lengkap
    LIMIT 20
  `);
  return stmt.all(`%${q}%`, `${q}%`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx node --test test/db.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "feat(db): tambah cariPeserta(q) — cari by nama OR no_seri"
```

---

### Task 2: Route `/peserta/cari` pakai `q` + `cariPeserta`

**Files:**
- Modify: `src/routes.js` (import baris 1-18 + handler baris ~135)
- Test: `test/routes.test.js`

**Interfaces:**
- Consumes: `cariPeserta(q)` dari Task 1.
- Produces: `GET /api/peserta/cari?q=<query>` → `Array<Peserta>` atau `[]` bila `q` < 2 karakter / kosong.

- [ ] **Step 1: Write the failing tests**

Di `test/routes.test.js`, tambahkan `cariPeserta` TIDAK perlu (route pakai via handler). Tapi tambah import `cariPeserta` TIDAK diperlukan di test ini. Yang diperlukan: update call site `?nama=` → `?q=`, lalu tambah 2 test baru.

Pertama, ganti SEMUA `?nama=` jadi `?q=` di file `test/routes.test.js` (8 kemunculan — verifikasi count dengan: `grep -c "?nama=" test/routes.test.js`). Sebagai contoh, baris ~57:

```js
// SEBELUM:
const res = await fetch(`${baseUrl}/api/peserta/cari?nama=andi`);
// SESUDAH:
const res = await fetch(`${baseUrl}/api/peserta/cari?q=andi`);
```

Lakukan untuk semua 8 kemunculan (`?nama=andi`, `?nama=a`, `?nama=Andi Wijaya`, `?nama=Budi`, dll).

Lalu tambah 2 test baru di akhir file (sebelum penutup):

```js
test('GET /api/peserta/cari?q=<no_seri> return hasil berdasarkan no seri', async () => {
  const res = await fetch(`${baseUrl}/api/peserta/cari?q=0013001`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data));
  assert.equal(data.length, 1);
  assert.equal(data[0].nama_lengkap, 'Andi Wijaya');
  assert.equal(data[0].no_seri, '0013001');
});

test('GET /api/peserta/cari?q=<prefix seri> return semua peserta dengan prefix itu', async () => {
  const res = await fetch(`${baseUrl}/api/peserta/cari?q=0013`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data));
  assert.ok(data.length >= 2);
  const names = data.map(p => p.nama_lengkap);
  assert.ok(names.includes('Andi Wijaya'));
  assert.ok(names.includes('Andi Saputra'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx node --test test/routes.test.js`
Expected: FAIL — test `?q=0013001` mengembalikan `[]` (route masih baca `req.query.nama`, jadi `q` tidak terbaca → guard `!q` return `[]`).

- [ ] **Step 3: Write minimal implementation**

Di `src/routes.js`:

Baris 1-18 — tambahkan `cariPeserta` ke import dari `./db.js`:

```js
import {
  getPesertaByNama,
  cariPeserta,
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
  incrementJumlahDipanggil,
} from './db.js';
```

Handler `/peserta/cari` (baris ~135) — ganti isi:

```js
  // Cari peserta (autocomplete) — by nama OR no_seri via satu kotak pintar
  router.get('/peserta/cari', (req, res) => {
    const q = req.query.q;
    if (!q || q.length < 2) {
      return res.json([]);
    }
    const hasil = cariPeserta(q);
    res.json(hasil);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx node --test test/routes.test.js`
Expected: PASS — semua test (termasuk 2 baru).

- [ ] **Step 5: Commit**

```bash
git add src/routes.js test/routes.test.js
git commit -m "feat(api): /peserta/cari pakai param q — cari by nama OR no_seri"
```

---

### Task 3: Frontend — URL fetch pakai `?q=`

**Files:**
- Modify: `public/js/peserta.js:172`

**Interfaces:**
- Consumes: `GET /api/peserta/cari?q=` dari Task 2.

- [ ] **Step 1: Edit baris fetch**

Di `public/js/peserta.js` baris ~172, ganti:

```js
// SEBELUM:
const res = await fetch(`/api/peserta/cari?nama=${encodeURIComponent(nama)}`);
// SESUDAH:
const res = await fetch(`/api/peserta/cari?q=${encodeURIComponent(nama)}`);
```

Variabel lokal `nama` tetap (nama variabel, bukan parameter URL) — minimisasi diff.

- [ ] **Step 2: Verifikasi manual (tidak ada test otomatis untuk frontend)**

Jalankan server: `npm run dev` lalu buka `http://localhost:3000`. Di kotak pencarian:
- Ketik `0013` (prefix seri) → muncul result rows dengan nama + `No. Seri: 0013xxx`.
- Ketik `Mayayana` → muncul result rows berdasarkan nama.
- Ketik 1 karakter → tidak ada hasil (guard < 2).

Stop server (Ctrl+C).

- [ ] **Step 3: Commit**

```bash
git add public/js/peserta.js
git commit -m "feat(peserta): frontend cari pakai ?q= (nama OR no_seri)"
```

---

### Task 4: Frontend — label, placeholder, hint

**Files:**
- Modify: `public/index.html:498-508`

- [ ] **Step 1: Edit tiga teks di index.html**

Baris ~498 — field label:

```html
<!-- SEBELUM: -->
<label class="field-label" for="input-nama">Masukkan Nama</label>
<!-- SESUDAH: -->
<label class="field-label" for="input-nama">Masukkan Nama / No. Seri</label>
```

Baris ~503 — placeholder input:

```html
<!-- SEBELUM: -->
<input type="text" id="input-nama" placeholder="Ketik nama lengkap…" autocomplete="off" aria-describedby="input-nama-hint">
<!-- SESUDAH: -->
<input type="text" id="input-nama" placeholder="Ketik nama atau no. seri…" autocomplete="off" aria-describedby="input-nama-hint">
```

Baris ~508 — sr-only hint:

```html
<!-- SEBELUM: -->
<span class="sr-only" id="input-nama-hint">Ketik minimal dua huruf nama Anda, lalu pilih dari daftar yang muncul.</span>
<!-- SESUDAH: -->
<span class="sr-only" id="input-nama-hint">Ketik minimal dua karakter nama atau no. seri Anda, lalu pilih dari daftar yang muncul.</span>
```

- [ ] **Step 2: Verifikasi manual**

Jalankan `npm run dev`, buka `http://localhost:3000`. Pastikan:
- Label kotak: "Masukkan Nama / No. Seri".
- Placeholder: "Ketik nama atau no. seri…".
- Cari by seri (`0013`) dan by nama (`Mayayana`) tetap jalan dari Task 3.

Stop server.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(peserta): label & hint kotak pencarian mendukung no. seri"
```

---

### Task 5: Full test suite + final verification

**Files:**
- (verifikasi saja, tidak ada edit)

- [ ] **Step 1: Run seluruh test suite**

Run: `npm test`
Expected: PASS — semua file test (`db.test.js`, `routes.test.js`) lulus tanpa regressi.

- [ ] **Step 2: Verifikasi end-to-end manual**

Jalankan `npm run dev`, buka `http://localhost:3000`. Skenario:
1. Cari by nama: ketik `Mayayana` → muncul, klik → konfirmasi → ambil nomor.
2. Cari by seri: ketik `0011649` (atau no_seri lain dari `data.csv`) → muncul 1 hasil exact, klik → konfirmasi.
3. Cari prefix seri: ketik `0011` → muncul beberapa hasil.
4. Edge: ketik 1 karakter → tidak ada hasil.

Stop server.

- [ ] **Step 3: Pastikan tidak ada perubahan yang belum di-commit**

Run: `git status`
Expected: `nothing to commit, working tree clean` (atau hanya file yang tidak terkait seperti `logo-radenfatah.png` yang memang belum di-track sebelumnya).

---

## Self-Review

**1. Spec coverage:**
- ✅ Fungsi `cariPeserta(q)` di `db.js` — Task 1.
- ✅ Route `/peserta/cari` baca `q` — Task 2.
- ✅ Frontend URL `?q=` — Task 3.
- ✅ Label/placeholder/hint — Task 4.
- ✅ Test: update call site + 2 test baru — Task 2 (Step 1).
- ✅ Error path: guard `< 2` karakter, fetch gagal, hasil kosong — semua sudah ada (dipertahankan, tidak diubah).

**2. Placeholder scan:** Tidak ada TBD/TODO. Semua step berisi kode konkret. ✅

**3. Type consistency:**
- `cariPeserta(q: string)` — signature konsisten di Task 1 (definisi) & Task 2 (konsumsi via route). ✅
- Route membaca `req.query.q` — konsisten dengan frontend yang kirim `?q=`. ✅
- Return type `Array<{id, nama_lengkap, tempat_tanggal_lahir, no_seri}>` — cocok dengan SELECT clause. ✅

Tidak ada issue. Plan siap.
