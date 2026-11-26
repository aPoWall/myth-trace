import { studioOnly } from './studio-only.js';
import { CONFIG } from './config.js';
import { validateScenePlan } from './stage-agent.js';

const presets = CONFIG.performancePresets;
const keys = ['dm', 'am', 'cm', 'fsm'];
const palettes = ['trace', 'frost', 'ember', 'mono'];
const original = Object.freeze({});
const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
const inGroup = group => value => typeof value === 'string' && Object.hasOwn(group, value);
const isGeometry = inGroup(presets.geometries);
const fields = {
  look: inGroup(presets.looks),
  geometry: value => value === 'off' || isGeometry(value),
  palette: value => palettes.includes(value),
  strength: unit,
  attack: unit,
  sacred: inGroup(presets.sacred.shapes),
  sacredStrength: unit,
  music: inGroup(presets.music),
  key: value => keys.includes(value),
  level: value => unit(value) && value <= .65,
  degrees: value => Array.isArray(value) && value.length > 0 && value.length <= presets.phrase.limit
    && value.every(note => Number.isInteger(note) && note >= 1 && note <= 8),
};

export function createStoryVersions(storage, storageKey) {
  const versions = new Map();
  for (const id of Object.keys(presets.stories)) {
    let settings;
    try { settings = JSON.parse(storage.getItem(`${storageKey}.${id}`) || 'null'); } catch { continue; }
    if (settings && Object.keys(settings).length
      && Object.entries(settings).every(([key, value]) => Object.hasOwn(fields, key) && fields[key](value))) versions.set(id, settings);
  }
  return {
    get: id => versions.get(id) || original,
    save(id, settings) {
      const hasSettings = Object.keys(settings).length > 0;
      if (hasSettings) versions.set(id, settings);
      else versions.delete(id);
      try { storage.setItem(`${storageKey}.${id}`, JSON.stringify(settings)); }
      catch { return false; }
      return true;
    },
  };
}

export function storyChanges(before, after) {
  return Object.keys(fields).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

export function proposeStoryVariant(current, plan, contract) {
  validateScenePlan(plan, contract);
  const variant = { ...current };
  for (const { type, preset, ...values } of plan.actions) {
    const allowed = Object.hasOwn(contract.storyFields, type) && contract.storyFields[type];
    if (!allowed || [...Object.keys(values), ...(preset === undefined ? [] : ['preset'])].some(key => !allowed.includes(key))) {
      throw new Error('VM105 returned an action outside the story editor');
    }
    if (type === 'visual') variant.look = preset;
    if (type === 'geometry') variant.geometry = preset;
    if (type === 'light') Object.assign(variant, values);
    if (type === 'music') Object.assign(variant, preset ? { music: preset, ...values } : values);
    if (type === 'sacred') {
      variant.sacred = preset;
      if (values.strength !== undefined) variant.sacredStrength = values.strength;
    }
    if (type === 'phrase') variant.degrees = values.degrees;
  }
  return variant;
}

export function createStoryPlanner(fetcher = globalThis.fetch) {
  let active, contractPromise;
  function cancel() {
    active?.abort();
    active = null;
  }

  async function propose(text, context, current) {
    cancel();
    const controller = active = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.stageAgent.requestMs);
    try {
      contractPromise ||= fetcher('/stage-agent-contract.json').then(response => {
        if (!response.ok) throw new Error('Story contract unavailable');
        return response.json();
      }).catch(error => { contractPromise = null; throw error; });
      const contract = await contractPromise;
      if (active !== controller) return null;
      if (controller.signal.aborted) throw new Error('SOTNIK timed out');
      const response = await studioOnly('/api/stage-agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ instrument: 'story', text, context }),
      });
      const plan = await response.json();
      if (active !== controller) return null;
      if (controller.signal.aborted) throw new Error('SOTNIK timed out');
      if (!response.ok) throw new Error(plan.error || 'SOTNIK unavailable');
      return { cue: plan.cue, variant: proposeStoryVariant(current, plan, contract) };
    } catch (error) {
      if (active !== controller) return null;
      if (controller.signal.aborted) throw new Error('SOTNIK timed out');
      throw error;
    } finally {
      clearTimeout(timer);
      if (active === controller) active = null;
    }
  }
  return { propose, cancel };
}
