import { CONFIG, clamp } from './config.js';
const hz = note => 440 * 2 ** ((note - 69) / 12);

export function bassStep(step, root = 38, config = CONFIG.bassDeck) {
  const beat = step % 16, bar = Math.floor(step / 16);
  return { beat, root: root + config.roots[bar % config.roots.length],
    kick: config.kicks.includes(beat), snare: beat === 8, hat: beat % 2 === 0 || beat === 15,
    bass: config.bass.includes(beat), accent: beat === 14 ? 7 : 0 };
}

// A local synthesized half-time deck. One clock, bounded lookahead, no samples/network.
export function createBassDeck(ctx, output, initial = {}) {
  const c = CONFIG.bassDeck, master = ctx.createGain(), bassBus = ctx.createGain(), filter = ctx.createBiquadFilter();
  const lfo = ctx.createOscillator(), lfoDepth = ctx.createGain();
  let settings = { bpm: c.bpm, wobble: c.wobble, filter: c.filter, root: c.root, ...initial };
  let next = ctx.currentTime + c.entrySeconds, step = 0, count = 0, stopped = false;
  const voices = new Set();
  master.gain.value = c.level; bassBus.gain.value = 1;
  filter.type = 'lowpass'; filter.Q.value = c.resonance;
  bassBus.connect(filter).connect(master).connect(output);
  lfo.connect(lfoDepth).connect(filter.frequency); lfo.start();
  const noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * c.noiseSeconds), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i=0;i<data.length;i++) data[i] = Math.random() * 2 - 1;
  const shape = Float32Array.from({length:257},(_,i)=>Math.tanh((i/128-1)*c.drive));

  function envelope(source, level, duration, when, destination, extra = []) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(level, when + c.attack);
    gain.gain.exponentialRampToValueAtTime(.0001, when + duration);
    source.connect(gain).connect(destination);
    voices.add(source); source.start(when); source.stop(when + duration + c.tail);
    source.onended = () => { voices.delete(source); source.disconnect(); gain.disconnect(); extra.forEach(node=>node.disconnect()); };
  }
  function noiseHit(when, snare) {
    const source = ctx.createBufferSource(), band = ctx.createBiquadFilter();
    source.buffer = noise; band.type = snare ? 'bandpass' : 'highpass';
    band.frequency.value = snare ? c.snareHz : c.hatHz;
    band.connect(master);
    envelope(source, snare ? c.snareLevel : c.hatLevel, snare ? c.snareSeconds : c.hatSeconds, when, band, [band]);
    if (snare) {
      const body=ctx.createOscillator();body.type='triangle';body.frequency.value=c.snareBodyHz;
      envelope(body,c.snareBodyLevel,c.snareSeconds,when,master);
    }
  }
  function kick(when) {
    const osc=ctx.createOscillator();osc.frequency.setValueAtTime(c.kickHz,when);
    osc.frequency.exponentialRampToValueAtTime(c.kickFloorHz,when+c.kickSeconds);
    envelope(osc,c.kickLevel,c.kickSeconds,when,master);
    bassBus.gain.cancelScheduledValues(when);bassBus.gain.setValueAtTime(c.duck,when);
    bassBus.gain.linearRampToValueAtTime(1,when+c.duckSeconds);
  }
  function bass(when,note,duration) {
    const drive=ctx.createWaveShaper();drive.curve=shape;drive.oversample='2x';drive.connect(bassBus);
    const osc=ctx.createOscillator();osc.type='sawtooth';osc.frequency.value=hz(note);
    envelope(osc,c.bassLevel,duration,when,drive,[drive]);
    const sub=ctx.createOscillator();sub.type='sine';sub.frequency.value=hz(note-12);
    envelope(sub,c.subLevel,duration,when,bassBus);
  }
  function configure(patch) {
    settings = { ...settings, ...patch };
    settings.bpm=clamp(settings.bpm,c.minBpm,c.maxBpm);
    const now=ctx.currentTime, amount=clamp(settings.wobble), cutoff=c.minFilterHz+clamp(settings.filter)*c.filterRangeHz;
    filter.frequency.setTargetAtTime(cutoff,now,c.controlLag);
    lfoDepth.gain.setTargetAtTime(cutoff*amount*c.wobbleDepth,now,c.controlLag);
    lfo.frequency.setTargetAtTime(settings.bpm/60*(c.wobbleMin+amount*c.wobbleRange),now,c.controlLag);
  }
  function schedule() {
    if(stopped || ctx.state!=='running')return;
    if(next<ctx.currentTime) { step+=Math.ceil((ctx.currentTime-next)/(60/settings.bpm/4));next=ctx.currentTime+c.entrySeconds; }
    while(next<ctx.currentTime+c.lookahead) {
      const beat=bassStep(step,settings.root,c), duration=60/settings.bpm/4;
      if(beat.kick)kick(next);
      if(beat.snare)noiseHit(next,true);
      if(beat.hat)noiseHit(next,false);
      if(beat.bass)bass(next,beat.root+beat.accent,duration*c.noteSteps);
      step++;count++;next+=duration;
    }
  }
  configure({});schedule();const timer=setInterval(schedule,c.schedulerMs);
  function nextBeatDelay() {
    const beat = 60 / settings.bpm;
    const quarter = next + ((4 - step % 4) % 4) * beat / 4;
    return ((quarter - ctx.currentTime) % beat + beat) % beat;
  }
  return { configure, nextBeatDelay, cue:()=>count, stop() {
    if(stopped)return;stopped=true;clearInterval(timer);master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(0,ctx.currentTime);master.disconnect();lfo.stop();lfo.disconnect();lfoDepth.disconnect();
    for(const source of voices)try{source.stop();}catch{} voices.clear();
    bassBus.disconnect();filter.disconnect();
  } };
}
