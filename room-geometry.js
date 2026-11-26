const size = { width: 160, height: 100 };
const scanInterval = 90;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function detectCorners(luma, width, height) {
  const candidates = [];
  for (let y = 5; y < height - 5; y += 2) {
    for (let x = 5; x < width - 5; x += 2) {
      let xx = 0, yy = 0, xy = 0;
      for (let j = -2; j <= 2; j++) {
        for (let i = -2; i <= 2; i++) {
          const p = (y + j) * width + x + i;
          const dx = luma[p + 1] - luma[p - 1];
          const dy = luma[p + width] - luma[p - width];
          xx += dx * dx;
          yy += dy * dy;
          xy += dx * dy;
        }
      }
      const score = (xx + yy - Math.hypot(xx - yy, 2 * xy)) / 2;
      if (score < 850) continue;
      const p = y * width + x;
      const signature = [
        luma[p - 3 * width - 3], luma[p - 3 * width + 3],
        luma[p + 3 * width - 3], luma[p + 3 * width + 3],
      ];
      const mean = signature.reduce((sum, value) => sum + value, 0) / signature.length;
      candidates.push({ x: x / width, y: y / height, score, signature: signature.map(value => value - mean) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const corners = [];
  for (const candidate of candidates) {
    if (corners.some(point => Math.hypot((point.x - candidate.x) * width, (point.y - candidate.y) * height) < 7)) continue;
    corners.push(candidate);
    if (corners.length === 34) break;
  }
  return corners;
}

export function followCorners(previous, candidates, allocateId) {
  const available = new Set(candidates);
  const tracked = [];
  for (const last of previous) {
    let best, cost = Infinity;
    for (const point of available) {
      const distance = Math.hypot((point.x - last.x) * size.width, (point.y - last.y) * size.height);
      if (distance > 15) continue;
      const difference = point.signature.reduce((sum, value, i) => sum + Math.abs(value - last.signature[i]), 0) / 4;
      const candidateCost = distance + difference * .12;
      if (difference > 65 || candidateCost >= cost) continue;
      best = point;
      cost = candidateCost;
    }
    if (best) {
      available.delete(best);
      tracked.push({ ...best, id: last.id, x: last.x * .24 + best.x * .76, y: last.y * .24 + best.y * .76,
        seen: last.seen + 1, missed: 0 });
    } else if (last.missed < 2) {
      tracked.push({ ...last, missed: last.missed + 1 });
    }
  }
  for (const point of available) tracked.push({ ...point, id: allocateId(), seen: 1, missed: 0 });
  return tracked;
}

function detectEdges(points, luma) {
  const { width, height } = size;
  const read = (x, y) => luma[clamp(Math.round(y), 0, height - 1) * width + clamp(Math.round(x), 0, width - 1)];
  const edges = [];
  for (const [index, a] of points.entries()) {
    for (let j = index + 1; j < points.length; j++) {
      const b = points[j];
      const dx = (b.x - a.x) * width, dy = (b.y - a.y) * height;
      const distance = Math.hypot(dx, dy);
      if (distance < 9 || distance > 92) continue;
      const normalX = -dy / distance, normalY = dx / distance;
      let votes = 0;
      for (let k = 1; k <= 7; k++) {
        const x = a.x * width + dx * k / 8, y = a.y * height + dy * k / 8;
        const gradient = Math.abs(read(x + 2.3 * normalX, y + 2.3 * normalY) - read(x - 2.3 * normalX, y - 2.3 * normalY));
        if (gradient > 27) votes++;
      }
      if (votes >= 5) edges.push({ a: a.id, b: b.id, confidence: votes / 7 });
    }
  }
  return edges.sort((a, b) => b.confidence - a.confidence).slice(0, 48);
}

export function createRoomGeometry() {
  const sample = document.createElement('canvas');
  const { width, height } = size;
  sample.width = width;
  sample.height = height;
  const context = sample.getContext('2d', { willReadFrequently: true });
  const luma = new Uint8Array(width * height);
  let current = { points: [], edges: [], locked: null };
  let previous = [], lastScan = -Infinity, lastVideoTime = -1, lastAspect = 0, sequence = 0;

  function reset() {
    previous = [];
    lastScan = -Infinity;
    lastVideoTime = -1;
    lastAspect = 0;
    current = { points: [], edges: [], locked: null };
    return current;
  }

  function update(video, time, mirrored, aspect, fit = 'fill') {
    if (!context || video.readyState < 2 || !video.videoWidth || !video.videoHeight || !(aspect > 0)) return reset();
    if (Math.abs(aspect - lastAspect) > .01) reset();
    lastAspect = aspect;
    if (time - lastScan < scanInterval || lastVideoTime === video.currentTime) return current;
    lastScan = time;
    lastVideoTime = video.currentTime;
    context.setTransform(mirrored ? -1 : 1, 0, 0, 1, mirrored ? width : 0, 0);
    // Camera landmarks, the camera layer and the shader all use normalized
    // source-image coordinates. A viewport crop here displaced room corners.
    if (fit === 'cover') {
      const cropWidth = Math.min(video.videoWidth, video.videoHeight * aspect);
      const cropHeight = Math.min(video.videoHeight, video.videoWidth / aspect);
      context.drawImage(video, (video.videoWidth - cropWidth) / 2, (video.videoHeight - cropHeight) / 2,
        cropWidth, cropHeight, 0, 0, width, height);
    } else context.drawImage(video, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    for (let i = 0; i < luma.length; i++) luma[i] = (data[i * 4] * 54 + data[i * 4 + 1] * 183 + data[i * 4 + 2] * 19) >> 8;
    previous = followCorners(previous, detectCorners(luma, width, height), () => ++sequence);
    const points = previous.filter(point => point.seen >= 2 && point.missed <= 1);
    const edges = detectEdges(points, luma);
    const locked = previous.some(point => point.id === current.locked) ? current.locked : null;
    current = { points, edges, locked };
    return current;
  }

  function lock(pointer, width, height) {
    const point = closestCorner(current.points, pointer, width, height);
    current = { ...current, locked: point?.id ?? null };
    return current;
  }
  const release = () => (current = { ...current, locked: null });
  return { update, lock, release, reset };
}

function closestCorner(points, pointer, width, height) {
  let distance = Math.min(width, height) * .18;
  let best;
  for (const point of points) {
    const candidate = Math.hypot((point.x - pointer.x) * width, (point.y - pointer.y) * height);
    if (point.missed || candidate >= distance) continue;
    best = point;
    distance = candidate;
  }
  return best;
}

export function drawRoomGeometry(ctx, width, height, room, pointer) {
  const pointById = new Map(room.points.map(point => [point.id, point]));
  const aim = pointer.active ? pointer : { x: .5, y: .5 };
  const target = pointById.get(room.locked) || closestCorner(room.points, aim, width, height);
  ctx.save();
  ctx.lineWidth = Math.max(1, width / 1240);
  for (const edge of room.edges) {
    const a = pointById.get(edge.a), b = pointById.get(edge.b);
    const lit = target?.id === a.id || target?.id === b.id;
    ctx.strokeStyle = lit ? 'rgba(166,217,255,.88)' : `rgba(106,166,220,${edge.confidence * .45})`;
    ctx.beginPath();
    ctx.moveTo(a.x * width, a.y * height);
    ctx.lineTo(b.x * width, b.y * height);
    ctx.stroke();
  }
  for (const point of room.points) {
    ctx.fillStyle = point.missed ? '#456481' : '#9fc5dc';
    ctx.fillRect(point.x * width - 1, point.y * height - 1, 3, 3);
  }
  ctx.strokeStyle = target ? 'rgba(211,237,255,.9)' : 'rgba(151,182,202,.55)';
  const ax = aim.x * width, ay = aim.y * height;
  ctx.strokeRect(ax - 4, ay - 4, 8, 8);
  if (target) {
    const x = target.x * width, y = target.y * height, radius = room.locked ? 12 : 8;
    ctx.strokeRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.restore();
}
