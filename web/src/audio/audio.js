/**
 * Sons sintetizados (sem arquivos): vento contínuo, anel, decolagem, batida,
 * clique de menu. O navegador só libera áudio depois de um gesto do usuário.
 */
export function createAudio() {
  let ctx = null;
  let master = null;
  let wind = null;
  let noise = null;

  function context() {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      noise = makeNoise(ctx);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // Só cria o áudio depois de um gesto real (senão o Chrome reclama no console).
  const unlock = () => {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    context();
  };
  addEventListener("pointerdown", unlock);
  addEventListener("keydown", unlock);

  function burst({ duration, from, to, q = 1, gain = 0.2, type = "bandpass" }) {
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    const t = ctx.currentTime;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + duration * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(g).connect(master);
    src.start();
    src.stop(t + duration + 0.05);
  }

  function tone(freq, end, duration, gain, type = "sine", delay = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(end, t + duration * 0.3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + duration + 0.05);
  }

  return {
    ring(streak = 0) {
      const base = 660 * Math.pow(1.06, Math.min(streak, 12));
      tone(base, base * 1.5, 0.45, 0.07);
      tone(base * 1.5, base * 2, 0.5, 0.04, "sine", 0.07);
    },
    takeoff() { burst({ duration: 1.3, from: 300, to: 1600, q: 0.8, gain: 0.25 }); },
    flap() { burst({ duration: 0.35, from: 900, to: 250, q: 0.7, gain: 0.18 }); },
    crash() {
      burst({ duration: 0.9, from: 1800, to: 80, q: 0.5, gain: 0.55, type: "lowpass" });
      tone(110, 38, 0.8, 0.35, "triangle");
    },
    click() { tone(1400, 1100, 0.08, 0.035, "triangle"); },
    finish() {
      [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.9, 0.06, "sine", i * 0.12));
    },
    /** Vento contínuo, `level` 0..1 conforme a velocidade. */
    wind(level) {
      if (!ctx) return;
      if (!wind) {
        const src = ctx.createBufferSource();
        src.buffer = noise;
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.Q.value = 0.6;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(filter).connect(g).connect(master);
        src.start();
        wind = { filter, gain: g };
      }
      const t = ctx.currentTime;
      wind.gain.gain.setTargetAtTime(0.02 + level * 0.16, t, 0.2);
      wind.filter.frequency.setTargetAtTime(350 + level * 900, t, 0.3);
    },
  };
}

function makeNoise(ctx) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    // Ruído "marrom": mais grave e macio que o branco.
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
  return buffer;
}
