// Gesture score: a shared minor scale for drones, strings and struck glass.
import { CONFIG } from './config.js';
import { createFingerScore } from './finger-score.js';
export const ORCHESTRA_KEYS = Object.freeze({ dm: 38, am: 45, cm: 36, fsm: 42 });
const PENTATONIC = [0, 3, 5, 7, 10, 12, 15, 17];
const CHORDS = [[0, 7, 15], [-4, 3, 12], [-7, 0, 8], [-5, 2, 10]];
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const clamp = (value, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, value));
const hz = note => 440 * 2 ** ((note - 69) / 12);
const label = note => NAMES[note % 12] + (Math.floor(note / 12) - 1);

function degreeAt(height) {
  return 1 + Math.round(clamp(1 - height) * (PENTATONIC.length - 1));
}

export function orchestraNote(key, height) {
  return (ORCHESTRA_KEYS[key] ?? ORCHESTRA_KEYS.dm) + 24 + PENTATONIC[degreeAt(height) - 1];
}

export function createParticlesOrchestra(session) {
  const fingerScore = createFingerScore();
  let graph, running = false, revision = 0, key = 'dm', baseKey = 'dm', guestKey = null, level = .55;
  let color = .82, bed = .48, attack = .036;
  let lastNote = '', lastStrike = -Infinity, rightHeld = true;
  let chordIndex = -1, origin = 0, melodyY = .52;
  let conductor = { room: null, day: null };

  function connectTone(ctx, wave, filter, bus, pan) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const stereo = ctx.createStereoPanner();
    stereo.pan.value = pan;
    osc.setPeriodicWave(wave);
    gain.gain.value = 0;
    osc.connect(gain).connect(stereo).connect(filter);
    filter.connect(bus);
    osc.start();
    osc.onended = () => { osc.disconnect(); gain.disconnect(); stereo.disconnect(); filter.disconnect(); };
    return { osc, gain, stereo, filter };
  }

  async function start() {
    if (running) return;
    running = true;
    const token = ++revision;
    try {
      const ctx = await session.getAudioContext();
      const output = await session.getOutputDestination();
      if (token !== revision) return;
      const master = ctx.createGain();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -20;
      limiter.ratio.value = 4;
      master.gain.value = 0;
      limiter.connect(master).connect(output);
      const wave = ctx.createPeriodicWave(new Float32Array(7), Float32Array.of(0, 1, .32, .4, .15, .12, .06));
      const celloWave = ctx.createPeriodicWave(new Float32Array(6), Float32Array.of(0, 1, .54, .3, .13, .09));
      const bows = [-.6, .04, .61, 0].map((pan, index) => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 450;
        const voice = connectTone(ctx, index === 3 ? celloWave : wave, filter, limiter, pan);
        voice.osc.detune.value = [-5, 3, 6, 0][index];
        return voice;
      });
      const fingers = fingerScore.state().voices.map((_, index) => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass'; filter.frequency.value = 1500;
        return connectTone(ctx, index < 5 ? celloWave : wave, filter, limiter, (index < 5 ? -1 : 1) * CONFIG.orchestraFingers.pan);
      });
      const dust = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const samples = dust.getChannelData(0);
      let value = 0;
      for (let i = 0; i < samples.length; i++) samples[i] = value = .87 * value + .13 * (Math.random() * 2 - 1);
      const air = ctx.createBufferSource();
      const airFilter = ctx.createBiquadFilter();
      const airGain = ctx.createGain();
      air.buffer = dust;
      air.loop = true;
      airFilter.type = 'bandpass';
      airFilter.frequency.value = 720;
      airGain.gain.value = 0;
      air.connect(airFilter).connect(airGain).connect(limiter);
      air.start();
      graph = { ctx, limiter, master, bows, fingers, air, airFilter, airGain, strikes: new Map() };
      fingerScore.reset();
      origin = ctx.currentTime;
      chordIndex = -1;
      lastStrike = -Infinity;
      lastNote = '';
      rightHeld = true;
      master.gain.setTargetAtTime(level, origin, .14);
      update([]);
    } catch (error) {
      if (token === revision) stop();
      throw error;
    }
  }

  function stop() {
    revision++;
    running = false;
    fingerScore.reset();
    if (!graph) return;
    const active = graph;
    graph = null;
    const end = active.ctx.currentTime + .15;
    active.master.gain.cancelScheduledValues(active.ctx.currentTime);
    active.master.gain.setTargetAtTime(0, active.ctx.currentTime, .022);
    for (const bow of active.bows) bow.osc.stop(end);
    for (const voice of active.fingers) voice.osc.stop(end);
    active.air.stop(end);
    for (const voice of active.strikes.keys()) stopStrike(voice, end);
    setTimeout(() => active.master.disconnect(), 220);
  }

  function stopStrike(voice, end) {
    for (const osc of voice) { try { osc.stop(end); } catch { /* finished voice */ } }
  }

  function strike(height = melodyY, force = .6, pan = .2, offset = 0) {
    if (!graph) return;
    const { ctx, limiter, strikes } = graph;
    const time = ctx.currentTime + offset;
    if (!offset && time - lastStrike < .23) return;
    const note = orchestraNote(key, height);
    if (!offset) { lastNote = label(note); lastStrike = time; }
    const stereo = ctx.createStereoPanner();
    stereo.pan.value = clamp(pan, -.8, .8);
    stereo.connect(limiter);
    const voice = [];
    for (const [ratio, weight, release] of [[1, .095, 1.65], [2, .033, 1.22], [3, .012, .65], [4.02, .006, .43]]) {
      const osc = ctx.createOscillator();
      const envelope = ctx.createGain();
      const timbre = ratio === 1 ? 1 : .23 + color * .77;
      const gain = weight * timbre * (.48 + .52 * clamp(force));
      osc.frequency.value = hz(note) * ratio;
      osc.connect(envelope).connect(stereo);
      envelope.gain.setValueAtTime(.0001, time);
      envelope.gain.exponentialRampToValueAtTime(gain, time + attack);
      envelope.gain.exponentialRampToValueAtTime(.0001, time + release);
      osc.start(time);
      osc.stop(time + release + .02);
      voice.push(osc);
    }
    strikes.set(voice, time);
    voice[0].onended = () => { strikes.delete(voice); stereo.disconnect(); };
  }

  function playDegrees(degrees, step = .43, force = .55) {
    if (!graph || !degrees.length) return;
    degrees.forEach((degree, index) => {
      if (!Number.isInteger(degree) || degree < 1 || degree > PENTATONIC.length) return;
      const height = 1 - (degree - 1) / (PENTATONIC.length - 1);
      if (index === 0) lastNote = label(orchestraNote(key, height));
      strike(height, force, (index % 3 - 1) * .23, .045 + index * step);
    });
  }

  function update(hands, onPinch) {
    const right = hands.find(hand => !hand.stale && hand.handedness === 'Right')
      || hands.find(hand => !hand.stale && hand.handedness !== 'Left');
    if (!right) rightHeld = true;
    else {
      melodyY += (right.palm.y - melodyY) * .26;
      const pinch = right.pinchRaw ?? right.pinch;
      if (pinch < .64) rightHeld = false;
      if (!rightHeld && pinch > .78) {
        rightHeld = true;
        strike(melodyY, .85, (right.palm.x - .5) * 1.4);
        onPinch?.(degreeAt(melodyY));
      }
    }
    if (!graph) return;
    const { ctx, bows, airFilter, airGain } = graph;
    const time = ctx.currentTime;
    const phrase = Math.floor((time - origin) / (CONFIG.roomConductor.phraseSeconds * (1 - (conductor.day?.density || 0) * CONFIG.roomConductor.dayPace))) % CHORDS.length;
    const left = hands.find(hand => !hand.stale && hand.handedness === 'Left');
    const root = ORCHESTRA_KEYS[key];
    if (phrase !== chordIndex) {
      chordIndex = phrase;
      [...CHORDS[phrase].map(step => root + 12 + step), root].forEach((note, index) => {
        const param = bows[index].osc.frequency;
        if (time - origin < .1) param.setValueAtTime(hz(note), time);
        else param.setTargetAtTime(hz(note), time, .039);
      });
    }
    const lift = left ? clamp(1 - left.palm.y) : .12;
    const roomLift = clamp((conductor.room?.rawRms || 0) * CONFIG.roomConductor.rmsGain) * CONFIG.roomConductor.swell;
    const swell = Math.max(roomLift, left ? clamp((left.openness - .32) / .36) * (.5 + lift * .5) : 0);
    const gentle = .91 + .09 * Math.sin((time - origin) * .88);
    for (let i = 0; i < bows.length; i++) {
      const strength = i === 3 ? .046 + lift * .029 : .012 + swell * .067;
      bows[i].gain.gain.setTargetAtTime(strength * gentle * (.61 + bed * .81), time, .32);
      bows[i].filter.frequency.setTargetAtTime(260 + color * 230 + swell * (i === 3 ? 380 : 1370) + lift * 260, time, .32);
    }
    airFilter.frequency.setTargetAtTime(550 + lift * 1250, time, .3);
    airGain.gain.setTargetAtTime(.007 + swell * .044, time, .4);

  }

  function updateFingers(hands, timestamp) {
    if (!graph) return;
    const frame = fingerScore.update(hands, timestamp, ORCHESTRA_KEYS[key]);
    const now = graph.ctx.currentTime;
    frame.voices.forEach((note, index) => {
      const voice = graph.fingers[index];
      voice.osc.frequency.setTargetAtTime(hz(note.midi), now, CONFIG.orchestraFingers.glide);
      voice.filter.frequency.setTargetAtTime(CONFIG.orchestraFingers.filterBase + color * CONFIG.orchestraFingers.filterRange, now, CONFIG.orchestraFingers.filterLag);
      voice.gain.gain.setTargetAtTime(note.level * CONFIG.orchestraFingers.level,
        now, note.gate ? attack : CONFIG.orchestraFingers.release);
    });
  }

  function updateKey() {
    const next = guestKey || baseKey;
    if (next === key) return;
    key = next;
    lastNote = '';
    chordIndex = -1;
    if (graph) for (const voice of graph.strikes.keys()) stopStrike(voice, graph.ctx.currentTime + .035);
  }

  return {
    start, stop, update, updateFingers, strike, playDegrees,
    setGuestKey(value) { guestKey = value; updateKey(); },
    setConductor(value) { conductor = value; },
    cancelPending() {
      if (!graph) return;
      const now = graph.ctx.currentTime;
      for (const [voice, startsAt] of graph.strikes) {
        if (startsAt > now) stopStrike(voice, now);
      }
    },
    configure(settings) {
      if (Object.hasOwn(ORCHESTRA_KEYS, settings.key)) { baseKey = settings.key; updateKey(); }
      if (Number.isFinite(settings.color)) color = clamp(settings.color);
      if (Number.isFinite(settings.bed)) bed = clamp(settings.bed);
      if (Number.isFinite(settings.attack)) attack = clamp(settings.attack, .018, .25);
      if (Number.isFinite(settings.level)) level = clamp(settings.level);
      if (graph) graph.master.gain.setTargetAtTime(level, graph.ctx.currentTime, .16);
    },
    state: () => ({ running, ready: Boolean(graph), lastNote, key, level, fingers: fingerScore.state().voices }),
    cue: () => graph ? Math.max(0, Math.floor((graph.ctx.currentTime - origin) / 1.75)) : 0,
  };
}
