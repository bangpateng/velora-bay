// Screenshot staging ONLY — never part of real play. Reads
// ?shot=<name>&seed=<n> and, after the world loads, puts the game in the
// named scene so a screenshot shows the real game at its best:
//   start  — the title screen over the live city (no staging)
//   drive  — Rico driving a sports car downtown, camera behind the car
//   street — Rico on foot on a busy street, traffic passing
//   chase  — Rico driving with wanted level 3 and two police cars in
//            pursuit (Phase A stages police-looking cars from
//            vehicles.js; Phase B wires real police pursuit AI in)
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
  game.state.objective = 'Meet Mama Lou at the pier';
  game.state.money = 250;
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
  game.state.objective = 'Lose the Kings — and the cops!';
  game.state.money = 2450;
  // Two police-looking cars tucked in behind, same heading, closing in.
  const p1 = createCar(game.scene, 'police', 0x1c2733, -3.4, -130, 0);
  const p2 = createCar(game.scene, 'police', 0x1c2733, 3.4, -136, 0);
  p1.speed = 26;
  p2.speed = 24;
  game.police.push(p1, p2);
  game.state.police = game.police;
}
