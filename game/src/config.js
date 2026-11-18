// Velora Bay tuning: every magic number the game balances on lives here,
// so later phases tune the feel in one place instead of hunting through
// the physics and the city builder.

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
  sky: 0x87bfe8,
  fog: 0x9fc8e8,
  sun: 0xfff2d0,
  ground: 0x8a8f7a,
  sidewalk: 0xb9b3a4,
  road: 0x2e2f33,
  roadLine: 0xe8e4c8,
  ocean: 0x1f7fae,
  beach: 0xe6d3a3,
  parkGrass: 0x5da24a,
  buildingPalette: [0x9aa3ad, 0xc2a878, 0x8f9bb0, 0xb98d7a, 0x7d8b9c, 0xd0c0a0],
  downtownPalette: [0x5f7086, 0x7a8ba0, 0x4e5f78, 0x93a7bd],
  palmTrunk: 0x7a5a38,
  palmLeaf: 0x3f9e4d,
  lampPole: 0x3a3f45,
  hudAccent: '#ffd23f',
};

// Wanted stars shown on the HUD; Phase B wires the police AI that
// raises and lowers this level. Phase A only stages it for screenshots.
export const WANTED_MAX = 5;
