import { CONFIG, clamp } from './config.js';
import { measuredFace, scoreAnchors } from './lattice.js';
import { paintPerformanceEtching } from './performance-etching.js';
import { createPigmentRelief, matchMeasuredWrist } from './pigment-relief.js';
import { proximityMesh } from './proximity-mesh.js';

const rules = CONFIG.lightScore.studies;
const isPoint = point => Number.isFinite(point?.x) && Number.isFinite(point.y)
  && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
const isFresh = (track, time) => track?.id && !track.stale && track.score >= rules.confidence
  && time >= track.lastSeen && time - track.lastSeen <= rules.freshMs;
const cubeVertices = Array.from({ length: 16 }, (_, bits) =>
  [1, 2, 4, 8].map(bit => bits & bit ? 1 : -1));
const cubeEdges = cubeVertices.flatMap((_, bits) =>
  [1, 2, 4, 8].filter(bit => !(bits & bit)).map(bit => [bits, bits | bit]));

export function createTrackingStudies() {
  const paths = new Map();
  const pigmentRelief = createPigmentRelief();
  let study = '', previousTime = -Infinity;

  function reset() {
    paths.clear();
    pigmentRelief.reset();
    study = '';
    previousTime = -Infinity;
  }

  function render({ ctx, width, height, time, tracking, controls, strength, id, colors, allowPointer = true }) {
    if (!id || !strength || id !== study || time < previousTime) reset();
    if (!id || !strength) return null;
    study = id;
    previousTime = time;
    if (id === 'pigment-relief') return pigmentRelief.render({ ctx, width, height, time, tracking, controls, strength });
    if (id === 'kosmodrom') return {source: controls.sector?.source || 'standby', segments: 0};
    const { pointer, lightScore: score } = controls;
    const hands = score.sources.hands === false ? [] : (tracking.hands || []).filter(hand =>
      isFresh(hand, time) && isPoint(hand.palm)).slice(0, 2);
    const pose = tracking.poses?.find(item => isFresh(item, time) && isPoint(item.center));
    const [warm, ice, copper] = colors;
    let segments = 0;

    function line(a, b, color, gain, weight = 1) {
      ctx.lineWidth = weight;
      ctx.strokeStyle = `rgba(${color},${clamp(gain * strength)})`;
      ctx.beginPath();
      ctx.moveTo(a.x * width, a.y * height);
      ctx.lineTo(b.x * width, b.y * height);
      ctx.stroke();
      segments++;
    }

    function mark(point, color, gain = 1, radius = 2) {
      ctx.fillStyle = `rgba(${color},${clamp(gain * strength)})`;
      ctx.fillRect(point.x * width - radius, point.y * height - radius, radius * 2, radius * 2);
    }

    function drawFingers() {
      let tips = 0;
      for (const hand of hands) {
        const points = hand.landmarks || [];
        for (const chain of rules.fingers) {
          for (let i = 1; i < chain.length; i++) {
            const a = points[chain[i - 1]], b = points[chain[i]];
            if (isPoint(a) && isPoint(b)) {
              const tipBone = i === chain.length - 1 && chain.length > 2;
              if (tipBone) line(a, b, '6,10,14', .86, 3.4);
              line(a, b, tipBone ? warm : ice, tipBone ? .94 : .65, tipBone ? 1.65 : 1.25);
            }
          }
          const tip = points[chain.at(-1)];
          if (chain.length < 3 || !isPoint(tip)) continue;
          tips++;
          mark(tip, warm, .92, 2.3);
        }
        const pinch = clamp(hand.pinchRaw ?? hand.pinch ?? 0);
        if (isPoint(points[4]) && isPoint(points[8])) {
          line(points[4], points[8], warm, .14 + pinch * .83, 1 + pinch * 1.8);
        }
      }
      if (tips) return 'fingers';
      if (measuredFace(tracking, time, score.sources)?.features?.['eye.l']) return 'face';
      return controls.demoActive && allowPointer ? drawCube() : drawPointer();
    }

    function drawExpression(kind) {
      const face = measuredFace(tracking, time, score.sources);
      const { 'eye.l': left, 'eye.r': right, mouth, 'cheek.l': cheekL, 'cheek.r': cheekR } = face?.features || {};
      if (![left, right, mouth].every(isPoint)) return drawPointer();
      if (kind === 'smile-prism') {
        const smile = clamp(face.blendshapes?.smile || 0);
        if (![cheekL, cheekR].every(isPoint)) return 'face';
        for (const [eye, cheek] of [[left, cheekL], [right, cheekR]]) {
          const flare = { x: cheek.x + (cheek.x - mouth.x) * (.12 + smile * rules.expression.prismSpread),
            y: cheek.y + (cheek.y - eye.y) * .26 };
          line(eye, cheek, ice, .68, 1.45);
          line(cheek, mouth, ice, .54, 1.35);
          line(eye, flare, copper, .33 + smile * .49, 1.4);
          line(flare, mouth, copper, .38 + smile * .52, 1.55);
          line(flare, cheek, warm, .28 + smile * .62);
          mark(flare, warm, .51 + smile * .44);
        }
      } else {
        const jaw = clamp(face.blendshapes?.jawOpen || 0);
        const dx = (right.x - left.x) * width, dy = (right.y - left.y) * height;
        const span = Math.min(Math.hypot(dx, dy), Math.min(width, height) * rules.expression.maxRingSpan);
        const angle = Math.atan2(dy, dx), ca = Math.cos(angle), sa = Math.sin(angle);
        const { ringCount, ringSegments } = rules.expression;
        for (let ring = 0; ring < ringCount; ring++) {
          for (const side of [0, Math.PI]) {
            const color = ring === 0 ? warm : ice;
            const gain = (.67 + jaw * .3) / (1 + ring * .32);
            ctx.strokeStyle = `rgba(${color},${clamp(gain * strength)})`;
            ctx.lineWidth = ring === 0 ? 1.55 : 1.15;
            ctx.beginPath();
            for (let i = 0; i <= ringSegments; i++) {
              const step = side + .17 + (Math.PI - .34) * i / ringSegments;
              const x = Math.cos(step) * span * (.37 + ring * .17) * (1 + jaw * .43);
              const y = Math.sin(step) * span * (.11 + ring * .10) * (1 + jaw * 1.65);
              const point = { x: mouth.x + (ca * x - sa * y) / width, y: mouth.y + (sa * x + ca * y) / height };
              if (i) ctx.lineTo(point.x * width, point.y * height);
              else ctx.moveTo(point.x * width, point.y * height);
              if (i === 0 || i === ringSegments) mark(point, warm, .64 + jaw * .3, 1.65);
            }
            ctx.stroke();
            segments += ringSegments;
          }
        }
      }
      mark(mouth, warm, .9);
      return 'face';
    }

    function drawJoints() {
      const joints = new Map();
      for (const anchor of tracking.anchors) {
        if (pose && anchor.id.startsWith(pose.id + ':joint:') && anchor.confidence >= rules.confidence
          && isPoint(anchor)) joints.set(anchor.label, anchor);
      }
      for (const [a, b] of rules.poseEdges) {
        if (joints.has(a) && joints.has(b)) line(joints.get(a), joints.get(b), ice, .75, 1.4);
      }
      for (const joint of joints.values()) mark(joint, ice, .85);
      let leftHand, rightHand, ambiguousLeft = false, ambiguousRight = false;
      for (const hand of hands) {
        const side = hand.handedness?.toLowerCase();
        const wrist = joints.get(side + ' wrist');
        const otherWrist = joints.get(side === 'left' ? 'right wrist' : 'left wrist');
        const tip = hand.landmarks?.[8];
        if (matchMeasuredWrist(hand, wrist, otherWrist, width, height)) {
          if (side === 'left') {
            ambiguousLeft ||= Boolean(leftHand);
            leftHand = hand;
          }
          if (side === 'right') {
            ambiguousRight ||= Boolean(rightHand);
            rightHand = hand;
          }
        }
        if (isPoint(tip)) line(hand.palm, tip, warm, .92, 1.6);
        mark(hand.palm, warm);
        if (isPoint(tip)) mark(tip, copper, 1, 3);
      }
      if (ambiguousLeft) leftHand = null;
      if (ambiguousRight) rightHand = null;
      if (leftHand) line(joints.get('left wrist'), leftHand.palm, ice, .60);
      if (rightHand) line(joints.get('right wrist'), rightHand.palm, ice, .60);
      if (leftHand && rightHand) line(leftHand.palm, rightHand.palm, copper, .45);
      if (hands.length || joints.size) return 'joints';
      return drawPointer();
    }

    function drawPointer() {
      if (allowPointer && score.sources.cursor && isPoint(pointer)) {
        const size = rules.pointerReticlePx;
        line({ x: pointer.x - size / width, y: pointer.y }, { x: pointer.x + size / width, y: pointer.y }, ice, .85);
        line({ x: pointer.x, y: pointer.y - size / height }, { x: pointer.x, y: pointer.y + size / height }, ice, .85);
        mark(pointer, warm);
        return 'pointer';
      }
      return 'waiting';
    }

    function drawCube() {
      const lead = hands[0]?.palm || (allowPointer && score.sources.cursor && isPoint(pointer) ? pointer : null);
      if (!lead) return 'waiting';
      const other = hands[1]?.palm;
      const center = other ? { x: (lead.x + other.x) / 2, y: (lead.y + other.y) / 2 } : lead;
      const span = Math.min(width, height);
      const size = span * rules.cubeScale * (other
        ? clamp(Math.hypot((other.x - lead.x) * width, (other.y - lead.y) * height) / (span * .38), .70, 1.5) : 1);
      const theta = .46 + (other ? Math.atan2(other.y - lead.y, other.x - lead.x) * .56 : lead.x * 1.52);
      const phi = .29 + lead.y * 1.21;
      const c = Math.cos(theta), s = Math.sin(theta), u = Math.cos(phi), v = Math.sin(phi);
      const cx = clamp(center.x, .22, .78), cy = clamp(center.y, .24, .76);
      const points = cubeVertices.map(([x, y, z, w]) => {
        const x1 = x * c - w * s, w1 = x * s + w * c;
        const y1 = y * u - z * v, z1 = y * v + z * u;
        const depth = 3.8 / (3.8 - w1);
        return { x: cx + size / width * depth * (x1 + .46 * z1),
          y: cy + size / height * depth * (y1 - .28 * z1) };
      });
      for (const [a, b] of cubeEdges) line(points[a], points[b], ice, .26);
      for (const [start, order] of rules.cubePaths) {
        let vertex = start;
        for (const [index, dimension] of order.entries()) {
          const next = vertex ^ dimension;
          line(points[vertex], points[next], index % 2 ? copper : ice, .96, 1.9);
          mark(points[next], index % 2 ? warm : ice, .92);
          vertex = next;
        }
      }
      return hands.length ? 'hands' : 'pointer';
    }

    function drawTrails() {
      const targets = hands.map(hand => [hand.id, hand.palm]);
      if (pose) targets.push([pose.id, pose.center]);
      if (!targets.length && allowPointer && score.sources.cursor && isPoint(pointer)) targets.push(['pointer', pointer]);
      const active = new Set(targets.map(([key]) => key));
      for (const [key, path] of paths) {
        if (!active.has(key)) path.connected = false;
        while (path.samples.length && time - path.samples[0].time > rules.trailLifeMs) path.samples.shift();
        if (!path.samples.length) paths.delete(key);
      }
      for (const [key, point] of targets) {
        if (!paths.has(key)) paths.set(key, { samples: [], connected: false });
        const path = paths.get(key);
        const last = path.samples.at(-1);
        if (!last || time - last.time >= rules.trailStepMs) {
          const continuous = path.connected && time - last.time <= rules.trailGapMs;
          const ease = continuous && key !== 'pointer' && !controls.reducedMotion
            ? 1 - Math.exp(-(time - last.time) / rules.trailFollowMs) : 1;
          path.samples.push({
            x: continuous ? last.x + (point.x - last.x) * ease : point.x,
            y: continuous ? last.y + (point.y - last.y) * ease : point.y,
            time, continuous,
          });
          path.connected = true;
        }
      }
      for (const path of paths.values()) {
        for (let i = 1; i < path.samples.length; i++) {
          const point = path.samples[i];
          if (!point.continuous) continue;
          const gain = 1 - (time - point.time) / rules.trailLifeMs;
          line(path.samples[i - 1], point, ice, gain * .26, 6);
          line(path.samples[i - 1], point, ice, gain * .88, 1.5);
        }
        if (path.connected) mark(path.samples.at(-1), warm);
      }
      return hands.length || pose ? 'tracked motion' : active.has('pointer') ? 'pointer' : 'waiting';
    }

    function drawMeasuredMesh(contours) {
      const nodes = scoreAnchors(tracking, time, score.sources, pointer, controls.room, controls.clipTracking && controls.clipCover);
      const measured = nodes.filter(node => node.source !== 'pointer');
      const mesh = proximityMesh(measured.length ? measured : nodes, width / height);
      const reaction = Math.min(CONFIG.measuredMesh.maxReaction, (controls.roomMusicFrame?.rms || 0) * 2 + (controls.dayContext?.pressure || 0) * .2);
      for (const [a,b] of mesh.edges) {
        line(a,b,ice,CONFIG.measuredMesh.lineGain + reaction,CONFIG.measuredMesh.lineWidth);
        if (contours) {
          const dx = (b.x - a.x) * width, dy = (b.y - a.y) * height;
          for (const ratio of [.5, 1, 1.5]) {
            ctx.beginPath();
            ctx.ellipse((a.x + b.x) * width / 2, (a.y + b.y) * height / 2,
              Math.hypot(dx,dy) * .5, Math.max(1, Math.hypot(dx,dy) * .12 * ratio * (1 + reaction)), Math.atan2(dy,dx), 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${ice},${strength * (.15 + reaction)})`; ctx.lineWidth = .7; ctx.stroke(); segments++;
          }
        }
      }
      for (const point of mesh.nodes) mark(point, warm, .62 + reaction, 1.4);
      return measured.length ? 'measured nodes' : drawPointer();
    }

    if (id === 'wire-gloves' || id === 'aftervoice') {
      const face = measuredFace(tracking, time, score.sources);
      if (tracking.camera?.active) {
        if (id === 'wire-gloves' && !hands.length) return {source:'waiting for hands', segments:0};
        if (id === 'aftervoice' && !face?.features?.mouth) return {source:'waiting for mouth', segments:0};
      }
      return paintPerformanceEtching({ctx, width, height, time, controls, hands, face, id, strength});
    }
    ctx.save();
    const source = id === 'joint-constellation' ? drawJoints()
      : id === 'diagonal-cube' ? drawCube()
      : id === 'time-filter-trails' ? drawTrails()
      : id === 'finger-loom' ? drawFingers()
      : id === 'measured-mesh' || id === 'resonant-contours' ? drawMeasuredMesh(id === 'resonant-contours') : drawExpression(id);
    ctx.restore();
    return { source, segments };
  }

  return { render };
}
