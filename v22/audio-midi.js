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

export function createAudioMidiEngine({ config, onStatus, onEvent, onControl }) {
  if (!config?.audio) throw new TypeError('createAudioMidiEngine requires config.audio');

  const audioConfig = config.audio;
  const statusCallback = typeof onStatus === 'function' ? onStatus : () => {};
  const eventCallback = typeof onEvent === 'function' ? onEvent : () => {};
  // Retain the frozen constructor key; V8 routes instrument CC through onEvent only.
  void onControl;

  const frame = {
    ts: 0,
    ready: false,
    micActive: false,
    midiActive: false,
    rms: 0,
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
    error: '',
  };

  let destroyed = false;
  let audioContext = null;
  let micStream = null;
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

  function refreshError() {
    frame.error = [micError, midiError].filter(Boolean).join(' · ');
  }

  function refreshReady() {
    frame.ready = frame.micActive || midiAccess !== null || midiBridgeReady;
  }

  function clearMicMeasurements() {
    frame.rms = 0;
    frame.bass = 0;
    frame.mid = 0;
    frame.high = 0;
    micAboveFloor = false;
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
    clearMicMeasurements();
    refreshReady();
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
    return audioContext;
  }

  function configureAnalyser(context, stream) {
    const nextAnalyser = context.createAnalyser();
    nextAnalyser.fftSize = audioConfig.fftSize;
    nextAnalyser.smoothingTimeConstant = audioConfig.smoothing;

    const nextSource = context.createMediaStreamSource(stream);
    nextSource.connect(nextAnalyser);
    // The analyser is the terminal node: microphone audio is never monitored.

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

  async function enableMic() {
    if (destroyed) {
      report('mic', 'destroyed', false, 'mic unavailable · engine destroyed');
      return frame;
    }
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
        const stream = await globalThis.navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (destroyed) {
          for (const track of stream.getTracks()) track.stop();
          return frame;
        }

        stopMicStream();
        micStream = stream;
        configureAnalyser(context, stream);
        for (const track of stream.getAudioTracks()) track.onended = handleMicEnded;
        frame.micActive = true;
        micError = '';
        refreshError();
        refreshReady();
        report('mic', 'live', true, 'mic live · FFT analysis only · no monitor');
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
      return 0;
    }

    let squareTotal = 0;
    if (timeFloats) {
      analyser.getFloatTimeDomainData(timeFloats);
      for (let index = 0; index < timeFloats.length; index += 1) {
        squareTotal += timeFloats[index] * timeFloats[index];
      }
      squareTotal /= timeFloats.length;
    } else {
      analyser.getByteTimeDomainData(timeBytes);
      for (let index = 0; index < timeBytes.length; index += 1) {
        const sample = (timeBytes[index] - 128) / 128;
        squareTotal += sample * sample;
      }
      squareTotal /= timeBytes.length;
    }

    const rawRms = Math.sqrt(squareTotal);
    if (!Number.isFinite(rawRms) || rawRms <= audioConfig.floor) {
      clearMicMeasurements();
      return 0;
    }

    frame.rms = clamp01(rawRms);
    analyser.getByteFrequencyData(frequencyBytes);
    frame.bass = averageFrequencyRange(1, bassEnd);
    frame.mid = averageFrequencyRange(bassEnd, midEnd);
    frame.high = averageFrequencyRange(midEnd, frequencyBytes.length);

    const drive = clamp01((rawRms - audioConfig.floor) / (1 - audioConfig.floor));
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

    const gateTarget = Math.max(micDrive, midiTarget) * masterLevel;
    frame.gate = clamp01(releaseValue(frame.gate, gateTarget, elapsedMs));
    if (gateTarget === 0 && frame.gate <= audioConfig.gateFloor) frame.gate = 0;

    frame.beat = clamp01(beatPending);
    beatPending = 0;
    return frame;
  }

  function getFrame() {
    return frame;
  }

  function panic() {
    if (destroyed) return frame;
    emitMidiPanic('manual panic');
    report('audio', 'panic', false, 'panic · audio energy zero');
    return frame;
  }

  function destroy() {
    if (destroyed) return;
    emitMidiPanic('destroy');
    destroyed = true;
    clearEnergy(true);
    stopMicStream();
    clearMidiAccess();
    stopMidiBridge();
    frame.ready = false;
    frame.error = '';
    audioContext?.close?.().catch?.(() => {});
    audioContext = null;
  }

  return { enableMic, enableMIDI, update, getFrame, panic, destroy };
}
