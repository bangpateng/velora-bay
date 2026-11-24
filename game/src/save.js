// Save / load: one localStorage slot, written on autosave points
// (mission complete, safehouse entry, pause-menu save) and read on
// Continue. The file only ever holds numbers, ids and small lists.
import { SAVE_KEY, snapshotProgress, applyProgress } from './state.js';

export class SaveSystem {
  constructor(state) {
    this.state = state;
  }

  hasSave() {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  }

  autosave() {
    this.write();
  }

  write() {
    try {
      const s = this.state;
      const data = {
        ...snapshotProgress(s),
        playerPos: { x: s.player.x, z: s.player.z, heading: s.player.heading },
        savedAt: new Date().toISOString(),
        version: 4,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  read() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  load() {
    const snap = this.read();
    if (!snap) return false;
    const ok = applyProgress(this.state, snap);
    if (ok && snap.playerPos) {
      this.state.player.x = snap.playerPos.x;
      this.state.player.z = snap.playerPos.z;
      this.state.player.heading = snap.playerPos.heading;
    }
    return ok;
  }

  clear() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* private mode */ }
  }
}
