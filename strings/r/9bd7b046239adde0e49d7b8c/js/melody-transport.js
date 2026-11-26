import { CONFIG } from './config.js';

const timing = Object.freeze({ minTempo: 40, maxTempo: 240, defaultTempo: 100, buildMs: 450 });
const maxNotes = 128;
const maxBeats = 128;
const minDuration = 1 / 8;
const msPerMinute = 60000;
const { minMidi, maxMidi } = CONFIG.instrument;
const boundedTempo = (value, fallback) => Number.isFinite(value)
  ? Math.round(Math.min(timing.maxTempo, Math.max(timing.minTempo, value))) : fallback;
const noop = () => {};

function readTune(score) {
  if (!Array.isArray(score?.sequence) || !score.sequence.length || score.sequence.length > maxNotes
      || !Number.isFinite(score.totalBeats) || score.totalBeats <= 0 || score.totalBeats > maxBeats) return null;
  let previousEnd = 0;
  const sequence = [];
  const wires = new Map();
  for (const note of score.sequence) {
    if (!note || !Number.isInteger(note.midi) || note.midi < minMidi || note.midi > maxMidi
        || !Number.isFinite(note.beat) || note.beat < previousEnd
        || !Number.isFinite(note.duration) || note.duration < minDuration
        || note.beat + note.duration > score.totalBeats) return null;
    const { beat, duration, midi } = note;
    const edgeKey = typeof note.edgeKey === 'string' && note.edgeKey.length <= 128 ? note.edgeKey : null;
    const x = Number.isFinite(note.x) ? Math.max(0, Math.min(1, note.x)) : .5;
    sequence.push({ beat, duration, midi, edgeKey, x });
    if (!wires.has(midi)) wires.set(midi, { midi, edgeKey, x });
    previousEnd = beat + duration;
  }
  return {
    sequence, totalBeats: score.totalBeats, bpm: boundedTempo(score.bpm, timing.defaultTempo),
    wires: [...wires.values()].sort((a, b) => a.midi - b.midi),
  };
}

export function createMelodyTransport({
  onBuild = noop, onNote = noop, onStep = noop, onState = noop,
  now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  let tune = null;
  let tempo = timing.defaultTempo;
  let loop = false;
  let status = 'stopped';
  let demo = false;
  let pausedPhase = null;
  let index = -1;
  let cycle = 0;
  let nextNote = 0;
  let nextWire = 0;
  let nextAt = 0;
  let remaining = 0;
  let timer = null;
  let generation = 0;

  const beatMs = () => msPerMinute / tempo;
  const getState = () => ({ status, demo, tempo, loop, index, cycle });

  function invalidate() {
    generation++;
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function reset() {
    invalidate();
    status = 'stopped';
    demo = false;
    pausedPhase = null;
    index = -1;
    cycle = 0;
    nextNote = 0;
    nextWire = 0;
  }

  function stop() {
    reset();
    onState(getState());
  }

  function load(score) {
    reset();
    tune = readTune(score);
    tempo = tune?.bpm ?? timing.defaultTempo;
    onState(getState());
    return tune !== null;
  }

  function queue() {
    const ticket = generation;
    const job = setTimer(() => {
      if (ticket !== generation || timer !== job) return;
      timer = null;
      tick(ticket);
    }, Math.max(0, Math.ceil(nextAt - now())));
    timer = job;
  }

  function emit(phase, event, handler, ticket) {
    handler(event, getState());
    if (ticket === generation) onStep({ phase, ...event }, getState());
    if (ticket === generation) queue();
  }

  function tick(ticket) {
    if (ticket !== generation) return;
    const time = now();
    if (time < nextAt) { queue(); return; }
    if (status === 'building') {
      if (nextWire < tune.wires.length) {
        const wire = tune.wires[nextWire];
        const event = { ...wire, index: nextWire++, total: tune.wires.length, durationMs: timing.buildMs };
        nextAt = time + timing.buildMs;
        emit('build', event, onBuild, ticket);
        return;
      }
      status = 'playing';
      nextAt = time + tune.sequence[0].beat * beatMs();
      onState(getState());
      if (ticket === generation) tick(ticket);
      return;
    }
    if (status !== 'playing') return;
    if (nextNote === tune.sequence.length) {
      if (!loop) { stop(); return; }
      cycle++;
      nextNote = 0;
      if (tune.sequence[0].beat > 0) {
        nextAt = time + tune.sequence[0].beat * beatMs();
        queue();
        return;
      }
    }
    index = nextNote++;
    const note = tune.sequence[index];
    const nextBeat = tune.sequence[nextNote]?.beat ?? tune.totalBeats;
    const interval = (nextBeat - note.beat) * beatMs();
    const expected = nextAt + interval;
    nextAt = expected > time ? expected : time + interval;
    emit('note', { ...note, index, cycle, durationMs: note.duration * beatMs() }, onNote, ticket);
  }

  function play(options) {
    if (!tune || status !== 'stopped') return false;
    const ticket = ++generation;
    demo = options?.demo === true;
    status = demo ? 'building' : 'playing';
    nextAt = now() + (demo ? 0 : tune.sequence[0].beat * beatMs());
    onState(getState());
    tick(ticket);
    return true;
  }

  function pause() {
    if (status !== 'building' && status !== 'playing') return false;
    remaining = Math.max(0, nextAt - now());
    pausedPhase = status;
    status = 'paused';
    invalidate();
    onState(getState());
    return true;
  }

  function resume() {
    if (status !== 'paused') return false;
    const ticket = ++generation;
    status = pausedPhase;
    pausedPhase = null;
    nextAt = now() + remaining;
    onState(getState());
    tick(ticket);
    return true;
  }

  function setTempo(value) {
    const adjusted = boundedTempo(value, tempo);
    const previous = tempo;
    tempo = adjusted;
    if (adjusted === previous) return tempo;
    if (status === 'playing') {
      const time = now();
      nextAt = time + Math.max(0, nextAt - time) * previous / tempo;
      invalidate();
      queue();
    } else if (status === 'paused' && pausedPhase === 'playing') {
      remaining *= previous / tempo;
    }
    onState(getState());
    return tempo;
  }

  function setLoop(value) {
    loop = value === true;
    onState(getState());
    return loop;
  }

  function restore(saved) {
    reset();
    tempo = boundedTempo(saved?.tempo, tune?.bpm ?? timing.defaultTempo);
    loop = saved?.loop === true;
    const state = getState();
    onState(state);
    return state;
  }

  return { load, play, pause, resume, stop, setTempo, setLoop, getState, restore, serialize: () => ({ tempo, loop }) };
}
