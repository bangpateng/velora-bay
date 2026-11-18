// Velora Bay itself: a sun-soaked coastal grid city from shared
// geometries and canvas textures. buildCity returns the colliders and
// road network the traffic AI and minimap both read from.
import * as THREE from 'three';
import { CITY, COLORS, SAFEHOUSE, WEAPON_SHOP } from './config.js';
import {
  createRng, pick, range, clamp,
  makeBuildingTexture, makeRoadTexture, makeCrosswalkTexture, makeSidewalkTexture,
} from './utils.js';

const PARK_BLOCK = { bx: 2, bz: 2 }; // south-east block is the city park

function roadLines() {
  const lines = [];
  for (let k = -2; k <= 2; k += 1) lines.push(k * CITY.pitch);
  return lines;
}

function blockCenters() {
  const centers = [];
  for (let bx = -3; bx <= 2; bx += 1) {
    for (let bz = -3; bz <= 2; bz += 1) {
      centers.push({ bx, bz, cx: (bx + 0.5) * CITY.pitch, cz: (bz + 0.5) * CITY.pitch });
    }
  }
  return centers;
}

function makePalmTree(trunkGeo, leafGeo, trunkMat, leafMat, rng) {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 2.2;
  trunk.rotation.z = range(rng, -0.08, 0.08);
  trunk.castShadow = true;
  tree.add(trunk);
  for (let i = 0; i < 6; i += 1) {
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    const a = (i / 6) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 1.1, 4.6, Math.sin(a) * 1.1);
    leaf.rotation.set(Math.sin(a) * 0.9, 0, Math.cos(a) * 0.9 + 0.5);
    leaf.castShadow = true;
    tree.add(leaf);
  }
  return tree;
}

function makeStreetLamp(poleGeo, headGeo, poleMat, glowMat) {
  const lamp = new THREE.Group();
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 3;
  pole.castShadow = true;
  lamp.add(pole);
  const arm = new THREE.Mesh(headGeo, poleMat);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(0.9, 5.9, 0);
  lamp.add(arm);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), glowMat);
  bulb.position.set(1.8, 5.9, 0);
  lamp.add(bulb);
  return lamp;
}

// Build the whole city into `scene`. Returns the data other systems need:
// colliders (building AABBs), roads (driveable segments), the park and
// pier landmarks, and a good on-foot spawn point.
export function buildCity(scene) {
  const rng = createRng(CITY.seed);
  const colliders = [];
  const roads = [];
  const lines = roadLines();
  const citySize = 330;

  // --- Ground, ocean and beach -------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(citySize + 200, citySize + 200),
    new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(20, 0, 0);
  ground.receiveShadow = true;
  scene.add(ground);

  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(340, 560),
    new THREE.MeshStandardMaterial({ color: COLORS.ocean, roughness: 0.25, metalness: 0.1 }),
  );
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(CITY.beachEdge - 170, -0.35, 0);
  ocean.receiveShadow = true;
  scene.add(ocean);

  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 340),
    new THREE.MeshStandardMaterial({ color: COLORS.beach, roughness: 1 }),
  );
  beach.rotation.x = -Math.PI / 2;
  beach.position.set((CITY.oceanEdge + CITY.beachEdge) / 2, 0.02, 0);
  beach.receiveShadow = true;
  scene.add(beach);

  // --- Roads, sidewalks and crosswalks -----------------------------------
  // One road texture tiled along Z, one rotated for X-roads.
  const roadTexZ = makeRoadTexture();
  roadTexZ.wrapS = THREE.RepeatWrapping;
  roadTexZ.wrapT = THREE.RepeatWrapping;
  roadTexZ.repeat.set(1, 24);
  const roadTexX = makeRoadTexture();
  roadTexX.wrapS = THREE.RepeatWrapping;
  roadTexX.wrapT = THREE.RepeatWrapping;
  roadTexX.repeat.set(24, 1);
  roadTexX.center.set(0.5, 0.5);
  roadTexX.rotation = Math.PI / 2;
  const roadMatX = new THREE.MeshStandardMaterial({ map: roadTexX, roughness: 0.95 });
  const roadMatZ = new THREE.MeshStandardMaterial({ map: roadTexZ, roughness: 0.95 });
  const sidewalkMat = new THREE.MeshStandardMaterial({
    map: makeSidewalkTexture(), roughness: 1,
  });
  const crossMat = new THREE.MeshStandardMaterial({
    map: makeCrosswalkTexture(), roughness: 0.9,
  });
  const roadGeoX = new THREE.PlaneGeometry(citySize, CITY.roadHalf * 2);
  const roadGeoZ = new THREE.PlaneGeometry(CITY.roadHalf * 2, citySize);
  for (const at of lines) {
    const roadX = new THREE.Mesh(roadGeoX, roadMatX);
    roadX.rotation.x = -Math.PI / 2;
    roadX.position.set(0, 0.03, at);
    roadX.receiveShadow = true;
    scene.add(roadX);
    const roadZ = new THREE.Mesh(roadGeoZ, roadMatZ);
    roadZ.rotation.x = -Math.PI / 2;
    roadZ.position.set(at, 0.03, 0);
    roadZ.receiveShadow = true;
    scene.add(roadZ);
    roads.push({ axis: 'x', at, from: -165, to: 165 });
    roads.push({ axis: 'z', at, from: -165, to: 165 });
    for (const other of lines) {
      const cross = new THREE.Mesh(new THREE.PlaneGeometry(13, 5), crossMat);
      cross.rotation.x = -Math.PI / 2;
      cross.position.set(at, 0.05, other);
      scene.add(cross);
    }
  }

  // --- Buildings ----------------------------------------------------------
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const buildingMats = new Map();
  function buildingMaterial(baseHex, floors) {
    const key = `${baseHex}:${floors}`;
    if (!buildingMats.has(key)) {
      const tex = makeBuildingTexture(rng, `#${baseHex.toString(16).padStart(6, '0')}`, floors, 5);
      buildingMats.set(key, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
    }
    return buildingMats.get(key);
  }

  const parkCenter = { x: (PARK_BLOCK.bx + 0.5) * CITY.pitch, z: (PARK_BLOCK.bz + 0.5) * CITY.pitch };
  for (const { bx, bz, cx, cz } of blockCenters()) {
    // West column is the beachfront: palms and open sand, no buildings.
    if (cx < -140) continue;
    if (bx === PARK_BLOCK.bx && bz === PARK_BLOCK.bz) {
      const grass = new THREE.Mesh(
        new THREE.PlaneGeometry(44, 44),
        new THREE.MeshStandardMaterial({ color: COLORS.parkGrass, roughness: 1 }),
      );
      grass.rotation.x = -Math.PI / 2;
      grass.position.set(cx, 0.06, cz);
      grass.receiveShadow = true;
      scene.add(grass);
      continue;
    }
    // Sidewalk slab for the whole block.
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(46, 46), sidewalkMat);
    walk.rotation.x = -Math.PI / 2;
    walk.position.set(cx, 0.04, cz);
    walk.receiveShadow = true;
    scene.add(walk);

    const dist = Math.hypot(cx, cz);
    const downtown = dist < CITY.downtownRadius;
    const palette = downtown ? COLORS.downtownPalette : COLORS.buildingPalette;
    if (downtown && rng() < 0.6) {
      // One landmark tower per downtown block.
      const w = range(rng, 16, 22);
      const d = range(rng, 16, 22);
      const h = range(rng, 42, 88);
      const tower = new THREE.Mesh(boxGeo, buildingMaterial(pick(rng, palette), 18));
      tower.scale.set(w, h, d);
      tower.position.set(cx, h / 2, cz);
      tower.castShadow = true;
      tower.receiveShadow = true;
      scene.add(tower);
      colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xff4444, emissive: 0xff2222, emissiveIntensity: 1.4 }),
      );
      beacon.position.set(cx, h + 0.6, cz);
      scene.add(beacon);
      continue;
    }
    // Ordinary block: two to four mid-rise buildings around a courtyard.
    const count = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i += 1) {
      const ox = (i % 2 === 0 ? -1 : 1) * range(rng, 6, 11);
      const oz = (i < 2 ? -1 : 1) * range(rng, 6, 11);
      const w = range(rng, 10, 16);
      const d = range(rng, 10, 16);
      const h = range(rng, 8, downtown ? 34 : 24);
      const b = new THREE.Mesh(boxGeo, buildingMaterial(pick(rng, palette), Math.max(3, Math.round(h / 4))));
      b.scale.set(w, h, d);
      b.position.set(cx + ox, h / 2, cz + oz);
      b.castShadow = true;
      b.receiveShadow = true;
      scene.add(b);
      colliders.push({
        minX: cx + ox - w / 2, maxX: cx + ox + w / 2,
        minZ: cz + oz - d / 2, maxZ: cz + oz + d / 2,
      });
    }
  }

  // --- Park trees, beach palms, street lamps ------------------------------
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 4.4, 6);
  const leafGeo = new THREE.ConeGeometry(1.5, 2.6, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: COLORS.palmTrunk, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: COLORS.palmLeaf, roughness: 0.9 });
  const treeGeo = new THREE.ConeGeometry(2.2, 5, 7);
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x3d8a3f, roughness: 1 });
  const parkRng = createRng(CITY.seed + 7);
  for (let i = 0; i < 14; i += 1) {
    const tree = new THREE.Mesh(treeGeo, treeMat);
    tree.position.set(
      parkCenter.x + range(parkRng, -18, 18),
      2.5,
      parkCenter.z + range(parkRng, -18, 18),
    );
    tree.castShadow = true;
    scene.add(tree);
  }
  for (let z = -150; z <= 150; z += 24) {
    const palm = makePalmTree(trunkGeo, leafGeo, trunkMat, leafMat, rng);
    palm.position.set(-156 + range(rng, -4, 4), 0, z + range(rng, -4, 4));
    scene.add(palm);
  }
  for (const line of lines) {
    for (let t = -140; t <= 140; t += 58) {
      const palm = makePalmTree(trunkGeo, leafGeo, trunkMat, leafMat, rng);
      palm.position.set(line + 10, 0, t);
      palm.scale.setScalar(0.85);
      scene.add(palm);
    }
  }

  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 6, 6);
  const headGeo = new THREE.CylinderGeometry(0.07, 0.07, 2, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: COLORS.lampPole, roughness: 0.6, metalness: 0.5 });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xffe9a8, emissive: 0xffdf8a, emissiveIntensity: 1.2,
  });
  for (const line of lines) {
    for (let t = -116; t <= 116; t += 58) {
      const lamp = makeStreetLamp(poleGeo, headGeo, poleMat, glowMat);
      lamp.position.set(line + 9, 0, t + 4);
      scene.add(lamp);
    }
  }

  // --- Traffic lights (visual) at the central intersections ---------------
  const lightPoleMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, emissive: 0xaa1111, emissiveIntensity: 0.9 });
  const greenMat = new THREE.MeshStandardMaterial({ color: 0x22aa44, emissive: 0x118833, emissiveIntensity: 0.7 });
  for (const x of [-58, 0, 58]) {
    for (const z of [-58, 0, 58]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 4.4, 6), lightPoleMat);
      pole.position.set(x + 8.5, 2.2, z + 8.5);
      scene.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.4), lightPoleMat);
      head.position.set(x + 8.5, 4.6, z + 8.5);
      scene.add(head);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), rng() < 0.5 ? redMat : greenMat);
      lamp.position.set(x + 8.5, 4.85, z + 8.28);
      scene.add(lamp);
    }
  }

  // --- The pier (mission landmark) ----------------------------------------
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 1 });
  const pier = new THREE.Mesh(new THREE.BoxGeometry(58, 0.8, 8), pierMat);
  pier.position.set(-179, 0.6, 0);
  pier.castShadow = true;
  pier.receiveShadow = true;
  scene.add(pier);
  for (let x = -154; x >= -204; x -= 10) {
    for (const dz of [-3.4, 3.4]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.4, 6), pierMat);
      post.position.set(x, -0.4, dz);
      scene.add(post);
    }
  }
  const pierEnd = { x: -204, z: 0 };

  // --- Mama Lou's garage (safehouse) beside the pier entrance ---------
  // Open ground west of the road; the pier walkway (z -4..4) stays clear.
  const garage = new THREE.Group();
  const gWalls = new THREE.Mesh(
    new THREE.BoxGeometry(16, 5, 11),
    new THREE.MeshStandardMaterial({ color: 0xffd9c2, roughness: 0.9 }),
  );
  gWalls.position.y = 2.5;
  gWalls.castShadow = true;
  garage.add(gWalls);
  const gDoor = new THREE.Mesh(
    new THREE.BoxGeometry(10, 3.8, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6, metalness: 0.4 }),
  );
  gDoor.position.set(0, 1.9, -5.6);
  garage.add(gDoor);
  const gSign = new THREE.Mesh(
    new THREE.BoxGeometry(12, 1.4, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x7be495, emissive: 0x2a7a44, emissiveIntensity: 0.7 }),
  );
  gSign.position.set(0, 5.8, -5.6);
  garage.add(gSign);
  garage.position.set(SAFEHOUSE.x, 0, SAFEHOUSE.z + 12);
  scene.add(garage);
  colliders.push({
    minX: SAFEHOUSE.x - 8, maxX: SAFEHOUSE.x + 8,
    minZ: SAFEHOUSE.z + 6.5, maxZ: SAFEHOUSE.z + 17.5,
  });

  // --- VELORA ARMS weapon kiosk on the beachfront promenade -----------
  const kiosk = new THREE.Group();
  const kBody = new THREE.Mesh(
    new THREE.BoxGeometry(4.5, 3, 3.5),
    new THREE.MeshStandardMaterial({ color: 0xffc2d1, roughness: 0.85 }),
  );
  kBody.position.y = 1.5;
  kBody.castShadow = true;
  kiosk.add(kBody);
  const kSign = new THREE.Mesh(
    new THREE.BoxGeometry(4.5, 0.9, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xaa7711, emissiveIntensity: 0.7 }),
  );
  kSign.position.set(0, 3.4, 1.8);
  kiosk.add(kSign);
  kiosk.position.set(WEAPON_SHOP.x, 0, WEAPON_SHOP.z);
  scene.add(kiosk);
  colliders.push({
    minX: WEAPON_SHOP.x - 2.3, maxX: WEAPON_SHOP.x + 2.3,
    minZ: WEAPON_SHOP.z - 1.8, maxZ: WEAPON_SHOP.z + 1.8,
  });

  // --- Escape boat moored just past the pier end (M7) ------------------
  const boat = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(9, 1.4, 3.4),
    new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.5 }),
  );
  hull.position.y = 0.4;
  hull.castShadow = true;
  boat.add(hull);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 1.6, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x2e6f8e, roughness: 0.5 }),
  );
  cabin.position.set(-0.5, 1.8, 0);
  boat.add(cabin);
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 5, 6),
    new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.8 }),
  );
  mast.position.set(1.5, 3.6, 0);
  boat.add(mast);
  boat.position.set(pierEnd.x - 10, 0, pierEnd.z);
  scene.add(boat);
  const boatEnd = { x: pierEnd.x - 10, z: pierEnd.z };

  return {
    colliders,
    roads,
    roadLines: lines,
    parkCenter,
    pierEnd,
    boatEnd,
    safehouse: SAFEHOUSE,
    weaponShop: WEAPON_SHOP,
    downtownCenter: { x: 0, z: 0 },
    // First mission marker: meet Mama Lou at the end of the pier.
    missionMarker: { x: pierEnd.x, z: pierEnd.z, label: 'Meet Mama Lou at the pier' },
    spawnPoint: { x: 12, z: 24 },
    cityBounds: { min: -165, max: 165 },
  };
}

// Keep a point inside the city bounds (used by the player and traffic).
export function clampToCity(x, z, bounds, margin = 4) {
  return {
    x: clamp(x, bounds.min + margin, bounds.max - margin),
    z: clamp(z, bounds.min + margin, bounds.max - margin),
  };
}
