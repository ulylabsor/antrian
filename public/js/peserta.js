const socket = io();

let pesertaTerpilih = null;
let myNomorAntrian = null;
let myLoket = null;        // loket terakhir dipanggil (untuk replay TTS)
let waktuDaftar = null;    // waktu peserta ambil antrian (untuk timelapse)
let currentStatus = null;  // status saat ini (untuk sinkronisasi timeline)

// ============================================================
// Helpers
// ============================================================
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function initials(nama) {
  if (!nama) return '?';
  const parts = String(nama).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function estimasiTunggu(antreanDepan) {
  if (antreanDepan == null || antreanDepan <= 0) return 'Segera';
  const menit = antreanDepan * 2; // asumsi ±2 menit per peserta
  if (menit < 60) return `± ${menit} mnt`;
  const jam = Math.floor(menit / 60);
  const sisa = menit % 60;
  return sisa > 0 ? `± ${jam}j ${sisa}m` : `± ${jam} jam`;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('is-off'));
  document.getElementById(id).classList.remove('is-off');
}

// ============================================================
// Timelapse — "baru saja", "X menit lalu"
// ============================================================
function timelapse(dateObj) {
  if (!dateObj) return '';
  const now = new Date();
  const diffSec = Math.floor((now - dateObj) / 1000);
  if (diffSec < 60) return 'baru saja';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHour = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  if (diffHour < 24) return remMin > 0 ? `${diffHour} jam ${remMin} menit lalu` : `${diffHour} jam lalu`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} hari lalu`;
}

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

function updateTimelapse() {
  const el = document.getElementById('timelapse-container');
  if (!el || !waktuDaftar) return;
  el.textContent = `Nomor diambil ${timelapse(waktuDaftar)}`;
}
setInterval(updateTimelapse, 30000);

// ============================================================
// TTS — Text-to-Speech bahasa Indonesia (Google TTS server-side)
// Gaya panggilan bandara: chime "ding-dong" di awal, lalu audio
// diputar 2x dengan jeda singkat di antaranya.
// ============================================================
let audioPanggilan = null;
let panggilanTimeout = null;   // timer jeda antar repetisi (untuk dibatalkan bila ada panggilan baru)

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
  // Hentikan panggilan yang sedang berjalan (termasuk timer repetisi)
  if (panggilanTimeout) { clearTimeout(panggilanTimeout); panggilanTimeout = null; }
  if (audioPanggilan) { audioPanggilan.pause(); audioPanggilan = null; }
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
          // Jeda singkat lalu putar ulang kalimat yang sama
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
    // Autoplay policy: browser memblok audio tanpa user gesture.
    // Tampilkan tombol replay agar user bisa putar manual (klik = gesture valid).
    const replayBtn = document.getElementById('replay-btn');
    if (replayBtn) replayBtn.classList.remove('hidden');
  }
}

function panggilLagi() {
  if (myNomorAntrian !== null && myLoket !== null) {
    ucapkanPanggilan(myNomorAntrian, myLoket);
  }
}

// ============================================================
// Pencarian nama (autocomplete)
// ============================================================
const inputNama = document.getElementById('input-nama');
const hasilPencarian = document.getElementById('hasil-pencarian');
const detailPeserta = document.getElementById('detail-peserta');
const btnClear = document.getElementById('btn-clear');

let timeoutId;
inputNama.addEventListener('input', (e) => {
  clearTimeout(timeoutId);
  const nama = e.target.value.trim();
  btnClear.style.display = nama ? 'flex' : 'none';
  detailPeserta.innerHTML = '';
  hasilPencarian.innerHTML = '';

  if (nama.length < 2) return;

  hasilPencarian.innerHTML = '<div class="result-searching"><span class="mini-ring" aria-hidden="true"></span>Mencari…</div>';

  timeoutId = setTimeout(async () => {
    try {
      const res = await fetch(`/api/peserta/cari?q=${encodeURIComponent(nama)}`);
      const data = await res.json();
      tampilkanHasilPencarian(data);
    } catch (err) {
      hasilPencarian.innerHTML = '<div class="result-empty">Gagal mencari. Periksa koneksi lalu coba lagi.</div>';
    }
  }, 300);
});

btnClear.addEventListener('click', () => {
  inputNama.value = '';
  btnClear.style.display = 'none';
  hasilPencarian.innerHTML = '';
  detailPeserta.innerHTML = '';
  inputNama.focus();
});

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

async function pilihPeserta(id) {
  let peserta;
  try {
    const res = await fetch(`/api/peserta/${id}`);
    peserta = await res.json();
  } catch (err) {
    showInfo({ title: 'Gagal Memuat', message: 'Tidak bisa terhubung ke server. Coba lagi.', type: 'error', confirmText: 'Tutup' });
    return;
  }

  if (peserta.error) {
    showInfo({ title: 'Peserta Tidak Ditemukan', message: peserta.error, type: 'error', confirmText: 'Tutup' });
    return;
  }

  pesertaTerpilih = peserta;
  hasilPencarian.innerHTML = '';
  inputNama.value = '';
  btnClear.style.display = 'none';

  // Kalau peserta sudah punya nomor antrian — tampilkan tiket status langsung
  if (peserta.nomor_antrian && (peserta.status === 'dipanggil' || peserta.status === 'selesai' || peserta.status === 'menunggu')) {
    tampilkanCardStatus(peserta);
    return;
  }

  // Tampilkan detail untuk konfirmasi ambil antrian
  detailPeserta.classList.remove('hidden');
  detailPeserta.innerHTML = `
    <div class="detail">
      <div class="detail-head">Konfirmasi Data Anda</div>
      <div class="detail-block">
        <div class="d-row"><span class="k">Nama Lengkap</span><span class="v">${esc(peserta.nama_lengkap)}</span></div>
        <div class="d-row"><span class="k">Tempat, Tanggal Lahir</span><span class="v">${esc(peserta.tempat_tanggal_lahir || '-')}</span></div>
        <div class="d-row"><span class="k">No. Seri</span><span class="v">${esc(peserta.no_seri || '-')}</span></div>
      </div>
      <button type="button" onclick="ambilAntrian()" class="btn-primary">Konfirmasi & Ambil Nomor Antrian</button>
      <button type="button" id="btn-batal-detail" class="btn-ghost">Batal, cari nama lain</button>
    </div>
  `;
  document.getElementById('btn-batal-detail').addEventListener('click', () => {
    detailPeserta.innerHTML = '';
    inputNama.focus();
  });
}

// ============================================================
// Loading → Nomor antrian
// ============================================================
function tampilkanLoading(judul = 'Sedang mengambil nomor antrian') {
  document.getElementById('load-title').textContent = judul;
  showScreen('screen-loading');
}

// Tampilkan tiket antrian untuk peserta yang sudah ambil nomor
function tampilkanCardStatus(peserta) {
  showScreen('screen-antrian');

  myNomorAntrian = peserta.nomor_antrian;
  const nomorEl = document.getElementById('nomor-antrian');
  nomorEl.textContent = peserta.nomor_antrian;
  nomorEl.classList.remove('pop');
  void nomorEl.offsetWidth;
  nomorEl.classList.add('pop');

  document.getElementById('info-peserta').innerHTML = `
    <div class="d-row"><span class="k">Nama</span><span class="v">${esc(peserta.nama_lengkap)}</span></div>
    <div class="d-row"><span class="k">No. Seri</span><span class="v">${esc(peserta.no_seri || '-')}</span></div>
  `;

  waktuDaftar = peserta.waktu_daftar ? new Date(String(peserta.waktu_daftar).replace(' ', 'T')) : new Date();
  updateTimelapse();

  socket.emit('peserta:join', peserta.nomor_antrian);
  muatPosisiAntrian(peserta.nomor_antrian, peserta.status);
  updateStatusDisplay(peserta.status, peserta.counter ?? null);
}

async function ambilAntrian() {
  if (!pesertaTerpilih) return;

  tampilkanLoading('Sedang mengambil nomor antrian');

  let data;
  try {
    const res = await fetch('/api/antrian/ambil', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pesertaId: pesertaTerpilih.id }),
    });
    data = await res.json();
  } catch (err) {
    showScreen('screen-cari');
    showInfo({ title: 'Gagal Mengambil Antrian', message: 'Tidak bisa terhubung ke server. Coba lagi.', type: 'error', confirmText: 'Tutup' });
    return;
  }

  if (data.error) {
    showScreen('screen-cari');
    showInfo({ title: 'Gagal Mengambil Antrian', message: data.error, type: 'error', confirmText: 'Tutup' });
    return;
  }

  // Beri jeda minimum supaya momen loading terasa, lalu pindah ke tiket
  setTimeout(() => {
    showScreen('screen-antrian');

    myNomorAntrian = data.nomor_antrian;
    const nomorEl = document.getElementById('nomor-antrian');
    nomorEl.textContent = data.nomor_antrian;
    nomorEl.classList.remove('pop');
    void nomorEl.offsetWidth;
    nomorEl.classList.add('pop');

    document.getElementById('info-peserta').innerHTML = `
      <div class="d-row"><span class="k">Nama</span><span class="v">${esc(pesertaTerpilih.nama_lengkap)}</span></div>
      <div class="d-row"><span class="k">No. Seri</span><span class="v">${esc(pesertaTerpilih.no_seri || '-')}</span></div>
    `;

    waktuDaftar = new Date();
    updateTimelapse();

    socket.emit('peserta:join', data.nomor_antrian);
    muatPosisiAntrian(data.nomor_antrian, 'menunggu');
    updateStatusDisplay('menunggu');
  }, 900);
}

// ============================================================
// Posisi & estimasi antrian (dari /api/info-antrian)
// ============================================================
async function muatPosisiAntrian(nomor, status) {
  if (status === 'dipanggil' || status === 'selesai') {
    document.getElementById('posisi-antrian').textContent = status === 'selesai' ? 'Selesai' : 'Dipanggil';
    document.getElementById('estimasi-tunggu').textContent = '—';
    return;
  }
  try {
    const res = await fetch('/api/info-antrian');
    const info = await res.json();
    const menunggu = info.menunggu || [];
    const idx = menunggu.findIndex(p => Number(p.nomor_antrian) === Number(nomor));
    if (idx >= 0) {
      document.getElementById('posisi-antrian').textContent = `#${idx + 1} dari ${menunggu.length}`;
      document.getElementById('estimasi-tunggu').textContent = estimasiTunggu(idx);
    } else {
      document.getElementById('posisi-antrian').textContent = '—';
      document.getElementById('estimasi-tunggu').textContent = '—';
    }
  } catch (err) {
    /* abaikan — info posisi sifatnya pelengkap */
  }
}

// ============================================================
// Timeline + status display
// ============================================================
function setTimeline(status) {
  const order = ['menunggu', 'dipanggil', 'selesai'];
  const idx = order.indexOf(status);
  document.querySelectorAll('#timeline .tl-step').forEach(step => {
    const i = order.indexOf(step.dataset.step);
    step.classList.toggle('done', i < idx);
    step.classList.toggle('active', i === idx);
  });
}

function updateStatusDisplay(status, counter = null) {
  currentStatus = status;
  const statusText = document.getElementById('status-text');
  const statusBox = document.getElementById('status-box');
  const counterDisplay = document.getElementById('counter-display');
  const counterNumber = document.getElementById('counter-number');
  const replayBtn = document.getElementById('replay-btn');

  const statusMap = {
    'menunggu': 'Menunggu',
    'dipanggil': 'Dipanggil — silakan ke ruangan',
    'selesai': 'Selesai',
  };

  statusText.textContent = statusMap[status] || 'Menunggu';
  statusBox.className = `status-pill ${status}`;

  setTimeline(status);

  if (status === 'dipanggil') {
    // Flash kartu saat dipanggil
    const card = document.querySelector('#screen-antrian .ticket-card');
    card.classList.remove('flash');
    void card.offsetWidth;
    card.classList.add('flash');

    if (counter !== null && counter !== undefined) {
      counterNumber.textContent = `Ruangan ${counter}`;
      counterDisplay.classList.remove('hidden');
      replayBtn.classList.remove('hidden');
      myLoket = counter;
      ucapkanPanggilan(myNomorAntrian, counter);
    } else {
      counterDisplay.classList.add('hidden');
      replayBtn.classList.add('hidden');
    }
    document.getElementById('posisi-antrian').textContent = 'Dipanggil';
    document.getElementById('estimasi-tunggu').textContent = '—';
  } else {
    counterDisplay.classList.add('hidden');
    replayBtn.classList.add('hidden');
    if (status === 'selesai') {
      document.getElementById('posisi-antrian').textContent = 'Selesai';
      document.getElementById('estimasi-tunggu').textContent = '—';
    }
  }
}

// ============================================================
// Socket events
// ============================================================
socket.on('antrian:panggil', (data) => {
  if (data.nomor === myNomorAntrian) updateStatusDisplay('dipanggil', data.counter ?? null);
});

socket.on('antrian:selesai', (data) => {
  if (data.nomor === myNomorAntrian) updateStatusDisplay('selesai');
});

// Panitia memanggil ulang — animasi lagi + putar audio lagi
socket.on('antrian:panggil-ulang', (data) => {
  if (data.nomor === myNomorAntrian) {
    updateStatusDisplay('dipanggil', data.counter ?? null);
    if (data.counter !== null && data.counter !== undefined) ucapkanPanggilan(myNomorAntrian, data.counter);
  }
});

// Saat ada peserta baru/selesai, posisi antrian bisa berubah → refresh
socket.on('antrian:baru', () => { if (myNomorAntrian !== null && currentStatus === 'menunggu') muatPosisiAntrian(myNomorAntrian, 'menunggu'); });
socket.on('statistik:update', () => { if (myNomorAntrian !== null && currentStatus === 'menunggu') muatPosisiAntrian(myNomorAntrian, 'menunggu'); });

// Expose ke window untuk onclick handlers
window.pilihPeserta = pilihPeserta;
window.ambilAntrian = ambilAntrian;
window.panggilLagi = panggilLagi;
window.toggleTheme = toggleTheme;
