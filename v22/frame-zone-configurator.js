const SOURCES = Object.freeze(['objects', 'body', 'hybrid']);

const FALLBACKS = Object.freeze({
  source: 'hybrid',
  objectClass: '',
  minOverlap: 0.18,
  dwellMs: 520,
  lossHoldMs: 320,
  cooldownMs: 480,
});

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function bounded(value, fallback, min, max) {
  return Math.min(max, Math.max(min, finite(value, fallback)));
}

function cleanText(value, fallback = '', maximum = 64) {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maximum);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeFrameZoneSettings(input = {}, defaults = FALLBACKS) {
  const base = isRecord(defaults) ? defaults : FALLBACKS;
  const patch = isRecord(input) ? input : {};
  const source = SOURCES.includes(patch.source)
    ? patch.source
    : SOURCES.includes(base.source) ? base.source : FALLBACKS.source;
  return Object.freeze({
    source,
    objectClass: cleanText(patch.objectClass, cleanText(base.objectClass)),
    minOverlap: bounded(patch.minOverlap, finite(base.minOverlap, FALLBACKS.minOverlap), 0, 1),
    dwellMs: Math.round(bounded(patch.dwellMs, finite(base.dwellMs, FALLBACKS.dwellMs), 0, 10_000)),
    lossHoldMs: Math.round(bounded(patch.lossHoldMs, finite(base.lossHoldMs, FALLBACKS.lossHoldMs), 0, 5_000)),
    cooldownMs: Math.round(bounded(patch.cooldownMs, finite(base.cooldownMs, FALLBACKS.cooldownMs), 0, 10_000)),
  });
}

function equal(a, b) {
  return a.source === b.source
    && a.objectClass === b.objectClass
    && a.minOverlap === b.minOverlap
    && a.dwellMs === b.dwellMs
    && a.lossHoldMs === b.lossHoldMs
    && a.cooldownMs === b.cooldownMs;
}

export function createFrameZoneConfigurator(options = {}) {
  const defaults = normalizeFrameZoneSettings(options.defaults);
  const storage = options.storage;
  const storageKey = typeof options.storageKey === 'string' && options.storageKey.trim()
    ? options.storageKey.trim()
    : 'mythtrace.v22.frame-zones.v1';
  const listeners = new Set();
  let state = defaults;
  let destroyed = false;

  try {
    const serialized = storage?.getItem?.(storageKey);
    if (typeof serialized === 'string' && serialized.length) {
      const restored = JSON.parse(serialized);
      if (isRecord(restored)) state = normalizeFrameZoneSettings(restored, defaults);
    }
  } catch {
    state = defaults;
  }

  function persist(next) {
    try {
      storage?.setItem?.(storageKey, JSON.stringify(next));
    } catch {
      // In-memory settings remain live when storage is unavailable.
    }
  }

  function emit() {
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch {
        // Subscribers are isolated from one another.
      }
    }
  }

  function configure(patch = {}) {
    if (destroyed || !isRecord(patch)) return state;
    const next = normalizeFrameZoneSettings(patch, state);
    if (equal(next, state)) return state;
    state = next;
    persist(state);
    emit();
    return state;
  }

  function reset() {
    if (destroyed) return state;
    const changed = !equal(state, defaults);
    state = defaults;
    try {
      storage?.removeItem?.(storageKey);
    } catch {
      persist(defaults);
    }
    if (changed) emit();
    return state;
  }

  function subscribe(listener) {
    if (destroyed || typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getState() {
    return state;
  }

  function destroy() {
    destroyed = true;
    listeners.clear();
  }

  return Object.freeze({ getState, configure, reset, subscribe, destroy });
}
