import { CONFIG, clamp } from './config.js';

const settings = CONFIG.lightScore.faceLinks;
const contours = [
  ['eye.r.outer', 'eye.r', 'eye.r.inner', 'nose.bridge', 'eye.l.inner', 'eye.l', 'eye.l.outer'],
  ['eye.r.outer', 'cheek.r', 'chin', 'cheek.l', 'eye.l.outer'],
  ['eye.r.inner', 'nose', 'eye.l.inner'],
  ['nose', 'mouth', 'chin'],
];

export function drawFaceLinks(ctx, features, width, height, strength, color, hands = {}) {
  const point = id => features[id];
  if (!point('eye.l') && !point('eye.r')) return;
  const line = (a, b, opacity) => {
    if (!a || !b) return;
    ctx.beginPath();
    ctx.moveTo(a.x * width, a.y * height);
    ctx.lineTo(b.x * width, b.y * height);
    ctx.lineWidth = settings.lineWidth + 1.8;
    ctx.strokeStyle = `rgba(5,10,15,${clamp(strength * opacity * .89)})`;
    ctx.stroke();
    ctx.lineWidth = settings.lineWidth;
    ctx.strokeStyle = `rgba(${color},${clamp(strength * opacity)})`;
    ctx.stroke();
  };

  ctx.save();
  for (const [index, contour] of contours.entries()) {
    for (let i = 1; i < contour.length; i++) line(point(contour[i - 1]), point(contour[i]), index === 0 ? .86 : .48);
  }
  const lead = hands['tip.r'] || hands['tip.l'];
  if (lead) {
    const reach = eye => eye ? Math.hypot((eye.x - lead.x) * width, (eye.y - lead.y) * height) : Infinity;
    const eye = reach(point('eye.r')) < reach(point('eye.l')) ? point('eye.r') : point('eye.l');
    line(eye, lead, .64);
  }
  for (const side of ['r', 'l']) {
    const eye = point('eye.' + side);
    if (!eye) continue;
    const x = eye.x * width, y = eye.y * height;
    const radius = Math.min(14, Math.max(6, width * .012));
    const halo = ctx.createRadialGradient(x, y, 0, x, y, radius);
    halo.addColorStop(0, `rgba(${settings.accent},${clamp(strength * 1.5)})`);
    halo.addColorStop(1, `rgba(${settings.accent},0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.fillStyle = `rgba(${settings.accent},${clamp(strength * 2)})`;
    ctx.fillRect(x - 2, y - 2, 4, 4);
  }
  ctx.restore();
}
