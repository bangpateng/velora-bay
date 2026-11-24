// Cars: a box-built car factory, arcade driving physics, and traffic
// that follows the road graph. Every car (player, traffic, police) is
// the same shape: { x, z, heading, speed, mesh, wheels, kind, color }.
import * as THREE from 'three';
import { clamp, lerp, angleDiff, dist2, pick, mulberry32 } from './util.js';
import { collideCircle, nearestNode, snapToRoad, ROAD_STEP } from './city.js';

export const CAR_KINDS = {
  sedan: { name: 'Marlin Sedan', top: 34, accel: 16, grip: 2.6, color: 0x4a90d9, price: 0 },
  muscle: { name: 'Torro Muscle', top: 40, accel: 19, grip: 2.3, color: 0xc93d3d, price: 1200 },
  sports: { name: 'Vela GT', top: 48, accel: 23, grip: 3.1, color: 0xffd23e, price: 4500 },
  suv: { name: 'Bison SUV', top: 32, accel: 14, grip: 2.2, color: 0x3d7a4a, price: 2000 },
  taxi: { name: 'Bay Taxi', top: 36, accel: 17, grip: 2.7, color: 0xf2c14e, price: 900 },
  van: { name: 'Cargo Van', top: 28, accel: 12, grip: 2.0, color: 0xe8e8e8, price: 0 },
  cop: { name: 'VBPD Cruiser', top: 42, accel: 21, grip: 3.0, color: 0x1c2f4a, price: 0 },
};

const CAR_COLORS = [0x4a90d9, 0xc93d3d, 0xffd23e, 0x3d7a4a, 0xe8e8e8, 0x8a5fc9, 0xe88a3d, 0x2c3440, 0xd9d9d9, 0x7a4a2c];

/** Build a low-poly car mesh: body, cabin, wheels, lights. `kind` picks proportions. */
export function makeCarMesh(kind = 'sedan', color = null) {
  const g = new THREE.Group();
  const bodyColor = color ?? CAR_KINDS[kind]?.color ?? 0x888888;
  const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x182838 });
  const tyreMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
  const long = kind === 'van' ? 5.2 : kind === 'suv' ? 4.9 : 4.4;
  const wide = kind === 'van' || kind === 'suv' ? 2.2 : 2.0;
  const body = new THREE.Mesh(new THREE.BoxGeometry(wide, 0.75, long), bodyMat);
  body.position.y = 0.55; body.castShadow = true; g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(wide * 0.85, 0.65, long * 0.45), glassMat);
  cabin.position.set(0, 1.2, kind === 'van' ? 0 : -0.3); cabin.castShadow = true; g.add(cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [wx, wz] of [[-wide / 2, long / 2 - 0.8], [wide / 2, long / 2 - 0.8], [-wide / 2, -long / 2 + 0.8], [wide / 2, -long / 2 + 0.8]]) {
    const w = new THREE.Mesh(wheelGeo, tyreMat);
    w.position.set(wx, 0.38, wz); w.castShadow = true; g.add(w); wheels.push(w);
  }
  // headlights + taillights
  const lightGeo = new THREE.BoxGeometry(0.35, 0.18, 0.1);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(lightGeo, headMat); h.position.set(s * 0.65, 0.6, long / 2 + 0.02); g.add(h);
    const t = new THREE.Mesh(lightGeo, tailMat); t.position.set(s * 0.65, 0.6, -long / 2 - 0.02); g.add(t);
  }
  if (kind === 'cop') {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 0.4), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    bar.position.set(0, 1.62, -0.3); g.add(bar);
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 0.4), new THREE.MeshBasicMaterial({ color: 0x2244ff }));
    bar2.position.set(0, 1.62, -0.3); bar2.position.x = 0; g.add(bar2);
    g.userData.lightbar = bar;
  }
  if (kind === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.5), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
    sign.position.set(0, 1.62, -0.3); g.add(sign);
  }
  g.userData.wheels = wheels;
  g.userData.long = long; g.userData.wide = wide;
  return g;
}

export function makeCar(kind, x, z, heading, color = null) {
  return {
    kind, x, z, heading, speed: 0, steer: 0,
    mesh: makeCarMesh(kind, color),
    color: color ?? CAR_KINDS[kind]?.color ?? 0x888888,
    driver: null, // 'player' | 'traffic' | 'cop' | null (parked)
    hp: 100, smoke: 0, stuck: 0, target: null, wait: 0,
    airborne: 0, vy: 0, wallCd: 0,
  };
}

export function syncCarMesh(car) {
  car.mesh.position.set(car.x, car.airborne > 0 ? car.airborne : 0, car.z);
  car.mesh.rotation.y = car.heading;
  const spin = car.speed * 0.5;
  for (const w of car.mesh.userData.wheels) w.rotation.x += spin * 0.016;
}

/** Arcade driving: throttle/brake/steer, grip, wall scrape, ramps. */
export function driveCar(car, input, dt, city) {
  const spec = CAR_KINDS[car.kind] || CAR_KINDS.sedan;
  const forward = input.throttle - input.brake;
  const targetSteer = input.steer * clamp(Math.abs(car.speed) / 6, 0, 1);
  car.steer = lerp(car.steer, targetSteer, clamp(dt * 8, 0, 1));
  const accel = forward * spec.accel * (input.boost ? 1.35 : 1);
  car.speed += accel * dt;
  car.speed -= car.speed * (input.handbrake ? 2.4 : 0.35) * dt;
  if (input.handbrake && Math.abs(car.speed) > 4) car.speed -= Math.sign(car.speed) * 6 * dt;
  car.speed = clamp(car.speed, -spec.top * 0.45, spec.top * (input.boost ? 1.12 : 1));
  if (Math.abs(car.speed) < 0.15 && forward === 0) car.speed = 0;
  car.heading += car.steer * spec.grip * (car.speed / spec.top) * dt * (car.speed < 0 ? -1 : 1);
  const nx = car.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.z + Math.cos(car.heading) * car.speed * dt;
  const res = collideCircle(city.colliders, nx, nz, 1.6);
  car.wallCd = Math.max(0, (car.wallCd || 0) - dt);
  let scrape = false;
  if (res.hit && Math.abs(car.speed) > 6 && car.wallCd <= 0) {
    car.hp -= Math.abs(car.speed) * 0.4;
    car.speed *= 0.45;
    car.smoke = Math.min(1, car.smoke + 0.25);
    car.wallCd = 0.6; // one scrape a moment, not a wreck per frame
    scrape = true;
  }
  car.x = clamp(res.x, -340, 340); car.z = clamp(res.z, -340, 340);
  // stunt ramps: launch when crossing one fast
  for (const r of city.ramps) {
    if (car.airborne <= 0 && dist2(car.x, car.z, r.x, r.z) < 4 && Math.abs(car.speed) > 18) {
      car.airborne = 0.01; car.vy = 7;
    }
  }
  if (car.airborne > 0 || car.vy > 0) {
    car.vy -= 22 * dt; car.airborne += car.vy * dt;
    if (car.airborne <= 0) { car.airborne = 0; car.vy = 0; }
  }
  syncCarMesh(car);
  return { hit: res.hit, scrape };
}

// ---------------------------------------------------------------- traffic
export class Traffic {
  constructor(scene, city, seed) {
    this.scene = scene; this.city = city;
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.cars = [];
    const kinds = ['sedan', 'sedan', 'suv', 'van', 'taxi', 'muscle', 'sports'];
    for (let i = 0; i < 22; i++) {
      const node = pick(this.rng, city.roadNodes);
      const kind = pick(this.rng, kinds);
      const car = makeCar(kind, node.x + (this.rng() - 0.5) * 6, node.z + (this.rng() - 0.5) * 6, this.rng() * Math.PI * 2, pick(this.rng, CAR_COLORS));
      car.driver = 'traffic';
      car.speed = 6 + this.rng() * 6;
      car.target = pick(this.rng, city.roadNodes);
      scene.add(car.mesh);
      this.cars.push(car);
    }
  }

  /** Pick a far node in a random direction so traffic keeps circulating. */
  retarget(car) {
    const node = pick(this.rng, this.city.roadNodes);
    car.target = node;
  }

  step(dt, playerPos) {
    for (const car of this.cars) {
      // traffic keeps its distance from the player: thin out near the player
      const d = dist2(car.x, car.z, playerPos.x, playerPos.z);
      if (d > 260) {
        const node = nearestNode(this.city.roadNodes, playerPos.x + (this.rng() - 0.5) * 220, playerPos.z + (this.rng() - 0.5) * 220);
        car.x = node.x; car.z = node.z; car.speed = 8;
        this.retarget(car);
      }
      if (!car.target || dist2(car.x, car.z, car.target.x, car.target.z) < 8) this.retarget(car);
      // steer along the road toward the target: first along x, then z
      const t = car.target;
      const wantHeading = Math.abs(t.x - car.x) > 10
        ? (t.x > car.x ? Math.PI / 2 : -Math.PI / 2)
        : (t.z > car.z ? 0 : Math.PI);
      const diff = angleDiff(car.heading, wantHeading);
      car.heading += clamp(diff, -1.6 * dt, 1.6 * dt);
      const cruise = 9 + Math.sin(car.x * 0.01 + car.z * 0.013) * 2;
      car.speed = lerp(car.speed, cruise, clamp(dt * 0.8, 0, 1));
      const nx = car.x + Math.sin(car.heading) * car.speed * dt;
      const nz = car.z + Math.cos(car.heading) * car.speed * dt;
      const res = collideCircle(this.city.colliders, nx, nz, 1.6);
      car.x = res.x; car.z = res.z;
      if (res.hit) { car.heading += Math.PI * 0.5 * dt * 4; this.retarget(car); }
      syncCarMesh(car);
    }
  }
}

/** Heading that follows the road grid toward (tx, tz): along x first, then z. */
export function roadHeading(x, z, tx, tz) {
  if (Math.abs(tx - x) > 10) return tx > x ? Math.PI / 2 : -Math.PI / 2;
  return tz > z ? 0 : Math.PI;
}

/**
 * Pure-pursuit point on the road route toward (tx, tz): drive along
 * the current road to the intersection nearest the target, then along
 * that road to the target's road, then straight in. Steering at this
 * point, instead of at a bare heading, keeps a car on the road through
 * corners instead of drifting into the blocks.
 */
export function pursuitPoint(x, z, tx, tz) {
  const turnX = Math.round(tx / 60) * 60; // road nearest the target's x
  const turnZ = Math.round(tz / 60) * 60; // road nearest the target's z
  const zRoad = Math.round(z / 60) * 60;
  if (Math.abs(turnX - x) > 12) {
    const px = x + Math.sign(turnX - x) * 25;
    return { x: Math.abs(turnX - px) < Math.abs(turnX - x) ? px : turnX, z: zRoad };
  }
  if (Math.abs(turnZ - z) > 12) {
    const pz = z + Math.sign(turnZ - z) * 25;
    return { x: turnX, z: Math.abs(turnZ - pz) < Math.abs(turnZ - z) ? pz : turnZ };
  }
  return { x: tx, z: tz };
}

/** Parked cars the player can steal, placed near roads across the city. */
export function spawnParkedCars(scene, city, seed) {
  const rng = mulberry32(seed ^ 0x51ab);
  const cars = [];
  const kinds = ['sedan', 'muscle', 'sports', 'suv', 'taxi', 'van', 'sedan', 'muscle'];
  // Parked at the roadside: one coordinate on a road line, the other a
  // few metres off it, so no car ever spawns inside a building.
  const spots = [
    [8, -60], [-68, 30], [128, 90], [-128, -90], [68, 180], [-8, 150],
    [208, -30], [-208, 120], [8, -150], [-68, -30], [128, -180], [-188, 180],
    [68, 30], [-128, -150], [188, 210], [-238, -180], [238, 150], [8, -90],
  ];
  for (let i = 0; i < spots.length; i++) {
    const [sx, sz] = spots[i];
    const kind = kinds[i % kinds.length];
    const car = makeCar(kind, sx, sz, pick(rng, [0, Math.PI / 2, Math.PI, -Math.PI / 2]), pick(rng, CAR_COLORS));
    car.driver = null;
    scene.add(car.mesh);
    syncCarMesh(car);
    cars.push(car);
  }
  return cars;
}
