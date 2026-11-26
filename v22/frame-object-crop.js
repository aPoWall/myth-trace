const DEFAULTS = Object.freeze({
  holdMs: 420,
  minScore: 0.42,
  padding: 0.08,
});

const LOCKED_PHASES = Object.freeze(['frozen', 'fading', 'off']);
const EDGE_EPSILON = 1e-9;

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

function boxWidth(box) {
  return Number(box?.w ?? box?.width);
}

function boxHeight(box) {
  return Number(box?.h ?? box?.height);
}

function validBox(box) {
  const x = Number(box?.x);
  const y = Number(box?.y);
  const width = boxWidth(box);
  const height = boxHeight(box);
  if (!Number.isFinite(x) || !Number.isFinite(y)
    || !Number.isFinite(width) || !Number.isFinite(height)
    || width <= 0 || height <= 0) return false;
  return Math.min(1, x + width) > Math.max(0, x)
    && Math.min(1, y + height) > Math.max(0, y);
}

function writeNormalizedBox(target, box, padding) {
  if (!validBox(box)) return false;
  const x = Number(box.x);
  const y = Number(box.y);
  const rawWidth = boxWidth(box);
  const rawHeight = boxHeight(box);
  const left = clamp(x);
  const top = clamp(y);
  const right = clamp(x + rawWidth);
  const bottom = clamp(y + rawHeight);
  const width = right - left;
  const height = bottom - top;
  const padX = width * padding;
  const padY = height * padding;
  const paddedLeft = clamp(left - padX);
  const paddedTop = clamp(top - padY);
  const paddedRight = clamp(right + padX);
  const paddedBottom = clamp(bottom + padY);
  target.x = paddedLeft;
  target.y = paddedTop;
  target.w = paddedRight - paddedLeft;
  target.h = paddedBottom - paddedTop;
  return target.w > 0 && target.h > 0;
}

function copyBox(target, source) {
  target.x = source.x;
  target.y = source.y;
  target.w = source.w;
  target.h = source.h;
}

function clearBox(box) {
  box.x = 0;
  box.y = 0;
  box.w = 0;
  box.h = 0;
}

function pointOnSegment(x, y, ax, ay, bx, by) {
  const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
  if (Math.abs(cross) > EDGE_EPSILON) return false;
  return x >= Math.min(ax, bx) - EDGE_EPSILON
    && x <= Math.max(ax, bx) + EDGE_EPSILON
    && y >= Math.min(ay, by) - EDGE_EPSILON
    && y <= Math.max(ay, by) + EDGE_EPSILON;
}

function validQuad(quad) {
  if (!Array.isArray(quad) || quad.length < 3) return false;
  let twiceArea = 0;
  for (let index = 0, previous = quad.length - 1; index < quad.length; previous = index, index += 1) {
    const a = quad[previous];
    const b = quad[index];
    const ax = Number(a?.x);
    const ay = Number(a?.y);
    const bx = Number(b?.x);
    const by = Number(b?.y);
    if (!Number.isFinite(ax) || !Number.isFinite(ay)
      || !Number.isFinite(bx) || !Number.isFinite(by)) return false;
    twiceArea += ax * by - bx * ay;
  }
  return Math.abs(twiceArea) > EDGE_EPSILON;
}

function pointInQuadXY(x, y, quad) {
  let inside = false;
  for (let index = 0, previous = quad.length - 1; index < quad.length; previous = index, index += 1) {
    const a = quad[previous];
    const b = quad[index];
    const ax = Number(a.x);
    const ay = Number(a.y);
    const bx = Number(b.x);
    const by = Number(b.y);
    if (pointOnSegment(x, y, ax, ay, bx, by)) return true;
    const crosses = (ay > y) !== (by > y)
      && x < ((bx - ax) * (y - ay)) / (by - ay) + ax;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Return true for a finite point inside, or on the edge of, a finite polygon. */
export function pointInQuad(point, quad) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !validQuad(quad)) return false;
  return pointInQuadXY(x, y, quad);
}

function pointInBox(x, y, box) {
  if (!validBox(box)) return false;
  const left = clamp(Number(box.x));
  const top = clamp(Number(box.y));
  const right = clamp(Number(box.x) + boxWidth(box));
  const bottom = clamp(Number(box.y) + boxHeight(box));
  return x >= left && x <= right && y >= top && y <= bottom;
}

function centerInFrame(x, y, frame) {
  if (validQuad(frame?.quad)) return pointInQuadXY(x, y, frame.quad);
  return pointInBox(x, y, frame?.bbox);
}

function equalClass(label, configured) {
  if (typeof label !== 'string' || typeof configured !== 'string') return false;
  let start = 0;
  let end = configured.length;
  while (start < end && configured.charCodeAt(start) <= 32) start += 1;
  while (end > start && configured.charCodeAt(end - 1) <= 32) end -= 1;
  if (label.length !== end - start) return false;
  for (let index = 0; index < label.length; index += 1) {
    let left = label.charCodeAt(index);
    let right = configured.charCodeAt(start + index);
    if (left >= 65 && left <= 90) left += 32;
    if (right >= 65 && right <= 90) right += 32;
    if (left !== right) return false;
  }
  return true;
}

function normalizedClass(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedArea(box) {
  if (!validBox(box)) return 0;
  const left = clamp(Number(box.x));
  const top = clamp(Number(box.y));
  const right = clamp(Number(box.x) + boxWidth(box));
  const bottom = clamp(Number(box.y) + boxHeight(box));
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function sourceKindFor(candidate, fallback = 'object') {
  const value = String(candidate?.sourceKind || fallback).trim().toLowerCase();
  return value === 'pose' || value === 'face' || value === 'object' || value === 'roi' ? value : fallback;
}

function focusSourceFor(content) {
  const value = String(content?.focusSource || '').trim().toLowerCase();
  return value === 'person' || value === 'face' || value === 'object' || value === 'roi' ? value : '';
}

function matchesFocusSource(candidate, source) {
  if (!source) return true;
  const kind = sourceKindFor(candidate);
  const label = String(candidate?.label || '').trim().toLowerCase();
  if (source === 'person') return kind === 'pose' && label === 'person';
  if (source === 'face') return kind === 'face' && label === 'face';
  if (source === 'roi') return kind === 'roi';
  return kind === 'object';
}

function finiteFocusSettings(input, content, defaults) {
  const settings = input?.focus && typeof input.focus === 'object'
    ? input.focus
    : content?.focus && typeof content.focus === 'object'
      ? content.focus
      : defaults;
  const scale = Number(settings?.edgeScale);
  const offset = Number(settings?.edgeOffset);
  if (!Number.isFinite(scale) || !Number.isFinite(offset) || scale <= 0 || scale >= 1) return null;
  return { edgeScale: scale, edgeOffset: clamp(offset) };
}

function writeFaceEdgeBox(target, box, settings) {
  if (!settings || !validBox(box)) return false;
  const width = boxWidth(box) * settings.edgeScale;
  const x = Number(box.x) + (boxWidth(box) - width) * settings.edgeOffset;
  return writeNormalizedBox(target, { x, y: box.y, w: width, h: boxHeight(box) }, 0);
}

function focalPolicyFor(content) {
  const policy = String(content?.focalPolicy || 'frame');
  return policy === 'largest-object' || policy === 'body' ? policy : 'frame';
}

function matchesConfiguredClass(label, configuredClass) {
  return !configuredClass || equalClass(label, configuredClass);
}

function candidatePriority(policy, label, matchesClass) {
  if (policy === 'body') {
    if (equalClass(label, 'person')) return 2;
    return matchesClass ? 1 : 0;
  }
  return matchesClass ? 1 : 0;
}

function candidateBeats(
  policy,
  candidatePriorityValue,
  candidateScore,
  candidateArea,
  candidateId,
  bestPriorityValue,
  bestScore,
  bestArea,
  bestId,
  selectedId,
) {
  if (candidatePriorityValue !== bestPriorityValue) return candidatePriorityValue > bestPriorityValue;
  if (policy === 'largest-object') {
    if (Math.abs(candidateArea - bestArea) > EDGE_EPSILON) return candidateArea > bestArea;
    if (Math.abs(candidateScore - bestScore) > EDGE_EPSILON) return candidateScore > bestScore;
    return candidateId < bestId;
  }
  if (Math.abs(candidateScore - bestScore) > EDGE_EPSILON) return candidateScore > bestScore;
  const candidateIsSelected = candidateId === selectedId;
  const bestIsSelected = bestId === selectedId;
  if (candidateIsSelected !== bestIsSelected) return candidateIsSelected;
  return candidateId < bestId;
}

function phaseFor(frame) {
  const phase = String(frame?.phase || 'searching');
  return phase === 'arming' || phase === 'live' || LOCKED_PHASES.includes(phase)
    ? phase
    : 'searching';
}

/**
 * Select and retain one tracked-object crop for a committed gesture frame.
 * The returned state and all of its boxes are reused by every update.
 */
export function createFrameObjectCrop(options = {}) {
  const holdMs = bounded(options.holdMs, DEFAULTS.holdMs, 0, 60_000);
  const minScore = bounded(options.minScore, DEFAULTS.minScore, 0, 1);
  // Padding is a fraction of the detected box size on every side.
  const padding = bounded(options.padding, DEFAULTS.padding, 0, 1);
  const defaultFocus = options.focus && typeof options.focus === 'object' ? options.focus : null;

  const displayBBox = { x: 0, y: 0, w: 0, h: 0 };
  const sourceBBox = { x: 0, y: 0, w: 0, h: 0 };
  const cameraSourceBBox = { x: 0, y: 0, w: 0, h: 0 };
  const candidateBox = { x: 0, y: 0, w: 0, h: 0 };
  const bestBox = { x: 0, y: 0, w: 0, h: 0 };
  const selectedBox = { x: 0, y: 0, w: 0, h: 0 };
  const authorRoiCandidate = {
    id: 'roi:hand-frame', label: 'author ROI', sourceKind: 'roi', score: 1,
    bbox: { x: 0, y: 0, w: 0, h: 0 }, lastSeen: 0,
  };

  const state = {
    timestamp: 0,
    active: false,
    valid: false,
    held: false,
    locked: false,
    phase: 'searching',
    objectId: '',
    objectClass: '',
    sourceKind: 'object',
    mirrored: false,
    focusDetail: 'whole',
    score: 0,
    displayBBox,
    bbox: displayBBox,
    sourceBBox,
    cameraSourceBBox,
    lastSeen: 0,
    missingMs: 0,
  };

  let destroyed = false;
  let lastTimestamp = 0;

  function clearSelection() {
    state.active = false;
    state.valid = false;
    state.held = false;
    state.objectId = '';
    state.objectClass = '';
    state.sourceKind = 'object';
    state.mirrored = false;
    state.focusDetail = 'whole';
    state.score = 0;
    state.lastSeen = 0;
    state.missingMs = 0;
    clearBox(displayBBox);
    clearBox(sourceBBox);
    clearBox(cameraSourceBBox);
  }

  function updateSourceBoxes(camera) {
    const mirrored = camera?.mirrored === true;
    state.mirrored = mirrored;
    sourceBBox.x = mirrored ? clamp(1 - displayBBox.x - displayBBox.w) : displayBBox.x;
    sourceBBox.y = displayBBox.y;
    sourceBBox.w = displayBBox.w;
    sourceBBox.h = displayBBox.h;

    const width = Math.max(0, finite(camera?.width));
    const height = Math.max(0, finite(camera?.height));
    cameraSourceBBox.x = sourceBBox.x * width;
    cameraSourceBBox.y = sourceBBox.y * height;
    cameraSourceBBox.w = sourceBBox.w * width;
    cameraSourceBBox.h = sourceBBox.h * height;
  }

  function select(id, label, sourceKind, score, box, timestamp, observedAt, camera, focusDetail = 'whole') {
    state.active = true;
    state.valid = true;
    state.objectId = id;
    state.objectClass = label;
    state.sourceKind = sourceKind;
    state.focusDetail = focusDetail;
    state.score = score;
    state.lastSeen = observedAt;
    state.missingMs = Math.max(0, timestamp - observedAt);
    state.held = state.missingMs > 0;
    copyBox(displayBBox, box);
    updateSourceBoxes(camera);
  }

  function update(input = {}) {
    if (destroyed) return state;
    const timestamp = Math.max(lastTimestamp, finite(input.timestamp, lastTimestamp));
    lastTimestamp = timestamp;
    state.timestamp = timestamp;
    const frame = input.frame;
    const content = input.content;
    const camera = input.camera;
    const phase = phaseFor(frame);
    const locked = Boolean(frame?.locked) || LOCKED_PHASES.includes(phase);
    state.phase = phase;
    state.locked = locked;

    if (locked) return state;

    const configuredClass = normalizedClass(content?.objectClass);
    const focalPolicy = focalPolicyFor(content);
    const focusSource = focusSourceFor(content);
    const wantsFaceEdge = focusSource === 'face' && content?.focusDetail === 'face-edge';
    const faceEdge = wantsFaceEdge ? finiteFocusSettings(input, content, defaultFocus) : null;
    const canAcquire = frame?.confirmed === true
      && phase === 'live'
      && content?.object?.updateCrop === true;
    const candidates = Array.isArray(input.candidates)
      ? input.candidates
      : Array.isArray(input.objects)
        ? input.objects
        : null;
    const usesFocusCandidates = Array.isArray(input.candidates);
    const usesAuthorRoi = canAcquire && focusSource === 'roi' && validBox(frame?.bbox);
    const candidateCount = candidates?.length || 0;
    if (usesAuthorRoi) {
      authorRoiCandidate.bbox.x = Number(frame.bbox.x);
      authorRoiCandidate.bbox.y = Number(frame.bbox.y);
      authorRoiCandidate.bbox.w = boxWidth(frame.bbox);
      authorRoiCandidate.bbox.h = boxHeight(frame.bbox);
      authorRoiCandidate.lastSeen = timestamp;
    }

    let bestId = '';
    let bestLabel = '';
    let bestSourceKind = 'object';
    let bestScore = -1;
    let bestArea = 0;
    let bestPriorityValue = 0;
    let bestSeenAt = 0;
    let selectedFound = false;
    let selectedScore = -1;
    let selectedArea = 0;
    let selectedPriorityValue = 0;
    let selectedLabel = '';
    let selectedSourceKind = 'object';
    let selectedSeenAt = 0;

    if (canAcquire && (candidates || usesAuthorRoi)) {
      for (let index = 0; index < candidateCount + (usesAuthorRoi ? 1 : 0); index += 1) {
        const candidate = index === candidateCount ? authorRoiCandidate : candidates[index];
        const id = candidate?.id;
        const label = candidate?.label;
        const sourceKind = sourceKindFor(candidate);
        const score = Number(candidate?.score);
        if (typeof id !== 'string' || !id) continue;
        if (!Number.isFinite(score) || score < minScore || !validBox(candidate?.bbox)) continue;
        if (usesFocusCandidates && !matchesFocusSource(candidate, focusSource)) continue;
        const matchesClass = matchesConfiguredClass(label, configuredClass);
        const priority = sourceKind === 'roi'
          ? 1
          : usesFocusCandidates
          ? 1
          : candidatePriority(focalPolicy, label, matchesClass);
        if (priority === 0) continue;
        const rawX = Number(candidate.bbox.x);
        const rawY = Number(candidate.bbox.y);
        const rawWidth = boxWidth(candidate.bbox);
        const rawHeight = boxHeight(candidate.bbox);
        const rawLastSeen = Number(candidate.lastSeen);
        const observedAt = Number.isFinite(rawLastSeen)
          ? Math.min(timestamp, Math.max(0, rawLastSeen))
          : timestamp;
        if (timestamp - observedAt > holdMs) continue;
        const centerX = clamp(rawX + rawWidth * 0.5);
        const centerY = clamp(rawY + rawHeight * 0.5);
        if (!centerInFrame(centerX, centerY, frame)) continue;
        const appliesFaceEdge = wantsFaceEdge && sourceKind === 'face' && Boolean(faceEdge);
        if (appliesFaceEdge) {
          if (!writeFaceEdgeBox(candidateBox, candidate.bbox, faceEdge)) continue;
        } else if (!writeNormalizedBox(candidateBox, candidate.bbox, sourceKind === 'roi' ? 0 : padding)) continue;
        const area = normalizedArea(candidate.bbox);

        if (state.active && id === state.objectId) {
          selectedFound = true;
          selectedScore = score;
          selectedArea = area;
          selectedPriorityValue = priority;
          selectedLabel = label;
          selectedSourceKind = sourceKind;
          selectedSeenAt = observedAt;
          copyBox(selectedBox, candidateBox);
        }
        const better = !bestId || candidateBeats(
          focalPolicy,
          priority,
          score,
          area,
          id,
          bestPriorityValue,
          bestScore,
          bestArea,
          bestId,
          state.objectId,
        );
        if (!better) continue;
        bestId = id;
        bestLabel = label;
        bestSourceKind = sourceKind;
        bestScore = score;
        bestArea = area;
        bestPriorityValue = priority;
        bestSeenAt = observedAt;
        copyBox(bestBox, candidateBox);
      }
    }

    if (state.active) {
      state.missingMs = Math.max(0, timestamp - state.lastSeen);
      // A held crop may outlive a camera mirror or resolution change. Recompute
      // the raw source box from the one stored display box, never from itself.
      updateSourceBoxes(camera);
      if (selectedFound) {
        const replacesSelection = bestId !== state.objectId && candidateBeats(
          focalPolicy,
          bestPriorityValue,
          bestScore,
          bestArea,
          bestId,
          selectedPriorityValue,
          selectedScore,
          selectedArea,
          state.objectId,
          state.objectId,
        );
        if (bestId && replacesSelection) {
          select(bestId, bestLabel, bestSourceKind, bestScore, bestBox, timestamp, bestSeenAt, camera,
            wantsFaceEdge && bestSourceKind === 'face' && faceEdge ? 'face-edge' : 'whole');
        } else {
          select(
            state.objectId,
            selectedLabel,
            selectedSourceKind,
            selectedScore,
            selectedBox,
            timestamp,
            selectedSeenAt,
            camera,
          );
        }
        return state;
      }

      state.held = state.missingMs < holdMs;
      if (state.held) return state;
      if (canAcquire && bestId) {
          select(bestId, bestLabel, bestSourceKind, bestScore, bestBox, timestamp, bestSeenAt, camera,
            wantsFaceEdge && bestSourceKind === 'face' && faceEdge ? 'face-edge' : 'whole');
        return state;
      }
      clearSelection();
      return state;
    }

    if (canAcquire && bestId) {
      select(bestId, bestLabel, bestSourceKind, bestScore, bestBox, timestamp, bestSeenAt, camera,
        wantsFaceEdge && bestSourceKind === 'face' && faceEdge ? 'face-edge' : 'whole');
    }
    return state;
  }

  function getState() {
    return state;
  }

  function reset(timestamp = 0) {
    if (destroyed) return state;
    lastTimestamp = Math.max(0, finite(timestamp));
    state.timestamp = lastTimestamp;
    state.phase = 'searching';
    state.locked = false;
    clearSelection();
    return state;
  }

  function destroy() {
    if (destroyed) return;
    reset(lastTimestamp);
    destroyed = true;
  }

  return Object.freeze({ update, getState, reset, destroy });
}
