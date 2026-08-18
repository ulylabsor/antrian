// ============================================================
// Auth Panitia — gating akses dashboard panitia.
// Dimuat SEBELUM panitia.js. Mengekspos: apiFetch, isAuthed,
// showLoginModal, showChangePasswordModal. Memanggil
// window.initPanitiaDashboard() setelah login sukses (Task 8).
// ============================================================

const TOKEN_KEY = 'panitia_token';
const EXP_KEY = 'panitia_token_exp';

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function getExp() { return parseInt(localStorage.getItem(EXP_KEY) || '0', 10); }
function setToken(token, expiresAt) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EXP_KEY, String(expiresAt));
}
function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXP_KEY);
}

function isAuthed() {
  const t = getToken();
  if (!t) return false;
  return getExp() > Date.now();
}
window.isAuthed = isAuthed;

// fetch wrapper: otomatis tambah Authorization. 401 → bersihkan + modal login.
async function apiFetch(url, opts = {}) {
  const t = getToken();
  const headers = { ...(opts.headers || {}) };
  if (t) headers['Authorization'] = `Bearer ${t}`;
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) {
    clearToken();
    showLoginModal();
    if (window.showToast) window.showToast('Sesi habis, silakan login ulang', 'warning');
    throw new Error('Unauthorized');
  }
  return res;
}
window.apiFetch = apiFetch;

// ===== Modal login =====
function showLoginModal() {
  document.getElementById('dash')?.setAttribute('hidden', '');
  const ov = document.getElementById('auth-overlay');
  ov.classList.remove('hidden');
  ov.classList.add('flex');
  ov.innerHTML = `
    <div class="auth-card" style="transform:scale(0.96);opacity:0;transition:all .3s ease-out;max-width:420px;width:100%;border:1px solid var(--card-border-strong);border-radius:24px;box-shadow:var(--shadow-hero);padding:40px 36px;">
      <div style="display:flex;align-items:center;justify-content:center;gap:18px;margin-bottom:24px;">
        <img src="logo-radenfatah.png" alt="Logo UIN Raden Fatah Palembang" width="56" height="56" style="border-radius:14px;box-shadow:0 8px 24px -8px rgba(0,0,0,.6);">
        <img src="ppg.png" alt="Logo PPG" style="height:56px;width:auto;object-fit:contain;display:block;">
      </div>
      <div style="text-align:center;">
        <div style="color:var(--gold);font-size:.8rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:8px;">Dashboard Panitia</div>
        <h2 id="auth-title" style="color:var(--paper);font-family:var(--font-display);font-size:1.6rem;font-weight:800;margin:0 0 6px;">Akses Terkunci</h2>
        <div style="width:60px;height:3px;background:var(--gold);border-radius:2px;margin:12px auto 22px;"></div>
        <p style="color:var(--paper-dim);font-size:.9rem;margin:0 0 24px;">Masukkan password panitia untuk melanjutkan.</p>
      </div>
      <form id="auth-form" style="display:flex;flex-direction:column;gap:14px;">
        <div style="position:relative;">
          <svg style="position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--paper-mute);" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <input id="auth-password" type="password" placeholder="Password panitia" autocomplete="current-password"
            style="width:100%;padding:13px 44px 13px 42px;background:var(--card);border:1px solid var(--card-border-strong);border-radius:12px;color:var(--paper);font-size:.95rem;outline:none;">
          <button type="button" id="auth-toggle-eye" aria-label="Lihat password" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--paper-mute);cursor:pointer;padding:6px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
        <p id="auth-error" style="color:var(--rose);font-size:.82rem;margin:0;min-height:1em;text-align:center;"></p>
        <button type="submit" id="auth-submit"
          style="padding:13px;border:none;border-radius:12px;background:linear-gradient(135deg,var(--gold),var(--gold-bright));color:#1a1206;font-weight:700;font-size:.95rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 8px 24px -8px var(--gold-glow);">
          Buka Dashboard
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      </form>
      <div style="text-align:center;margin-top:22px;color:var(--paper-faint);font-size:.75rem;">PPG UIN Raden Fatah Palembang</div>
    </div>
  `;
  const card = ov.querySelector('.auth-card');
  requestAnimationFrame(() => { card.style.transform = 'scale(1)'; card.style.opacity = '1'; });
  const pwInput = ov.querySelector('#auth-password');
  const errEl = ov.querySelector('#auth-error');
  pwInput.focus();

  ov.querySelector('#auth-toggle-eye').addEventListener('click', () => {
    const eyeBtn = ov.querySelector('#auth-toggle-eye');
    if (pwInput.type === 'password') {
      pwInput.type = 'text';
      eyeBtn.setAttribute('aria-label', 'Sembunyikan password');
    } else {
      pwInput.type = 'password';
      eyeBtn.setAttribute('aria-label', 'Lihat password');
    }
  });

  function shake() {
    card.style.animation = 'none';
    void card.offsetWidth;
    card.style.animation = 'auth-shake .4s';
  }

  ov.querySelector('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    const btn = ov.querySelector('#auth-submit');
    btn.disabled = true; btn.style.opacity = '.7';
    try {
      const res = await fetch('/api/panitia/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwInput.value }),
      });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || 'Password salah'; shake(); pwInput.select(); return; }
      setToken(data.token, data.expiresAt);
      closeAuthModal();
      // Guard: window.initPanitiaDashboard() belum tersedia hingga Task 8.
      // Tanpa guard, login sukses melempar TypeError. closeAuthModal() sudah
      // menampilkan dashboard (#dash hidden dihapus), jadi UI tetap berfungsi.
      if (typeof window.initPanitiaDashboard === 'function') window.initPanitiaDashboard();
    } catch (err) {
      errEl.textContent = 'Koneksi bermasalah';
    } finally {
      btn.disabled = false; btn.style.opacity = '1';
    }
  });
}
window.showLoginModal = showLoginModal;

function closeAuthModal() {
  const ov = document.getElementById('auth-overlay');
  ov.classList.add('hidden');
  ov.classList.remove('flex');
  ov.innerHTML = '';
  document.getElementById('dash')?.removeAttribute('hidden');
}

// ===== Modal ganti password =====
function showChangePasswordModal() {
  const ov = document.getElementById('auth-overlay');
  ov.classList.remove('hidden'); ov.classList.add('flex');
  ov.innerHTML = `
    <div class="auth-card" style="max-width:420px;width:100%;border:1px solid var(--card-border-strong);border-radius:24px;box-shadow:var(--shadow-hero);padding:40px 36px;">
      <h2 style="color:var(--paper);font-family:var(--font-display);font-size:1.4rem;font-weight:800;margin:0 0 20px;text-align:center;">Ganti Password</h2>
      <form id="cp-form" style="display:flex;flex-direction:column;gap:14px;">
        <input id="cp-current" type="password" placeholder="Password saat ini" autocomplete="current-password"
          style="padding:13px 14px;background:var(--card);border:1px solid var(--card-border-strong);border-radius:12px;color:var(--paper);outline:none;">
        <input id="cp-new" type="password" placeholder="Password baru (min 6 karakter)" autocomplete="new-password"
          style="padding:13px 14px;background:var(--card);border:1px solid var(--card-border-strong);border-radius:12px;color:var(--paper);outline:none;">
        <input id="cp-confirm" type="password" placeholder="Ulangi password baru" autocomplete="new-password"
          style="padding:13px 14px;background:var(--card);border:1px solid var(--card-border-strong);border-radius:12px;color:var(--paper);outline:none;">
        <p id="cp-error" style="color:var(--rose);font-size:.82rem;margin:0;min-height:1em;text-align:center;"></p>
        <div style="display:flex;gap:12px;">
          <button type="button" id="cp-cancel" style="flex:1;padding:13px;border:1px solid var(--card-border-strong);border-radius:12px;background:transparent;color:var(--paper-dim);font-weight:600;cursor:pointer;">Batal</button>
          <button type="submit" style="flex:1;padding:13px;border:none;border-radius:12px;background:linear-gradient(135deg,var(--gold),var(--gold-bright));color:#1a1206;font-weight:700;cursor:pointer;">Simpan</button>
        </div>
      </form>
      <p style="text-align:center;margin-top:16px;color:var(--paper-faint);font-size:.78rem;">Setelah ganti, Anda akan diminta login ulang.</p>
    </div>
  `;
  ov.querySelector('#cp-current').focus();
  ov.querySelector('#cp-cancel').addEventListener('click', closeAuthModal);
  ov.querySelector('#cp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cur = ov.querySelector('#cp-current').value;
    const nw = ov.querySelector('#cp-new').value;
    const cf = ov.querySelector('#cp-confirm').value;
    const errEl = ov.querySelector('#cp-error');
    errEl.textContent = '';
    if (nw !== cf) { errEl.textContent = 'Konfirmasi password tidak cocok'; return; }
    if (nw.length < 6) { errEl.textContent = 'Password baru minimal 6 karakter'; return; }
    try {
      const res = await apiFetch('/api/panitia/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: cur, newPassword: nw }),
      });
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error || 'Gagal'; return; }
      closeAuthModal();
      clearToken();
      if (window.showToast) window.showToast('Password diubah, silakan login ulang', 'success');
      showLoginModal();
    } catch (err) { errEl.textContent = 'Koneksi bermasalah'; }
  });
}
window.showChangePasswordModal = showChangePasswordModal;

// ===== Wiring tombol Ganti Password di settings panel =====
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-change-password');
  if (btn) btn.addEventListener('click', () => window.showChangePasswordModal());
});

// ===== Init: gate dashboard =====
// Dijalankan setelah DOM + semua script (termasuk panitia.js) siap.
// Sebelumnya IIFE dipanggil saat auth-panitia.js dieksekusi — panitia.js
// belum load sehingga window.initPanitiaDashboard === undefined dan
// semua listener (termasuk btn-settings) tidak pernah terpasang pada
// alur refresh-sudah-authed. Dengan DOMContentLoaded kedua script pasti
// sudah dieksekusi.
function runAuthGate() {
  if (isAuthed()) {
    document.getElementById('dash')?.removeAttribute('hidden');
    if (typeof window.initPanitiaDashboard === 'function') window.initPanitiaDashboard();
  } else {
    clearToken();
    showLoginModal();
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runAuthGate);
} else {
  runAuthGate();
}
