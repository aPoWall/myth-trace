import { CONFIG, clamp } from './config.js';
import { createAutoScore } from './auto-score.js';
import { drawFaceLinks } from './face-links.js';
import { createTrackingStudies } from './tracking-studies.js';
import { FACE_ANCHOR_IDS, latticeAnchors, measuredFaceAnchors, pinPosition } from './lattice.js';

const LABELS = ['01', '02', '03', '04', '05', '06', '07', '08'];
const TAU = 2 * Math.PI;
const RATIO_LABELS = ['1:1', '3:2', '2:1'];
const LOCAL_SHADOWS = Object.freeze([
  [[-.94, -.26], [-.35, -.86], [.13, -.30], [.87, -.55], [.47, .42], [-.33, .68]],
  [[-.67, -.72], [.25, -.8], [.85, -.10], [.28, .10], [.74, .75], [-.52, .50]],
  [[-.82, -.06], [-.28, -.61], [.30, -.83], [.84, -.24], [.49, .68], [-.40, .32]],
]);

export function createLightScore(settings = CONFIG.lightScore) {
  const xs = new Float32Array(settings.trailLength);
  const ys = new Float32Array(settings.trailLength);
  const times = new Float64Array(settings.trailLength);
  const nodes = new Float32Array(LABELS.length * 2);
  const paths = new Map();
  const demoStudies = new Map([
    ['time-filter-trails', createTrackingStudies()],
    ['finger-loom', createTrackingStudies()],
  ]);
  let lastLatticeSample = -Infinity;
  let write = 0;
  let count = 0;
  let lastSample = -Infinity;
  const leftTrailX = new Float32Array(settings.trailLength);
  const leftTrailY = new Float32Array(settings.trailLength);
  let pulse = 0;
  let lastTime = -Infinity;
  let pointerLatch = false;
  const autoScore = createAutoScore();
  const trackingStudies = createTrackingStudies();
  let wasAuto = false;

  function line(ctx, ax, ay, bx, by, color, alpha, width = 1) {
    ctx.strokeStyle = `rgba(${color},${clamp(alpha)})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  function beam(ctx, ax, ay, bx, by, color, gain) {
    line(ctx, ax, ay, bx, by, color, gain * .14, 11);
    line(ctx, ax, ay, bx, by, color, gain * .38, 3);
    line(ctx, ax, ay, bx, by, color, gain, 1.4);
  }

  function node(ctx, x, y, label, color, gain, active = false) {
    if (active) {
      const halo = ctx.createRadialGradient(x, y, 1, x, y, 44);
      halo.addColorStop(0, `rgba(${color},${gain * .96})`);
      halo.addColorStop(.18, `rgba(${color},${gain * .43})`);
      halo.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(x - 44, y - 44, 88, 88);
    }
    ctx.fillStyle = `rgba(${color},${gain})`;
    ctx.fillRect(x - 2, y - 2, 4, 4);
    ctx.fillText(label, x + 7, y - 6);
    if (active) {
      ctx.fillStyle = `rgba(255,244,208,${gain})`;
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
  }

  function drawSlices(ctx, width, height, time, start, end, colors, gain, energy, attack, framed, field) {
    const dx = end.x - start.x, dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 4) return;
    const size = Math.min(width, height);
    const nx = -dy / length, ny = dx / length;
    const clock = time * .001;
    const bands = field ? 14 : 9;
    for (let i = 0; i < bands; i++) {
      const t = (i + 1) / (bands + 1);
      const pulse = .68 + .32 * Math.sin(clock * 1.9 + i * .75 + energy * 3);
      const edge = size * (.027 + .075 * Math.sin(t * Math.PI)) * (1 + .48 * energy) * pulse;
      const x = start.x + dx * t, y = start.y + dy * t;
      const ax = x + nx * edge, ay = y + ny * edge;
      const bx = x - nx * edge, by = y - ny * edge;
      const offset = (i % 2 ? 1 : -1) * size * (.012 + .015 * attack);
      const tx = bx + (dx / length) * offset, ty = by + (dy / length) * offset;
      ctx.fillStyle = `rgba(${colors[1]},${gain * .10 * pulse})`;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(tx, ty); ctx.closePath(); ctx.fill();
      line(ctx, ax, ay, bx, by, colors[i % 3], gain * (.44 + energy * .38), 1.1 + attack);
      line(ctx, bx, by, tx, ty, colors[0], gain * .51);
      if (field) {
        const shift = (i % 3 - 1) * size * (.012 + attack * .055);
        const edgeRatio = .12 + .35 * pulse;
        line(ctx, ax + shift, ay, ax + shift + (bx - ax) * edgeRatio, ay + (by - ay) * edgeRatio,
          colors[2], gain * (.15 + energy * .3));
      }
      if (i % (field ? 3 : 2) === 0) node(ctx, bx, by, `/${i + 1}`, colors[1], gain * .66);
    }
    const h = .50 + .38 * Math.sin(clock * .7);
    const sx = start.x + dx * h, sy = start.y + dy * h;
    beam(ctx, framed ? start.x : 0, framed ? start.y : height * .64, sx, sy, colors[1], gain * (.44 + energy * .41));
    beam(ctx, framed ? end.x : width, framed ? end.y : height * .32, sx, sy, colors[2], gain * (.37 + energy * .48));
    node(ctx, sx, sy, '∩', colors[0], gain * (.49 + energy * .43), true);
  }

  function scatter(ctx, shapes, width, height, time, pointer, colors, gain, energy) {
    for (const [index, shape] of shapes.entries()) {
      const x = shape.x * width, y = shape.y * height;
      const r = shape.size * Math.min(width, height);
      const tilt = shape.angle + Math.sin(time * .00038 + index) * .16;
      const color = colors[index % 3];
      ctx.beginPath();
      for (let i = 0; i <= shape.sides; i++) {
        const a = tilt + i / shape.sides * TAU;
        const xx = x + Math.cos(a) * r, yy = y + Math.sin(a) * r;
        if (!i) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        if (i % 2 && i !== shape.sides) ctx.lineTo(x + Math.cos(a + .4) * r * .63, y + Math.sin(a + .4) * r * .63);
      }
      ctx.strokeStyle = `rgba(${color},${gain * (.38 + energy * .43)})`;
      ctx.lineWidth = 1; ctx.stroke();
      line(ctx, x, y, pointer.x * width, pointer.y * height, color, gain * .18);
      node(ctx, x, y, `S${index + 1}`, color, gain * .62);
    }
  }

  function drawLattice(ctx, width, height, time, tracking, controls, colors, gain, energy, attack) {
    const [amber, blue, red] = colors;
    const settings = CONFIG.lightScore.lattice;
    const anchors = latticeAnchors(tracking, time, controls.lightScore.sources);
    const pins = controls.lightScore.pins || [];
    const preview = controls.latticePreview;
    const px = point => ({ x: point.x * width, y: point.y * height });
    const live = Object.fromEntries(Object.entries(anchors).map(([id, point]) => [id, px(point)]));
    if (controls.lightScore.sources?.cursor !== false) live.cursor = px(controls.pointer);
    const fixed = pins.map((pin, index) => {
      const point = preview?.index === String(index) ? preview : pinPosition(pin, anchors);
      return point ? px(point) : null;
    });
    if (preview?.index === null) fixed.push(px(preview));
    const cursor = live.cursor;
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const tracing = ['palm.l', 'palm.r', 'cursor'];
    const clock = controls.reducedMotion ? 0 : time;
    const bounds = Math.min(width, height);
    const follow = (a, b, color, flux, phase) => {
      if (!a || !b || dist(a, b) < 3) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const motion = Math.sin(clock * .004 + phase) * (5 + attack * 21) * (1 + energy);
      const m = Math.max(1, Math.hypot(dx, dy));
      const mx = a.x + dx * .48 - dy / m * motion;
      const my = a.y + dy * .48 + dx / m * motion;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mx, my, b.x, b.y);
      ctx.strokeStyle = `rgba(5,8,12,${clamp(gain * flux * .66)})`;
      ctx.lineWidth = 2.4 + attack * 2;
      ctx.stroke();
      ctx.strokeStyle = `rgba(${color},${clamp(gain * flux * 1.28)})`;
      ctx.lineWidth = .85 + attack * 1.1;
      ctx.stroke();
      const t = (clock * (.00032 + energy * .0004) + phase * .149) % 1;
      if (!controls.reducedMotion) {
        ctx.fillStyle = `rgba(${color},${clamp(gain * flux * 1.3)})`;
        ctx.fillRect((1 - t) ** 2 * a.x + 2 * (1 - t) * t * mx + t * t * b.x,
          (1 - t) ** 2 * a.y + 2 * (1 - t) * t * my + t * t * b.y, 2, 2);
      }
    };
    const sample = time - lastLatticeSample >= settings.trailSampleMs;
    if (sample) lastLatticeSample = time;
    for (const id of tracing) {
      const point = live[id];
      const history = paths.get(id) || [];
      if (sample && point) history.push({ ...point, time });
      while (history.length > settings.maxTrails || time - history[0]?.time > settings.trailLifeMs) history.shift();
      paths.set(id, history);
      if (!controls.reducedMotion) for (let index = 1; index < history.length; index++) {
        const a = history[index - 1], b = history[index];
        if (b.time - a.time > settings.trailSampleMs * 3 || dist(a, b) > bounds * .20) continue;
        const tail = 1 - (time - a.time) / settings.trailLifeMs;
        line(ctx, a.x, a.y, b.x, b.y, blue, gain * tail * .46);
      }
    }
    ctx.setLineDash([2, 5]);
    follow(live['palm.l'], live['palm.r'], red, .49, 3);
    ctx.setLineDash([]);
    follow(live['palm.l'], cursor, blue, .70, 6);
    follow(live['palm.r'], cursor, red, .75, 7);
    for (const [i, point] of fixed.entries()) {
      if (!point) continue;
      let target = cursor;
      for (const anchor of Object.values(live)) if ((!target || dist(point, anchor) < dist(point, target)) && dist(point, anchor) > 4) target = anchor;
      follow(point, target, i % 2 ? red : amber, .86, 22 + i);
      if (target !== cursor) follow(point, cursor, blue, .43, 34 + i);
      if (fixed[i - 1]) follow(point, fixed[i - 1], blue, .47, 44 + i);
      if (i > 1 && fixed[0]) follow(point, fixed[0], blue, .27, 54 + i);
      node(ctx, point.x, point.y, `P${i + 1}`, amber, gain * .96, true);
    }
    for (const [id, point] of Object.entries(live)) {
      if (id.startsWith('obj:')) {
        let probe = cursor;
        for (const source of [live['tip.l'], live['tip.r'], live['palm.l'], live['palm.r']]) {
          if (source && (!probe || dist(source, point) < dist(probe, point))) probe = source;
        }
        const close = probe ? clamp(1 - dist(probe, point) / (bounds * .46)) : 0;
        if (probe) follow(probe, point, blue, .31 + close * .59, 38);
        node(ctx, point.x, point.y, String(anchors[id]?.label || 'object').toUpperCase(), blue, gain * (.41 + close * .55), close > .47);
        continue;
      }
      if (FACE_ANCHOR_IDS.includes(id)) continue;
      if (id.startsWith('tip')) {
        node(ctx, point.x, point.y, '+', blue, gain * .55);
        continue;
      }
      const color = id === 'palm.r' ? red : blue;
      node(ctx, point.x, point.y, id === 'cursor' ? '+' : id.toUpperCase(),
        color, gain, id.startsWith('palm'));
    }
    ctx.canvas.dataset.latticePins = String(pins.length);
    ctx.canvas.dataset.latticeAnchors = Object.keys(live).join(' ');
    ctx.canvas.dataset.latticeBindings = pins.map(pin => pin.anchor || 'free').join(' ');
    if (controls.debug) ctx.canvas.dataset.latticeNodes = JSON.stringify(Object.fromEntries(Object.entries(live).map(([id, point]) => [
      id, [Math.round(point.x), Math.round(point.y)],
    ])));
    else if (ctx.canvas.dataset.latticeNodes !== undefined) delete ctx.canvas.dataset.latticeNodes;
  }

  return function drawLightScore({ ctx, width, height, time, tracking, audio, controls, focus, frame }) {
    const { layers = {}, strength: baseStrength = 0, attack = 0, merge = false, auto = false, shadow, scatter: shapes } = controls.lightScore || {};
    const strength = controls.geometryMuted ? 0 : baseStrength;
    if (time < lastTime) {
      write = count = 0;
      lastSample = -Infinity;
      pulse = 0;
      pointerLatch = false;
      paths.clear();
      lastLatticeSample = -Infinity;
      autoScore.reset();
    }
    const colors = settings.palettes[controls.lightScore?.palette] || settings.colors;
    const drawStudy = (renderer, id, gain, allowPointer) => renderer.render({
      ctx, width, height, time, tracking, controls, strength: strength * gain, id, colors, allowPointer,
    });
    const mix = controls.demoMix;
    if (mix) {
      // Draw independent memories behind the principal study, then restore its original visual weight.
      for (const [id, weight, allowPointer = false] of mix.overlays) {
        const renderer = demoStudies.get(id);
        if (renderer) drawStudy(renderer, id, weight * (.55 + mix.effects[3] * .45), allowPointer);
      }
    }
    const study = trackingStudies.render({
      ctx, width, height, time, tracking, controls, strength, id: controls.lightScore?.study,
      colors,
    });
    if (ctx.canvas?.dataset) {
      if (study) {
        ctx.canvas.dataset.trackingStudy = controls.lightScore.study;
        ctx.canvas.dataset.studySource = study.source;
        ctx.canvas.dataset.studySegments = String(study.segments);
      } else {
        for (const key of ['trackingStudy', 'studySource', 'studySegments']) delete ctx.canvas.dataset[key];
      }
    }
    const features = strength > 0 && (auto || study || Object.keys(layers).length)
      ? measuredFaceAnchors(tracking, time, controls.lightScore?.sources) : {};
    const eyeCount = Number(Boolean(features['eye.l'])) + Number(Boolean(features['eye.r']));
    const canvasData = ctx.canvas?.dataset;
    if (canvasData) {
      if (eyeCount) canvasData.faceLinks = String(eyeCount);
      else delete canvasData.faceLinks;
    }
    const drawTrackedFace = () => {
      if (!eyeCount) return;
      const color = (settings.palettes[controls.lightScore.palette] || settings.colors)[1];
      const anchors = latticeAnchors(tracking, time, controls.lightScore.sources);
      drawFaceLinks(ctx, features, width, height, strength, color, anchors);
    };
    if (auto && strength > 0) {
      wasAuto = true;
      lastTime = time;
      const stage = autoScore.render({ ctx, width, height, time, tracking, audio, controls });
      ctx.canvas.dataset.autoPhrase = stage.form;
      ctx.canvas.dataset.autoDriver = stage.driver;
      ctx.canvas.dataset.autoNodes = stage.nodes.join(' ');
      ctx.canvas.dataset.latticePins = String(stage.pins);
      ctx.canvas.dataset.lightScoreActive = 'auto ' + stage.form;
      drawTrackedFace();
      return stage.driver;
    }
    if (wasAuto) {
      wasAuto = false;
      autoScore.reset();
      for (const key of ['autoPhrase', 'autoDriver', 'autoNodes', 'latticePins']) delete ctx.canvas.dataset[key];
    }
    if (!layers.lattice || strength <= 0) {
      if (ctx.canvas?.dataset?.latticeAnchors !== undefined) {
        delete ctx.canvas.dataset.latticeAnchors;
        delete ctx.canvas.dataset.latticePins;
        delete ctx.canvas.dataset.latticeBindings;
        delete ctx.canvas.dataset.latticeNodes;
      }
      paths.clear();
    }
    if ((!Object.keys(layers).length && !shadow && !merge && !shapes?.length) || strength <= 0) {
      write = count = 0;
      lastTime = time;
      if (ctx.canvas?.dataset) delete ctx.canvas.dataset.lightScoreActive;
      if (study) {
        drawTrackedFace();
        return study.source;
      }
      return 'off';
    }

    const left = tracking?.hands?.find(hand => hand.handedness === 'Left'
      && time - hand.lastSeen < settings.handFreshMs);
    const right = tracking?.hands?.find(hand => hand.handedness === 'Right'
      && time - hand.lastSeen < settings.handFreshMs);
    const input = right || left;
    const pointer = controls.pointer;
    const face = controls.lightScore.sources?.eyes
      ? tracking?.anchors?.find(anchor => anchor.kind === 'face' && anchor.confidence > .35) : null;
    const body = tracking?.poses?.[0]?.center;
    const box = frame?.confirmed ? frame.bbox : null;
    const centerX = box ? box.x + box.w / 2 : focus?.x ?? .5;
    const centerY = box ? box.y + box.h / 2 : focus?.y ?? .54;
    const cx = clamp(centerX, .18, .82) * width;
    const cy = clamp(centerY, .2, .8) * height;
    const px = clamp(input?.palm?.x ?? pointer.x) * width;
    const py = clamp(input?.palm?.y ?? pointer.y) * height;
    const output = controls.lightScore?.signal;
    const rms = Math.max(audio?.rms || 0, output?.rms || 0);
    const bass = Math.max(audio?.bass || 0, output?.bass || 0);
    const energy = clamp(rms * 2.5 + bass * .52);
    const field = controls.mode === 3;
    const activeLayers = Object.entries(layers).filter(([, weight]) => weight >= .001);
    const trigger = Math.max(clamp(audio?.beat), clamp(audio?.midiEnergy) * .55,
      pointer.down && !pointerLatch ? 1 : 0);
    pointerLatch = pointer.down;
    const delta = Number.isFinite(lastTime) ? Math.max(0, time - lastTime) : 0;
    pulse = Math.max(trigger, pulse * Math.exp(-delta / 145));
    lastTime = time;
    const twoHands = Boolean(left && right);
    const handLeftX = left ? clamp(left.palm?.x) * width : NaN;
    const handLeftY = left ? clamp(left.palm?.y) * height : NaN;
    if (layers.trail > 0 && time - lastSample >= settings.trailIntervalMs && (pointer.down || input)) {
      xs[write] = px; ys[write] = py; times[write] = time;
      leftTrailX[write] = twoHands ? handLeftX : NaN;
      leftTrailY[write] = twoHands ? handLeftY : NaN;
      write = (write + 1) % xs.length;
      count = Math.min(xs.length, count + 1);
      lastSample = time;
    }

    const intensity = clamp(strength * (.65 + energy * .26 + pulse * .18 + attack * .20));
    const [amber, blue, red] = colors;
    const baseRadius = Math.min(width, height) * settings.radius * (.74 + (left?.openness ?? .44) * .42 + energy * .18);
    const advance = controls.reducedMotion ? 0 : time * .00036;
    const activeIndex = Math.min(7, Math.floor(clamp(px / width) * 8));
    ctx.save();
    ctx.fillStyle = `rgba(3,8,14,${strength * settings.washOpacity * (.30 + attack * .32)})`;
    ctx.fillRect(0, 0, width, height);
    ctx.font = '10px "SFMono-Regular", Menlo, monospace';
    ctx.textBaseline = 'middle';
    const clock = controls.reducedMotion ? 0 : time;
    scatter(ctx, shapes || [], width, height, clock, pointer, colors, intensity, energy);
    const gain = intensity * (.45 + attack * .3);
    for (let i = 0; i < LABELS.length; i++) {
      const x = width * (.14 + i * .103);
      const y1 = height * .16;
      const y2 = height * .83;
      line(ctx, x, y1, x, y1 + (i === activeIndex ? 13 : 5), blue, gain * .58);
      line(ctx, x, y2, x, y2 + 6, blue, gain * .58);
      ctx.fillStyle = `rgba(${amber},${gain * (i === activeIndex ? .9 : .35)})`;
      ctx.fillText(LABELS[i], x, y1 - 8);
      ctx.fillText(LABELS[i], x, y2 + 14);
    }
    ctx.setLineDash([2, 7]);
    line(ctx, cx, height * .16, cx, height * .83, blue, gain * .34);
    line(ctx, width * .12, cy, width * .88, cy, blue, gain * .27);
    ctx.setLineDash([]);

    for (const [layerIndex, [mode, weight]] of activeLayers.entries()) {
      const phase = controls.reducedMotion ? 0 : time / settings.shadowIntervalMs;
      const mix = merge ? .24 + .76 * (.5 + .5 * Math.sin(phase * TAU + layerIndex * 2.4 + energy)) : 1;
      const gain = intensity * weight * mix;
      const origin = mode === 'orbit' && face ? face : mode === 'ratio' && input ? input.palm
        : mode === 'ratio' ? body : null;
      const cx = (origin?.x ?? centerX) * width;
      const cy = (origin?.y ?? centerY) * height;
      const radius = baseRadius * (1 + attack * .2 + (field ? .14 : 0));
      const angle = Math.atan2(py - cy, px - cx);
      if (mode === 'lattice') {
        drawLattice(ctx, width, height, time, tracking, controls, colors, gain, energy, attack);
      } else if (mode === 'slice') {
        const start = box ? { x: box.x * width, y: (box.y + box.h) * height }
          : twoHands ? { x: handLeftX, y: handLeftY }
          : { x: (face?.x ?? centerX - .20) * width, y: (face?.y ?? centerY + .13) * height };
        const end = box ? { x: (box.x + box.w) * width, y: box.y * height }
          : { x: px, y: py };
        drawSlices(ctx, width, height, controls.reducedMotion ? 0 : time, start, end, colors, gain, energy, attack, Boolean(box), field);
      } else if (mode === 'cross') {
        for (let i = 0; i < LABELS.length; i++) {
          const a = i * TAU / LABELS.length + angle * .42;
          const r = radius * (i % 2 ? .74 : 1);
          nodes[i * 2] = cx + Math.cos(a) * r;
          nodes[i * 2 + 1] = cy + Math.sin(a) * r;
        }
        for (let i = 0; i < LABELS.length; i++) {
          const next = (i + (i % 2 ? 2 : 3)) % LABELS.length;
          const x = nodes[i * 2], y = nodes[i * 2 + 1];
          line(ctx, x, y, nodes[next * 2], nodes[next * 2 + 1], i % 2 ? blue : amber, gain * .5);
          node(ctx, x, y, LABELS[i], amber, gain, i === activeIndex);
        }
        const hitX = nodes[activeIndex * 2], hitY = nodes[activeIndex * 2 + 1];
        beam(ctx, 0, height * .48, hitX, hitY, blue, gain * .82);
        beam(ctx, px, py, hitX, hitY, amber, gain);
        beam(ctx, width, height * .67, hitX, hitY, red, gain * .62);
      } else if (mode === 'orbit' || mode === 'ratio') {
        for (let i = 0; i < settings.ratios.length; i++) {
          const ratio = settings.ratios[i];
          const r = radius * (.5 + i * .37);
          const color = colors[i];
          const a = angle * ratio + advance / ratio + i;
          const rotation = angle * .17;
          ctx.strokeStyle = `rgba(${color},${gain * .43})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          if (mode === 'ratio') {
            for (let j = 0; j <= 72; j++) {
              const t = j * TAU / 36 + a;
              const x = cx + Math.sin(t * ratio) * r;
              const y = cy + Math.sin(t + angle) * r * .66;
              if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y);
            }
          } else {
            ctx.ellipse(cx, cy, r, r * .67, rotation, a - 2.35, a + .65);
          }
          ctx.stroke();
          const dx = Math.cos(a) * r, dy = Math.sin(a) * r * .67;
          const x = cx + (mode === 'ratio' ? Math.sin(a * ratio) * r
            : dx * Math.cos(rotation) - dy * Math.sin(rotation));
          const y = cy + (mode === 'ratio' ? Math.sin(a + angle) * r * .66
            : dx * Math.sin(rotation) + dy * Math.cos(rotation));
          beam(ctx, px, py, x, y, color, gain * .7);
          node(ctx, x, y, RATIO_LABELS[i], color, gain, true);
        }
      } else if (mode === 'mesh') {
        const lx = twoHands ? handLeftX : cx - radius * 1.15;
        const ly = twoHands ? handLeftY : cy + radius * .32;
        const bend = radius * (.5 + energy * .58);
        for (let i = 0; i < LABELS.length; i++) {
          const phase = i * TAU / LABELS.length + angle * .3;
          const middleX = (lx + px) / 2 + Math.cos(phase) * bend;
          const middleY = (ly + py) / 2 + Math.sin(phase) * bend;
          nodes[i * 2] = middleX;
          nodes[i * 2 + 1] = middleY;
          const active = i === activeIndex;
          const color = active ? amber : blue;
          line(ctx, lx, ly, middleX, middleY, color, gain * .55);
          line(ctx, middleX, middleY, px, py, color, gain * .7);
          node(ctx, middleX, middleY, LABELS[i], color, gain, active);
        }
        for (let i = 0; i < LABELS.length; i++) {
          const next = (i + 3) % LABELS.length;
          line(ctx, nodes[i * 2], nodes[i * 2 + 1], nodes[next * 2], nodes[next * 2 + 1], blue, gain * .37);
        }
        node(ctx, lx, ly, 'L', blue, gain, true);
        node(ctx, px, py, 'R', amber, gain, true);
      } else {
        let previous = -1;
        for (let i = 0; i < count; i++) {
          const index = (write - count + i + xs.length) % xs.length;
          const alpha = gain * clamp(1 - (time - times[index]) / (settings.trailLifetimeMs * (1 + attack * .42)));
          if (alpha <= 0) continue;
          if (previous >= 0) {
            line(ctx, xs[previous], ys[previous], xs[index], ys[index], blue, alpha, 1.3 + attack);
            if (Number.isFinite(leftTrailX[previous]) && Number.isFinite(leftTrailX[index])) {
              line(ctx, leftTrailX[previous], leftTrailY[previous], leftTrailX[index], leftTrailY[index], red, alpha, 1.3 + attack);
              if (i % 5 === 0) line(ctx, leftTrailX[index], leftTrailY[index], xs[index], ys[index], amber, alpha * .32);
            }
          }
          if (i % 4 === 0) node(ctx, xs[index], ys[index], LABELS[i % LABELS.length], blue, alpha);
          previous = index;
        }
        beam(ctx, cx, cy, px, py, amber, gain * .8);
        node(ctx, px, py, 'R', amber, gain, true);
        if (twoHands) node(ctx, handLeftX, handLeftY, 'L', red, gain, true);
      }
    }
    const cycle = controls.reducedMotion ? 0 : time / settings.shadowIntervalMs;
    const shape = shadow || (merge ? LOCAL_SHADOWS[Math.floor(cycle) % LOCAL_SHADOWS.length] : null);
    if (shape) {
      const scale = baseRadius * (1 + attack * .4);
      const edge = (.55 + energy * .3) * (shadow || controls.reducedMotion ? 1 : .24 + .76 * Math.sin((cycle % 1) * Math.PI));
      const center = body || face;
      const sx = center ? center.x * width : cx;
      const sy = center ? center.y * height : cy;
      for (let index = 0; index < shape.length; index++) {
        const [ax, ay] = shape[index];
        const [bx, by] = shape[(index + 1) % shape.length];
        line(ctx, sx + ax * scale, sy + ay * scale, sx + bx * scale, sy + by * scale, red, intensity * edge, 1 + attack);
        line(ctx, sx + ax * scale, sy + ay * scale, px, py, blue, intensity * edge * .24);
      }
    }
    ctx.restore();
    drawTrackedFace();
    if (ctx.canvas.dataset.lightScoreActive !== activeLayers.map(([name]) => name).join(' ')) {
      ctx.canvas.dataset.lightScoreActive = activeLayers.map(([name]) => name).join(' ');
    }
    return input ? 'hands' : 'pointer';
  };
}
