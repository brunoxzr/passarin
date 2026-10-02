// Página do óculos VR: recebe por WebRTC a imagem do jogo que roda no PC.
const hot = import.meta.hot;
const body = document.body;
const left = document.getElementById("left");
const right = document.getElementById("right");
const id = Math.random().toString(36).slice(2);
let pc = null;
let hostId = null;
let retry = 0;

function say(title, sub = "") {
  for (const [t, s] of [["msg", "sub"], ["msg2", "sub2"]]) {
    document.getElementById(t).textContent = title;
    document.getElementById(s).textContent = sub;
  }
}

function setLive(live) {
  body.dataset.live = String(live);
  if (!live) say("aguardando o jogo começar", "inicie a partida no computador");
  if (live) {
    wantCenter = true; // a frente do pássaro = para onde a pessoa olha ao começar
    say("recebendo o vídeo…", "se demorar, toque na tela");
    for (const v of [left, right]) v.play().catch(() => {});
  }
}

function hello() {
  clearTimeout(retry);
  if (body.dataset.src === "jpeg") return; // já está na reserva
  hot.send("vr:viewer", { id });
  // Se nada chegar (PC ainda sem o jogo aberto), tenta de novo.
  retry = setTimeout(() => { if (!pc || pc.connectionState !== "connected") hello(); }, 5000);
}

async function onOffer(msg) {
  if (body.dataset.src === "jpeg") return;
  pc?.close();
  hostId = msg.hostId;
  body.dataset.video = "false";
  const conn = new RTCPeerConnection();
  pc = conn;
  conn.ontrack = (e) => {
    const stream = e.streams[0] ?? new MediaStream([e.track]);
    for (const v of [left, right]) {
      v.srcObject = stream;
      v.play().catch(() => {});
    }
  };
  conn.onicecandidate = (e) => {
    if (e.candidate) hot.send("vr:to-host", { id, hostId: msg.hostId, candidate: e.candidate.toJSON() });
  };
  conn.onconnectionstatechange = () => {
    if (pc !== conn || body.dataset.src === "jpeg") return;
    if (conn.connectionState === "connected") clearTimeout(retry);
    if (conn.connectionState === "failed" || conn.connectionState === "disconnected") {
      say("conexão perdida", "reconectando…");
      body.dataset.video = "false";
      setTimeout(() => { if (pc === conn) hello(); }, 1500);
    }
  };
  await conn.setRemoteDescription(msg.sdp);
  await conn.setLocalDescription(await conn.createAnswer());
  hot.send("vr:to-host", { id, hostId: msg.hostId, sdp: conn.localDescription.toJSON() });
}

left.addEventListener("playing", () => { body.dataset.video = "true"; });

// ---------- reserva: quadros JPEG quando o WebRTC não conecta ----------
let jpegWs = null;
let drawing = false;
const eyesCanvas = [document.getElementById("cl"), document.getElementById("cr")];

function drawFrame(bmp) {
  const flat = body.dataset.mode === "flat";
  for (const c of eyesCanvas) {
    if (c.offsetWidth === 0) continue;
    const dpr = Math.min(devicePixelRatio, 2);
    const W = Math.round(c.offsetWidth * dpr);
    const H = Math.round(c.offsetHeight * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    // VR: preenche o olho (corta as bordas); tela: imagem inteira.
    const s = flat ? Math.min(W / bmp.width, H / bmp.height) : Math.max(W / bmp.width, H / bmp.height);
    const w = bmp.width * s;
    const h = bmp.height * s;
    const g = c.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);
    g.drawImage(bmp, (W - w) / 2, (H - h) / 2, w, h);
  }
}

function startJpeg() {
  if (jpegWs) return;
  body.dataset.src = "jpeg";
  const proto = location.protocol === "https:" ? "wss" : "ws";
  jpegWs = new WebSocket(`${proto}://${location.host}/vr-frames?role=viewer`);
  jpegWs.binaryType = "blob";
  jpegWs.onmessage = async (e) => {
    if (drawing || !(e.data instanceof Blob)) return; // atrasado: pula quadro
    drawing = true;
    try {
      const bmp = await createImageBitmap(e.data);
      drawFrame(bmp);
      bmp.close();
      body.dataset.video = "true";
    } catch { /* quadro ruim */ }
    drawing = false;
  };
  jpegWs.onclose = () => { jpegWs = null; setTimeout(startJpeg, 1500); };
}

// Se o vídeo WebRTC não começar em 3 s com o jogo rodando, troca para a reserva.
let waitStart = 0;
setInterval(() => {
  const waiting = body.dataset.live === "true" && body.dataset.video !== "true";
  if (!waiting) { waitStart = 0; return; }
  waitStart ||= performance.now();
  if (performance.now() - waitStart > 3000) startJpeg();
}, 500);
// Mantém o vídeo rodando o tempo todo (mesmo no menu), para aparecer na hora ao clicar em Jogar.
for (const v of [left, right]) v.addEventListener("pause", () => { if (v.srcObject) v.play().catch(() => {}); });

if (!hot) {
  say("abra pelo servidor do jogo", "rode python run.py no PC");
} else {
  hot.on("vr:state", ({ live }) => setLive(live));
  hot.on("vr:signal", (msg) => {
    if (msg.id !== id) return;
    if (msg.sdp?.type === "offer") onOffer(msg).catch((err) => say("erro na conexão", String(err)));
    else if (msg.candidate && pc && msg.hostId === hostId) pc.addIceCandidate(msg.candidate).catch(() => {});
  });
  // Quando o Vite reconecta (PC reiniciou o servidor), se apresenta de novo.
  hot.on("vite:ws:connect", hello);
  setLive(false);
  say("procurando o jogo no PC…", "abra o jogo no computador");
  hello();
}

// ---------- controles ----------
const bar = document.getElementById("bar");
let barT = 0;
function showBar() {
  bar.classList.remove("hide");
  clearTimeout(barT);
  barT = setTimeout(() => bar.classList.add("hide"), 3000);
}
addEventListener("pointerdown", () => {
  showBar();
  for (const v of [left, right]) if (v.paused && v.srcObject) v.play().catch(() => {});
});
showBar();

document.getElementById("full").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      await screen.orientation?.lock?.("landscape").catch(() => {});
    }
  } catch { /* iOS não tem tela cheia para páginas */ }
  keepAwake();
  askMotion();
});

document.getElementById("mode").addEventListener("click", (e) => {
  body.dataset.mode = body.dataset.mode === "vr" ? "flat" : "vr";
  e.currentTarget.textContent = body.dataset.mode === "vr" ? "Modo: VR" : "Modo: tela";
});

// ---------- olhar ao redor (giroscópio) ----------
// A orientação do celular vira um quaternion da câmera (mesma conta do DeviceOrientationControls
// do three.js). Só o giro horizontal é zerado no "Centralizar": inclinação segue a gravidade.
let baseYaw = null;
let wantCenter = true;
const quat = { x: 0, y: 0, z: 0, w: 1 };

function mul(a, b) {
  return {
    x: a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
    y: a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
    z: a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
const axis = (x, y, z, ang) => ({ x: x * Math.sin(ang / 2), y: y * Math.sin(ang / 2), z: z * Math.sin(ang / 2), w: Math.cos(ang / 2) });

function deviceQuat(alpha, beta, gamma, orient) {
  const d = Math.PI / 180;
  // Euler YXZ (beta em X, alpha em Y, -gamma em Z)
  let q = mul(mul(axis(0, 1, 0, alpha * d), axis(1, 0, 0, beta * d)), axis(0, 0, 1, -gamma * d));
  q = mul(q, { x: -Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }); // câmera olhando pela traseira do celular
  return mul(q, axis(0, 0, 1, -orient * d)); // celular deitado
}

function yawOf(q) {
  // Direção para onde a câmera (-Z) aponta, projetada no chão.
  const fx = -2 * (q.x * q.z + q.w * q.y);
  const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  return Math.atan2(-fx, -fz);
}

addEventListener("deviceorientation", (e) => {
  if (e.alpha == null || !hot) return;
  const orient = screen.orientation?.angle ?? window.orientation ?? 0;
  const q = deviceQuat(e.alpha, e.beta, e.gamma, orient);
  if (wantCenter || baseYaw === null) { baseYaw = yawOf(q); wantCenter = false; }
  const r = mul(axis(0, 1, 0, -baseYaw), q);
  Object.assign(quat, r);
  hot.send("vr:look", { q: [r.x, r.y, r.z, r.w] });
});

async function askMotion() {
  // iOS pede permissão num toque; Android libera direto em https.
  try { await DeviceOrientationEvent?.requestPermission?.(); } catch { /* recusado */ }
}

document.getElementById("center").addEventListener("click", () => { wantCenter = true; askMotion(); });
// Em http o Chrome não manda o giroscópio: avisa como liberar (flag do Chrome).
let gyroOk = false;
addEventListener("deviceorientation", (e) => { if (e.alpha != null) gyroOk = true; }, { once: false });
setTimeout(() => {
  if (gyroOk) return;
  const tip = document.createElement("p");
  tip.className = "s";
  tip.style.cssText = "position:fixed;top:8px;left:0;right:0;text-align:center;padding:0 16px;z-index:2";
  tip.textContent = `Para olhar ao redor: no Chrome abra chrome://flags/#unsafely-treat-insecure-origin-as-secure, coloque ${location.origin}, ative (Enabled) e reinicie o Chrome.`;
  document.body.append(tip);
  setTimeout(() => tip.remove(), 20000);
}, 2500);

// Não deixa a tela do celular apagar no meio do voo (só funciona em contexto seguro).
let lock = null;
async function keepAwake() {
  try { lock = await navigator.wakeLock?.request("screen"); } catch { /* sem suporte */ }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && lock) keepAwake(); });
