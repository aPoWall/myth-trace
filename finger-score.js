import { CONFIG, clamp } from './config.js';
const names = ['thumb', 'index', 'middle', 'ring', 'pinky'];
export function createFingerScore(config = CONFIG.orchestraFingers) {
  const voices = ['left', 'right'].flatMap((side, hand) => names.map((finger, index) => ({
    side, finger, midi: 0, gate: false, armed: false, level: 0, offset: config.octaves[hand] + config.degrees[index],
  })));
  const frame = { voices };
  function reset() {
    for (const voice of voices) { voice.gate = voice.armed = false; voice.level = 0; }
  }
  function update(hands, time, root) {
    for (const voice of voices) {
      voice.midi = root + voice.offset;
      const hand = hands?.[voice.side];
      const fresh = hand?.active && (!Number.isFinite(hand.lastSeen) || time - hand.lastSeen <= config.freshMs);
      const curl = fresh ? clamp(hand.curls?.[voice.finger] || 0) : 0;
      if (!fresh) { voice.gate = voice.armed = false; voice.level = 0; continue; }
      if (curl <= config.off) { voice.gate = false; voice.armed = true; }
      else if (voice.armed && curl >= config.on) voice.gate = true;
      voice.level = voice.gate ? clamp(config.floor + config.range * curl) : 0;
    }
    return frame;
  }
  return { update, reset, state: () => frame };
}

// The mapper emits ranges at its control rate; rendering can run several times in between.
export function createHeldFingerRanges(freshMs = CONFIG.orchestraFingers.freshMs) {
  const result = {left:null, right:null};
  let sampledAt = -Infinity;
  return (sample, tracked, time, enabled) => {
    if (sample) {
      sampledAt = time;
      result.left = sample.left;
      result.right = sample.right;
    }
    for (const side of ['left','right']) {
      const voice = result[side];
      if (!enabled || time < sampledAt || time - sampledAt > freshMs || !voice?.active ||
        !tracked.some(hand => hand.id === voice.trackId && !hand.stale &&
          Number.isFinite(hand.lastSeen) && time - hand.lastSeen <= freshMs)) result[side] = null;
    }
    return result;
  };
}
