// Small deterministic helpers shared by every Velora Bay system.
// Nothing here knows about three.js or the DOM: pure numbers, so the
// screenshot stager and the live game step exactly the same way.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;

/** Shortest signed turn from angle `a` toward angle `b`. */
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function angleLerp(a, b, t) {
  return a + angleDiff(a, b) * clamp(t, 0, 1);
}

/** 2D distance on the ground plane. */
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function formatCash(n) {
  const v = Math.max(0, Math.floor(n));
  return '$' + v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatClock(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.floor(minutes % 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/** A tiny event log the HUD drains: { text, kind, at }. */
export function makeFeed() {
  const items = [];
  return {
    items,
    push(text, kind = '') {
      items.push({ text, kind });
      if (items.length > 4) items.shift();
    },
    clear() { items.length = 0; },
  };
}
