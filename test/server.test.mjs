// Tests for HTTP endpoints and WebSocket RFC6455 room/relay protocol
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

console.log('Running server tests...');

const TEST_PORT = 3456;
const env = { ...process.env, PORT: String(TEST_PORT) };
const serverProc = spawn('node', ['server/server.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });

let serverOutput = '';
serverProc.stdout.on('data', d => { serverOutput += d.toString(); });
serverProc.stderr.on('data', d => { serverOutput += d.toString(); });

async function waitForServer(timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
      if (res.ok) return;
    } catch {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  throw new Error(`Server did not start in time. Output:\n${serverOutput}`);
}

class SimpleWsClient {
  constructor(port) {
    this.port = port;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.messages = [];
    this.listeners = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.connect(this.port, '127.0.0.1', () => {
        const key = crypto.randomBytes(16).toString('base64');
        const req = [
          'GET /ws HTTP/1.1',
          `Host: 127.0.0.1:${this.port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '',
          '',
        ].join('\r\n');
        this.socket.write(req);
      });

      let handshook = false;
      this.socket.on('data', (chunk) => {
        if (!handshook) {
          const str = chunk.toString();
          if (str.includes('HTTP/1.1 101 Switching Protocols')) {
            handshook = true;
            resolve();
            return;
          }
        }
        this._onData(chunk);
      });
      this.socket.on('error', reject);
    });
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this.buffer.length < 4) break;
        len = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) break;
        len = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (this.buffer.length < offset + len) break;
      const payload = this.buffer.subarray(offset, offset + len);
      this.buffer = this.buffer.subarray(offset + len);
      const text = payload.toString('utf8');
      try {
        const parsed = JSON.parse(text);
        this.messages.push(parsed);
        this._notify();
      } catch {
        // text ignored
      }
    }
  }

  _notify() {
    for (let i = this.listeners.length - 1; i >= 0; i--) {
      const { predicate, resolve } = this.listeners[i];
      const matchIdx = this.messages.findIndex(predicate);
      if (matchIdx !== -1) {
        const [found] = this.messages.splice(matchIdx, 1);
        this.listeners.splice(i, 1);
        resolve(found);
      }
    }
  }

  waitForMessage(predicate, timeout = 3000) {
    const matchIdx = this.messages.findIndex(predicate);
    if (matchIdx !== -1) {
      const [found] = this.messages.splice(matchIdx, 1);
      return Promise.resolve(found);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for WS message. Current: ${JSON.stringify(this.messages)}`));
      }, timeout);
      this.listeners.push({
        predicate,
        resolve: (msg) => { clearTimeout(timer); resolve(msg); },
      });
    });
  }

  send(data) {
    const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
    const maskKey = crypto.randomBytes(4);
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ maskKey[i & 3];

    let header;
    if (payload.length < 126) {
      header = Buffer.from([0x81, 0x80 | payload.length]);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    this.socket.write(Buffer.concat([header, maskKey, masked]));
  }

  close() {
    if (this.socket) this.socket.destroy();
  }
}

try {
  await waitForServer();

  // 1. HTTP /health test
  const healthRes = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
  assert.equal(healthRes.status, 200);
  const healthData = await healthRes.json();
  assert.equal(healthData.ok, true);

  // 2. Static file serving test (public/js/world.js)
  const worldRes = await fetch(`http://127.0.0.1:${TEST_PORT}/js/world.js`);
  assert.equal(worldRes.status, 200);
  const worldJsText = await worldRes.text();
  assert.ok(worldJsText.includes('WORLD'));

  // 3. WebSocket Room Creation and Join
  const host = new SimpleWsClient(TEST_PORT);
  await host.connect();
  host.send({ t: 'ping' });
  const pong = await host.waitForMessage(m => m.t === 'pong');
  assert.ok(pong.ts);

  host.send({ t: 'create', name: 'Alpha' });
  const created = await host.waitForMessage(m => m.t === 'created');
  assert.equal(created.role, 'host');
  assert.ok(created.code);
  const roomCode = created.code;

  const guest = new SimpleWsClient(TEST_PORT);
  await guest.connect();
  guest.send({ t: 'join', code: roomCode, name: 'Bravo' });
  const joined = await guest.waitForMessage(m => m.t === 'joined');
  assert.equal(joined.role, 'guest');
  assert.equal(joined.code, roomCode);

  const peerJoined = await host.waitForMessage(m => m.t === 'peer_joined');
  assert.equal(peerJoined.name, 'Bravo');

  // 4. WebSocket Message Relay (guest -> host and host -> guest)
  guest.send({ t: 'relay', data: { test: 'hello from guest' } });
  const hostRelayed = await host.waitForMessage(m => m.t === 'relay');
  assert.equal(hostRelayed.from, 'guest');
  assert.equal(hostRelayed.data.test, 'hello from guest');

  host.send({ t: 'relay', data: { snapshot: 1234 } });
  const guestRelayed = await guest.waitForMessage(m => m.t === 'relay');
  assert.equal(guestRelayed.from, 'host');
  assert.equal(guestRelayed.data.snapshot, 1234);

  host.close();
  guest.close();

  console.log('Server tests passed successfully!');
} finally {
  serverProc.kill();
}
