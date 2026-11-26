import { CONFIG, clamp } from './config.js';

// Gestures select coherent four-note figures; silence leaves the explicitly started bed.
export function createAirScore() {
  const config = CONFIG.airScore;
  let nextPhrase = 0, sequence = 0;
  function step({ time, motion, voice, height = .5, root }) {
    const singing = voice > config.voiceGate;
    const moving = motion > config.motionGate;
    const source = singing ? 'voice' : moving ? 'movement' : 'bed';
    if ((!singing && !moving) || time < nextPhrase) return { source, notes: [] };
    nextPhrase = time + config.phraseSeconds;
    const degree = Math.round((1 - clamp(height)) * (config.degrees.length - 1));
    const figure = config.figures[sequence++ % config.figures.length];
    return { source, notes: figure.map((offset, index) => ({
      midi: root + 12 + config.degrees[(degree + offset) % config.degrees.length],
      delay: index * config.noteSeconds,
      level: (singing ? .065 : .052) * (index === 0 ? 1 : .64),
    })) };
  }
  return { step, reset: () => { nextPhrase = 0; sequence = 0; } };
}
