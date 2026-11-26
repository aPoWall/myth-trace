import { CONFIG, clamp } from './config.js';
import { FACE_ANCHOR_IDS } from './lattice.js';

const settings = CONFIG.lightScore;
export const geometryLayers = settings.modes.filter(mode => mode !== 'off');
export const defaultGeometry = Object.freeze({
  layers: Object.freeze({ trail: .78, lattice: .81, slice: .45 }),
  strength: settings.strength, attack: .31, palette: 'trace', merge: false, auto: true,
  transpose: 0, major: false, harmony: 'solo', shadow: null, pins: Object.freeze([]),
  sources: Object.freeze({ eyes: true, hands: true, cursor: true }),
  study: '', reliefDepth: CONFIG.performancePresets.geometries['pigment-relief'].reliefDepth, mask: 'off', maskOpacity: .62, scatter: [],
});

export const anchorNames = Object.freeze([...FACE_ANCHOR_IDS, 'palm.l', 'palm.r', 'tip.l', 'tip.r']);

function normalizePins(pins) {
  if (!Array.isArray(pins)) return [];
  return pins.slice(0, settings.lattice.maxPins).filter(pin => Number.isFinite(pin?.x) && Number.isFinite(pin?.y))
    .map(pin => ({
      x: clamp(pin.x), y: clamp(pin.y), anchor: typeof pin.anchor === 'string'
        && (anchorNames.includes(pin.anchor) || /^obj:[a-z0-9:_-]{1,40}$/i.test(pin.anchor)) ? pin.anchor : '',
      dx: Number.isFinite(pin.dx) ? clamp(pin.dx, -.2, .2) : 0,
      dy: Number.isFinite(pin.dy) ? clamp(pin.dy, -.2, .2) : 0,
    }));
}

function unit(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value) : fallback;
}

export function normalizeShadow(value) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 12
    || value.some(point => !Array.isArray(point) || point.length !== 2
      || point.some(n => !Number.isFinite(n) || n < -1 || n > 1))) return null;
  return value.map(([x, y]) => [x, y]);
}

export function normalizeGeometry(value, fallback = defaultGeometry) {
  const layers = {};
  const source = value?.layers ?? (settings.modes.includes(value?.mode)
    ? (value.mode === 'off' ? {} : { [value.mode]: 1 }) : fallback.layers);
  for (const mode of geometryLayers) {
    const weight = unit(source?.[mode], 0);
    if (weight > 0) layers[mode] = weight;
  }
  return {
    layers,
    strength: unit(value?.strength, fallback.strength),
    reliefDepth: unit(value?.reliefDepth, fallback.reliefDepth ?? defaultGeometry.reliefDepth),
    attack: unit(value?.attack, fallback.attack),
    palette: Object.hasOwn(settings.palettes, value?.palette) ? value.palette : fallback.palette,
    merge: typeof value?.merge === 'boolean' ? value.merge : fallback.merge,
    auto: typeof value?.auto === 'boolean' ? value.auto : fallback.auto ?? false,
    transpose: Number.isInteger(value?.transpose)
      ? Math.round(clamp(value.transpose, -12, 12)) : fallback.transpose,
    major: typeof value?.major === 'boolean' ? value.major : fallback.major,
    harmony: ['solo', 'fifths', 'octaves'].includes(value?.harmony) ? value.harmony : fallback.harmony,
    shadow: value && Object.hasOwn(value, 'shadow') ? normalizeShadow(value.shadow) : fallback.shadow,
    pins: normalizePins(value?.pins ?? fallback.pins),
    sources: Object.fromEntries(Object.keys(defaultGeometry.sources).map(key => [
      key, typeof value?.sources?.[key] === 'boolean' ? value.sources[key] : fallback.sources?.[key] ?? true,
    ])),
    study: value?.study === '' || (typeof value?.study === 'string'
      && CONFIG.performancePresets.geometries[value.study]?.study === value.study)
      ? value.study : fallback.study || '',
    mask: 'off',
    maskOpacity: unit(value?.maskOpacity, fallback.maskOpacity ?? .62),
    scatter: normalizeScatter(value?.scatter ?? fallback.scatter),
  };
}

function normalizeScatter(values) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, 12).filter(item => [item?.x, item?.y, item?.size, item?.angle, item?.sides].every(Number.isFinite))
    .map(item => ({ x: clamp(item.x), y: clamp(item.y), size: clamp(item.size, .018, .15),
      angle: clamp(item.angle, 0, 2 * Math.PI), sides: Math.round(clamp(item.sides, 3, 8)) }));
}

export function scatterShapes(random = Math.random) {
  return Array.from({ length: 6 }, () => ({
    x: .12 + random() * .76, y: .14 + random() * .70, size: .035 + random() * .094,
    sides: 3 + Math.floor(random() * 5), angle: random() * Math.PI * 2,
  }));
}

export function liveCuePatch(cue, current) {
  if (typeof cue?.version !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(cue.version)) return null;
  const candidate = cue.geometry;
  if (!candidate || typeof candidate !== 'object') return {};
  const patch = {};
  for (const key of ['strength', 'attack']) {
    if (Number.isFinite(candidate[key])) patch[key] = clamp(candidate[key]);
  }
  if (Object.hasOwn(settings.palettes, candidate.palette)) patch.palette = candidate.palette;
  if (Array.isArray(candidate.shadow) && normalizeShadow(candidate.shadow)) patch.shadow = candidate.shadow;
  if (typeof candidate.merge === 'boolean') patch.merge = candidate.merge;
  if (typeof candidate.auto === 'boolean') patch.auto = candidate.auto;
  for (const key of geometryLayers) {
    if (Number.isFinite(candidate.layers?.[key])) {
      patch.layers ??= { ...current.layers };
      patch.layers[key] = clamp(candidate.layers[key]);
    }
  }
  return patch;
}

export function parseGeometryCommand(phrase, current) {
  const text = phrase.toLowerCase().replaceAll('ё', 'е').trim();
  const paletteNames = { ember: /тепл|красн|огнен|ember/, frost: /холод|син|лед|frost/,
    mono: /моно|ч[её]рно-бел|mono/, trace: /trace|трейс|исходн/ };
  const patch = {};
  for (const [palette, pattern] of Object.entries(paletteNames)) {
    if (pattern.test(text)) { patch.palette = palette; break; }
  }
  const amount = text.match(/(\d{1,3})\s*(?:%|процент)/);
  const level = amount ? clamp(Number(amount[1]) / 100) : null;
  if (/ярче|светлее|громче свет/.test(text)) patch.strength = level ?? clamp(current.strength + .15);
  if (/темнее|тусклее/.test(text)) patch.strength = level ?? clamp(current.strength - .15);
  if (/агресс|резче|жестче|острее/.test(text)) patch.attack = level ?? clamp(current.attack + .22);
  if (/мягче|спокойнее/.test(text)) patch.attack = level ?? clamp(current.attack - .22);
  if (/merge|мердж|смешивай|перемешивай/.test(text)) patch.merge = !/выключ|стоп|убери|без/.test(text);
  if (/авто|сама подбира/.test(text)) patch.auto = !/выключ|стоп|убери|без/.test(text);
  const layerNames = { cross: /cross|луч|пересеч/, orbit: /orbit|орбит/, ratio: /ratio|пропорц/,
    trail: /trail|трейл|шлейф|след\b|следа/, mesh: /mesh|меш|сетк/, lattice: /lattice|реш[её]тк|узл|глаз/, slice: /slice|срез|слайс/ };
  for (const [mode, pattern] of Object.entries(layerNames)) {
    if (pattern.test(text)) {
      patch.layers ??= { ...current.layers };
      patch.layers[mode] = /убери|выключ|без/.test(text) ? 0 : level ?? 1;
    }
  }
  if (/геометри[юя].*(выключ|выкл)|(?:выключ|убери).*всю геометри/.test(text)) {
    patch.layers = {}; patch.merge = false; patch.auto = false; patch.shadow = null;
  }
  const pitch = text.match(/(до|ре|ми|фа|соль|ля|си)(?:[-\s]+(диез|бемоль|#|b))?\s*(?:минор|мажор)/);
  if (pitch) {
    const offsets = { до: 0, ре: 2, ми: 4, фа: 5, соль: 7, ля: 9, си: 11 };
    const accidental = ['диез', '#'].includes(pitch[2]) ? 1 : ['бемоль', 'b'].includes(pitch[2]) ? -1 : 0;
    let shift = offsets[pitch[1]] + accidental - 2;
    if (shift > 6) shift -= 12;
    patch.transpose = shift;
    patch.major = /мажор/.test(pitch[0]);
  }
  if (/квинт/.test(text)) patch.harmony = 'fifths';
  else if (/октав/.test(text)) patch.harmony = 'octaves';
  else if (/соло|один голос/.test(text)) patch.harmony = 'solo';
  return patch;
}
