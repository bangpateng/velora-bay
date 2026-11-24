// Sound, all synthesized with WebAudio — no audio files, no network.
// Three radio stations run tiny step sequencers (bass + lead + hats);
// the engine is a filtered sawtooth that follows the car's speed;
// sirens, shots, punches and jingles are short oscillator/noise bursts.
import { clamp } from './util.js';

export const STATIONS = [
  { name: 'BAY FM 87.9 — Sunset Drive', bpm: 96, root: 220, minor: true, wave: 'sawtooth' },
  { name: 'PALMA 104 — Calle Caliente', bpm: 124, root: 196, minor: false, wave: 'square' },
  { name: 'STATIC 66 — Night Static', bpm: 76, root: 174, minor: true, wave: 'triangle' },
];

const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.stations = STATIONS;
    this.step = 0;
    this.nextStepTime = 0;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.muted = false;
    this.started = false;
  }

  /** Must be called from a user gesture (the start button). */
  start() {
    if (this.started) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.16;
      this.musicGain.connect(this.master);
      // engine
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 320;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();
      // siren (two-tone, gain driven by police proximity)
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'sine';
      this.sirenOsc.frequency.value = 720;
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain);
      this.sirenGain.connect(this.master);
      this.sirenOsc.start();
      this.started = true;
      this.nextStepTime = this.ctx.currentTime + 0.1;
    } catch (e) {
      this.started = false;
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.value = m ? 0 : 0.5;
  }

  /** One sequencer step: bass note, sparse lead, hat tick. */
  scheduleStep(stationIndex, when) {
    const st = STATIONS[stationIndex];
    const scale = SCALES[st.minor ? 'minor' : 'major'];
    const bar = Math.floor(this.step / 16) % 4;
    const roots = [0, 3, 5, 4];
    const rootShift = roots[bar];
    const bassDegree = [0, 0, 0, 2, 0, 0, 4, 0, 0, 0, 2, 0, 5, 4, 2, 0][this.step % 16];
    const bassNote = st.root * Math.pow(2, (scale[bassDegree % 7] + 12 * Math.floor(bassDegree / 7) + rootShift) / 12) / 2;
    this.note(bassNote, when, 0.22, 'triangle', 0.5);
    if (this.step % 4 === 0) {
      const leadDegree = [7, 5, 8, 6, 9, 7, 5, 4][Math.floor(this.step / 4) % 8];
      const lead = st.root * 2 * Math.pow(2, (scale[leadDegree % 7] + rootShift) / 12);
      this.note(lead, when, 0.3, st.wave, 0.16);
    }
    if (this.step % 2 === 1) this.noiseTick(when, 0.03, 0.05);
  }

  note(freq, when, dur, type, vol) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    o.connect(g); g.connect(this.musicGain);
    o.start(when); o.stop(when + dur + 0.05);
  }

  noiseTick(when, dur, vol) {
    if (!this.ctx) return;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = vol;
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
    src.connect(f); f.connect(g); g.connect(this.musicGain);
    src.start(when);
  }

  noiseBurst(dur, vol, filterFreq) {
    if (!this.ctx) return;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = vol;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
  }

  blip(freq, dur, type, vol) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(this.ctx.currentTime + dur + 0.02);
  }

  shot(weapon) {
    this.noiseBurst(0.12, 0.5, 2400);
    this.blip(weapon === 'smg' ? 190 : 140, 0.09, 'square', 0.25);
  }

  enemyShot() { this.noiseBurst(0.1, 0.22, 1800); }
  punch() { this.noiseBurst(0.08, 0.4, 500); this.blip(90, 0.08, 'sine', 0.4); }
  crash() { this.noiseBurst(0.35, 0.6, 900); }
  pickup() { this.blip(660, 0.09, 'sine', 0.3); setTimeout(() => this.blip(880, 0.12, 'sine', 0.3), 90); }
  dryClick() { this.blip(1200, 0.04, 'square', 0.15); }
  horn() { this.blip(370, 0.25, 'square', 0.2); }
  jingle() {
    if (!this.ctx) return;
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.22, 'triangle', 0.3), i * 120));
  }
  phoneRing() { this.blip(880, 0.15, 'sine', 0.25); setTimeout(() => this.blip(880, 0.15, 'sine', 0.25), 220); }

  /** Per-frame: sequencer scheduling, engine pitch, siren wail. */
  update(dt, state) {
    if (!this.ctx || this.muted) {
      if (this.engineGain) this.engineGain.gain.value = 0;
      if (this.sirenGain) this.sirenGain.gain.value = 0;
      return;
    }
    const st = STATIONS[state.flags.radioStation];
    const stepDur = 60 / st.bpm / 2;
    while (this.nextStepTime < this.ctx.currentTime + 0.12) {
      this.scheduleStep(state.flags.radioStation, this.nextStepTime);
      this.nextStepTime += stepDur;
      this.step += 1;
    }
    const p = state.player;
    const speed = p.inCar ? Math.abs(p.inCar.speed) : Math.abs(p.speed);
    const target = p.inCar ? 0.05 + Math.min(0.16, speed * 0.003) : 0;
    this.engineGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
    this.engineOsc.frequency.setTargetAtTime(52 + speed * 4.2, this.ctx.currentTime, 0.06);
    this.engineFilter.frequency.setTargetAtTime(300 + speed * 22, this.ctx.currentTime, 0.1);
    // siren: wail between two tones, louder when cops are near
    const nearest = state.police ? state.police.cops.reduce((m, c) => Math.min(m, Math.hypot(c.x - p.x, c.z - p.z)), Infinity) : Infinity;
    const sirenVol = p.wanted > 0 && nearest < 120 ? clamp(0.12 - nearest * 0.0008, 0.02, 0.12) : 0;
    this.sirenGain.gain.setTargetAtTime(sirenVol, this.ctx.currentTime, 0.2);
    this.sirenOsc.frequency.setTargetAtTime(Math.sin(this.ctx.currentTime * 2.4) > 0 ? 720 : 960, this.ctx.currentTime, 0.05);
  }
}
