import { CONFIG, clamp } from './config.js';
import { createAirScore } from './air-score.js';
import { createBassDeck } from './bass-deck.js';

const score = CONFIG.lightScore.atmosphere;
const focus = CONFIG.focusField.music;
const hz = midi => 440 * 2 ** ((midi - 69) / 12);
const target = (param, value, t, speed) => param.setTargetAtTime(value, t, speed);

export function createAtmosphere(session) {
  const airScore = createAirScore();
  let airSource = 'off';
  const airVoices = new Set();
  function clearAirNotes() {
    for (const oscillator of airVoices) { try { oscillator.stop(); } catch {} }
    airVoices.clear();
  }
  let graph;
  let pending;
  let requested = false;
  let started = 0;
  let nextGrain = 0;
  let nextRadio = 0;
  let radioIndex = 0;
  let tick = 0;
  let speech = 0;
  let track;
  let requestId = 0;
  let focusPlaying = false;
  let profileId = 'air';
  let deckSettings = { bpm: CONFIG.bassDeck.bpm, wobble: CONFIG.bassDeck.wobble, filter: CONFIG.bassDeck.filter };

  async function graphForSession() {
    if (graph) return graph;
    pending ||= (async () => {
      const output = await session.getOutputDestination();
      const ctx = await session.getAudioContext();
      const master = ctx.createGain(), bed = ctx.createGain(), tone = ctx.createBiquadFilter();
      const grains = ctx.createGain(), echo = ctx.createDelay(1.5), feedback = ctx.createGain(), damp = ctx.createBiquadFilter();
      const air = ctx.createBiquadFilter(), airLevel = ctx.createGain(), airDrive = ctx.createWaveShaper();
      master.gain.value = 0;
      bed.gain.value = .55;
      grains.gain.value = .24;
      tone.type = 'lowpass'; tone.frequency.value = 460; tone.Q.value = 1.1;
      damp.type = 'lowpass'; damp.frequency.value = 1550;
      echo.delayTime.value = .57; feedback.gain.value = .51;
      bed.connect(tone); tone.connect(master); grains.connect(master);
      grains.connect(echo); echo.connect(damp); damp.connect(feedback); feedback.connect(echo); damp.connect(master);
      master.connect(output);
      const drones = score.notes.map((_, index) => {
        const oscillator = ctx.createOscillator(), level = ctx.createGain(), pan = ctx.createStereoPanner();
        oscillator.type = index < 2 ? 'sine' : index === 2 ? 'triangle' : 'sine';
        oscillator.frequency.value = hz(score.baseMidi + score.notes[index]);
        oscillator.detune.value = [0, -4, 6, -9, 10][index];
        level.gain.value = 0;
        pan.pan.value = [0, -.13, .35, -.58, .61][index];
        oscillator.connect(level); level.connect(pan); pan.connect(bed); oscillator.start();
        return { oscillator, level };
      });
      const noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * .18), ctx.sampleRate);
      const data = noise.getChannelData(0);
      let n = 44017;
      for (let i = 0; i < data.length; i++) {
        n = (Math.imul(1664525, n) + 1013904223) >>> 0;
        data[i] = (n / 0x80000000 - 1) * Math.sin(i / data.length * Math.PI) ** 2;
      }
      const field = ctx.createBuffer(1, Math.round(ctx.sampleRate * 2.1), ctx.sampleRate);
      const fieldData = field.getChannelData(0);
      let memory = 0;
      for (let i = 0; i < fieldData.length; i++) {
        n = (Math.imul(1664525, n) + 1013904223) >>> 0;
        memory = (memory + (n / 0x80000000 - 1) * .025) / 1.025;
        fieldData[i] = memory * 3.5 * Math.min(1, Math.min(i, fieldData.length - 1 - i) / 250);
      }
      const wind = ctx.createBufferSource();
      wind.buffer = field; wind.loop = true;
      air.type = 'bandpass'; air.frequency.value = 550; air.Q.value = .7;
      airLevel.gain.value = 0;
      airDrive.curve = Float32Array.from({ length: 129 }, (_, i) => Math.tanh((i / 64 - 1) * 3));
      wind.connect(air); air.connect(airDrive); airDrive.connect(airLevel); airLevel.connect(grains); wind.start();
      return (graph = { ctx, master, tone, grains, drones, noise, wind, air, airLevel });
    })().finally(() => { pending = null; });
    return pending;
  }

  function startFocusMusic({ ctx, master, grains, noise }) {
    const output = ctx.createGain();
    output.gain.value = focus.level;
    const echo = ctx.createDelay(1.2), echoLevel = ctx.createGain();
    const stepSeconds = 60 / focus.bpm / 4;
    echo.delayTime.value = stepSeconds * 3;
    echoLevel.gain.value = .22;
    output.connect(master);
    output.connect(echo);
    echo.connect(echoLevel);
    echoLevel.connect(grains);
    const cueTimes = [];
    let cueCount = 0;
    let step = 0;
    let next = ctx.currentTime + focus.entryDelay;

    function tone(t, note, level, duration, pan, type = 'sine') {
      const osc = ctx.createOscillator(), env = ctx.createGain(), stereo = ctx.createStereoPanner();
      osc.type = type;
      osc.frequency.value = hz(note);
      stereo.pan.value = pan;
      env.gain.setValueAtTime(.0001, t);
      env.gain.exponentialRampToValueAtTime(level, t + .036);
      env.gain.exponentialRampToValueAtTime(.0001, t + duration);
      osc.connect(env); env.connect(stereo); stereo.connect(output);
      osc.start(t);
      osc.stop(t + duration + .01);
      osc.onended = () => { osc.disconnect(); env.disconnect(); stereo.disconnect(); };
    }

    function tap(t, downbeat) {
      const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), envelope = ctx.createGain();
      source.buffer = noise;
      filter.type = 'bandpass';
      filter.frequency.value = downbeat ? 370 : 2300;
      filter.Q.value = downbeat ? 2.4 : 1.1;
      envelope.gain.value = downbeat ? .31 : .15;
      source.connect(filter); filter.connect(envelope); envelope.connect(output);
      source.start(t);
      source.stop(t + .075);
      source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
    }

    function schedule() {
      if (ctx.state !== 'running') return;
      if (next < ctx.currentTime) {
        step += Math.ceil((ctx.currentTime - next) / stepSeconds);
        next = ctx.currentTime + .02;
      }
      while (next < ctx.currentTime + focus.lookahead) {
        const beat = step % 16, bar = Math.floor(step / 16);
        const t = next + (beat % 4 === 2 ? .024 : 0);
        const root = score.baseMidi + focus.roots[bar % focus.roots.length];
        if (focus.bass.includes(beat)) {
          tone(t, root + (beat === 14 ? 7 : 0), beat === 0 ? .39 : .22, beat === 0 ? .68 : .33, 0);
          if (beat === 0 || beat === 10) tap(t, true);
          cueTimes.push(t);
        }
        const key = focus.keys.indexOf(beat);
        if (key >= 0) {
          const note = root + focus.voicing[(key + bar) % focus.voicing.length];
          tone(t, note, key === 0 ? .18 : .11, .58, key % 2 ? .32 : -.32, 'triangle');
          if (beat === 8) tone(t, note + 7, .10, .72, .42);
          if (beat === 8 || beat === 15) cueTimes.push(t);
        }
        if (focus.taps.includes(beat)) tap(t, false);
        step++;
        next += stepSeconds;
      }
      while (cueTimes.length && cueTimes[0] <= ctx.currentTime) {
        cueTimes.shift();
        cueCount++;
      }
    }

    schedule();
    const timer = setInterval(schedule, focus.schedulerMs);
    return {
      cue: () => cueCount,
      stop(hard) {
        clearInterval(timer);
        if (hard) {
          output.disconnect();
          echoLevel.disconnect();
        } else {
          target(output.gain, 0, ctx.currentTime, .17);
          target(echoLevel.gain, 0, ctx.currentTime, .17);
          setTimeout(() => { output.disconnect(); echoLevel.disconnect(); }, 950);
        }
      },
    };
  }

  async function start(profile = 'air') {
    if (requested && profileId === profile) return;
    const id = ++requestId;
    requested = true;
    profileId = profile;
    focusPlaying = profile === 'focus';
    await session.getAudioContext();
    const current = await graphForSession();
    if (!requested || id !== requestId) return;
    track?.stop(false);
    clearAirNotes();
    if (profileId === 'bass') {
      for (const voice of current.drones) { voice.level.gain.cancelScheduledValues(current.ctx.currentTime); voice.level.gain.value = 0; }
      current.airLevel.gain.cancelScheduledValues(current.ctx.currentTime); current.airLevel.gain.value = 0;
    }
    track = profileId === 'bass' ? createBassDeck(current.ctx, current.master, deckSettings) : focusPlaying ? startFocusMusic(current) : null;
    started = current.ctx.currentTime;
    nextGrain = started;
    nextRadio = started + score.radioGapSeconds / 2;
    tick = 0;
    speech = 0;
    airScore.reset();
    airSource = profileId === 'bass' ? 'bass deck' : focusPlaying ? 'focus' : 'bed';
  }

  function stop(hard = false) {
    requested = false;
    airSource = 'off';
    focusPlaying = false;
    requestId++;
    clearAirNotes();
    track?.stop(hard);
    track = null;
    if (!graph) return;
    const { ctx, master } = graph;
    master.gain.cancelScheduledValues(ctx.currentTime);
    if (hard) master.gain.setValueAtTime(0, ctx.currentTime);
    else target(master.gain, 0, ctx.currentTime, score.releaseSeconds / 3);
  }

  function playRadio(level, palm) {
    const current = graph;
    if (current.radio || current.radioPending) return;
    const clip = score.radioClips[radioIndex++ % score.radioClips.length];
    current.radioPending = true;
    void fetch(`./assets/nasa-pocket/artemis-ii-${clip}.mp3`).then(response => {
      if (!response.ok) throw new Error('radio clip unavailable');
      return response.arrayBuffer();
    }).then(bytes => current.ctx.decodeAudioData(bytes)).then(buffer => {
      if (!requested || current.radioLevel === 0) return;
      const source = current.ctx.createBufferSource(), receiver = current.ctx.createBiquadFilter(), gain = current.ctx.createGain();
      source.buffer = buffer;
      source.playbackRate.value = .78 + (1 - palm.y) * .19;
      receiver.type = 'bandpass'; receiver.frequency.value = 1200; receiver.Q.value = 1.2;
      gain.gain.value = level * .6;
      source.connect(receiver); receiver.connect(gain); gain.connect(current.grains);
      current.radio = { source, gain };
      source.onended = () => {
        source.disconnect(); receiver.disconnect(); gain.disconnect(); current.radio = null;
      };
      source.start();
    }).catch(() => {}).finally(() => { current.radioPending = false; });
  }

  function update({ tracking, pointer, geometry, settings, voice = 0, root: performanceRoot }) {
    if (!requested || !graph) return;
    const { ctx, master, drones, tone, grains, noise, wind, air, airLevel } = graph;
    const time = ctx.currentTime;
    if (profileId === 'bass') {
      const right = tracking?.hands?.find(hand => !hand.stale && hand.handedness === 'Right');
      const left = tracking?.hands?.find(hand => !hand.stale && hand.handedness === 'Left');
      const blend = CONFIG.bassDeck.handBlend;
      track?.configure({ ...deckSettings, root: performanceRoot ?? CONFIG.bassDeck.root,
        filter: right ? deckSettings.filter * (1-blend) + clamp(1-right.palm.y) * blend : deckSettings.filter,
        wobble: left ? deckSettings.wobble * (1-blend) + clamp(left.openness) * blend : deckSettings.wobble });
      target(master.gain, clamp(settings?.gain ?? score.gain), time, score.attackSeconds / 3);
      return;
    }
    if (time < nextGrain) return;
    nextGrain = time + score.intervalSeconds;
    const t = time - started;
    const hand = tracking?.hands?.find(value => value.handedness === 'Right') || tracking?.hands?.[0];
    const palm = hand?.palm || pointer;
    const motion = clamp(hand ? Math.hypot(hand.velocityX || 0, hand.velocityY || 0) * .62 : tracking?.metrics?.motion);
    const depth = clamp(settings?.drift ?? score.drift);
    const grit = clamp(settings?.grain ?? score.grain);
    const radio = clamp(settings?.radio ?? score.radio);
    const voiceLevel = clamp(voice * 12);
    speech += (voiceLevel - speech) * (voiceLevel > speech ? .61 : .17);
    const duck = 1 - speech * .51;
    const airMix = clamp(settings?.noise ?? score.noise);
    target(wind.playbackRate, .65 + depth * .31 + .24 * Math.sin(t * .11) + motion * .26, time, .65);
    target(air.frequency, 210 + (1 - palm.y) * 1150 + Math.sin(t * .19) * 140 * depth + motion * 420 + speech * 170, time, .58);
    target(air.Q, .55 + depth * 1.7 + grit * 1.2, time, .4);
    target(airLevel.gain, airMix * (.44 + motion * .36 + speech * .24), time, .65);
    graph.radioLevel = radio;
    if (graph.radio) target(graph.radio.gain.gain, radio * .6, time, .15);
    if (radio > 0 && time >= nextRadio && (motion > .13 || time >= nextRadio + score.radioGapSeconds / 2)) {
      nextRadio = time + score.radioGapSeconds;
      playRadio(radio, palm);
    }
    const shift = geometry.transpose || 0;
    const bar = Math.floor(t / score.chordSeconds);
    const focusBar = Math.max(0, Math.floor((t - focus.entryDelay) / (60 / focus.bpm * 4)));
    const root = score.baseMidi + (focusPlaying
      ? focus.roots[focusBar % focus.roots.length]
      : shift + score.roots[bar % score.roots.length]);
    if (!focusPlaying) {
      const phrase = airScore.step({ time, motion, voice: voiceLevel, height: palm.y, root });
      airSource = phrase.source;
      for (const note of phrase.notes) {
        const oscillator = ctx.createOscillator(), envelope = ctx.createGain(), stereo = ctx.createStereoPanner();
        const when = time + note.delay;
        oscillator.type = 'sine';
        oscillator.frequency.value = hz(note.midi);
        stereo.pan.value = clamp((palm.x - .5) * 1.1, -.6, .6);
        envelope.gain.setValueAtTime(0, when);
        envelope.gain.linearRampToValueAtTime(note.level, when + .14);
        envelope.gain.exponentialRampToValueAtTime(.0001, when + CONFIG.airScore.releaseSeconds);
        oscillator.connect(envelope).connect(stereo).connect(grains);
        airVoices.add(oscillator);
        oscillator.start(when);
        oscillator.stop(when + CONFIG.airScore.releaseSeconds + .1);
        oscillator.onended = () => { airVoices.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); stereo.disconnect(); };
      }
    }
    target(master.gain, clamp(settings?.gain ?? score.gain) * .42 * duck, time, duck < 1 ? .23 : score.attackSeconds / 3);
    target(tone.frequency, 205 + 800 * (1 - palm.y) + 610 * depth * (.5 + .5 * Math.sin(t * .15)) + motion * 420, time, .5);
    for (const [index, voice] of drones.entries()) {
      const note = !focusPlaying && geometry.major && index === 3 ? 16 : score.notes[index];
      const level = (.28 + .72 * Math.sin(t * (.14 + index * .027) + index * .98) ** 2) * (index < 2 ? .20 : .12);
      target(voice.oscillator.frequency, hz(root + note), time, index < 2 ? 1.05 : 1.65);
      target(voice.level.gain, level, time, 1.25);
    }
    if (grit > 0 && (++tick % Math.max(2, 8 - Math.round(grit * 3 + motion * 2))) === 0) {
      const source = ctx.createBufferSource(), band = ctx.createBiquadFilter(), envelope = ctx.createGain(), pan = ctx.createStereoPanner();
      source.buffer = noise;
      source.playbackRate.value = .7 + depth * .65;
      band.type = 'bandpass'; band.frequency.value = hz(root + 31 + (tick % 5) * 2) + motion * 650 + 330 * (1 - palm.y);
      band.Q.value = 3 + depth * 6;
      pan.pan.value = clamp((palm.x - .5) * 1.65 + Math.sin(tick) * .25, -1, 1);
      envelope.gain.value = grit * (.16 + motion * .32);
      source.connect(band); band.connect(envelope); envelope.connect(pan); pan.connect(grains);
      source.onended = () => { source.disconnect(); band.disconnect(); envelope.disconnect(); pan.disconnect(); };
      source.start(time + .028);
    }
  }

  return { start, stop, update, profile: () => profileId,
    configureDeck(settings) { deckSettings = { ...deckSettings, ...settings }; if (profileId === 'bass') track?.configure(deckSettings); },
    nextBeatDelay: () => track?.nextBeatDelay?.() ?? null,
    source: () => airSource, cue: () => track?.cue() || 0, active: () => requested, ready: () => Boolean(graph) };
}
