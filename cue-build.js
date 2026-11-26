import { CONFIG } from './config.js';
import { geometryLayers, normalizeShadow } from './geometry-mix.js';

const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
const bool = value => typeof value === 'boolean';
const members = keys => value => keys.includes(value);

function validFields(value, rules) {
  return record(value) && Object.keys(value).length > 0 &&
    Object.entries(value).every(([key, item]) => Object.hasOwn(rules,key) && rules[key](item));
}

const layerRules = Object.fromEntries(geometryLayers.map(key => [key, unit]));
const sections = {
  geometry: value => validFields(value, {
    strength:unit, attack:unit, auto:bool, merge:bool, shadow:points => Boolean(normalizeShadow(points)),
    palette:members(Object.keys(CONFIG.lightScore.palettes)), layers:weights => validFields(weights,layerRules),
  }),
  atmosphere: value => validFields(value, {gain:unit, grain:unit, drift:unit, radio:unit, noise:unit}),
  lab: value => validFields(value, {
    preset:members(['off','tremor','rupture','residue']), amount:unit, tear:unit, memory:unit, mix:unit,
    prompt:text => typeof text === 'string' && text.length <= 220,
  }),
};

export function validateCueBuild(cue) {
  if (!record(cue)) return 'Expected a scene build';
  if (!Number.isSafeInteger(cue.edition) || cue.edition < 1) return 'Invalid edition';
  if (typeof cue.version !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(cue.version)) return 'Invalid version';
  if (!Object.hasOwn(CONFIG.performancePresets.stories,cue.target)) return 'Unknown target scene';
  const fields = Object.keys(cue).filter(key => !['version','edition','target'].includes(key));
  if (!fields.length) return 'Empty scene build';
  for (const key of fields) {
    if (!Object.hasOwn(sections,key) || !sections[key](cue[key])) return 'Invalid section ' + key;
  }
  return '';
}

export function cueBuildDecision(cue,{scene,lastEdition,busy}) {
  if (validateCueBuild(cue)) return 'invalid';
  if (cue.edition <= lastEdition) return 'seen';
  if (cue.target !== scene) return 'elsewhere';
  return busy ? 'pending' : 'apply';
}
