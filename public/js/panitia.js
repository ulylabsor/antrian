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

// ——— Animasi: diff per-tab untuk entrance & flash elegan ———
const prevNomorsByStatus = { menunggu: new Set(), dipanggil: new Set(), selesai: new Set() };
const firstLoadByStatus = { menunggu: true, dipanggil: true, selesai: true };
let pendingHighlight = null; // { nomor, flash: 'gold'|'emerald'|'blue'|'amber' } — dipakai lintas loadDaftar (mis. panggil → flash di tab tujuan)

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

  // Hitung set baru untuk diff — data yang baru muncul dikasih entrance + highlight
  const nextSet = new Set(data.map(p => p.nomor_antrian));
  const prevSet = prevNomorsByStatus[status] ?? new Set();
  const isFirstLoad = firstLoadByStatus[status] === true;

  if (data.length === 0) {
    container.innerHTML = '<p class="empty-state">Tidak ada antrian</p>';
    prevNomorsByStatus[status] = nextSet;
    firstLoadByStatus[status] = false;
    return;
  }

  container.innerHTML = data.map((p, idx) => {
    const nomor = p.nomor_antrian;
    const isNew = !prevSet.has(nomor);
    const shouldEnter = isFirstLoad || isNew;
    let flashCls = '';
    if (pendingHighlight && pendingHighlight.nomor === nomor && (pendingHighlight.forStatus === status || !pendingHighlight.forStatus)) {
      const m = { gold: 'row-flash-gold', emerald: 'row-flash-emerald', blue: 'row-flash-blue', amber: 'row-flash-amber' };
      flashCls = m[pendingHighlight.flash] || '';
    } else if (!isFirstLoad && isNew) {
      const m2 = { menunggu: 'row-flash-gold', dipanggil: 'row-flash-emerald', selesai: 'row-flash-blue' };
      flashCls = m2[status] || '';
    }
    const pulseCls = shouldEnter ? ' row-pulse' : '';
    let enterCls = '';
    if (shouldEnter) {
      if (status === 'menunggu') {
        // Menunggu = kebalikan dari tutup selesai: membuka elegan (fold-open) + pulse halus
        enterCls = ` row-open${pulseCls}`;
      } else {
        const bounceCls = status === 'selesai' ? ' row-bounce' : '';
        enterCls = ` row-enter${pulseCls}${bounceCls}`;
      }
    }
    const flashWithSpace = flashCls ? ` ${flashCls}` : '';
    const stagger = shouldEnter ? ` style="animation-delay:${Math.min(idx * 48, 380)}ms"` : '';
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
      // Toggle berkas Siap/Belum — checklist panitia, tetap di tab Menunggu.
      // Default Belum (0): berkas belum ditemukan; panitia toggle ke Siap saat berkas ketemu.
      const isSiap = Number(p.berkas_siap) === 1;
      const berkasBtn = isSiap
        ? `<button onclick="toggleBerkas(${p.nomor_antrian}, 0)" title="Berkas siap — klik untuk ubah ke Belum" aria-label="Berkas siap untuk nomor ${p.nomor_antrian}, klik untuk ubah ke belum" class="btn-action berkas-siap is-on">
             <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg>
             <span>Siap</span>
           </button>`
        : `<button onclick="toggleBerkas(${p.nomor_antrian}, 1)" title="Berkas belum — klik untuk tandai Siap" aria-label="Berkas belum untuk nomor ${p.nomor_antrian}, klik untuk tandai siap" class="btn-action berkas-siap">
             <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
             <span>Belum</span>
           </button>`;
      // Panggil hanya aktif bila berkas sudah Siap — cegah peserta dipanggil sebelum berkas ditemukan.
      const panggilBtn = isSiap
        ? `<button onclick="panggil(${p.nomor_antrian})" class="btn-action primary" title="Berkas siap — klik untuk panggil peserta" aria-label="Panggil nomor ${p.nomor_antrian}">
             <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l18-8-8 18-2-7-8-3z"/></svg>
             <span>Panggil</span>
           </button>`
        : `<button class="btn-action primary is-disabled" disabled title="Berkas belum siap — tandai Siap dulu sebelum panggil" aria-label="Panggil nomor ${p.nomor_antrian} dinonaktifkan karena berkas belum siap" aria-disabled="true">
             <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l18-8-8 18-2-7-8-3z"/></svg>
             <span>Panggil</span>
           </button>`;
      actions = `
        ${panggilBtn}
        ${berkasBtn}
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

    const rowAttr = `data-nomor="${p.nomor_antrian}"`;
    const rowExtra = `${enterCls}${flashWithSpace}`;
    return `
      <div class="list-row${!isSelesai ? ' has-seri-center' : ''}${rowExtra}" ${rowAttr}${stagger}>
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
  // Simpan snapshot untuk diff & stagger di load berikutnya
  prevNomorsByStatus[status] = nextSet;
  firstLoadByStatus[status] = false;
  // Bersihkan highlight setelah dipakai sekali (biar tidak flash lagi di refresh berikutnya)
  if (pendingHighlight) {
    const stillPending = data.some(p => p.nomor_antrian === pendingHighlight.nomor);
    if (stillPending || pendingHighlight.consumed) pendingHighlight = null;
    else pendingHighlight.consumed = true;
  }
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
    // Flash amber elegan pada baris yang di-panggil-ulang (tetap di tab Dipanggil)
    flashRow(nomor, 'amber');
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
    const res = await apiFetch(`/api/antrian/panggil/${nomor}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ counter: myLoket }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Backend enforce berkas siap — beri pesan yang jelas
      const msg = data.error || `Gagal memanggil (HTTP ${res.status})`;
      if (data.error && String(data.error).toLowerCase().includes('berkas')) {
        showInfo({ title: 'Berkas Belum Siap', message: msg, type: 'warning', confirmText: 'Mengerti' });
      } else {
        showToast(msg, 'error');
      }
      return;
    }
    // Animasi tutup elegan dulu (fold), baru ganti data — biar tidak hilang tiba-tiba
    await animateRowClose(nomor, 'emerald');
    pendingHighlight = { nomor, flash: 'emerald', forStatus: 'dipanggil' };
    await loadDaftar(currentFilter);
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
        const rowForClose = document.querySelector(`[data-nomor="${nomor}"]`);
        const doCloseFirst = !!rowForClose && currentFilter === 'dipanggil';
        // Tutup elegan: di Dipanggil → fold dulu baru hit API (optimistic elegan);
        // di tab lain → API dulu lalu fold (row belum ada di DOM tab aktif).
        let closePromise = null;
        if (doCloseFirst) closePromise = animateRowClose(nomor, 'blue');
        const apiPromise = apiFetch(`/api/antrian/selesai/${nomor}`, { method: 'POST' });
        if (closePromise) await Promise.all([closePromise, apiPromise]);
        else { await apiPromise; await animateRowClose(nomor, 'blue'); }
        // Selesai → baris pindah ke tab Selesai; kasih highlight biru elegan saat tab itu dibuka
        pendingHighlight = { nomor, flash: 'blue', forStatus: 'selesai' };
        await loadDaftar(currentFilter);
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

function queueToggleAnim(berkasBtn, panggilBtn, toSiap) {
  if (!berkasBtn) return;
  berkasBtn.classList.remove('just-toggled');
  void berkasBtn.offsetWidth; // reflow agar animasi bisa dipicu ulang
  berkasBtn.classList.add('just-toggled');
  berkasBtn.addEventListener('animationend', () => berkasBtn.classList.remove('just-toggled'), { once: true });
  if (panggilBtn && toSiap) {
    panggilBtn.classList.remove('panggil-ready');
    void panggilBtn.offsetWidth;
    panggilBtn.classList.add('panggil-ready');
    panggilBtn.addEventListener('animationend', () => panggilBtn.classList.remove('panggil-ready'), { once: true });
  }
}

async function toggleBerkas(nomor, nextVal) {
  const rowEl = document.querySelector(`[data-nomor="${nomor}"]`);
  let prevBerkasOn = null;
  let prevPanggilDisabled = null;
  let berkasBtnRef = null;
  if (rowEl) {
    berkasBtnRef = rowEl.querySelector('.berkas-siap');
    const panggilBtn0 = rowEl.querySelector('.btn-action.primary');
    prevBerkasOn = berkasBtnRef ? berkasBtnRef.classList.contains('is-on') : null;
    prevPanggilDisabled = panggilBtn0 ? panggilBtn0.hasAttribute('disabled') : null;
    applyBerkasOptimistic(rowEl, nomor, nextVal);
    // Animasi toggle instant + spinner syncing — tanpa nunggu network
    const berkasBtn = rowEl.querySelector('.berkas-siap');
    const panggilBtn = rowEl.querySelector('.btn-action.primary');
    queueToggleAnim(berkasBtn, panggilBtn, nextVal === 1);
    if (berkasBtn) {
      berkasBtn.classList.add('is-syncing');
      berkasBtn.setAttribute('aria-busy', 'true');
    }
  }
  try {
    const res = await apiFetch(`/api/antrian/berkas/${nomor}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ berkas_siap: nextVal }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    // Sinkron dengan server (aman dari race bila panitia lain ubah bersamaan)
    clearBerkasSyncing();
    await loadDaftar(currentFilter);
  } catch (err) {
    clearBerkasSyncing();
    if (err.message === 'Unauthorized') return;
    // Rollback: kembalikan tombol ke state sebelum klik (tanpa innerHTML agar aman XSS).
    if (rowEl && prevBerkasOn !== null && prevPanggilDisabled !== null) {
      const rollbackVal = prevBerkasOn ? 1 : 0;
      applyBerkasOptimistic(rowEl, nomor, rollbackVal);
    }
    if (!String(err.message).toLowerCase().includes('berkas')) {
      showToast('Gagal ubah status berkas: ' + err.message, 'error');
    } else {
      showToast(err.message, 'error');
    }
    // Tetap sinkron ulang agar tidak stuck di state optimistic yang salah
    await loadDaftar(currentFilter);
  } finally {
    clearBerkasSyncing();
  }
}

function clearBerkasSyncing() {
  document.querySelectorAll('.berkas-siap.is-syncing').forEach(b => {
    b.classList.remove('is-syncing');
    b.removeAttribute('aria-busy');
  });
}

function animateRowClose(nomor, tint) {
  const row = document.querySelector(`[data-nomor="${nomor}"]`);
  if (!row) return Promise.resolve();
  // Kunci tinggi agar max-height transition presisi, lalu fold
  row.style.maxHeight = `${row.offsetHeight}px`;
  void row.offsetWidth;
  const cls = tint === 'emerald' ? 'row-exit-emerald' : tint === 'blue' ? 'row-exit-blue' : tint === 'gold' ? 'row-exit-gold' : '';
  row.classList.add('row-exit');
  if (cls) row.classList.add(cls);
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(); };
    row.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 560);
  });
}

function flashRow(nomor, kind) {
  const row = document.querySelector(`[data-nomor="${nomor}"]`);
  if (!row) return;
  const cls = kind === 'amber' ? 'row-flash-amber' : kind === 'blue' ? 'row-flash-blue' : kind === 'emerald' ? 'row-flash-emerald' : 'row-flash-gold';
  row.classList.remove('row-flash-gold', 'row-flash-emerald', 'row-flash-blue', 'row-flash-amber');
  void row.offsetWidth;
  row.classList.add(cls);
  row.addEventListener('animationend', () => row.classList.remove(cls), { once: true });
}

function applyBerkasOptimistic(rowEl, nomor, nextVal) {
  const isSiap = nextVal === 1;
  const berkasBtn = rowEl.querySelector('.berkas-siap');
  const panggilBtn = rowEl.querySelector('.btn-action.primary');
  if (berkasBtn) {
    berkasBtn.classList.toggle('is-on', isSiap);
    berkasBtn.setAttribute('onclick', `toggleBerkas(${nomor}, ${isSiap ? 0 : 1})`);
    berkasBtn.setAttribute('title', isSiap ? 'Berkas siap — klik untuk ubah ke Belum' : 'Berkas belum — klik untuk tandai Siap');
    berkasBtn.setAttribute('aria-label', isSiap ? `Berkas siap untuk nomor ${nomor}, klik untuk ubah ke belum` : `Berkas belum untuk nomor ${nomor}, klik untuk tandai siap`);
    const label = berkasBtn.querySelector('span');
    if (label) label.textContent = isSiap ? 'Siap' : 'Belum';
    // Ganti ikon SVG dengan aman (tanpa innerHTML di parent) — isi path statis & terkontrol.
    const svg = berkasBtn.querySelector('svg');
    if (svg) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const ns = 'http://www.w3.org/2000/svg';
      const mk = (tag, attrs) => {
        const el = document.createElementNS(ns, tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        return el;
      };
      svg.appendChild(mk('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }));
      svg.appendChild(mk('polyline', { points: '14 2 14 8 20 8' }));
      if (isSiap) svg.appendChild(mk('path', { d: 'M9 15l2 2 4-4' }));
      else svg.appendChild(mk('line', { x1: '9', y1: '15', x2: '15', y2: '15' }));
    }
  }
  if (panggilBtn) {
    if (isSiap) {
      panggilBtn.removeAttribute('disabled');
      panggilBtn.removeAttribute('aria-disabled');
      panggilBtn.classList.remove('is-disabled');
      panggilBtn.setAttribute('onclick', `panggil(${nomor})`);
      panggilBtn.setAttribute('title', 'Berkas siap — klik untuk panggil peserta');
      panggilBtn.setAttribute('aria-label', `Panggil nomor ${nomor}`);
    } else {
      panggilBtn.setAttribute('disabled', '');
      panggilBtn.setAttribute('aria-disabled', 'true');
      panggilBtn.classList.add('is-disabled');
      panggilBtn.removeAttribute('onclick');
      panggilBtn.setAttribute('title', 'Berkas belum siap — tandai Siap dulu sebelum panggil');
      panggilBtn.setAttribute('aria-label', `Panggil nomor ${nomor} dinonaktifkan karena berkas belum siap`);
    }
  }
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

  socket.on('antrian:berkas', () => {
    // Panitia lain toggle berkas — refresh jika sedang di tab Menunggu
    if (currentFilter === 'menunggu') loadDaftar(currentFilter);
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
window.toggleBerkas = toggleBerkas;
window.putarPanggilan = putarPanggilan;
window.ucapkanPanggilan = ucapkanPanggilan;
window.salinNoSeri = salinNoSeri;
