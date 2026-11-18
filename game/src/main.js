// Velora Bay — boot, game loop and state machine. Each system owns its
// own file; this one wires the city, player, cars, HUD, audio and save.
import * as THREE from 'three';
import { CITY, COLORS, KEYS, PLAYER_TUNING, COMBAT_TUNING, districtAt, WEAPON_SHOP, SAFEHOUSE } from './config.js';
import { clamp, angleLerp } from './utils.js';
import { buildCity } from './city.js';
import { createPlayer, updatePlayerOnFoot, damagePlayer, healPlayer } from './player.js';
import {
  createCar, spawnTraffic, spawnParkedCars, updateTrafficCar,
  updatePlayerCar, findNearestCar, recycleTraffic, damageCar,
} from './vehicles.js';
import { initHUD, updateHUD, drawMinimap, showStartScreen, showPauseScreen, setStartButtons, setHudVisible, showMissionCard, updateMissionList } from './hud.js';
import {
  initAudio, setEngine, playClick, playCash, playHorn, playJump,
  playSiren, startSirenLoop, stopSirenLoop, playShot, playPunch,
  playPickup, playReload, playMission, playBusted, playBump, startMusic,
  setRadioStation, radioName, startRotorLoop, stopRotorLoop,
} from './audio.js';
import { saveGame, loadGame, hasSave } from './save.js';
import { createPedestrians, updatePedestrians, knockPedDown, nearestPed } from './pedestrians.js';
import { createPoliceSystem, buildPaintShop, PAINT_SHOP, PIER_RESPAWN } from './police.js';
import { createCombatSystem } from './combat.js';
import { createMissionSystem, MISSIONS } from './missions.js';
import { readShotParams, stageShot } from './shots.js';

const FIXED_DT = 1 / 60;
const HOSPITAL = { x: 116, z: 87 };

// Pointer lock can reject in headless browsers (no user gesture yet);
// swallow that — the game plays fine with the mouse unlocked.
function safePointerLock(canvas) {
  try {
    const result = canvas.requestPointerLock?.();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch (err) { /* pointer lock unavailable */ }
}

function createRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById('game-canvas') });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  return renderer;
}

function createLights(scene) {
  const sun = new THREE.DirectionalLight(COLORS.sun, 2.9);
  sun.position.set(140, 190, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -190;
  sun.shadow.camera.right = 190;
  sun.shadow.camera.top = 190;
  sun.shadow.camera.bottom = -190;
  sun.shadow.camera.far = 600;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x8a7a5a, 0.9);
  scene.add(hemi);
  return { sun, hemi };
}

function createSmokeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(60,60,60,0.85)');
  grad.addColorStop(1, 'rgba(60,60,60,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

export function bootGame() {
  const renderer = createRenderer();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.sky);
  scene.fog = new THREE.Fog(COLORS.fog, 180, 520);
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
  const lights = createLights(scene);
  const city = buildCity(scene);

  const player = createPlayer(scene, city.spawnPoint);
  const traffic = spawnTraffic(scene, city);
  const parked = spawnParkedCars(scene, city);
  const peds = createPedestrians(scene, city);
  buildPaintShop(scene);

  const smokeTex = createSmokeTexture();
  const smokeSprites = [];

  const state = {
    screen: 'menu', // menu | playing | paused
    menuFocus: '', // '' = orbit downtown; 'beach' = cover shot framing
    money: 250,
    health: PLAYER_TUNING.maxHealth,
    wanted: 0,
    ammo: COMBAT_TUNING.startAmmo,
    ammoReserve: 48,
    day: 1,
    clockMinutes: 8 * 60 + 15,
    objective: 'Meet Mama Lou at the pier',
    missionTimer: 0,
    damageFlash: 0,
    shake: 0,
    speedKmh: 0,
    inCar: false,
    nearCar: false,
    playerX: player.pos.x,
    playerZ: player.pos.z,
    playerHeading: player.heading,
    cameraYaw: Math.PI,
    cameraPitch: 0.32,
    traffic,
    police: [],
    peds,
    gang: [],
    missionMarker: city.missionMarker,
    missionsCompleted: [],
    currentMission: 0,
    radio: 0,
    radioName: 'VELORA FM',
    weapon: 'pistol', // pistol | smg (bought at VELORA ARMS)
    goldStored: false,
    district: 'Beachfront',
    nearShop: false,
    inSafehouse: false,
    safeTimer: 0,
    stats: { carsStolen: 0, distanceDriven: 0, crashes: 0, missionsDone: 0, timesBusted: 0, timesWasted: 0, kingsDefeated: 0, pedsHit: 0 },
    time: 0,
    gunshotPos: null,
    gunshotTimer: 0,
    lastCrimeAt: -10,
  };

  const input = {
    forward: false, back: false, left: false, right: false,
    sprint: false, jump: false, handbrake: false,
  };
  const keysDown = new Set();

  // --- Crime, damage, busted / wasted -------------------------------------
  // A 1.5 s cooldown stops one crash or burst from counting five times.
  function addCrime(level, reason) {
    if (state.time - state.lastCrimeAt < 1.5) return;
    state.lastCrimeAt = state.time;
    setWanted(state.wanted + level);
    void reason;
  }

  function setWanted(level) {
    state.wanted = clamp(level, 0, 5);
    if (state.wanted >= 3) playSiren();
  }

  // Hurt the player: red vignette flash, a camera shake, and the wasted
  // flow when health runs out.
  function hurtPlayer(amount, source) {
    if (state.screen !== 'playing') return;
    damagePlayer(player, amount);
    state.health = player.health;
    state.damageFlash = Math.min(1, state.damageFlash + 0.7);
    state.shake = Math.min(1, state.shake + 0.4);
    void source;
  }

  function loseCashFraction(fraction) {
    const lost = Math.floor(state.money * fraction);
    state.money = Math.max(0, state.money - lost);
    return lost;
  }

  function exitCarQuiet() {
    const car = player.inCar;
    if (!car) return;
    car.isPlayer = false;
    player.inCar = null;
    state.inCar = false;
    player.model.visible = true;
    setEngine(0, false);
  }

  function bustPlayer() {
    const lost = loseCashFraction(0.1);
    state.stats.timesBusted += 1;
    missions.failMission('Busted by the police.');
    policeSys.clearAll();
    setWanted(0);
    exitCarQuiet();
    player.pos.set(PIER_RESPAWN.x, 0, PIER_RESPAWN.z);
    player.vel.set(0, 0, 0);
    playBusted();
    showMissionCard('BUSTED', `The cops caught you at the pier. You lost $${lost.toLocaleString('en-US')} — 10% of your cash.`, 'fail');
    saveGame(state);
  }

  function wastePlayer() {
    const lost = loseCashFraction(0.1);
    state.stats.timesWasted += 1;
    missions.failMission('Wasted — you blacked out.');
    policeSys.clearAll();
    setWanted(0);
    exitCarQuiet();
    player.health = PLAYER_TUNING.maxHealth;
    state.health = player.health;
    player.pos.set(HOSPITAL.x, 0, HOSPITAL.z);
    player.vel.set(0, 0, 0);
    playBusted();
    showMissionCard('WASTED', `You woke up at the hospital. The bill cost you $${lost.toLocaleString('en-US')} — 10% of your cash.`, 'fail');
    saveGame(state);
  }

  function respawnPlayer() {
    player.health = PLAYER_TUNING.maxHealth;
    state.health = player.health;
    state.money = Math.floor(state.money * 0.9);
    player.pos.set(city.spawnPoint.x, 0, city.spawnPoint.z);
    player.vel.set(0, 0, 0);
    if (player.inCar) exitCar();
    state.objective = 'Meet Mama Lou at the pier';
  }

  // --- Systems (created after state so their hooks can close over it) ----
  const allCars = () => [...parked, ...traffic, ...policeSys.cars];

  const policeSys = createPoliceSystem(scene, city, {
    damagePlayer: (amount, source) => hurtPlayer(amount, source),
    onBusted: () => bustPlayer(),
    tryPaintShop: () => {
      if (state.money < PAINT_SHOP.price) {
        showMissionCard("LOU'S PAINT SHOP", `A repaint costs $${PAINT_SHOP.price} — you only have $${state.money}.`, 'fail');
        return false;
      }
      state.money -= PAINT_SHOP.price;
      setWanted(0);
      playCash();
      showMissionCard("LOU'S PAINT SHOP", 'Fresh paint, clean slate. The cops have lost you.', 'complete');
      return true;
    },
    startRotor: () => startRotorLoop(),
    stopRotor: () => stopRotorLoop(),
  });
  state.police = policeSys.cars;

  const combat = createCombatSystem(scene, {
    addCash: (amount) => { state.money += amount; },
    onGunshot: (point) => {
      state.gunshotPos = point;
      state.gunshotTimer = 2;
      addCrime(1, 'shooting');
    },
    onPedHit: () => {
      state.stats.pedsHit += 1;
      addCrime(1, 'hitting a pedestrian');
    },
    onPoliceHit: () => addCrime(2, 'shooting a cop'),
    onGangKill: () => { state.stats.kingsDefeated += 1; },
    damagePlayer: (amount, source) => hurtPlayer(amount, source),
    onEnemyShot: () => playShot(),
  });
  combat.spawnPickups(city, 8);
  state.gang = combat.gang;

  const missions = createMissionSystem(scene, city, {
    getPlayerPos: () => player.pos,
    getTime: () => state.time,
    isInCar: () => !!player.inCar,
    isInGoldCar: (car) => !!car && player.inCar === car,
    getWanted: () => state.wanted,
    setWanted: (level) => setWanted(level),
    spawnGang: (x, z, count) => combat.spawnGang(x, z, count),
    getGangAlive: () => combat.gangAlive(),
    clearGang: () => combat.clearGang(),
    spawnGoldCar: (x, z) => {
      const car = createCar(scene, 'sport', 0xd4af37, x, z, Math.PI / 2);
      car.parked = true;
      parked.push(car);
      return car;
    },
    onReward: (amount) => {
      state.money += amount;
      state.stats.missionsDone += 1;
      playCash();
      playMission();
      saveGame(state);
    },
    onMissionStart: (m) => { state.currentMission = MISSIONS.indexOf(m); },
    onMissionComplete: () => { saveGame(state); },
    onMissionFail: () => { saveGame(state); },
    onStoryComplete: () => {
      showMissionCard('KING OF VELORA BAY', 'Eight jobs. One city. Rico Vale runs Velora Bay now.', 'complete');
      playMission();
    },
    showCard: (title, body, kind) => showMissionCard(title, body, kind),
    setObjective: (text) => { state.objective = text; },
    setMarker: (x, z) => {
      state.missionMarker = x === null ? null : { x, z, label: state.objective };
    },
    setMissionTimer: (seconds) => { state.missionTimer = seconds; },
  });

  // --- Camera -------------------------------------------------------------
  function updateCamera(dt) {
    const target = player.inCar ? player.inCar.pos : player.pos;
    const targetY = player.inCar ? 1.4 : 1.7;
    if (player.inCar) {
      // Chase cam: ease behind the car's heading, widen FOV with speed.
      const wantYaw = player.inCar.heading + Math.PI;
      state.cameraYaw = angleLerp(state.cameraYaw, wantYaw, Math.min(1, dt * 2.2));
      state.cameraPitch = angleLerp(state.cameraPitch, 0.3, dt * 2);
      const speed01 = clamp(Math.abs(player.inCar.speed) / 42, 0, 1);
      camera.fov = angleLerp(camera.fov, 62 + speed01 * 13, dt * 3);
      camera.updateProjectionMatrix();
    }
    const dist = player.inCar ? 11.5 : 7.5;
    const cy = state.cameraYaw;
    const cp = state.cameraPitch;
    const cx = target.x - Math.sin(cy) * Math.cos(cp) * dist;
    const cz = target.z + Math.cos(cy) * Math.cos(cp) * dist;
    const camY = targetY + Math.sin(cp) * dist + 1.2;
    // Screen shake after taking damage.
    const sh = state.shake * 0.5;
    camera.position.set(
      cx + (Math.random() - 0.5) * sh,
      Math.max(camY, 1.2) + (Math.random() - 0.5) * sh,
      cz + (Math.random() - 0.5) * sh,
    );
    camera.lookAt(target.x, targetY, target.z);
  }

  // --- Entering / exiting cars --------------------------------------------
  function enterCar(car) {
    player.inCar = car;
    car.isPlayer = true;
    car.parked = false;
    player.model.visible = false;
    state.inCar = true;
    state.stats.carsStolen += 1;
    if (car.kind !== 'police') addCrime(1, 'stealing a car');
    playCash();
  }

  function exitCar() {
    const car = player.inCar;
    if (!car) return;
    car.isPlayer = false;
    player.inCar = null;
    state.inCar = false;
    player.pos.set(car.pos.x + 2.4, 0, car.pos.z);
    player.vel.set(0, 0, 0);
    player.heading = car.heading;
    player.model.visible = true;
    setEngine(0, false);
  }

  function tryEnterCar() {
    if (player.inCar) {
      exitCar();
      return;
    }
    const car = findNearestCar(player.pos, allCars(), 3.2);
    if (car) enterCar(car);
  }

  // --- Combat actions -------------------------------------------------------
  function shootPistol() {
    if (player.inCar || state.screen !== 'playing') return;
    const burst = state.weapon === 'smg' ? 3 : 1;
    if (state.ammo < burst) {
      playClick();
      return;
    }
    state.ammo -= burst;
    playShot();
    const origin = { x: player.pos.x, y: player.pos.y + 1.6, z: player.pos.z };
    // Aim at chest height 30 m ahead: the chase camera looks down, so
    // its raw forward ray would dive into the ground.
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const flat = Math.hypot(fwd.x, fwd.z) || 1;
    const aim = {
      x: origin.x + (fwd.x / flat) * 30,
      y: 1.2,
      z: origin.z + (fwd.z / flat) * 30,
    };
    const dl = Math.hypot(aim.x - origin.x, aim.y - origin.y, aim.z - origin.z);
    const dir = {
      x: (aim.x - origin.x) / dl,
      y: (aim.y - origin.y) / dl,
      z: (aim.z - origin.z) / dl,
    };
    for (let s = 0; s < burst; s += 1) {
      const spread = burst > 1 ? (s - 1) * 0.03 : 0;
      const c = Math.cos(spread);
      const sn = Math.sin(spread);
      combat.shoot(origin, {
        x: dir.x * c - dir.z * sn, y: dir.y, z: dir.x * sn + dir.z * c,
      }, { peds, cars: allCars() });
    }
  }

  function punch() {
    if (player.inCar || state.screen !== 'playing') return;
    playPunch();
    const result = combat.punch(player.pos, player.heading, { peds });
    if (result.hit) state.damageFlash = Math.max(state.damageFlash, 0.15);
  }

  function reload() {
    if (player.inCar || state.screen !== 'playing') return;
    if (state.ammoReserve <= 0 || state.ammo >= COMBAT_TUNING.startAmmo) return;
    const need = COMBAT_TUNING.startAmmo - state.ammo;
    const moved = Math.min(need, state.ammoReserve);
    state.ammo += moved;
    state.ammoReserve -= moved;
    playReload();
  }

  // --- VELORA ARMS: buy ammo or an SMG with mission cash --------------
  function buy(price, give, name, okMsg) {
    if (!state.nearShop || state.screen !== 'playing') return;
    if (state.money < price) {
      showMissionCard('VELORA ARMS', `${name} costs $${price} — you only have $${state.money}.`, 'fail');
      return;
    }
    state.money -= price;
    give();
    playCash();
    showMissionCard('VELORA ARMS', okMsg, 'info');
  }
  function buyAmmo() {
    buy(WEAPON_SHOP.ammoPrice, () => { state.ammoReserve += 24; }, 'Ammo', `+24 reserve ammo for $${WEAPON_SHOP.ammoPrice}. Press R to reload.`);
  }
  function buySmg() {
    if (state.weapon === 'smg') { showMissionCard('VELORA ARMS', 'You already own the SMG.', 'info'); return; }
    buy(WEAPON_SHOP.smgPrice, () => { state.weapon = 'smg'; }, 'The SMG', 'SMG bought — three-round bursts.');
  }

  function cycleRadio() {
    if (state.screen !== 'playing') return;
    state.radio = (state.radio + 1) % 3;
    state.radioName = setRadioStation(state.radio);
  }

  // --- Screens --------------------------------------------------------------
  function startPlaying(fromSave) {
    initAudio();
    startMusic();
    if (fromSave) {
      const data = loadGame();
      if (data) applySave(data);
    } else {
      // New Game: fresh story, fresh pockets.
      state.money = 250;
      state.health = PLAYER_TUNING.maxHealth;
      player.health = state.health;
      state.wanted = 0;
      state.ammo = COMBAT_TUNING.startAmmo;
      state.ammoReserve = 48;
      state.missionsCompleted = [];
      state.currentMission = 0;
      state.radio = 0;
      state.radioName = 'VELORA FM';
      state.weapon = 'pistol';
      state.goldStored = false;
      state.stats = { carsStolen: 0, distanceDriven: 0, crashes: 0, missionsDone: 0, timesBusted: 0, timesWasted: 0, kingsDefeated: 0, pedsHit: 0 };
      missions.loadSaveData({ current: 0, completed: [] });
      player.pos.set(city.spawnPoint.x, 0, city.spawnPoint.z);
      player.vel.set(0, 0, 0);
    }
    state.screen = 'playing';
    showStartScreen(false);
    showPauseScreen(false);
    setHudVisible(true);
    playClick();
    safePointerLock(document.getElementById("game-canvas"));
  }

  function pauseGame() {
    if (state.screen !== 'playing') return;
    state.screen = 'paused';
    updateMissionList(MISSIONS, missions.current, missions.completed);
    showPauseScreen(true);
    saveGame(state);
    document.exitPointerLock?.();
  }

  function resumeGame() {
    state.screen = 'playing';
    showPauseScreen(false);
    safePointerLock(document.getElementById("game-canvas"));
  }

  function applySave(data) {
    state.money = data.money ?? state.money;
    state.health = data.health ?? state.health;
    player.health = state.health;
    state.wanted = data.wanted ?? 0;
    state.ammo = data.ammo ?? state.ammo;
    state.ammoReserve = data.ammoReserve ?? state.ammoReserve;
    state.day = data.day ?? 1;
    state.clockMinutes = data.clockMinutes ?? state.clockMinutes;
    state.missionsCompleted = data.missionsCompleted || [];
    state.currentMission = data.currentMission ?? state.missionsCompleted.length;
    state.goldStored = data.goldStored ?? false;
    state.stats = { ...state.stats, ...(data.stats || {}) };
    missions.loadSaveData({ current: state.currentMission, completed: state.missionsCompleted });
    if (state.goldStored && !missions.goldCar) {
      // The stored gold car waits at Mama Lou's garage.
      const car = createCar(scene, 'sport', 0xd4af37, SAFEHOUSE.x, SAFEHOUSE.z - 8, Math.PI / 2);
      car.parked = true;
      parked.push(car);
      missions.goldCar = car;
    }
    if (data.player) {
      player.pos.set(data.player.x, 0, data.player.z);
      player.heading = data.player.heading ?? player.heading;
    }
  }

  // --- Input ----------------------------------------------------------------
  const canvas = document.getElementById('game-canvas');
  window.addEventListener('keydown', (e) => {
    if (e.code === KEYS.pause && state.screen === 'playing') { pauseGame(); return; }
    if (e.code === KEYS.pause && state.screen === 'paused') { resumeGame(); return; }
    if (e.code === KEYS.missions && state.screen === 'playing') { pauseGame(); return; }
    if (e.code === KEYS.missions && state.screen === 'paused') { resumeGame(); return; }
    keysDown.add(e.code);
    if (e.code === KEYS.forward) input.forward = true;
    if (e.code === KEYS.back) input.back = true;
    if (e.code === KEYS.left) input.left = true;
    if (e.code === KEYS.right) input.right = true;
    if (e.code === KEYS.sprint) input.sprint = true;
    if (e.code === KEYS.jump) {
      input.jump = true;
      if (!player.inCar && state.screen === 'playing') playJump();
    }
    if (e.code === KEYS.enterCar && state.screen === 'playing' && !e.repeat) tryEnterCar();
    if (e.code === KEYS.horn && player.inCar && !e.repeat) playHorn();
    if (e.code === KEYS.reload && state.screen === 'playing' && !e.repeat) reload();
    if (e.code === KEYS.punch && state.screen === 'playing' && !e.repeat) punch();
    if (e.code === KEYS.radio && state.screen === 'playing' && !e.repeat) cycleRadio();
    if (e.code === KEYS.buyAmmo && state.screen === 'playing' && !e.repeat) buyAmmo();
    if (e.code === KEYS.buySmg && state.screen === 'playing' && !e.repeat) buySmg();
    if (e.code === 'Space' && player.inCar) input.handbrake = true;
    if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    keysDown.delete(e.code);
    if (e.code === KEYS.forward) input.forward = false;
    if (e.code === KEYS.back) input.back = false;
    if (e.code === KEYS.left) input.left = false;
    if (e.code === KEYS.right) input.right = false;
    if (e.code === KEYS.sprint) input.sprint = false;
    if (e.code === KEYS.jump) input.jump = false;
    if (e.code === 'Space') input.handbrake = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    state.cameraYaw -= e.movementX * 0.0028;
    state.cameraPitch = clamp(state.cameraPitch + e.movementY * 0.0022, 0.05, 1.1);
  });
  canvas.addEventListener('mousedown', (e) => {
    if (state.screen !== 'playing') return;
    if (e.button !== 0) return;
    if (document.pointerLockElement === canvas) shootPistol();
    else safePointerLock(canvas);
  });
  canvas.addEventListener('click', () => {
    if (state.screen === 'playing') safePointerLock(canvas);
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas && state.screen === 'playing') pauseGame();
  });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- Smoke puffs for wrecked cars ---------------------------------------
  function puffSmoke(car, dt) {
    car.smokeTimer -= dt;
    if (car.smokeTimer > 0) return;
    car.smokeTimer = 0.12;
    const mat = new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0.7, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(car.pos.x + (Math.random() - 0.5), 1.8, car.pos.z + (Math.random() - 0.5));
    sprite.scale.setScalar(1.4);
    sprite.userData.life = 1.4;
    scene.add(sprite);
    smokeSprites.push(sprite);
  }

  function updateSmoke(dt) {
    for (let i = smokeSprites.length - 1; i >= 0; i -= 1) {
      const s = smokeSprites[i];
      s.userData.life -= dt;
      s.position.y += dt * 1.6;
      s.scale.setScalar(s.scale.x + dt * 1.8);
      s.material.opacity = Math.max(0, s.userData.life * 0.45);
      if (s.userData.life <= 0) {
        scene.remove(s);
        s.material.dispose();
        smokeSprites.splice(i, 1);
      }
    }
  }

  // --- Fixed-step update ----------------------------------------------------
  function update(dt) {
    state.time += dt;
    // The in-game clock runs 2 game-minutes a real second.
    state.clockMinutes += dt * 2;
    if (state.clockMinutes >= 1440) {
      state.clockMinutes -= 1440;
      state.day += 1;
    }
    state.damageFlash = Math.max(0, state.damageFlash - dt * 1.8);
    state.shake = Math.max(0, state.shake - dt * 2.2);
    if (state.gunshotTimer > 0) {
      state.gunshotTimer -= dt;
      if (state.gunshotTimer <= 0) state.gunshotPos = null;
    }
    if (player.inCar) {
      // Staging only: autoThrottle holds the throttle for drive shots.
      const driveInput = state.autoThrottle ? { ...input, forward: true } : input;
      const speed01 = updatePlayerCar(player.inCar, dt, driveInput, allCars(), city.colliders);
      state.speedKmh = player.inCar.speed * 3.6;
      state.stats.distanceDriven += Math.abs(player.inCar.speed) * dt;
      setEngine(speed01, true);
      player.pos.copy(player.inCar.pos);
      player.heading = player.inCar.heading;
      if (player.inCar.wrecked) puffSmoke(player.inCar, dt);
      // Running over a pedestrian is a crime — and a tragedy.
      if (Math.abs(player.inCar.speed) > 5) {
        const ped = nearestPed(player.inCar.pos, peds, 2.2);
        if (ped) {
          knockPedDown(ped, 6);
          state.stats.pedsHit += 1;
          addCrime(1, 'hitting a pedestrian');
          playBump();
        }
      }
    } else {
      updatePlayerOnFoot(player, dt, input, state.cameraYaw, city.colliders, city.cityBounds);
      state.speedKmh = 0;
      setEngine(0, false);
      // Traffic that clips the player on foot hurts.
      for (const car of allCars()) {
        if (car.wrecked) continue;
        const d = Math.hypot(car.pos.x - player.pos.x, car.pos.z - player.pos.z);
        if (d < 2.2 && Math.abs(car.speed || 0) > 4) {
          hurtPlayer(10, 'hit by a car');
          player.pos.x += (player.pos.x - car.pos.x) * 0.6;
          player.pos.z += (player.pos.z - car.pos.z) * 0.6;
          break;
        }
      }
    }
    for (const car of traffic) {
      updateTrafficCar(car, dt, allCars(), city.colliders);
      if (car.wrecked) puffSmoke(car, dt);
    }
    // Pedestrians, police pursuit, combat and missions.
    updatePedestrians(peds, dt, {
      playerPos: player.pos,
      playerSpeed: Math.hypot(player.vel.x, player.vel.z),
      playerInCar: !!player.inCar,
      gunshotPos: state.gunshotPos,
      cars: allCars(),
      bounds: city.cityBounds,
      city,
      time: state.time,
    });
    const policeEvent = policeSys.update(dt, {
      player,
      playerPos: player.pos,
      playerSpeed: player.inCar ? Math.abs(player.inCar.speed) : Math.hypot(player.vel.x, player.vel.z),
      playerHeading: player.heading,
      playerInCar: player.inCar,
      wanted: state.wanted,
      setWanted,
      allCars,
      colliders: city.colliders,
      time: state.time,
    });
    void policeEvent;
    combat.update(dt, {
      playerPos: player.pos,
      playerInCar: !!player.inCar,
      time: state.time,
    });
    for (const kind of combat.checkPickups(player.pos)) {
      if (kind === 'ammo') {
        state.ammoReserve += COMBAT_TUNING.pickupAmmo;
        showMissionCard('AMMO PICKUP', `+${COMBAT_TUNING.pickupAmmo} reserve ammo. Press R to reload.`, 'info');
      } else {
        healPlayer(player, COMBAT_TUNING.pickupHealth);
        state.health = player.health;
        showMissionCard('FIRST AID', `+${COMBAT_TUNING.pickupHealth} health.`, 'info');
      }
      playPickup();
    }
    missions.update(dt);
    // District, weapon shop and safehouse (Mama Lou's garage at the pier).
    state.district = districtAt(player.pos.x, player.pos.z);
    state.nearShop = !player.inCar && Math.hypot(player.pos.x - WEAPON_SHOP.x, player.pos.z - WEAPON_SHOP.z) < WEAPON_SHOP.r;
    const inSafe = Math.hypot(player.pos.x - SAFEHOUSE.x, player.pos.z - SAFEHOUSE.z) < SAFEHOUSE.r;
    state.inSafehouse = inSafe;
    if (inSafe) {
      // Heal, cool the wanted level, and store the gold car.
      if (player.health < PLAYER_TUNING.maxHealth) {
        healPlayer(player, dt * 2);
        state.health = player.health;
      }
      if (state.wanted > 0) {
        state.safeTimer += dt;
        if (state.safeTimer >= 3) {
          state.safeTimer = 0;
          setWanted(state.wanted - 1);
        }
      } else state.safeTimer = 0;
      if (player.inCar && missions.goldCar && player.inCar === missions.goldCar && !state.goldStored) {
        state.goldStored = true;
        showMissionCard('SAFEHOUSE', "The gold car is stored at Mama Lou's garage. It will be here when you come back.", 'complete');
        saveGame(state);
      }
    } else state.safeTimer = 0;
    state.missionsCompleted = missions.completed;
    state.currentMission = missions.current;
    state.gang = combat.gang;
    state.police = policeSys.cars;
    recycleTraffic(traffic, scene, city, player.pos);
    updateSmoke(dt);

    // Siren loop while wanted; engine hum is already tied to speed.
    if (state.wanted >= 1) startSirenLoop();
    else stopSirenLoop();

    // Wasted: no health left, wake up at the hospital.
    if (player.health <= 0) wastePlayer();

    state.playerX = player.pos.x;
    state.playerZ = player.pos.z;
    state.playerHeading = player.heading;
    state.health = player.health;
    state.nearCar = !player.inCar && !!findNearestCar(player.pos, allCars(), 3.2);
    updateCamera(dt);
    updateHUD(state);
    drawMinimap(state, city);
  }

  // Menu backdrop: a slow orbit around downtown; the cover shot holds
  // a fixed low frame down the beachfront to the pier instead.
  function updateMenuCamera(dt) {
    state.time += dt;
    if (state.menuFocus === 'beach') {
      // South along the beach looking north: bright sand foreground,
      // ocean left, pier ahead, gold car below the title panel.
      camera.position.set(-160, 15, 80);
      camera.lookAt(-172, 2, -20);
      return;
    }
    const a = state.time * 0.05;
    camera.position.set(Math.sin(a) * 120, 55, Math.cos(a) * 120);
    camera.lookAt(0, 12, 0);
  }

  // --- Main loop ------------------------------------------------------------
  let last = performance.now();
  let acc = 0;
  let saveTimer = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const frameDt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state.screen === 'playing') {
      acc += frameDt;
      while (acc >= FIXED_DT) {
        update(FIXED_DT);
        acc -= FIXED_DT;
      }
      saveTimer += frameDt;
      if (saveTimer > 15) {
        saveTimer = 0;
        saveGame(state);
      }
    } else if (state.screen === 'menu') {
      updateMenuCamera(frameDt);
      // Keep traffic rolling behind the title screen.
      for (const car of traffic) updateTrafficCar(car, frameDt, allCars(), city.colliders);
    }
    renderer.render(scene, camera);
  }

  // --- Wire the menus ---------------------------------------------------------
  initHUD();
  setHudVisible(false); // the title screen starts HUD-free
  setStartButtons({
    hasSave: hasSave(),
    onNew: () => startPlaying(false),
    onContinue: () => startPlaying(true),
  });
  document.getElementById('btn-resume')?.addEventListener('click', resumeGame);
  document.getElementById('btn-quit')?.addEventListener('click', () => {
    saveGame(state);
    state.screen = 'menu';
    showPauseScreen(false);
    showStartScreen(true);
    setHudVisible(false);
    setStartButtons({ hasSave: hasSave(), onNew: () => startPlaying(false), onContinue: () => startPlaying(true) });
  });
  document.getElementById('btn-restart')?.addEventListener('click', () => {
    respawnPlayer();
    resumeGame();
  });

  const game = {
    state, scene, camera, renderer, city, player, traffic, parked, police: policeSys.cars,
    peds, combat, missions, policeSys, sun: lights.sun,
    startPlaying, setWanted, enterCar, exitCar, respawnPlayer,
    shootPistol, punch, reload, hurtPlayer, bustPlayer, wastePlayer, addCrime,
  };

  // Screenshot staging: ?shot= puts the real game in a named scene.
  const { shot } = readShotParams();
  if (shot) stageShot(shot, game);

  window.__game = game;
  updateHUD(state);
  drawMinimap(state, city);
  requestAnimationFrame(loop);
  return game;
}

bootGame();
