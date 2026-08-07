import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getPanitiaAuth } from './db.js';

// AUTH_SECRET dibaca lazy (bukan ditangkap saat module-load) karena test
// menyetel process.env.AUTH_SECRET di beforeEach, yang berjalan SETELAH modul
// ini di-import. Jika ditangkap saat import, SECRET akan undefined dan
// crypto.createHmac akan gagal. Baca fresh setiap pemanggilan sign/verify.
function getSecret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET belum dikonfigurasi');
  return s;
}

const TTL_HOURS = parseInt(process.env.PANITIA_TOKEN_TTL_HOURS || '8', 10);

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function comparePassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function b64urlDecode(str) { return Buffer.from(str, 'base64url'); }

export function signToken({ ver }) {
  const exp = Date.now() + TTL_HOURS * 3600 * 1000;
  const payload = JSON.stringify({ role: 'panitia', ver, exp });
  const payloadB64 = b64url(payload);
  const sig = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest();
  return `${payloadB64}.${b64url(sig)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return { ok: false, expired: false };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, expired: false };
  const [payloadB64, sigB64] = parts;
  const expectedSig = crypto.createHmac('sha256', getSecret()).update(payloadB64).digest();
  const sigBuf = b64urlDecode(sigB64);
  if (expectedSig.length !== sigBuf.length || !crypto.timingSafeEqual(expectedSig, sigBuf)) {
    return { ok: false, expired: false };
  }
  let payload;
  try { payload = JSON.parse(b64urlDecode(payloadB64).toString()); }
  catch { return { ok: false, expired: false }; }
  if (payload.role !== 'panitia') return { ok: false, expired: false };
  if (payload.exp <= Date.now()) return { ok: false, expired: true };
  const auth = getPanitiaAuth();
  if (!auth || payload.ver !== auth.token_version) return { ok: false, expired: false };
  return { ok: true, expired: false };
}

export function requirePanitia(req, res, next) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(.+)$/);
  if (!m) return res.status(401).json({ error: 'Token tidak valid atau sesi habis' });
  const result = verifyToken(m[1]);
  if (!result.ok) return res.status(401).json({ error: 'Token tidak valid atau sesi habis' });
  next();
}

// Rate-limit login: max 5 per 60 detik per IP. In-memory (single-process).
const attempts = new Map();
const WINDOW_MS = 60_000;
const MAX = 5;

export function loginRateLimit(req, res, next) {
  const ip = req.ip || req.headers['x-test-ip'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let rec = attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) {
    rec = { count: 0, first: now };
    attempts.set(ip, rec);
  }
  rec.count++;
  if (rec.count > MAX) {
    return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  }
  next();
}
