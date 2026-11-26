const DEFAULTS = Object.freeze({
  zoneId: 'gesture-frame',
  maxEntities: 16,
  maxEvents: 32,
  dwellMs: 600,
  cooldownMs: 240,
  lossHoldMs: 420,
  overlapThreshold: 0.18,
  overlapExitThreshold: 0.12,
  minObjectScore: 0.42,
  minBodyScore: 0.45,
  matchMode: 'point-or-overlap',
});

const MATCH_MODES = new Set(['point', 'overlap', 'point-or-overlap']);
const SOURCE_NAMES = Object.freeze(['object', 'body']);
const EPSILON = 1e-8;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function boundedInteger(value, fallback, min, max) {
  return Math.round(clamp(finite(value, fallback), min, max));
}

function normalizedText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeSourceName(value) {
  const source = String(value ?? '').trim().toLowerCase();
  if (source === 'objects') return 'object';
  if (source === 'bodies' || source === 'pose' || source === 'poses' || source === 'person') return 'body';
  return SOURCE_NAMES.includes(source) ? source : '';
}

function normalizeSources(value, fallback = null) {
  const result = { object: true, body: true };
  if (fallback) {
    result.object = fallback.object !== false;
    result.body = fallback.body !== false;
  }
  if (value === undefined || value === null) return result;
  result.object = false;
  result.body = false;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const source = normalizeSourceName(entry);
      if (source) result[source] = true;
    }
    return result;
  }
  if (typeof value === 'string') {
    const source = normalizeSourceName(value);
    if (source) result[source] = true;
    return result;
  }
  if (typeof value === 'object') {
    result.object = value.object === true || value.objects === true;
    result.body = value.body === true || value.bodies === true || value.pose === true || value.poses === true;
  }
  return result;
}

function normalizeClasses(value, fallback = []) {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string' ? value.split(',') : fallback;
  const classes = [];
  for (const entry of source) {
    const label = String(entry ?? '').trim().toLowerCase();
    if (label && !classes.includes(label)) classes.push(label);
  }
  return classes;
}

function sourcesFromSetting(value, fallback = null) {
  if (value === 'hybrid') return { object: true, body: true };
  if (value === 'objects' || value === 'object') return { object: true, body: false };
  if (value === 'body' || value === 'bodies') return { object: false, body: true };
  return normalizeSources(value, fallback);
}

function sourceSetting(sources) {
  if (sources.object && sources.body) return 'hybrid';
  if (sources.object) return 'objects';
  return 'body';
}

function readInitialSettings(options) {
  const root = options?.config || {};
  const direct = options?.settings || options || {};
  const zone = root.frameZoneEvents || root.frameZones || direct.frameZoneEvents || direct.frameZones || direct;
  const tracking = root.tracking || direct.tracking || {};
  const gesture = root.gestureFrame || direct.gestureFrame || {};
  const content = root.frameContent || direct.frameContent || {};
  const overlapThreshold = clamp(zone.minOverlap ?? zone.overlapThreshold ?? DEFAULTS.overlapThreshold);
  const sources = sourcesFromSetting(zone.source ?? zone.sources);
  const classes = normalizeClasses(zone.objectClass ?? zone.classes);
  return {
    zoneId: normalizedText(zone.zoneId, DEFAULTS.zoneId).slice(0, 80),
    maxEntities: boundedInteger(zone.maxEntities, DEFAULTS.maxEntities, 1, 128),
    maxEvents: boundedInteger(zone.maxEvents, DEFAULTS.maxEvents, 1, 256),
    dwellMs: clamp(zone.dwellMs ?? content.exerciseRule?.holdMs ?? DEFAULTS.dwellMs, 0, 60_000),
    cooldownMs: clamp(zone.cooldownMs ?? content.eventCooldownMs ?? DEFAULTS.cooldownMs, 0, 60_000),
    lossHoldMs: clamp(zone.lossHoldMs ?? gesture.lossHoldMs ?? tracking.lostHoldMs ?? DEFAULTS.lossHoldMs, 0, 60_000),
    overlapThreshold,
    overlapExitThreshold: clamp(
      zone.overlapExitThreshold ?? Math.min(DEFAULTS.overlapExitThreshold, overlapThreshold),
      0,
      overlapThreshold,
    ),
    minObjectScore: clamp(zone.minObjectScore ?? tracking.minObjectScore ?? DEFAULTS.minObjectScore),
    minBodyScore: clamp(zone.minBodyScore ?? tracking.minPoseScore ?? DEFAULTS.minBodyScore),
    matchMode: MATCH_MODES.has(zone.matchMode) ? zone.matchMode : DEFAULTS.matchMode,
    source: sourceSetting(sources),
    objectClass: classes[0] || '',
    minOverlap: overlapThreshold,
    sources,
    classes,
  };
}

function applySettingsPatch(settings, patch = {}) {
  if (patch.zoneId !== undefined) settings.zoneId = normalizedText(patch.zoneId, settings.zoneId).slice(0, 80);
  if (patch.dwellMs !== undefined) settings.dwellMs = clamp(patch.dwellMs, 0, 60_000);
  if (patch.cooldownMs !== undefined) settings.cooldownMs = clamp(patch.cooldownMs, 0, 60_000);
  if (patch.lossHoldMs !== undefined) settings.lossHoldMs = clamp(patch.lossHoldMs, 0, 60_000);
  if (patch.overlapThreshold !== undefined) {
    settings.overlapThreshold = clamp(patch.overlapThreshold);
    settings.overlapExitThreshold = Math.min(settings.overlapExitThreshold, settings.overlapThreshold);
    settings.minOverlap = settings.overlapThreshold;
  }
  if (patch.minOverlap !== undefined) {
    settings.overlapThreshold = clamp(patch.minOverlap);
    settings.overlapExitThreshold = Math.min(settings.overlapExitThreshold, settings.overlapThreshold);
    settings.minOverlap = settings.overlapThreshold;
  }
  if (patch.overlapExitThreshold !== undefined) {
    settings.overlapExitThreshold = clamp(patch.overlapExitThreshold, 0, settings.overlapThreshold);
  }
  if (patch.minObjectScore !== undefined) settings.minObjectScore = clamp(patch.minObjectScore);
  if (patch.minBodyScore !== undefined) settings.minBodyScore = clamp(patch.minBodyScore);
  if (MATCH_MODES.has(patch.matchMode)) settings.matchMode = patch.matchMode;
  if (patch.source !== undefined || patch.sources !== undefined) {
    settings.sources = sourcesFromSetting(patch.source ?? patch.sources, settings.sources);
    settings.source = sourceSetting(settings.sources);
  }
  if (patch.objectClass !== undefined || patch.classes !== undefined) {
    settings.classes = normalizeClasses(patch.objectClass ?? patch.classes, settings.classes);
    settings.objectClass = settings.classes[0] || '';
  }
}

function makePoint() {
  return { x: 0, y: 0 };
}

function makeBox() {
  return { x: 0, y: 0, w: 0, h: 0 };
}

function clearBox(box) {
  box.x = 0;
  box.y = 0;
  box.w = 0;
  box.h = 0;
}

function writeBox(target, source) {
  target.x = clamp(source?.x);
  target.y = clamp(source?.y);
  target.w = clamp(source?.w ?? source?.width);
  target.h = clamp(source?.h ?? source?.height);
  if (target.x + target.w > 1) target.w = Math.max(0, 1 - target.x);
  if (target.y + target.h > 1) target.h = Math.max(0, 1 - target.y);
}

function validPoint(point) {
  return Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y));
}

function pointOnSegment(x, y, ax, ay, bx, by) {
  const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
  if (Math.abs(cross) > EPSILON) return false;
  const dot = (x - ax) * (bx - ax) + (y - ay) * (by - ay);
  if (dot < -EPSILON) return false;
  const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
  return dot <= lengthSquared + EPSILON;
}

function pointInQuad(x, y, quad) {
  let inside = false;
  for (let current = 0, previous = quad.length - 1; current < quad.length; previous = current, current += 1) {
    const a = quad[previous];
    const b = quad[current];
    if (pointOnSegment(x, y, a.x, a.y, b.x, b.y)) return true;
    const crosses = (a.y > y) !== (b.y > y)
      && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function polygonArea(buffer, count) {
  if (count < 3) return 0;
  let sum = 0;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    sum += buffer[index * 2] * buffer[next * 2 + 1] - buffer[next * 2] * buffer[index * 2 + 1];
  }
  return Math.abs(sum) * 0.5;
}

function quadArea(quad) {
  let sum = 0;
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4;
    sum += quad[index].x * quad[next].y - quad[next].x * quad[index].y;
  }
  return Math.abs(sum) * 0.5;
}

function insideBoundary(x, y, side, boundary) {
  if (side === 0) return x >= boundary;
  if (side === 1) return x <= boundary;
  if (side === 2) return y >= boundary;
  return y <= boundary;
}

function writeIntersection(output, offset, ax, ay, bx, by, side, boundary) {
  const horizontal = side < 2;
  const denominator = horizontal ? bx - ax : by - ay;
  const amount = Math.abs(denominator) <= EPSILON
    ? 0
    : (boundary - (horizontal ? ax : ay)) / denominator;
  output[offset] = horizontal ? boundary : ax + (bx - ax) * amount;
  output[offset + 1] = horizontal ? ay + (by - ay) * amount : boundary;
}

function clipBoundary(input, inputCount, output, side, boundary) {
  if (!inputCount) return 0;
  let outputCount = 0;
  let previousOffset = (inputCount - 1) * 2;
  let previousX = input[previousOffset];
  let previousY = input[previousOffset + 1];
  let previousInside = insideBoundary(previousX, previousY, side, boundary);
  for (let index = 0; index < inputCount; index += 1) {
    const offset = index * 2;
    const x = input[offset];
    const y = input[offset + 1];
    const currentInside = insideBoundary(x, y, side, boundary);
    if (currentInside !== previousInside) {
      writeIntersection(output, outputCount * 2, previousX, previousY, x, y, side, boundary);
      outputCount += 1;
    }
    if (currentInside) {
      output[outputCount * 2] = x;
      output[outputCount * 2 + 1] = y;
      outputCount += 1;
    }
    previousX = x;
    previousY = y;
    previousInside = currentInside;
  }
  return outputCount;
}

function quadBoxOverlapRatio(quad, box, scratchA, scratchB) {
  const boxArea = box.w * box.h;
  if (boxArea <= EPSILON) return 0;
  for (let index = 0; index < 4; index += 1) {
    scratchA[index * 2] = quad[index].x;
    scratchA[index * 2 + 1] = quad[index].y;
  }
  let input = scratchA;
  let output = scratchB;
  let count = 4;
  for (let side = 0; side < 4; side += 1) {
    const boundary = side === 0
      ? box.x
      : side === 1 ? box.x + box.w : side === 2 ? box.y : box.y + box.h;
    count = clipBoundary(input, count, output, side, boundary);
    const swap = input;
    input = output;
    output = swap;
    if (!count) return 0;
  }
  return clamp(polygonArea(input, count) / boxArea);
}

function copyQuad(target, source) {
  if (!Array.isArray(source) || source.length < 4) return false;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (let index = 0; index < 4; index += 1) {
    if (!validPoint(source[index])) return false;
    const x = clamp(source[index].x);
    const y = clamp(source[index].y);
    target.quad[index].x = x;
    target.quad[index].y = y;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  target.bbox.x = minX;
  target.bbox.y = minY;
  target.bbox.w = maxX - minX;
  target.bbox.h = maxY - minY;
  return quadArea(target.quad) > EPSILON;
}

function makeEvent() {
  return {
    type: '', ts: 0, zoneId: '', entityId: '', source: '', label: '',
    confidence: 0, overlap: 0, dwellMs: 0,
  };
}

function makeEntityView() {
  return {
    id: '', source: '', label: '', confidence: 0, inside: false,
    missing: false, overlap: 0, dwellProgress: 0, bbox: makeBox(),
  };
}

function makeState(key, source, id) {
  return {
    key,
    id,
    source,
    label: source === 'body' ? 'person' : '',
    confidence: 0,
    bbox: makeBox(),
    centerX: 0,
    centerY: 0,
    overlap: 0,
    inside: false,
    missing: false,
    enteredAt: null,
    lastSeenAt: null,
    dwellEmitted: false,
    seenToken: 0,
    lastEnterAt: -Infinity,
    lastLeaveAt: -Infinity,
    lastDwellAt: -Infinity,
  };
}

/**
 * Pure object/body zone detector for one committed two-hand frame.
 * `update()` reuses its output records. Consume events before the next update;
 * call `snapshot()` when retained diagnostics are required.
 */
export function createFrameZoneEvents(options = {}) {
  const settings = readInitialSettings(options);
  const states = new Map();
  const scratchA = new Float64Array(24);
  const scratchB = new Float64Array(24);
  const eventPool = Array.from({ length: settings.maxEvents }, makeEvent);
  const entityPool = Array.from({ length: settings.maxEntities }, makeEntityView);
  const events = [];
  const entities = [];
  const zone = {
    id: settings.zoneId,
    active: false,
    phase: 'searching',
    confidence: 0,
    quad: [makePoint(), makePoint(), makePoint(), makePoint()],
    bbox: makeBox(),
    memberCount: 0,
  };
  const zones = [];
  const output = {
    timestamp: 0,
    zoneCount: 0,
    zones,
    entityCount: 0,
    entities,
    eventCount: 0,
    events,
  };

  let destroyed = false;
  let frameToken = 0;
  let lastTimestamp = 0;
  let suspendedAt = null;

  function clearOutput(timestamp) {
    output.timestamp = timestamp;
    output.eventCount = 0;
    output.entityCount = 0;
    events.length = 0;
    entities.length = 0;
    zone.memberCount = 0;
  }

  function eventCooldown(state, type) {
    if (type === 'enter') return state.lastEnterAt;
    if (type === 'leave') return state.lastLeaveAt;
    return state.lastDwellAt;
  }

  function setEventCooldown(state, type, timestamp) {
    if (type === 'enter') state.lastEnterAt = timestamp;
    else if (type === 'leave') state.lastLeaveAt = timestamp;
    else state.lastDwellAt = timestamp;
  }

  function emit(type, state, timestamp, dwellDuration = 0) {
    if (timestamp - eventCooldown(state, type) < settings.cooldownMs) return false;
    if (output.eventCount >= eventPool.length) return false;
    const event = eventPool[output.eventCount];
    event.type = type;
    event.ts = timestamp;
    event.zoneId = zone.id;
    event.entityId = state.key;
    event.source = state.source;
    event.label = state.label;
    event.confidence = state.confidence;
    event.overlap = state.overlap;
    event.dwellMs = Math.max(0, dwellDuration);
    events[output.eventCount] = event;
    output.eventCount += 1;
    events.length = output.eventCount;
    setEventCooldown(state, type, timestamp);
    return true;
  }

  function classAllowed(source, label) {
    if (!settings.sources[source]) return false;
    if (source === 'body') return true;
    if (!settings.classes.length) return true;
    const normalized = String(label || (source === 'body' ? 'person' : '')).toLowerCase();
    return settings.classes.includes(normalized);
  }

  function stateAllowed(state) {
    return classAllowed(state.source, state.label);
  }

  function leaveAndDelete(state, timestamp) {
    if (state.inside) emit('leave', state, timestamp);
    states.delete(state.key);
  }

  function expireStates(timestamp) {
    for (const state of states.values()) {
      if (!stateAllowed(state) || state.lastSeenAt === null || timestamp - state.lastSeenAt > settings.lossHoldMs) {
        leaveAndDelete(state, timestamp);
      }
    }
  }

  function clearStates(timestamp, emitLeaves) {
    if (emitLeaves) {
      for (const state of states.values()) {
        if (state.inside) emit('leave', state, timestamp);
      }
    }
    states.clear();
  }

  function frameActive(frame) {
    const phase = String(frame?.phase || 'searching');
    zone.phase = phase;
    zone.confidence = clamp(frame?.confidence);
    zone.id = settings.zoneId;
    if (frame?.confirmed !== true || phase === 'searching' || phase === 'arming' || phase === 'off') return false;
    return copyQuad(zone, frame?.quad);
  }

  function frameSuspended(frame) {
    const phase = String(frame?.phase || 'searching');
    if (frame?.confirmed !== true || phase !== 'off') return false;
    zone.phase = phase;
    zone.confidence = clamp(frame?.confidence);
    zone.id = settings.zoneId;
    return copyQuad(zone, frame?.quad);
  }

  function resumeStates(timestamp) {
    if (suspendedAt === null) return;
    const pausedFor = Math.max(0, timestamp - suspendedAt);
    for (const state of states.values()) {
      if (state.enteredAt !== null) state.enteredAt += pausedFor;
      if (state.lastSeenAt !== null) state.lastSeenAt += pausedFor;
    }
    suspendedAt = null;
  }

  function findState(source, id) {
    const key = `${source}:${id}`;
    let state = states.get(key);
    if (state) return state;
    if (states.size >= settings.maxEntities) return null;
    state = makeState(key, source, id);
    states.set(key, state);
    return state;
  }

  function entityHit(state) {
    const pointHit = pointInQuad(state.centerX, state.centerY, zone.quad);
    const threshold = state.inside ? settings.overlapExitThreshold : settings.overlapThreshold;
    const overlapHit = state.overlap >= threshold;
    if (settings.matchMode === 'point') return pointHit;
    if (settings.matchMode === 'overlap') return overlapHit;
    return pointHit || overlapHit;
  }

  function updateOccupancy(state, timestamp) {
    const hit = entityHit(state);
    if (hit && !state.inside) {
      state.inside = true;
      state.enteredAt = timestamp;
      state.dwellEmitted = false;
      emit('enter', state, timestamp);
    } else if (!hit && state.inside) {
      state.inside = false;
      state.enteredAt = null;
      state.dwellEmitted = false;
      emit('leave', state, timestamp);
    }
    if (!state.inside || state.enteredAt === null || state.dwellEmitted) return;
    const held = Math.max(0, timestamp - state.enteredAt);
    if (held >= settings.dwellMs && emit('dwell', state, timestamp, held)) state.dwellEmitted = true;
  }

  function observe(source, entity, timestamp) {
    const id = normalizedText(entity?.id);
    if (!id) return;
    const label = source === 'body' ? 'person' : normalizedText(entity?.label, 'object').toLowerCase();
    const confidence = clamp(entity?.score);
    const minimum = source === 'body' ? settings.minBodyScore : settings.minObjectScore;
    if (confidence < minimum || !classAllowed(source, label)) return;
    const sourceBox = entity?.bbox;
    const center = source === 'body' && validPoint(entity?.center)
      ? entity.center
      : null;
    if (!sourceBox && !center) return;
    const state = findState(source, id);
    if (!state) return;
    state.seenToken = frameToken;
    state.lastSeenAt = timestamp;
    state.missing = false;
    state.label = label;
    state.confidence = confidence;
    if (sourceBox) writeBox(state.bbox, sourceBox);
    else clearBox(state.bbox);
    state.centerX = clamp(center?.x ?? state.bbox.x + state.bbox.w * 0.5);
    state.centerY = clamp(center?.y ?? state.bbox.y + state.bbox.h * 0.5);
    state.overlap = sourceBox
      ? quadBoxOverlapRatio(zone.quad, state.bbox, scratchA, scratchB)
      : 0;
    updateOccupancy(state, timestamp);
  }

  function publishEntities(timestamp) {
    let index = 0;
    for (const state of states.values()) {
      if (index >= entityPool.length) break;
      state.missing = state.seenToken !== frameToken;
      const view = entityPool[index];
      view.id = state.key;
      view.source = state.source;
      view.label = state.label;
      view.confidence = state.confidence;
      view.inside = state.inside;
      view.missing = state.missing;
      view.overlap = state.overlap;
      view.dwellProgress = state.inside && state.enteredAt !== null
        ? (settings.dwellMs <= 0 ? 1 : clamp((timestamp - state.enteredAt) / settings.dwellMs))
        : 0;
      view.bbox.x = state.bbox.x;
      view.bbox.y = state.bbox.y;
      view.bbox.w = state.bbox.w;
      view.bbox.h = state.bbox.h;
      entities[index] = view;
      if (state.inside) zone.memberCount += 1;
      index += 1;
    }
    output.entityCount = index;
    entities.length = index;
  }

  function update(input = {}) {
    const requested = input.timestamp ?? input.ts ?? input.tracking?.ts ?? input.gestureFrame?.ts;
    const timestamp = Math.max(lastTimestamp, finite(requested, lastTimestamp));
    lastTimestamp = timestamp;
    frameToken += 1;
    clearOutput(timestamp);
    if (destroyed) return output;
    if (input.settings || input.filter) applySettingsPatch(settings, input.settings || input.filter);

    const frame = input.gestureFrame || input.frame;
    if (frameSuspended(frame)) {
      if (suspendedAt === null) suspendedAt = timestamp;
      zone.active = false;
      zones[0] = zone;
      zones.length = 1;
      output.zoneCount = 1;
      publishEntities(suspendedAt);
      return output;
    }
    resumeStates(timestamp);
    zone.active = frameActive(frame);
    if (!zone.active) {
      output.zoneCount = 0;
      zones.length = 0;
      clearStates(timestamp, false);
      clearBox(zone.bbox);
      publishEntities(timestamp);
      return output;
    }

    expireStates(timestamp);

    zones[0] = zone;
    zones.length = 1;
    output.zoneCount = 1;
    const tracking = input.tracking || {};
    if (settings.sources.object) {
      const objects = Array.isArray(tracking.objects) ? tracking.objects : [];
      for (let index = 0; index < objects.length; index += 1) observe('object', objects[index], timestamp);
    }
    if (settings.sources.body) {
      const poses = Array.isArray(tracking.poses) ? tracking.poses : [];
      for (let index = 0; index < poses.length; index += 1) observe('body', poses[index], timestamp);
    }
    publishEntities(timestamp);
    return output;
  }

  function configure(patch = {}) {
    if (!destroyed) applySettingsPatch(settings, patch);
    return snapshot();
  }

  function snapshot() {
    return Object.freeze({
      destroyed,
      timestamp: output.timestamp,
      settings: Object.freeze({
        ...settings,
        sources: Object.freeze({ ...settings.sources }),
        classes: Object.freeze(settings.classes.slice()),
      }),
      zones: Object.freeze(zones.map((entry) => Object.freeze({
        id: entry.id,
        active: entry.active,
        phase: entry.phase,
        confidence: entry.confidence,
        quad: Object.freeze(entry.quad.map((point) => Object.freeze({ ...point }))),
        bbox: Object.freeze({ ...entry.bbox }),
        memberCount: entry.memberCount,
      }))),
      entities: Object.freeze(entities.map((entity) => Object.freeze({
        ...entity,
        bbox: Object.freeze({ ...entity.bbox }),
      }))),
      events: Object.freeze(events.map((event) => Object.freeze({ ...event }))),
    });
  }

  function reset(timestamp = 0) {
    const nextTimestamp = Math.max(0, finite(timestamp));
    clearOutput(nextTimestamp);
    states.clear();
    frameToken = 0;
    lastTimestamp = nextTimestamp;
    suspendedAt = null;
    zone.active = false;
    zone.phase = 'searching';
    zone.confidence = 0;
    zone.memberCount = 0;
    clearBox(zone.bbox);
    zones.length = 0;
    output.zoneCount = 0;
    return output;
  }

  function destroy() {
    if (destroyed) return;
    reset(lastTimestamp);
    destroyed = true;
  }

  return Object.freeze({ update, configure, snapshot, reset, destroy });
}
