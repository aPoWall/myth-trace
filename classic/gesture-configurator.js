import { CONFIG } from './config.js';

const KEYS = Object.freeze([
  'minArea',
  'stableHoldMs',
  'freezeMs',
  'fadeMs',
  'offMs',
  'restoreMs',
  'motionStill',
  'motionActivate',
]);

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function bounded(value, fallback, range) {
  return Math.min(range[1], Math.max(range[0], finite(value, fallback)));
}

function validRule(value) {
  return value === 'hold-or-raised' ? value : 'hold';
}

export function normalizeGestureSettings(input = {}, fallback = CONFIG.gestureFrame) {
  const limits = CONFIG.gestureFrame.controlLimits;
  const next = {
    version: 1,
    confirmationRule: validRule(input.confirmationRule ?? fallback.confirmationRule),
  };
  for (const key of KEYS) {
    next[key] = bounded(input[key], fallback[key], limits[key]);
  }
  next.stableHoldMs = Math.round(next.stableHoldMs);
  next.freezeMs = Math.round(next.freezeMs);
  next.fadeMs = Math.max(next.freezeMs, Math.round(next.fadeMs));
  next.offMs = Math.max(next.fadeMs, Math.round(next.offMs));
  next.restoreMs = Math.round(next.restoreMs);
  next.motionActivate = Math.max(next.motionStill, next.motionActivate);
  return Object.freeze(next);
}

function equal(a, b) {
  if (a.confirmationRule !== b.confirmationRule) return false;
  for (const key of KEYS) if (a[key] !== b[key]) return false;
  return true;
}

export function createGestureConfigurator(options = {}) {
  const defaults = normalizeGestureSettings(options.defaults || CONFIG.gestureFrame);
  const storage = options.storage;
  const storageKey = String(options.storageKey || CONFIG.gestureFrame.storageKey);
  const listeners = new Set();
  let state = defaults;
  let destroyed = false;

  try {
    const raw = storage?.getItem?.(storageKey);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      state = normalizeGestureSettings(parsed, defaults);
    }
  } catch {
    state = defaults;
  }

  function persist() {
    try { storage?.setItem?.(storageKey, JSON.stringify(state)); } catch { /* memory stays live */ }
  }

  function emit() {
    for (const listener of [...listeners]) {
      try { listener(state); } catch { /* subscribers are isolated */ }
    }
  }

  function getState() { return state; }

  function configure(patch = {}) {
    if (destroyed || !patch || typeof patch !== 'object' || Array.isArray(patch)) return state;
    const next = normalizeGestureSettings(patch, state);
    if (equal(state, next)) return state;
    state = next;
    persist();
    emit();
    return state;
  }

  function reset() {
    if (destroyed) return state;
    const changed = !equal(state, defaults);
    state = defaults;
    try { storage?.removeItem?.(storageKey); } catch { persist(); }
    if (changed) emit();
    return state;
  }

  function subscribe(listener) {
    if (destroyed || typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function destroy() {
    destroyed = true;
    listeners.clear();
  }

  return Object.freeze({ getState, configure, reset, subscribe, destroy });
}
