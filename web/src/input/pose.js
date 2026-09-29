import { WS_URL } from "../config.js";
import { ARM_KEYS } from "./arms.js";

const ARMS = ["leftUpper", "leftFore", "leftSweep", "rightUpper", "rightFore", "rightSweep"];

/**
 * Recebe a postura do rastreador Python via WebSocket e suaviza no cliente.
 * Sem rastreador, usa o teclado/mouse (`fallback`).
 */
export function createPose(fallback) {
  const s = {
    connected: false, tracking: false, calibrated: false, demo: false,
    stable: 0, message: "Conectando ao rastreador…", preview: null,
    leftUpper: 0.1, leftFore: 0.1, leftSweep: 0, rightUpper: 0.1, rightFore: 0.1, rightSweep: 0,
    span: 0.75, pitch: 0, roll: 0, headYaw: 0, headPitch: 0, shake: 0,
  };
  const target = { ...s };
  let prevRaise = 0;
  let ws;

  const connect = () => {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => { s.connected = true; };
    ws.onclose = () => { s.connected = false; s.tracking = false; setTimeout(connect, 1500); };
    ws.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return; // mensagem quebrada: ignora e espera a próxima
      }
      for (const k in m) if (typeof m[k] === "number" && !Number.isFinite(m[k])) m[k] = 0;
      s.calibrated = !!m.calibrated;
      s.tracking = !!m.tracking;
      s.demo = !!m.demo;
      s.stable = m.stable ?? 0;
      s.message = m.message || "";
      if (m.preview) s.preview = m.preview;
      if (m.tracking) {
        for (const k of ARMS) target[k] = m[k] || 0;
        target.span = m.span;
        target.pitch = m.pitch;
        target.roll = m.roll;
        target.headYaw = m.headYaw || 0;
        target.headPitch = m.headPitch || 0;
        if (m.lux !== undefined) {
          for (const k of ARM_KEYS) target[k] = m[k];
          if (!s.has3d) for (const k of ARM_KEYS) s[k] = m[k];
          s.has3d = true;
        }
      }
    };
  };
  connect();

  return {
    send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); },
    tick(dt) {
      const manual = !s.connected || fallback.active() || s.demo;
      if (!s.connected || fallback.active()) Object.assign(target, fallback.arms());
      s.use3d = s.has3d && !manual;
      if (s.use3d) for (const key of ARM_KEYS) s[key] += (target[key] - s[key]) * (1 - Math.exp(-20 * dt));
      if (!s.connected) {
        const h = fallback.head();
        target.headYaw = h.yaw;
        target.headPitch = h.pitch;
        target.pitch = 0;
        target.roll = 0;
      }
      const k = 1 - Math.exp(-18 * dt);
      const kb = 1 - Math.exp(-10 * dt);
      for (const key of ARMS) s[key] += (target[key] - s[key]) * k;
      s.span += (target.span - s.span) * k;
      s.pitch += (target.pitch - s.pitch) * kb;
      s.roll += (target.roll - s.roll) * kb;
      s.headYaw += (target.headYaw - s.headYaw) * kb;
      s.headPitch += (target.headPitch - s.headPitch) * kb;
      // Movimento brusco dos braços = impulso de velocidade.
      const raiseNow = (s.leftUpper + s.rightUpper + s.leftFore + s.rightFore) * 0.25;
      const delta = (raiseNow - prevRaise) / Math.max(dt, 0.001);
      prevRaise = raiseNow;
      const burst = fallback.boost() ? 1.2 : Math.max(0, Math.abs(delta) - 0.85);
      s.shake += (burst - s.shake) * (1 - Math.exp(-10 * dt));
    },
    sample: () => s,
    get state() { return s; },
  };
}
