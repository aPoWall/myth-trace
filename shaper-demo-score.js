import { CONFIG, clamp, lerp } from './config.js';

const settings = CONFIG.shaperDemo;
const ease = value => value * value * (3 - 2 * value);

export function createShaperDemoScore() {
  const effects = new Float32Array(4);
  const center = new Float32Array([.5, .5, 0, 0]);
  let elapsed = 0;

  function step(chapter, deltaMs, target, motion, amount, reducedMotion) {
    elapsed = Math.min(elapsed + deltaMs, chapter.durationMs);
    const progress = elapsed / chapter.durationMs;
    const releaseStart = chapter.durationMs - settings.releaseMs;
    const release = chapter.release ? 1 - ease(clamp((elapsed - releaseStart) / settings.releaseMs)) : 1;
    const rise = lerp(.46, 1, ease(progress));
    const drive = clamp(rise + clamp(motion) * settings.motionLift) * release * amount;
    const follow = 1 - Math.exp(-deltaMs / settings.crossfadeMs);
    for (let index = 0; index < effects.length; index++) {
      const motionScale = reducedMotion && index < 3 ? CONFIG.accessibility.reducedMotion.motionScale : 1;
      effects[index] = lerp(effects[index], chapter.effects[index] * drive * motionScale, follow);
    }
    center[0] = lerp(center[0], target.x, follow);
    center[1] = lerp(center[1], 1 - target.y, follow);
    center[2] = progress;
    return progress;
  }

  return {
    effects, center, step,
    restart() { elapsed = 0; },
    elapsed: () => elapsed,
  };
}

// A short local musical answer to a finished utterance in Aftervoice.
export function aftervoiceAnswer(text) {
  const words = String(text).toLowerCase().match(/[\p{L}]+/gu) || [];
  if (!words.length) return null;
  if (words.some(word => /^(тих|тиш|молч|silent|silence|still|quiet|hush)/u.test(word))) return 'hush';
  if (words.some(word => /^(выше|вверх|откр|подни|open|rise|rising|higher)/u.test(word))) return 'rise';
  if (words.some(word => /^(ниже|вниз|верни|назад|lower|fall|return|back)/u.test(word))) return 'return';
  return 'echo';
}
