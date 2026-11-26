import { CONFIG } from './config.js';

const instrument = CONFIG.instrument;
const octave = 12;

export const SCALES = Object.freeze([
  { id: 'minor-pentatonic', name: 'Minor pentatonic', degrees: [0, 3, 5, 7, 10] },
  { id: 'major-pentatonic', name: 'Major pentatonic', degrees: [0, 2, 4, 7, 9], mode: 'major' },
  { id: 'major', name: 'Major', degrees: [0, 2, 4, 5, 7, 9, 11], mode: 'major' },
  { id: 'natural-minor', name: 'Natural minor', degrees: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'whole-tone', name: 'Whole tone', degrees: [0, 2, 4, 6, 8, 10] },
  { id: 'chromatic', name: 'Chromatic', degrees: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
]);

export const VOICINGS = Object.freeze([
  { id: 'single', name: 'Single note', intervals: [0] },
  { id: 'fifth', name: 'Fifth', intervals: [0, 7] },
  { id: 'minor', name: 'Minor triad', intervals: [0, 3, 7] },
  { id: 'major', name: 'Major triad', intervals: [0, 4, 7] },
  { id: 'sus2', name: 'Sus2 · no third', intervals: [0, 2, 7] },
]);

export const TEMPLATES = Object.freeze([
  {
    id: 'harp', name: 'Harp', scene: 'atlas',
    description: 'Six parallel strings in the selected scale, from long and low to short and high.',
    gesture: 'Pluck strings in any order or brush across several.',
  },
  {
    id: 'chords', name: 'Three chords', scene: 'loom',
    description: 'Three zones of three strings. Minor gives i–VI–VII; major gives I–IV–V.',
    gesture: 'Brush across a zone for a chord or touch one string.',
  },
  {
    id: 'fifths', name: 'Low fifths', scene: 'orbit',
    description: 'Four low strings: root and fifth across two octaves.',
    gesture: 'Start with the long string and add the adjacent fifth.',
  },
  {
    id: 'crystal', name: 'Crystal', scene: 'crystal',
    description: 'Two triangles of independent strings tuned to fifths, a third and octaves.',
    gesture: 'Touch any edge. Try the same string at its center and edge.',
  },
  {id:'fan8',name:'Radiant fan',scene:'atlas',description:'Eight independent diagonal strings open across the selected scale.',gesture:'Sweep across the fan or pluck any string.'},
  {id:'rack8',name:'Octave rack',scene:'loom',description:'Eight separated scale strings in two banks, spanning an octave.',gesture:'Alternate between the two banks or brush across a row.'},
]);

function clamp(value, lower, upper, fallback) {
  return Number.isFinite(value) ? Math.min(upper, Math.max(lower, value)) : fallback;
}

function getScale(id) {
  return SCALES.find((scale) => scale.id === id) ?? SCALES[0];
}

export function quantizeMidi(midi, {
  rootMidi = instrument.defaultRootMidi, scale = instrument.defaultScale,
} = {}) {
  const root = Math.round(clamp(rootMidi, 0, 127, instrument.defaultRootMidi));
  const played = clamp(midi, 0, 127, root);
  const floor = root + octave * Math.floor((played - root) / octave);
  const { degrees } = getScale(scale);
  let nearest = root;
  for (let base = floor - octave; base <= floor + octave; base += octave) {
    for (const degree of degrees) {
      const note = base + degree;
      if (note < 0 || note > 127) continue;
      const distance = Math.abs(note - played);
      const previous = Math.abs(nearest - played);
      if (distance < previous || (distance === previous && note < nearest)) nearest = note;
    }
  }
  return nearest;
}

function lengthFactor(semitones) {
  return 2 ** (-semitones / octave);
}

function harp({ scale }) {
  const { degrees } = scale;
  const wires = Array.from({ length: 6 }, (_, index) => {
    const offset = degrees[index % degrees.length] + octave * Math.floor(index / degrees.length);
    const x = .10 + index * .16;
    return { offset, a: [x, .08], b: [x, .08 + .84 * lengthFactor(offset)] };
  });
  return { wires, groups: [{ name: 'Harp', at: [.5, .98] }] };
}

function chords({ scale }) {
  const harmonies = scale.mode === 'major'
    ? [['I', [0, 4, 7]], ['IV', [5, 9, 12]], ['V', [7, 11, 14]]]
    : [['i', [0, 3, 7]], ['VI', [8, 12, 15]], ['VII', [10, 14, 17]]];
  const groups = [];
  const wires = [];
  for (const [column, [name, notes]] of harmonies.entries()) {
    const center = .17 + column * .33;
    groups.push({ name, at: [center, .96] });
    for (const [voice, offset] of notes.entries()) {
      const x = center + (voice - 1) * .078;
      const radius = .40 * lengthFactor(offset);
      wires.push({ offset, a: [x, .52 - radius], b: [x, .52 + radius] });
    }
  }
  return { wires, groups };
}

function fifths({ aspect }) {
  const width = Math.min(.94, 1.55 / aspect);
  const wires = [0, 7, 12, 19].map((step, row) => {
    const radius = width * lengthFactor(step) / 2;
    const y = .15 + row * .24;
    return { offset: step - 24, a: [.5 - radius, y + radius * .10], b: [.5 + radius, y - radius * .10] };
  });
  return { wires, groups: [{ name: 'Root and fifth', at: [.5, .99] }] };
}

function inset(a, b, ratio) {
  return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
}

function crystal({ scale, aspect }) {
  const outer = [[.5, .04], [.94, .90], [.06, .90]];
  const inner = [[.5, .80], [.28, .32], [.72, .32]];
  const wires = [outer, inner].flatMap((triangle) => triangle.map((a, i) => {
    const b = triangle[(i + 1) % triangle.length];
    return { a: inset(a, b, .085), b: inset(b, a, .085) };
  }));
  const [left, top, right, bottom] = instrument.safeArea;
  const length = ({ a, b }) => Math.hypot((a[0] - b[0]) * (right - left) * aspect,
    (a[1] - b[1]) * (bottom - top));
  wires.sort((a, b) => length(b) - length(a));
  const pitches = [0, 7, 12, scale.mode === 'major' ? 16 : 15, 19, 24];
  wires.forEach((wire, i) => { wire.offset = pitches[i]; });
  return { wires, groups: [{ name: 'Prisms', at: [.5, .99] }] };
}

function scaleOffset(scale,index){return scale.degrees[index%scale.degrees.length]+octave*Math.floor(index/scale.degrees.length);}
function fan8({scale}){
 const wires=Array.from({length:8},(_,i)=>({offset:scaleOffset(scale,i),a:[.08+i*.035,.83],b:[.22+i*.10,.12+i*.035]}));
 return {wires,groups:[{name:'Radiant fan',at:[.5,.98]}]};
}
function rack8({scale}){
 const wires=Array.from({length:8},(_,i)=>{const row=Math.floor(i/4),col=i%4,y=.22+row*.50;return {offset:scaleOffset(scale,i),a:[.05+col*.235,y],b:[.23+col*.235,y+.11]};});
 return {wires,groups:[{name:'Low bank',at:[.5,.42]},{name:'High bank',at:[.5,.92]}]};
}
const layouts = { harp, chords, fifths, crystal, fan8, rack8 };

function boundedRoot(root, offsets) {
  const minimumShift = Math.ceil((instrument.minMidi - root - Math.min(...offsets)) / octave);
  const maximumShift = Math.floor((instrument.maxMidi - root - Math.max(...offsets)) / octave);
  return root + octave * clamp(0, minimumShift, maximumShift, 0);
}

export function buildTemplate(id, {
  rootMidi = instrument.defaultRootMidi, scale = instrument.defaultScale,
  aspect = instrument.aspect, register = 0,
} = {}) {
  if (!Object.hasOwn(layouts, id)) return null;
  const width = Number.isFinite(aspect) && aspect > 0 ? aspect : instrument.aspect;
  const { wires, groups } = layouts[id]({ aspect: width, scale: getScale(scale) });
  const key = clamp(rootMidi, instrument.minMidi, instrument.maxMidi, instrument.defaultRootMidi);
  const shift = clamp(register, -instrument.maxRegister, instrument.maxRegister, 0);
  const root = boundedRoot(Math.round(key) + Math.round(shift), wires.map((wire) => wire.offset));
  const [left, top, right, bottom] = instrument.safeArea;
  const position = ([x, y]) => ({ x: left + x * (right - left), y: top + y * (bottom - top) });
  const nodes = [];
  const edges = [];
  const tuning = {};
  for (const { a, b, offset } of wires) {
    const first = nodes.length + 1;
    const second = first + 1;
    const midi = root + offset;
    nodes.push({ id: first, ...position(a), midi }, { id: second, ...position(b), midi });
    const edge = [first, second];
    edges.push(edge);
    tuning[[...edge].sort((x, y) => String(x).localeCompare(String(y))).join(':')] = midi;
  }
  return {
    version: 2, nodes, edges, tuning,
    groups: groups.map(({ name, at }) => ({ name, ...position(at) })),
    template: id,
  };
}
