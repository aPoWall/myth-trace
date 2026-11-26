function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function distance(a, b) {
  return Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.y) - finite(b?.y));
}

function diagonal(box) {
  return Math.hypot(finite(box?.w), finite(box?.h));
}

function readConfig(config) {
  const source = config?.tracking?.handIdentity;
  if (!source) throw new TypeError('matchHandCandidates requires CONFIG.tracking.handIdentity');
  const predictionMs = finite(source.predictionMs, -1);
  const distanceScale = finite(source.distanceScale, -1);
  const mismatchPenalty = finite(source.mismatchPenalty, -1);
  const sizePenalty = finite(source.sizePenalty, -1);
  if (predictionMs < 0 || distanceScale < 1 || mismatchPenalty < 0 || sizePenalty < 0) {
    throw new TypeError('hand identity settings are outside their bounded range');
  }
  return { predictionMs, distanceScale, mismatchPenalty, sizePenalty };
}

function predictedCenter(track, timestamp, predictionMs) {
  const elapsedMs = clamp(finite(timestamp) - finite(track?.lastSeen), 0, predictionMs);
  const elapsedSeconds = elapsedMs / 1000;
  return {
    x: clamp(finite(track?.center?.x) + finite(track?.identityVelocityX ?? track?.velocityX) * elapsedSeconds),
    y: clamp(finite(track?.center?.y) + finite(track?.identityVelocityY ?? track?.velocityY) * elapsedSeconds),
  };
}

function pairCost(candidate, track, timestamp, identity, ema) {
  const predicted = predictedCenter(track, timestamp, identity.predictionMs);
  const motionDistance = distance(candidate?.center, predicted);
  const candidateSize = diagonal(candidate?.bbox);
  const trackSize = diagonal(track?.bbox);
  const gate = Math.max(ema, candidateSize, trackSize) * identity.distanceScale;
  if (motionDistance > gate) return Infinity;
  const knownMismatch = candidate?.handedness !== 'Unknown'
    && track?.handedness !== 'Unknown'
    && candidate.handedness !== track.handedness;
  const handednessCost = knownMismatch
    ? identity.mismatchPenalty * clamp(candidate?.handednessScore ?? candidate?.score)
    : 0;
  const sizeCost = Math.abs(candidateSize - trackSize) * identity.sizePenalty;
  return motionDistance + handednessCost + sizeCost;
}

export function matchHandCandidates(candidates, tracks, timestamp, config) {
  const identity = readConfig(config);
  const ema = Math.max(0.001, finite(config?.tracking?.ema, 0.36));
  const costs = candidates.map((candidate) => (
    tracks.map((track) => pairCost(candidate, track, timestamp, identity, ema))
  ));
  let bestMatches = new Map();
  let bestCount = -1;
  let bestCost = Infinity;
  const current = new Map();
  const used = new Set();

  function visit(candidateIndex, totalCost) {
    if (candidateIndex >= candidates.length) {
      const count = current.size;
      if (count > bestCount || (count === bestCount && totalCost < bestCost)) {
        bestMatches = new Map(current);
        bestCount = count;
        bestCost = totalCost;
      }
      return;
    }
    visit(candidateIndex + 1, totalCost);
    for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
      if (used.has(trackIndex) || !Number.isFinite(costs[candidateIndex]?.[trackIndex])) continue;
      used.add(trackIndex);
      current.set(candidateIndex, tracks[trackIndex]);
      visit(candidateIndex + 1, totalCost + costs[candidateIndex][trackIndex]);
      current.delete(candidateIndex);
      used.delete(trackIndex);
    }
  }

  visit(0, 0);
  return bestMatches;
}
