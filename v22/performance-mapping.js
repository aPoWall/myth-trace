const FINGER_NAMES = Object.freeze(['thumb', 'index', 'middle', 'ring', 'pinky']);
const TIP_INDEXES = Object.freeze([4, 8, 12, 16, 20]);
const SIDE_NAMES = Object.freeze(['left', 'right']);
const MIN_RANGE_INTERVAL_MS = 1000 / 30;

const CHANNEL = Object.freeze({
  openness: 0,
  spread: 1,
  curlStart: 2,
  tipStart: 7,
  palmX: 17,
  palmY: 18,
  palmZ: 19,
  velocityX: 20,
  velocityY: 21,
  velocity: 22,
  frameEnergy: 23,
  filter: 24,
  delay: 25,
  density: 26,
  playbackRate: 27,
  count: 28,
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min = 0, max = 1, fallback = min) {
  const number = Number(value);
  const finiteValue = Number.isFinite(number) ? number : fallback;
  return Math.min(max, Math.max(min, finiteValue));
}

function requireFinite(object, key, { min = -Infinity, max = Infinity } = {}) {
  const value = Number(object?.[key]);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`performance mapper ${key} must be finite in ${min}..${max}`);
  }
  return value;
}

function readConfig(config) {
  const tracking = config?.tracking;
  const sampler = config?.sampler;
  const entities = config?.entities;
  const mapping = config?.performanceMapping;
  if (!tracking || !sampler || !entities || !mapping) {
    throw new TypeError('performance mapper requires config tracking, sampler, entities and performanceMapping');
  }

  const pinchOn = requireFinite(mapping, 'pinchOn', { min: 0, max: 1 });
  const pinchOff = requireFinite(mapping, 'pinchOff', { min: 0, max: pinchOn });
  const chordDistanceMax = requireFinite(mapping, 'chordDistanceMax', { min: Number.EPSILON });
  const minConfidence = requireFinite(tracking, 'minHandScore', { min: 0, max: 1 });
  const staleMs = requireFinite(tracking, 'lostHoldMs', { min: 0 });
  const rangeIntervalMs = requireFinite(sampler, 'rangeIntervalMs', { min: MIN_RANGE_INTERVAL_MS });
  const smoothingSeconds = requireFinite(sampler, 'rangeSmoothingSeconds', { min: 0 });
  const minCooldownMs = requireFinite(sampler, 'minCooldownMs', { min: 0 });
  const maxCooldownMs = requireFinite(sampler, 'maxCooldownMs', { min: minCooldownMs });
  const cooldownMs = requireFinite(sampler, 'defaultCooldownMs', {
    min: minCooldownMs,
    max: maxCooldownMs,
  });
  const rateMin = requireFinite(sampler, 'playbackRateMin', { min: Number.EPSILON });
  const rateMax = requireFinite(sampler, 'playbackRateMax', { min: rateMin });
  if (!Array.isArray(sampler.playbackRateRatios) || sampler.playbackRateRatios.length === 0) {
    throw new TypeError('performance mapper requires sampler playbackRateRatios');
  }
  const ratios = [];
  for (const candidate of sampler.playbackRateRatios) {
    const value = Number(candidate);
    if (!Number.isFinite(value) || value < rateMin || value > rateMax || ratios.includes(value)) continue;
    ratios.push(value);
  }
  ratios.sort((a, b) => a - b);
  if (!ratios.length) throw new TypeError('performance mapper has no usable playbackRateRatios');
  if (!Array.isArray(entities.handCurlJoints) || entities.handCurlJoints.length !== FINGER_NAMES.length) {
    throw new TypeError('performance mapper requires five hand curl joints');
  }

  return Object.freeze({
    pinchOn,
    pinchOff,
    chordDistanceMax,
    minConfidence,
    staleMs,
    rangeIntervalMs,
    smoothingMs: smoothingSeconds * 1000,
    cooldownMs,
    rateMin,
    rateMax,
    ratios: Object.freeze(ratios),
    curlJoints: entities.handCurlJoints,
    defaultRoute: entities.sources?.hands || null,
  });
}

function makeFingerValues() {
  return {
    thumb: 0,
    index: 0,
    middle: 0,
    ring: 0,
    pinky: 0,
  };
}

function makeFingertipValues() {
  return {
    thumb: { x: 0, y: 0 },
    index: { x: 0, y: 0 },
    middle: { x: 0, y: 0 },
    ring: { x: 0, y: 0 },
    pinky: { x: 0, y: 0 },
  };
}

function makeRangeValues() {
  return {
    openness: 0,
    spread: 0,
    curls: makeFingerValues(),
    fingertips: makeFingertipValues(),
    palm: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, magnitude: 0 },
    frameEnergy: 0,
    filter: 0,
    delay: 0,
    delaySend: 0,
    density: 0,
    playbackRate: 0,
    rateSuggestion: 1,
    chordWidth: 0,
  };
}

function makeEventIntent(domain, side) {
  return {
    kind: 'event',
    domain,
    target: domain === 'sample' ? 'trigger' : domain === 'music' ? 'gesture-note' : 'pinch',
    source: 'hands',
    key: `hand:${side}:pinch`,
    handKey: `hand:${side}`,
    edge: true,
    timestamp: 0,
    cooldownMs: 0,
    clipId: '',
    velocity: 0,
    playbackRate: 1,
    offsetSeconds: 0,
    durationSeconds: null,
    strength: 0,
    confidence: 0,
  };
}

function makeRangeIntent(domain, side = '') {
  const handKey = side ? `hand:${side}` : 'hands';
  return {
    kind: 'range',
    domain,
    target: domain === 'sample' ? 'sampler-range' : domain === 'music' ? 'gesture-range' : 'hand-range',
    source: 'hands',
    key: `${handKey}:range`,
    handKey,
    timestamp: 0,
    confidence: 0,
    route: 0,
    handCount: 0,
    values: makeRangeValues(),
  };
}

function makeSide(side) {
  return {
    name: side,
    key: `hand:${side}`,
    active: false,
    pinched: false,
    hasSmooth: false,
    confidence: 0,
    lastSeenAt: null,
    lastSmoothAt: null,
    lastEventAt: null,
    nextEventAt: -Infinity,
    eventCount: 0,
    rangeCount: 0,
    lossCount: 0,
    raw: new Float64Array(CHANNEL.count),
    smooth: new Float64Array(CHANNEL.count),
    sampleEvent: makeEventIntent('sample', side),
    musicEvent: makeEventIntent('music', side),
    visualEvent: makeEventIntent('visual', side),
    visualRange: makeRangeIntent('visual', side),
  };
}

function pointDistance(a, b) {
  const x = finite(a?.x) - finite(b?.x);
  const y = finite(a?.y) - finite(b?.y);
  const z = finite(a?.z) - finite(b?.z);
  return Math.hypot(x, y, z);
}

function fingerCurl(landmarks, joint) {
  const a = landmarks?.[joint?.a];
  const b = landmarks?.[joint?.b];
  const c = landmarks?.[joint?.c];
  if (!a || !b || !c) return 0;
  const abX = finite(a.x) - finite(b.x);
  const abY = finite(a.y) - finite(b.y);
  const abZ = finite(a.z) - finite(b.z);
  const cbX = finite(c.x) - finite(b.x);
  const cbY = finite(c.y) - finite(b.y);
  const cbZ = finite(c.z) - finite(b.z);
  const magnitude = Math.hypot(abX, abY, abZ) * Math.hypot(cbX, cbY, cbZ);
  if (magnitude <= Number.EPSILON) return 0;
  const cosine = clamp((abX * cbX + abY * cbY + abZ * cbZ) / magnitude, -1, 1);
  return clamp(1 - Math.acos(cosine) / Math.PI);
}

function routeFromInput(input, fallback) {
  const settings = input?.settings && typeof input.settings === 'object'
    ? input.settings
    : input;
  const route = settings?.hands && typeof settings.hands === 'object'
    ? settings.hands
    : fallback;
  return route || null;
}

function normalizeHandedness(hand) {
  const handedness = hand?.handedness;
  if (handedness === 'Left' || handedness === 'left') return 0;
  if (handedness === 'Right' || handedness === 'right') return 1;
  return -1;
}

function palmX(hand) {
  return clamp(hand?.palm?.x ?? hand?.landmarks?.[0]?.x);
}

function selectHands(hands, selected) {
  selected[0] = null;
  selected[1] = null;
  let leftScore = -Infinity;
  let rightScore = -Infinity;
  let unknownLeft = null;
  let unknownRight = null;
  let unknownLeftX = Infinity;
  let unknownRightX = -Infinity;
  let unknownCount = 0;

  for (let index = 0; index < hands.length; index += 1) {
    const hand = hands[index];
    if (!hand || typeof hand !== 'object') continue;
    const side = normalizeHandedness(hand);
    const score = finite(hand.score, -Infinity);
    if (side === 0 && score > leftScore) {
      selected[0] = hand;
      leftScore = score;
      continue;
    }
    if (side === 1 && score > rightScore) {
      selected[1] = hand;
      rightScore = score;
      continue;
    }
    if (side !== -1) continue;
    const x = palmX(hand);
    unknownCount += 1;
    if (x < unknownLeftX) {
      unknownLeftX = x;
      unknownLeft = hand;
    }
    if (x > unknownRightX) {
      unknownRightX = x;
      unknownRight = hand;
    }
  }

  if (unknownCount === 1) {
    if (unknownLeftX <= 0.5 && !selected[0]) selected[0] = unknownLeft;
    else if (!selected[1]) selected[1] = unknownLeft;
    else if (!selected[0]) selected[0] = unknownLeft;
  } else if (unknownCount > 1) {
    if (!selected[0]) selected[0] = unknownLeft;
    if (!selected[1] && unknownRight !== selected[0]) selected[1] = unknownRight;
  }
}

function fillRaw(side, hand, frameEnergy, mapping) {
  const raw = side.raw;
  const landmarks = Array.isArray(hand.landmarks) ? hand.landmarks : null;
  const palm = hand.palm || landmarks?.[0] || null;
  const width = clamp(hand?.bbox?.w);
  const height = clamp(hand?.bbox?.h);
  const scale = Math.max(Math.hypot(width, height), Number.EPSILON);
  const thumb = landmarks?.[4] || palm;
  const index = landmarks?.[8] || palm;
  const pinky = landmarks?.[20] || palm;

  let openness = Number(hand.openness);
  if (!Number.isFinite(openness)) {
    openness = 0;
    for (let finger = 0; finger < TIP_INDEXES.length; finger += 1) {
      openness += pointDistance(landmarks?.[TIP_INDEXES[finger]] || palm, palm);
    }
    openness /= TIP_INDEXES.length * scale;
  }
  raw[CHANNEL.openness] = clamp(openness);
  raw[CHANNEL.spread] = clamp(pointDistance(index, pinky) / scale);

  let curlMaximum = 0;
  for (let finger = 0; finger < FINGER_NAMES.length; finger += 1) {
    const curl = fingerCurl(landmarks, mapping.curlJoints[finger]);
    raw[CHANNEL.curlStart + finger] = curl;
    curlMaximum = Math.max(curlMaximum, curl);
    const point = landmarks?.[TIP_INDEXES[finger]] || palm;
    raw[CHANNEL.tipStart + finger * 2] = clamp(point?.x);
    raw[CHANNEL.tipStart + finger * 2 + 1] = clamp(point?.y);
  }

  raw[CHANNEL.palmX] = clamp(palm?.x);
  raw[CHANNEL.palmY] = clamp(palm?.y);
  raw[CHANNEL.palmZ] = clamp(palm?.z, -1, 1);
  raw[CHANNEL.velocityX] = clamp(hand.velocityX, -1, 1);
  raw[CHANNEL.velocityY] = clamp(hand.velocityY, -1, 1);
  raw[CHANNEL.velocity] = clamp(Math.hypot(raw[CHANNEL.velocityX], raw[CHANNEL.velocityY]) / Math.SQRT2);
  raw[CHANNEL.frameEnergy] = clamp(frameEnergy);
  raw[CHANNEL.filter] = raw[CHANNEL.openness];
  raw[CHANNEL.delay] = raw[CHANNEL.spread];
  raw[CHANNEL.density] = Math.max(curlMaximum, raw[CHANNEL.velocity], raw[CHANNEL.frameEnergy]);
  raw[CHANNEL.playbackRate] = raw[CHANNEL.palmX];

  const pinchValue = Number(hand.pinch);
  return clamp(Number.isFinite(pinchValue) ? pinchValue : 1 - pointDistance(thumb, index) / scale);
}

function copyRangeValues(values, channels, rateSuggestion) {
  values.openness = clamp(channels[CHANNEL.openness]);
  values.spread = clamp(channels[CHANNEL.spread]);
  for (let finger = 0; finger < FINGER_NAMES.length; finger += 1) {
    const name = FINGER_NAMES[finger];
    values.curls[name] = clamp(channels[CHANNEL.curlStart + finger]);
    values.fingertips[name].x = clamp(channels[CHANNEL.tipStart + finger * 2]);
    values.fingertips[name].y = clamp(channels[CHANNEL.tipStart + finger * 2 + 1]);
  }
  values.palm.x = clamp(channels[CHANNEL.palmX]);
  values.palm.y = clamp(channels[CHANNEL.palmY]);
  values.palm.z = clamp(channels[CHANNEL.palmZ], -1, 1);
  values.velocity.x = clamp(channels[CHANNEL.velocityX], -1, 1);
  values.velocity.y = clamp(channels[CHANNEL.velocityY], -1, 1);
  values.velocity.magnitude = clamp(channels[CHANNEL.velocity]);
  values.frameEnergy = clamp(channels[CHANNEL.frameEnergy]);
  values.filter = clamp(channels[CHANNEL.filter]);
  values.delay = clamp(channels[CHANNEL.delay]);
  values.delaySend = values.delay;
  values.density = clamp(channels[CHANNEL.density]);
  values.playbackRate = clamp(channels[CHANNEL.playbackRate]);
  values.rateSuggestion = rateSuggestion;
}

/**
 * Converts current hand tracking into bounded, reusable data-only intents.
 * Consumers must read each returned batch before the next update because its
 * arrays and intent records are deliberately reused to bound hot-path garbage.
 */
export function createPerformanceMapper({ config } = {}) {
  const mapping = readConfig(config);
  const sides = [makeSide('left'), makeSide('right')];
  const selectedHands = [null, null];
  const aggregateChannels = new Float64Array(CHANNEL.count);
  const samplerRange = makeRangeIntent('sample');
  const musicRange = makeRangeIntent('music');
  const output = {
    timestamp: 0,
    sampler: [],
    music: [],
    visual: [],
  };

  let destroyed = false;
  let lastTimestamp = null;
  let lastTrackingTimestamp = null;
  let lastRangeAt = null;
  let regressionCount = 0;
  let totalSamplerEvents = 0;
  let totalSamplerRanges = 0;
  let totalMusicEvents = 0;
  let totalMusicRanges = 0;
  let totalVisualEvents = 0;
  let totalVisualRanges = 0;
  let currentArmed = false;
  let currentClipId = '';
  let currentRouteEnabled = false;
  let currentOverlayRoute = 0;
  let currentSoundRoute = 0;
  let currentStale = true;

  function quantizeRate(control) {
    const requested = mapping.rateMin + (mapping.rateMax - mapping.rateMin) * clamp(control);
    let best = mapping.ratios[0];
    let distance = Math.abs(best - requested);
    for (let index = 1; index < mapping.ratios.length; index += 1) {
      const candidate = mapping.ratios[index];
      const candidateDistance = Math.abs(candidate - requested);
      if (candidateDistance < distance) {
        best = candidate;
        distance = candidateDistance;
      }
    }
    return best;
  }

  function deactivateSide(side, countLoss = true) {
    if (countLoss && (side.active || side.pinched || side.hasSmooth)) side.lossCount += 1;
    side.active = false;
    side.pinched = false;
    side.hasSmooth = false;
    side.confidence = 0;
    side.lastSeenAt = null;
    side.lastSmoothAt = null;
    side.lastEventAt = null;
    side.nextEventAt = -Infinity;
    side.raw.fill(0);
    side.smooth.fill(0);
  }

  function clearOutput(timestamp) {
    output.timestamp = timestamp;
    output.sampler.length = 0;
    output.music.length = 0;
    output.visual.length = 0;
  }

  function resetTemporalState() {
    deactivateSide(sides[0]);
    deactivateSide(sides[1]);
    lastRangeAt = null;
  }

  function updateSmooth(side, timestamp) {
    if (!side.hasSmooth || side.lastSmoothAt === null || mapping.smoothingMs === 0) {
      side.smooth.set(side.raw);
      side.hasSmooth = true;
    } else {
      const elapsed = Math.max(0, timestamp - side.lastSmoothAt);
      const amount = 1 - Math.exp(-elapsed / mapping.smoothingMs);
      for (let index = 0; index < CHANNEL.count; index += 1) {
        side.smooth[index] += (side.raw[index] - side.smooth[index]) * amount;
      }
    }
    side.lastSmoothAt = timestamp;
  }

  function emitEvent(side, timestamp, pinch, clipId, sampleGate, musicGate, visualGate) {
    if (timestamp < side.nextEventAt) return;
    side.nextEventAt = timestamp + mapping.cooldownMs;
    side.lastEventAt = timestamp;
    side.eventCount += 1;
    const rateSuggestion = quantizeRate(side.raw[CHANNEL.playbackRate]);

    if (sampleGate) {
      const intent = side.sampleEvent;
      intent.timestamp = timestamp;
      intent.cooldownMs = mapping.cooldownMs;
      intent.clipId = clipId;
      intent.velocity = clamp(pinch * currentSoundRoute);
      intent.playbackRate = rateSuggestion;
      intent.strength = intent.velocity;
      intent.confidence = side.confidence;
      output.sampler.push(intent);
      totalSamplerEvents += 1;
    }

    if (musicGate) {
      const intent = side.musicEvent;
      intent.timestamp = timestamp;
      intent.cooldownMs = mapping.cooldownMs;
      intent.clipId = '';
      intent.velocity = clamp(pinch);
      intent.playbackRate = rateSuggestion;
      intent.strength = intent.velocity;
      intent.confidence = side.confidence;
      output.music.push(intent);
      totalMusicEvents += 1;
    }

    if (visualGate) {
      const intent = side.visualEvent;
      intent.timestamp = timestamp;
      intent.cooldownMs = mapping.cooldownMs;
      intent.clipId = '';
      intent.velocity = clamp(side.raw[CHANNEL.velocity]);
      intent.playbackRate = rateSuggestion;
      intent.strength = clamp(pinch * currentOverlayRoute);
      intent.confidence = side.confidence;
      output.visual.push(intent);
      totalVisualEvents += 1;
    }
  }

  function emitRanges(timestamp, sampleGate, musicGate, visualGate) {
    let activeCount = 0;
    let confidence = 0;
    let chordWidth = 0;
    aggregateChannels.fill(0);

    if (sides[0].active && sides[1].active) {
      const dx = sides[0].raw[CHANNEL.palmX] - sides[1].raw[CHANNEL.palmX];
      const dy = sides[0].raw[CHANNEL.palmY] - sides[1].raw[CHANNEL.palmY];
      chordWidth = clamp(Math.hypot(dx, dy) / mapping.chordDistanceMax);
    }

    for (let index = 0; index < sides.length; index += 1) {
      const side = sides[index];
      if (!side.active) continue;
      updateSmooth(side, timestamp);
      activeCount += 1;
      confidence += side.confidence;
      for (let channel = 0; channel < CHANNEL.count; channel += 1) {
        aggregateChannels[channel] += side.smooth[channel];
      }
      side.rangeCount += 1;

      if (visualGate) {
        const intent = side.visualRange;
        intent.timestamp = timestamp;
        intent.confidence = side.confidence;
        intent.route = currentOverlayRoute;
        intent.handCount = 1;
        copyRangeValues(intent.values, side.smooth, quantizeRate(side.smooth[CHANNEL.playbackRate]));
        intent.values.chordWidth = chordWidth;
        output.visual.push(intent);
        totalVisualRanges += 1;
      }
    }

    if (!activeCount) return;
    const divisor = 1 / activeCount;
    for (let channel = 0; channel < CHANNEL.count; channel += 1) {
      aggregateChannels[channel] *= divisor;
    }
    const rateSuggestion = quantizeRate(aggregateChannels[CHANNEL.playbackRate]);
    if (sampleGate) {
      const values = samplerRange.values;
      copyRangeValues(values, aggregateChannels, rateSuggestion);
      values.chordWidth = chordWidth;
      samplerRange.timestamp = timestamp;
      samplerRange.confidence = clamp(confidence * divisor);
      samplerRange.route = currentSoundRoute;
      samplerRange.handCount = activeCount;
      output.sampler.push(samplerRange);
      totalSamplerRanges += 1;
    }
    if (musicGate) {
      const values = musicRange.values;
      copyRangeValues(values, aggregateChannels, rateSuggestion);
      values.chordWidth = chordWidth;
      musicRange.timestamp = timestamp;
      musicRange.confidence = clamp(confidence * divisor);
      musicRange.route = currentSoundRoute;
      musicRange.handCount = activeCount;
      output.music.push(musicRange);
      totalMusicRanges += 1;
    }
  }

  function update({
    timestamp,
    tracking,
    entitySettings,
    routes,
    armed,
    samplerState,
    clipId,
    selectedClipId,
    selectedClip,
  } = {}) {
    const updateAt = Math.max(0, finite(timestamp, lastTimestamp ?? 0));
    clearOutput(updateAt);
    if (destroyed) return output;

    const trackingAtValue = Number(tracking?.ts);
    const trackingAt = Number.isFinite(trackingAtValue) ? Math.max(0, trackingAtValue) : null;
    const regressed = (lastTimestamp !== null && updateAt < lastTimestamp)
      || (trackingAt !== null && lastTrackingTimestamp !== null && trackingAt < lastTrackingTimestamp);
    if (regressed) {
      resetTemporalState();
      regressionCount += 1;
    }
    lastTimestamp = updateAt;
    if (trackingAt !== null) lastTrackingTimestamp = trackingAt;

    const routeInput = entitySettings ?? routes;
    const route = routeFromInput(routeInput, mapping.defaultRoute);
    currentRouteEnabled = route?.enabled !== false;
    currentOverlayRoute = currentRouteEnabled ? clamp(route?.overlay) : 0;
    currentSoundRoute = currentRouteEnabled ? clamp(route?.sound) : 0;
    currentArmed = armed === undefined ? Boolean(samplerState?.armed) : Boolean(armed);
    const requestedClip = selectedClipId ?? clipId ?? selectedClip?.id ?? '';
    currentClipId = typeof requestedClip === 'string' ? requestedClip : '';
    currentStale = trackingAt === null || updateAt - trackingAt > mapping.staleMs;

    const hands = Array.isArray(tracking?.hands) ? tracking.hands : null;
    if (!currentRouteEnabled || currentStale || !hands || hands.length === 0) {
      resetTemporalState();
      return output;
    }

    selectHands(hands, selectedHands);
    const frameEnergy = clamp(tracking?.metrics?.handEnergy);
    let activeCount = 0;
    const sampleGate = currentSoundRoute > 0 && currentArmed && currentClipId.length > 0;
    const musicGate = currentSoundRoute > 0;
    const visualGate = currentOverlayRoute > 0;

    for (let index = 0; index < sides.length; index += 1) {
      const side = sides[index];
      const hand = selectedHands[index];
      const confidence = clamp(hand?.score);
      if (!hand || confidence < mapping.minConfidence) {
        deactivateSide(side);
        continue;
      }

      side.active = true;
      side.confidence = confidence;
      side.lastSeenAt = trackingAt;
      activeCount += 1;
      const pinch = fillRaw(side, hand, frameEnergy, mapping);
      if (!side.pinched && pinch >= mapping.pinchOn) {
        side.pinched = true;
        emitEvent(side, updateAt, pinch, currentClipId, sampleGate, musicGate, visualGate);
      } else if (side.pinched && pinch <= mapping.pinchOff) {
        side.pinched = false;
      }
    }

    if (!activeCount) {
      lastRangeAt = null;
      return output;
    }
    if (lastRangeAt === null || updateAt - lastRangeAt >= mapping.rangeIntervalMs) {
      lastRangeAt = updateAt;
      emitRanges(updateAt, sampleGate, musicGate, visualGate);
    }
    return output;
  }

  function snapshotSide(side) {
    return Object.freeze({
      key: side.key,
      active: side.active,
      pinched: side.pinched,
      confidence: side.confidence,
      lastSeenAt: side.lastSeenAt,
      lastSmoothAt: side.lastSmoothAt,
      lastEventAt: side.lastEventAt,
      nextEventAt: Number.isFinite(side.nextEventAt) ? side.nextEventAt : null,
      eventCount: side.eventCount,
      rangeCount: side.rangeCount,
      lossCount: side.lossCount,
    });
  }

  function snapshot() {
    return Object.freeze({
      destroyed,
      armed: currentArmed,
      clipSelected: currentClipId.length > 0,
      timestamp: lastTimestamp,
      trackingTimestamp: lastTrackingTimestamp,
      stale: currentStale,
      route: Object.freeze({
        enabled: currentRouteEnabled,
        overlay: currentOverlayRoute,
        sound: currentSoundRoute,
      }),
      rangeIntervalMs: mapping.rangeIntervalMs,
      smoothingMs: mapping.smoothingMs,
      lastRangeAt,
      regressionCount,
      samplerIntentCount: output.sampler.length,
      musicIntentCount: output.music.length,
      visualIntentCount: output.visual.length,
      totals: Object.freeze({
        samplerEvents: totalSamplerEvents,
        samplerRanges: totalSamplerRanges,
        musicEvents: totalMusicEvents,
        musicRanges: totalMusicRanges,
        visualEvents: totalVisualEvents,
        visualRanges: totalVisualRanges,
      }),
      hands: Object.freeze({
        left: snapshotSide(sides[0]),
        right: snapshotSide(sides[1]),
      }),
    });
  }

  function reset() {
    clearOutput(0);
    deactivateSide(sides[0], false);
    deactivateSide(sides[1], false);
    sides[0].eventCount = 0;
    sides[0].rangeCount = 0;
    sides[0].lossCount = 0;
    sides[1].eventCount = 0;
    sides[1].rangeCount = 0;
    sides[1].lossCount = 0;
    lastTimestamp = null;
    lastTrackingTimestamp = null;
    lastRangeAt = null;
    regressionCount = 0;
    totalSamplerEvents = 0;
    totalSamplerRanges = 0;
    totalMusicEvents = 0;
    totalMusicRanges = 0;
    totalVisualEvents = 0;
    totalVisualRanges = 0;
    currentArmed = false;
    currentClipId = '';
    currentRouteEnabled = false;
    currentOverlayRoute = 0;
    currentSoundRoute = 0;
    currentStale = true;
    return snapshot();
  }

  function destroy() {
    if (destroyed) return;
    reset();
    destroyed = true;
  }

  return Object.freeze({ update, snapshot, reset, destroy });
}
