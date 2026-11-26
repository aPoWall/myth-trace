const SUBJECTS = Object.freeze([
  Object.freeze({ id: 'banana', words: Object.freeze(['banana', 'bananas', 'банан', 'бананы']), shape: 'banana-sdf' }),
  Object.freeze({ id: 'hand', words: Object.freeze(['hand', 'hands', 'рука', 'руки']), shape: 'hand-field' }),
  Object.freeze({ id: 'eye', words: Object.freeze(['eye', 'eyes', 'глаз', 'глаза']), shape: 'eye-sdf' }),
  Object.freeze({ id: 'flower', words: Object.freeze(['flower', 'flowers', 'цветок', 'цветы']), shape: 'petal-field' }),
  Object.freeze({ id: 'face', words: Object.freeze(['face', 'faces', 'лицо', 'лица']), shape: 'face-mask' }),
  Object.freeze({ id: 'portal', words: Object.freeze(['portal', 'window', 'портал', 'окно']), shape: 'portal-field' }),
  Object.freeze({ id: 'propeller', words: Object.freeze(['fan', 'propeller', 'ventilator', 'вентилятор', 'пропеллер']), shape: 'rotor-field' }),
]);

const PALETTES = Object.freeze({
  bone: Object.freeze({
    id: 'bone', field: Object.freeze([0.025, 0.022, 0.02]),
    primary: Object.freeze([0.91, 0.86, 0.76]), secondary: Object.freeze([0.42, 0.19, 0.11]),
  }),
  warm: Object.freeze({
    id: 'warm', field: Object.freeze([0.035, 0.018, 0.012]),
    primary: Object.freeze([0.98, 0.72, 0.16]), secondary: Object.freeze([0.55, 0.15, 0.045]),
  }),
  oxide: Object.freeze({
    id: 'oxide', field: Object.freeze([0.027, 0.018, 0.016]),
    primary: Object.freeze([0.76, 0.35, 0.19]), secondary: Object.freeze([0.89, 0.82, 0.69]),
  }),
  blue: Object.freeze({
    id: 'blue', field: Object.freeze([0.012, 0.02, 0.032]),
    primary: Object.freeze([0.25, 0.62, 0.82]), secondary: Object.freeze([0.76, 0.88, 0.91]),
  }),
});

const PALETTE_WORDS = Object.freeze({
  warm: Object.freeze(['warm', 'yellow', 'gold', 'sunny', 'тёплый', 'теплый', 'жёлтый', 'желтый', 'золотой']),
  oxide: Object.freeze(['oxide', 'rust', 'rusty', 'red', 'ржавый', 'ржавчина', 'красный']),
  blue: Object.freeze(['blue', 'cold', 'ice', 'cyan', 'синий', 'холодный', 'лёд', 'лед']),
  bone: Object.freeze(['bone', 'ivory', 'graphite', 'mono', 'white', 'кость', 'слоновая', 'графит', 'белый']),
});

const MOTION_WORDS = Object.freeze({
  animated: Object.freeze(['animated', 'animate', 'alive', 'moving', 'анимированный', 'живой', 'движение']),
  fast: Object.freeze(['fast', 'rapid', 'storm', 'быстро', 'быстрый', 'шторм']),
  slow: Object.freeze(['slow', 'calm', 'drift', 'медленно', 'медленный', 'спокойный']),
  pulse: Object.freeze(['pulse', 'pulsing', 'breath', 'breathing', 'пульс', 'дыхание', 'дышит']),
  spin: Object.freeze(['spin', 'spinning', 'rotate', 'rotation', 'крутится', 'вращение']),
  glitch: Object.freeze(['glitch', 'broken', 'scan', 'глитч', 'сломанный', 'скан']),
});

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function normalizePrompt(input) {
  return String(input ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 160);
}

function tokenize(prompt) {
  return prompt ? prompt.split(/\s+/u).filter(Boolean) : [];
}

function includesAny(tokenSet, words) {
  return words.some((word) => tokenSet.has(word));
}

function hashText(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function resolveSubject(tokenSet) {
  return SUBJECTS.find((subject) => includesAny(tokenSet, subject.words))
    || Object.freeze({ id: 'organic', shape: 'organic-field' });
}

function resolvePalette(tokenSet) {
  for (const [id, words] of Object.entries(PALETTE_WORDS)) {
    if (includesAny(tokenSet, words)) return PALETTES[id];
  }
  return PALETTES.bone;
}

function resolveMotion(tokenSet, seedUnit) {
  const animated = includesAny(tokenSet, MOTION_WORDS.animated);
  const fast = includesAny(tokenSet, MOTION_WORDS.fast);
  const slow = includesAny(tokenSet, MOTION_WORDS.slow);
  const pulse = includesAny(tokenSet, MOTION_WORDS.pulse);
  const spin = includesAny(tokenSet, MOTION_WORDS.spin);
  const glitch = includesAny(tokenSet, MOTION_WORDS.glitch);
  let speed = animated ? 0.42 : 0.18;
  if (fast) speed = 0.82;
  if (slow) speed = 0.12;
  return Object.freeze({
    speed,
    drift: clamp((animated ? 0.46 : 0.18) + seedUnit * 0.12),
    pulse: pulse ? 0.8 : animated ? 0.32 : 0.12,
    spin: spin ? 0.72 : 0.08 + seedUnit * 0.1,
    glitch: glitch ? 0.72 : 0,
  });
}

function resolveTexture(tokenSet) {
  if (tokenSet.has('grid') || tokenSet.has('сетка')) return 'grid';
  if (tokenSet.has('smoke') || tokenSet.has('дым')) return 'smoke';
  if (tokenSet.has('liquid') || tokenSet.has('жидкий')) return 'liquid';
  if (tokenSet.has('grain') || tokenSet.has('grainy') || tokenSet.has('зерно')) return 'grain';
  return 'fibres';
}

export function compilePromptScene(input, options = {}) {
  const prompt = normalizePrompt(input);
  const tokens = tokenize(prompt);
  const tokenSet = new Set(tokens);
  const salt = Number.isFinite(options.seed) ? String(options.seed) : 'mythtrace';
  const seed = hashText(`${salt}:${prompt || 'organic'}`);
  const seedUnit = seed / 0xffffffff;
  const subject = resolveSubject(tokenSet);
  const palette = resolvePalette(tokenSet);
  const motion = resolveMotion(tokenSet, seedUnit);
  const texture = resolveTexture(tokenSet);
  const density = clamp(0.48 + seedUnit * 0.24 + (motion.glitch ? 0.12 : 0));
  const recipe = {
    version: 1,
    prompt,
    seed,
    subject: subject.id,
    shape: subject.shape,
    palette: palette.id,
    colors: palette,
    texture,
    motion,
    density,
    intensity: clamp(options.intensity ?? 0.7),
    fit: options.fit === 'cover' ? 'cover' : 'contain',
  };
  return Object.freeze(recipe);
}

export function createPromptSceneCompiler(options = {}) {
  let seed = Number.isFinite(options.seed) ? options.seed : 0;
  let intensity = clamp(options.intensity ?? 0.7);
  let fit = options.fit === 'cover' ? 'cover' : 'contain';
  let recipe = compilePromptScene(options.prompt || '', { seed, intensity, fit });
  let destroyed = false;

  function compile(prompt, overrides = {}) {
    if (destroyed) return recipe;
    if (Number.isFinite(overrides.seed)) seed = overrides.seed;
    if (overrides.intensity !== undefined) intensity = clamp(overrides.intensity);
    if (overrides.fit !== undefined) fit = overrides.fit === 'cover' ? 'cover' : 'contain';
    recipe = compilePromptScene(prompt, { seed, intensity, fit });
    return recipe;
  }

  function getState() {
    return Object.freeze({ destroyed, recipe });
  }

  function destroy() {
    destroyed = true;
  }

  return Object.freeze({ compile, getState, destroy });
}
