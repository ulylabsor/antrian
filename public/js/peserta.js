const socket = io();

let pesertaTerpilih = null;
let myNomorAntrian = null;

const inputNama = document.getElementById('input-nama');
const hasilPencarian = document.getElementById('hasil-pencarian');
const detailPeserta = document.getElementById('detail-peserta');

// Autocomplete search
let timeoutId;
inputNama.addEventListener('input', (e) => {
  clearTimeout(timeoutId);
  const nama = e.target.value.trim();

  if (nama.length < 2) {
    hasilPencarian.innerHTML = '';
    return;
  }

  timeoutId = setTimeout(async () => {
    const res = await fetch(`/api/peserta/cari?nama=${encodeURIComponent(nama)}`);
    const data = await res.json();
    tampilkanHasilPencarian(data);
  }, 300);
});

function tampilkanHasilPencarian(data) {
  if (data.length === 0) {
    hasilPencarian.innerHTML = '<p class="text-gray-400 text-sm py-2">Nama tidak ditemukan</p>';
    return;
  }

  hasilPencarian.innerHTML = data.map(p => `
    <button
      onclick="pilihPeserta(${p.id})"
      class="w-full text-left px-4 py-2 hover:bg-blue-50 rounded-lg border-b border-gray-100 transition"
    >
      <div class="font-medium text-gray-800">${p.nama_lengkap}</div>
      <div class="text-xs text-gray-500">No Seri: ${p.no_seri}</div>
    </button>
  `).join('');
}

async function pilihPeserta(id) {
  const res = await fetch(`/api/peserta/${id}`);
  const peserta = await res.json();

  if (peserta.error) {
    alert(peserta.error);
    return;
  }

  pesertaTerpilih = peserta;
  hasilPencarian.innerHTML = '';
  inputNama.value = '';

  // Tampilkan detail
  detailPeserta.classList.remove('hidden');
  detailPeserta.innerHTML = `
    <div class="bg-blue-50 rounded-lg p-4 mb-4">
      <div class="mb-2">
        <span class="text-xs text-gray-500">Nama Lengkap</span>
        <p class="font-semibold">${peserta.nama_lengkap}</p>
      </div>
      <div class="mb-2">
        <span class="text-xs text-gray-500">Tempat, Tanggal Lahir</span>
        <p class="font-semibold">${peserta.tempat_tanggal_lahir}</p>
      </div>
      <div>
        <span class="text-xs text-gray-500">No Seri</span>
        <p class="font-semibold">${peserta.no_seri}</p>
      </div>
    </div>
    <button
      onclick="ambilAntrian()"
      class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition"
    >
      Konfirmasi & Ambil Nomor Antrian
    </button>
  `;
}

async function ambilAntrian() {
  if (!pesertaTerpilih) return;

  const res = await fetch('/api/antrian/ambil', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pesertaId: pesertaTerpilih.id }),
  });

  const data = await res.json();

  if (data.error) {
    alert(data.error);
    return;
  }

  // Pindah ke screen antrian
  document.getElementById('screen-cari').classList.add('hidden');
  document.getElementById('screen-antrian').classList.remove('hidden');

  myNomorAntrian = data.nomor_antrian;
  document.getElementById('nomor-antrian').textContent = data.nomor_antrian;

  // Tampilkan info peserta
  document.getElementById('info-peserta').innerHTML = `
    <p><strong>Nama:</strong> ${pesertaTerpilih.nama_lengkap}</p>
    <p><strong>No Seri:</strong> ${pesertaTerpilih.no_seri}</p>
  `;

  // Join socket room untuk update status
  socket.emit('peserta:join', data.nomor_antrian);

  updateStatusDisplay('menunggu');
}

function updateStatusDisplay(status) {
  const statusText = document.getElementById('status-text');
  const statusBox = document.getElementById('status-box');

  const statusMap = {
    'menunggu': { text: 'Menunggu', class: 'bg-yellow-100 text-yellow-800' },
    'dipanggil': { text: 'Dipanggil! Silakan ke counter', class: 'bg-green-100 text-green-800' },
    'selesai': { text: 'Selesai', class: 'bg-blue-100 text-blue-800' },
  };

  const config = statusMap[status] || statusMap['menunggu'];
  statusText.textContent = config.text;
  statusBox.className = `py-3 px-4 rounded-lg mb-4 ${config.class}`;

  if (status === 'dipanggil') {
    document.querySelector('#screen-antrian .bg-white').classList.add('flash-dipanggil');
  }
}

// Listen untuk update status
socket.on('antrian:panggil', (data) => {
  if (data.nomor === myNomorAntrian) {
    updateStatusDisplay('dipanggil');
  }
});

socket.on('antrian:selesai', (data) => {
  if (data.nomor === myNomorAntrian) {
    updateStatusDisplay('selesai');
  }
});

// Expose ke window untuk onclick handlers
window.pilihPeserta = pilihPeserta;
window.ambilAntrian = ambilAntrian;
