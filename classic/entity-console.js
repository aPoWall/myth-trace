import { clamp } from './config.js';

const TIP_INDEXES = Object.freeze([
  Object.freeze(['thumb', 4]),
  Object.freeze(['index', 8]),
  Object.freeze(['middle', 12]),
  Object.freeze(['ring', 16]),
  Object.freeze(['pinky', 20]),
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pointDistance(a, b) {
  return Math.hypot(
    finite(a?.x) - finite(b?.x),
    finite(a?.y) - finite(b?.y),
    finite(a?.z) - finite(b?.z),
  );
}

function boxDiagonal(box = {}) {
  return Math.max(Math.hypot(finite(box.w), finite(box.h)), Number.EPSILON);
}

function fingerCurl(landmarks, joint = {}) {
  const a = landmarks[joint.a];
  const b = landmarks[joint.b];
  const c = landmarks[joint.c];
  if (!a || !b || !c) return 0;
  const ab = [finite(a.x) - finite(b.x), finite(a.y) - finite(b.y), finite(a.z) - finite(b.z)];
  const cb = [finite(c.x) - finite(b.x), finite(c.y) - finite(b.y), finite(c.z) - finite(b.z)];
  const magnitude = Math.hypot(...ab) * Math.hypot(...cb);
  if (magnitude <= Number.EPSILON) return 0;
  const cosine = clamp((ab[0] * cb[0] + ab[1] * cb[1] + ab[2] * cb[2]) / magnitude, -1, 1);
  return clamp(1 - Math.acos(cosine) / Math.PI);
}

export function deriveHandConsoleMetrics(hand = {}, curlJoints = []) {
  const landmarks = Array.isArray(hand.landmarks) ? hand.landmarks : [];
  const palm = hand.palm || landmarks[0] || { x: 0, y: 0, z: 0 };
  const scale = boxDiagonal(hand.bbox);
  const thumb = landmarks[4] || palm;
  const index = landmarks[8] || palm;
  const pinky = landmarks[20] || palm;
  let openness = 0;
  for (const [, landmarkIndex] of TIP_INDEXES) {
    openness += pointDistance(landmarks[landmarkIndex] || palm, palm);
  }
  openness = clamp(openness / (TIP_INDEXES.length * scale));
  const curls = {};
  for (const joint of curlJoints) curls[String(joint.name || 'finger')] = fingerCurl(landmarks, joint);
  const fingertips = {};
  for (const [name, landmarkIndex] of TIP_INDEXES) {
    const point = landmarks[landmarkIndex] || palm;
    fingertips[name] = { x: clamp(finite(point.x)), y: clamp(finite(point.y)) };
  }
  return {
    pinch: clamp(Number.isFinite(Number(hand.pinch)) ? Number(hand.pinch) : 1 - pointDistance(thumb, index) / scale),
    openness: clamp(Number.isFinite(Number(hand.openness)) ? Number(hand.openness) : openness),
    spread: clamp(pointDistance(index, pinky) / scale),
    curl: curls,
    velocity: clamp(Math.hypot(finite(hand.velocityX), finite(hand.velocityY)), 0, Math.SQRT2),
    fingertips,
  };
}

function textElement(tag, text, className = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = String(text);
  return element;
}

function percent(value) {
  return `${Math.round(clamp(finite(value)) * 100)}%`;
}

function short(value, digits = 2) {
  return finite(value).toFixed(digits);
}

function pointText(point) {
  return `${short(point?.x)}, ${short(point?.y)}`;
}

function boxText(box) {
  return `${short(box?.x)},${short(box?.y)} · ${short(box?.w)}×${short(box?.h)}`;
}

function addMetric(container, label, value) {
  container.append(textElement('span', `${label} ${value}`));
}

function makeRow(title, status = '') {
  const row = document.createElement('article');
  row.className = 'entity-row';
  const head = document.createElement('header');
  head.className = 'entity-row__head';
  head.append(textElement('strong', title), textElement('span', status));
  const metrics = document.createElement('div');
  metrics.className = 'entity-row__metrics';
  row.append(head, metrics);
  return { row, metrics };
}

function copyDefaults(entityConfig) {
  const settings = {};
  for (const source of entityConfig.sourceOrder) {
    const defaults = entityConfig.sources[source] || {};
    settings[source] = {
      enabled: defaults.enabled !== false,
      overlay: clamp(finite(defaults.overlay)),
      sound: clamp(finite(defaults.sound)),
    };
    if (source === 'objects') settings[source].classes = [];
  }
  return settings;
}

function validateStored(raw, entityConfig) {
  const settings = copyDefaults(entityConfig);
  const storedSettings = raw && typeof raw === 'object' ? raw.settings : null;
  for (const source of entityConfig.sourceOrder) {
    const stored = storedSettings?.[source];
    if (!stored || typeof stored !== 'object') continue;
    settings[source].enabled = stored.enabled !== false;
    settings[source].overlay = clamp(finite(stored.overlay, settings[source].overlay));
    settings[source].sound = clamp(finite(stored.sound, settings[source].sound));
    if (source === 'objects' && Array.isArray(stored.classes)) {
      settings.objects.classes = [...new Set(stored.classes
        .map((label) => String(label || '').trim().toLowerCase())
        .filter(Boolean))].slice(0, 32);
    }
  }
  const requestedSource = String(raw?.selectedSource || '');
  return {
    selectedSource: entityConfig.sourceOrder.includes(requestedSource)
      ? requestedSource
      : entityConfig.sourceOrder[0],
    settings,
  };
}

function settingsSnapshot(settings) {
  const snapshot = {};
  for (const [source, route] of Object.entries(settings)) {
    snapshot[source] = {
      enabled: route.enabled,
      overlay: route.overlay,
      sound: route.sound,
    };
    if (source === 'objects') snapshot.objects.classes = route.classes.slice();
  }
  return snapshot;
}

export function createEntityConsole({ root, config, onStatus = () => {}, onSettings = () => {} } = {}) {
  if (!root) throw new Error('entity console root required');
  const entityConfig = config?.entities;
  if (!entityConfig) throw new Error('CONFIG.entities required');

  const closeButton = root.querySelector('[data-entity-close]');
  const sourceButtons = [...root.querySelectorAll('[data-entity-source]')];
  const title = root.querySelector('[data-entity-title]');
  const summary = root.querySelector('[data-entity-summary]');
  const enabledInput = root.querySelector('[data-entity-enabled]');
  const routeInputs = [...root.querySelectorAll('[data-entity-route]')];
  const list = root.querySelector('[data-entity-list]');
  const micStatus = root.querySelector('[data-entity-mic]');
  const midiStatus = root.querySelector('[data-entity-midi]');
  const controller = new AbortController();
  const { signal } = controller;

  let restored = null;
  try {
    const raw = localStorage.getItem(entityConfig.storageKey);
    if (raw) restored = JSON.parse(raw);
  } catch {
    restored = null;
  }
  const initial = validateStored(restored, entityConfig);
  let selectedSource = initial.selectedSource;
  const settings = initial.settings;
  let lastUpdateAt = -Infinity;
  let latestFrame = null;

  function persist() {
    const snapshot = getSettings();
    try {
      localStorage.setItem(entityConfig.storageKey, JSON.stringify({
        version: 1,
        selectedSource,
        settings: snapshot.settings,
      }));
      root.dataset.persisted = 'true';
    } catch {
      root.dataset.persisted = 'false';
    }
    onSettings(snapshot);
  }

  function syncRouteSurface() {
    const route = settings[selectedSource];
    enabledInput.checked = route.enabled;
    for (const input of routeInputs) {
      const name = input.dataset.entityRoute;
      input.step = String(entityConfig.routeStep);
      input.value = String(route[name]);
      const output = root.querySelector(`[data-entity-route-output="${name}"]`);
      if (output) output.textContent = percent(route[name]);
    }
    for (const button of sourceButtons) {
      const selected = button.dataset.entitySource === selectedSource;
      button.dataset.selected = String(selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    root.dataset.selectedSource = selectedSource;
    root.dataset.enabled = String(route.enabled);
    root.dataset.overlay = short(route.overlay);
    root.dataset.sound = short(route.sound);
    title.textContent = selectedSource.toUpperCase();
  }

  function renderHands(frame) {
    const hands = Array.isArray(frame?.tracking?.hands) ? frame.tracking.hands : [];
    for (const hand of hands) {
      const metrics = deriveHandConsoleMetrics(hand, entityConfig.handCurlJoints);
      const { row, metrics: cells } = makeRow(
        `${hand.handedness || 'unknown'} · ${hand.id || 'hand'}`,
        percent(hand.score),
      );
      addMetric(cells, 'pinch', percent(metrics.pinch));
      addMetric(cells, 'open', percent(metrics.openness));
      addMetric(cells, 'spread', percent(metrics.spread));
      addMetric(cells, 'velocity', short(metrics.velocity));
      for (const [finger, curl] of Object.entries(metrics.curl)) addMetric(cells, `${finger} curl`, percent(curl));
      for (const [finger, point] of Object.entries(metrics.fingertips)) addMetric(cells, `${finger} tip`, pointText(point));
      list.append(row);
    }
    return { count: hands.length, confidence: hands.length ? hands.reduce((sum, hand) => sum + finite(hand.score), 0) / hands.length : 0 };
  }

  function renderBody(frame) {
    const poses = Array.isArray(frame?.tracking?.poses) ? frame.tracking.poses : [];
    for (const pose of poses) {
      const { row, metrics } = makeRow(pose.id || 'body', percent(pose.score));
      addMetric(metrics, 'landmarks', Array.isArray(pose.landmarks) ? pose.landmarks.length : 0);
      addMetric(metrics, 'centre', pointText(pose.center));
      addMetric(metrics, 'bbox', boxText(pose.bbox));
      addMetric(metrics, 'velocity', short(Math.hypot(finite(pose.velocityX), finite(pose.velocityY))));
      if (Array.isArray(pose.landmarks)) {
        addMetric(metrics, 'shoulders', `${pointText(pose.landmarks[11])} / ${pointText(pose.landmarks[12])}`);
        addMetric(metrics, 'hips', `${pointText(pose.landmarks[23])} / ${pointText(pose.landmarks[24])}`);
      }
      list.append(row);
    }
    return { count: poses.length, confidence: poses.length ? poses.reduce((sum, pose) => sum + finite(pose.score), 0) / poses.length : 0 };
  }

  function renderFaces(frame) {
    const dedicated = Array.isArray(frame?.tracking?.faces) ? frame.tracking.faces : [];
    const fallback = dedicated.length ? [] : (Array.isArray(frame?.tracking?.poses) ? frame.tracking.poses : []);
    for (const face of dedicated) {
      const { row, metrics } = makeRow(face.id || 'face', `${percent(face.score)} · dedicated`);
      addMetric(metrics, 'landmarks', Array.isArray(face.landmarks) ? face.landmarks.length : 0);
      addMetric(metrics, 'bbox', boxText(face.bbox));
      addMetric(metrics, 'jaw', percent(face.blendshapes?.jawOpen));
      addMetric(metrics, 'smile', percent(face.blendshapes?.smile));
      addMetric(metrics, 'velocity', short(Math.hypot(finite(face.velocity?.x), finite(face.velocity?.y))));
      list.append(row);
    }
    for (const pose of fallback) {
      const { row, metrics } = makeRow(`${pose.id || 'pose'}:face`, `${percent(pose.score)} · pose fallback`);
      addMetric(metrics, 'landmarks', Math.min(11, Array.isArray(pose.landmarks) ? pose.landmarks.length : 0));
      addMetric(metrics, 'nose', pointText(pose.landmarks?.[0]));
      addMetric(metrics, 'ears', `${pointText(pose.landmarks?.[7])} / ${pointText(pose.landmarks?.[8])}`);
      addMetric(metrics, 'velocity', short(Math.hypot(finite(pose.velocityX), finite(pose.velocityY))));
      list.append(row);
    }
    const entities = dedicated.length ? dedicated : fallback;
    return { count: entities.length, confidence: entities.length ? entities.reduce((sum, face) => sum + finite(face.score), 0) / entities.length : 0 };
  }

  function renderObjects(frame) {
    const objects = Array.isArray(frame?.tracking?.objects) ? frame.tracking.objects : [];
    for (const object of objects) {
      const label = String(object.label || 'object');
      const normalizedLabel = label.toLowerCase();
      const muted = settings.objects.classes.includes(normalizedLabel);
      const { row, metrics } = makeRow(`${label} · ${object.id || 'object'}`, percent(object.score));
      row.dataset.entityId = String(object.id || '');
      row.dataset.objectClass = label;
      addMetric(metrics, 'bbox', boxText(object.bbox));
      addMetric(metrics, 'age', `${Math.round(Math.max(0, finite(object.age)))}ms`);
      addMetric(metrics, 'velocity', short(Math.hypot(finite(object.velocityX), finite(object.velocityY))));
      const actions = document.createElement('div');
      actions.className = 'entity-row__actions';
      const toggle = textElement('button', muted ? `unmute ${label}` : `mute ${label}`, 'entity-class-toggle');
      toggle.type = 'button';
      toggle.dataset.objectClass = normalizedLabel;
      toggle.dataset.muted = String(muted);
      actions.append(toggle);
      row.append(actions);
      list.append(row);
    }
    return { count: objects.length, confidence: objects.length ? objects.reduce((sum, object) => sum + finite(object.score), 0) / objects.length : 0 };
  }

  function renderPointer(frame) {
    const anchors = Array.isArray(frame?.tracking?.anchors) ? frame.tracking.anchors : [];
    const pointers = anchors.filter((anchor) => anchor.kind === 'pointer');
    if (!pointers.length && frame?.controls?.pointer) {
      pointers.push({
        id: 'pointer:primary', x: frame.controls.pointer.x, y: frame.controls.pointer.y,
        velocityX: 0, velocityY: 0, confidence: 1, strength: frame.controls.pointer.down ? 1 : 0.42,
      });
    }
    for (const pointer of pointers) {
      const { row, metrics } = makeRow(pointer.id || 'pointer', percent(pointer.confidence ?? 1));
      addMetric(metrics, 'position', pointText(pointer));
      addMetric(metrics, 'strength', percent(pointer.strength));
      addMetric(metrics, 'velocity', short(Math.hypot(finite(pointer.velocityX), finite(pointer.velocityY))));
      list.append(row);
    }
    return { count: pointers.length, confidence: pointers.length ? 1 : 0 };
  }

  function renderFrame(frame) {
    latestFrame = frame || latestFrame;
    if (!latestFrame) return;
    list.replaceChildren();
    let totals;
    if (selectedSource === 'hands') totals = renderHands(latestFrame);
    if (selectedSource === 'body') totals = renderBody(latestFrame);
    if (selectedSource === 'face') totals = renderFaces(latestFrame);
    if (selectedSource === 'objects') totals = renderObjects(latestFrame);
    if (selectedSource === 'pointer') totals = renderPointer(latestFrame);
    totals ||= { count: 0, confidence: 0 };
    if (!totals.count) list.append(textElement('p', `no ${selectedSource} tracked`, 'entity-row'));
    summary.textContent = `${totals.count} ${totals.count === 1 ? 'entity' : 'entities'} · ${percent(totals.confidence)} confidence`;
    root.dataset.entityCount = String(totals.count);
    root.dataset.confidence = short(totals.confidence);
    const audio = latestFrame.audio || {};
    micStatus.textContent = audio.micActive
      ? `mic rms ${short(audio.rms, 3)} · bass ${short(audio.bass, 2)} · mid ${short(audio.mid, 2)} · high ${short(audio.high, 2)} · beat ${short(audio.beat, 2)}`
      : 'mic standby';
    midiStatus.textContent = audio.midiActive
      ? `midi ${audio.lastNote ?? 'live'} · ${Array.isArray(audio.devices) ? audio.devices.length : 0} devices`
      : 'midi standby';
  }

  function selectSource(source) {
    if (!entityConfig.sourceOrder.includes(source)) return;
    selectedSource = source;
    syncRouteSurface();
    renderFrame(latestFrame);
    persist();
    onStatus(`entity console · ${selectedSource}`);
  }

  function updateRoute(name, value) {
    if (!['overlay', 'sound'].includes(name)) return;
    settings[selectedSource][name] = clamp(finite(value));
    syncRouteSurface();
    persist();
    onStatus(`${selectedSource} ${name} route · ${percent(settings[selectedSource][name])}`);
  }

  function setOpen(active) {
    const open = Boolean(active);
    root.hidden = !open;
    root.dataset.open = String(open);
    if (open) {
      syncRouteSurface();
      renderFrame(latestFrame);
      onStatus(`entity console · ${selectedSource}`);
    }
    return open;
  }

  function toggle() {
    return setOpen(root.hidden);
  }

  function update(frame = {}) {
    latestFrame = frame;
    const time = finite(frame.time, performance.now());
    if (root.hidden || time - lastUpdateAt < entityConfig.consoleRateMs) return;
    lastUpdateAt = time;
    renderFrame(frame);
  }

  function getSettings() {
    return { selectedSource, settings: settingsSnapshot(settings) };
  }

  function configureSource(source, patch = {}) {
    if (!entityConfig.sourceOrder.includes(source) || !patch || typeof patch !== 'object') {
      return getSettings();
    }
    const route = settings[source];
    if ('enabled' in patch) route.enabled = Boolean(patch.enabled);
    if ('overlay' in patch) route.overlay = clamp(finite(patch.overlay));
    if ('sound' in patch) route.sound = clamp(finite(patch.sound));
    if (source === selectedSource) syncRouteSurface();
    persist();
    return getSettings();
  }

  function destroy() {
    controller.abort();
    list.replaceChildren();
    delete root.dataset.entityCount;
    delete root.dataset.confidence;
  }

  closeButton.addEventListener('click', () => setOpen(false), { signal });
  for (const button of sourceButtons) {
    button.addEventListener('click', () => selectSource(button.dataset.entitySource), { signal });
  }
  enabledInput.addEventListener('change', () => {
    settings[selectedSource].enabled = enabledInput.checked;
    syncRouteSurface();
    persist();
    onStatus(`${selectedSource} route · ${enabledInput.checked ? 'enabled' : 'disabled'}`);
  }, { signal });
  for (const input of routeInputs) {
    input.addEventListener('input', () => updateRoute(input.dataset.entityRoute, input.value), { signal });
  }
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-object-class]');
    if (!button) return;
    const label = String(button.dataset.objectClass || '').toLowerCase();
    if (!label) return;
    const classes = settings.objects.classes;
    const index = classes.indexOf(label);
    if (index >= 0) classes.splice(index, 1);
    else classes.push(label);
    persist();
    renderFrame(latestFrame);
    onStatus(`object class ${label} · ${index >= 0 ? 'unmuted' : 'muted'}`);
  }, { signal });

  syncRouteSurface();
  root.dataset.open = String(!root.hidden);
  onSettings(getSettings());

  return { toggle, setOpen, update, getSettings, configureSource, destroy };
}
