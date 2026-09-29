/** Batida de asa: os dois braços sobem e depois descem até a linha dos ombros. */
export function createFlapDetector() {
  let armed = 0;
  return {
    reset() { armed = 0; },
    update(input, dt) {
      const low = Math.min(input.leftUpper, input.rightUpper);
      const avg = (input.leftUpper + input.rightUpper) / 2;
      if (low > 0.5) armed = 1.4;
      else armed = Math.max(0, armed - dt);
      if (armed > 0 && low < 0.45 && avg < 0.12) {
        armed = 0;
        return true;
      }
      return false;
    },
    get armed() { return armed > 0; },
  };
}

/** Segurar os dois braços para cima por `seconds`: equivale a apertar o botão. */
export function createHoldDetector(seconds = 1.6) {
  let t = 0;
  let latched = false;
  return {
    reset() { t = 0; latched = true; },
    get progress() { return Math.min(1, t / seconds); },
    update(input, dt, enabled) {
      const up = enabled && Math.min(input.leftUpper, input.rightUpper) > 0.75;
      if (!up) {
        latched = false;
        t = Math.max(0, t - dt * 2);
        return false;
      }
      if (latched) return false;
      t += dt;
      if (t >= seconds) {
        t = 0;
        latched = true;
        return true;
      }
      return false;
    },
  };
}
