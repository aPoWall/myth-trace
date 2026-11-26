import { studioOnly } from './studio-only.js';
import { CONFIG } from './config.js';
import { parseGeometryCommand } from './geometry-mix.js';

const wake = /^(?:миф(?:\s*трейс)?|сотник|п[её]с|(?:the\s+)?dog|myth\s*trace)[\s,:.!–-]+/iu;
export const stripAgentWake = text => text.trim().replace(wake, '').trim();
export const heardAgentCommand = text => wake.test(text.trim()) ? stripAgentWake(text) : '';

function validValue(value, rule) {
  if (rule.enum) return rule.enum.includes(value);
  if (rule.boolean) return typeof value === 'boolean';
  if (rule.weights) return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length > 0 && Object.entries(value).every(([key, weight]) => rule.weights.includes(key)
      && typeof weight === 'number' && Number.isFinite(weight) && weight >= 0 && weight <= 1);
  if (rule.notes) return Array.isArray(value) && value.length > 0 && value.length <= 12
    && value.every(note => Number.isInteger(note) && note >= 1 && note <= 8);
  return typeof value === 'number' && Number.isFinite(value) && (!rule.integer || Number.isInteger(value))
    && value >= rule.min && value <= rule.max;
}

export function validateScenePlan(plan, contract) {
  if (!plan || typeof plan.cue !== 'string' || !plan.cue || plan.cue.length > 200
    || !Array.isArray(plan.actions) || plan.actions.length > contract.maxActions
    || Object.keys(plan).some(key => !['cue', 'actions', 'outputTokens'].includes(key))) throw new Error('Invalid scene plan');
  for (const action of plan.actions) {
    const schema = action && Object.hasOwn(contract.actions, action.type) && contract.actions[action.type];
    if (!schema || Object.keys(action).length < 2 || !(schema.required || []).every(key => Object.hasOwn(action, key))
      || !Object.entries(action).every(([key, value]) => key === 'type'
        || Object.hasOwn(schema.fields, key) && validValue(value, schema.fields[key]))) throw new Error('Unsupported scene action');
  }
  if (plan.actions.some(action => action.type === 'accompany') && plan.actions.length !== 1) throw new Error('Temporary parts must be independent');
  return plan;
}

export function localScenePlan(text, geometry) {
  const phrase = stripAgentWake(text).toLowerCase().replaceAll('ё', 'е').replace(/[.!]+$/u, '');
  if (/^(?:закончи партию|останови подыгрывание|выйди из партии|end guest part|stop accompaniment)$/u.test(phrase)) {
    return {cue:'Guest part released', actions:[{type:'release', target:'guest'}]};
  }
  const bass = phrase.match(/^(включи|выключи) (?:бас|дабстеп|bass deck)$/u);
  if (bass) return { cue: 'Bass Deck', actions: [{ type: 'air', preset: 'bass', playing: bass[1] === 'включи' }] };
  if (/^(?:холоднее|теплее|ярче|темнее|мягче|резче|frost|ember|trace|mono|(?:trail|mesh|lattice|orbit|slice|cross|ratio)(?:\s+\d{1,3}%)?)$/u.test(phrase)) {
    return { cue: 'Local cue', actions: [{ type: 'light', ...parseGeometryCommand(phrase, geometry) }] };
  }
  const toggle = phrase.match(/^(включи|выключи) (геометрию|музыку|сакральный слой|демо|рамку)$/u);
  if (!toggle) return null;
  const enabled = toggle[1] === 'включи';
  const target = toggle[2];
  const action = target === 'геометрию' ? { type: 'geometry', preset: enabled ? 'auto' : 'off' }
    : target === 'музыку' ? { type: 'music', playing: enabled }
      : target === 'сакральный слой' ? { type: 'sacred', preset: enabled ? 'auto' : 'off' }
        : { type: target === 'демо' ? 'demo' : 'frame', enabled };
  return { cue: 'Local cue', actions: [action] };
}

export function createStageAgent({ read, context, apply, report, preflight = () => {}, invalidate = () => {}, fetcher = globalThis.fetch }) {
  let contractPromise, revision = 0, active = null, queued = null;
  const history = [];
  const contract = () => contractPromise ||= fetcher('/stage-agent-contract.json').then(response => {
    if (!response.ok) throw new Error('Agent contract unavailable');
    return response.json();
  }).catch(error => { contractPromise = null; throw error; });
  const note = (state, message) => report({ state, message, history: [...history] });

  async function enact(plan, version, text, source) {
    validateScenePlan(plan, await contract());
    if (version !== revision) return;
    preflight(plan);
    // Validate the whole plan before touching the current performance.
    for (const action of plan.actions) {
      if (version !== revision) return;
      await apply(action, () => version === revision);
    }
    if (version !== revision) return;
    history.unshift({ text, source, cue: plan.cue, actions: plan.actions });
    history.length = Math.min(history.length, CONFIG.stageAgent.historyLimit);
    note('ready', plan.actions.length ? `${source} · ${plan.cue}` : plan.cue);
  }

  async function drain() {
    if (active || !queued) return;
    const request = queued;
    queued = null;
    const controller = new AbortController();
    active = controller;
    const timer = setTimeout(() => controller.abort(), CONFIG.stageAgent.requestMs);
    note('thinking', 'SOTNIK · VM105 · composing a scene cue…');
    try {
      const response = await studioOnly('/api/stage-agent', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: controller.signal, body: JSON.stringify({ text: request.text, context: context(), instrument: request.guest ? 'accompany' : 'scene' }) });
      const plan = await response.json();
      if (!response.ok) throw new Error(plan.error || 'SOTNIK unavailable');
      if (request.guest && (!Array.isArray(plan.actions) || plan.actions.length > 1 || plan.actions.some(a => a?.type !== 'accompany'))) {
        throw new Error('VM105 did not return a playable guest part');
      }
      await enact(plan, request.version, request.text, 'VM105');
    } catch (error) {
      if (request.version === revision) note('error', error.name === 'AbortError' ? 'SOTNIK timed out; scene unchanged' : error.message);
    } finally {
      clearTimeout(timer);
      if (active === controller) active = null;
      if (queued) void drain();
    }
  }

  function submit(raw, { guest = false } = {}) {
    const text = stripAgentWake(raw).slice(0, 280);
    if (!text) return;
    const version = ++revision;
    invalidate();
    queued = null;
    guest ||= /подыгра|сыграй со мной|на\s+\d+\s+такт|play along|accompany|for\s+\d+\s+bars/iu.test(text);
    const plan = guest ? null : localScenePlan(text, read());
    if (plan) void enact(plan, version, text, 'Local').catch(error => {
      if (version === revision) note('error', error.message);
    });
    else {
      queued = { text, version, guest };
      if (active) note('thinking', 'Next cue queued · previous answer will be discarded');
      void drain();
    }
  }

  function cancel() {
    revision++;
    invalidate();
    queued = null;
    active?.abort();
    note('off', 'Agent stopped · pending cues discarded');
  }
  return { submit, cancel, pending: () => Boolean(active || queued), history: () => [...history] };
}
