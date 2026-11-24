// Screenshot scenes: each one stages the real game — the same world,
// the same systems, the same step function — from a fixed seed, then
// drives it forward with a simple autopilot so the frame is a moment
// of genuine play, not a posed diorama. ?shot=cover|street|mission|
// night picks the scene; ?seed=N fixes the random draws.
import { dist2 } from './util.js';
import { makeCar, syncCarMesh, pursuitPoint } from './vehicles.js';

const STEP = 1 / 30;

/** Steer a car toward (tx, tz) along the road grid, never diagonally through blocks. */
function driveToward(car, tx, tz) {
  const pt = pursuitPoint(car.x, car.z, tx, tz);
  const want = Math.atan2(pt.x - car.x, pt.z - car.z);
  let diff = want - car.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  // slow down for sharp turns so the car stays on the road, not in the blocks
  const sharp = Math.abs(diff) > 0.9;
  return { throttle: sharp ? 0.35 : 1, brake: 0, steer: Math.max(-1, Math.min(1, diff * 1.6)), boost: false, handbrake: false };
}

function walkToward(player, tx, tz) {
  const want = Math.atan2(tx - player.x, tz - player.z);
  let diff = want - player.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return { forward: Math.abs(diff) < 1.2, back: false, left: diff < -0.3, right: diff > 0.3, sprint: false };
}

/**
 * Stage the named scene on a live `game` (the main controller) and
 * return how many fixed steps the autopilot should run before the
 * screenshot is taken.
 */
export function stageShot(name, game) {
  const s = game.state;
  const p = s.player;
  s.flags.demo = true;
  s.mode = 'playing';
  game.hideMenus();
  game.setCamera(0, 0.32, 16);

  if (name === 'street') {
    // On foot on the marina strip, pier and ferris wheel behind, traffic passing.
    s.clockMinutes = 10 * 60 + 15;
    p.x = -262; p.z = 40; p.heading = Math.PI * 0.5;
    p.weapon = 'fists';
    s.missions.start(4); // The Drop: walk the pier
    s.missions.active.stepIndex = 0;
    game.autopilot = (dt) => walkToward(p, -380, 60);
    return 5 / STEP;
  }

  if (name === 'mission') {
    // Street Circuit start: player in a Vela GT on the z=120 avenue, rivals alongside, downtown towers.
    s.clockMinutes = 15 * 60 + 40;
    p.x = 0; p.z = 120; p.heading = Math.PI / 2;
    const car = makeCar('sports', 0, 120, Math.PI / 2, 0xffd23e);
    car.driver = 'player';
    game.enterCar(car);
    s.missions.start(5); // Street Circuit
    game.autopilot = () => driveToward(car, 120, 120);
    return 4 / STEP;
  }

  if (name === 'night') {
    // Harbor Lights at night: muscle car on the z=240 road by the marked crates, 1 star, lamps on.
    s.clockMinutes = 21 * 60 + 30;
    p.x = 60; p.z = 240; p.heading = Math.PI / 2;
    const car = makeCar('muscle', 60, 240, Math.PI / 2, 0xc93d3d);
    car.driver = 'player';
    game.enterCar(car);
    s.missions.start(8); // Harbor Lights
    s.police.addWanted(p, 1, 'Suspicious vehicle', s);
    game.autopilot = () => driveToward(car, 120, 240);
    return 3 / STEP;
  }

  // cover: golden-hour downtown chase, 3 stars, heli overhead, cruisers behind.
  s.clockMinutes = 17 * 60 + 35;
  p.x = 0; p.z = 60; p.heading = Math.PI;
  const car = makeCar('sports', 0, 60, Math.PI, 0xffd23e);
  car.driver = 'player';
  game.enterCar(car);
  s.player.money = 12500;
  s.missions.start(7); // Air Mail: 3-star escape to the marina (sets the heat itself)
  for (let i = 0; i < 2; i++) s.police.spawnCopNear(p);
  game.autopilot = () => driveToward(car, 0, -120);
  return 5 / STEP;
}

/** Distance helper re-exported for main's demo checks. */
export { dist2 };
