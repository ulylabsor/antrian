# Aplikasi Antrian Pengambilan Sertifikat

**Tanggal:** 2026-08-05
**Status:** Approved

---

## Ringkasan

Aplikasi web untuk mengelola antrian pengambilan sertifikat peserta program Serdik. Peserta datang ke lokasi, scan QR code, pilih nama, konfirmasi data, dan mendapat nomor antrian. Panitia melihat daftar antrian real-time, memanggil peserta, dan menandai selesai. Data tersinkron dengan Google Sheets.

---

## Konteks & Kebutuhan

### Data Source
- **Google Sheets:** https://docs.google.com/spreadsheets/d/1vefx3SssNHYpjOVb3g37BgnNUfHklS7IMtFQKQpujm4/
- **Total peserta:** ~984 orang
- **Kolom:** Timestamp, NAMA LENGKAP, TEMPAT TANGGAL LAHIR, NO SERI

### Alur Pengguna

**Peserta:**
1. Scan QR code di lokasi pengambilan
2. Cari nama (autocomplete)
3. Konfirmasi data (nama, TTL, no seri)
4. Ambil nomor antrian
5. Lihat status antrian real-time

**Panitia:**
1. Buka dashboard
2. Lihat statistik (total, menunggu, dipanggil, selesai)
3. Lihat daftar antrian real-time
4. Klik "Panggil" untuk memanggil peserta
5. Klik "Selesai" saat sertifikat diambil
6. Data otomatis sync ke Google Sheets

---

## Arsitektur

```
┌─────────────────────────────────────────────────────────────┐
│                        PESERTA                               │
│  Scan QR → Cari Nama → Konfirmasi Data → Lihat No Antrian   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      SERVER (Node.js)                        │
│  Express.js + SQLite + Socket.io + Google Sheets API        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        PANITIA                               │
│  Dashboard → Daftar Antrian → Panggil → Selesai → Sync      │
└─────────────────────────────────────────────────────────────┘
```

---

## Teknologi Stack

| Komponen | Teknologi | Keterangan |
|----------|-----------|------------|
| Runtime | Node.js 20+ | Backend server |
| Framework | Express.js | REST API |
| Database | SQLite (better-sqlite3) | File-based, zero config |
| Real-time | Socket.io | WebSocket untuk live updates |
| Frontend | Vanilla JS + Tailwind CSS | Mobile-friendly |
| Google Sheets | googleapis | Read/write via service account |
| Hosting | Railway / Render | Free tier deployment |

---

## Database Schema

### Tabel: `peserta`

| Kolom | Tipe | Keterangan |
|-------|------|------------|
| id | INTEGER PRIMARY KEY | Auto increment |
| nama_lengkap | TEXT | Dari Google Sheets |
| tempat_tanggal_lahir | TEXT | Dari Google Sheets |
| no_seri | TEXT UNIQUE | Dari Google Sheets |
| nomor_antrian | INTEGER | Auto-generate saat konfirmasi |
| status | TEXT | `belum` / `menunggu` / `dipanggil` / `selesai` |
| waktu_daftar | DATETIME | Timestamp konfirmasi |
| waktu_selesai | DATETIME | Timestamp sertifikat diambil |
| sheets_row | INTEGER | Row number di Google Sheets |

### Tabel: `antrian_counter`

| Kolom | Tipe | Keterangan |
|-------|------|------------|
| id | INTEGER PRIMARY KEY | Always 1 (single row) |
| last_number | INTEGER | Nomor antrian terakhir |

---

## API Endpoints

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/` | Halaman peserta (index.html) |
| GET | `/panitia` | Dashboard panitia (panitia.html) |
| GET | `/api/peserta/cari?nama=xxx` | Cari peserta (autocomplete) |
| GET | `/api/peserta/:id` | Get detail peserta |
| POST | `/api/antrian/ambil` | Ambil nomor antrian |
| GET | `/api/antrian/status/:nomor` | Cek status antrian |
| GET | `/api/antrian/daftar` | Daftar antrian (panitia) |
| POST | `/api/antrian/panggil/:nomor` | Panggil peserta |
| POST | `/api/antrian/selesai/:nomor` | Selesai + sync Sheets |
| GET | `/api/statistik` | Statistik antrian |

---

## Socket.io Events

| Event | Dari | Ke | Deskripsi |
|-------|------|-----|-----------|
| `antrian:baru` | Server | Panitia | Peserta baru ambil nomor |
| `antrian:panggil` | Server | Peserta + Panitia | Peserta dipanggil |
| `antrian:selesai` | Server | Panitia | Peserta selesai |
| `statistik:update` | Server | Semua | Update counter |

---

## Struktur Folder

```
antrian/
├── server.js              # Entry point
├── package.json
├── .env                   # Config (Google credentials)
├── database.sqlite        # SQLite file
├── public/
│   ├── index.html         # Halaman peserta
│   ├── panitia.html       # Dashboard panitia
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── peserta.js
│       └── panitia.js
├── src/
│   ├── db.js              # Database setup & queries
│   ├── sheets.js          # Google Sheets sync
│   ├── routes.js          # API endpoints
│   └── socket.js          # Socket.io handlers
└── scripts/
    └── import-data.js     # Import dari Sheets ke SQLite
```

---

## Google Sheets Sync

### Kolom Tambahan di Spreadsheet

| Kolom | Keterangan |
|-------|------------|
| STATUS | `menunggu` / `dipanggil` / `selesai` |
| NOMOR_ANTRIAN | Nomor antrian peserta |
| WAKTU_AMBIL | Timestamp sertifikat diambil |

### Sync Behavior

- **Read:** Import data peserta ke SQLite saat setup
- **Write:** Update status saat panitia klik "Selesai"

---

## Environment Variables

```env
PORT=3000
GOOGLE_SHEETS_ID=1vefx3SssNHYpjOVb3g37BgnNUfHklS7IMtFQKQpujm4
GOOGLE_SERVICE_ACCOUNT_EMAIL=xxx@xxx.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...
```

---

## Deployment

1. **Setup Google Service Account**
   - Buat credentials di Google Cloud Console
   - Share spreadsheet ke service account email

2. **Deploy ke Railway/Render**
   - Push code ke GitHub
   - Connect ke hosting platform
   - Set environment variables
   - Deploy

3. **Import Data**
   - Run `node scripts/import-data.js`

4. **Generate QR Code**
   - QR code berisi URL aplikasi
   - Print dan tempel di lokasi

---

## Fitur Opsional (Future)

- Notifikasi suara saat dipanggil
- Export laporan ke Excel
- Multi-event support
- Mode offline (PWA)
