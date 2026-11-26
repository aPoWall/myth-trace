import { CONFIG, clamp, lerp } from './config.js';
import { measuredFace } from './lattice.js';

const studyRules = CONFIG.lightScore.studies;
const settings = studyRules.pigmentRelief;
const HAND_POINTS = 21;
const MAX_HANDS = 2;
const PALM_BASE = [0, 5, 9, 13, 17];
const PALM_EDGE = [0, 2, 5, 9, 13, 17];
const FINGER_BASE = [1, 5, 9, 13, 17];
const SHOULDER = 0, ELBOW = 1, WRIST = 2, INDEX = 3, PINKY = 4, THUMB = 5;
const ARM = { Left: [11, 13, 15, 19, 17, 21], Right: [12, 14, 16, 20, 18, 22] };
const EYES_ON_POSE = [2, 5];
const FACE_EYES = ['eye.l', 'eye.r'];

const visible = point => Number.isFinite(point?.x) && Number.isFinite(point.y)
  && point.x > 0 && point.x < 1 && point.y > 0 && point.y < 1;
const fresh = (track, time) => track?.id && !track.stale && track.score >= studyRules.confidence
  && time >= track.lastSeen && time - track.lastSeen <= studyRules.freshMs;
const rgba = (color, alpha) => `rgba(${color},${clamp(alpha)})`;
const distance = (a, b, width, height) => Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);

export function matchMeasuredWrist(hand, poseWrist, otherWrist, width, height, span) {
  const points = hand.landmarks;
  const wrist = points?.[0];
  if (!visible(wrist) || !visible(poseWrist)) return false;
  if (!span) {
    if (!visible(points[5]) || !visible(points[17]) || !visible(hand.palm)) return false;
    span = Math.max(distance(points[5], points[17], width, height), distance(wrist, hand.palm, width, height));
  }
  if (span < Math.min(width, height) * settings.minPalmFraction) return false;
  const gap = distance(wrist, poseWrist, width, height);
  return gap <= span * settings.wristMatch
    && (!visible(otherWrist) || distance(wrist, otherWrist, width, height) - gap >= span * settings.wristSeparation);
}

function joint(anchors, pose, number) {
  const id = `${pose.id}:joint:${number}`;
  return anchors.find(anchor => anchor.id === id && anchor.confidence >= studyRules.confidence && visible(anchor));
}

// Trackers have independent IDs. Extend the surface only if both the wrist and
// the pose's estimate of the same hand agree in the displayed image.
function fitArm(state, poses, anchors, time, width, height) {
  const hand = state.hand;
  const side = ARM[hand.handedness];
  if (!side || (hand.handednessConfidence ?? hand.score) < studyRules.confidence) return false;
  const other = ARM[hand.handedness === 'Left' ? 'Right' : 'Left'];
  const wrist = hand.landmarks[0];
  const span = state.span;
  let fits = 0;
  for (const pose of poses) {
    if (!fresh(pose, time)) continue;
    const handWrist = joint(anchors, pose, side[WRIST]);
    const otherWrist = joint(anchors, pose, other[WRIST]);
    if (!matchMeasuredWrist(hand, handWrist, otherWrist, width, height, span)) continue;

    const forearm = joint(anchors, pose, side[ELBOW]);
    const shoulder = joint(anchors, pose, side[SHOULDER]);
    const poseIndex = pose.landmarks?.[side[INDEX]];
    const posePinky = pose.landmarks?.[side[PINKY]];
    const poseThumb = pose.landmarks?.[side[THUMB]];
    if (!forearm || !shoulder || !visible(poseIndex) || !visible(posePinky) || !visible(poseThumb)) continue;
    if (distance(poseIndex, posePinky, width, height) < span * .08) continue;
    const handCenter = state.armCenter;
    handCenter.x = (poseIndex.x + posePinky.x + poseThumb.x + handWrist.x) / 4;
    handCenter.y = (poseIndex.y + posePinky.y + poseThumb.y + handWrist.y) / 4;
    if (distance(handCenter, hand.palm, width, height) > span * settings.wristContinuity) continue;
    if (distance(forearm, wrist, width, height) < span * .40 || distance(forearm, shoulder, width, height) < span * .30) continue;
    state.arm[0] = shoulder;
    state.arm[1] = forearm;
    state.armWrist = handWrist;
    if (++fits > 1) return false;
  }
  return fits === 1;
}

function prepareHand(state, width, height) {
  const raw = state.hand.landmarks;
  const { x, y, z } = state;
  for (let i = 0; i < HAND_POINTS; i++) {
    x[i] = raw[i]?.x * width;
    y[i] = raw[i]?.y * height;
  }
  const knucklesX = (x[5] + x[9] + x[13] + x[17]) / 4;
  const knucklesY = (y[5] + y[9] + y[13] + y[17]) / 4;
  const dx = knucklesX - x[0], dy = knucklesY - y[0];
  const length = Math.hypot(dx, dy);
  const minSize = Math.min(width, height) * settings.minPalmFraction;
  if (length < minSize) return false;
  const palmWidth = Math.hypot(x[5] - x[17], y[5] - y[17]);
  state.span = Math.max(palmWidth, length * .70);
  state.ax = dx / length;
  state.ay = dy / length;
  const sign = Math.sign(-state.ay * (x[5] - x[17]) + state.ax * (y[5] - y[17])) || 1;
  state.sx = -state.ay * sign;
  state.sy = state.ax * sign;
  state.length = length;
  state.depth = Number.isFinite(raw[0].z) && raw.some(point => visible(point)
    && Number.isFinite(point.z) && point.z !== raw[0].z);
  // Normalized landmark z uses the hand's own wrist origin and x units.
  // This depth never goes into a comparison with the pose, face, or other hand.
  for (let i = 0; i < HAND_POINTS; i++) {
    z[i] = state.depth && Number.isFinite(raw[i]?.z) ? clamp((raw[0].z - raw[i].z) * width / state.span, -1.6, 1.6) : 0;
  }
  let fingerCount = 0;
  for (const base of FINGER_BASE) {
    if (!visible(raw[base]) || !visible(raw[base + 1]) || !visible(raw[base + 2]) || !visible(raw[base + 3])) continue;
    const depth = z[base + 2];
    let i = fingerCount++;
    while (i > 0 && z[state.fingerOrder[i - 1] + 2] > depth) {
      state.fingerOrder[i] = state.fingerOrder[i - 1];
      i--;
    }
    state.fingerOrder[i] = base;
  }
  state.fingerCount = fingerCount;
  return true;
}

function outsideEllipse(ctx, width, height, x, y, rx, ry, angle) {
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.moveTo(x + rx * Math.cos(angle), y + rx * Math.sin(angle));
  ctx.ellipse(x, y, rx, ry, angle, 0, 2 * Math.PI);
  ctx.clip('evenodd');
}

function outsideLimb(ctx, width, height, ax, ay, bx, by, radius) {
  const length = Math.hypot(bx - ax, by - ay);
  if (!length) return;
  outsideEllipse(ctx, width, height, (ax + bx) / 2, (ay + by) / 2,
    length / 2 + radius, radius, Math.atan2(by - ay, bx - ax));
}

function clipBehindHand(ctx, state, width, height) {
  const { x, y, span, length, ax, ay } = state;
  outsideEllipse(ctx, width, height, x[0] + ax * length * .47, y[0] + ay * length * .47,
    length * .66, span * .53, Math.atan2(ay, ax));
  for (let i = 0; i < state.fingerCount; i++) {
    const start = state.fingerOrder[i];
    outsideLimb(ctx, width, height, x[start], y[start], x[start + 3], y[start + 3], span * .078);
  }
  if (state.armLive) {
    const [shoulder, elbow] = state.arm;
    outsideLimb(ctx, width, height, x[0], y[0], elbow.x * width, elbow.y * height, span * .32);
    outsideLimb(ctx, width, height, elbow.x * width, elbow.y * height, shoulder.x * width, shoulder.y * height, span * .43);
  }
}

function curve(a, b, c, d, t) {
  return b + .5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * b - 3 * c + d - a)));
}

function sample(points, first, t) {
  const segment = Math.min(2, Math.floor(t * 3));
  return curve(points[first + Math.max(0, segment - 1)], points[first + segment],
    points[first + segment + 1], points[first + Math.min(3, segment + 2)], t * 3 - segment);
}

function writeEdges(section, index, cx, cy, ux, uy, a, b) {
  const j = index * 4;
  section[j] = cx + ux * a;
  section[j + 1] = cy + uy * a;
  section[j + 2] = cx + ux * b;
  section[j + 3] = cy + uy * b;
}

const channels = color => color.split(',').map(Number);
const blue = channels(settings.blue), copper = channels(settings.copper);
const blueEdge = channels(settings.blueEdge), copperEdge = channels(settings.copperEdge);
function tone(a, b, mix) {
  return `${Math.round(lerp(a[0], b[0], mix))},${Math.round(lerp(a[1], b[1], mix))},${Math.round(lerp(a[2], b[2], mix))}`;
}

function paintMaterial(ctx, state, steps, temperature, presence, grainCount) {
  const band = state.section;
  const center = Math.floor(steps / 2) * 4;
  const material = tone(blue, copper, temperature);
  const edge = tone(blueEdge, copperEdge, temperature);
  const crossWidth = Math.hypot(band[center] - band[center + 2], band[center + 1] - band[center + 3]);
  if (crossWidth < .3) return 0;
  const gradient = ctx.createLinearGradient(band[center], band[center + 1], band[center + 2], band[center + 3]);
  gradient.addColorStop(0, rgba('6,14,26', .09 * presence));
  gradient.addColorStop(.25, rgba(material, .61 * presence));
  gradient.addColorStop(.52, rgba(edge, .47 * presence));
  gradient.addColorStop(.69, rgba(material, .65 * presence));
  gradient.addColorStop(.93, rgba('11,26,43', .28 * presence));
  gradient.addColorStop(1, rgba(material, .07 * presence));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(band[0], band[1]);
  for (let i = 1; i <= steps; i++) ctx.lineTo(band[i * 4], band[i * 4 + 1]);
  for (let i = steps; i >= 0; i--) ctx.lineTo(band[i * 4 + 2], band[i * 4 + 3]);
  ctx.closePath();
  ctx.fill();

  for (const seam of [0.29, .54, .86]) {
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const j = i * 4;
      const x = lerp(band[j], band[j + 2], seam), y = lerp(band[j + 1], band[j + 3], seam);
      if (!i) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = Math.max(.54, Math.min(1.55, state.span * .012));
    ctx.strokeStyle = rgba(edge, (seam === .54 ? .54 : .24) * presence);
    ctx.stroke();
  }

  ctx.fillStyle = rgba(edge, .53 * presence);
  for (let i = 0; i < grainCount; i++) {
    const j = Math.floor(((i * .618034 + .3) % 1) * steps) * 4;
    const across = (i * .754878 + .12) % 1;
    const size = Math.max(.48, Math.min(1.6, state.span * .012 * (.4 + across)));
    ctx.fillRect(lerp(band[j], band[j + 2], across), lerp(band[j + 1], band[j + 3], across), size, size);
  }
  return 1;
}

function paintPalm(ctx, state, front, layer) {
  const steps = settings.arcSteps;
  const { x, y, z, ax, ay, sx, sy, length, span, grip, relief } = state;
  const spread = span * (.64 - .20 * grip + layer * .16);
  const center = length * (.58 - .23 * grip - layer * .52);
  const skew = (z[5] - z[17]) * span * .30 * relief;
  for (let i = 0; i <= steps; i++) {
    const phase = Math.PI * (i / steps + (front ? 0 : 1));
    const side = Math.cos(phase), depth = Math.sin(phase);
    const radius = spread * (1 + .18 * side * (1 - grip));
    const cross = side * radius + depth * grip * span * .13 * relief;
    const along = center + depth * span * (.38 + .16 * layer) * relief
      + side * (span * (.19 + .19 * layer) + skew);
    const taper = .16 + .84 * Math.sin((i / steps) * Math.PI) ** .7;
    const fabric = (layer ? .20 : .34) * span * taper * (1 - .33 * grip);
    writeEdges(state.section, i, x[0] + cross * sx + along * ax, y[0] + cross * sy + along * ay,
      ax, ay, -fabric * .65, fabric * (1 + .34 * side));
  }
  const warmth = clamp(grip * .94 + layer * .12 + (front ? .08 : -.14));
  return paintMaterial(ctx, state, steps, warmth, front ? (layer ? .82 : 1) : .48, front ? settings.grainCount : 0);
}

function paintPalmFoil(ctx, state) {
  const { x, y, z, grip, relief, span, section } = state;
  const landmarks = state.hand.landmarks;
  const cx = (x[0] + x[5] + x[9] + x[13] + x[17]) / 5;
  const cy = (y[0] + y[5] + y[9] + y[13] + y[17]) / 5;
  const cz = (z[0] + z[5] + z[9] + z[13] + z[17]) / 5;
  const width = 1 + .12 * (1 - grip);
  let count = 0;
  for (const index of PALM_EDGE) {
    if (!visible(landmarks[index])) continue;
    const j = count++ * 3;
    section[j] = lerp(cx, x[index], width);
    section[j + 1] = lerp(cy, y[index], width);
    section[j + 2] = z[index];
  }

  const material = tone(blue, copper, grip);
  const edge = tone(blueEdge, copperEdge, grip);
  ctx.beginPath();
  ctx.moveTo(section[0], section[1]);
  for (let i = 1; i < count; i++) ctx.lineTo(section[i * 3], section[i * 3 + 1]);
  ctx.closePath();
  ctx.fillStyle = rgba(material, .55);
  ctx.fill();
  ctx.lineWidth = Math.max(.85, Math.min(2.1, span * .032));
  ctx.strokeStyle = rgba(material, .83);
  ctx.stroke();
  let segments = 1;

  // The foil is a fan over the measured palm, so each face follows the
  // wrist, thumb base and knuckles through rotation and finger curls.
  for (let i = 0; i < count; i++) {
    const a = i * 3, b = ((i + 1) % count) * 3;
    const ax = section[a], ay = section[a + 1], bx = section[b], by = section[b + 1];
    const dx = (ax + bx) / 2 - cx, dy = (ay + by) / 2 - cy;
    const area = Math.abs((ax - cx) * (by - cy) - (bx - cx) * (ay - cy));
    if (area < 1 || Math.hypot(dx, dy) < 1) continue;
    const slope = (section[a + 2] - section[b + 2]) * relief;
    const height = (section[a + 2] + section[b + 2]) * .5 - cz;
    const sheen = clamp(.48 + slope * .61 + height * relief * .39 + (i % 2 ? .12 : -.12));
    const ramp = ctx.createLinearGradient(cx, cy, cx + dx, cy + dy);
    ramp.addColorStop(0, rgba(edge, .19 + sheen * .44));
    ramp.addColorStop(.72, rgba(material, .33 + sheen * .28));
    ramp.addColorStop(1, rgba(edge, .29 + sheen * .45));
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.closePath();
    ctx.fillStyle = ramp;
    ctx.fill();
    segments++;

    ctx.beginPath();
    ctx.moveTo(lerp(cx, ax, .15), lerp(cy, ay, .15));
    ctx.lineTo(ax, ay);
    ctx.lineTo(bx, by);
    for (let hatch = 1; hatch < 5; hatch++) {
      const t = (.22 + hatch * .135);
      ctx.moveTo(lerp(cx, ax, t), lerp(cy, ay, t));
      ctx.lineTo(lerp(cx, bx, t), lerp(cy, by, t));
    }
    ctx.lineWidth = Math.max(.58, Math.min(1.2, span * .017));
    ctx.strokeStyle = rgba(edge, .25 + sheen * .50);
    ctx.stroke();
    ctx.fillStyle = rgba(edge, .64);
    const grains = Math.floor(settings.grainCount / count);
    for (let grain = 0; grain < grains; grain++) {
      const along = (.27 + grain * .281 + i * .381966) % 1;
      const across = (.47 + grain * .618034) % 1;
      const gx = lerp(cx, lerp(ax, bx, across), along), gy = lerp(cy, lerp(ay, by, across), along);
      const size = Math.max(.6, Math.min(1.5, span * .017 * (.7 + across)));
      ctx.fillRect(gx, gy, size, size);
    }
  }
  return segments;
}

function paintFinger(ctx, state, first) {
  const { x, y, z, span, grip, relief } = state;
  const steps = settings.fingerSteps;
  if (Math.hypot(x[first] - x[first + 3], y[first] - y[first + 3]) < span * .08) return 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, dt = 1 / steps;
    const before = Math.max(0, t - dt), after = Math.min(1, t + dt);
    const dx = sample(x, first, after) - sample(x, first, before);
    const dy = sample(y, first, after) - sample(y, first, before);
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    const d = sample(z, first, t) * relief;
    const ridge = Math.sin(t * Math.PI * 1.5 + d) * span * .035;
    const width = span * (.03 + .035 * Math.sin(Math.PI * t)) * (1 - .45 * t) * (1 + .24 * clamp(d));
    writeEdges(state.section, i, sample(x, first, t), sample(y, first, t), nx, ny,
      ridge - width, ridge + width * .72);
  }
  // Farther fingers carry a thinner blue reflection. The copper fold gathers
  // on the thumb and index as their measured tips close.
  const nearness = clamp(.58 + (z[first + 2] - z[9]) * .74 * relief);
  const warmth = clamp(grip * (first <= 5 ? .98 : .36) + nearness * .13);
  return paintMaterial(ctx, state, steps, warmth, .29 + .55 * nearness, 0);
}

function paintArm(ctx, state, width, height, front) {
  const { span, grip, x, y, arm, relief } = state;
  const steps = settings.arcSteps;
  const sx = arm[0].x * width, sy = arm[0].y * height;
  const ex = arm[1].x * width, ey = arm[1].y * height;
  const wx = x[0], wy = y[0];
  const handoffX = state.ax * span * .32;
  const handoffY = state.ay * span * .32;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const path = t * 2;
    const point = t < .5 ? path : path - 1;
    const head = t < .5;
    const bx = head ? sx : ex, by = head ? sy : ey, cx = head ? ex : wx, cy = head ? ey : wy;
    const px = curve(sx, bx, cx, head ? wx : wx + handoffX, point);
    const py = curve(sy, by, cy, head ? wy : wy + handoffY, point);
    const dx = lerp(ex - sx, wx - ex, t), dy = lerp(ey - sy, wy - ey, t);
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    const fold = Math.sin(t * Math.PI * 2.8 - .48) * .42 * relief + (front ? .09 : -.47);
    const taper = Math.sin(Math.PI * .94 * t) * .46 + t * .38 + .04;
    writeEdges(state.section, i, px, py, nx, ny,
      span * (fold - taper * .29), span * (fold + taper * .31));
  }
  return paintMaterial(ctx, state, steps, .17 + grip * .57, front ? .72 : .36,
    front ? settings.grainCount : 0);
}

function readEyes(tracking, time, sources, poses, cache) {
  if (sources.eyes === false) {
    cache.seen = -Infinity;
    return false;
  }
  const face = measuredFace(tracking, time, sources);
  const features = face?.features;
  let left = features?.['eye.l'], right = features?.['eye.r'];
  let seen = face?.lastSeen;
  let singleEye = false;
  if (!visible(left) || !visible(right)) {
    for (const name of FACE_EYES) {
      const inner = features?.[name + '.inner'], outer = features?.[name + '.outer'];
      if (!visible(features?.[name]) || !visible(inner) || !visible(outer)) continue;
      left = inner;
      right = outer;
      singleEye = true;
      break;
    }
  }
  if (!visible(left) || !visible(right)) {
    const pose = poses.find(item => fresh(item, time));
    left = pose?.landmarks?.[EYES_ON_POSE[0]];
    right = pose?.landmarks?.[EYES_ON_POSE[1]];
    seen = pose?.lastSeen;
  }
  if (visible(left) && visible(right) && seen <= time) {
    cache.left = left;
    cache.right = right;
    cache.singleEye = singleEye;
    cache.seen = seen;
  }
  return time - cache.seen <= studyRules.freshMs + settings.holdMs;
}

export function createPigmentRelief() {
  const slots = Array.from({ length: MAX_HANDS }, () => ({
    hand: null, live: false, lastVisible: -Infinity, grip: 0,
    x: new Float32Array(HAND_POINTS), y: new Float32Array(HAND_POINTS), z: new Float32Array(HAND_POINTS),
    fingerOrder: new Uint8Array(FINGER_BASE.length),
    section: new Float32Array((Math.max(settings.arcSteps, settings.fingerSteps) + 1) * 4),
    arm: [null, null], armCenter: { x: 0, y: 0 }, armWrist: null, armLive: false,
  }));
  const eyes = { seen: -Infinity };
  let previousTime = -Infinity, mirror;
  function reset() {
    for (const slot of slots) slot.hand = null;
    eyes.seen = previousTime = -Infinity;
  }

  function render({ ctx, width, height, time, tracking, controls, strength }) {
    const sources = controls.lightScore?.sources || {};
    if (time < previousTime || tracking.camera?.mirrored !== mirror) reset();
    mirror = tracking.camera?.mirrored;
    if (sources.hands === false || tracking.camera?.active === false) {
      reset();
      return { source: sources.hands === false ? 'hands disabled' : 'waiting for hands', segments: 0 };
    }
    for (const slot of slots) {
      slot.live = slot.armLive = false;
      if (time - slot.lastVisible > settings.holdMs) slot.hand = null;
    }
    const delta = time - previousTime;
    previousTime = time;
    const poses = tracking.poses || [], anchors = tracking.anchors || [];
    let active = 0, withDepth = 0, arms = 0;
    let openPalm = false, copperPinch = false;
    for (const hand of tracking.hands || []) {
      if (active === MAX_HANDS) break;
      const raw = hand.landmarks;
      if (!fresh(hand, time) || !visible(hand.palm) || raw?.length !== HAND_POINTS || !PALM_BASE.every(i => visible(raw[i]))) continue;
      if (slots.some(slot => slot.live && slot.hand?.id === hand.id)) continue;
      const slot = slots.find(item => item.hand?.id === hand.id) || slots.find(item => !item.hand)
        || slots.find(item => !item.live && !tracking.hands.some(next => next.id === item.hand.id && fresh(next, time)));
      if (!slot) continue;
      const same = slot.hand?.id === hand.id;
      slot.hand = hand;
      if (!prepareHand(slot, width, height)) {
        slot.hand = null;
        continue;
      }
      const gap = Math.hypot(slot.x[4] - slot.x[8], slot.y[4] - slot.y[8]) / slot.span;
      const measuredTips = visible(raw[4]) && visible(raw[8]);
      const grip = measuredTips
        ? clamp((settings.pinchFar - gap) / (settings.pinchFar - settings.pinchNear))
        : same ? slot.grip : 0;
      slot.grip = same && !controls.reducedMotion ? lerp(slot.grip, grip, 1 - Math.exp(-delta / settings.gripFollowMs)) : grip;
      if (measuredTips) {
        openPalm ||= slot.grip < .24;
        copperPinch ||= slot.grip > .74;
      }
      slot.lastVisible = time;
      slot.live = true;
      slot.armLive = fitArm(slot, poses, anchors, time, width, height);
      active++;
      if (slot.depth) withDepth++;
      if (slot.armLive) arms++;
    }
    if (arms === MAX_HANDS && slots[0].armWrist === slots[1].armWrist) {
      slots[0].armLive = slots[1].armLive = false;
      arms = 0;
    }
    if (!slots.some(slot => slot.hand)) return { source: 'waiting for hands', segments: 0 };

    const neutralRelief = CONFIG.performancePresets.geometries['pigment-relief'].reliefDepth;
    const requestedRelief = controls.lightScore?.reliefDepth;
    const relief = (Number.isFinite(requestedRelief) ? clamp(requestedRelief) : neutralRelief) / neutralRelief;
    ctx.save();
    let eyeMask = false;
    if (readEyes(tracking, time, sources, poses, eyes)) {
      const ex = (eyes.right.x - eyes.left.x) * width, ey = (eyes.right.y - eyes.left.y) * height;
      const span = Math.hypot(ex, ey);
      if (span > 1 && span < Math.min(width, height) * .64) {
        const cx = (eyes.right.x + eyes.left.x) * width / 2;
        const cy = (eyes.right.y + eyes.left.y) * height / 2;
        const yRadius = span * settings.eyeHeight * (eyes.singleEye ? 1.65 : 1);
        outsideEllipse(ctx, width, height, cx, cy, span * settings.eyeWidth, yRadius, Math.atan2(ey, ex));
        eyeMask = true;
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round';
    let segments = 0, afterimages = 0;
    for (const slot of slots) {
      if (!slot.hand || (!slot.live && !prepareHand(slot, width, height))) continue;
      const age = time - slot.lastVisible;
      const presence = slot.live ? 1 : .68 * clamp(1 - age / settings.holdMs) ** 2;
      if (!presence) continue;
      if (!slot.live) afterimages++;
      slot.relief = relief;
      ctx.globalAlpha = clamp(strength * presence);
      ctx.save();
      clipBehindHand(ctx, slot, width, height);
      if (slot.armLive) segments += paintArm(ctx, slot, width, height, false);
      for (let i = 0; i < 2; i++) segments += paintPalm(ctx, slot, false, i);
      ctx.restore();

      if (slot.armLive) segments += paintArm(ctx, slot, width, height, true);
      segments += paintPalmFoil(ctx, slot);
      segments += paintPalm(ctx, slot, true, 1);
      for (let i = 0; i < slot.fingerCount; i++) segments += paintFinger(ctx, slot, slot.fingerOrder[i]);
      segments += paintPalm(ctx, slot, true, 0);
    }
    ctx.restore();

    if (!active) return { source: afterimages ? 'hand afterimage' : 'waiting for hands', segments };
    const depth = withDepth === active ? 'local depth' : withDepth ? 'local depth + planar' : 'planar';
    const source = `${active} ${active === 1 ? 'hand' : 'hands'} · ${depth}`
      + (openPalm ? ' · open palm' : '') + (copperPinch ? ' · copper pinch' : '')
      + (arms ? ' · arm' : '') + (eyeMask ? ' · eye mask' : '') + (afterimages ? ' · afterimage' : '');
    return { source, segments };
  }

  return { render, reset };
}
