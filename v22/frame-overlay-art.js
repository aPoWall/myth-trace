function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function channel(value) {
  return Math.round(clamp(value) * 255);
}

function rgba(color, alpha) {
  return `rgba(${channel(color?.[0])},${channel(color?.[1])},${channel(color?.[2])},${clamp(alpha)})`;
}

function noise(seed, index) {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function traceQuad(ctx, quad, width, height, box) {
  ctx.beginPath();
  if (Array.isArray(quad) && quad.length >= 4) {
    ctx.moveTo(clamp(quad[0]?.x) * width, clamp(quad[0]?.y) * height);
    for (let index = 1; index < 4; index += 1) {
      ctx.lineTo(clamp(quad[index]?.x) * width, clamp(quad[index]?.y) * height);
    }
    ctx.closePath();
    return;
  }
  ctx.rect(box.x, box.y, box.w, box.h);
}

function drawBanana(ctx, box, recipe, phase) {
  const pulse = 1 + Math.sin(phase * 2.1) * recipe.motion.pulse * 0.06;
  const cx = box.x + box.w * 0.5;
  const cy = box.y + box.h * 0.53;
  const rx = box.w * 0.3 * pulse;
  const ry = box.h * 0.27 * pulse;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.38 + Math.sin(phase * 0.7) * recipe.motion.spin * 0.12);
  ctx.beginPath();
  ctx.moveTo(-rx, -ry * 0.2);
  ctx.bezierCurveTo(-rx * 0.45, ry * 1.15, rx * 0.7, ry * 1.05, rx, -ry * 0.18);
  ctx.bezierCurveTo(rx * 0.52, ry * 0.53, -rx * 0.3, ry * 0.42, -rx, -ry * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-rx * 0.98, -ry * 0.16);
  ctx.lineTo(-rx * 1.08, -ry * 0.42);
  ctx.moveTo(rx * 0.98, -ry * 0.16);
  ctx.lineTo(rx * 1.08, -ry * 0.38);
  ctx.stroke();
  ctx.restore();
}

function drawEye(ctx, box, phase) {
  const cx = box.x + box.w * 0.5;
  const cy = box.y + box.h * 0.5;
  ctx.beginPath();
  ctx.moveTo(box.x + box.w * 0.15, cy);
  ctx.quadraticCurveTo(cx, box.y + box.h * 0.2, box.x + box.w * 0.85, cy);
  ctx.quadraticCurveTo(cx, box.y + box.h * 0.8, box.x + box.w * 0.15, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, Math.min(box.w, box.h) * (0.08 + Math.sin(phase) * 0.01), 0, Math.PI * 2);
  ctx.fill();
}

function drawPortal(ctx, box, phase) {
  const cx = box.x + box.w * 0.5;
  const cy = box.y + box.h * 0.5;
  const maximum = Math.min(box.w, box.h) * 0.42;
  for (let index = 0; index < 7; index += 1) {
    const radius = maximum * ((index + 1) / 7) * (1 + Math.sin(phase + index) * 0.025);
    ctx.beginPath();
    ctx.ellipse(cx, cy, radius, radius * (0.7 + index * 0.025), phase * 0.06, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawFlower(ctx, box, phase) {
  const cx = box.x + box.w * 0.5;
  const cy = box.y + box.h * 0.5;
  const radius = Math.min(box.w, box.h) * 0.25;
  for (let index = 0; index < 8; index += 1) {
    const angle = phase * 0.08 + index * Math.PI * 0.25;
    ctx.beginPath();
    ctx.ellipse(
      cx + Math.cos(angle) * radius * 0.72,
      cy + Math.sin(angle) * radius * 0.72,
      radius * 0.46,
      radius * 0.18,
      angle,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }
}

function drawPropeller(ctx, box, recipe, phase) {
  const cx = box.x + box.w * 0.5;
  const cy = box.y + box.h * 0.5;
  const radius = Math.min(box.w, box.h) * 0.31;
  const spin = phase * (0.75 + recipe.motion.spin * 2.6);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(spin);
  for (let index = 0; index < 4; index += 1) {
    ctx.save();
    ctx.rotate(index * Math.PI * 0.5);
    ctx.beginPath();
    ctx.ellipse(radius * 0.47, 0, radius * 0.68, radius * 0.18, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawField(ctx, box, recipe, phase) {
  const count = Math.round(12 + recipe.density * 24);
  for (let index = 0; index < count; index += 1) {
    const a = noise(recipe.seed, index * 3);
    const b = noise(recipe.seed, index * 3 + 1);
    const c = noise(recipe.seed, index * 3 + 2);
    const drift = recipe.motion.drift * Math.sin(phase * (0.4 + c) + c * 9);
    const x = box.x + ((a + drift * 0.08 + 1) % 1) * box.w;
    const y = box.y + ((b + Math.cos(phase * 0.3 + a * 8) * 0.035 + 1) % 1) * box.h;
    const length = Math.min(box.w, box.h) * (0.018 + c * 0.06);
    ctx.beginPath();
    ctx.moveTo(x - length, y);
    ctx.quadraticCurveTo(x, y - length * (0.5 + a), x + length, y + length * (b - 0.5));
    ctx.stroke();
  }
}

function drawPrompt(ctx, box, content, sceneTime, generatedBackground) {
  const recipe = content.recipe;
  if (!recipe) return;
  const phase = sceneTime * 0.001 * recipe.motion.speed;
  const primary = recipe.colors?.primary || [0.91, 0.86, 0.76];
  const secondary = recipe.colors?.secondary || [0.42, 0.19, 0.11];
  const image = generatedBackground?.image;
  if (image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
    const scale = Math.max(box.w / image.naturalWidth, box.h / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    ctx.save();
    ctx.globalAlpha *= 0.64 * clamp(content.opacity);
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(image, box.x + (box.w - width) * 0.5, box.y + (box.h - height) * 0.5, width, height);
    ctx.restore();
  }
  ctx.fillStyle = rgba(recipe.colors?.field || [0.025, 0.022, 0.02], 0.62 * content.opacity);
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeStyle = rgba(primary, (0.24 + recipe.intensity * 0.5) * content.opacity);
  ctx.fillStyle = rgba(secondary, (0.18 + recipe.intensity * 0.52) * content.opacity);
  ctx.lineWidth = 1.1 + recipe.intensity * 1.7;
  drawField(ctx, box, recipe, phase);
  ctx.strokeStyle = rgba(primary, (0.55 + recipe.intensity * 0.4) * content.opacity);
  ctx.fillStyle = rgba(secondary, (0.4 + recipe.intensity * 0.5) * content.opacity);
  if (recipe.subject === 'banana') drawBanana(ctx, box, recipe, phase);
  else if (recipe.subject === 'eye' || recipe.subject === 'face') drawEye(ctx, box, phase);
  else if (recipe.subject === 'portal') drawPortal(ctx, box, phase);
  else if (recipe.subject === 'flower') drawFlower(ctx, box, phase);
  else if (recipe.subject === 'propeller') drawPropeller(ctx, box, recipe, phase);
  else drawPortal(ctx, box, phase * 0.7);
}

function drawExercise(ctx, box, content) {
  const exercise = content.exerciseTarget || {};
  const cx = box.x + box.w * 0.5;
  const cy = box.y + box.h * 0.5;
  const radius = Math.min(box.w, box.h) * (0.12 + clamp(exercise.progress) * 0.08);
  ctx.strokeStyle = exercise.success ? 'rgba(245,196,74,.95)' : 'rgba(232,238,243,.72)';
  ctx.lineWidth = exercise.success ? 3 : 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * clamp(exercise.progress));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - radius * 1.35, cy);
  ctx.lineTo(cx + radius * 1.35, cy);
  ctx.moveTo(cx, cy - radius * 1.35);
  ctx.lineTo(cx, cy + radius * 1.35);
  ctx.stroke();
}

function focusLabel(crop) {
  if (crop?.sourceKind === 'face' && crop?.focusDetail === 'face-edge') return 'FACE EDGE';
  if (crop?.sourceKind === 'face') return 'FACE';
  if (crop?.sourceKind === 'pose') return 'PERSON';
  return String(crop?.objectClass || 'OBJECT').toUpperCase();
}

function drawFocusBracket(ctx, crop, width, height, alpha) {
  if (!crop?.active || !crop?.displayBBox) return;
  const source = crop.displayBBox;
  const x = clamp(source.x) * width;
  const y = clamp(source.y) * height;
  const w = clamp(source.w ?? source.width) * width;
  const h = clamp(source.h ?? source.height) * height;
  if (w < 2 || h < 2) return;
  const corner = Math.max(7, Math.min(w, h) * 0.22);
  ctx.save();
  ctx.strokeStyle = crop.held
    ? `rgba(214,174,104,${clamp(alpha) * 0.78})`
    : `rgba(240,235,219,${clamp(alpha)})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + corner, y); ctx.lineTo(x, y); ctx.lineTo(x, y + corner);
  ctx.moveTo(x + w - corner, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + corner);
  ctx.moveTo(x, y + h - corner); ctx.lineTo(x, y + h); ctx.lineTo(x + corner, y + h);
  ctx.moveTo(x + w - corner, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - corner);
  ctx.stroke();
  ctx.restore();
}

function drawObjectCrop(ctx, box, content, crop, video, sceneTime, focus) {
  ctx.fillStyle = `rgba(16,14,12,${0.82 * clamp(content.opacity)})`;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  const source = crop?.sourceBBox;
  const ready = crop?.active
    && source
    && video
    && video.readyState >= 2
    && video.videoWidth > 0
    && video.videoHeight > 0;
  if (!ready) {
    ctx.strokeStyle = `rgba(220,214,201,${0.28 * clamp(content.opacity)})`;
    ctx.lineWidth = 1;
    drawField(ctx, box, content.recipe, sceneTime * 0.001);
    return;
  }

  const sx = clamp(source.x) * video.videoWidth;
  const sy = clamp(source.y) * video.videoHeight;
  const sw = Math.max(1, clamp(source.w ?? source.width) * video.videoWidth);
  const sh = Math.max(1, clamp(source.h ?? source.height) * video.videoHeight);
  const scale = content.fit === 'cover'
    ? Math.max(box.w / sw, box.h / sh)
    : Math.min(box.w / sw, box.h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = box.x + (box.w - dw) * 0.5;
  const dy = box.y + (box.h - dh) * 0.5;
  const contrast = Math.max(1, Number(focus?.contrast) || 1.42) + clamp(content.energy) * 0.22;
  const brightness = 1 + Math.max(0, Number(focus?.brightness) || 0.12);
  ctx.save();
  ctx.globalAlpha *= clamp(content.opacity);
  ctx.filter = `contrast(${contrast}) brightness(${brightness}) saturate(.68)`;
  if (crop?.mirrored) {
    // sourceBBox is in raw camera coordinates; flip once here to match the stage.
    ctx.translate(box.x + box.w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, box.x + box.w - dx - dw, dy, dw, dh);
  } else {
    ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
  }
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'screen';
  ctx.strokeStyle = `rgba(228,220,204,${0.14 + clamp(content.energy) * 0.18})`;
  ctx.lineWidth = 1;
  drawField(ctx, box, content.recipe, sceneTime * 0.001);
  const corner = Math.max(7, Math.min(box.w, box.h) * 0.13);
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = crop?.held ? 'rgba(214,174,104,.78)' : 'rgba(240,235,219,.88)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(box.x + corner, box.y); ctx.lineTo(box.x, box.y); ctx.lineTo(box.x, box.y + corner);
  ctx.moveTo(box.x + box.w - corner, box.y); ctx.lineTo(box.x + box.w, box.y); ctx.lineTo(box.x + box.w, box.y + corner);
  ctx.moveTo(box.x, box.y + box.h - corner); ctx.lineTo(box.x, box.y + box.h); ctx.lineTo(box.x + corner, box.y + box.h);
  ctx.moveTo(box.x + box.w - corner, box.y + box.h); ctx.lineTo(box.x + box.w, box.y + box.h); ctx.lineTo(box.x + box.w, box.y + box.h - corner);
  ctx.stroke();
  ctx.fillStyle = 'rgba(5,6,9,.66)';
  ctx.fillRect(box.x, Math.max(box.y, box.y + 4), Math.min(box.w, 210), 14);
  ctx.fillStyle = crop?.held ? 'rgba(224,190,125,.9)' : 'rgba(240,235,219,.9)';
  ctx.font = '8px "SFMono-Regular", Menlo, monospace';
  ctx.fillText(`FOCUS · ${focusLabel(crop)} · ${crop?.held ? 'HELD' : 'LIVE'}`, box.x + 4, box.y + 14);
  ctx.restore();
}

function drawFrameZones(ctx, width, height, content, frameZone) {
  const entities = Array.isArray(frameZone?.entities) ? frameZone.entities : [];
  const count = Math.min(Number(frameZone?.entityCount) || 0, entities.length);
  for (let index = 0; index < count; index += 1) {
    const entity = entities[index];
    if (!entity?.inside) continue;
    const sourceBox = entity.bbox || {};
    const x = clamp(sourceBox.x) * width;
    const y = clamp(sourceBox.y) * height;
    const w = clamp(sourceBox.w ?? sourceBox.width) * width;
    const h = clamp(sourceBox.h ?? sourceBox.height) * height;
    if (w < 2 || h < 2) continue;
    const progress = clamp(entity.dwellProgress);
    const alpha = clamp(content.secondaryOpacity * (entity.missing ? 0.34 : 0.82));
    const warm = entity.source === 'body' ? [0.86, 0.42, 0.2] : [0.9, 0.86, 0.76];
    const corner = Math.max(5, Math.min(w, h) * 0.16);
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    ctx.save();
    ctx.strokeStyle = rgba(warm, alpha);
    ctx.fillStyle = rgba(warm, alpha * 0.12);
    ctx.lineWidth = 1 + progress * 1.5;
    if (entity.missing) ctx.setLineDash([4, 5]);
    ctx.fillRect(x, y, w, h);
    ctx.beginPath();
    ctx.moveTo(x + corner, y); ctx.lineTo(x, y); ctx.lineTo(x, y + corner);
    ctx.moveTo(x + w - corner, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + corner);
    ctx.moveTo(x + w, y + h - corner); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - corner, y + h);
    ctx.moveTo(x + corner, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - corner);
    ctx.stroke();
    ctx.setLineDash([]);
    const ring = Math.max(6, Math.min(w, h) * 0.12);
    ctx.beginPath();
    ctx.arc(cx, cy, ring, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * progress);
    ctx.stroke();
    ctx.fillStyle = 'rgba(5,6,9,.72)';
    ctx.fillRect(x, Math.max(0, y - 14), Math.min(w, 150), 14);
    ctx.fillStyle = rgba(warm, alpha);
    ctx.font = '8px "SFMono-Regular", Menlo, monospace';
    ctx.fillText(`${String(entity.source).toUpperCase()} · ${String(entity.label).toUpperCase()} · ${Math.round(progress * 100)}%`, x + 3, Math.max(9, y - 4));
    ctx.restore();
  }
}

export function createFrameOverlayArt(options = {}) {
  const lineWidth = Math.max(0.5, Number(options.lineWidth) || 1.2);
  const focus = Object.freeze({
    contrast: Math.max(1, Number(options.focusContrast) || 1.42),
    brightness: Math.max(0, Number(options.focusBrightness) || 0.12),
    bracketAlpha: clamp(Number(options.focusBracketAlpha) || 0.78),
  });
  const paintCapacity = Math.max(0, Math.round(Number(options.paint?.trailPoints) || 0));
  const paintSampleIntervalMs = Math.max(0, Number(options.paint?.sampleIntervalMs) || 0);
  const paintLineWidth = Math.max(0.5, Number(options.paint?.lineWidth) || lineWidth);
  const paintAlpha = clamp(options.paint?.alpha);
  const paintX = new Float32Array(paintCapacity);
  const paintY = new Float32Array(paintCapacity);
  const paintBreaks = new Uint8Array(paintCapacity);
  const video = options.video || null;
  let sceneTime = 0;
  let lastTime = null;
  let paintStart = 0;
  let paintCount = 0;
  let paintLastSampleAt = -Infinity;
  let paintBreakPending = true;
  let destroyed = false;

  function appendPaintPoint(xValue, yValue, time) {
    if (paintCapacity < 2) return;
    if (time < paintLastSampleAt) {
      paintLastSampleAt = -Infinity;
      paintBreakPending = true;
    }
    if (time - paintLastSampleAt < paintSampleIntervalMs) return;
    const x = clamp(xValue);
    const y = clamp(yValue);
    let index = (paintStart + paintCount) % paintCapacity;
    if (paintCount === paintCapacity) {
      index = paintStart;
      paintStart = (paintStart + 1) % paintCapacity;
    } else {
      paintCount += 1;
    }
    paintX[index] = x;
    paintY[index] = y;
    paintBreaks[index] = paintBreakPending ? 1 : 0;
    paintBreakPending = false;
    paintLastSampleAt = time;
  }

  function drawPaint(ctx, width, height, box, content) {
    if (paintCapacity < 2) {
      drawField(ctx, box, content.recipe, 0);
      return;
    }
    const primary = content.recipe?.colors?.primary || [0.91, 0.86, 0.76];
    ctx.globalAlpha *= clamp(content.opacity);
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = rgba(primary, paintAlpha);
    ctx.fillStyle = rgba(primary, paintAlpha);
    ctx.lineWidth = paintLineWidth + clamp(content.energy) * lineWidth;
    if (paintCount === 1) {
      ctx.beginPath();
      ctx.arc(paintX[paintStart] * width, paintY[paintStart] * height, ctx.lineWidth, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    for (let offset = 0; offset < paintCount; offset += 1) {
      const index = (paintStart + offset) % paintCapacity;
      const x = paintX[index] * width;
      const y = paintY[index] * height;
      if (offset === 0 || paintBreaks[index]) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function draw({ ctx, width, height, time = 0, frame, content, objectCrop, frameZone, generatedBackground } = {}) {
    if (destroyed || !ctx || !content?.visible || !frame) return false;
    const safeWidth = Math.max(1, Number(width) || 1);
    const safeHeight = Math.max(1, Number(height) || 1);
    const delta = lastTime === null ? 0 : Math.max(0, Math.min(100, time - lastTime));
    lastTime = time;
    if (content.promptShader?.animate) sceneTime += delta;

    const stageFill = content.stageFill === true;
    const normalizedBox = stageFill
      ? { x: 0, y: 0, w: 1, h: 1 }
      : content.bbox || frame.bbox || {};
    const box = {
      x: clamp(normalizedBox.x) * safeWidth,
      y: clamp(normalizedBox.y) * safeHeight,
      w: clamp(normalizedBox.w ?? normalizedBox.width) * safeWidth,
      h: clamp(normalizedBox.h ?? normalizedBox.height) * safeHeight,
    };
    if (box.w < 2 || box.h < 2) return false;

    if (content.mode === 'paint' && content.paint?.accumulate) {
      const centerX = frame.center?.x
        ?? clamp(normalizedBox.x) + clamp(normalizedBox.w ?? normalizedBox.width) * 0.5;
      const centerY = frame.center?.y
        ?? clamp(normalizedBox.y) + clamp(normalizedBox.h ?? normalizedBox.height) * 0.5;
      appendPaintPoint(centerX, centerY, time);
    } else {
      paintBreakPending = true;
    }

    ctx.save();
    if (stageFill) ctx.rect(0, 0, safeWidth, safeHeight);
    else traceQuad(ctx, frame.quad, safeWidth, safeHeight, box);
    ctx.clip();
    ctx.globalAlpha *= clamp(content.visualRoute ?? 1);
    if (content.mode === 'prompt-shader') drawPrompt(ctx, box, content, sceneTime, generatedBackground);
    else if (content.mode === 'exercise-target') drawExercise(ctx, box, content);
    else if (content.mode === 'paint') drawPaint(ctx, safeWidth, safeHeight, box, content);
    else if (content.mode === 'object') {
      drawObjectCrop(ctx, box, content, objectCrop, video, sceneTime, focus);
    }
    drawFrameZones(ctx, safeWidth, safeHeight, content, frameZone);
    ctx.restore();
    if (content.mode === 'object') {
      drawFocusBracket(ctx, objectCrop, safeWidth, safeHeight,
        focus.bracketAlpha * clamp(content.visualRoute ?? 1));
    }

    ctx.save();
    ctx.strokeStyle = content.locked ? 'rgba(245,196,74,.84)' : 'rgba(235,240,244,.78)';
    ctx.lineWidth = lineWidth + clamp(content.energy) * 1.4;
    if (content.phase === 'arming') ctx.setLineDash([5, 8]);
    traceQuad(ctx, frame.quad, safeWidth, safeHeight, box);
    ctx.stroke();
    ctx.fillStyle = 'rgba(5,6,9,.76)';
    ctx.fillRect(box.x, Math.max(0, box.y - 16), Math.min(box.w, 230), 16);
    ctx.fillStyle = 'rgba(235,240,244,.82)';
    ctx.font = '9px "SFMono-Regular", Menlo, monospace';
    ctx.fillText(`FRAME · ${String(content.mode).toUpperCase()} · ${String(content.phase).toUpperCase()}`, box.x + 4, Math.max(10, box.y - 5));
    ctx.restore();
    return true;
  }

  function reset() {
    sceneTime = 0;
    lastTime = null;
    paintStart = 0;
    paintCount = 0;
    paintLastSampleAt = -Infinity;
    paintBreakPending = true;
    paintX.fill(0);
    paintY.fill(0);
    paintBreaks.fill(0);
  }

  function snapshot() {
    return Object.freeze({
      destroyed,
      sceneTime,
      lastTime,
      paint: Object.freeze({
        capacity: paintCapacity,
        count: paintCount,
        start: paintStart,
        lastSampleAt: paintLastSampleAt,
      }),
    });
  }

  function destroy() {
    reset();
    destroyed = true;
  }

  return Object.freeze({ draw, reset, snapshot, destroy });
}
