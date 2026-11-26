import { compilePromptScene } from './prompt-scene.js';

export const FRAME_CONTENT_MODES = Object.freeze([
  'paint',
  'object',
  'prompt-shader',
  'exercise-target',
]);

const MODE_SET = new Set(FRAME_CONTENT_MODES);
const FIT_SET = new Set(['contain', 'cover']);
const FOCAL_SET = new Set(['frame', 'largest-object', 'body']);
const FOCUS_SOURCE_SET = new Set(['person', 'face', 'object', 'roi']);
const FOCUS_DETAIL_SET = new Set(['whole', 'face-edge']);
const EXERCISE_TARGET_SET = new Set(['inside-frame', 'frame-center']);

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedText(value, fallback, maxLength) {
  const text = String(value ?? '').trim();
  return (text || fallback).slice(0, maxLength);
}

function normalizeObjectClass(input = {}, fallback = {}) {
  if (Object.prototype.hasOwnProperty.call(input, 'objectClass')) {
    return String(input.objectClass ?? '').trim().slice(0, 64);
  }
  return boundedText(fallback.objectClass, 'person', 64);
}

function normalizeExerciseRule(input = {}, fallback = {}) {
  const target = EXERCISE_TARGET_SET.has(input.target)
    ? input.target
    : EXERCISE_TARGET_SET.has(fallback.target) ? fallback.target : 'inside-frame';
  return Object.freeze({
    source: boundedText(input.source, fallback.source || 'right-wrist', 48),
    target,
    tolerance: clamp(input.tolerance ?? fallback.tolerance ?? 0.08, 0, 0.45),
    holdMs: Math.round(clamp(input.holdMs ?? fallback.holdMs ?? 600, 0, 5000)),
  });
}

function normalizeFocus(input = {}, fallback = {}) {
  return Object.freeze({
    edgeScale: clamp(input.edgeScale ?? fallback.edgeScale ?? 0.46, 0.08, 0.92),
    edgeOffset: clamp(input.edgeOffset ?? fallback.edgeOffset ?? 0.82),
    bracketAlpha: clamp(input.bracketAlpha ?? fallback.bracketAlpha ?? 0.78),
  });
}

export function normalizeFrameContentSettings(input = {}, fallback = {}) {
  const mode = MODE_SET.has(input.mode)
    ? input.mode
    : MODE_SET.has(fallback.mode) ? fallback.mode : 'prompt-shader';
  const fit = FIT_SET.has(input.fit)
    ? input.fit
    : FIT_SET.has(fallback.fit) ? fallback.fit : 'contain';
  const focalPolicy = FOCAL_SET.has(input.focalPolicy)
    ? input.focalPolicy
    : FOCAL_SET.has(fallback.focalPolicy) ? fallback.focalPolicy : 'frame';
  const focusSource = FOCUS_SOURCE_SET.has(input.focusSource)
    ? input.focusSource
    : FOCUS_SOURCE_SET.has(fallback.focusSource) ? fallback.focusSource : 'person';
  const focusDetail = FOCUS_DETAIL_SET.has(input.focusDetail)
    ? input.focusDetail
    : FOCUS_DETAIL_SET.has(fallback.focusDetail) ? fallback.focusDetail : 'whole';
  const stageFill = Object.prototype.hasOwnProperty.call(input, 'stageFill')
    ? input.stageFill === true || input.stageFill === 'true'
    : fallback.stageFill === true || fallback.stageFill === 'true';
  return Object.freeze({
    version: 1,
    mode,
    prompt: boundedText(input.prompt, fallback.prompt || 'animated warm banana', 160),
    seed: Math.round(finite(input.seed, finite(fallback.seed, 23))),
    intensity: clamp(input.intensity ?? fallback.intensity ?? 0.72),
    fit,
    stageFill,
    objectClass: normalizeObjectClass(input, fallback),
    focalPolicy,
    focusSource,
    focusDetail,
    focus: normalizeFocus(input.focus, fallback.focus),
    visualRoute: clamp(input.visualRoute ?? fallback.visualRoute ?? 1),
    soundRoute: clamp(input.soundRoute ?? fallback.soundRoute ?? 0),
    exerciseRule: normalizeExerciseRule(input.exerciseRule, fallback.exerciseRule),
  });
}

function copyBox(target, source) {
  target.x = clamp(source?.x);
  target.y = clamp(source?.y);
  target.w = clamp(source?.w ?? source?.width);
  target.h = clamp(source?.h ?? source?.height);
}

function pointInsideBox(point, box, tolerance) {
  if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return false;
  const marginX = box.w * clamp(tolerance, 0, 0.45);
  const marginY = box.h * clamp(tolerance, 0, 0.45);
  return point.x >= box.x + marginX
    && point.x <= box.x + box.w - marginX
    && point.y >= box.y + marginY
    && point.y <= box.y + box.h - marginY;
}

function pointInsideQuad(point, quad) {
  if (!Array.isArray(quad) || quad.length < 4) return true;
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  let inside = false;
  for (let index = 0, previous = quad.length - 1; index < quad.length; previous = index, index += 1) {
    const a = quad[index];
    const b = quad[previous];
    const ax = Number(a?.x);
    const ay = Number(a?.y);
    const bx = Number(b?.x);
    const by = Number(b?.y);
    if (![ax, ay, bx, by].every(Number.isFinite)) return false;
    const crosses = (ay > y) !== (by > y)
      && x < ((bx - ax) * (y - ay)) / (by - ay) + ax;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointNearCenter(point, box, tolerance) {
  if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return false;
  const centerX = box.x + box.w * 0.5;
  const centerY = box.y + box.h * 0.5;
  const radius = Math.max(0.015, Math.min(box.w, box.h) * clamp(tolerance, 0, 0.45));
  return Math.hypot(point.x - centerX, point.y - centerY) <= radius;
}

function framePhase(frame) {
  const phase = String(frame?.phase || 'searching');
  return ['searching', 'arming', 'live', 'frozen', 'fading', 'off'].includes(phase)
    ? phase
    : 'searching';
}

function frameRender(frame) {
  return frame?.intents?.render || {};
}

/**
 * Content state for the two-hand frame. This controller is deliberately pure:
 * storage, DOM, camera, GPU and audio routing stay in the integration layer.
 */
export function createFrameContentController(options = {}) {
  let settings = normalizeFrameContentSettings(options.settings || options);
  let liveRecipe = compilePromptScene(settings.prompt, settings);
  let lockedRecipe = liveRecipe;
  let lastPhase = 'searching';
  let locked = false;
  let destroyed = false;
  let dwellStartedAt = null;
  let exerciseLatched = false;
  let eventCount = 0;

  const bbox = { x: 0, y: 0, w: 0, h: 0 };
  const events = [
    { type: '', ts: 0, source: '' },
    { type: '', ts: 0, source: '' },
  ];
  const plan = {
    ts: 0,
    mode: settings.mode,
    phase: 'searching',
    visible: false,
    locked: false,
    opacity: 0,
    focalOpacity: 0,
    secondaryOpacity: 0,
    energy: 0,
    bbox,
    recipe: liveRecipe,
    fit: settings.fit,
    stageFill: false,
    objectClass: settings.objectClass,
    focalPolicy: settings.focalPolicy,
    focusSource: settings.focusSource,
    focusDetail: settings.focusDetail,
    focus: settings.focus,
    visualRoute: settings.visualRoute,
    soundRoute: settings.soundRoute,
    paint: { accumulate: false },
    object: { updateCrop: false },
    promptShader: { animate: false, lockSeed: false },
    exerciseTarget: {
      source: settings.exerciseRule.source,
      target: settings.exerciseRule.target,
      evaluate: false,
      inside: false,
      progress: 0,
      success: false,
    },
    events,
    eventCount: 0,
  };

  function emit(type, timestamp, source = 'frame-content') {
    if (eventCount >= events.length) return;
    const event = events[eventCount];
    event.type = type;
    event.ts = timestamp;
    event.source = source;
    eventCount += 1;
  }

  function clearEvents() {
    eventCount = 0;
    plan.eventCount = 0;
  }

  function configure(patch = {}) {
    if (destroyed) return snapshot();
    const previous = settings;
    settings = normalizeFrameContentSettings(patch, previous);
    const recipeChanged = settings.prompt !== previous.prompt
      || settings.seed !== previous.seed
      || settings.intensity !== previous.intensity
      || settings.fit !== previous.fit;
    if (recipeChanged) liveRecipe = compilePromptScene(settings.prompt, settings);
    if (!locked) lockedRecipe = liveRecipe;
    return snapshot();
  }

  function evaluateExercise(timestamp, frame, point) {
    const target = plan.exerciseTarget;
    target.source = settings.exerciseRule.source;
    target.target = settings.exerciseRule.target;
    target.evaluate = settings.mode === 'exercise-target'
      && framePhase(frame) !== 'off'
      && Boolean(frame?.confirmed);
    target.success = false;
    if (!target.evaluate) {
      target.inside = false;
      target.progress = 0;
      dwellStartedAt = null;
      exerciseLatched = false;
      return;
    }

    target.inside = settings.exerciseRule.target === 'frame-center'
      ? pointNearCenter(point, bbox, settings.exerciseRule.tolerance)
      : pointInsideQuad(point, frame?.quad)
        && pointInsideBox(point, bbox, settings.exerciseRule.tolerance);
    if (!target.inside) {
      target.progress = 0;
      dwellStartedAt = null;
      exerciseLatched = false;
      return;
    }
    if (dwellStartedAt === null) dwellStartedAt = timestamp;
    const held = Math.max(0, timestamp - dwellStartedAt);
    target.progress = settings.exerciseRule.holdMs <= 0
      ? 1
      : clamp(held / settings.exerciseRule.holdMs);
    if (target.progress >= 1 && !exerciseLatched) {
      exerciseLatched = true;
      target.success = true;
      emit('exercise-success', timestamp, settings.exerciseRule.source);
    }
  }

  function update(input = {}) {
    if (destroyed) return plan;
    clearEvents();
    const frame = input.frame || input.gestureFrame || input;
    const timestamp = Math.max(plan.ts, finite(input.timestamp ?? input.ts ?? frame?.ts, plan.ts));
    const phase = framePhase(frame);
    const render = frameRender(frame);
    const nextLocked = Boolean(frame?.locked) || ['frozen', 'fading', 'off'].includes(phase);

    if (nextLocked && !locked) {
      lockedRecipe = liveRecipe;
      emit('content-lock', timestamp);
    } else if (!nextLocked && locked) {
      lockedRecipe = liveRecipe;
      emit('content-unlock', timestamp);
    }
    locked = nextLocked;

    plan.ts = timestamp;
    plan.mode = settings.mode;
    plan.phase = phase;
    plan.visible = Boolean(render.visible ?? (frame?.opacity > 0));
    plan.locked = locked;
    plan.opacity = clamp(render.opacity ?? frame?.opacity);
    plan.focalOpacity = clamp(render.focalOpacity ?? plan.opacity);
    plan.secondaryOpacity = clamp(render.secondaryOpacity ?? plan.opacity);
    plan.energy = clamp(frame?.energy);
    copyBox(bbox, frame?.bbox);
    plan.recipe = locked ? lockedRecipe : liveRecipe;
    plan.fit = settings.fit;
    plan.stageFill = settings.stageFill && Boolean(frame?.confirmed);
    plan.objectClass = settings.objectClass;
    plan.focalPolicy = settings.focalPolicy;
    plan.focusSource = settings.focusSource;
    plan.focusDetail = settings.focusDetail;
    plan.focus = settings.focus;
    plan.visualRoute = settings.visualRoute;
    plan.soundRoute = settings.soundRoute;
    plan.paint.accumulate = settings.mode === 'paint' && Boolean(render.paint?.accumulate);
    plan.object.updateCrop = settings.mode === 'object' && Boolean(render.object?.updateCrop);
    plan.promptShader.animate = settings.mode === 'prompt-shader'
      && Boolean(render.promptShader?.animate);
    plan.promptShader.lockSeed = settings.mode === 'prompt-shader' && locked;
    evaluateExercise(timestamp, frame, input.exercisePoint);
    plan.eventCount = eventCount;
    lastPhase = phase;
    return plan;
  }

  function snapshot() {
    return Object.freeze({
      destroyed,
      settings,
      runtime: Object.freeze({
        phase: lastPhase,
        locked,
        recipe: locked ? lockedRecipe : liveRecipe,
        exerciseLatched,
      }),
    });
  }

  function reset() {
    if (destroyed) return plan;
    lockedRecipe = liveRecipe;
    lastPhase = 'searching';
    locked = false;
    dwellStartedAt = null;
    exerciseLatched = false;
    plan.ts = 0;
    plan.phase = 'searching';
    plan.visible = false;
    plan.locked = false;
    plan.opacity = 0;
    plan.focalOpacity = 0;
    plan.secondaryOpacity = 0;
    plan.energy = 0;
    copyBox(bbox, null);
    clearEvents();
    return plan;
  }

  function destroy() {
    if (destroyed) return;
    reset();
    destroyed = true;
  }

  return Object.freeze({ configure, update, snapshot, reset, destroy });
}
