// Velora Bay tuning: every magic number the game balances on lives here.

export const CITY = {
  // Distance between neighbouring road centrelines (one block + one road).
  pitch: 58,
  // Half-width of a road surface, kerb to kerb.
  roadHalf: 7,
  // How many road lines run each way (avenues along X, streets along Z).
  roadCount: 5,
  // The grid spans road lines at -2..2 times pitch, so the city is
  // roughly 232 m across; the ocean and beach lie west of x = -150.
  oceanEdge: -150,
  beachEdge: -172,
  // Downtown blocks (the tallest towers) sit within this radius of centre.
  downtownRadius: 70,
  // Seeded world: the same seed always builds the same Velora Bay.
  seed: 20261118,
};

export const PLAYER_TUNING = {
  walkSpeed: 5.2,
  sprintSpeed: 9.0,
  accel: 26,
  friction: 18,
  jumpSpeed: 7.5,
  gravity: 20,
  radius: 0.55,
  maxHealth: 100,
  enterCarRange: 3.2,
};

export const CAR_TUNING = {
  engineAccel: 16,
  brakeForce: 30,
  reverseAccel: 9,
  maxSpeed: 42, // m/s, sports car; sedans scale down via kind factor
  maxReverse: 10,
  steerAngle: 0.55, // radians at standstill, eases off with speed
  steerSpeed: 3.2,
  grip: 8,
  handbrakeGrip: 2.2,
  drag: 0.35,
  radius: 1.6,
  // Kind multipliers on top speed / acceleration.
  kindSpeed: { sedan: 0.78, taxi: 0.78, van: 0.62, sport: 1.0, police: 0.92 },
  kindAccel: { sedan: 0.9, taxi: 0.9, van: 0.75, sport: 1.15, police: 1.05 },
};

export const TRAFFIC_TUNING = {
  count: 14,
  cruiseSpeed: 9,
  cruiseVariance: 3,
  despawnDistance: 220,
  spawnDistance: 130,
};

export const KEYS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  sprint: 'ShiftLeft',
  jump: 'Space',
  enterCar: 'KeyE',
  handbrake: 'Space',
  pause: 'Escape',
  horn: 'KeyH',
  reload: 'KeyR',
  punch: 'KeyF',
  missions: 'KeyM',
  radio: 'KeyQ',
  buyAmmo: 'KeyB',
  buySmg: 'KeyN',
  // Mouse: click to shoot (when the pointer is locked).
};

export const PED_TUNING = {
  count: 40,
  fleeRadius: 38,
};

export const POLICE_TUNING = {
  paintPrice: 200,
  bustSeconds: 2,
  decayBaseSeconds: 4,
};

export const COMBAT_TUNING = {
  pistolDamage: 34,
  punchDamage: 30,
  gangShotDamage: 8,
  gangHitChance: 0.12,
  shootRange: 70,
  startAmmo: 24,
  pickupAmmo: 24,
  pickupHealth: 40,
};

export const COLORS = {
  // Sun-soaked Miami: warm pastels, turquoise water, pale sand.
  sky: 0x6fc3f7,
  fog: 0xa8d8f5,
  sun: 0xfff6d8,
  ground: 0xa8a488,
  sidewalk: 0xd8cdb8,
  road: 0x4a4a55,
  roadLine: 0xfff2b0,
  ocean: 0x1fb3c9,
  beach: 0xf2e0b5,
  parkGrass: 0x6fbf5a,
  buildingPalette: [0xffd9c2, 0xffc2d1, 0xffe9a8, 0xa8e6cf, 0x9fc5e8, 0xffb3ba],
  downtownPalette: [0x8fb8d8, 0xa8c8e8, 0x7fb3d8, 0xc8d8f0],
  palmTrunk: 0x8a6a44,
  palmLeaf: 0x4cb85a,
  lampPole: 0x3a3f45,
  hudAccent: '#ffd23f',
};

// Six named districts, drawn on the minimap and shown on the HUD so the
// player always knows which part of Velora Bay they are in.
export const DISTRICTS = [
  { name: 'Beachfront', x0: -230, z0: -190, x1: -140, z1: 190 },
  { name: 'The Docks', x0: -140, z0: -190, x1: -58, z1: 58 },
  { name: 'Uptown', x0: -58, z0: -190, x1: 180, z1: -58 },
  { name: 'Downtown', x0: -58, z0: -58, x1: 58, z1: 58 },
  { name: 'Southside', x0: -140, z0: 58, x1: 58, z1: 190 },
  { name: 'Parkside', x0: 58, z0: -58, x1: 180, z1: 190 },
];

export function districtAt(x, z) {
  for (const d of DISTRICTS) if (x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1) return d.name;
  return 'Velora Bay';
}

// VELORA ARMS weapon kiosk on the beachfront promenade; Mama Lou's
// garage at the pier is the safehouse: heal, cool off, store the gold car.
export const WEAPON_SHOP = { x: -162, z: 58, r: 8, ammoPrice: 50, smgPrice: 500 };
export const SAFEHOUSE = { x: -148, z: 0, r: 13 };

// Wanted stars shown on the HUD (0-5).
export const WANTED_MAX = 5;
