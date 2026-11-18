// Cars: procedural low-poly models, arcade driving physics, traffic AI
// that follows the road network, parked cars to steal, and damage smoke.
// Police cars here are visual stand-ins for Phase A's chase staging;
// Phase B wires them to a real pursuit AI.
import * as THREE from 'three';
import { CAR_TUNING, TRAFFIC_TUNING } from './config.js';
import { createRng, pick, range, clamp, angleLerp, wrapAngle } from './utils.js';
import { resolveBuildingCollision } from './player.js';

const CAR_COLORS = [0xc0392b, 0x2e6f8e, 0xe0a030, 0x7d8b9c, 0x3a3f45, 0xd8d3c8, 0x5b7a4a, 0x8e44ad];
const TAXI_COLOR = 0xf2c200;
const POLICE_COLOR = 0x1c2733;

function box(w, h, d, color, roughness = 0.5, metalness = 0.35) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness, metalness }),
  );
  mesh.castShadow = true;
  return mesh;
}

// Build one car model. kind: sedan | taxi | van | sport | police.
// The group faces +Z when heading is 0; wheels are kept in userData so
// the physics can steer and spin them.
export function makeCarModel(color, kind = 'sedan') {
  const group = new THREE.Group();
  const isVan = kind === 'van';
  const isSport = kind === 'sport';
  const bodyLen = isVan ? 4.6 : isSport ? 4.0 : 4.3;
  const bodyW = isVan ? 2.0 : 1.9;
  const bodyH = isVan ? 1.05 : 0.62;
  const paint = kind === 'taxi' ? TAXI_COLOR : kind === 'police' ? POLICE_COLOR : color;

  const body = box(bodyW, bodyH, bodyLen, paint);
  body.position.y = 0.62;
  group.add(body);

  const cabin = box(bodyW * 0.86, isVan ? 0.85 : 0.55, isVan ? 3.4 : 2.1,
    0x18222e, 0.15, 0.6);
  cabin.position.set(0, bodyH + 0.62, isVan ? -0.2 : -0.25);
  group.add(cabin);

  if (kind === 'taxi') {
    const sign = box(0.7, 0.18, 0.4, 0xf2c200, 0.4, 0.1);
    sign.position.set(0, 1.62, -0.25);
    group.add(sign);
    const checker = box(bodyW + 0.02, 0.14, bodyLen * 0.5, 0x111111, 0.6, 0);
    checker.position.set(0, 0.95, 0);
    group.add(checker);
  }
  if (kind === 'police') {
    const bar = box(1.1, 0.14, 0.5, 0xdddddd, 0.3, 0.4);
    bar.position.set(0, 1.62, -0.25);
    group.add(bar);
    const red = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.16, 0.4),
      new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff1111, emissiveIntensity: 1.6 }),
    );
    red.position.set(-0.3, 1.74, -0.25);
    group.add(red);
    const blue = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.16, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x2244ff, emissive: 0x1122ff, emissiveIntensity: 1.6 }),
    );
    blue.position.set(0.3, 1.74, -0.25);
    group.add(blue);
    const star = box(bodyW + 0.02, 0.3, 1.2, 0xeeeeee, 0.5, 0.1);
    star.position.set(0, 0.66, 0.4);
    group.add(star);
  }
  if (isSport) {
    const spoiler = box(1.7, 0.08, 0.4, 0x111111, 0.4, 0.5);
    spoiler.position.set(0, 1.05, -bodyLen / 2 + 0.15);
    group.add(spoiler);
  }

  // Headlights and taillights.
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6c8, emissive: 0xffedb0, emissiveIntensity: 0.9 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, emissive: 0xaa1111, emissiveIntensity: 0.9 });
  for (const sx of [-0.6, 0.6]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.08), headMat);
    head.position.set(sx, 0.68, bodyLen / 2 + 0.01);
    group.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.08), tailMat);
    tail.position.set(sx, 0.68, -bodyLen / 2 - 0.01);
    group.add(tail);
  }

  // Wheels.
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
  const hubGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.3, 8);
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.3, metalness: 0.8 });
  const wheels = [];
  for (const [wx, wz] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]) {
    const wheel = new THREE.Group();
    const tyre = new THREE.Mesh(wheelGeo, wheelMat);
    tyre.rotation.z = Math.PI / 2;
    tyre.castShadow = true;
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.rotation.z = Math.PI / 2;
    wheel.add(tyre);
    wheel.add(hub);
    wheel.position.set(wx, 0.36, wz);
    group.add(wheel);
    wheels.push(wheel);
  }
  group.userData.wheels = wheels;
  group.userData.frontWheels = [wheels[0], wheels[1]];
  group.userData.kind = kind;
  group.userData.bodyLen = bodyLen;
  return group;
}

export function createCar(scene, kind, color, x, z, heading) {
  const model = makeCarModel(color, kind);
  model.position.set(x, 0, z);
  model.rotation.y = heading;
  scene.add(model);
  return {
    model,
    kind,
    pos: model.position,
    heading,
    speed: 0,
    steer: 0,
    damage: 0,
    wrecked: false,
    smokeTimer: 0,
    isPlayer: false,
    // Traffic AI fields (unused for the player's car).
    route: null,
    routeIndex: 0,
    cruise: TRAFFIC_TUNING.cruiseSpeed,
    stopped: 0,
  };
}

// A rectangular loop around one city block, on the roads that border it.
export function makeLoopRoute(rng, roadLines) {
  const inner = roadLines.filter((v) => Math.abs(v) <= 58);
  const x0 = pick(rng, inner);
  const z0 = pick(rng, inner);
  const x1 = x0 + 58;
  const z1 = z0 + 58;
  const lane = 3.2;
  const dir = rng() < 0.5 ? 1 : -1;
  const loop = [
    { x: x0 + lane, z: z0 + lane },
    { x: x1 - lane, z: z0 + lane },
    { x: x1 - lane, z: z1 - lane },
    { x: x0 + lane, z: z1 - lane },
  ];
  return dir > 0 ? loop : loop.reverse();
}

export function spawnTraffic(scene, city, count = TRAFFIC_TUNING.count) {
  const rng = createRng(99);
  const cars = [];
  const kinds = ['sedan', 'sedan', 'taxi', 'van', 'sedan', 'sport'];
  for (let i = 0; i < count; i += 1) {
    const kind = pick(rng, kinds);
    const route = makeLoopRoute(rng, city.roadLines);
    const start = route[Math.floor(rng() * route.length)];
    const car = createCar(scene, kind, pick(rng, CAR_COLORS), start.x, start.z, 0);
    car.route = route;
    car.routeIndex = 1;
    car.cruise = TRAFFIC_TUNING.cruiseSpeed + range(rng, -TRAFFIC_TUNING.cruiseVariance, TRAFFIC_TUNING.cruiseVariance);
    cars.push(car);
  }
  return cars;
}

export function spawnParkedCars(scene, city, count = 8) {
  const rng = createRng(7);
  const cars = [];
  const kinds = ['sedan', 'sedan', 'taxi', 'van', 'sport', 'sedan'];
  for (let i = 0; i < count; i += 1) {
    const line = pick(rng, city.roadLines);
    const along = range(rng, -140, 140);
    const horizontal = rng() < 0.5;
    const x = horizontal ? along : line + (rng() < 0.5 ? 5.2 : -5.2);
    const z = horizontal ? line + (rng() < 0.5 ? 5.2 : -5.2) : along;
    const heading = horizontal ? (rng() < 0.5 ? 0 : Math.PI) : (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    const car = createCar(scene, pick(rng, kinds), pick(rng, CAR_COLORS), x, z, heading);
    car.parked = true;
    cars.push(car);
  }
  return cars;
}

function nearestOtherCar(car, cars) {
  let best = null;
  let bestD = 7;
  for (const other of cars) {
    if (other === car || other.wrecked) continue;
    const d = Math.hypot(other.pos.x - car.pos.x, other.pos.z - car.pos.z);
    if (d < bestD) { bestD = d; best = other; }
  }
  return best;
}

// Traffic AI: follow the loop route, ease into corners, brake for the
// car ahead, and occasionally pause as if stuck at a light.
export function updateTrafficCar(car, dt, cars, colliders) {
  if (!car.route) return;
  const target = car.route[car.routeIndex];
  const dx = target.x - car.pos.x;
  const dz = target.z - car.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 3) {
    car.routeIndex = (car.routeIndex + 1) % car.route.length;
    return;
  }
  const wantHeading = Math.atan2(dx, dz);
  car.heading = angleLerp(car.heading, wantHeading, Math.min(1, dt * 3.5));
  const ahead = nearestOtherCar(car, cars);
  let targetSpeed = car.cruise;
  if (ahead) {
    const gap = Math.hypot(ahead.pos.x - car.pos.x, ahead.pos.z - car.pos.z);
    if (gap < 9) targetSpeed = Math.min(targetSpeed, Math.max(0, (gap - 5) * 1.2));
  }
  if (car.stopped > 0) {
    car.stopped -= dt;
    targetSpeed = 0;
  } else if (Math.random() < dt * 0.02) {
    car.stopped = 1 + Math.random() * 2; // brief light pause
  }
  car.speed += clamp(targetSpeed - car.speed, -14 * dt, 8 * dt);
  car.pos.x += Math.sin(car.heading) * car.speed * dt;
  car.pos.z += Math.cos(car.heading) * car.speed * dt;
  car.model.rotation.y = car.heading;
  spinWheels(car, dt);
}

// Arcade player driving: throttle, brake/reverse, speed-sensitive
// steering, handbrake drift, building push-out and car-vs-car push.
export function updatePlayerCar(car, dt, input, cars, colliders) {
  const kindFactor = CAR_TUNING.kindSpeed[car.kind] ?? 1;
  const accelFactor = CAR_TUNING.kindAccel[car.kind] ?? 1;
  const maxSpeed = CAR_TUNING.maxSpeed * kindFactor;
  const speed01 = clamp(Math.abs(car.speed) / maxSpeed, 0, 1);
  let steerTarget = 0;
  if (input.left) steerTarget = 1;
  if (input.right) steerTarget = -1;
  const steerEase = clamp(1 - speed01 * 0.65, 0.35, 1);
  car.steer += clamp(steerTarget * steerEase - car.steer, -CAR_TUNING.steerSpeed * dt, CAR_TUNING.steerSpeed * dt);

  if (input.forward) car.speed += CAR_TUNING.engineAccel * accelFactor * dt;
  if (input.back) {
    if (car.speed > 0.5) car.speed -= CAR_TUNING.brakeForce * dt;
    else car.speed -= CAR_TUNING.reverseAccel * dt;
  }
  car.speed -= car.speed * CAR_TUNING.drag * dt * 0.4;
  if (!input.forward && !input.back) car.speed -= Math.sign(car.speed) * 6 * dt;
  if (Math.abs(car.speed) < 0.15 && !input.forward && !input.back) car.speed = 0;
  car.speed = clamp(car.speed, -CAR_TUNING.maxReverse, maxSpeed);

  const grip = input.handbrake ? CAR_TUNING.handbrakeGrip : CAR_TUNING.grip;
  const turnRate = car.steer * CAR_TUNING.steerAngle * clamp(Math.abs(car.speed) / 8, 0, 1) * Math.sign(car.speed || 1);
  car.heading += turnRate * dt * grip * 0.45;
  car.pos.x += Math.sin(car.heading) * car.speed * dt;
  car.pos.z += Math.cos(car.heading) * car.speed * dt;
  // City edge: Velora Bay ends at the map bounds — bounce the speed
  // off instead of driving into empty ground.
  const B = 168;
  if (car.pos.x < -B || car.pos.x > B || car.pos.z < -B || car.pos.z > B) {
    car.pos.x = clamp(car.pos.x, -B, B);
    car.pos.z = clamp(car.pos.z, -B, B);
    car.speed *= 0.4;
  }
  resolveBuildingCollision(car.pos, CAR_TUNING.radius, colliders);

  // Car-vs-car shove: both cars get pushed apart and lose a little speed.
  for (const other of cars) {
    if (other === car || other.wrecked) continue;
    const dx = car.pos.x - other.pos.x;
    const dz = car.pos.z - other.pos.z;
    const d = Math.hypot(dx, dz);
    const min = 3.1;
    if (d > 0.01 && d < min) {
      const push = (min - d) / 2;
      const nx = dx / d;
      const nz = dz / d;
      car.pos.x += nx * push;
      car.pos.z += nz * push;
      other.pos.x -= nx * push;
      other.pos.z -= nz * push;
      car.speed *= 0.85;
      if (other.route) other.speed *= 0.7;
      damageCar(car, 4);
      damageCar(other, 4);
    }
  }
  car.model.rotation.y = car.heading;
  const wheels = car.model.userData.wheels || [];
  wheels.forEach((wheel, i) => {
    wheel.rotation.x += car.speed * dt * 1.4;
    if (i < 2) wheel.rotation.y = car.steer * 0.35;
  });
  return speed01;
}

function spinWheels(car, dt) {
  const wheels = car.model.userData.wheels || [];
  for (const wheel of wheels) wheel.rotation.x += car.speed * dt * 1.4;
}

// Damage accumulates from crashes; past 100 the car is wrecked and
// puffs smoke until Phase B's repair/respawn flow handles it.
export function damageCar(car, amount) {
  car.damage = Math.min(120, car.damage + amount);
  if (car.damage >= 100 && !car.wrecked) {
    car.wrecked = true;
    car.speed = 0;
  }
  return car.wrecked;
}

// Smoke puff positions for a wrecked car, so main.js can attach a
// cheap particle sprite without the car knowing about particles.
export function wreckSmokePosition(car, out) {
  out.set(car.pos.x, 1.6, car.pos.z);
  return out;
}

export function findNearestCar(pos, cars, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const car of cars) {
    if (car.wrecked) continue;
    const d = Math.hypot(car.pos.x - pos.x, car.pos.z - pos.z);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

// Despawn traffic that drifted far from the player and respawn it on a
// fresh loop near the player, so the streets always feel busy.
export function recycleTraffic(traffic, scene, city, playerPos) {
  for (const car of traffic) {
    const d = Math.hypot(car.pos.x - playerPos.x, car.pos.z - playerPos.z);
    if (d > TRAFFIC_TUNING.despawnDistance) {
      const rng = createRng((Math.random() * 1e9) | 0);
      const route = makeLoopRoute(rng, city.roadLines);
      const start = route[0];
      car.route = route;
      car.routeIndex = 1;
      car.pos.x = start.x;
      car.pos.z = start.z;
      car.heading = 0;
      car.speed = 0;
    }
  }
}
