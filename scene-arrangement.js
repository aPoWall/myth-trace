import { CONFIG, clamp } from './config.js';
import { ORCHESTRA_KEYS, orchestraNote } from './particles-orchestra.js';
import { loadSectorBuffer } from './kosmodrom.js';

const hz = note => 440 * 2 ** ((note - 69) / 12);

export function arrangementTempo(score, pace) {
  return clamp(score.bpm * score.profile.pace / pace, 42, 170);
}

// Both the stage and card audition read this score. Degrees follow the player's edited phrase.
export function scoreStep(score, step, key, degrees) {
  const bar = Math.floor(step / 16) % score.roots.length;
  const tick = step % 16;
  const section = score.sections[Math.floor(bar / 2)];
  const root = ORCHESTRA_KEYS[key] ?? ORCHESTRA_KEYS.dm;
  const phraseNote = index => orchestraNote(key, 1 - (degrees[index % degrees.length] - 1) / 7);
  const index = section.lead.indexOf(tick);
  const reply = section.answer.indexOf(tick);
  return {
    bar, tick, section: section.name,
    bass: section.bass.includes(tick) ? root + score.roots[bar] + (tick === 14 ? 7 : 0) : null,
    chord: tick === 0 ? score.chords[bar].map(interval => root + 12 + interval) : null,
    lead: index < 0 ? null : phraseNote(bar * 2 + index),
    answer: reply < 0 ? null : phraseNote(degrees.length - 1 - ((bar + reply) % degrees.length)) + 12,
    pulse: section.pulse.includes(tick),
    transmission: score.transmissions?.find(([b,t]) => b === bar && t === tick)?.[2],
  };
}

export function createSceneArrangement(session, report = () => {}) {
  let run = null;
  let generation = 0;
  let requested = '';
  let lift = 0;

  function stop() {
    generation++;
    const wasPlaying = Boolean(requested);
    requested = '';
    lift = 0;
    const old = run;
    run = null;
    if (old) {
      clearInterval(old.timer);
      const now = old.ctx.currentTime;
      old.master.gain.cancelScheduledValues(now);
      old.master.gain.setTargetAtTime(0, now, .006);
      for (const source of old.voices) source.stop(now + .03);
      setTimeout(() => old.nodes.forEach(node => node.disconnect()), 40);
    }
    if (wasPlaying) report(null);
  }

  async function start(id, read, {bars = Infinity, onError = () => {}} = {}) {
    stop();
    const score = CONFIG.sceneArrangements[id];
    if (!score) return;
    requested = id;
    const revision = generation;
    try {
      const ctx = await session.getAudioContext();
      if (revision !== generation) return;
      const output = await session.getOutputDestination();
      if (revision !== generation) return;
      const master = ctx.createGain(), tone = ctx.createBiquadFilter();
      const radio = ctx.createAnalyser();
      const delay = ctx.createDelay(1), echo = ctx.createGain();
      const wave = new Float32Array(256);
      radio.fftSize = wave.length;
      master.gain.value = 0;
      tone.type = 'lowpass';
      tone.Q.value = .65;
      tone.connect(master);
      delay.connect(echo).connect(tone);
      radio.connect(master);
      master.connect(output);
      const night = id === 'kosmodrom';
      echo.gain.value = night ? .23 : .16;
      const buffers = new Map(), voices = new Set();
      const active = {ctx, master, radio, wave, voices, site:0, state:null,
        nodes:[master, tone, radio, delay, echo]};
      run = active;

      for (const [, , slot] of score.transmissions || []) {
        const sample = CONFIG.kosmodrom.slots[slot];
        loadSectorBuffer(ctx, sample.file).then(buffer => buffers.set(slot,buffer))
          .catch(() => { if (run === active) onError('Radio file unavailable · ' + sample.name); });
      }

      function voice(source, bus, when, duration, level, attack, pan, delayed = false) {
        const envelope = ctx.createGain(), stereo = ctx.createStereoPanner();
        stereo.pan.value = clamp(pan, -1, 1);
        envelope.gain.setValueAtTime(.00001, when);
        envelope.gain.exponentialRampToValueAtTime(Math.max(.00002,level), when + Math.min(duration * .35,attack));
        envelope.gain.exponentialRampToValueAtTime(.00001, when + duration);
        source.connect(envelope).connect(stereo).connect(bus);
        if (delayed) stereo.connect(delay);
        voices.add(source);
        source.onended = () => { voices.delete(source); source.disconnect(); envelope.disconnect(); stereo.disconnect(); };
        return source;
      }

      function note(type, midi, when, duration, level, attack, pan = 0, delayed = false, bend = 0) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(hz(midi), when);
        if (bend) osc.frequency.exponentialRampToValueAtTime(hz(midi + bend), when + duration * .7);
        voice(osc, tone, when, duration, level, attack, pan, delayed);
        osc.start(when);
        osc.stop(when + duration + .01);
      }

      // Late decodes may join their own cue, but cannot replay an expired cue or survive Stop.
      function transmission(slot, when) {
        const sample = CONFIG.kosmodrom.slots[slot];
        function fire(buffer) {
          if (run !== active) return;
          const start = Math.max(when, ctx.currentTime);
          const elapsed = (start - when) * sample.rate;
          const duration = Math.min(sample.duration, buffer.duration - sample.offset) - elapsed;
          if (duration <= .08) return;
          const src = ctx.createBufferSource(), gain = ctx.createGain();
          src.buffer = buffer;
          src.playbackRate.value = sample.rate;
          const end = start + duration / sample.rate;
          gain.gain.setValueAtTime(.00001,start);
          gain.gain.linearRampToValueAtTime(.62,start + .015);
          gain.gain.setTargetAtTime(.00001, Math.max(start + .016,end - .14),.045);
          src.connect(gain).connect(radio);
          voices.add(src);
          active.site = sample.corner;
          src.onended = () => { voices.delete(src); src.disconnect(); gain.disconnect(); };
          src.start(start, sample.offset + elapsed, duration);
        }
        if (buffers.has(slot)) fire(buffers.get(slot));
        else loadSectorBuffer(ctx,sample.file).then(fire).catch(() => {});
      }

      let next = ctx.currentTime + .045, step = 0, lastDisplay = '';
      function schedule() {
        if (run !== active || ctx.state !== 'running') return;
        const p = read();
        const bpm = arrangementTempo(score, p.pace);
        const unit = 60 / bpm / 4;
        const now = ctx.currentTime;
        const level = clamp(p.level);
        master.gain.setTargetAtTime(level, now, .025);
        tone.frequency.setTargetAtTime(440 + 3900 * clamp(p.color + lift * .30), now, .045);
        delay.delayTime.setTargetAtTime(unit * (night ? 3 : 2), now, .05);
        const limit = bars * 16;
        if (step >= limit) {
          if (now >= next) stop();
          return;
        }
        if (next < now) {
          const missed = Math.min(limit - step, Math.ceil((now - next) / unit));
          step += missed;
          next += missed * unit;
        }
        while (next < now + .115 && step < limit) {
          const event = scoreStep(score, step, p.key, p.degrees);
          const at = next;
          if (event.chord) event.chord.forEach((midi, i) =>
            note(i === 1 ? 'sine' : 'triangle', midi, at, unit * (night ? 15.5 : 10),
              (.055 + .090 * p.bed) / (1 + i * .30), night ? .25 : p.attack * 2, [-.52,.07,.53][i]));
          if (event.bass !== null) {
            note('sine', event.bass, at, unit * (night ? 5.4 : 2.8), .39, .012);
            note('triangle', event.bass + 12, at, unit * 1.8, .10, .018);
          }
          if (event.lead !== null) note(p.timbre === 'glass' ? 'sine' : 'triangle', event.lead, at,
            unit * (night ? 2.7 : 1.9), .21, p.attack, step % 2 ? .25 : -.22, true);
          if (event.answer !== null) note('sine', event.answer, at, unit * (night ? 3.7 : 1.6),
            .095 + .045 * lift, .012, event.bar % 2 ? -.58 : .6, true, night ? -.22 : 0);
          if (event.pulse) {
            const down = event.tick === 0 || event.tick === 8;
            note(down ? 'sine' : 'triangle', down ? 50 : night ? 85 : 79, at,
              down ? .17 : .042, down ? .30 : .12, .003, down ? 0 : -.3, false, down ? -20 : -7);
          }
          if (event.transmission != null) transmission(event.transmission, at);
          const display = event.bar + '/' + Math.round(bpm);
          if (display !== lastDisplay) {
            lastDisplay = display;
            active.state = {id, title:score.title, section:event.section, bar:event.bar + 1, bpm:Math.round(bpm)};
            report(active.state);
          }
          step++;
          next += unit;
        }
        if (step >= limit && now >= next) stop();
      }
      active.timer = setInterval(schedule, 40);
      schedule();
    } catch (error) {
      if (revision === generation) { stop(); onError(error.message); }
    }
  }

  function radioSignal() {
    if (!run || requested !== 'kosmodrom') return 0;
    run.radio.getFloatTimeDomainData(run.wave);
    let sum = 0;
    for (const value of run.wave) sum += value * value;
    return clamp(Math.sqrt(sum / run.wave.length) * 6 * run.master.gain.value);
  }
  return {start, stop, radioSignal, setLift(value) {lift = clamp(value);},
    get id() {return requested;}, get site() {return run?.site || 0;}, get state() {return run?.state;}};
}
