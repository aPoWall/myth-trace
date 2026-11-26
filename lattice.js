import { CONFIG, clamp } from './config.js';

const settings = CONFIG.lightScore.lattice;
export const FACE_ANCHOR_IDS = Object.freeze([
  'eye.l', 'eye.r', 'eye.l.inner', 'eye.l.outer', 'eye.r.inner', 'eye.r.outer',
  'nose', 'nose.bridge', 'mouth', 'cheek.l', 'cheek.r', 'chin',
]);
const faceSettings = CONFIG.lightScore.faceLinks;

export function measuredFace(tracking, time, sources) {
  if (sources?.eyes === false || tracking?.camera?.active === false) return null;
  return tracking?.faces?.find(subject => subject.score >= faceSettings.minScore
    && time - subject.lastSeen <= faceSettings.maxAgeMs) || null;
}
export const measuredFaceAnchors = (tracking, time, sources) => measuredFace(tracking, time, sources)?.features || {};
const HAND_FEATURES = [['palm.l', 'Left'], ['palm.r', 'Right']];

export function scoreAnchors(tracking, time, sources, pointer, room, cover) {
  const anchors = latticeAnchors(tracking, time, sources);
  const nodes = Object.entries(anchors).map(([id, point]) => ({
    ...point, id, source: id.startsWith('obj:') ? 'object' : id.startsWith('palm') || id.startsWith('tip')
      ? 'hand' : 'face',
  }));
  if (cover) {
    for (const node of nodes) if (node.source === 'object') {
      const [x, y, w, h] = cover;
      node.x = x + node.x * w;
      node.y = y + node.y * h;
      node.source = 'clip';
    }
  }
  const pose = tracking?.poses?.find(item => item.score > .45 && time - item.lastSeen < settings.eyeHoldMs);
  if (pose?.center) nodes.push({ ...pose.center, id: 'body', label: 'body center', source: 'pose' });
  if (sources?.cursor !== false && pointer) nodes.push({ x: pointer.x, y: pointer.y, id: 'cursor', label: 'pointer', source: 'pointer' });
  if (room) {
    const distance = point => Math.hypot(point.x - (pointer?.x ?? .5), point.y - (pointer?.y ?? .5));
    const corners = [...room.points].sort((a, b) => Number(b.id === room.locked) - Number(a.id === room.locked) || distance(a) - distance(b));
    for (const point of corners.slice(0, 6)) {
      nodes.push({ x: point.x, y: point.y, id: `corner.${point.id}`, label: `corner ${point.id}`, source: 'room', locked: point.id === room.locked });
    }
  }
  return nodes.filter(node => node.x >= 0 && node.x <= 1 && node.y >= 0 && node.y <= 1);
}

export function latticeAnchors(tracking, time, sources) {
  const nodes = {};
  const face = measuredFaceAnchors(tracking, time, sources);
  for (const id of FACE_ANCHOR_IDS) if (face[id]) nodes[id] = face[id];
  for (const [name, side] of HAND_FEATURES) {
    if (sources?.hands === false) break;
    const hand = tracking?.hands?.find(item => item.handedness === side && time - item.lastSeen < CONFIG.lightScore.handFreshMs);
    if (hand?.palm) {
      nodes[name] = hand.palm;
      if (hand.landmarks?.[8]) nodes[name.replace('palm', 'tip')] = hand.landmarks[8];
    }
  }
  for (const object of (tracking?.objects || []).filter(object => object.score >= .5 && time - object.lastSeen < 500)
    .sort((a, b) => b.score - a.score).slice(0, 3)) {
    const box = object.bbox;
    if (box) nodes[`obj:${object.id}`] = { x: box.x + box.w / 2, y: box.y + box.h / 2, label: object.label };
  }
  return nodes;
}

export function pinPosition(pin, anchors) {
  const point = anchors[pin.anchor];
  if (point) return { x: clamp(point.x + pin.dx), y: clamp(point.y + pin.dy) };
  return FACE_ANCHOR_IDS.includes(pin.anchor) ? null : { x: pin.x, y: pin.y };
}

export function nearestNode(nodes, point, width, height, radius) {
  let best = null;
  let distance = radius;
  for (const [id, node] of Object.entries(nodes)) {
    if (!node) continue;
    const next = Math.hypot((point.x - node.x) * width, (point.y - node.y) * height);
    if (next < distance) { distance = next; best = id; }
  }
  return best;
}

export function placePin(point, anchors, width, height, free = false) {
  const anchor = !free && nearestNode(anchors, point, width, height, settings.snapPx);
  if (!anchor) return { x: point.x, y: point.y, anchor: '' };
  return { x: point.x, y: point.y, anchor, dx: 0, dy: 0 };
}
