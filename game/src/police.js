// Police and the wanted system: pursuit cars, foot cops, busts, and
// Lou's Paint Shop. Wanted runs 0-5 stars; crimes raise it, staying out
// of sight lowers it, and a $200 repaint clears it outright.
import * as THREE from 'three';
import { clamp, angleLerp, createRng, range } from './utils.js';
import { createCar, damageCar } from './vehicles.js';

export const PAINT_SHOP = { x: -138, z: 22, r: 10, price: 200 };
export const PIER_RESPAWN = { x: -148, z: 0 };

// How long the player must stay unseen before one star drops off.
function decaySeconds(wanted) {
  return 4 + wanted * 2;
}

function makeCopModel() {
  const group = new THREE.Group();
  const navy = new THREE.MeshStandardMaterial({ color: 0x1c2f4a, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98d64, roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), navy);
  torso.position.y = 1.15;
  torso.castShadow = true;
  group.add(torso);
  const badge = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.02),
    new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xaa8811, emissiveIntensity: 0.6 }),
  );
  badge.position.set(-0.18, 1.3, 0.18);
  group.add(badge);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.34), skin);
  head.position.y = 1.72;
  head.castShadow = true;
  group.add(head);
  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.12, 0.38),
    new THREE.MeshStandardMaterial({ color: 0x10151c, roughness: 0.8 }),
  );
  cap.position.y = 1.92;
  group.add(cap);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.78, 0.26), pants);
  legL.position.set(-0.17, 0.39, 0);
  group.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.78, 0.26), pants);
  legR.position.set(0.17, 0.39, 0);
  group.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.66, 0.22), navy);
  armL.position.set(-0.42, 1.15, 0);
  group.add(armL);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.66, 0.22), navy);
  armR.position.set(0.42, 1.15, 0);
  group.add(armR);
  group.userData = { legL, legR, armL, armR };
  return group;
}

// Lou's Paint Shop: a marked garage near the pier. Drive in and the
// wanted level is wiped for $200.
export function buildPaintShop(scene) {
  const group = new THREE.Group();
  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(14, 5, 10),
    new THREE.MeshStandardMaterial({ color: 0x7a4a2e, roughness: 0.9 }),
  );
  walls.position.y = 2.5;
  walls.castShadow = true;
  group.add(walls);
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(9, 3.6, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6, metalness: 0.4 }),
  );
  door.position.set(0, 1.8, 5.05);
  group.add(door);
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(10, 1.4, 0.4),
    new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xaa7711, emissiveIntensity: 0.7 }),
  );
  sign.position.set(0, 5.6, 5.1);
  group.add(sign);
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshStandardMaterial({ color: 0x555550, roughness: 1 }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.05, 9);
  pad.receiveShadow = true;
  group.add(pad);
  group.position.set(PAINT_SHOP.x, 0, PAINT_SHOP.z);
  scene.add(group);
  return group;
}

export function createPoliceSystem(scene, city, hooks) {
  const sys = {
    cars: [],
    cops: [],
    unseenTimer: 0,
    bustTimer: 0,
    paintCooldown: 0,
  };

  function spawnPoliceCar(near) {
    // Spawn on a road line near the player so the car arrives driving,
    // not popping in through a building.
    const rng = createRng((Math.random() * 1e9) | 0);
    const lines = city.roadLines.filter((l) => Math.abs(l - near.x) < 90 || Math.abs(l - near.z) < 90);
    const line = lines.length ? lines[Math.floor(rng() * lines.length)] : 0;
    const along = clamp(near.z + range(rng, -55, -35), -150, 150);
    const x = rng() < 0.5 ? line : clamp(near.x + range(rng, -50, 50), -150, 150);
    const z = rng() < 0.5 ? along : line;
    const car = createCar(scene, 'police', 0x1c2733, x, z, 0);
    car.isPolice = true;
    car.cruise = 0;
    // Alternate a lateral offset so two pursuers fan out instead of
    // stacking on the exact same line behind the player.
    car.pursuitOffset = sys.cars.length % 2 === 0 ? -3.5 : 3.5;
    sys.cars.push(car);
    return car;
  }

  function spawnFootCop(near) {
    const rng = createRng((Math.random() * 1e9) | 0);
    const a = rng() * Math.PI * 2;
    const model = makeCopModel();
    const x = clamp(near.x + Math.sin(a) * 28, -160, 160);
    const z = clamp(near.z + Math.cos(a) * 28, -160, 160);
    model.position.set(x, 0, z);
    scene.add(model);
    const cop = { model, pos: model.position, heading: 0, walkPhase: 0, speed: 6.4 };
    sys.cops.push(cop);
    return cop;
  }

  function removeCar(car) {
    scene.remove(car.model);
    const i = sys.cars.indexOf(car);
    if (i >= 0) sys.cars.splice(i, 1);
  }

  function removeCop(cop) {
    scene.remove(cop.model);
    const i = sys.cops.indexOf(cop);
    if (i >= 0) sys.cops.splice(i, 1);
  }

  sys.spawnPoliceCar = spawnPoliceCar;
  sys.spawnFootCop = spawnFootCop;

  sys.clearAll = () => {
    for (const car of [...sys.cars]) removeCar(car);
    for (const cop of [...sys.cops]) removeCop(cop);
    sys.unseenTimer = 0;
    sys.bustTimer = 0;
  };

  // One frame of the wanted system. ctx: { player, playerPos,
  // playerSpeed, playerInCar, wanted, setWanted, allCars, colliders,
  // time }. Returns an event string ('busted' | 'painted' | '').
  sys.update = (dt, ctx) => {
    const { playerPos, playerInCar, wanted } = ctx;
    sys.paintCooldown = Math.max(0, sys.paintCooldown - dt);

    // --- How many pursuers does this wanted level deserve? ------------
    const wantCars = wanted >= 1 ? Math.min(1 + Math.floor(wanted / 2), 3) : 0;
    while (sys.cars.length < wantCars) spawnPoliceCar(playerPos);
    while (sys.cars.length > wantCars) removeCar(sys.cars[sys.cars.length - 1]);
    const wantCops = !playerInCar && wanted >= 1 ? Math.min(wanted, 2) : 0;
    while (sys.cops.length < wantCops) spawnFootCop(playerPos);
    while (sys.cops.length > wantCops) removeCop(sys.cops[sys.cops.length - 1]);

    // --- Pursuit cars: chase, ram, and try to cut the player off ------
    for (const cop of sys.cars) {
      const dx = playerPos.x - cop.pos.x;
      const dz = playerPos.z - cop.pos.z;
      const dist = Math.hypot(dx, dz);
      // Aim slightly ahead of the player to cut them off when close,
      // offset sideways so pursuers fan out instead of stacking up.
      const lead = clamp(dist * 0.12, 0, 8);
      const tx0 = playerPos.x + Math.sin(ctx.playerHeading || 0) * lead * (ctx.playerSpeed || 0) * 0.05;
      const tz0 = playerPos.z + Math.cos(ctx.playerHeading || 0) * lead * (ctx.playerSpeed || 0) * 0.05;
      const toPlayer = Math.atan2(dx, dz);
      const off = cop.pursuitOffset || 0;
      const tx = tx0 + Math.cos(toPlayer) * off;
      const tz = tz0 - Math.sin(toPlayer) * off;
      const wantHeading = Math.atan2(tx - cop.pos.x, tz - cop.pos.z);
      cop.heading = angleLerp(cop.heading, wantHeading, Math.min(1, dt * 2.6));
      const topSpeed = Math.min(26 + wanted * 2.5, 38);
      cop.speed += clamp((dist > 12 ? topSpeed : topSpeed * 0.75) - cop.speed, -22 * dt, 14 * dt);
      cop.pos.x += Math.sin(cop.heading) * cop.speed * dt;
      cop.pos.z += Math.cos(cop.heading) * cop.speed * dt;
      cop.model.rotation.y = cop.heading;
      const wheels = cop.model.userData.wheels || [];
      for (const wheel of wheels) wheel.rotation.x += cop.speed * dt * 1.4;
      // Ram: shove the player's car and dent it; on foot, a hit hurts.
      if (dist < 4.2) {
        const nx = dx / (dist || 1);
        const nz = dz / (dist || 1);
        if (playerInCar) {
          playerInCar.pos.x += nx * 1.6;
          playerInCar.pos.z += nz * 1.6;
          damageCar(playerInCar, 6);
          cop.speed *= 0.55;
        } else if (hooks.damagePlayer) {
          hooks.damagePlayer(12, 'rammed by a police car');
          // Push the player clear so one ram is not a stunlock.
          ctx.player.pos.x += nx * 2.2;
          ctx.player.pos.z += nz * 2.2;
          cop.speed *= 0.4;
        }
      }
      // Despawn a pursuer that fell far behind; a fresh one spawns near.
      if (dist > 190) removeCar(cop);
    }

    // --- Foot cops: chase on foot, bust after 2 s up close ------------
    let busting = false;
    for (const cop of sys.cops) {
      const dx = playerPos.x - cop.pos.x;
      const dz = playerPos.z - cop.pos.z;
      const dist = Math.hypot(dx, dz);
      const wantHeading = Math.atan2(dx, dz);
      cop.heading = angleLerp(cop.heading, wantHeading, Math.min(1, dt * 6));
      const speed = dist > 3 ? cop.speed : cop.speed * 0.4;
      cop.pos.x += Math.sin(cop.heading) * speed * dt;
      cop.pos.z += Math.cos(cop.heading) * speed * dt;
      cop.model.rotation.y = cop.heading;
      cop.walkPhase += speed * dt * 2.2;
      const swing = Math.sin(cop.walkPhase) * 0.5;
      const { legL, legR, armL, armR } = cop.model.userData;
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      armL.rotation.x = -swing * 0.8;
      armR.rotation.x = swing * 0.8;
      if (dist < 2.4 && !playerInCar && (ctx.playerSpeed || 0) < 2.5) busting = true;
      if (dist > 120) removeCop(cop);
    }
    if (busting) {
      sys.bustTimer += dt;
      if (sys.bustTimer >= 2 && hooks.onBusted) {
        sys.bustTimer = 0;
        hooks.onBusted();
        return 'busted';
      }
    } else {
      sys.bustTimer = Math.max(0, sys.bustTimer - dt * 2);
    }

    // --- Wanted decay: unseen for a few seconds, one star drops off ---
    const nearest = Math.min(
      ...sys.cars.map((c) => Math.hypot(c.pos.x - playerPos.x, c.pos.z - playerPos.z)),
      ...sys.cops.map((c) => Math.hypot(c.pos.x - playerPos.x, c.pos.z - playerPos.z)),
      Infinity,
    );
    if (wanted > 0 && nearest > 45) {
      sys.unseenTimer += dt;
      if (sys.unseenTimer >= decaySeconds(wanted)) {
        sys.unseenTimer = 0;
        ctx.setWanted(wanted - 1);
      }
    } else {
      sys.unseenTimer = 0;
    }

    // --- Lou's Paint Shop: drive in, pay $200, walk out clean ---------
    if (playerInCar && sys.paintCooldown <= 0 && wanted > 0) {
      const d = Math.hypot(playerPos.x - PAINT_SHOP.x, playerPos.z - PAINT_SHOP.z);
      if (d < PAINT_SHOP.r && hooks.tryPaintShop) {
        if (hooks.tryPaintShop()) {
          sys.paintCooldown = 3;
          sys.clearAll();
          return 'painted';
        }
      }
    }
    return '';
  };

  return sys;
}
