// Small shared helpers: a seeded RNG so the city, traffic and staging
// are reproducible, math helpers, and canvas-generated textures so the
// game needs no image files at all.
import * as THREE from 'three';

// mulberry32 — tiny, fast, deterministic for a given seed.
export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

export function range(rng, min, max) {
  return min + rng() * (max - min);
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Shortest-path interpolation between two headings (radians).
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// A building facade: base colour with a grid of windows, a few lit warm.
export function makeBuildingTexture(rng, baseColor, floors = 8, cols = 5) {
  return canvasTexture(128, 256, (ctx, w, h) => {
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, w, h);
    // Subtle vertical shading so flat boxes read as towers.
    const shade = ctx.createLinearGradient(0, 0, w, 0);
    shade.addColorStop(0, 'rgba(0,0,0,0.18)');
    shade.addColorStop(0.5, 'rgba(255,255,255,0.06)');
    shade.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, w, h);
    const gapX = w / cols;
    const gapY = h / floors;
    for (let r = 0; r < floors; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const lit = rng() < 0.22;
        ctx.fillStyle = lit ? '#ffd98a' : 'rgba(20,30,44,0.85)';
        ctx.fillRect(c * gapX + gapX * 0.2, r * gapY + gapY * 0.25, gapX * 0.6, gapY * 0.5);
      }
    }
    // Roof parapet line.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, w, 6);
  });
}

// Asphalt with a dashed centre line, tiled along a road segment.
export function makeRoadTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#2e2f33';
    ctx.fillRect(0, 0, w, h);
    // Speckle for asphalt grain.
    for (let i = 0; i < 260; i += 1) {
      ctx.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.04})`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    ctx.fillStyle = '#e8e4c8';
    ctx.fillRect(w / 2 - 2, 8, 4, 44);
    ctx.fillRect(w / 2 - 2, 72, 4, 44);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(4, 0, 2, h);
    ctx.fillRect(w - 6, 0, 2, h);
  });
}

// Crosswalk stripes, laid across a road at an intersection.
export function makeCrosswalkTexture() {
  return canvasTexture(128, 64, (ctx, w, h) => {
    ctx.fillStyle = '#2e2f33';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let x = 6; x < w; x += 18) ctx.fillRect(x, 6, 9, h - 12);
  });
}

// Plain sidewalk slab with a faint grid of paving joints.
export function makeSidewalkTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#b9b3a4';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.14)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i += 1) {
      ctx.beginPath(); ctx.moveTo((i * w) / 4, 0); ctx.lineTo((i * w) / 4, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (i * h) / 4); ctx.lineTo(w, (i * h) / 4); ctx.stroke();
    }
  });
}

// Hex colour string ("#9aa3ad") to a THREE colour, for canvas palettes.
export function cssColor(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}
