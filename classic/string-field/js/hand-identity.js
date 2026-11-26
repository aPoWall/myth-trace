// Motion and size establish continuity. Handedness is secondary evidence
// because the classifier can flip as a hand turns through the camera plane.
function pairingCost(candidate, track, timestamp, settings) {
  const elapsed = Math.min(settings.predictionMs, Math.max(0, timestamp - track.seen)) / 1000;
  const x = track.center.x + track.velocity.x * elapsed;
  const y = track.center.y + track.velocity.y * elapsed;
  const distance = Math.hypot(candidate.center.x - x, candidate.center.y - y);
  const gate = Math.max(candidate.size, track.size, Number.EPSILON) * settings.distanceScale;
  if (distance > gate) return Infinity;

  const disagreement = candidate.side !== 'Unknown' && track.side !== 'Unknown' &&
    candidate.side !== track.side;
  const sideCost = disagreement ? (candidate.confidence ?? 0) *
    Math.min(settings.mismatchPenalty, distance * .45 + gate * .02) : 0;
  return distance + sideCost + Math.abs(candidate.size - track.size) * settings.sizePenalty;
}

export function matchHands(candidates, tracks, timestamp, settings) {
  const costs = candidates.map((candidate) => tracks.map((track) => pairingCost(candidate, track, timestamp, settings)));
  const current = new Array(candidates.length).fill(-1);
  let best = current.slice();
  let bestCount = -1;
  let bestCost = Infinity;

  // At most four hands. Choose the minimum-cost full assignment rather than a
  // greedy nearest neighbor that depends on the detector's result ordering.
  function search(index, used, count, cost) {
    if (index === candidates.length) {
      if (count > bestCount || (count === bestCount && cost < bestCost)) {
        best = current.slice();
        bestCount = count;
        bestCost = cost;
      }
      return;
    }
    const row = costs[index];
    for (let i = 0; i < tracks.length; i++) {
      const bit = 1 << i;
      if ((used & bit) || !Number.isFinite(row[i])) continue;
      current[index] = i;
      search(index + 1, used | bit, count + 1, cost + row[i]);
    }
    current[index] = -1;
    search(index + 1, used, count, cost);
  }

  search(0, 0, 0, 0);
  return best.map((index) => tracks[index] ?? null);
}
