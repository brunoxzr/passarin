import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  WATER, ISLANDS, ISLAND_TOP, ISLAND_DEPTH, MAP_SIZE, MAP_SEGMENTS,
  heights, fbm,
} from "./terrain.js";
import { clamp } from "../util/math.js";

export const FOG = new THREE.Color(0xeccfb0);
export const FOG_DENSITY = 0.0012;
export const SUN = new THREE.Vector3(-0.45, 0.42, 0.62).normalize();

export function createEnvironment(scene) {
  scene.fog = new THREE.FogExp2(FOG, FOG_DENSITY);
  scene.background = FOG.clone();

  const hemi = new THREE.HemisphereLight(0xffe6c8, 0x4a5a3a, 0.9);
  const sun = new THREE.DirectionalLight(0xffe2bc, 2.4);
  const fill = new THREE.DirectionalLight(0x9fbbe0, 0.45);
  fill.position.set(0.5, 0.4, -0.6);
  scene.add(hemi, sun, sun.target, fill);

  const sky = makeSky();
  const water = makeWater();
  const terrain = makeTerrain();
  const islands = new THREE.Group();
  for (const isl of ISLANDS) {
    const mesh = makeIsland(isl);
    mesh.position.set(isl.x, isl.y, isl.z);
    islands.add(mesh);
  }
  const clouds = makeClouds();
  const props = new THREE.Group();
  scene.add(sky, water, terrain, islands, clouds.group, props);

  return {
    terrain, islands, props,
    update(time, dt, focus, camera) {
      sun.position.copy(focus).addScaledVector(SUN, 200);
      sun.target.position.copy(focus);
      sky.position.copy(camera.position);
      water.material.uniforms.uTime.value = time;
      clouds.update(dt);
    },
  };
}

// Cada triângulo recebe uma cor só: visual low-poly coerente com os modelos da natureza.
function makeTerrain() {
  const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, MAP_SEGMENTS, MAP_SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heights[i]);
  const flat = geo.toNonIndexed();
  const p = flat.attributes.position;
  const colors = new Float32Array(p.count * 3);

  const bed = new THREE.Color(0x2c5652);
  const sand = new THREE.Color(0xe3cf9f);
  const lush = new THREE.Color(0x5f8a3a);
  const dry = new THREE.Color(0xa3ad52);
  const high = new THREE.Color(0x8f9a5c);
  const rock = new THREE.Color(0x9a8270);
  const darkRock = new THREE.Color(0x6a5a50);
  const snow = new THREE.Color(0xf5f1e8);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const col = new THREE.Color();

  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    n.copy(c).sub(b).cross(a.clone().sub(b)).normalize();
    const h = (a.y + b.y + c.y) / 3;
    const x = (a.x + b.x + c.x) / 3;
    const z = (a.z + b.z + c.z) / 3;
    const slope = 1 - Math.abs(n.y);
    const patch = fbm(x * 0.012, z * 0.012, 3);

    if (h < WATER - 0.5) col.copy(bed);
    else if (h < WATER + 2.8) col.copy(sand);
    else {
      col.copy(lush).lerp(dry, clamp((patch - 0.35) * 2.2, 0, 1));
      col.lerp(high, clamp((h - 70) / 50, 0, 1));
      col.lerp(rock, clamp((slope - 0.22) / 0.2, 0, 1));
      col.lerp(darkRock, clamp((slope - 0.5) / 0.25, 0, 1));
      if (slope < 0.55) col.lerp(snow, clamp((h - 128) / 18, 0, 1));
    }
    const jitter = 0.94 + ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1 * 0.1;
    col.multiplyScalar(jitter);
    for (let k = 0; k < 3; k++) {
      colors[(i + k) * 3] = col.r;
      colors[(i + k) * 3 + 1] = col.g;
      colors[(i + k) * 3 + 2] = col.b;
    }
  }
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  flat.computeVertexNormals();
  return new THREE.Mesh(flat, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

function makeIsland(isl) {
  const seg = 22;
  const rings = 6;
  const grass = new THREE.Color(0x77a146);
  const moss = new THREE.Color(0x587f36);
  const rock = new THREE.Color(0x7d6454);
  const deep = new THREE.Color(0x4f4039);

  // Topo gramado em anéis.
  const top = [];
  const topCol = [];
  const ring = (r) => {
    const out = [];
    const rad = (r / rings) * isl.r;
    for (let s = 0; s < seg; s++) {
      const ang = (s / seg) * Math.PI * 2;
      const wob = r === rings ? 1 + Math.sin(ang * 5 + isl.x) * 0.06 : 1;
      out.push([Math.cos(ang) * rad * wob, Math.pow(1 - r / rings, 0.55) * ISLAND_TOP, Math.sin(ang) * rad * wob]);
    }
    return out;
  };
  const rs = [];
  for (let r = 1; r <= rings; r++) rs.push(ring(r));
  const tri = (p, q, w, cl) => { top.push(...p, ...q, ...w); for (let k = 0; k < 3; k++) topCol.push(cl.r, cl.g, cl.b); };
  const center = [0, ISLAND_TOP, 0];
  for (let s = 0; s < seg; s++) tri(center, rs[0][(s + 1) % seg], rs[0][s], grass);
  for (let r = 0; r < rings - 1; r++) {
    const cl = grass.clone().lerp(moss, r / rings);
    for (let s = 0; s < seg; s++) {
      const nx = (s + 1) % seg;
      tri(rs[r][s], rs[r][nx], rs[r + 1][nx], cl);
      tri(rs[r][s], rs[r + 1][nx], rs[r + 1][s], cl);
    }
  }
  // Base de pedra irregular pendurada.
  const outer = rs[rings - 1];
  const tip = [Math.sin(isl.z) * isl.r * 0.1, -isl.r * ISLAND_DEPTH, Math.cos(isl.x) * isl.r * 0.1];
  const mid = outer.map(([x, y, z], i) => {
    const k = 0.55 + ((i * 7919) % 13) / 60;
    return [x * k, -isl.r * ISLAND_DEPTH * 0.45 - ((i * 31) % 5), z * k];
  });
  for (let s = 0; s < seg; s++) {
    const nx = (s + 1) % seg;
    tri(outer[s], mid[nx], outer[nx], rock);
    tri(outer[s], mid[s], mid[nx], rock);
    tri(mid[s], tip, mid[nx], deep);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(top, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(topCol, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
}

function makeClouds() {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xfffaf2, emissive: 0x7a6f78, emissiveIntensity: 0.35, flatShading: true });
  const puff = new THREE.IcosahedronGeometry(1, 1);
  const clouds = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 34; i++) {
    const pieces = [];
    const count = 4 + Math.floor(rnd() * 5);
    const len = 30 + rnd() * 50;
    for (let k = 0; k < count; k++) {
      const g = puff.clone();
      const s = 8 + rnd() * 12 * (1 - Math.abs(k / count - 0.5));
      g.scale(s * 1.3, s * 0.8, s);
      g.translate((k / count - 0.5) * len, rnd() * 5, (rnd() - 0.5) * 16);
      pieces.push(g);
    }
    const mesh = new THREE.Mesh(mergeGeometries(pieces), mat);
    const ang = rnd() * Math.PI * 2;
    const rad = 120 + rnd() * 820;
    mesh.position.set(Math.cos(ang) * rad, 150 + rnd() * 70, Math.sin(ang) * rad);
    mesh.rotation.y = rnd() * Math.PI;
    group.add(mesh);
    clouds.push({ mesh, drift: 1.5 + rnd() * 2 });
  }
  return {
    group,
    update(dt) {
      for (const c of clouds) {
        c.mesh.position.x += c.drift * dt;
        if (c.mesh.position.x > 1000) c.mesh.position.x = -1000;
      }
    },
  };
}

function makeWater() {
  const geo = new THREE.PlaneGeometry(4000, 4000, 40, 40);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uSun: { value: SUN.clone() },
      uFog: { value: FOG.clone() },
      uFogDensity: { value: FOG_DENSITY },
    },
    vertexShader: `
      uniform float uTime;
      varying vec3 vPos;
      void main() {
        vec3 p = position;
        p.y += sin(position.x * 0.05 + uTime * 1.3) * 0.22 + cos(position.z * 0.04 + uTime) * 0.16;
        vPos = (modelMatrix * vec4(p, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uSun;
      uniform vec3 uFog;
      uniform float uFogDensity;
      varying vec3 vPos;
      void main() {
        vec2 q = vPos.xz;
        vec3 n = normalize(vec3(
          sin(q.x * 0.11 + uTime * 1.7) * 0.05 + sin(q.y * 0.23 - uTime * 1.1) * 0.03,
          1.0,
          cos(q.y * 0.09 + uTime * 1.3) * 0.05 + cos(q.x * 0.19 + uTime) * 0.03));
        vec3 view = normalize(cameraPosition - vPos);
        float fres = pow(1.0 - max(dot(n, view), 0.0), 4.0);
        vec3 deep = vec3(0.05, 0.25, 0.30);
        vec3 shallow = vec3(0.20, 0.55, 0.52);
        vec3 col = mix(deep, shallow, 0.35 + fres * 0.5);
        col = mix(col, vec3(0.98, 0.84, 0.66), fres * 0.55);
        float spec = pow(max(dot(reflect(-normalize(uSun), n), view), 0.0), 180.0);
        col += vec3(1.0, 0.85, 0.6) * spec * 1.6;
        float dist = length(cameraPosition - vPos);
        float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
        col = mix(col, uFog, clamp(fog, 0.0, 1.0));
        gl_FragColor = vec4(col, mix(0.82 + fres * 0.15, 1.0, fog));
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER;
  mesh.renderOrder = 2;
  return mesh;
}

function makeSky() {
  const geo = new THREE.SphereGeometry(1800, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uSun: { value: SUN.clone() }, uFog: { value: FOG.clone() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uSun;
      uniform vec3 uFog;
      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y;
        vec3 zenith = vec3(0.20, 0.36, 0.62);
        vec3 mid = vec3(0.56, 0.68, 0.82);
        vec3 col = mix(uFog, mid, smoothstep(0.0, 0.25, h));
        col = mix(col, zenith, smoothstep(0.2, 0.9, h));
        if (h < 0.0) col = uFog;
        float d = max(dot(dir, normalize(uSun)), 0.0);
        col += pow(d, 6.0) * vec3(1.0, 0.62, 0.3) * 0.55;
        col += pow(d, 60.0) * vec3(1.0, 0.8, 0.5) * 0.5;
        col += smoothstep(0.9985, 0.9992, d) * vec3(1.6, 1.35, 1.0);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  return mesh;
}
