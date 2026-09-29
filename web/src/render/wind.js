import * as THREE from "three";

const COUNT = 260;

/** Riscos de vento passando pela câmera; aparecem conforme a velocidade. */
export function createWind(camera) {
  const pos = new Float32Array(COUNT * 6);
  const seeds = [];
  for (let i = 0; i < COUNT; i++) seeds.push(spawn({}, true));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  camera.add(lines);

  function spawn(p, anywhere) {
    const a = Math.random() * Math.PI * 2;
    const r = 1.2 + Math.random() * 5;
    p.x = Math.cos(a) * r;
    p.y = Math.sin(a) * r * 0.7;
    p.z = anywhere ? -Math.random() * 60 : -60;
    return p;
  }

  return {
    update(dt, speed, level) {
      mat.opacity += (level * 0.3 - mat.opacity) * (1 - Math.exp(-4 * dt));
      lines.visible = mat.opacity > 0.01;
      if (!lines.visible) return;
      const len = 1 + level * 5;
      for (let i = 0; i < COUNT; i++) {
        const p = seeds[i];
        p.z += speed * 1.6 * dt;
        if (p.z > 0.5) spawn(p, false);
        pos.set([p.x, p.y, p.z, p.x, p.y, p.z - len], i * 6);
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
