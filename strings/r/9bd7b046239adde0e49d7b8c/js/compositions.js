import { CONFIG } from './config.js';
import { edgeKey } from './score.js';

// MIDI notes followed by their lengths in quarter-note beats. An omitted length is one beat.
// Ode to Joy follows the Mutopia soprano line, adapted from G to C. Frère Jacques is a single voice.
const melodies = [
  {
    id: 'ode-to-joy', title: 'Ode to Joy', composer: 'Ludwig van Beethoven', bpm: 100,
    sourceURL: 'https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=528',
    notes: [
      64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, [64, 1.5], [62, .5], [62, 2],
      64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, [62, 1.5], [60, .5], [60, 2],
      62, 62, 64, 60, 62, [64, .5], [65, .5], 64, 60, 62, [64, .5], [65, .5], 64, 62, 60, 62, [55, 2],
      64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, [62, 1.5], [60, .5], [60, 2],
    ],
  },
  {
    id: 'frere-jacques', title: 'Frère Jacques', composer: 'Traditional French · attributed to Jean-Philippe Rameau', bpm: 108,
    sourceURL: 'https://imslp.org/wiki/Fr%C3%A8re_Jacques_(Rameau%2C_Jean-Philippe)',
    notes: [
      60, 62, 64, 60, 60, 62, 64, 60, 64, 65, [67, 2], 64, 65, [67, 2],
      [67, .5], [69, .5], [67, .5], [65, .5], 64, 60, [67, .5], [69, .5], [67, .5], [65, .5], 64, 60,
      60, 55, [60, 2], 60, 55, [60, 2],
    ],
  },
];

export const COMPOSITIONS = Object.freeze(melodies.map(({ notes, ...credit }) => Object.freeze(credit)));

const layout = { minimumWidth: .72, maxLength: .9, minLength: .64, groupY: .95 };
const { safeArea, aspect: defaultAspect, maxRegister } = CONFIG.instrument;

export function buildComposition(id, { transpose = 0, aspect = defaultAspect } = {}) {
  const index = COMPOSITIONS.findIndex((credit) => credit.id === id);
  if (index < 0) return null;
  const credit = COMPOSITIONS[index];
  const shift = Number.isFinite(transpose) ? Math.round(Math.max(-maxRegister, Math.min(maxRegister, transpose))) : 0;
  const notes = melodies[index].notes.map((note) => {
    const [midi, duration = 1] = Array.isArray(note) ? note : [note];
    return { midi: midi + shift, duration };
  });
  const pitches = [...new Set(notes.map(({ midi }) => midi))].sort((a, b) => a - b);
  const [left, top, right, bottom] = safeArea;
  const normalizedAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : defaultAspect;
  const width = (right - left) * Math.max(layout.minimumWidth, Math.min(1, defaultAspect / normalizedAspect));
  const center = (left + right) / 2;
  const middle = (top + bottom) / 2;
  const nodes = [];
  const edges = [];
  const tuning = {};
  const byPitch = new Map();
  for (const [order, midi] of pitches.entries()) {
    const fraction = order / (pitches.length - 1);
    const x = left + (right - left - width) / 2 + fraction * width;
    const radius = (bottom - top) / 2 * (layout.maxLength - (layout.maxLength - layout.minLength) * fraction);
    const first = nodes.length + 1;
    const second = first + 1;
    nodes.push({ id: first, midi, x, y: middle - radius }, { id: second, midi, x, y: middle + radius });
    edges.push([first, second]);
    const key = edgeKey(first, second);
    tuning[key] = midi;
    byPitch.set(midi, { edgeKey: key, x });
  }
  let totalBeats = 0;
  const sequence = notes.map(({ midi, duration }) => {
    const beat = totalBeats;
    totalBeats += duration;
    return { midi, beat, duration, ...byPitch.get(midi) };
  });
  return {
    ...credit, transpose: shift, sequence, totalBeats,
    version: 2, nodes, edges, tuning,
    groups: [{ name: credit.title, x: center, y: top + (bottom - top) * layout.groupY }],
  };
}
