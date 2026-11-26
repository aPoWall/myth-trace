const HARD_LIMITS = Object.freeze({
  clips: 10,
  bytes: 25 * 1024 * 1024,
  recordMs: 9000,
  voices: 8,
  rangeHz: 30,
});

function requireFinite(object, key, { min = -Infinity, max = Infinity } = {}) {
  const value = object?.[key];
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`config.sampler.${key} must be a finite number in ${min}..${max}`);
  }
  return value;
}

function requireText(object, key) {
  const value = object?.[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`config.sampler.${key} must be a non-empty string`);
  }
  return value;
}

function requireDynamics(object, key) {
  const value = object?.[key];
  if (!value || typeof value !== 'object') {
    throw new TypeError(`config.sampler.${key} is required`);
  }
  return Object.freeze({
    threshold: requireFinite(value, 'threshold'),
    knee: requireFinite(value, 'knee', { min: 0 }),
    ratio: requireFinite(value, 'ratio', { min: 1 }),
    attack: requireFinite(value, 'attack', { min: 0 }),
    release: requireFinite(value, 'release', { min: 0 }),
  });
}

function readSamplerConfig(config) {
  const source = config?.sampler;
  if (!source) throw new TypeError('createSamplerEngine requires config.sampler');

  const playbackRateMin = requireFinite(source, 'playbackRateMin', { min: 0.01 });
  const playbackRateMax = requireFinite(source, 'playbackRateMax', { min: playbackRateMin });
  if (!Array.isArray(source.playbackRateRatios) || source.playbackRateRatios.length === 0) {
    throw new TypeError('config.sampler.playbackRateRatios must be a non-empty array');
  }
  const playbackRateRatios = [...new Set(source.playbackRateRatios.map(Number))]
    .filter((value) => Number.isFinite(value) && value >= playbackRateMin && value <= playbackRateMax)
    .sort((a, b) => a - b);
  if (playbackRateRatios.length === 0) {
    throw new TypeError('config.sampler.playbackRateRatios has no ratio inside the configured bounds');
  }

  const recorderMimeTypes = source.recorderMimeTypes;
  if (!Array.isArray(recorderMimeTypes) || recorderMimeTypes.some((value) => typeof value !== 'string')) {
    throw new TypeError('config.sampler.recorderMimeTypes must be an array of strings');
  }
  const importMimeTypes = source.importMimeTypes;
  const importExtensions = source.importExtensions;
  if (!Array.isArray(importMimeTypes) || importMimeTypes.some((value) => typeof value !== 'string')) {
    throw new TypeError('config.sampler.importMimeTypes must be an array of strings');
  }
  if (!Array.isArray(importExtensions) || importExtensions.some((value) => typeof value !== 'string')) {
    throw new TypeError('config.sampler.importExtensions must be an array of strings');
  }
  const provenanceLimits = source.provenanceLimits;
  if (!provenanceLimits || typeof provenanceLimits !== 'object') {
    throw new TypeError('config.sampler.provenanceLimits is required');
  }

  const minCooldownMs = requireFinite(source, 'minCooldownMs', { min: 0 });
  const maxCooldownMs = requireFinite(source, 'maxCooldownMs', { min: minCooldownMs });
  const filterMinHz = requireFinite(source, 'filterMinHz', { min: 1 });
  const filterMaxHz = requireFinite(source, 'filterMaxHz', { min: filterMinHz });
  const delaySendMin = requireFinite(source, 'delaySendMin', { min: 0 });
  const delaySendMax = requireFinite(source, 'delaySendMax', { min: delaySendMin });
  const delayMaxSeconds = requireFinite(source, 'delayMaxSeconds', { min: 0 });

  return Object.freeze({
    dbName: requireText(source, 'dbName'),
    dbStore: requireText(source, 'dbStore'),
    dbVersion: Math.trunc(requireFinite(source, 'dbVersion', { min: 1 })),
    maxClips: Math.trunc(requireFinite(source, 'maxClips', { min: 1, max: HARD_LIMITS.clips })),
    maxBytes: Math.trunc(requireFinite(source, 'maxBytes', { min: 1, max: HARD_LIMITS.bytes })),
    recordLimitMs: requireFinite(source, 'recordLimitMs', { min: 1, max: HARD_LIMITS.recordMs }),
    maxVoices: Math.trunc(requireFinite(source, 'maxVoices', { min: 1, max: HARD_LIMITS.voices })),
    queueLimit: Math.trunc(requireFinite(source, 'queueLimit', { min: 1 })),
    defaultCooldownMs: requireFinite(source, 'defaultCooldownMs', { min: minCooldownMs, max: maxCooldownMs }),
    minCooldownMs,
    maxCooldownMs,
    rangeIntervalMs: requireFinite(source, 'rangeIntervalMs', { min: 1000 / HARD_LIMITS.rangeHz }),
    playbackRateMin,
    playbackRateMax,
    playbackRateRatios: Object.freeze(playbackRateRatios),
    filterMinHz,
    filterMaxHz,
    filterInitialHz: requireFinite(source, 'filterInitialHz', { min: filterMinHz, max: filterMaxHz }),
    filterQ: requireFinite(source, 'filterQ', { min: 0 }),
    delayMaxSeconds,
    delaySeconds: requireFinite(source, 'delaySeconds', { min: 0, max: delayMaxSeconds }),
    delaySendMin,
    delaySendMax,
    delaySendInitial: requireFinite(source, 'delaySendInitial', { min: delaySendMin, max: delaySendMax }),
    rangeSmoothingSeconds: requireFinite(source, 'rangeSmoothingSeconds', { min: 0 }),
    masterGain: requireFinite(source, 'masterGain', { min: 0, max: 1 }),
    voiceGain: requireFinite(source, 'voiceGain', { min: 0, max: 1 }),
    attackSeconds: requireFinite(source, 'attackSeconds', { min: 0 }),
    releaseSeconds: requireFinite(source, 'releaseSeconds', { min: 0 }),
    labelPrefix: requireText(source, 'labelPrefix'),
    recorderMimeTypes: Object.freeze([...recorderMimeTypes]),
    importMimeTypes: Object.freeze(importMimeTypes.map((value) => value.trim().toLowerCase()).filter(Boolean)),
    importExtensions: Object.freeze(importExtensions.map((value) => value.trim().toLowerCase()).filter(Boolean)),
    importMaxBytes: Math.trunc(requireFinite(source, 'importMaxBytes', { min: 1, max: HARD_LIMITS.bytes })),
    provenanceLimits: Object.freeze({
      sourceUrl: Math.trunc(requireFinite(provenanceLimits, 'sourceUrl', { min: 1, max: 4096 })),
      creator: Math.trunc(requireFinite(provenanceLimits, 'creator', { min: 1, max: 512 })),
      license: Math.trunc(requireFinite(provenanceLimits, 'license', { min: 1, max: 256 })),
    }),
    compressor: requireDynamics(source, 'compressor'),
    limiter: requireDynamics(source, 'limiter'),
  });
}

function clamp(value, min, max, fallback = min) {
  const finite = Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, finite));
}

function normalizeTimestamp(value, now) {
  return Number.isFinite(value) ? value : now();
}

function setParamNow(param, value, time) {
  if (!param) return;
  param.cancelScheduledValues?.(time);
  if (typeof param.setValueAtTime === 'function') param.setValueAtTime(value, time);
  else param.value = value;
}

function setParamSmooth(param, value, time, smoothingSeconds) {
  if (!param) return;
  if (smoothingSeconds > 0 && typeof param.setTargetAtTime === 'function') {
    param.setTargetAtTime(value, time, smoothingSeconds);
  } else {
    setParamNow(param, value, time);
  }
}

function configureDynamics(node, values) {
  node.threshold.value = values.threshold;
  node.knee.value = values.knee;
  node.ratio.value = values.ratio;
  node.attack.value = values.attack;
  node.release.value = values.release;
}

function hasStore(database, name) {
  if (typeof database.objectStoreNames?.contains === 'function') {
    return database.objectStoreNames.contains(name);
  }
  return Array.from(database.objectStoreNames || []).includes(name);
}

function requestError(request, fallback) {
  return request?.error || new Error(fallback);
}

function boundedText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeProvenance(value, sampler, fallbackKind = 'recording') {
  const raw = value && typeof value === 'object' ? value : {};
  const kind = raw.kind === 'import' ? 'import' : fallbackKind;
  return Object.freeze({
    kind,
    sourceUrl: boundedText(raw.sourceUrl, sampler.provenanceLimits.sourceUrl),
    creator: boundedText(raw.creator, sampler.provenanceLimits.creator),
    license: boundedText(raw.license, sampler.provenanceLimits.license),
    importedAt: Number.isFinite(raw.importedAt) ? raw.importedAt : 0,
  });
}

function publicClip(record) {
  return Object.freeze({
    id: record.id,
    label: record.label,
    duration: record.duration,
    mimeType: record.mimeType,
    createdAt: record.createdAt,
    size: record.size,
    provenance: record.provenance,
  });
}

function normalizeRecord(record, sampler) {
  const id = String(record?.id || '').trim();
  const blob = record?.blob;
  if (!id || !blob || typeof blob.arrayBuffer !== 'function' || !Number.isFinite(blob.size)) return null;
  return {
    id,
    label: String(record.label || id).trim() || id,
    duration: Math.max(0, Number(record.duration) || 0),
    mimeType: String(record.mimeType || record.type || blob.type || 'audio/webm'),
    createdAt: Number.isFinite(record.createdAt) ? record.createdAt : 0,
    size: Math.max(0, blob.size),
    blob,
    provenance: normalizeProvenance(record.provenance, sampler, 'recording'),
  };
}

/**
 * Browser-local sampler core. Every capability that could request a device,
 * create shared audio state or persist data is injected by the coordinator.
 */
export function createSamplerEngine({
  config,
  getAudioContext,
  getOutputDestination = null,
  getMicStream,
  IndexedDB,
  MediaRecorder,
  onStatus,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimer = (timer) => globalThis.clearTimeout(timer),
}) {
  const sampler = readSamplerConfig(config);
  if (typeof getAudioContext !== 'function') throw new TypeError('getAudioContext must be injected');
  if (typeof getMicStream !== 'function') throw new TypeError('getMicStream must be injected');
  if (!IndexedDB || typeof IndexedDB.open !== 'function') throw new TypeError('IndexedDB must be injected');
  if (typeof MediaRecorder !== 'function') throw new TypeError('MediaRecorder must be injected');
  if (typeof now !== 'function' || typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
    throw new TypeError('now, setTimer and clearTimer must be functions');
  }

  const statusCallback = typeof onStatus === 'function' ? onStatus : () => {};
  const clips = new Map();
  const bufferCache = new Map();
  const decodeTasks = new Map();
  const cooldowns = new Map();
  const queue = [];

  let destroyed = false;
  let armed = false;
  let armPromise = null;
  let armGeneration = 0;
  let audioContext = null;
  let graph = null;
  let outputLevel = 0;
  let database = null;
  let databasePromise = null;
  let storageTail = Promise.resolve();
  let recording = null;
  let recordingStart = null;
  let recordingGeneration = 0;
  let recordingSequence = 0;
  let importSequence = 0;
  let triggerSequence = 0;
  let triggerGeneration = 0;
  let draining = false;
  let currentRequest = null;
  let lastRangeAt = -Infinity;
  let lastEventAt = null;
  let error = '';

  const range = {
    filterHz: clamp(sampler.filterInitialHz, sampler.filterMinHz, sampler.filterMaxHz),
    delaySend: clamp(sampler.delaySendInitial, sampler.delaySendMin, sampler.delaySendMax),
    playbackRate: sampler.playbackRateRatios.reduce((best, candidate) => (
      Math.abs(candidate - 1) < Math.abs(best - 1) ? candidate : best
    )),
  };

  function report(state, message, details = {}) {
    try {
      statusCallback(Object.freeze({ source: 'sampler', state, message, ...details }));
    } catch {
      // Host UI callbacks never own sampler lifecycle.
    }
  }

  function fail(nextError, state = 'error') {
    error = nextError?.message || String(nextError || 'sampler unavailable');
    report(state, error);
  }

  function serializeStorage(operation) {
    const result = storageTail.then(operation, operation);
    storageTail = result.catch(() => {});
    return result;
  }

  function closeDatabaseWhenIdle() {
    const tail = storageTail;
    tail.finally(() => {
      if (storageTail !== tail) {
        closeDatabaseWhenIdle();
        return;
      }
      database?.close?.();
      database = null;
      databasePromise = null;
    });
  }

  function openDatabase() {
    if (database) return Promise.resolve(database);
    if (databasePromise) return databasePromise;
    if (destroyed) return Promise.reject(new Error('sampler destroyed'));

    databasePromise = new Promise((resolve, reject) => {
      let request;
      try {
        request = IndexedDB.open(sampler.dbName, sampler.dbVersion);
      } catch (openError) {
        reject(openError);
        return;
      }
      request.onupgradeneeded = () => {
        const nextDatabase = request.result;
        if (!hasStore(nextDatabase, sampler.dbStore)) {
          const store = nextDatabase.createObjectStore(sampler.dbStore, { keyPath: 'id' });
          store.createIndex?.('createdAt', 'createdAt');
        }
      };
      request.onsuccess = () => {
        database = request.result;
        resolve(database);
      };
      request.onerror = () => reject(requestError(request, 'sampler database open failed'));
    }).catch((openError) => {
      databasePromise = null;
      throw openError;
    });
    return databasePromise;
  }

  async function useStore(mode, issue) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      let transaction;
      let result;
      let settled = false;
      const rejectOnce = (transactionError) => {
        if (settled) return;
        settled = true;
        reject(transactionError);
      };
      try {
        transaction = db.transaction(sampler.dbStore, mode);
        transaction.oncomplete = () => {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        transaction.onerror = () => rejectOnce(transaction.error || new Error('sampler transaction failed'));
        transaction.onabort = () => rejectOnce(transaction.error || new Error('sampler transaction aborted'));
        const request = issue(transaction.objectStore(sampler.dbStore));
        if (request) {
          request.onsuccess = () => { result = request.result; };
          request.onerror = () => rejectOnce(requestError(request, 'sampler request failed'));
        }
      } catch (transactionError) {
        rejectOnce(transactionError);
      }
    });
  }

  function getAllRecords() {
    return useStore('readonly', (store) => store.getAll());
  }

  function putRecord(record) {
    return useStore('readwrite', (store) => store.put(record));
  }

  function deleteRecords(ids) {
    if (ids.length === 0) return Promise.resolve();
    return useStore('readwrite', (store) => {
      for (const id of ids) store.delete(id);
      return null;
    });
  }

  function settleRequest(request, result) {
    if (!request || request.settled) return;
    request.settled = true;
    request.resolve(result);
  }

  function stopLane(lane) {
    if (!lane) return;
    const source = lane.source;
    lane.source = null;
    lane.clipId = null;
    lane.startedAt = -Infinity;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* BufferSource may already be stopped. */ }
      try { source.disconnect(); } catch { /* Already disconnected. */ }
    }
    const time = audioContext?.currentTime || 0;
    setParamNow(lane.gain?.gain, 0, time);
  }

  function removeRuntimeClip(id) {
    bufferCache.delete(id);
    decodeTasks.delete(id);
    if (graph) {
      for (const lane of graph.lanes) {
        if (lane.clipId === id) stopLane(lane);
      }
    }
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index].clipId !== id) continue;
      settleRequest(queue[index], false);
      queue.splice(index, 1);
    }
    if (currentRequest?.clipId === id) settleRequest(currentRequest, false);
  }

  function prune(records) {
    const kept = records.slice().sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const removed = [];
    let totalBytes = kept.reduce((total, record) => total + record.size, 0);
    while (kept.length > sampler.maxClips || totalBytes > sampler.maxBytes) {
      const record = kept.shift();
      totalBytes -= record.size;
      removed.push(record);
    }
    return { kept, removed, totalBytes };
  }

  async function syncLibrary() {
    const rawRecords = await getAllRecords();
    if (destroyed) return [];
    const normalized = [];
    const invalidIds = [];
    for (const rawRecord of rawRecords || []) {
      const record = normalizeRecord(rawRecord, sampler);
      if (record) normalized.push(record);
      else if (rawRecord?.id) invalidIds.push(String(rawRecord.id));
    }
    const { kept, removed } = prune(normalized);
    const removedIds = [...invalidIds, ...removed.map((record) => record.id)];
    if (removedIds.length) await deleteRecords(removedIds);
    if (destroyed) return [];

    const keptIds = new Set(kept.map((record) => record.id));
    for (const existingId of clips.keys()) {
      if (!keptIds.has(existingId)) removeRuntimeClip(existingId);
    }
    clips.clear();
    for (const record of kept) clips.set(record.id, record);
    if (removedIds.length) report('pruned', `pruned ${removedIds.length} local clip(s)`);
    error = '';
    return listClips();
  }

  async function loadClips() {
    if (destroyed) return [];
    try {
      const loaded = await serializeStorage(syncLibrary);
      report('ready', `loaded ${loaded.length} local clip(s)`);
      return loaded;
    } catch (loadError) {
      fail(loadError, 'storage-unavailable');
      return [];
    }
  }

  function listClips() {
    return Object.freeze([...clips.values()].map(publicClip));
  }

  async function persistClip(record) {
    await putRecord(record);
    await syncLibrary();
    return clips.has(record.id) ? publicClip(clips.get(record.id)) : null;
  }

  function importFileAllowed(file) {
    const type = String(file?.type || '').trim().toLowerCase();
    if (type && sampler.importMimeTypes.includes(type)) return true;
    const name = String(file?.name || '').trim().toLowerCase();
    const dot = name.lastIndexOf('.');
    const extension = dot >= 0 ? name.slice(dot + 1) : '';
    return Boolean(extension && sampler.importExtensions.includes(extension));
  }

  function importLabel(file, fallback) {
    const raw = String(file?.name || fallback || '').trim();
    const dot = raw.lastIndexOf('.');
    const base = dot > 0 ? raw.slice(0, dot) : raw;
    return boundedText(base || fallback, 48) || fallback;
  }

  async function decodeImportedClip(blob) {
    const context = await getAudioContext();
    if (!context || typeof context.decodeAudioData !== 'function') {
      throw new Error('local audio decode is unavailable');
    }
    const bytes = await blob.arrayBuffer();
    const buffer = await context.decodeAudioData(bytes);
    const duration = Number(buffer?.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('local audio file has no playable duration');
    }
    return { buffer, duration };
  }

  async function importClip(file, provenance = {}) {
    if (destroyed) return null;
    const blob = file;
    if (!blob || typeof blob.arrayBuffer !== 'function' || !Number.isFinite(blob.size) || blob.size <= 0) {
      fail(new Error('choose a non-empty local audio file'), 'import-invalid');
      return null;
    }
    if (blob.size > sampler.importMaxBytes) {
      fail(new Error(`import exceeds ${Math.round(sampler.importMaxBytes / (1024 * 1024))} MiB local limit`), 'import-too-large');
      return null;
    }
    if (!importFileAllowed(file)) {
      fail(new Error('unsupported local audio type'), 'import-unsupported');
      return null;
    }
    let decoded;
    try {
      decoded = await decodeImportedClip(blob);
    } catch (decodeError) {
      fail(decodeError, 'import-decode-error');
      return null;
    }
    if (destroyed) return null;
    try {
      return await serializeStorage(async () => {
        const createdAt = normalizeTimestamp(undefined, now);
        importSequence += 1;
        const record = {
          id: `import-${Math.trunc(createdAt)}-${importSequence}`,
          label: importLabel(file, `import ${String(importSequence).padStart(2, '0')}`),
          duration: decoded.duration,
          mimeType: String(blob.type || 'audio/*'),
          createdAt,
          size: blob.size,
          blob,
          provenance: normalizeProvenance({ ...provenance, kind: 'import', importedAt: createdAt }, sampler, 'import'),
        };
        const saved = await persistClip(record);
        if (saved && !destroyed && clips.has(record.id)) bufferCache.set(record.id, decoded.buffer);
        report(saved ? 'imported' : 'pruned', saved ? `imported ${saved.label} · local only` : 'import pruned by local limits');
        return saved;
      });
    } catch (importError) {
      fail(importError, 'import-error');
      return null;
    }
  }

  async function renameClip(id, label) {
    if (destroyed) return false;
    const clipId = String(id || '');
    const nextLabel = String(label || '').trim();
    if (!nextLabel || !clips.has(clipId)) return false;
    try {
      return await serializeStorage(async () => {
        const record = { ...clips.get(clipId), label: nextLabel };
        await putRecord(record);
        if (destroyed) return false;
        clips.set(clipId, record);
        report('renamed', `renamed ${clipId}`);
        return true;
      });
    } catch (renameError) {
      fail(renameError, 'storage-error');
      return false;
    }
  }

  async function deleteClip(id) {
    if (destroyed) return false;
    const clipId = String(id || '');
    const existed = clips.has(clipId);
    try {
      await serializeStorage(() => deleteRecords([clipId]));
      clips.delete(clipId);
      removeRuntimeClip(clipId);
      report('deleted', `deleted ${clipId}`);
      return existed;
    } catch (deleteError) {
      fail(deleteError, 'storage-error');
      return false;
    }
  }

  function applyRangeToGraph() {
    if (!graph || !audioContext) return;
    const time = audioContext.currentTime;
    setParamSmooth(graph.filter.frequency, range.filterHz, time, sampler.rangeSmoothingSeconds);
    setParamSmooth(graph.delaySend.gain, range.delaySend, time, sampler.rangeSmoothingSeconds);
    for (const lane of graph.lanes) {
      if (lane.source) {
        setParamSmooth(lane.source.playbackRate, range.playbackRate, time, sampler.rangeSmoothingSeconds);
      }
    }
  }

  function quantizePlaybackRate(value) {
    const bounded = clamp(value, sampler.playbackRateMin, sampler.playbackRateMax, range.playbackRate);
    return sampler.playbackRateRatios.reduce((best, candidate) => (
      Math.abs(candidate - bounded) < Math.abs(best - bounded) ? candidate : best
    ));
  }

  function createGraph(context, outputDestination = context.destination) {
    const filter = context.createBiquadFilter();
    const delaySend = context.createGain();
    const delay = context.createDelay(sampler.delayMaxSeconds);
    const compressor = context.createDynamicsCompressor();
    const limiter = context.createDynamicsCompressor();
    const master = context.createGain();
    const lanes = [];

    filter.type = 'lowpass';
    filter.frequency.value = range.filterHz;
    filter.Q.value = sampler.filterQ;
    delaySend.gain.value = range.delaySend;
    delay.delayTime.value = clamp(sampler.delaySeconds, 0, sampler.delayMaxSeconds);
    configureDynamics(compressor, sampler.compressor);
    configureDynamics(limiter, sampler.limiter);
    master.gain.value = 0;

    filter.connect(compressor);
    filter.connect(delaySend);
    delaySend.connect(delay);
    delay.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(master);
    master.connect(outputDestination);

    for (let index = 0; index < sampler.maxVoices; index += 1) {
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(filter);
      lanes.push({ index, gain, source: null, clipId: null, startedAt: -Infinity });
    }
    return { filter, delaySend, delay, compressor, limiter, master, lanes };
  }

  function disconnectGraph() {
    if (!graph) return;
    setParamNow(graph.master.gain, 0, audioContext?.currentTime || 0);
    outputLevel = 0;
    for (const lane of graph.lanes) stopLane(lane);
    const nodes = [
      ...graph.lanes.map((lane) => lane.gain),
      graph.filter,
      graph.delaySend,
      graph.delay,
      graph.compressor,
      graph.limiter,
      graph.master,
    ];
    for (const node of nodes) {
      try { node.disconnect(); } catch { /* Resource may already be disconnected. */ }
    }
    graph = null;
  }

  async function arm() {
    if (destroyed) return false;
    if (armed && graph) return true;
    if (armPromise) return armPromise;
    const generation = armGeneration;
    armPromise = (async () => {
      try {
        const context = await getAudioContext();
        if (destroyed || generation !== armGeneration) return false;
        if (!context || context.state === 'closed') throw new Error('shared AudioContext is unavailable');
        if (context.state === 'suspended' && typeof context.resume === 'function') await context.resume();
        if (destroyed || generation !== armGeneration) return false;
        if (context.state && context.state !== 'running') throw new Error(`shared AudioContext is ${context.state}`);
        audioContext = context;
        const outputDestination = typeof getOutputDestination === 'function'
          ? await getOutputDestination()
          : context.destination;
        if (destroyed || generation !== armGeneration) return false;
        graph = createGraph(context, outputDestination || context.destination);
        armed = true;
        outputLevel = 0;
        error = '';
        report('armed', 'sampler armed · local playback ready');
        return true;
      } catch (armError) {
        disconnectGraph();
        armed = false;
        fail(armError, 'unavailable');
        return false;
      }
    })();
    try {
      return await armPromise;
    } finally {
      armPromise = null;
    }
  }

  function chooseRecorderMimeType() {
    if (typeof MediaRecorder.isTypeSupported !== 'function') return '';
    return sampler.recorderMimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  function finalizeDiscardedRecording(session) {
    if (!session || session.settled) return;
    session.settled = true;
    clearTimer(session.timer);
    session.timer = null;
    session.chunks.length = 0;
    session.resolve(null);
  }

  async function finalizeRecording(session) {
    if (!session || session.finishing || session.settled) return session?.done || null;
    session.finishing = true;
    clearTimer(session.timer);
    session.timer = null;

    if (session.discard || destroyed || session.chunks.length === 0) {
      if (recording === session) recording = null;
      finalizeDiscardedRecording(session);
      report('idle', session.discard ? 'recording discarded' : 'recording empty');
      return null;
    }

    try {
      const mimeType = session.chunks[0].type || session.mimeType || 'audio/webm';
      const blob = new Blob(session.chunks, { type: mimeType });
      if (blob.size > sampler.maxBytes) throw new Error('recording exceeds local sampler capacity');
      recordingSequence += 1;
      const createdAt = normalizeTimestamp(undefined, now);
      const record = {
        id: `local-${Math.trunc(createdAt)}-${recordingSequence}`,
        label: session.label || `${sampler.labelPrefix} ${String(recordingSequence).padStart(2, '0')}`,
        duration: Math.min(sampler.recordLimitMs, Math.max(0, createdAt - session.startedAt)) / 1000,
        mimeType,
        createdAt,
        size: blob.size,
        blob,
        provenance: normalizeProvenance({ kind: 'recording', importedAt: createdAt }, sampler, 'recording'),
      };
      const saved = await serializeStorage(() => persistClip(record));
      if (session.discard || destroyed) {
        await serializeStorage(() => deleteRecords([record.id]));
        clips.delete(record.id);
        removeRuntimeClip(record.id);
        if (recording === session) recording = null;
        finalizeDiscardedRecording(session);
        return null;
      }
      if (recording === session) recording = null;
      session.settled = true;
      session.chunks.length = 0;
      session.resolve(saved);
      report('saved', saved ? `saved ${saved.label}` : 'recording pruned by local limits');
      return saved;
    } catch (recordError) {
      fail(recordError, 'record-error');
      if (recording === session) recording = null;
      session.settled = true;
      session.chunks.length = 0;
      session.resolve(null);
      return null;
    }
  }

  async function startRecording(label = '') {
    if (destroyed || recording || recordingStart) return false;
    const token = { generation: recordingGeneration };
    recordingStart = token;
    try {
      const stream = await getMicStream();
      if (destroyed || token.generation !== recordingGeneration) return false;
      if (!stream) throw new Error('microphone stream unavailable');
      const mimeType = chooseRecorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      let resolveDone;
      const done = new Promise((resolve) => { resolveDone = resolve; });
      const session = {
        recorder,
        label: String(label || '').trim(),
        mimeType,
        chunks: [],
        startedAt: normalizeTimestamp(undefined, now),
        timer: null,
        finishing: false,
        discard: false,
        settled: false,
        resolve: resolveDone,
        done,
      };
      recorder.ondataavailable = (event) => {
        if (!session.discard && event?.data?.size) session.chunks.push(event.data);
      };
      recorder.onstop = () => { void finalizeRecording(session); };
      recorder.onerror = (event) => {
        session.discard = true;
        fail(event?.error || new Error('MediaRecorder failed'), 'record-error');
        finalizeDiscardedRecording(session);
        if (recording === session) recording = null;
      };
      recorder.start();
      recording = session;
      session.timer = setTimer(() => { void stopRecording(); }, sampler.recordLimitMs);
      report('recording', `recording · ${sampler.recordLimitMs / 1000}s cap`);
      return true;
    } catch (recordError) {
      fail(recordError, 'record-unavailable');
      return false;
    } finally {
      if (recordingStart === token) recordingStart = null;
    }
  }

  function stopRecording() {
    const session = recording;
    if (!session) return Promise.resolve(null);
    clearTimer(session.timer);
    session.timer = null;
    try {
      if (session.recorder.state !== 'inactive') session.recorder.stop();
    } catch (stopError) {
      session.discard = true;
      fail(stopError, 'record-error');
      finalizeDiscardedRecording(session);
      recording = null;
    }
    return session.done;
  }

  async function toggleRecording(label = '') {
    if (recording) return stopRecording();
    return startRecording(label);
  }

  function discardRecording() {
    const session = recording;
    if (!session) return;
    recording = null;
    session.discard = true;
    clearTimer(session.timer);
    session.timer = null;
    session.recorder.ondataavailable = null;
    session.recorder.onstop = null;
    session.recorder.onerror = null;
    try {
      if (session.recorder.state !== 'inactive') session.recorder.stop();
    } catch {
      // Panic still owns silence even if the recorder was already ending.
    }
    finalizeDiscardedRecording(session);
  }

  async function decodeClip(id) {
    if (bufferCache.has(id)) return bufferCache.get(id);
    if (decodeTasks.has(id)) return decodeTasks.get(id);
    const record = clips.get(id);
    if (!record || !audioContext) return null;
    const task = (async () => {
      const bytes = await record.blob.arrayBuffer();
      const buffer = await audioContext.decodeAudioData(bytes);
      if (!destroyed && clips.has(id)) bufferCache.set(id, buffer);
      return clips.has(id) ? buffer : null;
    })().finally(() => decodeTasks.delete(id));
    decodeTasks.set(id, task);
    return task;
  }

  function selectClip(event) {
    if (event.clipId !== undefined && clips.has(String(event.clipId))) return String(event.clipId);
    const ids = [...clips.keys()];
    if (ids.length === 0) return null;
    const slot = Math.trunc(Number(event.slot));
    const index = Number.isFinite(slot) ? ((slot % ids.length) + ids.length) % ids.length : 0;
    return ids[index];
  }

  function chooseLane() {
    const free = graph.lanes.find((lane) => !lane.source);
    if (free) return free;
    return graph.lanes.reduce((oldest, lane) => (
      lane.startedAt < oldest.startedAt ? lane : oldest
    ));
  }

  function playRequest(request, buffer) {
    if (!graph || !armed || destroyed || !buffer) return false;
    const duration = Number(buffer.duration);
    if (!Number.isFinite(duration) || duration <= 0) return false;

    const contextTime = audioContext.currentTime;
    const lane = chooseLane();
    stopLane(lane);
    const source = audioContext.createBufferSource();
    const rate = quantizePlaybackRate(request.playbackRate);
    const offset = clamp(request.offsetSeconds, 0, Math.max(0, duration - Number.EPSILON), 0);
    const playable = Math.max(0, duration - offset);
    const segmentDuration = clamp(request.durationSeconds, Number.EPSILON, playable, playable);
    const velocity = clamp(request.velocity, 0, 1, 1) * sampler.voiceGain;
    const attackEnd = Math.min(contextTime + sampler.attackSeconds, contextTime + segmentDuration);
    const releaseStart = Math.max(attackEnd, contextTime + segmentDuration - sampler.releaseSeconds);

    source.buffer = buffer;
    setParamNow(source.playbackRate, rate, contextTime);
    setParamNow(lane.gain.gain, 0, contextTime);
    if (typeof lane.gain.gain.linearRampToValueAtTime === 'function') {
      lane.gain.gain.linearRampToValueAtTime(velocity, attackEnd);
      lane.gain.gain.setValueAtTime?.(velocity, releaseStart);
      lane.gain.gain.linearRampToValueAtTime(0, contextTime + segmentDuration);
    } else {
      lane.gain.gain.value = velocity;
    }

    lane.source = source;
    lane.clipId = request.clipId;
    lane.startedAt = request.sequence;
    source.onended = () => {
      if (lane.source !== source) return;
      source.onended = null;
      try { source.disconnect(); } catch { /* Already disconnected. */ }
      lane.source = null;
      lane.clipId = null;
      lane.startedAt = -Infinity;
      setParamNow(lane.gain.gain, 0, audioContext?.currentTime || 0);
    };
    source.connect(lane.gain);
    source.start(contextTime, offset, segmentDuration);
    setParamNow(graph.master.gain, sampler.masterGain, contextTime);
    outputLevel = sampler.masterGain;
    lastEventAt = request.timestamp;
    report('triggered', `triggered ${clips.get(request.clipId)?.label || request.clipId}`, {
      clipId: request.clipId,
      playbackRate: rate,
    });
    return true;
  }

  async function drainQueue() {
    if (draining) return;
    draining = true;
    while (queue.length) {
      const request = queue.shift();
      currentRequest = request;
      if (request.generation !== triggerGeneration || destroyed || !armed || !clips.has(request.clipId)) {
        settleRequest(request, false);
        continue;
      }
      try {
        const buffer = await decodeClip(request.clipId);
        const valid = request.generation === triggerGeneration
          && !destroyed && armed && clips.has(request.clipId);
        settleRequest(request, valid ? playRequest(request, buffer) : false);
      } catch (decodeError) {
        fail(decodeError, 'decode-error');
        settleRequest(request, false);
      }
    }
    currentRequest = null;
    draining = false;
  }

  function trigger(event = {}) {
    if (destroyed || !armed || !graph || event.kind !== 'event' || event.edge !== true) {
      return Promise.resolve(false);
    }
    const clipId = selectClip(event);
    if (!clipId || queue.length >= sampler.queueLimit) return Promise.resolve(false);
    const timestamp = normalizeTimestamp(event.timestamp, now);
    const cooldownMs = clamp(
      event.cooldownMs,
      sampler.minCooldownMs,
      sampler.maxCooldownMs,
      sampler.defaultCooldownMs,
    );
    const key = String(event.key || `${event.source || 'event'}:${clipId}`);
    const previous = cooldowns.get(key);
    if (previous !== undefined && timestamp - previous < cooldownMs) return Promise.resolve(false);
    cooldowns.set(key, timestamp);
    triggerSequence += 1;

    return new Promise((resolve) => {
      queue.push({
        clipId,
        timestamp,
        generation: triggerGeneration,
        sequence: triggerSequence,
        velocity: event.velocity,
        playbackRate: event.playbackRate ?? range.playbackRate,
        offsetSeconds: event.offsetSeconds,
        durationSeconds: event.durationSeconds,
        settled: false,
        resolve,
      });
      void drainQueue();
    });
  }

  function updateRanges(values = {}, timestamp) {
    if (destroyed) return false;
    const updateAt = normalizeTimestamp(timestamp, now);
    if (updateAt - lastRangeAt < sampler.rangeIntervalMs) return false;
    lastRangeAt = updateAt;
    const filterControl = clamp(values.filter, 0, 1, 0);
    const sendControl = clamp(values.delaySend, 0, 1, 0);
    const rateControl = clamp(values.playbackRate, 0, 1, 0.5);
    range.filterHz = sampler.filterMinHz
      + (sampler.filterMaxHz - sampler.filterMinHz) * filterControl;
    range.delaySend = sampler.delaySendMin
      + (sampler.delaySendMax - sampler.delaySendMin) * sendControl;
    range.playbackRate = quantizePlaybackRate(
      sampler.playbackRateMin
      + (sampler.playbackRateMax - sampler.playbackRateMin) * rateControl,
    );
    applyRangeToGraph();
    return true;
  }

  function clearTriggerState() {
    triggerGeneration += 1;
    for (const request of queue.splice(0)) settleRequest(request, false);
    settleRequest(currentRequest, false);
    cooldowns.clear();
    lastEventAt = null;
  }

  function panic() {
    if (destroyed) return getState();
    armGeneration += 1;
    recordingGeneration += 1;
    recordingStart = null;
    discardRecording();
    clearTriggerState();
    if (graph) setParamNow(graph.master.gain, 0, audioContext?.currentTime || 0);
    outputLevel = 0;
    disconnectGraph();
    armed = false;
    report('panic', 'panic · sampler disarmed and exactly silent');
    return getState();
  }

  function getState() {
    const activeVoices = graph ? graph.lanes.filter((lane) => lane.source).length : 0;
    const totalBytes = [...clips.values()].reduce((total, clip) => total + clip.size, 0);
    return Object.freeze({
      armed,
      recording: Boolean(recording),
      destroyed,
      silent: outputLevel === 0 || activeVoices === 0,
      masterGain: outputLevel,
      clipCount: clips.size,
      totalBytes,
      decodedCount: bufferCache.size,
      activeVoices,
      queuedEvents: queue.length + (currentRequest && !currentRequest.settled ? 1 : 0),
      lastEventAt,
      range: Object.freeze({ ...range }),
      error,
    });
  }

  function destroy() {
    if (destroyed) return;
    armGeneration += 1;
    recordingGeneration += 1;
    recordingStart = null;
    discardRecording();
    clearTriggerState();
    disconnectGraph();
    armed = false;
    destroyed = true;
    outputLevel = 0;
    bufferCache.clear();
    decodeTasks.clear();
    cooldowns.clear();
    clips.clear();
    if (database || databasePromise) closeDatabaseWhenIdle();
    audioContext = null;
    report('destroyed', 'sampler resources released');
  }

  return Object.freeze({
    arm,
    loadClips,
    listClips,
    importClip,
    startRecording,
    stopRecording,
    toggleRecording,
    renameClip,
    deleteClip,
    trigger,
    updateRanges,
    panic,
    getState,
    destroy,
  });
}
