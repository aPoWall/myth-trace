function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, finite(value, min)));
}

export function midiNoteFrequency(note, tuning = 440) {
  return finite(tuning, 440) * (2 ** ((finite(note, 69) - 69) / 12));
}

function setParam(param, value, time) {
  if (!param) return;
  param.cancelScheduledValues?.(time);
  if (typeof param.setValueAtTime === 'function') param.setValueAtTime(value, time);
  else param.value = value;
}

function targetParam(param, value, time, constant = 0.01) {
  if (!param) return;
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(time);
  else {
    const current = finite(param.value);
    param.cancelScheduledValues?.(time);
    param.setValueAtTime?.(current, time);
  }
  if (typeof param.setTargetAtTime === 'function') param.setTargetAtTime(value, time, constant);
  else setParam(param, value, time);
}

function connect(source, destination) {
  source?.connect?.(destination);
  return destination;
}

function noteKey(event) {
  return `${String(event?.device || 'unknown')}:${Math.round(finite(event?.channel))}:${Math.round(finite(event?.note))}`;
}

function channelKey(event) {
  return `${String(event?.device || 'unknown')}:${Math.round(clamp(event?.channel, 0, 15))}`;
}

const FINGER_NAMES = Object.freeze(['thumb', 'index', 'middle', 'ring', 'pinky']);
const SIDE_NAMES = Object.freeze(['left', 'right']);

export function createMusicEngine({
  config,
  getAudioContext,
  getOutputDestination = null,
  onStatus = () => {},
} = {}) {
  const music = config?.music;
  const subjectRouteConfig = config?.overlay?.subjectRoute || {};
  if (!music || typeof getAudioContext !== 'function') {
    throw new TypeError('createMusicEngine requires CONFIG.music and getAudioContext');
  }
  if (!Array.isArray(music.fingerNotes) || music.fingerNotes.length !== FINGER_NAMES.length) {
    throw new TypeError('createMusicEngine requires five CONFIG.music.fingerNotes');
  }

  const fingerOctaveScenes = {};
  for (const [name, scene] of Object.entries(music.fingerOctaveScenes || {})) {
    if (!Array.isArray(scene?.left) || scene.left.length !== FINGER_NAMES.length
      || !Array.isArray(scene?.right) || scene.right.length !== FINGER_NAMES.length) continue;
    fingerOctaveScenes[name] = Object.freeze({
      label: String(scene.label || name),
      left: Int16Array.from(scene.left, (note) => Math.round(clamp(note, music.noteMin, music.noteMax))),
      right: Int16Array.from(scene.right, (note) => Math.round(clamp(note, music.noteMin, music.noteMax))),
    });
  }
  if (!Object.keys(fingerOctaveScenes).length || !fingerOctaveScenes[music.defaultFingerOctaveScene]) {
    throw new TypeError('createMusicEngine requires CONFIG.music finger octave scenes and default');
  }
  let fingerOctaveScene = music.defaultFingerOctaveScene;
  const configuredSensitivityPresets = music.fingerSensitivityPresets || {};
  const fingerSensitivityPresets = Object.freeze(Object.fromEntries(
    Object.entries(configuredSensitivityPresets).map(([name, preset]) => {
      const on = clamp(preset?.on, 0.01, 1);
      return [name, Object.freeze({ on, off: clamp(preset?.off, 0, on) })];
    }),
  ));
  if (Object.keys(fingerSensitivityPresets).length === 0) {
    throw new TypeError('createMusicEngine requires CONFIG.music.fingerSensitivityPresets');
  }
  const fingerGainMax = clamp(music.fingerGainMax);
  const fingerGainSmoothingSeconds = Math.max(0.001, finite(music.fingerGainSmoothingSeconds, 0.04));
  const envelopeConfig = music.fingerEnvelope;
  if (!envelopeConfig?.defaults || !Array.isArray(envelopeConfig.attackRange)
    || !Array.isArray(envelopeConfig.releaseRange)) {
    throw new TypeError('createMusicEngine requires CONFIG.music.fingerEnvelope');
  }
  const fingerAttackRange = Object.freeze([
    Math.max(0.001, finite(envelopeConfig.attackRange[0], 0.004)),
    Math.max(0.001, finite(envelopeConfig.attackRange[1], 0.18)),
  ]);
  const fingerReleaseRange = Object.freeze([
    Math.max(0.001, finite(envelopeConfig.releaseRange[0], 0.06)),
    Math.max(0.001, finite(envelopeConfig.releaseRange[1], 1.2)),
  ]);
  if (fingerAttackRange[1] < fingerAttackRange[0] || fingerReleaseRange[1] < fingerReleaseRange[0]) {
    throw new TypeError('createMusicEngine requires ordered finger envelope ranges');
  }
  const fingerLossMs = Math.max(0, finite(music.fingerLossMs, 450));
  const fingerVoiceCount = SIDE_NAMES.length * FINGER_NAMES.length;
  const fingerNotesBySide = [new Int16Array(FINGER_NAMES.length), new Int16Array(FINGER_NAMES.length)];
  const fingerDevices = new Array(fingerVoiceCount);
  const fingerKeys = new Array(fingerVoiceCount);

  let transpose = 0;
  let major = false;
  let handHarmony = "solo";

  function setFingerSceneNotes(sceneName) {
    const scene = fingerOctaveScenes[sceneName];
    fingerNotesBySide[0].set(scene.left);
    fingerNotesBySide[1].set(scene.right);
    for (let side = 0; side < SIDE_NAMES.length; side += 1) {
      for (let finger = 0; finger < FINGER_NAMES.length; finger += 1) {
        const index = side * FINGER_NAMES.length + finger;
        fingerNotesBySide[side][finger] += transpose + (major && finger === 1 ? 1 : 0) + (major && finger === 4 ? 1 : 0);
        fingerDevices[index] = `finger:${SIDE_NAMES[side]}:${FINGER_NAMES[finger]}`;
        fingerKeys[index] = noteKey({
          device: fingerDevices[index], channel: 0, note: fingerNotesBySide[side][finger],
        });
      }
    }
  }

  setFingerSceneNotes(fingerOctaveScene);

  let context = null;
  let graph = null;
  let destroyed = false;
  let armGeneration = 0;
  let armed = false;
  let silentReason = 'sound disarmed';
  let preset = music.defaultPreset;
  let scale = music.defaultScale;
  let master = clamp(music.master, 0, music.masterMax);
  let cutoff = clamp(music.presets[preset]?.cutoff, 0, 1);
  let delaySend = clamp(music.presets[preset]?.delaySend, 0, 1);
  let resonance = clamp(music.presets[preset]?.resonance, 0, 1);
  let subjectTimbre = 0;
  let subjectAmount = 0;
  let handRoute = 0;
  let gate = 0;
  let lastEvent = 'idle';
  let lastGestureAt = -Infinity;
  let lastRangeAt = -Infinity;
  let texture = clamp(music.presets[preset]?.texture);
  let saturation = clamp(music.presets[preset]?.texture, 0, 1);
  let harmony = 0;
  let handRole = Array.isArray(music.handRoles) && music.handRoles.includes(music.defaultHandRole)
    ? music.defaultHandRole
    : 'both';
  let fingerSensitivity = fingerSensitivityPresets[music.defaultFingerSensitivity]
    ? music.defaultFingerSensitivity
    : Object.keys(fingerSensitivityPresets)[0];
  let voiceSerial = 0;
  let lastFramePhase = 'searching';
  let hatsEnabled = false;
  let droneEnabled = false;
  let hatGate = 0;
  let hatTimer = null;
  let lastHatAt = -Infinity;
  let lastHandRangeAt = -Infinity;
  let lastUpdateTimestamp = -Infinity;
  let tremoloDepth = 0;
  let middleCurl = 0;
  let ringCurl = 0;
  let pinkyCurl = 0;
  let cachedState = null;
  let stateDirty = true;
  const voices = [];
  const active = new Map();
  const sustained = new Map();
  const sustain = new Map();
  const pitchBends = new Map();
  const modulations = new Map();
  const timers = new Set();
  const distortionCurves = [];
  const fingerGates = new Uint8Array(fingerVoiceCount);
  const fingerTriggerArmed = new Uint8Array(fingerVoiceCount);
  const fingerLevels = new Float32Array(fingerVoiceCount);
  const fingerCurls = new Float32Array(fingerVoiceCount);
  const fingerSideActive = new Uint8Array(SIDE_NAMES.length);
  const fingerTrackIds = ['', ''];
  const fingerAttackSeconds = new Float64Array(FINGER_NAMES.length);
  const fingerReleaseByFinger = new Float64Array(FINGER_NAMES.length);
  for (let index = 0; index < FINGER_NAMES.length; index += 1) {
    const defaults = envelopeConfig.defaults[FINGER_NAMES[index]];
    if (!defaults) throw new TypeError(`createMusicEngine requires ${FINGER_NAMES[index]} envelope defaults`);
    fingerAttackSeconds[index] = clamp(defaults.attack, fingerAttackRange[0], fingerAttackRange[1]);
    fingerReleaseByFinger[index] = clamp(defaults.release, fingerReleaseRange[0], fingerReleaseRange[1]);
  }
  fingerTriggerArmed.fill(1);

  function markDirty() {
    stateDirty = true;
  }

  function now() {
    return finite(context?.currentTime, 0);
  }

  function report(message = silentReason) {
    try { onStatus({ source: 'music', state: armed ? 'armed' : 'silent', active: !isSilent(), message }); } catch { /* host UI cannot break audio */ }
  }

  function filterHz(value) {
    const low = music.filterMinHz;
    const high = music.filterMaxHz;
    return low * ((high / low) ** clamp(value));
  }

  function makeDistortionCurve(amount) {
    const k = 20 + clamp(amount) * 940;
    const curve = new Float32Array(music.distortionCurveSize);
    for (let index = 0; index < curve.length; index += 1) {
      const x = index * 2 / curve.length - 1;
      curve[index] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }

  function setGraphControls() {
    if (!graph) return;
    const time = now();
    const subjectDepth = clamp(subjectRouteConfig.filterDepth, 0, 0.5);
    const effectiveCutoff = clamp(cutoff + (subjectTimbre - 0.5) * subjectAmount * subjectDepth);
    targetParam(graph.filter.frequency, filterHz(effectiveCutoff), time, 0.025);
    targetParam(graph.filter.Q, music.filterQMin + resonance * (music.filterQMax - music.filterQMin), time, 0.025);
    targetParam(graph.delaySend.gain, delaySend, time, 0.025);
    targetParam(graph.delayFeedback.gain, music.delayFeedback, time, 0.025);
    targetParam(graph.delayReturn.gain, music.delayReturn, time, 0.025);
    targetParam(graph.tremoloDepth?.gain, tremoloDepth * music.tremoloDepthMax, time, 0.025);
    const subGain = music.subGainMin + texture * (music.subGainMax - music.subGainMin);
    for (const voice of voices) targetParam(voice.subGain.gain, subGain, time, 0.025);
    if (graph.distortion && distortionCurves.length) {
      const index = Math.round(clamp(texture) * (distortionCurves.length - 1));
      graph.distortion.curve = distortionCurves[index];
    }
  }

  function makeNoiseBuffer() {
    if (!context?.createBuffer) return null;
    const sampleRate = Math.max(8000, finite(context.sampleRate, 48000));
    const length = Math.max(32, Math.round(sampleRate * music.hatBufferSeconds));
    const buffer = context.createBuffer(1, length, sampleRate);
    const channel = buffer.getChannelData(0);
    let seed = 0x9e3779b9;
    for (let index = 0; index < channel.length; index += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      channel[index] = (seed / 0xffffffff) * 2 - 1;
    }
    return buffer;
  }

  function makeVoice(index) {
    const oscillator = context.createOscillator();
    const sub = context.createOscillator();
    const subGain = context.createGain();
    const gainNode = context.createGain();
    const shape = music.presets[preset];
    oscillator.type = shape.waveform;
    sub.type = shape.subWaveform;
    setParam(gainNode.gain, 0, now());
    setParam(subGain.gain, music.subGainMin + texture * (music.subGainMax - music.subGainMin), now());
    connect(oscillator, gainNode);
    connect(sub, subGain);
    connect(subGain, gainNode);
    connect(gainNode, graph.synthBus);
    oscillator.start();
    sub.start();
    return {
      index, oscillator, sub, subGain, gainNode, key: '', note: 0, channel: 0, device: '',
      velocity: 0, active: false, pendingRelease: false, startedAt: 0, sequence: 0,
      releaseSeconds: music.releaseSeconds, timer: null,
    };
  }

  function buildGraph(outputDestination = context.destination) {
    const synthBus = context.createGain();
    const distortion = context.createWaveShaper?.() || null;
    const filter = context.createBiquadFilter();
    const delaySendNode = context.createGain();
    const delay = context.createDelay(music.delayMaxSeconds);
    const delayFeedback = context.createGain();
    const delayReturn = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const limiter = context.createDynamicsCompressor();
    const masterGain = context.createGain();
    const tremolo = context.createOscillator();
    const tremoloDepthNode = context.createGain();
    const hatFilter = context.createBiquadFilter();
    const hatGain = context.createGain();
    const hatSource = context.createBufferSource?.() || null;
    filter.type = 'lowpass';
    setParam(synthBus.gain, 1, now());
    setParam(delaySendNode.gain, 0, now());
    setParam(delay.delayTime, music.delaySeconds, now());
    setParam(delayFeedback.gain, music.delayFeedback, now());
    setParam(delayReturn.gain, music.delayReturn, now());
    setParam(masterGain.gain, 0, now());
    tremolo.type = 'sine';
    setParam(tremolo.frequency, music.tremoloHz, now());
    setParam(tremoloDepthNode.gain, 0, now());
    hatFilter.type = 'highpass';
    setParam(hatFilter.frequency, music.hatFrequencyMin, now());
    setParam(hatFilter.Q, 0.8, now());
    setParam(hatGain.gain, 0, now());
    for (const [node, settings] of [[compressor, music.compressor], [limiter, music.limiter]]) {
      for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) setParam(node[key], settings[key], now());
    }
    if (distortion) {
      distortion.oversample = '4x';
      for (let index = 0; index < music.distortionSteps; index += 1) {
        const mix = index / Math.max(1, music.distortionSteps - 1);
        distortionCurves.push(makeDistortionCurve(
          music.distortionMin + mix * (music.distortionMax - music.distortionMin),
        ));
      }
      connect(synthBus, distortion);
      connect(distortion, filter);
    } else connect(synthBus, filter);
    connect(filter, compressor);
    connect(filter, delaySendNode);
    connect(delaySendNode, delay);
    connect(delay, delayFeedback);
    connect(delayFeedback, delay);
    connect(delay, delayReturn);
    connect(delayReturn, compressor);
    connect(compressor, limiter);
    connect(limiter, masterGain);
    connect(masterGain, outputDestination);
    connect(tremolo, tremoloDepthNode);
    connect(tremoloDepthNode, synthBus.gain);
    tremolo.start();
    if (hatSource) {
      hatSource.buffer = makeNoiseBuffer();
      hatSource.loop = true;
      connect(hatSource, hatFilter);
      connect(hatFilter, hatGain);
      connect(hatGain, compressor);
      hatSource.start();
    }
    graph = {
      synthBus, distortion, filter, delaySend: delaySendNode, delay,
      delayFeedback, delayReturn, compressor, limiter, masterGain,
      tremolo, tremoloDepth: tremoloDepthNode, hatSource, hatFilter, hatGain,
    };
    setGraphControls();
    for (let index = 0; index < music.polyphony; index += 1) voices.push(makeVoice(index));
  }

  async function arm() {
    if (destroyed) return getState();
    const generation = armGeneration;
    try {
      context = await getAudioContext();
      if (context.state === 'suspended') await context.resume?.();
      if (generation !== armGeneration || destroyed) return getState();
      if (context.state && context.state !== 'running') {
        silentReason = 'audio context suspended';
        markDirty();
        report();
        return getState();
      }
      if (!graph) {
        const outputDestination = typeof getOutputDestination === 'function'
          ? await getOutputDestination()
          : context.destination;
        if (generation !== armGeneration || destroyed) return getState();
        if (!graph) buildGraph(outputDestination || context.destination);
      }
      armed = true;
      silentReason = 'waiting for MIDI or hands';
      lastEvent = 'armed';
      markDirty();
      report('music armed · waiting for MIDI or hands');
    } catch {
      if (generation !== armGeneration || destroyed) return getState();
      armed = false;
      silentReason = 'audio context suspended';
      markDirty();
      report();
    }
    return getState();
  }

  function clearTimer(voice) {
    if (!voice.timer) return;
    clearTimeout(voice.timer);
    timers.delete(voice.timer);
    voice.timer = null;
  }

  function schedule(callback, delayMs) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delayMs);
    timers.add(timer);
    return timer;
  }

  function clearHat({ resetClock = false } = {}) {
    if (hatTimer !== null) {
      clearTimeout(hatTimer);
      timers.delete(hatTimer);
      hatTimer = null;
    }
    hatGate = 0;
    setParam(graph?.hatGain?.gain, 0, now());
    if (resetClock) lastHatAt = -Infinity;
    if (active.size === 0) {
      gate = 0;
      setParam(graph?.masterGain?.gain, 0, now());
      silentReason = armed ? 'waiting for MIDI or hands' : 'sound disarmed';
    }
    markDirty();
  }

  function zeroHandModulation({ cutTail = true } = {}) {
    middleCurl = 0;
    ringCurl = 0;
    pinkyCurl = 0;
    tremoloDepth = 0;
    delaySend = cutTail ? 0 : clamp(music.presets[preset]?.delaySend);
    clearHat();
    setGraphControls();
  }

  function isHandVoice(voice) {
    return voice?.device === 'hands' || String(voice?.device || '').startsWith('finger:');
  }

  function clearFingerState() {
    fingerGates.fill(0);
    fingerTriggerArmed.fill(1);
    fingerLevels.fill(0);
    fingerCurls.fill(0);
    fingerSideActive.fill(0);
    fingerTrackIds[0] = '';
    fingerTrackIds[1] = '';
    harmony = 0;
  }

  function reconcileFingerVoices(range, timestamp) {
    const { on: fingerOn, off: fingerOff } = fingerSensitivityPresets[fingerSensitivity];
    const perHand = range?.hands && typeof range.hands === 'object' ? range.hands : null;
    let activeFingerCount = 0;
    for (let side = 0; side < SIDE_NAMES.length; side += 1) {
      const sideRange = perHand
        ? perHand[SIDE_NAMES[side]]
        : side === 1 ? range : null;
      fingerSideActive[side] = Number(sideRange?.active ?? Boolean(sideRange));
      fingerTrackIds[side] = fingerSideActive[side] ? String(sideRange?.trackId || '') : '';
      for (let finger = 0; finger < FINGER_NAMES.length; finger += 1) {
        const index = side * FINGER_NAMES.length + finger;
        const curl = fingerSideActive[side] ? clamp(sideRange?.curls?.[FINGER_NAMES[finger]]) : 0;
        fingerCurls[index] = curl;
        if (!fingerTriggerArmed[index]) {
          if (curl <= fingerOff) fingerTriggerArmed[index] = 1;
          fingerGates[index] = 0;
          fingerLevels[index] = 0;
          continue;
        }
        if (fingerGates[index]) {
          if (curl <= fingerOff) fingerGates[index] = 0;
        } else if (curl >= fingerOn) {
          fingerGates[index] = 1;
        }
        if (!fingerGates[index]) {
          fingerLevels[index] = 0;
          continue;
        }
        const span = Math.max(Number.EPSILON, 1 - fingerOff);
        fingerLevels[index] = clamp(0.35 + 0.65 * ((curl - fingerOff) / span));
        activeFingerCount += 1;
      }
    }

    const normalization = 1 / Math.sqrt(Math.max(1, activeFingerCount));
    for (let index = 0; index < fingerVoiceCount; index += 1) {
      const side = Math.floor(index / FINGER_NAMES.length);
      const finger = index % FINGER_NAMES.length;
      const note = fingerNotesBySide[side][finger];
      const key = fingerKeys[index];
      const existing = active.get(key);
      if (!fingerGates[index]) {
        if (existing && !existing.timer) {
          existing.releaseSeconds = fingerReleaseByFinger[finger];
          releaseVoice(existing);
          lastEvent = `${SIDE_NAMES[side]} ${FINGER_NAMES[finger]} ${note} off`;
        }
        continue;
      }

      const velocity = clamp(
        fingerLevels[index] * fingerGainMax * clamp(handRoute) * normalization,
      );
      if (velocity <= music.idleSnap) {
        if (existing && !existing.timer) releaseVoice(existing);
        continue;
      }
      if (!existing) {
        const voice = noteOn({
          type: 'note', note, velocity,
          channel: 0, device: fingerDevices[index], timestamp: timestamp + index * 0.001,
          attackSeconds: fingerAttackSeconds[finger],
          companionRatio: handHarmony === 'fifths' ? 2 ** ((side === 0 ? -7 : 7) / 12)
            : handHarmony === 'octaves' ? (side === 0 ? .5 : 2) : .5,
        });
        if (voice) {
          voice.releaseSeconds = fingerReleaseByFinger[finger];
          lastEvent = `${SIDE_NAMES[side]} ${FINGER_NAMES[finger]} ${note} on`;
        }
        continue;
      }
      clearTimer(existing);
      existing.pendingRelease = false;
      existing.velocity = velocity;
      existing.releaseSeconds = fingerReleaseByFinger[finger];
      targetParam(
        existing.gainNode.gain,
        velocity * music.voiceGain * music.sustainLevel,
        now(),
        fingerGainSmoothingSeconds,
      );
    }
    const activeSideCount = fingerSideActive[0] + fingerSideActive[1];
    harmony = activeFingerCount / (Math.max(1, activeSideCount) * FINGER_NAMES.length);
    markDirty();
  }

  function silenceHandVoices(reason = 'hand tracking lost') {
    const hasNonHandVoice = [...active.values()].some((voice) => !isHandVoice(voice));
    zeroHandModulation({ cutTail: !hasNonHandVoice });
    clearFingerState();
    for (const voice of [...active.values()]) {
      if (isHandVoice(voice)) releaseVoice(voice, true);
    }
    if (!hasNonHandVoice) {
      gate = 0;
      setParam(graph?.masterGain?.gain, 0, now());
      setParam(graph?.delaySend?.gain, 0, now());
      setParam(graph?.delayFeedback?.gain, 0, now());
      setParam(graph?.delayReturn?.gain, 0, now());
      silentReason = armed ? 'waiting for fresh hands or MIDI' : 'sound disarmed';
    }
    lastEvent = reason;
    markDirty();
    report(hasNonHandVoice ? 'hand gate zero · non-hand voice remains' : `${reason} · exact silence`);
    return getState();
  }

  function triggerHat(timestamp, activity) {
    if (!armed || !hatsEnabled || !graph?.hatSource || handRoute <= 0) return false;
    const intensity = clamp(activity) * clamp(handRoute);
    if (intensity < music.hatActivityFloor) return false;
    clearHat();
    const time = now();
    const brightness = music.hatFrequencyMin
      + (music.hatFrequencyMax - music.hatFrequencyMin) * clamp(activity);
    setGraphControls();
    setParam(graph.hatFilter.frequency, brightness, time);
    setParam(graph.hatGain.gain, 0, time);
    graph.hatGain.gain.linearRampToValueAtTime?.(intensity * music.hatGain, time + 0.002);
    targetParam(graph.hatGain.gain, 0, time + 0.008, Math.max(0.003, music.hatDurationMs / 4000));
    setParam(graph.masterGain.gain, master, time);
    hatGate = intensity;
    gate = Math.max(gate, intensity);
    lastHatAt = timestamp;
    lastEvent = `hat ${Math.round(intensity * 100)}%`;
    const timer = schedule(() => {
      if (hatTimer !== timer) return;
      hatTimer = null;
      hatGate = 0;
      setParam(graph?.hatGain?.gain, 0, now());
      if (active.size === 0) {
        gate = 0;
        setParam(graph?.masterGain?.gain, 0, now());
        silentReason = armed ? 'waiting for MIDI or hands' : 'sound disarmed';
      }
      markDirty();
      report();
    }, music.hatDurationMs + 24);
    hatTimer = timer;
    silentReason = '';
    markDirty();
    report('output active · hand hi-hat');
    return true;
  }

  function setHatsEnabled(enabled) {
    hatsEnabled = Boolean(enabled);
    if (!hatsEnabled) clearHat({ resetClock: true });
    lastEvent = hatsEnabled ? 'hats armed · waiting for hand motion' : 'hats off';
    markDirty();
    report(hatsEnabled ? 'hats armed · move a fresh hand' : 'hats off · exact silence');
    return getState();
  }

  function finalizeVoice(voice) {
    clearTimer(voice);
    if (voice.key && active.get(voice.key) === voice) active.delete(voice.key);
    if (voice.key && sustained.get(voice.key) === voice) sustained.delete(voice.key);
    voice.active = false;
    voice.pendingRelease = false;
    voice.key = '';
    setParam(voice.gainNode.gain, 0, now());
    markDirty();
    if (active.size === 0 && hatGate <= music.idleSnap) {
      gate = 0;
      silentReason = armed ? 'waiting for MIDI or hands' : 'sound disarmed';
      setParam(graph?.masterGain?.gain, 0, now());
      report();
    }
  }

  function releaseVoice(voice, immediate = false) {
    if (!voice?.active) return;
    const time = now();
    clearTimer(voice);
    voice.pendingRelease = false;
    if (immediate) {
      finalizeVoice(voice);
      return;
    }
    targetParam(voice.gainNode.gain, 0, time, Math.max(0.001, voice.releaseSeconds / 4));
    const timer = setTimeout(() => finalizeVoice(voice), voice.releaseSeconds * 1000 + 24);
    voice.timer = timer;
    timers.add(timer);
  }

  function chooseVoice() {
    const idle = voices.find((voice) => !voice.active);
    if (idle) return idle;
    let oldest = voices[0];
    for (const voice of voices) if (voice.startedAt < oldest.startedAt) oldest = voice;
    releaseVoice(oldest, true);
    return oldest;
  }

  function noteOn(event) {
    if (!armed || !graph) {
      silentReason = 'sound disarmed';
      report();
      return false;
    }
    const note = Math.round(clamp(event.note, music.noteMin, music.noteMax));
    const velocity = clamp(event.velocity);
    if (velocity <= 0) return noteOff({ ...event, note });
    const key = noteKey({ ...event, note });
    const existing = active.get(key);
    if (existing) releaseVoice(existing, true);
    const voice = chooseVoice();
    const time = now();
    const frequency = midiNoteFrequency(note, music.tuning);
    const shape = music.presets[preset];
    voice.key = key;
    voice.note = note;
    voice.channel = Math.round(clamp(event.channel, 0, 15));
    voice.device = String(event.device || 'unknown');
    voice.velocity = velocity;
    voice.active = true;
    voice.pendingRelease = false;
    voice.startedAt = finite(event.timestamp, Date.now());
    voice.sequence = ++voiceSerial;
    voice.releaseSeconds = Math.min(music.releaseSeconds, finite(shape.release, music.releaseSeconds));
    clearTimer(voice);
    setParam(voice.oscillator.frequency, frequency, time);
    setParam(voice.sub.frequency, frequency * (event.companionRatio || .5), time);
    const scope = channelKey(voice);
    const bendCents = (pitchBends.get(scope) || 0) * music.pitchBendSemitones * 100;
    const modCents = (modulations.get(scope) || 0) * music.modDepthCents;
    setParam(voice.oscillator.detune, bendCents - modCents, time);
    setParam(voice.sub.detune, bendCents + modCents, time);
    setParam(voice.gainNode.gain, 0, time);
    const peak = velocity * music.voiceGain;
    const defaultAttack = Math.min(music.attackSeconds, finite(shape.attack, music.attackSeconds));
    const attack = Number.isFinite(event.attackSeconds)
      ? clamp(event.attackSeconds, fingerAttackRange[0], fingerAttackRange[1])
      : defaultAttack;
    voice.gainNode.gain.linearRampToValueAtTime?.(peak, time + attack);
    voice.gainNode.gain.linearRampToValueAtTime?.(peak * music.sustainLevel, time + attack + music.decaySeconds);
    setGraphControls();
    setParam(graph.masterGain.gain, master, time);
    active.set(key, voice);
    gate = Math.max(gate, velocity);
    silentReason = '';
    lastEvent = `note ${note}`;
    markDirty();
    report(`output active · ${active.size} ${active.size === 1 ? 'voice' : 'voices'}`);
    return voice;
  }

  function noteOff(event) {
    const key = noteKey(event);
    const voice = active.get(key);
    if (!voice) return false;
    const sustainKey = `${voice.device}:${voice.channel}`;
    if (sustain.get(sustainKey)) {
      voice.pendingRelease = true;
      sustained.set(key, voice);
      markDirty();
      return true;
    }
    releaseVoice(voice);
    lastEvent = `release ${voice.note}`;
    markDirty();
    return true;
  }

  function control(event) {
    const controller = Math.round(finite(event.controller));
    const value = clamp(event.value);
    const scope = channelKey(event);
    if (controller === 1) {
      modulations.set(scope, value);
      const modCents = value * music.modDepthCents;
      for (const voice of active.values()) {
        if (channelKey(voice) !== scope) continue;
        const bendCents = (pitchBends.get(scope) || 0) * music.pitchBendSemitones * 100;
        targetParam(voice.oscillator.detune, bendCents - modCents, now(), 0.012);
        targetParam(voice.sub.detune, bendCents + modCents, now(), 0.012);
      }
      lastEvent = `mod ${Math.round(value * 100)}%`;
    }
    if (controller === 7) master = value * music.masterMax;
    if (controller === 71) resonance = value;
    if (controller === 74) cutoff = value;
    if (controller === 91) delaySend = value;
    if (controller === 21) texture = saturation = value;
    if (controller === 64) {
      sustain.set(scope, value >= 0.5);
      if (value < 0.5) {
        for (const [key, voice] of sustained) {
          if (channelKey(voice) !== scope) continue;
          sustained.delete(key);
          releaseVoice(voice);
        }
      }
    }
    if (graph && active.size > 0) setParam(graph.masterGain.gain, master, now());
    setGraphControls();
    markDirty();
    return true;
  }

  function bend(event) {
    const value = clamp(event.value, -1, 1);
    const scope = channelKey(event);
    pitchBends.set(scope, value);
    const cents = value * music.pitchBendSemitones * 100;
    const modCents = (modulations.get(scope) || 0) * music.modDepthCents;
    for (const voice of active.values()) {
      if (channelKey(voice) !== scope) continue;
      targetParam(voice.oscillator.detune, cents - modCents, now(), 0.012);
      targetParam(voice.sub.detune, cents + modCents, now(), 0.012);
    }
    lastEvent = `bend ${value.toFixed(2)}`;
    markDirty();
    return true;
  }

  function handleMidiEvent(event = {}) {
    if (destroyed) return getState();
    if (event.type === 'note') noteOn(event);
    else if (event.type === 'noteoff') noteOff(event);
    else if (event.type === 'cc') control(event);
    else if (event.type === 'pitchbend') bend(event);
    else if (event.type === 'panic') panic();
    return getState();
  }

  async function startDrone() {
    const generation = armGeneration;
    await arm();
    if (generation !== armGeneration || !armed || droneEnabled) return getState();
    droneEnabled = true;
    const timestamp = Date.now();
    for (let index = 0; index < music.droneNotes.length; index += 1) {
      noteOn({
        type: 'note',
        note: music.droneNotes[index],
        velocity: music.droneVelocity,
        channel: 15,
        device: 'music latch',
        timestamp: timestamp + index * 0.001,
      });
    }
    lastEvent = 'music latch on · continuous Rhodes bed';
    markDirty();
    report('music latch on · hands retune · panic stops');
    return getState();
  }

  function stopDrone({ immediate = false } = {}) {
    droneEnabled = false;
    for (const voice of [...active.values()]) {
      if (voice.device === 'music latch') releaseVoice(voice, immediate);
    }
    lastEvent = 'music latch off';
    markDirty();
    return getState();
  }

  function applyPreset(name) {
    if (!music.presets[name]) return;
    preset = name;
    const settings = music.presets[name];
    cutoff = clamp(settings.cutoff);
    delaySend = clamp(settings.delaySend);
    resonance = clamp(settings.resonance);
    texture = clamp(settings.texture);
    saturation = clamp(settings.texture);
    for (const voice of voices) {
      voice.oscillator.type = settings.waveform;
      voice.sub.type = settings.subWaveform;
    }
    setGraphControls();
    markDirty();
  }

  function acceptsGestureEvent(event) {
    if (handRole === 'both') return true;
    const handKey = String(event?.handKey || '');
    return !handKey || handKey === `hand:${handRole}`;
  }

  function update(input = {}) {
    if (destroyed) return getState();
    const timestamp = finite(input.timestamp, Date.now());
    lastUpdateTimestamp = timestamp;
    if (typeof input.preset === 'string') applyPreset(input.preset);
    const nextTranspose = Number.isInteger(input.transpose) ? Math.round(clamp(input.transpose, -12, 12)) : transpose;
    const nextMajor = typeof input.major === 'boolean' ? input.major : major;
    const nextHarmony = ['solo', 'fifths', 'octaves'].includes(input.handHarmony) ? input.handHarmony : handHarmony;
    if (nextTranspose !== transpose || nextMajor !== major || nextHarmony !== handHarmony) {
      silenceHandVoices('hand harmony updated');
      transpose = nextTranspose;
      major = nextMajor;
      handHarmony = nextHarmony;
      setFingerSceneNotes(fingerOctaveScene);
    }
    if (fingerOctaveScenes[input.fingerOctaveScene]
      && fingerOctaveScene !== input.fingerOctaveScene) {
      silenceHandVoices(`finger scene · ${input.fingerOctaveScene}`);
      fingerOctaveScene = input.fingerOctaveScene;
      setFingerSceneNotes(fingerOctaveScene);
      fingerTriggerArmed.fill(0);
      lastHandRangeAt = -Infinity;
      lastEvent = `finger scene ${fingerOctaveScene} · release to rearm`;
      markDirty();
    }
    if (Array.isArray(music.handRoles) && music.handRoles.includes(input.handRole) && handRole !== input.handRole) {
      handRole = input.handRole;
      markDirty();
    }
    if (fingerSensitivityPresets[input.fingerSensitivity]
      && fingerSensitivity !== input.fingerSensitivity) {
      fingerSensitivity = input.fingerSensitivity;
      silenceHandVoices(`finger sensitivity · ${fingerSensitivity}`);
    }
    if (input.fingerEnvelope && typeof input.fingerEnvelope === 'object') {
      let envelopeChanged = false;
      for (let index = 0; index < FINGER_NAMES.length; index += 1) {
        const source = input.fingerEnvelope[FINGER_NAMES[index]];
        if (!source) continue;
        if (Number.isFinite(Number(source.attack))) {
          const attack = clamp(source.attack, fingerAttackRange[0], fingerAttackRange[1]);
          if (fingerAttackSeconds[index] !== attack) {
            fingerAttackSeconds[index] = attack;
            envelopeChanged = true;
          }
        }
        if (Number.isFinite(Number(source.release))) {
          const release = clamp(source.release, fingerReleaseRange[0], fingerReleaseRange[1]);
          if (fingerReleaseByFinger[index] !== release) {
            fingerReleaseByFinger[index] = release;
            envelopeChanged = true;
          }
        }
      }
      if (envelopeChanged) {
        lastEvent = 'finger envelopes updated';
        markDirty();
      }
    }
    if (music.scales[input.scale] && scale !== input.scale) {
      scale = input.scale;
      markDirty();
    }
    let directGraphChange = false;
    if (Object.hasOwn(input, 'subjectRange')) {
      const nextAmount = clamp(input.subjectRange?.sound);
      const nextTimbre = nextAmount > clamp(subjectRouteConfig.idleSnap, 0, 0.1)
        ? clamp(input.subjectRange?.value)
        : 0;
      if (subjectAmount !== nextAmount || subjectTimbre !== nextTimbre) {
        subjectAmount = nextAmount;
        subjectTimbre = nextTimbre;
        directGraphChange = true;
        markDirty();
      }
    }
    if (Number.isFinite(input.master) && master !== clamp(input.master, 0, music.masterMax)) {
      master = clamp(input.master, 0, music.masterMax);
      markDirty();
    }
    if (Number.isFinite(input.cutoff) && cutoff !== clamp(input.cutoff)) {
      cutoff = clamp(input.cutoff);
      markDirty();
      directGraphChange = true;
    }
    if (Number.isFinite(input.delaySend) && delaySend !== clamp(input.delaySend)) {
      delaySend = clamp(input.delaySend);
      markDirty();
      directGraphChange = true;
    }
    if (Number.isFinite(input.saturation) && saturation !== clamp(input.saturation)) {
      saturation = texture = clamp(input.saturation);
      markDirty();
      directGraphChange = true;
    }
    if (Number.isFinite(input.handRoute) && handRoute !== clamp(input.handRoute)) {
      const previousHandRoute = handRoute;
      handRoute = clamp(input.handRoute);
      if (previousHandRoute > music.idleSnap && handRoute <= music.idleSnap) {
        silenceHandVoices('hands sound route = 0');
      } else {
        markDirty();
      }
    }
    if (directGraphChange) setGraphControls();
    if (input.range && timestamp - lastRangeAt >= music.gestureIntervalMs) {
      lastRangeAt = timestamp;
      lastHandRangeAt = timestamp;
      const presetSettings = music.presets[preset];
      const openness = clamp(input.range.openness ?? input.range.filter ?? cutoff);
      const spread = clamp(input.range.spread ?? input.range.delaySend);
      const motion = clamp(input.range.velocity?.magnitude);
      cutoff = clamp(clamp(presetSettings?.cutoff) * 0.45 + openness * 0.55);
      middleCurl = clamp(input.range.curls?.middle);
      ringCurl = clamp(input.range.curls?.ring);
      pinkyCurl = clamp(input.range.curls?.pinky);
      tremoloDepth = motion * 0.18;
      delaySend = clamp(clamp(presetSettings?.delaySend) * 0.35 + spread * 0.22);
      texture = clamp(Math.max(saturation, motion * 0.35));
      resonance = clamp(clamp(presetSettings?.resonance) + motion * 0.18);
      reconcileFingerVoices(input.range, timestamp);
      setGraphControls();
      const activity = motion;
      const hatInterval = music.hatMaxIntervalMs
        - (music.hatMaxIntervalMs - music.hatMinIntervalMs) * motion;
      if (timestamp - lastHatAt >= hatInterval) triggerHat(timestamp, activity);
      markDirty();
    } else if (Number.isFinite(lastHandRangeAt) && timestamp - lastHandRangeAt > fingerLossMs) {
      lastHandRangeAt = -Infinity;
      silenceHandVoices('hand tracking lost');
    }
    if (input.framePhase === 'off' && lastFramePhase !== 'off') {
      silenceAll('waiting for MIDI or hands', 'frame off');
    }
    if (typeof input.framePhase === 'string') lastFramePhase = input.framePhase;
    if (input.event && !acceptsGestureEvent(input.event)) {
      lastEvent = `${String(input.event.handKey || 'other hand').replace('hand:', '')} hand · texture only`;
      markDirty();
    } else if (input.event && handRoute > 0 && armed && timestamp - lastGestureAt >= music.beaconCooldownMs) {
      lastGestureAt = timestamp;
      lastEvent = 'pinch accent · ten side-owned pitches stay fixed';
      markDirty();
    } else if (input.event && handRoute <= 0) {
      silentReason = active.size ? '' : 'hands sound route = 0';
      markDirty();
    }
    if (graph && active.size > 0) setParam(graph.masterGain.gain, master, now());
    return getState();
  }

  async function testOutput() {
    await arm();
    if (!armed) return getState();
    const event = {
      type: 'note', note: music.testNote, velocity: music.testVelocity,
      channel: 0, device: 'test output', timestamp: Date.now(),
    };
    const voice = noteOn(event);
    if (voice) scheduleVoiceOff(voice, event, music.testDurationMs);
    return getState();
  }

  function isSilent() {
    return active.size === 0 && hatGate <= music.idleSnap;
  }

  function getState() {
    if (!stateDirty && cachedState) return cachedState;
    const activeNotes = Object.freeze([...active.values()].map((voice) => Object.freeze({
      key: voice.key, note: voice.note, channel: voice.channel,
      velocity: voice.velocity, device: voice.device,
    })));
    const fingerGateStates = {};
    const fingerEnvelopes = {};
    const fingerHands = {};
    for (let index = 0; index < FINGER_NAMES.length; index += 1) {
      const finger = FINGER_NAMES[index];
      fingerEnvelopes[finger] = Object.freeze({
        attack: fingerAttackSeconds[index],
        release: fingerReleaseByFinger[index],
      });
      const leftIndex = index;
      const rightIndex = FINGER_NAMES.length + index;
      const leftVoice = active.get(fingerKeys[leftIndex]);
      const rightVoice = active.get(fingerKeys[rightIndex]);
      const leftGate = fingerGates[leftIndex] ? 'on' : leftVoice?.timer ? 'release' : 'off';
      const rightGate = fingerGates[rightIndex] ? 'on' : rightVoice?.timer ? 'release' : 'off';
      fingerGateStates[finger] = leftGate === 'on' || rightGate === 'on'
        ? 'on'
        : leftGate === 'release' || rightGate === 'release' ? 'release' : 'off';
    }
    for (let side = 0; side < SIDE_NAMES.length; side += 1) {
      const notes = {};
      const levels = {};
      const curls = {};
      const gates = {};
      for (let finger = 0; finger < FINGER_NAMES.length; finger += 1) {
        const name = FINGER_NAMES[finger];
        const index = side * FINGER_NAMES.length + finger;
        const voice = active.get(fingerKeys[index]);
        notes[name] = fingerNotesBySide[side][finger];
        levels[name] = fingerLevels[index];
        curls[name] = fingerCurls[index];
        gates[name] = fingerGates[index] ? 'on' : voice?.timer ? 'release' : 'off';
      }
      fingerHands[SIDE_NAMES[side]] = Object.freeze({
        active: Boolean(fingerSideActive[side]),
        trackId: fingerTrackIds[side],
        notes: Object.freeze(notes),
        levels: Object.freeze(levels),
        curls: Object.freeze(curls),
        gates: Object.freeze(gates),
      });
    }
    cachedState = Object.freeze({
      armed, silent: isSilent(), silentReason: isSilent() ? silentReason : '',
      preset, scale, handRole, fingerSensitivity, fingerOctaveScene, activeNotes, voiceCount: activeNotes.length,
      contextState: String(context?.state || 'not-created'),
      gate: isSilent() ? 0 : gate, master, cutoff, delaySend, saturation, harmony, lastEvent,
      subjectRoute: Object.freeze({ amount: subjectAmount, timbre: subjectTimbre }),
      handFresh: Number.isFinite(lastHandRangeAt)
        && Number.isFinite(lastUpdateTimestamp)
        && lastUpdateTimestamp - lastHandRangeAt <= fingerLossMs,
      droneEnabled, hatsEnabled, hatGate: hatGate <= music.idleSnap ? 0 : hatGate,
      fingers: Object.freeze({
        thumb: Math.max(fingerLevels[0], fingerLevels[5]),
        index: Math.max(fingerLevels[1], fingerLevels[6]),
        middle: Math.max(fingerLevels[2], fingerLevels[7]),
        ring: Math.max(fingerLevels[3], fingerLevels[8]),
        pinky: Math.max(fingerLevels[4], fingerLevels[9]),
        tremolo: tremoloDepth,
        scene: fingerOctaveScene,
        notes: Object.freeze({
          thumb: fingerNotesBySide[1][0], index: fingerNotesBySide[1][1], middle: fingerNotesBySide[1][2],
          ring: fingerNotesBySide[1][3], pinky: fingerNotesBySide[1][4],
        }),
        curls: Object.freeze({
          thumb: Math.max(fingerCurls[0], fingerCurls[5]),
          index: Math.max(fingerCurls[1], fingerCurls[6]),
          middle: Math.max(fingerCurls[2], fingerCurls[7]),
          ring: Math.max(fingerCurls[3], fingerCurls[8]),
          pinky: Math.max(fingerCurls[4], fingerCurls[9]),
        }),
        gates: Object.freeze(fingerGateStates),
        envelopes: Object.freeze(fingerEnvelopes),
        hands: Object.freeze(fingerHands),
      }),
      fingerThresholds: fingerSensitivityPresets[fingerSensitivity],
    });
    stateDirty = false;
    return cachedState;
  }

  function scheduleVoiceOff(voice, event, delayMs) {
    const sequence = voice.sequence;
    schedule(() => {
      if (active.get(voice.key) !== voice || voice.sequence !== sequence) return;
      noteOff({ ...event, type: 'noteoff' });
    }, delayMs);
  }

  function silenceAll(reason, eventName) {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    sustained.clear();
    sustain.clear();
    pitchBends.clear();
    modulations.clear();
    hatsEnabled = false;
    droneEnabled = false;
    clearHat({ resetClock: true });
    clearFingerState();
    lastRangeAt = -Infinity;
    lastGestureAt = -Infinity;
    lastHandRangeAt = -Infinity;
    middleCurl = 0;
    ringCurl = 0;
    pinkyCurl = 0;
    tremoloDepth = 0;
    subjectTimbre = 0;
    subjectAmount = 0;
    for (const voice of voices) releaseVoice(voice, true);
    active.clear();
    gate = 0;
    if (graph) {
      setParam(graph.masterGain.gain, 0, now());
      setParam(graph.delaySend.gain, 0, now());
      setParam(graph.delayFeedback.gain, 0, now());
      setParam(graph.delayReturn.gain, 0, now());
      setParam(graph.tremoloDepth?.gain, 0, now());
      setParam(graph.hatGain?.gain, 0, now());
    }
    silentReason = reason;
    lastEvent = eventName;
    markDirty();
    report();
    return getState();
  }

  function panic({ disarm = false } = {}) {
    armGeneration += 1;
    if (disarm) armed = false;
    return silenceAll('panic · exact silence', 'panic');
  }

  function destroy() {
    if (destroyed) return;
    panic();
    destroyed = true;
    armed = false;
    markDirty();
    for (const voice of voices) {
      voice.oscillator.stop?.();
      voice.sub.stop?.();
      voice.oscillator.disconnect?.();
      voice.sub.disconnect?.();
      voice.gainNode.disconnect?.();
    }
    graph?.tremolo?.stop?.();
    graph?.hatSource?.stop?.();
    for (const node of Object.values(graph || {})) node?.disconnect?.();
    voices.length = 0;
    graph = null;
    silentReason = 'sound disarmed';
  }

  return Object.freeze({ arm, startDrone, stopDrone, handleMidiEvent, update, setHatsEnabled, testOutput, panic, getState, destroy });
}
