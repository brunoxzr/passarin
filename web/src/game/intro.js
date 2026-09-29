import { clamp, easeInOut, smoothstep } from "../util/math.js";
import { createFlapDetector } from "../input/gestures.js";

// Abertura dos olhos ao acordar: [segundos, abertura 0..1].
const WAKE = [
  [0, 0], [1.1, 0.3], [1.7, 0.24], [2.2, 0], [2.9, 0],
  [3.9, 0.6], [4.5, 0.52], [4.85, 0], [5.2, 0], [6.6, 1],
];
const SLEEP_TIME = 2.2;
const WAKE_TIME = WAKE[WAKE.length - 1][0];
const TRANSITION = 3.8;
const TYPE_SPEED = 0.06;

function eyelid(t) {
  for (let i = 1; i < WAKE.length; i++) {
    const [t1, v1] = WAKE[i];
    if (t <= t1) {
      const [t0, v0] = WAKE[i - 1];
      return v0 + (v1 - v0) * smoothstep((t - t0) / (t1 - t0));
    }
  }
  return 1;
}

/**
 * Abertura em primeira pessoa. Fases:
 * sleep → wake (piscadas) → prompt (texto, espera a batida de asa) → takeoff → done.
 * `blend` diz à câmera quanto já saiu da cabeça do pássaro.
 */
export function createIntro() {
  const lids = document.getElementById("lids");
  const canvas = document.getElementById("view");
  const line = document.getElementById("intro-line");
  const hint = document.getElementById("intro-hint");
  const bar = document.getElementById("intro-bar");
  const fill = document.getElementById("intro-fill");
  const flap = createFlapDetector();

  const s = { phase: "off", t: 0, speed: 1, open: 0, text: "", typed: 0, typeT: 0, resume: false, force: false };

  function setPhase(p) {
    s.phase = p;
    s.t = 0;
    document.body.dataset.intro = p;
  }

  function say(text, sub = "") {
    if (hint.textContent !== sub) hint.textContent = sub;
    if (s.text === text) return;
    s.text = text;
    s.typed = 0;
    s.typeT = 0;
    line.textContent = "";
  }

  function type(dt) {
    if (s.typed >= s.text.length) return;
    s.typeT += dt;
    const n = Math.min(s.text.length, Math.floor(s.typeT / TYPE_SPEED));
    if (n !== s.typed) {
      s.typed = n;
      line.textContent = s.text.slice(0, n);
    }
  }

  function setLids(open, blur) {
    s.open = open;
    lids.style.setProperty("--open", open.toFixed(3));
    canvas.style.filter = blur > 0.05 ? `blur(${blur.toFixed(1)}px)` : "";
  }

  return {
    get phase() { return s.phase; },
    get open() { return s.open; },
    get active() { return s.phase !== "off" && s.phase !== "done"; },
    /** 0 = olhos do pássaro, 1 = terceira pessoa. */
    get blend() {
      if (s.phase === "takeoff") return easeInOut(s.t / TRANSITION);
      if (s.phase === "done" || s.phase === "off" || s.resume) return 1;
      return 0;
    },
    /** Abertura completa. `quick` encurta o sono ao tentar de novo. */
    start(quick = false) {
      s.speed = quick ? 1.8 : 1;
      s.resume = false;
      s.force = false;
      s.text = "";
      line.textContent = "";
      hint.textContent = "";
      flap.reset();
      setLids(0, 10);
      setPhase("sleep");
    },
    /** Depois de pausar/recalibrar no ar: só o texto, sem primeira pessoa. */
    startResume() {
      s.resume = true;
      s.force = false;
      s.text = "";
      flap.reset();
      setLids(1, 0);
      setPhase("prompt");
    },
    stop() {
      setLids(1, 0);
      setPhase("off");
    },
    /** Espaço/clique: pula a abertura ou força a decolagem. */
    skip() {
      if (s.phase === "sleep" || s.phase === "wake") setPhase("prompt");
      else if (s.phase === "prompt") s.force = true;
    },
    /** Devolve "takeoff" | "resume" | "done" | null. */
    update(dt, input, pose) {
      s.t += dt * (s.phase === "sleep" || s.phase === "wake" ? s.speed : 1);
      let event = null;
      switch (s.phase) {
        case "sleep":
          setLids(0, 10);
          if (s.t > SLEEP_TIME) setPhase("wake");
          break;
        case "wake": {
          const open = eyelid(s.t);
          setLids(open, Math.max(0, 9 * (1 - s.t / WAKE_TIME)) + (1 - open) * 3);
          if (s.t > WAKE_TIME) setPhase("prompt");
          break;
        }
        case "prompt": {
          setLids(1, 0);
          const offline = !pose.connected;
          const ready = offline || pose.calibrated;
          bar.hidden = ready;
          fill.style.width = `${Math.round(pose.stable * 100)}%`;
          if (!ready) {
            say(
              "Abra as asas.",
              pose.tracking
                ? "Braços abertos na altura dos ombros, tronco reto. Segure um instante."
                : "Afaste-se até a câmera ver seus ombros, cotovelos e quadril.",
            );
          } else if (offline) {
            say("Levante voo.", "Sem webcam: mouse olha ao redor · Espaço decola · WASD voa");
          } else {
            say("Levante voo.", "Suba os dois braços e desça de uma vez, como uma batida de asa.");
          }
          type(dt);
          const flapped = ready && pose.tracking && flap.update(input, dt);
          if (flapped || s.force) {
            event = s.resume ? "resume" : "takeoff";
            say("", "");
            line.textContent = "";
            bar.hidden = true;
            setPhase(s.resume ? "done" : "takeoff");
          }
          break;
        }
        case "takeoff":
          if (s.t > TRANSITION) {
            setPhase("done");
            event = "done";
          }
          break;
      }
      return event;
    },
    /** Olhar da cabeça durante a primeira pessoa (acordando = cabeça baixa). */
    headPitchOffset() {
      return -0.32 * (1 - s.open) - 0.05;
    },
  };
}

export const clampHead = (input) => ({
  yaw: clamp(input.headYaw || 0, -1.3, 1.3),
  pitch: clamp(input.headPitch || 0, -0.75, 0.75),
});
