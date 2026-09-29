import * as THREE from "three";
import { groundAt } from "./terrain.js";

const RADIUS = 4.4;
const PICKUP = 5.8;
const BENDS = [
  0.22, 0.38, 0.48, 0.5, 0.5, 0.5, 0.5, 0.5, 0.48, 0.42, 0.3,
  -0.2, -0.42, -0.55, -0.55, -0.55, -0.55, -0.55, -0.5, -0.38,
  0.25, 0.48, 0.55, 0.55, 0.55, 0.48, 0.32, 0.18,
];

/** Percurso de anéis. Só o próximo anel conta; os outros ficam esmaecidos. */
export function createRings(scene, start) {
  const torus = new THREE.TorusGeometry(RADIUS, 0.3, 10, 44);
  const disc = new THREE.CircleGeometry(RADIUS - 0.2, 40);
  const idle = new THREE.MeshStandardMaterial({ color: 0xe8b85c, emissive: 0xb87a22, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.35, transparent: true, opacity: 0.55 });
  const next = new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffc860, emissiveIntensity: 2.2, metalness: 0.2, roughness: 0.3 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });

  const points = [];
  let x = start.x;
  let z = start.z;
  let yaw = start.yaw;
  for (const bend of BENDS) {
    yaw += bend;
    x += Math.sin(yaw) * 84;
    z += Math.cos(yaw) * 84;
    if (Math.hypot(x, z) > 540) {
      yaw = Math.atan2(-x, -z);
      x += Math.sin(yaw) * 30;
      z += Math.cos(yaw) * 30;
    }
    const y = Math.max(groundAt(x, z) + 24, 52 + Math.sin(points.length * 0.7) * 14);
    points.push(new THREE.Vector3(x, y, z));
  }

  const rings = points.map((p, i) => {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(torus, idle);
    const face = new THREE.Mesh(disc, glow);
    face.visible = false;
    group.add(ring, face);
    group.position.copy(p);
    group.lookAt(points[Math.min(i + 1, points.length - 1)]);
    if (i === points.length - 1) group.lookAt(points[i - 1]);
    scene.add(group);
    return { group, ring, face, base: p.y, got: false, burst: 0 };
  });

  let index = 0;

  function mark() {
    rings.forEach((r, i) => {
      r.ring.material = i === index ? next : idle;
      r.face.visible = i === index;
    });
  }

  function reset() {
    index = 0;
    for (const r of rings) {
      r.got = false;
      r.burst = 0;
      r.group.visible = true;
      r.group.scale.setScalar(1);
    }
    mark();
  }
  reset();

  return {
    total: rings.length,
    get collected() { return index; },
    get done() { return index >= rings.length; },
    get next() { return rings[index]?.group.position ?? null; },
    reset,
    /** Retorna true quando o próximo anel foi atravessado neste frame. */
    update(time, dt, birdPos, active) {
      let hit = false;
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i];
        if (r.got) {
          if (r.burst < 1) {
            r.burst = Math.min(1, r.burst + dt * 2.5);
            r.group.scale.setScalar(1 + r.burst * 0.8);
            r.group.visible = r.burst < 1;
          }
          continue;
        }
        r.group.position.y = r.base + Math.sin(time * 1.2 + i) * 0.3;
        if (i === index) {
          const pulse = 1 + Math.sin(time * 4) * 0.04;
          r.ring.scale.setScalar(pulse);
          glow.opacity = 0.1 + Math.sin(time * 4) * 0.04;
          if (active && birdPos.distanceTo(r.group.position) < PICKUP) {
            r.got = true;
            r.ring.scale.setScalar(1);
            r.face.visible = false;
            index++;
            hit = true;
            mark();
          }
        }
      }
      return hit;
    },
  };
}
