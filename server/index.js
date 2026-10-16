// Servidor HTTP + WebSocket. En desarrollo (--dev) sirve el cliente con Vite;
// en producción sirve la carpeta dist/ generada con `npm run build`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './game.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.fbx': 'application/octet-stream', '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  const dist = path.join(ROOT, 'dist');
  const url = new URL(req.url, 'http://x');
  let file = path.normalize(path.join(dist, decodeURIComponent(url.pathname)));
  if (!file.startsWith(dist)) {
    res.writeHead(403).end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(500).end('Falta dist/. Ejecuta "npm run build" o usa "npm run dev".');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

export async function createServer(port = PORT, { dev = DEV } = {}) {
  let handler = serveStatic;
  if (dev) {
    const { createServer: createVite } = await import('vite');
    const vite = await createVite({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'spa' });
    handler = (req, res) => vite.middlewares(req, res);
  }
  const server = http.createServer((req, res) => handler(req, res));
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://x').pathname !== '/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  const rooms = new Map();
  let nextId = 1;

  function newCode() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code;
    do {
      code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
    } while (rooms.has(code));
    return code;
  }

  wss.on('connection', (ws) => {
    const id = String(nextId++);
    let room = null;
    const send = (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (!room) {
        const name = String(msg.name || 'Jugador').slice(0, 16);
        if (msg.t === 'create') {
          const code = newCode();
          room = new Room(code, (c) => rooms.delete(c));
          rooms.set(code, room);
          room.addPlayer(id, name, send);
        } else if (msg.t === 'join') {
          const target = rooms.get(String(msg.code || '').toUpperCase());
          if (!target) send({ t: 'error', msg: 'No existe una sala con ese código.' });
          else if (!target.addPlayer(id, name, send)) send({ t: 'error', msg: 'La sala está llena (máximo 4).' });
          else room = target;
        }
        return;
      }
      room.handle(id, msg);
    });

    ws.on('close', () => room?.removePlayer(id));
  });

  await new Promise((resolve) => server.listen(port, resolve));
  return { server, wss, rooms };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().then(() => {
    console.log(`Última Compra en http://localhost:${PORT}${DEV ? ' (modo desarrollo)' : ''}`);
  });
}
