// VICE DEAD — Client WebSocket Networking and Multiplayer Synchronization
import { createSim, spawnPlayers, stepSim } from './sim.js';
import { setSimState, currentSim, myPlayerId } from './client.js';

let ws = null;
let roomCode = null;
let playerRole = null;
let guestInput = null;

const statusEl = document.getElementById('room-status');
const btnHost = document.getElementById('btn-host');
const btnJoin = document.getElementById('btn-join');
const roomInput = document.getElementById('room-code-input');

function setStatus(text, isError = false) {
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.style.color = isError ? '#ff2d55' : '#ffb300';
  }
}

function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/ws`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    // Keepalive ping
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: 'ping' }));
      }
    }, 15000);
  };

  ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    handleNetworkMessage(msg);
  };

  ws.onclose = () => {
    setStatus('Disconnected from server.', true);
  };

  ws.onerror = () => {
    setStatus('Connection error.', true);
  };

  return ws;
}

function handleNetworkMessage(msg) {
  switch (msg.t) {
    case 'created': {
      roomCode = msg.code;
      playerRole = 'host';
      setStatus(`Room created! Code: ${roomCode}. Waiting for Player 2...`);

      // Initialize authoritative simulation
      const sim = createSim({ seed: Math.floor(Math.random() * 999999), players: 2 });
      const hostName = document.getElementById('player-name').value.trim() || 'Player 1';
      spawnPlayers(sim, [hostName, 'Waiting...']);
      const myId = sim.players[0].id;

      setSimState(sim, myId, true, true, ws);
      break;
    }
    case 'joined': {
      roomCode = msg.code;
      playerRole = 'guest';
      setStatus(`Joined room ${roomCode}! Connecting to host...`);

      // Guest starts with blank simulation until host syncs
      const guestName = document.getElementById('player-name').value.trim() || 'Player 2';
      const sim = createSim({ seed: 1, players: 2 });
      spawnPlayers(sim, ['Host', guestName]);
      const myId = sim.players[1].id;

      setSimState(sim, myId, false, true, ws);

      // Launch UI
      document.getElementById('lobby-screen').classList.add('hidden');
      document.getElementById('hud').classList.add('active');
      document.getElementById('crosshair').classList.add('active');
      break;
    }
    case 'peer_joined': {
      setStatus(`Peer "${msg.name}" joined! Starting match...`);
      if (currentSim && currentSim.players[1]) {
        currentSim.players[1].name = msg.name;
      }
      setTimeout(() => {
        document.getElementById('lobby-screen').classList.add('hidden');
        document.getElementById('hud').classList.add('active');
        document.getElementById('crosshair').classList.add('active');
      }, 500);
      break;
    }
    case 'relay': {
      if (msg.data.type === 'guest_input') {
        guestInput = msg.data.input;
        if (currentSim && currentSim.players[1]) {
          const inputs = {};
          inputs[currentSim.players[1].id] = guestInput;
          stepSim(currentSim, guestInput.dt || 0.016, inputs);
        }
      } else if (msg.data.type === 'sim_sync') {
        // Sync simulation snapshot onto guest
        if (playerRole === 'guest' && currentSim) {
          const remote = msg.data.simState;
          currentSim.t = remote.t;
          currentSim.wave = remote.wave;
          currentSim.waveState = remote.waveState;
          currentSim.waveTimer = remote.waveTimer;
          currentSim.score = remote.score;
          currentSim.kills = remote.kills;
          currentSim.over = remote.over;
          currentSim.zombies = remote.zombies;
          currentSim.pickups = remote.pickups;
          // Sync players without resetting guest's local view
          for (let i = 0; i < remote.players.length; i++) {
            if (currentSim.players[i]) {
              const rp = remote.players[i];
              const lp = currentSim.players[i];
              lp.hp = rp.hp;
              lp.alive = rp.alive;
              lp.mag = rp.mag;
              lp.score = rp.score;
              lp.kills = rp.kills;
              lp.weapon = rp.weapon;
              if (lp.id !== myPlayerId) {
                lp.x = rp.x;
                lp.z = rp.z;
                lp.yaw = rp.yaw;
                lp.pitch = rp.pitch;
              }
            }
          }
        }
      }
      break;
    }
    case 'peer_left': {
      setStatus('Peer has left the game.', true);
      break;
    }
    case 'host_gone': {
      setStatus('Host disconnected. Returning to lobby...', true);
      setTimeout(() => {
        window.location.reload();
      }, 2000);
      break;
    }
    case 'error': {
      setStatus(`Error: ${msg.msg}`, true);
      break;
    }
  }
}

// Button actions
btnHost?.addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) ws = initWebSocket();
  const name = document.getElementById('player-name').value.trim() || 'Player 1';
  setStatus('Creating room on server...');
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ t: 'create', name }));
  } else {
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ t: 'create', name }));
    }, { once: true });
  }
});

btnJoin?.addEventListener('click', () => {
  const code = (roomInput.value || '').trim().toUpperCase();
  if (!code || code.length !== 4) {
    setStatus('Please enter a valid 4-character room code.', true);
    return;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) ws = initWebSocket();
  const name = document.getElementById('player-name').value.trim() || 'Player 2';
  setStatus(`Joining room ${code}...`);
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ t: 'join', code, name }));
  } else {
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ t: 'join', code, name }));
    }, { once: true });
  }
});

export { initWebSocket, ws };
