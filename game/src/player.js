// Rico Vale on foot: a third-person walker built from boxes, moving
// relative to the camera, with sprint, jump, and entering/exiting cars.
import * as THREE from 'three';
import { PLAYER_TUNING } from './config.js';
import { clamp } from './utils.js';
import { clampToCity } from './city.js';

export function buildPlayerModel() {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98d64, roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x2e6f8e, roughness: 0.9 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.9 });
  const shoes = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), shirt);
  torso.position.y = 1.15;
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.34), skin);
  head.position.y = 1.72;
  head.castShadow = true;
  group.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.38), new THREE.MeshStandardMaterial({ color: 0xd8b13a, roughness: 0.8 }));
  cap.position.y = 1.92;
  group.add(cap);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.78, 0.26), pants);
  legL.position.set(-0.17, 0.39, 0);
  legL.castShadow = true;
  group.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.78, 0.26), pants);
  legR.position.set(0.17, 0.39, 0);
  legR.castShadow = true;
  group.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.66, 0.22), shirt);
  armL.position.set(-0.42, 1.15, 0);
  armL.castShadow = true;
  group.add(armL);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.66, 0.22), shirt);
  armR.position.set(0.42, 1.15, 0);
  armR.castShadow = true;
  group.add(armR);
  group.userData = { legL, legR, armL, armR };
  return group;
}

export function createPlayer(scene, spawn) {
  const model = buildPlayerModel();
  model.position.set(spawn.x, 0, spawn.z);
  scene.add(model);
  return {
    model,
    pos: new THREE.Vector3(spawn.x, 0, spawn.z),
    vel: new THREE.Vector3(),
    heading: Math.PI * 0.75,
    health: PLAYER_TUNING.maxHealth,
    onGround: true,
    inCar: null,
    walkPhase: 0,
    moving: false,
  };
}

// Circle-vs-AABB push-out vs building colliders, shared by cars.
export function resolveBuildingCollision(pos, radius, colliders) {
  for (const c of colliders) {
    const nx = clamp(pos.x, c.minX, c.maxX);
    const nz = clamp(pos.z, c.minZ, c.maxZ);
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * radius;
        pos.z = nz + (dz / d) * radius;
      } else {
        // Centre inside the box: push out along the smallest penetration.
        const pushL = pos.x - c.minX + radius;
        const pushR = c.maxX - pos.x + radius;
        const pushB = pos.z - c.minZ + radius;
        const pushF = c.maxZ - pos.z + radius;
        const m = Math.min(pushL, pushR, pushB, pushF);
        if (m === pushL) pos.x = c.minX - radius;
        else if (m === pushR) pos.x = c.maxX + radius;
        else if (m === pushB) pos.z = c.minZ - radius;
        else pos.z = c.maxZ + radius;
      }
    }
  }
}

export function updatePlayerOnFoot(player, dt, input, cameraYaw, colliders, bounds) {
  const speed = input.sprint ? PLAYER_TUNING.sprintSpeed : PLAYER_TUNING.walkSpeed;
  let fx = 0;
  let fz = 0;
  if (input.forward) fz -= 1;
  if (input.back) fz += 1;
  if (input.left) fx -= 1;
  if (input.right) fx += 1;
  const len = Math.hypot(fx, fz);
  player.moving = len > 0;
  if (len > 0) {
    fx /= len;
    fz /= len;
    // Movement is relative to where the camera looks.
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    const wx = fx * cos - fz * sin;
    const wz = fx * sin + fz * cos;
    player.vel.x += wx * PLAYER_TUNING.accel * dt;
    player.vel.z += wz * PLAYER_TUNING.accel * dt;
    player.heading = Math.atan2(wx, wz);
  }
  // Friction + gravity.
  const damp = Math.max(0, 1 - PLAYER_TUNING.friction * dt);
  player.vel.x *= damp;
  player.vel.z *= damp;
  const hSpeed = Math.hypot(player.vel.x, player.vel.z);
  const cap = speed * 1.15;
  if (hSpeed > cap) {
    player.vel.x *= cap / hSpeed;
    player.vel.z *= cap / hSpeed;
  }
  if (input.jump && player.onGround) {
    player.vel.y = PLAYER_TUNING.jumpSpeed;
    player.onGround = false;
  }
  player.vel.y -= PLAYER_TUNING.gravity * dt;
  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  player.pos.y += player.vel.y * dt;
  if (player.pos.y <= 0) {
    player.pos.y = 0;
    player.vel.y = 0;
    player.onGround = true;
  }
  const clamped = clampToCity(player.pos.x, player.pos.z, bounds);
  player.pos.x = clamped.x;
  player.pos.z = clamped.z;
  resolveBuildingCollision(player.pos, PLAYER_TUNING.radius, colliders);

  // Pose the model: face the heading, swing limbs while walking.
  player.model.position.copy(player.pos);
  player.model.rotation.y = player.heading;
  player.walkPhase += hSpeed * dt * 1.6;
  const swing = player.moving ? Math.sin(player.walkPhase) * 0.55 : 0;
  const { legL, legR, armL, armR } = player.model.userData;
  legL.rotation.x = swing;
  legR.rotation.x = -swing;
  armL.rotation.x = -swing * 0.8;
  armR.rotation.x = swing * 0.8;
}

export function damagePlayer(player, amount) {
  player.health = Math.max(0, player.health - amount);
  return player.health <= 0;
}

export function healPlayer(player, amount) {
  player.health = Math.min(PLAYER_TUNING.maxHealth, player.health + amount);
}
