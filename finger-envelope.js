const FINGER_NAMES = Object.freeze(['thumb', 'index', 'middle', 'ring', 'pinky']);

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function validRange(value, label) {
  if (!Array.isArray(value) || value.length !== 2) throw new TypeError(`${label} must contain min and max`);
  const min = Number(value[0]);
  const max = Number(value[1]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) {
    throw new TypeError(`${label} must be a finite positive range`);
  }
  return Object.freeze([min, max]);
}

function readConfig(config) {
  const source = config?.music?.fingerEnvelope;
  if (!source || typeof source.storageKey !== 'string' || !source.storageKey) {
    throw new TypeError('createFingerEnvelope requires CONFIG.music.fingerEnvelope');
  }
  const attackRange = validRange(source.attackRange, 'finger envelope attackRange');
  const releaseRange = validRange(source.releaseRange, 'finger envelope releaseRange');
  const defaults = {};
  for (const finger of FINGER_NAMES) {
    const value = source.defaults?.[finger];
    const attack = Number(value?.attack);
    const release = Number(value?.release);
    if (!Number.isFinite(attack) || attack < attackRange[0] || attack > attackRange[1]
      || !Number.isFinite(release) || release < releaseRange[0] || release > releaseRange[1]) {
      throw new TypeError(`finger envelope default ${finger} is outside its range`);
    }
    defaults[finger] = Object.freeze({ attack, release });
  }
  return Object.freeze({
    storageKey: source.storageKey,
    schemaVersion: Math.round(finite(source.schemaVersion, 0)),
    attackRange,
    releaseRange,
    step: Math.max(0.001, finite(source.step, 0.01)),
    defaults: Object.freeze(defaults),
  });
}

function snapshot(values, revision, lastEvent) {
  const envelopes = {};
  for (const finger of FINGER_NAMES) envelopes[finger] = Object.freeze({ ...values[finger] });
  return Object.freeze({
    revision,
    lastEvent,
    values: Object.freeze(envelopes),
  });
}

export function createFingerEnvelope({
  config,
  storage = globalThis.localStorage,
} = {}) {
  const settings = readConfig(config);
  const values = Object.fromEntries(FINGER_NAMES.map((finger) => [finger, { ...settings.defaults[finger] }]));
  let destroyed = false;
  let revision = 0;
  let lastEvent = 'finger envelopes · defaults';
  let cachedState = null;

  function restoreField(candidate, finger, field, range) {
    const value = Number(candidate?.[finger]?.[field]);
    if (!Number.isFinite(value) || value < range[0] || value > range[1]) return false;
    values[finger][field] = value;
    return true;
  }

  try {
    const stored = JSON.parse(storage?.getItem?.(settings.storageKey) || 'null');
    if (stored && Number(stored.version) === settings.schemaVersion) {
      let restored = false;
      for (const finger of FINGER_NAMES) {
        restored = restoreField(stored.values, finger, 'attack', settings.attackRange) || restored;
        restored = restoreField(stored.values, finger, 'release', settings.releaseRange) || restored;
      }
      if (restored) {
        revision = 1;
        lastEvent = 'finger envelopes · restored';
      }
    }
  } catch { /* unavailable or malformed storage keeps CONFIG defaults */ }

  function getState() {
    if (!cachedState) cachedState = snapshot(values, revision, lastEvent);
    return cachedState;
  }

  function persist() {
    try {
      storage?.setItem?.(settings.storageKey, JSON.stringify({
        version: settings.schemaVersion,
        values: Object.fromEntries(FINGER_NAMES.map((finger) => [finger, { ...values[finger] }])),
      }));
    } catch { /* in-memory controls remain usable */ }
  }

  function configure(finger, patch = {}) {
    if (destroyed) return getState();
    if (!FINGER_NAMES.includes(finger)) throw new TypeError('finger envelope requires a known finger');
    let changed = false;
    if (Number.isFinite(Number(patch.attack))) {
      const attack = clamp(patch.attack, settings.attackRange[0], settings.attackRange[1]);
      if (values[finger].attack !== attack) {
        values[finger].attack = attack;
        changed = true;
      }
    }
    if (Number.isFinite(Number(patch.release))) {
      const release = clamp(patch.release, settings.releaseRange[0], settings.releaseRange[1]);
      if (values[finger].release !== release) {
        values[finger].release = release;
        changed = true;
      }
    }
    if (!changed) return getState();
    revision += 1;
    lastEvent = `${finger} envelope · attack ${values[finger].attack.toFixed(3)} · release ${values[finger].release.toFixed(2)}`;
    cachedState = null;
    persist();
    return getState();
  }

  function reset() {
    if (destroyed) return getState();
    for (const finger of FINGER_NAMES) Object.assign(values[finger], settings.defaults[finger]);
    revision += 1;
    lastEvent = 'finger envelopes · reset to score';
    cachedState = null;
    try { storage?.removeItem?.(settings.storageKey); } catch { /* defaults remain active */ }
    return getState();
  }

  function destroy() {
    destroyed = true;
  }

  return Object.freeze({ configure, reset, getState, destroy });
}
