import * as THREE from "three";
import { WATER, groundAt, terrainNormal, insideIsland } from "../world/terrain.js";
import { clamp, damp, dampAngle } from "../util/math.js";

export const SIT_HEIGHT = 1.1;
const TAKEOFF_TIME = 3.2;
const BODY = 1.1; // raio do corpo para colisão
const CRASH_IMPACT = 7.5; // velocidade (m/s) contra a superfície que mata
const GRACE = 1.5; // segundos de proteção depois de decolar

/**
 * Estado do voo. Modos: ground (sentado), takeoff (decolagem roteirizada),
 * flying, hover (pausado no ar), crashed (caindo depois da batida).
 */
export function createFlight() {
  return {
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 0, vx: 0, vy: 0, vz: 0,
    q: new THREE.Quaternion(),
    lift: 0, extreme: 0, extremeT: 0, dir: 0, flapCooldown: 0, flaps: 0,
    mode: "ground", t: 0, grace: 0, hoverY: 0, spin: 0,
    stats: { speed: 1, turn: 1, climb: 1 },
    crash: null,
  };
}

export function placeOnGround(f, start) {
  Object.assign(f, {
    x: start.x, z: start.z, yaw: start.yaw,
    y: groundAt(start.x, start.z) + SIT_HEIGHT,
    pitch: 0, roll: 0, speed: 0, vy: 0, mode: "ground", t: 0, spin: 0, crash: null, lift: 0, flaps: 0,
  });
}

export const isAirborne = (f) => f.mode === "takeoff" || f.mode === "flying";

export function takeOff(f) {
  f.mode = "takeoff";
  f.t = 0;
  f.speed = 4;
  f.vy = 2;
}

export function hover(f) {
  f.mode = "hover";
  f.hoverY = f.y;
}

export function resume(f) {
  f.mode = "flying";
  f.grace = GRACE;
}

/** Avança a física um passo. Devolve { cause, speed } se o pássaro bateu. */
export function stepFlight(f, input, dt, obstacles) {
  if (f.mode === "flying") return stepFlying(f, input, dt, obstacles);
  switch (f.mode) {
    case "ground":
      f.pitch = damp(f.pitch, 0, 6, dt);
      f.roll = damp(f.roll, 0, 6, dt);
      break;
    case "hover":
      steer(f, input, dt);
      f.y = f.hoverY + Math.sin(performance.now() / 600) * 0.25;
      f.vy = 0;
      f.pitch = damp(f.pitch, 0, 6, dt);
      break;
    case "takeoff":
      stepTakeoff(f, dt);
      f.vx = Math.sin(f.yaw) * f.speed;
      f.vz = Math.cos(f.yaw) * f.speed;
      break;
    case "crashed":
      stepCrashed(f, dt);
      break;
  }
  syncQuat(f);
  return null;
}

function steer(f, input, dt) {
  // Como avião: asa esquerda mais alta inclina e vira para a direita.
  const armTilt =
    (input.leftUpper - input.rightUpper) * 0.62 +
    ((input.leftFore || 0) - (input.rightFore || 0)) * 0.38;
  const tilt = Math.abs(armTilt);
  const s = tilt < 0.05 ? 0 : Math.sign(armTilt) * Math.pow(clamp((tilt - 0.05) / 0.68, 0, 1), 0.9);
  f.roll = dampAngle(f.roll, s * 0.6, Math.abs(s) < 0.05 ? 4.6 : 3.8 * f.stats.turn, dt);
}

function advance(f, dt) {
  const ahead = Math.cos(f.pitch);
  f.x += Math.sin(f.yaw) * ahead * f.speed * dt;
  f.z += Math.cos(f.yaw) * ahead * f.speed * dt;
  f.y += f.vy * dt;
}

function stepTakeoff(f, dt) {
  f.t += dt;
  const k = clamp(f.t / TAKEOFF_TIME, 0, 1);
  f.speed = damp(f.speed, 12 * f.stats.speed, 1.3, dt);
  f.vy = damp(f.vy, 10 * (1 - k) + 1.5, 3.5, dt);
  f.pitch = damp(f.pitch, -0.3 * (1 - k), 3, dt);
  f.roll = damp(f.roll, 0, 3, dt);
  advance(f, dt);
  const ground = groundAt(f.x, f.z, f.y);
  f.y = Math.max(f.y, ground + Math.min(3, SIT_HEIGHT + f.t * 2));
  if (k >= 1) {
    f.mode = "flying";
    f.grace = GRACE;
  }
  return null;
}

const normal = { x: 0, y: 1, z: 0 };

// Voo livre em 3D: a orientação é um quaternion, então dá para fazer
// looping, parafuso e voar de cabeça para baixo.
const Q = new THREE.Quaternion();
const qa = new THREE.Quaternion();
const F = new THREE.Vector3();
const U = new THREE.Vector3();
const R = new THREE.Vector3();
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler(0, 0, 0, "YXZ");

/** Sincroniza yaw/pitch/roll (usados pela câmera e HUD) a partir do quaternion. */
function syncEuler(f) {
  F.set(0, 0, 1).applyQuaternion(f.q);
  U.set(0, 1, 0).applyQuaternion(f.q);
  R.set(-1, 0, 0).applyQuaternion(f.q);
  f.yaw = Math.atan2(F.x, F.z);
  f.pitch = Math.asin(clamp(-F.y, -1, 1));
  f.roll = Math.atan2(-R.y, U.y);
}

/** Monta o quaternion a partir de yaw/pitch/roll (modos roteirizados). */
export function syncQuat(f) {
  euler.set(f.pitch, f.yaw, f.roll, "YXZ");
  f.q.setFromEuler(euler);
}

function stepFlying(f, input, dt, obstacles) {
  const { stats } = f;
  f.grace = Math.max(0, f.grace - dt);

  const raise = (input.leftUpper + input.rightUpper) * 0.5;
  // Subir/mergulhar exige os DOIS braços: levantar um só é curva, não subida.
  const low = Math.min(input.leftUpper, input.rightUpper);
  const high = Math.max(input.leftUpper, input.rightUpper);
  const bothForward = Math.min(input.leftSweep || 0, input.rightSweep || 0);
  // Braços lá no alto: a cabeça decide. Olhando para cima = nariz para cima;
  // olhando para baixo = asas recolhidas, mergulho. Altitude de verdade só batendo asa.
  const armsUp = clamp((low - 0.6) / 0.4, 0, 1);
  const head = input.headPitch || 0;
  // Braços no alto já sobem; olhar para cima reforça (a cabeça nem sempre é bem lida).
  const climb = armsUp * (0.65 + 0.35 * clamp((head - 0.05) / 0.3, 0, 1));
  // Braços esticados bem na vertical = sobe "retão" (nariz bem para cima).
  const vertical = clamp((low - 1.0) / 0.3, 0, 1);
  // Braços caídos e parados = planeio descendo devagar (não é mergulho).
  // Batendo asa lá embaixo não conta como caído: a batida sobe em qualquer altura.
  const flapping = f.lift > 1.5 || f.extremeT < 0.6;
  const droop = flapping ? 0 : clamp((-high - 0.5) / 0.7, 0, 1);
  // Mergulho: SÓ braços esticados para frente na altura do ombro (não no alto:
  // levantar os braços é gesto de subir, e a webcam lê o punho "à frente" nessa hora).
  // Mergulho apontando: os dois antebraços esticados para frente. Quanto mais
  // apontam para baixo, mais fundo o mergulho (o nariz segue a direção dos braços).
  let dive = 0;
  let diveAngle = 0.95;
  if (input.use3d) {
    // Apontando para frente = antebraço não está para o lado (x pequeno) e vai
    // à frente do corpo (z negativo). Braço caído do lado tem z≈0: não conta.
    const side = Math.max(Math.abs(input.lfx), Math.abs(input.rfx));
    const ahead = Math.min(-input.lfz, -input.rfz);
    const pointing = clamp((0.75 - side) / 0.35, 0, 1) * clamp((ahead - 0.15) / 0.25, 0, 1);
    // Inclinação para baixo dos antebraços (0 = reto à frente, 1 = para o chão).
    const down = -(input.lfy + input.rfy) / 2;
    dive = pointing * clamp((down + 0.15) / 0.2, 0, 1);
    diveAngle = clamp(0.25 + Math.asin(clamp(down, 0, 1)) * 1.2, 0.25, 1.35);
    // Pose de tobogã: braços cruzados no peito (cada antebraço aponta para o
    // outro lado), como o falcão recolhe as asas. Olhar para baixo = mergulho
    // mais fundo; olhando bem para baixo o pássaro despenca quase na vertical.
    const crossed = clamp((input.lfx - 0.25) / 0.3, 0, 1) * clamp((-input.rfx - 0.25) / 0.3, 0, 1);
    if (crossed > dive) {
      dive = crossed;
      diveAngle = clamp(0.5 + clamp(-head, 0, 0.6) * 1.45, 0.5, 1.37);
    }
    f.tucked = crossed;
  } else {
    const level = clamp(1 - (Math.abs(raise) - 0.35) / 0.3, 0, 1);
    dive = clamp((bothForward - 0.35) / 0.35, 0, 1) * level;
  }
  const tuck = 0;

  const armTilt =
    (input.leftUpper - input.rightUpper) * 0.62 +
    ((input.leftFore || 0) - (input.rightFore || 0)) * 0.38;
  const tilt = Math.abs(armTilt);
  const steerAmt = tilt < 0.06 ? 0 : Math.sign(armTilt) * clamp((tilt - 0.06) / 0.9, 0, 2.2);
  const hard = clamp((Math.abs(steerAmt) - 0.9) / 0.7, 0, 1); // 0 = curva normal, 1 = curva fechada

  syncEuler(f);
  // Três níveis: inclinação média = curva; bastante = curva fechada (quase 80°);
  // extrema (um braço lá em cima, outro lá embaixo) = parafuso.
  let rollRate;
  if (Math.abs(steerAmt) > 1.6) rollRate = Math.sign(steerAmt) * (2.8 + (Math.abs(steerAmt) - 1.6) * 3) * stats.turn;
  else {
    const bank = Math.sign(steerAmt) * (Math.min(Math.abs(steerAmt), 0.9) * 1.0 + hard * 0.4);
    let err = bank - f.roll;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    rollRate = clamp(err * 3.6, -3.2, 3.2) * stats.turn;
  }
  // Arfagem livre: segurar "subir" completa um looping.
  // Sem comando o nariz volta sozinho para o horizonte (com asas caídas, fica levemente baixo).
  // Cada gesto define um ângulo de nariz e o pássaro para nele. Só "subir" forte
  // (braços bem acima dos ombros) continua girando: é assim que sai o looping.
  let pitchRate;
  // Looping: braços no alto, olhando bem para cima, e com embalo (velocidade).
  if (climb > 0.95 && f.speed > 18) pitchRate = 1.6 * stats.climb;
  else {
    const target = droop * 0.05 + dive * diveAngle - climb * (0.35 + vertical * 0.45);
    pitchRate = (f.pitch - target) * 2.2 * Math.cos(f.roll);
  }
  // Curva: a sustentação inclinada puxa o nariz para o lado.
  // Na curva fechada o pássaro "puxa" forte: dá meia-volta em ~2 s.
  const turnRate = Math.sin(f.roll) * (0.7 + clamp(f.speed / 30, 0, 1) * 0.5) * (1 + hard * 1.2) * stats.turn;

  qa.setFromAxisAngle(AZ, rollRate * dt);
  f.q.multiply(qa);
  qa.setFromAxisAngle(AX, -pitchRate * dt);
  f.q.multiply(qa);
  qa.setFromAxisAngle(AY, -turnRate * dt);
  f.q.premultiply(qa);

  // Fora do mapa: puxa de volta para o centro.
  if (Math.hypot(f.x, f.z) > 700) {
    let err = Math.atan2(-f.x, -f.z) - f.yaw;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    qa.setFromAxisAngle(AY, err * 1.2 * dt);
    f.q.premultiply(qa);
  }
  f.q.normalize();
  syncEuler(f);

  // Batida de asa por amplitude: o braço varreu ~25° (para baixo OU para cima)
  // em menos de 1 s desde o último extremo. Cada batida = um degrau de altitude.
  f.flapCooldown -= dt;
  f.extremeT += dt;
  if (f.extremeT > 1 || (raise - f.extreme) * f.dir > 0) {
    // ainda indo na mesma direção (ou demorou demais): o extremo acompanha o braço
    f.extreme = raise;
    f.extremeT = 0;
  }
  const swing = Math.abs(raise - f.extreme);
  if (swing > 0.35) {
    if (f.flapCooldown <= 0) {
      const power = clamp(swing / 0.9, 0.5, 1);
      // Impulso seco para cima: forte na hora, some em ~0,5 s. O nariz levanta um pouco.
      f.lift += 16 * power * stats.climb;
      f.speed += 1.2 * power * stats.speed;
      qa.setFromAxisAngle(AX, -0.1 * power);
      f.q.multiply(qa);
      f.flapCooldown = 0.3;
      f.flaps++;
    }
    f.dir = Math.sign(raise - f.extreme);
    f.extreme = raise;
    f.extremeT = 0;
  }
  f.lift = damp(f.lift, 0, 3, dt);

  // Energia: descer acelera, subir freia.
  const shake = Math.max(0, input.shake - 0.6);
  const cruise = 11 * stats.speed;
  // Nariz para cima sem bater asa troca velocidade por altura (e perde fôlego).
  // Arrasto só freia acima do cruzeiro; abaixo dele só recupera voando nivelado ou descendo.
  const drag = f.speed > cruise ? (f.speed - cruise) * 0.3 : (f.speed - cruise) * 0.3 * Math.max(0, 1 - F.y * 6);
  // Braços no alto: a asa ainda empurra um pouco, dá para subir devagar sem estolar.
  f.speed += (-F.y * 14 + climb * (5 + vertical * 6) * stats.climb + shake * 8 * stats.speed - drag + (tuck + droop) * 6 * Math.max(0, -F.y)) * dt;
  f.speed = clamp(f.speed, 7, 70 * stats.speed);
  // Perto do estol o nariz cai sozinho.
  if (f.speed < 8.5 && F.y > 0) {
    qa.setFromAxisAngle(AX, 1.2 * dt);
    f.q.multiply(qa);
  }

  // Planando o pássaro afunda devagar (menos quanto mais rápido); a batida compensa.
  const sink = (clamp(0.9 - f.speed * 0.03, 0.3, 0.9) + droop * 0.8) * Math.max(0, U.y);
  f.vx = F.x * f.speed;
  f.vy = F.y * f.speed - sink + f.lift;
  f.vz = F.z * f.speed;
  f.x += f.vx * dt;
  f.y += f.vy * dt;
  f.z += f.vz * dt;
  if (f.y > 190) {
    f.y = 190;
    qa.setFromAxisAngle(AX, 0.8 * dt);
    f.q.multiply(qa);
  }
  const hit = collide(f, obstacles);
  syncEuler(f);
  return hit;
}

function collide(f, obstacles) {
  const vx = f.vx;
  const vz = f.vz;
  const kmh = f.speed * 3.6;
  const safe = f.grace > 0;

  const isl = insideIsland(f.x, f.y, f.z);
  if (isl && !safe) return crash(f, "Você bateu numa ilha flutuante", kmh);

  for (const o of obstacles) {
    const dx = f.x - o.x;
    const dz = f.z - o.z;
    const r = o.r + BODY * 0.6;
    if (dx * dx + dz * dz < r * r && f.y > o.y0 && f.y < o.y1) {
      if (!safe) return crash(f, o.kind === "rock" ? "Você bateu numa pedra" : "Você bateu numa árvore", kmh);
    }
  }

  const terrain = groundAt(f.x, f.z, f.y);
  if (terrain < WATER && f.y < WATER + BODY) {
    if (f.vy < -9 && !safe) return crash(f, "Você mergulhou na água rápido demais", kmh);
    f.y = WATER + BODY;
    if (f.vy < 0) f.vy = 0;
    level(f, 0.25);
    return null;
  }
  if (f.y < terrain + BODY) {
    terrainNormal(f.x, f.z, normal);
    const impact = -(vx * normal.x + f.vy * normal.y + vz * normal.z);
    const steep = normal.y < 0.93;
    if ((impact > CRASH_IMPACT || (steep && impact > 3)) && !safe) {
      return crash(f, normal.y < 0.75 ? "Você bateu na montanha" : "Você bateu no chão", kmh);
    }
    // Encostou de leve: desliza e o nariz volta para o horizonte.
    f.y = terrain + BODY;
    if (f.vy < 0) f.vy = 0;
    level(f, 0.25);
  }
  return null;
}

function level(f, k) {
  syncEuler(f);
  euler.set(Math.min(f.pitch, 0), f.yaw, f.roll * (1 - k), "YXZ");
  Q.setFromEuler(euler);
  f.q.slerp(Q, k);
}

function crash(f, cause, kmh) {
  f.mode = "crashed";
  f.t = 0;
  f.crash = { cause, kmh: Math.round(kmh) };
  f.landed = false;
  f.vy = Math.max(f.vy, 4);
  f.spin = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 3);
  return f.crash;
}

function stepCrashed(f, dt) {
  f.t += dt;
  f.speed = damp(f.speed, 0, 2.2, dt);
  f.vy -= 24 * dt;
  f.x -= Math.sin(f.yaw) * f.speed * 0.25 * dt;
  f.z -= Math.cos(f.yaw) * f.speed * 0.25 * dt;
  f.y += f.vy * dt;
  const floor = Math.max(groundAt(f.x, f.z, f.y), WATER) + 0.35;
  if (f.y < floor) {
    f.y = floor;
    f.vy = Math.abs(f.vy) * 0.25;
    f.spin *= 0.35;
    f.landed = true;
  }
  if (f.landed && Math.abs(f.spin) < 1.5) {
    // Largado no chão: tombado de lado, bico enfiado, meio torto.
    const side = Math.sign(f.roll || 1);
    f.roll = damp(f.roll, side * (Math.PI / 2 + 0.25), 5, dt);
    f.pitch = damp(f.pitch, 0.35, 4, dt);
    f.spin = 0;
  } else {
    f.roll += f.spin * dt;
    f.pitch = damp(f.pitch, 1.1, 3, dt);
  }
}
