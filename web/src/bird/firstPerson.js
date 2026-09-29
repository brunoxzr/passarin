import * as THREE from "three";

const UPPER = 0.5; // ombro → cotovelo
const FORE = 0.55; // cotovelo → punho
const HAND = 0.5; // punho → ponta das primárias

// Pena unitária apontando para +Z (para trás da asa), largura 1 em X.
function featherGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.3, 0);
  s.bezierCurveTo(-0.62, 0.35, -0.42, 0.85, -0.05, 1);
  s.bezierCurveTo(0.2, 1.02, 0.52, 0.7, 0.3, 0);
  s.lineTo(-0.3, 0);
  const g = new THREE.ShapeGeometry(s, 8);
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.PI);
  return g;
}

const X = new THREE.Vector3(1, 0, 0);
const BACK = new THREE.Vector3(0, 0, 1);
const DOWN = new THREE.Vector3(0, -1, 0);
const m4 = new THREE.Matrix4();
const bx = new THREE.Vector3();
const by = new THREE.Vector3();
const bz = new THREE.Vector3();

/** Rotação que aponta o eixo X na direção `dir`, com as penas (+Z) o mais para trás possível. */
function aim(out, dir) {
  bx.copy(dir).normalize();
  bz.copy(BACK).addScaledVector(bx, -BACK.dot(bx));
  if (bz.lengthSq() < 0.04) bz.copy(DOWN).addScaledVector(bx, -DOWN.dot(bx));
  bz.normalize();
  by.crossVectors(bz, bx);
  return out.setFromRotationMatrix(m4.makeBasis(bx, by, bz));
}

/**
 * Asas vistas de dentro do pássaro. Presas ao corpo (não à cabeça), com
 * ombro, cotovelo e punho seguindo a direção 3D real do braço do jogador.
 */
export function createWingRig() {
  const feather = featherGeometry();
  const mats = {
    cover: new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }),
    flight: new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }),
    tip: new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }),
    beak: new THREE.MeshLambertMaterial({}),
  };

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.rotation.y = Math.PI; // dentro do rig: frente = -Z, direita = +X
  root.add(body);

  const addFeather = (parent, mat, x, len, width, angle, y) => {
    const m = new THREE.Mesh(feather, mat);
    m.position.set(x, y, 0);
    m.scale.set(width, 1, len);
    m.rotation.y = angle;
    parent.add(m);
  };
  const limb = (radius, length, mat) => {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), mat);
    m.rotation.z = Math.PI / 2;
    m.position.x = length / 2;
    m.scale.set(1, 1, 0.7);
    return m;
  };

  function buildWing() {
    const shoulder = new THREE.Group();
    shoulder.add(limb(0.03, UPPER, mats.cover));
    for (let i = 0; i < 7; i++) addFeather(shoulder, mats.cover, 0.02 + (i / 6.5) * UPPER, 0.24, 0.2, 0.05, 0.02);
    for (let i = 0; i < 7; i++) addFeather(shoulder, mats.flight, 0.03 + (i / 6.5) * UPPER, 0.46, 0.17, 0.03 + i * 0.015, 0);

    const elbow = new THREE.Group();
    elbow.position.x = UPPER;
    shoulder.add(elbow);
    elbow.add(limb(0.025, FORE, mats.cover));
    for (let i = 0; i < 7; i++) addFeather(elbow, mats.cover, 0.02 + (i / 6.5) * FORE, 0.2, 0.18, 0.08, 0.02);
    for (let i = 0; i < 8; i++) addFeather(elbow, mats.flight, 0.02 + (i / 7.5) * FORE, 0.5, 0.16, 0.08 + i * 0.03, 0);

    const wrist = new THREE.Group();
    wrist.position.x = FORE;
    elbow.add(wrist);
    wrist.add(limb(0.02, HAND * 0.45, mats.cover));
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      addFeather(wrist, t > 0.35 ? mats.tip : mats.flight, t * HAND * 0.5, 0.5 + t * 0.35, 0.14, 0.3 + t * 1.25, -0.005 * t);
    }
    return { shoulder, elbow, wrist };
  }

  const wings = {};
  const mirror = new THREE.Group();
  mirror.scale.x = -1;
  body.add(mirror);
  for (const side of "lr") {
    const w = buildWing();
    w.shoulder.position.set(0.26, -0.42, 0.02);
    (side === "r" ? body : mirror).add(w.shoulder);
    wings[side] = w;
  }

  // Bico: preso à cabeça (câmera), entra por baixo da visão.
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.8, 10), mats.beak);
  beak.geometry.rotateX(-Math.PI / 2);
  beak.position.set(0, -0.36, -0.7);
  beak.rotation.x = -0.2;

  const qU = new THREE.Quaternion();
  const qF = new THREE.Quaternion();
  const qH = new THREE.Quaternion();
  const inv = new THREE.Quaternion();
  const d = new THREE.Vector3();
  const mirrored = (v, side) => d.set(side === "l" ? -v.x : v.x, v.y, v.z);

  function poseWing(w, a, side) {
    aim(qU, mirrored(a.u, side));
    aim(qF, mirrored(a.f, side));
    aim(qH, mirrored(a.h, side));
    w.shoulder.quaternion.copy(qU);
    w.elbow.quaternion.copy(inv.copy(qU).invert().multiply(qF));
    w.wrist.quaternion.copy(inv.copy(qF).invert().multiply(qH));
  }

  return {
    root,
    beak,
    setColors({ cover, flight, tip, beak: beakColor }) {
      mats.cover.color.setHex(cover);
      mats.flight.color.setHex(flight);
      mats.tip.color.setHex(tip ?? flight);
      mats.beak.color.setHex(beakColor);
    },
    setVisible(v) {
      root.visible = v;
      beak.visible = v;
    },
    /** arms: saída de createArmReader() — vetores no espaço do corpo. */
    update(eye, yaw, arms) {
      root.position.copy(eye);
      root.rotation.set(0, yaw, 0);
      poseWing(wings.r, arms.r, "r");
      poseWing(wings.l, arms.l, "l");
    },
  };
}
