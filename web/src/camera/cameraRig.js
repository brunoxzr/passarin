import * as THREE from "three";
import { groundAt, WATER } from "../world/terrain.js";
import { clamp, damp, lerp } from "../util/math.js";

const FP_FOV = 74;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Câmera do jogo. `blend` vai de 0 (olhos do pássaro) a 1 (terceira pessoa).
 * No modo "showcase" (menu) ela circula o pássaro em plano cinematográfico.
 */
export function createCameraRig(camera) {
  const tpPos = new THREE.Vector3();
  const tpLook = new THREE.Vector3();
  const tpUp = new THREE.Vector3();
  const fpLook = new THREE.Vector3();
  const look = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const up = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const camQ = new THREE.Quaternion();
  let ready = false;
  let tpFov = 52;
  let shake = 0;

  // Terceira pessoa presa à orientação do pássaro (com atraso): em looping e
  // de cabeça para baixo a câmera gira junto.
  function thirdPerson(dt, f, focus, airborne, crashed) {
    if (!ready) {
      camQ.copy(f.q);
      ready = true;
    }
    if (crashed) {
      // Câmera se afasta e olha o pássaro caído, com o horizonte reto.
      desired.copy(focus).addScaledVector(fwd.set(0, 0, 1).applyQuaternion(camQ).setY(0).normalize(), -9);
      desired.y += 4;
      tpPos.lerp(desired, 1 - Math.exp(-1.2 * dt));
      tpLook.lerp(focus, 1 - Math.exp(-6 * dt));
      tpUp.lerp(UP, 1 - Math.exp(-3 * dt));
    } else {
      // Segue a rotação do pássaro de perto: no parafuso a câmera gira junto.
      camQ.slerp(f.q, 1 - Math.exp(-(airborne ? 7 : 6) * dt));
      fwd.set(0, 0, 1).applyQuaternion(camQ);
      up.set(0, 1, 0).applyQuaternion(camQ);
      const back = airborne ? 3 + clamp(f.speed / 40, 0, 1) * 1.2 : 4.2;
      const height = airborne ? 0.9 : 1.45;
      desired.copy(focus).addScaledVector(fwd, -back).addScaledVector(up, height);
      tpPos.copy(desired);
      tmp.copy(focus).addScaledVector(fwd, 2).addScaledVector(up, 0.35);
      tpLook.copy(tmp);
      tpUp.copy(up);
    }
    const floor = Math.max(groundAt(tpPos.x, tpPos.z, tpPos.y), WATER) + 1.2;
    if (tpPos.y < floor) tpPos.y = floor;
    const dive = airborne ? clamp(f.pitch, 0, 1) * clamp(f.speed / 48, 0, 1) : 0;
    tpFov = damp(tpFov, (airborne ? 50 : 52) + dive * 8 + clamp((f.speed - 14) / 40, 0, 1) * 12, 2, dt);
  }

  return {
    shake(amount) { shake = Math.max(shake, amount); },
    reset() { ready = false; },
    /**
     * ctx: { flight, focus, airborne, crashed, eye, lookYaw, lookPitch, blend }
     */
    update(dt, ctx) {
      thirdPerson(dt, ctx.flight, ctx.focus, ctx.airborne, ctx.crashed);
      const e = ctx.blend;
      const cp = Math.cos(ctx.lookPitch);
      fpLook.set(Math.sin(ctx.lookYaw) * cp, Math.sin(ctx.lookPitch), Math.cos(ctx.lookYaw) * cp).multiplyScalar(10).add(ctx.eye);
      camera.position.lerpVectors(ctx.eye, tpPos, e);
      camera.position.y += Math.sin(Math.PI * e) * 1.6; // arco ao sair da cabeça
      look.lerpVectors(fpLook, tpLook, e);
      camera.fov = lerp(FP_FOV, tpFov, e);
      camera.up.lerpVectors(UP, tpUp, e).normalize();
      if (shake > 0.001) {
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake;
        shake = damp(shake, 0, 5, dt);
      }
      camera.updateProjectionMatrix();
      camera.lookAt(look);
    },
    /** Plano do menu: órbita lenta ao redor do pássaro. */
    showcase(time, focus, yaw) {
      const a = yaw + Math.PI * 0.75 + Math.sin(time * 0.15) * 0.5;
      camera.position.set(focus.x + Math.sin(a) * 9, focus.y + 2.2 + Math.sin(time * 0.3) * 0.8, focus.z + Math.cos(a) * 9);
      camera.up.copy(UP);
      camera.fov = 40;
      camera.updateProjectionMatrix();
      // O pássaro fica no terço direito da tela, o menu ocupa a esquerda.
      look.copy(focus);
      tmp.set(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(-3.2);
      look.add(tmp);
      camera.lookAt(look);
      ready = false;
    },
  };
}
