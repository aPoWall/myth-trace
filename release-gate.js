import { ROOM_RECEIPT_ITEMS, summarizeRoomReceipt } from './stage-check.js';

function cleanStamp(value) {
  return String(value || '').trim().slice(0, 80);
}

export function normalizeReleaseRecord(value, schemaVersion = 1) {
  if (!value || value.version !== schemaVersion) return null;
  const buildStamp = cleanStamp(value.buildStamp);
  const frozenAt = Number(value.frozenAt);
  if (!buildStamp || !Number.isFinite(frozenAt) || frozenAt <= 0) return null;
  const roomIds = new Set(Array.isArray(value.room) ? value.room : ROOM_RECEIPT_ITEMS.filter(({ id }) => value.room?.[id] === true).map(({ id }) => id));
  return Object.freeze({
    version: schemaVersion,
    buildStamp,
    frozenAt,
    softwareVersion: String(value.softwareVersion || '').slice(0, 24),
    room: Object.freeze(ROOM_RECEIPT_ITEMS.filter(({ id }) => roomIds.has(id)).map(({ id }) => id)),
  });
}

export function deriveReleaseGate(input = {}) {
  const currentBuildStamp = cleanStamp(input.currentBuildStamp);
  const receiptBuildStamp = cleanStamp(input.receiptBuildStamp);
  const pendingBuildStamp = cleanStamp(input.pendingBuildStamp);
  const room = summarizeRoomReceipt(input.roomReceipt);
  const software = input.software || {};
  const softwareComplete = software.verified === true
    && Number(software.javascriptTests) > 0
    && Number(software.pythonTests) > 0
    && Number(software.browserSuites) > 0
    && Number(software.enduranceMinutes) >= 30;
  const bound = Boolean(currentBuildStamp && receiptBuildStamp === currentBuildStamp);
  const ready = softwareComplete && room.complete && bound && !pendingBuildStamp;
  const frozen = normalizeReleaseRecord(input.releaseRecord, Number(input.schemaVersion) || 1);
  const frozenCurrent = Boolean(frozen && ready && frozen.buildStamp === currentBuildStamp);
  const missing = ROOM_RECEIPT_ITEMS.filter(({ id }) => !room.checked.includes(id)).map(({ id }) => id);

  return Object.freeze({
    currentBuildStamp,
    receiptBuildStamp,
    pendingBuildStamp,
    softwareComplete,
    room,
    missing: Object.freeze(missing),
    bound,
    ready,
    frozen,
    frozenCurrent,
    status: frozenCurrent ? 'frozen' : ready ? 'ready' : pendingBuildStamp ? 'pending-build' : room.complete ? 'unbound' : 'blocked',
  });
}

export function createReleaseRecord({ buildStamp, softwareVersion, roomReceipt, frozenAt = Date.now(), schemaVersion = 1 }) {
  const room = summarizeRoomReceipt(roomReceipt);
  const stamp = cleanStamp(buildStamp);
  if (!stamp || !room.complete || !Number.isFinite(frozenAt) || frozenAt <= 0) return null;
  return normalizeReleaseRecord({
    version: schemaVersion,
    buildStamp: stamp,
    frozenAt,
    softwareVersion,
    room: Object.fromEntries(room.checked.map((id) => [id, true])),
  }, schemaVersion);
}
