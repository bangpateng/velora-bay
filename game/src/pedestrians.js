// Pedestrians: low-poly walkers on the sidewalks. They stroll, wait at
// crossings, flee gunshots and speeding cars, and keep their distance.
import * as THREE from 'three';
import { createRng, pick, range, clamp, angleLerp } from './utils.js';

const SHIRT_COLORS = [
  0xd84a4a, 0x4a90d8, 0x4ad87a, 0xe0a030, 0x8e44ad, 0xe8e4d8,
  0x2e6f8e, 0xd87a4a, 0x5b7a4a, 0xc0392b, 0x7d8b9c, 0xf2c200,
];
const SKIN_COLORS = [0xc98d64, 0x8a5a38, 0xe8b98a, 0x6b4423, 0xd8a077];
const PANTS_COLORS = [0x2b2f36, 0x3a4a5a, 0x5a4a3a, 0x6a6a6a, 0x24303e];

export const PED_COUNT = 40;

// A sidewalk point: just off a road line, so walkers stay off the asphalt.
export function sidewalkPoint(rng, roadLines, nearX = 0, nearZ = 0, radius = 90) {
  const line = pick(rng, roadLines);
  const along = range(rng, -150, 150);
  const side = rng() < 0.5 ? 1 : -1;
  const off = 9.5 + rng() * 3;
  let x;
  let z;
  if (rng() < 0.5) {
    x = along;
    z = line + side * off;
  } else {
    x = line + side * off;
    z = along;
  }
  // Bias the point toward the given centre when one is supplied.
  if (radius < 200) {
    x = clamp(x, nearX - radius, nearX + radius);
    z = clamp(z, nearZ - radius, nearZ + radius);
  }
  return { x, z };
}

function buildPedModel(rng) {
  const group = new THREE.Group();
  const height = range(rng, 0.92, 1.1);
  const skin = new THREE.MeshStandardMaterial({ color: pick(rng, SKIN_COLORS), roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color: pick(rng, SHIRT_COLORS), roughness: 0.9 });
  const pants = new THREE.MeshStandardMaterial({ color: pick(rng, PANTS_COLORS), roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.66, 0.32), shirt);
  torso.position.y = 1.08;
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.32), skin);
  head.position.y = 1.62;
  head.castShadow = true;
  group.add(head);
  // A few walkers wear a cap or a beanie.
  if (rng() < 0.4) {
    const hat = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.12, 0.36),
      new THREE.MeshStandardMaterial({ color: pick(rng, SHIRT_COLORS), roughness: 0.85 }),
    );
    hat.position.y = 1.82;
    group.add(hat);
  }
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.72, 0.24), pants);
  legL.position.set(-0.15, 0.36, 0);
  legL.castShadow = true;
  group.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.72, 0.24), pants);
  legR.position.set(0.15, 0.36, 0);
  legR.castShadow = true;
  group.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.6, 0.2), shirt);
  armL.position.set(-0.38, 1.08, 0);
  group.add(armL);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.6, 0.2), shirt);
  armR.position.set(0.38, 1.08, 0);
  group.add(armR);
  group.scale.setScalar(height);
  group.userData = { legL, legR, armL, armR, height };
  return group;
}

export function createPedestrians(scene, city, count = PED_COUNT) {
  const rng = createRng(4242);
  const peds = [];
  for (let i = 0; i < count; i += 1) {
    const spot = sidewalkPoint(rng, city.roadLines, 0, 0, 200);
    const model = buildPedModel(rng);
    model.position.set(spot.x, 0, spot.z);
    scene.add(model);
    const dest = sidewalkPoint(rng, city.roadLines, spot.x, spot.z, 70);
    peds.push({
      model,
      pos: model.position,
      heading: rng() * Math.PI * 2,
      speed: range(rng, 1.1, 1.9),
      walkSpeed: range(rng, 1.1, 1.9),
      dest,
      state: 'walk', // walk | wait | flee | down
      waitTimer: 0,
      downTimer: 0,
      walkPhase: rng() * 6,
      alive: true,
    });
  }
  return peds;
}

// Is this point close to a road crossing (both coordinates near a line)?
function nearCrossing(x, z, roadLines) {
  const nearLine = (v) => roadLines.some((line) => Math.abs(v - line) < 9);
  return nearLine(x) && nearLine(z);
}

export function updatePedestrians(peds, dt, ctx) {
  const { playerPos, playerSpeed, playerInCar, gunshotPos, cars, bounds } = ctx;
  for (const ped of peds) {
    if (!ped.alive) {
      ped.downTimer -= dt;
      if (ped.downTimer <= 0) {
        // Get back up far from the player: respawn on a nearby sidewalk.
        const rng = createRng((Math.random() * 1e9) | 0);
        const spot = sidewalkPoint(rng, ctx.city.roadLines, playerPos.x, playerPos.z, 70);
        ped.pos.set(spot.x, 0, spot.z);
        ped.model.rotation.x = 0;
        ped.model.visible = true;
        ped.alive = true;
        ped.state = 'walk';
        ped.dest = sidewalkPoint(rng, ctx.city.roadLines, spot.x, spot.z, 70);
      }
      continue;
    }
    // --- Flee triggers ------------------------------------------------
    let fleeFrom = null;
    if (gunshotPos) {
      const gd = Math.hypot(ped.pos.x - gunshotPos.x, ped.pos.z - gunshotPos.z);
      if (gd < 38) fleeFrom = gunshotPos;
    }
    if (!fleeFrom && cars) {
      for (const car of cars) {
        if (Math.abs(car.speed || 0) < 8) continue;
        const cd = Math.hypot(ped.pos.x - car.pos.x, ped.pos.z - car.pos.z);
        if (cd < 6) { fleeFrom = car.pos; break; }
      }
    }
    if (fleeFrom) {
      ped.state = 'flee';
      const dx = ped.pos.x - fleeFrom.x;
      const dz = ped.pos.z - fleeFrom.z;
      const d = Math.hypot(dx, dz) || 1;
      ped.dest = {
        x: clamp(ped.pos.x + (dx / d) * 40, bounds.min + 6, bounds.max - 6),
        z: clamp(ped.pos.z + (dz / d) * 40, bounds.min + 6, bounds.max - 6),
      };
    }

    if (ped.state === 'wait') {
      ped.waitTimer -= dt;
      if (ped.waitTimer <= 0) ped.state = 'walk';
    } else {
      const dx = ped.dest.x - ped.pos.x;
      const dz = ped.dest.z - ped.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1.5) {
        // Arrived: pick a new destination, or wait a beat at a crossing.
        if (ped.state === 'flee') {
          ped.state = 'walk';
          ped.speed = ped.walkSpeed;
        } else if (nearCrossing(ped.pos.x, ped.pos.z, ctx.city.roadLines) && Math.random() < 0.5) {
          ped.state = 'wait';
          ped.waitTimer = 1 + Math.random() * 2.5;
        }
        const rng = createRng((Math.random() * 1e9) | 0);
        ped.dest = sidewalkPoint(rng, ctx.city.roadLines, ped.pos.x, ped.pos.z, 70);
      } else {
        const speed = ped.state === 'flee' ? 4.6 : ped.walkSpeed;
        const want = Math.atan2(dx, dz);
        ped.heading = angleLerp(ped.heading, want, Math.min(1, dt * 5));
        ped.pos.x += Math.sin(ped.heading) * speed * dt;
        ped.pos.z += Math.cos(ped.heading) * speed * dt;
        ped.walkPhase += speed * dt * 2.4;
        const swing = Math.sin(ped.walkPhase) * 0.5;
        const { legL, legR, armL, armR } = ped.model.userData;
        legL.rotation.x = swing;
        legR.rotation.x = -swing;
        armL.rotation.x = -swing * 0.8;
        armR.rotation.x = swing * 0.8;
      }
    }

    // --- Simple separation so walkers do not stack up ------------------
    for (const other of peds) {
      if (other === ped || !other.alive) continue;
      const dx = ped.pos.x - other.pos.x;
      const dz = ped.pos.z - other.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 1.1) {
        ped.pos.x += (dx / d) * (1.1 - d) * 0.5;
        ped.pos.z += (dz / d) * (1.1 - d) * 0.5;
      }
    }

    // Keep walkers near the action: respawn stragglers beside the player.
    const pd = Math.hypot(ped.pos.x - playerPos.x, ped.pos.z - playerPos.z);
    if (pd > 130) {
      const rng = createRng((Math.random() * 1e9) | 0);
      const spot = sidewalkPoint(rng, ctx.city.roadLines, playerPos.x, playerPos.z, 60);
      ped.pos.set(spot.x, 0, spot.z);
      ped.dest = sidewalkPoint(rng, ctx.city.roadLines, spot.x, spot.z, 60);
      ped.state = 'walk';
    }
    void playerSpeed;
    void playerInCar;
    ped.model.rotation.y = ped.heading;
  }
}

// Knock a pedestrian down; they get back up elsewhere.
export function knockPedDown(ped, seconds = 4) {
  if (!ped.alive) return;
  ped.alive = false;
  ped.downTimer = seconds;
  ped.model.rotation.x = -Math.PI / 2;
}

export function nearestPed(pos, peds, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const ped of peds) {
    if (!ped.alive) continue;
    const d = Math.hypot(ped.pos.x - pos.x, ped.pos.z - pos.z);
    if (d < bestD) { bestD = d; best = ped; }
  }
  return best;
}
