// VICE DEAD — Client WebGL renderer, audio/effects, input controller, and game loop.
import { WORLD, districtNameAt, collidersNear } from './world.js';
import { WEAPONS, WEAPON_ORDER, createSim, spawnPlayers, stepSim, reloadNow } from './sim.js';

// ---- WebGL & Canvas Setup ----
const canvas = document.getElementById('game-canvas');
const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
if (!gl) {
  alert('WebGL not supported in your browser.');
}

// Global state
let currentSim = null;
let myPlayerId = null;
let isHost = true;
let isOnline = false;
let ws = null;

// Controls & Inputs
const keys = {};
const mouse = { x: 0, y: 0, down: false };
let pointerLocked = false;
let yaw = 0;
let pitch = 0;
let lastTime = performance.now();

// Shader Sources
const vsSource = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  attribute vec3 aColor;

  uniform mat4 uProjection;
  uniform mat4 uView;
  uniform mat4 uModel;

  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vFragPos;

  void main() {
    vec4 worldPos = uModel * vec4(aPosition, 1.0);
    vFragPos = worldPos.xyz;
    vNormal = mat3(uModel) * aNormal;
    vColor = aColor;
    gl_Position = uProjection * uView * worldPos;
  }
`;

const fsSource = `
  precision mediump float;

  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vFragPos;

  uniform vec3 uSunDir;
  uniform vec3 uCameraPos;
  uniform float uFogDensity;
  uniform vec3 uFogColor;

  void main() {
    vec3 norm = normalize(vNormal);
    float diff = max(dot(norm, uSunDir), 0.15);
    vec3 ambient = vec3(0.12, 0.10, 0.22); // Vice City night ambient
    vec3 diffuse = vColor * diff * 0.9;
    vec3 lit = ambient * vColor + diffuse;

    // Atmospheric neon fog
    float dist = length(vFragPos - uCameraPos);
    float fog = clamp(exp(-dist * uFogDensity), 0.0, 1.0);
    vec3 finalColor = mix(uFogColor, lit, fog);

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

function compileShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

const prog = gl.createProgram();
gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, vsSource));
gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fsSource));
gl.linkProgram(prog);

const attribs = {
  pos: gl.getAttribLocation(prog, 'aPosition'),
  norm: gl.getAttribLocation(prog, 'aNormal'),
  col: gl.getAttribLocation(prog, 'aColor'),
};
const uniforms = {
  proj: gl.getUniformLocation(prog, 'uProjection'),
  view: gl.getUniformLocation(prog, 'uView'),
  model: gl.getUniformLocation(prog, 'uModel'),
  sunDir: gl.getUniformLocation(prog, 'uSunDir'),
  camPos: gl.getUniformLocation(prog, 'uCameraPos'),
  fogDensity: gl.getUniformLocation(prog, 'uFogDensity'),
  fogColor: gl.getUniformLocation(prog, 'uFogColor'),
};

// Simple Matrix Math
function mat4Perspective(fovy, aspect, near, far) {
  const f = 1.0 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, (2 * far * near) * nf, 0
  ]);
}

function mat4Identity() {
  return new Float32Array([
    1,0,0,0,
    0,1,0,0,
    0,0,1,0,
    0,0,0,1
  ]);
}

function mat4Translate(m, x, y, z) {
  const r = new Float32Array(m);
  r[12] += m[0] * x + m[4] * y + m[8] * z;
  r[13] += m[1] * x + m[5] * y + m[9] * z;
  r[14] += m[2] * x + m[6] * y + m[10] * z;
  r[15] += m[3] * x + m[7] * y + m[11] * z;
  return r;
}

function mat4Scale(m, sx, sy, sz) {
  const r = new Float32Array(m);
  r[0] *= sx; r[1] *= sx; r[2] *= sx; r[3] *= sx;
  r[4] *= sy; r[5] *= sy; r[6] *= sy; r[7] *= sy;
  r[8] *= sz; r[9] *= sz; r[10] *= sz; r[11] *= sz;
  return r;
}

function mat4LookAt(eye, center, up) {
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;

  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  let xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;

  let yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;

  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1
  ]);
}

// Geometry Buffers: Cube
function createCubeMesh() {
  const positions = [
    // Front
    -0.5, -0.5,  0.5,   0.5, -0.5,  0.5,   0.5,  0.5,  0.5,
    -0.5, -0.5,  0.5,   0.5,  0.5,  0.5,  -0.5,  0.5,  0.5,
    // Back
    -0.5, -0.5, -0.5,  -0.5,  0.5, -0.5,   0.5,  0.5, -0.5,
    -0.5, -0.5, -0.5,   0.5,  0.5, -0.5,   0.5, -0.5, -0.5,
    // Top
    -0.5,  0.5, -0.5,  -0.5,  0.5,  0.5,   0.5,  0.5,  0.5,
    -0.5,  0.5, -0.5,   0.5,  0.5,  0.5,   0.5,  0.5, -0.5,
    // Bottom
    -0.5, -0.5, -0.5,   0.5, -0.5, -0.5,   0.5, -0.5,  0.5,
    -0.5, -0.5, -0.5,   0.5, -0.5,  0.5,  -0.5, -0.5,  0.5,
    // Right
     0.5, -0.5, -0.5,   0.5,  0.5, -0.5,   0.5,  0.5,  0.5,
     0.5, -0.5, -0.5,   0.5,  0.5,  0.5,   0.5, -0.5,  0.5,
    // Left
    -0.5, -0.5, -0.5,  -0.5, -0.5,  0.5,  -0.5,  0.5,  0.5,
    -0.5, -0.5, -0.5,  -0.5,  0.5,  0.5,  -0.5,  0.5, -0.5,
  ];
  const normals = [
    // Front
     0,  0,  1,   0,  0,  1,   0,  0,  1,   0,  0,  1,   0,  0,  1,   0,  0,  1,
    // Back
     0,  0, -1,   0,  0, -1,   0,  0, -1,   0,  0, -1,   0,  0, -1,   0,  0, -1,
    // Top
     0,  1,  0,   0,  1,  0,   0,  1,  0,   0,  1,  0,   0,  1,  0,   0,  1,  0,
    // Bottom
     0, -1,  0,   0, -1,  0,   0, -1,  0,   0, -1,  0,   0, -1,  0,   0, -1,  0,
    // Right
     1,  0,  0,   1,  0,  0,   1,  0,  0,   1,  0,  0,   1,  0,  0,   1,  0,  0,
    // Left
    -1,  0,  0,  -1,  0,  0,  -1,  0,  0,  -1,  0,  0,  -1,  0,  0,  -1,  0,  0,
  ];

  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

  const normBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);

  return { posBuf, normBuf, count: 36 };
}

const cubeMesh = createCubeMesh();

function drawBox(m, color) {
  gl.uniformMatrix4fv(uniforms.model, false, m);

  gl.bindBuffer(gl.ARRAY_BUFFER, cubeMesh.posBuf);
  gl.vertexAttribPointer(attribs.pos, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(attribs.pos);

  gl.bindBuffer(gl.ARRAY_BUFFER, cubeMesh.normBuf);
  gl.vertexAttribPointer(attribs.norm, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(attribs.norm);

  gl.vertexAttrib3f(attribs.col, color[0], color[1], color[2]);
  gl.disableVertexAttribArray(attribs.col);

  gl.drawArrays(gl.TRIANGLES, 0, cubeMesh.count);
}

// Window resizing
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Pointer lock for FPS controls
canvas.addEventListener('click', () => {
  if (currentSim && !pointerLocked) {
    canvas.requestPointerLock();
  }
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
});
document.addEventListener('mousemove', (e) => {
  if (pointerLocked) {
    yaw -= e.movementX * 0.0022;
    pitch -= e.movementY * 0.0022;
    pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitch));
  }
});

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (!currentSim) return;
  const p = currentSim.players.find(x => x.id === myPlayerId);
  if (!p) return;

  if (e.code === 'KeyR') reloadNow(currentSim, p);
  if (e.code === 'Digit1') p.weapon = 'pistol';
  if (e.code === 'Digit2') p.weapon = 'smg';
  if (e.code === 'Digit3') p.weapon = 'shotgun';
  if (e.code === 'Digit4') p.weapon = 'rifle';
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('mousedown', (e) => { if (e.button === 0) mouse.down = true; });
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.down = false; });

// Input calculation for local player
function getMyInput(dt) {
  let mx = 0, mz = 0;
  // yaw directions: yaw=0 -> dir is (0, 1) in sim coordinate space (aimDir: sin(yaw), cos(yaw))
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);

  if (keys['KeyW']) { mx += sin; mz += cos; }
  if (keys['KeyS']) { mx -= sin; mz -= cos; }
  if (keys['KeyA']) { mx += cos; mz -= sin; }
  if (keys['KeyD']) { mx -= cos; mz += sin; }

  return {
    mx,
    mz,
    yaw,
    pitch,
    sprint: !!keys['ShiftLeft'] || !!keys['ShiftRight'],
    jump: !!keys['Space'],
    fire: mouse.down,
    reload: !!keys['KeyR'],
    weapon: WEAPON_ORDER.indexOf(currentSim?.players.find(p => p.id === myPlayerId)?.weapon ?? 'pistol'),
    dt,
  };
}

// Minimap 2D Canvas rendering
const minimapCanvas = document.getElementById('minimap');
const mmCtx = minimapCanvas.getContext('2d');

function updateMinimap(sim, myPlayer) {
  mmCtx.clearRect(0, 0, 130, 130);
  mmCtx.fillStyle = 'rgba(12, 16, 28, 0.9)';
  mmCtx.beginPath();
  mmCtx.arc(65, 65, 63, 0, Math.PI * 2);
  mmCtx.fill();
  mmCtx.strokeStyle = '#00e5ff';
  mmCtx.lineWidth = 2;
  mmCtx.stroke();

  if (!myPlayer) return;
  const scale = 0.5; // 1 meter = 0.5px
  const cx = 65, cy = 65;

  // Draw zombies
  mmCtx.fillStyle = '#ff2d55';
  for (const z of sim.zombies) {
    if (z.dead) continue;
    const rx = (z.x - myPlayer.x) * scale;
    const rz = (z.z - myPlayer.z) * scale;
    if (Math.hypot(rx, rz) < 60) {
      mmCtx.beginPath();
      mmCtx.arc(cx + rx, cy + rz, 2.5, 0, Math.PI * 2);
      mmCtx.fill();
    }
  }

  // Draw pickups
  mmCtx.fillStyle = '#ffb300';
  for (const k of sim.pickups) {
    const rx = (k.x - myPlayer.x) * scale;
    const rz = (k.z - myPlayer.z) * scale;
    if (Math.hypot(rx, rz) < 60) {
      mmCtx.fillRect(cx + rx - 2, cy + rz - 2, 4, 4);
    }
  }

  // Draw players
  for (const p of sim.players) {
    const rx = (p.x - myPlayer.x) * scale;
    const rz = (p.z - myPlayer.z) * scale;
    if (Math.hypot(rx, rz) < 60) {
      mmCtx.fillStyle = p.id === myPlayer.id ? '#00e5ff' : '#ff2d95';
      mmCtx.beginPath();
      mmCtx.arc(cx + rx, cy + rz, 3.5, 0, Math.PI * 2);
      mmCtx.fill();
    }
  }
}

// Update HUD elements
function updateHUD(sim) {
  const myPlayer = sim.players.find(p => p.id === myPlayerId);
  if (!myPlayer) return;

  document.getElementById('health-bar').style.width = `${Math.max(0, myPlayer.hp)}%`;
  document.getElementById('health-text').textContent = Math.round(myPlayer.hp);

  document.getElementById('wave-badge').textContent = `WAVE ${sim.wave}`;
  document.getElementById('wave-state').textContent = sim.waveState === 'intermission' ? `PREPARE (${Math.ceil(sim.waveTimer)}s)` : `${sim.zombies.filter(z => !z.dead).length} ZOMBIES`;

  document.getElementById('score-val').textContent = myPlayer.score;
  document.getElementById('kills-val').textContent = myPlayer.kills;

  const district = districtNameAt(myPlayer.x, myPlayer.z);
  document.getElementById('district-banner').textContent = district.toUpperCase();

  document.getElementById('weapon-name').textContent = myPlayer.weapon.toUpperCase();
  document.getElementById('ammo-mag').textContent = myPlayer.reloading ? 'RELOADING' : myPlayer.mag;
  document.getElementById('ammo-res').textContent = myPlayer.reserve[myPlayer.weapon];

  const teammate = sim.players.find(p => p.id !== myPlayerId);
  if (teammate) {
    document.getElementById('teammate-status').textContent = `${teammate.name}: ${teammate.alive ? Math.round(teammate.hp) + ' HP' : 'RESPAWNING...'}`;
  } else {
    document.getElementById('teammate-status').textContent = 'Solo Play';
  }

  updateMinimap(sim, myPlayer);
}

// Main Render Loop
function render(sim) {
  gl.clearColor(0.04, 0.03, 0.08, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);

  const myPlayer = sim.players.find(p => p.id === myPlayerId) || sim.players[0];
  if (!myPlayer) return;

  const camY = 1.7 + (myPlayer.y || 0);
  const eye = [myPlayer.x, camY, myPlayer.z];
  const center = [
    myPlayer.x + Math.sin(yaw) * Math.cos(pitch),
    camY + Math.sin(pitch),
    myPlayer.z + Math.cos(yaw) * Math.cos(pitch)
  ];

  const aspect = canvas.width / canvas.height;
  const proj = mat4Perspective(Math.PI / 3, aspect, 0.1, 800);
  const view = mat4LookAt(eye, center, [0, 1, 0]);

  gl.useProgram(prog);
  gl.uniformMatrix4fv(uniforms.proj, false, proj);
  gl.uniformMatrix4fv(uniforms.view, false, view);
  gl.uniform3f(uniforms.sunDir, 0.5, 0.8, 0.3);
  gl.uniform3fv(uniforms.camPos, eye);
  gl.uniform1f(uniforms.fogDensity, 0.005);
  gl.uniform3f(uniforms.fogColor, 0.05, 0.04, 0.09);

  // 1. Draw Ground
  let m = mat4Translate(mat4Identity(), myPlayer.x, -0.05, myPlayer.z);
  m = mat4Scale(m, 500, 0.1, 500);
  drawBox(m, [0.08, 0.07, 0.12]);

  // 2. Draw Buildings around player
  const colliders = collidersNear(myPlayer.x, myPlayer.z, 160);
  for (const c of colliders) {
    if (c.kind === 'building') {
      let mb = mat4Translate(mat4Identity(), c.x, c.h / 2, c.z);
      mb = mat4Scale(mb, c.hx * 2, c.h, c.hz * 2);
      drawBox(mb, [0.22, 0.20, 0.32]);
    }
  }

  // 3. Draw Zombies
  for (const z of sim.zombies) {
    if (z.dead) continue;
    let mz = mat4Translate(mat4Identity(), z.x, 1.0, z.z);
    const zColor = z.type === 2 ? [0.6, 0.1, 0.1] : (z.type === 1 ? [0.8, 0.4, 0.1] : [0.2, 0.5, 0.2]);
    mz = mat4Scale(mz, z.radius * 2, 2.0, z.radius * 2);
    drawBox(mz, zColor);
  }

  // 4. Draw Pickups
  for (const k of sim.pickups) {
    let mk = mat4Translate(mat4Identity(), k.x, 0.3 + Math.sin(sim.t * 4) * 0.1, k.z);
    mk = mat4Scale(mk, 0.5, 0.5, 0.5);
    const col = k.type === 'health' ? [1.0, 0.2, 0.3] : (k.type === 'armor' ? [0.2, 0.8, 1.0] : [1.0, 0.8, 0.2]);
    drawBox(mk, col);
  }

  // 5. Draw Other Players
  for (const p of sim.players) {
    if (p.id === myPlayer.id || !p.alive) continue;
    let mp = mat4Translate(mat4Identity(), p.x, 1.0, p.z);
    mp = mat4Scale(mp, 0.8, 2.0, 0.8);
    drawBox(mp, [1.0, 0.18, 0.65]); // Pink teammate
  }
}

// Main Game Loop
function tick(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (currentSim) {
    if (isHost) {
      const inputs = {};
      inputs[myPlayerId] = getMyInput(dt);
      stepSim(currentSim, dt, inputs);

      if (isOnline && ws && ws.readyState === WebSocket.OPEN) {
        // Send state snapshot to guest
        ws.send(JSON.stringify({
          t: 'relay',
          data: { type: 'sim_sync', simState: currentSim }
        }));
      }
    } else {
      // Guest sends inputs to host
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          t: 'relay',
          data: { type: 'guest_input', input: getMyInput(dt) }
        }));
      }
    }

    render(currentSim);
    updateHUD(currentSim);

    if (currentSim.over) {
      document.getElementById('gameover-screen').classList.remove('hidden');
      document.getElementById('gameover-stats').textContent = `WAVE ${currentSim.wave} • KILLS ${currentSim.kills} • SCORE ${currentSim.score}`;
    }
  }

  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Start Game helper
export function startSoloGame(playerName = 'Survivor') {
  document.getElementById('lobby-screen').classList.add('hidden');
  document.getElementById('gameover-screen').classList.add('hidden');
  document.getElementById('hud').classList.add('active');
  document.getElementById('crosshair').classList.add('active');

  currentSim = createSim({ seed: Math.floor(Math.random() * 999999), players: 1 });
  spawnPlayers(currentSim, [playerName]);
  myPlayerId = currentSim.players[0].id;
  isHost = true;
  isOnline = false;
  yaw = 0;
  pitch = 0;
}

// UI Event Listeners
document.getElementById('btn-solo').addEventListener('click', () => {
  const name = document.getElementById('player-name').value.trim() || 'Survivor';
  startSoloGame(name);
});

document.getElementById('btn-restart').addEventListener('click', () => {
  const name = document.getElementById('player-name').value.trim() || 'Survivor';
  startSoloGame(name);
});

export { currentSim, myPlayerId, isHost, isOnline, setSimState };

function setSimState(sim, playerId, hostStatus, onlineStatus, websocket) {
  currentSim = sim;
  myPlayerId = playerId;
  isHost = hostStatus;
  isOnline = onlineStatus;
  ws = websocket;
}
