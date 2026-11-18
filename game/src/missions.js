// Missions: Rico Vale's story in eight jobs. Each is a short chain of
// steps — go somewhere, steal something, defeat someone, survive —
// driven by a floating beacon, a minimap diamond and the HUD objective.
// Walk into the beacon to start; failing sends you back to retry.
import * as THREE from 'three';
import { clamp } from './utils.js';

// Landmarks (all on roads or open ground, never inside a building).
const PIER = { x: -148, z: 0 };          // Mama Lou's garage, at the pier
const DOCKS = { x: -140, z: -116 };      // the docks, west edge
const PARK = { x: 145, z: 145 };         // the city park, south-east
const PLAZA = { x: 0, z: 0 };            // downtown plaza
const SHOWROOM = { x: 87, z: 29 };       // gold sports car showroom
const BANK = { x: 58, z: 58 };           // the bank, downtown
const BOAT = { x: -214, z: 0 };          // escape boat past the pier end
const HIDEOUT = { x: 145, z: 145 };      // crew hideout, by the park

export const MISSIONS = [
  {
    id: 'm1', title: 'First Wheels', reward: 300,
    intro: 'Mama Lou: "Rico, you owe me. Steal any car and bring it to my garage at the pier. No questions."',
    outro: 'Mama Lou: "Not bad. The car is mine now — and so is your debt, for a while."',
    steps: [
      { type: 'stealCar', label: 'Steal any car' },
      { type: 'goto', x: PIER.x, z: PIER.z, r: 9, label: "Deliver the car to Mama Lou's garage" },
    ],
  },
  {
    id: 'm2', title: 'The Drop', reward: 500,
    intro: 'Mama Lou: "A package is waiting at the docks. Take it to the park — and expect company. The cops are already sniffing around."',
    outro: 'The handoff is clean. Mama Lou counts the cash and nods: you are earning your keep.',
    steps: [
      { type: 'pickup', x: DOCKS.x, z: DOCKS.z, r: 6, label: 'Pick up the package at the docks', wantedOnPickup: 1 },
      { type: 'goto', x: PARK.x, z: PARK.z, r: 10, label: 'Deliver the package to the park' },
    ],
  },
  {
    id: 'm3', title: "Kings' Turf", reward: 800,
    intro: 'The Kings jumped one of Lou\'s runners at the downtown plaza. Four of them, bragging in the open. Take them down — then get out before their friends arrive.',
    outro: 'Four Kings down. The plaza is quiet again, and the whole city heard about it.',
    steps: [
      { type: 'goto', x: PLAZA.x, z: PLAZA.z, r: 14, label: 'Reach the downtown plaza' },
      { type: 'kill', count: 4, x: PLAZA.x, z: PLAZA.z, r: 30, label: 'Defeat 4 Kings gang members', spawnGang: true },
      { type: 'escape', x: PLAZA.x, z: PLAZA.z, r: 55, label: 'Escape the plaza area' },
    ],
  },
  {
    id: 'm4', title: 'The Getaway', reward: 1200,
    intro: 'Mama Lou: "A gold sports car sits in the showroom uptown. It is the Kings\' prize. Take it — and when the cops come, and they will, survive a full minute at three stars."',
    outro: 'Sixty seconds of sirens, and you are still driving. The gold car is yours now.',
    steps: [
      { type: 'stealGold', x: SHOWROOM.x, z: SHOWROOM.z, r: 8, label: 'Steal the gold sports car from the showroom' },
      { type: 'survive', seconds: 60, wanted: 3, label: 'Survive 60s at wanted level 3' },
    ],
  },
  {
    id: 'm5', title: 'Bay Heist', reward: 2500,
    intro: 'This is the big one. Hit the bank downtown, hold it against four-star police waves for ninety seconds, then run for the pier. Do this, and you are the King of Velora Bay.',
    outro: 'KING OF VELORA BAY. The pier lights, the ocean, the whole city — yours.',
    steps: [
      { type: 'goto', x: BANK.x, z: BANK.z, r: 10, label: 'Reach the bank downtown' },
      { type: 'survive', seconds: 90, wanted: 4, label: 'Survive 90s of 4-star police waves' },
      { type: 'goto', x: PIER.x, z: PIER.z, r: 9, label: 'Reach the pier — finish the job' },
    ],
  },
  {
    id: 'm6', title: 'Getaway Driver', reward: 1500,
    intro: 'Mama Lou: "Meet Danny at the docks — he is the best wheelman in Velora Bay, and he owes me too. Pick him up and drive him to the hideout by the park. The cops know his face, so keep moving."',
    outro: 'Danny: "You drive like you mean it, Rico. We are a crew now — you, me, and Lou."',
    steps: [
      { type: 'goto', x: DOCKS.x, z: DOCKS.z, r: 10, label: 'Meet Danny at the docks' },
      { type: 'pickup', x: DOCKS.x, z: DOCKS.z, r: 6, label: 'Pick up Danny', wantedOnPickup: 2 },
      { type: 'driveTo', x: HIDEOUT.x, z: HIDEOUT.z, r: 12, label: 'Drive Danny to the hideout by the park' },
    ],
  },
  {
    id: 'm7', title: 'Pier Escape', reward: 1800,
    intro: 'Mama Lou: "The Kings torched my garage, Rico. A boat is waiting past the pier — but the cops are already on the beachfront. Hold the pier for forty-five seconds, then run for the boat."',
    outro: 'The boat pulls away as the sirens fade. Lou is already planning the next move.',
    steps: [
      { type: 'goto', x: PIER.x, z: PIER.z, r: 10, label: 'Reach the pier' },
      { type: 'survive', seconds: 45, wanted: 3, label: 'Hold the pier for 45s at wanted level 3' },
      { type: 'goto', x: BOAT.x, z: BOAT.z, r: 8, label: 'Reach the boat — escape by sea' },
    ],
  },
  {
    id: 'm8', title: 'Kingpin', reward: 4000,
    intro: 'Mama Lou: "One name left: Big Sal, the Kings\' boss. He hides in the warehouse at the docks with five of his best. Take them all down — Sal most of all — and Velora Bay is yours."',
    outro: 'Big Sal is down. The Kings are finished. Rico Vale runs Velora Bay now.',
    steps: [
      { type: 'goto', x: DOCKS.x, z: DOCKS.z, r: 12, label: 'Reach the Kings\' warehouse at the docks' },
      { type: 'kill', count: 6, x: DOCKS.x, z: DOCKS.z, r: 32, label: 'Defeat Big Sal and 5 Kings', spawnGang: true, boss: true },
      { type: 'escape', x: DOCKS.x, z: DOCKS.z, r: 60, label: 'Leave the docks — the city is yours' },
    ],
  },
];

export const MISSION_SPOTS = { PIER, DOCKS, PARK, PLAZA, SHOWROOM, BANK, BOAT, HIDEOUT };

function buildBeacon(scene) {
  const group = new THREE.Group();
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.6),
    new THREE.MeshStandardMaterial({
      color: 0xffd23f, emissive: 0xaa7711, emissiveIntensity: 1.2,
      transparent: true, opacity: 0.9,
    }),
  );
  gem.position.y = 3.2;
  group.add(gem);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.9, 42, 10, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd23f, transparent: true, opacity: 0.16,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  beam.position.y = 21;
  group.add(beam);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.2, 3.0, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.12;
  group.add(ring);
  group.userData = { gem, ring };
  scene.add(group);
  return group;
}

export function createMissionSystem(scene, city, hooks) {
  const sys = {
    current: 0,          // index into MISSIONS; 5 = story finished
    stepIndex: 0,
    active: false,       // a mission is running right now
    waiting: true,       // standing at the beacon, ready to start next
    surviveLeft: 0,
    completed: [],
    beacon: buildBeacon(scene),
    goldCar: null,
  };

  function currentMission() {
    return MISSIONS[sys.current] || null;
  }

  function currentStep() {
    const m = currentMission();
    return m ? m.steps[sys.stepIndex] : null;
  }

  function moveBeaconTo(x, z) {
    sys.beacon.position.set(x, 0, z);
    sys.beacon.visible = true;
    if (hooks.setMarker) hooks.setMarker(x, z);
  }

  function setObjective(text) {
    if (hooks.setObjective) hooks.setObjective(text);
  }

  function showCard(title, body, kind = 'info') {
    if (hooks.showCard) hooks.showCard(title, body, kind);
  }

  // Point the beacon at what the player must do next.
  function pointBeacon() {
    const m = currentMission();
    if (!m) {
      sys.beacon.visible = false;
      if (hooks.setMarker) hooks.setMarker(null);
      return;
    }
    if (sys.waiting) {
      const first = m.steps[0];
      moveBeaconTo(first.x ?? PIER.x, first.z ?? PIER.z);
      setObjective(`${m.title} — walk into the gold beacon to start`);
    } else {
      const step = currentStep();
      if (step && step.x !== undefined) moveBeaconTo(step.x, step.z);
      else moveBeaconTo(hooks.getPlayerPos().x, hooks.getPlayerPos().z);
    }
  }

  sys.startMission = (index) => {
    const m = MISSIONS[index];
    if (!m) return false;
    sys.current = index;
    sys.stepIndex = 0;
    sys.active = true;
    sys.waiting = false;
    sys.surviveLeft = 0;
    if (hooks.onMissionStart) hooks.onMissionStart(m);
    showCard(`MISSION ${index + 1} — ${m.title}`, m.intro, 'intro');
    sys.advanceToStep(0);
    return true;
  };

  sys.advanceToStep = (i) => {
    sys.stepIndex = i;
    const step = currentStep();
    if (!step) { sys.completeMission(); return; }
    if (step.type === 'kill' && step.spawnGang && hooks.spawnGang) {
      hooks.spawnGang(step.x, step.z, step.count, step.boss);
    }
    if (step.type === 'stealGold' && hooks.spawnGoldCar) {
      sys.goldCar = hooks.spawnGoldCar(SHOWROOM.x, SHOWROOM.z);
    }
    if (step.type === 'survive') {
      sys.surviveLeft = step.seconds;
      if (hooks.setWanted) hooks.setWanted(step.wanted);
    }
    if (step.type === 'goto' || step.type === 'pickup' || step.type === 'stealGold' || step.type === 'escape' || step.type === 'driveTo') {
      moveBeaconTo(step.x, step.z);
    }
    const m = currentMission();
    setObjective(`${m.title}: ${step.label}`);
    if (hooks.onStep) hooks.onStep(m, step);
  };

  sys.completeMission = () => {
    const m = currentMission();
    if (!m) return;
    sys.completed.push(m.id);
    sys.active = false;
    sys.waiting = true;
    if (hooks.onReward) hooks.onReward(m.reward);
    showCard(`MISSION COMPLETE — ${m.title}`, `${m.outro}  Reward: $${m.reward.toLocaleString('en-US')}.`, 'complete');
    if (hooks.onMissionComplete) hooks.onMissionComplete(m);
    sys.current += 1;
    sys.stepIndex = 0;
    if (sys.current >= MISSIONS.length) {
      setObjective('King of Velora Bay — story complete. Free roam!');
      sys.beacon.visible = false;
      if (hooks.setMarker) hooks.setMarker(null);
      if (hooks.onStoryComplete) hooks.onStoryComplete();
    } else {
      pointBeacon();
    }
  };

  sys.failMission = (reason) => {
    const m = currentMission();
    if (!m || !sys.active) return;
    sys.active = false;
    sys.waiting = true;
    if (hooks.clearGang) hooks.clearGang();
    showCard(`MISSION FAILED — ${m.title}`, `${reason} Walk back into the beacon to retry.`, 'fail');
    if (hooks.onMissionFail) hooks.onMissionFail(m, reason);
    sys.stepIndex = 0;
    pointBeacon();
  };

  sys.getSaveData = () => ({
    current: sys.current,
    completed: [...sys.completed],
  });

  sys.loadSaveData = (data) => {
    if (!data) return;
    sys.completed = Array.isArray(data.completed) ? [...data.completed] : [];
    sys.current = clamp(data.current ?? sys.completed.length, 0, MISSIONS.length);
    sys.active = false;
    sys.waiting = true;
    sys.stepIndex = 0;
    pointBeacon();
  };

  sys.update = (dt) => {
    const m = currentMission();
    if (!m) return;
    // Beacon spin + bob, always — it is the player's compass.
    const { gem, ring } = sys.beacon.userData;
    gem.rotation.y += dt * 1.6;
    gem.position.y = 3.2 + Math.sin(hooks.getTime() * 2) * 0.35;
    ring.scale.setScalar(1 + Math.sin(hooks.getTime() * 3) * 0.12);
    const p = hooks.getPlayerPos();

    if (sys.waiting) {
      const first = m.steps[0];
      const bx = first.x ?? PIER.x;
      const bz = first.z ?? PIER.z;
      if (Math.hypot(p.x - bx, p.z - bz) < 6) sys.startMission(sys.current);
      return;
    }
    if (!sys.active) return;
    const step = currentStep();
    if (!step) return;
    const dist = step.x !== undefined ? Math.hypot(p.x - step.x, p.z - step.z) : Infinity;
    switch (step.type) {
      case 'goto':
        if (dist < step.r) sys.advanceToStep(sys.stepIndex + 1);
        break;
      case 'driveTo':
        // Like goto, but the player must arrive in a car — a driving job.
        if (dist < step.r && hooks.isInCar && hooks.isInCar()) sys.advanceToStep(sys.stepIndex + 1);
        else if (dist < step.r) setObjective(`${m.title}: get in a car — Danny rides, he does not walk`);
        break;
      case 'pickup':
        if (dist < step.r) {
          if (step.wantedOnPickup && hooks.setWanted) hooks.setWanted(step.wantedOnPickup);
          sys.advanceToStep(sys.stepIndex + 1);
        }
        break;
      case 'stealCar':
        if (hooks.isInCar && hooks.isInCar()) sys.advanceToStep(sys.stepIndex + 1);
        break;
      case 'stealGold': {
        const inGold = hooks.isInGoldCar ? hooks.isInGoldCar(sys.goldCar) : false;
        if (inGold) sys.advanceToStep(sys.stepIndex + 1);
        else if (dist < step.r && hooks.isInCar && hooks.isInCar()) {
          // In the wrong car at the showroom: nudge, do not advance.
          setObjective(`${m.title}: steal the GOLD sports car, not this one`);
        }
        break;
      }
      case 'kill': {
        const alive = hooks.getGangAlive ? hooks.getGangAlive() : 0;
        setObjective(`${m.title}: defeat the Kings — ${alive} left`);
        if (alive === 0) sys.advanceToStep(sys.stepIndex + 1);
        break;
      }
      case 'escape':
        if (dist > step.r) sys.advanceToStep(sys.stepIndex + 1);
        break;
      case 'survive': {
        const wanted = hooks.getWanted ? hooks.getWanted() : 0;
        if (wanted >= step.wanted) {
          sys.surviveLeft -= dt;
          if (hooks.setMissionTimer) hooks.setMissionTimer(Math.ceil(sys.surviveLeft));
        } else {
          // Wanted dropped: the heat is off, the clock stalls.
          if (hooks.setMissionTimer) hooks.setMissionTimer(Math.ceil(sys.surviveLeft));
          setObjective(`${m.title}: raise your wanted level back to ${step.wanted}★ — ${Math.ceil(sys.surviveLeft)}s left`);
        }
        if (sys.surviveLeft <= 0) {
          if (hooks.setMissionTimer) hooks.setMissionTimer(0);
          sys.advanceToStep(sys.stepIndex + 1);
        }
        break;
      }
      default:
        break;
    }
  };

  pointBeacon();
  return sys;
}
