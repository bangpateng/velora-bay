// Screenshot staging ONLY — never part of real play. Reads
// ?shot=<name>&seed=<n> and, after the world loads, puts the game in the
// named scene so a screenshot shows the real game at its best:
//   start  — the title screen over the live city (no staging)
//   drive  — Rico driving a sports car downtown, camera behind the car
//   street — Rico on foot on a busy street, pedestrians strolling past,
//            traffic passing, and the gold M1 mission beacon ahead
//   chase  — Rico driving with wanted level 3 and REAL police pursuit
//            cars from police.js chasing, ramming and cutting him off
import { createCar } from './vehicles.js';

export function readShotParams() {
  const params = new URLSearchParams(window.location.search);
  return { shot: params.get('shot') || '', seed: Number(params.get('seed') || 1) };
}

// Stage one named scene on the live game object. `game` is the object
// main.js builds: { state, player, traffic, parked, police, city,
// startPlaying, setWanted, spawnPoliceStandIn }.
export function stageShot(name, game) {
  if (!name || name === 'start') return 'start';
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

function stageDrive(game) {
  const car = createCar(game.scene, 'sport', 0xc0392b, 0, -116, 0);
  car.isPlayer = true;
  game.parked.push(car);
  game.enterCar(car);
  game.state.autoThrottle = true; // staged drive: hold the throttle
  game.state.objective = 'Drive downtown — Velora Bay is yours';
  game.state.money = 1250;
}

function stageStreet(game) {
  game.player.pos.set(9, 0, 24);
  game.player.heading = Math.PI * 0.9;
  game.state.cameraYaw = Math.PI * 0.9 + Math.PI;
  game.state.money = 250;
  // Mission staging: M1 is waiting at its pier beacon, so the HUD shows
  // the real objective line and the minimap shows the gold diamond.
  game.state.objective = 'First Wheels — walk into the gold beacon to start';
  // Pull a few pedestrians onto the sidewalk right in front of the
  // camera so the street reads as lived-in.
  game.peds.slice(0, 6).forEach((ped, i) => {
    ped.pos.set(-6 + i * 5, 0, 14 + (i % 2) * 4);
    ped.dest = { x: -6 + i * 5, z: 40 };
    ped.state = 'walk';
  });
  // Make sure a few traffic cars are passing right in front of the camera.
  game.traffic.slice(0, 4).forEach((car, i) => {
    car.pos.x = -40 + i * 26;
    car.pos.z = 0;
    car.heading = Math.PI / 2;
    car.routeIndex = 0;
  });
}

function stageChase(game) {
  const car = createCar(game.scene, 'sport', 0xe0a030, 0, -116, 0);
  car.isPlayer = true;
  game.parked.push(car);
  game.enterCar(car);
  game.setWanted(3);
  game.state.autoThrottle = true; // staged chase: the player car keeps moving
  game.state.objective = 'The Getaway — survive 60s at wanted level 3';
  game.state.money = 2450;
  game.state.missionTimer = 47;
  // Real police pursuit: two patrol cars spawned on roads behind the
  // player; police.js steers, rams and cuts them off every frame.
  const p1 = game.policeSys.spawnPoliceCar(game.player.pos);
  const p2 = game.policeSys.spawnPoliceCar(game.player.pos);
  p1.pos.set(-3.4, 0, -130);
  p2.pos.set(3.4, 0, -138);
  p1.speed = 26;
  p2.speed = 24;
  game.state.police = game.policeSys.cars;
}
