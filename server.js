import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './src/db.js';
import { createRouter } from './src/routes.js';
import { setupSocket } from './src/socket.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Init database
initDb();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', createRouter(io));

// Socket.io
setupSocket(io);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
  console.log(`Dashboard panitia: http://localhost:${PORT}/panitia.html`);
});

export { app, server, io };
