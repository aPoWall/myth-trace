const GHOST_WIRE = 'ghost-wire';

function finiteUnit(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function finiteNonNegative(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function isGhostWirePatch(patch) {
  if (patch === null || typeof patch !== 'object') return false;
  if (patch.version !== 1 || patch.engine !== 'hydra' || patch.recipe !== GHOST_WIRE || patch.enabled !== true) {
    return false;
  }
  if (!Object.isFrozen(patch) || !Array.isArray(patch.axes) || !Array.isArray(patch.events)) return false;
  if (!Object.isFrozen(patch.axes) || !Object.isFrozen(patch.events)) return false;
  return patch.axes.every((axis) => Object.isFrozen(axis)
    && typeof axis?.id === 'string'
    && typeof axis.source === 'string'
    && typeof axis.metric === 'string'
    && Number.isFinite(axis.min)
    && Number.isFinite(axis.max)
    && axis.max > axis.min)
    && patch.events.every((event) => Object.isFrozen(event)
      && typeof event?.id === 'string'
      && typeof event.source === 'string'
      && typeof event.type === 'string');
}

function frozenScalarView(slot, keys) {
  const view = {};
  for (const key of keys) {
    Object.defineProperty(view, key, {
      enumerable: true,
      get: () => slot[key],
    });
  }
  return Object.freeze(view);
}

function findAxisValue(values, id) {
  if (!Array.isArray(values)) return 0;
  for (const value of values) {
    if (value?.id === id) return finiteUnit(value.value);
  }
  return 0;
}

export function createLocalPerformancePatchAdapter({ onFrame = () => {} } = {}) {
  const axisSlots = [];
  const eventSlots = [];
  let axisViews = Object.freeze([]);
  let eventViews = Object.freeze([]);
  let accepted = false;
  let suspended = true;
  let panicked = false;
  let destroyed = false;
  let timestamp = 0;
  let fps = 0;
  let axisCount = 0;
  let eventCount = 0;
  let state;

  function ensureState() {
    if (state) return state;
    state = Object.freeze({
      recipe: GHOST_WIRE,
      get active() { return accepted && !suspended && !panicked && !destroyed; },
      get suspended() { return suspended; },
      get panicked() { return panicked; },
      get destroyed() { return destroyed; },
      get timestamp() { return timestamp; },
      get fps() { return fps; },
      get axisCount() { return axisCount; },
      axes: axisViews,
      get eventCount() { return eventCount; },
      events: eventViews,
    });
    return state;
  }

  function emit() {
    try {
      onFrame(ensureState());
    } catch {
      // Presentation diagnostics never interrupt the projector frame loop.
    }
  }

  function clearEffect() {
    axisCount = 0;
    eventCount = 0;
    for (const axis of axisSlots) axis.value = 0;
    for (const event of eventSlots) event.value = 0;
  }

  function clearPatch() {
    axisSlots.length = 0;
    eventSlots.length = 0;
    axisViews = Object.freeze([]);
    eventViews = Object.freeze([]);
    state = null;
    timestamp = 0;
    fps = 0;
    axisCount = 0;
    eventCount = 0;
  }

  function start(patch) {
    if (destroyed || !isGhostWirePatch(patch)) {
      accepted = false;
      suspended = true;
      panicked = false;
      clearEffect();
      emit();
      return false;
    }

    clearPatch();
    for (const axis of patch.axes) axisSlots.push({ id: axis.id, value: 0 });
    for (const event of patch.events) eventSlots.push({ id: event.id, type: event.type, value: 0, seen: false });
    axisViews = Object.freeze(axisSlots.map((slot) => frozenScalarView(slot, ['id', 'value'])));
    eventViews = Object.freeze(eventSlots.map((slot) => frozenScalarView(slot, ['id', 'type', 'value'])));
    accepted = true;
    suspended = false;
    panicked = false;
    axisCount = axisSlots.length;
    emit();
    return true;
  }

  function update(frame = {}) {
    if (!accepted || suspended || panicked || destroyed) return ensureState();
    timestamp = finiteNonNegative(frame.timestamp);
    fps = finiteNonNegative(frame.fps);
    axisCount = axisSlots.length;
    for (const axis of axisSlots) axis.value = findAxisValue(frame.axes, axis.id);

    for (const event of eventSlots) {
      event.value = 0;
      event.seen = false;
    }
    if (Array.isArray(frame.events)) {
      const incomingCount = Number.isInteger(frame.eventCount)
        ? Math.min(frame.events.length, Math.max(0, frame.eventCount))
        : frame.events.length;
      for (let index = 0; index < incomingCount; index += 1) {
        const incoming = frame.events[index];
        const slot = eventSlots.find((event) => event.id === incoming?.id && event.type === incoming?.type);
        if (!slot) continue;
        slot.value = Math.max(slot.value, finiteUnit(incoming.value));
        slot.seen = true;
      }
    }
    eventCount = eventSlots.reduce((count, event) => count + Number(event.seen), 0);
    emit();
    return ensureState();
  }

  function suspend() {
    if (destroyed) return ensureState();
    suspended = true;
    clearEffect();
    emit();
    return ensureState();
  }

  function resume() {
    if (!accepted || panicked || destroyed) return false;
    suspended = false;
    axisCount = axisSlots.length;
    emit();
    return true;
  }

  function panic() {
    if (destroyed) return ensureState();
    panicked = true;
    suspended = true;
    clearEffect();
    emit();
    return ensureState();
  }

  function destroy() {
    if (destroyed) return ensureState();
    accepted = false;
    panicked = true;
    suspended = true;
    clearEffect();
    destroyed = true;
    emit();
    return ensureState();
  }

  function getState() {
    return ensureState();
  }

  return Object.freeze({ start, update, suspend, resume, panic, destroy, getState });
}
