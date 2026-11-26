const CONTENT_MODES = Object.freeze([
  'paint',
  'object',
  'prompt-shader',
  'exercise-target',
]);

const PHASES = Object.freeze([
  'searching',
  'arming',
  'live',
  'frozen',
  'fading',
  'off',
]);

const DEFAULTS = Object.freeze({
  mode: 'paint',
  minArea: 0.06,
  minConfidence: 0.55,
  minBodyConfidence: 0.5,
  freshnessMs: 180,
  stableHoldMs: 350,
  stabilityEnterDistance: 0.018,
  stabilityExitDistance: 0.032,
  lossHoldMs: 420,
  freezeMs: 350,
  fadeMs: 1400,
  offMs: 3000,
  restoreMs: 600,
  motionStill: 0.055,
  motionActivate: 0.12,
  motionFullScale: 0.08,
  raisedHandMargin: 0.025,
  confirmationRule: 'hold',
  focalOpacity: 0.42,
  maxAspect: 20,
});

const MAX_EVENTS = 6;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function bounded(value, fallback, min, max) {
  return clamp(finite(value, fallback), min, max);
}

function option(source, key, fallback) {
  return source && source[key] !== undefined ? source[key] : fallback;
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function makePoint() {
  return { x: 0, y: 0, z: 0, handId: '', tip: '' };
}

function makeGeometry() {
  return {
    quad: [makePoint(), makePoint(), makePoint(), makePoint()],
    bbox: { x: 0, y: 0, w: 0, h: 0 },
    center: { x: 0, y: 0 },
    area: 0,
    aspect: 1,
    confidence: 0,
    leftId: '',
    rightId: '',
  };
}

function clearGeometry(geometry) {
  for (let index = 0; index < geometry.quad.length; index += 1) {
    const point = geometry.quad[index];
    point.x = 0;
    point.y = 0;
    point.z = 0;
    point.handId = '';
    point.tip = '';
  }
  geometry.bbox.x = 0;
  geometry.bbox.y = 0;
  geometry.bbox.w = 0;
  geometry.bbox.h = 0;
  geometry.center.x = 0;
  geometry.center.y = 0;
  geometry.area = 0;
  geometry.aspect = 1;
  geometry.confidence = 0;
  geometry.leftId = '';
  geometry.rightId = '';
}

function copyPoint(target, source) {
  target.x = source.x;
  target.y = source.y;
  target.z = source.z;
  target.handId = source.handId;
  target.tip = source.tip;
}

function copyGeometry(target, source) {
  for (let index = 0; index < target.quad.length; index += 1) {
    copyPoint(target.quad[index], source.quad[index]);
  }
  target.bbox.x = source.bbox.x;
  target.bbox.y = source.bbox.y;
  target.bbox.w = source.bbox.w;
  target.bbox.h = source.bbox.h;
  target.center.x = source.center.x;
  target.center.y = source.center.y;
  target.area = source.area;
  target.aspect = source.aspect;
  target.confidence = source.confidence;
  target.leftId = source.leftId;
  target.rightId = source.rightId;
}

function maximumPointDelta(a, b) {
  let maximum = 0;
  for (let index = 0; index < a.quad.length; index += 1) {
    maximum = Math.max(maximum, pointDistance(a.quad[index], b.quad[index]));
  }
  return maximum;
}

function pointConfidence(point) {
  let confidence = 1;
  let found = false;
  const direct = Number(point?.confidence);
  const presence = Number(point?.presence);
  const visibility = Number(point?.visibility);
  if (Number.isFinite(direct)) {
    confidence = Math.min(confidence, direct);
    found = true;
  }
  if (Number.isFinite(presence)) {
    confidence = Math.min(confidence, presence);
    found = true;
  }
  if (Number.isFinite(visibility)) {
    confidence = Math.min(confidence, visibility);
    found = true;
  }
  return found ? clamp(confidence) : 1;
}

function pointFresh(point, hand, frameTimestamp, timestamp, freshnessMs) {
  if (!point || point.stale === true || hand?.stale === true) return false;
  const explicitAge = Number.isFinite(Number(point.ageMs))
    ? Number(point.ageMs)
    : Number(hand?.ageMs);
  if (Number.isFinite(explicitAge) && explicitAge > freshnessMs) return false;
  const observedAt = Number.isFinite(Number(point.lastSeen))
    ? Number(point.lastSeen)
    : Number.isFinite(Number(hand?.lastSeen))
      ? Number(hand.lastSeen)
      : frameTimestamp;
  return timestamp - observedAt <= freshnessMs;
}

function validTip(point) {
  return Number.isFinite(Number(point?.x))
    && Number.isFinite(Number(point?.y))
    && Number.isFinite(Number(point?.z ?? 0));
}

function normalizedId(hand) {
  const id = hand?.id;
  return typeof id === 'string' && id ? id : '';
}

function handComesFirst(a, b, aId, bId) {
  const aThumb = a.landmarks[THUMB_TIP];
  const aIndex = a.landmarks[INDEX_TIP];
  const bThumb = b.landmarks[THUMB_TIP];
  const bIndex = b.landmarks[INDEX_TIP];
  const aCenter = (clamp(aThumb.x) + clamp(aIndex.x)) * 0.5;
  const bCenter = (clamp(bThumb.x) + clamp(bIndex.x)) * 0.5;
  if (aCenter !== bCenter) return aCenter < bCenter;
  return aId <= bId;
}

function writeTip(target, point, handId, tip) {
  target.x = clamp(point.x);
  target.y = clamp(point.y);
  target.z = clamp(point.z, -1, 1);
  target.handId = handId;
  target.tip = tip;
}

function writeHandEdge(top, bottom, hand, handId) {
  const thumb = hand.landmarks[THUMB_TIP];
  const index = hand.landmarks[INDEX_TIP];
  const thumbFirst = clamp(thumb.y) < clamp(index.y)
    || (clamp(thumb.y) === clamp(index.y) && clamp(thumb.x) <= clamp(index.x));
  if (thumbFirst) {
    writeTip(top, thumb, handId, 'thumb');
    writeTip(bottom, index, handId, 'index');
  } else {
    writeTip(top, index, handId, 'index');
    writeTip(bottom, thumb, handId, 'thumb');
  }
}

function buildGeometry(target, handA, handB, handAId, handBId, confidence, maxAspect) {
  const leftFirst = handComesFirst(handA, handB, handAId, handBId);
  const left = leftFirst ? handA : handB;
  const right = leftFirst ? handB : handA;
  const leftId = leftFirst ? handAId : handBId;
  const rightId = leftFirst ? handBId : handAId;

  // Clockwise order from the top point of the screen-left hand.
  writeHandEdge(target.quad[0], target.quad[3], left, leftId);
  writeHandEdge(target.quad[1], target.quad[2], right, rightId);

  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (let index = 0; index < target.quad.length; index += 1) {
    const point = target.quad[index];
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const width = clamp(maxX - minX);
  const height = clamp(maxY - minY);
  target.bbox.x = clamp(minX);
  target.bbox.y = clamp(minY);
  target.bbox.w = width;
  target.bbox.h = height;
  target.center.x = clamp(minX + width * 0.5);
  target.center.y = clamp(minY + height * 0.5);
  target.area = clamp(width * height);
  target.aspect = bounded(width / Math.max(height, Number.EPSILON), 1, 0, maxAspect);
  target.confidence = clamp(confidence);
  target.leftId = leftId;
  target.rightId = rightId;
}

function cloneGeometry(geometry) {
  return {
    quad: geometry.quad.map((point) => ({ ...point })),
    bbox: { ...geometry.bbox },
    center: { ...geometry.center },
    area: geometry.area,
    aspect: geometry.aspect,
    confidence: geometry.confidence,
    leftId: geometry.leftId,
    rightId: geometry.rightId,
  };
}

function normalizeMode(mode, fallback) {
  return CONTENT_MODES.includes(mode) ? mode : fallback;
}

function normalizeConfirmationRule(rule) {
  return rule === 'hold-or-raised' || rule === 'raised-hand' || rule === 'body-signal'
    ? 'hold-or-raised'
    : 'hold';
}

/**
 * Pure, deterministic two-hand frame and stillness state machine.
 * `update()` reuses its returned frame, geometry and event records; consumers
 * that need retained diagnostics should call the intentionally allocating
 * `snapshot()` outside the render hot path.
 */
export function createGestureFrame(options = {}) {
  const config = options.config?.gestureFrame
    || options.config?.frame
    || options.config
    || options;
  const settings = Object.freeze({
    minArea: bounded(option(config, 'minArea', DEFAULTS.minArea), DEFAULTS.minArea, 0.06, 1),
    minConfidence: bounded(option(config, 'minConfidence', DEFAULTS.minConfidence), DEFAULTS.minConfidence, 0, 1),
    minBodyConfidence: bounded(option(config, 'minBodyConfidence', DEFAULTS.minBodyConfidence), DEFAULTS.minBodyConfidence, 0, 1),
    freshnessMs: bounded(option(config, 'freshnessMs', DEFAULTS.freshnessMs), DEFAULTS.freshnessMs, 0, 10_000),
    stableHoldMs: bounded(option(config, 'stableHoldMs', DEFAULTS.stableHoldMs), DEFAULTS.stableHoldMs, 0, 60_000),
    stabilityEnterDistance: bounded(option(config, 'stabilityEnterDistance', DEFAULTS.stabilityEnterDistance), DEFAULTS.stabilityEnterDistance, 0, 1),
    stabilityExitDistance: bounded(option(config, 'stabilityExitDistance', DEFAULTS.stabilityExitDistance), DEFAULTS.stabilityExitDistance, 0, 1),
    lossHoldMs: bounded(option(config, 'lossHoldMs', DEFAULTS.lossHoldMs), DEFAULTS.lossHoldMs, 0, 60_000),
    freezeMs: bounded(option(config, 'freezeMs', DEFAULTS.freezeMs), DEFAULTS.freezeMs, 0, 60_000),
    fadeMs: bounded(option(config, 'fadeMs', DEFAULTS.fadeMs), DEFAULTS.fadeMs, 0, 60_000),
    offMs: bounded(option(config, 'offMs', DEFAULTS.offMs), DEFAULTS.offMs, 0, 60_000),
    restoreMs: bounded(option(config, 'restoreMs', DEFAULTS.restoreMs), DEFAULTS.restoreMs, 0, 60_000),
    motionStill: bounded(option(config, 'motionStill', DEFAULTS.motionStill), DEFAULTS.motionStill, 0, 1),
    motionActivate: bounded(option(config, 'motionActivate', DEFAULTS.motionActivate), DEFAULTS.motionActivate, 0, 1),
    motionFullScale: bounded(option(config, 'motionFullScale', DEFAULTS.motionFullScale), DEFAULTS.motionFullScale, Number.EPSILON, 1),
    raisedHandMargin: bounded(option(config, 'raisedHandMargin', DEFAULTS.raisedHandMargin), DEFAULTS.raisedHandMargin, 0, 1),
    confirmationRule: normalizeConfirmationRule(option(config, 'confirmationRule', DEFAULTS.confirmationRule)),
    focalOpacity: bounded(option(config, 'focalOpacity', DEFAULTS.focalOpacity), DEFAULTS.focalOpacity, 0, 1),
    maxAspect: bounded(option(config, 'maxAspect', DEFAULTS.maxAspect), DEFAULTS.maxAspect, 1, 100),
  });

  if (settings.stabilityExitDistance < settings.stabilityEnterDistance) {
    throw new RangeError('gesture frame stabilityExitDistance must be >= stabilityEnterDistance');
  }
  if (settings.motionActivate < settings.motionStill) {
    throw new RangeError('gesture frame motionActivate must be >= motionStill');
  }
  if (settings.fadeMs < settings.freezeMs || settings.offMs < settings.fadeMs) {
    throw new RangeError('gesture frame timing must satisfy freezeMs <= fadeMs <= offMs');
  }

  const candidate = makeGeometry();
  const pairScratch = makeGeometry();
  const previousCandidate = makeGeometry();
  const armingReference = makeGeometry();
  const outputGeometry = makeGeometry();
  const eventPool = new Array(MAX_EVENTS);
  const events = [];
  for (let index = 0; index < MAX_EVENTS; index += 1) {
    eventPool[index] = { type: '', ts: 0, phase: '' };
  }

  const frame = {
    ts: 0,
    phase: 'searching',
    mode: normalizeMode(option(config, 'mode', options.mode), DEFAULTS.mode),
    quad: outputGeometry.quad,
    bbox: outputGeometry.bbox,
    center: outputGeometry.center,
    area: 0,
    aspect: 1,
    confidence: 0,
    motion: 0,
    stillness: 0,
    stillnessMs: 0,
    opacity: 0,
    energy: 0,
    valid: false,
    confirmed: false,
    locked: false,
    trackingLost: false,
    stableProgress: 0,
    events,
    eventCount: 0,
    intents: {
      ui: {
        phase: 'searching',
        showGuide: false,
        showProgress: false,
        progress: 0,
        trackingLost: false,
      },
      render: {
        mode: normalizeMode(option(config, 'mode', options.mode), DEFAULTS.mode),
        visible: false,
        preview: false,
        locked: false,
        updateGeometry: false,
        reveal: 0,
        opacity: 0,
        focalOpacity: 0,
        secondaryOpacity: 0,
        preserveFocal: false,
        paint: { accumulate: false },
        object: { updateCrop: false },
        promptShader: { animate: false, lockSeed: false },
        exerciseTarget: { evaluate: false, lockTarget: false },
      },
    },
  };

  let phase = 'searching';
  let mode = frame.mode;
  let destroyed = false;
  let confirmed = false;
  let hasCandidate = false;
  let hasPreviousCandidate = false;
  let armingAt = -Infinity;
  let stillSince = -Infinity;
  let lostAt = -Infinity;
  let lastTimestamp = 0;
  let moving = true;
  let offReason = '';
  let restoringAt = -Infinity;
  let restoreFromOpacity = 0;
  let opacity = 0;
  let energy = 0;

  function clearEvents() {
    events.length = 0;
    frame.eventCount = 0;
  }

  function emit(type, timestamp) {
    if (frame.eventCount >= MAX_EVENTS) return;
    const event = eventPool[frame.eventCount];
    event.type = type;
    event.ts = timestamp;
    event.phase = phase;
    events[frame.eventCount] = event;
    frame.eventCount += 1;
    events.length = frame.eventCount;
  }

  function transition(nextPhase, event, timestamp) {
    if (phase === nextPhase) return;
    phase = nextPhase;
    if (nextPhase !== 'off') offReason = '';
    if (event) emit(event, timestamp);
  }

  function handEligible(hand, trackingTimestamp, timestamp) {
    if (!hand || !Array.isArray(hand.landmarks)) return false;
    const thumb = hand.landmarks[THUMB_TIP];
    const index = hand.landmarks[INDEX_TIP];
    if (!validTip(thumb) || !validTip(index)) return false;
    const score = clamp(hand.score);
    if (score < settings.minConfidence) return false;
    if (!pointFresh(thumb, hand, trackingTimestamp, timestamp, settings.freshnessMs)) return false;
    if (!pointFresh(index, hand, trackingTimestamp, timestamp, settings.freshnessMs)) return false;
    const id = normalizedId(hand);
    return Boolean(id);
  }

  function deriveCandidate(tracking, timestamp) {
    const hands = Array.isArray(tracking?.hands) ? tracking.hands : null;
    if (!hands || hands.length < 2) return false;
    const trackingTimestamp = Number.isFinite(Number(tracking?.ts))
      ? Number(tracking.ts)
      : timestamp;
    if (timestamp - trackingTimestamp > settings.freshnessMs) return false;

    let bestConfidence = -1;
    let bestArea = -1;
    let bestLeftId = '';
    let bestRightId = '';
    let found = false;
    for (let first = 0; first < hands.length - 1; first += 1) {
      const handA = hands[first];
      if (!handEligible(handA, trackingTimestamp, timestamp)) continue;
      const handAId = normalizedId(handA);
      for (let second = first + 1; second < hands.length; second += 1) {
        const handB = hands[second];
        if (!handEligible(handB, trackingTimestamp, timestamp)) continue;
        const handBId = normalizedId(handB);
        if (handAId === handBId) continue;
        const thumbA = handA.landmarks[THUMB_TIP];
        const indexA = handA.landmarks[INDEX_TIP];
        const thumbB = handB.landmarks[THUMB_TIP];
        const indexB = handB.landmarks[INDEX_TIP];
        const confidence = Math.min(
          clamp(handA.score),
          clamp(handB.score),
          pointConfidence(thumbA),
          pointConfidence(indexA),
          pointConfidence(thumbB),
          pointConfidence(indexB),
        );
        if (confidence < settings.minConfidence) continue;
        buildGeometry(pairScratch, handA, handB, handAId, handBId, confidence, settings.maxAspect);
        if (pairScratch.area < settings.minArea) continue;
        const better = confidence > bestConfidence
          || (confidence === bestConfidence && pairScratch.area > bestArea)
          || (confidence === bestConfidence && pairScratch.area === bestArea
            && (pairScratch.leftId < bestLeftId
              || (pairScratch.leftId === bestLeftId && pairScratch.rightId < bestRightId)));
        if (!better) continue;
        copyGeometry(candidate, pairScratch);
        bestConfidence = confidence;
        bestArea = pairScratch.area;
        bestLeftId = pairScratch.leftId;
        bestRightId = pairScratch.rightId;
        found = true;
      }
    }
    return found;
  }

  function raisedHandSignal(input, tracking) {
    if (settings.confirmationRule !== 'hold-or-raised') return false;
    if (input?.raisedHand === true || input?.bodySignal === true || input?.confirmation === true) return true;
    const poses = Array.isArray(tracking?.poses) ? tracking.poses : null;
    if (!poses) return false;
    for (let index = 0; index < poses.length; index += 1) {
      const pose = poses[index];
      if (clamp(pose?.score) < settings.minBodyConfidence || !Array.isArray(pose?.landmarks)) continue;
      const leftShoulder = pose.landmarks[LEFT_SHOULDER];
      const rightShoulder = pose.landmarks[RIGHT_SHOULDER];
      const leftWrist = pose.landmarks[LEFT_WRIST];
      const rightWrist = pose.landmarks[RIGHT_WRIST];
      const leftRaised = validTip(leftShoulder) && validTip(leftWrist)
        && clamp(leftWrist.y) + settings.raisedHandMargin < clamp(leftShoulder.y);
      const rightRaised = validTip(rightShoulder) && validTip(rightWrist)
        && clamp(rightWrist.y) + settings.raisedHandMargin < clamp(rightShoulder.y);
      if (leftRaised || rightRaised) return true;
    }
    return false;
  }

  function beginArming(timestamp) {
    transition('arming', 'enter', timestamp);
    armingAt = timestamp;
    copyGeometry(armingReference, candidate);
    copyGeometry(outputGeometry, candidate);
  }

  function confirm(timestamp, motion) {
    confirmed = true;
    copyGeometry(outputGeometry, candidate);
    transition('live', 'confirm', timestamp);
    moving = motion >= settings.motionActivate;
    stillSince = motion <= settings.motionStill ? timestamp : -Infinity;
    lostAt = -Infinity;
    opacity = 1;
    energy = Math.max(energy, 0.25 + motion * 0.75);
  }

  function updateStillness(timestamp, motion) {
    if (motion >= settings.motionActivate) {
      moving = true;
      stillSince = -Infinity;
      if (phase === 'frozen' || phase === 'fading' || phase === 'off') {
        restoreFromOpacity = opacity;
        restoringAt = timestamp;
        transition('live', 'unfreeze', timestamp);
      }
      return;
    }
    if (motion <= settings.motionStill) {
      if (moving || !Number.isFinite(stillSince)) stillSince = timestamp;
      moving = false;
    }
    if (moving || !Number.isFinite(stillSince)) return;

    const held = Math.max(0, timestamp - stillSince);
    if (phase === 'live' && held >= settings.freezeMs) transition('frozen', 'freeze', timestamp);
    if (phase === 'frozen' && held >= settings.fadeMs) transition('fading', 'fade', timestamp);
    if (phase === 'fading' && held >= settings.offMs) {
      offReason = 'stillness';
      transition('off', 'off', timestamp);
    }
  }

  function updateOpacityAndEnergy(timestamp, deltaMs, motion) {
    let targetOpacity = 0;
    let targetEnergy = 0;
    let secondaryOpacity = 0;
    let focalOpacity = 0;

    if (phase === 'arming') {
      targetOpacity = 0.2 + frame.stableProgress * 0.35;
      targetEnergy = 0.08 + frame.stableProgress * 0.18;
      secondaryOpacity = targetOpacity;
      focalOpacity = targetOpacity;
    } else if (phase === 'live') {
      targetOpacity = 1;
      targetEnergy = 0.24 + motion * 0.76;
      secondaryOpacity = 1;
      focalOpacity = 1;
    } else if (phase === 'frozen') {
      targetOpacity = 1;
      targetEnergy = 0.18;
      secondaryOpacity = 1;
      focalOpacity = 1;
    } else if (phase === 'fading') {
      const range = Math.max(1, settings.offMs - settings.fadeMs);
      const fadeProgress = clamp((frame.stillnessMs - settings.fadeMs) / range);
      secondaryOpacity = 1 - fadeProgress;
      focalOpacity = 1 - fadeProgress * (1 - settings.focalOpacity);
      targetOpacity = focalOpacity;
      targetEnergy = 0.18 * (1 - fadeProgress);
    }

    if (phase === 'off') {
      opacity = 0;
      energy = 0;
      restoringAt = -Infinity;
    } else if (Number.isFinite(restoringAt)) {
      const progress = settings.restoreMs <= 0
        ? 1
        : clamp((timestamp - restoringAt) / settings.restoreMs);
      opacity = restoreFromOpacity + (targetOpacity - restoreFromOpacity) * progress;
      if (progress >= 1) restoringAt = -Infinity;
      const energyStep = settings.restoreMs <= 0 ? 1 : clamp(deltaMs / settings.restoreMs);
      energy += (targetEnergy - energy) * energyStep;
    } else {
      const opacityDuration = phase === 'fading'
        ? Math.max(1, settings.offMs - settings.fadeMs)
        : Math.max(1, settings.restoreMs);
      const opacityStep = clamp(deltaMs / opacityDuration);
      const energyStep = clamp(deltaMs / Math.max(1, settings.restoreMs));
      opacity += (targetOpacity - opacity) * opacityStep;
      energy += (targetEnergy - energy) * energyStep;
    }

    frame.opacity = clamp(opacity);
    frame.energy = clamp(energy);
    const render = frame.intents.render;
    render.opacity = frame.opacity;
    render.focalOpacity = phase === 'fading' ? clamp(focalOpacity) : frame.opacity;
    render.secondaryOpacity = phase === 'fading' ? clamp(secondaryOpacity) : frame.opacity;
  }

  function updateIntents() {
    const ui = frame.intents.ui;
    const render = frame.intents.render;
    const active = confirmed && phase !== 'off';
    ui.phase = phase;
    ui.showGuide = phase === 'arming';
    ui.showProgress = phase === 'arming';
    ui.progress = frame.stableProgress;
    ui.trackingLost = frame.trackingLost;

    render.mode = mode;
    render.visible = frame.opacity > 0 && (phase === 'arming' || active);
    render.preview = phase === 'arming';
    render.locked = phase === 'frozen' || phase === 'fading' || phase === 'off';
    render.updateGeometry = phase === 'arming' || phase === 'live';
    render.reveal = clamp(frame.opacity * (0.35 + frame.energy * 0.65));
    render.preserveFocal = phase === 'fading';
    render.paint.accumulate = active && mode === 'paint' && phase === 'live';
    render.object.updateCrop = active && mode === 'object' && phase === 'live';
    render.promptShader.animate = active && mode === 'prompt-shader' && phase === 'live';
    render.promptShader.lockSeed = mode === 'prompt-shader' && render.locked;
    render.exerciseTarget.evaluate = active && mode === 'exercise-target' && phase !== 'off';
    render.exerciseTarget.lockTarget = mode === 'exercise-target' && render.locked;
  }

  function publishGeometry() {
    frame.area = outputGeometry.area;
    frame.aspect = outputGeometry.aspect;
    frame.confidence = outputGeometry.confidence;
  }

  function update(input = {}) {
    clearEvents();
    if (destroyed) return frame;
    const tracking = input.tracking || input.trackingFrame || input;
    const requestedTimestamp = input.timestamp ?? input.ts ?? tracking?.ts;
    const timestamp = Math.max(lastTimestamp, finite(requestedTimestamp, lastTimestamp));
    const deltaMs = Math.max(0, timestamp - lastTimestamp);
    lastTimestamp = timestamp;
    frame.ts = timestamp;
    if (input.mode !== undefined) mode = normalizeMode(input.mode, mode);
    frame.mode = mode;

    hasCandidate = deriveCandidate(tracking, timestamp);
    let geometryMotion = 0;
    if (hasCandidate && hasPreviousCandidate) {
      geometryMotion = clamp(maximumPointDelta(candidate, previousCandidate) / settings.motionFullScale);
    }
    if (hasCandidate) {
      copyGeometry(previousCandidate, candidate);
      hasPreviousCandidate = true;
    }
    const suppliedMotion = Number.isFinite(Number(input.motion))
      ? Number(input.motion)
      : Number(tracking?.metrics?.motion);
    const handMotion = Number(tracking?.metrics?.handEnergy);
    const motion = clamp(Math.max(
      Number.isFinite(suppliedMotion) ? suppliedMotion : 0,
      Number.isFinite(handMotion) ? handMotion : 0,
      geometryMotion,
    ));
    frame.motion = motion;
    frame.valid = hasCandidate;

    if (!confirmed) {
      if (!hasCandidate) {
        if (phase === 'arming') transition('searching', '', timestamp);
        armingAt = -Infinity;
        frame.stableProgress = 0;
        clearGeometry(outputGeometry);
      } else if (phase === 'searching' || (phase === 'off' && offReason === 'loss')) {
        beginArming(timestamp);
      } else if (phase === 'arming') {
        const drift = maximumPointDelta(candidate, armingReference);
        if (drift > settings.stabilityExitDistance) {
          armingAt = timestamp;
          copyGeometry(armingReference, candidate);
        } else if (drift <= settings.stabilityEnterDistance) {
          // Recenter on bounded jitter so accumulated tracker noise cannot
          // eventually trip the wider exit threshold.
          copyGeometry(armingReference, candidate);
        }
        copyGeometry(outputGeometry, candidate);
      }

      if (phase === 'arming') {
        frame.stableProgress = settings.stableHoldMs <= 0
          ? 1
          : clamp((timestamp - armingAt) / settings.stableHoldMs);
        if (raisedHandSignal(input, tracking) || frame.stableProgress >= 1) confirm(timestamp, motion);
      }
    } else if (!hasCandidate) {
      if (!Number.isFinite(lostAt)) lostAt = timestamp;
      frame.trackingLost = true;
      if (timestamp - lostAt > settings.lossHoldMs && phase !== 'off') {
        offReason = 'loss';
        transition('off', 'off', timestamp);
        confirmed = false;
        hasPreviousCandidate = false;
        armingAt = -Infinity;
        stillSince = -Infinity;
      }
    } else {
      lostAt = -Infinity;
      frame.trackingLost = false;
      updateStillness(timestamp, motion);
      if (phase === 'live') copyGeometry(outputGeometry, candidate);
    }

    frame.phase = phase;
    frame.confirmed = confirmed;
    frame.locked = phase === 'frozen' || phase === 'fading' || phase === 'off';
    if (!frame.trackingLost) frame.trackingLost = confirmed && !hasCandidate;
    frame.stillnessMs = !moving && Number.isFinite(stillSince)
      ? Math.max(0, timestamp - stillSince)
      : 0;
    frame.stillness = settings.offMs <= 0 ? Number(!moving) : clamp(frame.stillnessMs / settings.offMs);
    if (!confirmed && phase === 'searching') {
      opacity = 0;
      energy = 0;
    }
    updateOpacityAndEnergy(timestamp, deltaMs, motion);
    updateIntents();
    publishGeometry();
    return frame;
  }

  function getFrame() {
    return frame;
  }

  function setMode(nextMode) {
    if (destroyed) return mode;
    mode = normalizeMode(nextMode, mode);
    frame.mode = mode;
    updateIntents();
    return mode;
  }

  function snapshot() {
    return {
      destroyed,
      ts: frame.ts,
      phase,
      mode,
      valid: frame.valid,
      confirmed,
      locked: frame.locked,
      trackingLost: frame.trackingLost,
      stableProgress: frame.stableProgress,
      motion: frame.motion,
      stillness: frame.stillness,
      stillnessMs: frame.stillnessMs,
      opacity: frame.opacity,
      energy: frame.energy,
      geometry: cloneGeometry(outputGeometry),
      events: events.map((event) => ({ ...event })),
      diagnostics: {
        armingAt: Number.isFinite(armingAt) ? armingAt : null,
        stillSince: Number.isFinite(stillSince) ? stillSince : null,
        lostAt: Number.isFinite(lostAt) ? lostAt : null,
        offReason,
        leftSourceId: outputGeometry.leftId,
        rightSourceId: outputGeometry.rightId,
        candidateFresh: hasCandidate,
      },
      settings: { ...settings },
    };
  }

  function reset(timestamp = 0) {
    if (destroyed) return frame;
    clearEvents();
    phase = 'searching';
    confirmed = false;
    hasCandidate = false;
    hasPreviousCandidate = false;
    armingAt = -Infinity;
    stillSince = -Infinity;
    lostAt = -Infinity;
    restoringAt = -Infinity;
    restoreFromOpacity = 0;
    moving = true;
    offReason = '';
    opacity = 0;
    energy = 0;
    lastTimestamp = Math.max(0, finite(timestamp));
    clearGeometry(candidate);
    clearGeometry(pairScratch);
    clearGeometry(previousCandidate);
    clearGeometry(armingReference);
    clearGeometry(outputGeometry);
    frame.ts = lastTimestamp;
    frame.phase = phase;
    frame.valid = false;
    frame.confirmed = false;
    frame.locked = false;
    frame.trackingLost = false;
    frame.stableProgress = 0;
    frame.motion = 0;
    frame.stillness = 0;
    frame.stillnessMs = 0;
    frame.opacity = 0;
    frame.energy = 0;
    publishGeometry();
    updateIntents();
    return frame;
  }

  function destroy() {
    if (destroyed) return;
    reset(lastTimestamp);
    destroyed = true;
    phase = 'off';
    frame.phase = phase;
    frame.locked = true;
    updateIntents();
  }

  return Object.freeze({
    update,
    getFrame,
    setMode,
    snapshot,
    reset,
    destroy,
  });
}

export { CONTENT_MODES, PHASES };
