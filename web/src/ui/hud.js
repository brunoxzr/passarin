import * as THREE from "three";

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

/** Placar, cronômetro, marcador do próximo anel e status do rastreador. */
export function createHud() {
  const el = (id) => document.getElementById(id);
  const rings = el("hud-rings");
  const total = el("hud-total");
  const time = el("hud-time");
  const speed = el("hud-speed");
  const hint = el("hud-hint");
  const marker = el("marker");
  const markerDist = el("marker-dist");
  const pip = el("pip");
  const preview = el("preview");
  const dot = el("tracker-dot");
  const label = el("tracker-label");
  const v = new THREE.Vector3();
  let lastPreview = null;
  const last = {};

  const set = (node, key, value) => {
    if (last[key] === value) return;
    last[key] = value;
    node.textContent = value;
  };

  return {
    update({ collected, count, elapsed, kmh, pose, next, camera, showMarker, hintText }) {
      set(rings, "rings", String(collected).padStart(2, "0"));
      set(total, "total", String(count).padStart(2, "0"));
      set(time, "time", formatTime(elapsed));
      set(speed, "speed", String(Math.round(kmh)));
      set(hint, "hint", hintText);

      if (pose.preview && pose.preview !== lastPreview) {
        lastPreview = pose.preview;
        preview.src = pose.preview;
        pip.classList.add("has-preview");
      }
      const status = !pose.connected ? "off" : pose.demo ? "demo" : pose.tracking ? "on" : "lost";
      if (last.status !== status) {
        last.status = status;
        dot.dataset.state = status;
        label.textContent = {
          off: "sem rastreador · teclado",
          demo: "modo demonstração",
          on: "corpo rastreado",
          lost: "não vejo seu corpo",
        }[status];
      }

      if (!showMarker || !next) {
        marker.hidden = true;
        return;
      }
      marker.hidden = false;
      v.copy(next).project(camera);
      const behind = v.z > 1;
      let x = behind ? -v.x : v.x;
      let y = behind ? -v.y : v.y;
      const onScreen = !behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.88;
      if (!onScreen) {
        const k = 0.9 / Math.max(Math.abs(x), Math.abs(y), 0.001);
        x *= k;
        y *= k;
      }
      marker.classList.toggle("edge", !onScreen);
      marker.style.transform = `translate(${((x + 1) / 2) * innerWidth}px, ${((1 - y) / 2) * innerHeight}px)`;
      marker.style.setProperty("--angle", `${Math.atan2(-y, x)}rad`);
      set(markerDist, "dist", `${Math.round(camera.position.distanceTo(next))} m`);
    },
  };
}
