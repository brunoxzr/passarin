const WATER = 26;

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

function fbm(x, z) {
  let v = 0;
  let a = 0.5;
  let f = 1;
  let s = 0;
  for (let i = 0; i < 5; i++) {
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

export function terrainHeight(x, z) {
  const warp = fbm(x * 0.0008, z * 0.0008);
  const base = fbm(x * 0.0014 + warp * 0.4, z * 0.0014);
  const ridge = 1 - Math.abs(fbm(x * 0.0024 + 20, z * 0.0024) * 2 - 1);
  let h = Math.pow(base, 1.25) * 120 + Math.pow(ridge, 1.7) * 80;
  h += Math.exp(-((x - 40) ** 2 + (z + 220) ** 2) / (2 * 90 * 90)) * 70;
  h += Math.exp(-((x + 260) ** 2 + (z + 40) ** 2) / (2 * 110 * 110)) * 90;
  const d = z - riverZ(x);
  const carve = Math.exp(-(d * d) / (2 * 64 * 64));
  h = h * (1 - carve * 0.72) + 14 * carve;
  return h;
}

export const ISLANDS = [
  { x: 160, z: -30, y: 92, r: 26 },
  { x: 310, z: 70, y: 118, r: 20 },
  { x: -40, z: 180, y: 86, r: 16 },
  { x: 470, z: -120, y: 132, r: 18 },
  { x: -180, z: 140, y: 108, r: 22 },
];

export function islandTop(isl, x, z) {
  const dx = x - isl.x;
  const dz = z - isl.z;
  const d = Math.hypot(dx, dz);
  if (d > isl.r) return null;
  const edge = 1 - d / isl.r;
  return isl.y + Math.pow(edge, 0.6) * 6;
}

export function groundAt(x, z, y = 999) {
  let h = terrainHeight(x, z);
  for (const isl of ISLANDS) {
    const top = islandTop(isl, x, z);
    if (top != null && y > isl.y - 4 && top > h) h = top;
  }
  return h;
}

export function findStart() {
  const x = -220;
  let z = riverZ(x) - 130;
  let y = terrainHeight(x, z);
  if (y < WATER + 18) {
    z = riverZ(x) - 180;
    y = terrainHeight(x, z);
  }
  return { x, y: y + 26, z, yaw: Math.PI / 2 };
}

export { WATER };
