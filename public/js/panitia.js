const socket = io();
socket.emit('panitia:join');

let currentFilter = 'menunggu';
let searchQuery = '';

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
    opt.textContent = `Counter ${i}`;
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
}

async function loadDaftar(status) {
  currentFilter = status;
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
    container.innerHTML = '<p class="text-gray-400 text-center py-4">Tidak ada antrian</p>';
    return;
  }

  container.innerHTML = data.map(p => {
    let actions = '';
    // Tombol panggil ulang (speaker) — muncul untuk peserta yang sudah dipanggil
    const replayBtn = (p.status === 'dipanggil' && p.counter !== null && p.counter !== undefined)
      ? `<button onclick="putarPanggilan(${p.nomor_antrian}, ${p.counter})" title="Putar panggilan lagi" class="px-2 py-1 bg-amber-100 text-amber-800 rounded-lg text-sm font-medium hover:bg-amber-200">🔊</button>`
      : '';

    if (status === 'menunggu') {
      actions = `
        <button onclick="panggil(${p.nomor_antrian})" class="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Panggil</button>
        <button onclick="selesai(${p.nomor_antrian})" class="px-3 py-1 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">Selesai</button>
      `;
    } else if (status === 'dipanggil') {
      actions = `
        ${replayBtn}
        <button onclick="selesai(${p.nomor_antrian})" class="px-3 py-1 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">Selesai</button>
      `;
    }

    // Badge counter untuk peserta yang sudah dipanggil ke counter tertentu
    const counterBadge = (p.status === 'dipanggil' && p.counter !== null && p.counter !== undefined)
      ? `<span class="ml-2 px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-semibold">Counter ${p.counter}</span>`
      : '';

    // Timelapse waktu sejak peserta masuk (font kecil)
    const timelapseTxt = p.waktu_daftar ? timelapse(p.waktu_daftar) : '';

    return `
      <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
        <div class="flex items-center gap-4">
          <div class="text-2xl font-bold text-blue-700 w-12">#${p.nomor_antrian}</div>
          <div>
            <div class="font-semibold text-gray-800">${p.nama_lengkap}${counterBadge}</div>
            <div class="text-sm text-gray-500">No Seri: ${p.no_seri}</div>
            ${timelapseTxt ? `<div class="text-xs text-gray-400 mt-0.5">⏱ ${timelapseTxt}</div>` : ''}
          </div>
        </div>
        <div class="flex gap-2 items-center">${actions}</div>
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

// Panggil ulang dari dashboard panitia — trigger animasi + audio di halaman peserta
async function putarPanggilan(nomor, _loket) {
  try {
    const res = await fetch(`/api/antrian/panggil-ulang/${nomor}`, { method: 'POST' });
    const data = await res.json();
    if (data.error) {
      alert('Gagal memanggil ulang: ' + data.error);
    }
    // Peserta akan animasi + putar audio via socket event (tidak perlu audio di sini)
  } catch (err) {
    alert('Gagal memanggil ulang: ' + err.message);
  }
}

async function panggil(nomor) {
  if (myLoket === null) {
    alert('Pilih counter Anda di pojok kanan atas terlebih dahulu.');
    return;
  }
  await fetch(`/api/antrian/panggil/${nomor}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ counter: myLoket }),
  });
  loadDaftar(currentFilter);
  loadStatistik();
}

async function selesai(nomor) {
  if (!confirm(`Tandai sertifikat nomor antrian #${nomor} sudah diambil?`)) {
    return; // batal
  }
  await fetch(`/api/antrian/selesai/${nomor}`, { method: 'POST' });
  loadDaftar(currentFilter);
  loadStatistik();
}

// === Real-time updates ===
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

// === Init & event wiring ===
document.addEventListener('DOMContentLoaded', () => {
  loadMyLoket();
  loadLoketSettings();
  loadStatistik();
  loadDaftar('menunggu');

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
    const res = await fetch('/api/settings/loket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jumlah_loket: n }),
    });
    const data = await res.json();
    const status = document.getElementById('settings-status');
    if (data.error) {
      status.textContent = data.error;
      status.className = 'text-xs text-red-600';
    } else {
      status.textContent = 'Tersimpan';
      status.className = 'text-xs text-green-600';
      jumlahLoket = data.jumlah_loket;
      renderLoketDropdown();
      setTimeout(() => { status.textContent = ''; }, 2000);
    }
  });

  // Sync — download data terbaru dari Google Sheets publik → import ke SQLite (skip duplikat)
  document.getElementById('btn-sync').addEventListener('click', async () => {
    const btn = document.getElementById('btn-sync');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ Downloading...';
    try {
      const res = await fetch('/api/sync/download', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        alert('Gagal sync: ' + data.error);
      } else {
        alert(data.message);
        // Refresh statistik & daftar setelah sync
        loadStatistik();
        loadDaftar(currentFilter);
      }
    } catch (err) {
      alert('Gagal sync: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });
});

// Expose
window.loadDaftar = loadDaftar;
window.panggil = panggil;
window.selesai = selesai;
window.putarPanggilan = putarPanggilan;
