// Save / load through localStorage, guarded so a browser that blocks
// storage (private mode, file:// quirks) just plays without saving.
// Phase B wires the save into mission progress and the pause menu.
export const SAVE_KEY = 'velora-bay-save-v1';

export function saveGame(state) {
  try {
    if (typeof localStorage === 'undefined') return false;
    const data = {
      version: 1,
      savedAt: Date.now(),
      money: state.money,
      health: state.health,
      wanted: state.wanted,
      ammo: state.ammo,
      day: state.day,
      clockMinutes: state.clockMinutes,
      missionsCompleted: state.missionsCompleted || [],
      stats: state.stats || {},
      player: {
        x: state.playerX,
        z: state.playerZ,
        heading: state.playerHeading,
      },
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    return false;
  }
}

export function loadGame() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== 1) return null;
    return data;
  } catch (err) {
    return null;
  }
}

export function hasSave() {
  return loadGame() !== null;
}

export function clearSave() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(SAVE_KEY);
  } catch (err) { /* storage unavailable */ }
}
