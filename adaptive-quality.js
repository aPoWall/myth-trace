function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function createAdaptiveQualityController({ config, onChange = () => {} } = {}) {
  const settings = config?.adaptiveQuality;
  if (!settings) throw new TypeError('createAdaptiveQualityController requires CONFIG.adaptiveQuality');
  let level = settings.initialLevel;
  let measuredFps = 0;
  let candidate = '';
  let candidateSince = 0;
  let changedAt = 0;
  let changes = 0;
  let lastEvent = `quality ${level} · waiting for measured fps`;

  function levelSettings() { return settings.levels[level]; }
  function state() {
    return Object.freeze({ level, measuredFps, candidate, candidateSince, changedAt, changes, settings: levelSettings(), lastEvent });
  }
  function transition(next, timestamp, reason) {
    if (!settings.order.includes(next) || next === level) return state();
    level = next;
    changedAt = timestamp;
    changes += 1;
    candidate = '';
    candidateSince = 0;
    lastEvent = `quality ${level} · ${reason}`;
    try { onChange(state(), lastEvent); } catch { /* observers cannot break the stage */ }
    return state();
  }
  function update({ timestamp = 0, fps = 0 } = {}) {
    const now = Math.max(0, finite(timestamp));
    const nextFps = finite(fps);
    if (nextFps <= 0) return state();
    measuredFps = nextFps;
    const current = levelSettings();
    let target = '';
    let holdMs = 0;
    let reason = '';
    if (current.degradeTo && measuredFps < current.degradeBelowFps) {
      target = current.degradeTo;
      holdMs = current.degradeHoldMs;
      reason = `${Math.round(measuredFps)} fps sustained low`;
    } else if (current.recoverTo && measuredFps >= current.recoverAboveFps) {
      target = current.recoverTo;
      holdMs = current.recoverHoldMs;
      reason = `${Math.round(measuredFps)} fps sustained recovery`;
    }
    if (!target) {
      candidate = '';
      candidateSince = 0;
      return state();
    }
    if (candidate !== target) {
      candidate = target;
      candidateSince = now;
      return state();
    }
    if (now - candidateSince < holdMs) return state();
    return transition(target, now, reason);
  }
  return Object.freeze({ update, getState: state });
}
