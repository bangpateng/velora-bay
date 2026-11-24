// Combat: fists, pistol and SMG, enemy squads with simple AI, the
// mission objects (crates, the chase target, race rivals, take-cars)
// and the pickups scattered around the city. Shooting is a ray from
// the camera through the crosshair, tested against enemies, crates
// and cars.
import * as THREE from 'three';
import { clamp, dist2, pick, mulberry32 } from './util.js';
import { makePersonMesh, animateWalk } from './people.js';
import { makeCar, syncCarMesh, pursuitPoint } from './vehicles.js';

export class Combat {
  constructor(scene, city, state) {
    this.scene = scene; this.city = city; this.state = state;
    this.rng = mulberry32(state.seed ^ 0xC0FFEE);
    this.enemies = [];
    this.crates = [];
    this.racers = [];
    this.chaseCar = null;
    this.takeCar = null;
    this.pickups = [];
    this.flash = 0;
    this.tracer = null;
    this.buildPickups();
  }

  buildPickups() {
    const spots = [
      { kind: 'health', x: -30, z: -258 }, { kind: 'armor', x: 60, z: 120 },
      { kind: 'ammo', x: -270, z: -60 }, { kind: 'health', x: 180, z: 258 },
      { kind: 'armor', x: 120, z: -120 }, { kind: 'ammo', x: -120, z: 60 },
      { kind: 'health', x: 0, z: 12 }, { kind: 'ammo', x: 240, z: 60 },
    ];
    const colors = { health: 0x37e08b, armor: 0x4aa8ff, ammo: 0xffd23e };
    for (const s of spots) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), new THREE.MeshLambertMaterial({ color: colors[s.kind], emissive: colors[s.kind], emissiveIntensity: 0.35 }));
      mesh.position.set(s.x, 0.8, s.z);
      mesh.rotation.y = Math.PI / 4;
      this.scene.add(mesh);
      this.pickups.push({ ...s, mesh, taken: false, respawn: 0 });
    }
  }

  flashDamage() { this.flash = 1; }

  // ---------------------------------------------------------- enemies
  spawnSquad(kind, count, player) {
    const spots = kind === 'bankGuards'
      ? [[14, 14], [-14, 14], [14, -14], [-14, -14], [20, 0], [-20, 0]]
      : [[-360, 40], [-360, 80], [-340, 60], [-350, 90]];
    for (let i = 0; i < count; i++) {
      const [sx, sz] = spots[i % spots.length];
      const mesh = makePersonMesh(0x8a2f2f, pick(this.rng, [0xe8b88a, 0xc98a5f]), 0x2c3440);
      const e = {
        x: sx + (this.rng() - 0.5) * 8, z: sz + (this.rng() - 0.5) * 8,
        hp: 50, mesh, phase: this.rng() * 6, shootT: 1 + this.rng(), kind,
      };
      mesh.position.set(e.x, 0, e.z);
      this.scene.add(mesh);
      this.enemies.push(e);
    }
    this.state.feed.push(`${count} hostiles incoming — watch your health.`);
  }

  spawnCrates(x, z, count) {
    const crates = [];
    const mat = new THREE.MeshLambertMaterial({ color: 0xe8a13d });
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), mat.clone());
      mesh.position.set(x - 30 + i * 16 + (this.rng() - 0.5) * 6, 1.5, z + (this.rng() - 0.5) * 10);
      mesh.castShadow = true;
      this.scene.add(mesh);
      const c = { x: mesh.position.x, z: mesh.position.z, hp: 30, mesh };
      crates.push(c); this.crates.push(c);
    }
    return crates;
  }

  spawnChaseTarget(player) {
    const car = makeCar('sports', player.x + 40, player.z + 20, 0, 0x1c1c1c);
    car.driver = 'chase'; car.hp = 100; car.speed = 20;
    this.scene.add(car.mesh); syncCarMesh(car);
    this.chaseCar = car;
    return car;
  }

  despawnChaseTarget() {
    if (this.chaseCar) { this.scene.remove(this.chaseCar.mesh); this.chaseCar = null; }
  }

  spawnRacers(checkpoints, player) {
    const racers = [];
    const colors = [0xc93d3d, 0x4a90d9, 0x3d7a4a];
    for (let i = 0; i < 3; i++) {
      const car = makeCar('sports', player.x + (i - 1) * 8, player.z, 0, colors[i]);
      car.driver = 'racer'; car.cp = 0; car.speed = 22;
      this.scene.add(car.mesh); syncCarMesh(car);
      racers.push(car);
    }
    this.racers = racers;
    return racers;
  }

  spawnTakeCar(kind, x, z) {
    if (this.takeCar) this.scene.remove(this.takeCar.mesh);
    const car = makeCar(kind, x, z, Math.PI / 2);
    this.scene.add(car.mesh); syncCarMesh(car);
    this.takeCar = car;
    return car;
  }

  clearMissionObjects() {
    for (const e of this.enemies) this.scene.remove(e.mesh);
    this.enemies = [];
    for (const c of this.crates) this.scene.remove(c.mesh);
    this.crates = [];
    for (const r of this.racers) this.scene.remove(r.mesh);
    this.racers = [];
    this.despawnChaseTarget();
    if (this.takeCar) { this.scene.remove(this.takeCar.mesh); this.takeCar = null; }
  }

  // ---------------------------------------------------------- shooting
  /** Fire the current weapon from the camera through the crosshair. */
  shoot(camera, player) {
    const s = this.state;
    if (player.weapon === 'fists') return;
    if (player.ammo <= 0) {
      s.audio.dryClick();
      s.feed.push('Out of ammo — find an ammo crate (yellow).');
      return;
    }
    player.ammo -= 1;
    s.stats.shotsFired += 1;
    s.audio.shot(player.weapon);
    const origin = camera.position.clone();
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const range = 90;
    let best = null, bestD = range;
    const test = (x, z, radius, ref) => {
      // ray vs vertical cylinder at (x, z)
      const ox = x - origin.x, oz = z - origin.z;
      const dx = dir.x, dz = dir.z;
      const a = dx * dx + dz * dz;
      if (a < 0.0001) return;
      const t = (ox * dx + oz * dz) / a;
      if (t < 0 || t > bestD) return;
      const px = origin.x + dx * t - x, pz = origin.z + dz * t - z;
      if (px * px + pz * pz < radius * radius) { bestD = t; best = ref; }
    };
    for (const e of this.enemies) test(e.x, e.z, 1.1, { type: 'enemy', ref: e });
    for (const c of this.crates) test(c.x, c.z, 2.2, { type: 'crate', ref: c });
    for (const car of [...s.police.cops, ...(this.chaseCar ? [this.chaseCar] : [])]) test(car.x, car.z, 2.2, { type: 'car', ref: car });
    if (best) {
      const dmg = player.weapon === 'smg' ? 22 : 34;
      if (best.type === 'enemy') {
        best.ref.hp -= dmg;
        if (best.ref.hp <= 0) {
          this.scene.remove(best.ref.mesh);
          this.enemies = this.enemies.filter((e) => e !== best.ref);
          if (s.missions.active) s.missions.active.kills += 1;
          s.feed.push('Hostile down.');
        }
      } else if (best.type === 'crate') {
        best.ref.hp -= dmg;
        best.ref.mesh.material.color.setHex(0x7a4a1c);
        if (best.ref.hp <= 0) {
          this.scene.remove(best.ref.mesh);
          s.audio.crash();
        }
      } else if (best.type === 'car') {
        best.ref.hp -= dmg;
        if (best.ref.hp <= 0 && best.ref.driver === 'cop') s.police.removeCop(best.ref);
      }
    }
    // tracer flash: a short-lived line from the camera
    if (this.tracer) this.scene.remove(this.tracer);
    const end = origin.clone().add(dir.clone().multiplyScalar(bestD));
    const geo = new THREE.BufferGeometry().setFromPoints([origin, end]);
    this.tracer = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 }));
    this.scene.add(this.tracer);
    this.tracerT = 0.08;
    s.pedestrians.scare(player.x, player.z, 40);
    if (player.wanted < 2) s.police.addWanted(player, 1, 'Shots fired in public', s);
  }

  /** Melee: punch whatever is closest in front of the player. */
  punch(player) {
    const s = this.state;
    s.audio.punch();
    const px = player.x + Math.sin(player.heading) * 1.6;
    const pz = player.z + Math.cos(player.heading) * 1.6;
    for (const e of [...this.enemies]) {
      if (dist2(e.x, e.z, px, pz) < 2) {
        e.hp -= 30;
        if (e.hp <= 0) {
          this.scene.remove(e.mesh);
          this.enemies = this.enemies.filter((x) => x !== e);
          if (s.missions.active) s.missions.active.kills += 1;
        }
        return;
      }
    }
    for (const ped of s.pedestrians.peds) {
      if (dist2(ped.x, ped.z, px, pz) < 1.6) {
        s.pedestrians.scare(ped.x, ped.z, 12);
        s.police.addWanted(player, 1, 'Assault', s);
        return;
      }
    }
  }

  step(dt, player, camera) {
    if (this.tracer) {
      this.tracerT -= dt;
      if (this.tracerT <= 0) { this.scene.remove(this.tracer); this.tracer = null; }
    }
    this.flash = Math.max(0, this.flash - dt * 2.2);
    // enemies: walk at the player and shoot with bad aim
    for (const e of [...this.enemies]) {
      const d = dist2(e.x, e.z, player.x, player.z);
      const want = Math.atan2(player.x - e.x, player.z - e.z);
      e.mesh.rotation.y = want;
      if (d > 2.2) {
        const sp = 3.4;
        e.x += Math.sin(want) * sp * dt;
        e.z += Math.cos(want) * sp * dt;
        e.phase += dt * 8;
        animateWalk(e.mesh, e.phase, 1);
      }
      e.mesh.position.set(e.x, 0, e.z);
      e.shootT -= dt;
      if (e.shootT <= 0 && d < 45 && d > 2.5) {
        e.shootT = 1.4 + this.rng() * 0.9;
        this.state.audio.enemyShot();
        if (this.rng() < 0.42) {
          const dmg = 7 + this.rng() * 6;
          this.damagePlayer(dmg);
        }
      }
    }
    // chase target: flees along the road grid away from the player
    if (this.chaseCar) {
      const c = this.chaseCar;
      const away = { x: c.x + (c.x - player.x), z: c.z + (c.z - player.z) };
      const pt = pursuitPoint(c.x, c.z, away.x, away.z);
      const want = Math.atan2(pt.x - c.x, pt.z - c.z);
      let diff = want - c.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      c.heading += clamp(diff, -1.8 * dt, 1.8 * dt);
      c.speed = 26;
      c.x += Math.sin(c.heading) * c.speed * dt;
      c.z += Math.cos(c.heading) * c.speed * dt;
      c.x = clamp(c.x, -320, 320); c.z = clamp(c.z, -320, 320);
      syncCarMesh(c);
    }
    // race rivals: chase the next checkpoint
    for (const r of this.racers) {
      const m = this.state.missions.active;
      if (!m || m.def.steps[m.stepIndex]?.type !== 'race') continue;
      const cps = m.def.steps[m.stepIndex].checkpoints;
      const cp = cps[Math.min(r.cp, cps.length - 1)];
      if (!cp) continue;
      const pt = pursuitPoint(r.x, r.z, cp[0], cp[1]);
      const want = Math.atan2(pt.x - r.x, pt.z - r.z);
      let diff = want - r.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      r.heading += clamp(diff, -2 * dt, 2 * dt);
      r.speed = 24 + Math.sin(this.state.time + r.x) * 2;
      r.x += Math.sin(r.heading) * r.speed * dt;
      r.z += Math.cos(r.heading) * r.speed * dt;
      if (dist2(r.x, r.z, cp[0], cp[1]) < 12) r.cp += 1;
      syncCarMesh(r);
    }
    // pickups: bob, spin, collect
    for (const pk of this.pickups) {
      if (pk.taken) {
        pk.respawn -= dt;
        if (pk.respawn <= 0) { pk.taken = false; pk.mesh.visible = true; }
        continue;
      }
      pk.mesh.rotation.y += dt * 1.5;
      pk.mesh.position.y = 0.8 + Math.sin(this.state.time * 2 + pk.x) * 0.15;
      if (dist2(player.x, player.z, pk.x, pk.z) < 2) {
        pk.taken = true; pk.mesh.visible = false; pk.respawn = 45;
        if (pk.kind === 'health') { player.health = clamp(player.health + 50, 0, 100); this.state.feed.push('Health +50'); }
        if (pk.kind === 'armor') { player.armor = clamp(player.armor + 50, 0, 100); this.state.feed.push('Armor +50'); }
        if (pk.kind === 'ammo') { player.ammo += 30; this.state.feed.push('Ammo +30'); }
        this.state.audio.pickup();
      }
    }
    // player car rams crates
    if (player.inCar) {
      for (const c of this.crates) {
        if (c.hp > 0 && dist2(player.inCar.x, player.inCar.z, c.x, c.z) < 3.4) {
          c.hp = 0;
          this.scene.remove(c.mesh);
          this.state.audio.crash();
          player.inCar.speed *= 0.6;
        }
      }
    }
  }

  damagePlayer(amount) {
    const s = this.state;
    const p = s.player;
    let left = amount;
    if (p.armor > 0) {
      const absorbed = Math.min(p.armor, left);
      p.armor -= absorbed; left -= absorbed;
    }
    p.health -= left;
    this.flashDamage();
    if (p.health <= 0) {
      p.health = 0;
      p.dead = true;
    }
  }
}
