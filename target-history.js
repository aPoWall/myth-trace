const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

function hasBox(box) {
  const width = Number(box?.w ?? box?.width);
  const height = Number(box?.h ?? box?.height);
  return Number.isFinite(box?.x) && Number.isFinite(box?.y)
    && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

function isEligible(anchor, minConfidence) {
  const id = String(anchor?.id || '');
  const kind = String(anchor?.kind || 'anchor');
  const confidence = clamp01(anchor?.confidence ?? anchor?.strength);
  return Boolean(id && kind !== 'pointer' && confidence >= minConfidence);
}

function updateEntry(entry, anchor, timestamp) {
  entry.kind = String(anchor.kind || 'anchor');
  entry.label = String(anchor.label || anchor.kind || 'anchor');
  entry.x = clamp01(anchor.x);
  entry.y = clamp01(anchor.y);
  entry.confidence = clamp01(anchor.confidence ?? anchor.strength);
  entry.lastSeenAt = timestamp;
  entry.visible = true;
  if (hasBox(anchor.bbox)) {
    entry.bbox ||= { x: 0, y: 0, w: 0, h: 0 };
    entry.bbox.x = clamp01(anchor.bbox.x);
    entry.bbox.y = clamp01(anchor.bbox.y);
    entry.bbox.w = clamp01(anchor.bbox.w ?? anchor.bbox.width);
    entry.bbox.h = clamp01(anchor.bbox.h ?? anchor.bbox.height);
  } else {
    entry.bbox = null;
  }
  return entry;
}

export function createTargetHistory({ capacity = 8, holdMs = 650, minConfidence = 0.28 } = {}) {
  const limit = Math.max(1, Math.floor(Number(capacity) || 8));
  const hold = Math.max(0, Number(holdMs) || 0);
  const threshold = clamp01(minConfidence);
  const entries = [];
  const state = {
    count: 0, index: 0, selectedId: '', kind: '', label: '', confidence: 0,
    phase: 'empty', locked: false, ageMs: 0,
  };
  let selectedId = '';
  let lastTimestamp = 0;

  function find(id) {
    for (let index = 0; index < entries.length; index += 1) {
      if (entries[index].id === id) return entries[index];
    }
    return null;
  }

  function refreshState(timestamp = lastTimestamp) {
    lastTimestamp = Number.isFinite(timestamp) ? timestamp : lastTimestamp;
    const selected = selectedId ? find(selectedId) : null;
    state.count = entries.length;
    state.index = selected ? entries.indexOf(selected) + 1 : 0;
    state.selectedId = selected?.id || '';
    state.kind = selected?.kind || '';
    state.label = selected?.label || '';
    state.confidence = selected?.confidence || 0;
    state.locked = Boolean(selected);
    state.ageMs = selected ? Math.max(0, lastTimestamp - selected.lastSeenAt) : 0;
    state.phase = !entries.length ? 'empty'
      : !selected ? 'idle'
        : selected.visible ? 'live'
          : state.ageMs <= hold ? 'held' : 'lost';
    return state;
  }

  function observe(anchors = [], timestamp = lastTimestamp) {
    lastTimestamp = Number.isFinite(timestamp) ? timestamp : lastTimestamp;
    for (const entry of entries) entry.visible = false;
    for (const anchor of anchors) {
      if (!isEligible(anchor, threshold)) continue;
      const entry = find(String(anchor.id));
      if (entry) updateEntry(entry, anchor, lastTimestamp);
    }
    return refreshState(lastTimestamp);
  }

  function select(anchor, timestamp = lastTimestamp) {
    if (!isEligible(anchor, threshold)) return refreshState(timestamp);
    lastTimestamp = Number.isFinite(timestamp) ? timestamp : lastTimestamp;
    const id = String(anchor.id);
    let entry = find(id);
    if (!entry) {
      entry = {
        id, kind: 'anchor', label: 'anchor', x: 0.5, y: 0.5, confidence: 0,
        bbox: null, lastSeenAt: lastTimestamp, visible: true,
      };
      entries.push(entry);
      if (entries.length > limit) entries.shift();
    }
    updateEntry(entry, anchor, lastTimestamp);
    selectedId = id;
    return refreshState(lastTimestamp);
  }

  function cycle(direction = 1, timestamp = lastTimestamp) {
    lastTimestamp = Number.isFinite(timestamp) ? timestamp : lastTimestamp;
    if (!entries.length) return refreshState(lastTimestamp);
    const step = Math.sign(Number(direction) || 1);
    const current = Math.max(0, entries.findIndex((entry) => entry.id === selectedId));
    const next = selectedId
      ? (current + step + entries.length) % entries.length
      : step < 0 ? entries.length - 1 : 0;
    selectedId = entries[next].id;
    return refreshState(lastTimestamp);
  }

  function clearSelection(timestamp = lastTimestamp) {
    selectedId = '';
    return refreshState(timestamp);
  }

  function resolve(timestamp = lastTimestamp) {
    const current = refreshState(timestamp);
    if (!current.locked || current.phase === 'lost') return null;
    return find(current.selectedId);
  }

  function clear(timestamp = lastTimestamp) {
    entries.length = 0;
    selectedId = '';
    return refreshState(timestamp);
  }

  return Object.freeze({ observe, select, cycle, clearSelection, resolve, getState: refreshState, clear });
}
