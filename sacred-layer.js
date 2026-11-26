import { measuredFaceAnchors } from './lattice.js';

const TAU = Math.PI * 2;
const STEP = Math.PI / 3;

function circle(ctx, x, y, radius) {
  ctx.moveTo(x + radius, y);
  ctx.arc(x, y, radius, 0, TAU);
}

function hexPoint(index, radius) {
  return [Math.cos(index * STEP) * radius, Math.sin(index * STEP) * radius];
}

const ring = Array.from({ length: 6 }, (_, index) => hexPoint(index, 1));

function drawVesica(ctx, radius) {
  circle(ctx, -radius / 2, 0, radius);
  circle(ctx, radius / 2, 0, radius);
}

function drawRosette(ctx, radius) {
  circle(ctx, 0, 0, radius);
  for (const [x, y] of ring) circle(ctx, x * radius, y * radius, radius);
}

function drawLattice(ctx, radius) {
  for (let index = 0; index < ring.length; index++) {
    const [x, y] = ring[index];
    const [nextX, nextY] = ring[(index + 1) % ring.length];
    ctx.moveTo(0, 0);
    ctx.lineTo(x * radius, y * radius);
    ctx.lineTo(nextX * radius, nextY * radius);
    ctx.lineTo((x + nextX) * radius, (y + nextY) * radius);
    ctx.lineTo(x * radius, y * radius);
    ctx.lineTo(2 * x * radius, 2 * y * radius);
    ctx.lineTo((x + nextX) * radius, (y + nextY) * radius);
  }
}

const paths = { vesica: drawVesica, rosette: drawRosette, lattice: drawLattice };

export function createSacredLayer(settings) {
  let x = .5, y = .5, scale = settings.baseRadius, angle = 0, lastTime = null;
  return function render(ctx, width, height, time, tracking, audio, controls, frame) {
    const shape = controls.sacredLayer === 'auto' ? controls.sacredLiveShape : controls.sacredLayer;
    const draw = Object.hasOwn(paths, shape) ? paths[shape] : null;
    if (!draw) { lastTime = null; return; }

    const unit = Math.min(width, height);
    const normalized = Number.isFinite(lastTime) ? Math.max(0, time - lastTime) : 0;
    const move = lastTime === null ? 1 : 1 - Math.exp(-normalized / settings.positionSmoothingMs);
    const rotate = lastTime === null ? 1 : 1 - Math.exp(-normalized / settings.angleSmoothingMs);
    lastTime = time;

    const box = frame?.confirmed && frame.bbox?.w > 0 ? frame.bbox : null;
    const [first, second] = (tracking?.hands || []).filter(hand => !hand.stale);
    const features = measuredFaceAnchors(tracking, time, controls.lightScore?.sources);
    const eyePair = !first && features['eye.l'] && features['eye.r'] ? [features['eye.l'], features['eye.r']] : null;
    const pins = controls.sacredPins || [];
    const pinPair = controls.sacredLayer === 'auto' && !first && pins.length >= 2 ? pins : null;
    const anchors = pinPair || eyePair?.sort((a, b) => a.x - b.x);
    const target = anchors ? {
      x: (anchors[0].x + anchors[1].x) / 2,
      y: (anchors[0].y + anchors[1].y) / 2,
    } : tracking?.poses?.[0]?.center || controls.pointer;
    let centerX = target?.x ?? .5;
    let centerY = target?.y ?? .5;
    let radius = settings.baseRadius;
    let turn = 0;
    if (anchors) {
      const dx = (anchors[1].x - anchors[0].x) * width;
      const dy = (anchors[1].y - anchors[0].y) * height;
      turn = Math.atan2(dy, dx);
      radius = Math.hypot(dx, dy) / unit * settings.anchorRadius;
    }
    if (box) {
      centerX = box.x + box.w / 2;
      centerY = box.y + box.h / 2;
      radius = Math.min(box.w * width, box.h * height) / unit * settings.frameRadius;
    } else if (first?.palm && second?.palm) {
      const left = first.palm.x < second.palm.x ? first.palm : second.palm;
      const right = left === first.palm ? second.palm : first.palm;
      centerX = (left.x + right.x) / 2;
      centerY = (left.y + right.y) / 2;
      turn = Math.atan2((right.y - left.y) * height, (right.x - left.x) * width);
      radius = Math.hypot((right.x - left.x) * width, (right.y - left.y) * height) / unit * settings.anchorRadius;
    }
    const onEyes = eyePair && !pinPair && !box;
    const visualRadius = Math.min(.33, box || onEyes ? radius : Math.max(settings.minRadius, Math.min(settings.maxRadius, radius)));
    // Keep the whole construction on screen, even when the pointer reaches an edge.
    const edgeX = visualRadius * unit / width;
    const edgeY = visualRadius * unit / height;
    const clampCenter = (coordinate, edge) => Math.max(edge, Math.min(1 - edge, coordinate));
    x += ((onEyes ? centerX : clampCenter(centerX, edgeX)) - x) * (onEyes ? 1 : move);
    y += ((onEyes ? centerY : clampCenter(centerY, edgeY)) - y) * (onEyes ? 1 : move);
    scale += (visualRadius - scale) * (onEyes ? 1 : move);
    angle += ((controls.reducedMotion && !onEyes ? 0 : turn) - angle) * (onEyes ? 1 : rotate);

    const energy = Math.min(1, Math.max(0, audio?.bass || 0, (controls.lightScore?.signal?.rms || 0) * 8));
    const strength = controls.sacredStrength ?? settings.strength;
    if (!strength) return;
    const r = scale * unit * (shape === 'vesica' ? 2 / 3 : 1 / 2);
    ctx.save();
    ctx.translate(x * width, y * height);
    ctx.rotate(angle);
    ctx.lineWidth = settings.lineWidth;
    ctx.strokeStyle = `rgba(${settings.ink},${strength * (.65 + energy * .25)})`;
    ctx.beginPath();
    draw(ctx, r);
    ctx.stroke();
    ctx.fillStyle = `rgba(${settings.accent},${strength * (.80 + energy * .20)})`;
    ctx.fillRect(-1.5, -1.5, 3, 3);
    if (controls.sacredLayer === 'auto') {
      const facet = controls.sacredFacet ?? 0;
      const point = shape === 'vesica' ? [0, (facet ? -1 : 1) * Math.sqrt(3) / 2]
        : hexPoint(facet, shape === 'lattice' ? 2 : 1);
      ctx.beginPath();
      ctx.arc(point[0] * r, point[1] * r, 2.5 + energy, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  };
}
