// The story: ten jobs for fixer Mara Solis, from a first stolen car to
// the showdown on the pier. A mission is a list of steps; each step is
// one verb (go, drive, take, kill, race, survive, smash, chase) with a
// target, and the manager advances, times and pays them out.
import { clamp, dist2, formatCash } from './util.js';

export const MISSION_DEFS = [
  {
    id: 1, title: 'First Wheels', giver: 'Mara Solis', reward: 300,
    briefing: 'Mara needs a driver, not a résumé. Steal any car on the street and bring it to her garage in the Hills.',
    steps: [
      { type: 'car', label: 'Steal any car (walk up to one and press E)' },
      { type: 'goto', x: -90, z: -270, r: 45, label: 'Drive to Mara\'s garage in the Hills', inCar: true },
    ],
  },
  {
    id: 2, title: 'Courier Run', giver: 'Mara Solis', reward: 400,
    briefing: 'A package for the diner, then one for the marina office. The clock is the boss. 150 seconds, Kai.',
    timer: 150,
    steps: [
      { type: 'goto', x: 90, z: 150, r: 45, label: 'Deliver the package to the Diner' },
      { type: 'goto', x: -270, z: -90, r: 45, label: 'Deliver the second package to the Marina Office' },
    ],
  },
  {
    id: 3, title: 'Repo Job', giver: 'Mara Solis', reward: 550,
    briefing: 'A Torro Muscle sits unpaid-for at the harbor. Take it, and the cops will notice — lose them before Dino\'s Autos.',
    steps: [
      { type: 'take', kind: 'muscle', x: 180, z: 240, label: 'Take the Torro Muscle at the Harbor' },
      { type: 'goto', x: 150, z: -90, r: 45, label: 'Deliver it to Dino\'s Autos (lose the cops first)', inCar: true, needWanted: 0 },
    ],
  },
  {
    id: 4, title: 'Taxi Trouble', giver: 'Dino', reward: 500,
    briefing: 'Dino\'s cabbie called in sick. Three fares, one cab, no complaints. The taxi is waiting by the Diner.',
    steps: [
      { type: 'taxi', label: 'Get in the Bay Taxi by the Diner' },
      { type: 'fare', x: -120, z: 180, label: 'Fare 1: drop the passenger at the beach road' },
      { type: 'fare', x: 240, z: -60, label: 'Fare 2: drop the passenger in Old Town' },
      { type: 'fare', x: 0, z: -180, label: 'Fare 3: drop the passenger in the Hills' },
    ],
  },
  {
    id: 5, title: 'The Drop', giver: 'Mara Solis', reward: 700,
    briefing: 'A pickup on the pier at dusk. Vince Kade\'s crew heard about it too. Take the package, then take them down.',
    steps: [
      { type: 'goto', x: -380, z: 60, r: 8, label: 'Walk the pier and grab the package' },
      { type: 'kill', count: 4, label: 'Kade\'s crew is here — take them all down', spawn: 'pierCrew' },
      { type: 'goto', x: -30, z: -270, r: 20, label: 'Get back to the safehouse' },
    ],
  },
  {
    id: 6, title: 'Street Circuit', giver: 'Rae', reward: 900,
    briefing: 'Rae runs the midnight circuit. Five checkpoints through downtown, three rivals, one winner. Don\'t finish last.',
    timer: 200,
    steps: [
      { type: 'race', label: 'Race the circuit — hit every checkpoint', checkpoints: [[120, 120], [120, -120], [-120, -120], [-120, 120], [0, 0]] },
    ],
  },
  {
    id: 7, title: 'Bank of Velora', giver: 'Mara Solis', reward: 1500,
    briefing: 'The Bank of Velora keeps its cash in the back. Walk in, grab it, and hold the door while the whole city wakes up.',
    steps: [
      { type: 'goto', x: 30, z: 30, r: 20, label: 'Enter the Bank of Velora', onFoot: true },
      { type: 'hold', seconds: 6, label: 'Grab the cash — hold the vault!' },
      { type: 'kill', count: 6, label: 'Bank security is coming — hold them off', spawn: 'bankGuards' },
      { type: 'escape', x: -30, z: -270, r: 45, label: 'Escape to the safehouse with the money', wanted: 3 },
    ],
  },
  {
    id: 8, title: 'Air Mail', giver: 'Mara Solis', reward: 1100,
    briefing: 'The heli is already up. They want the package you\'re carrying. Get it to the marina office — and don\'t stop for anyone.',
    steps: [
      { type: 'escape', x: -270, z: -90, r: 45, label: 'Reach the Marina Office under a 3-star chase', wanted: 3, timer: 120 },
    ],
  },
  {
    id: 9, title: 'Harbor Lights', giver: 'Mara Solis', reward: 1300,
    briefing: 'Night job. Kade is moving product through the harbor in four marked crates. Smash them all — by car or by bullet.',
    night: true,
    steps: [
      { type: 'smash', count: 4, label: 'Smash the four marked crates at the Harbor', area: { x: 120, z: 265 } },
      { type: 'goto', x: -90, z: -270, r: 45, label: 'Get back to the garage' },
    ],
  },
  {
    id: 10, title: 'The Last Tide', giver: 'Mara Solis', reward: 2500,
    briefing: 'Vince Kade is running for the pier in his Vela GT. Ram him off the road, finish his crew, and end this.',
    steps: [
      { type: 'chase', label: 'Chase Kade\'s Vela GT — ram it until it stops' },
      { type: 'kill', count: 3, label: 'Kade\'s last crew on the pier', spawn: 'pierCrew' },
      { type: 'goto', x: -380, z: 60, r: 8, label: 'Walk to the end of the pier. It\'s over.' },
    ],
  },
];

export class MissionManager {
  constructor(state) {
    this.state = state;
    this.active = null; // { def, stepIndex, timer, holdT, kills, crates, rivals, chaseCar, startedAt }
    this.racePositions = [];
  }

  get currentDef() {
    return MISSION_DEFS[this.state.progress.missionIndex] || null;
  }

  get isActive() { return !!this.active; }

  start(index = this.state.progress.missionIndex) {
    const def = MISSION_DEFS[index];
    if (!def) return false;
    this.active = {
      def, stepIndex: 0, timer: def.timer || 0, holdT: 0,
      kills: 0, killsNeeded: 0, crates: [], rivals: [], chaseCar: null,
      raceCp: 0, checkpoint: null, startedAt: this.state.time,
    };
    if (def.night) this.state.clockMinutes = 21 * 60;
    this.state.feed.push(`JOB ${def.id}/10 — ${def.title}`, 'gold');
    this.state.feed.push(`${def.giver}: ${def.briefing}`);
    this.enterStep();
    return true;
  }

  currentStep() {
    return this.active ? this.active.def.steps[this.active.stepIndex] : null;
  }

  enterStep() {
    const s = this.state;
    const step = this.currentStep();
    if (!step) return;
    const m = this.active;
    if (step.type === 'kill') {
      m.kills = 0; m.killsNeeded = step.count;
      s.combat.spawnSquad(step.spawn || 'pierCrew', step.count, s.player);
    } else if (step.type === 'smash') {
      m.crates = s.combat.spawnCrates(step.area.x, step.area.z, step.count);
    } else if (step.type === 'chase') {
      m.chaseCar = s.combat.spawnChaseTarget(s.player);
    } else if (step.type === 'race') {
      m.raceCp = 0;
      m.rivals = s.combat.spawnRacers(step.checkpoints, s.player);
    } else if (step.type === 'take') {
      s.combat.spawnTakeCar(step.kind, step.x, step.z);
    } else if (step.type === 'taxi') {
      s.combat.spawnTakeCar('taxi', 120, 150);
    } else if (step.type === 'escape' && step.wanted) {
      s.police.addWanted(s.player, step.wanted - s.player.wanted, 'The heat is on', s);
    }
    if (step.type === 'escape' && step.timer) m.timer = step.timer;
    if (step.type === 'hold') m.holdT = 0;
  }

  advance() {
    const m = this.active;
    m.stepIndex += 1;
    if (m.stepIndex >= m.def.steps.length) {
      this.complete();
    } else {
      this.enterStep();
    }
  }

  complete() {
    const s = this.state;
    const m = this.active;
    s.player.money += m.def.reward;
    s.stats.missionsDone += 1;
    s.progress.missionIndex = Math.min(10, s.progress.missionIndex + 1);
    if (m.def.id === 3) s.progress.ownedCars.push('muscle');
    if (m.def.id === 4) s.progress.ownedCars.push('taxi');
    if (m.def.id === 6) s.progress.ownedCars.push('sports');
    if (m.def.id === 9) s.progress.unlocked.pistol = true;
    if (m.def.id === 10) s.progress.ownedCars.push('sports');
    s.combat.clearMissionObjects();
    s.feed.push(`JOB COMPLETE — ${m.def.title}: +${formatCash(m.def.reward)}`, 'gold');
    s.hud.toast(`JOB COMPLETE`, `${m.def.title}  •  +${formatCash(m.def.reward)}`);
    s.audio.jingle();
    if (s.progress.missionIndex >= 10) {
      s.mode = 'complete';
      s.hud.showEnd('VELORA BAY IS YOURS', 'Ten jobs, one city. Mara is proud, the cops are tired, and the Bay belongs to Kai Marlowe. Story complete — free roam continues.');
    }
    this.active = null;
    s.save.autosave();
  }

  fail(reason) {
    const s = this.state;
    s.combat.clearMissionObjects();
    this.active = null;
    s.hud.showEnd('JOB FAILED', `${reason} — the job is still open. Try again from the pause menu or the phone.`);
  }

  /** Where the gold marker sits right now, or null. */
  marker() {
    if (!this.active) return null;
    const step = this.currentStep();
    if (!step) return null;
    if (step.type === 'race') {
      const cp = step.checkpoints[this.active.raceCp];
      return cp ? { x: cp[0], z: cp[1] } : null;
    }
    if (step.type === 'chase' && this.active.chaseCar) return { x: this.active.chaseCar.x, z: this.active.chaseCar.z };
    if (step.type === 'kill' || step.type === 'hold') return null;
    if (step.x !== undefined) return { x: step.x, z: step.z };
    return null;
  }

  update(dt) {
    if (!this.active) return;
    const s = this.state;
    const m = this.active;
    const step = this.currentStep();
    const p = s.player;
    if (m.timer > 0) {
      m.timer -= dt;
      if (m.timer <= 0) { this.fail('Out of time.'); return; }
    }
    if (!step) return;
    const d = (x, z) => dist2(p.x, p.z, x, z);

    switch (step.type) {
      case 'car':
        if (p.inCar) this.advance();
        break;
      case 'goto':
      case 'fare':
        if (step.inCar && !p.inCar) break;
        if (step.onFoot && p.inCar) break;
        if (step.needWanted !== undefined && p.wanted > step.needWanted) break; // cool off first
        if (d(step.x, step.z) < (step.r || 8)) this.advance();
        break;
      case 'take':
        if (p.inCar && p.inCar.kind === step.kind) {
          s.police.addWanted(p, 1, 'Grand theft auto', s);
          s.stats.carsStolen += 1;
          this.advance();
        }
        break;
      case 'taxi':
        if (p.inCar && p.inCar.kind === 'taxi') this.advance();
        break;
      case 'kill':
        if (m.kills >= m.killsNeeded) this.advance();
        break;
      case 'hold':
        if (d(30, 30) < 20) {
          m.holdT += dt;
          if (m.holdT >= step.seconds) {
            s.player.money += 200;
            this.advance();
          }
        } else m.holdT = Math.max(0, m.holdT - dt);
        break;
      case 'race': {
        const cp = step.checkpoints[m.raceCp];
        if (cp && d(cp[0], cp[1]) < 12) {
          m.raceCp += 1;
          s.audio.pickup();
          if (m.raceCp >= step.checkpoints.length) {
            const rivalsAhead = m.rivals.filter((r) => r.cp > m.raceCp).length;
            if (rivalsAhead > 0) { this.fail('Rae\'s crew beat you to the line.'); return; }
            this.advance();
          }
        }
        break;
      }
      case 'escape':
        if (step.timer !== undefined && m.timer <= 0) { this.fail('They caught up with you.'); return; }
        if (d(step.x, step.z) < (step.r || 10)) {
          if (step.wanted) s.police.clearWanted(p);
          this.advance();
        }
        break;
      case 'smash':
        if (m.crates.every((c) => c.hp <= 0)) this.advance();
        break;
      case 'chase':
        if (m.chaseCar && m.chaseCar.hp <= 25) {
          s.feed.push('Kade\'s GT is done — he\'s running for the pier on foot.', 'gold');
          s.combat.despawnChaseTarget();
          this.advance();
        }
        break;
      default:
        break;
    }
    // mission 3's escape step also needs the wanted level gone — the
    // goto case above already refuses to advance while wanted > needWanted.
  }

  /** Text for the objective panel. */
  objectiveText() {
    if (!this.active) {
      const next = this.currentDef;
      if (!next) return { title: 'FREE ROAM', text: 'Story complete. The city is yours — fares, coins and jumps still pay.' };
      return { title: `NEXT JOB: ${next.title.toUpperCase()}`, text: `${next.giver}: ${next.briefing} — press ENTER to start the job.` };
    }
    const step = this.currentStep();
    const m = this.active;
    let extra = '';
    if (m.timer > 0) extra = `  •  ${Math.ceil(m.timer)}s left`;
    if (step.type === 'kill') extra = `  •  ${m.kills}/${m.killsNeeded} down`;
    if (step.type === 'hold') extra = `  •  hold ${Math.ceil(step.seconds - m.holdT)}s`;
    if (step.type === 'race') extra = `  •  checkpoint ${m.raceCp + 1}/${step.checkpoints.length}`;
    if (step.type === 'smash') extra = `  •  ${m.crates.filter((c) => c.hp > 0).length} crates left`;
    return { title: `JOB ${m.def.id}/10 — ${m.def.title.toUpperCase()}`, text: (step.label || '') + extra };
  }
}
