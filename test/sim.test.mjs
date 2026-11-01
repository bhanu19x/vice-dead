import assert from 'node:assert/strict';
import {
  WEAPONS,
  WEAPON_ORDER,
  PLAYER_COLORS,
  createSim,
  spawnPlayers,
  reloadNow,
  attachSimRng,
  stepSim,
  serialize,
  consumeEvents,
  worldDistance,
} from '../public/js/sim.js';

// Constant sanity checks
assert.ok(WEAPONS.pistol);
assert.ok(WEAPONS.smg);
assert.ok(WEAPONS.shotgun);
assert.ok(WEAPONS.rifle);
assert.deepEqual(WEAPON_ORDER, ['pistol', 'smg', 'shotgun', 'rifle']);
assert.equal(worldDistance(0, 0, 3, 4), 5);

// Create sim
const sim = createSim({ seed: 42 });
assert.equal(sim.seed, 42);
assert.equal(sim.players.length, 0);
assert.equal(sim.zombies.length, 0);
assert.equal(sim.wave, 0);
assert.equal(sim.over, false);

// Spawn players
spawnPlayers(sim, ['Alice', 'Bob']);
assert.equal(sim.players.length, 2);
const [p1, p2] = sim.players;
assert.equal(p1.name, 'Alice');
assert.equal(p2.name, 'Bob');
assert.equal(p1.alive, true);
assert.equal(p1.hp, 100);
assert.equal(p1.weapon, 'pistol');
assert.equal(p1.mag, WEAPONS.pistol.mag);

// Player input and movement
const initialX = p1.x;
stepSim(sim, 0.1, {
  [p1.id]: {
    mx: 1,
    mz: 0,
    yaw: 0,
    pitch: 0,
    sprint: false,
    jump: false,
    fire: false,
    reload: false,
    weapon: 0,
  },
});
assert.notEqual(p1.x, initialX, 'Player should have moved in x direction');

// Weapon switching
stepSim(sim, 0.1, {
  [p1.id]: {
    mx: 0,
    mz: 0,
    yaw: 0,
    pitch: 0,
    sprint: false,
    jump: false,
    fire: false,
    reload: false,
    weapon: 1, // smg
  },
});
assert.equal(p1.weapon, 'smg', 'Player should switch to SMG');
assert.equal(p1.mag, WEAPONS.smg.mag);

// Reloading logic
p1.mag = 5;
reloadNow(sim, p1);
assert.equal(p1.reloading, true);
// Step until reload finishes
stepSim(sim, 2.0, {});
assert.equal(p1.reloading, false);
assert.equal(p1.mag, WEAPONS.smg.mag, 'Magazine should be fully refilled after reload');

// Spawning wave and zombie interaction
assert.equal(sim.waveState, 'active');
assert.ok(sim.wave >= 1);
assert.ok(sim.zombies.length > 0, 'Wave should spawn zombies');

// Test zombie hit detection via shooting
const targetZombie = sim.zombies[0];
// Position player looking directly at the zombie
p1.x = targetZombie.x;
p1.z = targetZombie.z - 5; // 5 units south
p1.yaw = 0; // facing +Z towards targetZombie
p1.pitch = 0;
p1.weapon = 'rifle';
p1.mag = 8;
p1.fireCd = 0;
p1.reloading = false;

const initialHp = targetZombie.hp;
stepSim(sim, 0.05, {
  [p1.id]: {
    mx: 0,
    mz: 0,
    yaw: 0,
    pitch: 0,
    sprint: false,
    jump: false,
    fire: true,
    reload: false,
    weapon: 3,
  },
});

assert.ok(targetZombie.hp < initialHp || targetZombie.dead, 'Zombie HP should decrease when shot');

// Test zombie kill & score
targetZombie.hp = 1;
p1.fireCd = 0;
stepSim(sim, 0.05, {
  [p1.id]: {
    mx: 0,
    mz: 0,
    yaw: 0,
    pitch: 0,
    sprint: false,
    jump: false,
    fire: true,
    reload: false,
    weapon: 3,
  },
});
assert.equal(targetZombie.dead, true, 'Zombie should die when HP <= 0');
assert.ok(p1.kills >= 1, 'Player should get kill credit');
assert.ok(p1.score > 0, 'Player score should increase');

// Pickups collection
sim.pickups.push({
  id: 9999,
  x: p1.x,
  z: p1.z,
  type: 'health',
  t: sim.t,
});
p1.hp = 50;
stepSim(sim, 0.05, {});
assert.equal(p1.hp, 85, 'Health pickup should increase player HP');
assert.equal(sim.pickups.some(k => k.id === 9999), false, 'Pickup should be collected');

// Events consumption
const events = consumeEvents(sim);
assert.ok(Array.isArray(events));
assert.ok(events.length > 0);
assert.equal(sim.events.length, 0, 'consumeEvents should clear event buffer');

// Serialization
const snapshot = serialize(sim);
assert.equal(typeof snapshot.t, 'number');
assert.equal(snapshot.wave, sim.wave);
assert.ok(Array.isArray(snapshot.p));
assert.ok(Array.isArray(snapshot.z));
assert.ok(Array.isArray(snapshot.k));
assert.ok(Array.isArray(snapshot.ev));

// Attach RNG
let rngCalls = 0;
attachSimRng(sim, () => {
  rngCalls++;
  return 0.5;
});
assert.ok(sim.rng);
assert.equal(sim.rng(), 0.5);
assert.equal(rngCalls, 1);

console.log('sim.test.mjs passed successfully');
