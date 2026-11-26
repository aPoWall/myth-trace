function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function sanitizeData(value, settings) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.freeze({});
  const output = {};
  for (const [key, raw] of Object.entries(value).slice(0, settings.maxDataFields)) {
    const name = boundedText(key, settings.maxStringLength);
    if (!name) continue;
    if (typeof raw === 'string') output[name] = boundedText(raw, settings.maxStringLength);
    else if (typeof raw === 'number' && Number.isFinite(raw)) output[name] = raw;
    else if (typeof raw === 'boolean') output[name] = raw;
  }
  return Object.freeze(output);
}

export function normalizeScoreEvent(input, settings, sequence = 0, relativeMs = 0) {
  if (!input || typeof input !== 'object' || !settings?.kinds?.includes?.(String(input.kind || ''))) return null;
  const action = boundedText(input.action, settings.maxStringLength);
  if (!action) return null;
  return Object.freeze({
    seq: Math.max(1, Math.trunc(finite(sequence, 1))),
    t: Math.max(0, Math.min(settings.maxDurationMs, Math.round(finite(relativeMs, 0)))),
    kind: String(input.kind),
    action,
    label: boundedText(input.label, settings.maxStringLength),
    data: sanitizeData(input.data, settings),
  });
}

function freezeScore(score) {
  if (!score) return null;
  return Object.freeze({
    id: score.id,
    startedAt: score.startedAt,
    endedAt: score.endedAt,
    durationMs: score.durationMs,
    stopReason: score.stopReason,
    events: Object.freeze(score.events.map((event) => Object.freeze({ ...event, data: Object.freeze({ ...event.data }) }))),
  });
}

export function createScoreRecorder({
  config,
  storage = globalThis.localStorage,
  clock = globalThis.performance?.now?.bind(globalThis.performance) || (() => 0),
  wallClock = Date.now,
  onStatus = () => {},
} = {}) {
  const settings = config?.scoreRecorder;
  if (!settings || !Array.isArray(settings.kinds) || !settings.storageKey) {
    throw new TypeError('createScoreRecorder requires CONFIG.scoreRecorder');
  }

  let recording = false;
  let startedClock = 0;
  let score = null;
  let persisted = false;
  let lastEvent = 'score idle · no events';

  function report(message = lastEvent) {
    lastEvent = message;
    try { onStatus(getState(), message); } catch { /* observers cannot break the score */ }
  }

  function normalizeStored(raw) {
    if (raw?.version !== settings.schemaVersion || !raw.score || !Array.isArray(raw.score.events)) return null;
    const events = [];
    for (const source of raw.score.events.slice(0, settings.maxEvents)) {
      const event = normalizeScoreEvent(source, settings, events.length + 1, source?.t);
      if (event) events.push(event);
    }
    const durationMs = Math.max(0, Math.min(settings.maxDurationMs, Math.round(finite(raw.score.durationMs, 0))));
    return freezeScore({
      id: boundedText(raw.score.id, settings.maxStringLength) || `score-${Math.trunc(finite(raw.score.startedAt, 0))}`,
      startedAt: Math.max(0, Math.trunc(finite(raw.score.startedAt, 0))),
      endedAt: Math.max(0, Math.trunc(finite(raw.score.endedAt, 0))),
      durationMs,
      stopReason: boundedText(raw.score.stopReason, settings.maxStringLength) || 'restored',
      events,
    });
  }

  try {
    score = normalizeStored(JSON.parse(storage?.getItem?.(settings.storageKey) || 'null'));
    persisted = Boolean(score);
    if (score) lastEvent = `score restored · ${score.events.length} events`;
  } catch {
    score = null;
    persisted = false;
    lastEvent = 'score storage unavailable · memory only';
  }

  function persist() {
    if (!score) return false;
    try {
      storage?.setItem?.(settings.storageKey, JSON.stringify({
        version: settings.schemaVersion,
        score,
      }));
      persisted = true;
      return true;
    } catch {
      persisted = false;
      return false;
    }
  }

  function start(timestamp = clock()) {
    if (recording) return getState(timestamp);
    startedClock = finite(timestamp, clock());
    const startedAt = Math.max(0, Math.trunc(finite(wallClock(), 0)));
    score = freezeScore({
      id: `score-${startedAt}`,
      startedAt,
      endedAt: 0,
      durationMs: 0,
      stopReason: '',
      events: [],
    });
    recording = true;
    persisted = false;
    report('score recording · causal events only');
    return getState(timestamp);
  }

  function elapsed(timestamp = clock()) {
    return recording ? Math.max(0, finite(timestamp, startedClock) - startedClock) : score?.durationMs || 0;
  }

  function stop(reason = 'manual', timestamp = clock()) {
    if (!recording) return getState(timestamp);
    const durationMs = Math.min(settings.maxDurationMs, Math.round(elapsed(timestamp)));
    score = freezeScore({
      ...score,
      endedAt: Math.max(score.startedAt, Math.trunc(finite(wallClock(), score.startedAt))),
      durationMs,
      stopReason: boundedText(reason, settings.maxStringLength) || 'manual',
    });
    recording = false;
    const saved = persist();
    report(`score stopped · ${score.events.length} events · ${saved ? 'saved locally' : 'memory only'}`);
    return getState(timestamp);
  }

  function record(input, timestamp = clock()) {
    if (!recording || !score) return false;
    const relativeMs = Math.max(elapsed(timestamp), score.events.at(-1)?.t || 0);
    if (relativeMs > settings.maxDurationMs) {
      stop('duration limit', timestamp);
      return false;
    }
    if (score.events.length >= settings.maxEvents) {
      stop('event limit', timestamp);
      return false;
    }
    const event = normalizeScoreEvent(input, settings, score.events.length + 1, relativeMs);
    if (!event) return false;
    score = freezeScore({ ...score, durationMs: Math.round(relativeMs), events: [...score.events, event] });
    if (score.events.length >= settings.maxEvents) stop('event limit', timestamp);
    else report(`${event.kind} · ${event.action} · ${score.events.length}/${settings.maxEvents}`);
    return true;
  }

  function update(timestamp = clock()) {
    if (recording && elapsed(timestamp) >= settings.maxDurationMs) stop('duration limit', timestamp);
    return getState(timestamp);
  }

  function clear() {
    recording = false;
    startedClock = 0;
    score = null;
    persisted = false;
    try { storage?.removeItem?.(settings.storageKey); } catch { /* in-memory clear still succeeds */ }
    report('score cleared · no events');
    return getState();
  }

  function exportJson() {
    if (!score) return '';
    return JSON.stringify({
      schema: 'mythtrace.performance-score',
      version: settings.schemaVersion,
      score,
    }, null, 2);
  }

  function getState(timestamp = clock()) {
    return Object.freeze({
      recording,
      persisted,
      durationMs: Math.min(settings.maxDurationMs, Math.round(elapsed(timestamp))),
      eventCount: score?.events.length || 0,
      capacity: settings.maxEvents,
      lastEvent,
      score,
    });
  }

  return Object.freeze({ start, record, update, stop, clear, exportJson, getState });
}
