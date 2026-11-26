import { CONFIG, clamp } from './config.js';

// Draw the inner measuring marks in the detector's box, including boxes touching the screen edge.
export function drawObjectRegistration(ctx, box, width, height, {strength, palette}) {
  if (!(strength > 0) || !box) return;
  const rules = CONFIG.objectRegistration;
  const w = box.w * width, h = box.h * height;
  const size = Math.min(w,h);
  if (size < rules.minArmPx * 4) return;
  const inset = size * rules.inset;
  const arm = Math.min(size * rules.arm, rules.maxArmPx);
  const x = box.x * width + inset, y = box.y * height + inset;
  const right = x + w - inset * 2, bottom = y + h - inset * 2;
  const colors = CONFIG.lightScore.palettes[palette] || CONFIG.lightScore.palettes.frost;
  ctx.strokeStyle = 'rgba(' + colors[1] + ',' + clamp(strength) + ')';
  ctx.lineWidth = rules.widthPx + strength * rules.widthGain;
  ctx.beginPath();
  for (const [px,py,sx,sy] of [[x,y,1,1],[right,bottom,-1,-1]]) {
    ctx.moveTo(px,py+sy*arm); ctx.lineTo(px,py); ctx.lineTo(px+sx*arm,py);
    ctx.moveTo(px+sx*arm*.5,py); ctx.lineTo(px+sx*arm*.5,py+sy*arm*.12);
  }
  ctx.stroke();
}

const inside = (point, box) => point.x >= box.x && point.x <= box.x + box.w
  && point.y >= box.y && point.y <= box.y + box.h;

export function createObjectFocus(minScore, holdMs = 850) {
  let locked = null, saved = null, seenAt = 0, state = null;
  function clear() { locked = saved = state = null; }
  function sample(objects, pointer, time, ratio = 1) {
    const valid = (objects || []).filter(({ id, bbox, score, lastSeen }) => id && bbox?.w > 0
      && bbox?.h > 0 && score >= minScore && (!Number.isFinite(lastSeen) || time - lastSeen < holdMs));
    if (locked) {
      const current = valid.find(object => object.id === locked);
      if (current) {
        saved = current;
        seenAt = Number.isFinite(current.lastSeen) ? current.lastSeen : time;
        return state = { target: current, locked: true, lost: false, opacity: 1 };
      }
      if (saved && time - seenAt < holdMs) {
        return state = { target: saved, locked: true, lost: true, opacity: .35 };
      }
      clear();
    }
    const at = pointer || { x: .5, y: .5 };
    const ranked = valid.map(object => {
      const { x, y, w, h } = object.bbox;
      const hit = inside(at, object.bbox);
      const distance = Math.hypot((at.x - x - w / 2) * ratio, at.y - y - h / 2);
      return { object, score: (hit ? 2 - w * h : 0) + object.score * .5 - distance * .6
        - (object.label.toLowerCase() === 'person' ? .28 : 0) };
    });
    if (!ranked.length) return state = null;
    ranked.sort((a, b) => b.score - a.score);
    const prior = ranked.find(({ object }) => object.id === state?.target?.id);
    const best = ranked[0];
    const target = prior && best.score - prior.score < .16 ? prior.object : best.object;
    return state = { target, locked: false, lost: false, opacity: .74 };
  }
  function toggle(time) {
    if (locked) { clear(); return null; }
    if (!state?.target) return null;
    saved = state.target;
    locked = saved.id;
    seenAt = Number.isFinite(saved.lastSeen) ? saved.lastSeen : time;
    return state = { target: saved, locked: true, lost: false, opacity: 1 };
  }
  return { sample, toggle, clear };
}
