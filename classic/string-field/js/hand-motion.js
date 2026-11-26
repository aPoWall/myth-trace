import { CONFIG } from './config.js';
import { matchHands } from './hand-identity.js';

const JOINTS = 21;
const PALM = [0, 5, 9, 13, 17];
const TIPS = [8, 12, 16, 20];
const unit = (value) => Math.max(0, Math.min(1, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const sideOf = (category) => ['Left', 'Right'].includes(category?.categoryName) ? category.categoryName : 'Unknown';

function readPoints(points) {
  if (!Array.isArray(points) || points.length < JOINTS) return null;
  const joints = points.slice(0, JOINTS);
  return joints.every((point) => [point?.x,point?.y,point?.z].every(Number.isFinite)) ? joints : null;
}

function copyPoints(points, mirror, world = false) {
  return points.map(({ x, y, z }) => ({ x: mirror ? (world ? -x : 1 - x) : x, y, z }));
}

function palmCenter(points, yScale) {
  let x = 0;
  let y = 0;
  for (const i of PALM) {
    x += points[i].x;
    y += points[i].y;
  }
  return { x: x / PALM.length, y: y * yScale / PALM.length };
}

function palmSize(points, yScale) {
  const projected = (a, b) => Math.hypot(points[a].x - points[b].x, (points[a].y - points[b].y) * yScale);
  return Math.max(projected(0, 9), projected(5, 17));
}

function alpha(cutoff, seconds) {
  const rate = 2 * Math.PI * cutoff * seconds;
  return rate / (1 + rate);
}

function smooth(raw, previous, seconds, settings) {
  if (!previous) {
    return { raw, points: raw, velocity: raw.map(() => ({ x: 0, y: 0, z: 0 })) };
  }
  const velocity = [];
  const derivative = alpha(settings.dCutoff, seconds);
  const points = raw.map((point, index) => {
    const prior = previous.raw[index];
    const last = previous.points[index];
    const speed = previous.velocity[index];
    const dx = speed.x + derivative * ((point.x - prior.x) / seconds - speed.x);
    const dy = speed.y + derivative * ((point.y - prior.y) / seconds - speed.y);
    const dz = speed.z + derivative * ((point.z - prior.z) / seconds - speed.z);
    const cutoff = settings.minCutoff + settings.beta * Math.hypot(dx, dy, dz);
    const weight = alpha(cutoff, seconds);
    velocity.push({ x: dx, y: dy, z: dz });
    return {
      x: last.x + weight * (point.x - last.x),
      y: last.y + weight * (point.y - last.y),
      z: last.z + weight * (point.z - last.z),
    };
  });
  return { raw, points, velocity };
}

function planeNormal(points) {
  const wrist = points[0];
  const across = { x: points[17].x - points[5].x, y: points[17].y - points[5].y, z: points[17].z - points[5].z };
  const forward = { x: points[9].x - wrist.x, y: points[9].y - wrist.y, z: points[9].z - wrist.z };
  const x = across.y * forward.z - across.z * forward.y;
  const y = across.z * forward.x - across.x * forward.z;
  const z = across.x * forward.y - across.y * forward.x;
  const length = Math.hypot(x, y, z);
  return length > Number.EPSILON ? { x: x / length, y: y / length, z: z / length } : null;
}

function measuredPalm(points) {
  return (distance(points[0], points[9]) + distance(points[5], points[17])) / 2;
}

function profileShape(image, world, yScale, precision) {
  // Image y uses image height whereas depth is on roughly the normalized x scale.
  // World points are model-estimated 3D landmarks in hand-centered coordinates.
  const normalized = world ?? image.map(({ x, y, z }) => ({ x, y: y * yScale, z }));
  const palm = Math.max(Number.EPSILON, measuredPalm(normalized));
  const pinch = (tip) => unit(1 - distance(normalized[4], normalized[tip]) / (palm * precision.pinchDistanceScale));
  const spread = TIPS.reduce((sum, i) => sum + unit((distance(normalized[i], normalized[0]) / palm - 1) / 1.1), 0) / TIPS.length;
  const normal = planeNormal(normalized);
  const depthSource = world ? 'world' : 'image-depth';
  const facing = normal?.z ?? 0;
  let view = 'unknown';
  if (normal) {
    if (Math.abs(facing) < precision.orientationEdgeRatio) view = 'edge-on';
    else view = Math.abs(facing) < precision.obliqueRatio ? 'oblique' : 'face-on';
  }
  const reliable = Boolean(world || (normal && view !== 'edge-on'));
  return {
    pinch: pinch(8), middlePinch: pinch(12), spread,
    palmNormal: normal, orientation: { view, facing, source: depthSource },
    depthSource, pinchReliable: reliable,
  };
}

export function createHandMotion({ precision = CONFIG.tracking.precision, holdMs = CONFIG.tracking.lostMs, mirror = true } = {}) {
  const tracks = new Map();
  let hands = [];
  let nextId = 1;
  let maxHands = precision.maxHands;
  let lastFrame = -Infinity;
  let lastFade = -Infinity;

  function reset() {
    tracks.clear();
    hands = [];
    lastFrame = lastFade = -Infinity;
  }

  function expire(timestamp) {
    for (const [id, track] of tracks) {
      if (timestamp - track.seen > holdMs) tracks.delete(id);
    }
  }

  function trim() {
    if (tracks.size <= maxHands) return;
    const latest = [...tracks.values()].sort((a, b) => b.seen - a.seen);
    for (const track of latest.slice(maxHands)) tracks.delete(track.id);
  }

  function refresh(timestamp) {
    expire(timestamp);
    hands = [...tracks.values()].map((track) => {
      const ageMs = Math.max(0, timestamp - track.seen);
      return ageMs === 0 ? track.hand : {
        ...track.hand, stale: true, ageMs, interactive: false,
        quality: { ...track.hand.quality, state: 'stale' },
      };
    });
    return hands;
  }

  function update(result, timestamp, { width = precision.width, height = precision.height } = {}) {
    if (!Number.isFinite(timestamp) || timestamp <= lastFrame) return hands;
    const w = Number.isFinite(width) && width > 0 ? width : precision.width;
    const h = Number.isFinite(height) && height > 0 ? height : precision.height;
    const yScale = h / w;
    expire(timestamp);
    const candidates = [];
    const sides = result?.handednesses ?? result?.handedness ?? [];
    for (const [index, input] of (result?.landmarks ?? []).entries()) {
      const points = readPoints(input);
      if (!points) continue;
      const world = readPoints(result.worldLandmarks?.[index]);
      const category = sides[index]?.[0];
      const side = sideOf(category);
      candidates.push({
        points, world: world && measuredPalm(world) >= precision.minWorldPalm ? world : null,
        center: palmCenter(points, yScale),
        size: palmSize(points, yScale),
        side,
        confidence: side !== 'Unknown' && Number.isFinite(category?.score) ? unit(category.score) : null,
      });
      if (candidates.length === maxHands) break;
    }

    const matches = matchHands(candidates, [...tracks.values()], timestamp, precision.identity);
    for (const [index, candidate] of candidates.entries()) {
      const prior = matches[index];
      const id = prior?.id ?? `hand-${nextId++}`;
      const seconds = Math.max(.001, (timestamp - (prior?.seen ?? timestamp)) / 1000);
      const gap = !prior || prior.seen !== lastFrame || timestamp - prior.seen >= precision.stallMs;
      const velocity = prior && !gap ? {
        x: (candidate.center.x - prior.center.x) / seconds,
        y: (candidate.center.y - prior.center.y) / seconds,
      } : { x: 0, y: 0 };
      // Start shapes from the new observation after an occlusion; identity can
      // survive the gap without sweeping a pointer through the unseen path.
      const image = smooth(copyPoints(candidate.points, mirror), gap ? null : prior?.image, seconds, precision.smoothing);
      const world = candidate.world ? smooth(copyPoints(candidate.world, mirror, true),
        gap ? null : prior?.world, seconds, precision.smoothing) : null;
      const shape = profileShape(image.points, world?.points, yScale, precision);
      const adopt = !prior || prior.side === 'Unknown';
      const side = adopt ? candidate.side : prior.side;
      const confidence = adopt || candidate.side === side ? candidate.confidence ?? prior?.confidence ?? null : prior.confidence;
      const palmPixels = candidate.size * w;
      const residualPx = Math.sqrt(image.points.reduce((sum, point, i) => {
        const raw = image.raw[i];
        return sum + ((point.x - raw.x) * w) ** 2 + ((point.y - raw.y) * h) ** 2;
      }, 0) / JOINTS);
      const largeEnough = palmPixels >= precision.minPalmPixels;
      const state = largeEnough ? 'tracked' : 'small';
      const hand = {
        id, side, confidence, x: image.points[8].x, y: image.points[8].y,
        pinch: shape.pinch, middlePinch: shape.middlePinch, spread: shape.spread,
        landmarks: image.points, rawLandmarks: image.raw,
        worldLandmarks: world?.points ?? null, rawWorldLandmarks: world?.raw ?? null,
        palmNormal: shape.palmNormal, orientation: shape.orientation,
        quality: { palmPixels, landmarkCount: JOINTS, depthSource: shape.depthSource, pinchReliable: shape.pinchReliable, state },
        residualPx, stale: false, ageMs: 0, interactive: largeEnough && shape.pinchReliable,
      };
      tracks.set(id, {
        id, side, confidence, seen: timestamp, center: candidate.center, size: candidate.size,
        velocity, image, world, hand,
      });
    }
    lastFrame = timestamp;
    lastFade = timestamp;
    trim();
    return refresh(timestamp);
  }

  function tick(timestamp) {
    if (!tracks.size || timestamp - lastFrame < precision.stallMs ||
        timestamp - lastFade < 1000 / precision.frameRate) return null;
    lastFade = timestamp;
    return refresh(timestamp);
  }

  return {
    update, tick, reset,
    setMaxHands(value) {
      maxHands = value === 4 ? 4 : 2;
      trim();
      if (Number.isFinite(lastFrame)) refresh(Math.max(lastFrame, lastFade));
    },
    setMirror(value) {
      const next = Boolean(value);
      if (mirror === next) return false;
      mirror = next;
      reset();
      return true;
    },
    getHands: () => hands,
  };
}
