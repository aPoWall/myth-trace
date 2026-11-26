import { CONFIG } from './config.js';
import { VOICINGS } from './instruments.js';
import { makeDrumBuffer, rhythmStep } from './rhythm.js';
import { getSamplePlaybackRate } from './sample-pitch.js';

const audio = CONFIG.audio;
const room = audio.ambience;
const beat = CONFIG.rhythm;
const sampleSettings = CONFIG.samples;

function clamp(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function isStarScene(scene) {
  return scene !== 'metal' && Object.hasOwn(audio.scenes, scene);
}

function getTimbre(scene) {
  return isStarScene(scene) ? audio.scenes[scene] : audio.scenes.atlas;
}

function midiFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function stringNote({
  midi = 57, frequency, velocity = .6, x = .5, tension = .5, u = .5, scene = 'loom',
} = {}) {
  midi = clamp(midi, 0, 127, 57);
  scene = isStarScene(scene) ? scene : 'atlas';
  return {
    midi,
    frequency: Number.isFinite(frequency) && frequency > 0 ? frequency : midiFrequency(midi),
    velocity: clamp(velocity, 0, CONFIG.strings.maxVelocity, .6),
    x: clamp(x, 0, 1, .5),
    tension: clamp(tension, 0, 1, .5),
    u: clamp(u, audio.stringTouchMin, 1 - audio.stringTouchMin, .5),
    scene,
    timbre: audio.stringScenes[scene] ?? audio.scenes.metal,
  };
}

function chordNote({ frequency = 220, voicing = 'single', ...options } = {}) {
  const { intervals } = VOICINGS.find(({ id }) => id === voicing) ?? VOICINGS[0];
  return { ...stringNote({ ...options, frequency }), intervals };
}

function makeNoise(context, channels, seconds) {
  const buffer = context.createBuffer(channels, Math.ceil(context.sampleRate * seconds), context.sampleRate);
  let seed = 1;
  for (let ch = 0; ch < channels; ch++) {
    const samples = buffer.getChannelData(ch);
    for (let i = 0; i < samples.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      samples[i] = seed / 0x80000000 - 1;
    }
  }
  return buffer;
}

function makeGraph(context, volume, muted, space = 0, beatVolume = beat.volume, sampleVolume = sampleSettings.volume) {
  const master = context.createGain();
  master.gain.value = volume;
  const limiter = context.createWaveShaper();
  const curve = new Float32Array(audio.saturatorSize);
  for (let i = 0; i < curve.length; i++) {
    const input = (2 * i) / (curve.length - 1) - 1;
    curve[i] = audio.limit * Math.tanh(input / audio.limit);
  }
  limiter.curve = curve;

  const analyser = context.createAnalyser();
  analyser.fftSize = audio.meterSize;
  const output = context.createGain();
  output.gain.value = muted ? 0 : 1;
  master.connect(limiter).connect(analyser).connect(output).connect(context.destination);

  const ambience = context.createGain();
  ambience.gain.value = space;
  ambience.connect(master);
  const drumBus = context.createGain();
  drumBus.gain.value = beatVolume;
  drumBus.connect(master);
  const sampleBus = context.createGain();
  sampleBus.gain.value = sampleVolume;
  sampleBus.connect(master);

  return {
    context,
    master,
    analyser,
    samples: new Float32Array(analyser.fftSize),
    noise: makeNoise(context, 1, audio.noiseSeconds),
    voices: new Set(),
    ambience,
    ambienceVoices: new Set(),
    drumBus, drumBuffers: new Map(), drumVoices: new Set(),
    sampleBus, sampleVoices: new Set(),
  };
}

function envelope(param, start, attack, length, peak, release = audio.release, minimum = audio.minimumGain) {
  const end = start + length;
  const fade = Math.min(release, (length - attack) / 2);
  const floor = Math.min(minimum, peak / 2);
  param.setValueAtTime(0, start);
  param.linearRampToValueAtTime(peak, start + attack);
  param.exponentialRampToValueAtTime(floor, end - fade);
  param.linearRampToValueAtTime(0, end);
}

function releaseVoice(context, voices, voice, stop = false) {
  if (!voices.delete(voice)) return;
  for (const node of voice.nodes) node.disconnect();
  if (stop) {
    for (const source of voice.sources) {
      source.onended = null;
      source.stop(context.currentTime);
    }
  }
}

function clearVoices(context, voices) {
  for (const voice of voices) releaseVoice(context, voices, voice, true);
}

function rampGain(param, value, time) {
  if (param.cancelAndHoldAtTime) {
    param.cancelAndHoldAtTime(time);
  } else {
    const previous = param.value;
    param.cancelScheduledValues(time);
    param.setValueAtTime(previous, time);
  }
  param.linearRampToValueAtTime(value, time + audio.volumeRamp);
}

function playDrum(graph, voiceName, start, velocity, limitVoices = true) {
  const { context, drumBus, drumBuffers, drumVoices } = graph;
  if (limitVoices && drumVoices.size >= beat.maxVoices) {
    releaseVoice(context, drumVoices, drumVoices.values().next().value, true);
  }
  if (!drumBuffers.has(voiceName)) drumBuffers.set(voiceName, makeDrumBuffer(context, voiceName));
  const source = context.createBufferSource();
  source.buffer = drumBuffers.get(voiceName);
  const gain = context.createGain();
  gain.gain.value = velocity * beat.gain;
  const pan = context.createStereoPanner();
  pan.pan.value = beat.drums[voiceName].pan;
  source.connect(gain).connect(pan).connect(drumBus);
  const voice = { nodes: [source, gain, pan], sources: [source] };
  drumVoices.add(voice);
  source.onended = () => releaseVoice(context, drumVoices, voice);
  source.start(start);
}

function getSlice(buffer, options = {}) {
  const { start = 0, end = 1, reverse = false, velocity = .6 } = options;
  const speed = getSamplePlaybackRate(options);
  const left = clamp(start, 0, 1, 0);
  const right = clamp(end, 0, 1, 1);
  const strength = clamp(velocity, 0, 1, .6);
  if (right <= left || strength === 0) return null;
  const first = Math.floor(left * buffer.length);
  const last = Math.min(buffer.length, Math.ceil(right * buffer.length));
  const count = Math.min(last - first, Math.floor(sampleSettings.maxTriggerSeconds * speed * buffer.sampleRate));
  if (count <= 0) return null;
  return { first: reverse ? last - count : first, count, speed, strength, reverse: Boolean(reverse) };
}

function playSample(graph, buffer, slice, start) {
  const { context, sampleBus, sampleVoices } = graph;
  const { first, count, speed, strength, reverse } = slice;
  if (sampleVoices.size >= sampleSettings.maxVoices) {
    releaseVoice(context, sampleVoices, sampleVoices.values().next().value, true);
  }
  const source = context.createBufferSource();
  let offset = first / buffer.sampleRate;
  if (reverse) {
    const flipped = context.createBuffer(buffer.numberOfChannels, count, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const from = buffer.getChannelData(ch);
      const to = flipped.getChannelData(ch);
      for (let i = 0; i < count; i++) to[i] = from[first + count - 1 - i];
    }
    source.buffer = flipped;
    offset = 0;
  } else source.buffer = buffer;
  source.playbackRate.value = speed;

  const gain = context.createGain();
  const bufferSeconds = count / buffer.sampleRate;
  const duration = bufferSeconds / speed;
  const amplitude = sampleSettings.gain * strength;
  const attack = Math.min(sampleSettings.attack, duration / 4);
  const release = Math.min(sampleSettings.release, duration / 4);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(amplitude, start + attack);
  gain.gain.setValueAtTime(amplitude, start + duration - release);
  gain.gain.linearRampToValueAtTime(0, start + duration);
  source.connect(gain).connect(sampleBus);
  const voice = { nodes: [source, gain], sources: [source] };
  sampleVoices.add(voice);
  source.onended = () => releaseVoice(context, sampleVoices, voice);
  source.start(start, offset, bufferSeconds);
  source.stop(start + duration);
}

function describeSample(id, name, buffer) {
  const peaks = Array(sampleSettings.peakCount).fill(0);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  for (const channel of channels) {
    for (let i = 0; i < buffer.length; i++) {
      const bin = Math.floor(i * peaks.length / buffer.length);
      peaks[bin] = Math.min(1, Math.max(peaks[bin], Math.abs(channel[i])));
    }
  }
  const slices = Array.from({ length: sampleSettings.sliceCount }, (_, index) => Object.freeze({
    start: index / sampleSettings.sliceCount, end: (index + 1) / sampleSettings.sliceCount,
  }));
  return Object.freeze({
    id, name, duration: buffer.duration, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate,
    peaks: Object.freeze(peaks), slices: Object.freeze(slices),
  });
}

async function sampleBytes(url, blob, signal) {
  const { maxBytes } = sampleSettings;
  const tooLarge = () => new Error(`Sample file must be at most ${maxBytes / 1048576} MB`);
  if (blob instanceof Blob) {
    if (!blob.size) throw new Error('Sample file is empty');
    if (blob.size > maxBytes) throw tooLarge();
    return blob.arrayBuffer();
  }
  if (!url || !globalThis.location?.href) throw new Error('Choose a local sample');
  const target = new URL(url, location.href);
  if (target.origin !== location.origin || !['http:', 'https:'].includes(target.protocol)) {
    throw new Error('Sample URLs must be local to this instrument');
  }
  const response = await fetch(target, { signal, redirect: 'error' });
  if (!response.ok) throw new Error(`Sample unavailable (HTTP ${response.status})`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw tooLarge();
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maxBytes) throw tooLarge();
    return bytes;
  }
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return bytes.buffer;
}

function playVoice(graph, {
  midi, frequency = midiFrequency(midi), velocity, x, timbre, tension = 0, u,
  level = 0, brightness = 0, start,
}) {
  const { context } = graph;
  const cutoff = audio.nyquistMargin * context.sampleRate / 2;
  const fundamental = Math.min(cutoff, frequency);
  const gain = audio.noteGain * timbre.gain * velocity;
  const attack = audio.attack * timbre.attackScale;
  const spaceTail = Math.max(0, ...timbre.space.map(([delay]) => delay));
  const isString = u !== undefined;
  const stiffness = isString
    ? (timbre.stiffness ?? 1) * (audio.stringStiffness + (1 - tension) * audio.stringSlackStiffness)
    : 0;
  const contact = isString ? Math.PI * u : 0;
  const contactAtFundamental = Math.sin(contact);
  const lastPartial = timbre.partials.at(-1);
  const highestMode = lastPartial[3] ?? lastPartial[0];

  const body = context.createGain();
  const pan = context.createStereoPanner();
  const output = context.createGain();
  pan.pan.value = (2 * x - 1) * audio.panWidth;
  body.connect(pan).connect(output).connect(graph.master);

  const voice = { nodes: [body, pan, output], sources: [] };
  for (const [time, reflectionLevel, position] of timbre.space) {
    const delay = context.createDelay(time);
    const reflection = context.createGain();
    const side = context.createStereoPanner();
    delay.delayTime.value = time;
    reflection.gain.value = reflectionLevel;
    side.pan.value = position;
    body.connect(delay).connect(reflection).connect(side).connect(output);
    voice.nodes.push(delay, reflection, side);
  }

  const overtones = [];
  let voiceEnd = 0;
  for (const [ratio, amplitude, decayScale, order = ratio] of timbre.partials) {
    // A stiff wire stretches upper modes while holding the fundamental fixed.
    const partialHz = fundamental * ratio * Math.sqrt((1 + stiffness * ratio ** 2) / (1 + stiffness));
    if (partialHz > cutoff) continue;
    let strength = amplitude;
    if (isString) {
      // A pluck at a standing wave's node leaves that mode unexcited.
      const excitation = Math.abs(Math.sin(contact * order) / contactAtFundamental);
      if (excitation < audio.stringModeFloor) continue;
      const highMode = Math.sqrt((order - 1) / (highestMode - 1));
      const tilt = (1 + tension * audio.stringTensionBrighten) ** highMode;
      strength *= Math.min(audio.stringTouchBoost, excitation) * tilt;
    }
    const oscillator = context.createOscillator();
    const partial = context.createGain();
    const duration = Math.min(audio.tail - spaceTail, audio.decay * timbre.decayScale * decayScale);
    oscillator.frequency.value = partialHz;
    if (timbre.bendCents) {
      oscillator.detune.setValueAtTime(timbre.bendCents, start);
      oscillator.detune.linearRampToValueAtTime(0, start + audio.bendTime);
    }
    envelope(partial.gain, start, attack, duration, strength * gain);
    oscillator.connect(partial).connect(body);
    voice.nodes.push(oscillator, partial);
    voice.sources.push(oscillator);
    overtones.push({ oscillator, duration });
    voiceEnd = Math.max(voiceEnd, duration);
  }

  const noise = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const noiseGain = context.createGain();
  noise.buffer = graph.noise;
  // Each pitch uses a different short slice of the same noise buffer.
  const offset = (midi / 128) * (audio.noiseSeconds - timbre.noiseDecay);
  filter.type = 'bandpass';
  const noiseBrightness = 1 + brightness * level * audio.voiceBrighten + tension * audio.stringNoiseBrighten;
  filter.frequency.value = Math.min(cutoff, timbre.noiseHz * noiseBrightness);
  filter.Q.value = timbre.noiseQ;
  envelope(noiseGain.gain, start, audio.noiseAttack, timbre.noiseDecay,
    gain * timbre.noise * (1 + level * audio.voiceBreath));
  noise.connect(filter).connect(noiseGain).connect(body);
  voice.nodes.push(noise, filter, noiseGain);
  voice.sources.push(noise);
  noise.start(start, offset, timbre.noiseDecay);

  graph.voices.add(voice);
  let keepAlive = true;
  for (const { oscillator, duration } of overtones) {
    const endsVoice = keepAlive && duration === voiceEnd;
    if (endsVoice) {
      // Its envelope is already at zero while the last reflection finishes.
      oscillator.onended = () => releaseVoice(context, graph.voices, voice);
      keepAlive = false;
    }
    oscillator.start(start);
    oscillator.stop(start + duration + (endsVoice ? spaceTail : 0));
  }
}

function exciteRoom(graph, {
  midi, frequency = midiFrequency(midi), x, velocity, scene, start, level = 0, brightness = 0,
}) {
  const { context, ambienceVoices } = graph;
  if (ambienceVoices.size >= room.maxVoices) {
    releaseVoice(context, ambienceVoices, ambienceVoices.values().next().value, true);
  }
  const palette = room.scenes[scene] ?? room.scenes.atlas;
  const length = Math.min(palette.seconds, room.tail);
  const cutoff = audio.nyquistMargin * context.sampleRate / 2;
  const [sweepFrom, sweepTo, q, airLevel] = palette.noise;
  const airBrightness = 1 + brightness * level * audio.voiceBrighten;
  const airGain = airLevel * velocity * (1 + level * audio.voiceBreath);

  graph.air ??= makeNoise(context, 2, room.tail);
  const air = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const breath = context.createGain();
  const drift = context.createStereoPanner();
  air.buffer = graph.air;
  filter.type = 'bandpass';
  filter.Q.value = q;
  const airCutoff = room.airCeilingRatio * context.sampleRate;
  filter.frequency.setValueAtTime(clamp(sweepFrom * airBrightness, room.airFloorHz, airCutoff, room.airFloorHz),
    start);
  filter.frequency.exponentialRampToValueAtTime(
    clamp(sweepTo * airBrightness, room.airFloorHz, airCutoff, room.airFloorHz), start + length);
  drift.pan.value = (2 * x - 1) * room.airPan;
  envelope(breath.gain, start, palette.attack, length, airGain, room.fade, airGain * room.tailFloor);
  air.connect(filter).connect(breath).connect(drift).connect(graph.ambience);

  const voice = { nodes: [air, filter, breath, drift], sources: [air] };
  for (const [ratio, amplitude, position, delay, span] of palette.tones) {
    const hz = frequency * ratio;
    if (hz > cutoff) continue;
    const tone = context.createOscillator();
    const gain = context.createGain();
    const pan = context.createStereoPanner();
    const onset = start + delay;
    const duration = (length - delay) * span;
    const peak = amplitude * velocity;
    tone.frequency.value = hz;
    pan.pan.value = position;
    envelope(gain.gain, onset, palette.attack, duration, peak, room.fade, peak * room.tailFloor);
    tone.connect(gain).connect(pan).connect(graph.ambience);
    tone.start(onset);
    tone.stop(onset + duration);
    voice.nodes.push(tone, gain, pan);
    voice.sources.push(tone);
  }

  ambienceVoices.add(voice);
  air.onended = () => releaseVoice(context, ambienceVoices, voice);
  air.start(start);
  air.stop(start + length);
}

function playNote(graph, note, backing) {
  const count = Math.min(audio.maxVoices, note.intervals?.length ?? 1);
  while (graph.voices.size + count > audio.maxVoices) {
    releaseVoice(graph.context, graph.voices, graph.voices.values().next().value, true);
  }
  if (count === 1) {
    playVoice(graph, note);
  } else {
    const velocity = note.velocity / Math.sqrt(count);
    for (let i = 0; i < count; i++) {
      const interval = note.intervals[i];
      const x = clamp(note.x + (2 * i / (count - 1) - 1) * audio.chordSpread, 0, 1, note.x);
      playVoice(graph, {
        ...note,
        midi: clamp(note.midi + interval, 0, 127, note.midi),
        frequency: note.frequency * 2 ** (interval / 12),
        velocity,
        x,
      });
    }
  }
  if (backing) exciteRoom(graph, note);
}

function isMuted(requested) {
  return Boolean(requested || globalThis.navigator?.webdriver
    || new URLSearchParams(globalThis.location?.search).has('mute'));
}

export function createAudioEngine({ muted = false } = {}) {
  const muteOutput = isMuted(muted);
  let graph;
  let pendingArm;
  let disposed = false;
  let volume = audio.volume;
  let scene = 'atlas';
  let level = 0;
  let brightness = 0;
  let voiceAmount = audio.voiceAmount;
  let environment = true;
  let space = room.space;
  let beatVolume = beat.volume;
  let sampleVolume = sampleSettings.volume;
  let pendingSample = null;
  let lastSample = null;
  const library = new Map();
  const silenceListeners = new Set();

  const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const isRunning = () => graph?.context.state === 'running';

  function arm() {
    if (disposed || !AudioContext) return Promise.resolve(false);
    if (pendingArm) return pendingArm;
    if (isRunning()) return Promise.resolve(true);
    let context;
    try {
      if (!graph) {
        context = new AudioContext();
        graph = makeGraph(context, volume, muteOutput, space, beatVolume, sampleVolume);
      }
      pendingArm = graph.context.resume()
        .then(() => !disposed && isRunning(), () => false)
        .finally(() => { pendingArm = null; });
      return pendingArm;
    } catch {
      context?.close().catch(() => {});
      return Promise.resolve(false);
    }
  }

  function strike(note) {
    if (!isRunning() || note.velocity === 0) return false;
    playNote(graph, {
      ...note,
      level: level * voiceAmount,
      brightness,
      start: graph.context.currentTime,
    }, environment && space > 0);
    return true;
  }

  function pluck({ midi = 60, velocity = .6, x = .5, scene: noteScene = scene } = {}) {
    return strike({
      midi: clamp(midi, 0, 127, 60),
      velocity: clamp(velocity, 0, 1, .6),
      x: clamp(x, 0, 1, .5),
      scene: noteScene,
      timbre: getTimbre(noteScene),
    });
  }

  function pluckString({ scene: noteScene = scene, ...options } = {}) {
    return strike(stringNote({ ...options, scene: noteScene }));
  }

  function pluckChord({ scene: noteScene = scene, ...options } = {}) {
    return strike(chordNote({ ...options, scene: noteScene }));
  }

  function setVoice(nextLevel, nextBrightness) {
    level = clamp(nextLevel, 0, 1, 0);
    brightness = clamp(nextBrightness, 0, 1, 0);
  }

  function setVoiceAmount(value) {
    voiceAmount = clamp(value, 0, 1, voiceAmount);
  }

  function setScene(id) {
    if (isStarScene(id)) scene = id;
  }

  function setEnvironment(enabled) {
    environment = Boolean(enabled);
    if (!environment && graph) clearVoices(graph.context, graph.ambienceVoices);
  }

  function setSpace(value) {
    space = clamp(value, 0, 1, space);
    if (graph) rampGain(graph.ambience.gain, space, graph.context.currentTime);
  }

  function setVolume(value) {
    volume = clamp(value, 0, 1, volume);
    if (graph) rampGain(graph.master.gain, volume, graph.context.currentTime);
  }

  function getAudioTime() {
    return isRunning() ? graph.context.currentTime : null;
  }

  function scheduleDrum({ voice, time, velocity = .7 } = {}) {
    const now = getAudioTime();
    const strength = clamp(velocity, 0, 1, .7);
    if (now === null || strength === 0 || !Object.hasOwn(beat.drums, voice)) return false;
    const start = Number.isFinite(time) ? Math.max(now, time) : now;
    if (start - now > beat.maxFuture) return false;
    playDrum(graph, voice, start, strength);
    return true;
  }

  function setBeatVolume(value) {
    beatVolume = clamp(value, 0, 1, beatVolume);
    if (graph) rampGain(graph.drumBus.gain, beatVolume, graph.context.currentTime);
  }

  function stopDrums() {
    if (graph) clearVoices(graph.context, graph.drumVoices);
  }

  function onSilence(listener) {
    silenceListeners.add(listener);
    return () => silenceListeners.delete(listener);
  }

  async function loadSample({ id, name, url, blob } = {}) {
    if (disposed || !graph) throw new Error('Enable sound before decoding a sample');
    if (typeof id !== 'string' || !id.trim()) throw new Error('Sample ID is required');
    const { context } = graph;
    pendingSample?.abort();
    const load = new AbortController();
    pendingSample = load;
    try {
      const bytes = await sampleBytes(url, blob, load.signal);
      if (load.signal.aborted) throw new Error('Sample load replaced');
      const buffer = await context.decodeAudioData(bytes);
      if (load.signal.aborted || graph?.context !== context) throw new Error('Sample load replaced');
      if (buffer.duration <= 0 || buffer.duration > sampleSettings.maxDecodedSeconds
          || buffer.numberOfChannels > sampleSettings.maxChannels) {
        throw new Error(`Sample must be mono or stereo and at most ${sampleSettings.maxDecodedSeconds} seconds`);
      }
      const info = describeSample(id, name || blob?.name || id, buffer);
      library.delete(id);
      library.set(id, { buffer, info });
      if (library.size > sampleSettings.maxEntries) library.delete(library.keys().next().value);
      lastSample = id;
      return info;
    } finally {
      if (pendingSample === load) pendingSample = null;
    }
  }

  function getSampleInfo(id = lastSample) {
    return library.get(id)?.info ?? null;
  }

  function triggerSample({ id = lastSample, ...options } = {}) {
    const now = getAudioTime();
    const record = library.get(id);
    if (now === null || !record) return false;
    const slice = getSlice(record.buffer, options);
    if (!slice) return false;
    playSample(graph, record.buffer, slice, now);
    return true;
  }

  function setSampleVolume(value) {
    sampleVolume = clamp(value, 0, 1, sampleVolume);
    if (graph) rampGain(graph.sampleBus.gain, sampleVolume, graph.context.currentTime);
  }

  function sampleStop() {
    if (graph) clearVoices(graph.context, graph.sampleVoices);
  }

  function silence() {
    for (const stop of silenceListeners) {
      try { stop(); } catch { /* A transport callback cannot prevent panic. */ }
    }
    if (!graph) return;
    clearVoices(graph.context, graph.voices);
    clearVoices(graph.context, graph.ambienceVoices);
    stopDrums();
    sampleStop();
    graph.samples.fill(0);
  }

  function dispose() {
    disposed = true;
    pendingSample?.abort();
    silence();
    silenceListeners.clear();
    library.clear();
    if (!graph) return Promise.resolve();
    const { context } = graph;
    graph = null;
    return context.state === 'closed' ? Promise.resolve() : context.close();
  }

  function getMetrics() {
    const armed = isRunning();
    let sum = 0;
    let peak = 0;
    if (armed && (graph.voices.size || graph.ambienceVoices.size || graph.drumVoices.size || graph.sampleVoices.size)) {
      graph.analyser.getFloatTimeDomainData(graph.samples);
      for (const sample of graph.samples) {
        sum += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
    }
    return {
      armed,
      muted: muteOutput,
      rms: armed ? Math.sqrt(sum / graph.samples.length) : 0,
      peak,
      voices: graph?.voices.size ?? 0,
      ambienceVoices: graph?.ambienceVoices.size ?? 0,
      drumVoices: graph?.drumVoices.size ?? 0,
      sampleVoices: graph?.sampleVoices.size ?? 0,
      scene,
      environment,
      space,
      voiceAmount,
      contextState: graph?.context.state ?? (disposed ? 'closed' : AudioContext ? 'unarmed' : 'unavailable'),
    };
  }

  return {
    arm, pluck, pluckString, pluckChord, setVoice, setVoiceAmount, setScene,
    setEnvironment, setSpace, setVolume, silence, dispose, getMetrics,
    getAudioTime, scheduleDrum, setBeatVolume, stopDrums, onSilence,
    loadSample, triggerSample, getSampleInfo, setSampleVolume, sampleStop,
    getLoadedSamples: () => [...library.values()].map(({ info }) => info),
  };
}

function offlineGraph(duration, space = 0, beatVolume = beat.volume, sampleVolume = sampleSettings.volume) {
  const OfflineAudioContext = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
  if (!OfflineAudioContext) throw new Error('OfflineAudioContext unavailable');
  const context = new OfflineAudioContext(2, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
  return makeGraph(context, audio.volume, false, space, beatVolume, sampleVolume);
}

async function renderNote(note, duration, environment = false, space = 0) {
  const graph = offlineGraph(duration, space);
  if (note.velocity > 0) {
    playNote(graph, { ...note, start: audio.renderPreroll }, environment && space > 0);
  }
  return graph.context.startRendering();
}

export async function renderProbe({ midi = 60, scene = 'atlas', seconds = 3 } = {}) {
  return renderNote({
    midi: clamp(midi, 0, 127, 60),
    velocity: .6,
    x: .5,
    timbre: getTimbre(scene),
  }, clamp(seconds, .1, audio.maxProbeSeconds, 3));
}

export async function renderStringProbe({ seconds, ...options } = {}) {
  return renderNote(stringNote(options), clamp(seconds, .1, audio.maxProbeSeconds, audio.stringProbeSeconds));
}

export async function renderSceneProbe({
  scene = 'atlas', frequency = 220, u = .36, tension = .5, velocity = .6,
  seconds = room.probeSeconds, space = room.space, environment = true,
} = {}) {
  return renderChordProbe({ scene, frequency, u, tension, velocity, seconds, space, environment });
}

export async function renderChordProbe({
  scene = 'atlas', u = .36, seconds = room.probeSeconds, space = room.space, environment = true, ...options
} = {}) {
  const note = chordNote({ ...options, scene, u });
  return renderNote(note, clamp(seconds, .1, audio.maxProbeSeconds, room.probeSeconds),
    Boolean(environment), clamp(space, 0, 1, room.space));
}

export async function renderRhythmProbe({ preset = 'uk-half-time', bpm, density, swing, volume = beat.volume, steps, seconds } = {}) {
  const patternLength = beat.stepsPerBeat * beat.beatsPerBar * beat.patternBars;
  const count = Math.round(clamp(steps, 1, patternLength, patternLength));
  const plan = [];
  let time = audio.renderPreroll;
  for (let step = 0; step < count; step++) {
    const entry = rhythmStep(preset, step, { bpm, density, swing });
    for (const { voice, velocity } of entry.hits) plan.push({ voice, velocity, time });
    time += entry.length;
  }
  const tail = Math.max(...Object.values(beat.drums).map((drum) => drum.seconds));
  const duration = clamp(seconds, .1, audio.maxProbeSeconds, Math.min(audio.maxProbeSeconds, time + tail));
  const graph = offlineGraph(duration, 0, clamp(volume, 0, 1, beat.volume));
  for (const { voice, time: start, velocity } of plan) {
    if (start < duration) playDrum(graph, voice, start, velocity, false);
  }
  return graph.context.startRendering();
}

export { renderRhythmProbe as renderBeatProbe };

export async function renderSampleProbe({ buffer, seconds, volume = sampleSettings.volume, ...options } = {}) {
  const slice = buffer ? getSlice(buffer, options) : null;
  const fallback = slice ? slice.count / buffer.sampleRate / slice.speed + audio.renderPreroll + .1 : .2;
  const duration = clamp(seconds, .1, audio.maxProbeSeconds, fallback);
  const graph = offlineGraph(duration, 0, beat.volume, clamp(volume, 0, 1, sampleSettings.volume));
  if (slice) playSample(graph, buffer, slice, audio.renderPreroll);
  return graph.context.startRendering();
}
