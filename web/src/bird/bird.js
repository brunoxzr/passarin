import * as THREE from "three";
import { BIRD_SPAN } from "../config.js";
import { clamp } from "../util/math.js";

// Espaço do pássaro: frente = +Z, cima = +Y, direita = -X.
const FLAP_TIME = 0.55;
const Y = new THREE.Vector3(0, 1, 0);
const _wq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _rq = new THREE.Quaternion();
const _d = new THREE.Quaternion();
const _rest = new THREE.Vector3();
const _target = new THREE.Vector3();

/** Braço (x direita, y cima, z trás) → espaço do pássaro, com a batida extra somada. */
function toBird(out, v, side, extra) {
  out.set(-v.x, v.y, -v.z);
  if (extra) {
    // Gira em volta do eixo da frente: positivo levanta a asa.
    const a = side === "r" ? -extra : extra;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = out.x * c - out.y * s;
    out.y = out.x * s + out.y * c;
    out.x = x;
  }
  return out.normalize();
}

/**
 * Aponta `node` (osso ou pivô) para `targetBird`. `restDir` é a direção do
 * segmento em repouso, no espaço local do nó.
 */
function aimNode(node, restLocal, restDir, targetBird, rootQ) {
  // Só este nó é recalculado (o pai já está em dia) — nada de percorrer o esqueleto todo.
  node.quaternion.copy(restLocal);
  node.updateWorldMatrix(false, false);
  node.getWorldQuaternion(_wq);
  _rest.copy(restDir).applyQuaternion(_wq);
  _target.copy(targetBird).applyQuaternion(rootQ);
  _d.setFromUnitVectors(_rest, _target);
  node.parent.getWorldQuaternion(_pq);
  node.quaternion.copy(_pq.invert().multiply(_d).multiply(_wq));
  node.updateWorldMatrix(false, false);
}

/** Pássaro jogável com asas dirigidas pelo braço do jogador. */
export async function loadBird(loader, spec) {
  const gltf = await loader.loadAsync(spec.file);
  const model = gltf.scene;
  const root = new THREE.Group();
  const orient = new THREE.Group();
  orient.rotation.set(spec.orient[0], spec.orient[1], spec.orient[2]);
  orient.add(model);
  root.add(orient);

  // Escala pela envergadura e centraliza.
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(orient);
  const size = box.getSize(new THREE.Vector3());
  orient.scale.setScalar(BIRD_SPAN / Math.max(size.x, 0.001));
  root.updateMatrixWorld(true);
  box.setFromObject(orient);
  orient.position.sub(box.getCenter(new THREE.Vector3()));
  // Matrizes em dia antes de montar pivôs/ossos (senão a 1ª asa usa a posição antiga).
  root.updateMatrixWorld(true);
  model.traverse((o) => {
    if (o.isMesh) o.frustumCulled = false;
  });

  const driver = spec.rig === "bones" ? boneDriver(model, spec) : spec.rig === "pieces" ? pieceDriver(model, spec) : bendDriver(model, spec);
  const arms = { u: new THREE.Vector3(), f: new THREE.Vector3(), h: new THREE.Vector3() };
  let flapT = 1;
  let lastFlaps = 0;

  return {
    root,
    model,
    spec,
    /** Toca uma batida de asa ampliada (chamado a cada impulso). */
    flap() { flapT = 0; },
    /** arms: createArmReader() → { l:{u,f,h}, r:{u,f,h} }. */
    setWings(armDirs, dt, flaps = 0) {
      if (flaps !== lastFlaps) {
        lastFlaps = flaps;
        flapT = 0;
      }
      flapT = Math.min(1, flapT + dt / FLAP_TIME);
      const extra = flapT < 1 ? Math.sin(flapT * Math.PI * 2) * 0.9 * (1 - flapT * 0.4) : 0;
      root.updateWorldMatrix(true, false);
      root.getWorldQuaternion(_rq);
      for (const side of "lr") {
        const a = armDirs[side];
        toBird(arms.u, a.u, side, extra);
        toBird(arms.f, a.f, side, extra * 1.3);
        toBird(arms.h, a.h, side, extra * 1.5);
        driver(side, arms, _rq);
      }
    },
    place(f) {
      root.position.set(f.x, f.y, f.z);
      root.quaternion.copy(f.q);
    },
    dispose() {
      root.removeFromParent();
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
    },
  };
}

// Gavião: ossos de verdade. Ombro, antebraço e mão seguem o braço.
function boneDriver(model, spec) {
  const byName = {};
  model.traverse((o) => { if (o.isBone) byName[o.name] = o; });
  const chain = {};
  for (const side of "lr") {
    const s = side === "l" ? spec.boneLeft : spec.boneRight;
    chain[side] = ["u", "f", "h"].map((seg, i) => {
      const bone = byName[spec.bones[i] + s];
      return bone ? { seg, bone, rest: bone.quaternion.clone() } : null;
    }).filter(Boolean);
  }
  return (side, arms, rootQ) => {
    const list = chain[side];
    if (!list.length) return;
    list[0].bone.parent.updateWorldMatrix(true, false); // atualiza só a linha até o ombro
    for (const { seg, bone, rest } of list) aimNode(bone, rest, Y, arms[seg], rootQ);
  };
}

// Pássaro com asas em malhas separadas: cada asa gira num pivô no ombro.
function pieceDriver(model, spec) {
  const pivots = {};
  model.updateMatrixWorld(true);
  for (const side of "lr") {
    const mesh = model.getObjectByName(side === "l" ? spec.pieceLeft : spec.pieceRight);
    if (!mesh) continue;
    const b = new THREE.Box3().setFromObject(mesh);
    const center = b.getCenter(new THREE.Vector3());
    // Ombro = borda interna da asa, na altura do centro.
    const inner = Math.abs(b.min.x) < Math.abs(b.max.x) ? b.min.x : b.max.x;
    const shoulderW = new THREE.Vector3(inner, center.y - (b.max.y - b.min.y) * 0.3, center.z);
    const parent = mesh.parent;
    const pivot = new THREE.Group();
    pivot.position.copy(parent.worldToLocal(shoulderW.clone()));
    parent.add(pivot);
    pivot.attach(mesh);
    pivot.updateMatrixWorld(true);
    // Direção de repouso: ombro → centro da asa, no espaço local do pivô.
    const restW = center.clone().sub(shoulderW).normalize();
    const restLocal = restW.applyQuaternion(pivot.getWorldQuaternion(new THREE.Quaternion()).invert());
    pivots[side] = { pivot, rest: pivot.quaternion.clone(), dir: restLocal };
  }
  return (side, arms, rootQ) => {
    const p = pivots[side];
    if (!p) return;
    p.pivot.parent.updateWorldMatrix(true, false);
    aimNode(p.pivot, p.rest, p.dir, arms.u, rootQ);
  };
}

// Malha única (gaivota): a asa dobra no shader pela elevação do braço.
function bendDriver(model, spec) {
  const uniforms = { uWingL: { value: 0 }, uWingR: { value: 0 } };
  model.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uWingL = uniforms.uWingL;
        shader.uniforms.uWingR = uniforms.uWingR;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float uWingL;\nuniform float uWingR;")
          .replace("#include <begin_vertex>", `#include <begin_vertex>
            float side = transformed.${spec.bendAxis};
            float ang = side >= 0.0 ? uWingR : -uWingL;
            float k = smoothstep(${spec.bendFrom.toFixed(1)}, ${spec.bendTo.toFixed(1)}, abs(side));
            float c = cos(ang), s = sin(ang);
            float a2 = side * c - transformed.y * s;
            float y2 = side * s + transformed.y * c;
            transformed.${spec.bendAxis} = mix(side, a2, k);
            transformed.y = mix(transformed.y, y2, k);`);
      };
      m.customProgramCacheKey = () => `bend-${spec.id}`;
    }
  });
  return (side, arms) => {
    const elev = Math.asin(clamp(arms.u.y, -1, 1)) - spec.restElev;
    (side === "l" ? uniforms.uWingL : uniforms.uWingR).value = clamp(elev, -1.4, 1.4) * spec.bendSign;
  };
}

/** Braços sintéticos batendo asa (menu e pássaros de enfeite). */
export function syntheticArms(out, time, speed = 5.5, amp = 0.8) {
  const e = Math.sin(time * speed) * amp;
  for (const side of "lr") {
    const s = side === "l" ? -1 : 1;
    const a = out[side];
    a.u.set(s * Math.cos(e), Math.sin(e), 0.15);
    a.f.set(s * Math.cos(e * 1.3), Math.sin(e * 1.3), 0.2);
    a.h.set(s * Math.cos(e * 1.5), Math.sin(e * 1.5), 0.3);
  }
  return out;
}

export function makeArms() {
  const v = () => new THREE.Vector3();
  return { l: { u: v(), f: v(), h: v() }, r: { u: v(), f: v(), h: v() } };
}
