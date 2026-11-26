import { createSacredLayer } from './sacred-layer.js';
import { drawRoomGeometry } from './room-geometry.js';
import { MODES, clamp } from './config.js';
import { createFrameOverlayArt } from './frame-overlay-art.js';
import { createMultiTargetScore } from './multi-target-score.js';
import { createTargetHistory } from './target-history.js';
import { createFocusField } from './focus-field.js';
import { drawObjectRegistration } from './object-focus.js';
import { createLightScore } from './light-score.js';

const HAND_CONNECTIONS = Object.freeze([
  [0,1],[1,2],[2,3],[3,4], [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12], [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20], [0,17],
]);
const GRID_DASH = Object.freeze([3, 7]);
const CROP_DASH = Object.freeze([2, 5]);
const EMPTY_LIST = Object.freeze([]);

function hash32(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hash01(text) {
  return hash32(text) / 4294967295;
}

function pct(value) {
  return String(Math.round(clamp(value) * 100)).padStart(3, '0');
}

function poseLandmarkLabel(index) {
  switch (index) {
    case 0: return 'nose';
    case 1: return 'left eye inner';
    case 2: return 'left eye';
    case 3: return 'left eye outer';
    case 4: return 'right eye inner';
    case 5: return 'right eye';
    case 6: return 'right eye outer';
    case 7: return 'left ear';
    case 8: return 'right ear';
    case 9: return 'mouth left';
    case 10: return 'mouth right';
    case 11: return 'left shoulder';
    case 12: return 'right shoulder';
    case 13: return 'left elbow';
    case 14: return 'right elbow';
    case 15: return 'left wrist';
    case 16: return 'right wrist';
    case 17: return 'left pinky';
    case 18: return 'right pinky';
    case 19: return 'left index';
    case 20: return 'right index';
    case 21: return 'left thumb';
    case 22: return 'right thumb';
    case 23: return 'left hip';
    case 24: return 'right hip';
    case 25: return 'left knee';
    case 26: return 'right knee';
    case 27: return 'left ankle';
    case 28: return 'right ankle';
    case 29: return 'left heel';
    case 30: return 'right heel';
    case 31: return 'left foot';
    case 32: return 'right foot';
    default: return `joint ${index}`;
  }
}

function isHandPortal(anchor) {
  return anchor?.kind === 'fingertip' || anchor?.kind === 'palm';
}

function hasAuthoredLocalFrame(gestureFrame, frameContent) {
  return Boolean(gestureFrame?.confirmed && frameContent?.visible && frameContent.stageFill !== true);
}

export function createOverlay({ canvas, video, feedbackCanvas, config }) {
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  const focusSettings = config.overlay.pointerFocus;
  const targetHistory = createTargetHistory({
    capacity: focusSettings.historyCapacity,
    holdMs: focusSettings.historyHoldMs,
    minConfidence: focusSettings.minConfidence,
  });
  const targetScore = createMultiTargetScore(config.overlay.targetScore);
  const drawLightScore = createLightScore(config.lightScore);
  const focusField = createFocusField(config.focusField);
  const sacredLayer = createSacredLayer(config.performancePresets.sacred);
  let wasFocusField = false;
  const frameArt = createFrameOverlayArt({
    lineWidth: config.overlay.lineWidth,
    focusContrast: config.frameContent?.focusContrast,
    focusBrightness: config.frameContent?.focusBrightness,
    focusBracketAlpha: config.frameContent?.focus?.bracketAlpha,
    paint: config.frameContent?.paint,
    video,
    feedbackCanvas,
  });
  let width = 1;
  let height = 1;
  let dpr = 1;
  let lastLabelsAt = -Infinity;
  let cachedStatus = '';
  let memoryCanvases = null;
  let memoryContexts = null;
  let memoryCapturedAt = null;
  let memoryCapacity = 0;
  let memoryCount = 0;
  let memoryWriteIndex = 0;
  let memoryWidth = 0;
  let memoryHeight = 0;
  let lastMemoryCaptureAt = -Infinity;
  let memoryCaptureAvailable = false;
  let memoryUsedThisFrame = false;
  let memoryAgeThisFrame = 0;
  let resolveCandidateAt = -Infinity;
  let lastResolveAt = null;
  let resolveAmount = 0;
  const pointerFocusBox = { x: 0, y: 0, w: 0, h: 0 };
  const pointerFocus = {
    active: false, id: '', kind: '', label: '', x: 0.5, y: 0.5,
    confidence: 0, bbox: null, locked: false, phase: 'idle',
    acquiredAt: -Infinity, lastSeenAt: -Infinity,
  };
  let lastPointerDown = false;
  let lastFocusTime = 0;

  function publishResolveDiagnostics(state, density) {
    if (!canvas.dataset) return;
    canvas.dataset.bodyResolve = resolveAmount.toFixed(3);
    canvas.dataset.bodyResolveState = state;
    canvas.dataset.overlayDensity = density.toFixed(3);
  }

  function updateBodyResolve(time, tracking, debug) {
    const poses = tracking?.poses || EMPTY_LIST;
    let poseConfidence = 0;
    for (const pose of poses) poseConfidence = Math.max(poseConfidence, clamp(pose?.score));
    const handEnergy = clamp(tracking?.metrics?.handEnergy || 0);
    const candidate = poseConfidence >= config.overlay.resolvePoseScore
      && handEnergy <= config.overlay.resolveHandEnergy;

    if (candidate) {
      if (!Number.isFinite(resolveCandidateAt)) resolveCandidateAt = time;
    } else {
      resolveCandidateAt = -Infinity;
    }

    const held = candidate && time - resolveCandidateAt >= config.overlay.resolveHoldMs;
    const elapsed = lastResolveAt === null ? 0 : Math.max(0, time - lastResolveAt);
    const step = clamp(elapsed / config.overlay.resolveFadeMs);
    resolveAmount = held
      ? Math.min(1, resolveAmount + step)
      : Math.max(0, resolveAmount - step);
    lastResolveAt = time;

    const state = held ? 'active' : (candidate ? 'holding' : (resolveAmount > 0 ? 'releasing' : 'idle'));
    const density = debug
      ? 1
      : 1 - resolveAmount * (1 - config.overlay.resolveMinDensity);
    publishResolveDiagnostics(state, density);
    return density;
  }

  function publishMemoryDiagnostics() {
    if (!canvas.dataset) return;
    canvas.dataset.memoryFrames = String(memoryCount);
    canvas.dataset.memorySource = memoryUsedThisFrame
      ? 'feedback'
      : (video && video.readyState >= 2 && video.videoWidth && video.videoHeight ? 'video' : 'none');
    canvas.dataset.memoryAgeMs = String(Math.round(memoryUsedThisFrame ? memoryAgeThisFrame : 0));
  }

  function releaseMemoryRing() {
    memoryCanvases = null;
    memoryContexts = null;
    memoryCapturedAt = null;
    memoryCapacity = 0;
    memoryCount = 0;
    memoryWriteIndex = 0;
    memoryWidth = 0;
    memoryHeight = 0;
    lastMemoryCaptureAt = -Infinity;
    memoryCaptureAvailable = false;
    memoryUsedThisFrame = false;
    memoryAgeThisFrame = 0;
  }

  function resizeMemoryRing() {
    releaseMemoryRing();
    if (!feedbackCanvas) return;

    const capacity = Math.max(0, Math.floor(config.overlay.memoryFrames));
    const scale = config.overlay.memoryScale;
    const ownerDocument = canvas.ownerDocument;
    if (!capacity || !(scale > 0) || !ownerDocument?.createElement) return;

    const sourceWidth = feedbackCanvas.width || Math.round(width * dpr);
    const sourceHeight = feedbackCanvas.height || Math.round(height * dpr);
    if (!sourceWidth || !sourceHeight) return;

    memoryCapacity = capacity;
    memoryWidth = Math.max(1, Math.round(sourceWidth * scale));
    memoryHeight = Math.max(1, Math.round(sourceHeight * scale));
    memoryCanvases = new Array(memoryCapacity);
    memoryContexts = new Array(memoryCapacity);
    memoryCapturedAt = new Float64Array(memoryCapacity);

    try {
      for (let i = 0; i < memoryCapacity; i += 1) {
        const memoryCanvas = ownerDocument.createElement('canvas');
        memoryCanvas.width = memoryWidth;
        memoryCanvas.height = memoryHeight;
        const memoryContext = memoryCanvas.getContext('2d', { alpha: false, desynchronized: true });
        if (!memoryContext) throw new Error('2D feedback capture unavailable');
        memoryContext.globalCompositeOperation = 'copy';
        memoryCanvases[i] = memoryCanvas;
        memoryContexts[i] = memoryContext;
      }
      memoryCaptureAvailable = true;
    } catch {
      releaseMemoryRing();
    }
  }

  function captureMemory(time) {
    if (!memoryCaptureAvailable || !feedbackCanvas || !memoryCapacity) return;
    if (time - lastMemoryCaptureAt < config.overlay.memoryIntervalMs) return;
    if (!feedbackCanvas.width || !feedbackCanvas.height) return;

    lastMemoryCaptureAt = time;
    try {
      memoryContexts[memoryWriteIndex].drawImage(feedbackCanvas, 0, 0, memoryWidth, memoryHeight);
    } catch {
      releaseMemoryRing();
      return;
    }
    memoryCapturedAt[memoryWriteIndex] = time;
    memoryWriteIndex = (memoryWriteIndex + 1) % memoryCapacity;
    memoryCount = Math.min(memoryCount + 1, memoryCapacity);
  }

  function resize(nextWidth, nextHeight, nextDpr = 1) {
    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
    dpr = Math.max(1, nextDpr);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    resizeMemoryRing();
    publishMemoryDiagnostics();
    publishResolveDiagnostics('idle', 1);
  }

  function line(x1, y1, x2, y2, alpha = 0.28, dash = null) {
    ctx.save();
    ctx.strokeStyle = `rgba(226,232,238,${alpha})`;
    ctx.lineWidth = config.overlay.lineWidth;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  function drawFieldGrid(tracking, controls) {
    const confidence = tracking?.metrics?.confidence || 0;
    const spacing = controls.mode === 2 ? 22 : 44;
    ctx.save();
    ctx.globalAlpha *= 0.035 + confidence * 0.055;
    ctx.fillStyle = '#edf2f6';
    for (let y = spacing * 0.5; y < height; y += spacing) {
      for (let x = spacing * 0.5; x < width; x += spacing) {
        const radius = controls.mode === 2 ? 0.8 + confidence * 1.2 : 0.55;
        ctx.fillRect(x, y, radius, radius);
      }
    }
    ctx.restore();
    const diagonal = width * (0.16 + (tracking?.metrics?.motion || 0) * 0.18);
    line(diagonal, -20, diagonal + height * 0.42, height + 20, 0.18, GRID_DASH);
  }

  function drawCrop(anchor, index, tracking, time, controls, portalAlpha) {
    if (memoryCount >= 2 && (controls.mode === 0 || controls.mode === 3)) {
      const anchorId = anchor.id || String(index);
      const idPhase = hash01(anchorId);
      const ageClass = Math.min(memoryCount - 1, hash32(anchorId) % memoryCapacity);
      const memoryIndex = (memoryWriteIndex - 1 - ageClass + memoryCapacity) % memoryCapacity;
      const memoryCanvas = memoryCanvases[memoryIndex];
      if (memoryCanvas) {
        const sourceLimit = Math.min(memoryWidth, memoryHeight);
        const sourceSize = Math.min(sourceLimit, Math.max(54, sourceLimit * (0.11 + idPhase * 0.08)));
        const screenX = clamp(anchor.x);
        const screenY = clamp(anchor.y);
        const sourceXCenter = screenX * memoryWidth;
        const sourceYCenter = screenY * memoryHeight;
        const sx = Math.max(0, Math.min(memoryWidth - sourceSize, sourceXCenter - sourceSize * 0.5));
        const sy = Math.max(0, Math.min(memoryHeight - sourceSize, sourceYCenter - sourceSize * 0.5));
        const pulse = 1 + Math.sin(time * 0.0018 + idPhase * 8) * 0.06;
        const base = Math.min(width, height)
          * (0.075 + idPhase * 0.035)
          * config.overlay.targetScore.portalScale
          * pulse;
        const aspect = 0.72 + idPhase * 0.55;
        const dw = base * aspect;
        const dh = base / aspect;
        const offsetX = (idPhase - 0.5) * Math.min(width * 0.18, 180);
        const offsetY = ((idPhase * 7) % 1 - 0.5) * Math.min(height * 0.12, 100);
        const dx = Math.max(1, Math.min(width - dw - 1, screenX * width + offsetX - dw * 0.5));
        const dy = Math.max(1, Math.min(height - dh - 1, screenY * height + offsetY - dh * 0.5));
        const maximumAge = config.overlay.memoryIntervalMs * memoryCapacity;
        const memoryAge = Math.min(maximumAge, Math.max(0, time - memoryCapturedAt[memoryIndex]));

        ctx.save();
        ctx.beginPath();
        ctx.rect(dx, dy, dw, dh);
        ctx.clip();
        ctx.globalAlpha *= portalAlpha;
        ctx.filter = controls.mode === 0 ? 'grayscale(1) contrast(2.2) brightness(1.18)' : 'grayscale(1) contrast(1.7)';
        ctx.drawImage(memoryCanvas, sx, sy, sourceSize, sourceSize, dx, dy, dw, dh);
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = `rgba(235,240,244,${portalAlpha * (0.46 + anchor.confidence * 0.42)})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);
        ctx.fillStyle = 'rgba(5,6,9,.82)';
        ctx.fillRect(dx, dy - 14, Math.min(dw, 154), 14);
        ctx.fillStyle = `rgba(236,241,245,${portalAlpha * 0.9})`;
        ctx.font = '9px "SFMono-Regular", Menlo, monospace';
        ctx.fillText(
          `${anchor.kind}.${String(index).padStart(2, '0')} · ${pct(anchor.confidence)} · T-${(memoryAge / 1000).toFixed(1)}s`,
          dx + 4,
          dy - 4,
        );
        ctx.restore();
        line(screenX * width, screenY * height, dx + dw * 0.5, dy + dh * 0.5, portalAlpha * 0.28, CROP_DASH);
        if (!memoryUsedThisFrame) memoryAgeThisFrame = memoryAge;
        memoryUsedThisFrame = true;
        return;
      }
    }

    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    const idPhase = hash01(anchor.id || String(index));
    const sourceSize = Math.max(54, Math.min(video.videoWidth, video.videoHeight) * (0.11 + idPhase * 0.08));
    const screenX = clamp(anchor.x);
    const screenY = clamp(anchor.y);
    const sourceXCenter = tracking.camera.mirrored ? (1 - screenX) * video.videoWidth : screenX * video.videoWidth;
    const sourceYCenter = screenY * video.videoHeight;
    const sx = Math.max(0, Math.min(video.videoWidth - sourceSize, sourceXCenter - sourceSize * 0.5));
    const sy = Math.max(0, Math.min(video.videoHeight - sourceSize, sourceYCenter - sourceSize * 0.5));
    const pulse = 1 + Math.sin(time * 0.0018 + idPhase * 8) * 0.06;
    const base = Math.min(width, height)
      * (0.075 + idPhase * 0.035)
      * config.overlay.targetScore.portalScale
      * pulse;
    const aspect = 0.72 + idPhase * 0.55;
    const dw = base * aspect;
    const dh = base / aspect;
    const offsetX = (idPhase - 0.5) * Math.min(width * 0.18, 180);
    const offsetY = ((idPhase * 7) % 1 - 0.5) * Math.min(height * 0.12, 100);
    const dx = Math.max(1, Math.min(width - dw - 1, screenX * width + offsetX - dw * 0.5));
    const dy = Math.max(1, Math.min(height - dh - 1, screenY * height + offsetY - dh * 0.5));

    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, dw, dh);
    ctx.clip();
    ctx.globalAlpha *= portalAlpha;
    ctx.filter = controls.mode === 0 ? 'grayscale(1) contrast(2.2) brightness(1.18)' : 'grayscale(1) contrast(1.7)';
    if (tracking.camera.mirrored) {
      ctx.translate(dx + dw, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(video, sx, sy, sourceSize, sourceSize, 0, 0, dw, dh);
    } else {
      ctx.drawImage(video, sx, sy, sourceSize, sourceSize, dx, dy, dw, dh);
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = `rgba(235,240,244,${portalAlpha * (0.46 + anchor.confidence * 0.42)})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);
    ctx.fillStyle = 'rgba(5,6,9,.82)';
    ctx.fillRect(dx, dy - 14, Math.min(dw, 122), 14);
    ctx.fillStyle = `rgba(236,241,245,${portalAlpha * 0.9})`;
    ctx.font = '9px "SFMono-Regular", Menlo, monospace';
    ctx.fillText(`${anchor.kind}.${String(index).padStart(2, '0')} · ${pct(anchor.confidence)}`, dx + 4, dy - 4);
    ctx.restore();
    line(screenX * width, screenY * height, dx + dw * 0.5, dy + dh * 0.5, portalAlpha * 0.28, CROP_DASH);
  }

  function drawAnchor(anchor, index, controls) {
    const x = clamp(anchor.x) * width;
    const y = clamp(anchor.y) * height;
    const energy = clamp(anchor.strength || anchor.confidence);
    const size = 9 + energy * 18;
    ctx.save();
    ctx.strokeStyle = `rgba(238,243,247,${0.36 + energy * 0.56})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - size, y - size, size * 2, size * 2);
    ctx.beginPath();
    ctx.moveTo(x - size - 5, y);
    ctx.lineTo(x + size + 5, y);
    ctx.moveTo(x, y - size - 5);
    ctx.lineTo(x, y + size + 5);
    ctx.stroke();
    if (controls.debug) {
      ctx.fillStyle = 'rgba(238,243,247,.74)';
      ctx.font = '9px "SFMono-Regular", Menlo, monospace';
      ctx.fillText(`${anchor.label || anchor.kind}:${index}`, x + size + 6, y + 3);
    }
    ctx.restore();
  }

  function drawAmbientAnchor(anchor, index) {
    const x = clamp(anchor.x) * width;
    const y = clamp(anchor.y) * height;
    const energy = clamp(anchor.strength || anchor.confidence);
    const settings = config.overlay.targetScore;
    const alpha = settings.ambientMinAlpha
      + energy * (settings.ambientMaxAlpha - settings.ambientMinAlpha);
    const size = 5 + energy * 6;
    const corner = Math.max(2, size * 0.4);
    ctx.save();
    ctx.strokeStyle = `rgba(238,243,247,${alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - size, y - size + corner); ctx.lineTo(x - size, y - size); ctx.lineTo(x - size + corner, y - size);
    ctx.moveTo(x + size - corner, y - size); ctx.lineTo(x + size, y - size); ctx.lineTo(x + size, y - size + corner);
    ctx.moveTo(x - size, y + size - corner); ctx.lineTo(x - size, y + size); ctx.lineTo(x - size + corner, y + size);
    ctx.moveTo(x + size - corner, y + size); ctx.lineTo(x + size, y + size); ctx.lineTo(x + size, y + size - corner);
    ctx.stroke();
    ctx.fillStyle = `rgba(238,243,247,${alpha * 0.76})`;
    ctx.fillRect(x - 1, y - 1, 2, 2);
    ctx.font = '8px "SFMono-Regular", Menlo, monospace';
    ctx.fillText(`${String(index + 1).padStart(2, '0')}`, x + size + 4, y + 3);
    ctx.restore();
  }

  function validFocusBox(bbox) {
    const w = Number(bbox?.w ?? bbox?.width);
    const h = Number(bbox?.h ?? bbox?.height);
    return Number.isFinite(bbox?.x) && Number.isFinite(bbox?.y)
      && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
  }

  function copyFocus(anchor, time) {
    const changed = pointerFocus.id !== anchor.id;
    pointerFocus.active = true;
    pointerFocus.id = String(anchor.id || 'anchor');
    pointerFocus.kind = String(anchor.kind || 'anchor');
    pointerFocus.label = String(anchor.label || anchor.kind || 'anchor');
    pointerFocus.x = clamp(anchor.x);
    pointerFocus.y = clamp(anchor.y);
    pointerFocus.confidence = clamp(anchor.confidence ?? anchor.strength);
    if (validFocusBox(anchor.bbox)) {
      pointerFocusBox.x = clamp(anchor.bbox.x);
      pointerFocusBox.y = clamp(anchor.bbox.y);
      pointerFocusBox.w = clamp(anchor.bbox.w ?? anchor.bbox.width);
      pointerFocusBox.h = clamp(anchor.bbox.h ?? anchor.bbox.height);
      pointerFocus.bbox = pointerFocusBox;
    } else {
      pointerFocus.bbox = null;
    }
    if (changed) pointerFocus.acquiredAt = time;
    pointerFocus.lastSeenAt = time;
  }

  function findPointerCandidate(anchors, pointer, settings) {
    const px = clamp(pointer.x);
    const py = clamp(pointer.y);
    let best = null;
    let bestRank = -Infinity;
    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index];
      const confidence = clamp(anchor?.confidence ?? anchor?.strength);
      if (!anchor || confidence < settings.minConfidence) continue;
      const ax = clamp(anchor.x);
      const ay = clamp(anchor.y);
      const distance = Math.hypot(px - ax, py - ay);
      const same = pointerFocus.active && pointerFocus.id === String(anchor.id || '');
      const radius = same ? settings.releaseRadius : settings.acquireRadius;
      let rank = distance <= radius ? 1 - distance / Math.max(radius, 0.0001) : -Infinity;
      if (validFocusBox(anchor.bbox)) {
        const bx = clamp(anchor.bbox.x);
        const by = clamp(anchor.bbox.y);
        const bw = clamp(anchor.bbox.w ?? anchor.bbox.width);
        const bh = clamp(anchor.bbox.h ?? anchor.bbox.height);
        const inside = px >= bx && px <= bx + bw && py >= by && py <= by + bh;
        if (inside) rank = 2 + (1 - clamp(bw * bh));
      }
      if (same) rank += 0.16;
      if (rank > bestRank) {
        best = anchor;
        bestRank = rank;
      }
    }
    return bestRank > -Infinity ? best : null;
  }

  function releasePointerFocus() {
    pointerFocus.active = false;
    pointerFocus.locked = false;
  }

  function clearFocusSelection(time = lastFocusTime) {
    targetHistory.clearSelection(time);
    releasePointerFocus();
  }

  function applyHistorySelection(time = lastFocusTime) {
    const selected = targetHistory.resolve(time);
    if (selected) {
      copyFocus(selected, time);
      pointerFocus.locked = true;
    } else {
      pointerFocus.active = false;
      pointerFocus.locked = targetHistory.getState(time).locked;
    }
    return targetHistory.getState(time);
  }

  function cycleFocus(direction) {
    targetHistory.cycle(direction, lastFocusTime);
    return applyHistorySelection(lastFocusTime);
  }

  function selectPointerFocus(time, anchors, controls) {
    const settings = config.overlay.pointerFocus;
    lastFocusTime = time;
    targetHistory.observe(anchors, time);
    const pointer = controls.pointer;
    const pointerDown = Boolean(pointer?.down);
    const clicked = pointerDown && !lastPointerDown;
    lastPointerDown = pointerDown;
    if (!settings || !pointer) {
      if (time - pointerFocus.lastSeenAt > (settings?.lossHoldMs || 0)) releasePointerFocus();
      return pointerFocus.active ? pointerFocus : null;
    }

    const best = findPointerCandidate(anchors, pointer, settings);
    if (clicked) {
      const selectedId = targetHistory.getState(time).selectedId;
      if (!best || (selectedId && String(best.id || '') === selectedId)) {
        clearFocusSelection(time);
        return null;
      }
      targetHistory.select(best, time);
      copyFocus(best, time);
      pointerFocus.locked = true;
      return pointerFocus;
    }

    if (targetHistory.getState(time).locked) {
      applyHistorySelection(time);
      return pointerFocus.active ? pointerFocus : null;
    }

    if (best) {
      copyFocus(best, time);
    } else if (time - pointerFocus.lastSeenAt > settings.lossHoldMs) releasePointerFocus();
    return pointerFocus.active ? pointerFocus : null;
  }

  function drawFocusBrackets(focus, pulse) {
    const bbox = focus.bbox;
    const fallback = 0.045;
    const x = (bbox ? clamp(bbox.x) : clamp(focus.x - fallback)) * width;
    const y = (bbox ? clamp(bbox.y) : clamp(focus.y - fallback)) * height;
    const w = (bbox ? clamp(bbox.w) : fallback * 2) * width;
    const h = (bbox ? clamp(bbox.h) : fallback * 2) * height;
    const inset = 5 + pulse * 8;
    const corner = Math.max(10, Math.min(28, Math.min(w, h) * 0.22));
    ctx.save();
    ctx.strokeStyle = `rgba(244,247,249,${0.62 + pulse * 0.28})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - inset, y - inset + corner); ctx.lineTo(x - inset, y - inset); ctx.lineTo(x - inset + corner, y - inset);
    ctx.moveTo(x + w + inset - corner, y - inset); ctx.lineTo(x + w + inset, y - inset); ctx.lineTo(x + w + inset, y - inset + corner);
    ctx.moveTo(x - inset, y + h + inset - corner); ctx.lineTo(x - inset, y + h + inset); ctx.lineTo(x - inset + corner, y + h + inset);
    ctx.moveTo(x + w + inset - corner, y + h + inset); ctx.lineTo(x + w + inset, y + h + inset); ctx.lineTo(x + w + inset, y + h + inset - corner);
    ctx.stroke();
    ctx.restore();
  }

  function drawFocusLens(focus, tracking, pointerX, pointerY) {
    const settings = config.overlay.pointerFocus;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return false;
    const lensWidth = Math.min(settings.lensWidth, Math.max(84, width - 16));
    const lensHeight = Math.min(settings.lensHeight, Math.max(62, height - 16));
    let dx = pointerX + settings.lensOffset;
    let dy = pointerY + settings.lensOffset;
    if (dx + lensWidth > width - 8) dx = pointerX - settings.lensOffset - lensWidth;
    if (dy + lensHeight > height - 8) dy = pointerY - settings.lensOffset - lensHeight;
    dx = Math.max(8, Math.min(width - lensWidth - 8, dx));
    dy = Math.max(8, Math.min(height - lensHeight - 8, dy));

    const pad = settings.padding;
    const bbox = focus.bbox;
    let bx = bbox ? clamp(bbox.x - pad) : clamp(focus.x - 0.12);
    let by = bbox ? clamp(bbox.y - pad) : clamp(focus.y - 0.12);
    let bw = bbox ? clamp(bbox.w + pad * 2) : 0.24;
    let bh = bbox ? clamp(bbox.h + pad * 2) : 0.24;
    bw = Math.min(bw, 1 - bx);
    bh = Math.min(bh, 1 - by);
    const targetAspect = lensWidth / lensHeight;
    if (bw / Math.max(bh, 0.0001) > targetAspect) {
      const nextHeight = Math.min(1, bw / targetAspect);
      by = clamp(by - (nextHeight - bh) * 0.5, 0, 1 - nextHeight);
      bh = nextHeight;
    } else {
      const nextWidth = Math.min(1, bh * targetAspect);
      bx = clamp(bx - (nextWidth - bw) * 0.5, 0, 1 - nextWidth);
      bw = nextWidth;
    }
    const mirrored = Boolean(tracking?.camera?.mirrored);
    const sourceX = (mirrored ? 1 - bx - bw : bx) * video.videoWidth;
    const sourceY = by * video.videoHeight;
    const sourceWidth = bw * video.videoWidth;
    const sourceHeight = bh * video.videoHeight;
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, lensWidth, lensHeight);
    ctx.clip();
    ctx.filter = 'grayscale(1) contrast(1.38) brightness(.86)';
    if (mirrored) {
      ctx.translate(dx + lensWidth, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, lensWidth, lensHeight);
    } else {
      ctx.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, dx, dy, lensWidth, lensHeight);
    }
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(244,247,249,.78)';
    ctx.strokeRect(dx + 0.5, dy + 0.5, lensWidth - 1, lensHeight - 1);
    ctx.fillStyle = 'rgba(5,6,9,.86)';
    ctx.fillRect(dx, dy, lensWidth, 16);
    ctx.fillStyle = 'rgba(244,247,249,.88)';
    ctx.font = '9px "SFMono-Regular", Menlo, monospace';
    ctx.fillText(`${focus.locked ? 'LOCK' : 'FOCUS'} · ${focus.label} · ${pct(focus.confidence)}`, dx + 5, dy + 11);
    ctx.restore();
    return true;
  }

  function drawPointerFocus(time, focus, tracking, controls, drawLens) {
    const pointer = controls.pointer;
    if (!pointer) return;
    const px = clamp(pointer.x) * width;
    const py = clamp(pointer.y) * height;
    const pulse = focus ? 1 - clamp((time - focus.acquiredAt) / config.overlay.pointerFocus.pulseMs) : 0;
    const radius = pointer.down ? 21 : (focus ? 17 + pulse * 5 : 12);
    ctx.save();
    ctx.strokeStyle = `rgba(244,247,249,${focus ? 0.92 : 0.58})`;
    ctx.fillStyle = pointer.down ? 'rgba(244,247,249,.18)' : 'rgba(5,6,9,.16)';
    ctx.lineWidth = 1;
    ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
    ctx.strokeRect(px - radius + 0.5, py - radius + 0.5, radius * 2 - 1, radius * 2 - 1);
    ctx.beginPath();
    ctx.moveTo(px - radius - 7, py); ctx.lineTo(px + radius + 7, py);
    ctx.moveTo(px, py - radius - 7); ctx.lineTo(px, py + radius + 7);
    ctx.stroke();
    ctx.restore();
    if (!focus) return;
    line(px, py, focus.x * width, focus.y * height, 0.5 + pulse * 0.24, CROP_DASH);
    drawFocusBrackets(focus, pulse);
    if (drawLens) drawFocusLens(focus, tracking, px, py);
  }

  function drawSubjectRouteEffect(time, route) {
    const amount = clamp(route?.visual);
    const box = route?.bbox;
    if (!route?.active || amount <= config.overlay.subjectRoute.idleSnap || !validFocusBox(box)) return;
    const x = clamp(box.x) * width;
    const y = clamp(box.y) * height;
    const w = clamp(box.w ?? box.width) * width;
    const h = clamp(box.h ?? box.height) * height;
    if (w < 2 || h < 2) return;
    const settings = config.overlay.subjectRoute;
    const alpha = settings.visualMinAlpha
      + amount * (settings.visualMaxAlpha - settings.visualMinAlpha);
    const scanY = y + h * ((time * 0.00018 + route.value * 0.42) % 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = `rgba(226,235,242,${alpha * 0.28})`;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = `rgba(244,247,249,${alpha})`;
    ctx.fillRect(x, scanY - 0.5, w, 1);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = `rgba(244,247,249,${alpha * 0.9})`;
    ctx.setLineDash(CROP_DASH);
    ctx.strokeRect(x + 1.5, y + 1.5, Math.max(0, w - 3), Math.max(0, h - 3));
    ctx.fillStyle = `rgba(244,247,249,${alpha})`;
    ctx.font = '8px "SFMono-Regular", Menlo, monospace';
    ctx.fillText(`ROUTE · ${route.owner} · ${pct(route.value)}`, x + 5, Math.max(10, y - 5));
    ctx.restore();
  }

  function drawHands(hands, controls) {
    if (!controls.debug) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(232,238,243,.38)';
    ctx.lineWidth = 1;
    for (const hand of hands) {
      for (const [a, b] of HAND_CONNECTIONS) {
        const p = hand.landmarks[a];
        const q = hand.landmarks[b];
        if (!p || !q) continue;
        ctx.beginPath();
        ctx.moveTo(p.x * width, p.y * height);
        ctx.lineTo(q.x * width, q.y * height);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawPoseBone(pose, fromIndex, toIndex, alpha) {
    const from = pose.landmarks[fromIndex];
    const to = pose.landmarks[toIndex];
    if (!from || !to) return;
    line(clamp(from.x) * width, clamp(from.y) * height, clamp(to.x) * width, clamp(to.y) * height, alpha);
  }

  function drawPoseSkeleton(pose, alpha) {
    drawPoseBone(pose, 0, 1, alpha);
    drawPoseBone(pose, 1, 2, alpha);
    drawPoseBone(pose, 2, 3, alpha);
    drawPoseBone(pose, 3, 7, alpha);
    drawPoseBone(pose, 0, 4, alpha);
    drawPoseBone(pose, 4, 5, alpha);
    drawPoseBone(pose, 5, 6, alpha);
    drawPoseBone(pose, 6, 8, alpha);
    drawPoseBone(pose, 9, 10, alpha);
    drawPoseBone(pose, 11, 12, alpha);
    drawPoseBone(pose, 11, 13, alpha);
    drawPoseBone(pose, 13, 15, alpha);
    drawPoseBone(pose, 15, 17, alpha);
    drawPoseBone(pose, 15, 19, alpha);
    drawPoseBone(pose, 15, 21, alpha);
    drawPoseBone(pose, 17, 19, alpha);
    drawPoseBone(pose, 12, 14, alpha);
    drawPoseBone(pose, 14, 16, alpha);
    drawPoseBone(pose, 16, 18, alpha);
    drawPoseBone(pose, 16, 20, alpha);
    drawPoseBone(pose, 16, 22, alpha);
    drawPoseBone(pose, 18, 20, alpha);
    drawPoseBone(pose, 11, 23, alpha);
    drawPoseBone(pose, 12, 24, alpha);
    drawPoseBone(pose, 23, 24, alpha);
    drawPoseBone(pose, 23, 25, alpha);
    drawPoseBone(pose, 25, 27, alpha);
    drawPoseBone(pose, 27, 29, alpha);
    drawPoseBone(pose, 29, 31, alpha);
    drawPoseBone(pose, 27, 31, alpha);
    drawPoseBone(pose, 24, 26, alpha);
    drawPoseBone(pose, 26, 28, alpha);
    drawPoseBone(pose, 28, 30, alpha);
    drawPoseBone(pose, 30, 32, alpha);
    drawPoseBone(pose, 28, 32, alpha);
  }

  function drawPoseJoint(point, alpha) {
    if (!point) return;
    const radius = config.overlay.lineWidth * config.overlay.cropScale;
    ctx.save();
    ctx.fillStyle = `rgba(238,243,247,${alpha})`;
    ctx.beginPath();
    ctx.arc(clamp(point.x) * width, clamp(point.y) * height, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPoseCenter(pose, alpha) {
    const center = pose.center;
    if (!center) return;
    const x = clamp(center.x) * width;
    const y = clamp(center.y) * height;
    const radius = config.overlay.lineWidth * config.overlay.cropScale * config.overlay.cropScale;
    ctx.save();
    ctx.strokeStyle = `rgba(238,243,247,${alpha})`;
    ctx.lineWidth = config.overlay.lineWidth;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.moveTo(x - radius * config.overlay.cropScale, y);
    ctx.lineTo(x + radius * config.overlay.cropScale, y);
    ctx.moveTo(x, y - radius * config.overlay.cropScale);
    ctx.lineTo(x, y + radius * config.overlay.cropScale);
    ctx.stroke();
    ctx.restore();
  }

  function drawPoses(poses, controls) {
    for (const pose of poses) {
      if (!pose || !Array.isArray(pose.landmarks)) continue;
      // Pose tracking already mirrors into displayed coordinates. The canvas
      // transform applied in resize converts these CSS pixels to device pixels.
      const confidence = clamp(pose.score);
      if (confidence <= 0) continue;
      const alpha = confidence * (controls.debug ? 0.38 : 0.18);

      drawPoseCenter(pose, alpha);
      if (controls.debug) {
        drawPoseSkeleton(pose, alpha);
        ctx.save();
        ctx.font = '9px "SFMono-Regular", Menlo, monospace';
        ctx.fillStyle = `rgba(238,243,247,${confidence * 0.74})`;
        for (let index = 0; index < pose.landmarks.length; index += 1) {
          const point = pose.landmarks[index];
          if (!point) continue;
          drawPoseJoint(point, alpha);
          ctx.fillText(
            `${String(index).padStart(2, '0')} ${poseLandmarkLabel(index)}`,
            clamp(point.x) * width + config.overlay.lineWidth * config.overlay.cropScale,
            clamp(point.y) * height - config.overlay.lineWidth * config.overlay.cropScale,
          );
        }
        if (pose.center) {
          ctx.fillText(
            `${pose.id || 'pose'} · ${pct(confidence)}`,
            clamp(pose.center.x) * width + config.overlay.lineWidth * config.overlay.cropScale,
            clamp(pose.center.y) * height + config.overlay.lineWidth * config.overlay.cropScale,
          );
        }
        ctx.restore();
        continue;
      }

      drawPoseBone(pose, 11, 12, alpha);
      drawPoseBone(pose, 23, 24, alpha);
      drawPoseJoint(pose.landmarks[13], alpha);
      drawPoseJoint(pose.landmarks[14], alpha);
      drawPoseJoint(pose.landmarks[15], alpha);
      drawPoseJoint(pose.landmarks[16], alpha);
      drawPoseJoint(pose.landmarks[25], alpha);
      drawPoseJoint(pose.landmarks[26], alpha);
    }
  }

  function drawHud({ time, tracking, audio, controls, stats }) {
    if (!controls.hud) return;
    const mode = MODES[controls.mode] || MODES[0];
    const fps = Math.round(stats?.fps || 0);
    const objects = tracking?.objects?.length || 0;
    const hands = tracking?.hands?.length || 0;
    const poses = tracking?.poses?.length || 0;
    const faces = tracking?.faces?.length || 0;
    const gate = audio?.gate || 0;
    const rendererState = stats?.webgl2 === false ? ' · safe raster fallback' : '';
    const status = `${tracking?.status || 'idle'} · ${hands} hands · ${poses} bodies · ${faces} faces · ${objects} objects · ${fps} fps${rendererState}`;
    if (time - lastLabelsAt >= config.overlay.labelRateMs) {
      cachedStatus = status;
      lastLabelsAt = time;
    }

    ctx.save();
    ctx.textBaseline = 'top';
    if (controls.debug) {
    ctx.fillStyle = 'rgba(5,6,9,.64)';
    ctx.fillRect(18, 18, Math.min(460, width - 36), 64);
    ctx.strokeStyle = 'rgba(235,240,244,.28)';
    ctx.strokeRect(18.5, 18.5, Math.min(460, width - 36) - 1, 63);
    ctx.font = '600 13px "SFMono-Regular", Menlo, monospace';
    ctx.fillStyle = 'rgba(242,245,247,.92)';
    ctx.fillText(`${String(controls.mode + 1).padStart(2, '0')} · ${mode.name}`, 30, 29);
    ctx.font = '10px "SFMono-Regular", Menlo, monospace';
    ctx.fillStyle = 'rgba(179,188,197,.82)';
    ctx.fillText(cachedStatus, 30, 50);
    ctx.fillText(`motion ${pct(tracking?.metrics?.motion || 0)} · body ${pct(tracking?.metrics?.bodyEnergy || 0)} · audio ${pct(gate)} · feedback ${pct(controls.feedback)}`, 30, 65);
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(225,231,236,.58)';
    ctx.fillText(`EXECUTING ${mode.code.toUpperCase()}`, width - 22, 24);
    ctx.fillText(new Date().toISOString().slice(11, 23), width - 22, 40);
    ctx.restore();
  }

  function drawLiveObjects(objects, cover, target, settings) {
    const visible = (objects || EMPTY_LIST)
      .filter(object => object.bbox && object.score >= config.tracking.minObjectScore)
      .sort((a, b) => b.score - a.score).slice(0, 3);
    ctx.save();
    ctx.fillStyle = 'rgba(244,247,249,.72)';
    ctx.font = '10px "SFMono-Regular", Menlo, monospace';
    for (const object of visible) {
      let box = object.bbox;
      if (cover) {
        const [x, y, w, h] = cover;
        const left = clamp(x + box.x * w), right = clamp(x + (box.x + box.w) * w);
        const top = clamp(y + box.y * h), bottom = clamp(y + (box.y + box.h) * h);
        if (right <= left || bottom <= top) continue;
        box = { x: left, y: top, w: right - left, h: bottom - top };
      }
      drawFocusBrackets({ bbox: box }, 0);
      if (settings) drawObjectRegistration(ctx, box, width, height, settings);
      ctx.fillText(`${target?.locked ? 'LOCK · ' : ''}${object.label} · ${pct(object.score)}`, clamp(box.x) * width,
        Math.max(18, clamp(box.y) * height - 13));
      if (target?.locked) {
        const x = (box.x + box.w / 2) * width, y = (box.y + box.h / 2) * height;
        ctx.fillStyle = 'rgba(221,235,243,.86)';
        ctx.fillRect(x - 2, y - 2, 4, 4);
      }
    }
    ctx.restore();
  }

  function drawNodeInspector(controls) {
    if (!controls.inspectNodes || !controls.hud) return;
    ctx.save();
    ctx.font = '10px "SFMono-Regular", Menlo, monospace';
    for (const node of controls.stageNodes || EMPTY_LIST) {
      const x = node.x * width, y = node.y * height;
      ctx.strokeStyle = 'rgba(240,207,166,.8)';
      ctx.strokeRect(x - 4, y - 4, 8, 8);
      ctx.fillStyle = 'rgba(243,232,218,.92)';
      ctx.fillText(node.label || node.id, Math.min(width - 70, x + 8), Math.max(13, y - 7));
    }
    ctx.restore();
  }

  function render({
    time = performance.now(), tracking, audio, controls, stats,
    gestureFrame, frameContent, frameObjectCrop, frameZone, generatedBackground, subjectRoute,
  }) {
    memoryUsedThisFrame = false;
    memoryAgeThisFrame = 0;
    ctx.clearRect(0, 0, width, height);
    const drawLayers = () => {
      frameArt.draw({
        ctx, width, height, time, frame: gestureFrame,
        content: frameContent, objectCrop: frameObjectCrop, frameZone, generatedBackground,
      });
      if (controls.room && !controls.geometryMuted) {
        ctx.save();
        ctx.globalAlpha *= controls.lightScore?.strength ?? 1;
        drawRoomGeometry(ctx, width, height, controls.room, { ...controls.pointer, active: controls.pointer.roomActive });
        ctx.restore();
      }
      sacredLayer(ctx, width, height, time, tracking, audio, controls, gestureFrame);
    };
    if (canvas.dataset) canvas.dataset.sacred = (controls.sacredLayer === 'auto' ? controls.sacredLiveShape : controls.sacredLayer) || 'off';
    if (controls.focusField) {
      delete canvas.dataset.faceLinks;
      if (!wasFocusField) focusField.reset();
      wasFocusField = true;
      canvas.dataset.focusFieldSource = controls.geometryMuted ? 'off'
        : focusField.render(ctx, width, height, time, tracking, audio, controls);
      canvas.dataset.trackingStudy = 'point-lattice';
      canvas.dataset.studySource = canvas.dataset.focusFieldSource;
      delete canvas.dataset.studySegments;
      if (controls.geometryMuted) delete canvas.dataset.focusFieldNode;
      drawNodeInspector(controls);
      drawLayers();
      return;
    }
    if (wasFocusField) {
      wasFocusField = false;
      delete canvas.dataset.focusFieldSource;
      delete canvas.dataset.focusFieldNode;
    }
    const density = updateBodyResolve(time, tracking, controls.debug);
    ctx.save();
    ctx.globalAlpha *= density;
    if (!controls.demoActive || controls.debug) drawFieldGrid(tracking, controls);
    const anchors = tracking?.anchors || EMPTY_LIST;
    const traceVisible = controls.trace !== false;
    const cleanStage = (controls.demoActive || controls.lightScore?.auto && controls.lightScore.strength > 0) && !controls.debug;
    const tilesVisible = traceVisible && controls.trackingTiles !== false && (!controls.demoActive || controls.debug);
    const suppressHandPortals = hasAuthoredLocalFrame(gestureFrame, frameContent);
    let suppressedHandPortals = 0;
    let focus = null;
    let scoreState = targetScore.getState();
    if (traceVisible) {
      focus = selectPointerFocus(time, anchors, controls);
      scoreState = targetScore.update(anchors, targetHistory.getState(time));
      pointerFocus.phase = scoreState.subjectPhase;
    } else {
      clearFocusSelection(time);
      targetScore.reset();
      lastPointerDown = false;
      scoreState = targetScore.getState();
    }
    ctx.restore();
    const lightSource = drawLightScore({ctx, width, height, time, tracking, audio, controls,
      focus: focus?.locked ? focus : null, frame: gestureFrame});
    const target = controls.objectFocus;
    if (controls.objectWorkflow && target) {
      ctx.save();
      ctx.globalAlpha = target.opacity;
      drawLiveObjects([target.target], controls.clipTracking ? controls.clipCover : null, target,
        controls.geometryMuted || !controls.lightScore?.study ? null : controls.lightScore);
      ctx.restore();
      canvas.dataset.objectTarget = target.target.id;
      canvas.dataset.objectLocked = String(target.locked);
    } else {
      delete canvas.dataset.objectTarget;
      delete canvas.dataset.objectLocked;
    }
    if (!controls.objectWorkflow && ((controls.clipTracking && controls.inspectNodes)
      || (!cleanStage && !controls.clipActive && controls.liveObjects && !gestureFrame?.confirmed && !focus?.locked))) {
      drawLiveObjects(tracking?.objects, controls.clipTracking ? controls.clipCover : null);
    }
    if (controls.clipActive) canvas.dataset.clipObjects = String(controls.clipTracking ? tracking?.objects?.length || 0 : 0);
    else if (canvas.dataset.clipObjects !== undefined) delete canvas.dataset.clipObjects;
    ctx.save();
    ctx.globalAlpha *= density;
    if (tilesVisible) {
      const visiblePortals = controls.debug
        ? scoreState.portalCount
        : Math.ceil(scoreState.portalCount * density);
      if (controls.mode === 0 || controls.mode === 3) {
        const portalAlpha = controls.mode === 3
          ? config.overlay.targetScore.portalAlphaShaper
          : config.overlay.targetScore.portalAlphaMyth;
        let drawnPortals = 0;
        for (let i = 0; i < anchors.length && drawnPortals < visiblePortals; i += 1) {
          if (!targetScore.isPortal(anchors[i]?.id)) continue;
          if (suppressHandPortals && isHandPortal(anchors[i])) {
            suppressedHandPortals += 1;
            continue;
          }
          if (controls.mode === 3 && controls.shaperQuiet && !controls.debug
            && (anchors[i].kind === 'face' || isHandPortal(anchors[i]))) continue;
          drawCrop(anchors[i], i, tracking, time, controls, portalAlpha);
          drawnPortals += 1;
        }
      }
    }
    if (traceVisible) {
      for (let i = 0; i < anchors.length; i += 1) {
        const role = targetScore.roleFor(anchors[i]?.id);
        if (role === 'ambient' && !cleanStage) drawAmbientAnchor(anchors[i], i);
        else if (controls.debug) drawAnchor(anchors[i], i, controls);
      }
      if (tilesVisible || controls.debug) {
        drawHands(tracking?.hands || EMPTY_LIST, controls);
        drawPoses(tracking?.poses || EMPTY_LIST, controls);
        const showLens = tilesVisible && !(controls.mode === 3 && controls.shaperQuiet && focus?.kind === 'face' && !focus?.locked);
        drawPointerFocus(time, focus, tracking, controls, showLens);
        drawSubjectRouteEffect(time, subjectRoute);
      }
    }
    ctx.restore();
    if (traceVisible && !controls.debug && controls.trackingTiles === false && (focus?.locked || lightSource === 'off')) {
      drawPointerFocus(time, focus, tracking, controls, false);
    }
    drawLayers();
    if (canvas.dataset) {
      canvas.dataset.lightScore = Object.keys(controls.lightScore?.layers || {}).join(' ') || 'off';
      canvas.dataset.lightScoreSource = lightSource;
      canvas.dataset.frameMode = String(frameContent?.mode || 'none');
      canvas.dataset.framePhase = String(gestureFrame?.phase || 'searching');
      canvas.dataset.frameObjectId = String(frameObjectCrop?.objectId || '');
      canvas.dataset.frameObjectActive = String(Boolean(frameObjectCrop?.active));
      canvas.dataset.frameCameraLayer = String(frameContent?.cameraLayer || 'mixed');
      canvas.dataset.frameObjectState = frameObjectCrop?.featureLocked
        ? String(frameObjectCrop.featurePhase || 'idle')
        : frameObjectCrop?.held ? 'held' : (frameObjectCrop?.active ? 'live' : 'idle');
      canvas.dataset.frameFeatureId = String(frameObjectCrop?.featureId || '');
      canvas.dataset.frameFeaturePhase = String(frameObjectCrop?.featurePhase || 'idle');
      canvas.dataset.frameFeatureConfidence = Number(frameObjectCrop?.score || 0).toFixed(3);
      canvas.dataset.trackingTiles = String(controls.trackingTiles !== false);
      canvas.dataset.framePortalSuppression = suppressHandPortals ? 'hands' : 'off';
      canvas.dataset.framePortalsSuppressed = String(suppressedHandPortals);
      canvas.dataset.frameZoneCount = String(frameZone?.zones?.[0]?.memberCount || 0);
      const lastZoneEvent = frameZone?.events?.[(frameZone?.eventCount || 0) - 1];
      canvas.dataset.frameZoneEvent = String(lastZoneEvent?.type || '');
      canvas.dataset.frameZoneSource = String(lastZoneEvent?.source || '');
      canvas.dataset.pointerFocusActive = String(Boolean(pointerFocus.active && traceVisible));
      canvas.dataset.pointerFocusId = pointerFocus.active && traceVisible ? pointerFocus.id : '';
      canvas.dataset.pointerFocusKind = pointerFocus.active && traceVisible ? pointerFocus.kind : '';
      canvas.dataset.pointerFocusLabel = pointerFocus.active && traceVisible ? pointerFocus.label : '';
      canvas.dataset.pointerFocusLocked = String(Boolean(pointerFocus.active && pointerFocus.locked && traceVisible));
      const historyState = targetHistory.getState(time);
      canvas.dataset.targetHistoryCount = String(historyState.count);
      canvas.dataset.targetHistoryIndex = String(historyState.index);
      canvas.dataset.targetHistoryId = historyState.selectedId;
      canvas.dataset.targetHistoryPhase = historyState.phase;
      canvas.dataset.scoreSubjectId = scoreState.subjectId;
      canvas.dataset.scoreSubjectPhase = scoreState.subjectPhase;
      canvas.dataset.scoreAmbientCount = String(scoreState.ambientCount);
      canvas.dataset.scorePortalCount = String(scoreState.portalCount);
      canvas.dataset.subjectRouteSource = String(subjectRoute?.source || 'none');
      canvas.dataset.subjectRouteId = String(subjectRoute?.id || '');
      canvas.dataset.subjectRouteOwner = String(subjectRoute?.owner || '');
      canvas.dataset.subjectRoutePhase = String(subjectRoute?.phase || 'idle');
      canvas.dataset.subjectRouteValue = Number(subjectRoute?.value || 0).toFixed(3);
      canvas.dataset.subjectRouteVisual = Number(subjectRoute?.visual || 0).toFixed(3);
      canvas.dataset.subjectRouteSound = Number(subjectRoute?.sound || 0).toFixed(3);
    }
    if (!cleanStage) drawHud({ time, tracking, audio, controls, stats });
    drawNodeInspector(controls);
    captureMemory(time);
    publishMemoryDiagnostics();
  }

  function destroy() {
    ctx.clearRect(0, 0, width, height);
    frameArt.destroy();
    releaseMemoryRing();
    targetHistory.clear(lastFocusTime);
    targetScore.reset();
    if (canvas.dataset) {
      delete canvas.dataset.memoryFrames;
      delete canvas.dataset.memorySource;
      delete canvas.dataset.memoryAgeMs;
      delete canvas.dataset.bodyResolve;
      delete canvas.dataset.bodyResolveState;
      delete canvas.dataset.overlayDensity;
      delete canvas.dataset.frameMode;
      delete canvas.dataset.framePhase;
      delete canvas.dataset.frameObjectId;
      delete canvas.dataset.frameObjectActive;
      delete canvas.dataset.frameObjectState;
      delete canvas.dataset.frameFeatureId;
      delete canvas.dataset.frameFeaturePhase;
      delete canvas.dataset.frameFeatureConfidence;
      delete canvas.dataset.trackingTiles;
      delete canvas.dataset.framePortalSuppression;
      delete canvas.dataset.framePortalsSuppressed;
      delete canvas.dataset.frameZoneCount;
      delete canvas.dataset.frameZoneEvent;
      delete canvas.dataset.frameZoneSource;
      delete canvas.dataset.pointerFocusActive;
      delete canvas.dataset.pointerFocusId;
      delete canvas.dataset.pointerFocusKind;
      delete canvas.dataset.pointerFocusLabel;
      delete canvas.dataset.pointerFocusLocked;
      delete canvas.dataset.targetHistoryCount;
      delete canvas.dataset.targetHistoryIndex;
      delete canvas.dataset.targetHistoryId;
      delete canvas.dataset.targetHistoryPhase;
      delete canvas.dataset.scoreSubjectId;
      delete canvas.dataset.scoreSubjectPhase;
      delete canvas.dataset.scoreAmbientCount;
      delete canvas.dataset.scorePortalCount;
      delete canvas.dataset.subjectRouteSource;
      delete canvas.dataset.subjectRouteId;
      delete canvas.dataset.subjectRouteOwner;
      delete canvas.dataset.subjectRoutePhase;
      delete canvas.dataset.subjectRouteValue;
      delete canvas.dataset.subjectRouteVisual;
      delete canvas.dataset.subjectRouteSound;
    }
  }

  return {
    resize,
    render,
    destroy,
    focusPrevious: () => cycleFocus(-1),
    focusNext: () => cycleFocus(1),
    focusClear: () => clearFocusSelection(lastFocusTime),
    getFocusState: () => targetHistory.getState(lastFocusTime),
    getScoreState: () => targetScore.getState(),
    getSubjectState: () => pointerFocus,
  };
}
