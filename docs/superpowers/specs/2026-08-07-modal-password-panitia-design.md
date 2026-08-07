# Design: Modal Password Panitia (Akses Terkunci)

**Tanggal**: 2026-08-07
**Status**: Approved (siap untuk implementation plan)
**Author**: Antrian Dev

## Ringkasan

Menambahkan pengaman password pada halaman `/panitia` dalam bentuk modal
elegan yang menampilkan logo UIN Raden Fatah & PPG. Pengguna harus memasukkan
password panitia yang benar sebelum dashboard dapat diakses. Validasi password
dilakukan **server-side** (hash bcrypt di SQLite) dengan token HMAC signed
stateless. Halaman tetap static, tetapi seluruh **endpoint aksi panitia**
dilindungi middleware `requirePanitia`.

## Konteks & Motivasi

Halaman `/panitia` saat ini dapat diakses publik tanpa autentikasi. Halaman ini
mengendalikan aksi sensitif (memanggil antrian, mengubah setting loket,
sinkronisasi data). Perlu pengaman agar tidak sembarang orang dapat membuka dan
mengoperasikan dashboard panitia.

Stack: Node.js + Express + Socket.io + SQLite, clean URLs (`/panitia` →
`panitia.html`). Design tokens gelap/emas konsisten lintas halaman. Sudah ada
`modal.js` reusable (showToast/showInfo/showConfirm) namun bertema putih
Tailwind — terpisah dari design tokens halaman utama.

## Keputusan Desain (dipilih via brainstorming)

| Aspek | Keputusan | Alasan |
|---|---|---|
| Lokasi validasi | Server-side (API) | Aman sungguhan; password tidak bocor di source |
| Sesi login | Tahan di localStorage + expiry 8 jam | Praktis untuk panitia yang pakai browser itu berulang |
| Sumber password | Hash bcrypt di DB + UI ganti password | Fleksibel, bisa ganti tanpa restart server |
| Jumlah akun | 1 akun panitia tunggal | Skenario 1 komputer panitia; sederhana |
| Endpoint dilindungi | Aksi panitia saja; GET read-only publik | Halaman publik (info.html, index.html) butuh GET antrian |
| Strategi token | HMAC signed token stateless + token_version | Stateless = no DB lookup per request; token_version invalidasi saat ganti password |
| Hash library | bcryptjs (pure JS) | No native build, mudah di VPS sumopod |
| Logout | Hapus token di client (stateless) | Server tidak track sesi; logout = hapus localStorage |

## Arsitektur

### Alur login

1. User buka `/panitia`. Halaman static tetap di-serve. Konten dashboard
   di-`hidden` via CSS; modal login ditampilkan otomatis di atasnya.
2. User masukkan password → `POST /api/panitia/auth { password }` → server
   `bcrypt.compare(password, hash_di_db)` → bila cocok, return `{ token, expiresAt }`.
3. Frontend simpan `panitia_token` + `panitia_token_exp` di localStorage. Tutup
   modal. Tampilkan dashboard (`initPanitiaDashboard()`).
4. Setiap fetch aksi panitia → header `Authorization: Bearer <token>` via
   `apiFetch()` helper.

### Verifikasi token (middleware `requirePanitia`)

- Parse `Authorization: Bearer xxx` → verifikasi HMAC signature.
- Cek `exp` > now (tolak expired).
- Cek `payload.ver === db.token_version` (tolak token lama pasca ganti password).
- Bila salah satu gagal → `401 { error: "Token tidak valid atau sesi habis" }`.
- Middleware dipasang **per-route** hanya di endpoint aksi panitia (bukan
  global), agar GET read-only publik tetap bebas.

### Token HMAC format

```
base64url(JSON{role:"panitia", ver, exp}).base64url(HMAC-SHA256(payload, AUTH_SECRET))
```

- `AUTH_SECRET` dari `process.env.AUTH_SECRET` — wajib di-set; bila kosong server
  refuse start dengan pesan jelas (tidak silent fallback random, karena restart
  akan invalid semua token).
- `exp` = `now + (PANITIA_TOKEN_TTL_HOURS || 8) jam`.
- `ver` = `token_version` dari DB saat login.

## Komponen

### Backend

**Tabel SQLite `panitia_auth`** (di `src/db.js`):

```sql
CREATE TABLE IF NOT EXISTS panitia_auth (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Constraint `CHECK (id = 1)` memaksa selalu 1 baris (akun tunggal). Functions:
- `getPanitiaAuth()` → `{ password_hash, token_version }` atau null.
- `setPanitiaPassword(newHash)` → update hash, `token_version++`, `updated_at`.
- `initAuth()` → seed baris id=1 bila kosong, hash dari
  `process.env.PANITIA_DEFAULT_PASSWORD` (fallback default aman).

**`src/auth.js`** (modul baru):
- `hashPassword(plain)` → bcrypt hash (cost 10).
- `comparePassword(plain, hash)` → boolean.
- `signToken({ ver })` → string token (exp 8 jam).
- `verifyToken(token)` → `{ ok, payload, expired }`.
- `requirePanitia` (Express middleware) — verifikasi token + version.
- Rate-limit login: `Map` in-memory `{ ip: { count, firstAttempt } }`, max 5
  gagal per 60 detik per IP, lewat → `429`. `loginRateLimit` middleware.

**`src/routes.js`** — endpoint baru + pasang middleware:
- `POST /api/panitia/auth` — body `{ password }` → 200 `{ token, expiresAt }` /
  401 / 429. Pesan generic "Password salah" (tidak bocor ada/tidak akun).
- `POST /api/panitia/change-password` — `requirePanitia`, body
  `{ currentPassword, newPassword }` → verifikasi current, validasi new (min 6
  char), hash, `setPanitiaPassword`, 200. Token lama langsung invalid (version
  naik). Frontend auto-logout.
- Middleware `requirePanitia` dipasang ke: `POST /sync/sheets`,
  `POST /sync/download`, `POST /antrian/panggil/:nomor`,
  `POST /antrian/panggil-ulang/:nomor`, `POST /antrian/selesai/:nomor`,
  `POST /settings/loket`.

### Frontend

**`public/js/auth-panitia.js`** (modul baru, dimuat sebelum `panitia.js`):
- `apiFetch(url, opts)` — bungkus `fetch`, otomatis tambah `Authorization:
  Bearer <token>`. Bila 401 → hapus token + tampilkan modal login + toast
  "Sesi habis, silakan login ulang". Di-expose ke `window`.
- `isAuthed()` — cek token ada & `exp > now`.
- `showLoginModal()` — render modal login ke overlay.
- `handleLogin(password)` — fetch auth, sukses simpan token + tutup modal +
  `initPanitiaDashboard()`.
- `handleChangePassword(...)` — modal ganti password.
- Saat load: bila `isAuthed()` → `initPanitiaDashboard()`; bila tidak →
  `showLoginModal()`.

**`public/js/panitia.js`** (ubah):
- Bungkus isi `DOMContentLoaded` callback lama ke `initPanitiaDashboard()`
  (tidak auto-panggil). Di-expose ke `window`.
- Ganti semua `fetch(...)` aksi panitia → `apiFetch(...)`. Daftar aksi yang
  diganti: panggil, panggil-ulang, selesai, settings/loket POST, sync/download,
  sync/sheets.
- Socket `panitia:join` dipindah ke dalam `initPanitiaDashboard()` (jangan join
  sebelum login).

**`public/panitia.html`** (ubah):
- Dashboard utama dibungkus `<div id="dash" hidden>` (hidden sampai login).
- Tambah element modal login (atau di-render JS).
- Tambah tombol "Ganti Password" di panel settings.
- Tambah `<script src="/js/auth-panitia.js"></script>` **sebelum** `panitia.js`.

### Visual modal login

Selaras design tokens gelap/emas halaman, BUKAN tema putih `modal.js`:
- Backdrop: `bg-black/60 backdrop-blur-md`, full-screen `z-[2000]` (di atas
  overlay lama `z-1000`).
- Kartu: tokens `--card`, `--card-border-strong`, `--gold`.
- Dua logo (UIN `logo-radenfatah.png` + PPG `ppg.png`) berdampingan dengan gap,
  `shadow-lg`, rounded.
- Eyebrow "Dashboard Panitia" (gold), heading "Akses Terkunci", hairline gold.
- Input password: ikon gembok kiri, tombol mata kanan (toggle visibility).
- Tombol "Buka Dashboard": gradient `--gold` → `--gold-bright`, hover glow
  `--gold-glow`, icon panah.
- Animasi masuk: kartu `scale(0.96)→scale(1)` + opacity 300ms ease-out.
- Error salah: input shake (keyframe horizontal) + border `--rose` + pesan kecil.
- Enter key submit, autofocus input, `role=dialog`, `aria-modal=true`.

## Endpoint yang dilindungi vs publik

**Dilindungi (wajib token panitia):**
- `POST /api/sync/sheets`
- `POST /api/sync/download`
- `POST /api/antrian/panggil/:nomor`
- `POST /api/antrian/panggil-ulang/:nomor`
- `POST /api/antrian/selesai/:nomor`
- `POST /api/settings/loket`
- `POST /api/panitia/change-password` (juga wajib token panitia)

**Publik (tanpa token):** semua GET (`/peserta/cari`, `/peserta/all`,
`/peserta/:id`, `/antrian/status/:nomor`, `/antrian/daftar`, `/settings/loket`,
`/statistik`, `/info-antrian`, `/tts`) + `POST /antrian/ambil` (pengambilan nomor
oleh peserta umum).

## Keamanan

- Password di-hash bcrypt (cost 10) — `bcryptjs` pure JS.
- `AUTH_SECRET` wajib di `.env`; bila kosong server refuse start.
- Rate-limit login: 5 gagal/60 detik per IP, `Map` in-memory (single-process).
- Token di localStorage — rentan XSS, tapi app sudah escape HTML di `modal.js`
  & tidak render HTML tak-percaya. Trade-off dapat diterima untuk app internal.
- `change-password` wajib token valid + verifikasi `currentPassword`.
- Halaman static tetap publik — konten dashboard di-`hidden` CSS sampai login.
  Ini bukan pengaman halaman sejati (struktur HTML bisa di-inspect), tetapi API
  yang dilindungi adalah sumber kebenaran data. Tanpa token valid, tidak ada aksi
  yang bisa dilakukan.

## Error handling

- `POST /api/panitia/auth`: 401 (password salah), 429 (rate-limited), 500
  (server error). Pesan generic, tidak bocor ada/tidak akun.
- `requirePanitia` middleware: 401 saat token hilang/expired/version mismatch.
- `apiFetch`: 401 → bersihkan token + modal login + toast. Network error →
  toast "Koneksi bermasalah".
- `change-password`: 400 (validasi min 6 char, confirm match), 401 (current
  salah), 401 (token invalid).

## Testing

Pakai DB test (`test-database.sqlite`, sudah ada) supaya tidak ganggu data nyata:
- `test/auth.test.js`: hash/compare password; signToken/verifyToken (valid,
  expired, tampered, version-mismatch); `requirePanitia` middleware (401 tanpa
  token, 200 dengan token valid, 401 version lama).
- `test/routes-panitia-auth.test.js`: `POST /api/panitia/auth` sukses + salah +
  rate-limit; endpoint aksi panitia 401 tanpa token, 200 dengan token;
  `change-password` flow + invalidasi token lama.

## File yang berubah / dibuat

**Baru:**
- `src/auth.js`
- `public/js/auth-panitia.js`
- `test/auth.test.js`
- `test/routes-panitia-auth.test.js`

**Ubah:**
- `src/db.js` — tabel `panitia_auth` + `getPanitiaAuth`/`setPanitiaPassword`/`initAuth`.
- `src/routes.js` — endpoint auth + `requirePanitia` ke endpoint aksi.
- `public/panitia.html` — dashboard di-hidden, modal login, tombol ganti password, script auth-panitia.js.
- `public/js/panitia.js` — `initPanitiaDashboard()` wrapping, `fetch`→`apiFetch`, socket join dipindah.
- `.env.example` — tambah `AUTH_SECRET`, `PANITIA_DEFAULT_PASSWORD`, `PANITIA_TOKEN_TTL_HOURS`.
- `package.json` — tambah dependency `bcryptjs`.

## Out of scope (YAGNI)

- Multi-user panitia (username+password per user) — terlalu kompleks untuk
  skenario 1 komputer panitia.
- Cookie httpOnly session — antagonis dengan arsitektur static + fetch, dan
  bermasalah lintas-origin via Cloudflare.
- Refresh token / sliding expiry — TTL 8 jam cukup; re-login sederhana.
- Revoke sesi aktif via UI admin — stateless; ganti password = invalidasi total.
