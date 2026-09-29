const CONTROL = ["KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"];

/**
 * Teclado + mouse como substitutos do corpo, para jogar/testar sem webcam.
 * W/↑ sobe, S/↓ mergulha, A/D ou ←/→ vira, Shift acelera; o mouse move a cabeça.
 */
export function createKeyboard() {
  const keys = new Set();
  const mouse = { x: 0, y: 0 };
  addEventListener("keydown", (e) => keys.add(e.code));
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());
  addEventListener("pointermove", (e) => {
    mouse.x = (e.clientX / innerWidth) * 2 - 1;
    mouse.y = (e.clientY / innerHeight) * 2 - 1;
  });
  const has = (...codes) => codes.some((c) => keys.has(c));

  return {
    active: () => has(...CONTROL),
    arms() {
      const up = has("KeyW", "ArrowUp");
      const down = has("KeyS", "ArrowDown");
      let l = 0.1;
      let r = 0.1;
      // W = braços no alto olhando para cima (nariz sobe); E = batida de asa.
      if (up) { l = 1.05; r = 1.05; }
      if (has("KeyE")) { l = -0.9; r = -0.9; }
      if (has("KeyD", "ArrowRight")) l += 0.7;
      if (has("KeyA", "ArrowLeft")) r += 0.7;
      const sweep = down ? 0.7 : 0;
      const out = { leftUpper: l, leftFore: l, leftSweep: sweep, rightUpper: r, rightFore: r, rightSweep: sweep };
      if (up) out.headPitch = 0.5;
      return out;
    },
    boost: () => has("ShiftLeft", "ShiftRight"),
    head: () => ({ yaw: mouse.x * 1.1, pitch: -mouse.y * 0.6 }),
  };
}
