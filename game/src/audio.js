// All sound is synthesized with WebAudio — no audio files. Every entry
// guards a blocked AudioContext so the game never crashes on autoplay.
let ctx = null;
let master = null;
let engineOsc = null;
let engineGain = null;
let musicNodes = [];
let musicTimer = null;
let muted = false;

function ensureContext() {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
  } catch (err) {
    ctx = null;
  }
  return ctx;
}

// Call from the first user gesture. Safe to call repeatedly.
export function initAudio() {
  const audio = ensureContext();
  if (audio && audio.state === 'suspended') audio.resume().catch(() => {});
  return !!audio;
}

export function setMuted(value) {
  muted = value;
  if (master) master.gain.value = value ? 0 : 0.5;
}

function blip(freq, duration, type = 'sine', volume = 0.2, slideTo = null) {
  if (!ensureContext()) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain).connect(master);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  } catch (err) { /* audio is cosmetic; never break the game */ }
}

function noiseBurst(duration, volume = 0.3, lowpass = 1200) {
  if (!ensureContext()) return;
  try {
    const len = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(filter).connect(gain).connect(master);
    src.start();
  } catch (err) { /* cosmetic */ }
}

export function playClick() {
  blip(660, 0.07, 'square', 0.08);
}

export function playShot() {
  noiseBurst(0.16, 0.5, 900);
  blip(160, 0.1, 'sawtooth', 0.18, 55);
}

export function playCash() {
  blip(880, 0.09, 'sine', 0.16);
  setTimeout(() => blip(1320, 0.14, 'sine', 0.16), 90);
}

export function playSiren() {
  // Two-tone wail, one cycle; startSirenLoop repeats it while police pursue.
  blip(750, 0.45, 'sine', 0.1, 1050);
  setTimeout(() => blip(1050, 0.45, 'sine', 0.1, 750), 450);
}

let sirenTimer = null;
export function startSirenLoop() {
  if (sirenTimer) return;
  playSiren();
  sirenTimer = setInterval(playSiren, 950);
}

export function stopSirenLoop() {
  if (!sirenTimer) return;
  clearInterval(sirenTimer);
  sirenTimer = null;
}

export function playPunch() {
  noiseBurst(0.09, 0.35, 700);
  blip(120, 0.08, 'sine', 0.15, 70);
}

export function playPickup() {
  blip(520, 0.08, 'sine', 0.14);
  setTimeout(() => blip(780, 0.12, 'sine', 0.14), 80);
}

export function playReload() {
  blip(420, 0.06, 'square', 0.08);
  setTimeout(() => blip(560, 0.06, 'square', 0.08), 140);
}

export function playMission() {
  blip(523, 0.12, 'sine', 0.16);
  setTimeout(() => blip(659, 0.12, 'sine', 0.16), 120);
  setTimeout(() => blip(784, 0.2, 'sine', 0.16), 240);
}

export function playBusted() {
  blip(392, 0.18, 'sawtooth', 0.12, 196);
  setTimeout(() => blip(311, 0.3, 'sawtooth', 0.12, 155), 200);
}

export function playHorn() {
  blip(370, 0.25, 'square', 0.1);
  blip(466, 0.25, 'square', 0.08);
}

export function playJump() {
  blip(280, 0.12, 'sine', 0.1, 520);
}

export function playBump() {
  noiseBurst(0.1, 0.25, 500);
}

// Continuous engine hum: call every frame with speed 0..1 while driving.
export function setEngine(speed01, running) {
  if (!running) {
    if (engineGain) engineGain.gain.value = 0;
    return;
  }
  if (!ensureContext()) return;
  try {
    if (!engineOsc) {
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      engineOsc.connect(filter).connect(engineGain).connect(master);
      engineOsc.start();
    }
    const target = ctx.currentTime;
    engineOsc.frequency.setTargetAtTime(55 + speed01 * 130, target, 0.08);
    engineGain.gain.setTargetAtTime(0.03 + speed01 * 0.05, target, 0.1);
  } catch (err) { /* cosmetic */ }
}

// Car radio: three stations, Q switches between them. Each station is a
// chord loop with its own tempo; the HUD shows the station name.
const RADIO = [
  { name: 'VELORA FM', bar: 4400, chords: [
    [110.0, 130.81, 164.81, 196.0], [87.31, 130.81, 164.81, 220.0],
    [130.81, 164.81, 196.0, 246.94], [98.0, 146.83, 196.0, 246.94],
  ] },
  { name: 'BAY 87.5', bar: 3000, chords: [
    [130.81, 164.81, 196.0, 261.63], [98.0, 146.83, 196.0, 246.94],
    [110.0, 164.81, 220.0, 261.63], [87.31, 130.81, 174.61, 220.0],
  ] },
  { name: 'OCEAN DRIVE', bar: 5200, chords: [
    [146.83, 174.61, 220.0, 261.63], [98.0, 146.83, 196.0, 293.66],
    [130.81, 164.81, 196.0, 246.94], [110.0, 146.83, 174.61, 220.0],
  ] },
];
let radioStation = 0;
let chordIndex = 0;

function playChord() {
  if (!ctx) return;
  stopChord();
  const station = RADIO[radioStation];
  const chord = station.chords[chordIndex % station.chords.length];
  chordIndex += 1;
  for (const freq of chord) {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.035, ctx.currentTime + 1.2);
      gain.gain.setValueAtTime(0.035, ctx.currentTime + 3.2);
      gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 4.4);
      osc.connect(gain).connect(master);
      osc.start();
      osc.stop(ctx.currentTime + 4.5);
      musicNodes.push(osc);
    } catch (err) { /* cosmetic */ }
  }
}

export function startMusic() {
  if (!ensureContext() || musicTimer) return;
  playChord();
  musicTimer = setInterval(playChord, RADIO[radioStation].bar);
}

export function setRadioStation(i) {
  radioStation = ((i % RADIO.length) + RADIO.length) % RADIO.length;
  chordIndex = 0;
  if (musicTimer) {
    clearInterval(musicTimer);
    stopChord();
    playChord();
    musicTimer = setInterval(playChord, RADIO[radioStation].bar);
  }
  return RADIO[radioStation].name;
}

export function radioName() {
  return RADIO[radioStation].name;
}

function stopChord() {
  for (const osc of musicNodes) {
    try { osc.stop(); } catch (err) { /* already stopped */ }
  }
  musicNodes = [];
}

export function stopMusic() {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = null;
  stopChord();
}

// Helicopter rotor: a low sawtooth thump, amplitude-modulated at ~11 Hz
// for the whomp-whomp, while the police heli is overhead.
let rotorNodes = null;
export function startRotorLoop() {
  if (rotorNodes || !ensureContext()) return;
  try {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 32;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.035;
    lfo.connect(lfoGain).connect(gain.gain);
    osc.connect(gain).connect(master);
    osc.start();
    lfo.start();
    rotorNodes = { osc, lfo };
  } catch (err) { /* cosmetic */ }
}

export function stopRotorLoop() {
  if (!rotorNodes) return;
  try { rotorNodes.osc.stop(); rotorNodes.lfo.stop(); } catch (err) { /* already stopped */ }
  rotorNodes = null;
}
