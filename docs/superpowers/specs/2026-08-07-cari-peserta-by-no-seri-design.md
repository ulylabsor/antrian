# Desain: Pencarian Peserta by No. Seri (kotak pintar)

**Tanggal:** 2026-08-07
**Status:** Approved (brainstorming)
**Latar belakang:** Halaman peserta (`public/index.html`) saat ini hanya bisa mencari peserta berdasarkan nama. Peserta ingin bisa mencari dirinya juga lewat **no. seri** (mis. `0011649`) — data 7-digit numerik yang sudah tersimpan di kolom `no_seri`.

## Tujuan

Satu kotak pencarian pintar di halaman ambil-nomor antrian: ketik nama → cari by nama, ketik no. seri → cari by no. seri. Tanpa toggle/tab/kotak kedua — sistem otomatis meng-cover keduanya.

## Keputusan UX

**Satu kotak pintar (auto-detect), tanpa deteksi eksplisit.** Frontend mengirim satu parameter `q`; backend menjalankan dua kondisi `LIKE` sekaligus (nama OR no_seri). Tidak ada deteksi digit-vs-huruf di mana pun — semua kasus (nama murni, seri murni, seri parsial) ditangani seragam dan robust terhadap edge case (nama bertahun, seri berspasi).

## Arsitektur & alur data

```
input box → debounce 300ms → GET /api/peserta/cari?q=...
   → cariPeserta(q)  [fungsi baru di db.js]
   → SELECT ... WHERE nama_lengkap LIKE '%q%' OR TRIM(no_seri) LIKE 'q%'
   → array peserta → render result rows (sudah tampilkan no_seri)
```

Satu kotak, satu endpoint, satu fungsi DB. Render baris hasil TIDAK diubah — baris sudah menampilkan `No. Seri` sebagai baris kedua, jadi saat cari by seri, nama + seri yang cocok langsung terlihat.

## Perubahan backend

### `src/db.js` — fungsi baru `cariPeserta(q)`

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

- **Nama** = substring (`%q%`) — konsisten dengan perilaku lama (`getPesertaByNama`).
- **No. seri** = prefix (`q%`) — mencerminkan cara nomor dibaca, menghindari false-match digit tengah. `TRIM()` menjaga dari spasi awal/akhir di data.
- `getPesertaByNama` lama dipertahankan — masih dipakai oleh `test/db.test.js`; `cariPeserta` jadi satu-satunya pemanggil produksi.

### `src/routes.js` — handler `/peserta/cari` (baris ~135)

```js
router.get('/peserta/cari', (req, res) => {
  const q = req.query.q;
  if (!q || q.length < 2) return res.json([]);
  res.json(cariPeserta(q));
});
```

Parameter berubah dari `nama` → `q`. Endpoint ini hanya dipakai `public/js/peserta.js:172` + test (diverifikasi via grep — panitia/data.html tidak memakainya). Tidak ada konsumer lain, jadi switch bersih tanpa fallback `nama`.

## Perubahan frontend

### `public/index.html` (baris ~498–508)

- Field label: `Masukkan Nama` → `Masukkan Nama / No. Seri`
- Placeholder: `Ketik nama lengkap…` → `Ketik nama atau no. seri…`
- sr-only hint: `Ketik minimal dua huruf nama Anda, lalu pilih dari daftar yang muncul.` → `Ketik minimal dua karakter nama atau no. seri Anda, lalu pilih dari daftar yang muncul.`

### `public/js/peserta.js` (baris ~172)

```js
const res = await fetch(`/api/peserta/cari?q=${encodeURIComponent(nama)}`);
```

Variabel lokal `nama` dipertahankan (nama variabel, bukan parameter URL) — minimisasi diff.

## Perubahan test

### `test/routes.test.js`

- Update 8 call site `?nama=` → `?q=` (baris ~57, 68, 75, 83, 99, 145, 200, dan satu lainnya — verifikasi via grep saat implementasi).
- Tambah 2 test baru:
  - Cari by seri exact: `?q=0013001` → panjang 1, `nama_lengkap === 'Andi Wijaya'`.
  - Cari by seri prefix: `?q=0013` → panjang ≥ 2, memuat `Andi Wijaya` dan `Andi Saputra`.

Data seed test (baris 38–40) sudah punya no_seri (`0013001`, `0013002`, `0013003`) — langsung bisa dipakai tanpa ubah seed.

## Error handling

Tidak ada error path baru. Path yang ada tetap:
- `q` < 2 karakter → `[]` (guard di route, sama seperti dulu).
- Fetch gagal → render `Gagal mencari. Periksa koneksi lalu coba lagi.` (sudah ada di `peserta.js`).
- Hasil kosong → render `Nama tidak ditemukan.` (sudah ada di `tampilkanHasilPencarian`).

## Di luar scope (YAGNI)

- Highlight teks yang cocok di result row.
- Exact-match boosting (serial unik → full-7-digit sudah return 1 hasil via prefix match).
- Mode pencarian terpisah / toggle / kotak kedua.
- Pencarian fuzzy / typo tolerance.

## File yang diubah

| File | Perubahan |
|---|---|
| `src/db.js` | Tambah `cariPeserta(q)`; pertahankan `getPesertaByNama` |
| `src/routes.js` | Handler `/peserta/cari` pakai `q` + `cariPeserta` |
| `public/index.html` | Label, placeholder, sr-only hint |
| `public/js/peserta.js` | URL fetch `?nama=` → `?q=` |
| `test/routes.test.js` | Update call site + 2 test baru |
