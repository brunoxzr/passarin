/**
 * Transmite o canvas do jogo por WebRTC para o óculos VR (página /mobile).
 * A sinalização passa pelo WebSocket do Vite (plugin vr-relay em vite.config.js).
 */
export function createVrStream(canvas) {
  const hot = import.meta.hot;
  if (!hot || !canvas.captureStream) return { setLive() {}, applyLook() {}, sendFrame() {}, info: () => "vr off" };

  const hostId = Math.random().toString(36).slice(2);
  const peers = new Map();
  let stream = null;
  let live = false;

  const getStream = () => (stream ??= canvas.captureStream(30));

  // ---------- aba inteira (HUD, câmera com o desenho do corpo, textos) ----------
  // O canvas só tem a cena 3D. Com permissão, captura a aba toda e manda ela no lugar.
  let tabVideo = null;
  let asked = false;
  async function captureTab() {
    if (asked || !navigator.mediaDevices?.getDisplayMedia) return;
    asked = true;
    try {
      const tab = await navigator.mediaDevices.getDisplayMedia({
        // Limita a captura: a aba em resolução de monitor deixa o encoder lento e derruba os fps do jogo.
        video: { frameRate: { ideal: 30, max: 30 }, width: { ideal: 1280, max: 1280 }, height: { ideal: 720, max: 720 } },
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
    // H.264 primeiro: o Chrome codifica na placa de vídeo (não pesa no jogo) e rende mais qualidade
    // por bit que VP8; o celular decodifica por hardware. Os outros codecs ficam como reserva.
    try {
      const caps = RTCRtpSender.getCapabilities("video")?.codecs ?? [];
      const rank = (c) => (/h264/i.test(c.mimeType) ? 0 : /vp9/i.test(c.mimeType) ? 1 : 2);
      const codecs = [...caps].sort((a, b) => rank(a) - rank(b));
      pc.getTransceivers().find((t) => t.sender === sender)?.setCodecPreferences(codecs);
    } catch { /* sem suporte: codec padrão */ }
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
    adapt(pc, sender);
  }

  // Ajusta bitrate/resolução/fps conforme a rede: o vale tem muito detalhe, mas travar é pior
  // que perder nitidez. Começa em 4 Mbps, sobe se a rede aguenta e desce com perda ou latência.
  const LEVELS = [
    { scale: 1, fps: 30, max: 5_000_000 },
    { scale: 1, fps: 30, max: 3_500_000 },
    { scale: 1, fps: 24, max: 2_500_000 },
    { scale: 1.33, fps: 24, max: 1_800_000 },
    { scale: 1.5, fps: 20, max: 1_200_000 },
  ];
  async function apply(sender, level) {
    try {
      const params = sender.getParameters();
      params.encodings = params.encodings?.length ? params.encodings : [{}];
      const enc = params.encodings[0];
      const l = LEVELS[level];
      enc.maxBitrate = l.max;
      enc.maxFramerate = l.fps;
      enc.scaleResolutionDownBy = l.scale;
      params.degradationPreference = "maintain-framerate";
      await sender.setParameters(params);
    } catch { /* navegador sem suporte: fica no padrão */ }
  }
  function adapt(pc, sender) {
    let level = 0;
    let good = 0;
    apply(sender, level);
    const timer = setInterval(async () => {
      if (pc.connectionState === "closed" || pc.connectionState === "failed") return clearInterval(timer);
      if (pc.connectionState !== "connected") return;
      let loss = 0;
      let rtt = 0;
      let avail = Infinity;
      try {
        (await pc.getStats()).forEach((r) => {
          if (r.type === "remote-inbound-rtp" && r.kind === "video") {
            loss = r.fractionLost ?? 0;
            rtt = (r.roundTripTime ?? 0) * 1000;
          }
          if (r.type === "candidate-pair" && r.nominated && r.availableOutgoingBitrate) avail = r.availableOutgoingBitrate;
        });
      } catch { return; }
      const bad = loss > 0.04 || rtt > 250 || avail < LEVELS[level].max * 0.6;
      const next = bad ? Math.min(level + 1, LEVELS.length - 1)
        : ++good >= 4 && avail > LEVELS[Math.max(level - 1, 0)].max * 0.9 && loss < 0.01 && rtt < 120 ? Math.max(level - 1, 0)
        : level;
      if (bad) good = 0;
      if (next !== level) { level = next; good = 0; apply(sender, level); }
    }, 2000);
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
  let lastDown = 0;
  let jLevel = 1;
  // Resolução alta fica fixa (pixelar é pior que perder fps); cai primeiro a qualidade e os fps.
  const JPEG_LEVELS = [
    { w: 1280, q: 0.8, fps: 30 },
    { w: 1280, q: 0.7, fps: 30 },
    { w: 1280, q: 0.6, fps: 24 },
    { w: 1120, q: 0.55, fps: 24 },
    { w: 960, q: 0.55, fps: 20 },
    { w: 960, q: 0.45, fps: 15 },
  ];
  const small = document.createElement("canvas");
  const ctx2d = small.getContext("2d");
  ctx2d.imageSmoothingQuality = "high";
  // JPEG: codifica várias vezes mais rápido que WebP, e aqui o que importa são os fps.
  const MIME = "image/jpeg";
  function openFrames() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    frameWs = new WebSocket(`${proto}://${location.host}/vr-frames?role=host`);
    frameWs.onmessage = (e) => {
      if (e.data === "d") { // o celular não acompanha: baixa a qualidade
        const now = performance.now();
        if (now - lastDown > 400) { jLevel = Math.min(jLevel + 1, JPEG_LEVELS.length - 1); lastDown = now; }
        return;
      }
      try { frameViewers = JSON.parse(e.data).viewers; } catch { /* ignora */ }
    };
    frameWs.onclose = () => { frameViewers = 0; setTimeout(openFrames, 2000); };
  }
  openFrames();

  hot.send("vr:host", {});
  hot.send("vr:state", { live });

  return {
    /** Chamar logo depois de desenhar o quadro: copia o canvas antes de o WebGL limpá-lo. */
    sendFrame() {
      if (!live || !frameViewers || encoding || frameWs?.readyState !== 1) return;
      const now = performance.now();
      // Fila de envio cheia = rede não dá conta: baixa a qualidade; vazia por um tempo: sobe.
      const backlog = frameWs.bufferedAmount;
      if (backlog > 150_000) {
        if (now - lastDown > 500) { jLevel = Math.min(jLevel + 1, JPEG_LEVELS.length - 1); lastDown = now; }
        return;
      }
      if (now - lastDown > 5000 && jLevel > 0) { jLevel--; lastDown = now; } // 5 s sem queda: sobe
      const { w, q, fps } = JPEG_LEVELS[jLevel];
      if (now - lastFrame < 1000 / fps) return;
      lastFrame = now;
      const src = tabVideo?.videoWidth ? tabVideo : canvas;
      const sw = src.videoWidth || src.width;
      const sh = src.videoHeight || src.height;
      const h = Math.round((w * sh) / sw);
      if (small.width !== w || small.height !== h) { small.width = w; small.height = h; }
      ctx2d.drawImage(src, 0, 0, w, h);
      encoding = true;
      small.toBlob((blob) => {
        encoding = false;
        if (blob && frameWs?.readyState === 1) frameWs.send(blob);
      }, MIME, q);
    },
    /** Resumo para o F3: captura da aba, conexões WebRTC, visores no plano B e nível atual. */
    info: () => `VR aba ${tabVideo ? "sim" : "não"} · rtc ${peers.size} · jpeg ${frameViewers} nv${jLevel}`,
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
