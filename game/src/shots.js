// Screenshot staging ONLY — never part of real play. Reads
// ?shot=<name>&seed=<n> and, after the world loads, puts the game in the
// named scene so a screenshot shows the real game at its best:
//   start  — the cover: title screen over the beachfront at sunset, gold
//            car on the sand, palms, pier and turquoise ocean
//   drive  — Rico driving the gold car south down Ocean Drive, the
//            beachfront road, ocean on the right
//   street — Rico on foot on the beachfront promenade, peds strolling,
//            traffic passing, gold car parked on the sand
//   chase  — Rico driving at wanted level 4: police cars chasing, the
//            police helicopter overhead and a roadblock ahead
import { createCar } from './vehicles.js';

export function readShotParams() {
  const params = new URLSearchParams(window.location.search);
  return { shot: params.get('shot') || '', seed: Number(params.get('seed') || 1) };
}

export function stageShot(name, game) {
  if (!name) return 'start';
  if (name === 'start') {
    stageCover(game);
    return 'start';
  }
  game.startPlaying();
  if (name === 'drive') {
    stageDrive(game);
    return 'drive';
  }
  if (name === 'street') {
    stageStreet(game);
    return 'street';
  }
  if (name === 'chase') {
    stageChase(game);
    return 'chase';
  }
  return 'start';
}

function stageCover(game) {
  // Sunset over the beachfront: warm the sun (the sky stays bright
  // Miami blue) and hold the menu camera on a low cinematic frame down
  // the beach to the pier.
  game.state.menuFocus = 'beach';
  game.sun.color.set(0xffd9a8);
  game.sun.position.set(40, 55, 140);
  // Gold car on the sand, close to the camera so it reads on the cover.
  const car = createCar(game.scene, 'sport', 0xd4af37, -166, 60, Math.PI * 0.6);
  car.parked = true;
  game.parked.push(car);
  // A few walkers on the promenade so the beach reads as lived-in.
  game.peds.slice(0, 8).forEach((ped, i) => {
    ped.pos.set(-168 + (i % 4) * 5, 0, 8 + Math.floor(i / 4) * 14);
    ped.dest = { x: -168 + (i % 4) * 5, z: ped.pos.z + 30 };
    ped.state = 'walk';
  });
}

function stageDrive(game) {
  // Ocean Drive: the beachfront road (x = -116), heading south, ocean
  // and palms on the right, city towers on the left.
  const car = createCar(game.scene, 'sport', 0xd4af37, -116, -60, 0);
  car.isPlayer = true;
  game.parked.push(car);
  game.enterCar(car);
  game.state.autoThrottle = true;
  game.state.objective = 'Ocean Drive — cruise the beachfront';
  game.state.money = 1250;
}

function stageStreet(game) {
  // Beachfront promenade: Rico on foot on the sand, facing north toward
  // the pier, peds strolling past and traffic on the beachfront road.
  game.player.pos.set(-160, 0, 44);
  game.player.heading = Math.PI;
  game.state.cameraYaw = 0;
  game.state.money = 250;
  game.state.objective = 'Beachfront Promenade — Velora Bay in the sun';
  game.peds.slice(0, 10).forEach((ped, i) => {
    ped.pos.set(-168 + (i % 5) * 4, 0, 28 + Math.floor(i / 5) * 6);
    ped.dest = { x: -168 + (i % 5) * 4, z: ped.pos.z + 20 };
    ped.state = 'walk';
  });
  game.traffic.slice(0, 4).forEach((car, i) => {
    car.pos.x = -116;
    car.pos.z = -30 + i * 26;
    car.heading = 0;
    car.routeIndex = 0;
  });
  // Gold car parked on the sand as a visual anchor.
  const car = createCar(game.scene, 'sport', 0xd4af37, -156, 30, Math.PI * 0.6);
  car.parked = true;
  game.parked.push(car);
}

function stageChase(game) {
  const car = createCar(game.scene, 'sport', 0xe0a030, 0, -116, 0);
  car.isPlayer = true;
  game.parked.push(car);
  game.enterCar(car);
  game.setWanted(4);
  game.state.autoThrottle = true;
  game.state.objective = 'The Getaway — survive 60s at wanted level 4';
  game.state.money = 2450;
  game.state.missionTimer = 47;
  // Real police pursuit: two patrol cars behind, one cutting in ahead
  // (visible in the chase camera); the heli and roadblocks spawn from
  // the wanted level itself.
  const p1 = game.policeSys.spawnPoliceCar(game.player.pos);
  const p2 = game.policeSys.spawnPoliceCar(game.player.pos);
  const p3 = game.policeSys.spawnPoliceCar(game.player.pos);
  p1.pos.set(-3.4, 0, -130);
  p2.pos.set(3.4, 0, -138);
  p3.pos.set(4, 0, -85);
  p1.speed = 26;
  p2.speed = 24;
  p3.speed = 18;
  game.state.police = game.policeSys.cars;
}
