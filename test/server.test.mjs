import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, '..', 'server', 'server.mjs');
const TEST_PORT = 3123;

async function runTests() {
  const serverProcess = fork(SERVER_PATH, [], {
    env: { ...process.env, PORT: String(TEST_PORT) },
    stdio: 'pipe',
  });

  try {
    // Wait for server to start listening
    await new Promise((resolve, reject) => {
      let started = false;
      serverProcess.stdout.on('data', (d) => {
        if (d.toString().includes('VICE DEAD server running:')) {
          started = true;
          resolve();
        }
      });
      serverProcess.on('error', reject);
      setTimeout(() => {
        if (!started) resolve(); // fallback to polling
      }, 1000);
    });

    const baseUrl = `http://localhost:${TEST_PORT}`;

    // 1. HTTP health check
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.ok, true);
    assert.equal(typeof healthData.rooms, 'number');

    // 2. HTTP static file (e.g. /js/world.js)
    const staticRes = await fetch(`${baseUrl}/js/world.js`);
    assert.equal(staticRes.status, 200);
    const staticText = await staticRes.text();
    assert.ok(staticText.includes('WORLD'));

    // 3. HTTP 404 for non-existent file
    const notFoundRes = await fetch(`${baseUrl}/nonexistent-file.xyz`);
    assert.equal(notFoundRes.status, 404);

    // 4. WebSocket tests
    const wsUrl = `ws://localhost:${TEST_PORT}/ws`;

    // Helper to create and wait for open
    function connectWS() {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        ws.onopen = () => resolve(ws);
        ws.onerror = reject;
      });
    }

    const hostWs = await connectWS();
    const guestWs = await connectWS();

    function waitForMessage(ws, predicate) {
      return new Promise((resolve) => {
        const handler = (event) => {
          const msg = JSON.parse(event.data);
          if (!predicate || predicate(msg)) {
            ws.removeEventListener('message', handler);
            resolve(msg);
          }
        };
        ws.addEventListener('message', handler);
      });
    }

    // Ping / Pong test
    const pongPromise = waitForMessage(hostWs, m => m.t === 'pong');
    hostWs.send(JSON.stringify({ t: 'ping' }));
    const pongMsg = await pongPromise;
    assert.equal(pongMsg.t, 'pong');
    assert.ok(typeof pongMsg.ts === 'number');

    // Room creation
    const createdPromise = waitForMessage(hostWs, m => m.t === 'created');
    hostWs.send(JSON.stringify({ t: 'create', name: 'HostPlayer' }));
    const createdMsg = await createdPromise;
    assert.equal(createdMsg.t, 'created');
    assert.equal(createdMsg.role, 'host');
    assert.equal(createdMsg.name, 'HostPlayer');
    assert.ok(createdMsg.code);
    const roomCode = createdMsg.code;

    // Guest joins room
    const peerJoinedPromise = waitForMessage(hostWs, m => m.t === 'peer_joined');
    const joinedPromise = waitForMessage(guestWs, m => m.t === 'joined');
    guestWs.send(JSON.stringify({ t: 'join', code: roomCode, name: 'GuestPlayer' }));

    const [peerJoinedMsg, joinedMsg] = await Promise.all([peerJoinedPromise, joinedPromise]);
    assert.equal(peerJoinedMsg.t, 'peer_joined');
    assert.equal(peerJoinedMsg.name, 'GuestPlayer');
    assert.equal(joinedMsg.t, 'joined');
    assert.equal(joinedMsg.role, 'guest');
    assert.equal(joinedMsg.code, roomCode);

    // Relay message: Host -> Guest
    const relayToGuestPromise = waitForMessage(guestWs, m => m.t === 'relay');
    hostWs.send(JSON.stringify({ t: 'relay', data: { hello: 'from host' } }));
    const relayToGuestMsg = await relayToGuestPromise;
    assert.equal(relayToGuestMsg.from, 'host');
    assert.deepEqual(relayToGuestMsg.data, { hello: 'from host' });

    // Relay message: Guest -> Host
    const relayToHostPromise = waitForMessage(hostWs, m => m.t === 'relay');
    guestWs.send(JSON.stringify({ t: 'relay', data: { hello: 'from guest' } }));
    const relayToHostMsg = await relayToHostPromise;
    assert.equal(relayToHostMsg.from, 'guest');
    assert.deepEqual(relayToHostMsg.data, { hello: 'from guest' });

    // Clean up WebSockets
    hostWs.close();
    guestWs.close();

    console.log('server.test.mjs passed successfully');
  } finally {
    serverProcess.kill();
  }
}

runTests().catch((err) => {
  console.error('server.test.mjs failed:', err);
  process.exit(1);
});
