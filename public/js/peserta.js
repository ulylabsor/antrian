const socket = io();

let pesertaTerpilih = null;
let myNomorAntrian = null;
let waktuDaftar = null; // waktu peserta ambil antrian (untuk timelapse)

// ============================================================
// Waktu sekarang — update tiap detik di halaman cari
// ============================================================
function updateWaktuSekarang() {
  const el = document.getElementById('waktu-sekarang');
  if (!el) return;
  const now = new Date();
  const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const bulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const hariIni = hari[now.getDay()];
  const tanggal = now.getDate();
  const bulanIni = bulan[now.getMonth()];
  const tahun = now.getFullYear();
  const jam = String(now.getHours()).padStart(2, '0');
  const menit = String(now.getMinutes()).padStart(2, '0');
  const detik = String(now.getSeconds()).padStart(2, '0');
  el.textContent = `${hariIni}, ${tanggal} ${bulanIni} ${tahun} · ${jam}:${menit}:${detik}`;
}
// Update tiap detik
updateWaktuSekarang();
setInterval(updateWaktuSekarang, 1000);

// ============================================================
// Timelapse — "baru saja", "X menit lalu"
// ============================================================
function timelapse(dateObj) {
  if (!dateObj) return '';
  const now = new Date();
  const diffMs = now - dateObj;
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

function updateTimelapse() {
  const el = document.getElementById('timelapse-container');
  if (!el || !waktuDaftar) return;
  el.textContent = `Anda ambil antrian ini ${timelapse(waktuDaftar)}`;
}
// Update tiap 30 detik
setInterval(updateTimelapse, 30000);

// ============================================================
// TTS — Text-to-Speech bahasa Indonesia (via Google TTS server-side)
// Web Speech API sering jatuh ke voice English di Windows, jadi kita
// pakai Google TTS yang punya suara Indonesia asli.
// ============================================================

let audioPanggilan = null; // instance Audio yang sedang/sudah diputar

async function ucapkanPanggilan(nomor, loket) {
  // Stop audio sebelumnya kalau ada
  if (audioPanggilan) {
    audioPanggilan.pause();
    audioPanggilan = null;
  }
  try {
    const url = `/api/tts?nomor=${encodeURIComponent(nomor)}&loket=${encodeURIComponent(loket)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('TTS gagal');
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    audioPanggilan = new Audio(objectUrl);
    audioPanggilan.onended = () => { URL.revokeObjectURL(objectUrl); };
    await audioPanggilan.play();
  } catch (err) {
    console.error('Gagal memutar panggilan:', err.message);
  }
}

function panggilLagi() {
  if (myNomorAntrian !== null && myLoket !== null) {
    ucapkanPanggilan(myNomorAntrian, myLoket);
  }
}

let myLoket = null; // loket terakhir dipanggil (untuk replay TTS)

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

  // Kalau peserta sudah punya nomor antrian (sudah ambil sebelumnya) — tampilkan card status langsung
  if (peserta.nomor_antrian && (peserta.status === 'dipanggil' || peserta.status === 'selesai' || peserta.status === 'menunggu')) {
    tampilkanCardStatus(peserta);
    return;
  }

  // Tampilkan detail untuk konfirmasi ambil antrian
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

// Tampilkan card antrian untuk peserta yang sudah ambil nomor sebelumnya
function tampilkanCardStatus(peserta) {
  // Pindah ke screen antrian
  document.getElementById('screen-cari').classList.add('hidden');
  document.getElementById('screen-antrian').classList.remove('hidden');

  myNomorAntrian = peserta.nomor_antrian;
  document.getElementById('nomor-antrian').textContent = peserta.nomor_antrian;

  // Tampilkan info peserta
  document.getElementById('info-peserta').innerHTML = `
    <p><strong>Nama:</strong> ${peserta.nama_lengkap}</p>
    <p><strong>No Seri:</strong> ${peserta.no_seri}</p>
  `;

  // Simpan waktu ambil untuk timelapse (dari DB)
  waktuDaftar = peserta.waktu_daftar ? new Date(String(peserta.waktu_daftar).replace(' ', 'T')) : new Date();
  updateTimelapse();

  // Join socket room untuk update status
  socket.emit('peserta:join', peserta.nomor_antrian);

  // Set status display sesuai status peserta
  updateStatusDisplay(peserta.status, peserta.counter ?? null);
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

  // Simpan waktu ambil untuk timelapse
  waktuDaftar = new Date();
  updateTimelapse();

  // Join socket room untuk update status
  socket.emit('peserta:join', data.nomor_antrian);

  updateStatusDisplay('menunggu');
}

function updateStatusDisplay(status, counter = null) {
  const statusText = document.getElementById('status-text');
  const statusBox = document.getElementById('status-box');
  const counterDisplay = document.getElementById('counter-display');
  const counterNumber = document.getElementById('counter-number');

  const statusMap = {
    'menunggu': { text: 'Menunggu', class: 'bg-yellow-100 text-yellow-800' },
    'dipanggil': { text: 'Dipanggil! Silakan ke counter', class: 'bg-green-100 text-green-800' },
    'selesai': { text: 'Selesai', class: 'bg-blue-100 text-blue-800' },
  };

  const config = statusMap[status] || statusMap['menunggu'];
  statusText.textContent = config.text;
  statusBox.className = `py-3 px-4 rounded-lg mb-4 ${config.class}`;

  if (status === 'dipanggil') {
    // Force re-trigger animasi: hapus class dulu, lalu tambah lagi (untuk panggil ulang)
    const card = document.querySelector('#screen-antrian .bg-white');
    card.classList.remove('flash-dipanggil');
    // Paksa reflow agar animasi trigger lagi
    void card.offsetWidth;
    card.classList.add('flash-dipanggil');
    const replayBtn = document.getElementById('replay-btn');
    if (counter !== null && counter !== undefined) {
      counterNumber.textContent = `Counter ${counter}`;
      counterDisplay.classList.remove('hidden');
      replayBtn.classList.remove('hidden');
      myLoket = counter;
      // TTS — ucapkan panggilan
      ucapkanPanggilan(myNomorAntrian, counter);
    } else {
      counterDisplay.classList.add('hidden'); // legacy / no-counter call
      replayBtn.classList.add('hidden');
    }
  } else {
    counterDisplay.classList.add('hidden');
    document.getElementById('replay-btn').classList.add('hidden');
  }
}

// Listen untuk update status
socket.on('antrian:panggil', (data) => {
  if (data.nomor === myNomorAntrian) {
    updateStatusDisplay('dipanggil', data.counter ?? null);
  }
});

socket.on('antrian:selesai', (data) => {
  if (data.nomor === myNomorAntrian) {
    updateStatusDisplay('selesai');
  }
});

// Panitia memanggil ulang — animasi lagi + putar audio lagi
socket.on('antrian:panggil-ulang', (data) => {
  if (data.nomor === myNomorAntrian) {
    // Trigger animasi panggil lagi (flash + pulse) — pakai mekanisme yang sama dengan panggil awal
    updateStatusDisplay('dipanggil', data.counter ?? null);
    // Putar audio panggilan lagi
    if (data.counter !== null && data.counter !== undefined) {
      ucapkanPanggilan(myNomorAntrian, data.counter);
    }
  }
});

// Expose ke window untuk onclick handlers
window.pilihPeserta = pilihPeserta;
window.ambilAntrian = ambilAntrian;
window.panggilLagi = panggilLagi;
