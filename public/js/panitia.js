const socket = io();
socket.emit('panitia:join');

let currentFilter = 'menunggu';

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
  const data = await res.json();

  const container = document.getElementById('daftar-antrian');

  if (data.length === 0) {
    container.innerHTML = '<p class="text-gray-400 text-center py-4">Tidak ada antrian</p>';
    return;
  }

  container.innerHTML = data.map(p => {
    let actions = '';
    if (status === 'menunggu') {
      actions = `
        <button onclick="panggil(${p.nomor_antrian})" class="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Panggil</button>
        <button onclick="selesai(${p.nomor_antrian})" class="px-3 py-1 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">Selesai</button>
      `;
    } else if (status === 'dipanggil') {
      actions = `
        <button onclick="selesai(${p.nomor_antrian})" class="px-3 py-1 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">Selesai</button>
      `;
    }

    return `
      <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
        <div class="flex items-center gap-4">
          <div class="text-2xl font-bold text-blue-700 w-12">#${p.nomor_antrian}</div>
          <div>
            <div class="font-semibold text-gray-800">${p.nama_lengkap}</div>
            <div class="text-sm text-gray-500">No Seri: ${p.no_seri}</div>
          </div>
        </div>
        <div class="flex gap-2">${actions}</div>
      </div>
    `;
  }).join('');
}

async function panggil(nomor) {
  await fetch(`/api/antrian/panggil/${nomor}`, { method: 'POST' });
  loadDaftar(currentFilter);
  loadStatistik();
}

async function selesai(nomor) {
  await fetch(`/api/antrian/selesai/${nomor}`, { method: 'POST' });
  loadDaftar(currentFilter);
  loadStatistik();
}

// Real-time updates
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

// Initial load
loadStatistik();
loadDaftar('menunggu');

// Expose
window.loadDaftar = loadDaftar;
window.panggil = panggil;
window.selesai = selesai;
