import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, initAuth } from './src/db.js';
import { createRouter } from './src/routes.js';
import { setupSocket } from './src/socket.js';

dotenv.config();

// Wajib ada AUTH_SECRET untuk menandatangani token panitia.
if (!process.env.AUTH_SECRET) {
  console.error("FATAL: AUTH_SECRET belum di-set di .env. Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Init database
initDb();
initAuth();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());

// Clean URLs: akses tanpa ekstensi .html (mis. /panitia → panitia.html).
// Didefinisikan SEBELUM express.static supaya request clean-path dicegat dulu.
// .html lama tetap berfungsi (express.static serve apa adanya) — kompatibel
// dengan bookmark pengguna & cache Cloudflare yang mungkin masih pakai .html.
const PAGES = ['panitia', 'info', 'data'];
app.use((req, res, next) => {
  const seg = req.path.split('/')[1];
  if (seg && PAGES.includes(seg) && !req.path.includes('.')) {
    req.url = '/' + seg + '.html';
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', createRouter(io));

// Socket.io
setupSocket(io);

const PORT = process.env.PORT || 3000;

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
  console.log(`Dashboard panitia: http://localhost:${PORT}/panitia`);
});

export { app, server, io };
