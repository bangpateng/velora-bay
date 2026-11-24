// Velora Bay — main controller. Boots the renderer, owns the loop, and
// wires every system together: city, traffic, pedestrians, police,
// missions, combat, HUD, audio, save and input. The same stepWorld()
// drives live play and the ?shot= screenshot stager.
import * as THREE from 'three';
import { createGameState } from './state.js';
import { mulberry32, clamp, lerp, dist2, formatCash } from './util.js';
import { buildCity } from './city.js';
import { Traffic, spawnParkedCars, makeCar, syncCarMesh, driveCar, CAR_KINDS } from './vehicles.js';
import { makePersonMesh, animateWalk, stepPlayerOnFoot, Pedestrians } from './people.js';
import { Police } from './police.js';
import { MissionManager } from './missions.js';
import { Combat } from './combat.js';
import { Hud } from './hud.js';
import { AudioEngine } from './audio.js';
import { SaveSystem } from './save.js';
import { Input } from './input.js';
import { stageShot } from './shots.js';

const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') || 20261124);

class Game {
  constructor() {
    this.state = createGameState(SEED);
    this.state.flags.demo = params.has('shot');
    window.__velora = { state: this.state, errors: [], frames: 0, startedAt: Date.now() };
    window.__velora.game = this; // debug handle: lets automated tests step the world
    window.addEventListener('error', (e) => window.__velora.errors.push(String(e.message || e.error)));
    this.autopilot = null;
    this.camYaw = Math.PI;
    this.camPitch = 0.32;
    this.camDist = 16;
    this.walkPhase = 0;
    this.boot();
  }

  boot() {
    const s = this.state;
    const canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87b5d9);
    this.scene.fog = new THREE.Fog(0x87b5d9, 320, 900);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1400);
    this.camera.position.set(0, 12, 200);

    s.city = buildCity(this.scene, SEED);
    s.traffic = new Traffic(this.scene, s.city, SEED);
    s.pedestrians = new Pedestrians(this.scene, s.city, SEED);
    s.police = new Police(this.scene, s.city, SEED);
    s.combat = new Combat(this.scene, s.city, s);
    s.missions = new MissionManager(s);
    s.hud = new Hud(s);
    s.audio = new AudioEngine();
    s.save = new SaveSystem(s);
    this.input = new Input(canvas);
    this.parkedCars = spawnParkedCars(this.scene, s.city, SEED);

    // the player, on foot
    this.playerMesh = makePersonMesh(0xffd23e, 0xe8b88a, 0x2c3440, true);
    this.scene.add(this.playerMesh);

    // sun coins: spinning gold discs at the city's coin spots
    const coinGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.18, 18);
    coinGeo.rotateX(Math.PI / 2);
    const coinMat = new THREE.MeshLambertMaterial({ color: 0xffd23e, emissive: 0x8a6a00, emissiveIntensity: 0.6 });
    for (const coin of s.city.coins) {
      if (s.progress.coinsFound.includes(coin.id)) { coin.taken = true; continue; }
      const mesh = new THREE.Mesh(coinGeo, coinMat);
      mesh.position.set(coin.x, 1.2, coin.z);
      this.scene.add(mesh);
      coin.mesh = mesh;
    }

    // the gold mission beacon: a light pillar + a spinning diamond
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 60, 12, 1, true), beaconMat);
    this.beacon.position.y = 30;
    this.scene.add(this.beacon);
    this.beaconTop = new THREE.Mesh(new THREE.OctahedronGeometry(1.6), new THREE.MeshBasicMaterial({ color: 0xffd23e }));
    this.scene.add(this.beaconTop);

    // street props: a few benches + hydrants for the sidewalks
    this.addProps();

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this.wireMenus();
    const shot = params.get('shot');
    if (shot) {
      const steps = stageShot(shot, this);
      for (let i = 0; i < steps; i++) this.stepWorld(1 / 30);
      this.state.hud.update(0);
    }
    this.last = performance.now();
    const loop = (now) => {
      requestAnimationFrame(loop);
      const dt = clamp((now - this.last) / 1000, 0, 0.05);
      this.last = now;
      this.frame(dt);
    };
    requestAnimationFrame(loop);
  }

  addProps() {
    const benchMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
    const hydMat = new THREE.MeshLambertMaterial({ color: 0xc93d3d });
    for (let i = 0; i < 14; i++) {
      const x = -240 + (i % 7) * 80, z = -180 + Math.floor(i / 7) * 360;
      const bench = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.8), benchMat);
      bench.position.set(x + 10, 0.5, z + 10);
      this.scene.add(bench);
      const hyd = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 1, 8), hydMat);
      hyd.position.set(x - 10, 0.5, z - 10);
      this.scene.add(hyd);
    }
  }

  // ------------------------------------------------------------ menus
  hideMenus() {
    this.state.hud.showMenu(false);
    this.state.hud.showPause(false);
    this.state.hud.hideEnd();
  }

  wireMenus() {
    const s = this.state;
    const startPlaying = (fresh) => {
      s.audio.start();
      this.hideMenus();
      s.mode = 'playing';
      if (fresh) {
        s.missions.start(0);
        s.feed.push('Mara: first job\'s on the board — steal a car, any car.');
      }
    };
    document.getElementById('btn-new').addEventListener('click', () => {
      s.save.clear();
      this.resetRun();
      startPlaying(true);
    });
    document.getElementById('btn-continue').addEventListener('click', () => {
      if (!s.save.hasSave()) {
        s.feed.push('No save yet — start a New Game.');
        s.hud.drainFeed();
        return;
      }
      s.save.load();
      this.hideMenus();
      s.mode = 'playing';
      s.audio.start();
      s.feed.push('Welcome back to Velora Bay.');
    });
    document.getElementById('btn-how').addEventListener('click', () => {
      const t = document.getElementById('how-text');
      t.style.display = t.style.display === 'none' ? 'block' : 'none';
    });
    document.getElementById('btn-resume').addEventListener('click', () => {
      this.hideMenus(); s.mode = 'playing'; s.paused = false;
    });
    document.getElementById('btn-save').addEventListener('click', () => {
      s.save.write();
      s.feed.push('Game saved.');
      s.hud.drainFeed();
    });
    document.getElementById('btn-restart-mission').addEventListener('click', () => {
      if (s.missions.active) {
        const idx = s.missions.active.def.id - 1;
        s.combat.clearMissionObjects();
        s.missions.active = null;
        s.missions.start(idx);
      }
      this.hideMenus(); s.mode = 'playing'; s.paused = false;
    });
    document.getElementById('btn-quit').addEventListener('click', () => {
      s.save.write();
      s.mode = 'menu';
      this.hideMenus();
      s.hud.showMenu(true);
    });
    document.getElementById('btn-retry').addEventListener('click', () => {
      this.respawn();
      this.hideMenus();
      s.mode = 'playing';
    });
    document.getElementById('btn-end-menu').addEventListener('click', () => {
      s.save.write();
      s.mode = 'menu';
      this.hideMenus();
      s.hud.showMenu(true);
    });
    // Continue is disabled-looking when there is no save
    document.getElementById('btn-continue').style.opacity = s.save.hasSave() ? '1' : '0.45';
  }

  resetRun() {
    const s = this.state;
    const fresh = createGameState(SEED);
    // keep the built world, reset only the run state
    s.player.x = 0; s.player.z = 190; s.player.heading = Math.PI;
    s.player.health = 100; s.player.armor = 0; s.player.money = 250;
    s.player.weapon = 'fists'; s.player.ammo = 0; s.player.inCar = null;
    s.player.wanted = 0; s.player.dead = false; s.player.busted = false;
    s.stats = fresh.stats; s.progress = fresh.progress;
    s.clockMinutes = 16 * 60 + 30; s.day = 1; s.time = 0;
    s.missions.active = null;
    s.police.clearWanted(s.player);
    s.combat.clearMissionObjects();
  }

  respawn() {
    const s = this.state;
    const p = s.player;
    if (p.inCar) this.exitCar();
    p.x = -30; p.z = -258; p.heading = Math.PI;
    p.health = 100; p.armor = 50; p.dead = false; p.busted = false;
    p.money = Math.max(0, Math.floor(p.money * 0.9));
    s.police.clearWanted(p);
    if (s.missions.active) {
      const idx = s.missions.active.def.id - 1;
      s.combat.clearMissionObjects();
      s.missions.active = null;
      s.feed.push('You wake up at the safehouse. The job is still open — press ENTER to retry it.');
      s.progress.retryMission = idx;
    }
  }

  setCamera(yaw, pitch, dist) {
    this.camYaw = yaw; this.camPitch = pitch; this.camDist = dist;
  }

  // ------------------------------------------------------------ cars
  nearestFreeCar(maxD = 4.5) {
    const p = this.state.player;
    let best = null, bd = maxD;
    const consider = (car) => {
      if (!car || car === p.inCar) return;
      const d = dist2(p.x, p.z, car.x, car.z);
      if (d < bd) { bd = d; best = car; }
    };
    for (const c of this.parkedCars) consider(c);
    for (const c of this.state.traffic.cars) consider(c);
    for (const c of this.state.police.cops) consider(c);
    for (const c of this.state.police.roadblocks) consider(c);
    if (this.state.combat.takeCar) consider(this.state.combat.takeCar);
    return best;
  }

  enterCar(car) {
    const s = this.state;
    const p = s.player;
    // pull the car out of whatever list owned it
    if (!car.mesh.parent) this.scene.add(car.mesh);
    this.parkedCars = this.parkedCars.filter((c) => c !== car);
    s.traffic.cars = s.traffic.cars.filter((c) => c !== car);
    if (car.driver === 'cop') {
      s.police.cops = s.police.cops.filter((c) => c !== car);
      s.police.addWanted(p, 2, 'You stole a police cruiser', s);
    } else if (car !== s.combat.takeCar) {
      s.police.addWanted(p, 1, 'Grand theft auto', s);
      s.stats.carsStolen += 1;
    }
    car.driver = 'player';
    p.inCar = car;
    p.x = car.x; p.z = car.z; p.heading = car.heading;
    this.playerMesh.visible = false;
    s.audio.horn();
    s.feed.push(`You took the ${CAR_KINDS[car.kind]?.name || car.kind}.`);
  }

  exitCar() {
    const s = this.state;
    const p = s.player;
    const car = p.inCar;
    if (!car) return;
    car.driver = null;
    car.speed = 0;
    p.x = car.x + Math.cos(car.heading) * 2.4;
    p.z = car.z - Math.sin(car.heading) * 2.4;
    p.heading = car.heading;
    p.inCar = null;
    if (!this.parkedCars.includes(car)) this.parkedCars.push(car);
    this.playerMesh.visible = true;
  }

  // ------------------------------------------------------------ per-frame
  frame(dt) {
    const s = this.state;
    window.__velora.frames += 1;
    if (s.mode === 'playing' && !s.paused) {
      this.stepWorld(dt);
    }
    // camera always follows, even on menus (slow orbit over the city)
    this.updateCamera(dt);
    if (s.city) s.city.update(dt, s.clockMinutes);
    this.renderer.render(this.scene, this.camera);
    if (s.mode === 'playing' || s.mode === 'complete') s.hud.update(dt);
    this.input.endFrame();
  }

  stepWorld(dt) {
    const s = this.state;
    const p = s.player;
    const inp = this.input;
    s.time += dt;
    s.stats.playSeconds += dt;
    s.clockMinutes += dt * 0.4; // one game hour every 150 s
    if (s.clockMinutes >= 24 * 60) { s.clockMinutes -= 24 * 60; s.day += 1; }

    // --- global keys ---------------------------------------------------
    if (inp.wasPressed('Escape') || inp.wasPressed('KeyP')) {
      s.paused = true; s.mode = 'paused';
      s.hud.showPause(true);
      document.getElementById('pause-stats').textContent =
        `Day ${s.day} • ${formatCash(p.money)} • ${s.stats.missionsDone}/10 jobs done • ${s.stats.carsStolen} cars stolen • ${s.stats.coins} sun coins • ${s.stats.faresDone} fares`;
      return;
    }
    if (inp.wasPressed('KeyM')) {
      s.flags.radioMuted = !s.flags.radioMuted;
      s.audio.setMuted(s.flags.radioMuted);
    }
    if (inp.wasPressed('KeyR')) {
      s.flags.radioStation = (s.flags.radioStation + 1) % s.audio.stations.length;
      s.feed.push(`Radio: ${s.audio.stations[s.flags.radioStation].name}`);
    }
    if (inp.wasPressed('Enter')) {
      if (!s.missions.active) {
        const idx = s.progress.retryMission ?? s.progress.missionIndex;
        if (idx < 10) { s.missions.start(idx); s.progress.retryMission = undefined; }
      }
    }
    if (inp.wasPressed('Digit1')) { p.weapon = 'fists'; }
    if (inp.wasPressed('Digit2')) {
      if (s.progress.unlocked.pistol || s.progress.unlocked.smg) {
        p.weapon = s.progress.unlocked.smg ? 'smg' : 'pistol';
        if (p.ammo <= 0) p.ammo = 24;
      } else s.feed.push('No gun yet — finish Job 9, Harbor Lights.');
    }
    if (inp.wasPressed('KeyH') && p.inCar) s.audio.horn();
    if (inp.wasPressed('KeyT')) this.startTaxi();

    // --- autopilot (screenshot staging) overrides the keys -------------
    let driveInput = null, walkInput = null;
    if (this.autopilot) {
      const a = this.autopilot(dt);
      if (p.inCar) driveInput = a; else walkInput = a;
    }

    // --- movement ------------------------------------------------------
    if (p.inCar) {
      const d = driveInput || inp.drive();
      const drive = driveCar(p.inCar, d, dt, s.city);
      if (drive.scrape) {
        s.audio.crash();
        s.pedestrians.scare(p.inCar.x, p.inCar.z, 25);
        this.damagePlayer(2);
      }
      p.x = p.inCar.x; p.z = p.inCar.z; p.heading = p.inCar.heading;
      s.stats.distanceDriven += Math.abs(p.inCar.speed) * dt;
      if (p.inCar.hp <= 0) {
        s.feed.push('Your car is wrecked!', 'gold');
        s.audio.crash();
        this.scene.remove(p.inCar.mesh);
        p.inCar = null;
        this.playerMesh.visible = true;
      }
      if (inp.wasPressed('KeyE')) this.exitCar();
    } else {
      const w = walkInput || inp.walk();
      const moving = stepPlayerOnFoot(p, w, this.camYaw, dt, s.city);
      if (moving) this.walkPhase += dt * p.speed * 2.2;
      // soft body: don't stand inside a car
      const allCars = [...this.parkedCars, ...s.traffic.cars, ...s.police.cops];
      for (const car of allCars) {
        const d = dist2(p.x, p.z, car.x, car.z);
        if (d < 2.4 && d > 0.01) {
          p.x = car.x + ((p.x - car.x) / d) * 2.4;
          p.z = car.z + ((p.z - car.z) / d) * 2.4;
        }
      }
      if (inp.wasPressed('KeyE')) {
        const car = this.nearestFreeCar();
        if (car) this.enterCar(car);
        else this.tryInteract();
      }
      if (inp.wasPressed('KeyF')) s.combat.punch(p);
      if (inp.mouseDown && p.weapon !== 'fists') s.combat.shoot(this.camera, p);
    }

    // camera orbit from mouse drag / wheel
    this.camYaw -= inp.mouseDX * 0.005;
    this.camPitch = clamp(this.camPitch + inp.mouseDY * 0.003, 0.12, 1.1);
    this.camDist = clamp(this.camDist + inp.wheel * 0.01, 8, 24);

    // --- world systems --------------------------------------------------
    s.traffic.step(dt, p);
    s.pedestrians.step(dt, null);
    s.police.step(dt, p, s);
    s.combat.step(dt, p, this.camera);
    s.missions.update(dt);
    this.updateTaxi(dt);
    this.updateCoins(dt);
    this.updatePlaces(dt);

    // --- death / busted -------------------------------------------------
    if (p.dead) {
      s.stats.deaths += 1;
      s.mode = 'wasted';
      s.hud.showEnd('WASTED', 'The Bay got the better of you. You wake up at the safehouse, 10% lighter.');
      s.audio.crash();
      return;
    }
    if (p.busted) {
      p.busted = false;
      s.stats.arrests += 1;
      s.mode = 'busted';
      s.hud.showEnd('BUSTED', 'The VBPD took you in. You wake up at the safehouse, 10% lighter — and the job is still open.');
      return;
    }

    // --- audio + HUD ----------------------------------------------------
    s.audio.update(dt, s);
    s.hud.drainFeed();
    this.syncPlayerMesh();
    this.updateBeacon();
  }

  syncPlayerMesh() {
    const p = this.state.player;
    this.playerMesh.position.set(p.x, 0, p.z);
    this.playerMesh.rotation.y = p.heading;
    animateWalk(this.playerMesh, this.walkPhase, clamp(p.speed / 8, 0, 1));
  }

  updateBeacon() {
    const s = this.state;
    const marker = s.missions.marker() || (s.taxi ? s.taxi.marker : null);
    const has = !!marker;
    this.beacon.visible = has;
    this.beaconTop.visible = has;
    if (has) {
      this.beacon.position.set(marker.x, 30, marker.z);
      this.beaconTop.position.set(marker.x, 14 + Math.sin(s.time * 2) * 0.8, marker.z);
      this.beaconTop.rotation.y += 0.02;
    }
  }

  updateCamera(dt) {
    const s = this.state;
    const p = s.player;
    if (s.mode === 'menu') {
      const t = performance.now() / 1000;
      this.camera.position.set(Math.sin(t * 0.05) * 260, 120, Math.cos(t * 0.05) * 260);
      this.camera.lookAt(0, 10, 0);
      return;
    }
    // in a car the camera swings behind the car; on foot it follows the orbit yaw
    if (p.inCar) {
      const target = p.inCar.heading;
      let diff = target - this.camYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.camYaw += diff * clamp(dt * 1.6, 0, 1);
    }
    const tx = p.x, tz = p.z;
    const dirX = -Math.sin(this.camYaw) * Math.cos(this.camPitch);
    const dirZ = -Math.cos(this.camYaw) * Math.cos(this.camPitch);
    const dirY = Math.sin(this.camPitch);
    // pull the camera in when a building stands between it and the player
    let frac = 1;
    const insideBuilding = (x, z, y) => {
      if (y > 30) return false;
      for (const c of s.city.colliders) {
        if (Math.abs(x - c.x) < c.hx + 1.5 && Math.abs(z - c.z) < c.hz + 1.5) return true;
      }
      return false;
    };
    for (const f of [1, 0.8, 0.6, 0.45, 0.3]) {
      if (!insideBuilding(tx + dirX * this.camDist * f, tz + dirZ * this.camDist * f, dirY * this.camDist * f + 2.5)) { frac = f; break; }
      frac = f;
    }
    const dist = this.camDist * frac;
    const cx = tx + dirX * dist;
    const cz = tz + dirZ * dist;
    const cy = dirY * dist + 2.5;
    this.camera.position.x = lerp(this.camera.position.x, cx, clamp(dt * 8, 0, 1));
    this.camera.position.y = lerp(this.camera.position.y, cy, clamp(dt * 8, 0, 1));
    this.camera.position.z = lerp(this.camera.position.z, cz, clamp(dt * 8, 0, 1));
    this.camera.lookAt(tx, 1.6, tz);
  }

  updateCoins(dt) {
    const s = this.state;
    const p = s.player;
    for (const coin of s.city.coins) {
      if (coin.taken || !coin.mesh) continue;
      coin.mesh.rotation.y += dt * 2;
      if (dist2(p.x, p.z, coin.x, coin.z) < 2.6) {
        coin.taken = true;
        coin.mesh.visible = false;
        s.progress.coinsFound.push(coin.id);
        s.stats.coins += 1;
        p.money += 50;
        s.feed.push(`Sun coin +$50 (${s.stats.coins}/30)`, 'gold');
        s.audio.pickup();
      }
    }
  }

  /** Safehouse, garage and Dino's Autos: proximity actions. */
  updatePlaces(dt) {
    const s = this.state;
    const p = s.player;
    // safehouse: heal + clear wanted + save
    if (dist2(p.x, p.z, -30, -270) < 9) {
      if (p.health < 100 || p.wanted > 0) {
        p.health = 100; p.armor = Math.max(p.armor, 50);
        s.police.clearWanted(p);
        s.save.autosave();
        s.feed.push('Safehouse — healed, heat cleared, game saved.', 'gold');
        s.audio.jingle();
      }
    }
    // garage: press G to take your garage car
    if (!p.inCar && dist2(p.x, p.z, -90, -270) < 8 && this.input.wasPressed('KeyG')) {
      const kind = s.garageCar;
      const car = makeCar(kind, -90, -258, Math.PI);
      this.scene.add(car.mesh); syncCarMesh(car);
      this.parkedCars.push(car);
      this.enterCar(car);
    }
    // Dino's Autos: press B to buy the next car you can afford
    if (!p.inCar && dist2(p.x, p.z, 150, -90) < 10 && this.input.wasPressed('KeyB')) {
      const order = ['taxi', 'muscle', 'suv', 'sports'];
      const next = order.find((k) => !s.progress.ownedCars.includes(k) && p.money >= CAR_KINDS[k].price);
      if (next) {
        p.money -= CAR_KINDS[next].price;
        s.progress.ownedCars.push(next);
        s.garageCar = next;
        s.feed.push(`Bought the ${CAR_KINDS[next].name} — it's in your garage (G).`, 'gold');
        s.audio.jingle();
      } else {
        s.feed.push('Nothing affordable here right now — run a job first.');
      }
    }
  }

  /** Taxi side job: hail a fare, pick them up, drop them off. */
  startTaxi() {
    const s = this.state;
    const p = s.player;
    if (s.taxi) { s.feed.push('You already have a fare — check the gold marker.'); return; }
    if (p.inCar) { s.feed.push('Taxi fares start on foot — get out and press T near a road.'); return; }
    const node = s.city.roadNodes[Math.floor(Math.random() * s.city.roadNodes.length)];
    const target = { x: node.x, z: node.z };
    s.taxi = { phase: 'pickup', passenger: { x: p.x + 6, z: p.z + 6 }, target, timer: 150, marker: { x: p.x + 6, z: p.z + 6 } };
    s.audio.phoneRing();
    s.feed.push('Taxi fare: pick up the passenger at the gold marker, then drive them across town.', 'gold');
  }

  updateTaxi(dt) {
    const s = this.state;
    const t = s.taxi;
    if (!t) return;
    const p = s.player;
    t.timer -= dt;
    if (t.timer <= 0) { s.feed.push('The fare gave up waiting.'); s.taxi = null; return; }
    if (t.phase === 'pickup') {
      t.marker = t.passenger;
      if (p.inCar && dist2(p.x, p.z, t.passenger.x, t.passenger.z) < 6) {
        t.phase = 'dropoff';
        t.marker = t.target;
        s.feed.push('Passenger aboard — drive to the gold marker.');
      }
    } else {
      t.marker = t.target;
      if (dist2(p.x, p.z, t.target.x, t.target.z) < 9) {
        const pay = 40 + Math.floor(Math.random() * 50);
        p.money += pay;
        s.stats.faresDone += 1;
        s.feed.push(`Fare complete +$${pay} — nice driving.`, 'gold');
        s.audio.jingle();
        s.taxi = null;
      }
    }
  }

  tryInteract() {
    const s = this.state;
    const p = s.player;
    if (dist2(p.x, p.z, -90, -270) < 8) {
      s.feed.push(`Garage: your ${CAR_KINDS[s.garageCar].name} is ready — press G to take it. Owned: ${s.progress.ownedCars.join(', ')}.`);
    } else if (dist2(p.x, p.z, 150, -90) < 10) {
      s.feed.push('Dino\'s Autos — press B to buy the next car you can afford (Taxi $900, Muscle $1,200, SUV $2,000, GT $4,500).');
    } else if (dist2(p.x, p.z, -30, -270) < 9) {
      s.feed.push('Safehouse — step inside to heal, clear heat and save.');
    }
  }

  damagePlayer(amount) {
    this.state.combat.damagePlayer(amount);
  }
}

new Game();
