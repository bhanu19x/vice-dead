// Tests for world procedural generation, determinism, colliders, and utilities
import assert from 'node:assert/strict';
import {
  WORLD,
  DISTRICTS,
  POIS,
  mulberry32,
  seedWorld,
  getSeed,
  chunkIndex,
  chunkOf,
  isWater,
  districtAt,
  districtNameAt,
  nearestPOI,
  getChunk,
  forChunksAround,
  collidersNear,
  isBlocked,
  resolveCircle,
  raycastStatic,
  findOpenSpot,
  allSpawnPoints,
  worldDistance,
  bakeDistrictTexture,
} from '../public/js/world.js';

console.log('Running world tests...');

// 1. Deterministic Mulberry32 RNG
const rng1 = mulberry32(12345);
const rng2 = mulberry32(12345);
for (let i = 0; i < 10; i++) {
  assert.equal(rng1(), rng2(), 'mulberry32 must produce identical sequence for same seed');
}

// 2. Seed World
seedWorld(4242);
assert.equal(getSeed(), 4242);

// 3. World Constants & Chunk calculation
assert.equal(WORLD.size, 10000);
assert.equal(WORLD.grid, 50);
const c0 = chunkOf(0, 0);
assert.equal(c0.cx, 25);
assert.equal(c0.cz, 25);

const cMin = chunkOf(-5000, -5000);
assert.equal(cMin.cx, 0);
assert.equal(cMin.cz, 0);

const cMax = chunkOf(4999, 4999);
assert.equal(cMax.cx, 49);
assert.equal(cMax.cz, 49);

// 4. District and Water detection
assert.ok(DISTRICTS.length >= 8);
const nameCenter = districtNameAt(0, 0);
assert.equal(nameCenter, 'Downtown Vice');
assert.ok(typeof districtAt(0, 0) === 'number');

// Water boundary check
assert.ok(isWater(-4500, 0));

// 5. POIs and distance
const nearest = nearestPOI(0, 0);
assert.equal(nearest.poi.name, 'Neon Plaza');
assert.equal(nearest.distance, 0);

assert.equal(worldDistance(0, 0, 3, 4), 5);

// 6. Chunk Generation and Caching
seedWorld(90210);
const chunkA = getChunk(25, 25);
assert.ok(chunkA.buildings.length >= 0);
assert.ok(chunkA.colliders.length >= 0);
const chunkB = getChunk(25, 25);
assert.equal(chunkA, chunkB, 'Chunk must be cached');

// Out of bounds chunk returns default empty chunk
const outChunk = getChunk(-1, -1);
assert.equal(outChunk.district, 3);
assert.equal(outChunk.buildings.length, 0);

// 7. Colliders & Collision Resolution
const colliders = collidersNear(0, 0, 100);
assert.ok(Array.isArray(colliders));

const resolved = resolveCircle(0, 0, 0.5);
assert.ok(typeof resolved.x === 'number');
assert.ok(typeof resolved.z === 'number');

// 8. Open spots and spawn points
const spot = findOpenSpot(0, 0, 10, 50);
assert.ok(!isWater(spot.x, spot.z));
assert.ok(!isBlocked(spot.x, spot.z, 0.5));

const spawns = allSpawnPoints();
assert.ok(spawns.length > 50);

// 9. Static Raycasting
const ray = raycastStatic(0, 0, 1, 0, 500);
if (ray) {
  assert.ok(ray.t > 0);
  assert.ok(ray.collider);
}

// 10. District texture baking
const tex = bakeDistrictTexture(16);
assert.equal(tex.size, 16);
assert.equal(tex.data.length, 16 * 16 * 4);

console.log('World tests passed successfully!');
