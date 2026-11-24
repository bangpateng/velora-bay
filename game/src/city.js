// Velora Bay itself: a procedural sun-soaked coastal city built from
// boxes, canvas textures and a road graph. Districts: Marina (west beach
// + pier), Downtown (centre towers), Old Town (east), Harbor (south
// port), Hills (north houses + the safehouse). Everything the game
// collides with is recorded in `colliders` as { x, z, hx, hz }.
import * as THREE from 'three';
import { CITY_HALF, ROAD_STEP } from './state.js';
import { mulberry32, pick, clamp, lerp } from './util.js';

export { ROAD_STEP };

const ROAD_HALF = 7; // half-width of a road
const BLOCK = ROAD_STEP;

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Windows for a tower: warm lit grid on a coloured facade. */
function facadeTexture(base, lit) {
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let y = 10; y < h - 10; y += 22) {
      for (let x = 10; x < w - 10; x += 18) {
        g.fillStyle = Math.random() < 0.24 ? lit : 'rgba(20,32,52,0.85)';
        g.fillRect(x, y, 11, 14);
      }
    }
  });
}

function groundTexture() {
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#8fae7a'; g.fillRect(0, 0, w, h);
    // city blocks: pale pavement squares between roads
    g.fillStyle = '#b9b3a4';
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) g.fillRect(28 + i * 60, 28 + j * 60, 44, 44);
    g.fillStyle = '#7d9c6d';
    for (let n = 0; n < 260; n++) g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
  });
}

/** One 24 m tile of asphalt: centre dashes along `horizontal`, edge lines. */
function roadTexture(horizontal) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#3a3f46'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2c14e';
    if (horizontal) {
      g.fillRect(0, h / 2 - 2, 26, 4); g.fillRect(64, h / 2 - 2, 26, 4);
      g.fillRect(128, h / 2 - 2, 26, 4); g.fillRect(192, h / 2 - 2, 26, 4);
    } else {
      g.fillRect(w / 2 - 2, 0, 4, 26); g.fillRect(w / 2 - 2, 64, 4, 26);
      g.fillRect(w / 2 - 2, 128, 4, 26); g.fillRect(w / 2 - 2, 192, 4, 26);
    }
    g.fillStyle = 'rgba(255,255,255,0.75)';
    if (horizontal) { g.fillRect(0, 6, w, 3); g.fillRect(0, h - 9, w, 3); }
    else { g.fillRect(6, 0, 3, h); g.fillRect(w - 9, 0, 3, h); }
  });
}

export function buildCity(scene, seed) {
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const landmarks = {};
  const roadNodes = [];

  // --- sky, sun, lights -------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a6f4d, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.1);
  sun.position.set(180, 260, 120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -340; sun.shadow.camera.right = 340;
  sun.shadow.camera.top = 340; sun.shadow.camera.bottom = -340;
  sun.shadow.camera.far = 900;
  scene.add(sun);
  scene.add(sun.target);
  const lampLight = new THREE.PointLight(0xffc46b, 0, 60, 1.6);

  // --- ground, beach, sea ----------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_HALF * 2 + 260, CITY_HALF * 2 + 40),
    new THREE.MeshLambertMaterial({ map: groundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-40, 0, 0);
  ground.receiveShadow = true;
  group.add(ground);

  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(120, CITY_HALF * 2 + 40),
    new THREE.MeshLambertMaterial({ color: 0xe8d29a }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(-CITY_HALF - 60, 0.05, 0);
  sand.receiveShadow = true;
  group.add(sand);

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(420, CITY_HALF * 2 + 400),
    new THREE.MeshLambertMaterial({ color: 0x1e7f9e, transparent: true, opacity: 0.92 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-CITY_HALF - 330, 0.02, 0);
  group.add(sea);

  // --- roads: one texture tile per 24 m, so dashes stay dashes ---------
  const roadTexX = roadTexture(true);
  roadTexX.wrapS = THREE.RepeatWrapping; roadTexX.wrapT = THREE.RepeatWrapping;
  roadTexX.repeat.set(25, 1);
  const roadTexZ = roadTexture(false);
  roadTexZ.wrapS = THREE.RepeatWrapping; roadTexZ.wrapT = THREE.RepeatWrapping;
  roadTexZ.repeat.set(1, 25);
  const roadMatX = new THREE.MeshLambertMaterial({ map: roadTexX });
  const roadMatZ = new THREE.MeshLambertMaterial({ map: roadTexZ });
  const roadGeoX = new THREE.PlaneGeometry(CITY_HALF * 2, ROAD_HALF * 2);
  const roadGeoZ = new THREE.PlaneGeometry(ROAD_HALF * 2, CITY_HALF * 2);
  for (let i = -5; i <= 5; i++) {
    const p = i * BLOCK;
    const rx = new THREE.Mesh(roadGeoX, roadMatX);
    rx.rotation.x = -Math.PI / 2; rx.position.set(0, 0.06, p); rx.receiveShadow = true;
    group.add(rx);
    const rz = new THREE.Mesh(roadGeoZ, roadMatZ);
    rz.rotation.x = -Math.PI / 2; rz.position.set(p, 0.06, 0); rz.receiveShadow = true;
    group.add(rz);
  }
  // road graph nodes at every intersection
  for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) {
    roadNodes.push({ x: i * BLOCK, z: j * BLOCK });
  }

  // --- buildings ---------------------------------------------------------
  const facades = [
    facadeTexture('#e8b48a', '#ffe9a8'), facadeTexture('#9fc3e8', '#fff2b0'),
    facadeTexture('#d98a7a', '#ffe9a8'), facadeTexture('#b7d3a5', '#fff2b0'),
    facadeTexture('#c9b8e8', '#ffe9a8'), facadeTexture('#e8d9a0', '#fff2b0'),
  ];
  const houseMat = new THREE.MeshLambertMaterial({ color: 0xf2e3c8 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xb3541e });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  function addBuilding(x, z, w, h, d, mat, collide = true) {
    const m = new THREE.Mesh(boxGeo, mat);
    m.scale.set(w, h, d);
    m.position.set(x, h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    if (collide) colliders.push({ x, z, hx: w / 2, hz: d / 2 });
    return m;
  }

  // Downtown towers: one per city block, centred in the block so the
  // roads stay clear (block centres sit 30 m off the road lines).
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const bx = i * BLOCK + 30, bz = j * BLOCK + 30;
    const near = Math.abs(i) + Math.abs(j);
    const h = 34 + rng() * 46 - near * 7;
    addBuilding(bx + (rng() - 0.5) * 6, bz + (rng() - 0.5) * 6, 26 + rng() * 10, Math.max(18, h), 26 + rng() * 10, new THREE.MeshLambertMaterial({ map: pick(rng, facades) }));
    if (rng() < 0.5) addBuilding(bx + 14, bz - 14, 12, 10 + rng() * 8, 12, new THREE.MeshLambertMaterial({ map: pick(rng, facades) }));
  }
  // Old Town mid-rise (east)
  for (let i = 2; i <= 4; i++) for (let j = -4; j <= 4; j++) {
    if (rng() < 0.25) continue;
    addBuilding(i * BLOCK + 30, j * BLOCK + 30, 24 + rng() * 8, 12 + rng() * 14, 24 + rng() * 8, new THREE.MeshLambertMaterial({ map: pick(rng, facades) }));
  }
  // Marina low blocks (west, near beach)
  for (let i = -5; i <= -4; i++) for (let j = -4; j <= 4; j++) {
    if (rng() < 0.3) continue;
    addBuilding(i * BLOCK + 30, j * BLOCK + 30, 22, 9 + rng() * 8, 22, new THREE.MeshLambertMaterial({ map: pick(rng, facades) }));
  }
  // Hills houses (north): small homes with pitched roofs
  for (let i = -4; i <= 4; i++) for (let j = -5; j <= -4; j++) {
    if (rng() < 0.35) continue;
    const hx = i * BLOCK + 30, hz = j * BLOCK + 30;
    // never build on the safehouse or the garage
    if (Math.abs(hx + 30) < 24 && Math.abs(hz + 270) < 24) continue;
    if (Math.abs(hx + 90) < 24 && Math.abs(hz + 270) < 24) continue;
    addBuilding(hx, hz, 14, 6 + rng() * 3, 12, houseMat);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(11, 4, 4), roofMat);
    roof.position.set(hx, 6 + 4 + 2, hz); roof.rotation.y = Math.PI / 4;
    roof.castShadow = true; group.add(roof);
  }
  // Harbor containers + cranes (south)
  const containerCols = [0xc94f3d, 0x3d7fc9, 0x4fc93d, 0xe8a13d, 0x8a5fc9];
  for (let n = 0; n < 26; n++) {
    const cx = -240 + rng() * 480, cz = 252 + rng() * 36;
    addBuilding(cx, cz, 12, 3 + rng() * 3, 4, new THREE.MeshLambertMaterial({ color: pick(rng, containerCols) }));
  }
  for (let n = 0; n < 3; n++) {
    const cx = -160 + n * 160;
    const crane = new THREE.Group();
    const leg = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xe8c13d }));
    leg.scale.set(4, 42, 4); leg.position.y = 21; leg.castShadow = true; crane.add(leg);
    const arm = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xe8c13d }));
    arm.scale.set(46, 3, 3); arm.position.set(12, 40, 0); arm.castShadow = true; crane.add(arm);
    crane.position.set(cx, 0, 268);
    group.add(crane);
    colliders.push({ x: cx, z: 268, hx: 3, hz: 3 });
  }

  // --- pier (west, into the sea) -----------------------------------------
  const pierMat = new THREE.MeshLambertMaterial({ color: 0x8a6f4d });
  const pier = new THREE.Mesh(boxGeo, pierMat);
  pier.scale.set(90, 1.5, 10); pier.position.set(-CITY_HALF - 105, 0.8, 60);
  pier.castShadow = true; pier.receiveShadow = true; group.add(pier);
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(11, 1.2, 8, 24), new THREE.MeshLambertMaterial({ color: 0xffd23e, emissive: 0x664400 }));
  wheel.add(rim);
  for (let n = 0; n < 8; n++) {
    const spoke = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }));
    spoke.scale.set(21, 0.8, 0.8); spoke.rotation.z = (n / 8) * Math.PI; wheel.add(spoke);
  }
  wheel.position.set(-CITY_HALF - 140, 16, 60);
  group.add(wheel);
  landmarks.ferrisWheel = wheel;

  // --- palms along the beach + scattered street trees ---------------------
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2fae5f });
  function palm(x, z, s = 1) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * s, 0.5 * s, 7 * s, 6), trunkMat);
    trunk.position.y = 3.5 * s; trunk.castShadow = true; g.add(trunk);
    for (let n = 0; n < 6; n++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(1.1 * s, 4.5 * s, 4), leafMat);
      leaf.position.y = 7.4 * s;
      leaf.rotation.z = 1.1; leaf.rotation.y = (n / 6) * Math.PI * 2;
      leaf.position.x = Math.cos((n / 6) * Math.PI * 2) * 1.4 * s;
      leaf.position.z = Math.sin((n / 6) * Math.PI * 2) * 1.4 * s;
      g.add(leaf);
    }
    g.position.set(x, 0, z);
    group.add(g);
    return g;
  }
  for (let j = -5; j <= 5; j++) palm(-CITY_HALF - 18, j * BLOCK + 18, 0.9 + rng() * 0.4);
  for (let n = 0; n < 40; n++) palm(-280 + rng() * 560, -280 + rng() * 560, 0.8 + rng() * 0.4);

  // --- street lamps -------------------------------------------------------
  const lampGeo = new THREE.CylinderGeometry(0.12, 0.12, 7, 5);
  const lampMat = new THREE.MeshLambertMaterial({ color: 0x2c3440 });
  const bulbGeo = new THREE.SphereGeometry(0.5, 8, 6);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  const lampPositions = [];
  for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) {
    if ((i + j) % 2 !== 0) continue;
    const x = i * BLOCK + 9, z = j * BLOCK + 9;
    const pole = new THREE.Mesh(lampGeo, lampMat);
    pole.position.set(x, 3.5, z); group.add(pole);
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.set(x, 7.1, z); group.add(bulb);
    lampPositions.push({ x, z, bulb });
  }

  // --- landmarks: safehouse, garage, autos, diner, bank, marina office ---
  function landmarkBox(x, z, w, h, d, color, name) {
    const m = addBuilding(x, z, w, h, d, new THREE.MeshLambertMaterial({ color }));
    landmarks[name] = { x, z, mesh: m };
    return m;
  }
  landmarkBox(-30, -270, 20, 9, 16, 0xf2e3c8, 'safehouse'); // Hills
  landmarkBox(-90, -270, 16, 7, 14, 0x3d7fc9, 'garage');
  landmarkBox(150, -90, 26, 10, 20, 0xe8a13d, 'autos'); // Dino's Autos
  landmarkBox(90, 150, 24, 12, 20, 0xd98a7a, 'diner');
  landmarkBox(30, 30, 30, 26, 26, 0x9fc3e8, 'bank'); // downtown bank
  landmarkBox(-270, -90, 20, 10, 16, 0x4fc93d, 'marinaOffice');
  landmarkBox(210, 270, 30, 8, 20, 0xc94f3d, 'harborOffice');

  // Safehouse porch light + garage door paint
  const porch = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
  porch.position.set(-30, 4, -261); group.add(porch);

  // --- sun coins + stunt ramps (positions chosen on roads / open plazas) --
  const coins = [];
  // All coin spots sit on a road (one coordinate on a road line), so
  // no coin ever spawns inside a building.
  const coinSpots = [
    [-270, 240], [-270, -240], [270, 240], [240, -270], [0, 240], [0, -240],
    [-120, 60], [120, -60], [60, 180], [-60, -180], [180, 60], [-180, -60],
    [240, 0], [-240, 0], [120, 240], [-120, -240], [60, -120], [-60, 120],
    [300, 120], [-300, -120], [180, 180], [-180, 180], [240, -120], [-240, 120],
    [60, 0], [-60, 0], [0, 60], [0, -60], [120, -180], [-120, 180],
  ];
  for (let i = 0; i < coinSpots.length; i++) coins.push({ id: i, x: coinSpots[i][0], z: coinSpots[i][1], taken: false, mesh: null });
  const ramps = [
    { x: -120, z: 0, heading: Math.PI / 2 },
    { x: 120, z: 60, heading: -Math.PI / 2 },
    { x: 0, z: -180, heading: 0 },
  ];

  return {
    group, colliders, roadNodes, landmarks, lampPositions, lampLight,
    sun, hemi, coins, ramps, sea, wheel: landmarks.ferrisWheel,
    /** Move the sun + sky with the world clock; returns true when night. */
    update(dt, clockMinutes) {
      const dayFrac = ((clockMinutes / 60) % 24) / 24; // 0..1
      const sunAngle = (dayFrac - 0.25) * Math.PI * 2; // noon overhead
      const elev = Math.sin(sunAngle);
      sun.position.set(Math.cos(sunAngle) * 260, Math.max(20, elev * 300), 120);
      const night = elev < 0.02;
      const warm = clamp(1 - Math.abs(elev - 0.25) * 2.2, 0, 1);
      sun.color.setHSL(0.09 + warm * 0.02, 0.85, 0.62 + (1 - warm) * 0.12);
      sun.intensity = night ? 0.25 : 1.4 + warm * 0.9;
      hemi.intensity = night ? 0.28 : 0.95;
      scene.background = new THREE.Color().setHSL(0.58, 0.55, night ? 0.05 : 0.55 + warm * 0.08);
      scene.fog = new THREE.Fog(scene.background, 320, 900);
      lampLight.intensity = night ? 60 : 0;
      for (const l of lampPositions) l.bulb.material = bulbMat;
      if (landmarks.ferrisWheel) landmarks.ferrisWheel.rotation.z += dt * (night ? 0.25 : 0.05);
      return night;
    },
  };
}

/** Circle (player/car) vs building AABBs: push out, return hit flag. */
export function collideCircle(colliders, x, z, r) {
  let hit = false;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const nx = clamp(x, c.x - c.hx, c.x + c.hx);
    const nz = clamp(z, c.z - c.hz, c.z + c.hz);
    const dx = x - nx, dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      hit = true;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const push = (r - d) / d;
        x += dx * push; z += dz * push;
      } else {
        // centre inside the box: push along the smallest penetration axis
        const px = c.hx + r - Math.abs(x - c.x);
        const pz = c.hz + r - Math.abs(z - c.z);
        if (px < pz) x += (x > c.x ? px : -px); else z += (z > c.z ? pz : -pz);
      }
    }
  }
  return { x, z, hit };
}

/** Nearest road node to a point (traffic + police spawns). */
export function nearestNode(roadNodes, x, z) {
  let best = roadNodes[0], bd = Infinity;
  for (const n of roadNodes) {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/** A point on a road near (x, z): snap to the closest road line. */
export function snapToRoad(x, z) {
  const rx = Math.round(x / ROAD_STEP) * ROAD_STEP;
  const rz = Math.round(z / ROAD_STEP) * ROAD_STEP;
  return Math.abs(x - rx) < Math.abs(z - rz) ? { x: rx, z } : { x, z: rz };
}
