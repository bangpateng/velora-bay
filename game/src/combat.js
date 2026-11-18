// Combat: pistol with mouse aim, tracers, punch, pickups, and the Kings
// — the rival gang that shoots back, drops cash, and anchors missions.
import * as THREE from 'three';
import { createRng, pick, range, clamp, angleLerp } from './utils.js';
import { damageCar } from './vehicles.js';
import { knockPedDown } from './pedestrians.js';

const GANG_SHIRT = 0x8e1f2f; // Kings wear dark red
const GANG_NAMES = ['Kings'];

export const PICKUP_RESPAWN = 45;

function buildGangModel() {
  const group = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: GANG_SHIRT, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98d64, roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), shirt);
  torso.position.y = 1.15;
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.34), skin);
  head.position.y = 1.72;
  head.castShadow = true;
  group.add(head);
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.1, 0.36),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 }),
  );
  band.position.y = 1.86;
  group.add(band);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.78, 0.26), pants);
  legL.position.set(-0.17, 0.39, 0);
  group.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.78, 0.26), pants);
  legR.position.set(0.17, 0.39, 0);
  group.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.66, 0.22), shirt);
  armL.position.set(-0.42, 1.15, 0);
  group.add(armL);
  // Right arm holds the pistol, raised forward.
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.66, 0.22), shirt);
  armR.position.set(0.42, 1.25, 0.25);
  armR.rotation.x = -1.2;
  group.add(armR);
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.12, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.4, metalness: 0.6 }),
  );
  gun.position.set(0.42, 1.5, 0.55);
  group.add(gun);
  // Health bar: a thin bar floating over the head, scaled by health.
  const barBg = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.12, 0.05),
    new THREE.MeshBasicMaterial({ color: 0x222222 }),
  );
  barBg.position.y = 2.15;
  group.add(barBg);
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(0.96, 0.08, 0.06),
    new THREE.MeshBasicMaterial({ color: 0xff4444 }),
  );
  bar.position.y = 2.15;
  group.add(bar);
  group.userData = { legL, legR, armL, armR, bar };
  return group;
}

// Ray-sphere test: distance along the ray, or Infinity.
function rayHit(origin, dir, center, radius, maxDist) {
  const ox = center.x - origin.x;
  const oy = center.y - origin.y;
  const oz = center.z - origin.z;
  const t = ox * dir.x + oy * dir.y + oz * dir.z;
  if (t < 0 || t > maxDist) return Infinity;
  const px = origin.x + dir.x * t;
  const py = origin.y + dir.y * t;
  const pz = origin.z + dir.z * t;
  const d = Math.hypot(px - center.x, py - center.y, pz - center.z);
  return d <= radius ? t : Infinity;
}

export function createCombatSystem(scene, hooks) {
  const sys = {
    gang: [],
    pickups: [],
    tracers: [],
    sparks: [],
    flash: null,
    flashTimer: 0,
  };

  // --- Muzzle flash: a brief bright sprite at the gun -------------------
  const flashMat = new THREE.SpriteMaterial({
    color: 0xffd23f, transparent: true, opacity: 0, depthWrite: false,
  });
  sys.flash = new THREE.Sprite(flashMat);
  sys.flash.scale.setScalar(1.6);
  scene.add(sys.flash);

  function addTracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    ]);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.95 }),
    );
    scene.add(line);
    sys.tracers.push({ line, life: 0.09 });
  }

  function addSparks(point, count = 6) {
    for (let i = 0; i < count; i += 1) {
      const mat = new THREE.SpriteMaterial({ color: 0xffb347, transparent: true, opacity: 0.95, depthWrite: false });
      const s = new THREE.Sprite(mat);
      s.position.set(point.x, point.y, point.z);
      s.scale.setScalar(0.28);
      s.userData = {
        life: 0.35 + Math.random() * 0.2,
        vx: (Math.random() - 0.5) * 6,
        vy: Math.random() * 4,
        vz: (Math.random() - 0.5) * 6,
      };
      scene.add(s);
      sys.sparks.push(s);
    }
  }

  // --- Pickups: ammo crates and first-aid kits, respawning --------------
  function makePickupMesh(kind) {
    const group = new THREE.Group();
    if (kind === 'ammo') {
      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.5, 0.7),
        new THREE.MeshStandardMaterial({ color: 0xe0a030, roughness: 0.7 }),
      );
      crate.castShadow = true;
      group.add(crate);
      const lid = new THREE.Mesh(
        new THREE.BoxGeometry(0.74, 0.1, 0.74),
        new THREE.MeshStandardMaterial({ color: 0x8a6a10, roughness: 0.7 }),
      );
      lid.position.y = 0.3;
      group.add(lid);
    } else {
      const kit = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.5, 0.5),
        new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6 }),
      );
      kit.castShadow = true;
      group.add(kit);
      const crossV = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.4, 0.06),
        new THREE.MeshStandardMaterial({ color: 0xcc2222, emissive: 0x881111, emissiveIntensity: 0.5 }),
      );
      crossV.position.set(0, 0, 0.28);
      group.add(crossV);
      const crossH = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.14, 0.06),
        new THREE.MeshStandardMaterial({ color: 0xcc2222, emissive: 0x881111, emissiveIntensity: 0.5 }),
      );
      crossH.position.set(0, 0, 0.28);
      group.add(crossH);
    }
    return group;
  }

  sys.spawnPickups = (city, count = 8) => {
    const rng = createRng(777);
    for (let i = 0; i < count; i += 1) {
      const kind = i % 2 === 0 ? 'ammo' : 'health';
      const line = pick(rng, city.roadLines);
      const along = range(rng, -140, 140);
      const x = rng() < 0.5 ? along : line + (rng() < 0.5 ? 10 : -10);
      const z = rng() < 0.5 ? line + (rng() < 0.5 ? 10 : -10) : along;
      const model = makePickupMesh(kind);
      model.position.set(x, 0.55, z);
      scene.add(model);
      sys.pickups.push({ model, pos: model.position, kind, taken: false, respawnTimer: 0 });
    }
  };

  sys.checkPickups = (playerPos) => {
    const collected = [];
    for (const p of sys.pickups) {
      if (p.taken) continue;
      const d = Math.hypot(p.pos.x - playerPos.x, p.pos.z - playerPos.z);
      if (d < 2.2) {
        p.taken = true;
        p.respawnTimer = PICKUP_RESPAWN;
        p.model.visible = false;
        collected.push(p.kind);
      }
    }
    return collected;
  };

  // --- The Kings ----------------------------------------------------------
  // spawnGang(x, z, count, boss): when boss is true the first member is
  // Big Sal, the Kings' boss — 300 health and a gold band, for the finale.
  sys.spawnGang = (x, z, count = 4, boss = false) => {
    const rng = createRng((Math.random() * 1e9) | 0);
    const members = [];
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2;
      const model = buildGangModel();
      model.position.set(x + Math.sin(a) * 8, 0, z + Math.cos(a) * 8);
      scene.add(model);
      const isBoss = boss && i === 0;
      const member = {
        model,
        pos: model.position,
        heading: a,
        health: isBoss ? 300 : 100,
        maxHealth: isBoss ? 300 : 100,
        shootTimer: 1 + rng() * 1.5,
        walkPhase: rng() * 6,
        alive: true,
        kind: isBoss ? 'boss' : 'gang',
      };
      if (isBoss) {
        // Gold band and a bigger frame so Big Sal reads as the boss.
        model.children[2].material = new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.5, metalness: 0.4 });
        model.scale.setScalar(1.25);
      }
      sys.gang.push(member);
      members.push(member);
    }
    return members;
  };

  sys.clearGang = () => {
    for (const m of sys.gang) scene.remove(m.model);
    sys.gang = [];
  };

  sys.gangAlive = () => sys.gang.filter((m) => m.alive).length;

  function killGangMember(member) {
    member.alive = false;
    member.model.rotation.x = -Math.PI / 2;
    member.model.position.y = 0.4;
    const drop = 25 + Math.floor(Math.random() * 36);
    if (hooks.addCash) hooks.addCash(drop);
    if (hooks.onGangKill) hooks.onGangKill(member, drop);
    setTimeout(() => {
      scene.remove(member.model);
      const i = sys.gang.indexOf(member);
      if (i >= 0) sys.gang.splice(i, 1);
    }, 6000);
  }

  // --- Shooting: ray-sphere tests vs gang, peds, cars and police. ---
  sys.shoot = (origin, dir, ctx) => {
    const maxDist = 70;
    let bestT = maxDist;
    let best = null;
    const consider = (t, hit) => {
      if (t < bestT) { bestT = t; best = hit; }
    };
    for (const m of sys.gang) {
      if (!m.alive) continue;
      const t = rayHit(origin, dir, { x: m.pos.x, y: m.pos.y + 1.2, z: m.pos.z }, 1.1, maxDist);
      consider(t, { kind: 'gang', target: m });
    }
    for (const ped of ctx.peds || []) {
      if (!ped.alive) continue;
      const t = rayHit(origin, dir, { x: ped.pos.x, y: ped.pos.y + 1.1, z: ped.pos.z }, 1.0, maxDist);
      consider(t, { kind: 'ped', target: ped });
    }
    for (const car of ctx.cars || []) {
      const t = rayHit(origin, dir, { x: car.pos.x, y: 1, z: car.pos.z }, 2.4, maxDist);
      consider(t, { kind: car.isPolice ? 'police' : 'car', target: car });
    }
    const end = {
      x: origin.x + dir.x * bestT,
      y: Math.max(0.1, origin.y + dir.y * bestT),
      z: origin.z + dir.z * bestT,
    };
    const muzzle = {
      x: origin.x + dir.x * 1.2,
      y: origin.y + dir.y * 1.2 - 0.15,
      z: origin.z + dir.z * 1.2,
    };
    addTracer(muzzle, end);
    addSparks(end, best ? 8 : 3);
    sys.flash.position.set(muzzle.x, muzzle.y, muzzle.z);
    sys.flash.material.opacity = 1;
    sys.flashTimer = 0.06;
    if (hooks.onGunshot) hooks.onGunshot(end);
    if (!best) return { hit: null, point: end };
    if (best.kind === 'gang') {
      const m = best.target;
      m.health -= 34;
      m.model.userData.bar.scale.x = clamp(m.health / m.maxHealth, 0, 1);
      m.model.userData.bar.position.x = -(1 - m.health / m.maxHealth) * 0.48;
      if (m.health <= 0) killGangMember(m);
    } else if (best.kind === 'ped') {
      knockPedDown(best.target, 6);
      if (hooks.onPedHit) hooks.onPedHit(best.target);
    } else if (best.kind === 'car' || best.kind === 'police') {
      damageCar(best.target, 18);
      if (best.kind === 'police' && hooks.onPoliceHit) hooks.onPoliceHit(best.target);
    }
    return { hit: best.kind, point: end, target: best.target };
  };

  // --- Punch (F): short-range melee ---------------------------------------
  sys.punch = (playerPos, playerHeading, ctx) => {
    const fx = Math.sin(playerHeading);
    const fz = Math.cos(playerHeading);
    for (const m of sys.gang) {
      if (!m.alive) continue;
      const dx = m.pos.x - playerPos.x;
      const dz = m.pos.z - playerPos.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.4 && (dx * fx + dz * fz) / (d || 1) > 0.3) {
        m.health -= 30;
        m.pos.x += (dx / (d || 1)) * 1.2;
        m.pos.z += (dz / (d || 1)) * 1.2;
        m.model.userData.bar.scale.x = clamp(m.health / m.maxHealth, 0, 1);
        if (m.health <= 0) killGangMember(m);
        return { hit: 'gang', target: m };
      }
    }
    for (const ped of ctx.peds || []) {
      if (!ped.alive) continue;
      const dx = ped.pos.x - playerPos.x;
      const dz = ped.pos.z - playerPos.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.2 && (dx * fx + dz * fz) / (d || 1) > 0.3) {
        knockPedDown(ped, 5);
        if (hooks.onPedHit) hooks.onPedHit(ped);
        return { hit: 'ped', target: ped };
      }
    }
    return { hit: null };
  };

  // --- Per-frame: gang AI, tracer/spark fade, pickup respawn -------------
  sys.update = (dt, ctx) => {
    const { playerPos, playerInCar } = ctx;
    for (const m of sys.gang) {
      if (!m.alive) continue;
      const dx = playerPos.x - m.pos.x;
      const dz = playerPos.z - m.pos.z;
      const dist = Math.hypot(dx, dz);
      // Face the player; close in if far, hold ground and shoot if near.
      const want = Math.atan2(dx, dz);
      m.heading = angleLerp(m.heading, want, Math.min(1, dt * 5));
      m.model.rotation.y = m.heading;
      if (dist > 26) {
        m.pos.x += Math.sin(m.heading) * 3.4 * dt;
        m.pos.z += Math.cos(m.heading) * 3.4 * dt;
        m.walkPhase += 3.4 * dt * 2.2;
        const swing = Math.sin(m.walkPhase) * 0.45;
        m.model.userData.legL.rotation.x = swing;
        m.model.userData.legR.rotation.x = -swing;
      }
      // Kings shoot back: ~1 shot per 2 s, 12% hit.
      m.shootTimer -= dt;
      if (m.shootTimer <= 0 && dist < 38 && !playerInCar) {
        m.shootTimer = 1.4 + Math.random() * 1.4;
        const from = { x: m.pos.x, y: 1.5, z: m.pos.z };
        const to = { x: playerPos.x, y: 1.3, z: playerPos.z };
        addTracer(from, to);
        if (Math.random() < 0.12 && hooks.damagePlayer) hooks.damagePlayer(8, 'shot by the Kings');
        if (hooks.onEnemyShot) hooks.onEnemyShot(m);
      }
    }
    for (const p of sys.pickups) {
      if (p.taken) {
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) {
          p.taken = false;
          p.model.visible = true;
        }
      } else {
        p.model.position.y = 0.55 + Math.sin(ctx.time * 2 + p.pos.x) * 0.12;
        p.model.rotation.y += dt * 0.8;
      }
    }
    if (sys.flashTimer > 0) {
      sys.flashTimer -= dt;
      if (sys.flashTimer <= 0) sys.flash.material.opacity = 0;
    }
    for (let i = sys.tracers.length - 1; i >= 0; i -= 1) {
      const t = sys.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.09);
      if (t.life <= 0) {
        scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        sys.tracers.splice(i, 1);
      }
    }
    for (let i = sys.sparks.length - 1; i >= 0; i -= 1) {
      const s = sys.sparks[i];
      s.userData.life -= dt;
      s.position.x += s.userData.vx * dt;
      s.position.y += s.userData.vy * dt;
      s.position.z += s.userData.vz * dt;
      s.userData.vy -= 12 * dt;
      s.material.opacity = Math.max(0, s.userData.life * 2.5);
      if (s.userData.life <= 0) {
        scene.remove(s);
        s.material.dispose();
        sys.sparks.splice(i, 1);
      }
    }
  };

  return sys;
}
