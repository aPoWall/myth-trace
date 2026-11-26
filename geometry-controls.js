import { studioOnly } from './studio-only.js';
import { CONFIG } from './config.js';
import { heardAgentCommand } from './stage-agent.js';
import { defaultGeometry, geometryLayers, normalizeGeometry, parseGeometryCommand, normalizeShadow, scatterShapes } from './geometry-mix.js';

export function bindGeometryControls({ panel, voicePanel, musicPanel, read, apply, applyShadow, microphone, setAppMic, dispatchCommand, cancelCommand, onListening, onTranscript, speechLanguage }) {
  const find = selector => panel.querySelector(selector) || voicePanel?.querySelector(selector);
  const status = find('[data-sotnik-status]');
  const record = find('[data-geometry-record]');
  const listen = find('[data-geometry-listen]');
  const form = find('[data-geometry-command]');
  const command = form.querySelector('input');
  const file = find('[data-geometry-file]');
  const balances = find('[data-layer-balances]');
  const key = musicPanel.querySelector('[data-geometry-key]');
  const harmony = musicPanel.querySelector('[data-geometry-harmony]');
  const major = musicPanel.querySelector('[data-geometry-major]');
  let recorder, recordingTimer, recording = false;
  let listening = false, liveStream = null, liveRequest = null, lastLive = '', lastLiveAt = 0;
  let generation = 0, manualRequest = null;
  let lastDirection = '';
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

  for (const shift of [0, 1, 2, 3, 4, 5, 6, -5, -4, -3, -2, -1]) {
    key.add(new Option(names[((shift + 2) % 12 + 12) % 12], String(shift)));
  }
  for (const mode of geometryLayers) {
    const row = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = mode;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '.01';
    input.setAttribute('aria-label', `${mode} balance`);
    const output = document.createElement('output');
    row.append(name, input, output);
    balances.append(row);
    row.dataset.layer = mode;
    input.addEventListener('input', () => apply({ layers: { ...read().layers, [mode]: Number(input.value) } }));
  }

  function render() {
    const state = read();
    for (const button of panel.querySelectorAll('[data-light-score-mode]')) {
      const mode = button.dataset.lightScoreMode;
      const active = mode === 'off'
        ? !Object.keys(state.layers).length && !state.shadow && !state.merge && !state.auto && state.mask === 'off' && !state.scatter.length
        : state.layers[mode] > 0;
      button.setAttribute('aria-pressed', String(active));
    }
    for (const row of balances.children) {
      const weight = state.layers[row.dataset.layer] || 0;
      row.querySelector('input').value = String(weight);
      row.querySelector('output').textContent = `${Math.round(weight * 100)}%`;
    }
    for (const button of panel.querySelectorAll('[data-lattice-source]')) {
      button.setAttribute('aria-pressed', String(state.sources[button.dataset.latticeSource]));
    }
    find('[data-light-score-strength]').value = String(state.strength);
    find('[data-geometry-attack]').value = String(state.attack);
    find('[data-geometry-palette]').value = state.palette;
    find('[data-geometry-merge]').setAttribute('aria-pressed', String(state.merge));
    find('[data-geometry-auto]').setAttribute('aria-pressed', String(state.auto));
    key.value = String(state.transpose > 6 ? state.transpose - 12 : state.transpose < -5 ? state.transpose + 12 : state.transpose);
    harmony.value = state.harmony;
    major.value = String(state.major);
  }

  function enact(phrase) {
    const text = phrase.trim().slice(0, 280);
    if (!text) { status.textContent = 'No phrase detected'; return; }
    lastDirection = text;
    if (dispatchCommand) { dispatchCommand(text); return; }
    const patch = parseGeometryCommand(text, read());
    const micChange = /(?:включи|выключи|вкл|выкл).{0,12}микрофон/i.test(text);
    if (micChange) void setAppMic?.(!/выключ|выкл/i.test(text))?.catch(error => { status.textContent = error.message; });
    if (Object.keys(patch).length || micChange) {
      apply(patch);
      status.textContent = `Applied · ${text}`;
    } else status.textContent = `“${text}” · press SERVER SHADOW to generate a shape`;
    if (/нарисуй|придумай.*фигур|сотник.*(?:тен|фигур)/i.test(text)) void applyShadow(lastDirection);
  }

  function stopListening() {
    generation++;
    listening = false;
    listen.setAttribute('aria-pressed', 'false');
    listen.textContent = 'listen · off';
    liveRequest?.abort();
    manualRequest?.abort();
    liveStream?.getTracks().forEach(track => track.stop());
    liveStream = null;
    if (recorder?.state === 'recording') recorder.stop();
    cancelCommand?.();
    onListening?.(false);
  }

  find('[data-agent-stop]')?.addEventListener('click', stopListening);

  async function startListening() {
    if (listening || recording) return;
    listening = true;
    const version = ++generation;
    listen.setAttribute('aria-pressed', 'true');
    listen.textContent = 'listen · on';
    lastLive = '';
    lastLiveAt = 0;
    try {
      const trackId = microphone?.();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: trackId ? { deviceId: { exact: trackId } } : true });
      if (!listening || version !== generation) { stream.getTracks().forEach(track => track.stop()); return; }
      liveStream = stream;
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
        if (listening && version === generation) { stopListening(); status.textContent = 'Microphone disconnected · press LISTEN to reconnect'; }
      }, { once: true }));
      onListening?.(true);
      status.textContent = 'Listening · say “Сотник, холоднее” or “Пёс, измени пространство”';
      const segment = () => {
        if (!listening || liveStream !== stream || version !== generation) return;
        const chunks = [];
        const active = new MediaRecorder(stream, { audioBitsPerSecond: 48000 });
        recorder = active;
        active.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        active.onstop = () => {
          if (!listening || liveStream !== stream || version !== generation) return;
          segment();
          if (liveRequest || !chunks.length) return;
          const request = new AbortController();
          liveRequest = request;
          void studioOnly('/api/geometry/voice', { method: 'POST', signal: request.signal,
            headers: { 'X-Voice-Language': speechLanguage?.() || 'ru' },
            body: new Blob(chunks, { type: active.mimeType }) }).then(async response => {
              const result = await response.json();
              if (!response.ok) throw new Error(result.error || 'Transcription unavailable');
              return result;
            }).then(result => {
            if (!listening || liveStream !== stream || version !== generation || typeof result.text !== 'string') return;
            onTranscript?.(result.text);
            const phrase = heardAgentCommand(result.text);
            if (!phrase) return;
            const complete = phrase;
            const normalized = complete.toLowerCase().replace(/[^\p{L}\d]+/gu, ' ').trim();
            if (normalized === lastLive && Date.now() - lastLiveAt < CONFIG.lightScore.voiceMaxMs * 2) return;
            lastLive = normalized;
            lastLiveAt = Date.now();
            command.value = complete;
            enact(complete);
          }).catch(error => {
            if (listening && version === generation && error.name !== 'AbortError') status.textContent = `Voice · ${error.message}`;
          }).finally(() => { if (liveRequest === request) liveRequest = null; });
        };
        active.start();
        setTimeout(() => { if (active.state === 'recording') active.stop(); }, CONFIG.stageAgent.segmentMs);
      };
      segment();
    } catch (error) {
      if (version === generation) { stopListening(); status.textContent = `Microphone · ${error.message}`; }
    }
  }
  listen.addEventListener('click', () => {
    if (listening) { stopListening(); status.textContent = 'Voice commands off'; }
    else void startListening();
  });

  panel.addEventListener('click', event => {
    const mode = event.target.closest('[data-light-score-mode]')?.dataset.lightScoreMode;
    if (mode === 'off') apply({ layers: {}, shadow: null, merge: false, auto: false, mask: 'off', scatter: [] });
    else if (mode) apply({ auto: false, layers: { ...read().layers, [mode]: read().layers[mode] ? 0 : .84 } });
    const source = event.target.closest('[data-lattice-source]')?.dataset.latticeSource;
    if (source) apply({ sources: { ...read().sources, [source]: !read().sources[source] } });
  });
  find('[data-light-score-strength]').addEventListener('input', event => apply({ strength: Number(event.target.value) }));
  find('[data-geometry-clear-pins]').addEventListener('click', () => apply({ pins: [] }));
  find('[data-geometry-attack]').addEventListener('input', event => apply({ attack: Number(event.target.value) }));
  find('[data-geometry-palette]').addEventListener('change', event => apply({ palette: event.target.value }));
  find('[data-geometry-merge]').addEventListener('click', () => apply({
    merge: !read().merge,
    layers: Object.keys(read().layers).length ? read().layers : defaultGeometry.layers,
  }));
  find('[data-geometry-auto]').addEventListener('click', () => apply({ auto: !read().auto }));
  find('[data-geometry-scatter]').addEventListener('click', () => apply({ auto: false, scatter: scatterShapes() }));
  find('[data-geometry-clear-scatter]').addEventListener('click', () => apply({ scatter: [] }));
  key.addEventListener('change', () => apply({ transpose: Number(key.value) }));
  harmony.addEventListener('change', () => apply({ harmony: harmony.value }));
  major.addEventListener('change', () => apply({ major: major.value === 'true' }));
  form.addEventListener('submit', event => { event.preventDefault(); enact(command.value); });
  find('[data-sotnik-analyse]').addEventListener('click', () => void applyShadow(command.value || lastDirection));
  find('[data-geometry-export]').addEventListener('click', () => {
    const encoded = JSON.stringify({ format: 'mythtrace-geometry', version: 1, ...normalizeGeometry(read()) }, null, 2);
    const url = URL.createObjectURL(new Blob([encoded], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mythtrace-geometry.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  });
  find('[data-geometry-import]').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const selected = file.files?.[0];
    if (!selected) return;
    try {
      if (selected.size > 16384) throw new Error();
      const preset = JSON.parse(await selected.text());
      if (preset?.format !== 'mythtrace-geometry' || preset.version !== 1
        || !preset.layers || Array.isArray(preset.layers)) throw new Error();
      if (preset.shadow !== null && !normalizeShadow(preset.shadow)) throw new Error();
      apply(normalizeGeometry(preset));
      status.textContent = 'Preset loaded';
    } catch { status.textContent = 'Could not open the MythTrace preset'; }
    file.value = '';
  });
  record.addEventListener('click', async () => {
    if (listening) return;
    if (recorder?.state === 'recording') { recorder.stop(); return; }
    if (recording) return;
    recording = true;
    const version = generation;
    let stream;
    try {
      const trackId = microphone?.();
      stream = await navigator.mediaDevices.getUserMedia({ audio: trackId ? { deviceId: { exact: trackId } } : true });
      if (version !== generation) { stream.getTracks().forEach(track => track.stop()); recording = false; return; }
      recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        clearTimeout(recordingTimer);
        stream.getTracks().forEach(track => track.stop());
        record.setAttribute('aria-pressed', 'false');
        record.textContent = 'speak';
        if (version !== generation) { recording = false; return; }
        record.disabled = true;
        status.textContent = 'Transcribing locally…';
        try {
          const clip = new Blob(chunks, { type: recorder.mimeType });
          manualRequest = new AbortController();
          const response = await studioOnly('/api/geometry/voice', { method: 'POST', body: clip, signal: manualRequest.signal });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          if (version !== generation) return;
          command.value = result.text;
          enact(result.text);
        } catch (error) { if (version === generation) status.textContent = error.message; }
        finally { recording = false; record.disabled = false; manualRequest = null; }
      };
      recorder.start();
      record.textContent = 'send';
      record.setAttribute('aria-pressed', 'true');
      status.textContent = 'Speak, then press SEND or wait for recording to end.';
      recordingTimer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, CONFIG.lightScore.voiceMaxMs);
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      recording = false;
      status.textContent = `Microphone · ${error.message}`;
    }
  });

  return { render, startListening, stopListening, isListening: () => listening, hasLiveMic: () => Boolean(listening && liveStream?.active), isRecording: () => recording };
}
