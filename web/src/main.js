import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { BIRDS, CREDITS } from "./config.js";
import { WATER, findStart, fbm, riverZ, groundAt } from "./world/terrain.js";
import { createEnvironment } from "./world/environment.js";
import { loadTemplates, scatter, decorateIslands } from "./world/props.js";
import { createRings } from "./world/rings.js";
import { createFlock } from "./world/flock.js";
import { loadBird, makeArms, syntheticArms } from "./bird/bird.js";
import { createArmReader } from "./input/arms.js";
import { createFlight, placeOnGround, stepFlight, takeOff, hover, resume, isAirborne, syncQuat } from "./bird/flight.js";
import { createWingRig } from "./bird/firstPerson.js";
import { createCameraRig } from "./camera/cameraRig.js";
import { createIntro, clampHead } from "./game/intro.js";
import { createPose } from "./input/pose.js";
import { createKeyboard } from "./input/keyboard.js";
import { createHoldDetector } from "./input/gestures.js";
import { createAudio } from "./audio/audio.js";
import { createHud, formatTime } from "./ui/hud.js";
import { createList, renderStats } from "./ui/screens.js";
import { createPost } from "./render/post.js";
import { createWind } from "./render/wind.js";
import { clamp, damp } from "./util/math.js";
import { createVrStream } from "./net/vrStream.js";

THREE.Cache.enabled = true;

const TREES = ["tree_oak.glb", "tree_default.glb", "tree_detailed.glb", "tree_fat.glb", "tree_small.glb", "tree_pineTallA.glb", "tree_pineRoundC.glb"];
const PALMS = ["tree_palmTall.glb"];
const ROCKS = ["rock_largeA.glb", "rock_largeB.glb", "rock_tallA.glb", "rock_smallA.glb", "rock_tallE.glb", "cliff_large_rock.glb", "cliff_rock.glb"];
const PLANTS = ["plant_bush.glb", "plant_bushLarge.glb", "grass_large.glb", "flower_yellowA.glb", "flower_redA.glb", "flower_purpleA.glb"];
const EYE_UP = 0.5;
const EYE_FORWARD = 0.9;

// ---------- estado salvo ----------
const saved = (() => {
  try { return JSON.parse(localStorage.getItem("adepassaro") || "{}"); } catch { return {}; }
})();
const settings = { bird: saved.bird ?? 0, quality: saved.quality ?? false, invert: false, swap: false, best: saved.best ?? {} };
const save = () => {
  try { localStorage.setItem("adepassaro", JSON.stringify({ bird: settings.bird, quality: settings.quality, best: settings.best })); } catch { /* sem armazenamento */ }
};

// ---------- render ----------
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("view"), antialias: true, powerPreference: "high-performance" });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.15, 4000);
scene.add(camera);
const post = createPost(renderer, scene, camera);
post.setQuality(settings.quality);

const env = createEnvironment(scene);
const loader = new GLTFLoader();
const keyboard = createKeyboard();
const pose = createPose(keyboard);
const audio = createAudio();
const hud = createHud();
const intro = createIntro();
const camRig = createCameraRig(camera);
const wind = createWind(camera);
const wings = createWingRig();
scene.add(wings.root);
camera.add(wings.beak);
const flight = createFlight();
const start = findStart();
const obstacles = [];
const menuHold = createHoldDetector(2);
const deathHold = createHoldDetector(1.6);
const vr = createVrStream(renderer.domElement);

let bird = null;
let rings = null;
let flock = null;
let screen = "loading";
let elapsed = 0;
let deadT = 0;
let streak = 0;
const eye = new THREE.Vector3();

function setScreen(s) {
  screen = s;
  document.body.dataset.screen = s;
  // O óculos VR só recebe imagem com a partida iniciada (não no carregamento nem no menu).
  vr.setLive(s !== "loading" && s !== "menu");
}

// ---------- boot ----------
const loadFill = document.getElementById("load-fill");
const progress = (p, label) => {
  loadFill.style.width = `${p * 100}%`;
  if (label) document.getElementById("load-label").textContent = label;
};

boot().catch((err) => {
  console.error(err);
  progress(1, "o vale não carregou — atualize a página");
});

async function boot() {
  progress(0.1, "plantando as árvores");
  const [trees, palms, rocks, plants] = await Promise.all([TREES, PALMS, ROCKS, PLANTS].map((f) => loadTemplates(loader, f)));
  const farFromStart = (x, z, r) => Math.hypot(x - start.x, z - start.z) > r;
  const forest = (x, z) => fbm(x * 0.004 + 7, z * 0.004 - 3, 3);
  scatter(env.props, trees, {
    count: 260, minH: 9, maxH: 17, obstacles, kind: "tree",
    accept: (h, x, z) => h > WATER + 5 && h < 118 && forest(x, z) > 0.5 && Math.abs(z - riverZ(x)) > 30 && farFromStart(x, z, 26),
  });
  scatter(env.props, palms, {
    count: 30, minH: 10, maxH: 14, obstacles, kind: "tree",
    accept: (h) => h > WATER + 1 && h < WATER + 6,
  });
  scatter(env.props, rocks, {
    count: 60, minH: 3, maxH: 9, obstacles, kind: "rock", solid: 0.45,
    accept: (h, x, z) => h > WATER + 1 && farFromStart(x, z, 14),
  });
  scatter(env.props, plants, { count: 500, minH: 1.2, maxH: 2.6, accept: (h) => h > WATER + 3 && h < 100 });
  // Ninho: grama e flores ao redor de onde o pássaro acorda, sem tapar a vista.
  const fwd = { x: Math.sin(start.yaw), z: Math.cos(start.yaw) };
  scatter(env.props, plants, {
    count: 70, minH: 0.9, maxH: 2.2, area: { x: start.x, z: start.z, radius: 26 },
    accept: (h, x, z) => {
      const dx = x - start.x;
      const dz = z - start.z;
      const d = Math.hypot(dx, dz);
      return h > WATER + 1 && d > 3 && !((dx * fwd.x + dz * fwd.z) / d > 0.8 && d < 18);
    },
  });
  decorateIslands(env.islands, trees, 8, { obstacles, kind: "tree" });
  decorateIslands(env.islands, rocks, 2.5, { obstacles, kind: "rock", offset: 2 });
  decorateIslands(env.islands, plants, 1.4, { offset: 1 });

  progress(0.6, "chamando os pássaros");
  [flock] = await Promise.all([createFlock(scene, loader), selectBird(settings.bird)]);
  rings = createRings(scene, start);
  progress(1);
  setupUi();
  openMenu();
  // Compila todos os shaders agora, senão o jogo trava na primeira vez que algo aparece.
  wings.setVisible(true);
  try {
    renderer.compile(scene, camera);
  } catch (err) {
    console.warn("pré-compilação falhou", err);
  }
  const clock = new THREE.Clock();
  let lastError = "";
  // Se a placa de vídeo "cair" (WebGL context lost), avisa e recarrega sozinho.
  renderer.domElement.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    console.error("WebGL context lost — placa de vídeo reiniciou");
    debug.textContent = "A placa de vídeo reiniciou (WebGL). Recarregando…";
    debug.hidden = false;
    setTimeout(() => location.reload(), 1500);
  });
  const debug = document.getElementById("debug");
  let fpsT = 0;
  let fpsN = 0;
  let worst = 0;
  addEventListener("keydown", (e) => { if (e.code === "F3") { e.preventDefault(); debug.hidden = !debug.hidden; } });
  renderer.setAnimationLoop(() => {
    const raw = clock.getDelta();
    fpsT += raw;
    fpsN++;
    worst = Math.max(worst, raw);
    if (fpsT > 1) {
      const p = pose.state;
      debug.textContent = `${Math.round(fpsN / fpsT)} fps · pior quadro ${Math.round(worst * 1000)} ms · ${renderer.info.render.calls} draws · rastreador ${p.connected ? (p.tracking ? "rastreando" : "sem corpo") : "offline"} · 3D ${p.use3d ? "sim" : "não"} · ${screen}/${intro.phase}/${flight.mode} · altura ${flight.y.toFixed(1)} · batidas ${flight.flaps} · braços ${((p.leftUpper + p.rightUpper) / 2).toFixed(2)}${lastError ? " · ERRO: " + lastError : ""}`;
      fpsT = 0;
      fpsN = 0;
      worst = 0;
    }
    try {
      frame(Math.min(raw, 0.05), clock.elapsedTime);
    } catch (err) {
      // Um erro num quadro não pode congelar a tela: registra uma vez e segue.
      if (String(err) !== lastError) {
        lastError = String(err);
        console.error("erro no quadro:", err);
      }
      post.render();
    }
  });
}

async function selectBird(i) {
  settings.bird = (i + BIRDS.length) % BIRDS.length;
  const spec = BIRDS[settings.bird];
  const next = await loadBird(loader, spec);
  bird?.dispose();
  bird = next;
  scene.add(bird.root);
  flight.stats = { speed: spec.speed, turn: spec.turn, climb: spec.climb };
  wings.setColors(spec.wing);
  save();
  renderBirdPanel();
}

// ---------- menus ----------
let menuList;
let settingsList;
let pauseList;
let deathList;
let finishList;
let panel = "bird";

function showPanel(name) {
  panel = name;
  for (const p of ["bird", "howto", "settings"]) document.getElementById(`panel-${p}`).hidden = p !== name;
}

function renderBirdPanel() {
  const spec = BIRDS[settings.bird];
  document.getElementById("bird-name").textContent = spec.name;
  document.getElementById("bird-title").textContent = spec.name;
  document.getElementById("bird-blurb").textContent = spec.blurb;
  const bar = (v) => `<i style="width:${Math.round(clamp(v / 1.45, 0, 1) * 100)}%"></i>`;
  document.getElementById("bird-stats").innerHTML =
    `<dt>Velocidade</dt><dd>${bar(spec.speed)}</dd><dt>Curva</dt><dd>${bar(spec.turn)}</dd><dt>Subida</dt><dd>${bar(spec.climb)}</dd>`;
  const best = settings.best[spec.id];
  document.getElementById("bird-best").textContent = best ? `Recorde: ${formatTime(best)} no percurso completo` : "Ainda sem recorde com este pássaro.";
}

function renderSettings() {
  document.getElementById("set-quality").textContent = settings.quality ? "alta" : "leve";
  document.getElementById("set-invert").textContent = settings.invert ? "invertido" : "normal";
  document.getElementById("set-swap").textContent = settings.swap ? "trocadas" : "normal";
}

function setupUi() {
  renderSettings();
  document.getElementById("credits").textContent = CREDITS;
  menuList = createList(document.getElementById("menu-list"), (b, dir) => {
    audio.click();
    const a = b.dataset.action;
    if (a === "play" && dir === 0) startGame(false);
    else if (a === "mirror" && dir === 0) openMirror();
    else if (a === "bird") { showPanel("bird"); selectBird(settings.bird + (dir || 1)); }
    else if (a === "howto") showPanel("howto");
    else if (a === "settings") showPanel("settings");
  }, (b) => {
    const a = b.dataset.action;
    if (a === "howto" || a === "settings" || a === "bird") showPanel(a);
  });
  settingsList = createList(document.getElementById("settings-list"), (b) => {
    audio.click();
    const s = b.dataset.setting;
    if (s === "quality") { settings.quality = !settings.quality; post.setQuality(settings.quality); save(); }
    else if (s === "invert") { settings.invert = !settings.invert; pose.send({ cmd: "invert_pitch" }); }
    else if (s === "swap") { settings.swap = !settings.swap; pose.send({ cmd: "swap_arms" }); }
    else if (s === "calibrate") pose.send({ cmd: "recalibrate" });
    renderSettings();
  });
  pauseList = createList(document.getElementById("pause-list"), (b) => {
    audio.click();
    const a = b.dataset.action;
    if (a === "resume") setScreen("play");
    else if (a === "recalibrate") { pose.send({ cmd: "recalibrate" }); hover(flight); intro.startResume(); setScreen("play"); }
    else if (a === "menu") openMenu();
  });
  const endPick = (b) => {
    audio.click();
    if (b.dataset.action === "retry") startGame(true);
    else openMenu();
  };
  deathList = createList(document.getElementById("death-list"), endPick);
  finishList = createList(document.getElementById("finish-list"), endPick);

  addEventListener("keydown", (e) => {
    if (screen === "menu") {
      if (panel === "settings" && document.activeElement?.closest?.("#settings-list")) settingsList.key(e);
      else menuList.key(e);
    } else if (screen === "mirror") {
      if (e.code === "Escape") openMenu();
    } else if (screen === "pause") {
      if (e.code === "Escape") setScreen("play");
      else pauseList.key(e);
    } else if (screen === "dead" || screen === "finish") {
      if (e.code === "Escape") openMenu();
      else (screen === "dead" ? deathList : finishList).key(e);
    } else if (screen === "play") {
      if (e.code === "Escape" && !intro.active) setScreen("pause");
      else if (e.code === "Space") {
        e.preventDefault();
        if (intro.phase === "prompt" && !pose.state.calibrated) pose.send({ cmd: "calibrate" });
        intro.skip();
      }
      else if (e.code === "KeyC" && isAirborne(flight)) {
        pose.send({ cmd: "recalibrate" });
        hover(flight);
        intro.startResume();
      }
    }
  });
  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    post.resize(innerWidth, innerHeight);
  });
}

function openMenu() {
  intro.stop();
  menuList.reset();
  showPanel("bird");
  menuHold.reset();
  setScreen("menu");
}

function startGame(quick) {
  placeOnGround(flight, start);
  rings.reset();
  camRig.reset();
  elapsed = 0;
  streak = 0;
  deathHold.reset();
  intro.start(quick);
  post.uniforms.uDeath.value = 0;
  if (!pose.state.calibrated) pose.send({ cmd: "recalibrate" });
  setScreen("play");
}

function die(crash) {
  audio.crash();
  camRig.shake(1.4);
  post.uniforms.uHit.value = 1;
  const flash = document.getElementById("flash");
  flash.classList.remove("hit");
  void flash.offsetWidth;
  flash.classList.add("hit");
  deadT = 0;
  document.getElementById("death-cause").textContent = `${crash.cause} a ${crash.kmh} km/h.`;
  renderStats(document.getElementById("death-stats"), [
    ["anéis", `${rings.collected}/${rings.total}`],
    ["tempo", formatTime(elapsed)],
  ]);
}

function finish() {
  audio.finish();
  const spec = BIRDS[settings.bird];
  const prev = settings.best[spec.id];
  const record = !prev || elapsed < prev;
  if (record) { settings.best[spec.id] = elapsed; save(); }
  renderStats(document.getElementById("finish-stats"), [
    ["tempo", formatTime(elapsed), record ? "record" : ""],
    [record ? "novo recorde" : "recorde", formatTime(settings.best[spec.id])],
    ["pássaro", spec.name],
  ]);
  hover(flight);
  finishList.reset();
  setScreen("finish");
  renderBirdPanel();
}

// ---------- loop ----------
function frame(dt, time) {
  pose.tick(dt);
  const input = pose.sample();
  const p = pose.state;

  if (screen === "menu") menuFrame(dt, time, input);
  else if (screen === "pause") { /* mundo congelado */ }
  else if (screen === "mirror") mirrorFrame(dt, time, input);
  else gameFrame(dt, time, input);

  flock.update(time, dt);
  env.update(time, dt, bird.root.position, camera);
  const kmh = flight.speed * 3.6;
  const speedLevel = screen === "play" && isAirborne(flight) ? clamp((flight.speed - 18) / 30, 0, 1) : 0;
  wind.update(dt, flight.speed, speedLevel);
  audio.wind(screen === "menu" ? 0.15 : isAirborne(flight) ? clamp(flight.speed / 50, 0, 1) : 0.05);
  post.uniforms.uSpeed.value = speedLevel;
  post.uniforms.uHit.value = damp(post.uniforms.uHit.value, 0, 2.5, dt);

  hud.update({
    collected: rings.collected, count: rings.total, elapsed, kmh, pose: p,
    next: rings.next, camera, showMarker: screen === "play" && isAirborne(flight),
    hintText: hudHint(p),
  });
  vr.applyLook(camera);
  post.render();
  vr.sendFrame();
  renderInsets();
}

// ---------- câmeras extras ----------
let showFront = false;
addEventListener("keydown", (e) => { if (e.code === "KeyV") showFront = !showFront; });
const frontCam = new THREE.PerspectiveCamera(40, 4 / 3, 0.1, 2000);
const fpCam = new THREE.PerspectiveCamera(74, 4 / 3, 0.15, 2000);
const insetFwd = new THREE.Vector3();
const insetUp = new THREE.Vector3();

/** Pássaro visto de frente (segunda pessoa): posiciona `cam` diante do bico. */
function aimFront(cam, dist) {
  insetFwd.set(0, 0, 1).applyQuaternion(flight.q);
  insetUp.set(0, 1, 0).applyQuaternion(flight.q);
  cam.position.copy(bird.root.position).addScaledVector(insetFwd, dist).addScaledVector(insetUp, 0.5);
  cam.up.copy(insetUp);
  cam.lookAt(bird.root.position);
}

function drawInset(cam, x, y, w, h) {
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
  renderer.setScissorTest(true);
  renderer.setViewport(x, innerHeight - y - h, w, h);
  renderer.setScissor(x, innerHeight - y - h, w, h);
  renderer.render(scene, cam);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
}

function renderInsets() {
  const frame = document.getElementById("inset");
  // Renderizar a cena de novo custa caro: no jogo a câmera de frente só liga com V.
  // Em primeira pessoa ela aparece sempre (você se vê como pássaro); em voo, liga com V.
  const firstPerson = intro.blend < 0.5 && intro.phase !== "sleep" && intro.phase !== "wake";
  const flying = intro.blend >= 0.5;
  const show = (screen === "play" && flight.mode !== "crashed" && (firstPerson || (flying && showFront))) || screen === "mirror";
  frame.hidden = !show;
  if (!show) return;
  const r = frame.getBoundingClientRect();
  if (screen === "mirror") {
    // No espelho, a janelinha mostra o que o pássaro vê.
    fpCam.position.copy(eye);
    insetFwd.set(0, 0, 1).applyQuaternion(flight.q);
    fpCam.up.set(0, 1, 0).applyQuaternion(flight.q);
    fpCam.lookAt(insetUp.copy(eye).add(insetFwd));
    bird.model.visible = false;
    wings.setVisible(true);
    drawInset(fpCam, innerWidth - r.right, r.top, r.width, r.height); // canvas espelhado
    wings.setVisible(false);
    bird.model.visible = true;
  } else {
    // Na primeira pessoa o corpo está escondido da sua visão: liga só para esta janela.
    const bodyWas = bird.model.visible;
    const wingsWere = wings.root.visible;
    bird.model.visible = true;
    wings.setVisible(false);
    aimFront(frontCam, firstPerson ? 6 : 7);
    drawInset(frontCam, r.left, r.top, r.width, r.height);
    bird.model.visible = bodyWas;
    wings.setVisible(wingsWere);
  }
}

// ---------- modo "virar pássaro" ----------
function openMirror() {
  placeOnGround(flight, start);
  flight.y = groundAt(start.x, start.z) + 30;
  hover(flight);
  intro.stop();
  setScreen("mirror");
}

function mirrorFrame(dt, time, input) {
  stepFlight(flight, input, dt, obstacles);
  bird.place(flight);
  bird.model.visible = true;
  wings.setVisible(false);
  const arms = readArms(input);
  bird.setWings(arms, dt);
  eye.set(0, 0.5, 0.9).applyQuaternion(flight.q).add(bird.root.position);
  wings.update(eye, flight.yaw, arms);
  // Câmera principal de frente para o pássaro; a tela é espelhada (CSS), como um espelho.
  aimFront(camera, 8);
  camera.fov = 45;
  camera.updateProjectionMatrix();
}

function hudHint(p) {
  if (screen !== "play" || !isAirborne(flight)) return "";
  if (p.connected && !p.tracking) return "Não vejo seu corpo — volte para o quadro da câmera";
  if (elapsed < 8) return "Bata as asas para subir · braço mais alto vira · V câmera de frente · Esc pausa";
  return "";
}

function menuFrame(dt, time, input) {
  // O pássaro escolhido plana em círculo; a câmera o acompanha de lado.
  const a = time * 0.12;
  flight.x = 60 + Math.cos(a) * 170;
  flight.z = 20 + Math.sin(a) * 170;
  flight.y = 118 + Math.sin(time * 0.5) * 3;
  flight.yaw = Math.atan2(-Math.sin(a), Math.cos(a));
  flight.pitch = Math.sin(time * 0.5) * -0.05;
  flight.roll = -0.18;
  flight.speed = 16;
  syncQuat(flight);
  bird.place(flight);
  bird.model.visible = true;
  wings.setVisible(false);
  // Com corpo na câmera, o pássaro do menu já copia os seus braços.
  bird.setWings(pose.state.tracking && !pose.state.demo ? readArms(input) : syntheticArms(demoArms, time, 5.5, 0.8), dt);
  camRig.showcase(time, bird.root.position, flight.yaw);

  const holdOk = pose.state.tracking;
  const go = menuHold.update(input, dt, holdOk);
  document.getElementById("menu-hold").style.setProperty("--p", menuHold.progress.toFixed(3));
  if (go) startGame(false);
}

const readArms = createArmReader();
const demoArms = makeArms();
let lastFlaps = 0;

function gameFrame(dt, time, input) {
  const event = screen === "play" ? intro.update(dt, input, pose.state) : null;
  if (event === "takeoff") { takeOff(flight); audio.takeoff(); }
  else if (event === "resume") resume(flight);

  const crash = stepFlight(flight, input, dt, obstacles);
  if (crash) die(crash);
  if (screen === "play" && isAirborne(flight) && !intro.active) elapsed += dt;

  bird.place(flight);
  const arms = readArms(input);
  const autoFlap = flight.mode === "takeoff" && !pose.state.tracking;
  let wingArms = arms;
  if (flight.mode === "crashed") wingArms = syntheticArms(demoArms, 0.9, 1, -0.9); // asas largadas
  else if (autoFlap) wingArms = syntheticArms(demoArms, time, 9, 0.9);
  bird.setWings(wingArms, dt, flight.flaps);
  if (flight.flaps !== lastFlaps) {
    lastFlaps = flight.flaps;
    audio.flap();
  }

  const blend = intro.blend;
  const fp = blend < 0.12;
  bird.model.visible = !fp;
  wings.setVisible(fp);

  const fwdX = Math.sin(flight.yaw);
  const fwdZ = Math.cos(flight.yaw);
  eye.set(flight.x + fwdX * EYE_FORWARD, flight.y + EYE_UP, flight.z + fwdZ * EYE_FORWARD);
  if (flight.mode === "ground") eye.y += Math.sin(time * 1.7) * 0.02; // respiração
  wings.update(eye, flight.yaw, arms);

  const head = clampHead(input);
  const look = 1 - blend;
  camRig.update(dt, {
    flight,
    focus: bird.root.position,
    airborne: isAirborne(flight),
    crashed: flight.mode === "crashed",
    eye,
    lookYaw: flight.yaw - head.yaw * look,
    lookPitch: (head.pitch + intro.headPitchOffset()) * look,
    blend,
  });

  if (rings.update(time, dt, bird.root.position, isAirborne(flight))) {
    streak++;
    audio.ring(streak);
    if (rings.done) finish();
  }

  if (flight.mode === "crashed") {
    deadT += dt;
    post.uniforms.uDeath.value = damp(post.uniforms.uDeath.value, 1, 1.5, dt);
    if (deadT > 1.8 && screen === "play") {
      deathList.reset();
      deathHold.reset();
      setScreen("dead");
    }
    if (screen === "dead") {
      const go = deathHold.update(input, dt, pose.state.tracking);
      document.getElementById("death-hold").style.setProperty("--p", deathHold.progress.toFixed(3));
      if (go) startGame(true);
    }
  }
}
