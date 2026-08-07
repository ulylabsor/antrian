# Sembunyikan Peserta Selesai dari Pencarian — Design

Tanggal: 2026-08-07

## Konteks & Masalah

Saat ini [cariPeserta(q)](src/db.js) mengembalikan SEMUA peserta yang cocok, terlepas status. Frontend [peserta.js](public/js/peserta.js) menampilkan semuanya di dropdown, lalu `pilihPeserta(id)` menampilkan **tiket/card status** untuk yang sudah punya nomor (termasuk `selesai` → tampil "Selesai").

Akibatnya, peserta yang **sudah mengambil sertifikat** (status `selesai`) tetap muncul di daftar pencarian dan, kalau dipilih, menampilkan kartu tiket — bukan modal informasi. Permintaan: sembunyikan mereka dari daftar pencarian; ganti dengan modal informasi.

## Keputusan

**Trigger modal (dipilih user): "Modal jika semua cocok selesai"**
- Peserta `selesai` disembunyikan dari dropdown.
- Jika nama/kata kunci yg diketik HANYA cocok dgn peserta `selesai` (tidak ada match lain), tampilkan modal "Peserta sudah mengambil sertifikat".
- Jika match campuran (ada `selesai` + ada `belum`/`menunggu`/`dipanggil`), hanya yg belum `selesai` tampil di dropdown. Tidak ada modal (yg selesai diam-diam disisihkan).
- Jika tidak ada match sama sekali → tetap "Nama tidak ditemukan" (perilaku lama).

## Arsitektur

**Pendekatan: filter di frontend, bukan backend.** Backend `cariPeserta` tetap mengembalikan semua match TAPI menambah field `status` ke SELECT, supaya frontend bisa memisahkan. Alasan:
1. **Tidak merusak kontrak tes backend** — [routes.test.js](test/routes.test.js) cek `data.length == 2` untuk `q=andi` (keduanya `belum`, panjang tak berubah) dan cek nama/no_seri (field `status` extra tidak mengganggu).
2. **Satu endpoint, tidak ada fetch kedua** untuk cek jumlah selesai.
3. **Logika trigger "semua selesai"** butuh tahu mana yg selesai — field `status` di response cukup; tidak perlu query terpisah.

### Perubahan

**1. [src/db.js](src/db.js) — `cariPeserta(q)` tambah kolom `status`:**
```sql
SELECT id, nama_lengkap, tempat_tanggal_lahir, no_seri, status
FROM peserta
WHERE nama_lengkap LIKE ? COLLATE NOCASE
   OR TRIM(no_seri) LIKE ? COLLATE NOCASE
ORDER BY nama_lengkap
LIMIT 20
```
Hanya menambah `status` ke SELECT. Tidak ada filter WHERE — backend tetap kembalikan semua match (termasuk `selesai`) supaya frontend bisa membedakan.

**2. [public/js/peserta.js](public/js/peserta.js) — `tampilkanHasilPencarian(data)`:**
```js
function tampilkanHasilPencarian(data) {
  if (!data || data.length === 0) {
    hasilPencarian.innerHTML = '<div class="result-empty">Nama tidak ditemukan.<br>Coba kata kunci lain.</div>';
    return;
  }

  const selesai = data.filter(p => p.status === 'selesai');
  const aktif   = data.filter(p => p.status !== 'selesai');

  // Semua match sudah selesai → modal, bukan dropdown kosong
  if (aktif.length === 0 && selesai.length > 0) {
    const p = selesai[0];
    inputNama.value = '';
    btnClear.style.display = 'none';
    hasilPencarian.innerHTML = '';
    showInfo({
      title: 'Sudah Mengambil Sertifikat',
      message: `${p.nama_lengkap} sudah mengambil sertifikat pada ${formatTanggal(p.waktu_selesai)}.`,
      type: 'success',
      confirmText: 'Tutup',
    });
    return;
  }

  if (aktif.length === 0) { // selesai.length === 0 juga (seharusnya tak mungkin krn data.length>0)
    hasilPencarian.innerHTML = '<div class="result-empty">Nama tidak ditemukan.<br>Coba kata kunci lain.</div>';
    return;
  }

  // Render hanya yg belum selesai
  hasilPencarian.innerHTML = aktif.map(p => `...`).join('');
}
```

**Catatan `waktu_selesai`:** saat ini `cariPeserta` TIDAK mengembalikan `waktu_selesai`. Agar modal bisa tampilkan tanggal ambil sertifikat, tambahkan `waktu_selesai` ke SELECT juga. Atau sederhanakan pesan modal jadi tanpa tanggal (cukup nama). Pilihan di Task plan.

### Tipe modal & `showInfo`

`showInfo` didefinisikan di [modal.js](public/js/modal.js) (dimuat sebelum peserta.js). Kontrak: `{ title, message, type, confirmText, onConfirm }`, `type: 'success'|'error'|'info'|'warning'`. **Penting:** `message` di-escape via `escapeHtml` → **plain text saja, tidak bisa HTML**. Modal selalu `bg-white` + `text-gray-800` (hardcoded Tailwind) → kontras baik di kedua tema, **bukan masalah readability auth-card**. Pakai `type: 'success'` (hijau) agar modal "sudah ambil" positif.

`waktu_selesai` diformat di JS jadi plain-text string (mis. "5 Mei 2026, 14:30") lalu disisipkan ke `message` — bukan HTML.

### Kompatibilitas & Risiko

- **Tes backend `data.length == 2` utk `q=andi`:** kedua match `belum`, `selesai` filter frontend tak menyentuh panjang. **Lulus.**
- **Tes cek nama/no_seri:** field extra `status`/`waktu_selesai` tidak mengganggu assert field lain. **Lulus.**
- **Data peserta di field `waktu_selesai`:** `getDaftarAntrian` & statistik sudah baca kolom ini → kolomnya ada di schema (db.js line 54). Tidak perlu migrasi.
- **`getPesertaByNama`** (fungsi lama, mungkin tak dipakai frontend lagi) — TIDAK diubah (di luar scope; bukan bagian alur cari yg dipakai).
- **Mode terang:** modal `showInfo` memakai token desain — sudah adaptif tema (tidak perlu override khusus, beda dgn auth-card).

## Yang TIDAK Diubah

- Endpoint `/api/peserta/cari` ([routes.js](src/routes.js)) — kontrak route tak berubah, hanya isi response dapat field `status`/`waktu_selesai` extra.
- `pilihPeserta(id)` — tetap ada (utk kasus match campuran, peserta `belum` dipilih normal). Cabang `status === 'selesai'` di `pilihPeserta` jadi dead code utk alur pencarian baru, tapi TIDAK dihapus (masih relevan bila ada jalur lain menuju seorang peserta selesai — mis. direct link / refresh dgn nomor). Aman ditinggalkan.
- Halaman data (`/peserta/all`) — TETAP tampilkan semua termasuk selesai (itu dashboard data lengkap, bukan pencarian pengambilan).

## Testing

- Tambah tes backend: `cariPeserta` mengembalikan field `status` (assert `data[0].status` defined).
- Tambah tes backend: peserta `selesai` tetap masuk response `cariPeserta` (tidak di-filter backend).
- Verifikasi manual frontend: ketik nama peserta selesai → modal muncul; ketik nama campuran → dropdown hanya yg aktif.
