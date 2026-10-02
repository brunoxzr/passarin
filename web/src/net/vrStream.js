/**
 * Transmite o canvas do jogo por WebRTC para o óculos VR (página /mobile).
 * A sinalização passa pelo WebSocket do Vite (plugin vr-relay em vite.config.js).
 */
export function createVrStream(canvas) {
  const hot = import.meta.hot;
  if (!hot || !canvas.captureStream) return { setLive() {}, applyLook() {}, sendFrame() {} };

  const hostId = Math.random().toString(36).slice(2);
  const peers = new Map();
  let stream = null;
  let live = false;

  const getStream = () => (stream ??= canvas.captureStream(60));

  // ---------- aba inteira (HUD, câmera com o desenho do corpo, textos) ----------
  // O canvas só tem a cena 3D. Com permissão, captura a aba toda e manda ela no lugar.
  let tabVideo = null;
  let asked = false;
  async function captureTab() {
    if (asked || !navigator.mediaDevices?.getDisplayMedia) return;
    asked = true;
    try {
      const tab = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "exclude",
      });
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.srcObject = tab;
      await v.play();
      tabVideo = v;
      stream = tab;
      const track = tab.getVideoTracks()[0];
      track.contentHint = "motion";
      track.addEventListener("ended", () => { tabVideo = null; stream = null; asked = false; });
      for (const pc of peers.values()) for (const s of pc.getSenders()) s.replaceTrack(track).catch(() => {});
    } catch {
      asked = false; // recusou: tenta de novo no próximo clique, segue só com o 3D
    }
  }
  const ask = () => captureTab();
  addEventListener("pointerdown", ask);
  addEventListener("keydown", ask);

  async function connect(id) {
    peers.get(id)?.close();
    const pc = new RTCPeerConnection();
    peers.set(id, pc);
    const track = getStream().getVideoTracks()[0];
    track.contentHint = "motion";
    const sender = pc.addTrack(track, getStream());
    pc.onicecandidate = (e) => {
      if (e.candidate) hot.send("vr:to-viewer", { id, hostId, candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(pc.connectionState)) {
        pc.close();
        if (peers.get(id) === pc) peers.delete(id);
      }
    };
    await pc.setLocalDescription(await pc.createOffer());
    hot.send("vr:to-viewer", { id, hostId, sdp: pc.localDescription.toJSON() });
    // Mais bitrate que o padrão: o vale tem muito detalhe e o óculos amplia a imagem.
    try {
      const params = sender.getParameters();
      params.encodings = params.encodings?.length ? params.encodings : [{}];
      params.encodings[0].maxBitrate = 8_000_000;
      params.encodings[0].maxFramerate = 60;
      await sender.setParameters(params);
    } catch { /* navegador sem suporte: fica no padrão */ }
  }

  hot.on("vr:join", ({ id }) => connect(id).catch((err) => console.warn("VR: falha ao conectar", err)));
  hot.on("vr:signal", async (msg) => {
    if (msg.hostId !== hostId) return;
    const pc = peers.get(msg.id);
    if (!pc) return;
    try {
      if (msg.sdp) await pc.setRemoteDescription(msg.sdp);
      else if (msg.candidate) await pc.addIceCandidate(msg.candidate);
    } catch (err) {
      console.warn("VR: sinalização", err);
    }
  });
  // Cabeça de quem está com o óculos (giroscópio do celular), relativa à frente do pássaro.
  const look = { x: 0, y: 0, z: 0, w: 1 };
  let lookAt = 0;
  hot.on("vr:look", ({ q }) => {
    [look.x, look.y, look.z, look.w] = q;
    lookAt = performance.now();
  });

  // ---------- reserva: quadros JPEG pela mesma porta do jogo ----------
  let frameWs = null;
  let frameViewers = 0;
  let encoding = false;
  let lastFrame = 0;
  const small = document.createElement("canvas");
  const ctx2d = small.getContext("2d");
  function openFrames() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    frameWs = new WebSocket(`${proto}://${location.host}/vr-frames?role=host`);
    frameWs.onmessage = (e) => { try { frameViewers = JSON.parse(e.data).viewers; } catch { /* ignora */ } };
    frameWs.onclose = () => { frameViewers = 0; setTimeout(openFrames, 2000); };
  }
  openFrames();

  hot.send("vr:host", {});
  hot.send("vr:state", { live });

  return {
    /** Chamar logo depois de desenhar o quadro: copia o canvas antes de o WebGL limpá-lo. */
    sendFrame() {
      if (!live || !frameViewers || encoding || frameWs?.readyState !== 1 || frameWs.bufferedAmount > 500_000) return;
      const now = performance.now();
      if (now - lastFrame < 1000 / 30) return;
      lastFrame = now;
      const src = tabVideo?.videoWidth ? tabVideo : canvas;
      const sw = src.videoWidth || src.width;
      const sh = src.videoHeight || src.height;
      const w = 1280;
      const h = Math.round((w * sh) / sw);
      if (small.width !== w || small.height !== h) { small.width = w; small.height = h; }
      ctx2d.drawImage(src, 0, 0, w, h);
      encoding = true;
      small.toBlob((blob) => {
        encoding = false;
        if (blob && frameWs?.readyState === 1) frameWs.send(blob);
      }, "image/jpeg", 0.72);
    },
    /** Gira a câmera para onde a cabeça olha (só com partida rolando e óculos enviando). */
    applyLook(camera) {
      if (!live || performance.now() - lookAt > 1000) return;
      camera.quaternion.multiply(look);
    },
    /** true enquanto uma partida está rolando: o óculos só mostra o jogo nesse estado. */
    setLive(on) {
      if (on === live) return;
      live = on;
      hot.send("vr:state", { live });
    },
  };
}
