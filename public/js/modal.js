// ============================================================
// Modal System — Reusable, informatif, dan accessibility-friendly
// Menyediakan: showToast(), showConfirm(), showInfo()
// Mengganti alert()/confirm() native dengan UI yang lebih bagus.
// ============================================================

// Pastikan container ada di DOM (dibuat sekali, dipakai bersama)
function ensureOverlay() {
  let ov = document.getElementById('modal-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'modal-overlay';
    ov.className = 'fixed inset-0 z-[1000] hidden items-center justify-center p-4 bg-black/50 backdrop-blur-sm';
    ov.addEventListener('click', (e) => {
      // Klik backdrop (bukan konten) → tutup hanya untuk toast/info, bukan confirm
      if (e.target === ov && ov.dataset.dismissable !== 'false') {
        closeModal();
      }
    });
    // Tutup dengan Escape (hanya untuk non-confirm)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !ov.classList.contains('hidden') && ov.dataset.dismissable !== 'false') {
        closeModal();
      }
    });
    document.body.appendChild(ov);
  }
  return ov;
}

// Tutup modal & kosongkan konten
function closeModal() {
  const ov = document.getElementById('modal-overlay');
  if (!ov) return;
  ov.classList.add('hidden');
  ov.classList.remove('flex');
  ov.innerHTML = '';
  ov.dataset.dismissable = 'true';
  document.body.style.overflow = '';
}

// ===== Toast notifikasi singkat (auto-dismiss 4s) =====
// type: 'success' | 'error' | 'info' | 'warning'
function showToast(message, type = 'info', duration = 4000) {
  const ov = ensureOverlay();
  // Toast tidak modal-blocking — tampilkan di pojok, bukan overlay tengah
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    stack.className = 'fixed top-4 right-4 z-[1001] flex flex-col gap-2 max-w-sm';
    document.body.appendChild(stack);
  }

  const styles = {
    success: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', icon: 'M20 6 9 17l-5-5', iconBg: 'bg-green-600' },
    error: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', icon: 'M18 6 6 18 M6 6l12 12', iconBg: 'bg-red-600' },
    warning: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', icon: 'M12 9v4 M12 17h.01 M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', iconBg: 'bg-amber-600' },
    info: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800', icon: 'M12 16v-4 M12 8h.01', iconBg: 'bg-blue-600' },
  };
  const s = styles[type] || styles.info;

  const toast = document.createElement('div');
  toast.className = `flex items-start gap-3 ${s.bg} ${s.text} border ${s.border} rounded-xl shadow-lg p-4 transition-all duration-300 transform translate-x-full opacity-0`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.innerHTML = `
    <div class="flex-shrink-0 w-8 h-8 ${s.iconBg} text-white rounded-full flex items-center justify-center">
      <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${s.icon}"/></svg>
    </div>
    <div class="flex-1 text-sm font-medium leading-relaxed">${escapeHtml(message)}</div>
    <button class="flex-shrink-0 text-current opacity-50 hover:opacity-100 transition-opacity cursor-pointer" aria-label="Tutup notifikasi">
      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18 M6 6l12 12"/></svg>
    </button>
  `;

  // Tombol tutup manual
  toast.querySelector('button').addEventListener('click', () => removeToast(toast));
  stack.appendChild(toast);

  // Animasi masuk
  requestAnimationFrame(() => {
    toast.classList.remove('translate-x-full', 'opacity-0');
  });

  // Auto-dismiss
  const timer = setTimeout(() => removeToast(toast), duration);
  toast.dataset.timer = timer;
}

function removeToast(toast) {
  if (!toast || !toast.parentNode) return;
  clearTimeout(Number(toast.dataset.timer));
  toast.classList.add('translate-x-full', 'opacity-0');
  setTimeout(() => toast.remove(), 300);
}

// ===== Modal info (tombol OK tunggal) =====
// opts: { title, message, type, confirmText, onConfirm }
// type: 'success' | 'error' | 'info' | 'warning'
function showInfo(opts) {
  const { title = '', message = '', type = 'info', confirmText = 'OK', onConfirm } = opts || {};
  const ov = ensureOverlay();
  ov.dataset.dismissable = 'true';
  const cfg = iconConfig(type);
  ov.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="flex flex-col items-center pt-6 px-6">
        <div class="w-16 h-16 ${cfg.iconBg} text-white rounded-full flex items-center justify-center mb-4 shadow-lg">
          <svg class="w-9 h-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${cfg.icon}"/></svg>
        </div>
        ${title ? `<h3 id="modal-title" class="text-lg font-bold text-gray-800 text-center mb-2">${escapeHtml(title)}</h3>` : ''}
        <p class="text-gray-600 text-center text-sm leading-relaxed mb-5 whitespace-pre-line">${escapeHtml(message)}</p>
      </div>
      <div class="px-6 pb-6">
        <button id="modal-ok" class="w-full ${cfg.btnBg} ${cfg.btnHover} text-white font-semibold py-3 rounded-xl transition-all hover:shadow-md active:scale-[0.98] cursor-pointer">
          ${escapeHtml(confirmText)}
        </button>
      </div>
    </div>
  `;
  showOverlay();
  const okBtn = ov.querySelector('#modal-ok');
  okBtn.focus();
  okBtn.addEventListener('click', () => {
    closeModal();
    if (typeof onConfirm === 'function') onConfirm();
  });
}

// ===== Modal konfirmasi (tombol Batal + Konfirmasi) =====
// opts: { title, message, type, confirmText, cancelText, onConfirm, onCancel }
// type: 'success' | 'error' | 'info' | 'warning' | 'danger'
function showConfirm(opts) {
  const {
    title = 'Konfirmasi',
    message = '',
    type = 'info',
    confirmText = 'Konfirmasi',
    cancelText = 'Batal',
    onConfirm,
    onCancel,
  } = opts || {};
  const ov = ensureOverlay();
  ov.dataset.dismissable = 'false'; // Escape/backdrop tidak tutup confirm
  const cfg = iconConfig(type);
  ov.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all" role="alertdialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="flex flex-col items-center pt-6 px-6">
        <div class="w-16 h-16 ${cfg.iconBg} text-white rounded-full flex items-center justify-center mb-4 shadow-lg">
          <svg class="w-9 h-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${cfg.icon}"/></svg>
        </div>
        <h3 id="modal-title" class="text-lg font-bold text-gray-800 text-center mb-2">${escapeHtml(title)}</h3>
        <p class="text-gray-600 text-center text-sm leading-relaxed mb-5 whitespace-pre-line">${escapeHtml(message)}</p>
      </div>
      <div class="px-6 pb-6 flex gap-3">
        <button id="modal-cancel" class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 rounded-xl transition-all hover:shadow-sm active:scale-[0.98] cursor-pointer">
          ${escapeHtml(cancelText)}
        </button>
        <button id="modal-confirm" class="flex-1 ${cfg.btnBg} ${cfg.btnHover} text-white font-semibold py-3 rounded-xl transition-all hover:shadow-md active:scale-[0.98] cursor-pointer">
          ${escapeHtml(confirmText)}
        </button>
      </div>
    </div>
  `;
  showOverlay();
  const cancelBtn = ov.querySelector('#modal-cancel');
  const confirmBtn = ov.querySelector('#modal-confirm');
  confirmBtn.focus();
  cancelBtn.addEventListener('click', () => {
    closeModal();
    if (typeof onCancel === 'function') onCancel();
  });
  confirmBtn.addEventListener('click', () => {
    closeModal();
    if (typeof onConfirm === 'function') onConfirm();
  });
}

// ===== Helper =====
function showOverlay() {
  const ov = document.getElementById('modal-overlay');
  ov.classList.remove('hidden');
  ov.classList.add('flex');
  document.body.style.overflow = 'hidden'; // cegah scroll background
}

function iconConfig(type) {
  const configs = {
    success: { iconBg: 'bg-green-600', btnBg: 'bg-green-600', btnHover: 'hover:bg-green-700', icon: 'M20 6 9 17l-5-5' },
    error: { iconBg: 'bg-red-600', btnBg: 'bg-red-600', btnHover: 'hover:bg-red-700', icon: 'M18 6 6 18 M6 6l12 12' },
    warning: { iconBg: 'bg-amber-500', btnBg: 'bg-amber-500', btnHover: 'hover:bg-amber-600', icon: 'M12 9v4 M12 17h.01 M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' },
    danger: { iconBg: 'bg-red-600', btnBg: 'bg-red-600', btnHover: 'hover:bg-red-700', icon: 'M12 9v4 M12 17h.01 M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' },
    info: { iconBg: 'bg-blue-600', btnBg: 'bg-blue-600', btnHover: 'hover:bg-blue-700', icon: 'M12 16v-4 M12 8h.01' },
  };
  return configs[type] || configs.info;
}

// Escape HTML untuk mencegah XSS
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Expose ke window
window.showToast = showToast;
window.showConfirm = showConfirm;
window.showInfo = showInfo;
window.closeModal = closeModal;
