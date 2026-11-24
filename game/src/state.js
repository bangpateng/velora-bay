// The single shared game state. Every system reads and writes this one
// object, so a save, a mission restart and a screenshot stage all start
// from the same shape. No rendering code lives here.
import { makeFeed } from './util.js';

export const CITY_HALF = 300; // city spans -300..300 on x and z
export const ROAD_STEP = 60; // roads every 60 m
export const SAVE_KEY = 'velora-bay-save-v4';

export function createGameState(seed) {
  return {
    seed,
    time: 0, // seconds since the session started
    clockMinutes: 16 * 60 + 30, // world clock, 16:30 golden hour
    day: 1,
    mode: 'menu', // menu | playing | paused | wasted | busted | complete
    paused: false,
    screen: 'menu',

    player: {
      x: 0, z: 190, heading: Math.PI, // on foot, facing south toward the bay
      speed: 0, health: 100, armor: 0, money: 250,
      weapon: 'fists', ammo: 0, inCar: null, wanted: 0,
      heat: 0, // 0..1, how "hot" the player is; cools when unseen
      dead: false, busted: false,
    },

    stats: {
      missionsDone: 0, carsStolen: 0, copsDodged: 0, coins: 0,
      distanceDriven: 0, shotsFired: 0, arrests: 0, deaths: 0,
      faresDone: 0, jumpsDone: 0, playSeconds: 0,
    },

    // Progression the save file owns.
    progress: {
      missionIndex: 0, // next mission to play (0..9, 10 = story done)
      ownedCars: ['sedan'], // garage collection
      coinsFound: [], // coin ids already collected
      unlocked: { pistol: false, smg: false },
    },

    mission: null, // active mission runtime (see missions.js)
    taxi: null, // active fare { passenger, stops, stopIndex, timer }
    garageCar: 'sedan',

    feed: makeFeed(),
    flags: {
      radioMuted: false, radioStation: 0, cameraMode: 0,
      nightForced: false, demo: false,
    },

    // Filled in by city.js / vehicles.js / people.js at boot.
    city: null,
    traffic: null,
    pedestrians: null,
    police: null,
    combat: null,
    coins: [], // { x, z, id, taken, mesh }
    ramps: [], // { x, z, heading }
    markers: [], // world markers the HUD/minimap draw
  };
}

/** A plain snapshot of the parts a save file owns. */
export function snapshotProgress(state) {
  return {
    money: state.player.money,
    missionIndex: state.progress.missionIndex,
    ownedCars: [...state.progress.ownedCars],
    coinsFound: [...state.progress.coinsFound],
    unlocked: { ...state.progress.unlocked },
    stats: { ...state.stats },
    day: state.day,
    clockMinutes: state.clockMinutes,
    garageCar: state.garageCar,
  };
}

export function applyProgress(state, snap) {
  if (!snap || typeof snap !== 'object') return false;
  state.player.money = snap.money ?? 250;
  state.progress.missionIndex = snap.missionIndex ?? 0;
  state.progress.ownedCars = Array.isArray(snap.ownedCars) ? snap.ownedCars : ['sedan'];
  state.progress.coinsFound = Array.isArray(snap.coinsFound) ? snap.coinsFound : [];
  state.progress.unlocked = snap.unlocked || { pistol: false, smg: false };
  Object.assign(state.stats, snap.stats || {});
  state.day = snap.day || 1;
  state.clockMinutes = snap.clockMinutes ?? 16 * 60 + 30;
  state.garageCar = snap.garageCar || 'sedan';
  return true;
}
