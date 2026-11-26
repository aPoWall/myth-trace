const ROOT_KEYS = Object.freeze(['version', 'id', 'engine', 'recipe', 'enabled', 'axes', 'events']);
const AXIS_KEYS = Object.freeze(['id', 'source', 'metric', 'min', 'max']);
const EVENT_KEYS = Object.freeze(['id', 'source', 'type']);
const ADAPTER_METHODS = Object.freeze(['start', 'update', 'suspend', 'resume', 'panic', 'destroy']);
const STATUS = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  DISABLED: 'disabled',
  SUSPENDED: 'suspended-low-fps',
  PANICKED: 'panicked',
  FAULTED: 'faulted',
  DESTROYED: 'destroyed',
});
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]*$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function integer(value, label, min) {
  if (!Number.isInteger(value) || value < min) {
    throw new TypeError(`CONFIG.performancePatch.${label} must be an integer >= ${min}`);
  }
  return value;
}

function positive(value, label, minimum = 0) {
  const number = finite(value);
  if (number === null || number < minimum) {
    throw new TypeError(`CONFIG.performancePatch.${label} must be >= ${minimum}`);
  }
  return number;
}

function stringList(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`CONFIG.performancePatch.${label} must be a non-empty array`);
  }
  const normalized = [];
  for (const entry of value) {
    const text = String(entry ?? '').trim().toLowerCase();
    if (!text || normalized.includes(text)) {
      throw new TypeError(`CONFIG.performancePatch.${label} contains an invalid entry`);
    }
    normalized.push(text);
  }
  return Object.freeze(normalized);
}

function readSchema(config) {
  const patch = config?.performancePatch;
  if (!isRecord(patch)) throw new TypeError('CONFIG.performancePatch is required');

  const version = integer(patch.version, 'version', 1);
  if (version !== 1) throw new TypeError('CONFIG.performancePatch.version must be 1');
  const idMaxLength = integer(patch.idMaxLength, 'idMaxLength', 1);
  const maxAxes = integer(patch.maxAxes, 'maxAxes', 1);
  const maxEvents = integer(patch.maxEvents, 'maxEvents', 1);
  const minFps = positive(patch.minFps, 'minFps', 1);
  const lowFpsHoldMs = positive(patch.lowFpsHoldMs, 'lowFpsHoldMs', 1);
  const resumeFps = positive(patch.resumeFps, 'resumeFps', minFps);
  const recoveryHoldMs = positive(patch.recoveryHoldMs, 'recoveryHoldMs', 1);
  const engines = stringList(patch.engines, 'engines');
  const sources = stringList(patch.sources, 'sources');
  if (!isRecord(patch.recipes)) {
    throw new TypeError('CONFIG.performancePatch.recipes must be an object');
  }
  const recipes = {};
  for (const engine of engines) recipes[engine] = stringList(patch.recipes[engine], `recipes.${engine}`);

  return Object.freeze({
    version,
    idMaxLength,
    maxAxes,
    maxEvents,
    minFps,
    lowFpsHoldMs,
    resumeFps,
    recoveryHoldMs,
    engines: new Set(engines),
    sources: new Set(sources),
    recipes: Object.freeze(recipes),
  });
}

function exactKeys(value, allowed, label, errors) {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${label}.${key} is not allowed`);
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) errors.push(`${label}.${key} is required`);
  }
  return true;
}

function identifier(value, label, schema, errors) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!text || text.length > schema.idMaxLength || !IDENTIFIER.test(text)) {
    errors.push(`${label} must be a bounded lowercase identifier`);
    return '';
  }
  return text;
}

function normalizeAxis(value, index, schema, errors) {
  const label = `axes[${index}]`;
  if (!exactKeys(value, AXIS_KEYS, label, errors)) return null;
  const id = identifier(value.id, `${label}.id`, schema, errors);
  const source = identifier(value.source, `${label}.source`, schema, errors);
  const metric = identifier(value.metric, `${label}.metric`, schema, errors);
  if (source && !schema.sources.has(source)) errors.push(`${label}.source is not allowed`);
  const min = finite(value.min);
  const max = finite(value.max);
  if (min === null) errors.push(`${label}.min must be finite`);
  if (max === null) errors.push(`${label}.max must be finite`);
  if (min !== null && max !== null && max <= min) errors.push(`${label}.max must be greater than min`);
  return Object.freeze({ id, source, metric, min, max });
}

function normalizeEvent(value, index, schema, errors) {
  const label = `events[${index}]`;
  if (!exactKeys(value, EVENT_KEYS, label, errors)) return null;
  const id = identifier(value.id, `${label}.id`, schema, errors);
  const source = identifier(value.source, `${label}.source`, schema, errors);
  const type = identifier(value.type, `${label}.type`, schema, errors);
  if (source && !schema.sources.has(source)) errors.push(`${label}.source is not allowed`);
  return Object.freeze({ id, source, type });
}

function validateWithSchema(input, schema) {
  const errors = [];
  if (!exactKeys(input, ROOT_KEYS, 'patch', errors)) {
    return Object.freeze({ valid: false, errors: Object.freeze(errors), patch: null });
  }

  if (input.version !== schema.version) errors.push(`patch.version must be ${schema.version}`);
  const id = identifier(input.id, 'patch.id', schema, errors);
  const engine = identifier(input.engine, 'patch.engine', schema, errors);
  const recipe = identifier(input.recipe, 'patch.recipe', schema, errors);
  if (engine && !schema.engines.has(engine)) errors.push('patch.engine is not allowed');
  if (engine && recipe && !schema.recipes[engine]?.includes(recipe)) {
    errors.push('patch.recipe is not a configured local recipe');
  }
  if (typeof input.enabled !== 'boolean') errors.push('patch.enabled must be boolean');

  const axes = [];
  const events = [];
  if (!Array.isArray(input.axes)) errors.push('patch.axes must be an array');
  else if (input.axes.length > schema.maxAxes) errors.push(`patch.axes exceeds ${schema.maxAxes}`);
  else for (let index = 0; index < input.axes.length; index += 1) {
    const axis = normalizeAxis(input.axes[index], index, schema, errors);
    if (axis) axes.push(axis);
  }
  if (!Array.isArray(input.events)) errors.push('patch.events must be an array');
  else if (input.events.length > schema.maxEvents) errors.push(`patch.events exceeds ${schema.maxEvents}`);
  else for (let index = 0; index < input.events.length; index += 1) {
    const event = normalizeEvent(input.events[index], index, schema, errors);
    if (event) events.push(event);
  }

  if (Array.isArray(input.axes) && Array.isArray(input.events) && input.axes.length + input.events.length === 0) {
    errors.push('patch must declare at least one axis or event');
  }
  const ids = new Set();
  for (const binding of [...axes, ...events]) {
    if (!binding.id) continue;
    if (ids.has(binding.id)) errors.push(`binding id ${binding.id} is duplicated`);
    ids.add(binding.id);
  }
  if (errors.length > 0) {
    return Object.freeze({ valid: false, errors: Object.freeze(errors), patch: null });
  }

  const patch = Object.freeze({
    version: schema.version,
    id,
    engine,
    recipe,
    enabled: input.enabled,
    axes: Object.freeze(axes),
    events: Object.freeze(events),
  });
  return Object.freeze({ valid: true, errors: Object.freeze([]), patch });
}

export function validatePerformancePatch(input, config) {
  return validateWithSchema(input, readSchema(config));
}

function requireAdapter(adapter) {
  if (!isRecord(adapter)) throw new TypeError('PerformancePatch sidecar adapter is required');
  for (const method of ADAPTER_METHODS) {
    if (typeof adapter[method] !== 'function') {
      throw new TypeError(`PerformancePatch sidecar adapter.${method} is required`);
    }
  }
  return adapter;
}

function errorMessage(error) {
  return error instanceof Error && error.message ? error.message : String(error || 'unknown adapter error');
}

export function createPerformancePatchHost({ config, onState = () => {} } = {}) {
  const schema = readSchema(config);
  const axisPool = Array.from(
    { length: schema.maxAxes },
    () => Object.seal({ id: '', value: 0 }),
  );
  const eventPool = Array.from(
    { length: schema.maxEvents },
    () => Object.seal({ id: '', type: '', value: 0 }),
  );
  const output = Object.seal({
    timestamp: 0,
    fps: 0,
    axisCount: 0,
    axes: Object.seal(axisPool),
    eventCount: 0,
    events: Object.seal(eventPool),
  });
  let patch = null;
  let adapter = null;
  let status = STATUS.IDLE;
  let reason = 'no patch loaded';
  let lowFpsSince = null;
  let recoverySince = null;
  let lastTimestamp = 0;
  let lastFps = 0;

  function getState() {
    return Object.freeze({
      status,
      reason,
      active: status === STATUS.RUNNING,
      patchId: patch?.id || '',
      engine: patch?.engine || '',
      fps: lastFps,
      lowFpsSince,
      recoverySince,
    });
  }

  function emit() {
    try {
      onState(getState());
    } catch {
      // Diagnostics cannot interrupt the projector or sidecar lifecycle.
    }
  }

  function transition(nextStatus, nextReason) {
    if (status === nextStatus && reason === nextReason) return;
    status = nextStatus;
    reason = nextReason;
    emit();
  }

  function clearOutput() {
    output.axisCount = 0;
    output.eventCount = 0;
    for (const axis of axisPool) {
      axis.id = '';
      axis.value = 0;
    }
    for (const event of eventPool) {
      event.id = '';
      event.type = '';
      event.value = 0;
    }
  }

  function retireAdapter(nextStatus = STATUS.IDLE, nextReason = 'no patch loaded') {
    if (adapter) {
      try { adapter.panic(); } catch { /* Retire every reachable lane. */ }
      try { adapter.suspend('unload'); } catch { /* Retire every reachable lane. */ }
      try { adapter.destroy(); } catch { /* Retire every reachable lane. */ }
    }
    adapter = null;
    patch = null;
    lowFpsSince = null;
    recoverySince = null;
    clearOutput();
    transition(nextStatus, nextReason);
  }

  function fault(method, error) {
    if (adapter) {
      try { adapter.panic(); } catch { /* A failing adapter stays contained. */ }
      try { adapter.suspend('fault'); } catch { /* A failing adapter stays contained. */ }
    }
    lowFpsSince = null;
    recoverySince = null;
    clearOutput();
    transition(STATUS.FAULTED, `${method} · ${errorMessage(error)}`);
  }

  function load(input, nextAdapter) {
    if (status === STATUS.DESTROYED) throw new Error('PerformancePatch host is destroyed');
    const validation = validateWithSchema(input, schema);
    if (!validation.valid) return validation;
    const validatedAdapter = requireAdapter(nextAdapter);
    retireAdapter();
    patch = validation.patch;
    adapter = validatedAdapter;
    if (!patch.enabled) {
      transition(STATUS.DISABLED, 'patch disabled');
      return validation;
    }
    try {
      adapter.start(patch);
      transition(STATUS.RUNNING, 'patch running');
    } catch (error) {
      fault('start failed', error);
    }
    return validation;
  }

  function findAxisValue(values, id) {
    if (!Array.isArray(values)) return null;
    for (let index = 0; index < values.length; index += 1) {
      const entry = values[index];
      if (entry?.id !== id) continue;
      return finite(entry.value);
    }
    return null;
  }

  function copyInputs(frame) {
    output.timestamp = lastTimestamp;
    output.fps = lastFps;
    output.axisCount = patch.axes.length;
    for (let index = 0; index < patch.axes.length; index += 1) {
      const binding = patch.axes[index];
      const target = axisPool[index];
      const raw = findAxisValue(frame?.axes, binding.id);
      target.id = binding.id;
      target.value = raw === null
        ? 0
        : (clamp(raw, binding.min, binding.max) - binding.min) / (binding.max - binding.min);
    }

    output.eventCount = 0;
    const incomingEvents = Array.isArray(frame?.events) ? frame.events : [];
    for (let index = 0; index < incomingEvents.length && output.eventCount < schema.maxEvents; index += 1) {
      const incoming = incomingEvents[index];
      const binding = patch.events.find((entry) => entry.id === incoming?.id && entry.type === incoming?.type);
      if (!binding) continue;
      const target = eventPool[output.eventCount];
      const value = finite(incoming.value);
      target.id = binding.id;
      target.type = binding.type;
      target.value = clamp(value === null ? 1 : value);
      output.eventCount += 1;
    }
  }

  function update(frame = {}) {
    if (status !== STATUS.RUNNING && status !== STATUS.SUSPENDED) return output;
    const timestamp = finite(frame.timestamp);
    const fps = finite(frame.fps);
    if (timestamp !== null) lastTimestamp = Math.max(lastTimestamp, timestamp);
    if (fps !== null && fps > 0) lastFps = fps;

    if (status === STATUS.RUNNING && fps !== null && fps > 0) {
      if (fps < schema.minFps) {
        if (lowFpsSince === null) lowFpsSince = lastTimestamp;
        if (lastTimestamp - lowFpsSince >= schema.lowFpsHoldMs) {
          try {
            adapter.suspend('sustained-low-fps');
            recoverySince = null;
            clearOutput();
            transition(STATUS.SUSPENDED, 'sustained-low-fps');
          } catch (error) {
            fault('suspend failed', error);
          }
          return output;
        }
      } else {
        lowFpsSince = null;
      }
    }

    if (status === STATUS.SUSPENDED) {
      if (fps !== null && fps >= schema.resumeFps) {
        if (recoverySince === null) recoverySince = lastTimestamp;
        if (lastTimestamp - recoverySince >= schema.recoveryHoldMs) {
          try {
            adapter.resume();
            lowFpsSince = null;
            recoverySince = null;
            transition(STATUS.RUNNING, 'patch running');
          } catch (error) {
            fault('resume failed', error);
          }
        }
      } else {
        recoverySince = null;
      }
      if (status !== STATUS.RUNNING) return output;
    }

    copyInputs(frame);
    try {
      adapter.update(output);
    } catch (error) {
      fault('update failed', error);
    }
    return output;
  }

  function panic() {
    if (status === STATUS.DESTROYED) return getState();
    if (!adapter) {
      clearOutput();
      transition(STATUS.IDLE, 'panic · no sidecar');
      return getState();
    }
    try { adapter.panic(); } catch { /* Panic continues through every safe close. */ }
    try { adapter.suspend('panic'); } catch { /* Panic continues through every safe close. */ }
    lowFpsSince = null;
    recoverySince = null;
    clearOutput();
    transition(STATUS.PANICKED, 'panic · sidecar suspended');
    return getState();
  }

  function unload() {
    if (status === STATUS.DESTROYED) return getState();
    retireAdapter();
    return getState();
  }

  function destroy() {
    if (status === STATUS.DESTROYED) return;
    retireAdapter(STATUS.DESTROYED, 'host destroyed');
  }

  return Object.freeze({ load, update, panic, unload, getState, destroy });
}
