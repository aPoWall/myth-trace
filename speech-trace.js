import { CONFIG, clamp } from './config.js';

// Only measured mouths emit words. Losing the face never invents a new anchor.
export function createSpeechTrace(config = CONFIG.speechTrace) {
  let mouth = null, sequence = 0;
  const words = [];
  function update(time, face) {
    const point = !face?.stale && face?.features?.mouth;
    mouth = point && Number.isFinite(point.x) && Number.isFinite(point.y)
      ? { x: clamp(point.x), y: clamp(point.y) } : null;
    for (let i = words.length - 1; i >= 0; i--) {
      const word = words[i], age = clamp((time - word.at) / config.lifetimeMs);
      if (age >= 1) { words.splice(i, 1); continue; }
      word.x = clamp(word.origin.x + word.drift * config.spread * age);
      word.y = clamp(word.origin.y - config.rise * age);
      word.opacity = time < word.at ? 0 : 1 - age;
    }
    return words;
  }
  function push(text, time) {
    if (!mouth) return;
    const tokens = String(text).trim().split(/\s+/u).filter(Boolean).slice(-config.maxWords);
    for (const [index, token] of tokens.entries()) {
      const id = sequence++;
      words.push({ id, text: token.slice(0, config.maxWordLength), at: time + index * config.emissionMs,
        origin: { ...mouth }, x: mouth.x, y: mouth.y, drift: (id % 5 - 2) / 2, opacity: 1 });
    }
    words.splice(0, Math.max(0, words.length - config.maxWords));
  }
  return { update, push, clear() { words.length = 0; mouth = null; } };
}
