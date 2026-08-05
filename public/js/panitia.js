const socket = io();
socket.emit('panitia:join');

let currentFilter = 'menunggu';

// === State loket ===
let jumlahLoket = 3;
let myLoket = null;

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
  // Bangun options — textContent aman
  sel.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '-- pilih --';
  sel.appendChild(placeholder);
  for (let i = 1; i <= jumlahLoket; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `Loket ${i}`;
    sel.appendChild(opt);
  }
  if (myLoket !== null && myLoket <= jumlahLoket) {
    sel.value = String(myLoket);
  } else {
    sel.value = '';
    if (myLoket !== null) saveMyLoket(null);
  }
}

async function loadLoketSettings() {
  try {
    const res = await fetch('/api/settings/loket');
    const data = await res.json();
    jumlahLoket = data.jumlah_loket;
    document.getElementById('input-jumlah-loket').value = jumlahLoket;
    renderLoketDropdown();
  } catch (err) {
    console.error('Gagal memuat settings loket:', err);
  }
}

// === Statistik & daftar ===
async function loadStatistik() {
  try {
    const res = await fetch('/api/statistik');
    const data = await res.json();
    document.getElementById('stat-total').textContent = data.total;
    document.getElementById('stat-menunggu').textContent = data.menunggu;
    document.getElementById('stat-dipanggil').textContent = data.dipanggil;
    document.getElementById('stat-selesai').textContent = data.selesai;
  } catch (err) {
    console.error('Gagal memuat statistik:', err);
  }
}

// Escape user-controlled text sebelum masuk innerHTML (nama peserta dari DB)
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setFilterPills(active) {
  ['menunggu', 'dipanggil', 'selesai'].forEach(s => {
    document.getElementById(`pill-${s}`).setAttribute('data-active', s === active ? 'true' : 'false');
  });
}

async function loadDaftar(status) {
  currentFilter = status;
  setFilterPills(status);
  try {
    const res = await fetch(`/api/antrian/daftar?status=${status}`);
    const data = await res.json();

    const container = document.getElementById('daftar-antrian');

    if (data.length === 0) {
      container.innerHTML = '<p style="color:var(--slate-mute); text-align:center; padding:16px 0;">Tidak ada antrian</p>';
      return;
    }

    container.innerHTML = data.map(p => {
      let actions = '';
      if (status === 'menunggu') {
        actions = `
          <button onclick="panggil(${p.nomor_antrian})" class="action-btn panggil">Panggil</button>
          <button onclick="selesai(${p.nomor_antrian})" class="action-btn selesai">Selesai</button>
        `;
      } else if (status === 'dipanggil') {
        actions = `
          <button onclick="selesai(${p.nomor_antrian})" class="action-btn selesai">Selesai</button>
        `;
      }

      const loketBadge = (p.status === 'dipanggil' && p.counter !== null && p.counter !== undefined)
        ? `<span class="loket-badge">Loket ${esc(p.counter)}</span>`
        : '';

      return `
        <div class="queue-row">
          <div style="display:flex; align-items:center; gap:16px; min-width:0;">
            <div class="num">#${esc(p.nomor_antrian)}</div>
            <div style="min-width:0;">
              <div class="name">${esc(p.nama_lengkap)}${loketBadge}</div>
              <div class="seri">No Seri: ${esc(p.no_seri)}</div>
            </div>
          </div>
          <div style="display:flex; gap:8px; flex-shrink:0;">${actions}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Gagal memuat daftar antrian:', err);
  }
}

async function panggil(nomor) {
  if (myLoket === null) {
    alert('Pilih loket Anda di pojok kanan atas terlebih dahulu.');
    return;
  }
  try {
    await fetch(`/api/antrian/panggil/${nomor}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ counter: myLoket }),
    });
    loadDaftar(currentFilter);
    loadStatistik();
  } catch (err) {
    alert('Gagal memanggil peserta. Coba lagi.');
  }
}

async function selesai(nomor) {
  try {
    await fetch(`/api/antrian/selesai/${nomor}`, { method: 'POST' });
    loadDaftar(currentFilter);
    loadStatistik();
  } catch (err) {
    alert('Gagal menandai selesai. Coba lagi.');
  }
}

// === Real-time ===
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
  if (currentFilter === 'dipanggil' || currentFilter === 'menunggu') {
    loadDaftar(currentFilter);
  }
  loadStatistik();
});

socket.on('settings:loket', (data) => {
  jumlahLoket = data.jumlah_loket;
  document.getElementById('input-jumlah-loket').value = jumlahLoket;
  renderLoketDropdown();
});

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
  loadMyLoket();
  loadLoketSettings();
  loadStatistik();
  loadDaftar('menunggu');

  document.getElementById('select-loket').addEventListener('change', (e) => {
    const v = e.target.value;
    saveMyLoket(v === '' ? null : parseInt(v, 10));
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    const panel = document.getElementById('panel-settings');
    const btn = document.getElementById('btn-settings');
    const isHidden = panel.style.display === 'none';
    panel.style.display = isHidden ? 'block' : 'none';
    btn.setAttribute('data-active', isHidden ? 'true' : 'false');
  });

  document.getElementById('btn-simpan-loket').addEventListener('click', async () => {
    const n = parseInt(document.getElementById('input-jumlah-loket').value, 10);
    try {
      const res = await fetch('/api/settings/loket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jumlah_loket: n }),
      });
      const data = await res.json();
      const status = document.getElementById('settings-status');
      if (data.error) {
        status.textContent = data.error;
        status.style.color = '#dc2626';
      } else {
        status.textContent = 'Tersimpan';
        status.style.color = 'var(--emerald)';
        jumlahLoket = data.jumlah_loket;
        renderLoketDropdown();
        setTimeout(() => { status.textContent = ''; }, 2000);
      }
    } catch (err) {
      alert('Gagal menyimpan pengaturan.');
    }
  });
});

window.loadDaftar = loadDaftar;
window.panggil = panggil;
window.selesai = selesai;
