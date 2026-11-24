// The law: a 5-star wanted system with VBPD cruisers that chase, a
// police helicopter from 3 stars, and roadblocks from 4. Cops lose the
// player when unseen long enough; the safehouse clears heat instantly.
import * as THREE from 'three';
import { clamp, lerp, angleDiff, dist2, mulberry32, pick } from './util.js';
import { makeCar, syncCarMesh, CAR_KINDS } from './vehicles.js';
import { nearestNode } from './city.js';

const WANTED_LABELS = ['', 'SUSPECT', 'FLEEING', 'DANGEROUS', 'ARMED & DANGEROUS', 'CITYWIDE MANHUNT'];

export class Police {
  constructor(scene, city, seed) {
    this.scene = scene; this.city = city;
    this.rng = mulberry32(seed ^ 0x5050);
    this.cops = [];
    this.heli = null;
    this.heliMesh = null;
    this.roadblocks = [];
    this.loseTimer = 0; // seconds the player has been unseen
    this.sirenPhase = 0;
    this.buildHeli();
  }

  buildHeli() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 6), new THREE.MeshLambertMaterial({ color: 0x1c2f4a }));
    body.castShadow = true; g.add(body);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.9, 1.6), new THREE.MeshLambertMaterial({ color: 0x9fd8ff }));
    glass.position.set(0, 0.2, 2.4); g.add(glass);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.12, 0.7), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    rotor.position.y = 1.1; g.add(rotor);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 5), new THREE.MeshLambertMaterial({ color: 0x1c2f4a }));
    tail.position.set(0, 0.3, -5); g.add(tail);
    const spot = new THREE.Mesh(new THREE.ConeGeometry(6, 26, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.16, side: THREE.DoubleSide }));
    spot.position.y = -13; spot.rotation.x = Math.PI; g.add(spot);
    g.visible = false;
    this.scene.add(g);
    this.heliMesh = g;
    this.heli = { x: 0, z: 0, y: 55, angle: 0, rotor };
  }

  wantedLabel(stars) { return WANTED_LABELS[stars] || ''; }

  /** How many cruisers a wanted level fields. */
  copCount(stars) {
    return [0, 1, 2, 3, 4, 5][stars] || 0;
  }

  spawnCopNear(player) {
    const node = nearestNode(this.city.roadNodes, player.x + (this.rng() - 0.5) * 160, player.z + (this.rng() - 0.5) * 160);
    const car = makeCar('cop', node.x, node.z, this.rng() * Math.PI * 2);
    car.driver = 'cop';
    car.hp = 120;
    this.scene.add(car.mesh);
    syncCarMesh(car);
    this.cops.push(car);
    return car;
  }

  removeCop(car) {
    this.scene.remove(car.mesh);
    this.cops = this.cops.filter((c) => c !== car);
  }

  setRoadblocks(on, player) {
    if (on && this.roadblocks.length === 0) {
      for (let i = 0; i < 2; i++) {
        const ahead = { x: player.x + Math.sin(player.heading || 0) * (60 + i * 40), z: player.z + Math.cos(player.heading || 0) * (60 + i * 40) };
        const node = nearestNode(this.city.roadNodes, ahead.x, ahead.z);
        const a = makeCar('cop', node.x - 3, node.z, Math.PI / 2);
        const b = makeCar('cop', node.x + 3, node.z, Math.PI / 2);
        this.scene.add(a.mesh); this.scene.add(b.mesh);
        syncCarMesh(a); syncCarMesh(b);
        this.roadblocks.push(a, b);
      }
    }
    if (!on && this.roadblocks.length > 0) {
      for (const c of this.roadblocks) this.scene.remove(c.mesh);
      this.roadblocks = [];
    }
  }

  step(dt, player, state) {
    const stars = player.wanted;
    const want = this.copCount(stars);
    // keep the cruiser count matched to the wanted level
    while (this.cops.length < want) this.spawnCopNear(player);
    while (this.cops.length > want) this.removeCop(this.cops[this.cops.length - 1]);
    this.setRoadblocks(stars >= 4, player);

    // helicopter from 3 stars
    const heliOn = stars >= 3;
    this.heliMesh.visible = heliOn;
    if (heliOn) {
      this.heli.angle += dt * 0.45;
      this.heli.x = player.x + Math.cos(this.heli.angle) * 26;
      this.heli.z = player.z + Math.sin(this.heli.angle) * 26;
      this.heli.y = 52 + Math.sin(state.time * 0.7) * 3;
      this.heliMesh.position.set(this.heli.x, this.heli.y, this.heli.z);
      this.heliMesh.rotation.y = Math.atan2(player.x - this.heli.x, player.z - this.heli.z);
      this.heli.rotor.rotation.y += dt * 22;
    }

    // cruisers pursue: steer at the player, ram speed, give up when far
    for (const cop of [...this.cops]) {
      const d = dist2(cop.x, cop.z, player.x, player.z);
      const spec = CAR_KINDS.cop;
      const wantHeading = Math.atan2(player.x - cop.x, player.z - cop.z);
      const diff = angleDiff(cop.heading, wantHeading);
      cop.heading += clamp(diff, -2.4 * dt, 2.4 * dt);
      const targetSpeed = d > 6 ? spec.top * (d > 120 ? 1 : 0.85) : 0;
      cop.speed = lerp(cop.speed, targetSpeed, clamp(dt * 1.4, 0, 1));
      const nx = cop.x + Math.sin(cop.heading) * cop.speed * dt;
      const nz = cop.z + Math.cos(cop.heading) * cop.speed * dt;
      // crude wall slide: if blocked, swing around
      let hitWall = false;
      for (const c of this.city.colliders) {
        if (Math.abs(nx - c.x) < c.hx + 1.6 && Math.abs(nz - c.z) < c.hz + 1.6) { hitWall = true; break; }
      }
      if (hitWall) { cop.heading += 1.4 * dt * 3; cop.speed *= 0.6; }
      else { cop.x = nx; cop.z = nz; }
      cop.x = clamp(cop.x, -340, 340); cop.z = clamp(cop.z, -340, 340);
      syncCarMesh(cop);
      // ram the player (a nudge, not a wrecking ball)
      if (d < 3.4 && cop.speed > 8) {
        if (player.inCar) {
          player.inCar.hp -= 5 * dt;
          player.inCar.speed *= 0.96;
        } else {
          player.health -= 16 * dt;
          state.combat?.flashDamage();
        }
      }
      // a cop car that is wrecked or far away despawns
      if (cop.hp <= 0 || d > 420) {
        if (cop.hp <= 0) { state.stats.copsDodged += 1; state.feed.push('VBPD cruiser wrecked — nice driving.', 'gold'); }
        this.removeCop(cop);
      }
    }

    // heat: cools when no cop is close and the heli is gone
    const nearest = this.cops.reduce((m, c) => Math.min(m, dist2(c.x, c.z, player.x, player.z)), Infinity);
    if (stars > 0 && nearest > 90 && !heliOn) {
      this.loseTimer += dt;
      if (this.loseTimer > 14) {
        player.wanted = Math.max(0, stars - 1);
        this.loseTimer = 0;
        state.feed.push(player.wanted === 0 ? 'You lost them. The Bay forgets fast.' : 'Heat is dropping — keep out of sight.');
      }
    } else {
      this.loseTimer = 0;
    }

    // busted: a cop touches the player on foot while wanted
    if (stars > 0 && !player.inCar && nearest < 2.6 && player.health > 0) {
      player.busted = true;
    }
    this.sirenPhase += dt;
  }

  /** Raise the wanted level, capping at 5. Returns the new level. */
  addWanted(player, n, reason, state) {
    const before = player.wanted;
    player.wanted = clamp(player.wanted + n, 0, 5);
    if (player.wanted > before) {
      state.feed.push(`${reason} — wanted level ${player.wanted}★ ${this.wantedLabel(player.wanted)}`);
    }
    return player.wanted;
  }

  clearWanted(player) {
    player.wanted = 0;
    this.loseTimer = 0;
    for (const c of [...this.cops]) this.removeCop(c);
    this.setRoadblocks(false, player);
  }
}
