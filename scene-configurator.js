const RENDER_KEYS = Object.freeze([
  'intensity',
  'feedback',
  'bloom',
  'aberration',
  'threshold',
  'particleGain',
]);

const TUNING_KEYS = Object.freeze([
  'fieldFloor',
  'bodyReveal',
  'voidCoverage',
  'centering',
  'warmth',
  'density',
]);

const NUMERIC_KEYS = Object.freeze([...RENDER_KEYS, ...TUNING_KEYS, 'portraitMix']);
const PATCH_KEYS = Object.freeze(['palette', ...NUMERIC_KEYS]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, range) {
  return Math.min(range[1], Math.max(range[0], value));
}

function readRange(value, label) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new TypeError(`Missing scene configurator range: ${label}`);
  }
  const first = Number(value[0]);
  const second = Number(value[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    throw new TypeError(`Invalid scene configurator range: ${label}`);
  }
  return Object.freeze([Math.min(first, second), Math.max(first, second)]);
}

function readSchema(config) {
  if (!isRecord(config) || !isRecord(config.sceneConfigurator)) {
    throw new TypeError('CONFIG.sceneConfigurator is required');
  }

  const scene = config.sceneConfigurator;
  const presetOrder = Array.isArray(scene.presetOrder)
    ? scene.presetOrder.filter((name) => typeof name === 'string' && name.length > 0)
    : [];
  const modes = Array.isArray(scene.modes)
    ? scene.modes.filter((mode) => Number.isInteger(mode))
    : [];

  if (presetOrder.length === 0 || modes.length === 0 || !isRecord(scene.presets)) {
    throw new TypeError('CONFIG.sceneConfigurator presets and modes are required');
  }

  const renderLimits = {};
  for (const key of RENDER_KEYS) {
    renderLimits[key] = readRange(scene.renderLimits?.[key], `renderLimits.${key}`);
  }

  const tuningLimits = {};
  for (const key of TUNING_KEYS) {
    tuningLimits[key] = readRange(scene.renderLimits?.[key], `renderLimits.${key}`);
  }

  if (scene.renderLimits?.portraitMix) tuningLimits.portraitMix = readRange(scene.renderLimits.portraitMix, 'renderLimits.portraitMix');

  const bloomLimit = renderLimits.bloom;
  const safeBloomMax = Number(config.calibration?.safeBloomMax);
  if (!Number.isFinite(safeBloomMax)) {
    throw new TypeError('CONFIG.calibration.safeBloomMax is required');
  }
  renderLimits.bloom = Object.freeze([
    bloomLimit[0],
    Math.max(bloomLimit[0], Math.min(bloomLimit[1], safeBloomMax)),
  ]);

  return {
    scene,
    version: Number.isInteger(scene.version) ? scene.version : 1,
    modes: Object.freeze([...new Set(modes)]),
    presetOrder: Object.freeze([...new Set(presetOrder)]),
    renderLimits: Object.freeze(renderLimits),
    tuningLimits: Object.freeze(tuningLimits),
  };
}

function normalizeWithSchema(input, defaults, schema) {
  const safeInput = isRecord(input) ? input : {};
  const safeDefaults = isRecord(defaults) ? defaults : {};
  const fallbackPresetName = schema.presetOrder[0];
  const fallbackPreset = isRecord(schema.scene.presets[fallbackPresetName])
    ? schema.scene.presets[fallbackPresetName]
    : {};
  const presetNames = schema.presetOrder;

  const defaultPreset = presetNames.includes(safeDefaults.preset) || safeDefaults.preset === 'custom'
    ? safeDefaults.preset
    : fallbackPresetName;
  const preset = presetNames.includes(safeInput.preset) || safeInput.preset === 'custom'
    ? safeInput.preset
    : defaultPreset;

  const defaultPalette = presetNames.includes(safeDefaults.palette)
    ? safeDefaults.palette
    : presetNames.includes(fallbackPreset.palette)
      ? fallbackPreset.palette
      : fallbackPresetName;
  const palette = presetNames.includes(safeInput.palette) ? safeInput.palette : defaultPalette;
  const settings = { preset, palette };

  for (const key of RENDER_KEYS) {
    const range = schema.renderLimits[key];
    const fallback = finite(safeDefaults[key], finite(fallbackPreset[key], range[0]));
    settings[key] = clamp(finite(safeInput[key], fallback), range);
  }

  for (const [key, range] of Object.entries(schema.tuningLimits)) {
    const fallback = finite(safeDefaults[key], finite(fallbackPreset[key], range[0]));
    settings[key] = clamp(finite(safeInput[key], fallback), range);
  }

  return Object.freeze(settings);
}

export function normalizeSceneSettings(input = {}, defaults = {}, config) {
  return normalizeWithSchema(input, defaults, readSchema(config));
}

function settingsEqual(a, b) {
  if (a === b) return true;
  return a.preset === b.preset
    && a.palette === b.palette
    && NUMERIC_KEYS.every((key) => a[key] === b[key]);
}

function materialSettingsEqual(a, b) {
  return a.palette === b.palette && NUMERIC_KEYS.every((key) => a[key] === b[key]);
}

function freezeState(version, modes) {
  return Object.freeze({
    version,
    modes: Object.freeze({ ...modes }),
  });
}

export function createSceneConfigurator({ config, storage, storageKey } = {}) {
  const schema = readSchema(config);
  const key = typeof storageKey === 'string' && storageKey.trim()
    ? storageKey.trim()
    : schema.scene.storageKey;
  const listeners = new Set();
  const validModes = new Set(schema.modes.map(String));
  const presetNames = new Set(schema.presetOrder);
  const defaults = {};

  for (const mode of schema.modes) {
    const modeKey = String(mode);
    const configuredPreset = schema.scene.defaultPresetByMode?.[modeKey]
      ?? schema.scene.defaultPresetByMode?.[mode]
      ?? schema.scene.defaults?.[modeKey]
      ?? schema.scene.defaults?.[mode];
    const presetName = presetNames.has(configuredPreset)
      ? configuredPreset
      : schema.presetOrder[0];
    const preset = isRecord(schema.scene.presets[presetName])
      ? schema.scene.presets[presetName]
      : {};
    defaults[modeKey] = normalizeWithSchema(
      { ...preset, preset: presetName },
      { ...preset, preset: presetName },
      schema,
    );
  }

  const defaultState = freezeState(schema.version, defaults);
  let state = defaultState;
  let destroyed = false;

  try {
    if (storage && typeof storage.getItem === 'function') {
      const serialized = storage.getItem(key);
      if (typeof serialized === 'string' && serialized.length > 0) {
        const restored = JSON.parse(serialized);
        if (
          isRecord(restored)
          && restored.version === schema.version
          && isRecord(restored.modes)
        ) {
          const restoredModes = {};
          for (const mode of schema.modes) {
            const modeKey = String(mode);
            restoredModes[modeKey] = isRecord(restored.modes[modeKey])
              ? normalizeWithSchema(restored.modes[modeKey], defaults[modeKey], schema)
              : defaults[modeKey];
          }
          state = freezeState(schema.version, restoredModes);
        }
      }
    }
  } catch {
    state = defaultState;
  }

  function modeKeyFor(mode) {
    const modeKey = String(mode);
    return validModes.has(modeKey) ? modeKey : null;
  }

  function persist(nextState) {
    try {
      if (storage && typeof storage.setItem === 'function') {
        storage.setItem(key, JSON.stringify(nextState));
      }
    } catch {
      // Live state remains authoritative when persistence is unavailable.
    }
  }

  function clearPersisted() {
    let removed = false;
    try {
      if (storage && typeof storage.removeItem === 'function') {
        storage.removeItem(key);
        removed = true;
      }
    } catch {
      removed = false;
    }
    if (!removed) persist(defaultState);
  }

  function emit(mode) {
    for (const listener of [...listeners]) {
      try {
        listener(state, mode);
      } catch {
        // A faulty observer cannot interrupt the performance state lane.
      }
    }
  }

  function replaceMode(modeKey, nextSettings) {
    const current = state.modes[modeKey];
    if (settingsEqual(current, nextSettings)) return current;
    state = freezeState(schema.version, { ...state.modes, [modeKey]: nextSettings });
    persist(state);
    emit(Number(modeKey));
    return nextSettings;
  }

  function getState() {
    return state;
  }

  function getModeSettings(mode) {
    const modeKey = modeKeyFor(mode);
    return modeKey ? state.modes[modeKey] : null;
  }

  function configure(mode, patch = {}) {
    const modeKey = modeKeyFor(mode);
    if (destroyed || !modeKey || !isRecord(patch)) return modeKey ? state.modes[modeKey] : null;

    const filteredPatch = {};
    for (const patchKey of PATCH_KEYS) {
      if (Object.hasOwn(patch, patchKey)) filteredPatch[patchKey] = patch[patchKey];
    }
    if (Object.keys(filteredPatch).length === 0) return state.modes[modeKey];

    const current = state.modes[modeKey];
    const candidate = normalizeWithSchema(
      { ...current, ...filteredPatch, preset: current.preset },
      current,
      schema,
    );
    if (materialSettingsEqual(current, candidate)) return current;

    const custom = normalizeWithSchema({ ...candidate, preset: 'custom' }, current, schema);
    return replaceMode(modeKey, custom);
  }

  function applyPreset(mode, presetName) {
    const modeKey = modeKeyFor(mode);
    if (destroyed || !modeKey) return modeKey ? state.modes[modeKey] : null;
    if (!presetNames.has(presetName)) return state.modes[modeKey];
    const preset = isRecord(schema.scene.presets[presetName])
      ? schema.scene.presets[presetName]
      : {};
    const next = normalizeWithSchema(
      { ...preset, preset: presetName },
      { ...preset, preset: presetName },
      schema,
    );
    return replaceMode(modeKey, next);
  }

  function resetMode(mode) {
    const modeKey = modeKeyFor(mode);
    if (destroyed || !modeKey) return modeKey ? state.modes[modeKey] : null;
    return replaceMode(modeKey, defaults[modeKey]);
  }

  function reset() {
    if (destroyed) return state;
    const changed = schema.modes.some((mode) => (
      !settingsEqual(state.modes[String(mode)], defaults[String(mode)])
    ));
    state = defaultState;
    clearPersisted();
    if (changed) emit(null);
    return state;
  }

  function subscribe(listener) {
    if (destroyed || typeof listener !== 'function') return () => {};
    listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      listeners.delete(listener);
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    listeners.clear();
  }

  return Object.freeze({
    getState,
    getModeSettings,
    configure,
    applyPreset,
    resetMode,
    reset,
    subscribe,
    destroy,
  });
}
