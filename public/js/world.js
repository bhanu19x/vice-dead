// Deterministic procedural 10 x 10 km city. No browser or Three.js dependency.
export const WORLD = { size: 10000, half: 5000, block: 200, road: 24, sidewalk: 6, grid: 50 };
export const DISTRICTS = [
  { id: 0, name: 'Downtown Vice', color: [0.18, 0.17, 0.23] },
  { id: 1, name: 'Midtown', color: [0.22, 0.21, 0.24] },
  { id: 2, name: 'Vice Beach', color: [0.76, 0.62, 0.42] },
  { id: 3, name: 'Open Water', color: [0.05, 0.25, 0.34] },
  { id: 4, name: 'Sunset Suburbs', color: [0.20, 0.32, 0.17] },
  { id: 5, name: 'Industrial Mile', color: [0.27, 0.27, 0.28] },
  { id: 6, name: 'Palm Grove Park', color: [0.16, 0.38, 0.20] },
  { id: 7, name: 'Vice Port', color: [0.29, 0.28, 0.27] },
];
export const POIS = [
  { name: 'Neon Plaza', x: 0, z: 0 },
  { name: 'Ocean Drive', x: -3600, z: 900 },
  { name: 'Palm Grove Park', x: 2100, z: -1600 },
  { name: 'Vice Port', x: 900, z: 3900 },
  { name: 'Rustbelt Yards', x: 3900, z: 800 },
  { name: 'Sunset Suburbs', x: -900, z: -3600 },
  { name: 'The Boardwalk', x: -4050, z: -400 },
  { name: 'Cypress Mall', x: 1800, z: 1200 },
];

export const PALETTES = {
  tower: [0x29354a, 0x354158, 0x443650, 0x2d4b4d, 0x51465b],
  mid: [0xf0b6c8, 0xb5e1d8, 0xf7d99d, 0xc5d7f3, 0xe5c5ef, 0xffc3a5],
  house: [0xd8c6aa, 0xc4b69d, 0xd2b79f, 0xb8c8aa, 0xe0c4b0],
  industrial: [0x62666d, 0x77716b, 0x535b63, 0x76665d],
};
export const NEON = [0x00e5ff, 0xff2d95, 0x9d4dff, 0x39ff8f, 0xffb300, 0xff5252];
export const CAR_COLORS = [0xf7d154, 0x5ee6d8, 0xff7a6b, 0xc9c3f5, 0xf4f4f4, 0x3ec1f2, 0xff9ecb];

let activeSeed = 90210;
let cache = new Map();

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519 | 0);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
const pick = (r, a) => a[(r() * a.length) | 0];
const rnd = (r, a, b) => a + r() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function seedWorld(seed = 90210) { activeSeed = seed | 0; cache = new Map(); }
export function getSeed() { return activeSeed; }
export function chunkIndex(v) { return clamp(Math.floor((v + WORLD.half) / WORLD.block), 0, WORLD.grid - 1); }
export function chunkOf(x, z) { return { cx: chunkIndex(x), cz: chunkIndex(z) }; }

export function isWater(x, z) {
  return x < -4300 + Math.sin(z * 0.0011) * 140 || z > 4450 + Math.sin(x * 0.0009) * 110 || (x + z < -6900 && x < -2500);
}
export function districtAt(x, z) {
  if (isWater(x, z)) return 3;
  if (x < -3250) return 2;
  if (z > 3250) return 7;
  if (z < -2900) return 4;
  if (x > 3150) return 5;
  if (Math.hypot(x - 2100, z + 1600) < 650) return 6;
  const r = Math.hypot(x, z);
  if (r < 1150) return 0;
  return r < 2350 ? 1 : (Math.sin(x * 0.0017 + z * 0.0012) > 0.35 ? 4 : 1);
}
export function districtNameAt(x, z) { return DISTRICTS[districtAt(x, z)].name; }
export function nearestPOI(x, z) {
  let best = null, d = Infinity;
  for (const poi of POIS) { const q = (poi.x - x) ** 2 + (poi.z - z) ** 2; if (q < d) { d = q; best = poi; } }
  return { poi: best, distance: Math.sqrt(d) };
}

function makeChunk(cx, cz) {
  const key = `${cx},${cz}`;
  if (cache.has(key)) return cache.get(key);
  const r = mulberry32(hash2(cx, cz, activeSeed));
  const ox = cx * WORLD.block - WORLD.half, oz = cz * WORLD.block - WORLD.half;
  const centerX = ox + 100, centerZ = oz + 100, district = districtAt(centerX, centerZ);
  const buildings = [], props = [], colliders = [];
  const addBuilding = (x, z, w, d, h, kind, color, rot = 0, neon = 0) => {
    if (isWater(x, z) || isWater(x - w * .45, z) || isWater(x + w * .45, z)) return;
    const b = { x, z, w, d, h, kind, color, rot, neon, solid: true };
    buildings.push(b); colliders.push({ x, z, hx: w / 2, hz: d / 2, h, kind: 'building' });
  };
  const addProp = (type, x, z, extra = {}) => { if (!isWater(x, z)) props.push({ type, x, z, ...extra }); };
  const inner0 = 18, inner1 = 182;

  if (district === 0) {
    const count = r() < .35 ? 1 : 2;
    if (count === 1) {
      const w = rnd(r, 92, 140), d = rnd(r, 92, 140);
      addBuilding(centerX + rnd(r, -12, 12), centerZ + rnd(r, -12, 12), w, d, rnd(r, 65, 155), 'tower', pick(r, PALETTES.tower), r() < .5 ? 0 : Math.PI / 2, pick(r, NEON));
    } else {
      for (let k = 0; k < 2; k++) {
        const w = rnd(r, 55, 76), d = rnd(r, 55, 82);
        const x = ox + (k ? 112 : 68) + rnd(r, -5, 5), z = oz + rnd(r, 72, 128);
        addBuilding(x, z, w, d, rnd(r, 48, 112), 'tower', pick(r, PALETTES.tower), r() < .5 ? 0 : Math.PI / 2, pick(r, NEON));
      }
    }
  } else if (district === 1) {
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      if (r() < .12) continue;
      const w = rnd(r, 45, 68), d = rnd(r, 44, 68);
      addBuilding(ox + (a ? 126 : 74) + rnd(r, -4, 4), oz + (b ? 126 : 74) + rnd(r, -4, 4), w, d, rnd(r, 14, 42), 'mid', pick(r, PALETTES.mid), r() < .5 ? 0 : Math.PI / 2, r() < .55 ? pick(r, NEON) : 0);
    }
  } else if (district === 2) {
    for (let b = 0; b < 2; b++) {
      const w = rnd(r, 48, 68), d = rnd(r, 52, 72);
      addBuilding(ox + rnd(r, 55, 145), oz + (b ? 135 : 65), w, d, rnd(r, 18, 45), 'hotel', pick(r, PALETTES.mid), 0, pick(r, NEON));
    }
    for (let i = 0; i < 4; i++) addProp('palm', ox + rnd(r, 20, 180), oz + rnd(r, 15, 185), { scale: rnd(r, .8, 1.25), rot: rnd(r, -Math.PI, Math.PI) });
  } else if (district === 4) {
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      if (r() < .12) continue;
      const w = rnd(r, 18, 30), d = rnd(r, 15, 27);
      addBuilding(ox + (a ? 130 : 68) + rnd(r, -8, 8), oz + (b ? 130 : 68) + rnd(r, -8, 8), w, d, rnd(r, 5, 10), 'house', pick(r, PALETTES.house), r() < .5 ? 0 : Math.PI / 2, 0);
      if (r() < .55) addProp('palm', ox + rnd(r, 28, 172), oz + rnd(r, 28, 172), { scale: rnd(r, .65, .9), rot: rnd(r, 0, 6.28) });
    }
  } else if (district === 5 || district === 7) {
    const n = district === 5 ? (r() < .45 ? 1 : 2) : 1;
    for (let i = 0; i < n; i++) {
      const w = rnd(r, 80, 142), d = rnd(r, 55, 100);
      addBuilding(ox + rnd(r, 40, 160), oz + rnd(r, 40, 160), w, d, rnd(r, 8, 20), 'warehouse', pick(r, PALETTES.industrial), 0, 0);
    }
    for (let i = 0; i < 7; i++) addProp('container', ox + rnd(r, 25, 175), oz + rnd(r, 25, 175), { rot: r() < .5 ? 0 : Math.PI / 2, color: pick(r, [0xd94f30, 0x2d6cdf, 0x2f9e44, 0xf0c419]), stack: r() < .25 });
  } else if (district === 6) {
    for (let i = 0; i < 9; i++) addProp('palm', ox + rnd(r, 20, 180), oz + rnd(r, 20, 180), { scale: rnd(r, .8, 1.3), rot: rnd(r, 0, 6.28) });
    for (let i = 0; i < 5; i++) addProp('bench', ox + rnd(r, 35, 165), oz + rnd(r, 35, 165), { rot: rnd(r, 0, 6.28) });
  }

  // Roadside infrastructure and details across street grid
  // Corner and mid-block street lamps
  const lampPts = [[24, 24], [100, 24], [176, 24], [24, 176], [100, 176], [176, 176], [24, 100], [176, 100]];
  for (const [lx, lz] of lampPts) addProp('lamp', ox + lx, oz + lz, { rot: r() * 6.28 });

  // Palm trees lining avenues
  const palmSidePts = [[32, 26], [68, 26], [132, 26], [168, 26], [32, 174], [68, 174], [132, 174], [168, 174]];
  for (const [px, pz] of palmSidePts) {
    if (r() < 0.85) addProp('palm', ox + px, oz + pz, { scale: rnd(r, 0.85, 1.3), rot: rnd(r, 0, 6.28) });
  }

  // Parked cars along sidewalks
  if (r() < .75) addProp('car', ox + rnd(r, 35, 165), oz + 16, { rot: 0, color: pick(r, CAR_COLORS) });
  if (r() < .70) addProp('car', ox + rnd(r, 35, 165), oz + 184, { rot: Math.PI, color: pick(r, CAR_COLORS) });
  if (r() < .50) addProp('car', ox + 16, oz + rnd(r, 35, 165), { rot: Math.PI / 2, color: pick(r, CAR_COLORS) });

  // Urban props: Dumpsters, bins, construction barriers
  if (r() < .6) addProp('bin', ox + rnd(r, 20, 180), oz + 20, { rot: r() * 6.28 });
  if (r() < .4) addProp('dumpster', ox + rnd(r, 25, 175), oz + 24, { rot: r() < .5 ? 0 : Math.PI / 2 });
  if (r() < .35) addProp('barrier', ox + rnd(r, 30, 170), oz + 28, { rot: r() < .5 ? 0 : Math.PI / 2 });
  const chunk = { cx, cz, district, buildings, props, colliders };
  cache.set(key, chunk);
  return chunk;
}

export function getChunk(cx, cz) {
  if (cx < 0 || cz < 0 || cx >= WORLD.grid || cz >= WORLD.grid) return { buildings: [], props: [], colliders: [], district: 3 };
  return makeChunk(cx, cz);
}
export function forChunksAround(x, z, radius, callback) {
  const c = chunkOf(x, z);
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) callback(getChunk(c.cx + dx, c.cz + dz));
}
export function collidersNear(x, z, radius = 30) {
  const out = [];
  const c0 = chunkOf(x - radius, z - radius), c1 = chunkOf(x + radius, z + radius);
  for (let cz = c0.cz; cz <= c1.cz; cz++) for (let cx = c0.cx; cx <= c1.cx; cx++) out.push(...getChunk(cx, cz).colliders);
  return out;
}
export function isBlocked(x, z, radius = .45) {
  if (Math.abs(x) > WORLD.half - 8 || Math.abs(z) > WORLD.half - 8 || isWater(x, z)) return true;
  for (const c of collidersNear(x, z, radius + 2)) {
    const qx = clamp(x, c.x - c.hx, c.x + c.hx), qz = clamp(z, c.z - c.hz, c.z + c.hz);
    if ((x - qx) ** 2 + (z - qz) ** 2 < radius * radius) return true;
  }
  return false;
}
export function resolveCircle(x, z, radius = .45) {
  for (let pass = 0; pass < 3; pass++) {
    for (const c of collidersNear(x, z, radius + 3)) {
      const qx = clamp(x, c.x - c.hx, c.x + c.hx), qz = clamp(z, c.z - c.hz, c.z + c.hz);
      let dx = x - qx, dz = z - qz, d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 < 1e-8) {
          const px = c.hx + radius - Math.abs(x - c.x), pz = c.hz + radius - Math.abs(z - c.z);
          if (px < pz) x += x < c.x ? -px : px; else z += z < c.z ? -pz : pz;
        } else {
          const d = Math.sqrt(d2), push = radius - d;
          x += dx / d * push; z += dz / d * push;
        }
      }
    }
  }
  if (isWater(x, z)) { x = Math.max(x, -4280); z = Math.min(z, 4420); }
  return { x: clamp(x, -WORLD.half + 8, WORLD.half - 8), z: clamp(z, -WORLD.half + 8, WORLD.half - 8) };
}
export function raycastStatic(ox, oz, dx, dz, maxDist = 300) {
  let best = null;
  const seen = new Set();
  for (let t = 0; t <= maxDist; t += 30) {
    const c = chunkOf(ox + dx * t, oz + dz * t), key = `${c.cx},${c.cz}`;
    if (seen.has(key)) continue; seen.add(key);
    for (const b of getChunk(c.cx, c.cz).colliders) {
      const tx = Math.abs(dx) < 1e-6 ? Infinity : ((b.x + (dx > 0 ? -b.hx : b.hx)) - ox) / dx;
      const tz = Math.abs(dz) < 1e-6 ? Infinity : ((b.z + (dz > 0 ? -b.hz : b.hz)) - oz) / dz;
      const tHit = Math.min(tx, tz);
      if (tHit >= 0 && tHit < maxDist && (!best || tHit < best.t) && Math.abs(ox + dx * tHit - b.x) <= b.hx + .2 && Math.abs(oz + dz * tHit - b.z) <= b.hz + .2) best = { t: tHit, x: ox + dx * tHit, z: oz + dz * tHit, collider: b };
    }
  }
  return best;
}
export function findOpenSpot(x, z, minDist = 0, maxDist = 80, rng = Math.random) {
  for (let i = 0; i < 40; i++) {
    const a = rng() * Math.PI * 2, d = minDist + rng() * (maxDist - minDist);
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    if (!isBlocked(px, pz, .7)) return { x: px, z: pz };
  }
  return resolveCircle(x, z, .7);
}
export function allSpawnPoints() {
  const points = [{ x: 0, z: 80 }, { x: 80, z: 0 }, { x: -80, z: 0 }, { x: 0, z: -80 }];
  for (let i = 0; i < 50; i++) { const a = i * 2.39996, d = 700 + (i % 10) * 250; const p = findOpenSpot(Math.cos(a) * d * .5, Math.sin(a) * d * .5, 0, 100); points.push(p); }
  return points;
}
export function worldDistance(x1, z1, x2, z2) {
  return Math.hypot(x2 - x1, z2 - z1);
}

export function bakeDistrictTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const wx = (x / (size - 1) - .5) * WORLD.size, wz = (y / (size - 1) - .5) * WORLD.size;
    const d = districtAt(wx, wz), c = DISTRICTS[d].color, water = isWater(wx, wz) ? 255 : 0;
    const i = (y * size + x) * 4; data[i] = c[0] * 255; data[i + 1] = c[1] * 255; data[i + 2] = c[2] * 255; data[i + 3] = water;
  }
  return { data, size };
}
