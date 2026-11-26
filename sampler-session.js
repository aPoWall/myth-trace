import { CONFIG } from './config.js';

/**
 * Owns the recorder/sampler browser resources without requesting either at boot.
 * Recording tracks are released after each take; the AudioContext lasts until unload.
 */
export function createSamplerSession({ environment = globalThis, config = CONFIG } = {}) {
  let audioContext = null;
  let micStream = null;
  let micPromise = null;
  let micGeneration = 0;
  let outputDestination = null;
  let outputContext = null;
  let mixLimiter = null;
  let stageAnalyser = null;
  const stageSpectrum = new Uint8Array(512);
  const stageWave = new Float32Array(1024);
  const stageSignal = { rms: 0, bass: 0 };
  let performanceDestination = null;
  let performanceStream = null;
  const mediaElementRoutes = new Map();
  let destroyed = false;

  async function getAudioContext() {
    if (destroyed) throw new Error('sampler session destroyed');
    if (audioContext?.state === 'closed') audioContext = null;
    if (!audioContext) {
      const AudioContextClass = environment.AudioContext || environment.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio is unsupported');
      audioContext = new AudioContextClass();
    }
    if (audioContext.state === 'suspended') await audioContext.resume?.();
    if (audioContext.state && audioContext.state !== 'running') {
      throw new Error(`AudioContext is ${audioContext.state}`);
    }
    return audioContext;
  }

  async function getMicStream() {
    if (destroyed) throw new Error('sampler session destroyed');
    const activeTrack = micStream?.getAudioTracks?.().find((track) => track.readyState !== 'ended');
    if (activeTrack) return micStream;
    if (micPromise) return micPromise;
    const mediaDevices = environment.navigator?.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      throw new Error('microphone recording requires a supported localhost/HTTPS browser');
    }
    const generation = micGeneration;
    micPromise = mediaDevices.getUserMedia({ audio: true, video: false }).then((stream) => {
      if (destroyed || generation !== micGeneration) {
        for (const track of stream.getTracks?.() || []) track.stop?.();
        throw new Error(destroyed ? 'sampler session destroyed' : 'microphone request cancelled');
      }
      micStream = stream;
      return stream;
    }).finally(() => { micPromise = null; });
    return micPromise;
  }

  /**
   * The one mixing point for every engine master. It is intentionally lazy:
   * opening the stage still creates neither an AudioContext nor an audio route.
   */
  async function getOutputDestination() {
    const context = await getAudioContext();
    if (destroyed) throw new Error('sampler session destroyed');
    if (outputDestination && outputContext === context) return outputDestination;

    releasePerformanceCaptureStream();
    try { outputDestination?.disconnect?.(); } catch (_) { /* best effort teardown */ }
    try { mixLimiter?.disconnect?.(); } catch (_) { /* best effort teardown */ }

    if (!context.createGain || !context.destination) {
      throw new Error('Web Audio output routing is unsupported');
    }
    outputDestination = context.createGain();
    outputDestination.gain.value = 1;
    mixLimiter = context.createDynamicsCompressor();
    for (const [name, value] of Object.entries(config.performanceMix)) mixLimiter[name].value = value;
    outputDestination.connect(mixLimiter);
    mixLimiter.connect(context.destination);
    stageAnalyser?.disconnect?.();
    stageAnalyser = context.createAnalyser?.() || null;
    if (stageAnalyser) {
      stageAnalyser.fftSize = stageWave.length;
      mixLimiter.connect(stageAnalyser);
    }
    outputContext = context;
    return outputDestination;
  }

  function sampleStageOutput() {
    if (!stageAnalyser || outputContext?.state !== 'running') {
      stageSignal.rms = stageSignal.bass = 0;
      return stageSignal;
    }
    stageAnalyser.getFloatTimeDomainData(stageWave);
    stageAnalyser.getByteFrequencyData(stageSpectrum);
    let squares = 0;
    for (const value of stageWave) squares += value * value;
    stageSignal.rms = Math.sqrt(squares / stageWave.length);
    const lowEnd = Math.max(2, Math.floor(240 * stageWave.length / outputContext.sampleRate));
    let low = 0;
    for (let i = 1; i < lowEnd; i++) low += stageSpectrum[i];
    stageSignal.bass = stageSignal.rms > .002 ? low / ((lowEnd - 1) * 255) : 0;
    return stageSignal;
  }

  /**
   * Returns a MediaStream mixed from the shared output bus. This is an explicit
   * performance-capture action; it never calls getUserMedia or changes mic state.
   */
  async function getPerformanceCaptureStream() {
    await getOutputDestination();
    if (destroyed) throw new Error('sampler session destroyed');
    if (performanceStream) return performanceStream;

    const context = outputContext;
    if (!context?.createMediaStreamDestination) {
      throw new Error('Web Audio performance capture is unsupported');
    }
    performanceDestination = context.createMediaStreamDestination();
    performanceStream = performanceDestination.stream;
    if (!performanceStream?.getTracks) {
      performanceDestination = null;
      performanceStream = null;
      throw new Error('Web Audio performance capture stream is unavailable');
    }
    mixLimiter.connect(performanceDestination);
    return performanceStream;
  }

  /**
   * Routes an explicitly played local media element through the same output bus
   * as the synth and sampler. This keeps narration audible on the selected Mac
   * output and includes it in an opted-in performance capture. The route is
   * lazy: no AudioContext, source node or audio is created at boot.
   */
  async function routeMediaElement(element) {
    if (destroyed) throw new Error('sampler session destroyed');
    if (!element || typeof element !== 'object') {
      throw new TypeError('media element route requires an HTMLMediaElement');
    }
    const output = await getOutputDestination();
    const context = outputContext;
    const existing = mediaElementRoutes.get(element);
    if (existing?.context === context) return existing;
    if (!context?.createMediaElementSource || !context?.createGain) {
      throw new Error('Web Audio media-element routing is unsupported');
    }
    if (existing) {
      try { existing.source?.disconnect?.(); } catch (_) { /* best effort teardown */ }
      try { existing.gain?.disconnect?.(); } catch (_) { /* best effort teardown */ }
      mediaElementRoutes.delete(element);
    }
    const source = context.createMediaElementSource(element);
    const gain = context.createGain();
    gain.gain.value = 1;
    source.connect(gain);
    gain.connect(output);
    const route = Object.freeze({ context, source, gain, output });
    mediaElementRoutes.set(element, route);
    return route;
  }

  function releasePerformanceCaptureStream() {
    const destination = performanceDestination;
    const stream = performanceStream;
    performanceDestination = null;
    performanceStream = null;
    try {
      if (destination && mixLimiter) mixLimiter.disconnect?.(destination);
    } catch (_) { /* browser nodes may already be disconnected */ }
    try { destination?.disconnect?.(); } catch (_) { /* best effort teardown */ }
    for (const track of stream?.getTracks?.() || []) {
      try { track.stop?.(); } catch (_) { /* best effort teardown */ }
    }
  }

  function releaseMicStream() {
    micGeneration += 1;
    for (const track of micStream?.getTracks?.() || []) track.stop?.();
    micStream = null;
  }

  function getState() {
    return Object.freeze({
      audioReady: audioContext?.state === 'running',
      micActive: Boolean(micStream?.getAudioTracks?.().some((track) => track.readyState !== 'ended')),
      mediaElementRouteCount: mediaElementRoutes.size,
      destroyed,
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    releaseMicStream();
    releasePerformanceCaptureStream();
    for (const route of mediaElementRoutes.values()) {
      try { route.source?.disconnect?.(); } catch (_) { /* best effort teardown */ }
      try { route.gain?.disconnect?.(); } catch (_) { /* best effort teardown */ }
    }
    mediaElementRoutes.clear();
    try { outputDestination?.disconnect?.(); } catch (_) { /* best effort teardown */ }
    try { mixLimiter?.disconnect?.(); } catch (_) { /* best effort teardown */ }
    mixLimiter = null;
    outputDestination = null;
    outputContext = null;
    stageAnalyser?.disconnect?.();
    stageAnalyser = null;
    audioContext?.close?.().catch?.(() => {});
    audioContext = null;
  }

  return Object.freeze({
    getAudioContext,
    getMicStream,
    releaseMicStream,
    getOutputDestination,
    sampleStageOutput,
    getPerformanceCaptureStream,
    releasePerformanceCaptureStream,
    routeMediaElement,
    getState,
    destroy,
  });
}
