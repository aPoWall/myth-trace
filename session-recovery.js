import { CONFIG } from './config.js';
export function saveRecovery(storage, payload, now = Date.now()) {
  storage.setItem(CONFIG.sessionRecovery.key, JSON.stringify({ savedAt: now, pending: true, payload }));
}
export function readRecovery(storage, now = Date.now()) {
  try {
    const value = JSON.parse(storage.getItem(CONFIG.sessionRecovery.key) || 'null');
    if (!value?.pending || now - value.savedAt > CONFIG.sessionRecovery.maxAgeMs || now < value.savedAt || !value.payload) return null;
    storage.setItem(CONFIG.sessionRecovery.key, JSON.stringify({ ...value, pending: false }));
    return value.payload;
  } catch { return null; }
}
