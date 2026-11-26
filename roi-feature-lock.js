const DEFAULTS = Object.freeze({
  searchRadius: 6,
  minTemplateEdge: 6,
  minCorrelation: 0.76,
  textureFloor: 0.12,
  lossMs: 1200,
});

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value) || 0));

function validBox(box) {
  const width = Number(box?.w ?? box?.width);
  const height = Number(box?.h ?? box?.height);
  return Number.isFinite(box?.x) && Number.isFinite(box?.y)
    && Number.isFinite(width) && Number.isFinite(height)
    && width > 0 && height > 0;
}

function luminance(pixels, index) {
  const offset = index * 4;
  return (pixels[offset] * 77 + pixels[offset + 1] * 150 + pixels[offset + 2] * 29) >> 8;
}

export function createRoiFeatureLock(options = {}) {
  const searchRadius = Math.max(0, Math.min(16, Math.round(Number(options.searchRadius) || DEFAULTS.searchRadius)));
  const minTemplateEdge = Math.max(3, Math.min(32, Math.round(Number(options.minTemplateEdge) || DEFAULTS.minTemplateEdge)));
  const minCorrelation = clamp(options.minCorrelation ?? DEFAULTS.minCorrelation, 0.2, 0.99);
  const textureFloor = clamp(options.textureFloor ?? DEFAULTS.textureFloor, 0.01, 0.8);
  const lossMs = Math.max(100, Math.min(10_000, Number(options.lossMs) || DEFAULTS.lossMs));
  const bbox = { x: 0, y: 0, w: 0, h: 0 };
  const state = {
    phase: 'idle', active: false, held: false, featureId: '', confidence: 0,
    correlation: 0, texture: 0, capturedAt: 0, lastSeen: 0, missingMs: 0,
    bbox, templateWidth: 0, templateHeight: 0,
  };
  let destroyed = false;
  let lastTimestamp = 0;
  let generation = 0;
  let template = null;
  let templateEnergy = 0;
  let templateX = 0;
  let templateY = 0;
  let templateWidth = 0;
  let templateHeight = 0;
  let lastMatchConfidence = 0;
  let lastAuthorPhase = 'idle';

  function clearTemplate(phase = 'idle') {
    template = null;
    templateEnergy = 0;
    templateX = 0;
    templateY = 0;
    templateWidth = 0;
    templateHeight = 0;
    lastMatchConfidence = 0;
    state.phase = phase;
    state.active = false;
    state.held = false;
    state.featureId = '';
    state.confidence = 0;
    state.correlation = 0;
    state.texture = 0;
    state.capturedAt = 0;
    state.lastSeen = 0;
    state.missingMs = 0;
    state.templateWidth = 0;
    state.templateHeight = 0;
    bbox.x = 0; bbox.y = 0; bbox.w = 0; bbox.h = 0;
  }

  function validPixels(pixels, width, height) {
    return pixels && Number.isInteger(width) && Number.isInteger(height)
      && width > 0 && height > 0 && pixels.length >= width * height * 4;
  }

  function capture(pixels, width, height, authorBox, timestamp) {
    if (!validPixels(pixels, width, height) || !validBox(authorBox)) return false;
    const left = Math.max(0, Math.min(width - 1, Math.floor(clamp(authorBox.x) * width)));
    const top = Math.max(0, Math.min(height - 1, Math.floor(clamp(authorBox.y) * height)));
    const right = Math.max(left + 1, Math.min(width, Math.ceil(clamp(Number(authorBox.x) + Number(authorBox.w ?? authorBox.width)) * width)));
    const bottom = Math.max(top + 1, Math.min(height, Math.ceil(clamp(Number(authorBox.y) + Number(authorBox.h ?? authorBox.height)) * height)));
    const candidateWidth = right - left;
    const candidateHeight = bottom - top;
    if (candidateWidth < minTemplateEdge || candidateHeight < minTemplateEdge) {
      state.phase = 'weak';
      return false;
    }
    const count = candidateWidth * candidateHeight;
    let sum = 0;
    let sumSquares = 0;
    for (let y = 0; y < candidateHeight; y += 1) {
      for (let x = 0; x < candidateWidth; x += 1) {
        const value = luminance(pixels, (top + y) * width + left + x);
        sum += value;
        sumSquares += value * value;
      }
    }
    const mean = sum / count;
    const energy = Math.max(0, sumSquares - (sum * sum) / count);
    const texture = clamp(Math.sqrt(energy / count) / 64);
    if (texture < textureFloor || energy <= 0) {
      state.phase = 'weak';
      state.texture = texture;
      return false;
    }
    const nextTemplate = new Int16Array(count);
    let index = 0;
    for (let y = 0; y < candidateHeight; y += 1) {
      for (let x = 0; x < candidateWidth; x += 1) {
        nextTemplate[index] = Math.round(luminance(pixels, (top + y) * width + left + x) - mean);
        index += 1;
      }
    }
    template = nextTemplate;
    templateEnergy = energy;
    templateX = left;
    templateY = top;
    templateWidth = candidateWidth;
    templateHeight = candidateHeight;
    state.phase = 'live';
    state.active = true;
    state.held = false;
    state.featureId = `roi-feature:${++generation}`;
    state.confidence = 1;
    state.correlation = 1;
    state.texture = texture;
    state.capturedAt = timestamp;
    state.lastSeen = timestamp;
    state.missingMs = 0;
    state.templateWidth = candidateWidth;
    state.templateHeight = candidateHeight;
    bbox.x = left / width;
    bbox.y = top / height;
    bbox.w = candidateWidth / width;
    bbox.h = candidateHeight / height;
    lastMatchConfidence = 1;
    return true;
  }

  function match(pixels, width, height, timestamp) {
    if (!template || !validPixels(pixels, width, height)
      || templateWidth > width || templateHeight > height) return false;
    let bestCorrelation = -1;
    let bestX = templateX;
    let bestY = templateY;
    const minX = Math.max(0, templateX - searchRadius);
    const maxX = Math.min(width - templateWidth, templateX + searchRadius);
    const minY = Math.max(0, templateY - searchRadius);
    const maxY = Math.min(height - templateHeight, templateY + searchRadius);
    const count = templateWidth * templateHeight;
    for (let candidateY = minY; candidateY <= maxY; candidateY += 1) {
      for (let candidateX = minX; candidateX <= maxX; candidateX += 1) {
        let sum = 0;
        let sumSquares = 0;
        let dot = 0;
        let index = 0;
        for (let y = 0; y < templateHeight; y += 1) {
          const row = (candidateY + y) * width + candidateX;
          for (let x = 0; x < templateWidth; x += 1) {
            const value = luminance(pixels, row + x);
            sum += value;
            sumSquares += value * value;
            dot += template[index] * value;
            index += 1;
          }
        }
        const candidateEnergy = Math.max(0, sumSquares - (sum * sum) / count);
        if (candidateEnergy <= 0) continue;
        const correlation = dot / Math.sqrt(templateEnergy * candidateEnergy);
        if (correlation <= bestCorrelation) continue;
        bestCorrelation = correlation;
        bestX = candidateX;
        bestY = candidateY;
      }
    }
    state.correlation = clamp((bestCorrelation + 1) * 0.5);
    if (bestCorrelation < minCorrelation) return false;
    templateX = bestX;
    templateY = bestY;
    bbox.x = bestX / width;
    bbox.y = bestY / height;
    bbox.w = templateWidth / width;
    bbox.h = templateHeight / height;
    const normalizedMatch = clamp((bestCorrelation - minCorrelation) / (1 - minCorrelation));
    const confidence = clamp((0.55 + normalizedMatch * 0.45) * (0.72 + state.texture * 0.28));
    state.phase = 'live';
    state.active = true;
    state.held = false;
    state.confidence = confidence;
    state.lastSeen = timestamp;
    state.missingMs = 0;
    lastMatchConfidence = confidence;
    return true;
  }

  function miss(timestamp) {
    if (!template || state.phase === 'lost') return state;
    state.missingMs = Math.max(0, timestamp - state.lastSeen);
    const remaining = clamp(1 - state.missingMs / lossMs);
    state.confidence = clamp(lastMatchConfidence * remaining);
    state.held = state.missingMs > 0 && state.missingMs < lossMs;
    state.active = state.missingMs < lossMs;
    state.phase = state.active ? 'held' : 'lost';
    if (!state.active) state.confidence = 0;
    return state;
  }

  function update(input = {}) {
    if (destroyed) return state;
    const timestamp = Math.max(lastTimestamp, Number(input.timestamp) || lastTimestamp);
    lastTimestamp = timestamp;
    const author = input.author || {};
    const authorPhase = String(author.phase || 'idle');
    if (input.enabled === false) {
      clearTemplate('idle');
      lastAuthorPhase = authorPhase;
      return state;
    }
    if (authorPhase === 'arming' && lastAuthorPhase !== 'arming') clearTemplate('arming');
    lastAuthorPhase = authorPhase;
    if (!template && author.confirmed === true && authorPhase === 'frozen') {
      capture(input.pixels, Number(input.width), Number(input.height), author.bbox, timestamp);
      return state;
    }
    if (!template) {
      if (authorPhase === 'arming') state.phase = 'arming';
      else if (author.confirmed === true) state.phase = state.phase === 'weak' ? 'weak' : 'waiting';
      else if (state.phase !== 'weak') state.phase = 'idle';
      return state;
    }
    if (state.phase === 'lost') return state;
    if (!match(input.pixels, Number(input.width), Number(input.height), timestamp)) miss(timestamp);
    return state;
  }

  function reset(timestamp = lastTimestamp) {
    if (destroyed) return state;
    lastTimestamp = Math.max(0, Number(timestamp) || 0);
    lastAuthorPhase = 'idle';
    clearTemplate('idle');
    return state;
  }

  function destroy() {
    if (destroyed) return;
    reset(lastTimestamp);
    destroyed = true;
  }

  return Object.freeze({ update, getState: () => state, reset, destroy });
}
