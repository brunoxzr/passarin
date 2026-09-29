import * as THREE from "three";
import { ISLANDS, islandTop, terrainHeight } from "./terrain.js";

/** Carrega os .glb da pasta nature e devolve as malhas prontas para instanciar. */
export async function loadTemplates(loader, files) {
  const templates = [];
  const results = await Promise.all(files.map((f) => loader.loadAsync(`/models/nature/${f}`).catch(() => null)));
  for (const gltf of results) {
    if (!gltf) continue;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      const size = new THREE.Vector3();
      o.geometry.boundingBox.getSize(size);
      const height = Math.max(size.y, 0.001);
      templates.push({ geometry: o.geometry, material: o.material, height, width: Math.max(size.x, size.z) / height });
    });
  }
  return templates;
}

function randomPoint(area) {
  if (area.radius) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * area.radius;
    return [area.x + Math.cos(a) * r, area.z + Math.sin(a) * r];
  }
  return [(Math.random() - 0.5) * area.size, (Math.random() - 0.5) * area.size];
}

/**
 * Espalha instâncias dos templates. Se `obstacles` for passado, cada objeto
 * vira um cilindro de colisão (tronco + copa).
 */
export function scatter(parent, templates, { count, minH, maxH, accept, area = { size: 1300 }, obstacles = null, kind = "tree", solid = 0.4 }) {
  if (!templates.length || !count) return;
  const buckets = templates.map(() => []);
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 60) {
    guard++;
    const [x, z] = randomPoint(area);
    const h = terrainHeight(x, z);
    if (!accept(h, x, z)) continue;
    const idx = Math.floor(Math.random() * templates.length);
    const t = templates[idx];
    const height = minH + Math.random() * (maxH - minH);
    buckets[idx].push({ x, h: h - 0.2, z, s: height / t.height, rot: Math.random() * Math.PI * 2 });
    if (obstacles) obstacles.push({ kind, x, z, y0: h - 1, y1: h + height * 0.95, r: Math.max(0.5, height * t.width * solid) });
    placed++;
  }
  const dummy = new THREE.Object3D();
  buckets.forEach((list, idx) => {
    if (!list.length) return;
    const src = templates[idx];
    const mesh = new THREE.InstancedMesh(src.geometry, src.material, list.length);
    list.forEach((p, i) => {
      dummy.position.set(p.x, p.h, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.computeBoundingSphere();
    parent.add(mesh);
  });
}

/** Um enfeite por ilha flutuante (árvore, pedra ou planta). */
export function decorateIslands(group, templates, height, { obstacles = null, kind = "tree", offset = 0 } = {}) {
  if (!templates.length) return;
  ISLANDS.forEach((isl, i) => {
    const t = templates[(i + offset) % templates.length];
    const mesh = new THREE.Mesh(t.geometry, t.material);
    const x = isl.x + Math.sin(i * 3.1 + offset) * isl.r * 0.35;
    const z = isl.z + Math.cos(i * 1.7 + offset) * isl.r * 0.35;
    const top = islandTop(isl, x, z) ?? isl.y;
    mesh.scale.setScalar(height / t.height);
    mesh.position.set(x, top - 0.2, z);
    mesh.rotation.y = i * 1.3;
    group.add(mesh);
    if (obstacles) obstacles.push({ kind, x, z, y0: top - 1, y1: top + height * 0.95, r: Math.max(0.5, height * t.width * 0.4) });
  });
}
