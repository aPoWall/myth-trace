import { CONFIG } from './config.js';

const settings = CONFIG.rhythm;
const stepsPerBar = settings.stepsPerBeat * settings.beatsPerBar;
const stepsPerPattern = stepsPerBar * settings.patternBars;
const clamp = (value, lower, upper, fallback) =>
  Number.isFinite(value) ? Math.min(upper, Math.max(lower, value)) : fallback;

export const BEAT_PRESETS = Object.freeze(settings.presets.map(({ id, name, bpm, density, swing }) =>
  Object.freeze({ id, name, bpm, density, swing })));

const patterns = new Map(settings.presets.map(({ id, ...preset }) => {
  const steps = Array.from({ length: stepsPerPattern }, () => []);
  for (const [voice, hits] of Object.entries(preset.pattern)) {
    for (const [step, velocity, density = 0] of hits) steps[step].push({ voice, velocity, density });
  }
  return [id, { ...preset, id, steps }];
}));

function presetFor(id) {
  return patterns.get(id) ?? patterns.get('off');
}

export function rhythmStep(id, index, options = {}) {
  const preset = presetFor(id);
  const { bpm = preset.bpm, density = preset.density, swing = preset.swing } = options;
  const tempo = clamp(bpm, settings.minBpm, settings.maxBpm, preset.bpm);
  const amount = clamp(density, 0, 1, preset.density);
  const feel = clamp(swing, 0, 1, preset.swing) * settings.maxSwing;
  const position = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
  const hits = preset.steps[position % stepsPerPattern].filter((hit) => hit.density <= amount);
  return {
    step: position % stepsPerBar,
    bar: Math.floor(position / stepsPerBar),
    length: 60 / tempo / settings.stepsPerBeat * (1 + (position % 2 ? -feel : feel)),
    hits,
  };
}

export function makeDrumBuffer(context, voice) {
  const kit = settings.drums[voice];
  const rate = context.sampleRate;
  const buffer = context.createBuffer(1, Math.ceil(rate * kit.seconds), rate);
  const pcm = buffer.getChannelData(0);
  const [air, low, high, decay] = kit.air;
  const fast = 1 - Math.exp(-2 * Math.PI * high / rate);
  const slow = 1 - Math.exp(-2 * Math.PI * low / rate);
  const phases = new Float64Array(kit.tones.length);
  let a = 0;
  let b = 0;
  let seed = voice.charCodeAt(0);
  for (let i = 0; i < pcm.length; i++) {
    const t = i / rate;
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    const white = seed / 0x80000000 - 1;
    a += fast * (white - a);
    b += slow * (white - b);

    let noise = 0;
    for (const burst of kit.bursts) {
      const age = t - burst;
      if (age >= 0) noise += Math.min(1, age / kit.attack) * Math.exp(-age / decay);
    }
    let mix = air * (a - b) * noise;
    for (const [index, [base, sweep, glide, damp, gain]] of kit.tones.entries()) {
      phases[index] += 2 * Math.PI * (base + sweep * Math.exp(-t / glide)) / rate;
      mix += Math.sin(phases[index]) * gain * Math.exp(-t / damp) * Math.min(1, t / kit.attack);
    }
    const tail = clamp((pcm.length - 1 - i) / (kit.release * rate), 0, 1, 0);
    pcm[i] = Math.tanh(mix) * tail;
  }
  return buffer;
}

export function createRhythm({ audio, onPulse = () => {} }) {
  let preset = presetFor('off');
  let bpm = preset.bpm;
  let density = preset.density;
  let swing = preset.swing;
  let volume = settings.volume;
  let playing = false;
  let disposed = false;
  let generation = 0;
  let timer = null;
  let nextTime = 0;
  let nextStep = 0;
  let playedStep = -1;
  let playedBar = 0;
  const pulses = new Set();

  function getState() {
    return { preset: preset.id, bpm, density, swing, volume, playing, step: playedStep, bar: playedBar };
  }

  function stop() {
    generation++;
    playing = false;
    if (timer !== null) clearInterval(timer);
    timer = null;
    for (const pulse of pulses) clearTimeout(pulse);
    pulses.clear();
    audio.stopDrums();
    playedStep = -1;
    playedBar = 0;
  }

  function schedule() {
    if (!playing || disposed) return;
    const now = audio.getAudioTime();
    if (!Number.isFinite(now) || globalThis.document?.hidden) { stop(); return; }
    if (nextTime < now - settings.lateGrace) {
      // Skip missed subdivisions after a stalled UI thread.
      nextStep += Math.max(1, Math.floor((now - nextTime) * bpm * settings.stepsPerBeat / 60));
      nextTime = now + settings.startDelay;
    }
    while (nextTime <= now + settings.lookAhead) {
      const entry = rhythmStep(preset.id, nextStep++, { bpm, density, swing });
      const time = Math.max(nextTime, now);
      const sounded = [];
      for (const hit of entry.hits) {
        if (audio.scheduleDrum({ ...hit, time })) sounded.push(hit);
      }
      const pulse = {
        step: entry.step, bar: entry.bar, time,
        kick: sounded.some((hit) => hit.voice === 'kick'),
        accent: sounded.reduce((max, hit) => Math.max(max, hit.velocity), 0),
      };
      const pending = setTimeout(() => {
        pulses.delete(pending);
        if (!playing || disposed || globalThis.document?.hidden) return;
        playedStep = pulse.step;
        playedBar = pulse.bar;
        onPulse(pulse);
      }, Math.max(0, (time - now) * 1000));
      pulses.add(pending);
      nextTime += entry.length;
    }
  }

  async function start() {
    if (disposed || preset.id === 'off' || globalThis.document?.hidden) return false;
    if (playing) return true;
    const token = ++generation;
    const armed = await audio.arm();
    if (!armed || disposed || token !== generation || globalThis.document?.hidden) return false;
    const now = audio.getAudioTime();
    if (!Number.isFinite(now)) return false;
    nextStep = 0;
    nextTime = now + settings.startDelay;
    playing = true;
    schedule();
    if (!playing) return false;
    timer = setInterval(schedule, settings.tickMs);
    return true;
  }

  function setPreset(value) {
    const next = presetFor(value);
    if (preset.id === next.id) return preset.id;
    stop();
    preset = next;
    bpm = preset.bpm;
    density = preset.density;
    swing = preset.swing;
    return preset.id;
  }

  function setBpm(value) {
    bpm = Math.round(clamp(value, settings.minBpm, settings.maxBpm, bpm));
    return bpm;
  }

  function setDensity(value) { density = clamp(value, 0, 1, density); return density; }
  function setSwing(value) { swing = clamp(value, 0, 1, swing); return swing; }
  function setVolume(value) {
    volume = clamp(value, 0, 1, volume);
    audio.setBeatVolume(volume);
    return volume;
  }

  function restore(saved = {}) {
    stop();
    preset = presetFor(saved?.preset);
    bpm = preset.bpm;
    density = preset.density;
    swing = preset.swing;
    setBpm(saved?.bpm);
    setDensity(saved?.density);
    setSwing(saved?.swing);
    setVolume(saved?.volume ?? settings.volume);
    return getState();
  }

  function visibility() { if (globalThis.document?.hidden) stop(); }

  const unsubscribe = audio.onSilence(stop);
  globalThis.document?.addEventListener('visibilitychange', visibility);
  globalThis.window?.addEventListener('pagehide', stop);
  setVolume(volume);

  return {
    start, stop, setPreset, setBpm, setDensity, setSwing, setVolume, getState, restore,
    dispose() {
      if (disposed) return;
      stop();
      disposed = true;
      unsubscribe();
      globalThis.document?.removeEventListener('visibilitychange', visibility);
      globalThis.window?.removeEventListener('pagehide', stop);
    },
  };
}
