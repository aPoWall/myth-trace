function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function boundedText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function uniqueMidiDevices(value, settings) {
  if (!Array.isArray(value)) return Object.freeze([]);
  const seen = new Set();
  const devices = [];
  for (const source of value) {
    const label = boundedText(source, settings.maxMidiLabelLength);
    const key = label.toLocaleLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    devices.push(label);
    if (devices.length >= settings.maxMidiDevices) break;
  }
  return Object.freeze(devices);
}

function freezeProfile(profile) {
  if (!profile) return null;
  return Object.freeze({
    ...profile,
    midiDevices: Object.freeze([...(profile.midiDevices || [])]),
    projector: Object.freeze({ ...profile.projector }),
  });
}

export function normalizeVenueProfile(input, config, savedAt = Date.now()) {
  const settings = config?.venueProfile;
  if (!settings || !input || typeof input !== 'object') return null;
  const monitorPresets = Object.keys(config?.audio?.monitor?.presets || {});
  const fallbackPreset = String(config?.audio?.monitor?.defaultPreset || monitorPresets[0] || 'clear');
  const monitorPreset = monitorPresets.includes(String(input.monitorPreset || ''))
    ? String(input.monitorPreset)
    : fallbackPreset;
  const timestamp = Math.max(0, Math.trunc(finite(savedAt, 0)));
  return freezeProfile({
    id: boundedText(input.id, settings.maxNameLength) || `venue-${timestamp}`,
    name: boundedText(input.name, settings.maxNameLength) || 'venue profile',
    cameraDeviceId: boundedText(input.cameraDeviceId, settings.maxDeviceIdLength),
    micDeviceId: boundedText(input.micDeviceId, settings.maxDeviceIdLength),
    monitorPreset,
    midiDevices: uniqueMidiDevices(input.midiDevices, settings),
    projector: {
      threshold: clamp(input.projector?.threshold),
      intensity: clamp(input.projector?.intensity),
      bloom: clamp(input.projector?.bloom, 0, config.calibration.safeBloomMax),
      mirrored: input.projector?.mirrored !== false,
    },
    savedAt: timestamp,
  });
}

function mediaMatch(savedId, currentIds, exposed) {
  if (!savedId) return 'default';
  if (currentIds.includes(savedId)) return 'matched';
  return exposed ? 'missing' : 'pending';
}

export function matchVenueProfile(profile, current = {}) {
  if (!profile) return Object.freeze({ camera: 'empty', mic: 'empty', midi: 'empty' });
  const cameraIds = Array.isArray(current.cameraIds) ? current.cameraIds.map(String).filter(Boolean) : [];
  const micIds = Array.isArray(current.micIds) ? current.micIds.map(String).filter(Boolean) : [];
  const currentMidi = Array.isArray(current.midiDevices)
    ? current.midiDevices.map((label) => String(label).trim().toLocaleLowerCase()).filter(Boolean)
    : [];
  let midi = 'default';
  if (profile.midiDevices.length) {
    if (profile.midiDevices.every((label) => currentMidi.includes(label.toLocaleLowerCase()))) midi = 'matched';
    else midi = current.midiExposed ? 'missing' : 'pending';
  }
  return Object.freeze({
    camera: mediaMatch(profile.cameraDeviceId, cameraIds, Boolean(current.cameraExposed)),
    mic: mediaMatch(profile.micDeviceId, micIds, Boolean(current.micExposed)),
    midi,
  });
}

export function createVenueProfileStore({
  config,
  storage = globalThis.localStorage,
  wallClock = Date.now,
  onStatus = () => {},
} = {}) {
  const settings = config?.venueProfile;
  if (!settings?.storageKey) throw new TypeError('createVenueProfileStore requires CONFIG.venueProfile');
  let profile = null;
  let persisted = false;
  let lastEvent = 'venue profile empty · save current room explicitly';

  try {
    const raw = JSON.parse(storage?.getItem?.(settings.storageKey) || 'null');
    profile = raw?.version === settings.schemaVersion
      ? normalizeVenueProfile(raw.profile, config, raw.profile?.savedAt)
      : null;
    persisted = Boolean(profile);
    if (profile) lastEvent = `venue restored · ${profile.name} · settings idle`;
  } catch {
    lastEvent = 'venue storage unavailable · memory only';
  }

  function state(message = lastEvent) {
    return Object.freeze({ profile, persisted, lastEvent: message });
  }

  function report(message) {
    lastEvent = message;
    try { onStatus(state(), message); } catch { /* observers cannot break the profile */ }
    return state();
  }

  function save(input) {
    profile = normalizeVenueProfile(input, config, wallClock());
    if (!profile) return report('venue profile rejected · invalid settings');
    try {
      storage?.setItem?.(settings.storageKey, JSON.stringify({ version: settings.schemaVersion, profile }));
      persisted = true;
    } catch {
      persisted = false;
    }
    return report(`venue saved · ${profile.name} · ${persisted ? 'local' : 'memory only'}`);
  }

  function clear() {
    profile = null;
    persisted = false;
    try { storage?.removeItem?.(settings.storageKey); } catch { /* in-memory clear still succeeds */ }
    return report('venue profile cleared · running routes unchanged');
  }

  function getState() {
    return state();
  }

  return Object.freeze({ save, clear, getState });
}
