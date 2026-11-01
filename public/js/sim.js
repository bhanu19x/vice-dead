// Deterministic simulation. Runs headless (host browser, and in Node for tests).
import { collidersNear, resolveCircle, raycastStatic, isBlocked, findOpenSpot, worldDistance } from './world.js';

export const WEAPONS = {
  pistol: { name: 'Pistol', dmg: 34, rpm: 300, mag: 12, reserve: 80, spread: 0.013, range: 90, pellets: 1, auto: false },
  smg: { name: 'SMG', dmg: 17, rpm: 740, mag: 30, reserve: 180, spread: 0.03, range: 70, pellets: 1, auto: true },
  shotgun: { name: 'Shotgun', dmg: 11, rpm: 72, mag: 6, reserve: 42, spread: 0.085, range: 36, pellets: 7, auto: false },
  rifle: { name: 'Rifle', dmg: 78, rpm: 95, mag: 8, reserve: 48, spread: 0.0015, range: 220, pellets: 1, auto: false },
};
export const WEAPON_ORDER = ['pistol', 'smg', 'shotgun', 'rifle'];
export const PLAYER_COLORS = [0x26e0ff, 0xff5fa8];

const TAU = Math.PI * 2;
let idCounter = 1;
function nid() { return idCounter++; }

export function createSim({ seed = 90210, players = 2 } = {}) {
  return {
    t: 0, seed, wave: 0, waveState: 'intermission', waveTimer: 1.0, waveCount: 0,
    score: 0, kills: 0, nextId: 1, roverTimer: 0, over: false, winner: '',
    players: [], zombies: [], pickups: [], events: [], bullets: [],
  };
}

function addPlayer(sim, name, color, x, z) {
  sim.players.push({
    id: nid(), name, color, x, z, yaw: 0, pitch: 0, vy: 0, grounded: true,
    hp: 100, hurts: [], alive: true, respawnT: 0, kills: 0, score: 0,
    weapon: 'pistol', mag: WEAPONS.pistol.mag, reserve: Object.fromEntries(WEAPON_ORDER.map(w => [w, WEAPONS[w].reserve])),
    reloading: false, reloadT: 0, fireCd: 0, moving: false, speed: 0, strafe: 0, deadT: 0, lastHitAt: 0,
  });
}
export function spawnPlayers(sim, names = ['Player 1', 'Player 2'], colors = [0x26e0ff, 0xff5fa8]) {
  const origins = [[0, 40], [0, -40], [60, 0], [-60, 0]];
  for (let i = 0; i < Math.min(2, names.length); i++) addPlayer(sim, names[i], colors[i] ?? PLAYER_COLORS[i], origins[i][0], origins[i][1]);
}

function aimDir(yaw, pitch) { return { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) }; }
function normalize(d) { const l = Math.hypot(d.x, d.y, d.z) || 1; return { x: d.x / l, y: d.y / l, z: d.z / l }; }

function capsuleHit(ox, oy, oz, d, ax, az, topY, botY, r) {
  // vertical capsule around (ax, az), radius r
  const cx = ox - ax, cz = oz - az;
  const a = d.x * d.x + d.z * d.z; // ignore y for height bands: we clamp y later
  const b = 2 * (cx * d.x + cz * d.z);
  const c = cx * cx + cz * cz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
  for (const t of [t1, t2]) {
    if (t < 0 || t > 600) continue;
    const y = oy + d.y * t;
    if (y >= botY && y <= topY) return { t, x: ox + d.x * t, y, z: oz + d.z * t, head: false };
  }
  // head sphere too
  return null;
}

function headHit(ox, oy, oz, d, ax, az, hx, hy, hz, r) {
  const cx = ox - hx, cy = oy - hy, cz = oz - hz;
  const b = 2 * (cx * d.x + cy * d.y + cz * d.z);
  const c = cx * cx + cy * cy + cz * cz - r * r;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t = (-b - sq) / 2;
  if (t < 0 || t > 600) return null;
  return { t, x: ox + d.x * t, y: oy + d.y * t, z: oz + d.z * t, head: true };
}

function shoot(sim, player, dir, weaponDef, yaw, pitch) {
  const eye = { x: player.x, y: 1.62 + Math.sin(player.pitch) * 0, z: player.z };
  for (let p = 0; p < weaponDef.pellets; p++) {
    let d = dir;
    if (weaponDef.pellets > 1 || weaponDef.spread > 0.0005) {
      d = normalize({
        x: dir.x + (Math.random() - .5) * weaponDef.spread * 2 + (Math.random() - .5) * weaponDef.spread,
        y: dir.y + (Math.random() - .5) * weaponDef.spread * 2,
        z: dir.z + (Math.random() - .5) * weaponDef.spread * 2,
      });
    }
    // obstruction
    const wall = raycastStatic(eye.x, eye.z, d.x, d.z, weaponDef.range);
    const dmax = wall ? Math.min(wall.t, weaponDef.range) : weaponDef.range;
    let nearest = null;
    for (const z of sim.zombies) {
      if (z.dead) continue;
      const cy = 1.0, hy = 2.02;
      const body = capsuleHit(eye.x, eye.y, eye.z, d, z.x, z.z, 1.9, 0.8, z.radius);
      if (body && body.t < dmax && (!nearest || body.t < nearest.t)) {
        nearest = { ...body, zombie: z };
      }
      const hh = headHit(eye.x, eye.y, eye.z, d, z.x, z.z, z.x, hy, z.z, 0.30);
      if (hh && hh.t < dmax && (!nearest || hh.t < nearest.t)) {
        nearest = { ...hh, zombie: z };
      }
    }
    sim.events.push({ t: 'shot', x: eye.x, y: eye.y, z: eye.z, dx: d.x * 40, dy: d.y * 40, dz: d.z * 40, w: player.weapon, o: player.id, to: nearest ? nearest.t : dmax });
    if (nearest && nearest.zombie) {
      const zid = nearest.zombie.id;
      const zombie = sim.zombies.find(q => q.id === zid);
      if (zombie && !zombie.dead) {
        const dmg = nearest.head ? weaponDef.dmg * 1.6 : weaponDef.dmg;
        zombie.hp -= dmg;
        zombie.hurtAt = sim.t;
        sim.events.push({ t: 'blood', x: nearest.x, y: nearest.y, z: nearest.z, head: nearest.head, dmg: Math.round(dmg) });
        if (zombie.hp <= 0) {
          zombie.dead = true; zombie.deadT = sim.t;
          player.kills++; player.score += zombie.type === 2 ? 30 : (zombie.type === 1 ? 20 : 15);
          sim.kills++; sim.score += zombie.type === 2 ? 30 : (zombie.type === 1 ? 20 : 15);
          sim.events.push({ t: 'zdeath', id: zombie.id, x: zombie.x, z: zombie.z, type: zombie.type });
          dropLoot(sim, zombie.x, zombie.z);
        }
      }
    }
  }
}

function dropLoot(sim, x, z) {
  const r = Math.random();
  const type = r < .06 ? 'armor' : r < .22 ? 'health' : r < .55 ? 'ammo' : null;
  if (type) sim.pickups.push({ id: nid(), x: x + (Math.random() - .5), z: z + (Math.random() - .5), type, t: sim.t });
}

export function reloadNow(sim, player) {
  const def = WEAPONS[player.weapon];
  const have = player.reserve[player.weapon];
  const need = def.mag - player.mag;
  if (have > 0 && need > 0) {
    player.reloading = true; player.reloadT = def.name === 'Shotgun' ? 1.6 : 1.3;
  }
}

const ZTYPE = [
  { hp: 100, speed: 2.2, dmg: 12, radius: .42, name: 'walker' },
  { hp: 60, speed: 4.5, dmg: 8, radius: .38, name: 'runner' },
  { hp: 420, speed: 1.5, dmg: 22, radius: .7, name: 'brute' },
];

function spawnZombie(sim, x, z, type, idx) {
  const def = ZTYPE[type];
  const hpscale = 1 + sim.wave * 0.12;
  sim.zombies.push({ id: nid(), x, z, yaw: Math.random() * TAU, hp: def.hp * hpscale, maxHp: def.hp * hpscale, type, speed: def.speed * (1 + Math.min(sim.wave * 0.02, 0.4)), radius: def.radius, dmg: def.dmg, attackCd: 0, anim: Math.random() * TAU, dead: false, deadT: 0, hurtAt: -9, strafeT: 0, strafe: 0, target: null });
}

function alivePlayers(sim) { return sim.players.filter(p => p.alive); }

function spawnWave(sim) {
  sim.wave++; sim.waveCount = Math.min(6 + sim.wave * 4, 50);
  sim.waveState = 'active';
  sim.events.push({ t: 'wave', n: sim.wave });
  const plist = alivePlayers(sim);
  let spawned = 0, guard = 0;
  while (spawned < sim.waveCount && guard++ < 400) {
    const p = plist[(guard - 1) % plist.length];
    const spot = findOpenSpot(p.x, p.z, 38, 75);
    let type = sim.rng ? sim.rng() : Math.random();
    if (type < 0.62) type = 0; else if (type < 0.9) type = 1; else type = 2;
    if (sim.wave < 2 && type === 2) type = 0;
    spawnZombie(sim, spot.x, spot.z, type, spawned);
    spawned++;
  }
}
export function attachSimRng(sim, rng) { sim.rng = rng; }

function respawn(sim, player) {
  const mates = sim.players.filter(p => p.alive && p !== player);
  const anchor = mates[0] ?? { x: 0, z: 0 };
  const spot = findOpenSpot(anchor.x, anchor.z, 30, 60);
  player.x = spot.x; player.z = spot.z; player.hp = 60; player.alive = true; player.vy = 0;
  sim.events.push({ t: 'respawn', id: player.id, x: spot.x, z: spot.z });
}

// ---- inputs ----------------------------------------------------------------
// input: { seq, mx, mz, yaw, pitch, sprint, jump, fire, reload, weapon }
function applyInput(sim, player, inp) {
  if (!player.alive) return;
  player.yaw = inp.yaw; player.pitch = inp.pitch;
  // movement
  let mx = inp.mx || 0, mz = inp.mz || 0;
  const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
  const speed = inp.sprint ? 9.0 : 5.6;
  player.moving = l > 0.01; player.speed = l * speed; player.strafe = mx;
  let nx = player.x + mx * speed * inp.dt, nz = player.z + mz * speed * inp.dt;
  const res = resolveCircle(nx, nz, .45); player.x = res.x; player.z = res.z;
  // jump
  if (inp.jump && player.grounded) { player.vy = 6.4; player.grounded = false; }
  if (!player.grounded) { player.vy -= 22 * inp.dt; player.y = (player.y ?? 0) + player.vy * inp.dt; if (player.y <= 0) { player.y = 0; player.vy = 0; player.grounded = true; } }
  // weapon switch
  if (inp.weapon >= 0 && inp.weapon < WEAPON_ORDER.length && WEAPON_ORDER[inp.weapon] !== player.weapon) {
    player.weapon = WEAPON_ORDER[inp.weapon]; player.mag = WEAPONS[player.weapon].mag; player.reloading = false; player.reloadT = 0; player.fireCd = 0;
  }
  // reload
  if (inp.reload && !player.reloading) reloadNow(sim, player);
  if (player.reloading) {
    player.reloadT -= inp.dt;
    if (player.reloadT <= 0) {
      const def = WEAPONS[player.weapon];
      const need = def.mag - player.mag;
      const take = Math.min(need, player.reserve[player.weapon]);
      player.mag += take; player.reserve[player.weapon] -= take;
      player.reloading = false;
    }
  } else {
    player.fireCd -= inp.dt;
    // fire
    const def = WEAPONS[player.weapon];
    if (inp.fire && player.fireCd <= 0 && player.mag > 0) {
      player.fireCd = 60 / def.rpm; player.mag--;
      if (player.mag === 0 && player.reserve[player.weapon] > 0) reloadNow(sim, player);
      const dir = aimDir(player.yaw, player.pitch);
      shoot(sim, player, dir, def, player.yaw, player.pitch);
    } else if (inp.fire && player.fireCd <= 0 && player.mag <= 0 && player.reserve[player.weapon] > 0) {
      reloadNow(sim, player);
      sim.events.push({ t: 'reload', id: player.id });
    }
  }
  // zombie melee damage recency
  if (sim.t - player.lastHitAt > 0.15) player.hurts = [];
}

function updateZombie(sim, z, dt) {
  if (z.dead) return;
  z.anim += dt * (z.type === 1 ? 6 : 3.2);
  // pick target
  const players = alivePlayers(sim);
  if (!players.length) return;
  let best = null, bd = Infinity;
  for (const p of players) { const d = (p.x - z.x) ** 2 + (p.z - z.z) ** 2; if (d < bd) { bd = d; best = p; } }
  z.target = best; const dist = Math.sqrt(bd);
  const dir = { x: (best.x - z.x) / dist, z: (best.z - z.z) / dist };
  // wander if far
  if (dist > 160 && z.type === 0) return;
  let mx = dir.x, mz = dir.z;
  // strafe interference
  z.strafeT -= dt;
  if (z.strafeT <= 0) { z.strafeT = 1.2 + Math.random(); z.strafe = Math.random() < .5 ? 1 : -1; }
  const ox = z.x + mx * z.speed * dt, oz = z.z + mz * z.speed * dt;
  let nx = ox, nz = oz;
  if (isBlocked(ox, oz, z.radius)) {
    z.strafe *= -1;
    nx = z.x + -mz * z.strafe * z.speed * dt; nz = z.z + mx * z.strafe * z.speed * dt;
  }
  const res = resolveCircle(nx, nz, z.radius); z.x = res.x; z.z = res.z;
  if (dist > 0.001) z.yaw = Math.atan2(dir.x, dir.z);
  if (z.hurtAt > 0) { z.hurtAt = -0; }
  // attack
  z.attackCd -= dt;
  if (dist < 1.9 && z.attackCd <= 0) {
    z.attackCd = z.type === 1 ? 0.8 : 1.0;
    best.hp -= z.dmg; best.lastHitAt = sim.t;
    best.hurts.push({ from: z });
    if (best.hp <= 0) {
      best.hp = 0; best.alive = false; best.deadT = sim.t; best.respawnT = sim.t + 5;
      sim.events.push({ t: 'pdeath', id: best.id, x: best.x, z: best.z });
    }
  }
}

// ---- main step -------------------------------------------------------------
export function stepSim(sim, dt, inputs) {
  if (sim.over) return;
  sim.t += dt;
  // wave controller
  if (sim.waveState === 'intermission') {
    sim.waveTimer -= dt;
    const active = sim.zombies.some(z => !z.dead);
    if (!active && sim.waveTimer <= 0 && sim.players.some(p => p.alive)) spawnWave(sim);
  } else {
    const active = sim.zombies.some(z => !z.dead);
    if (!active) { sim.waveState = 'intermission'; sim.waveTimer = 6; sim.events.push({ t: 'waveclear', n: sim.wave }); }
  }
  // ambient roamers
  sim.roverTimer -= dt;
  if (sim.roverTimer <= 0 && sim.wave > 0) {
    sim.roverTimer = 7;
    const alive = sim.zombies.filter(z => !z.dead).length;
    if (alive < 14) {
      const p = alivePlayers(sim)[0]; if (p) { const spot = findOpenSpot(p.x, p.z, 90, 150); spawnZombie(sim, spot.x, spot.z, Math.random() < .7 ? 0 : (Math.random() < .5 ? 1 : 2), alive); }
    }
  }
  // players
  for (const player of sim.players) {
    if (!player.alive) {
      if (player.respawnT && sim.t >= player.respawnT && sim.players.every(q => !q.alive)) respawn(sim, player);
      else if (player.respawnT && sim.t >= player.respawnT) respawn(sim, player);
      continue;
    }
    const inp = inputs[player.id];
    applyInput(sim, player, inp ? { ...inp, dt } : { mx: 0, mz: 0, yaw: player.yaw, pitch: player.pitch, dt });
  }
  // game over check
  if (sim.players.length && sim.players.every(p => !p.alive)) {
    sim.over = true; sim.winner = 'The horde';
  }
  // zombies
  for (const z of sim.zombies) updateZombie(sim, z, dt);
  // cleanup dead zombies after 3s
  if (sim.t % 1 < dt) sim.zombies = sim.zombies.filter(z => !z.dead || sim.t - z.deadT < 3);
  // pickups
  for (const p of sim.players) if (p.alive) for (let i = sim.pickups.length - 1; i >= 0; i--) {
    const k = sim.pickups[i];
    if ((p.x - k.x) ** 2 + (p.z - k.z) ** 2 < 2.2 ** 2) {
      if (k.type === 'health') p.hp = Math.min(100, p.hp + 35);
      else if (k.type === 'armor') p.hp = Math.min(100, p.hp + 55);
      else if (k.type === 'ammo') for (const w of WEAPON_ORDER) p.reserve[w] = Math.min(p.reserve[w] + 24, WEAPONS[w].reserve * 2 + 60);
      sim.events.push({ t: 'pickup', id: p.id, type: k.type });
      sim.pickups.splice(i, 1);
    }
  }
}

// ---- serialization ---------------------------------------------------------
export function serialize(sim) {
  return {
    t: sim.t, wave: sim.wave, waveState: sim.waveState, waveTimer: sim.waveTimer, score: sim.score, kills: sim.kills, over: sim.over,
    p: sim.players.map(p => [p.id, p.x, p.z, p.yaw, p.hp, p.alive ? 1 : 0, WEAPON_ORDER.indexOf(p.weapon), p.mag, p.score, p.moving ? 1 : 0, p.deadT ? 1 : 0]),
    z: sim.zombies.map(z => [z.id, z.x, z.z, z.type, Math.round(z.hp), z.yaw, z.anim, z.dead ? 1 : 0, z.hurtAt]),
    k: sim.pickups.map(k => [k.id, k.x, k.z, k.type]),
    ev: sim.events.slice(),
  };
}
export function consumeEvents(sim) { const e = sim.events; sim.events = []; return e; }
export { worldDistance };