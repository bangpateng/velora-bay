// HUD: the DOM panels (wanted stars, cash, clock, health, radio, the
// objective card, the message feed) and the canvas minimap drawn from
// the city graph every frame. No game logic lives here — only display.
import { formatCash, formatClock } from './util.js';

export class Hud {
  constructor(state) {
    this.state = state;
    this.el = {};
    for (const id of ['stars', 'cash', 'cash-sub', 'clock', 'obj-title', 'obj-text', 'obj-dist', 'health-fill', 'armor-fill', 'weapon-line', 'ammo-line', 'radio-name', 'speed', 'car-line', 'messages', 'crosshair', 'damage', 'toast', 'hint', 'menu', 'pause-menu', 'end-menu', 'end-title', 'end-text', 'pause-stats']) {
      this.el[id] = document.getElementById(id);
    }
    this.map = document.getElementById('minimap');
    this.mapCtx = this.map.getContext('2d');
    this.toastT = 0;
    this.lastObjective = '';
  }

  message(text, kind = '') {
    const div = document.createElement('div');
    if (kind) div.className = kind;
    div.textContent = text;
    this.el.messages.appendChild(div);
    while (this.el.messages.children.length > 4) this.el.messages.removeChild(this.el.messages.firstChild);
    setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 9000);
  }

  toast(title, sub = '') {
    const t = this.el.toast;
    t.innerHTML = '';
    const b = document.createElement('div'); b.textContent = title;
    t.appendChild(b);
    if (sub) { const s = document.createElement('small'); s.textContent = sub; t.appendChild(s); }
    t.style.display = 'block';
    this.toastT = 3.2;
  }

  showEnd(title, text) {
    this.el['end-title'].textContent = title;
    this.el['end-text'].textContent = text;
    this.el['end-menu'].classList.add('show');
  }

  hideEnd() { this.el['end-menu'].classList.remove('show'); }

  showMenu(show) { this.el.menu.classList.toggle('show', show); }
  showPause(show) { this.el['pause-menu'].classList.toggle('show', show); }

  /** Drain the state's feed into the message stack. */
  drainFeed() {
    const feed = this.state.feed;
    while (feed.items.length > 0) {
      const item = feed.items.shift();
      this.message(item.text, item.kind);
    }
  }

  update(dt) {
    const s = this.state;
    const p = s.player;
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.el.toast.style.display = 'none';
    }
    // stars
    let stars = '';
    for (let i = 0; i < 5; i++) stars += i < p.wanted ? '★' : '<span class="off">★</span>';
    this.el.stars.innerHTML = stars;
    this.el.cash.firstChild.nodeValue = formatCash(p.money);
    this.el['cash-sub'].textContent = 'KAI MARLOWE  •  ' + (p.wanted > 0 ? s.police.wantedLabel(p.wanted) : 'CLEAN');
    const dayPart = s.clockMinutes < 6 * 60 || s.clockMinutes >= 19 * 60 ? '☾ NIGHT' : s.clockMinutes < 12 * 60 ? '☀ MORNING' : s.clockMinutes < 17 * 60 ? '☀ AFTERNOON' : '☀ GOLDEN HOUR';
    this.el.clock.textContent = `${formatClock(s.clockMinutes)}   ${dayPart}   DAY ${s.day}`;
    this.el['health-fill'].style.width = `${Math.max(0, p.health)}%`;
    this.el['armor-fill'].style.width = `${Math.max(0, p.armor)}%`;
    this.el['weapon-line'].firstChild.nodeValue = p.weapon === 'fists' ? 'FISTS  •  ' : p.weapon === 'pistol' ? 'PISTOL  •  ' : 'SMG  •  ';
    this.el['ammo-line'].textContent = p.weapon === 'fists' ? '∞ melee' : `${p.ammo} rounds`;
    this.el['crosshair'].style.display = p.weapon !== 'fists' && !p.inCar ? 'block' : 'none';
    this.el.damage.style.opacity = s.combat ? String(Math.min(0.95, s.combat.flash)) : '0';
    const station = s.audio.stations[s.flags.radioStation];
    this.el['radio-name'].textContent = s.flags.radioMuted ? 'RADIO OFF (M to unmute)' : station.name;
    const speed = p.inCar ? Math.abs(p.inCar.speed) * 2.2 : Math.abs(p.speed) * 2.2;
    this.el.speed.textContent = String(Math.round(speed));
    this.el['car-line'].textContent = p.inCar ? (p.inCar.kind === 'cop' ? 'VBPD CRUISER (STOLEN)' : (p.inCar.kind.toUpperCase() + '  •  HP ' + Math.max(0, Math.round(p.inCar.hp)) + '%')) : 'ON FOOT';
    // objective
    const obj = s.missions.objectiveText();
    const key = obj.title + '|' + obj.text;
    if (key !== this.lastObjective) {
      this.lastObjective = key;
      this.el['obj-title'].textContent = obj.title;
      this.el['obj-text'].textContent = obj.text;
    }
    const marker = s.missions.marker();
    this.el['obj-dist'].textContent = marker ? `◆ ${Math.round(Math.hypot(marker.x - p.x, marker.z - p.z))} m` : '';
    this.drawMinimap(marker);
  }

  drawMinimap(marker) {
    const s = this.state;
    const ctx = this.mapCtx;
    const W = 210, C = W / 2;
    const scale = W / 760; // world -380..380 maps to the disc
    const px = (x) => C + x * scale;
    const pz = (z) => C + z * scale;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath(); ctx.arc(C, C, C - 2, 0, Math.PI * 2); ctx.clip();
    // sea + sand + land
    ctx.fillStyle = '#1e7f9e'; ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = '#e8d29a'; ctx.fillRect(0, 0, px(-300), W);
    ctx.fillStyle = '#274b63'; ctx.fillRect(px(-300), 0, W - px(-300), W);
    // roads
    ctx.strokeStyle = '#5a636e'; ctx.lineWidth = 5;
    for (let i = -5; i <= 5; i++) {
      ctx.beginPath(); ctx.moveTo(px(i * 60), 0); ctx.lineTo(px(i * 60), W); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, pz(i * 60)); ctx.lineTo(W, pz(i * 60)); ctx.stroke();
    }
    ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 1;
    for (let i = -5; i <= 5; i++) {
      ctx.beginPath(); ctx.moveTo(px(i * 60), 0); ctx.lineTo(px(i * 60), W); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, pz(i * 60)); ctx.lineTo(W, pz(i * 60)); ctx.stroke();
    }
    const p = s.player;
    const blip = (x, z, color, r = 4) => {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(px(x), pz(z), r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
    };
    // safehouse + garage
    blip(-30, -270, '#37e08b', 5);
    blip(-90, -270, '#4aa8ff', 4);
    // mission marker (pulsing gold diamond)
    if (marker) {
      const pulse = 6 + Math.sin(s.time * 5) * 2;
      ctx.fillStyle = '#ffd23e';
      ctx.beginPath();
      ctx.moveTo(px(marker.x), pz(marker.z) - pulse);
      ctx.lineTo(px(marker.x) + pulse, pz(marker.z));
      ctx.lineTo(px(marker.x), pz(marker.z) + pulse);
      ctx.lineTo(px(marker.x) - pulse, pz(marker.z));
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.stroke();
    }
    // cops (blue) + heli
    if (s.police) {
      for (const c of s.police.cops) blip(c.x, c.z, '#2244ff', 3.5);
      if (s.police.heliMesh.visible) blip(s.police.heli.x, s.police.heli.z, '#ff2222', 5);
    }
    // enemies (red)
    if (s.combat) for (const e of s.combat.enemies) blip(e.x, e.z, '#ff4444', 3.5);
    // taxi fare target
    if (s.taxi && s.taxi.target) blip(s.taxi.target.x, s.taxi.target.z, '#ffe066', 4);
    // player arrow (rotates with heading)
    ctx.save();
    ctx.translate(px(p.x), pz(p.z));
    ctx.rotate(-p.heading + Math.PI);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.stroke();
    ctx.restore();
    ctx.restore();
    // north tick
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('N', C, 13);
  }
}
