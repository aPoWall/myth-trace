const FINGER_NAMES = Object.freeze(['thumb', 'index', 'middle', 'ring', 'pinky']);
const SIDE_NAMES = Object.freeze(['left', 'right']);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function requireNumber(source, key, min, max = Infinity) {
  const value = Number(source?.[key]);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`finger calibration ${key} must be finite in ${min}..${max}`);
  }
  return value;
}

function sideIndex(side) {
  return SIDE_NAMES.indexOf(String(side || '').toLowerCase());
}

function readConfig(config) {
  const source = config?.music?.fingerCalibration;
  if (!source || typeof source.storageKey !== 'string' || !source.storageKey) {
    throw new TypeError('createFingerCalibration requires CONFIG.music.fingerCalibration');
  }
  const durationMs = requireNumber(source, 'durationMs', 1);
  const timeoutMs = requireNumber(source, 'timeoutMs', durationMs);
  const minSamples = Math.round(requireNumber(source, 'minSamples', 2));
  const maxSamples = Math.round(requireNumber(source, 'maxSamples', minSamples));
  const baselineMin = requireNumber(source, 'baselineMin', 0, 1);
  const baselineMax = requireNumber(source, 'baselineMax', baselineMin, 1);
  return Object.freeze({
    storageKey: source.storageKey,
    schemaVersion: Math.round(requireNumber(source, 'schemaVersion', 1)),
    durationMs,
    timeoutMs,
    minSamples,
    maxSamples,
    minConfidence: requireNumber(source, 'minConfidence', 0, 1),
    maxMotion: requireNumber(source, 'maxMotion', 0, 1),
    minOpenness: requireNumber(source, 'minOpenness', 0, 1),
    maxNeutralCurl: requireNumber(source, 'maxNeutralCurl', 0, 1),
    maxStdDev: requireNumber(source, 'maxStdDev', 0, 1),
    deadband: requireNumber(source, 'deadband', 0, 0.49),
    baselineMin,
    baselineMax,
  });
}

function makeProfile() {
  return { present: false, neutral: new Float64Array(FINGER_NAMES.length), samples: 0, calibratedAt: 0 };
}

export function createFingerCalibration({
  config,
  storage = globalThis.localStorage,
  now = () => Date.now(),
} = {}) {
  const settings = readConfig(config);
  const profiles = [makeProfile(), makeProfile()];
  const sums = new Float64Array(FINGER_NAMES.length);
  const sumsSquared = new Float64Array(FINGER_NAMES.length);
  const sample = new Float64Array(FINGER_NAMES.length);

  let destroyed = false;
  let phase = 'idle';
  let pendingSide = -1;
  let startedAt = 0;
  let firstAcceptedAt = null;
  let lastAcceptedAt = null;
  let acceptedSamples = 0;
  let progress = 0;
  let revision = 0;
  let lastEvent = 'finger neutral · not calibrated';

  function resetAccumulator() {
    sums.fill(0);
    sumsSquared.fill(0);
    sample.fill(0);
    firstAcceptedAt = null;
    lastAcceptedAt = null;
    acceptedSamples = 0;
    progress = 0;
  }

  function readStoredProfile(candidate, target) {
    if (!candidate || !Array.isArray(candidate.neutral) || candidate.neutral.length !== FINGER_NAMES.length) return;
    const samples = Math.round(Number(candidate.samples));
    const calibratedAt = Number(candidate.calibratedAt);
    if (!Number.isFinite(samples) || samples < settings.minSamples || !Number.isFinite(calibratedAt) || calibratedAt < 0) return;
    for (let index = 0; index < FINGER_NAMES.length; index += 1) {
      const value = Number(candidate.neutral[index]);
      if (!Number.isFinite(value) || value < settings.baselineMin || value > settings.baselineMax) return;
      sample[index] = value;
    }
    target.neutral.set(sample);
    target.samples = samples;
    target.calibratedAt = calibratedAt;
    target.present = true;
  }

  function restore() {
    try {
      const parsed = JSON.parse(storage?.getItem?.(settings.storageKey) || 'null');
      if (!parsed || Number(parsed.version) !== settings.schemaVersion) return;
      readStoredProfile(parsed.left, profiles[0]);
      readStoredProfile(parsed.right, profiles[1]);
      if (profiles[0].present || profiles[1].present) {
        revision += 1;
        const saved = profiles[0].present && profiles[1].present ? 'both hands' : profiles[0].present ? 'left hand' : 'right hand';
        lastEvent = `finger neutral restored · ${saved}`;
      }
    } catch { /* malformed or unavailable local storage stays empty */ }
    sample.fill(0);
  }

  function plainProfile(profile) {
    if (!profile.present) return null;
    return {
      neutral: Array.from(profile.neutral, (value) => Number(value.toFixed(6))),
      samples: profile.samples,
      calibratedAt: profile.calibratedAt,
    };
  }

  function persist() {
    try {
      if (!profiles[0].present && !profiles[1].present) {
        storage?.removeItem?.(settings.storageKey);
        return;
      }
      storage?.setItem?.(settings.storageKey, JSON.stringify({
        version: settings.schemaVersion,
        left: plainProfile(profiles[0]),
        right: plainProfile(profiles[1]),
      }));
    } catch { /* in-memory calibration remains usable */ }
  }

  function retry(message) {
    phase = 'retry';
    pendingSide = -1;
    progress = 0;
    lastEvent = message;
    resetAccumulator();
  }

  function expire(timestamp) {
    if (pendingSide < 0) return false;
    if (timestamp - startedAt < settings.timeoutMs) return false;
    retry(`finger neutral retry · ${SIDE_NAMES[pendingSide]} hand was not stable`);
    return true;
  }

  function start(side, timestamp = now()) {
    if (destroyed) return getState(timestamp);
    const index = sideIndex(side);
    if (index < 0) throw new TypeError('finger calibration side must be left or right');
    resetAccumulator();
    pendingSide = index;
    startedAt = Math.max(0, finite(timestamp, now()));
    phase = 'waiting';
    lastEvent = `finger neutral · hold ${SIDE_NAMES[index]} hand open and still`;
    return getState(startedAt);
  }

  function validSample(hand) {
    if (!hand || hand.active !== true) {
      lastEvent = `finger neutral · waiting for live ${SIDE_NAMES[pendingSide]} hand`;
      return false;
    }
    if (finite(hand.confidence) < settings.minConfidence) {
      lastEvent = 'finger neutral · raise hand confidence';
      return false;
    }
    if (finite(hand.motion) > settings.maxMotion) {
      lastEvent = 'finger neutral · hold the hand still';
      return false;
    }
    if (finite(hand.openness) < settings.minOpenness) {
      lastEvent = 'finger neutral · open all five fingers';
      return false;
    }
    for (let index = 0; index < FINGER_NAMES.length; index += 1) {
      const value = Number(hand.curls?.[FINGER_NAMES[index]]);
      if (!Number.isFinite(value) || value < 0 || value > settings.maxNeutralCurl) {
        lastEvent = 'finger neutral · relax and open all five fingers';
        return false;
      }
      sample[index] = value;
    }
    return true;
  }

  function finish(timestamp) {
    const target = profiles[pendingSide];
    for (let index = 0; index < FINGER_NAMES.length; index += 1) {
      const mean = sums[index] / acceptedSamples;
      const variance = Math.max(0, sumsSquared[index] / acceptedSamples - mean * mean);
      if (Math.sqrt(variance) > settings.maxStdDev) {
        retry(`finger neutral retry · ${SIDE_NAMES[pendingSide]} hand varied too much`);
        return false;
      }
      sample[index] = clamp(mean, settings.baselineMin, settings.baselineMax);
    }
    const acceptedSide = pendingSide;
    target.neutral.set(sample);
    target.samples = acceptedSamples;
    target.calibratedAt = Math.max(0, finite(timestamp, now()));
    target.present = true;
    revision += 1;
    phase = 'accepted';
    pendingSide = -1;
    progress = 1;
    lastEvent = `finger neutral saved · ${SIDE_NAMES[acceptedSide]} · ${acceptedSamples} samples`;
    persist();
    resetAccumulator();
    progress = 1;
    return true;
  }

  function update({ timestamp = now(), hands = null } = {}) {
    if (destroyed || pendingSide < 0) return false;
    const updateAt = Math.max(0, finite(timestamp, now()));
    if (expire(updateAt)) return false;
    const hand = hands?.[SIDE_NAMES[pendingSide]];
    if (!validSample(hand)) {
      phase = 'waiting';
      return false;
    }
    phase = 'sampling';
    if (firstAcceptedAt === null) firstAcceptedAt = updateAt;
    lastAcceptedAt = updateAt;
    if (acceptedSamples < settings.maxSamples) {
      acceptedSamples += 1;
      for (let index = 0; index < FINGER_NAMES.length; index += 1) {
        sums[index] += sample[index];
        sumsSquared[index] += sample[index] * sample[index];
      }
    }
    const coverage = updateAt - firstAcceptedAt;
    progress = Math.min(
      1,
      Math.min(coverage / settings.durationMs, acceptedSamples / settings.minSamples),
    );
    lastEvent = `finger neutral sampling · ${SIDE_NAMES[pendingSide]} · ${Math.round(progress * 100)}%`;
    if (coverage >= settings.durationMs && acceptedSamples >= settings.minSamples) return finish(updateAt);
    return false;
  }

  function normalize(raw, profile, index) {
    const value = clamp(raw);
    if (!profile.present) return value;
    const neutral = profile.neutral[index];
    const denominator = Math.max(Number.EPSILON, 1 - neutral - settings.deadband);
    return clamp((value - neutral - settings.deadband) / denominator);
  }

  function apply(range) {
    if (!range?.curls || !range?.hands) return range;
    let activeCount = 0;
    sample.fill(0);
    for (let side = 0; side < SIDE_NAMES.length; side += 1) {
      const hand = range.hands[SIDE_NAMES[side]];
      if (!hand?.active) continue;
      activeCount += 1;
      for (let index = 0; index < FINGER_NAMES.length; index += 1) {
        const finger = FINGER_NAMES[index];
        const normalized = normalize(hand.curls?.[finger], profiles[side], index);
        hand.curls[finger] = normalized;
        sample[index] += normalized;
      }
    }
    if (!activeCount) return range;
    for (let index = 0; index < FINGER_NAMES.length; index += 1) {
      range.curls[FINGER_NAMES[index]] = clamp(sample[index] / activeCount);
    }
    return range;
  }

  function isActive() {
    return !destroyed && pendingSide >= 0;
  }

  function clear(side = 'both') {
    if (destroyed) return getState();
    const normalized = String(side || '').toLowerCase();
    if (normalized !== 'both' && sideIndex(normalized) < 0) {
      throw new TypeError('finger calibration clear side must be left, right or both');
    }
    if (normalized === 'both') {
      profiles[0] = makeProfile();
      profiles[1] = makeProfile();
      pendingSide = -1;
      resetAccumulator();
    } else {
      const index = sideIndex(normalized);
      profiles[index] = makeProfile();
      if (pendingSide === index) {
        pendingSide = -1;
        resetAccumulator();
      }
    }
    revision += 1;
    phase = 'idle';
    lastEvent = normalized === 'both' ? 'finger neutral reset · both hands raw' : `finger neutral reset · ${normalized} hand raw`;
    persist();
    return getState();
  }

  function stateProfile(profile) {
    return Object.freeze({
      saved: profile.present,
      neutral: Object.freeze(Object.fromEntries(FINGER_NAMES.map((name, index) => [
        name,
        profile.present ? profile.neutral[index] : 0,
      ]))),
      samples: profile.samples,
      calibratedAt: profile.calibratedAt,
    });
  }

  function getState(timestamp = now()) {
    const readAt = Math.max(0, finite(timestamp, now()));
    if (!destroyed) expire(readAt);
    return Object.freeze({
      destroyed,
      phase,
      active: pendingSide >= 0,
      side: pendingSide >= 0 ? SIDE_NAMES[pendingSide] : '',
      progress,
      acceptedSamples,
      startedAt: pendingSide >= 0 ? startedAt : 0,
      firstAcceptedAt,
      lastAcceptedAt,
      revision,
      lastEvent,
      profiles: Object.freeze({
        left: stateProfile(profiles[0]),
        right: stateProfile(profiles[1]),
      }),
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    pendingSide = -1;
    resetAccumulator();
    phase = 'idle';
    lastEvent = 'finger calibration destroyed';
  }

  restore();
  return Object.freeze({ start, update, isActive, apply, clear, getState, destroy });
}
