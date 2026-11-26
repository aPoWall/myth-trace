import { studioOnly } from './studio-only.js';
import { CONFIG, clamp } from './config.js';

const settings = CONFIG.liveLab;
const presets = ['off', 'tremor', 'rupture', 'residue'];
const defaultPrompt = 'dark charcoal etching, cold blue iron and oxidized copper, mist, sparse luminous threads, black background';

export function createLiveLab(panel, canvas, stageCanvas) {
  const status = panel.querySelector('[data-lab-status]');
  const prompt = panel.querySelector('[data-lab-prompt]');
  const button = panel.querySelector('[data-lab-diffusion]');
  const fields = [...panel.querySelectorAll('[data-lab-value]')];
  const choices = [...panel.querySelectorAll('[data-lab-preset]')];
  const context = canvas.getContext('2d');
  const frames = [null, null];
  const settingsState = { preset: settings.preset, amount: settings.amount, tear: settings.tear,
    memory: settings.memory, mix: settings.mix };
  try {
    const saved = JSON.parse(localStorage.getItem(settings.storageKey));
    if (presets.includes(saved?.preset)) settingsState.preset = saved.preset;
    for (const key of ['amount', 'tear', 'memory', 'mix']) {
      if (Number.isFinite(saved?.[key])) settingsState[key] = clamp(saved[key]);
    }
    prompt.value = typeof saved?.prompt === 'string' ? saved.prompt.slice(0, 220) : defaultPrompt;
  } catch {
    prompt.value = defaultPrompt;
  }
  const warp = new Float32Array(4);
  const center = new Float32Array([.5, .5, 0, 0]);
  let enabled = false, request, nextTime = 0, lastTime = 0, arrival = 0;
  let energy = 0, gesture = false, pulse = 0, opacity = 0, bootPending = false;
  let activeInput = false, lastSignature = '';
  let hasNewFrame = false;
  const report = value => { if (status.textContent !== value) status.textContent = value; };
  const save = () => {
    try { localStorage.setItem(settings.storageKey, JSON.stringify({ ...settingsState, prompt: prompt.value })); } catch {}
  };
  function renderSettings() {
    for (const control of fields) control.value = settingsState[control.dataset.labValue];
    for (const choice of choices) choice.setAttribute('aria-pressed', String(choice.dataset.labPreset === settingsState.preset));
    button.setAttribute('aria-pressed', String(enabled));
    stageCanvas.dataset.liveLab = settingsState.preset;
  }
  for (const control of fields) control.addEventListener('input', () => {
    settingsState[control.dataset.labValue] = Number(control.value);
    save();
  });
  for (const choice of choices) choice.addEventListener('click', () => {
    settingsState.preset = choice.dataset.labPreset;
    renderSettings();
    save();
  });
  prompt.addEventListener('change', save);
  renderSettings();
  function applyCue(cue) {
    if (!cue || typeof cue !== 'object') return;
    if (presets.includes(cue.preset)) settingsState.preset = cue.preset;
    for (const key of ['amount', 'tear', 'memory', 'mix']) {
      if (Number.isFinite(cue[key])) settingsState[key] = clamp(cue[key]);
    }
    if (typeof cue.prompt === 'string') prompt.value = cue.prompt.slice(0, 220);
    renderSettings();
    save();
  }

  function stop() {
    enabled = false;
    request?.abort();
    request = null;
    for (const frame of frames) frame?.close();
    frames.fill(null);
    hasNewFrame = false;
    lastSignature = '';
    opacity = 0;
    canvas.hidden = true;
    canvas.dataset.state = 'off';
    delete canvas.dataset.latency;
    renderSettings();
    report('Diffusion off');
  }
  button.addEventListener('click', () => {
    if (enabled) { stop(); return; }
    if (!context || typeof createImageBitmap !== 'function') { report('Diffusion is unavailable in this browser'); return; }
    enabled = true;
    nextTime = 0;
    bootPending = true;
    renderSettings();
    report('Connecting to local SD-Turbo…');
  });

  async function generate(nodes, drivenEnergy, signature) {
    const job = new AbortController();
    request = job;
    const started = performance.now();
    const timeout = setTimeout(() => job.abort(), settings.requestMs);
    let delay = settings.cadenceMs;
    try {
      const response = await studioOnly(settings.sidecar + '/frame', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: job.signal,
        body: JSON.stringify({ nodes, energy: drivenEnergy, prompt: prompt.value.trim() || defaultPrompt }),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Model busy');
      const bitmap = await createImageBitmap(await response.blob());
      if (!enabled || request !== job) { bitmap.close(); return; }
      frames[0]?.close();
      frames[0] = frames[1];
      frames[1] = bitmap;
      arrival = performance.now();
      hasNewFrame = true;
      canvas.dataset.state = 'live';
      canvas.dataset.latency = String(Math.round(arrival - started));
      lastSignature = signature;
      report(`SD-Turbo · ${((arrival - started) / 1000).toFixed(1)} s · ${settings.size}×${settings.size}`);
    } catch (error) {
      if (request !== job) return;
      delay = settings.retryMs;
      canvas.dataset.state = 'waiting';
      report(error.name === 'AbortError' ? 'SD-Turbo timed out'
        : error instanceof TypeError ? 'Start local diffusion with scripts/start-diffusion.sh' : error.message);
    } finally {
      clearTimeout(timeout);
      if (request === job) {
        request = null;
        nextTime = performance.now() + delay;
      }
    }
  }

  function update(time, tracking, audio, controls, active) {
    const dt = Math.min(100, Math.max(0, time - lastTime));
    lastTime = time;
    const ease = 1 - Math.exp(-dt / settings.followMs);
    const hands = tracking?.hands || [];
    const measured = hands.find(hand => hand.handedness === 'Right') || hands[0];
    const body = tracking?.poses?.[0]?.center;
    const target = measured?.palm || body || controls.pointer;
    const level = clamp(Math.max(tracking?.metrics?.handEnergy || 0, tracking?.metrics?.motion || 0,
      (audio?.rms || 0) * 2.6, (controls.lightScore?.signal?.rms || 0) * 2.6));
    energy += (level - energy) * ease;
    const tapped = Boolean(controls.pointer.down || hands.some(hand => hand.pinch > .72) || audio?.beat > .7);
    pulse = tapped && !gesture ? 1 : pulse * Math.exp(-dt / settings.pulseMs);
    gesture = tapped;
    center[0] += (target.x - center[0]) * ease;
    center[1] += (1 - target.y - center[1]) * ease;
    center[2] = controls.reducedMotion ? 0 : energy;
    center[3] = controls.reducedMotion ? 0 : pulse;
    warp[0] = active ? presets.indexOf(settingsState.preset) : 0;
    warp[1] = settingsState.amount;
    warp[2] = settingsState.tear;
    warp[3] = settingsState.memory;

    if (enabled && active && !document.hidden && !request && time >= nextTime) {
      const nodes = [];
      for (const hand of hands.slice(0, 2)) {
        for (const point of [hand.palm, hand.landmarks?.[8]]) if (point) nodes.push([point.x, point.y]);
      }
      if (body) nodes.push([body.x, body.y]);
      if (!nodes.length) nodes.push([controls.pointer.x, controls.pointer.y]);
      const snapped = nodes.map(point => point.map(value => Math.round(clamp(value) * 32) / 32));
      const signature = JSON.stringify([snapped, prompt.value, Math.round(energy * 8)]);
      if (bootPending || signature !== lastSignature) {
        bootPending = false;
        void generate(snapped, energy, signature);
      }
    }

    activeInput = active;
    const fade = frames[1] ? clamp((time - arrival) / settings.frameFadeMs) : 0;
    opacity = enabled && active && frames[1] ? settingsState.mix * (frames[0] ? 1 : fade) : 0;
    canvas.hidden = !opacity;
    if (opacity && (hasNewFrame || fade < 1)) {
      context.clearRect(0, 0, settings.size, settings.size);
      if (frames[0]) context.drawImage(frames[0], 0, 0);
      context.globalAlpha = frames[0] ? fade : 1;
      context.drawImage(frames[1], 0, 0);
      context.globalAlpha = 1;
      hasNewFrame = fade < 1;
    }
    if (opacity && Number(canvas.style.opacity) !== opacity) canvas.style.opacity = opacity;
  }
  return {
    warp, center, update, stop, applyCue,
    paint(ctx, width, height) {
      if (!activeInput || !opacity) return;
      const size = Math.max(width, height);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = opacity;
      ctx.drawImage(canvas, (width - size) / 2, (height - size) / 2, size, size);
      ctx.restore();
    },
  };
}
