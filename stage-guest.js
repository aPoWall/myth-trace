import { CONFIG } from './config.js';
import { orchestraNote } from './particles-orchestra.js';

// A finite voice on the recorder's mix bus. Oscillators end on the audio clock,
// including when the page is in the background. The musician owns the base key.
export function createGuestPart(session, setKey, report) {
  let slot = null;
  let generation = 0;

  function finish(state) {
    generation++;
    const active = slot;
    if (!active) return;
    slot = null;
    const disconnect = () => {
      active.clock.onended = null;
      active.bus.disconnect();
      active.harmonic.disconnect();
      active.envelope.disconnect();
      for (const node of active.oscillators) node.disconnect();
    };
    if (state === 'finished') {
      disconnect();
    } else {
      const now = active.bus.context.currentTime;
      const end = now + .025;
      active.bus.gain.setValueAtTime(active.bus.gain.value, now);
      active.bus.gain.linearRampToValueAtTime(0, end);
      active.clock.onended = disconnect;
      for (const node of active.oscillators) node.stop(end);
    }
    setKey(null);
    report(state, active.action);
  }

  async function play(action, bpm, current = () => true, nextBeat = () => null) {
    finish('released');
    const ticket = ++generation;
    const ctx = await session.getAudioContext();
    const output = await session.getOutputDestination();
    if (ticket !== generation || !current()) return;
    const profile = CONFIG.performancePresets.music[action.preset];
    const start = ctx.currentTime + (nextBeat() ?? .025);
    const bar = 4 * 60 / bpm;
    const step = bar / action.degrees.length;
    const end = start + bar * action.bars;
    const bus = ctx.createGain();
    const envelope = ctx.createGain();
    const osc = ctx.createOscillator();
    osc.type = action.preset === 'glass' ? 'sine' : 'triangle';
    const overtone = ctx.createOscillator();
    overtone.type = 'sine';
    const harmonic = ctx.createGain();
    harmonic.gain.value = profile.color * .25;
    overtone.connect(harmonic).connect(envelope);
    osc.connect(envelope).connect(bus).connect(output);
    bus.gain.value = action.level ?? CONFIG.stageAgent.guestLevel;
    envelope.gain.value = 0;
    for (let i = 0; i < action.bars * action.degrees.length; i++) {
      const t = start + i * step;
      const degree = action.degrees[i % action.degrees.length];
      const midi = orchestraNote(action.key, 1 - (degree - 1) / 7);
      const hz = 440 * 2 ** ((midi - 69) / 12);
      osc.frequency.setValueAtTime(hz, t);
      overtone.frequency.setValueAtTime(hz * (action.preset === 'glass' ? 3 : 2), t);
      envelope.gain.setValueAtTime(0, t);
      envelope.gain.linearRampToValueAtTime(.42, t + Math.min(profile.attack, step * .25));
      envelope.gain.exponentialRampToValueAtTime(.001, t + step * .91);
      envelope.gain.linearRampToValueAtTime(0, t + step * .98);
    }
    slot = {action, bus, envelope, harmonic, oscillators: [osc, overtone], clock: osc};
    osc.onended = () => { if (ticket === generation) finish('finished'); };
    for (const tone of [osc, overtone]) { tone.start(start); tone.stop(end); }
    setKey(action.key);
    report('playing', action);
  }

  return {play, stop: () => finish('released'), active: () => Boolean(slot)};
}
