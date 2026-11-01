import assert from 'node:assert/strict';
import {
  WORLD,
  DISTRICTS,
  POIS,
  PALETTES,
  NEON,
  CAR_COLORS,
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
  bakeDistrictTexture,
  worldDistance,
} from '../public/js/world.js';

// Seed setting and reading
seedWorld(12345);
assert.equal(getSeed(), 12345, 'Seed should match set value');
seedWorld(90210);
assert.equal(getSeed(), 90210, 'Seed should reset to 90210');

// World constants
assert.equal(WORLD.size, 10000);
assert.equal(WORLD.half, 5000);
assert.equal(WORLD.grid, 50);
assert.equal(DISTRICTS.length, 8);
assert.ok(POIS.length >= 8);

// chunkIndex and chunkOf
assert.equal(chunkIndex(-5000), 0);
assert.equal(chunkIndex(4999), 49);
assert.equal(chunkIndex(0), 25);
const c0 = chunkOf(0, 0);
assert.equal(c0.cx, 25);
assert.equal(c0.cz, 25);

// worldDistance
assert.equal(worldDistance(0, 0, 3, 4), 5);
assert.equal(worldDistance(10, 20, 10, 20), 0);
assert.equal(worldDistance(-5, 0, 5, 0), 10);

// isWater and districtAt
assert.ok(typeof isWater(0, 0) === 'boolean');
assert.equal(isWater(-4500, 0), true, 'Far west should be water');
const dWater = districtAt(-4500, 0);
assert.equal(dWater, 3, 'Far west district should be Open Water');
assert.equal(districtNameAt(-4500, 0), 'Open Water');

const dCenter = districtAt(0, 0);
assert.equal(dCenter, 0, 'Origin should be Downtown Vice');
assert.equal(districtNameAt(0, 0), 'Downtown Vice');

// nearestPOI
const poiRes = nearestPOI(0, 0);
assert.equal(poiRes.poi.name, 'Neon Plaza');
assert.equal(poiRes.distance, 0);

const poiDrive = nearestPOI(-3600, 900);
assert.equal(poiDrive.poi.name, 'Ocean Drive');
assert.equal(poiDrive.distance, 0);

// Chunks generation and caching
const chunk = getChunk(25, 25);
assert.ok(chunk);
assert.equal(chunk.cx, 25);
assert.equal(chunk.cz, 25);
assert.ok(Array.isArray(chunk.buildings));
assert.ok(Array.isArray(chunk.props));
assert.ok(Array.isArray(chunk.colliders));

const chunkCached = getChunk(25, 25);
assert.equal(chunk, chunkCached, 'getChunk should return cached instance');

// Out of bounds chunk
const oobChunk = getChunk(-1, 0);
assert.equal(oobChunk.buildings.length, 0);
assert.equal(oobChunk.district, 3);

// forChunksAround
let visitedChunks = 0;
forChunksAround(0, 0, 1, (c) => {
  visitedChunks++;
  assert.ok(c);
});
assert.equal(visitedChunks, 9, 'Radius 1 around center should visit 3x3=9 chunks');

// collidersNear and isBlocked
const colliders = collidersNear(0, 0, 50);
assert.ok(Array.isArray(colliders));
assert.ok(typeof isBlocked(0, 0, 0.45) === 'boolean');
assert.equal(isBlocked(-4500, 0), true, 'Water position should be blocked');
assert.equal(isBlocked(5000, 0), true, 'World boundary position should be blocked');

// resolveCircle
const resolved = resolveCircle(0, 0, 0.45);
assert.ok(typeof resolved.x === 'number');
assert.ok(typeof resolved.z === 'number');

// raycastStatic
const rayHit = raycastStatic(0, 0, 1, 0, 500);
if (rayHit) {
  assert.ok(typeof rayHit.t === 'number');
  assert.ok(typeof rayHit.x === 'number');
  assert.ok(typeof rayHit.z === 'number');
  assert.ok(rayHit.collider);
}

// findOpenSpot
const spot = findOpenSpot(0, 0, 10, 50);
assert.ok(typeof spot.x === 'number');
assert.ok(typeof spot.z === 'number');
assert.equal(isBlocked(spot.x, spot.z, 0.7), false, 'findOpenSpot should return unblocked spot');

// allSpawnPoints
const spawns = allSpawnPoints();
assert.ok(spawns.length >= 50);
assert.equal(spawns[0].x, 0);
assert.equal(spawns[0].z, 80);

// bakeDistrictTexture
const tex = bakeDistrictTexture(16);
assert.equal(tex.size, 16);
assert.equal(tex.data.length, 16 * 16 * 4);

console.log('world.test.mjs passed successfully');
