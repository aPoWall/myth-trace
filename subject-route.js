function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function validBox(box) {
  const width = Number(box?.w ?? box?.width);
  const height = Number(box?.h ?? box?.height);
  return Number.isFinite(box?.x) && Number.isFinite(box?.y)
    && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

function routeOwner(kind) {
  if (kind === 'fingertip' || kind === 'palm' || kind === 'hand') return 'hands';
  if (kind === 'face') return 'face';
  if (kind === 'person' || kind === 'body' || kind === 'joint' || kind === 'pose') return 'body';
  if (kind === 'object') return 'objects';
  return '';
}

function objectMuted(subject, route) {
  const classes = Array.isArray(route?.classes) ? route.classes : [];
  const label = String(subject?.label || '').trim().toLowerCase();
  return Boolean(label && classes.includes(label));
}

export function createSubjectRoute({
  smoothingMs = 90,
  intervalMs = 1000 / 30,
  idleSnap = 0.001,
} = {}) {
  const smoothing = Math.max(1, finite(smoothingMs, 90));
  const interval = Math.max(1, finite(intervalMs, 1000 / 30));
  const snap = Math.max(0, finite(idleSnap, 0.001));
  const bbox = { x: 0, y: 0, w: 0, h: 0 };
  const state = {
    active: false,
    source: 'none',
    id: '',
    kind: '',
    label: '',
    owner: '',
    phase: 'idle',
    confidence: 0,
    value: 0,
    visual: 0,
    sound: 0,
    bbox,
    updatedAt: 0,
  };
  let lastTimestamp = null;
  let lastRangeAt = -Infinity;

  function zero(timestamp = lastTimestamp || 0) {
    state.active = false;
    state.source = 'none';
    state.id = '';
    state.kind = '';
    state.label = '';
    state.owner = '';
    state.phase = 'idle';
    state.confidence = 0;
    state.value = 0;
    state.visual = 0;
    state.sound = 0;
    bbox.x = 0;
    bbox.y = 0;
    bbox.w = 0;
    bbox.h = 0;
    state.updatedAt = finite(timestamp, 0);
    lastRangeAt = -Infinity;
    return state;
  }

  function copyBox(source, x, y) {
    if (validBox(source)) {
      bbox.x = clamp(source.x);
      bbox.y = clamp(source.y);
      bbox.w = clamp(source.w ?? source.width, 0, 1 - bbox.x);
      bbox.h = clamp(source.h ?? source.height, 0, 1 - bbox.y);
      return;
    }
    const radius = 0.055;
    bbox.x = clamp(x - radius, 0, 1 - radius * 2);
    bbox.y = clamp(y - radius, 0, 1 - radius * 2);
    bbox.w = radius * 2;
    bbox.h = radius * 2;
  }

  function update({
    timestamp = 0,
    enabled = true,
    subject = null,
    entitySettings = null,
    frameObjectCrop = null,
    frameContent = null,
  } = {}) {
    const now = Math.max(0, finite(timestamp, lastTimestamp || 0));
    if (lastTimestamp !== null && now < lastTimestamp) zero(now);
    const elapsed = lastTimestamp === null ? interval : Math.max(0, now - lastTimestamp);
    lastTimestamp = now;
    if (!enabled) return zero(now);

    let source = 'none';
    let id = '';
    let kind = '';
    let label = '';
    let owner = '';
    let phase = 'idle';
    let confidence = 0;
    let x = 0.5;
    let y = 0.5;
    let sourceBox = null;
    let route = null;

    if (subject?.locked) {
      if (subject.active && subject.kind !== 'pointer') {
        owner = routeOwner(String(subject.kind || ''));
        route = entitySettings?.settings?.[owner] ?? entitySettings?.[owner] ?? null;
        if (owner && route && route.enabled !== false && !objectMuted(subject, route)) {
          source = 'subject';
          id = String(subject.id || '');
          kind = String(subject.kind || 'anchor');
          label = String(subject.label || kind);
          phase = String(subject.phase || 'live');
          confidence = clamp(subject.confidence);
          x = clamp(finite(subject.x, 0.5));
          y = clamp(finite(subject.y, 0.5));
          sourceBox = subject.bbox;
        }
      }
    } else if (
      frameContent?.focusSource === 'roi'
      && frameObjectCrop?.active
      && frameObjectCrop?.sourceKind === 'roi'
      && clamp(frameObjectCrop?.score) > 0
    ) {
      source = 'roi';
      id = String(frameObjectCrop.featureId || frameObjectCrop.objectId || 'roi:hand-frame');
      kind = 'roi';
      label = 'author ROI';
      owner = 'frame';
      phase = String(frameObjectCrop.featurePhase || (frameObjectCrop.held ? 'held' : 'live'));
      confidence = clamp(frameObjectCrop.score);
      sourceBox = frameObjectCrop.displayBBox || frameObjectCrop.bbox;
      x = clamp(finite(sourceBox?.x, 0.5) + finite(sourceBox?.w ?? sourceBox?.width) * 0.5);
      y = clamp(finite(sourceBox?.y, 0.5) + finite(sourceBox?.h ?? sourceBox?.height) * 0.5);
      route = { enabled: true, overlay: frameContent.visualRoute, sound: frameContent.soundRoute };
    }

    if (source === 'none' || !id || confidence <= snap) return zero(now);

    const targetValue = clamp(1 - y);
    if (now - lastRangeAt >= interval) {
      const alpha = state.active && state.id === id
        ? 1 - Math.exp(-Math.max(elapsed, interval) / smoothing)
        : 1;
      state.value += (targetValue - state.value) * alpha;
      if (Math.abs(state.value) <= snap) state.value = 0;
      lastRangeAt = now;
    }
    state.active = true;
    state.source = source;
    state.id = id;
    state.kind = kind;
    state.label = label;
    state.owner = owner;
    state.phase = phase;
    state.confidence = confidence;
    state.visual = clamp(route?.overlay) * confidence;
    state.sound = clamp(route?.sound) * confidence;
    if (state.visual <= snap) state.visual = 0;
    if (state.sound <= snap) state.sound = 0;
    copyBox(sourceBox, x, y);
    state.updatedAt = now;
    return state;
  }

  return Object.freeze({ update, reset: zero, getState: () => state });
}
