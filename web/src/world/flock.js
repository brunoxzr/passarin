import { BIRDS } from "../config.js";
import { loadBird, makeArms, syntheticArms } from "../bird/bird.js";

// [pássaro, raio extra, altura, escala]
// Só gaivota e udu: são baratos (sem esqueleto), o gavião fica para o jogador.
const SPECS = [
  [1, 40, 78, 1.1],
  [1, -30, 92, 1],
  [1, 110, 84, 0.9],
  [2, 10, 64, 0.7],
];

/** Pássaros de enfeite circulando o vale. */
export async function createFlock(scene, loader) {
  const arms = makeArms();
  const birds = await Promise.all(SPECS.map(async ([i, offset, y, scale], k) => {
    const bird = await loadBird(loader, BIRDS[i]);
    bird.root.scale.setScalar(scale);
    scene.add(bird.root);
    return { bird, radius: 80 + offset, speed: 0.1 + (k % 3) * 0.04, y, phase: k * 1.7, flap: 4 + k * 0.6 };
  }));
  return {
    update(time, dt) {
      for (const b of birds) {
        const a = time * b.speed + b.phase;
        b.bird.root.position.set(Math.cos(a) * b.radius + 80, b.y + Math.sin(a * 2) * 4, Math.sin(a) * b.radius);
        // Tangente ao círculo, inclinado para dentro da curva.
        b.bird.root.rotation.set(0, -a, 0);
        b.bird.root.rotateZ(-0.25);
        // Bate asa em rajadas e plana entre elas.
        const burst = Math.sin(time * 0.5 + b.phase) > 0.2;
        syntheticArms(arms, time + b.phase, b.flap, burst ? 0.7 : 0.08);
        b.bird.setWings(arms, dt);
      }
    },
  };
}
