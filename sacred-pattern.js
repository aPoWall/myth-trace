// Classify authored formations in projection space. A held candidate must persist before it can play.
export function createSacredPattern({ settleMs, alignment, minSpan, openPinch, closePinch }) {
  let candidate = 'off';
  let changedAt = 0;
  let committed = 'off';
  let eyesDriven = false;

  function update({ time, hands, pins, eyes, frame, aspect, disabled = [] }) {
    let shape = 'off';
    let angle = 0;
    const live = hands.filter(hand => !hand.stale && hand.palm);
    const pair = live.length > 1 ? [...live].sort((a, b) => a.palm.x - b.palm.x) : [];
    if (pair.length) {
      const [left, right] = pair;
      const dx = (right.palm.x - left.palm.x) * aspect;
      const dy = right.palm.y - left.palm.y;
      const distance = Math.hypot(dx, dy);
      angle = Math.atan2(dy, dx);
      const tip = right.landmarks?.[8];
      if (tip) {
        const localAngle = Math.atan2(tip.y - right.palm.y, (tip.x - right.palm.x) * aspect);
        angle = localAngle - angle;
      }
      if (distance >= minSpan) {
        const leftPinch = left.pinchRaw ?? left.pinch;
        const rightPinch = right.pinchRaw ?? right.pinch;
        shape = frame?.confirmed || Math.abs(dy) / distance > alignment || (leftPinch >= closePinch && rightPinch >= closePinch)
          ? 'lattice'
          : leftPinch < openPinch && rightPinch < openPinch ? 'vesica' : 'rosette';
      }
    } else if (frame?.confirmed && live.length) shape = 'lattice';
    else if (live.length) {
      const hand = live[0];
      if ((hand.pinchRaw ?? hand.pinch) >= closePinch) shape = 'rosette';
    } else if (pins.length >= 2) {
      const [first, second, third] = pins;
      const distance = (a, b) => Math.hypot((b.x - a.x) * aspect, b.y - a.y);
      if (distance(first, second) >= minSpan) {
        angle = Math.atan2(second.y - first.y, (second.x - first.x) * aspect);
        shape = 'vesica';
        if (third) {
          const sides = [distance(first, second), distance(second, third), distance(third, first)];
          const even = Math.min(...sides) / Math.max(...sides) > .77;
          shape = pins.length === 3 && even ? 'rosette' : 'lattice';
        }
      }
    }
    if (shape === 'off' && eyes) shape = 'vesica';
    if (disabled.includes(shape)) shape = 'off';
    if (eyesDriven && !eyes) {
      committed = 'off';
      eyesDriven = false;
    }
    if (candidate !== shape) {
      candidate = shape;
      changedAt = time;
    }
    const transition = candidate !== committed && time - changedAt >= settleMs;
    if (transition) {
      committed = candidate;
      eyesDriven = Boolean(eyes && committed === 'vesica');
    }
    const facet = (Math.round(angle / (Math.PI / 3)) + 6) % 6;
    return { shape: committed, facet, transition };
  }
  update.reset = () => { committed = candidate = 'off'; changedAt = 0; eyesDriven = false; };
  return update;
}
