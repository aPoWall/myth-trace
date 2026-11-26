import { clamp } from './config.js';

const TAU = 2 * Math.PI;
const ROOT3 = Math.sqrt(3);
const LAYER_GAP = Math.sqrt(2 / 3);
const kinds = ['rosette', 'plane', 'crystal'];

function lattice(radius, layers) {
  const nodes = [];
  for (const layer of layers) {
    for (let q = -radius; q <= radius; q++) {
      for (let r = -radius; r <= radius; r++) {
        if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) > radius) continue;
        const shift = layer / 3;
        nodes.push({
          q, r, layer, shell: Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)),
          x: q + shift + (r + shift) / 2, y: (r + shift) * ROOT3 / 2, z: layer * LAYER_GAP,
        });
      }
    }
  }
  const edges = [];
  const center = nodes.findIndex(n => n.q === 0 && n.r === 0 && n.layer === 0);
  const neighbors = [];
  for (const [i, a] of nodes.entries()) {
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const distance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (Math.abs(distance - 1) > 1e-6) continue;
      edges.push([i, j]);
      if (i === center || j === center) neighbors.push(i === center ? j : i);
    }
  }
  return { nodes, edges, center, neighbors, points: nodes.map(() => ({ x: 0, y: 0, depth: 0 })) };
}

const guides = {
  rosette: '7 equal circles · hexagon side equals radius',
  plane: '(111) plane · six nearest neighbours',
  crystal: 'FCC · ABC stacking · 6 in-plane + 3 above + 3 below',
};
const hues = ['131,173,197', '207,222,227', '190,141,101'];
const core = '228,234,235';
const amber = '236,156,97';

export function createFocusField(config) {
  const structures = {
    rosette: lattice(1, [0]),
    plane: lattice(3, [0]),
    crystal: lattice(2, [-1, 0, 1]),
  };
  let subjectId, seenAt, lastTime, aimX, aimY, turn, pitch, cycleTime, phase, lastCue;
  let mode, priorMode, switchedAt, currentChoice, activeHit;
  const haze = [];
  for (let i = 0; i < config.grainCount; i++) {
    const random = Math.sin((i + 1) * 91.713) * 43758.5453;
    const x = random - Math.floor(random);
    const flip = Math.sin((i + 1) * 127.187) * 38951.619;
    const y = flip - Math.floor(flip);
    haze.push([x, y]);
  }

  function reset() {
    subjectId = '';
    seenAt = lastTime = -Infinity;
    turn = .16;
    pitch = .58;
    aimX = aimY = .5;
    cycleTime = phase = lastCue = 0;
    mode = priorMode = currentChoice = '';
    activeHit = null;
    switchedAt = -Infinity;
  }
  reset();

  function chooseSubject(anchors, time) {
    let candidate, held, max = 0;
    for (const anchor of anchors) {
      const priority = config.anchors[anchor.kind];
      if (!priority || anchor.confidence < config.confidence) continue;
      if (anchor.id === subjectId) held = anchor;
      const score = anchor.confidence * priority;
      if (score > max) { candidate = anchor; max = score; }
    }
    if (held) { seenAt = time; return held; }
    if (subjectId && time - seenAt < config.holdMs) return null;
    subjectId = candidate?.id || '';
    seenAt = candidate ? time : -Infinity;
    return candidate;
  }

  function stroke(ctx, ax, ay, bx, by, color, opacity, width = 1) {
    ctx.strokeStyle = `rgba(${color},${clamp(opacity)})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  function halo(ctx, x, y, radius, color, alpha) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${color},${alpha})`);
    gradient.addColorStop(.28, `rgba(${color},${alpha * .42})`);
    gradient.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  function field(ctx, width, height, scale, x, y, hit, cameraVisible) {
    ctx.fillStyle = `rgba(3,6,9,${cameraVisible ? .28 : config.backgroundAlpha})`;
    ctx.fillRect(0, 0, width, height);
    halo(ctx, x, y, scale * .60, '38,65,78', .47);
    if (hit) halo(ctx, hit.x, hit.y, scale * .29, '63,108,127', .29);
    ctx.fillStyle = 'rgba(182,207,220,.12)';
    for (const [u, v] of haze) ctx.fillRect(u * width, v * height, u < .94 ? 1 : 2, 1);
    const top = height * .145, bottom = height * .855;
    const left = width * .13, right = width * .87;
    ctx.font = `${Math.max(8, scale * .013)}px monospace`;
    for (let i = 0; i <= 24; i++) {
      const gx = left + (right - left) * i / 24;
      stroke(ctx, gx, top, gx, bottom, '124,164,183', i % 6 === 0 ? .15 : .071);
      ctx.fillStyle = 'rgba(153,181,191,.44)';
      ctx.fillRect(gx, bottom, 1, i % 6 ? 3 : 8);
      if (i % 6 === 0) ctx.fillText(String(i).padStart(2, '0'), gx + 4, bottom + 17);
    }
    for (let i = 0; i <= 8; i++) {
      const gy = top + (bottom - top) * i / 8;
      stroke(ctx, left, gy, right, gy, '124,164,183', i % 4 === 0 ? .14 : .075);
    }
    ctx.strokeStyle = 'rgba(145,180,193,.30)';
    ctx.strokeRect(left, top, right - left, bottom - top);
    for (const u of [left, right]) {
      for (const v of [top, bottom]) {
        stroke(ctx, u, v, u + (u === left ? 13 : -13), v, core, .46);
        stroke(ctx, u, v, u, v + (v === top ? 13 : -13), core, .46);
      }
    }
  }

  function project(structure, kind, x, y, scale) {
    const rotation = kind === 'crystal' ? turn : turn * .62;
    const tilt = kind === 'crystal' ? pitch : 0;
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const cp = Math.cos(tilt), sp = Math.sin(tilt);
    const step = scale * config.spacing[kind];
    for (const [i, node] of structure.nodes.entries()) {
      const px = cos * node.x - sin * node.y;
      const py = sin * node.x + cos * node.y;
      const p = structure.points[i];
      p.x = x + step * px;
      p.y = y + step * (cp * py - sp * node.z);
      p.depth = sp * py + cp * node.z;
    }
    return step;
  }

  function rosette(ctx, structure, step, index, pulse) {
    for (const [i, p] of structure.points.entries()) {
      ctx.strokeStyle = `rgba(${i === index ? amber : core},${i === index ? .69 : .34})`;
      ctx.lineWidth = i === index ? 1.45 : .85;
      ctx.beginPath();
      ctx.arc(p.x, p.y, step, 0, TAU);
      ctx.stroke();
    }
    const c = structure.points[structure.center], p = structure.points[index];
    stroke(ctx, c.x, c.y, p.x, p.y, amber, .78 + pulse * .18, 1.25);
    ctx.fillStyle = `rgba(${amber},.8)`;
    ctx.fillText('r', (c.x + p.x) / 2 + 5, (c.y + p.y) / 2 - 5);
  }

  function drawStructure(ctx, kind, structure, x, y, scale, strength, index, presence) {
    const step = project(structure, kind, x, y, scale);
    const points = structure.points;
    const center = points[structure.center];
    const hit = points[index];
    ctx.save();
    ctx.globalAlpha *= presence;
    if (kind === 'rosette') rosette(ctx, structure, step, index, strength);
    for (const [a, b] of structure.edges) {
      const pa = points[a], pb = points[b], na = structure.nodes[a], nb = structure.nodes[b];
      const central = a === structure.center || b === structure.center;
      const lit = central && (a === index || b === index);
      const sameLayer = na.layer === nb.layer;
      const color = lit ? amber : sameLayer ? hues[na.layer + 1] : core;
      const depth = clamp((pa.depth + pb.depth + 4) / 8);
      const opacity = lit ? .94 : central ? .59 : kind === 'rosette' ? .36 : sameLayer ? .18 + depth * .23 : .085 + depth * .08;
      stroke(ctx, pa.x, pa.y, pb.x, pb.y, color, opacity, lit ? 1.65 : .82);
    }
    for (const [i, p] of points.entries()) {
      const node = structure.nodes[i];
      const close = structure.neighbors.includes(i);
      const color = i === index ? amber : hues[node.layer + 1];
      const size = i === index ? 4 : close ? 3 : 1.5;
      ctx.fillStyle = `rgba(${color},${i === index ? 1 : close ? .91 : .28 + clamp((p.depth + 2) / 5) * .27})`;
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      if (kind !== 'rosette' && close && (kind === 'plane' || i === index)) ctx.fillText(
        kind === 'crystal' ? 'ABC'[node.layer + 1] : String(structure.neighbors.indexOf(i) + 1).padStart(2, '0'), p.x + 6, p.y - 5);
    }
    if (kind === 'crystal') {
      for (const layer of [-1, 0, 1]) {
        const edge = structure.nodes.findIndex(node => node.layer === layer && node.q === -2 && node.r === 0);
        const p = points[edge];
        ctx.fillStyle = `rgba(${hues[layer + 1]},.91)`;
        ctx.fillText('ABC'[layer + 1], p.x - 15, p.y);
      }
    }
    halo(ctx, hit.x, hit.y, scale * (.078 + strength * .066), amber, .53 + strength * .24);
    halo(ctx, center.x, center.y, scale * .087, '167,205,226', .42);
    ctx.fillStyle = '#edf3f2';
    ctx.fillRect(center.x - 2, center.y - 2, 4, 4);
    ctx.strokeStyle = `rgba(${core},.84)`;
    ctx.strokeRect(center.x - 7, center.y - 7, 14, 14);
    ctx.restore();
    return hit;
  }

  function render(ctx, width, height, time, tracking, audio, controls) {
    const dt = Number.isFinite(lastTime) ? Math.min(100, Math.max(0, time - lastTime)) : 0;
    lastTime = time;
    const choice = controls.focusGeometry || 'auto';
    if (choice !== currentChoice) { currentChoice = choice; cycleTime = 0; }
    if (!controls.reducedMotion) cycleTime += dt;
    const next = choice === 'auto' ? kinds[Math.floor(cycleTime / config.chapterMs) % kinds.length] : choice;
    if (next !== mode) { priorMode = mode; mode = next; switchedAt = time; }
    const easing = 1 - Math.exp(-dt / config.followMs);
    const subject = chooseSubject(tracking?.anchors || [], time);
    const manualAim = controls.pointer.focusActive;
    const guide = controls.hud !== false;
    if (subject || !subjectId) {
      aimX = subject?.x ?? (manualAim ? controls.pointer.x : .5);
      aimY = subject?.y ?? (manualAim ? controls.pointer.y : .5);
    }
    const t = controls.reducedMotion ? 0 : time * .001;
    const yaw = .19 + Math.sin(t * .33) * .24 + (aimX - .5) * 1.6;
    const tilt = clamp(.56 + Math.sin(t * .24) * .22 + (aimY - .5) * 1.3, 0, 1.23);
    turn += (yaw - turn) * easing;
    pitch += (tilt - pitch) * easing;
    const cue = controls.focusCue || 0;
    if (cue > lastCue) phase += cue - lastCue;
    if (!controls.focusPlaying && Math.floor(cycleTime / config.idleCueMs) !== Math.floor((cycleTime - dt) / config.idleCueMs)) phase++;
    lastCue = cue;
    const strength = clamp(Math.max(audio?.bass || 0, (controls.lightScore?.signal?.rms || 0) * 9));
    const scale = Math.min(width, height);
    const x = width * .5, y = height * .49;
    const fade = controls.reducedMotion || !priorMode ? 1 : clamp((time - switchedAt) / config.crossfadeMs);
    ctx.save();
    field(ctx, width, height, scale, x, y, activeHit, controls.focusCameraVisible);
    const draw = (kind, alpha) => {
      const shape = structures[kind];
      const index = shape.neighbors[phase % shape.neighbors.length];
      return drawStructure(ctx, kind, shape, x, y, scale, strength, index, alpha * (controls.lightScore?.strength ?? 1));
    };
    if (fade < 1) draw(priorMode, 1 - fade);
    activeHit = draw(mode, fade);
    ctx.restore();
    const canvas = ctx.canvas;
    if (canvas.dataset.focusFieldNode !== String(phase)) canvas.dataset.focusFieldNode = String(phase);
    if (canvas.dataset.focusGeometry !== mode) canvas.dataset.focusGeometry = mode;
    const count = String(structures[mode].neighbors.length);
    if (canvas.dataset.focusNeighbors !== count) canvas.dataset.focusNeighbors = count;
    if (guide && canvas.dataset.focusGuide !== guides[mode]) canvas.dataset.focusGuide = guides[mode];
    return subjectId || (manualAim ? 'pointer' : 'auto');
  }
  return { render, reset };
}
