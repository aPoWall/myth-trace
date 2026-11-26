import { CONFIG } from './config.js';

export function createGestureInterpreter({ onEvent = () => {}, thresholds = {} } = {}) {
  const on=Number.isFinite(thresholds.pinchOn) ? thresholds.pinchOn : CONFIG.tracking.pinchOn;
  const off=Number.isFinite(thresholds.pinchOff) ? thresholds.pinchOff : CONFIG.tracking.pinchOff;
  const dwell=Number.isFinite(thresholds.debounceMs) ? thresholds.debounceMs : CONFIG.tracking.debounceMs;
  const releaseMs=Number.isFinite(thresholds.releaseMs) ? thresholds.releaseMs : 120;
  if(off<0 || on>1 || off>=on || dwell<0 || releaseMs<0) throw new RangeError('Invalid pinch thresholds');
  const tracks = new Map();
  let spreadArmed = true, lastSpread = -Infinity;
  const emit = (type, h, timestamp, velocity = 0, reason) => onEvent({ type, handId: h.id, x: h.x, y: h.y, spread: h.spread, velocity, timestamp, ...(reason ? {reason} : {}) });
  function update({ hands = [], timestamp = performance.now() } = {}) {
    const seen = new Set();
    for (const h of hands) {
      seen.add(h.id);
      // A short occlusion may retain the last picture; it cannot move or release a gesture.
      if(h.stale||h.interactive===false){const held=tracks.get(h.id);if(held){held.releaseSince=null;if(!held.active)held.since=null;}continue;}
      let t = tracks.get(h.id);
      if (!t) { t = { active: false, since: null, releaseSince: null, eraseSince: null, eraseArmed: true, previous: h, time: timestamp }; tracks.set(h.id, t); }
      if (!t.active) {
        if (h.pinch >= on) {
          if (t.since === null) t.since = timestamp;
          if (timestamp - t.since >= dwell) { t.active = true; emit('pinchstart', h, timestamp); }
        } else t.since = null;
      } else if (h.pinch <= off) {
        if(t.releaseSince === null) t.releaseSince = timestamp;
        if(timestamp - t.releaseSince >= releaseMs){emit('pinchend', h, timestamp, 0, 'release'); t.active = false; t.since = null; t.releaseSince = null;}
      } else {
        t.releaseSince = null;
        const dt = Math.max(1, timestamp - t.time);
        emit('pinchmove', h, timestamp, Math.hypot(h.x - t.previous.x, h.y - t.previous.y) * 1000 / dt);
      }
      // The erase gesture is deliberate: the index pinch must stay open throughout.
      if ((h.middlePinch ?? 0) <= off) {
        t.eraseArmed = true; t.eraseSince = null;
      } else if (h.pinch > off || (h.middlePinch ?? 0) < on) {
        t.eraseSince = null;
      } else if (t.eraseArmed) {
        if (t.eraseSince === null) t.eraseSince = timestamp;
        if (timestamp - t.eraseSince >= (CONFIG.tracking.eraseHoldMs ?? 350)) {
          emit('erase', h, timestamp); t.eraseArmed = false; t.eraseSince = null;
        }
      }
      t.previous = h; t.time = timestamp;
    }
    for (const [id, t] of tracks) if (!seen.has(id)) {
      if (t.active) emit('pinchend', t.previous, timestamp, 0, 'lost');
      tracks.delete(id);
    }
    const open = hands.filter(h => !h.stale && h.interactive!==false && h.pinch <= off && h.spread >= CONFIG.tracking.spreadThreshold);
    if (open.length < 2) spreadArmed = true;
    else if (spreadArmed && timestamp - lastSpread >= CONFIG.tracking.spreadCooldownMs) {
      spreadArmed = false; lastSpread = timestamp;
      emit('spread', { ...open[0], x: (open[0].x + open[1].x) / 2, y: (open[0].y + open[1].y) / 2, spread: Math.min(open[0].spread, open[1].spread) }, timestamp);
    }
  }
  function reset() { for(const t of tracks.values()) if(t.active) emit('pinchend',t.previous,performance.now(),0,'lost'); tracks.clear(); spreadArmed = true; lastSpread = -Infinity; }
  function getState(){return {thresholds:{pinchOn:on,pinchOff:off,debounceMs:dwell,releaseMs},hands:[...tracks].map(([id,t])=>({id,active:t.active,releasing:t.releaseSince!==null,pinch:t.previous.pinch,pending:t.since!==null&&!t.active}))};}
  return { update, reset, getState };
}
