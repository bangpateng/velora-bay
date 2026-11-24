// People: the on-foot player controller and the pedestrians who fill
// the sidewalks. Characters are box-built figures with a walk swing;
// pedestrians stroll the pavements and flee from gunfire and speeding cars.
import * as THREE from 'three';
import { clamp, lerp, angleDiff, dist2, pick, mulberry32 } from './util.js';
import { collideCircle, ROAD_STEP } from './city.js';

const SHIRTS = [0xd95f4b, 0x4b8fd9, 0x5fd94b, 0xe8c14b, 0x9b5fd9, 0xe8e8e8, 0x2c3440, 0xd94b8a];
const SKINS = [0xe8b88a, 0xc98a5f, 0x8a5a3b, 0xf2c9a0];
const PANTS = [0x2c3440, 0x4a5a6a, 0x6a4a3d, 0x3d3d3d];

export function makePersonMesh(shirt, skin, pants, isPlayer = false) {
  const g = new THREE.Group();
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.85, 0.4), shirtMat);
  torso.position.y = 1.15; torso.castShadow = true; g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.4), skinMat);
  head.position.y = 1.85; head.castShadow = true; g.add(head);
  const hairColors = [0x1c1c1c, 0x5a3a1c, 0x888888];
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.16, 0.42), new THREE.MeshLambertMaterial({ color: isPlayer ? 0x1c1c1c : hairColors[Math.floor(Math.random() * hairColors.length)] }));
  hair.position.y = 2.08; g.add(hair);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.75, 0.32), pantsMat);
  legL.position.set(-0.19, 0.38, 0); legL.castShadow = true; g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.19; g.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.24), shirtMat);
  armL.position.set(-0.48, 1.2, 0); g.add(armL);
  const armR = armL.clone(); armR.position.x = 0.48; g.add(armR);
  g.userData = { legL, legR, armL, armR, head };
  return g;
}

/** Animate limbs from a walk phase; 0 = standing. */
export function animateWalk(mesh, phase, speedFrac) {
  const u = mesh.userData;
  const swing = Math.sin(phase) * 0.55 * speedFrac;
  u.legL.rotation.x = swing; u.legR.rotation.x = -swing;
  u.armL.rotation.x = -swing * 0.8; u.armR.rotation.x = swing * 0.8;
}

/** Move the player on foot: WASD relative to the camera, sprint, collide. */
export function stepPlayerOnFoot(player, input, camHeading, dt, city) {
  const run = input.sprint ? 8.5 : 4.6;
  let mx = 0, mz = 0;
  if (input.forward) { mx += Math.sin(camHeading); mz += Math.cos(camHeading); }
  if (input.back) { mx -= Math.sin(camHeading); mz -= Math.cos(camHeading); }
  if (input.left) { mx += Math.sin(camHeading - Math.PI / 2); mz += Math.cos(camHeading - Math.PI / 2); }
  if (input.right) { mx += Math.sin(camHeading + Math.PI / 2); mz += Math.cos(camHeading + Math.PI / 2); }
  const len = Math.hypot(mx, mz);
  if (len > 0.01) {
    mx /= len; mz /= len;
    const want = Math.atan2(mx, mz);
    player.heading = lerp(player.heading, player.heading + angleDiff(player.heading, want), clamp(dt * 12, 0, 1));
    const nx = player.x + mx * run * dt;
    const nz = player.z + mz * run * dt;
    const res = collideCircle(city.colliders, nx, nz, 0.6);
    player.x = clamp(res.x, -345, 345); player.z = clamp(res.z, -345, 345);
    player.speed = run;
  } else {
    player.speed = 0;
  }
  return len > 0.01;
}

// ---------------------------------------------------------------- pedestrians
export class Pedestrians {
  constructor(scene, city, seed) {
    this.scene = scene; this.city = city;
    this.rng = mulberry32(seed ^ 0x77aa);
    this.peds = [];
    for (let i = 0; i < 36; i++) {
      const node = pick(this.rng, city.roadNodes);
      const mesh = makePersonMesh(pick(this.rng, SHIRTS), pick(this.rng, SKINS), pick(this.rng, PANTS));
      const ped = {
        x: node.x + (this.rng() - 0.5) * 16, z: node.z + (this.rng() - 0.5) * 16,
        heading: this.rng() * Math.PI * 2, speed: 1.1 + this.rng() * 0.9,
        mesh, phase: this.rng() * 6, target: null, flee: 0, panic: 0,
      };
      ped.target = this.nextTarget(ped);
      scene.add(mesh);
      this.peds.push(ped);
    }
  }

  nextTarget(ped) {
    // stroll along pavements: a point one block away, offset from the road
    const node = pick(this.rng, this.city.roadNodes);
    return { x: node.x + (this.rng() - 0.5) * 10, z: node.z + (this.rng() - 0.5) * 10 };
  }

  /** Something loud happened at (x, z): nearby pedestrians panic. */
  scare(x, z, radius) {
    for (const p of this.peds) {
      if (dist2(p.x, p.z, x, z) < radius) {
        p.panic = 1;
        p.target = { x: p.x + (p.x - x) * 2 + (this.rng() - 0.5) * 30, z: p.z + (p.z - z) * 2 + (this.rng() - 0.5) * 30 };
      }
    }
  }

  step(dt, danger) {
    for (const p of this.peds) {
      if (p.panic > 0) p.panic = Math.max(0, p.panic - dt * 0.25);
      if (!p.target || dist2(p.x, p.z, p.target.x, p.target.z) < 3) p.target = this.nextTarget(p);
      const want = Math.atan2(p.target.x - p.x, p.target.z - p.z);
      p.heading = lerp(p.heading, p.heading + angleDiff(p.heading, want), clamp(dt * 4, 0, 1));
      const sp = p.speed * (p.panic > 0 ? 3.2 : 1);
      const nx = p.x + Math.sin(p.heading) * sp * dt;
      const nz = p.z + Math.cos(p.heading) * sp * dt;
      const res = collideCircle(this.city.colliders, nx, nz, 0.5);
      p.x = clamp(res.x, -340, 340); p.z = clamp(res.z, -340, 340);
      p.phase += dt * sp * 3.4;
      p.mesh.position.set(p.x, 0, p.z);
      p.mesh.rotation.y = p.heading;
      animateWalk(p.mesh, p.phase, clamp(sp / 3, 0, 1));
    }
    if (danger) this.scare(danger.x, danger.z, danger.radius);
  }
}
