// VICE DEAD — multiplayer game server (zero dependencies).
// Serves the static client and relays WebSocket messages between the two
// players of a room. Game logic & simulation live in the host's browser.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptWebSocket } from './ws.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

// ---- rooms -----------------------------------------------------------------
const rooms = new Map(); // code -> { code, host:Conn|null, guest:Conn|null, createdAt }
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing 0/O/1/I

function newCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function createRoom(code) {
  const room = { code, host: null, guest: null, createdAt: Date.now() };
  rooms.set(code, room);
  return room;
}

function destroyRoom(code) {
  rooms.delete(code);
}

function sendToPeer(me, room, msg) {
  const peer = me === room.host ? room.guest : room.host;
  if (peer && peer.socket && !peer.socket.destroyed) {
    peer.send(msg);
  }
}

// ---- client connections ----------------------------------------------------
const clients = new Set();

function onConnection(conn) {
  conn._state = { uid: Math.random().toString(36).slice(2), code: null, role: null, name: 'Player' };
  clients.add(conn);

  conn.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    handleMessage(conn, msg);
  });

  conn.on('close', () => {
    clients.delete(conn);
    const s = conn._state;
    if (s.code && s.role === 'host') {
      const room = rooms.get(s.code);
      if (room) {
        if (room.guest) room.guest.send({ t: 'host_gone' });
        destroyRoom(s.code);
      }
    } else if (s.code && s.role === 'guest') {
      const room = rooms.get(s.code);
      if (room) {
        room.guest = null;
        if (room.host) room.host.send({ t: 'peer_left' });
      }
    }
  });
}

function handleMessage(conn, msg) {
  const s = conn._state;
  switch (msg.t) {
    case 'ping': {
      conn.send({ t: 'pong', ts: Date.now() });
      break;
    }
    case 'create': {
      const code = newCode();
      const room = createRoom(code);
      s.code = code;
      s.role = 'host';
      s.name = (msg.name || 'Player 1').slice(0, 24);
      room.host = conn;
      conn.send({ t: 'created', code, role: 'host', id: s.uid, name: s.name });
      break;
    }
    case 'join': {
      const code = String(msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { conn.send({ t: 'error', msg: 'Room not found' }); break; }
      if (room.guest) { conn.send({ t: 'error', msg: 'Room is full' }); break; }
      s.code = code;
      s.role = 'guest';
      s.name = (msg.name || 'Player 2').slice(0, 24);
      room.guest = conn;
      conn.send({ t: 'joined', code, role: 'guest', id: s.uid, name: s.name });
      if (room.host) room.host.send({ t: 'peer_joined', id: s.uid, name: s.name });
      break;
    }
    case 'relay': {
      // forward to peer (host <-> guest)
      const room = rooms.get(s.code);
      if (!room) break;
      sendToPeer(conn, room, { t: 'relay', from: s.role, data: msg.data });
      break;
    }
    case 'leave': {
      const room = rooms.get(s.code);
      s.code = null; s.role = null;
      if (room) {
        if (s.role === 'host') destroyRoom(room.code);
        // role already cleared; use explicit path below
      }
      break;
    }
    default:
      break;
  }
}

// ---- HTTP server -----------------------------------------------------------
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  let pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  if (pathname === '/') pathname = '/index.html';
  const safe = path.normalize(path.join(ROOT, pathname));
  if (!safe.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(safe, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(safe).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.on('upgrade', (req, socket, head) => {
  if ((req.url || '').split('?')[0] !== '/ws') {
    socket.destroy();
    return;
  }
  const conn = acceptWebSocket(req, socket, head);
  if (conn) onConnection(conn);
});

// keepalive sweep
setInterval(() => {
  for (const room of rooms.values()) {
    if (Date.now() - room.createdAt > 6 * 3600 * 1000) {
      if (room.host) room.host.close();
      if (room.guest) room.guest.close();
      destroyRoom(room.code);
    }
  }
}, 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`\n  VICE DEAD server running:`);
  console.log(`    local:   http://localhost:${PORT}`);
  console.log(`    network: http://<your-ip>:${PORT}\n`);
}).on('error', (e) => {
  console.error('Failed to start server:', e.message);
  process.exit(1);
});