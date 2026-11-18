// Velora Bay — boot, game loop and state machine.
// Wires the city, the player, the cars, the HUD, the audio and the save
// together; each system owns its own file, this one only connects them.
import * as THREE from 'three';
import { CITY, COLORS, KEYS, PLAYER_TUNING } from './config.js';
import { clamp, angleLerp } from './utils.js';
import { buildCity } from './city.js';
import { createPlayer, updatePlayerOnFoot } from './player.js';
import {
  createCar, spawnTraffic, spawnParkedCars, updateTrafficCar,
  updatePlayerCar, findNearestCar, recycleTraffic,
} from './vehicles.js';
import { initHUD, updateHUD, drawMinimap, showStartScreen, showPauseScreen, setStartButtons, setHudVisible } from './hud.js';
import {
  initAudio, setEngine, playClick, playCash, playHorn, playJump,
  playSiren, startMusic,
} from './audio.js';
import { saveGame, loadGame, hasSave } from './save.js';
import { readShotParams, stageShot } from './shots.js';

const FIXED_DT = 1 / 60;

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
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

function createLights(scene) {
  const sun = new THREE.DirectionalLight(COLORS.sun, 2.6);
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
  createLights(scene);
  const city = buildCity(scene);

  const player = createPlayer(scene, city.spawnPoint);
  const traffic = spawnTraffic(scene, city);
  const parked = spawnParkedCars(scene, city);
  const police = [];
  const allCars = () => [...parked, ...traffic, ...police];

  const smokeTex = createSmokeTexture();
  const smokeSprites = [];

  const state = {
    screen: 'menu', // menu | playing | paused
    money: 250,
    health: PLAYER_TUNING.maxHealth,
    wanted: 0,
    ammo: 24,
    day: 1,
    clockMinutes: 8 * 60 + 15,
    objective: 'Meet Mama Lou at the pier',
    speedKmh: 0,
    inCar: false,
    nearCar: false,
    playerX: player.pos.x,
    playerZ: player.pos.z,
    playerHeading: player.heading,
    cameraYaw: Math.PI,
    cameraPitch: 0.32,
    traffic,
    police,
    missionMarker: city.missionMarker,
    missionsCompleted: [],
    stats: { carsStolen: 0, distanceDriven: 0, crashes: 0 },
    time: 0,
  };

  const input = {
    forward: false, back: false, left: false, right: false,
    sprint: false, jump: false, handbrake: false,
  };
  const keysDown = new Set();

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
    camera.position.set(cx, Math.max(camY, 1.2), cz);
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

  // --- Wanted level (Phase B wires police AI to raise/lower this) ---------
  function setWanted(level) {
    state.wanted = clamp(level, 0, 5);
    if (state.wanted >= 3) playSiren();
  }

  // --- Death placeholder (Phase B adds the busted/wasted flow) ------------
  function respawnPlayer() {
    player.health = PLAYER_TUNING.maxHealth;
    state.health = player.health;
    state.money = Math.floor(state.money * 0.9);
    player.pos.set(city.spawnPoint.x, 0, city.spawnPoint.z);
    player.vel.set(0, 0, 0);
    if (player.inCar) exitCar();
    state.objective = 'Meet Mama Lou at the pier';
  }

  // --- Screens --------------------------------------------------------------
  function startPlaying(fromSave) {
    initAudio();
    startMusic();
    if (fromSave) {
      const data = loadGame();
      if (data) applySave(data);
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
    state.day = data.day ?? 1;
    state.clockMinutes = data.clockMinutes ?? state.clockMinutes;
    state.missionsCompleted = data.missionsCompleted || [];
    state.stats = { ...state.stats, ...(data.stats || {}) };
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
    if (player.inCar) {
      // Staging only: shots.js sets autoThrottle so a staged drive shot
      // shows the car actually moving; real play never sets this flag.
      const driveInput = state.autoThrottle ? { ...input, forward: true } : input;
      const speed01 = updatePlayerCar(player.inCar, dt, driveInput, allCars(), city.colliders);
      state.speedKmh = player.inCar.speed * 3.6;
      state.stats.distanceDriven += Math.abs(player.inCar.speed) * dt;
      setEngine(speed01, true);
      player.pos.copy(player.inCar.pos);
      player.heading = player.inCar.heading;
      if (player.inCar.wrecked) puffSmoke(player.inCar, dt);
    } else {
      updatePlayerOnFoot(player, dt, input, state.cameraYaw, city.colliders, city.cityBounds);
      state.speedKmh = 0;
      setEngine(0, false);
    }
    for (const car of traffic) {
      updateTrafficCar(car, dt, allCars(), city.colliders);
      if (car.wrecked) puffSmoke(car, dt);
    }
    // Police stand-ins cruise behind the player during a staged chase.
    for (const cop of police) {
      const dx = player.pos.x - cop.pos.x;
      const dz = player.pos.z - cop.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 4) {
        cop.heading = angleLerp(cop.heading, Math.atan2(dx, dz), Math.min(1, dt * 2));
        cop.speed = clamp(dist * 0.9, 8, 30);
        cop.pos.x += Math.sin(cop.heading) * cop.speed * dt;
        cop.pos.z += Math.cos(cop.heading) * cop.speed * dt;
        cop.model.rotation.y = cop.heading;
      }
    }
    recycleTraffic(traffic, scene, city, player.pos);
    updateSmoke(dt);

    // Death placeholder: lose 10% cash and wake up back at the spawn.
    if (player.health <= 0) respawnPlayer();

    state.playerX = player.pos.x;
    state.playerZ = player.pos.z;
    state.playerHeading = player.heading;
    state.health = player.health;
    state.nearCar = !player.inCar && !!findNearestCar(player.pos, allCars(), 3.2);
    updateCamera(dt);
    updateHUD(state);
    drawMinimap(state, city);
  }

  // Menu backdrop: a slow orbit around downtown so the title screen
  // sits over a living city instead of a frozen frame.
  function updateMenuCamera(dt) {
    state.time += dt;
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
    state, scene, camera, renderer, city, player, traffic, parked, police,
    startPlaying, setWanted, enterCar, exitCar, respawnPlayer,
  };

  // Screenshot staging: ?shot=drive|street|chase|start skips the menu and
  // puts the real game in the named scene. No shot param = normal menu.
  const { shot } = readShotParams();
  if (shot) stageShot(shot, game);

  window.__game = game;
  updateHUD(state);
  drawMinimap(state, city);
  requestAnimationFrame(loop);
  return game;
}

bootGame();
