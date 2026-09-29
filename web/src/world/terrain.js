// Relevo do vale. A altura "crua" é procedural; o jogo usa um campo amostrado
// na mesma grade da malha, então colisão e visual batem exatamente.

export const WATER = 26;
export const MAP_SIZE = 1600;
export const MAP_SEGMENTS = 170;
export const COAST = 620; // raio onde a ilha começa a afundar no mar

function hash(ix, iz) {
  let n = ix * 374761393 + iz * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}

function noise(x, z) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash(x0, z0);
  const b = hash(x0 + 1, z0);
  const c = hash(x0, z0 + 1);
  const d = hash(x0 + 1, z0 + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm(x, z, octaves = 5) {
  let v = 0;
  let a = 0.5;
  let f = 1;
  let s = 0;
  for (let i = 0; i < octaves; i++) {
    v += a * noise(x * f, z * f);
    s += a;
    a *= 0.5;
    f *= 2.03;
  }
  return v / s;
}

export function riverZ(x) {
  return Math.sin(x * 0.0042) * 150 + Math.sin(x * 0.0016) * 70;
}

function rawHeight(x, z) {
  const warp = fbm(x * 0.0008, z * 0.0008);
  const base = fbm(x * 0.0014 + warp * 0.4, z * 0.0014);
  const ridge = 1 - Math.abs(fbm(x * 0.0024 + 20, z * 0.0024) * 2 - 1);
  let h = Math.pow(base, 1.25) * 120 + Math.pow(ridge, 1.7) * 80;
  h += Math.exp(-((x - 40) ** 2 + (z + 220) ** 2) / (2 * 90 * 90)) * 70;
  h += Math.exp(-((x + 260) ** 2 + (z + 40) ** 2) / (2 * 110 * 110)) * 90;
  const d = z - riverZ(x);
  const carve = Math.exp(-(d * d) / (2 * 64 * 64));
  h = h * (1 - carve * 0.72) + 14 * carve;
  // A ilha termina em praia e mar aberto, em vez de um corte seco.
  const r = Math.hypot(x, z) + (fbm(x * 0.006, z * 0.006, 3) - 0.5) * 90;
  const t = Math.min(1, Math.max(0, (r - COAST) / 150));
  const sink = t * t * (3 - 2 * t);
  return h * (1 - sink) + (WATER - 14) * sink;
}

// Campo de alturas na mesma grade da PlaneGeometry do terreno.
const N = MAP_SEGMENTS + 1;
const CELL = MAP_SIZE / MAP_SEGMENTS;
const HALF = MAP_SIZE / 2;
export const heights = new Float32Array(N * N);
for (let iz = 0; iz < N; iz++) {
  for (let ix = 0; ix < N; ix++) {
    heights[iz * N + ix] = rawHeight(ix * CELL - HALF, iz * CELL - HALF);
  }
}

/** Altura exata da malha (mesma triangulação da PlaneGeometry). */
export function terrainHeight(x, z) {
  const gx = Math.min(MAP_SEGMENTS - 1e-4, Math.max(0, (x + HALF) / CELL));
  const gz = Math.min(MAP_SEGMENTS - 1e-4, Math.max(0, (z + HALF) / CELL));
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const u = gx - ix;
  const v = gz - iz;
  const ha = heights[iz * N + ix];
  const hb = heights[(iz + 1) * N + ix];
  const hc = heights[(iz + 1) * N + ix + 1];
  const hd = heights[iz * N + ix + 1];
  if (u + v <= 1) return ha + (hd - ha) * u + (hb - ha) * v;
  return hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
}

export function terrainNormal(x, z, out = { x: 0, y: 1, z: 0 }) {
  const e = 1.5;
  const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  const len = Math.hypot(dx, 2 * e, dz);
  out.x = -dx / len;
  out.y = (2 * e) / len;
  out.z = -dz / len;
  return out;
}

export const ISLANDS = [
  { x: 160, z: -30, y: 92, r: 26 },
  { x: 310, z: 70, y: 118, r: 20 },
  { x: -40, z: 180, y: 86, r: 16 },
  { x: 470, z: -120, y: 132, r: 18 },
  { x: -180, z: 140, y: 108, r: 22 },
];

export const ISLAND_TOP = 6;
export const ISLAND_DEPTH = 0.75; // fundo do cone, em múltiplos do raio

export function islandTop(isl, x, z) {
  const d = Math.hypot(x - isl.x, z - isl.z);
  if (d > isl.r) return null;
  const edge = 1 - d / isl.r;
  return isl.y + Math.pow(edge, 0.55) * ISLAND_TOP;
}

export function groundAt(x, z, y = 999) {
  let h = terrainHeight(x, z);
  for (const isl of ISLANDS) {
    const top = islandTop(isl, x, z);
    if (top != null && y > isl.y - 2 && top > h) h = top;
  }
  return h;
}

/** Ilha flutuante que contém o ponto (abaixo da borda), ou null. */
export function insideIsland(x, y, z) {
  for (const isl of ISLANDS) {
    const d = Math.hypot(x - isl.x, z - isl.z);
    if (d > isl.r) continue;
    const bottom = isl.y - isl.r * ISLAND_DEPTH * (1 - d / isl.r);
    if (y < isl.y - 1 && y > bottom) return isl;
  }
  return null;
}

export function findStart() {
  const x = -220;
  let z = riverZ(x) - 130;
  if (terrainHeight(x, z) < WATER + 18) z = riverZ(x) - 180;
  return { x, z, yaw: Math.PI / 2 };
}
