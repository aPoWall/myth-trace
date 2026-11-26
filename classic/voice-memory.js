function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, range, fallback) {
  return Math.min(range[1], Math.max(range[0], finite(value, fallback)));
}

export function normalizeVoiceMemorySettings(input = {}, defaults = {}) {
  const limits = defaults.limits || {};
  const range = (key, fallback) => Array.isArray(limits[key]) ? limits[key] : fallback;
  return Object.freeze({
    echoDelaySeconds: clamp(input.echoDelaySeconds, range('echoDelaySeconds', [0.08, 1.2]), defaults.echoDelaySeconds ?? 0.34),
    feedback: clamp(input.feedback, range('feedback', [0, 0.72]), defaults.feedback ?? 0.36),
    wet: clamp(input.wet, range('wet', [0, 0.8]), defaults.wet ?? 0.32),
    repeatEnabled: Object.hasOwn(input, 'repeatEnabled')
      ? input.repeatEnabled === true || input.repeatEnabled === 'true'
      : defaults.repeatEnabled === true,
    repeatDelaySeconds: clamp(input.repeatDelaySeconds, range('repeatDelaySeconds', [2, 30]), defaults.repeatDelaySeconds ?? 6),
    fragmentLengthSeconds: clamp(input.fragmentLengthSeconds, range('fragmentLengthSeconds', [1, 20]), defaults.fragmentLengthSeconds ?? 5),
    repeatCount: Math.round(clamp(input.repeatCount, range('repeatCount', [1, 4]), defaults.repeatCount ?? 1)),
  });
}

function setParam(param, value, time = 0) {
  if (!param) return;
  param.cancelScheduledValues?.(time);
  param.setValueAtTime?.(value, time);
  if (typeof param.setValueAtTime !== 'function') param.value = value;
}

export function createVoiceMemory({
  config,
  routeMediaElement,
  onStatus = () => {},
  setTimer = globalThis.setTimeout?.bind(globalThis),
  clearTimer = globalThis.clearTimeout?.bind(globalThis),
} = {}) {
  const defaults = config?.narration?.memory;
  if (!defaults || typeof routeMediaElement !== 'function') {
    throw new TypeError('createVoiceMemory requires CONFIG.narration.memory and routeMediaElement');
  }

  let settings = normalizeVoiceMemorySettings({}, defaults);
  let element = null;
  let route = null;
  let graph = null;
  let active = false;
  let replaying = false;
  let remainingRepeats = 0;
  let repeatTimer = null;
  let fragmentTimer = null;
  let tailTimer = null;
  let destroyed = false;
  let lastEvent = 'idle';

  function now() {
    return finite(route?.context?.currentTime, 0);
  }

  function report(message) {
    try { onStatus({ source: 'voice-memory', message, ...getState() }); } catch { /* UI observers cannot break audio */ }
  }

  function clearHandle(name) {
    const handle = name === 'repeat' ? repeatTimer : name === 'fragment' ? fragmentTimer : tailTimer;
    if (handle !== null) clearTimer?.(handle);
    if (name === 'repeat') repeatTimer = null;
    else if (name === 'fragment') fragmentTimer = null;
    else tailTimer = null;
  }

  function clearTimers() {
    clearHandle('repeat');
    clearHandle('fragment');
    clearHandle('tail');
  }

  function exactZero() {
    setParam(graph?.feedback?.gain, 0, now());
    setParam(graph?.wet?.gain, 0, now());
  }

  function applyEffects() {
    if (!graph) return;
    const time = now();
    setParam(graph.delay.delayTime, settings.echoDelaySeconds, time);
    setParam(graph.feedback.gain, settings.feedback, time);
    setParam(graph.wet.gain, settings.wet, time);
  }

  function disconnectGraph() {
    exactZero();
    for (const node of Object.values(graph || {})) {
      try { node?.disconnect?.(); } catch { /* best effort */ }
    }
    graph = null;
  }

  function buildGraph(nextRoute) {
    if (graph && route === nextRoute) return;
    disconnectGraph();
    route = nextRoute;
    const context = route?.context;
    if (!context?.createDelay || !context?.createGain || !route?.gain || !route?.output) {
      throw new Error('voice memory Web Audio route is unavailable');
    }
    const delay = context.createDelay(defaults.maxDelaySeconds);
    const feedback = context.createGain();
    const wet = context.createGain();
    setParam(delay.delayTime, settings.echoDelaySeconds, now());
    setParam(feedback.gain, 0, now());
    setParam(wet.gain, 0, now());
    route.gain.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(route.output);
    graph = { delay, feedback, wet };
  }

  async function arm(nextElement = element) {
    if (destroyed) return getState();
    if (!nextElement) throw new TypeError('voice memory requires a media element');
    element = nextElement;
    const nextRoute = await routeMediaElement(element);
    buildGraph(nextRoute);
    lastEvent = 'armed';
    return getState();
  }

  function configure(patch = {}) {
    if (destroyed || !patch || typeof patch !== 'object') return getState();
    settings = normalizeVoiceMemorySettings(patch, { ...defaults, ...settings, limits: defaults.limits });
    if (!settings.repeatEnabled) {
      remainingRepeats = 0;
      clearHandle('repeat');
      clearHandle('fragment');
    }
    if (active) applyEffects();
    lastEvent = 'configured';
    return getState();
  }

  function tailDurationMs() {
    const repeats = 2 + settings.feedback * 8;
    return Math.min(defaults.maxTailSeconds * 1000, Math.max(300, settings.echoDelaySeconds * repeats * 1000));
  }

  function finishAfterTail() {
    clearHandle('tail');
    tailTimer = setTimer?.(() => {
      tailTimer = null;
      active = false;
      replaying = false;
      exactZero();
      lastEvent = 'tail complete · exact silence';
      report(lastEvent);
    }, tailDurationMs()) ?? null;
  }

  function scheduleRepeat() {
    clearHandle('repeat');
    if (!active || !settings.repeatEnabled || remainingRepeats <= 0) {
      finishAfterTail();
      return false;
    }
    lastEvent = `memory waiting · ${settings.repeatDelaySeconds}s`;
    repeatTimer = setTimer?.(async () => {
      repeatTimer = null;
      if (!active || !settings.repeatEnabled || remainingRepeats <= 0 || !element) return;
      remainingRepeats -= 1;
      replaying = true;
      element.currentTime = 0;
      applyEffects();
      try {
        await element.play?.();
        lastEvent = `memory replay · ${settings.fragmentLengthSeconds}s`;
        report(lastEvent);
        fragmentTimer = setTimer?.(() => {
          fragmentTimer = null;
          element?.pause?.();
          replaying = false;
          if (remainingRepeats > 0) scheduleRepeat();
          else finishAfterTail();
        }, settings.fragmentLengthSeconds * 1000) ?? null;
      } catch (error) {
        active = false;
        replaying = false;
        exactZero();
        lastEvent = `memory replay unavailable · ${error.message}`;
        report(lastEvent);
      }
    }, settings.repeatDelaySeconds * 1000) ?? null;
    report(lastEvent);
    return true;
  }

  function start() {
    if (destroyed || !graph || !element) return getState();
    clearTimers();
    active = true;
    replaying = false;
    remainingRepeats = settings.repeatEnabled ? settings.repeatCount : 0;
    applyEffects();
    lastEvent = settings.repeatEnabled
      ? `voice echo live · ${remainingRepeats} memory ${remainingRepeats === 1 ? 'repeat' : 'repeats'}`
      : 'voice echo live';
    report(lastEvent);
    return getState();
  }

  function handleEnded() {
    if (!active || replaying) return false;
    return scheduleRepeat();
  }

  function stop(reason = 'voice memory stopped · exact silence') {
    clearTimers();
    element?.pause?.();
    remainingRepeats = 0;
    replaying = false;
    active = false;
    exactZero();
    lastEvent = reason;
    report(lastEvent);
    return getState();
  }

  function panic() {
    settings = normalizeVoiceMemorySettings({ ...settings, repeatEnabled: false }, { ...defaults, ...settings, limits: defaults.limits });
    return stop('panic · voice memory exact silence');
  }

  function getState() {
    return Object.freeze({
      active,
      replaying,
      remainingRepeats,
      scheduled: repeatTimer !== null || fragmentTimer !== null || tailTimer !== null,
      effectLive: Boolean(graph) && active,
      settings,
      lastEvent,
      destroyed,
    });
  }

  function destroy() {
    if (destroyed) return;
    stop('voice memory destroyed');
    disconnectGraph();
    route = null;
    element = null;
    destroyed = true;
  }

  return Object.freeze({ arm, configure, start, handleEnded, stop, panic, getState, destroy });
}
