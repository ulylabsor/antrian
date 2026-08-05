const socket = io();

let pesertaTerpilih = null;
let myNomorAntrian = null;
let myLoket = null;          // loket terakhir dipanggil (untuk replay TTS)

const inputNama = document.getElementById('input-nama');
const hasilPencarian = document.getElementById('hasil-pencarian');
const detailPeserta = document.getElementById('detail-peserta');
const pesertaBg = document.getElementById('peserta-bg');
const pesertaCard = document.getElementById('peserta-card');

// ============================================================
// TTS — Text-to-Speech bahasa Indonesia
// ============================================================

function ucapkanPanggilan(nomor, loket) {
  if (!('speechSynthesis' in window)) return; // browser tidak support

  const teks = `Panggilan nomor ${nomor}, harap menuju ke loket ${loket}`;
  const u = new SpeechSynthesisUtterance(teks);
  u.lang = 'id-ID';
  u.rate = 0.9;        // sedikit lebih lambat — terdengar jelas & resmi
  u.pitch = 1;

  // Cari voice bahasa Indonesia kalau ada
  const voices = window.speechSynthesis.getVoices();
  const idVoice = voices.find(v => v.lang === 'id-ID') || voices.find(v => v.lang.startsWith('id'));
  if (idVoice) u.voice = idVoice;

  // Cancel utterance sebelumnya kalau ada (jangan tumpuk)
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

// Beberapa browser load voices async — pastikan siap
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {};
}

function panggilLagi() {
  if (myNomorAntrian !== null && myLoket !== null) {
    ucapkanPanggilan(myNomorAntrian, myLoket);
  }
}

// ============================================================
// Autocomplete search
// ============================================================

let timeoutId;
inputNama.addEventListener('input', (e) => {
  clearTimeout(timeoutId);
  const nama = e.target.value.trim();

  if (nama.length < 2) {
    hasilPencarian.innerHTML = '';
    return;
  }

  timeoutId = setTimeout(async () => {
    try {
      const res = await fetch(`/api/peserta/cari?nama=${encodeURIComponent(nama)}`);
      const data = await res.json();
      tampilkanHasilPencarian(data);
    } catch (err) {
      hasilPencarian.innerHTML = '<p style="color:var(--slate-mute); font-size:13px; padding:8px 0;">Gagal mencari. Coba lagi.</p>';
    }
  }, 300);
});

function tampilkanHasilPencarian(data) {
  if (data.length === 0) {
    hasilPencarian.innerHTML = '<p style="color:var(--slate-mute); font-size:13px; padding:10px 0;">Nama tidak ditemukan</p>';
    return;
  }

  hasilPencarian.innerHTML = data.map(p => `
    <button
      onclick="pilihPeserta(${p.id})"
      class="search-result"
    >
      <div class="name">${p.nama_lengkap}</div>
      <div class="seri">No Seri: ${p.no_seri}</div>
    </button>
  `).join('');
}

async function pilihPeserta(id) {
  try {
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
    detailPeserta.style.display = 'block';
    detailPeserta.innerHTML = `
      <div style="background:var(--mist); border-radius:var(--radius-sm); padding:18px; margin-bottom:18px; text-align:left;">
        <div style="margin-bottom:12px;">
          <div style="font-family:var(--font-display); font-size:10px; color:var(--slate-mute); font-weight:600; letter-spacing:2px; text-transform:uppercase;">Nama Lengkap</div>
          <div style="font-weight:600; color:var(--ink-2); margin-top:3px;">${peserta.nama_lengkap}</div>
        </div>
        <div style="margin-bottom:12px;">
          <div style="font-family:var(--font-display); font-size:10px; color:var(--slate-mute); font-weight:600; letter-spacing:2px; text-transform:uppercase;">Tempat, Tanggal Lahir</div>
          <div style="font-weight:600; color:var(--ink-2); margin-top:3px;">${peserta.tempat_tanggal_lahir}</div>
        </div>
        <div>
          <div style="font-family:var(--font-display); font-size:10px; color:var(--slate-mute); font-weight:600; letter-spacing:2px; text-transform:uppercase;">No Seri</div>
          <div style="font-weight:600; color:var(--ink-2); margin-top:3px;">${peserta.no_seri}</div>
        </div>
      </div>
      <button onclick="ambilAntrian()" class="confirm-btn">
        Konfirmasi & Ambil Nomor Antrian
      </button>
    `;
  } catch (err) {
    alert('Gagal memuat data peserta.');
  }
}

async function ambilAntrian() {
  if (!pesertaTerpilih) return;

  try {
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
    document.getElementById('screen-cari').style.display = 'none';
    document.getElementById('screen-antrian').style.display = 'flex';

    myNomorAntrian = data.nomor_antrian;
    document.getElementById('nomor-antrian').textContent = data.nomor_antrian;

    // Tampilkan info peserta
    document.getElementById('info-peserta').innerHTML = `
      <div class="row"><span class="k">Nama</span><span class="v">${pesertaTerpilih.nama_lengkap}</span></div>
      <div class="row"><span class="k">No Seri</span><span class="v">${pesertaTerpilih.no_seri}</span></div>
    `;

    // Join socket room untuk update status
    socket.emit('peserta:join', data.nomor_antrian);

    updateStatusDisplay('menunggu');
  } catch (err) {
    alert('Gagal mengambil nomor antrian. Coba lagi.');
  }
}

function updateStatusDisplay(status, loket = null) {
  const badge = document.getElementById('status-badge');
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  const loketBox = document.getElementById('loket-box');
  const loketNumber = document.getElementById('loket-number');
  const replayBtn = document.getElementById('replay-btn');
  const nomor = document.getElementById('nomor-antrian');

  // Reset badge classes
  badge.classList.remove('dipanggil', 'selesai');
  dot.style.display = '';

  if (status === 'menunggu') {
    label.textContent = 'Menunggu';
    dot.style.display = '';
    pesertaBg.classList.remove('dipanggil');
    pesertaCard.classList.remove('dipanggil');
    nomor.classList.remove('dipanggil');
    loketBox.style.display = 'none';
    replayBtn.style.display = 'none';

  } else if (status === 'dipanggil') {
    // Spotlight transition — background cross-fade ke dark slate
    pesertaBg.classList.add('dipanggil');
    pesertaCard.classList.add('dipanggil');
    nomor.classList.add('dipanggil');
    badge.classList.add('dipanggil');
    dot.style.display = 'none'; // sembunyikan dot saat dipanggil
    label.textContent = '🔔 Dipanggil';

    if (loket !== null && loket !== undefined) {
      loketNumber.textContent = `Loket ${loket}`;
      loketBox.style.display = 'block';
      replayBtn.style.display = 'inline-flex';
      myLoket = loket;
      // TTS — ucapkan panggilan
      ucapkanPanggilan(myNomorAntrian, loket);
    } else {
      loketBox.style.display = 'none';
      replayBtn.style.display = 'none';
    }

  } else if (status === 'selesai') {
    badge.classList.add('selesai');
    dot.style.display = 'none';
    label.textContent = '✓ Selesai';
    loketBox.style.display = 'none';
    replayBtn.style.display = 'none';
    // Kembali ke background tenang
    pesertaBg.classList.remove('dipanggil');
    pesertaCard.classList.remove('dipanggil');
    nomor.classList.remove('dipanggil');
  }
}

// ============================================================
// Socket listeners
// ============================================================

socket.on('antrian:panggil', (data) => {
  if (data.nomor === myNomorAntrian) {
    updateStatusDisplay('dipanggil', data.loket ?? data.counter ?? null);
  }
});

socket.on('antrian:selesai', (data) => {
  if (data.nomor === myNomorAntrian) {
    updateStatusDisplay('selesai');
  }
});

// ============================================================
// Expose ke window untuk onclick handlers
// ============================================================

window.pilihPeserta = pilihPeserta;
window.ambilAntrian = ambilAntrian;
window.panggilLagi = panggilLagi;
