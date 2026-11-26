import { CONFIG } from './config.js';

const octave = 12;
const maxShift = CONFIG.instrument.maxRegister;
const { minRate, maxRate } = CONFIG.samples;
const defaultRoot = 60;
const clamp = (value, min, max, fallback) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

export function normalizeSamplePitch(options) {
  const { transpose, sourceMidi, targetMidi, keyFollow } = options ?? {};
  const root = Math.round(clamp(sourceMidi, 0, 127, defaultRoot));
  return {
    transpose: Math.round(clamp(transpose, -maxShift, maxShift, 0)),
    sourceMidi: root,
    targetMidi: Math.round(clamp(targetMidi, 0, 127, root)),
    keyFollow: keyFollow === true,
  };
}

export function getSamplePlaybackRate(options) {
  const { transpose, sourceMidi, targetMidi, keyFollow } = normalizeSamplePitch(options);
  const semitones = clamp(transpose + (keyFollow ? targetMidi - sourceMidi : 0), -maxShift, maxShift, 0);
  return clamp(options?.rate, minRate, maxRate, 1) * 2 ** (semitones / octave);
}
