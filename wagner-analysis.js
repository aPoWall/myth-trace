function unit(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function createWagnerAnalysis(settings) {
  const required = [
    'fftSize', 'floor', 'closeFloor', 'gateReleaseMs', 'swellAttackMs',
    'swellReleaseMs', 'rmsScale', 'bandMinDb', 'bandMaxDb', 'bassHz',
    'midHz', 'maxHz', 'onsetThreshold', 'onsetCooldownMs', 'onsetReleaseMs',
    'phaseRate', 'dtMaxMs', 'tailMs',
  ];
  for (const key of required) {
    if (!Number.isFinite(settings?.[key])) throw new TypeError(`Wagner analysis requires finite ${key}`);
  }
  const {
    fftSize, floor, closeFloor, gateReleaseMs, swellAttackMs, swellReleaseMs,
    rmsScale, bandMinDb, bandMaxDb, bassHz, midHz, maxHz, onsetThreshold,
    onsetCooldownMs, onsetReleaseMs, phaseRate, dtMaxMs, tailMs,
  } = settings;
  if (!Number.isInteger(fftSize) || fftSize < 2 || fftSize % 2 !== 0
      || closeFloor < 0 || floor <= closeFloor || floor > 1
      || gateReleaseMs <= 0 || swellAttackMs <= 0 || swellReleaseMs <= 0
      || rmsScale <= 0 || bandMinDb >= bandMaxDb || bandMaxDb > 0
      || bassHz <= 0 || midHz <= bassHz || maxHz <= midHz
      || onsetThreshold < 0 || onsetThreshold > 1 || onsetCooldownMs < 0
      || onsetReleaseMs <= 0 || phaseRate < 0 || dtMaxMs <= 0 || tailMs <= 0) {
    throw new RangeError('Wagner analysis settings are outside their bounded ranges');
  }
  const binCount = fftSize / 2;
  const previousSpectrum = new Float32Array(binCount);
  const referenceAmplitude = Math.pow(10, bandMaxDb / 20);
  const frame = {
    rms: 0, bass: 0, mid: 0, high: 0, centroid: 0, flux: 0,
    onset: 0, onsetCount: 0, swell: 0, gate: 0, phase: 0,
  };
  let previousTime = null;
  let previousSampleRate = 0;
  let signalOpen = false;
  let lastSignalAt = -Infinity;
  let lastSignalGate = 0;
  let lastOnsetAt = -Infinity;
  let onsetStrength = 0;

  function normalizedBand(power, count) {
    if (power <= 0 || count <= 0) return 0;
    const decibels = 10 * Math.log10(power / count);
    return unit((decibels - bandMinDb) / (bandMaxDb - bandMinDb));
  }

  function update(input) {
    if (!input) return frame;
    const { time, waveform, spectrum, sampleRate, active } = input;
    if (!Number.isFinite(time) || time < 0 || (previousTime !== null && time <= previousTime)) return frame;
    const elapsedMs = previousTime === null ? 0 : Math.min(dtMaxMs, time - previousTime);
    previousTime = time;
    const waveformCount = active && waveform ? Math.min(fftSize, waveform.length) : 0;
    let squares = 0;
    for (let index = 0; index < waveformCount; index += 1) {
      const value = waveform[index];
      const bounded = Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0;
      squares += bounded * bounded;
    }
    const rawRms = waveformCount > 0 ? unit(Math.sqrt(squares / waveformCount)) : 0;
    if (!active || rawRms <= closeFloor) signalOpen = false;
    else if (rawRms >= floor) signalOpen = true;
    const measured = signalOpen && rawRms > closeFloor;
    const drive = measured ? unit(rawRms * rmsScale) : 0;
    frame.rms = measured ? rawRms : 0;
    frame.bass = 0;
    frame.mid = 0;
    frame.high = 0;
    frame.centroid = 0;
    frame.flux = 0;

    if (measured && Number.isFinite(sampleRate) && sampleRate > 0 && spectrum) {
      const rateChanged = previousSampleRate > 0 && sampleRate !== previousSampleRate;
      if (rateChanged) previousSpectrum.fill(0);
      previousSampleRate = sampleRate;
      const binHz = sampleRate / fftSize;
      const spectrumCount = Math.min(binCount, spectrum.length);
      let bassPower = 0;
      let midPower = 0;
      let highPower = 0;
      let bassCount = 0;
      let midCount = 0;
      let highCount = 0;
      let amplitudeSum = 0;
      let frequencySum = 0;
      let currentSum = 0;
      let previousSum = 0;
      let positiveChange = 0;
      for (let index = 0; index < binCount; index += 1) {
        const frequency = index * binHz;
        const included = index > 0 && index < spectrumCount && frequency <= maxHz;
        const decibels = included ? spectrum[index] : -Infinity;
        const amplitude = Number.isFinite(decibels) && decibels > bandMinDb
          ? Math.pow(10, Math.min(bandMaxDb, decibels) / 20)
          : 0;
        const normalized = amplitude / referenceAmplitude;
        const previous = previousSpectrum[index];
        currentSum += normalized;
        previousSum += previous;
        positiveChange += Math.max(0, normalized - previous);
        previousSpectrum[index] = normalized;
        if (!included) continue;
        const power = amplitude * amplitude;
        if (frequency < bassHz) { bassPower += power; bassCount += 1; }
        else if (frequency < midHz) { midPower += power; midCount += 1; }
        else { highPower += power; highCount += 1; }
        amplitudeSum += amplitude;
        frequencySum += frequency * amplitude;
      }
      frame.bass = normalizedBand(bassPower, bassCount);
      frame.mid = normalizedBand(midPower, midCount);
      frame.high = normalizedBand(highPower, highCount);
      frame.centroid = amplitudeSum > 0 ? Math.min(maxHz, frequencySum / amplitudeSum) : 0;
      const fluxDenominator = Math.max(currentSum, previousSum);
      frame.flux = rateChanged || fluxDenominator <= 0 ? 0 : unit(positiveChange / fluxDenominator);
      if (frame.flux > onsetThreshold && time - lastOnsetAt >= onsetCooldownMs) {
        onsetStrength = frame.flux;
        lastOnsetAt = time;
        frame.onsetCount = Math.min(Number.MAX_SAFE_INTEGER, frame.onsetCount + 1);
      }
    } else {
      previousSpectrum.fill(0);
    }

    frame.onset = onsetStrength * unit(1 - (time - lastOnsetAt) / onsetReleaseMs);
    if (measured) {
      lastSignalAt = time;
      lastSignalGate = drive;
      frame.gate = drive;
      frame.phase = (frame.phase + drive * elapsedMs * phaseRate / 1000) % 1;
    } else {
      frame.gate = lastSignalGate * unit(1 - (time - lastSignalAt) / gateReleaseMs);
    }
    const swellDuration = drive > frame.swell ? swellAttackMs : swellReleaseMs;
    frame.swell = unit(frame.swell + (drive - frame.swell) * (1 - Math.exp(-elapsedMs / swellDuration)));
    if (!measured && time - lastSignalAt >= tailMs) {
      frame.gate = 0;
      frame.swell = 0;
      frame.onset = 0;
      onsetStrength = 0;
    }
    return frame;
  }

  function reset() {
    previousSpectrum.fill(0);
    previousTime = null;
    previousSampleRate = 0;
    signalOpen = false;
    lastSignalAt = -Infinity;
    lastSignalGate = 0;
    lastOnsetAt = -Infinity;
    onsetStrength = 0;
    frame.rms = 0;
    frame.bass = 0;
    frame.mid = 0;
    frame.high = 0;
    frame.centroid = 0;
    frame.flux = 0;
    frame.onset = 0;
    frame.onsetCount = 0;
    frame.swell = 0;
    frame.gate = 0;
    frame.phase = 0;
    return frame;
  }

  return { frame, update, reset };
}
