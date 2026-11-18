// The HUD: health bar, cash, wanted stars, ammo, speed, clock and the
// objective line, plus a live 2D minimap drawn from the world state.
// Phase B adds the phone, weapon wheel and mission tracker here.
import { WANTED_MAX } from './config.js';

let els = null;
let minimap = null;
let minimapCtx = null;

export function initHUD() {
  els = {
    healthFill: document.getElementById('health-fill'),
    healthText: document.getElementById('health-text'),
    cash: document.getElementById('cash'),
    stars: document.getElementById('stars'),
    ammo: document.getElementById('ammo'),
    speed: document.getElementById('speed'),
    clock: document.getElementById('clock'),
    objective: document.getElementById('objective'),
    hint: document.getElementById('hint'),
    missionTimer: document.getElementById('mission-timer'),
    crosshair: document.getElementById('crosshair'),
    vignette: document.getElementById('damage-vignette'),
    missionCard: document.getElementById('mission-card'),
    missionCardTitle: document.getElementById('mission-card-title'),
    missionCardBody: document.getElementById('mission-card-body'),
    missionList: document.getElementById('mission-list'),
  };
  minimap = document.getElementById('minimap');
  if (minimap) minimapCtx = minimap.getContext('2d');
  return els;
}

export function formatClock(day, minutes) {
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, '0');
  const mm = String(Math.floor(minutes % 60)).padStart(2, '0');
  return `Day ${day}  ${hh}:${mm}`;
}

export function formatCash(amount) {
  return `$${Math.floor(amount).toLocaleString('en-US')}`;
}

// One call per frame: cheap DOM writes only when the text actually
// changed, so the HUD never costs a layout per frame.
export function updateHUD(state) {
  if (!els) return;
  const healthPct = Math.max(0, Math.min(100, state.health));
  if (els.healthFill) els.healthFill.style.width = `${healthPct}%`;
  if (els.healthText) els.healthText.textContent = `${Math.ceil(healthPct)}`;
  if (els.cash) els.cash.textContent = formatCash(state.money);
  if (els.stars) {
    let stars = '';
    for (let i = 0; i < WANTED_MAX; i += 1) stars += i < state.wanted ? '★' : '☆';
    if (els.stars.textContent !== stars) els.stars.textContent = stars;
    els.stars.classList.toggle('hot', state.wanted >= 3);
  }
  if (els.ammo) els.ammo.textContent = state.inCar ? '—' : `${state.ammo} / ${state.ammoReserve ?? 0}`;
  if (els.speed) {
    const kmh = Math.round(Math.abs(state.speedKmh || 0));
    els.speed.textContent = state.inCar ? `${kmh} km/h` : 'ON FOOT';
  }
  if (els.clock) els.clock.textContent = formatClock(state.day, state.clockMinutes);
  if (els.objective && els.objective.textContent !== state.objective) {
    els.objective.textContent = state.objective;
  }
  if (els.hint) {
    const hint = state.inCar
      ? 'E — exit car · Space — handbrake · H — horn'
      : state.nearCar
        ? 'E — steal car · Click — shoot · F — punch · R — reload · Shift — sprint'
        : 'WASD — move · Click — shoot · F — punch · R — reload · E — enter car · M — missions';
    if (els.hint.textContent !== hint) els.hint.textContent = hint;
  }
  if (els.missionTimer) {
    const t = state.missionTimer > 0 ? `⏱ ${state.missionTimer}s` : '';
    if (els.missionTimer.textContent !== t) els.missionTimer.textContent = t;
  }
  // Damage vignette: a red flash that fades after the player is hurt.
  if (els.vignette) {
    els.vignette.style.opacity = String(Math.max(0, Math.min(1, state.damageFlash || 0)));
  }
  // Crosshair: only on foot, when the pistol is out.
  if (els.crosshair) {
    els.crosshair.style.display = !state.inCar && state.screen === 'playing' ? 'block' : 'none';
  }
}

// A mission intro/outro card, centre screen, fading after a few seconds.
let cardTimer = null;
export function showMissionCard(title, body, kind = 'info') {
  if (!els || !els.missionCard) return;
  els.missionCardTitle.textContent = title;
  els.missionCardBody.textContent = body;
  els.missionCard.className = `mission-card show ${kind}`;
  if (cardTimer) clearTimeout(cardTimer);
  cardTimer = setTimeout(() => {
    els.missionCard.classList.remove('show');
  }, 6000);
}

export function hideMissionCard() {
  if (els && els.missionCard) els.missionCard.classList.remove('show');
}

// Mission list for the pause screen: done, current, locked.
export function updateMissionList(missions, currentIndex, completed) {
  if (!els || !els.missionList) return;
  els.missionList.innerHTML = '';
  missions.forEach((m, i) => {
    const li = document.createElement('li');
    const done = completed.includes(m.id);
    li.textContent = `${done ? '✓' : i === currentIndex ? '►' : '·'} ${i + 1}. ${m.title} — $${m.reward.toLocaleString('en-US')}${done ? ' (done)' : ''}`;
    li.style.color = done ? '#7be495' : i === currentIndex ? '#ffd23f' : '#cdd8e2';
    els.missionList.appendChild(li);
  });
}

// Top-down minimap: ocean on the west edge, roads as lines, the player
// as a white arrow, traffic as yellow dots, police as flashing blue/red
// dots, and the mission marker as a gold diamond.
export function drawMinimap(state, city) {
  if (!minimapCtx || !city) return;
  const size = minimap.width;
  const half = size / 2;
  const scale = size / 380; // world spans roughly -190..190 on the map
  const toMap = (x, z) => [half + x * scale, half + z * scale];
  const ctx = minimapCtx;

  ctx.fillStyle = 'rgba(16, 24, 34, 0.92)';
  ctx.fillRect(0, 0, size, size);
  // Ocean strip on the west edge.
  const [ox] = toMap(-190, 0);
  ctx.fillStyle = '#1f7fae';
  ctx.fillRect(0, 0, Math.max(0, half - 150 * scale), size);
  // City ground.
  ctx.fillStyle = '#3a3f45';
  ctx.fillRect(half - 165 * scale, half - 165 * scale, 330 * scale, 330 * scale);
  // Roads.
  ctx.strokeStyle = '#6a7078';
  ctx.lineWidth = 3;
  for (const road of city.roads) {
    ctx.beginPath();
    const [ax, az] = toMap(road.axis === 'x' ? road.from : road.at, road.axis === 'x' ? road.at : road.from);
    const [bx, bz] = toMap(road.axis === 'x' ? road.to : road.at, road.axis === 'x' ? road.at : road.to);
    ctx.moveTo(ax, az);
    ctx.lineTo(bx, bz);
    ctx.stroke();
  }
  // Park.
  if (city.parkCenter) {
    const [px, pz] = toMap(city.parkCenter.x, city.parkCenter.z);
    ctx.fillStyle = '#3d8a3f';
    ctx.fillRect(px - 10, pz - 10, 20, 20);
  }
  // Mission marker.
  if (state.missionMarker) {
    const [mx, mz] = toMap(state.missionMarker.x, state.missionMarker.z);
    const pulse = 6 + Math.sin(state.time * 4) * 2;
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(mx, mz - pulse);
    ctx.lineTo(mx + pulse, mz);
    ctx.lineTo(mx, mz + pulse);
    ctx.lineTo(mx - pulse, mz);
    ctx.closePath();
    ctx.fill();
  }
  // Traffic dots.
  ctx.fillStyle = '#ffe27a';
  for (const car of state.traffic || []) {
    const [cx, cz] = toMap(car.pos.x, car.pos.z);
    ctx.fillRect(cx - 1.5, cz - 1.5, 3, 3);
  }
  // Pedestrian dots (grey) and Kings gang members (red).
  ctx.fillStyle = 'rgba(200,200,200,0.85)';
  for (const ped of state.peds || []) {
    if (!ped.alive) continue;
    const [cx, cz] = toMap(ped.pos.x, ped.pos.z);
    ctx.fillRect(cx - 1, cz - 1, 2, 2);
  }
  ctx.fillStyle = '#ff4444';
  for (const m of state.gang || []) {
    if (!m.alive) continue;
    const [cx, cz] = toMap(m.pos.x, m.pos.z);
    ctx.fillRect(cx - 1.5, cz - 1.5, 3, 3);
  }
  // Police dots (flashing — Phase B drives these from real pursuit).
  const flash = Math.floor(state.time * 3) % 2 === 0;
  ctx.fillStyle = flash ? '#3a86ff' : '#ff3b30';
  for (const car of state.police || []) {
    const [cx, cz] = toMap(car.pos.x, car.pos.z);
    ctx.beginPath();
    ctx.arc(cx, cz, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Player arrow.
  const [px, pz] = toMap(state.playerX, state.playerZ);
  ctx.save();
  ctx.translate(px, pz);
  ctx.rotate(-state.playerHeading + Math.PI);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 6);
  ctx.lineTo(0, 3);
  ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // North tick.
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.fillText('N', half - 4, 12);
}

export function showStartScreen(show) {
  const el = document.getElementById('start-screen');
  if (el) el.style.display = show ? 'flex' : 'none';
}

// The HUD belongs to play, not to the menus: hide it under the title
// screen and show it again when a game starts.
export function setHudVisible(visible) {
  for (const el of document.querySelectorAll('.hud')) {
    el.style.display = visible ? '' : 'none';
  }
}

export function showPauseScreen(show) {
  const el = document.getElementById('pause-screen');
  if (el) el.style.display = show ? 'flex' : 'none';
}

export function setStartButtons({ hasSave, onNew, onContinue }) {
  const btnNew = document.getElementById('btn-new');
  const btnContinue = document.getElementById('btn-continue');
  if (btnNew) btnNew.addEventListener('click', onNew);
  if (btnContinue) {
    btnContinue.style.display = hasSave ? 'inline-block' : 'none';
    btnContinue.addEventListener('click', onContinue);
  }
}
