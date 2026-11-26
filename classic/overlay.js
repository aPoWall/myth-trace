import { MODES, clamp } from './config.js';
import { createFrameOverlayArt } from './frame-overlay-art.js';

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

export function createOverlay({ canvas, video, feedbackCanvas, config }) {
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  const frameArt = createFrameOverlayArt({
    lineWidth: config.overlay.lineWidth,
    focusContrast: config.frameContent?.focusContrast,
    focusBrightness: config.frameContent?.focusBrightness,
    focusBracketAlpha: config.frameContent?.focus?.bracketAlpha,
    video,
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

  function drawCrop(anchor, index, tracking, time, controls) {
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
        const base = Math.min(width, height) * (0.075 + idPhase * 0.035) * pulse;
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
        ctx.globalAlpha *= controls.mode === 3 ? 0.92 : 0.58;
        ctx.filter = controls.mode === 0 ? 'grayscale(1) contrast(2.2) brightness(1.18)' : 'grayscale(1) contrast(1.7)';
        ctx.drawImage(memoryCanvas, sx, sy, sourceSize, sourceSize, dx, dy, dw, dh);
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = `rgba(235,240,244,${0.35 + anchor.confidence * 0.45})`;
        ctx.lineWidth = 1;
        ctx.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);
        ctx.fillStyle = 'rgba(5,6,9,.82)';
        ctx.fillRect(dx, dy - 14, Math.min(dw, 154), 14);
        ctx.fillStyle = 'rgba(236,241,245,.78)';
        ctx.font = '9px "SFMono-Regular", Menlo, monospace';
        ctx.fillText(
          `${anchor.kind}.${String(index).padStart(2, '0')} · ${pct(anchor.confidence)} · T-${(memoryAge / 1000).toFixed(1)}s`,
          dx + 4,
          dy - 4,
        );
        ctx.restore();
        line(screenX * width, screenY * height, dx + dw * 0.5, dy + dh * 0.5, 0.16, CROP_DASH);
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
    const base = Math.min(width, height) * (0.075 + idPhase * 0.035) * pulse;
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
    ctx.globalAlpha *= controls.mode === 3 ? 0.92 : 0.58;
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
    ctx.strokeStyle = `rgba(235,240,244,${0.35 + anchor.confidence * 0.45})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(dx + 0.5, dy + 0.5, dw - 1, dh - 1);
    ctx.fillStyle = 'rgba(5,6,9,.82)';
    ctx.fillRect(dx, dy - 14, Math.min(dw, 122), 14);
    ctx.fillStyle = 'rgba(236,241,245,.78)';
    ctx.font = '9px "SFMono-Regular", Menlo, monospace';
    ctx.fillText(`${anchor.kind}.${String(index).padStart(2, '0')} · ${pct(anchor.confidence)}`, dx + 4, dy - 4);
    ctx.restore();
    line(screenX * width, screenY * height, dx + dw * 0.5, dy + dh * 0.5, 0.16, CROP_DASH);
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

  function drawFaces(faces, controls) {
    for (const face of faces) {
      if (!face?.bbox) continue;
      const confidence = clamp(face.score);
      if (!confidence) continue;
      const x = clamp(face.bbox.x) * width;
      const y = clamp(face.bbox.y) * height;
      const w = clamp(face.bbox.w ?? face.bbox.width) * width;
      const h = clamp(face.bbox.h ?? face.bbox.height) * height;
      if (w < 2 || h < 2) continue;
      const alpha = confidence * (controls.debug ? 0.58 : 0.3);
      ctx.save();
      ctx.strokeStyle = `rgba(235,220,185,${alpha})`;
      ctx.lineWidth = config.overlay.lineWidth;
      ctx.strokeRect(x, y, w, h);
      if (controls.debug && Array.isArray(face.landmarks)) {
        ctx.fillStyle = `rgba(235,220,185,${alpha})`;
        for (const index of [1, 13, 14, 33, 263, 61, 291]) {
          const point = face.landmarks[index];
          if (!point) continue;
          ctx.fillRect(clamp(point.x) * width - 1, clamp(point.y) * height - 1, 2, 2);
        }
      }
      ctx.restore();
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
    const status = `${tracking?.status || 'idle'} · ${hands} hands · ${poses} bodies · ${faces} faces · ${objects} objects · ${fps} fps`;
    if (time - lastLabelsAt >= config.overlay.labelRateMs) {
      cachedStatus = status;
      lastLabelsAt = time;
    }

    ctx.save();
    ctx.textBaseline = 'top';
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

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(225,231,236,.58)';
    ctx.fillText(`EXECUTING ${mode.code.toUpperCase()}`, width - 22, 24);
    ctx.fillText(new Date().toISOString().slice(11, 23), width - 22, 40);
    ctx.restore();
  }

  function render({
    time = performance.now(), tracking, audio, controls, stats,
    gestureFrame, frameContent, frameObjectCrop, frameZone, generatedBackground,
  }) {
    memoryUsedThisFrame = false;
    memoryAgeThisFrame = 0;
    ctx.clearRect(0, 0, width, height);
    const density = updateBodyResolve(time, tracking, controls.debug);
    ctx.save();
    ctx.globalAlpha *= density;
    drawFieldGrid(tracking, controls);
    const anchors = tracking?.anchors || EMPTY_LIST;
    const traceVisible = controls.trace !== false;
    const tilesVisible = traceVisible && controls.trackingTiles !== false;
    if (tilesVisible) {
      const maxPortals = Math.min(config.overlay.maxPortals, anchors.length);
      const visiblePortals = controls.debug ? maxPortals : Math.ceil(maxPortals * density);
      if (controls.mode === 0 || controls.mode === 3) {
        for (let i = 0; i < visiblePortals; i += 1) drawCrop(anchors[i], i, tracking, time, controls);
      }
    }
    if (traceVisible) {
      for (let i = 0; i < anchors.length; i += 1) drawAnchor(anchors[i], i, controls);
      drawHands(tracking?.hands || EMPTY_LIST, controls);
      drawPoses(tracking?.poses || EMPTY_LIST, controls);
      drawFaces(tracking?.faces || EMPTY_LIST, controls);
    }
    ctx.restore();
    frameArt.draw({
      ctx, width, height, time, frame: gestureFrame,
      content: frameContent, objectCrop: frameObjectCrop, frameZone, generatedBackground,
    });
    if (canvas.dataset) {
      canvas.dataset.frameMode = String(frameContent?.mode || 'none');
      canvas.dataset.framePhase = String(gestureFrame?.phase || 'searching');
      canvas.dataset.frameObjectId = String(frameObjectCrop?.objectId || '');
      canvas.dataset.frameObjectActive = String(Boolean(frameObjectCrop?.active));
      canvas.dataset.frameObjectState = frameObjectCrop?.held ? 'held' : (frameObjectCrop?.active ? 'live' : 'idle');
      canvas.dataset.trackingTiles = String(controls.trackingTiles !== false);
      canvas.dataset.frameZoneCount = String(frameZone?.zones?.[0]?.memberCount || 0);
      const lastZoneEvent = frameZone?.events?.[(frameZone?.eventCount || 0) - 1];
      canvas.dataset.frameZoneEvent = String(lastZoneEvent?.type || '');
      canvas.dataset.frameZoneSource = String(lastZoneEvent?.source || '');
    }
    drawHud({ time, tracking, audio, controls, stats });
    captureMemory(time);
    publishMemoryDiagnostics();
  }

  function destroy() {
    ctx.clearRect(0, 0, width, height);
    frameArt.destroy();
    releaseMemoryRing();
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
      delete canvas.dataset.trackingTiles;
    }
  }

  return { resize, render, destroy };
}
