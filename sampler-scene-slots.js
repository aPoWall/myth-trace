function boundedText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function emptySlot(index) {
  return Object.freeze({ index, clipId: '', label: '', savedAt: 0, status: 'empty' });
}

function normalizeSlot(value, index, maxLabelLength) {
  const clipId = boundedText(value?.clipId, 160);
  if (!clipId) return emptySlot(index);
  return Object.freeze({
    index,
    clipId,
    label: boundedText(value?.label, maxLabelLength) || clipId,
    savedAt: Math.max(0, Number(value?.savedAt) || 0),
    status: 'stored',
  });
}

export function createSamplerSceneSlots({ storage, config, now = () => Date.now() }) {
  const settings = config?.samplerScenes;
  if (!settings || typeof settings !== 'object') throw new TypeError('config.samplerScenes is required');
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new TypeError('sampler scene storage is required');
  }
  const slotCount = Math.trunc(Number(settings.slotCount));
  const schemaVersion = Math.trunc(Number(settings.schemaVersion));
  const maxLabelLength = Math.trunc(Number(settings.maxLabelLength));
  if (slotCount < 1 || slotCount > 8) throw new TypeError('sampler scene slotCount must be 1..8');
  if (schemaVersion < 1) throw new TypeError('sampler scene schemaVersion must be positive');
  if (maxLabelLength < 1 || maxLabelLength > 160) throw new TypeError('sampler scene maxLabelLength must be 1..160');

  let persisted = true;
  let slots = Array.from({ length: slotCount }, (_, index) => emptySlot(index));

  try {
    const raw = JSON.parse(storage.getItem(settings.storageKey) || 'null');
    if (raw?.version === schemaVersion && Array.isArray(raw.slots)) {
      slots = slots.map((_, index) => normalizeSlot(raw.slots[index], index, maxLabelLength));
    }
  } catch {
    persisted = false;
  }

  function write() {
    try {
      storage.setItem(settings.storageKey, JSON.stringify({
        version: schemaVersion,
        slots: slots.map(({ clipId, label, savedAt }) => ({ clipId, label, savedAt })),
      }));
      persisted = true;
    } catch {
      persisted = false;
    }
    return persisted;
  }

  function validIndex(index) {
    const value = Math.trunc(Number(index));
    return value >= 0 && value < slotCount ? value : -1;
  }

  function save(index, clip) {
    const slotIndex = validIndex(index);
    if (slotIndex < 0) return Object.freeze({ status: 'invalid', slot: null, persisted });
    const clipId = boundedText(clip?.id ?? clip?.clipId, 160);
    if (!clipId) return Object.freeze({ status: 'unassigned', slot: slots[slotIndex], persisted });
    slots[slotIndex] = normalizeSlot({
      clipId,
      label: clip?.label,
      savedAt: Number(now()) || 0,
    }, slotIndex, maxLabelLength);
    write();
    return Object.freeze({ status: persisted ? 'saved' : 'volatile', slot: slots[slotIndex], persisted });
  }

  function clear(index) {
    const slotIndex = validIndex(index);
    if (slotIndex < 0) return false;
    slots[slotIndex] = emptySlot(slotIndex);
    write();
    return true;
  }

  function recall(index, availableClips = []) {
    const slotIndex = validIndex(index);
    if (slotIndex < 0) return Object.freeze({ status: 'invalid', slot: null, clip: null });
    const slot = slots[slotIndex];
    if (!slot.clipId) return Object.freeze({ status: 'empty', slot, clip: null });
    const clip = availableClips.find((candidate) => candidate?.id === slot.clipId) || null;
    if (!clip) return Object.freeze({ status: 'missing', slot: Object.freeze({ ...slot, status: 'missing' }), clip: null });
    return Object.freeze({ status: 'ready', slot: Object.freeze({ ...slot, status: 'ready' }), clip });
  }

  function list(availableClips = []) {
    return Object.freeze(slots.map((slot, index) => recall(index, availableClips).slot));
  }

  return Object.freeze({ save, recall, clear, list, isPersisted: () => persisted });
}
