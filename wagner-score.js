import { createWagnerAnalysis } from './wagner-analysis.js';

const bound = (value, maximum = 1) => Math.min(maximum, Math.max(0, Number(value) || 0));

export function createWagnerScore({ config, session, environment = globalThis, onStatus = () => {} }) {
  const settings = config.wagner;
  const analysis = createWagnerAnalysis(settings);
  const media = environment.document.createElement('audio');
  media.preload = 'metadata';
  const state = { enabled: false, source: 'none', name: '', status: 'off · choose your recording or tab audio',
    playing: false, paused: false, pending: false, gain: settings.defaultGain, position: 0, duration: 0,
    sampleRate: 0, contextState: 'not started', builtin: false, work: 'tristan', rate: 1, color: 1, echo: 0, conduct: false, ...analysis.frame };
  const merged = {};
  const input = { time: 0, waveform: null, spectrum: null, sampleRate: 0, active: false };
  let route = null;
  let routeRequest = null;
  let context = null;
  let analyser = null;
  let waveform = null;
  let spectrum = null;
  let stream = null;
  let streamSource = null;
  let blobUrl = '';
  let generation = 0;
  let playbackGeneration = 0;
  let destroyed = false;
  let buffering = false;
  let resumeAfterHold = false;
  let restoredPosition = 0;
  let effect = null;
  let lastConduct = -Infinity;

  function report(message) { state.status = message; onStatus(message); }
  function zero() { analysis.reset(); Object.assign(state, analysis.frame); }
  function mute() {
    if (!route) return;
    route.gain.gain.cancelScheduledValues?.(route.context.currentTime);
    route.gain.gain.value = 0;
  }
  function releaseStream() {
    const previous = stream;
    stream = null;
    try { streamSource?.disconnect(); } catch (_) {}
    streamSource = null;
    for (const track of previous?.getTracks?.() || []) { track.onended = null; track.stop(); }
  }
  function stop(reason = 'stopped · exact silence', rewind = true) {
    generation += 1;
    media.pause();
    mute();
    releaseStream();
    if (rewind && media.src) { try { media.currentTime = 0; } catch (_) {} }
    resumeAfterHold = false;
    buffering = false;
    state.playing = false; state.paused = false; state.pending = false;
    state.position = Number(media.currentTime) || 0;
    zero(); report(reason);
  }
  function loadFile(file) {
    if (destroyed) throw new Error('score closed');
    if (!file || !Number.isFinite(file.size) || file.size <= 0 || file.size > settings.maxFileBytes) {
      throw new Error('choose a nonempty local recording up to 768 MiB');
    }
    stop('changing local recording');
    if (blobUrl) environment.URL.revokeObjectURL(blobUrl);
    blobUrl = environment.URL.createObjectURL(file);
    media.src = blobUrl;
    media.load?.();
    state.source = 'file'; state.name = file.name || 'local recording'; state.duration = 0; state.builtin = false; state.work = 'local';
    report(`ready · ${state.name} · press PLAY`);
  }
  function loadRecording() {
    report('Choose a local audio file under Source and signal');
  }
  function connectAnalyser(nextContext) {
    if (analyser && nextContext === context) return;
    context = nextContext;
    analyser = context.createAnalyser();
    analyser.fftSize = settings.fftSize;
    analyser.smoothingTimeConstant = 0;
    waveform = new Float32Array(settings.fftSize);
    spectrum = new Float32Array(settings.fftSize / 2);
    state.sampleRate = context.sampleRate;
  }
  async function ensureFileRoute() {
    if (!route) {
      routeRequest ||= session.routeMediaElement(media).then((next) => {
        route = next;
        mute();
        connectAnalyser(route.context);
        const limiter = context.createDynamicsCompressor();
        limiter.threshold.value = settings.compressorThreshold;
        limiter.ratio.value = settings.compressorRatio;
        route.gain.disconnect(route.output);
        if (typeof context.createBiquadFilter === 'function' && typeof context.createDelay === 'function') {
          const filter = context.createBiquadFilter(), delay = context.createDelay(1), feedback = context.createGain(), wet = context.createGain();
          filter.type = 'lowpass'; filter.frequency.value = 18000;
          delay.delayTime.value = .29; feedback.gain.value = .32; wet.gain.value = 0;
          route.source.disconnect(route.gain);
          route.source.connect(filter); filter.connect(route.gain);
          filter.connect(delay); delay.connect(feedback); feedback.connect(delay);
          delay.connect(wet); wet.connect(route.gain);
          effect = { filter, delay, wet };
          applyPerformance();
        }
        route.gain.connect(limiter);
        limiter.connect(route.output);
        route.gain.connect(analyser);
        return route;
      }).finally(() => { routeRequest = null; });
      await routeRequest;
    }
    if (route.context.state === 'suspended') await route.context.resume();
    if (route.context.state !== 'running') throw new Error(`audio context ${route.context.state}`);
  }
  async function play() {
    if (destroyed || !media.src) throw new Error('choose a local recording first');
    stop('starting local recording', false);
    state.source = 'file'; state.pending = true;
    const request = generation;
    try {
      await ensureFileRoute();
      if (destroyed || request !== generation) return;
      playbackGeneration = request;
      await media.play();
      if (destroyed || request !== generation) { if (playbackGeneration === request) { media.pause(); mute(); } return; }
      buffering = false;
      state.enabled = true; state.playing = true; state.paused = false;
      route.gain.gain.value = state.gain;
      report(`playing · ${state.name} · shared local output`);
    } catch (error) {
      if (request === generation) { stop(`file unavailable · ${error.message}`, false); throw error; }
    } finally { if (request === generation) state.pending = false; }
  }
  async function shareAudio() {
    if (!environment.navigator?.mediaDevices?.getDisplayMedia) { report('tab audio unavailable here · use a local file or supported Chrome'); throw new Error(state.status); }
    stop('choose a music tab and include its audio');
    const request = generation;
    state.pending = true;
    let selected = null;
    try {
      selected = await environment.navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, selfBrowserSurface: 'exclude', systemAudio: 'include' });
      if (destroyed || request !== generation) { for (const track of selected.getTracks()) track.stop(); return; }
      if (!selected.getAudioTracks().length) throw new Error('selected surface has no audio track · select a music tab with audio sharing');
      for (const track of selected.getVideoTracks()) track.stop();
      if (!selected.getAudioTracks().some(track => track.readyState === 'live')) throw new Error('this browser ended audio when retiring video · use the local recording');
      const nextContext = await session.getAudioContext();
      if (destroyed || request !== generation) { for (const track of selected.getTracks()) track.stop(); return; }
      connectAnalyser(nextContext);
      stream = selected;
      streamSource = context.createMediaStreamSource(new environment.MediaStream(selected.getAudioTracks()));
      streamSource.connect(analyser);
      for (const track of stream.getAudioTracks()) track.onended = () => stop('tab audio ended · exact silence', false);
      state.source = 'tab'; state.name = 'selected tab audio'; state.enabled = true; state.playing = true;
      state.duration = 0; state.position = 0;
      report('tab audio live · analysis only · no duplicate monitor or capture');
    } catch (error) {
      for (const track of selected?.getTracks?.() || []) track.stop();
      if (request === generation) { stop(`tab audio unavailable · ${error.message}`, false); throw error; }
    } finally { if (request === generation) state.pending = false; }
  }
  function pause() {
    generation += 1;
    media.pause(); mute();
    state.playing = false; state.pending = false; state.paused = true;
    zero(); report('paused · position held · exact silence');
  }
  async function resume() {
    if (state.source === 'none') throw new Error('Choose a local recording under Source and signal');
    if (state.source === 'file') return play();
    if (state.source === 'tab' && stream?.getAudioTracks().some(track => track.readyState === 'live')) {
      state.playing = true; state.paused = false; report('tab analysis resumed');
      return;
    }
    throw new Error('select a recording or choose tab audio again');
  }
  function setHeld(held) {
    if (held) { resumeAfterHold = state.playing; if (state.playing || state.pending) pause(); }
    else if (resumeAfterHold) { resumeAfterHold = false; return resume(); }
  }
  function setEnabled(enabled) { state.enabled = Boolean(enabled); if (!state.enabled) stop('score off · exact silence'); }
  function setGain(value) {
    state.gain = bound(value, settings.maxGain);
    if (route && state.playing && state.source === 'file') route.gain.gain.value = state.gain;
  }
  function applyPerformance(hand) {
    if (!effect || !context) return;
    const now = context.currentTime;
    const position = hand?.palm;
    const rate = Math.min(1.85, Math.max(.55, state.rate * (position ? .62 + .77 * (1 - position.y) : 1)));
    media.playbackRate = rate;
    const color = position ? state.color * (.19 + .81 * position.x) : state.color;
    effect.filter.frequency.setTargetAtTime(180 + 17820 * color ** 3, now, .13);
    effect.wet.gain.setTargetAtTime(Math.min(.8, state.echo + (position ? (1 - hand.openness) * .38 : 0)), now, .16);
    effect.delay.delayTime.setTargetAtTime(position ? .10 + .48 * position.y : .29, now, .16);
    state.liveRate = rate;
  }
  function setPerformance(patch) {
    if (Number.isFinite(patch.rate)) state.rate = Math.min(1.65, Math.max(.65, patch.rate));
    if (Number.isFinite(patch.color)) state.color = bound(patch.color);
    if (Number.isFinite(patch.echo)) state.echo = bound(patch.echo, .75);
    if (typeof patch.conduct === 'boolean') state.conduct = patch.conduct;
    applyPerformance();
  }
  function conduct(time, hands = []) {
    if (!state.conduct || !state.playing || !effect || state.source !== 'file' || time - lastConduct < 110) return;
    lastConduct = time;
    const hand = hands.find(item => item.handedness === 'Right' && time - item.lastSeen < 250)
      || hands.find(item => time - item.lastSeen < 250);
    applyPerformance(hand);
  }
  function seek(value) {
    if (state.source !== 'file' || !Number.isFinite(media.duration)) return;
    media.currentTime = bound(value, media.duration);
    state.position = media.currentTime;
    buffering = state.playing;
    zero();
  }
  function sample(time) {
    state.position = state.source === 'file' ? Number(media.currentTime) || 0 : 0;
    state.duration = state.source === 'file' && Number.isFinite(media.duration) ? media.duration : 0;
    state.contextState = context?.state || 'not started';
    const live = state.enabled && state.playing && !buffering && analyser && context?.state === 'running'
      && (state.source === 'tab' ? stream?.getAudioTracks().some(track => track.readyState === 'live') : !media.paused && !media.ended && !media.seeking && media.readyState >= 2);
    if (live) { analyser.getFloatTimeDomainData(waveform); analyser.getFloatFrequencyData(spectrum); }
    input.time = time; input.waveform = waveform; input.spectrum = spectrum;
    input.sampleRate = state.sampleRate; input.active = Boolean(live);
    Object.assign(state, analysis.update(input));
    return state;
  }
  function mergeAudio(frame) {
    if (!state.enabled) return frame;
    Object.assign(merged, frame);
    merged.rms = Math.max(Number(frame.rms) || 0, bound(state.rms * settings.rmsScale));
    for (const name of ['bass', 'mid', 'high', 'gate']) merged[name] = Math.max(Number(frame[name]) || 0, state[name]);
    merged.beat = Math.max(Number(frame.beat) || 0, state.onset);
    return merged;
  }
  media.addEventListener('loadedmetadata', () => {
    state.duration = Number.isFinite(media.duration) ? media.duration : 0;
    if (state.builtin && restoredPosition > 0) seek(restoredPosition);
    restoredPosition = 0;
  });

  function restoreBuiltinPosition(position, work = 'tristan') {
    if ((!Number.isFinite(position) || position <= 0) && work === 'tristan') return;
    restoredPosition = Number(position) || 0;
    loadRecording(work);
  }
  function playbackReady() {
    buffering = false;
    if (state.playing) report(`playing · ${state.name} · shared local output`);
  }
  media.addEventListener('waiting', () => { if (state.playing || state.pending) { buffering = true; zero(); report('buffering · measurements zero'); } });
  media.addEventListener('playing', playbackReady);
  media.addEventListener('seeked', playbackReady);
  media.addEventListener('ended', () => stop('recording ended · exact silence', false));
  media.addEventListener('error', () => stop('recording cannot be decoded by this browser', false));

  function destroy() {
    if (destroyed) return;
    stop('score closed'); destroyed = true;
    if (blobUrl) environment.URL.revokeObjectURL(blobUrl);
    blobUrl = ''; media.removeAttribute('src'); media.load?.();
    try { analyser?.disconnect(); } catch (_) {}
    waveform = null; spectrum = null;
  }
  return { state, loadFile, loadRecording, restoreBuiltinPosition, play, pause, resume, shareAudio, stop, panic: stop, setHeld, setEnabled, setGain, seek, sample, mergeAudio, destroy, setPerformance, conduct };
}

export function bindWagnerControls(score, root, onPlay = () => {}) {
  const find = name => root.querySelector(`[data-wagner-${name}]`);
  const timeLabel = value => { const seconds = Math.max(0, Math.floor(value || 0)); return `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds / 60 % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`; };
  const action = callback => async () => { try { await callback(); } catch (error) { score.state.status = error.message; find('status').textContent = error.message; } };
  find('toggle').addEventListener('click', () => score.setEnabled(!score.state.enabled));
  find('file').addEventListener('change', action(() => { const file = find('file').files?.[0]; if (file) score.loadFile(file); find('file').value = ''; }));
  find('play').addEventListener('click', action(async () => { if (score.state.playing) score.pause(); else { onPlay(); await score.resume(); } }));
  find('stop').addEventListener('click', () => score.stop());
  find('share').addEventListener('click', action(async () => { onPlay(); await score.shareAudio(); }));
  find('gain').addEventListener('input', () => score.setGain(find('gain').value));
  find('seek').addEventListener('input', () => score.seek(Number(find('seek').value)));
  find('work').addEventListener('change', action(async () => {
    const wasPlaying = score.state.playing || score.state.pending;
    score.loadRecording(find('work').value);
    if (wasPlaying) { onPlay(); await score.play(); }
  }));
  for (const key of ['rate', 'color', 'echo']) find(key).addEventListener('input', () => score.setPerformance({ [key]: Number(find(key).value) }));
  find('conduct').addEventListener('click', () => {
    score.setPerformance({ conduct: !score.state.conduct });
    find('conduct').setAttribute('aria-pressed', String(score.state.conduct));
  });
  return function render() {
    const frame = score.state;
    root.dataset.enabled = String(frame.enabled); root.dataset.playing = String(frame.playing);
    root.dataset.source = frame.source; root.dataset.rms = frame.rms.toFixed(5); root.dataset.gate = frame.gate.toFixed(4);
    root.dataset.swell = frame.swell.toFixed(4); root.dataset.context = frame.contextState;
    find('toggle').setAttribute('aria-pressed', String(frame.enabled));
    find('toggle').dataset.on = String(frame.enabled);
    find('toggle').textContent = `WAGNER ${frame.enabled ? 'ON' : 'OFF'}`;
    find('play').textContent = frame.playing ? 'pause recording' : frame.work === 'tristan' ? 'play Tristan' : 'play recording';
    if (frame.work !== 'local') find('work').value = frame.work;
    find('conduct').setAttribute('aria-pressed', String(frame.conduct));
    find('conduct-state').textContent = `${(frame.liveRate ?? frame.rate).toFixed(2)}× · ${frame.conduct ? 'palm controls speed and tone' : 'manual control'}`;
    find('play').disabled = frame.pending;
    find('share').disabled = frame.pending;
    find('status').textContent = frame.status;
    find('meter').textContent = `RMS ${frame.rms.toFixed(4)} · LOW ${frame.bass.toFixed(2)} / MID ${frame.mid.toFixed(2)} / HIGH ${frame.high.toFixed(2)} · ${Math.round(frame.centroid)} Hz · SWELL ${frame.swell.toFixed(2)} · ONSET ${frame.onsetCount}`;
    find('time').textContent = `${timeLabel(frame.position)} / ${timeLabel(frame.duration)}`;
    find('seek').max = String(frame.duration || 1); find('seek').value = String(frame.position); find('seek').disabled = frame.source !== 'file' || !frame.duration;
  };
}
