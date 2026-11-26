function finiteTime(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function liveCount(items) {
  return Array.isArray(items) ? items.length : 0;
}

function modelLabel(label, count, modelState, cameraActive) {
  if (count > 0) return `${label} ${count} live`;
  if (modelState === 'unavailable') return `${label} unavailable`;
  if (modelState === 'disabled') return `${label} disabled`;
  if (modelState === 'loading') return `${label} loading`;
  return cameraActive ? `${label} waiting` : `${label} standby`;
}

export const ROOM_RECEIPT_ITEMS = Object.freeze([
  Object.freeze({ id: 'camera', label: 'camera + landmarks observed' }),
  Object.freeze({ id: 'projector', label: 'projector image observed' }),
  Object.freeze({ id: 'audio', label: 'test note heard' }),
  Object.freeze({ id: 'midi', label: 'MIDI note heard' }),
  Object.freeze({ id: 'gesture', label: 'hand pinch heard' }),
  Object.freeze({ id: 'voice', label: 'poem heard' }),
  Object.freeze({ id: 'capture', label: 'local take saved' }),
  Object.freeze({ id: 'panic', label: 'panic silence confirmed' }),
]);

export function summarizeRoomReceipt(value = {}) {
  const checked = ROOM_RECEIPT_ITEMS.filter((item) => value?.[item.id] === true);
  const timestamp = finiteTime(value?.timestamp);
  return Object.freeze({
    checked: Object.freeze(checked.map((item) => item.id)),
    count: checked.length,
    total: ROOM_RECEIPT_ITEMS.length,
    timestamp,
    complete: checked.length === ROOM_RECEIPT_ITEMS.length,
  });
}

/**
 * Turns already-observed browser state into a human-readable stage checklist.
 * It intentionally performs no device requests, audio playback, MIDI work or capture.
 */
export function deriveStageCheck(input = {}) {
  const tracking = input.tracking || {};
  const camera = tracking.camera || {};
  const audio = input.audio || {};
  const music = input.music || {};
  const capture = input.capture || {};
  const renderer = input.renderer || {};
  const narrative = input.narrative || {};
  const frameCrop = input.frameCrop || {};
  const modelStates = input.modelStates || {};
  const cameraActive = Boolean(camera.active);
  const audioReady = Boolean(music.armed && music.contextState === 'running');
  const panicAt = finiteTime(input.panicAt);
  const now = finiteTime(input.now);

  const items = Object.freeze([
    Object.freeze({
      id: 'renderer',
      state: renderer.webgl2 === true ? 'live' : 'fallback',
      text: renderer.webgl2 === true ? 'webgl2 live' : 'safe raster fallback',
    }),
    Object.freeze({
      id: 'camera',
      state: cameraActive ? 'live' : 'waiting',
      text: cameraActive ? `camera live · ${camera.label || 'local source'}` : 'camera standby · press C',
    }),
    Object.freeze({ id: 'hands', state: liveCount(tracking.hands) ? 'live' : 'waiting', text: modelLabel('hands', liveCount(tracking.hands), modelStates.hand, cameraActive) }),
    Object.freeze({ id: 'body', state: liveCount(tracking.poses) ? 'live' : 'waiting', text: modelLabel('body', liveCount(tracking.poses), modelStates.pose, cameraActive) }),
    Object.freeze({ id: 'face', state: liveCount(tracking.faces) ? 'live' : 'waiting', text: modelLabel('face', liveCount(tracking.faces), modelStates.face, cameraActive) }),
    Object.freeze({ id: 'objects', state: liveCount(tracking.objects) ? 'live' : 'waiting', text: modelLabel('objects', liveCount(tracking.objects), modelStates.object, cameraActive) }),
    Object.freeze({
      id: 'roi',
      state: frameCrop.active && frameCrop.sourceKind === 'roi' ? 'live' : 'waiting',
      text: frameCrop.active && frameCrop.sourceKind === 'roi'
        ? `author ROI ${frameCrop.held ? 'held' : 'live'} · local frame crop`
        : 'author ROI idle · G → object → author ROI',
    }),
    Object.freeze({
      id: 'sound',
      state: audioReady ? (music.silent ? 'ready' : 'live') : 'waiting',
      text: audioReady ? (music.silent ? 'browser sound armed · listen in room' : `sound gate live · ${music.voiceCount || 0} voice`) : 'sound off · open I → START SOUND',
    }),
    Object.freeze({
      id: 'midi',
      state: audio.midiActive ? 'live' : 'waiting',
      text: audio.midiActive ? `midi live · ${(audio.devices || []).join(', ') || 'input'}` : 'midi standby · press N',
    }),
    Object.freeze({
      id: 'voice',
      state: narrative.playing ? 'live' : 'waiting',
      text: narrative.playing ? 'poem playing · local routed voice' : 'poem idle · press Z → PLAY POEM',
    }),
    Object.freeze({
      id: 'capture',
      state: capture.active ? 'live' : 'ready',
      text: capture.active ? 'capture recording locally' : `capture ready · ${capture.takeCount || 0} local take${capture.takeCount === 1 ? '' : 's'}`,
    }),
    Object.freeze({
      id: 'panic',
      state: panicAt ? 'ready' : 'waiting',
      text: panicAt && now >= panicAt ? 'panic sent · confirm room silence' : 'panic check · press X before audience',
    }),
  ]);

  return Object.freeze({
    items,
    roomNote: 'ROOM CHECK IS MANUAL · listen on the actual projector output; browser state cannot prove room sound or image.',
  });
}
