import { CONFIG, clamp } from './config.js';
import { scoreAnchors, pinPosition } from './lattice.js';

const { autoScore: config, palettes } = CONFIG.lightScore;
const by = (nodes, ...ids) => ids.map(id => nodes.find(node => node.id === id)).filter(Boolean);

export function selectScorePhrase(nodes, energy, motion) {
  const palms = by(nodes, 'palm.l', 'palm.r');
  const eyes = by(nodes, 'eye.r', 'eye.l');
  const [body] = by(nodes, 'body');
  const [cursor] = by(nodes, 'cursor');
  const corners = nodes.filter(node => node.source === 'room');
  const corner = corners.find(node => node.locked) || corners.reduce((best, node) => {
    const distance = point => Math.hypot(point.x - (cursor?.x ?? .5), point.y - (cursor?.y ?? .5));
    return !best || distance(node) < distance(best) ? node : best;
  }, null);
  const object = corner?.locked ? corner : nodes.find(node => node.source === 'object' || node.source === 'clip') || corner;
  if (palms.length === 2) return { form: 'weave', nodes: palms, driver: 'ладони' };
  if (!palms[0] && eyes.length === 2) return { form: 'face', nodes: eyes, driver: 'глаза' };
  if (energy >= config.surgeGate) {
    const lead = palms[0] || body || object || cursor;
    const end = [body, object, cursor].find(node => node && node.id !== lead?.id);
    return { form: 'slice', nodes: [lead, end].filter(Boolean), driver: 'звук' };
  }
  if (palms[0]) {
    const [tip] = by(nodes, palms[0].id.replace('palm', 'tip'));
    return { form: 'slice', nodes: [palms[0], tip || body].filter(Boolean), driver: 'рука' };
  }
  if (motion >= config.pitchGate && cursor && !body && !object)
    return { form: 'slice', nodes: [cursor], driver: 'курсор' };
  const origin = body || object || cursor;
  return { form: 'orbit', nodes: origin ? [origin] : [], driver: origin?.label || 'поле' };
}

export function createAutoScore() {
  let current, previous, last = -Infinity, changed = -Infinity, lastMotion = -Infinity;
  let positions = new Map(), trace = [], shadow, oldShadow, shadowChangedAt;
  const reset = () => {
    current = previous = null;
    last = changed = lastMotion = -Infinity;
    positions = new Map();
    trace = [];
    shadow = oldShadow = null;
    shadowChangedAt = -Infinity;
  };

  function render({ ctx, width, height, time, tracking, audio, controls }) {
    const score = controls.lightScore;
    const [warm, ice, copper] = palettes[score.palette] || palettes.trace;
    const { pointer, reducedMotion } = controls;
    const signal = score.signal;
    const energy = clamp(2.5 * Math.max(audio?.rms || 0, signal?.rms || 0) + .42 * Math.max(audio?.bass || 0, signal?.bass || 0));
    const measured = scoreAnchors(tracking, time, score.sources, pointer, controls.room, controls.clipTracking && controls.clipCover);
    const proposed = selectScorePhrase(measured, energy, tracking?.metrics?.motion || 0);
    const span = Math.min(width, height);
    const dt = Number.isFinite(last) ? clamp(time - last, 0, 100) : 100;
    const ease = reducedMotion ? 1 : 1 - Math.exp(-dt / config.followMs);
    const active = new Map();
    for (const n of measured) {
      const old = positions.get(n.id);
      active.set(n.id, {
        x: old ? old.x + (n.x - old.x) * ease : n.x,
        y: old ? old.y + (n.y - old.y) * ease : n.y,
      });
    }
    const hasNodes = state => state?.nodes.every(node => active.has(node.id));
    function materialize(state) {
      const [a, b] = state.nodes.map(node => active.get(node.id) || positions.get(node.id) || node);
      state.a = { x: a ? clamp(a.x, .08, .92) * width : width * .54,
        y: a ? clamp(a.y, .10, .89) * height : height * .49 };
      state.b = b ? { x: b.x * width, y: b.y * height } : null;
    }
    if (!current || (current.form === 'face' && !hasNodes(current))
      || (proposed.form === 'face' && current.form !== 'face') || (current.form !== proposed.form || current.driver !== proposed.driver)
      && time - changed >= (hasNodes(current) ? config.holdMs : config.lossMs)) {
      previous = current;
      current = proposed;
      changed = time;
    } else if (current.form === proposed.form && current.driver === proposed.driver) current.nodes = proposed.nodes;
    if (hasNodes(current) || !current.a) materialize(current);
    positions = active;
    last = time;

    function line(ax, ay, bx, by, color, alpha, weight = 1) {
      ctx.strokeStyle = `rgba(${color},${clamp(alpha)})`;
      ctx.lineWidth = weight;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    function filament(ax, ay, bx, by, color, alpha) {
      line(ax, ay, bx, by, '5,9,14', alpha * .92, 2.8);
      line(ax, ay, bx, by, color, alpha, 1.24);
    }
    function glow(x, y, alpha) {
      const radius = 11 + energy * 13;
      const halo = ctx.createRadialGradient(x, y, 0, x, y, radius);
      halo.addColorStop(0, `rgba(${warm},${clamp(alpha * .78)})`);
      halo.addColorStop(1, `rgba(${warm},0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      ctx.fillStyle = `rgba(${warm},${clamp(alpha)})`;
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }

    function phrase(state, presence) {
      if (!state?.a || presence <= 0 || state.form === 'face') return;
      const { a, b, form } = state;
      const { layers = {} } = score;
      const weight = form === 'slice' ? layers.slice : form === 'weave' ? layers.mesh : layers.orbit;
      const gain = presence * score.strength * (.57 + (weight ?? config.initialScale) * .43) * (.83 + .17 * energy);
      const fallback = span * config.fallbackSpan;
      const deltaX = b ? b.x - a.x : fallback, deltaY = b ? b.y - a.y : fallback * .27;
      const length = Math.hypot(deltaX, deltaY);
      const theta = length > 3 ? Math.atan2(deltaY, deltaX) : .26;
      const ux = Math.cos(theta), uy = Math.sin(theta);
      const nx = -uy, ny = ux;
      const drift = reducedMotion ? 0 : time * .00046;
      const extent = clamp(length, span * .23, span * config.maxSpan);
      const ox = a.x, oy = a.y;
      if (form === 'orbit') {
        for (let n = 0; n < 3; n++) {
          const r = extent * (.43 + n * .15);
          ctx.beginPath();
          ctx.ellipse(ox, oy, r, r * .65, -.32, -.64 + n * .64 + drift, 4.30 + n * .47 + drift);
          ctx.strokeStyle = `rgba(${n ? ice : warm},${gain * (n ? .35 - n * .04 : .52)})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        const t = reducedMotion ? .4 : drift;
        const x = Math.cos(t) * extent * .58, y = Math.sin(t) * extent * .58 * .65;
        const angle = -.32;
        glow(ox + x * Math.cos(angle) - y * Math.sin(angle), oy + x * Math.sin(angle) + y * Math.cos(angle), gain);
        return;
      }

      const widthFactor = form === 'weave' ? .145 : .091;
      const cross = extent * widthFactor * (1 + energy * .63);
      const count = form === 'weave' ? 11 : 8;
      const lane = offset => {
        ctx.beginPath();
        for (let i = 0; i <= count; i++) {
          const t = i / count;
          const depth = Math.sin(t * Math.PI) * cross * offset;
          const longitudinal = extent * (t - (form === 'weave' ? 0 : .13));
          if (i === 0) ctx.moveTo(ox + ux * longitudinal, oy + uy * longitudinal);
          else ctx.lineTo(ox + ux * longitudinal + nx * depth, oy + uy * longitudinal + ny * depth);
        }
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(${offset < 0 ? warm : ice},${gain * .55})`;
        ctx.stroke();
      };
      lane(-1); lane(1);
      for (let i = 1; i < count; i++) {
        const t = i / count;
        const x = ox + ux * extent * (t - (form === 'weave' ? 0 : .13));
        const y = oy + uy * extent * (t - (form === 'weave' ? 0 : .13));
        const d = Math.sin(t * Math.PI) * cross;
        const tail = form === 'weave' ? extent * .072 : extent * (.028 + score.attack * .063);
        filament(x - nx * d - ux * tail, y - ny * d - uy * tail,
          x + nx * d + ux * tail, y + ny * d + uy * tail, i % 3 ? ice : warm, gain * (.66 + energy * .25));
      }
      glow(ox, oy, gain);
      if (form === 'weave' && b && length <= extent) glow(b.x, b.y, gain * .74);
    }

    ctx.save();
    const fade = reducedMotion || !previous ? 1 : clamp((time - changed) / config.fadeMs);
    if (fade < 1) phrase(previous, 1 - fade);
    else previous = null;
    phrase(current, fade);
    const lead = by(measured, 'palm.r', 'palm.l', 'cursor')[0];
    if (!reducedMotion && lead && time - lastMotion > config.strideMs) {
      const before = trace.at(-1);
      if (!before || before.id !== lead.id || Math.hypot(before.x - lead.x, before.y - lead.y) > .003) {
        trace.push({ x: lead.x, y: lead.y, id: lead.id, time });
      }
      lastMotion = time;
    }
    while (trace.length && time - trace[0].time > config.trailMs) trace.shift();
    if (!reducedMotion) for (let i = 1; i < trace.length; i++) {
      const a = trace[i - 1], b = trace[i];
      if (a.id !== b.id || Math.hypot((b.x - a.x) * width, (b.y - a.y) * height) > span * config.jumpFraction) continue;
      const age = 1 - (time - a.time) / config.trailMs;
      const gain = age * score.strength * (.30 + (score.layers.trail ?? .5) * .32);
      line(a.x * width, a.y * height, b.x * width, b.y * height, ice, gain, 1 + age * .4);
      line(a.x * width, a.y * height + 3 * age, b.x * width, b.y * height + 3 * age, copper, gain * .3);
    }
    const points = Object.fromEntries(measured.map(node => [node.id, node]));
    const pins = score.pins.map((pin, index) => controls.latticePreview?.index === String(index) ? controls.latticePreview : pinPosition(pin, points));
    if (controls.latticePreview?.index === null) pins.push(controls.latticePreview);
    for (let index = 0; index < pins.length; index++) {
      const pin = pins[index], prev = pins[index - 1];
      if (!pin) continue;
      if (prev) line(prev.x * width, prev.y * height, pin.x * width, pin.y * height, ice, score.strength * .34);
      glow(pin.x * width, pin.y * height, score.strength * .65);
    }
    const nextShadow = score.shadow;
    if (nextShadow?.length !== shadow?.length || nextShadow?.some(([x, y], index) => x !== shadow[index][0] || y !== shadow[index][1])) {
      oldShadow = shadow;
      shadow = nextShadow;
      shadowChangedAt = time;
    }
    function drawShadow(shape, presence) {
      if (!shape || presence <= 0) return;
      const size = span * (.09 + .046 * energy);
      const body = points.body;
      const x = (body?.x ?? .5) * width + span * .21;
      const y = (body?.y ?? .5) * height - span * .14;
      for (const [i, [ax, ay]] of shape.entries()) {
        const [bx, by] = shape[(i + 1) % shape.length];
        line(x + ax * size, y + ay * size, x + bx * size, y + by * size, copper, presence * score.strength * (.26 + .39 * energy));
      }
    }
    const shadowFade = reducedMotion ? 1 : clamp((time - shadowChangedAt) / config.fadeMs);
    if (shadowFade < 1) drawShadow(oldShadow, 1 - shadowFade);
    else oldShadow = null;
    drawShadow(shadow, shadowFade);
    ctx.restore();
    return { form: current.form, driver: current.driver, nodes: current.nodes.map(node => node.id), pins: pins.length };
  }
  return { render, reset };
}
