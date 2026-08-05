# Aplikasi Antrian Pengambilan Sertifikat

Aplikasi web untuk mengelola antrian pengambilan sertifikat peserta.

## Setup

### 1. Google Service Account

1. Buka [Google Cloud Console](https://console.cloud.google.com/)
2. Buat project baru atau pilih project yang ada
3. Enable **Google Sheets API**
4. Buat **Service Account** (IAM & Admin → Service Accounts)
5. Buat key (JSON), download
6. Share spreadsheet ke email service account (editor permission)
7. Copy email & private key ke `.env`

### 2. Install & Config

```bash
npm install
cp .env.example .env
# Edit .env dengan credentials Anda
```

### 3. Import Data

```bash
npm run import
```

### 4. Generate QR Code

```bash
npm run qr
```

### 5. Jalankan Server

```bash
npm run dev
```

- Peserta: http://localhost:3000
- Panitia: http://localhost:3000/panitia.html

## Deploy

Deploy ke Railway/Render:
1. Push ke GitHub
2. Connect repo ke Railway/Render
3. Set environment variables
4. Deploy
5. Set `APP_URL` ke URL produksi
6. Generate QR code baru: `npm run qr`

## Testing

```bash
npm test
```
