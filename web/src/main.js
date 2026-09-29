import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { WATER, ISLANDS, terrainHeight, groundAt, findStart, riverZ, islandTop } from "./terrain.js";

const FOG = 0xf0d2b4;
const SUN = new THREE.Vector3(-0.45, 0.62, 0.42).normalize();
const WS_URL = "ws://127.0.0.1:8765";

const TREES = [
  "tree_oak.glb", "tree_default.glb", "tree_detailed.glb", "tree_fat.glb",
  "tree_small.glb", "tree_palmTall.glb", "tree_pineTallA.glb",
];
const ROCKS = ["rock_largeA.glb", "rock_largeB.glb", "rock_tallA.glb", "rock_smallA.glb", "rock_tallE.glb"];
const PLANTS = ["plant_bush.glb", "plant_bushLarge.glb", "grass_large.glb", "flower_yellowA.glb", "flower_redA.glb", "flower_purpleA.glb"];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (c, t, k, dt) => c + (t - c) * (1 - Math.exp(-k * dt));

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("view"), antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG, 0.00135);
scene.background = new THREE.Color(FOG);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.15, 4000);
const start = findStart();

const hemi = new THREE.HemisphereLight(0xffe2c4, 0x3e5a38, 0.72);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.castShadow = false;
const sunTarget = new THREE.Object3D();
scene.add(sun, sunTarget);
sun.target = sunTarget;
scene.add(new THREE.DirectionalLight(0x9ec0dc, 0.35));

const sky = makeSky();
scene.add(sky);
const water = makeWater();
scene.add(water);

const terrain = makeTerrain();
scene.add(terrain);

const islands = new THREE.Group();
scene.add(islands);
for (const isl of ISLANDS) {
  const mesh = makeIsland(isl);
  mesh.position.set(isl.x, isl.y - 2, isl.z);
  islands.add(mesh);
}

const loader = new GLTFLoader();
const props = new THREE.Group();
scene.add(props);

const bird = new THREE.Group();
bird.position.set(start.x, start.y, start.z);
scene.add(bird);
const wing = { mixer: null, action: null, duration: 1 };

const flock = [];
const coins = [];
let score = 0;
const scoreEl = document.getElementById("score");

const pose = createPose();
const flight = {
  x: start.x, y: start.y, z: start.z, yaw: start.yaw,
  pitch: 0, roll: 0, speed: 16, vy: 0, flying: false,
};
let camReady = false;
const camLook = new THREE.Vector3();
let camYaw = 0;
let camRoll = 0;
let camPitch = 0;

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uSpeed: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uSpeed;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      float r = length(d);
      vec2 uv = vUv + d * r * uSpeed * 0.18;
      vec3 c = texture2D(tDiffuse, uv).rgb;
      c = pow(max(c, 0.0), vec3(0.96));
      c = (c - 0.5) * 1.06 + 0.5;
      c *= smoothstep(0.95, 0.4, r);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.7, 0.92);
composer.addPass(bloom);
const grade = new ShaderPass(GradeShader);
composer.addPass(grade);
composer.addPass(new OutputPass());

document.getElementById("btn-cal").onclick = () => { unlockAudio(); pose.send({ cmd: "calibrate" }); };
document.getElementById("btn-invert").onclick = () => pose.send({ cmd: "invert_pitch" });
document.getElementById("btn-swap").onclick = () => pose.send({ cmd: "swap_arms" });
addEventListener("keydown", (e) => {
  if (e.key === "c" || e.key === "C") {
    flight.flying = false;
    document.getElementById("calib").classList.remove("hidden");
    pose.send({ cmd: "recalibrate" });
  }
});
addEventListener("resize", resize);

const audio = createAudio();
boot().catch((err) => {
  console.error(err);
  const label = document.getElementById("stable-label");
  if (label) label.textContent = "O cenário falhou ao carregar. Atualize a página.";
});

async function boot() {
  await scatter(TREES, 60, 10, 16, (h, x, z) => h > WATER + 6 && h < 100 && Math.abs(z - riverZ(x)) > 40);
  await scatter(ROCKS, 16, 2.4, 5, (h) => h > WATER + 1);
  await scatter(PLANTS, 0, 1.4, 2.6, (h) => h > WATER + 3 && h < 75);
  await loadBird("/models/Stork.glb", bird, 5.2, wing);
  await spawnFlock();
  buildCoins();
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.elapsedTime;
    pose.tick(dt, time);
    const input = pose.sample();
    if (pose.takeOff()) {
      flight.flying = true;
      document.getElementById("calib").classList.add("hidden");
      unlockAudio();
    }
    stepFlight(input, dt);
    placeBird(input, time, dt);
    updateCoins(time);
    updateFlock(time, dt);
    updateCamera(dt, input);
    followSun();
    sky.position.copy(camera.position);
    water.material.uniforms.uTime.value = time;
    grade.uniforms.uSpeed.value = flight.flying ? clamp((flight.speed - 12) / 28, 0, 1) * clamp(flight.pitch, 0, 1) : 0;
    hud();
    renderer.render(scene, camera);
  });
}

function stepFlight(input, dt) {
  const raise = (input.leftUpper + input.rightUpper) * 0.5;
  const bothForward = Math.min(input.leftSweep || 0, input.rightSweep || 0);
  const shake = Math.max(0, input.shake - 0.2);
  const armTilt =
    (input.rightUpper - input.leftUpper) * 0.62 +
    ((input.rightFore || 0) - (input.leftFore || 0)) * 0.38;
  const tilt = Math.abs(armTilt);
  const steer = tilt < 0.05 ? 0 : Math.sign(armTilt) * Math.pow(clamp((tilt - 0.05) / 0.68, 0, 1), 0.9);
  const pace = clamp(flight.speed / 32, 0.55, 1.85);
  flight.roll = dampAngle(flight.roll, steer * 0.95, Math.abs(steer) < 0.05 ? 4.6 : 3.8, dt);
  if (!flight.flying) {
    flight.y = start.y + Math.sin(performance.now() / 600) * 0.25;
    flight.vy = 0;
    flight.pitch = damp(flight.pitch, 0, 6, dt);
    return;
  }
  const climb = clamp((raise - 0.1) / 0.34, 0, 1);
  const droop = clamp((-raise - 0.08) / 0.65, 0, 1);
  const leanDown = clamp((-(input.pitch || 0) - 0.06) / 0.4, 0, 1);
  const ground = groundAt(flight.x, flight.z, flight.y);
  const altitude = flight.y - ground;
  const dive = altitude > 12 ? clamp((bothForward - 0.1) / 0.22, 0, 1) : 0;
  const wantPitch = clamp(dive * 0.34 + leanDown * 0.18 + droop * 0.1 - climb * 0.26, -0.3, 0.38);
  flight.pitch = damp(flight.pitch, wantPitch, 4.2, dt);
  flight.speed = damp(flight.speed, 15 + dive * dive * 28 + shake * 22, dive > 0.35 ? 1.8 : 1.05, dt);
  flight.speed = clamp(flight.speed, 12, 58);
  const along = -Math.sin(flight.pitch) * flight.speed;
  const wantVy = along * 0.28 + climb * 14 * (1 - dive) - droop * (1 - dive) * 8;
  flight.vy = damp(flight.vy, wantVy, 4.6, dt);
  flight.yaw -= Math.sin(flight.roll) * (0.58 + pace * 0.4) * dt;
  const ahead = Math.cos(flight.pitch);
  flight.x += Math.sin(flight.yaw) * ahead * flight.speed * dt;
  flight.z += Math.cos(flight.yaw) * ahead * flight.speed * dt;
  flight.y += flight.vy * dt;
  if (flight.y < ground + 3) {
    flight.y = ground + 3;
    if (flight.vy < 0) flight.vy = 0;
  } else if (flight.y < WATER + 1.2 && ground < WATER) {
    flight.y = WATER + 1.2;
    if (flight.vy < 0) flight.vy = 0;
  }
  flight.y = Math.min(flight.y, 150);
  if (Math.max(Math.abs(flight.x), Math.abs(flight.z)) > 680) {
    flight.yaw = damp(flight.yaw, Math.atan2(-flight.x, -flight.z), 1.2, dt);
  }
}

function placeBird(input, time, dt) {
  bird.position.set(flight.x, flight.y, flight.z);
  const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), flight.yaw);
  const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), flight.pitch);
  const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), flight.roll);
  bird.quaternion.copy(qYaw).multiply(qPitch).multiply(qRoll);
  if (wing.pose) {
    wing.pose.r.value = input.rightUpper * 0.9 + (input.rightFore || 0) * 0.35;
    wing.pose.l.value = input.leftUpper * 0.9 + (input.leftFore || 0) * 0.35;
  }
}

function updateCamera(dt) {
  camYaw = dampAngle(camYaw, flight.yaw, 4.2, dt);
  camRoll = damp(camRoll, flight.roll, 2.4, dt);
  camPitch = damp(camPitch, flight.pitch, 2.2, dt);
  const flat = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
  const focus = bird.position.clone();
  const back = flight.flying ? 2.45 : 4.2;
  const rise = clamp(flight.vy / 14, 0, 1);
  const height = flight.flying ? 0.7 + rise * 1.35 : 1.45;
  const desired = focus.clone().addScaledVector(flat, -back).add(new THREE.Vector3(0, height, 0));
  if (!camReady) {
    camera.position.copy(desired);
    camLook.copy(focus);
    camYaw = flight.yaw;
    camRoll = flight.roll;
    camPitch = flight.pitch;
    camReady = true;
  }
  const follow = 1 - Math.exp(-2.8 * dt);
  const followY = 1 - Math.exp(-12 * dt);
  camera.position.x += (desired.x - camera.position.x) * follow;
  camera.position.z += (desired.z - camera.position.z) * follow;
  camera.position.y += (desired.y - camera.position.y) * followY;
  const look = focus.clone().addScaledVector(flat, 0.55).add(new THREE.Vector3(0, 0.2 + rise * 0.35, 0));
  const lookK = 1 - Math.exp(-3.2 * dt);
  const lookY = 1 - Math.exp(-12 * dt);
  camLook.x += (look.x - camLook.x) * lookK;
  camLook.z += (look.z - camLook.z) * lookK;
  camLook.y += (look.y - camLook.y) * lookY;
  const dive = flight.flying ? clamp(camPitch, 0, 1) * clamp(flight.speed / 48, 0, 1) : 0;
  camera.fov = damp(camera.fov, (flight.flying ? 42 : 52) + dive * 6, 2, dt);
  camera.updateProjectionMatrix();
  camera.up.set(Math.sin(-camRoll * 0.55), Math.cos(camRoll * 0.55), 0);
  camera.lookAt(camLook);
}

function dampAngle(current, target, speed, dt) {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-speed * dt));
}

function followSun() {
  const focus = bird.position;
  sun.position.copy(focus).addScaledVector(SUN, 160);
  sunTarget.position.copy(focus);
  const r = 70;
  const cam = sun.shadow.camera;
  cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
  cam.updateProjectionMatrix();
}

function hud() {
  scoreEl.textContent = `${score}`;
  const status = document.getElementById("status");
  const label = document.getElementById("stable-label");
  const fill = document.getElementById("stable-fill");
  fill.style.width = `${Math.round(pose.stable * 100)}%`;
  label.textContent = pose.message;
  document.getElementById("eyebrow").textContent = pose.demo ? "demonstração" : "alinhar postura";
  const img = document.getElementById("preview");
  const wrap = img.parentElement;
  if (pose.preview) {
    img.src = pose.preview;
    wrap.classList.add("has-preview");
  }
  if (!pose.connected) status.textContent = "rastreador offline — python run.py";
  else if (flight.flying && !pose.tracking) status.textContent = "corpo fora do quadro";
  else if (flight.flying) status.textContent = "Incline um braço para virar";
  else status.textContent = "";
}

async function loadBird(url, parent, height, slot) {
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;
  fitHeight(model, height);
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  model.rotation.y = 0;
  parent.add(model);
  slot.model = model;
  const pose = { l: { value: 0 }, r: { value: 0 } };
  slot.pose = pose;
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (o.morphTargetInfluences) o.morphTargetInfluences.fill(0);
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    for (const material of materials) {
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uWingL = pose.l;
        shader.uniforms.uWingR = pose.r;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float uWingL;\nuniform float uWingR;")
          .replace("#include <begin_vertex>", `#include <begin_vertex>
            float wingAng = transformed.x >= 0.0 ? uWingR : -uWingL;
            float wingMix = smoothstep(12.0, 34.0, abs(transformed.x));
            float ws = sin(wingAng);
            float wc = cos(wingAng);
            float wx = transformed.x * wc - transformed.y * ws;
            float wy = transformed.x * ws + transformed.y * wc;
            transformed.x = mix(transformed.x, wx, wingMix);
            transformed.y = mix(transformed.y, wy, wingMix);`);
      };
      material.customProgramCacheKey = () => "wing-pose";
    }
  });
}

async function spawnFlock() {
  const specs = [
    ["/models/Flamingo.glb", 1.8, 40],
    ["/models/Stork.glb", 2.1, -30],
    ["/models/Flamingo.glb", 1.5, 110],
  ];
  for (const [url, h, zoff] of specs) {
    const gltf = await loader.loadAsync(url);
    const model = gltf.scene;
    fitHeight(model, h);
    model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const pivot = new THREE.Group();
    model.rotation.y = Math.PI;
    pivot.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(gltf.animations[0]);
    action.play();
    scene.add(pivot);
    flock.push({ pivot, mixer, radius: 80 + zoff, speed: 0.12 + Math.random() * 0.08, y: 70 + Math.random() * 30, phase: Math.random() * 6 });
  }
}

function updateFlock(time, dt) {
  for (const b of flock) {
    b.mixer.update(dt);
    const a = time * b.speed + b.phase;
    b.pivot.position.set(Math.cos(a) * b.radius + 80, b.y + Math.sin(a * 2) * 4, Math.sin(a) * b.radius);
    b.pivot.rotation.y = -a + Math.PI;
  }
}

function fitHeight(root, height) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const s = height / Math.max(size.y, size.x, size.z, 0.001);
  root.scale.setScalar(s);
  box.setFromObject(root);
  const center = new THREE.Vector3();
  box.getCenter(center);
  root.position.sub(center);
}

async function scatter(files, count, minH, maxH, accept) {
  const templates = [];
  for (const file of files) {
    const gltf = await loader.loadAsync(`/models/nature/${file}`).catch(() => null);
    if (!gltf) continue;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      const size = new THREE.Vector3();
      o.geometry.boundingBox.getSize(size);
      o.userData.baseHeight = Math.max(size.y, 0.001);
      templates.push(o);
    });
  }
  if (!templates.length) return;
  const buckets = templates.map(() => []);
  let placed = 0;
  let guard = 0;
  while (placed < count && guard < count * 40) {
    guard++;
    const x = (Math.random() - 0.5) * 1300;
    const z = (Math.random() - 0.5) * 1300;
    const h = terrainHeight(x, z);
    if (!accept(h, x, z)) continue;
    const idx = placed % templates.length;
    const desired = minH + Math.random() * (maxH - minH);
    buckets[idx].push({ x, h, z, s: desired / templates[idx].userData.baseHeight, rot: Math.random() * Math.PI * 2 });
    placed++;
  }
  const dummy = new THREE.Object3D();
  buckets.forEach((list, idx) => {
    if (!list.length) return;
    const src = templates[idx];
    const mesh = new THREE.InstancedMesh(src.geometry, src.material, list.length);
    list.forEach((p, i) => {
      dummy.position.set(p.x, p.h, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    props.add(mesh);
  });
  for (const isl of ISLANDS) {
    const src = templates[placed % templates.length];
    const mesh = new THREE.Mesh(src.geometry, src.material);
    const top = islandTop(isl, isl.x, isl.z);
    mesh.scale.setScalar((minH * 0.7) / src.userData.baseHeight);
    mesh.position.set(isl.x + (Math.random() - 0.5) * 6, top, isl.z);
    mesh.castShadow = true;
    islands.add(mesh);
  }
}

function buildCoins() {
  const geo = new THREE.TorusGeometry(4.2, 0.22, 10, 28);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffd56a, emissive: 0xffc14a, emissiveIntensity: 1.6, metalness: 0.35, roughness: 0.32 });
  const nextMat = new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0xffffff, emissiveIntensity: 2.8, metalness: 0.2, roughness: 0.25 });
  const pts = [];
  let x = start.x;
  let z = start.z;
  let yaw = start.yaw;
  const step = 84;
  const bends = [
    0.22, 0.38, 0.48, 0.5, 0.5, 0.5, 0.5, 0.5, 0.48, 0.42, 0.3,
    -0.2, -0.42, -0.55, -0.55, -0.55, -0.55, -0.55, -0.5, -0.38,
    0.25, 0.48, 0.55, 0.55, 0.55, 0.48, 0.32, 0.18,
  ];
  for (const bend of bends) {
    yaw += bend;
    x += Math.sin(yaw) * step;
    z += Math.cos(yaw) * step;
    if (Math.hypot(x, z) > 560) {
      yaw = Math.atan2(-x, -z);
      x += Math.sin(yaw) * step * 0.35;
      z += Math.cos(yaw) * step * 0.35;
    }
    const y = Math.max(groundAt(x, z, 200) + 22, 50 + Math.sin(pts.length * 0.7) * 14);
    pts.push(new THREE.Vector3(x, y, z));
  }
  pts.forEach((p, i) => {
    const mesh = new THREE.Mesh(geo, i === 0 ? nextMat : mat);
    const nxt = pts[Math.min(i + 1, pts.length - 1)];
    mesh.position.copy(p);
    mesh.lookAt(nxt);
    mesh.userData.base = p.y;
    scene.add(mesh);
    coins.push({ mesh, got: false, next: i === 0 });
  });
}

function updateCoins(time) {
  const bp = bird.position;
  let passed = false;
  for (const c of coins) {
    if (c.got) continue;
    c.mesh.position.y = c.mesh.userData.base + Math.sin(time * 1.4 + c.mesh.position.x) * 0.2;
    if (flight.flying && bp.distanceTo(c.mesh.position) < 5.5) {
      c.got = true;
      c.mesh.visible = false;
      score += 1;
      audio.chime();
      passed = true;
    }
  }
  if (passed) {
    const nxt = coins.find((c) => !c.got);
    if (nxt) nxt.mesh.material = nxt.mesh.material.clone();
    coins.forEach((c) => {
      if (!c.got && c === nxt) {
        c.mesh.material.emissive.setHex(0xffffff);
        c.mesh.material.emissiveIntensity = 2.8;
      }
    });
  }
}

function makeTerrain() {
  const geo = new THREE.PlaneGeometry(1500, 1500, 80, 80);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const grass = new THREE.Color(0x7d9a4e);
  const grassHi = new THREE.Color(0xc5d48a);
  const rock = new THREE.Color(0x8d6a58);
  const snow = new THREE.Color(0xf4f1ea);
  const sand = new THREE.Color(0xd8c4a0);
  const deep = new THREE.Color(0x1a4c54);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    const slope = Math.abs(terrainHeight(x + 3, z) - terrainHeight(x - 3, z)) + Math.abs(terrainHeight(x, z + 3) - terrainHeight(x, z - 3));
    const col = deep.clone();
    if (h < WATER + 1.2) col.copy(deep);
    else if (h < WATER + 6) col.copy(sand).lerp(grass, (h - WATER) / 6);
    else {
      col.copy(grass).lerp(grassHi, clamp((h - 40) / 50, 0, 1));
      col.lerp(rock, clamp(slope / 8, 0, 1));
      col.lerp(snow, clamp((h - 120) / 40, 0, 1));
    }
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 }));
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

function makeIsland(isl) {
  const seg = 40;
  const rings = 14;
  const positions = [];
  const colors = [];
  const indices = [];
  const grass = new THREE.Color(0x86a356);
  const rock = new THREE.Color(0x6d5146);
  const add = (x, y, z, col) => {
    const i = positions.length / 3;
    positions.push(x, y, z);
    colors.push(col.r, col.g, col.b);
    return i;
  };
  const center = add(0, 6, 0, grass);
  const ringsIdx = [];
  for (let r = 1; r <= rings; r++) {
    const ring = [];
    const rad = (r / rings) * isl.r;
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const edge = r / rings;
      const col = grass.clone().lerp(rock, edge * edge);
      ring.push(add(Math.cos(a) * rad, Math.pow(1 - edge, 0.55) * 6, Math.sin(a) * rad, col));
    }
    ringsIdx.push(ring);
  }
  for (let s = 0; s < seg; s++) indices.push(center, ringsIdx[0][(s + 1) % seg], ringsIdx[0][s]);
  for (let r = 0; r < rings - 1; r++) {
    for (let s = 0; s < seg; s++) {
      const n = (s + 1) % seg;
      const a = ringsIdx[r][s];
      const b = ringsIdx[r][n];
      const c = ringsIdx[r + 1][s];
      const d = ringsIdx[r + 1][n];
      indices.push(a, b, d, a, d, c);
    }
  }
  const bottom = add(0, -isl.r * 0.65, 0, rock);
  const outer = ringsIdx[rings - 1];
  for (let s = 0; s < seg; s++) indices.push(outer[s], bottom, outer[(s + 1) % seg]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, flatShading: false }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeWater() {
  const geo = new THREE.PlaneGeometry(3200, 3200, 24, 24);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      uniform float uTime;
      varying vec3 vPos;
      varying vec3 vNormal;
      void main() {
        vec3 p = position;
        p.y += sin(position.x * 0.05 + uTime * 1.3) * 0.25 + cos(position.z * 0.04 + uTime) * 0.18;
        vPos = (modelMatrix * vec4(p, 1.0)).xyz;
        vNormal = normalize(mat3(modelMatrix) * vec3(-cos(position.x * 0.05 + uTime) * 0.02, 1.0, sin(position.z * 0.04) * 0.02));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vPos;
      varying vec3 vNormal;
      void main() {
        vec3 view = normalize(cameraPosition - vPos);
        float fres = pow(1.0 - max(dot(normalize(vNormal), view), 0.0), 3.0);
        vec3 deep = vec3(0.06, 0.28, 0.32);
        vec3 shallow = vec3(0.28, 0.66, 0.6);
        vec3 col = mix(deep, shallow, fres);
        col = mix(col, vec3(0.95, 0.82, 0.68), fres * 0.45);
        gl_FragColor = vec4(col, 0.78 + fres * 0.18);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER;
  mesh.renderOrder = 2;
  return mesh;
}

function makeSky() {
  const geo = new THREE.SphereGeometry(1700, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSun: { value: SUN.clone() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uSun;
      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y;
        vec3 fogc = vec3(0.941, 0.824, 0.706);
        vec3 zenith = vec3(0.23, 0.40, 0.68);
        vec3 mid = vec3(0.55, 0.72, 0.86);
        vec3 col = mix(fogc, mid, smoothstep(0.0, 0.22, h));
        col = mix(col, zenith, smoothstep(0.18, 0.85, h));
        if (h < 0.0) col = mix(fogc * 0.72, fogc, smoothstep(-0.35, 0.0, h));
        float sun = pow(max(dot(dir, normalize(uSun)), 0.0), 280.0);
        float glow = pow(max(dot(dir, normalize(uSun)), 0.0), 7.0);
        col += glow * vec3(1.0, 0.72, 0.38) * 0.7;
        col += sun * vec3(1.4, 1.15, 0.8);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  return mesh;
}

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
}

function createPose() {
  const s = {
    connected: false, tracking: false, calibrated: false, demo: false,
    stable: 0, message: "Conectando o corpo…", preview: null,
    leftUpper: 0.1, leftFore: 0, leftSweep: 0, rightUpper: 0.1, rightFore: 0, rightSweep: 0, span: 0.75,
    pitch: 0, roll: 0, flap: 0, shake: 0, rose: false,
  };
  const target = { ...s };
  let prevRaise = 0;
  let ws;
  const connect = () => {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => { s.connected = true; };
    ws.onclose = () => { s.connected = false; setTimeout(connect, 1500); };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.calibrated && !s.calibrated) s.rose = true;
      s.calibrated = !!m.calibrated;
      s.tracking = !!m.tracking;
      s.demo = !!m.demo;
      s.stable = m.stable ?? 0;
      s.message = m.message || "";
      s.preview = m.preview || s.preview;
      if (m.tracking) {
        target.leftUpper = m.leftUpper; target.leftFore = m.leftFore; target.leftSweep = m.leftSweep || 0;
        target.rightUpper = m.rightUpper; target.rightFore = m.rightFore; target.rightSweep = m.rightSweep || 0;
        target.span = m.span; target.pitch = m.pitch; target.roll = m.roll;
      }
    };
  };
  connect();
  return {
    send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); },
    tick(dt, time) {
      const k = 1 - Math.exp(-18 * dt);
      const kb = 1 - Math.exp(-10 * dt);
      if (!s.tracking && !s.connected) {
        target.leftUpper = 0.15 + Math.sin(time * 1.4) * 0.35;
        target.rightUpper = 0.15 + Math.sin(time * 1.4) * 0.35;
        target.span = 0.8;
      }
      s.leftUpper += (target.leftUpper - s.leftUpper) * k;
      s.leftFore += (target.leftFore - s.leftFore) * k;
      s.leftSweep += ((target.leftSweep || 0) - s.leftSweep) * k;
      s.rightUpper += (target.rightUpper - s.rightUpper) * k;
      s.rightFore += (target.rightFore - s.rightFore) * k;
      s.rightSweep += ((target.rightSweep || 0) - s.rightSweep) * k;
      s.span += (target.span - s.span) * k;
      s.pitch += (target.pitch - s.pitch) * kb;
      s.roll += (target.roll - s.roll) * kb;
      const raiseNow = (s.leftUpper + s.rightUpper + s.leftFore + s.rightFore) * 0.25;
      const delta = (raiseNow - prevRaise) / Math.max(dt, 0.001);
      prevRaise = raiseNow;
      s.flap = Math.max(0, -delta - 0.35);
      const burst = Math.max(0, Math.abs(delta) - 0.85);
      s.shake += (burst - s.shake) * (1 - Math.exp(-10 * dt));
    },
    sample: () => s,
    takeOff() {
      if (!s.rose) return false;
      s.rose = false;
      return true;
    },
    get stable() { return s.stable; },
    get message() { return s.message; },
    get preview() { return s.preview; },
    get demo() { return s.demo; },
    get connected() { return s.connected; },
    get tracking() { return s.tracking; },
  };
}

function createAudio() {
  let ctx;
  function context() {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  return {
    unlock() { context(); },
    chime() {
      const ac = context();
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      o.frequency.exponentialRampToValueAtTime(1400, ac.currentTime + 0.08);
      g.gain.setValueAtTime(0.06, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.35);
      o.connect(g); g.connect(ac.destination);
      o.start();
      o.stop(ac.currentTime + 0.4);
    },
  };
}

function unlockAudio() {
  audio.unlock();
}
