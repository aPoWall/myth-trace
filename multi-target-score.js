const SEMANTIC_PORTAL_KINDS = Object.freeze(['object', 'face', 'person', 'body']);
const HAND_PORTAL_KINDS = Object.freeze(['palm', 'fingertip']);

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function kindGroup(kind) {
  if (SEMANTIC_PORTAL_KINDS.includes(kind)) return kind;
  if (HAND_PORTAL_KINDS.includes(kind)) return 'hand';
  return kind || 'anchor';
}

function portalRank(kind) {
  const semanticIndex = SEMANTIC_PORTAL_KINDS.indexOf(kind);
  if (semanticIndex >= 0) return 4 - semanticIndex * 0.1;
  if (kind === 'palm') return 2;
  if (kind === 'fingertip') return 1;
  return 0;
}

function eligible(anchor, minConfidence) {
  return Boolean(
    anchor
    && anchor.id
    && anchor.kind !== 'pointer'
    && clamp01(anchor.confidence ?? anchor.strength) >= minConfidence
  );
}

function findAnchor(anchors, id, minConfidence) {
  if (!id) return null;
  for (const anchor of anchors) {
    if (String(anchor?.id || '') === id && eligible(anchor, minConfidence)) return anchor;
  }
  return null;
}

function contains(list, count, id) {
  for (let index = 0; index < count; index += 1) {
    if (list[index] === id) return true;
  }
  return false;
}

function groupUsed(ids, count, anchors, group, minConfidence) {
  for (let index = 0; index < count; index += 1) {
    const anchor = findAnchor(anchors, ids[index], minConfidence);
    if (anchor && kindGroup(anchor.kind) === group) return true;
  }
  return false;
}

export function createMultiTargetScore({
  maxAmbient = 4,
  maxAmbientPortals = 2,
  minConfidence = 0.28,
} = {}) {
  const ambientLimit = Math.max(0, Math.floor(Number(maxAmbient) || 0));
  const portalLimit = Math.max(0, Math.min(ambientLimit, Math.floor(Number(maxAmbientPortals) || 0)));
  const confidenceFloor = clamp01(minConfidence);
  const ambientIds = new Array(ambientLimit).fill('');
  const previousAmbientIds = new Array(ambientLimit).fill('');
  const portalIds = new Array(portalLimit).fill('');
  const state = {
    subjectId: '', subjectPhase: 'idle', subjectActive: false,
    ambientIds, ambientCount: 0, portalIds, portalCount: 0,
  };

  function reset() {
    state.subjectId = '';
    state.subjectPhase = 'idle';
    state.subjectActive = false;
    state.ambientCount = 0;
    state.portalCount = 0;
    ambientIds.fill('');
    previousAmbientIds.fill('');
    portalIds.fill('');
    return state;
  }

  function update(anchors = [], focusState = null) {
    const subjectId = focusState?.locked ? String(focusState.selectedId || '') : '';
    state.subjectId = subjectId;
    state.subjectPhase = subjectId ? String(focusState?.phase || 'lost') : 'idle';
    state.subjectActive = Boolean(subjectId && (state.subjectPhase === 'live' || state.subjectPhase === 'held'));

    const previousCount = state.ambientCount;
    for (let index = 0; index < ambientLimit; index += 1) {
      previousAmbientIds[index] = index < previousCount ? ambientIds[index] : '';
      ambientIds[index] = '';
    }
    state.ambientCount = 0;

    // Retain still-visible prior IDs first so tracker array reordering cannot flicker roles.
    for (let index = 0; index < previousCount && state.ambientCount < ambientLimit; index += 1) {
      const id = previousAmbientIds[index];
      if (!id || id === subjectId || !findAnchor(anchors, id, confidenceFloor)) continue;
      ambientIds[state.ambientCount] = id;
      state.ambientCount += 1;
    }

    // Fill deterministically. A fresh kind receives a modest diversity bonus.
    while (state.ambientCount < ambientLimit) {
      let best = null;
      let bestScore = -Infinity;
      let bestId = '';
      for (const anchor of anchors) {
        if (!eligible(anchor, confidenceFloor)) continue;
        const id = String(anchor.id);
        if (id === subjectId || contains(ambientIds, state.ambientCount, id)) continue;
        const group = kindGroup(anchor.kind);
        const diversity = groupUsed(ambientIds, state.ambientCount, anchors, group, confidenceFloor) ? 0 : 0.24;
        const score = clamp01(anchor.confidence ?? anchor.strength) + diversity;
        if (score > bestScore || (score === bestScore && id.localeCompare(bestId) < 0)) {
          best = anchor;
          bestId = id;
          bestScore = score;
        }
      }
      if (!best) break;
      ambientIds[state.ambientCount] = bestId;
      state.ambientCount += 1;
    }

    portalIds.fill('');
    state.portalCount = 0;
    while (state.portalCount < portalLimit) {
      let bestId = '';
      let bestScore = -Infinity;
      for (let index = 0; index < state.ambientCount; index += 1) {
        const id = ambientIds[index];
        if (contains(portalIds, state.portalCount, id)) continue;
        const anchor = findAnchor(anchors, id, confidenceFloor);
        if (!anchor) continue;
        const score = portalRank(anchor.kind) + clamp01(anchor.confidence ?? anchor.strength) * 0.1;
        if (score > bestScore || (score === bestScore && id.localeCompare(bestId) < 0)) {
          bestId = id;
          bestScore = score;
        }
      }
      if (!bestId || bestScore < 1) break;
      portalIds[state.portalCount] = bestId;
      state.portalCount += 1;
    }
    return state;
  }

  function roleFor(id) {
    const value = String(id || '');
    if (value && value === state.subjectId) return 'subject';
    if (contains(ambientIds, state.ambientCount, value)) return 'ambient';
    return 'hidden';
  }

  function isPortal(id) {
    return contains(portalIds, state.portalCount, String(id || ''));
  }

  return Object.freeze({ update, reset, roleFor, isPortal, getState: () => state });
}
