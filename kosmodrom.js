import { CONFIG, clamp } from './config.js';

const settings = CONFIG.kosmodrom;
const tracking = CONFIG.lightScore.studies;
const padNotes = [36,37,38,39,40,41,42,43,48,49,50,51,52,53,54,55,60,61,62,63,64,65,66,67];

export function createSectorInput() {
  const edges = new Map();
  const levels = new Float32Array(4);
  const centers = new Float32Array([.5, .5, .5, .5]);
  let source = 'standby';

  function sample({time, dt, hands = [], mic = 0, midi = 0, sampleLevel = 0, site = 0,
    bank = settings.banks[0], pads = false, onPad}) {
    let handLevel = 0;
    for (const hand of hands) {
      if (!hand.id || hand.stale || !(hand.score >= tracking.confidence) ||
          !(time >= hand.lastSeen && time - hand.lastSeen <= tracking.freshMs) ||
          !Number.isFinite(hand.palm?.x) || !Number.isFinite(hand.palm?.y)) continue;
      const pinch = hand.pinchRaw ?? hand.pinch ?? 0;
      const motion = clamp(Math.hypot(hand.velocityX || 0, hand.velocityY || 0) / 1.6);
      const openness = clamp(((hand.openness || 0) - .82) / .18);
      const level = Math.max(clamp((pinch - .36) / .42), motion, openness * .45);
      if (level >= handLevel) {
        handLevel = level;
        centers[2] = clamp(hand.palm.x);
        centers[3] = 1 - clamp(hand.palm.y);
      }
      const edge = edges.get(hand.id) || {held: false, playedAt: -Infinity};
      edge.seen = time;
      if (!edge.held && pinch >= settings.pinchOn) {
        edge.held = true;
        if (pads && time - edge.playedAt >= settings.debounceMs) {
          const slot = bank.start + Math.min(bank.size - 1, Math.floor(clamp(hand.palm.x) * bank.size));
          edge.playedAt = time;
          onPad?.(slot, clamp(.62 + motion * .18));
        }
      } else if (pinch < settings.pinchOff) {
        edge.held = false;
      }
      edges.set(hand.id, edge);
    }
    for (const [id, edge] of edges) {
      if (time - edge.seen > settings.debounceMs) edges.delete(id);
    }
    const micLevel = mic > settings.quiet ? clamp(mic * 3) : 0;
    const signal = Math.max(micLevel, sampleLevel);
    const instant = Math.max(handLevel, midi, signal);
    const decay = Math.exp(-1000 * dt / settings.releaseMs);
    levels[0] = Math.max(instant, levels[0] * decay);
    if (levels[0] < .006) levels[0] = 0;
    levels[1] = midi;
    levels[2] = handLevel;
    levels[3] = signal;
    [centers[0], centers[1]] = settings.sites[site];
    if (instant <= 0) source = levels[0] ? 'decay' : 'standby';
    else if (instant === handLevel) source = 'hand';
    else if (instant === midi) source = 'MIDI';
    else source = sampleLevel >= micLevel ? 'sample' : 'microphone';
  }

  function reset() {
    edges.clear();
    levels.fill(0);
    source = 'standby';
  }
  return {sample, reset, levels, centers, get source() { return source; }};
}

const sampleCaches = new WeakMap();
export function loadSectorBuffer(ctx, file) {
  if (!sampleCaches.has(ctx)) sampleCaches.set(ctx, new Map());
  const buffers = sampleCaches.get(ctx);
  if (!buffers.has(file)) {
    const result = fetch(file).then(response => {
      if (!response.ok) throw Error('HTTP ' + response.status);
      return response.arrayBuffer();
    }).then(bytes => ctx.decodeAudioData(bytes)).catch(error => {
      buffers.delete(file);
      throw error;
    });
    buffers.set(file, result);
  }
  return buffers.get(file);
}

export function createSectorDeck(session, {status = () => {}} = {}) {
  const voices = {stage: new Set(), preview: new Set()};
  const generation = {stage: 0, preview: 0};
  const wave = new Float32Array(256);
  let selected = 0, armed = false, active = false;
  let graph, site = 0, level = settings.level, bank = settings.banks[0];

  function connect(ctx, output) {
    const gain = ctx.createGain(), filter = ctx.createBiquadFilter(), meter = ctx.createAnalyser();
    filter.type = 'lowpass';
    filter.Q.value = .72;
    filter.frequency.value = settings.cutoff + settings.filterRange * .42;
    meter.fftSize = wave.length;
    gain.gain.value = level;
    meter.connect(gain);
    gain.connect(filter);
    filter.connect(output);
    return {gain, meter, ctx};
  }

  async function play(index = selected, velocity = 1, lane = 'stage') {
    const slot = settings.slots[index];
    if (!slot || (lane === 'stage' && !active)) return;
    if (lane === 'preview') stop('preview');
    const epoch = generation[lane];
    try {
      const ctx = await session.getAudioContext();
      if (epoch !== generation[lane]) return;
      const [buffer, output] = await Promise.all([loadSectorBuffer(ctx, slot.file), session.getOutputDestination()]);
      if (epoch !== generation[lane]) return;
      graph ??= connect(ctx, output);

      const src = ctx.createBufferSource(), envelope = ctx.createGain();
      const now = ctx.currentTime;
      const offset = Math.min(slot.offset, Math.max(0, buffer.duration - .1));
      const duration = Math.min(slot.duration, buffer.duration - offset);
      src.buffer = buffer;
      src.playbackRate.value = slot.rate;
      envelope.gain.setValueAtTime(.0001, now);
      envelope.gain.exponentialRampToValueAtTime(Math.max(.0002, clamp(velocity) * .96), now + settings.attack);
      envelope.gain.setTargetAtTime(.0001, now + duration * .72, settings.tail);
      src.connect(envelope);
      // A card audition is audible on the shared mix but cannot move the live scan.
      envelope.connect(lane === 'stage' ? graph.meter : graph.gain);
      src.onended = () => {
        voices[lane].delete(src);
        src.disconnect();
        envelope.disconnect();
      };
      src.start(now, offset, duration);
      voices[lane].add(src);
      if (lane === 'stage') site = slot.corner;
      status(slot.name);
    } catch (error) {
      if (epoch === generation[lane]) status('Sample unavailable · ' + error.message);
    }
  }

  function stop(lane) {
    generation[lane]++;
    for (const src of voices[lane]) src.stop();
    voices[lane].clear();
  }

  function exit() {
    stop('stage');
    armed = false;
    active = false;
  }

  function signal() {
    if (!graph || !voices.stage.size) return 0;
    graph.meter.getFloatTimeDomainData(wave);
    let sum = 0;
    for (const value of wave) sum += value * value;
    return clamp(Math.sqrt(sum / wave.length) * 6 * level);
  }

  function midi(event) {
    if (!active || !armed || event.type !== 'note') return;
    let index = settings.slots.findIndex(slot => slot.note != null && slot.note === event.note);
    if (index < 0 && [4, 10].includes(event.channel + 1)) index = padNotes.indexOf(event.note) % 16;
    if (index >= 0) void play(index, event.velocity);
  }

  function select(index) {
    if (!settings.slots[index]) return;
    selected = index;
    bank = settings.banks.find(item => index >= item.start && index < item.start + item.size);
  }

  async function arm(value) {
    armed = Boolean(value && active);
    if (armed) {
      try { await session.getAudioContext(); }
      catch (error) { armed = false; status(error.message); }
    }
  }

  return {play, stop, exit, signal, midi, select, arm,
    setActive(value) {
      if (active && !value) exit();
      active = value;
    },
    setLevel(value) {
      level = clamp(value);
      if (graph) graph.gain.gain.setTargetAtTime(level, graph.ctx.currentTime, .045);
    },
    get active() { return active; }, get selected() { return selected; },
    get bank() { return bank; }, get armed() { return armed; }, get site() { return site; },
  };
}
