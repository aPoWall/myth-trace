function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function deviceKey(value) {
  return String(value || 'default').trim() || 'default';
}

export function createMicCalibration({ config, storage = null, now = () => Date.now() } = {}) {
  const settings = config?.audio?.calibration;
  if (!settings) throw new TypeError('createMicCalibration requires CONFIG.audio.calibration');
  const sampleIntervalMs = Math.max(1, finite(settings.sampleIntervalMs));
  const durationMs = Math.max(sampleIntervalMs, finite(settings.durationMs));
  const speechDurationMs = Math.max(sampleIntervalMs, finite(settings.speechDurationMs));
  const maxSamples = Math.max(1, Math.trunc(finite(settings.maxSamples)));
  const minSamples = Math.max(1, Math.min(maxSamples, Math.trunc(finite(settings.minSamples))));
  const floorPercentile = clamp(settings.floorPercentile);
  const floorMultiplier = Math.max(1, finite(settings.floorMultiplier, 1));
  const minFloor = clamp(settings.minFloor);
  const maxFloor = clamp(settings.maxFloor, minFloor, 1);
  const speechRatio = Math.max(1, finite(settings.speechRatio, 1));
  const minSpeechPeak = clamp(settings.minSpeechPeak);
  const peakHoldMs = Math.max(0, finite(settings.peakHoldMs));
  const peakDecayPerSecond = Math.max(0, finite(settings.peakDecayPerSecond));
  const storageKey = String(settings.storageKey || '').trim();
  if (!storageKey) throw new TypeError('CONFIG.audio.calibration.storageKey is required');

  const samples = new Float32Array(maxSamples);
  let selectedDevice = 'default';
  let receipts = Object.create(null);
  let phase = 'idle';
  let startedAt = -Infinity;
  let lastSampleAt = -Infinity;
  let lastPeakAt = -Infinity;
  let heldUntil = -Infinity;
  let sampleCount = 0;
  let currentRms = 0;
  let peakHold = 0;
  let speechPeak = 0;
  let lastEvent = 'mic calibration idle';
  let revision = 0;

  function load() {
    if (!storage?.getItem) return;
    try {
      const parsed = JSON.parse(storage.getItem(storageKey) || 'null');
      if (parsed?.version !== 1 || !parsed.devices || typeof parsed.devices !== 'object') return;
      receipts = Object.assign(Object.create(null), parsed.devices);
    } catch {
      receipts = Object.create(null);
    }
  }

  function persist() {
    if (!storage?.setItem) return;
    try {
      storage.setItem(storageKey, JSON.stringify({ version: 1, devices: receipts }));
    } catch {
      // Calibration remains usable for this session when storage is unavailable.
    }
  }

  function receipt() {
    const value = receipts[selectedDevice];
    return value && typeof value === 'object' ? value : null;
  }

  function restingPhase() {
    const saved = receipt();
    if (saved?.speechConfirmedAt) return 'confirmed';
    if (Number.isFinite(saved?.gateFloor)) return 'ready';
    return 'idle';
  }

  function touch(message) {
    lastEvent = message;
    revision += 1;
  }

  function selectDevice(value) {
    const next = deviceKey(value);
    if (next === selectedDevice) return getState();
    selectedDevice = next;
    phase = restingPhase();
    sampleCount = 0;
    speechPeak = 0;
    touch(receipt() ? 'saved room floor restored · run speech check if the room changed' : 'selected mic · calibration needed');
    return getState();
  }

  function startQuiet(timestamp = now()) {
    phase = 'quiet';
    startedAt = finite(timestamp, now());
    lastSampleAt = -Infinity;
    sampleCount = 0;
    speechPeak = 0;
    samples.fill(0);
    touch('quiet calibration · stay silent for 3 seconds');
    return getState();
  }

  function finishQuiet(timestamp) {
    if (sampleCount < minSamples) {
      phase = restingPhase();
      touch(`quiet calibration needs ${minSamples} live samples · try again`);
      return;
    }
    const sorted = Array.from(samples.subarray(0, sampleCount)).sort((a, b) => a - b);
    const percentileIndex = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * floorPercentile));
    const noiseFloor = clamp(sorted[percentileIndex]);
    const gateFloor = clamp(noiseFloor * floorMultiplier, minFloor, maxFloor);
    receipts[selectedDevice] = {
      noiseFloor,
      gateFloor,
      speechPeak: 0,
      speechConfirmedAt: 0,
      calibratedAt: finite(timestamp, now()),
      preset: 'clear',
    };
    persist();
    phase = 'ready';
    touch('room floor ready · say “one-two-three” in the speech check');
  }

  function startSpeech(timestamp = now()) {
    if (!Number.isFinite(receipt()?.gateFloor)) {
      touch('run quiet calibration before the speech check');
      return getState();
    }
    phase = 'speech';
    startedAt = finite(timestamp, now());
    speechPeak = 0;
    touch('speech check live · say “one-two-three” now');
    return getState();
  }

  function finishSpeech(timestamp) {
    const saved = receipt();
    if (!saved) {
      phase = 'idle';
      touch('speech check lost its room floor · calibrate again');
      return;
    }
    const threshold = Math.max(minSpeechPeak, saved.gateFloor * speechRatio);
    if (speechPeak < threshold) {
      phase = 'ready';
      saved.speechPeak = speechPeak;
      saved.speechConfirmedAt = 0;
      persist();
      touch('speech contrast too low · move closer or choose another mic');
      return;
    }
    phase = 'confirmed';
    saved.speechPeak = speechPeak;
    saved.speechConfirmedAt = finite(timestamp, now());
    saved.preset = 'clear';
    persist();
    touch('clear speech confirmed · browser input receipt saved locally');
  }

  function update({ timestamp = now(), rawRms = 0 } = {}) {
    const time = finite(timestamp, now());
    const rms = clamp(rawRms);
    const elapsedSeconds = Number.isFinite(lastPeakAt) ? Math.max(0, time - lastPeakAt) / 1000 : 0;
    lastPeakAt = time;
    currentRms = rms;
    if (rms >= peakHold) {
      peakHold = rms;
      heldUntil = time + peakHoldMs;
    } else if (time > heldUntil) {
      peakHold = Math.max(rms, peakHold * Math.exp(-peakDecayPerSecond * elapsedSeconds));
    }

    if (phase === 'quiet') {
      if (time - lastSampleAt >= sampleIntervalMs && sampleCount < samples.length) {
        samples[sampleCount] = rms;
        sampleCount += 1;
        lastSampleAt = time;
      }
      if (time - startedAt >= durationMs) finishQuiet(time);
    } else if (phase === 'speech') {
      speechPeak = Math.max(speechPeak, rms);
      if (time - startedAt >= speechDurationMs) finishSpeech(time);
    }
    return getState(time);
  }

  function cancel(reason = 'calibration cancelled') {
    if (phase === 'quiet' || phase === 'speech') {
      phase = restingPhase();
      sampleCount = 0;
      speechPeak = 0;
      touch(reason);
    }
    return getState();
  }

  function clear() {
    delete receipts[selectedDevice];
    persist();
    phase = 'idle';
    sampleCount = 0;
    speechPeak = 0;
    touch('mic room receipt cleared · default floor restored');
    return getState();
  }

  function getState(timestamp = now()) {
    const time = finite(timestamp, now());
    const saved = receipt();
    const duration = phase === 'speech' ? speechDurationMs : durationMs;
    const progress = phase === 'quiet' || phase === 'speech'
      ? clamp((time - startedAt) / duration)
      : 0;
    const gateFloor = Number.isFinite(saved?.gateFloor) ? clamp(saved.gateFloor, minFloor, maxFloor) : null;
    return Object.freeze({
      phase,
      active: phase === 'quiet' || phase === 'speech',
      deviceKey: selectedDevice,
      progress,
      sampleCount,
      currentRms,
      peakHold,
      noiseFloor: Number.isFinite(saved?.noiseFloor) ? clamp(saved.noiseFloor) : null,
      gateFloor,
      speechPeak: phase === 'speech' ? speechPeak : clamp(saved?.speechPeak),
      speechThreshold: gateFloor === null ? null : Math.max(minSpeechPeak, gateFloor * speechRatio),
      speechConfirmed: Boolean(saved?.speechConfirmedAt),
      preset: String(saved?.preset || 'clear'),
      calibratedAt: finite(saved?.calibratedAt),
      confirmedAt: finite(saved?.speechConfirmedAt),
      lastEvent,
      revision,
    });
  }

  load();
  phase = restingPhase();
  return Object.freeze({ selectDevice, startQuiet, startSpeech, update, cancel, clear, getState });
}
