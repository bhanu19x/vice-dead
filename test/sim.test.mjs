// Tests for deterministic simulation loop, weapons, zombies, waves, and pickups
import assert from 'node:assert/strict';
import {
  WEAPONS,
  WEAPON_ORDER,
  createSim,
  spawnPlayers,
  reloadNow,
  attachSimRng,
  stepSim,
  serialize,
  consumeEvents,
} from '../public/js/sim.js';
import { mulberry32 } from '../public/js/world.js';

console.log('Running sim tests...');

// 1. Sim creation and player spawning
const sim = createSim({ seed: 42, players: 2 });
assert.equal(sim.seed, 42);
assert.equal(sim.wave, 0);
assert.equal(sim.waveState, 'intermission');

spawnPlayers(sim, ['Alice', 'Bob']);
assert.equal(sim.players.length, 2);
assert.equal(sim.players[0].name, 'Alice');
assert.equal(sim.players[1].name, 'Bob');
assert.equal(sim.players[0].hp, 100);
assert.equal(sim.players[0].weapon, 'pistol');
assert.equal(sim.players[0].mag, WEAPONS.pistol.mag);

// 2. Input application and player movement
const p1 = sim.players[0];
const startX = p1.x;
const startZ = p1.z;

stepSim(sim, 0.1, {
  [p1.id]: { mx: 1, mz: 0, yaw: 0, pitch: 0, sprint: false, jump: false, fire: false, reload: false },
});

assert.ok(p1.x > startX, 'Player should have moved forward on X axis');
assert.ok(p1.moving);

// 3. Weapon firing and events
const initialMag = p1.mag;
stepSim(sim, 0.1, {
  [p1.id]: { mx: 0, mz: 0, yaw: 0, pitch: 0, fire: true },
});
assert.equal(p1.mag, initialMag - 1, 'Pistol mag should decrease by 1 when fired');
const events = consumeEvents(sim);
assert.ok(events.some(e => e.t === 'shot'), 'Sim should generate shot event');

// 4. Weapon reloading
p1.mag = 0;
p1.reserve.pistol = 50;
reloadNow(sim, p1);
assert.ok(p1.reloading);
assert.ok(p1.reloadT > 0);

// Advance time until reload completes
stepSim(sim, 2.0, {});
assert.equal(p1.reloading, false);
assert.equal(p1.mag, WEAPONS.pistol.mag);
assert.equal(p1.reserve.pistol, 50 - WEAPONS.pistol.mag);

// 5. Weapon switching
stepSim(sim, 0.1, {
  [p1.id]: { weapon: 1 }, // smg
});
assert.equal(p1.weapon, 'smg');
assert.equal(p1.mag, WEAPONS.smg.mag);

// 6. Zombie spawning and damage via shooting
attachSimRng(sim, mulberry32(100));
// Trigger wave spawn by advancing intermission timer
sim.waveTimer = 0.01;
stepSim(sim, 0.02, {});
assert.equal(sim.wave, 1);
assert.equal(sim.waveState, 'active');
assert.ok(sim.zombies.length > 0, 'Wave 1 should spawn zombies');

// Place a zombie right in front of player 1 and shoot it
const testZombie = sim.zombies[0];
testZombie.x = p1.x;
testZombie.y = 0;
testZombie.z = p1.z + 5; // right in front (yaw = 0 aims +Z in aimDir)
const initialZhp = testZombie.hp;

// Point directly at zombie (yaw=0, pitch=0) and fire rifle
p1.weapon = 'rifle';
p1.mag = 10;
p1.fireCd = 0;
stepSim(sim, 0.1, {
  [p1.id]: { yaw: 0, pitch: 0, fire: true },
});

assert.ok(testZombie.hp < initialZhp, `Zombie should have taken damage: initial ${initialZhp}, current ${testZombie.hp}`);

// 7. Pickups
sim.pickups.push({ id: 999, x: p1.x, z: p1.z, type: 'health', t: sim.t });
p1.hp = 50;
stepSim(sim, 0.05, {});
assert.ok(p1.hp > 50, 'Player should collect health pickup');
assert.equal(sim.pickups.length, 0, 'Collected pickup should be removed');

// 8. Serialization
const state = serialize(sim);
assert.ok(typeof state.t === 'number');
assert.ok(Array.isArray(state.p));
assert.ok(Array.isArray(state.z));
assert.ok(Array.isArray(state.k));

console.log('Sim tests passed successfully!');
