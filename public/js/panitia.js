// socket dibuat di initPanitiaDashboard() setelah login panitia.
// Jangan join sebelum auth — mencegah koneksi socket bocor ke server
// saat halaman dibuka oleh user belum login.
let socket;

// Guard double-init: initPanitiaDashboard() bisa dipanggil ulang
// (login → logout → login lagi). Tanpa guard, setInterval menumpuk
// dan socket.io connect berkali-kali. Setelah init pertama, abaikan
// panggilan berikutnya.
let dashboardInitialized = false;

let currentFilter = 'menunggu';
let searchQuery = '';

// ============================================================
// TTS — Text-to-Speech bahasa Indonesia (via Google TTS server-side)
// Sama seperti di sisi peserta, supaya panitia juga mendengar
// konfirmasi suara saat memanggil / memanggil ulang antrian.
// Dipicu dari klik tombol (user gesture) → aman dari autoplay policy.
// Gaya bandara: chime "ding-dong" di awal, lalu audio 2x dengan jeda.
// ============================================================
let audioPanggilan = null; // instance Audio yang sedang/sudah diputar
let panggilanTimeout = null; // timer jeda antar repetisi (gaya bandara)

// Chime "ding-dong" khas bandara via Web Audio API (tanpa file eksternal).
// Dua nada turun (E5 → C5) dengan decay halus — terdengar seperti bel paging.
let chimeCtx = null;
function putarChime() {
  try {
    chimeCtx = chimeCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = chimeCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const nada = [
      { f: 659.25, t: 0.00, d: 0.45 }, // E5 "ding"
      { f: 523.25, t: 0.38, d: 0.55 }, // C5 "dong"
    ];
    nada.forEach(n => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.f;
      // Envelope: cepat naik, lambat turun (bell-like)
      gain.gain.setValueAtTime(0.0001, now + n.t);
      gain.gain.exponentialRampToValueAtTime(0.35, now + n.t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + n.t);
      osc.stop(now + n.t + n.d + 0.05);
    });
  } catch (e) { /* abaikan — chime opsional, TTS tetap jalan */ }
}

async function ucapkanPanggilan(nomor, loket) {
  if (nomor === null || nomor === undefined || loket === null || loket === undefined) return;
  // Stop audio sebelumnya kalau ada (panggilan baru menimpa yang lama)
  if (panggilanTimeout) { clearTimeout(panggilanTimeout); panggilanTimeout = null; }
  if (audioPanggilan) {
    audioPanggilan.pause();
    audioPanggilan = null;
  }
  try {
    // Bunyikan chime di awal (sekali, sebelum TTS) — gaya panggilan bandara.
    putarChime();
    const url = `/api/tts?nomor=${encodeURIComponent(nomor)}&loket=${encodeURIComponent(loket)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('TTS gagal');
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);

    // Putar audio dua kali dengan jeda 1.5 detik (gaya panggilan bandara).
    let putaran = 0;
    const JEDA_MS = 1500;
    const MAX_PUTARAN = 2;
    const putarSekali = () => {
      const a = new Audio(objectUrl);
      audioPanggilan = a;
      a.onended = () => {
        putaran++;
        if (putaran < MAX_PUTARAN) {
          panggilanTimeout = setTimeout(() => {
            panggilanTimeout = null;
            if (audioPanggilan === a) putarSekali();
          }, JEDA_MS);
        } else {
          URL.revokeObjectURL(objectUrl);
        }
      };
      return a.play();
    };
    await putarSekali();
  } catch (err) {
    console.error('Gagal memutar panggilan:', err.message);
  }
}

// === State loket (counter) ===
let jumlahLoket = 3;        // dari server, default 3
let myLoket = null;         // counter panitia ini (persist di localStorage)

const LOKET_KEY = 'panitia_loket';

function loadMyLoket() {
  const v = localStorage.getItem(LOKET_KEY);
  const n = parseInt(v, 10);
  myLoket = (Number.isInteger(n) && n >= 1) ? n : null;
}

function saveMyLoket(n) {
  myLoket = n;
  if (n === null) localStorage.removeItem(LOKET_KEY);
  else localStorage.setItem(LOKET_KEY, String(n));
}

function renderLoketDropdown() {
  const sel = document.getElementById('select-loket');
  sel.innerHTML = '<option value="">-- pilih --</option>';
  for (let i = 1; i <= jumlahLoket; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `Ruangan ${i}`;
    sel.appendChild(opt);
  }
  // Restore choice jika masih valid
  if (myLoket !== null && myLoket <= jumlahLoket) {
    sel.value = String(myLoket);
  } else {
    sel.value = '';
    if (myLoket !== null) saveMyLoket(null); // invalidated by reduced jumlah
  }
}

async function loadLoketSettings() {
  const res = await fetch('/api/settings/loket');
  const data = await res.json();
  jumlahLoket = data.jumlah_loket;
  document.getElementById('input-jumlah-loket').value = jumlahLoket;
  renderLoketDropdown();
}

// === Statistik & daftar antrian ===
async function loadStatistik() {
  const res = await fetch('/api/statistik');
  const data = await res.json();
  document.getElementById('stat-total').textContent = data.total;
  document.getElementById('stat-menunggu').textContent = data.menunggu;
  document.getElementById('stat-dipanggil').textContent = data.dipanggil;
  document.getElementById('stat-selesai').textContent = data.selesai;
  // Update badge jumlah di tiap tab
  updateTabCounts(data);
}

// === Tab bar — indikator tab aktif + badge jumlah ===
function updateTabButtons(active) {
  ['menunggu', 'dipanggil', 'selesai'].forEach(tab => {
    const btn = document.getElementById(`tab-${tab}`);
    if (!btn) return;
    btn.classList.toggle('active', tab === active);
  });
}

function updateTabCounts(stat) {
  const map = { menunggu: stat.menunggu, dipanggil: stat.dipanggil, selesai: stat.selesai };
  for (const tab of ['menunggu', 'dipanggil', 'selesai']) {
    const el = document.getElementById(`tab-count-${tab}`);
    if (el) el.textContent = map[tab] ?? 0;
  }
}

async function loadDaftar(status) {
  currentFilter = status;
  updateTabButtons(status);
  const res = await fetch(`/api/antrian/daftar?status=${status}`);
  let data = await res.json();

  // Apply filter pencarian di sisi client (cari nama / no seri / nomor antrian)
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    data = data.filter(p =>
      String(p.nama_lengkap || '').toLowerCase().includes(q) ||
      String(p.no_seri || '').toLowerCase().includes(q) ||
      String(p.nomor_antrian || '').includes(q)
    );
  }

  const container = document.getElementById('daftar-antrian');

  if (data.length === 0) {
    container.innerHTML = '<p class="empty-state">Tidak ada antrian</p>';
    return;
  }

  container.innerHTML = data.map(p => {
    let actions = '';
    // Tombol panggil ulang (speaker) — muncul untuk peserta yang sudah dipanggil
    // Ikon speaker + label, tooltip, hover lift
    const replayBtn = (p.status === 'dipanggil' && p.counter !== null && p.counter !== undefined)
      ? `<button onclick="putarPanggilan(${p.nomor_antrian}, ${p.counter})" title="Putar panggilan lagi" aria-label="Putar panggilan lagi untuk nomor ${p.nomor_antrian}" class="btn-action amber">
           <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
           <span>Panggil Ulang</span>
         </button>`
      : '';

    if (status === 'menunggu') {
      actions = `
        <button onclick="panggil(${p.nomor_antrian})" class="btn-action primary">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l18-8-8 18-2-7-8-3z"/></svg>
          <span>Panggil</span>
        </button>
        <button onclick="selesai(${p.nomor_antrian})" class="btn-action emerald">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
          <span>Selesai</span>
        </button>
      `;
    } else if (status === 'dipanggil') {
      actions = `
        ${replayBtn}
        <button onclick="selesai(${p.nomor_antrian})" class="btn-action emerald">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
          <span>Selesai</span>
        </button>
      `;
    }

    // Badge counter untuk peserta yang sudah dipanggil ke counter tertentu
    const counterBadge = (p.status === 'dipanggil' && p.counter !== null && p.counter !== undefined)
      ? `<span class="counter-badge">Ruangan ${p.counter}</span>`
      : '';

    // Info jumlah dipanggil (berapa kali peserta dipanggil)
    const jumlahTxt = (p.status === 'dipanggil' && p.jumlah_dipanggil > 0)
      ? `<div class="meta-line gold">🔔 dipanggil ${p.jumlah_dipanggil}x</div>`
      : '';

    // Timelapse waktu sejak peserta masuk (font kecil)
    const timelapseTxt = p.waktu_daftar ? timelapse(p.waktu_daftar) : '';

    // Info waktu selesai + durasi proses (hanya untuk status selesai)
    const selesaiTxt = (p.status === 'selesai' && p.waktu_selesai)
      ? formatSelesai(p.waktu_selesai, p.waktu_daftar)
      : '';

    // Untuk baris selesai, letakkan timelapse + info selesai di kolom kanan
    // supaya tidak menumpuk di kiri (selesai tidak punya tombol aksi).
    const isSelesai = status === 'selesai';
    const leftMeta = isSelesai ? '' : `${timelapseTxt ? `<div class="meta-line">⏱ ${timelapseTxt}</div>` : ''}${jumlahTxt}`;
    const rightMeta = isSelesai
      ? `<div class="list-meta">${timelapseTxt ? `<div class="meta-line">⏱ ${timelapseTxt}</div>` : ''}${selesaiTxt}</div>`
      : '';

    // Untuk tab Menunggu & Dipanggil: no seri ditempatkan di zona tengah (font besar, mudah dibaca).
    // Untuk Selesai: seri tetap di list-info (kiri) karena tidak ada tombol aksi & layout berbeda.
    const seriCenter = !isSelesai
      ? `<div class="seri-center">
           <span class="seri-label">No Seri</span>
           <span class="seri-badge">${esc(p.no_seri)}</span>
           <button onclick="salinNoSeri('${esc(p.no_seri)}', event)" title="Salin No Seri" aria-label="Salin nomor seri ${esc(p.no_seri)}" class="copy-btn">
             <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
           </button>
         </div>`
      : '';
    const seriInInfo = isSelesai
      ? `<div class="seri-row">
           <span class="seri-label">No Seri</span>
           <span class="seri-badge">${esc(p.no_seri)}</span>
           <button onclick="salinNoSeri('${esc(p.no_seri)}', event)" title="Salin No Seri" aria-label="Salin nomor seri ${esc(p.no_seri)}" class="copy-btn">
             <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
           </button>
         </div>`
      : '';

    return `
      <div class="list-row${!isSelesai ? ' has-seri-center' : ''}">
        <div class="list-main">
          <div class="list-num">#${p.nomor_antrian}</div>
          <div class="list-info">
            <div class="list-name">${esc(p.nama_lengkap)}${counterBadge}</div>
            ${seriInInfo}
            ${leftMeta}
          </div>
        </div>
        ${seriCenter}
        ${isSelesai ? rightMeta : `<div class="list-actions">${actions}</div>`}
      </div>
    `;
  }).join('');
}

// Timelapse — "baru saja", "5 menit lalu", "2 jam 15 menit lalu"
function timelapse(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now - d;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'baru saja';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHour = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  if (diffHour < 24) return remMin > 0 ? `${diffHour} jam ${remMin} menit lalu` : `${diffHour} jam lalu`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} hari lalu`;
}

// Format jam HH:MM dari string datetime DB
function formatJam(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Format durasi antara waktu_daftar → waktu_selesai: "5 menit", "1 jam 5 menit"
function formatDurasi(daftar, selesai) {
  if (!daftar || !selesai) return '';
  const d1 = new Date(String(daftar).replace(' ', 'T'));
  const d2 = new Date(String(selesai).replace(' ', 'T'));
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return '';
  const diffMs = d2 - d1;
  if (diffMs < 0) return '';
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '< 1 menit';
  if (diffMin < 60) return `${diffMin} menit`;
  const diffHour = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  return remMin > 0 ? `${diffHour} jam ${remMin} menit` : `${diffHour} jam`;
}

// Info waktu selesai untuk kartu status selesai
// Tampilkan jam selesai + durasi proses (dari ambil antrian sampai selesai)
function formatSelesai(waktuSelesai, waktuDaftar) {
  const jam = formatJam(waktuSelesai);
  const durasi = formatDurasi(waktuDaftar, waktuSelesai);
  if (!jam && !durasi) return '';
  const parts = [];
  if (jam) parts.push(`✅ Selesai ${jam}`);
  if (durasi) parts.push(`⏱ Proses ${durasi}`);
  return `<div class="selesai-tag">${parts.join(' · ')}</div>`;
}

// Escape HTML untuk mencegah XSS saat menyisipkan data tidak tepercaya (nama, no_seri) ke innerHTML
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Salin no seri ke clipboard + feedback singkat pada tombol
async function salinNoSeri(noseri, ev) {
  if (!noseri) return;
  try {
    await navigator.clipboard.writeText(noseri);
  } catch {
    // Fallback untuk browser tanpa Clipboard API / konteks non-HTTPS
    const ta = document.createElement('textarea');
    ta.value = noseri;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  }
  // Feedback visual pada tombol yang diklik
  const btn = ev && ev.currentTarget;
  if (btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 1200);
  }
}

// Panggil ulang dari dashboard panitia — trigger animasi + audio di halaman peserta
async function putarPanggilan(nomor, _loket) {
  try {
    const res = await apiFetch(`/api/antrian/panggil-ulang/${nomor}`, { method: 'POST' });
    const data = await res.json();
    if (data.error) {
      showToast('Gagal memanggil ulang: ' + data.error, 'error');
      return;
    }
    // Peserta akan animasi + putar audio via socket event (tidak perlu audio di sini)
    showToast(`Panggilan ulang nomor #${nomor} dikirim ke peserta`, 'success');
  } catch (err) {
    // 401: apiFetch sudah menampilkan modal login + toast 'Sesi habis'.
    // Jangan tampilkan toast kedua yang redundan di sini.
    if (err.message === 'Unauthorized') return;
    showToast('Gagal memanggil ulang: ' + err.message, 'error');
  }
}

async function panggil(nomor) {
  if (myLoket === null) {
    showInfo({
      title: 'Ruangan Belum Dipilih',
      message: 'Silakan pilih ruangan Anda di pojok kanan atas terlebih dahulu sebelum memanggil antrian.',
      type: 'warning',
      confirmText: 'Mengerti',
    });
    return;
  }
  try {
    await apiFetch(`/api/antrian/panggil/${nomor}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ counter: myLoket }),
    });
    loadDaftar(currentFilter);
    loadStatistik();
  } catch (err) {
    // 401: apiFetch sudah tampilkan modal login + toast 'Sesi habis'.
    if (err.message === 'Unauthorized') return;
    showToast('Gagal memanggil: ' + err.message, 'error');
  }
}

async function selesai(nomor) {
  showConfirm({
    title: 'Konfirmasi Selesai',
    message: `Tandai sertifikat nomor antrian #${nomor} sudah diambil?`,
    type: 'success',
    confirmText: 'Ya, Selesai',
    cancelText: 'Batal',
    onConfirm: async () => {
      try {
        await apiFetch(`/api/antrian/selesai/${nomor}`, { method: 'POST' });
        loadDaftar(currentFilter);
        loadStatistik();
        showToast(`Antrian #${nomor} ditandai selesai`, 'success');
      } catch (err) {
        // 401: apiFetch sudah tampilkan modal login + toast 'Sesi habis'.
        if (err.message === 'Unauthorized') return;
        showToast('Gagal menandai selesai: ' + err.message, 'error');
      }
    },
  });
}

// === Real-time updates & init ===
// Dipanggil auth-panitia.js setelah login sukses (atau saat sudah authed
// saat reload). Sebelum auth, jangan connect socket / join / pasang
// listener — mencegah koneksi realtime bocor ke dashboard belum login.
window.initPanitiaDashboard = function initPanitiaDashboard() {
  // Guard double-init: cegah setInterval menumpuk + socket connect
  // berkali-kali bila user login → logout → login lagi.
  if (dashboardInitialized) return;
  dashboardInitialized = true;

  // Inisialisasi socket setelah login (jangan join sebelum auth)
  socket = io();
  socket.emit('panitia:join');

  // Socket listeners (dipindah dari top-level)
  socket.on('antrian:baru', () => {
    if (currentFilter === 'menunggu') loadDaftar(currentFilter);
    loadStatistik();
  });

  socket.on('statistik:update', () => {
    loadStatistik();
  });

  socket.on('antrian:selesai', () => {
    loadDaftar(currentFilter);
    loadStatistik();
  });

  socket.on('antrian:panggil', () => {
    // Refresh daftar agar badge counter muncul di dashboard lain
    if (currentFilter === 'dipanggil' || currentFilter === 'menunggu') {
      loadDaftar(currentFilter);
    }
    loadStatistik();
  });

  socket.on('settings:loket', (data) => {
    // Panitia lain mengubah jumlah loket — re-render dropdown
    jumlahLoket = data.jumlah_loket;
    document.getElementById('input-jumlah-loket').value = jumlahLoket;
    renderLoketDropdown();
  });

  // Data loads (dari DOMContentLoaded lama)
  loadMyLoket();
  loadLoketSettings();
  loadStatistik();
  loadDaftar('menunggu');

  // Update timelapse tiap 30 detik tanpa reload penuh
  setInterval(() => {
    // Re-render daftar untuk update timelapse (data sudah di-cache di client)
    loadDaftar(currentFilter);
  }, 30000);

  // Pencarian daftar antrian (debounce 250ms)
  let cariTimeout;
  document.getElementById('input-cari-antrian').addEventListener('input', (e) => {
    clearTimeout(cariTimeout);
    const v = e.target.value.trim();
    cariTimeout = setTimeout(() => {
      searchQuery = v;
      loadDaftar(currentFilter);
    }, 250);
  });

  document.getElementById('select-loket').addEventListener('change', (e) => {
    const v = e.target.value;
    saveMyLoket(v === '' ? null : parseInt(v, 10));
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('panel-settings').classList.toggle('hidden');
  });

  document.getElementById('btn-simpan-loket').addEventListener('click', async () => {
    const n = parseInt(document.getElementById('input-jumlah-loket').value, 10);
    const status = document.getElementById('settings-status');
    try {
      const res = await apiFetch('/api/settings/loket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jumlah_loket: n }),
      });
      const data = await res.json();
      if (data.error) {
        status.textContent = data.error;
        status.className = 'settings-status is-error';
      } else {
        status.textContent = 'Tersimpan';
        status.className = 'settings-status is-ok';
        jumlahLoket = data.jumlah_loket;
        renderLoketDropdown();
        setTimeout(() => { status.textContent = ''; }, 2000);
      }
    } catch (err) {
      // 401: apiFetch sudah tampilkan modal login + toast 'Sesi habis'.
      if (err.message === 'Unauthorized') return;
      status.textContent = 'Gagal menyimpan: ' + err.message;
      status.className = 'settings-status is-error';
    }
  });

  // Sync — download data terbaru dari Google Sheets publik → import ke SQLite (skip duplikat)
  document.getElementById('btn-sync').addEventListener('click', async () => {
    const btn = document.getElementById('btn-sync');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ Downloading...';
    try {
      const res = await apiFetch('/api/sync/download', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        showInfo({
          title: 'Gagal Sync',
          message: data.error,
          type: 'error',
          confirmText: 'Tutup',
        });
      } else {
        showInfo({
          title: 'Sync Berhasil',
          message: data.message,
          type: 'success',
          confirmText: 'Selesai',
        });
        // Refresh statistik & daftar setelah sync
        loadStatistik();
        loadDaftar(currentFilter);
      }
    } catch (err) {
      // 401: apiFetch sudah tampilkan modal login + toast 'Sesi habis'.
      if (err.message === 'Unauthorized') return;
      showToast('Gagal sync: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });
};

// Expose
window.loadDaftar = loadDaftar;
window.panggil = panggil;
window.selesai = selesai;
window.putarPanggilan = putarPanggilan;
window.ucapkanPanggilan = ucapkanPanggilan;
window.salinNoSeri = salinNoSeri;
