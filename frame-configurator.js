import { CONFIG } from './config.js';
import { normalizeFrameContentSettings } from './frame-content.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeSettingsInput(value) {
  if (!isRecord(value)) return {};
  if (value.exerciseRule === undefined || isRecord(value.exerciseRule)) return value;
  const safe = { ...value };
  delete safe.exerciseRule;
  return safe;
}

export function normalizeFrameConfiguratorState(input = {}, defaults = CONFIG.frameContent) {
  const normalizedDefaults = normalizeFrameContentSettings(
    safeSettingsInput(defaults),
    CONFIG.frameContent,
  );
  return normalizeFrameContentSettings(safeSettingsInput(input), normalizedDefaults);
}

function statesEqual(a, b) {
  return a === b || (
    a.version === b.version
    && a.mode === b.mode
    && a.prompt === b.prompt
    && a.seed === b.seed
    && a.intensity === b.intensity
    && a.fit === b.fit
    && a.cameraLayer === b.cameraLayer
    && a.stageFill === b.stageFill
    && a.objectClass === b.objectClass
    && a.focalPolicy === b.focalPolicy
    && a.focusSource === b.focusSource
    && a.focusDetail === b.focusDetail
    && a.focus.edgeScale === b.focus.edgeScale
    && a.focus.edgeOffset === b.focus.edgeOffset
    && a.focus.bracketAlpha === b.focus.bracketAlpha
    && a.visualRoute === b.visualRoute
    && a.soundRoute === b.soundRoute
    && a.exerciseRule.source === b.exerciseRule.source
    && a.exerciseRule.target === b.exerciseRule.target
    && a.exerciseRule.tolerance === b.exerciseRule.tolerance
    && a.exerciseRule.holdMs === b.exerciseRule.holdMs
  );
}

export function createFrameConfigurator(options = {}) {
  const defaults = normalizeFrameConfiguratorState(options.defaults);
  const storage = options.storage;
  const storageKey = typeof options.storageKey === 'string' && options.storageKey.trim()
    ? options.storageKey.trim()
    : CONFIG.frameContent.storageKey;
  const listeners = new Set();
  let state = defaults;
  let destroyed = false;

  if (typeof options.onChange === 'function') listeners.add(options.onChange);

  try {
    if (storage && typeof storage.getItem === 'function') {
      const serialized = storage.getItem(storageKey);
      if (typeof serialized === 'string' && serialized.length > 0) {
        const restored = JSON.parse(serialized);
        if (isRecord(restored)) state = normalizeFrameConfiguratorState(restored, defaults);
      }
    }
  } catch {
    state = defaults;
  }

  function persist(nextState) {
    try {
      if (storage && typeof storage.setItem === 'function') {
        storage.setItem(storageKey, JSON.stringify(nextState));
      }
    } catch {
      // In-memory state remains authoritative when persistence is unavailable.
    }
  }

  function clearPersisted() {
    let removed = false;
    try {
      if (storage && typeof storage.removeItem === 'function') {
        storage.removeItem(storageKey);
        removed = true;
      }
    } catch {
      removed = false;
    }
    if (!removed) persist(defaults);
  }

  function emit() {
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch {
        // One subscriber cannot prevent other subscribers from receiving state.
      }
    }
  }

  function getState() {
    return state;
  }

  function configure(patch = {}, save = true) {
    if (destroyed || !isRecord(patch)) return state;
    const exerciseRule = isRecord(patch.exerciseRule)
      ? { ...state.exerciseRule, ...patch.exerciseRule }
      : state.exerciseRule;
    const nextState = normalizeFrameConfiguratorState({ ...patch, exerciseRule }, state);
    if (statesEqual(state, nextState)) return state;
    state = nextState;
    if (save) persist(state);
    emit();
    return state;
  }

  function reset() {
    if (destroyed) return state;
    const changed = !statesEqual(state, defaults);
    state = defaults;
    clearPersisted();
    if (changed) emit();
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

  return Object.freeze({ getState, configure, reset, subscribe, destroy });
}
