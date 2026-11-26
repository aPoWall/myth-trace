function finite(value, name, { min = -Infinity, integer = false } = {}) {
  if (!Number.isFinite(value) || value < min || (integer && !Number.isInteger(value))) {
    throw new TypeError(`${name} must be ${integer ? 'an integer ' : ''}number >= ${min}`);
  }
  return value;
}

function readConfig(config) {
  const source = config?.performanceCapture;
  if (!source || typeof source !== 'object') {
    throw new TypeError('createPerformanceRecorder requires config.performanceCapture');
  }
  if (!Array.isArray(source.mimeTypes) || source.mimeTypes.length === 0
    || source.mimeTypes.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new TypeError('config.performanceCapture.mimeTypes must be a non-empty string array');
  }
  return Object.freeze({
    frameRate: finite(source.frameRate, 'config.performanceCapture.frameRate', { min: 1 }),
    chunkMs: finite(source.chunkMs, 'config.performanceCapture.chunkMs', { min: 1 }),
    maxDurationMs: finite(source.maxDurationMs, 'config.performanceCapture.maxDurationMs', { min: 1 }),
    maxTakes: finite(source.maxTakes, 'config.performanceCapture.maxTakes', { min: 1, integer: true }),
    maxBytes: finite(source.maxBytes, 'config.performanceCapture.maxBytes', { min: 1, integer: true }),
    mimeTypes: Object.freeze([...source.mimeTypes]),
  });
}

function safeCall(callback, state) {
  try {
    callback(Object.freeze({ ...state }));
  } catch {
    // Rendering UI callbacks never own the capture lifecycle.
  }
}

function recordSummary(record) {
  return Object.freeze({
    id: record.id,
    createdAt: record.createdAt,
    durationMs: record.durationMs,
    mimeType: record.mimeType,
    size: record.size,
  });
}

/**
 * Explicit, browser-local performance capture. A coordinator supplies an
 * already-authorized MediaStream (normally canvas.captureStream); this module
 * never asks for a device, touches DOM state, downloads, or sends data away.
 */
export function createPerformanceRecorder({
  config,
  environment = globalThis,
  onState = () => {},
} = {}) {
  const capture = readConfig(config);
  const MediaRecorder = environment?.MediaRecorder;
  const BlobConstructor = environment?.Blob || globalThis.Blob;
  const now = () => environment?.performance?.now?.() ?? Date.now();
  const setTimer = environment?.setTimeout?.bind(environment) || globalThis.setTimeout.bind(globalThis);
  const clearTimer = environment?.clearTimeout?.bind(environment) || globalThis.clearTimeout.bind(globalThis);
  const urls = new Map();
  const takes = new Map();
  const unsavedTakes = new Set();
  let sequence = 0;
  let active = null;
  let destroyed = false;
  let status = typeof MediaRecorder === 'function' ? 'idle' : 'unsupported';
  let storage = null;
  let pendingWrites = 0;
  let storageLoaded = !environment.indexedDB;
  const database = environment.indexedDB;
  const storageReady = database ? new Promise(resolve => {
    let request;
    try { request = database.open('mythtrace-performance-video', 1); }
    catch { resolve(); return; }
    request.onupgradeneeded = () => request.result.createObjectStore('takes', { keyPath: 'id' });
    request.onerror = request.onblocked = () => resolve();
    request.onsuccess = () => {
      if (destroyed) { request.result.close(); resolve(); return; }
      storage = request.result;
      const transaction = storage.transaction('takes', 'readonly');
      const saved = transaction.objectStore('takes').getAll();
      saved.onsuccess = () => {
        for (const take of saved.result.sort((a, b) => a.createdAt - b.createdAt)) takes.set(take.id, take);
      };
      transaction.oncomplete = () => { resolve(); publish(); };
      transaction.onabort = transaction.onerror = () => resolve();
    };
  }) : Promise.resolve();
  void storageReady.then(() => { storageLoaded = true; publish(); });

  async function persistTake(record, removed = []) {
    if (record) unsavedTakes.add(record.id);
    for (const id of removed) unsavedTakes.delete(id);
    pendingWrites++;
    await storageReady;
    try {
      if (!storage) throw new Error('storage unavailable');
      await new Promise((resolve, reject) => {
        const transaction = storage.transaction('takes', 'readwrite');
        const store = transaction.objectStore('takes');
        for (const id of removed) store.delete(id);
        if (record) store.put(record);
        transaction.oncomplete = resolve;
        transaction.onabort = transaction.onerror = reject;
      });
      if (record) unsavedTakes.delete(record.id);
    } catch {
      error = record
        ? 'Take in memory. Download and remove it before updating.'
        : 'The browser could not remove the saved take.';
    } finally { pendingWrites--; publish(); }
  }

  let error = typeof MediaRecorder === 'function' ? '' : 'MediaRecorder unavailable';

  function totalBytes() {
    let result = 0;
    for (const take of takes.values()) result += take.size;
    return result;
  }

  function currentState() {
    const elapsed = active ? Math.max(0, now() - active.startedAt) : 0;
    return {
      status,
      active: Boolean(active),
      mimeType: active?.mimeType || '',
      durationMs: elapsed,
      takeCount: takes.size,
      totalBytes: totalBytes(),
      error,
      pendingWrites,
      storageLoaded,
      persistenceFailed: unsavedTakes.size > 0,
    };
  }

  function publish() {
    safeCall(onState, currentState());
  }

  function chooseMimeType() {
    if (typeof MediaRecorder?.isTypeSupported !== 'function') return '';
    return capture.mimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  function revokeUrl(id) {
    const url = urls.get(id);
    if (!url) return;
    urls.delete(id);
    try { environment?.URL?.revokeObjectURL?.(url); } catch { /* best-effort release */ }
  }

  function discardSession(session, nextStatus = 'idle', nextError = '') {
    if (!session || session.settled) return;
    session.discard = true;
    clearTimer(session.timer);
    session.timer = null;
    session.chunks.length = 0;
    session.bytes = 0;
    if (active === session) active = null;
    status = nextStatus;
    error = nextError;
  }

  function settleDiscard(session) {
    if (!session || session.settled) return;
    session.settled = true;
    session.resolve(null);
    publish();
  }

  function halt(session, nextError) {
    if (!session || session.settled) return;
    discardSession(session, 'error', nextError);
    try {
      if (session.recorder.state !== 'inactive') session.recorder.stop();
    } catch {
      settleDiscard(session);
    }
  }

  function makeId(createdAt) {
    sequence += 1;
    return `take-${createdAt}-${sequence}`;
  }

  function pruneFor(record, removed) {
    while (takes.size >= capture.maxTakes || totalBytes() + record.size > capture.maxBytes) {
      const oldest = [...takes.values()].find(take => !database || !unsavedTakes.has(take.id));
      if (!oldest) break;
      removed.push(oldest.id);
      takes.delete(oldest.id);
      revokeUrl(oldest.id);
    }
    return totalBytes() + record.size <= capture.maxBytes && takes.size < capture.maxTakes;
  }

  function finalize(session) {
    if (!session || session.settled) return;
    clearTimer(session.timer);
    session.timer = null;
    if (session.discard || destroyed || session.chunks.length === 0 || !BlobConstructor) {
      if (session.discard || destroyed) discardSession(session, status, error);
      else {
        if (active === session) active = null;
        status = 'idle';
        error = BlobConstructor ? 'capture produced no data' : 'Blob unavailable';
      }
      settleDiscard(session);
      return;
    }
    const finishedAt = now();
    const createdAt = Date.now();
    const blob = new BlobConstructor(session.chunks, { type: session.mimeType || session.chunks[0].type || 'video/webm' });
    if (!Number.isFinite(blob.size) || blob.size > capture.maxBytes) {
      discardSession(session, 'error', 'capture exceeds configured byte limit');
      settleDiscard(session);
      return;
    }
    const record = {
      id: makeId(createdAt),
      createdAt,
      durationMs: Math.min(capture.maxDurationMs, Math.max(0, finishedAt - session.startedAt)),
      mimeType: blob.type || session.mimeType || 'video/webm',
      size: blob.size,
      blob,
    };
    const removed = [];
    if (!pruneFor(record, removed)) {
      discardSession(session, 'error', 'capture exceeds local take library limit');
      settleDiscard(session);
      return;
    }
    takes.set(record.id, record);
    if (active === session) active = null;
    session.chunks.length = 0;
    session.settled = true;
    status = 'idle';
    error = '';
    void persistTake(record, removed).then(() => session.resolve(recordSummary(record)));
    publish();
  }

  function stopSession(session) {
    if (!session || session.settled || session.stopping) return;
    session.stopping = true;
    clearTimer(session.timer);
    session.timer = null;
    if (active === session) status = 'stopping';
    try {
      if (session.recorder.state !== 'inactive') session.recorder.stop();
      else finalize(session);
    } catch (stopError) {
      halt(session, stopError?.message || 'MediaRecorder stop failed');
    }
    publish();
  }

  function start(stream) {
    if (destroyed || active) return false;
    if (typeof MediaRecorder !== 'function') {
      status = 'unsupported';
      error = 'MediaRecorder unavailable';
      publish();
      return false;
    }
    if (!stream) {
      status = 'error';
      error = 'capture stream unavailable';
      publish();
      return false;
    }
    const mimeType = chooseMimeType();
    let recorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (startError) {
      status = 'error';
      error = startError?.message || 'MediaRecorder unavailable';
      publish();
      return false;
    }
    let resolve;
    const session = {
      recorder,
      mimeType,
      startedAt: now(),
      chunks: [],
      bytes: 0,
      timer: null,
      discard: false,
      stopping: false,
      settled: false,
      done: new Promise((done) => { resolve = done; }),
      resolve,
    };
    recorder.ondataavailable = (event) => {
      const chunk = event?.data;
      if (session.discard || !chunk?.size) return;
      if (!Number.isFinite(chunk.size) || chunk.size < 0 || session.bytes + chunk.size > capture.maxBytes) {
        halt(session, 'capture exceeds configured byte limit');
        return;
      }
      session.chunks.push(chunk);
      session.bytes += chunk.size;
    };
    recorder.onstop = () => finalize(session);
    recorder.onerror = (event) => halt(session, event?.error?.message || 'MediaRecorder failed');
    active = session;
    status = 'recording';
    error = '';
    try {
      recorder.start(capture.chunkMs);
      session.timer = setTimer(() => stopSession(session), capture.maxDurationMs);
      publish();
      return true;
    } catch (startError) {
      discardSession(session, 'error', startError?.message || 'MediaRecorder start failed');
      settleDiscard(session);
      return false;
    }
  }

  function stop() {
    const session = active;
    if (!session) return Promise.resolve(null);
    stopSession(session);
    return session.done;
  }

  function panic() {
    const session = active;
    if (!session) return;
    discardSession(session, 'idle', '');
    try {
      if (session.recorder.state !== 'inactive') session.recorder.stop();
    } catch {
      // A panic must still discard a take if the recorder has already stopped.
    }
    settleDiscard(session);
  }

  function listTakes() {
    return Object.freeze([...takes.values()].map(recordSummary));
  }

  function removeTake(id) {
    const key = String(id || '');
    if (!takes.has(key)) return false;
    takes.delete(key);
    revokeUrl(key);
    void persistTake(null, [key]);
    publish();
    return true;
  }

  function getTakeUrl(id) {
    const key = String(id || '');
    const record = takes.get(key);
    if (!record || typeof environment?.URL?.createObjectURL !== 'function') return '';
    if (!urls.has(key)) urls.set(key, environment.URL.createObjectURL(record.blob));
    return urls.get(key);
  }

  function getState() {
    return Object.freeze(currentState());
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    const session = active;
    if (session) {
      discardSession(session, 'destroyed', '');
      try {
        if (session.recorder.state !== 'inactive') session.recorder.stop();
      } catch { /* teardown is best effort */ }
      settleDiscard(session);
    }
    for (const id of urls.keys()) revokeUrl(id);
    takes.clear();
    unsavedTakes.clear();
    storage?.close();
    status = 'destroyed';
    error = '';
    publish();
  }

  return Object.freeze({
    start,
    stop,
    panic,
    listTakes,
    removeTake,
    getTakeUrl,
    getState,
    destroy,
  });
}
