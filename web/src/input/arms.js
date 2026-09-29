import * as THREE from "three";

// Vetores 3D do braço no espaço do corpo: x = direita, y = cima, z = para trás.
export const ARM_KEYS = [];
for (const side of "lr") for (const seg of "ufh") for (const axis of "xyz") ARM_KEYS.push(side + seg + axis);

function fromAngles(out, side, elev, sweep) {
  const s = side === "l" ? -1 : 1;
  const c = Math.cos(elev);
  const sw = sweep * 0.9;
  return out.set(s * c * Math.cos(sw), Math.sin(elev), -c * Math.sin(sw)).normalize();
}

/**
 * Direções de braço, antebraço e mão para cada lado. Usa os vetores 3D do
 * rastreador quando existem; senão monta a partir dos ângulos (teclado/demo).
 */
export function createArmReader() {
  const arms = {
    l: { u: new THREE.Vector3(), f: new THREE.Vector3(), h: new THREE.Vector3() },
    r: { u: new THREE.Vector3(), f: new THREE.Vector3(), h: new THREE.Vector3() },
  };
  return function read(input) {
    for (const side of "lr") {
      const a = arms[side];
      if (input.use3d) {
        // A profundidade do MediaPipe vem "achatada": amplia o eixo frente/trás.
        for (const seg of "ufh") a[seg].set(input[side + seg + "x"], input[side + seg + "y"], input[side + seg + "z"] * 2).normalize();
      } else {
        const name = side === "l" ? "left" : "right";
        const sweep = input[name + "Sweep"] || 0;
        fromAngles(a.u, side, input[name + "Upper"], sweep);
        fromAngles(a.f, side, input[name + "Fore"] ?? input[name + "Upper"], sweep);
        a.h.copy(a.f);
      }
    }
    return arms;
  };
}
