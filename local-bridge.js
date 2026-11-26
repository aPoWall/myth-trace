function boundedText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function flatData(value, settings) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.freeze({});
  const output = {};
  for (const [sourceKey, sourceValue] of Object.entries(value).slice(0, settings.maxDataFields)) {
    const key = boundedText(sourceKey, settings.maxStringLength);
    if (!key) continue;
    if (typeof sourceValue === 'string') output[key] = boundedText(sourceValue, settings.maxStringLength);
    else if (typeof sourceValue === 'boolean') output[key] = sourceValue;
    else if (typeof sourceValue === 'number' && Number.isFinite(sourceValue)) output[key] = sourceValue;
  }
  return Object.freeze(output);
}

export function normalizeLocalBridgeUrl(value, settings) {
  const source = boundedText(value, settings?.maxUrlLength || 0);
  if (!source || source.length !== String(value ?? '').trim().length) return '';
  try {
    const url = new URL(source);
    if (!['ws:', 'wss:'].includes(url.protocol)) return '';
    if (!settings.allowedHosts.includes(url.hostname)) return '';
    if (url.username || url.password) return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

export function normalizeBridgeEvent(input, settings, sequence, timestamp) {
  if (!input || !settings.allowedKinds.includes(String(input.kind || ''))) return null;
  const action = boundedText(input.action, settings.maxStringLength);
  if (!action) return null;
  return Object.freeze({
    schema: 'mythtrace.causal-event',
    version: settings.schemaVersion,
    seq: Math.max(1, Math.trunc(finite(sequence, 1))),
    t: Math.max(0, Math.round(finite(timestamp, 0))),
    kind: String(input.kind),
    action,
    label: boundedText(input.label, settings.maxStringLength),
    data: flatData(input.data, settings),
  });
}

export function createLocalBridge({ config, WebSocketCtor = globalThis.WebSocket, clock = () => globalThis.performance?.now?.() || 0, onStatus = () => {} } = {}) {
  const settings = config?.localBridge;
  if (!settings) throw new TypeError('createLocalBridge requires CONFIG.localBridge');
  let socket = null;
  let status = 'idle';
  let url = settings.defaultUrl;
  let sequence = 0;
  let sent = 0;
  let lastEvent = 'local bridge idle · explicit connect only';

  function state() {
    return Object.freeze({ status, url, sequence, sent, connected: status === 'open', lastEvent });
  }

  function report(message) {
    lastEvent = message;
    try { onStatus(state(), message); } catch { /* observers cannot break transport */ }
    return state();
  }

  function detach(target) {
    if (!target) return;
    target.onopen = null;
    target.onclose = null;
    target.onerror = null;
  }

  function disconnect(reason = 'manual') {
    const active = socket;
    socket = null;
    if (active) {
      detach(active);
      try { active.close(1000, boundedText(reason, 80)); } catch { /* route is already detached */ }
    }
    status = 'idle';
    return report(`local bridge disconnected · ${reason}`);
  }

  function connect(source = settings.defaultUrl) {
    const normalized = normalizeLocalBridgeUrl(source, settings);
    if (!normalized) {
      if (!socket) status = 'rejected';
      return report('bridge rejected · localhost ws/wss only');
    }
    if (socket && ['connecting', 'open'].includes(status) && normalized === url) return state();
    if (socket) disconnect('endpoint changed');
    if (typeof WebSocketCtor !== 'function') {
      status = 'unavailable';
      return report('local WebSocket unavailable');
    }
    url = normalized;
    status = 'connecting';
    const target = new WebSocketCtor(url);
    socket = target;
    target.onopen = () => {
      if (socket !== target) return;
      status = 'open';
      report(`local bridge open · ${url}`);
    };
    target.onclose = () => {
      if (socket !== target) return;
      detach(target);
      socket = null;
      status = 'idle';
      report('local bridge closed · no reconnect');
    };
    target.onerror = () => {
      if (socket !== target) return;
      detach(target);
      socket = null;
      status = 'error';
      report('local bridge error · no reconnect');
    };
    return report(`local bridge connecting · ${url}`);
  }

  function emit(input, timestamp = clock()) {
    if (!socket || status !== 'open' || socket.readyState !== 1) return false;
    const event = normalizeBridgeEvent(input, settings, sequence + 1, timestamp);
    if (!event) return false;
    const payload = JSON.stringify(event);
    if (payload.length > settings.maxMessageLength) return false;
    try {
      socket.send(payload);
      sequence += 1;
      sent += 1;
      report(`${event.kind}.${event.action} · local bridge ${sequence}`);
      return true;
    } catch {
      const active = socket;
      socket = null;
      detach(active);
      try { active?.close?.(1011, 'send error'); } catch { /* exact local route is already detached */ }
      status = 'error';
      report('local bridge send error · no reconnect');
      return false;
    }
  }

  return Object.freeze({ connect, disconnect, emit, getState: state });
}
