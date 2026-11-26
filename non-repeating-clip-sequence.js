function normalizeIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))].sort();
}

function normalizeOrder(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(ids, seed, cycle, lastClipId) {
  const order = [...ids];
  const random = createRandom((seed ^ hashText(ids.join('\u001f')) ^ Math.imul(cycle + 1, 0x9e3779b1)) >>> 0);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [order[index], order[target]] = [order[target], order[index]];
  }
  if (order.length > 1 && order[0] === lastClipId) {
    const swapIndex = 1 + Math.floor(random() * (order.length - 1));
    [order[0], order[swapIndex]] = [order[swapIndex], order[0]];
  }
  return order;
}

export function createNonRepeatingClipSequence({ storage, config }) {
  const settings = config?.samplerSequence;
  if (!settings || typeof settings !== 'object') throw new TypeError('config.samplerSequence is required');
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new TypeError('sampler sequence storage is required');
  }
  const schemaVersion = Math.trunc(Number(settings.schemaVersion));
  const seed = Math.trunc(Number(settings.seed)) >>> 0;
  if (schemaVersion < 1) throw new TypeError('sampler sequence schemaVersion must be positive');

  let enabled = Boolean(settings.defaultEnabled);
  let signature = '';
  let order = [];
  let cursor = 0;
  let cycle = 0;
  let lastClipId = '';
  let persisted = true;

  try {
    const raw = JSON.parse(storage.getItem(settings.storageKey) || 'null');
    if (raw?.version === schemaVersion) {
      enabled = Boolean(raw.enabled);
      signature = String(raw.signature || '');
      order = normalizeOrder(raw.order);
      cursor = Math.min(order.length, Math.max(0, Math.trunc(Number(raw.cursor)) || 0));
      cycle = Math.max(0, Math.trunc(Number(raw.cycle)) || 0);
      lastClipId = String(raw.lastClipId || '');
    }
  } catch {
    persisted = false;
  }

  function write() {
    try {
      storage.setItem(settings.storageKey, JSON.stringify({
        version: schemaVersion, enabled, signature, order, cursor, cycle, lastClipId,
      }));
      persisted = true;
    } catch {
      persisted = false;
    }
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    write();
    return getState();
  }

  function reset(ids = []) {
    const normalized = normalizeIds(ids);
    signature = normalized.join('\u001f');
    order = [];
    cursor = 0;
    cycle = 0;
    lastClipId = '';
    write();
    return getState();
  }

  function next(ids, fallbackId = '') {
    const normalized = normalizeIds(ids);
    const nextSignature = normalized.join('\u001f');
    const fallback = String(fallbackId || '');
    if (!enabled || normalized.length < 2) {
      return Object.freeze({ clipId: fallback, source: 'mapped', state: getState() });
    }
    if (signature !== nextSignature || order.some((id) => !normalized.includes(id)) || order.length !== normalized.length) {
      signature = nextSignature;
      order = [];
      cursor = 0;
      cycle = 0;
      lastClipId = '';
    }
    if (cursor >= order.length) {
      order = shuffle(normalized, seed, cycle, lastClipId);
      cursor = 0;
      cycle += 1;
    }
    const clipId = order[cursor] || fallback;
    cursor += 1;
    lastClipId = clipId;
    write();
    return Object.freeze({ clipId, source: 'sequence', state: getState() });
  }

  function getState() {
    return Object.freeze({
      enabled, signature, order: Object.freeze([...order]), cursor, cycle, lastClipId, persisted,
      remaining: Math.max(0, order.length - cursor),
    });
  }

  return Object.freeze({ setEnabled, reset, next, getState });
}
