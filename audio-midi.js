import { createVoiceGame } from './voice-game.js';

const MIDI_CC_MASTER = 7;
const MIDI_CC_SUSTAIN = 64;
const MIDI_PITCH_BEND_CENTER = 8192;
const MIDI_PITCH_BEND_MAX = 16383;

function clamp01(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function eventTimestamp(value) {
  if (Number.isFinite(value)) return value;
  return globalThis.performance?.now?.() ?? Date.now();
}

function describeError(error, source) {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return `${source} permission denied`;
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return `no ${source} device`;
  if (name === 'NotReadableError' || name === 'TrackStartError') return `${source} device unavailable`;
  if (name === 'AbortError') return `${source} request cancelled`;
  return error?.message ? `${source} unavailable · ${error.message}` : `${source} unavailable`;
}

export function createAudioMidiEngine({ config, onStatus, onEvent, onControl, getVoiceOutput }) {
  if (!config?.audio) throw new TypeError('createAudioMidiEngine requires config.audio');

  const audioConfig = config.audio;
  const monitorConfig = audioConfig.monitor || {};
  const diagnosticConfig = audioConfig.diagnostics || {};
  const statusCallback = typeof onStatus === 'function' ? onStatus : () => {};
  const eventCallback = typeof onEvent === 'function' ? onEvent : () => {};
  // Retain the frozen constructor key; V8 routes instrument CC through onEvent only.
  void onControl;

  function monitorBound(key, value) {
    const range = monitorConfig.bounds?.[key];
    const numeric = Number(value);
    if (!Array.isArray(range) || range.length < 2) return Number.isFinite(numeric) ? numeric : 0;
    const minimum = Number(range[0]);
    const maximum = Number(range[1]);
    return Math.min(maximum, Math.max(minimum, Number.isFinite(numeric) ? numeric : minimum));
  }

  function resolveMonitorPreset(requestedId) {
    const presets = monitorConfig.presets || {};
    const fallbackId = String(monitorConfig.defaultPreset || Object.keys(presets)[0] || 'clear');
    const candidateId = String(requestedId || '');
    const id = Object.hasOwn(presets, candidateId) ? candidateId : fallbackId;
    const preset = presets[id] || monitorConfig;
    const values = {};
    for (const key of [
      'gain', 'highpassHz', 'presenceHz', 'presenceDb', 'presenceQ', 'lowpassHz',
      'saturation', 'echoDelaySeconds', 'echoFeedback', 'echoWet',
      'compressorThreshold', 'compressorKnee', 'compressorRatio',
      'compressorAttack', 'compressorRelease',
    ]) values[key] = monitorBound(key, preset[key]);
    return { id, values };
  }

  const initialMonitorPreset = resolveMonitorPreset(monitorConfig.defaultPreset);
  const frame = {
    ts: 0,
    ready: false,
    micActive: false,
    micDeviceId: '',
    micDeviceLabel: '',
    monitorActive: false,
    monitorPreset: initialMonitorPreset.id,
    monitorWet: initialMonitorPreset.values.echoWet,
    monitorFeedback: initialMonitorPreset.values.echoFeedback,
    audioContextState: 'not-created',
    sampleRate: 0,
    baseLatencyMs: 0,
    outputLatencyMs: 0,
    estimatedLatencyMs: 0,
    latencySource: 'unavailable',
    latencyStatus: 'unavailable',
    inputPeak: 0,
    inputPeakHold: 0,
    inputPeakDb: Number(diagnosticConfig.floorDb) || -96,
    inputHeadroom: 'silent',
    clipActive: false,
    clipEvents: 0,
    clipSamples: 0,
    midiActive: false,
    rawRms: 0,
    rms: 0,
    micFloor: Number(config.audio.floor) || 0,
    bass: 0,
    mid: 0,
    high: 0,
    beat: 0,
    gate: 0,
    midiEnergy: 0,
    lastNote: null,
    cc: {},
    devices: [],
    activeNotes: Object.freeze([]),
    voiceGame: Object.freeze({
      preset: config.audio.voiceGame?.defaultPreset || 'slow-orbit',
      passes: config.audio.voiceGame?.defaultPasses || 2,
      recording: false,
      active: false,
      activeRuns: 0,
      energy: 0,
      slots: Object.freeze([]),
      maxSlots: config.audio.voiceGame?.maxSlots || 3,
      maxCaptureSeconds: config.audio.voiceGame?.maxCaptureSeconds || 7,
      lastEvent: 'voice game ready · silent',
      supported: Boolean(globalThis.MediaRecorder && globalThis.Blob),
      destroyed: false,
    }),
    error: '',
  };

  let destroyed = false;
  let audioContext = null;
  let micStream = null;
  let voiceGame = null;
  let micSource = null;
  let analyser = null;
  let timeFloats = null;
  let timeBytes = null;
  let frequencyBytes = null;
  let bassEnd = 0;
  let midEnd = 0;
  let micPromise = null;
  let micAboveFloor = false;
  let micError = '';
  let preferredMicDeviceId = '';
  let inputProfile = 'voice';
  let monitorEnabled = false;
  let monitorGraph = null;
  let monitorPresetId = initialMonitorPreset.id;
  let monitorPresetValues = initialMonitorPreset.values;
  let micFloor = clamp01(audioConfig.floor);
  let diagnosticLastAt = null;
  let diagnosticPeakHoldUntil = 0;
  let diagnosticClipHoldUntil = 0;

  let midiAccess = null;
  let midiRequest = null;
  let midiError = '';
  let midiBridge = null;
  let midiBridgeReady = false;
  let midiTarget = 0;
  let masterLevel = clamp01(audioConfig.master);
  let beatPending = 0;
  let lastUpdateAt = null;

  const activeNotes = new Map();
  const midiInputs = new Map();
  const midiBridgeDevices = new Set();
  const sustainChannels = new Set();
  const activeNoteLimit = Math.max(1, Math.floor(Number(config.music?.polyphony) || 8));

  function callSafely(callback, ...args) {
    try {
      callback(...args);
    } catch {
      // Host callbacks cannot break input sampling or leave energy latched.
    }
  }

  function report(source, state, active, message) {
    callSafely(statusCallback, { source, state, active, message });
  }

  voiceGame = audioConfig.voiceGame
    ? createVoiceGame({
      config: audioConfig.voiceGame,
      getAudioContext: () => audioContext,
      getMicStream: () => micStream,
      getVoiceOutput,
      onStatus: (status) => {
        frame.voiceGame = voiceGame?.getState?.() || frame.voiceGame;
        report('voice-game', status?.recording ? 'recording' : status?.active ? 'live' : 'idle',
          Boolean(status?.recording || status?.active), status?.message || 'voice game ready');
      },
    })
    : {
      startCapture: async () => frame.voiceGame,
      stopCapture: async () => frame.voiceGame,
      playSlot: async () => frame.voiceGame,
      setPreset: () => frame.voiceGame,
      setPasses: () => frame.voiceGame,
      clear: () => frame.voiceGame,
      panic: () => frame.voiceGame,
      getState: () => frame.voiceGame,
      destroy: () => {},
    };
  frame.voiceGame = voiceGame.getState();

  function refreshVoiceGameFrame() {
    frame.voiceGame = voiceGame?.getState?.() || frame.voiceGame;
    return frame.voiceGame;
  }

  function refreshError() {
    frame.error = [micError, midiError].filter(Boolean).join(' · ');
  }

  function refreshReady() {
    frame.ready = frame.micActive || midiAccess !== null || midiBridgeReady;
  }

  function clearMicMeasurements() {
    frame.rawRms = 0;
    frame.rms = 0;
    frame.bass = 0;
    frame.mid = 0;
    frame.high = 0;
    micAboveFloor = false;
  }

  function refreshAudioContextFacts() {
    frame.audioContextState = String(audioContext?.state || 'not-created');
    frame.sampleRate = Number.isFinite(Number(audioContext?.sampleRate))
      ? Math.max(0, Number(audioContext.sampleRate)) : 0;
    const baseLatencyMs = Number(audioContext?.baseLatency) * 1000;
    const outputLatencyMs = Number(audioContext?.outputLatency) * 1000;
    frame.baseLatencyMs = Number.isFinite(baseLatencyMs) && baseLatencyMs > 0 ? baseLatencyMs : 0;
    frame.outputLatencyMs = Number.isFinite(outputLatencyMs) && outputLatencyMs > 0 ? outputLatencyMs : 0;
    if (frame.baseLatencyMs > 0 && frame.outputLatencyMs > 0) {
      frame.estimatedLatencyMs = frame.baseLatencyMs + frame.outputLatencyMs;
      frame.latencySource = 'base+output';
    } else if (frame.baseLatencyMs > 0) {
      frame.estimatedLatencyMs = frame.baseLatencyMs;
      frame.latencySource = 'base-only';
    } else {
      frame.estimatedLatencyMs = 0;
      frame.latencySource = 'unavailable';
    }
    const goodMs = Math.max(0, Number(diagnosticConfig.latencyGoodMs) || 0);
    const watchMs = Math.max(goodMs, Number(diagnosticConfig.latencyWatchMs) || goodMs);
    frame.latencyStatus = frame.latencySource === 'unavailable'
      ? 'unavailable'
      : frame.estimatedLatencyMs <= goodMs ? 'good'
        : frame.estimatedLatencyMs <= watchMs ? 'watch' : 'high';
  }

  function updateInputDiagnostics(timestamp, peak, clippedSamples, live = true) {
    const now = eventTimestamp(timestamp);
    const elapsedSeconds = diagnosticLastAt === null ? 0 : Math.max(0, now - diagnosticLastAt) / 1000;
    diagnosticLastAt = now;
    const nextPeak = Number.isFinite(Number(peak)) ? clamp01(Number(peak)) : 0;
    frame.inputPeak = live ? nextPeak : 0;
    frame.clipSamples = live ? Math.max(0, Math.floor(Number(clippedSamples) || 0)) : 0;
    if (live && nextPeak >= frame.inputPeakHold) {
      frame.inputPeakHold = nextPeak;
      diagnosticPeakHoldUntil = now + Math.max(0, Number(diagnosticConfig.peakHoldMs) || 0);
    } else if (now >= diagnosticPeakHoldUntil) {
      const decay = Math.max(0, Number(diagnosticConfig.peakDecayPerSecond) || 0) * elapsedSeconds;
      frame.inputPeakHold = Math.max(nextPeak, frame.inputPeakHold - decay);
    }

    const clipped = live && frame.clipSamples >= Math.max(1, Math.floor(Number(diagnosticConfig.clipMinSamples) || 1));
    if (clipped) {
      if (!frame.clipActive || now >= diagnosticClipHoldUntil) frame.clipEvents += 1;
      diagnosticClipHoldUntil = now + Math.max(0, Number(diagnosticConfig.clipHoldMs) || 0);
      frame.clipActive = true;
    } else if (!live || now >= diagnosticClipHoldUntil) {
      frame.clipActive = false;
      if (!live) diagnosticClipHoldUntil = 0;
    }

    const floorDb = Number(diagnosticConfig.floorDb) || -96;
    frame.inputPeakDb = frame.inputPeakHold > 0
      ? Math.max(floorDb, 20 * Math.log10(frame.inputPeakHold)) : floorDb;
    const warn = clamp01(Number(diagnosticConfig.headroomWarnThreshold));
    frame.inputHeadroom = !live ? 'silent'
      : frame.clipActive ? 'clip'
        : frame.inputPeakHold >= warn ? 'near' : 'safe';
  }

  function resetAudioDiagnostics() {
    frame.inputPeak = 0;
    frame.inputPeakHold = 0;
    frame.inputPeakDb = Number(diagnosticConfig.floorDb) || -96;
    frame.inputHeadroom = frame.micActive ? 'safe' : 'silent';
    frame.clipActive = false;
    frame.clipEvents = 0;
    frame.clipSamples = 0;
    diagnosticLastAt = null;
    diagnosticPeakHoldUntil = 0;
    diagnosticClipHoldUntil = 0;
    refreshAudioContextFacts();
    return frame;
  }

  function disconnectMonitor() {
    for (const node of Object.values(monitorGraph || {})) node?.disconnect?.();
    monitorGraph = null;
    frame.monitorActive = false;
  }

  function makeMonitorCurve(amount = 0.18) {
    const curve = new Float32Array(1024);
    const drive = 8 + clamp01(amount) * 80;
    for (let index = 0; index < curve.length; index += 1) {
      const x = index * 2 / (curve.length - 1) - 1;
      curve[index] = Math.tanh(x * drive) / Math.tanh(drive);
    }
    return curve;
  }

  function setMonitorParam(param, value) {
    if (!param) return;
    const now = Number(audioContext?.currentTime) || 0;
    const transition = Math.max(0.001, Number(monitorConfig.transitionSeconds) || 0.001);
    param.cancelScheduledValues?.(now);
    if (typeof param.setTargetAtTime === 'function') param.setTargetAtTime(value, now, transition);
    else param.value = value;
  }

  function applyMonitorPresetToGraph() {
    const graph = monitorGraph;
    if (!graph) return;
    const values = monitorPresetValues;
    setMonitorParam(graph.highpass.frequency, values.highpassHz);
    setMonitorParam(graph.presence.frequency, values.presenceHz);
    setMonitorParam(graph.presence.gain, values.presenceDb);
    setMonitorParam(graph.presence.Q, values.presenceQ);
    setMonitorParam(graph.lowpass.frequency, values.lowpassHz);
    graph.shaper.curve = makeMonitorCurve(values.saturation);
    graph.shaper.oversample = '2x';
    setMonitorParam(graph.clean.gain, Math.cos(values.saturation * Math.PI * 0.5));
    setMonitorParam(graph.colour.gain, Math.sin(values.saturation * Math.PI * 0.5));
    setMonitorParam(graph.delay.delayTime, values.echoDelaySeconds);
    setMonitorParam(graph.feedback.gain, values.echoFeedback);
    setMonitorParam(graph.echo.gain, values.echoWet);
    setMonitorParam(graph.compressor.threshold, values.compressorThreshold);
    setMonitorParam(graph.compressor.knee, values.compressorKnee);
    setMonitorParam(graph.compressor.ratio, values.compressorRatio);
    setMonitorParam(graph.compressor.attack, values.compressorAttack);
    setMonitorParam(graph.compressor.release, values.compressorRelease);
    setMonitorParam(graph.master.gain, values.gain);
  }

  function connectMicMonitor() {
    disconnectMonitor();
    if (!monitorEnabled || !micSource || !audioContext) return false;
    const highpass = audioContext.createBiquadFilter();
    const presence = audioContext.createBiquadFilter();
    const lowpass = audioContext.createBiquadFilter();
    const shaper = audioContext.createWaveShaper();
    const clean = audioContext.createGain();
    const colour = audioContext.createGain();
    const delay = audioContext.createDelay(Number(monitorConfig.bounds?.echoDelaySeconds?.[1]) || 1);
    const feedback = audioContext.createGain();
    const echo = audioContext.createGain();
    const compressor = audioContext.createDynamicsCompressor();
    const master = audioContext.createGain();
    highpass.type = 'highpass';
    presence.type = 'peaking';
    lowpass.type = 'lowpass';
    master.gain.value = 0;
    micSource.connect(highpass);
    highpass.connect(presence);
    presence.connect(lowpass);
    lowpass.connect(clean);
    clean.connect(compressor);
    lowpass.connect(shaper);
    shaper.connect(colour);
    colour.connect(compressor);
    lowpass.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(echo);
    echo.connect(compressor);
    compressor.connect(master);
    master.connect(audioContext.destination);
    monitorGraph = {
      highpass, presence, lowpass, shaper, clean, colour, delay, feedback, echo, compressor, master,
    };
    applyMonitorPresetToGraph();
    frame.monitorActive = true;
    return true;
  }

  function clearEnergy(clearControls = false) {
    clearMicMeasurements();
    frame.beat = 0;
    frame.gate = 0;
    frame.midiEnergy = 0;
    frame.lastNote = null;
    beatPending = 0;
    midiTarget = 0;
    activeNotes.clear();
    sustainChannels.clear();
    refreshActiveNotes();
    if (clearControls) frame.cc = {};
  }

  function stopMicStream() {
    voiceGame?.panic?.('mic stopped · voice game exact silence');
    disconnectMonitor();
    if (micStream) {
      for (const track of micStream.getTracks()) {
        track.onended = null;
        track.stop();
      }
    }
    micSource?.disconnect?.();
    analyser?.disconnect?.();
    micStream = null;
    micSource = null;
    analyser = null;
    timeFloats = null;
    timeBytes = null;
    frequencyBytes = null;
    frame.micActive = false;
    frame.micDeviceId = '';
    frame.micDeviceLabel = '';
    clearMicMeasurements();
    updateInputDiagnostics(eventTimestamp(), 0, 0, false);
    refreshReady();
  }

  function setMicMonitor(enabled) {
    monitorEnabled = Boolean(enabled);
    if (!monitorEnabled) {
      disconnectMonitor();
      report('mic', 'live', frame.micActive, frame.micActive ? 'mic live · monitor off' : 'mic standby');
      return frame;
    }
    if (!frame.micActive || !connectMicMonitor()) {
      monitorEnabled = false;
      report('mic', 'unavailable', false, 'voice monitor needs a live selected microphone');
      return frame;
    }
    report('mic', 'live', true, `voice monitor live · ${monitorPresetId} preset · headphones recommended`);
    return frame;
  }

  function setMicMonitorPreset(presetId, { report: shouldReport = true } = {}) {
    const resolved = resolveMonitorPreset(presetId);
    monitorPresetId = resolved.id;
    monitorPresetValues = resolved.values;
    frame.monitorPreset = monitorPresetId;
    frame.monitorWet = monitorPresetValues.echoWet;
    frame.monitorFeedback = monitorPresetValues.echoFeedback;
    applyMonitorPresetToGraph();
    if (shouldReport) {
      report('mic', frame.monitorActive ? 'live' : 'idle', frame.monitorActive,
        frame.monitorActive
          ? `voice monitor live · ${monitorPresetId} preset · wet ${Math.round(frame.monitorWet * 100)}% · feedback ${Math.round(frame.monitorFeedback * 100)}%`
          : `monitor preset ${monitorPresetId} selected · sound unchanged`);
    }
    return frame;
  }

  async function startVoiceGameCapture() {
    if (destroyed) return frame;
    if (!frame.micActive) {
      report('voice-game', 'idle', false, 'voice game needs MIC + VOICE first');
      return frame;
    }
    await voiceGame.startCapture();
    refreshVoiceGameFrame();
    return frame;
  }

  async function stopVoiceGameCapture() {
    if (destroyed) return frame;
    await voiceGame.stopCapture({ play: true });
    refreshVoiceGameFrame();
    return frame;
  }

  async function playVoiceGameSlot(slotId) {
    if (destroyed) return frame;
    await voiceGame.playSlot(slotId);
    refreshVoiceGameFrame();
    return frame;
  }

  function setVoiceGamePreset(presetId) {
    voiceGame.setPreset(presetId);
    refreshVoiceGameFrame();
    return frame;
  }

  function setVoiceGamePasses(count) {
    voiceGame.setPasses(count);
    refreshVoiceGameFrame();
    return frame;
  }

  function clearVoiceGame() {
    voiceGame.clear();
    refreshVoiceGameFrame();
    return frame;
  }

  function setMicFloor(value) {
    const calibration = audioConfig.calibration || {};
    const minimum = clamp01(Number(calibration.minFloor));
    const maximum = Math.max(minimum, clamp01(Number(calibration.maxFloor) || 1));
    const requested = Number.isFinite(Number(value)) ? Number(value) : audioConfig.floor;
    micFloor = Math.min(maximum, Math.max(minimum, requested));
    frame.micFloor = micFloor;
    return frame;
  }

  function handleMicEnded() {
    if (destroyed || !frame.micActive) return;
    stopMicStream();
    micError = 'mic disconnected';
    refreshError();
    report('mic', 'unavailable', false, 'mic disconnected · audio analysis silent');
  }

  async function ensureAudioContext() {
    if (audioContext?.state === 'closed') audioContext = null;
    if (!audioContext) {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio is unsupported');
      audioContext = new AudioContextClass();
    }
    if (audioContext.state === 'suspended') await audioContext.resume();
    if (audioContext.state !== 'running') throw new Error(`AudioContext is ${audioContext.state}`);
    refreshAudioContextFacts();
    return audioContext;
  }

  function configureAnalyser(context, stream) {
    const nextAnalyser = context.createAnalyser();
    nextAnalyser.fftSize = audioConfig.fftSize;
    nextAnalyser.smoothingTimeConstant = audioConfig.smoothing;

    const nextSource = context.createMediaStreamSource(stream);
    nextSource.connect(nextAnalyser);
    // Analysis remains local; the optional monitor is connected only by an explicit action.

    micSource = nextSource;
    analyser = nextAnalyser;
    frequencyBytes = new Uint8Array(analyser.frequencyBinCount);
    if (typeof analyser.getFloatTimeDomainData === 'function') {
      timeFloats = new Float32Array(analyser.fftSize);
      timeBytes = null;
    } else {
      timeFloats = null;
      timeBytes = new Uint8Array(analyser.fftSize);
    }

    // Equal logarithmic spans produce useful bass/mid/high regions from any FFT size.
    const logarithmicSpan = Math.cbrt(analyser.frequencyBinCount);
    bassEnd = Math.max(1, Math.floor(logarithmicSpan));
    midEnd = Math.max(bassEnd + 1, Math.floor(logarithmicSpan * logarithmicSpan));
    midEnd = Math.min(midEnd, analyser.frequencyBinCount);
  }

  async function enableMic(deviceId = '', profile = 'voice') {
    if (destroyed) {
      report('mic', 'destroyed', false, 'mic unavailable · engine destroyed');
      return frame;
    }
    const requestedDeviceId = typeof deviceId === 'string' ? deviceId.trim() : '';
    const nextProfile = profile === 'music' ? 'music' : 'voice';
    const shouldSwitchDevice = frame.micActive && (requestedDeviceId !== preferredMicDeviceId || nextProfile !== inputProfile);
    if (shouldSwitchDevice) stopMicStream();
    preferredMicDeviceId = requestedDeviceId;
    inputProfile = nextProfile;
    if (frame.micActive) {
      try {
        await ensureAudioContext();
        report('mic', 'live', true, 'mic live · FFT analysis only');
      } catch (error) {
        stopMicStream();
        micError = describeError(error, 'mic');
        refreshError();
        report('mic', 'unavailable', false, `${micError} · analysis silent`);
      }
      return frame;
    }
    if (micPromise) return micPromise;

    micPromise = (async () => {
      report('mic', 'requesting', false, 'requesting mic · analysis stays local');
      try {
        if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
          throw new Error('getUserMedia requires a supported localhost/HTTPS browser');
        }

        // Creation/resume occurs directly in the A/button user-gesture call path.
        const context = await ensureAudioContext();
        const audio = {
          ...(inputProfile === 'music' ? audioConfig.musicMicrophone : audioConfig.microphone),
          ...(preferredMicDeviceId ? { deviceId: { exact: preferredMicDeviceId } } : {}),
        };
        let stream;
        try {
          stream = await globalThis.navigator.mediaDevices.getUserMedia({ audio, video: false });
        } catch (error) {
          if (!preferredMicDeviceId || !['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'].includes(error?.name)) throw error;
          preferredMicDeviceId = '';
          stream = await globalThis.navigator.mediaDevices.getUserMedia({ audio: inputProfile === 'music' ? audioConfig.musicMicrophone : audioConfig.microphone, video: false });
        }
        if (destroyed) {
          for (const track of stream.getTracks()) track.stop();
          return frame;
        }

        stopMicStream();
        micStream = stream;
        configureAnalyser(context, stream);
        for (const track of stream.getAudioTracks()) track.onended = handleMicEnded;
        frame.micActive = true;
        const track = stream.getAudioTracks()[0];
        frame.micDeviceId = String(track?.getSettings?.().deviceId || preferredMicDeviceId || '');
        frame.micDeviceLabel = String(track?.label || 'Selected microphone');
        if (monitorEnabled) connectMicMonitor();
        micError = '';
        refreshError();
        refreshReady();
        report('mic', 'live', true, `mic live${track?.label ? ` · ${track.label}` : ''} · FFT analysis only · no monitor`);
      } catch (error) {
        stopMicStream();
        micError = describeError(error, 'mic');
        refreshError();
        report('mic', 'unavailable', false, `${micError} · analysis silent`);
      } finally {
        micPromise = null;
      }
      return frame;
    })();

    return micPromise;
  }

  function averageFrequencyRange(start, end) {
    if (!frequencyBytes || end <= start) return 0;
    let total = 0;
    for (let index = start; index < end; index += 1) total += frequencyBytes[index];
    return clamp01(total / ((end - start) * 255));
  }

  function sampleMic(timestamp) {
    if (!frame.micActive || !analyser || audioContext?.state !== 'running') {
      clearMicMeasurements();
      updateInputDiagnostics(timestamp, 0, 0, false);
      return 0;
    }

    let squareTotal = 0;
    let samplePeak = 0;
    let clippedSamples = 0;
    const clipThreshold = clamp01(Number(diagnosticConfig.clipThreshold));
    if (timeFloats) {
      analyser.getFloatTimeDomainData(timeFloats);
      for (let index = 0; index < timeFloats.length; index += 1) {
        const sample = timeFloats[index];
        const absolute = Math.abs(sample);
        squareTotal += sample * sample;
        if (absolute > samplePeak) samplePeak = absolute;
        if (absolute >= clipThreshold) clippedSamples += 1;
      }
      squareTotal /= timeFloats.length;
    } else {
      analyser.getByteTimeDomainData(timeBytes);
      for (let index = 0; index < timeBytes.length; index += 1) {
        const sample = (timeBytes[index] - 128) / 128;
        const absolute = Math.abs(sample);
        squareTotal += sample * sample;
        if (absolute > samplePeak) samplePeak = absolute;
        if (absolute >= clipThreshold) clippedSamples += 1;
      }
      squareTotal /= timeBytes.length;
    }

    const rawRms = Math.sqrt(squareTotal);
    updateInputDiagnostics(timestamp, samplePeak, clippedSamples, true);
    frame.rawRms = Number.isFinite(rawRms) ? clamp01(rawRms) : 0;
    if (!Number.isFinite(rawRms) || rawRms <= micFloor) {
      clearMicMeasurements();
      frame.rawRms = Number.isFinite(rawRms) ? clamp01(rawRms) : 0;
      return 0;
    }

    frame.rms = clamp01(rawRms);
    analyser.getByteFrequencyData(frequencyBytes);
    frame.bass = averageFrequencyRange(1, bassEnd);
    frame.mid = averageFrequencyRange(bassEnd, midEnd);
    frame.high = averageFrequencyRange(midEnd, frequencyBytes.length);

    const drive = clamp01((rawRms - micFloor) / Math.max(Number.EPSILON, 1 - micFloor));
    if (!micAboveFloor) {
      beatPending = Math.max(beatPending, drive);
      callSafely(eventCallback, { type: 'beat', source: 'mic', strength: drive, timestamp });
    }
    micAboveFloor = true;
    return drive;
  }

  function refreshActiveNotes() {
    const notes = Array.from(activeNotes.values());
    const start = Math.max(0, notes.length - activeNoteLimit);
    const snapshot = [];
    for (let index = start; index < notes.length; index += 1) {
      const note = notes[index];
      snapshot.push(Object.freeze({
        note: note.note,
        channel: note.channel,
        velocity: note.velocity,
        device: note.device,
      }));
    }
    frame.activeNotes = Object.freeze(snapshot);
  }

  function recalculateMidiTarget() {
    let nextTarget = 0;
    let lastNote = null;
    for (const note of activeNotes.values()) {
      nextTarget = Math.max(nextTarget, note.velocity);
      lastNote = note.note;
    }
    midiTarget = nextTarget;
    frame.lastNote = lastNote;
    refreshActiveNotes();
  }

  function releaseInputNotes(inputId) {
    let changed = false;
    for (const [key, note] of activeNotes) {
      if (note.inputId === inputId) {
        activeNotes.delete(key);
        changed = true;
      }
    }
    for (const sustainKey of sustainChannels) {
      if (sustainKey.startsWith(`${inputId}:`)) sustainChannels.delete(sustainKey);
    }
    if (changed) recalculateMidiTarget();
    else refreshActiveNotes();
    return changed;
  }

  function midiDeviceLabel(input) {
    return String(input.name || input.manufacturer || input.id || 'MIDI input');
  }

  function handleMidiMessage(event, input) {
    if (destroyed || !event?.data || event.data.length < 2) return;
    const command = event.data[0] & 0xf0;
    const channel = event.data[0] & 0x0f;
    const dataOne = event.data[1] & 0x7f;
    const dataTwo = (event.data[2] || 0) & 0x7f;
    const inputId = String(input.id || midiDeviceLabel(input));
    const device = midiDeviceLabel(input);
    const noteKey = `${inputId}:${channel}:${dataOne}`;
    const sustainKey = `${inputId}:${channel}`;
    const timestamp = eventTimestamp(event.timeStamp);

    if (command === 0x90 && dataTwo > 0) {
      const velocity = dataTwo / 127;
      activeNotes.delete(noteKey);
      activeNotes.set(noteKey, {
        inputId, channel, note: dataOne, velocity, device, held: true,
      });
      recalculateMidiTarget();
      frame.lastNote = dataOne;
      beatPending = Math.max(beatPending, velocity);
      callSafely(eventCallback, {
        type: 'note', note: dataOne, velocity, channel, device, timestamp,
      });
      return;
    }

    if (command === 0x80 || (command === 0x90 && dataTwo === 0)) {
      const activeNote = activeNotes.get(noteKey);
      if (activeNote && sustainChannels.has(sustainKey)) activeNote.held = false;
      else activeNotes.delete(noteKey);
      recalculateMidiTarget();
      callSafely(eventCallback, {
        type: 'noteoff', note: dataOne, velocity: dataTwo / 127, channel, device, timestamp,
      });
      return;
    }

    if (command === 0xb0) {
      const value = dataTwo / 127;
      frame.cc[dataOne] = value;
      if (dataOne === MIDI_CC_SUSTAIN) {
        if (dataTwo >= 64) sustainChannels.add(sustainKey);
        else {
          sustainChannels.delete(sustainKey);
          let changed = false;
          for (const [key, note] of activeNotes) {
            if (note.inputId === inputId && note.channel === channel && !note.held) {
              activeNotes.delete(key);
              changed = true;
            }
          }
          if (changed) recalculateMidiTarget();
        }
      }
      callSafely(eventCallback, {
        type: 'cc', controller: dataOne, value, channel, device, timestamp,
      });
      if (dataOne === MIDI_CC_MASTER) masterLevel = value;
      return;
    }

    if (command === 0xe0) {
      const raw = Math.min(MIDI_PITCH_BEND_MAX, (dataTwo << 7) | dataOne);
      const value = raw < MIDI_PITCH_BEND_CENTER
        ? (raw - MIDI_PITCH_BEND_CENTER) / MIDI_PITCH_BEND_CENTER
        : (raw - MIDI_PITCH_BEND_CENTER) / (MIDI_PITCH_BEND_MAX - MIDI_PITCH_BEND_CENTER);
      callSafely(eventCallback, {
        type: 'pitchbend', value: Math.min(1, Math.max(-1, value)), raw, channel, device, timestamp,
      });
    }
  }

  function emitMidiPanic(reason, input = null) {
    clearEnergy();
    frame.ts = eventTimestamp();
    callSafely(eventCallback, {
      type: 'panic',
      reason,
      ...(input ? { device: midiDeviceLabel(input) } : {}),
      timestamp: frame.ts,
    });
  }

  function syncMidiInputs() {
    if (!midiAccess || destroyed) return;
    const connectedIds = new Set();
    const devices = [];

    for (const input of midiAccess.inputs.values()) {
      if (input.state === 'disconnected') continue;
      const inputId = String(input.id || midiDeviceLabel(input));
      connectedIds.add(inputId);
      devices.push(midiDeviceLabel(input));
      const currentBinding = midiInputs.get(inputId);
      if (currentBinding?.input !== input) {
        if (currentBinding) {
          currentBinding.input.onmidimessage = null;
          emitMidiPanic('midi input replaced', currentBinding.input);
        }
        const handler = (event) => handleMidiMessage(event, input);
        input.onmidimessage = handler;
        midiInputs.set(inputId, { input, handler });
      }
    }

    for (const [inputId, binding] of midiInputs) {
      if (connectedIds.has(inputId)) continue;
      binding.input.onmidimessage = null;
      midiInputs.delete(inputId);
      releaseInputNotes(inputId);
      emitMidiPanic('midi disconnected', binding.input);
    }

    frame.devices = devices;
    frame.midiActive = devices.length > 0;
    refreshReady();
    if (frame.midiActive) {
      stopMidiBridge(false);
      report('midi', 'live', true, `midi live · ${devices.join(', ')}`);
    } else {
      report('midi', 'waiting', false, 'midi ready · no input devices');
      startMidiBridge();
    }
  }

  function syncMidiBridgeFrame() {
    if (midiAccess && frame.midiActive && midiInputs.size > 0) return;
    frame.devices = [...midiBridgeDevices];
    frame.midiActive = midiBridgeDevices.size > 0;
    refreshReady();
  }

  function handleMidiBridgeMessage(message) {
    if (destroyed || !message || typeof message !== 'object') return;
    if (message.type === 'ready') {
      midiBridgeReady = true;
      midiError = '';
      refreshError();
      syncMidiBridgeFrame();
      report('midi', frame.midiActive ? 'live' : 'waiting', frame.midiActive,
        frame.midiActive
          ? `CoreMIDI live · ${frame.devices.join(', ')}`
          : 'CoreMIDI ready · no input devices');
      return;
    }
    if (message.type === 'source') {
      const device = String(message.source || 'CoreMIDI');
      const inputId = `bridge:${device}`;
      if (message.connected) midiBridgeDevices.add(device);
      else {
        midiBridgeDevices.delete(device);
        releaseInputNotes(inputId);
        callSafely(eventCallback, {
          type: 'panic', reason: 'midi disconnected', device, timestamp: eventTimestamp(),
        });
      }
      syncMidiBridgeFrame();
      report('midi', frame.midiActive ? 'live' : 'waiting', frame.midiActive,
        frame.midiActive
          ? `CoreMIDI live · ${frame.devices.join(', ')}`
          : 'CoreMIDI ready · no input devices');
      return;
    }
    if (message.type === 'midi' && Array.isArray(message.data) && message.data.length === 3) {
      const device = String(message.source || 'CoreMIDI');
      midiBridgeDevices.add(device);
      midiBridgeReady = true;
      syncMidiBridgeFrame();
      handleMidiMessage({ data: Uint8Array.from(message.data), timeStamp: eventTimestamp() }, {
        id: `bridge:${device}`, name: device, manufacturer: 'CoreMIDI', state: 'connected',
      });
      return;
    }
    if (message.type === 'error') {
      midiError = String(message.message || 'CoreMIDI bridge unavailable');
      refreshError();
      report('midi', 'unavailable', false, midiError);
    }
  }

  function stopMidiBridge(clearDevices = true) {
    midiBridge?.close?.();
    midiBridge = null;
    midiBridgeReady = false;
    let releasedNotes = false;
    for (const device of midiBridgeDevices) {
      releasedNotes = releaseInputNotes(`bridge:${device}`) || releasedNotes;
    }
    if (releasedNotes) {
      clearEnergy();
      callSafely(eventCallback, {
        type: 'panic', reason: 'CoreMIDI bridge switched off', timestamp: eventTimestamp(),
      });
    }
    if (!clearDevices) {
      midiBridgeDevices.clear();
      return;
    }
    midiBridgeDevices.clear();
    syncMidiBridgeFrame();
  }

  function startMidiBridge() { return false; }

  function clearMidiAccess() {
    if (midiAccess) midiAccess.onstatechange = null;
    for (const [inputId, binding] of midiInputs) {
      binding.input.onmidimessage = null;
      releaseInputNotes(inputId);
    }
    midiInputs.clear();
    midiAccess = null;
    syncMidiBridgeFrame();
    recalculateMidiTarget();
  }

  function failMidi(error) {
    clearMidiAccess();
    midiError = describeError(error, 'midi');
    refreshError();
    refreshReady();
    report('midi', 'unavailable', false, midiError);
  }

  function startMidiRequest() {
    const request = globalThis.navigator.requestMIDIAccess({ sysex: false });
    midiRequest = request;
    request.then(
      (access) => {
        if (destroyed || midiRequest !== request) return;
        midiAccess = access;
        midiAccess.onstatechange = syncMidiInputs;
        midiError = '';
        refreshError();
        syncMidiInputs();
      },
      (error) => {
        if (destroyed || midiRequest !== request) return;
        failMidi(error);
      },
    ).finally(() => {
      if (midiRequest === request) midiRequest = null;
    });
    return request;
  }

  async function waitForMidiRequest(request) {
    let timeoutId = 0;
    const outcome = await Promise.race([
      request.then(() => 'settled', () => 'settled'),
      new Promise((resolve) => {
        timeoutId = globalThis.setTimeout(
          () => resolve('timed-out'),
          audioConfig.midiRequestTimeoutMs,
        );
      }),
    ]);
    if (timeoutId) globalThis.clearTimeout(timeoutId);

    if (outcome === 'timed-out' && !destroyed && midiRequest === request && !midiAccess) {
      frame.midiActive = false;
      frame.devices = [];
      midiError = 'midi request timed out';
      refreshError();
      refreshReady();
      report('midi', 'timed-out', false, `${midiError} · approve the browser prompt or press N to recheck`);
      startMidiBridge();
    }
    return frame;
  }

  async function enableMIDI() {
    if (destroyed) {
      report('midi', 'destroyed', false, 'midi unavailable · engine destroyed');
      return frame;
    }
    if (midiAccess) {
      syncMidiInputs();
      return frame;
    }
    if (midiBridgeReady || midiBridgeDevices.size > 0) {
      syncMidiBridgeFrame();
      return frame;
    }
    if (typeof globalThis.navigator?.requestMIDIAccess !== 'function') {
      if (!startMidiBridge()) failMidi(new Error('Web MIDI and local CoreMIDI bridge are unavailable'));
      return frame;
    }

    report('midi', 'requesting', false, 'requesting Web MIDI');
    let request = midiRequest;
    if (!request) {
      try {
        request = startMidiRequest();
      } catch (error) {
        failMidi(error);
        startMidiBridge();
        return frame;
      }
    }
    return waitForMidiRequest(request);
  }

  function releaseValue(current, target, elapsedMs) {
    if (target > current) return current + (target - current) * audioConfig.gateAttack;
    if (target === current) return current;
    return current * Math.exp(-elapsedMs / audioConfig.gateReleaseMs);
  }

  function update(timestamp, trackingFrame) {
    void trackingFrame;
    if (destroyed) return frame;

    const now = eventTimestamp(timestamp);
    const elapsedMs = lastUpdateAt === null ? 0 : Math.max(0, now - lastUpdateAt);
    lastUpdateAt = now;
    frame.ts = now;
    refreshAudioContextFacts();

    let micDrive = 0;
    try {
      micDrive = sampleMic(now);
    } catch (error) {
      stopMicStream();
      micError = describeError(error, 'mic');
      refreshError();
      report('mic', 'unavailable', false, `${micError} · analysis silent`);
    }

    const masteredMidiTarget = midiTarget * masterLevel;
    frame.midiEnergy = clamp01(releaseValue(frame.midiEnergy, masteredMidiTarget, elapsedMs));
    if (masteredMidiTarget === 0 && frame.midiEnergy <= audioConfig.gateFloor) frame.midiEnergy = 0;

    const voiceGameState = refreshVoiceGameFrame();
    const gateTarget = Math.max(micDrive, midiTarget, voiceGameState.energy || 0) * masterLevel;
    frame.gate = clamp01(releaseValue(frame.gate, gateTarget, elapsedMs));
    if (gateTarget === 0 && frame.gate <= audioConfig.gateFloor) frame.gate = 0;

    frame.beat = clamp01(beatPending);
    beatPending = 0;
    return frame;
  }

  function getFrame() {
    refreshVoiceGameFrame();
    return frame;
  }

  function getMIDIAccess() {
    return midiAccess;
  }

  function panic() {
    if (destroyed) return frame;
    emitMidiPanic('manual panic');
    monitorEnabled = false;
    disconnectMonitor();
    voiceGame?.panic?.();
    refreshVoiceGameFrame();
    report('audio', 'panic', false, 'panic · audio energy zero');
    return frame;
  }

  function destroy() {
    if (destroyed) return;
    emitMidiPanic('destroy');
    destroyed = true;
    clearEnergy(true);
    resetAudioDiagnostics();
    stopMicStream();
    voiceGame?.destroy?.();
    clearMidiAccess();
    stopMidiBridge();
    frame.ready = false;
    frame.error = '';
    audioContext?.close?.().catch?.(() => {});
    audioContext = null;
    frame.audioContextState = 'closed';
    frame.sampleRate = 0;
    frame.baseLatencyMs = 0;
    frame.outputLatencyMs = 0;
    frame.estimatedLatencyMs = 0;
    frame.latencySource = 'unavailable';
    frame.latencyStatus = 'unavailable';
  }

  return {
    enableMic,
    disableMic: stopMicStream,
    setMicMonitor,
    setMicMonitorPreset,
    setMicFloor,
    resetAudioDiagnostics,
    startVoiceGameCapture,
    stopVoiceGameCapture,
    playVoiceGameSlot,
    setVoiceGamePreset,
    setVoiceGamePasses,
    clearVoiceGame,
    enableMIDI,
    getMIDIAccess,
    update,
    getFrame,
    panic,
    destroy,
  };
}
