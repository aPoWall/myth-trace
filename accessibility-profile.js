function parseStored(storage, key) {
  try { return JSON.parse(storage?.getItem?.(key) || 'null'); } catch { return null; }
}

export function normalizeAccessibilityProfile(value, { systemReducedMotion = false, systemHighContrast = false } = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.freeze({
    highContrast: source.highContrast === undefined ? Boolean(systemHighContrast) : source.highContrast === true,
    reducedMotion: source.reducedMotion === undefined ? Boolean(systemReducedMotion) : source.reducedMotion === true,
  });
}

export function createAccessibilityProfileStore({ config, storage = globalThis.localStorage, system = {}, onStatus = () => {} } = {}) {
  const settings = config?.accessibility;
  if (!settings) throw new TypeError('createAccessibilityProfileStore requires CONFIG.accessibility');
  const stored = parseStored(storage, settings.storageKey);
  let profile = normalizeAccessibilityProfile(stored, system);
  let persisted = Boolean(stored);
  let lastEvent = persisted ? 'accessibility profile restored' : 'accessibility follows system defaults';

  function state() {
    return Object.freeze({ profile, persisted, lastEvent });
  }

  function report(message) {
    lastEvent = message;
    try { onStatus(state(), message); } catch { /* observers cannot break local preferences */ }
    return state();
  }

  function save(patch = {}) {
    profile = normalizeAccessibilityProfile({ ...profile, ...patch });
    try {
      storage?.setItem?.(settings.storageKey, JSON.stringify({ version: settings.schemaVersion, ...profile }));
      persisted = true;
    } catch {
      persisted = false;
    }
    return report(`accessibility saved · contrast ${profile.highContrast ? 'high' : 'standard'} · motion ${profile.reducedMotion ? 'reduced' : 'full'}`);
  }

  return Object.freeze({ getState: state, save });
}
