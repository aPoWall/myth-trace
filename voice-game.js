function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
}

function safeDisconnect(node) {
  try { node?.disconnect?.(); } catch { /* an already-released node is silent */ }
}

function safeStop(source, when = 0) {
  try { source?.stop?.(when); } catch { /* an already-ended source is silent */ }
}

function setParam(param, value, at = 0) {
  if (!param) return;
  param.cancelScheduledValues?.(at);
  if (typeof param.setValueAtTime === 'function') param.setValueAtTime(value, at);
  else param.value = value;
}

export function normalizeVoiceGameSettings(input = {}, config = {}) {
  const presets = config.presets || {};
  const fallbackPreset = Object.hasOwn(presets, config.defaultPreset)
    ? config.defaultPreset : Object.keys(presets)[0] || 'slow-orbit';
  const requestedPreset = String(input.preset || '');
  const preset = Object.hasOwn(presets, requestedPreset) ? requestedPreset : fallbackPreset;
  const passOptions = Array.isArray(config.passOptions) && config.passOptions.length
    ? config.passOptions.map(value => Math.round(finite(value, 2))) : [2, 3];
  const requestedPasses = Math.round(finite(input.passes, config.defaultPasses || passOptions[0]));
  const passes = passOptions.includes(requestedPasses)
    ? requestedPasses : passOptions.includes(config.defaultPasses) ? config.defaultPasses : passOptions[0];
  return Object.freeze({ preset, passes });
}

export function createVoiceGame({
  config,
  getAudioContext,
  getMicStream,
  getVoiceOutput,
  onStatus = () => {},
  storage = globalThis.localStorage,
  MediaRecorderClass = globalThis.MediaRecorder,
  BlobClass = globalThis.Blob,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  if (!config?.presets || typeof getAudioContext !== 'function' || typeof getMicStream !== 'function') {
    throw new TypeError('createVoiceGame requires CONFIG.audio.voiceGame and private audio accessors');
  }

  let settings = normalizeVoiceGameSettings({}, config);
  try {
    const raw = storage?.getItem?.(config.storageKey);
    if (raw) settings = normalizeVoiceGameSettings(JSON.parse(raw), config);
  } catch { /* storage is optional; audio remains session-local */ }

  let destroyed = false;
  let recorder = null;
  let recorderStopPromise = null;
  let recorderStopResolve = null;
  let captureTimer = null;
  let captureStartedAt = 0;
  let captureChunks = [];
  let captureToken = 0;
  let discardCapture = false;
  let playAfterCapture = true;
  let graph = null;
  let graphContext = null;
  let slotSerial = 0;
  let runSerial = 0;
  let lastEvent = 'voice game ready · silent';
  const slots = [];
  const runs = [];

  const maxSlots = Math.max(1, Math.floor(finite(config.maxSlots, 3)));
  const maxRuns = Math.max(1, Math.floor(finite(config.maxConcurrentRuns, 3)));
  const minimumSeconds = Math.max(0.1, finite(config.minCaptureSeconds, 0.35));
  const maximumSeconds = Math.max(minimumSeconds, finite(config.maxCaptureSeconds, 7));

  function preset() {
    return config.presets[settings.preset] || config.presets[config.defaultPreset] || Object.values(config.presets)[0];
  }

  function publicState() {
    const recording = Boolean(recorder && recorder.state !== 'inactive');
    const activeRuns = runs.filter(run => run.active).length;
    return Object.freeze({
      preset: settings.preset,
      passes: settings.passes,
      recording,
      active: activeRuns > 0,
      activeRuns,
      energy: activeRuns > 0 ? clamp(finite(preset()?.visualEnergy, 0.24) * activeRuns, 0, 0.65) : 0,
      slots: Object.freeze(slots.map((slot, index) => Object.freeze({
        id: slot.id,
        index,
        duration: slot.duration,
        createdAt: slot.createdAt,
      }))),
      maxSlots,
      maxCaptureSeconds: maximumSeconds,
      lastEvent,
      supported: Boolean(MediaRecorderClass && BlobClass),
      destroyed,
    });
  }

  function report(message) {
    lastEvent = String(message || lastEvent);
    try { onStatus({ source: 'voice-game', message: lastEvent, ...publicState() }); } catch { /* UI cannot break DSP */ }
  }

  function persist() {
    try { storage?.setItem?.(config.storageKey, JSON.stringify(settings)); } catch { /* session state remains valid */ }
  }

  function setPreset(presetId) {
    settings = normalizeVoiceGameSettings({ ...settings, preset: presetId }, config);
    persist();
    if (graph) applyPresetToGraph();
    report(`voice game · ${settings.preset} selected · sound unchanged`);
    return publicState();
  }

  function setPasses(count) {
    settings = normalizeVoiceGameSettings({ ...settings, passes: count }, config);
    persist();
    report(`voice game · ${settings.passes} finite passes · sound unchanged`);
    return publicState();
  }

  function disconnectGraph() {
    if (!graph) return;
    setParam(graph.master?.gain, 0, finite(graphContext?.currentTime, 0));
    for (const node of Object.values(graph)) safeDisconnect(node);
    graph = null;
    graphContext = null;
  }

  function applyPresetToGraph() {
    if (!graph || !graphContext) return;
    const values = preset();
    const time = finite(graphContext.currentTime, 0);
    setParam(graph.highpass.frequency, finite(values.highpassHz, 100), time);
    setParam(graph.lowpass.frequency, finite(values.lowpassHz, 6500), time);
    setParam(graph.delay.delayTime, finite(values.delaySeconds, 0.26), time);
    setParam(graph.feedback.gain, clamp(values.feedback, 0, 0.64), time);
    setParam(graph.wet.gain, clamp(values.wet, 0, 0.5), time);
    setParam(graph.dry.gain, clamp(values.dry, 0, 1), time);
    setParam(graph.compressor.threshold, finite(values.compressorThreshold, -24), time);
    setParam(graph.compressor.knee, finite(values.compressorKnee, 18), time);
    setParam(graph.compressor.ratio, finite(values.compressorRatio, 4), time);
    setParam(graph.compressor.attack, finite(values.compressorAttack, 0.01), time);
    setParam(graph.compressor.release, finite(values.compressorRelease, 0.18), time);
    setParam(graph.master.gain, clamp(values.gain, 0, finite(config.maxGain, 0.24)), time);
  }

  function ensureGraph(context, output = context.destination) {
    if (graph && graphContext === context) return graph;
    disconnectGraph();
    const highpass = context.createBiquadFilter();
    const lowpass = context.createBiquadFilter();
    const dry = context.createGain();
    const delay = context.createDelay(finite(config.maxDelaySeconds, 1.2));
    const feedback = context.createGain();
    const wet = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const master = context.createGain();
    highpass.type = 'highpass';
    lowpass.type = 'lowpass';
    master.gain.value = 0;
    highpass.connect(lowpass);
    lowpass.connect(dry);
    dry.connect(compressor);
    lowpass.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(compressor);
    compressor.connect(master);
    master.connect(output);
    graph = { highpass, lowpass, dry, delay, feedback, wet, compressor, master };
    graphContext = context;
    applyPresetToGraph();
    return graph;
  }

  function stopRun(run, reason = 'released') {
    if (!run?.active) return;
    run.active = false;
    if (run.timer !== null) clearTimer?.(run.timer);
    run.timer = null;
    for (const voice of run.voices) {
      safeStop(voice.source);
      safeDisconnect(voice.source);
      safeDisconnect(voice.gain);
    }
    run.voices.length = 0;
    if (reason) lastEvent = `voice phrase ${run.slotId} · ${reason}`;
  }

  function compactRuns() {
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      if (!runs[index].active) runs.splice(index, 1);
    }
  }

  function stopPlayback(reason = 'released · exact silence') {
    for (const run of runs) stopRun(run, 'released');
    compactRuns();
    disconnectGraph();
    report(`voice game · ${reason}`);
    return publicState();
  }

  async function playSlot(slotId) {
    if (destroyed) return publicState();
    const slot = slots.find(item => item.id === String(slotId))
      || slots[Math.max(0, Math.min(slots.length - 1, Math.floor(finite(slotId, 0))))];
    if (!slot) {
      report('voice game · empty slot · silent');
      return publicState();
    }
    const shared = typeof getVoiceOutput === 'function' ? await getVoiceOutput().catch(() => null) : null;
    if (destroyed || !slots.includes(slot)) return publicState();
    const context = shared?.context || getAudioContext();
    if (!context) {
      report('voice game · start MIC + VOICE first');
      return publicState();
    }
    if (context.state !== 'running') await context.resume?.();
    if (context.state !== 'running') {
      report(`voice game · AudioContext ${context.state || 'unavailable'} · silent`);
      return publicState();
    }

    compactRuns();
    if (runs.length >= maxRuns) {
      stopRun(runs[0], 'oldest run released');
      compactRuns();
    }
    const values = preset();
    const route = ensureGraph(context, shared?.output || context.destination);
    const playbackRate = clamp(values.playbackRate, 0.5, 1.25);
    const passDuration = Math.max(0.05, slot.duration / playbackRate);
    const gap = Math.max(0, finite(values.gapSeconds, 0.18));
    const waitSeconds = finite(values.replySeconds, .025);
    const startAt = finite(context.currentTime, 0) + waitSeconds;
    const run = { id: `run-${++runSerial}`, slotId: slot.id, active: true, voices: [], timer: null };
    runs.push(run);

    for (let pass = 0; pass < settings.passes; pass += 1) {
      const source = context.createBufferSource();
      const gain = context.createGain();
      const when = startAt + pass * (passDuration + gap);
      const endAt = when + passDuration;
      source.buffer = slot.buffer;
      source.loop = false;
      setParam(source.playbackRate, values.replySeconds && pass % 2 ? playbackRate * .91 : playbackRate, when);
      if (source.detune) setParam(source.detune, finite(values.detuneCents, 0) * pass, when);
      setParam(gain.gain, 0, when);
      gain.gain.linearRampToValueAtTime?.(1, when + 0.025);
      gain.gain.setValueAtTime?.(1, Math.max(when + 0.025, endAt - 0.09));
      gain.gain.linearRampToValueAtTime?.(0, endAt);
      source.connect(gain);
      gain.connect(route.highpass);
      source.onended = () => {
        safeDisconnect(source);
        safeDisconnect(gain);
      };
      source.start(when);
      source.stop(endAt + 0.02);
      run.voices.push({ source, gain });
    }

    const totalSeconds = settings.passes * passDuration + (settings.passes - 1) * gap;
    run.timer = setTimer?.(() => {
      run.active = false;
      run.timer = null;
      run.voices.length = 0;
      compactRuns();
      if (!runs.length) disconnectGraph();
      report(`voice phrase ${slot.id} complete · ${settings.passes} passes`);
    }, Math.ceil((waitSeconds + totalSeconds + (values.replySeconds ? .54 : .08)) * 1000)) ?? null;
    report(`voice phrase ${slot.id} · ${settings.preset} · ${settings.passes} passes`);
    return publicState();
  }

  function chooseMimeType() {
    const candidates = Array.isArray(config.mimeTypes) ? config.mimeTypes : [];
    return candidates.find(type => MediaRecorderClass?.isTypeSupported?.(type)) || '';
  }

  async function decodeCapture(chunks, mimeType, token, shouldPlay) {
    if (destroyed || discardCapture || token !== captureToken || !chunks.length) return publicState();
    const context = getAudioContext();
    if (!context?.decodeAudioData || !BlobClass) {
      report('voice game · local audio decode unavailable · silent');
      return publicState();
    }
    try {
      const blob = new BlobClass(chunks, mimeType ? { type: mimeType } : undefined);
      const arrayBuffer = await blob.arrayBuffer();
      if (destroyed || discardCapture || token !== captureToken) return publicState();
      const buffer = await context.decodeAudioData(arrayBuffer.slice(0));
      const duration = finite(buffer?.duration, 0);
      if (duration < minimumSeconds) {
        report(`voice game · phrase too short · minimum ${minimumSeconds.toFixed(2)}s`);
        return publicState();
      }
      const slot = {
        id: `phrase-${++slotSerial}`,
        buffer,
        duration: Math.min(duration, maximumSeconds),
        createdAt: Date.now(),
      };
      if (slots.length >= maxSlots) slots.shift();
      slots.push(slot);
      report(`voice phrase ${slot.id} caught · ${slot.duration.toFixed(1)}s · ${slots.length}/${maxSlots}`);
      if (shouldPlay) await playSlot(slot.id);
    } catch (error) {
      report(`voice game · decode failed · ${error?.message || 'silent'}`);
    }
    return publicState();
  }

  async function startCapture() {
    if (destroyed) return publicState();
    if (recorder && recorder.state !== 'inactive') return publicState();
    const stream = getMicStream();
    const liveTrack = stream?.getAudioTracks?.().find(track => track.readyState !== 'ended');
    if (!stream || !liveTrack) {
      report('voice game · start MIC + VOICE first');
      return publicState();
    }
    if (!MediaRecorderClass || !BlobClass) {
      report('voice game · MediaRecorder unavailable · silent');
      return publicState();
    }
    const mimeType = chooseMimeType();
    const token = ++captureToken;
    captureChunks = [];
    discardCapture = false;
    playAfterCapture = true;
    captureStartedAt = now();
    recorder = mimeType ? new MediaRecorderClass(stream, { mimeType }) : new MediaRecorderClass(stream);
    recorderStopPromise = new Promise(resolve => { recorderStopResolve = resolve; });
    recorder.ondataavailable = event => {
      if (token !== captureToken || discardCapture || !event?.data || event.data.size <= 0) return;
      captureChunks.push(event.data);
    };
    recorder.onerror = event => {
      report(`voice game · recorder error · ${event?.error?.message || 'silent'}`);
    };
    recorder.onstop = async () => {
      const chunks = captureChunks;
      const shouldPlay = playAfterCapture;
      const currentMime = recorder?.mimeType || mimeType;
      recorder = null;
      captureChunks = [];
      if (captureTimer !== null) clearTimer?.(captureTimer);
      captureTimer = null;
      await decodeCapture(chunks, currentMime, token, shouldPlay);
      recorderStopResolve?.(publicState());
      recorderStopResolve = null;
      recorderStopPromise = null;
    };
    recorder.start(120);
    captureTimer = setTimer?.(() => { void stopCapture({ play: true, reason: 'maximum phrase reached' }); }, maximumSeconds * 1000) ?? null;
    report(`voice game recording · sing or speak · max ${maximumSeconds.toFixed(0)}s`);
    return publicState();
  }

  async function stopCapture({ play = true, reason = 'finish + play' } = {}) {
    if (!recorder || recorder.state === 'inactive') return publicState();
    playAfterCapture = Boolean(play);
    discardCapture = !play;
    if (captureTimer !== null) clearTimer?.(captureTimer);
    captureTimer = null;
    const elapsed = Math.max(0, (now() - captureStartedAt) / 1000);
    recorder.stop();
    report(play ? `voice game · ${reason} · decoding ${elapsed.toFixed(1)}s locally` : 'voice game capture discarded');
    return recorderStopPromise || publicState();
  }

  function clear(reason = 'released all · exact silence') {
    captureToken += 1;
    discardCapture = true;
    playAfterCapture = false;
    if (captureTimer !== null) clearTimer?.(captureTimer);
    captureTimer = null;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* recorder teardown remains silent */ }
    }
    stopPlayback(reason);
    slots.length = 0;
    report(`voice game · ${reason} · slots empty`);
    return publicState();
  }

  function panic(reason = 'panic · exact silence') {
    captureToken += 1;
    discardCapture = true;
    playAfterCapture = false;
    if (captureTimer !== null) clearTimer?.(captureTimer);
    captureTimer = null;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* recorder teardown remains silent */ }
    }
    return stopPlayback(reason);
  }

  function destroy() {
    if (destroyed) return;
    panic('destroyed · exact silence');
    slots.length = 0;
    destroyed = true;
    report('voice game destroyed');
  }

  return {
    startCapture,
    stopCapture,
    playSlot,
    setPreset,
    setPasses,
    clear,
    panic,
    getState: publicState,
    destroy,
  };
}
