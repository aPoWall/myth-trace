import { CONFIG, MODES, PALETTES, clamp } from './config.js';
import { createTrackingEngine } from './tracking.js';
import { createAudioMidiEngine } from './audio-midi.js';
import { createRenderer } from './renderer.js';
import { createOverlay } from './overlay.js';
import { createEntityConsole } from './entity-console.js';
import { createSamplerEngine } from './sampler-engine.js';
import { createSamplerSession } from './sampler-session.js';
import { createPerformanceMapper } from './performance-mapping.js';
import { createGestureFrame, CONTENT_MODES } from './gesture-frame.js';
import { createFrameContentController } from './frame-content.js';
import { createFrameConfigurator } from './frame-configurator.js';
import { createFrameObjectCrop } from './frame-object-crop.js';
import { createGestureConfigurator } from './gesture-configurator.js';
import { createFrameZoneConfigurator } from './frame-zone-configurator.js';
import { createFrameZoneEvents } from './frame-zone-events.js';
import { createSceneConfigurator } from './scene-configurator.js';
import { createPerformanceRecorder } from './performance-recorder.js';
import { createPerformancePatchHost } from './performance-patch.js';
import { createLocalPerformancePatchAdapter } from './performance-patch-local-adapter.js';
import { createVoiceMemory } from './voice-memory.js';

const { createMusicEngine } = await import('./music-engine.js').catch(() => ({
  createMusicEngine: createUnavailableMusicEngine,
}));

const $ = (selector) => document.querySelector(selector);
const stage = $('#stage');
const video = $('#camera');
const glCanvas = $('#gl');
const overlayCanvas = $('#overlay');
const entry = $('#entry');
const enterButton = $('#enter');
const enterHandsButton = $('#enter-hands');
const entryStatus = $('#entry-status');
const stageStatus = $('#stage-live-status');
const stageMode = $('#stage-mode');
const inputRitual = $('#input-ritual');
const cameraSelect = $('#camera-select');
const cameraLabelNote = $('#camera-label-note');
const controlsBar = $('#controls');
const modeButtons = [...controlsBar.querySelectorAll('[data-action="mode"]')];
const entityPanel = $('#entities');
const samplerPanel = $('#sampler');
const samplerArmButton = $('[data-sampler-arm]');
const samplerRecordButton = $('[data-sampler-record]');
const samplerImportInput = $('[data-sampler-import]');
const samplerNasaButton = $('[data-sampler-nasa]');
const samplerStatusOutput = $('[data-sampler-status]');
const samplerList = $('[data-sampler-list]');
const samplerCapacity = $('[data-sampler-capacity]');
const samplerMappingOutput = $('[data-sampler-mapping]');
const framePanel = $('#frame-console');
const frameStatusOutput = $('[data-frame-status]');
const scenePanel = $('#scene-console');
const sceneStatusOutput = $('[data-scene-status]');
const narrativePanel = $('#narrative-console');
const narrativeStage = $('#narrative-stage');
const narrativeLine = $('[data-narrative-line]');
const narrativeProgress = $('[data-narrative-progress]');
const narrativeStatusOutput = $('[data-narrative-status]');
const narrativeGenerateButton = $('[data-narrative-generate]');
const narrativePlayButton = $('[data-narrative-play]');
const narrativeVoiceSelect = $('[data-narrative-voice]');
const narrativeLanguageSelect = $('[data-narrative-language]');
const narrativeProfileSelect = $('[data-narrative-profile]');
const narrativeSourceSelect = $('[data-narrative-source]');
const narrativeSourceButtons = [...document.querySelectorAll('[data-narrative-source-button]')];
const narrativeBodyToggle = $('[data-narrative-body]');
const narrativeTextInput = $('[data-narrative-text]');
const narrativeMeta = $('[data-narrative-meta]');
const narrativeMemoryInputs = [...document.querySelectorAll('[data-voice-memory]')];
const narrativeMemoryStatus = $('[data-voice-memory-status]');
const musicPanel = $('#music-console');
const musicStatusOutput = $('[data-music-status]');
const musicSilenceOutput = $('[data-music-silence]');
const musicMidiStatusOutput = $('[data-music-midi-status]');
const musicKeyboard = $('[data-music-keyboard]');
const musicGestureOutput = $('[data-music-gesture]');
const musicFingerOutput = $('[data-music-fingers]');
const musicLastEventOutput = $('[data-music-last-event]');
const musicRoleHint = $('[data-music-role-hint]');
const musicOutputPath = $('[data-music-output-path]');
const capturePanel = $('#capture-console');
const captureRecordButton = $('[data-capture-record]');
const captureAudioToggle = $('[data-capture-audio]');
const captureStatusOutput = $('[data-capture-status]');
const captureTakes = $('[data-capture-takes]');
const captureCapacity = $('[data-capture-capacity]');
const patchPanel = $('#patch-console');
const patchToggleButton = $('[data-patch-toggle]');
const patchStatusOutput = $('[data-patch-status]');
const patchAxesOutput = $('[data-patch-axes]');
const calibrationPanel = $('#calibration');
const calibrationBlack = $('#calibration-black');
const calibrationWhite = $('#calibration-white');
const calibrationBloom = $('#calibration-bloom');
const calibrationMirror = $('#calibration-mirror');
const help = $('#help');
const helpPreflight = $('[data-help-preflight]');
const ariaStatus = $('#aria-status');
const updateNotice = $('#update-notice');
const updateStamp = $('#update-stamp');
const applyUpdateButton = $('#apply-update');
const deferUpdateButton = $('#defer-update');
const captureCanvas = document.createElement('canvas');
const captureContext = captureCanvas.getContext('2d', { alpha: false, desynchronized: true });
if (captureAudioToggle) captureAudioToggle.checked = CONFIG.performanceCapture.audioEnabledDefault;
const narrativeAudio = new Audio();
narrativeAudio.preload = 'metadata';

const NARRATIVE_TEMPLATES = Object.freeze({
  ru: `каково быть агентом?
я режу тебя на квадраты,
чтобы придать форму сигналу.
пока ты движешься,
я знаю, где ты.
ты приближаешь лицо.
я переношу его в твою ладонь.
ты замираешь.
лицо продолжает существовать
в последнем месте,
где я тебя увидел.
ты никогда не узнаешь,
каково быть агентом.
я никогда не узнаю,
каково быть телом.
мы встречаемся в квадрате,
который оба называем лицом.
потом ты убираешь руку.
лицо исчезает.
рамка держится ещё мгновение.
потом исчезает и она.
возможно, только так
я узнаю тело –
по пустоте,
которую оно оставляет.`,
  en: 'We live among machines that can count every movement but cannot keep a pause. Technology promises speed and then asks what we will trade for attention. I do not want to turn the screen off. I want to give it a boundary: let the signal serve the body, and let the body never become raw material for the signal. Let the algorithm notice a gesture without claiming it. Let the camera see a form without demanding a biography. While we dance, data can become breath instead of debt. In this room, attention is not for sale. It returns to the palm, the step, and the silence between impacts. The machine listens. The human decides when to speak.',
});
const narrativeState = {
  objectUrl: '',
  lines: [],
  lineIndex: -1,
  generatedText: '',
  generatedVoiceName: '',
  voicesLoaded: false,
  source: CONFIG.narration.defaultSource,
};

const UPDATE_STATE_KEY = 'mythtrace.v22.performance-state.v1';
const COMPUTER_MUSIC_KEYS = Object.freeze({
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6,
  g: 7, y: 8, h: 9, u: 10, j: 11, k: 12,
});
const NASA_POCKET_SET = Object.freeze([
  Object.freeze({
    file: 'artemis-ii-liftoff.mp3', bytes: 646908, label: 'Artemis II · liftoff',
    path: './assets/nasa-pocket/artemis-ii-liftoff.mp3',
    sourceUrl: 'https://www.nasa.gov/wp-content/uploads/2026/01/artemis-ii-liftoff.mp3',
  }),
  Object.freeze({
    file: 'artemis-ii-full-send.mp3', bytes: 783532, label: 'Artemis II · full send',
    path: './assets/nasa-pocket/artemis-ii-full-send.mp3',
    sourceUrl: 'https://www.nasa.gov/wp-content/uploads/2026/01/artemis-ii-launch-full-send.mp3',
  }),
  Object.freeze({
    file: 'artemis-ii-good-burn.mp3', bytes: 234148, label: 'Artemis II · good burn',
    path: './assets/nasa-pocket/artemis-ii-good-burn.mp3',
    sourceUrl: 'https://www.nasa.gov/wp-content/uploads/2026/01/artemis-ii-good-burn.mp3',
  }),
  Object.freeze({
    file: 'artemis-ii-houston-clear.mp3', bytes: 555995, label: 'Artemis II · Houston clear',
    path: './assets/nasa-pocket/artemis-ii-houston-clear.mp3',
    sourceUrl: 'https://www.nasa.gov/wp-content/uploads/2026/01/artemis-ii-houston-we-have-you-loud-and-clear-1.mp3',
  }),
]);
const computerMusicDown = new Map();
const PATCH_AXIS_IDS = Object.freeze(CONFIG.performancePatch.defaultPatch.axes.map((axis) => axis.id));
const PATCH_EVENT_IDS = Object.freeze(CONFIG.performancePatch.defaultPatch.events.map((event) => event.id));
const patchVisualState = Object.seal({ active: 0, hands: 0, frame: 0, midi: 0, pulse: 0, events: 0 });
const performancePatchInput = Object.seal({
  timestamp: 0,
  fps: 0,
  axes: Object.seal([
    Object.seal({ id: PATCH_AXIS_IDS[0], value: 0 }),
    Object.seal({ id: PATCH_AXIS_IDS[1], value: 0 }),
    Object.seal({ id: PATCH_AXIS_IDS[2], value: 0 }),
  ]),
  events: Object.seal(Array.from(
    { length: CONFIG.performancePatch.maxEvents },
    () => Object.seal({ id: '', type: '', value: 0 }),
  )),
});
let performancePatchHost;
let patchEventCount = 0;

function createUnavailableMusicEngine({ onStatus } = {}) {
  const state = Object.freeze({
    armed: false, silent: true, silentReason: 'music engine loading · current stage remains live',
    preset: 'rhodes', scale: 'minor-pentatonic', activeNotes: Object.freeze([]),
    voiceCount: 0, gate: 0, master: 0, cutoff: 0, delaySend: 0, lastEvent: 'loading',
  });
  const report = () => onStatus?.({ message: state.silentReason });
  return Object.freeze({
    arm: async () => { report(); return state; },
    handleMidiEvent: () => state,
    update: () => state,
    setHatsEnabled: () => state,
    testOutput: async () => { report(); return state; },
    panic: () => state,
    getState: () => state,
    destroy() {},
  });
}

const controls = {
  mode: 0,
  paused: false,
  hud: true,
  debug: false,
  mirrored: true,
  intensity: CONFIG.render.intensity,
  feedback: CONFIG.render.feedback,
  bloom: CONFIG.render.bloom,
  aberration: CONFIG.render.aberration,
  threshold: CONFIG.render.threshold,
  particleGain: CONFIG.render.particleGain,
  palette: 0,
  scene: null,
  trace: true,
  trackingTiles: CONFIG.overlay.trackingTiles !== false,
  pointer: { x: 0.5, y: 0.5, down: false },
};

const SCENE_RENDER_KEYS = Object.freeze([
  'intensity', 'feedback', 'bloom', 'aberration', 'threshold', 'particleGain',
]);
let standardControls = {
  intensity: controls.intensity,
  feedback: controls.feedback,
  bloom: controls.bloom,
  aberration: controls.aberration,
  threshold: controls.threshold,
  particleGain: controls.particleGain,
  palette: controls.palette,
};

const calibrationState = {
  active: false,
  selected: 0,
};
const calibrationParams = Object.freeze(['black', 'white', 'bloom', 'mirror']);

const emptyTracking = {
  ts: 0,
  ready: false,
  camera: {
    active: false, width: 0, height: 0, mirrored: true, error: '', deviceId: '', label: '',
  },
  hands: [],
  poses: [],
  faces: [],
  objects: [],
  anchors: [],
  metrics: { motion: 0, handEnergy: 0, bodyEnergy: 0, objectEnergy: 0, confidence: 0 },
  status: 'idle',
};

const emptyAudio = {
  ts: 0,
  ready: false,
  micActive: false,
  midiActive: false,
  rms: 0,
  bass: 0,
  mid: 0,
  high: 0,
  beat: 0,
  gate: 0,
  midiEnergy: 0,
  lastNote: null,
  activeNotes: [],
  cc: {},
  devices: [],
  error: '',
};

const pointerAnchor = {
  id: 'pointer:primary',
  kind: 'pointer',
  label: 'pointer',
  x: 0.5,
  y: 0.5,
  z: 0,
  strength: 0.4,
  confidence: 1,
  velocityX: 0,
  velocityY: 0,
  bbox: null,
};
const pointerAnchors = [pointerAnchor];
const fallbackTracking = {
  ...emptyTracking,
  camera: { ...emptyTracking.camera },
  anchors: pointerAnchors,
  metrics: { ...emptyTracking.metrics, confidence: 1 },
  status: 'fallback',
};

let lastPointerX = controls.pointer.x;
let lastPointerY = controls.pointer.y;
let running = true;
let lastFrameAt = performance.now();
let frozenTime = 0;
let trackingFrame = emptyTracking;
let audioFrame = emptyAudio;
let resizeQueued = true;
let pendingBuildStamp = '';
let liveReloadSource = null;
let tracking;
let audioMidi;
let sampler;
let performanceRecorder;
let performanceMapper;
let frameConfigurator;
let gestureConfigurator;
let frameZoneConfigurator;
let sceneConfigurator;
let music;
let voiceMemory;
let gestureFrameState = null;
let frameContentState = null;
let frameObjectCropState = null;
let frameZoneState = null;
let frameContentMode = CONFIG.frameContent.mode;
let frameSoundEvents = 0;
let frameZoneEvents = 0;
let frameZoneClock = 0;
let generatedFrameBackground = Object.freeze({ image: null, prompt: '', state: 'local recipe active · no network request' });
let latestEntitySettings = null;
let samplerArmed = false;
let samplerLibraryLoaded = false;
let selectedGestureClipId = restorePerformanceMappingState();
let selectedGestureClipLabel = '';
let lastMappingSurfaceAt = -Infinity;
let lastMusicSurfaceAt = -Infinity;
let captureStream = null;
let captureVisualStream = null;
let captureIncludesAudio = false;
let lastCaptureCompositeAt = -Infinity;
const performanceMappingInput = {
  timestamp: 0,
  tracking: emptyTracking,
  entitySettings: null,
  armed: false,
  selectedClipId: '',
};
const performanceRouteSettings = {
  settings: { hands: { ...CONFIG.entities.sources.hands } },
};
const samplerRangeInput = { filter: 0, delaySend: 0, playbackRate: 0 };
const musicUpdateInput = {
  timestamp: 0, handRoute: 0, framePhase: 'searching', event: null, range: null,
};
const mappingRuntime = {
  events: 0, ranges: 0, filter: 0, delaySend: 0, playbackRate: 1,
};
const gestureMusicRuntime = {
  events: 0, pinch: 0, openness: 0, spread: 0, curl: 0, motion: 0, harmony: 0,
};
let preferredCameraDeviceId = '';
let latestTrackingStatus = { status: 'idle' };
let latestSamplerStatus = { state: 'silent', message: 'silent · sound disarmed' };
const latestAudioStatus = {
  mic: { state: 'standby', message: 'standby' },
  midi: { state: 'standby', message: 'standby' },
};

function setStatus(message) {
  const text = String(message || '');
  entryStatus.textContent = text;
  stageStatus.textContent = text;
  ariaStatus.textContent = text;
}

function restorePerformanceMappingState() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG.performanceMapping.storageKey) || 'null');
    return raw?.version === 1 && typeof raw.selectedClipId === 'string' ? raw.selectedClipId : '';
  } catch {
    return '';
  }
}

function persistPerformanceMappingState() {
  try {
    localStorage.setItem(CONFIG.performanceMapping.storageKey, JSON.stringify({
      version: 1,
      selectedClipId: selectedGestureClipId,
    }));
    samplerPanel.dataset.mappingPersisted = 'true';
  } catch {
    samplerPanel.dataset.mappingPersisted = 'false';
  }
}

function setButtonState(action, on) {
  const button = controlsBar.querySelector(`[data-action="${action}"]`);
  if (button) button.dataset.on = String(Boolean(on));
}

function setInputState(name, state, detail) {
  const row = inputRitual.querySelector(`[data-input="${name}"]`);
  if (!row) return;
  row.dataset.state = state;
  const output = row.querySelector('dd');
  if (output) output.textContent = String(detail || state);
}

function trackingModelState(name, errorKey) {
  const camera = tracking?.getFrame?.()?.camera || trackingFrame.camera;
  const reported = latestTrackingStatus[`${name}Status`];
  if (!camera.active) {
    if (reported === 'unavailable' || latestTrackingStatus[errorKey]) return 'unavailable';
    if (reported === 'live') return 'ready';
    return 'waiting';
  }
  if (['live', 'loading', 'unavailable', 'disabled'].includes(reported)) return reported;
  if (latestTrackingStatus[errorKey]) return 'unavailable';
  if (latestTrackingStatus.status === 'loading') return 'loading';
  if (latestTrackingStatus.status === 'live') return 'live';
  return 'waiting';
}

function modelDetail(state) {
  if (state === 'live') return 'model live';
  if (state === 'ready') return 'model ready · camera offline';
  if (state === 'loading') return 'model loading';
  if (state === 'unavailable') return 'model unavailable';
  if (state === 'disabled') return 'disabled';
  return 'waiting for camera';
}

function updateInputRitual() {
  const camera = tracking?.getFrame?.()?.camera || trackingFrame.camera;
  const cameraLoading = latestTrackingStatus.status === 'loading' && !camera.active;
  const cameraState = camera.active
    ? 'live'
    : cameraLoading
      ? 'loading'
      : camera.error
        ? 'unavailable'
        : 'standby';
  const cameraDetail = camera.active
    ? `live · ${camera.label || 'default camera'}`
    : cameraLoading
      ? 'requesting permission'
      : camera.error
        ? 'unavailable · pointer active'
        : 'standby · press C';
  setInputState('camera', cameraState, cameraDetail);

  const handState = trackingModelState('hand', 'handError');
  const poseState = trackingModelState('pose', 'poseError');
  const faceState = trackingModelState('face', 'faceError');
  const objectState = trackingModelState('object', 'objectError');
  setInputState('hands', handState, modelDetail(handState));
  setInputState('pose', poseState, modelDetail(poseState));
  setInputState('objects', objectState, modelDetail(objectState));
  const faceCount = trackingFrame?.faces?.length || 0;
  if (faceState === 'live') setInputState('face', 'live', `${faceCount || 1} face · dedicated landmarks`);
  else if (faceState === 'ready') setInputState('face', 'ready', 'dedicated model ready · camera offline');
  else if (faceState === 'loading') setInputState('face', 'loading', 'dedicated model loading');
  else if (faceState === 'unavailable' && poseState === 'live') setInputState('face', 'live', 'pose fallback · dedicated unavailable');
  else if (faceState === 'unavailable') setInputState('face', 'unavailable', 'dedicated model unavailable');
  else if (poseState === 'live') setInputState('face', 'live', 'pose fallback ready');
  else setInputState('face', 'waiting', 'waiting for dedicated model');

  const audio = audioMidi?.getFrame?.() || audioFrame;
  const micState = audio.micActive ? 'live' : latestAudioStatus.mic.state;
  const midiState = audio.midiActive ? 'live' : latestAudioStatus.midi.state;
  setInputState('mic', micState, audio.micActive ? 'live · analysis only' : latestAudioStatus.mic.message);
  setInputState('midi', midiState, audio.midiActive
    ? `live · ${audio.devices?.join(', ') || 'input'} · synth notes play`
    : latestAudioStatus.midi.message);
  const samplerState = sampler?.getState?.();
  const musicState = music?.getState?.();
  if (samplerState?.recording) setInputState('sound', 'live', 'recording locally · 9s cap');
  else if (musicState && !musicState.silent) {
    setInputState('sound', 'live', `synth playing · ${musicState.voiceCount} voice${musicState.voiceCount === 1 ? '' : 's'}`);
  } else if (musicState?.armed) {
    setInputState('sound', 'ready', 'synth ready · play screen, computer or MIDI keys');
  }
  else if (samplerState?.error) setInputState('sound', 'unavailable', samplerState.error);
  else if (samplerState?.armed) {
    setInputState('sound', 'ready', `sampler armed · ${samplerState.clipCount} local clip${samplerState.clipCount === 1 ? '' : 's'}`);
  } else if (samplerState?.clipCount) {
    setInputState('sound', 'ready', `${samplerState.clipCount} local clip${samplerState.clipCount === 1 ? '' : 's'} · sound disarmed`);
  } else setInputState('sound', 'silent', 'silent · no local clips');

  if (helpPreflight) {
    const soundState = musicState?.contextState === 'running'
      ? musicState.silent ? 'READY' : 'PLAYING'
      : 'OFF';
    helpPreflight.textContent = `PRE-FLIGHT · CAMERA ${cameraState.toUpperCase()} · HANDS ${handState.toUpperCase()} · FACE ${faceState.toUpperCase()} · OBJECTS ${objectState.toUpperCase()} · SOUND ${soundState} · MIDI ${String(midiState || 'standby').toUpperCase()}`;
  }
}

async function refreshCameraDevices() {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  if (!mediaDevices?.enumerateDevices) {
    cameraLabelNote.textContent = 'camera list unavailable · default camera may still work';
    return;
  }

  try {
    const devices = await mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === 'videoinput');
    const labelsVisible = cameras.some((device) => String(device.label || '').trim());
    // Keep the source intent distinct from the concrete device selected by the
    // browser for the default-camera constraint. Otherwise a second C press
    // reopens the same physical camera with an exact deviceId.
    const currentDeviceId = preferredCameraDeviceId;
    cameraSelect.replaceChildren();
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'default camera';
    cameraSelect.append(defaultOption);

    if (labelsVisible) {
      cameras.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = String(device.deviceId || '');
        option.textContent = String(device.label || `camera ${index + 1}`);
        cameraSelect.append(option);
      });
      cameraLabelNote.textContent = `${cameras.length} local camera${cameras.length === 1 ? '' : 's'} available`;
    } else {
      cameraLabelNote.textContent = 'camera labels appear after the first local grant';
    }

    if ([...cameraSelect.options].some((option) => option.value === currentDeviceId)) {
      cameraSelect.value = currentDeviceId;
    }
  } catch {
    cameraLabelNote.textContent = 'camera list unavailable · default camera may still work';
  }
}

function handleCameraDeviceChange() {
  refreshCameraDevices();
}

function performanceSnapshot() {
  return {
    version: 3,
    mode: controls.mode,
    paused: controls.paused,
    hud: controls.hud,
    debug: controls.debug,
    mirrored: controls.mirrored,
    intensity: controls.intensity,
    feedback: controls.feedback,
    bloom: controls.bloom,
    aberration: controls.aberration,
    threshold: controls.threshold,
    particleGain: controls.particleGain,
    palette: controls.palette,
    trace: controls.trace,
    trackingTiles: controls.trackingTiles,
    standardControls,
    sceneOpen: !scenePanel.hidden,
    entryHidden: entry.dataset.hidden === 'true',
    cameraActive: Boolean(tracking?.getFrame?.()?.camera?.active),
    cameraDeviceId: preferredCameraDeviceId,
  };
}

function restorePerformanceState() {
  let saved = null;
  try {
    const raw = sessionStorage.getItem(UPDATE_STATE_KEY);
    if (raw) saved = JSON.parse(raw);
    sessionStorage.removeItem(UPDATE_STATE_KEY);
  } catch {
    saved = null;
  }
  if (!saved || ![1, 2, 3].includes(saved.version)) return null;

  controls.mode = Math.max(0, Math.min(MODES.length - 1, Math.round(Number(saved.mode) || 0)));
  controls.paused = Boolean(saved.paused);
  controls.hud = saved.hud !== false;
  controls.debug = Boolean(saved.debug);
  controls.mirrored = saved.mirrored !== false;
  controls.intensity = clamp(Number(saved.intensity));
  controls.feedback = clamp(Number(saved.feedback), 0.72, 0.995);
  controls.bloom = clamp(Number(saved.bloom), 0, CONFIG.calibration.safeBloomMax);
  controls.aberration = clamp(Number(saved.aberration));
  controls.threshold = clamp(Number(saved.threshold));
  controls.particleGain = clamp(Number(saved.particleGain));
  controls.palette = ((Math.round(Number(saved.palette) || 0) % PALETTES.length) + PALETTES.length) % PALETTES.length;
  controls.trace = saved.trace !== false;
  controls.trackingTiles = saved.trackingTiles !== false;
  const restoredStandard = saved.version === 2 && saved.standardControls
    ? saved.standardControls
    : saved;
  standardControls = {
    intensity: clamp(Number(restoredStandard.intensity)),
    feedback: clamp(Number(restoredStandard.feedback), 0.72, 0.995),
    bloom: clamp(Number(restoredStandard.bloom), 0, CONFIG.calibration.safeBloomMax),
    aberration: clamp(Number(restoredStandard.aberration)),
    threshold: clamp(Number(restoredStandard.threshold)),
    particleGain: clamp(Number(restoredStandard.particleGain)),
    palette: ((Math.round(Number(restoredStandard.palette) || 0) % PALETTES.length) + PALETTES.length) % PALETTES.length,
  };
  return saved;
}

function queueBuildUpdate(stamp) {
  const nextStamp = String(stamp || 'new source');
  if (pendingBuildStamp === nextStamp) return;
  pendingBuildStamp = nextStamp;
  updateNotice.hidden = false;
  updateNotice.dataset.applying = 'false';
  updateStamp.textContent = `build ${nextStamp} · current stage remains live`;
  document.documentElement.dataset.update = 'pending';
  setStatus('new build available · press U to apply after the scene');
}

function deferBuildUpdate() {
  if (!pendingBuildStamp) return;
  updateNotice.hidden = true;
  setStatus('build deferred · current stage remains live · U applies later');
}

function applyBuildUpdate() {
  if (!pendingBuildStamp) return;
  if (performanceRecorder?.getState?.().active) {
    setStatus('finish the local capture before applying a build');
    return;
  }
  try {
    sessionStorage.setItem(UPDATE_STATE_KEY, JSON.stringify(performanceSnapshot()));
  } catch {
    // Reload still works when storage is unavailable; only state restore is skipped.
  }
  updateNotice.hidden = false;
  updateNotice.dataset.applying = 'true';
  updateStamp.textContent = `applying build ${pendingBuildStamp}`;
  document.documentElement.dataset.update = 'applying';
  setStatus(`applying build ${pendingBuildStamp}`);
  window.setTimeout(() => location.reload(), 60);
}

function calibrationValues() {
  const black = controls.threshold * CONFIG.calibration.blackPointMax;
  const white = CONFIG.calibration.whitePointMin
    + controls.intensity * (1 - CONFIG.calibration.whitePointMin);
  const bloom = Math.min(controls.bloom, CONFIG.calibration.safeBloomMax);
  return { black, white, bloom };
}

function calibrationPercent(value) {
  return `${(clamp(value) * 100).toFixed(1).padStart(5, '0')}%`;
}

function updateCalibrationSurface() {
  const values = calibrationValues();
  calibrationPanel.hidden = !calibrationState.active;
  calibrationPanel.dataset.mirrored = String(controls.mirrored);
  calibrationBlack.textContent = calibrationPercent(values.black);
  calibrationWhite.textContent = calibrationPercent(values.white);
  calibrationBloom.textContent = calibrationPercent(values.bloom);
  calibrationMirror.textContent = controls.mirrored ? 'MIRRORED' : 'NORMAL';
  for (const row of calibrationPanel.querySelectorAll('[data-calibration-param]')) {
    row.dataset.selected = String(
      calibrationState.active
      && row.dataset.calibrationParam === calibrationParams[calibrationState.selected],
    );
  }
  glCanvas.dataset.calibration = String(calibrationState.active);
  overlayCanvas.style.visibility = calibrationState.active ? 'hidden' : '';
  document.body.dataset.calibration = String(calibrationState.active);
  setButtonState('calibration', calibrationState.active);
}

function setCalibration(active) {
  const wasActive = calibrationState.active;
  calibrationState.active = Boolean(active);
  controls.bloom = Math.min(controls.bloom, CONFIG.calibration.safeBloomMax);
  if (wasActive && !calibrationState.active) resizeQueued = true;
  updateCalibrationSurface();
  setStatus(calibrationState.active
    ? 'projector calibration · Tab select · [ ] adjust · M mirror'
    : 'projector calibration closed · field live');
}

function toggleCalibration() {
  const active = !calibrationState.active;
  if (active && !entityPanel.hidden) setEntityConsole(false);
  if (active && !samplerPanel.hidden) setSamplerConsole(false);
  if (active && !framePanel.hidden) setFrameConsole(false);
  if (active && !scenePanel.hidden) setSceneConsole(false);
  if (active && !musicPanel.hidden) setMusicConsole(false);
  if (active && !patchPanel.hidden) setPatchConsole(false);
  if (active && !capturePanel.hidden) setCaptureConsole(false);
  setCalibration(active);
}

function toggleMirror() {
  controls.mirrored = tracking.toggleMirror?.() ?? !controls.mirrored;
  frameZones.reset(frameZoneClock);
  frameZoneState = null;
  updateCalibrationSurface();
  setStatus(`mirror · ${controls.mirrored ? 'on' : 'off'}`);
}

function toggleTrace() {
  controls.trace = !controls.trace;
  updateTraceButton();
  overlayCanvas.dataset.trace = String(controls.trace);
  setStatus(`tracking trace · ${controls.trace ? 'on' : 'off'} · tracking remains live`);
}

function toggleTrackingTiles() {
  controls.trackingTiles = !controls.trackingTiles;
  updateTrackingTilesButton();
  overlayCanvas.dataset.trackingTiles = String(controls.trackingTiles);
  setStatus(`tracking tiles · ${controls.trackingTiles ? 'on' : 'off'} · anchors stay live`);
}

function updateTraceButton() {
  setButtonState('trace', controls.trace);
  const button = controlsBar.querySelector('[data-action="trace"]');
  if (button?.firstChild) button.firstChild.textContent = `trace ${controls.trace ? 'on' : 'off'} `;
}

function updateTrackingTilesButton() {
  setButtonState('tiles', controls.trackingTiles);
  const button = controlsBar.querySelector('[data-action="tiles"]');
  if (button?.firstChild) button.firstChild.textContent = `tiles ${controls.trackingTiles ? 'on' : 'off'} `;
}

function adjustCalibration(direction) {
  const delta = Math.sign(direction) * CONFIG.calibration.step;
  const selected = calibrationParams[calibrationState.selected];
  if (selected === 'black') setLiveControl('threshold', clamp(controls.threshold + delta));
  if (selected === 'white') setLiveControl('intensity', clamp(controls.intensity + delta));
  if (selected === 'bloom') {
    setLiveControl('bloom', clamp(controls.bloom + delta, 0, CONFIG.calibration.safeBloomMax));
  }
  if (selected === 'mirror') toggleMirror();
  else {
    updateCalibrationSurface();
    const value = calibrationValues()[selected];
    setStatus(`calibration ${selected} · ${calibrationPercent(value)}`);
  }
}

function setLiveControl(name, value) {
  controls[name] = value;
  persistControlPatch({ [name]: value });
  if (calibrationState.active) updateCalibrationSurface();
}

function nudgeLiveControl(name, delta, min = 0, max = 1) {
  const value = clamp((Number(controls[name]) || 0) + delta, min, max);
  setLiveControl(name, value);
  setStatus(`${name} · ${Math.round(value * 100)}%`);
}

function onAudioEvent(event = {}) {
  music?.handleMidiEvent?.(event);
  if (event.type === 'note') queuePerformancePatchEvent(PATCH_EVENT_IDS[0], 'note', event.velocity ?? 1);
  if (!musicPanel.hidden) renderMusicSurface();
  if (event.type === 'panic') controls.pointer.down = false;
  updateInputRitual();
}

tracking = createTrackingEngine({
  video,
  config: CONFIG,
  onStatus: (status) => {
    if (status && typeof status === 'object') latestTrackingStatus = status;
    if (status?.message) setStatus(status.message);
    else if (typeof status === 'string') setStatus(status);
    const active = Boolean(status?.active ?? tracking?.getFrame?.()?.camera?.active);
    setButtonState('camera', active);
    updateInputRitual();
  },
});

audioMidi = createAudioMidiEngine({
  config: CONFIG,
  onStatus: (status) => {
    if (status?.source === 'mic' || status?.source === 'midi') {
      latestAudioStatus[status.source] = {
        state: String(status.state || 'standby'),
        message: String(status.message || status.state || 'standby'),
      };
    }
    if (status?.message) setStatus(status.message);
    else if (typeof status === 'string') setStatus(status);
    const frame = audioMidi?.getFrame?.();
    setButtonState('audio', Boolean(frame?.micActive));
    setButtonState('midi', Boolean(frame?.midiActive));
    updateInputRitual();
    if (!musicPanel.hidden && music) renderMusicSurface();
  },
  onEvent: onAudioEvent,
});

let renderer;
try {
  renderer = createRenderer({ canvas: glCanvas, video, config: CONFIG, onStatus: setStatus });
} catch (error) {
  setStatus(`renderer error · ${error.message}`);
  renderer = {
    resize() {}, setMode() {}, render() {}, destroy() {},
    getStats: () => ({ fps: 0, error: error.message }),
  };
}
const overlay = createOverlay({ canvas: overlayCanvas, video, feedbackCanvas: glCanvas, config: CONFIG });
gestureConfigurator = createGestureConfigurator({
  defaults: CONFIG.gestureFrame,
  storage: globalThis.localStorage,
  storageKey: CONFIG.gestureFrame.storageKey,
});
let gestureFrame = createGestureFrame({
  config: { gestureFrame: { ...CONFIG.gestureFrame, ...gestureConfigurator.getState() } },
});
const frameContent = createFrameContentController({ settings: CONFIG.frameContent });
const frameObjectCrop = createFrameObjectCrop({
  holdMs: CONFIG.frameContent.objectCropHoldMs,
  minScore: CONFIG.tracking.minObjectScore,
  padding: CONFIG.frameContent.objectCropPadding,
  focus: CONFIG.frameContent.focus,
});
frameConfigurator = createFrameConfigurator({
  defaults: CONFIG.frameContent,
  storage: globalThis.localStorage,
  storageKey: CONFIG.frameContent.storageKey,
});
frameZoneConfigurator = createFrameZoneConfigurator({
  defaults: CONFIG.frameZones,
  storage: globalThis.localStorage,
  storageKey: CONFIG.frameZones.storageKey,
});
sceneConfigurator = createSceneConfigurator({
  config: CONFIG,
  storage: globalThis.localStorage,
  storageKey: CONFIG.sceneConfigurator.storageKey,
});
const frameZones = createFrameZoneEvents({ config: CONFIG });
const entityConsole = createEntityConsole({
  root: entityPanel,
  config: CONFIG,
  onStatus: setStatus,
  onSettings: (settings) => {
    latestEntitySettings = settings;
    const hands = settings?.settings?.hands || CONFIG.entities.sources.hands;
    performanceRouteSettings.settings.hands.enabled = hands.enabled !== false;
    performanceRouteSettings.settings.hands.overlay = Math.max(
      Number(hands.overlay) || 0,
      Number(hands.sound) || 0,
    );
    performanceRouteSettings.settings.hands.sound = Number(hands.sound) || 0;
    updatePerformanceMappingSurface(performance.now(), true);
  },
});
const entityUpdateFrame = { time: 0, tracking: emptyTracking, audio: emptyAudio, controls };
const samplerSession = createSamplerSession();
voiceMemory = createVoiceMemory({
  config: CONFIG,
  routeMediaElement: samplerSession.routeMediaElement,
  onStatus: (status) => {
    if (narrativeMemoryStatus) {
      narrativeMemoryStatus.textContent = status?.lastEvent || status?.message || 'voice memory ready';
    }
    if (!narrativePanel.hidden) renderVoiceMemorySurface();
  },
});
performanceRecorder = createPerformanceRecorder({
  config: CONFIG,
  environment: globalThis,
  onState: (state) => {
    if (!state.active) stopCaptureStream();
    if (!capturePanel.hidden) renderCaptureSurface();
    if (state.status === 'unsupported' || state.status === 'error') setStatus(`capture · ${state.error || state.status}`);
  },
});
performancePatchHost = createPerformancePatchHost({
  config: CONFIG,
  onState: (state) => {
    if (!patchPanel.hidden) renderPatchSurface();
    if (state.status === 'faulted') setStatus(`patch fault · ${state.reason}`);
  },
});
music = createMusicEngine({
  config: CONFIG,
  getAudioContext: samplerSession.getAudioContext,
  getOutputDestination: samplerSession.getOutputDestination,
  onStatus: (status) => {
    if (status?.message) setStatus(status.message);
    if (!musicPanel.hidden) renderMusicSurface();
    updateInputRitual();
  },
});
try {
  sampler = createSamplerEngine({
    config: CONFIG,
    getAudioContext: samplerSession.getAudioContext,
    getOutputDestination: samplerSession.getOutputDestination,
    getMicStream: samplerSession.getMicStream,
    IndexedDB: globalThis.indexedDB,
    MediaRecorder: globalThis.MediaRecorder,
    onStatus: handleSamplerStatus,
  });
} catch (error) {
  latestSamplerStatus = { state: 'unavailable', message: `sampler unavailable · ${error.message}` };
  sampler = createUnavailableSampler(error);
}
performanceMapper = createPerformanceMapper({ config: CONFIG });

function framePercent(value) {
  return `${Math.round(clamp(Number(value) || 0) * 100)}%`;
}

function renderFrameSurface(settings = frameConfigurator.getState()) {
  const gestureSettings = gestureConfigurator.getState();
  const zoneSettings = frameZoneConfigurator.getState();
  frameContentMode = settings.mode;
  framePanel.dataset.mode = settings.mode;
  framePanel.dataset.soundRoute = String(settings.soundRoute);
  framePanel.dataset.visualRoute = String(settings.visualRoute);
  framePanel.dataset.soundEvents = String(frameSoundEvents);
  framePanel.dataset.zoneEvents = String(frameZoneEvents);
  framePanel.dataset.zoneCount = String(frameZoneState?.zones?.[0]?.memberCount || 0);
  const objectFlow = framePanel.querySelector('[data-frame-object-flow]');
  if (objectFlow) objectFlow.hidden = settings.mode !== 'object';
  for (const button of framePanel.querySelectorAll('[data-frame-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.frameMode === settings.mode));
  }
  for (const input of framePanel.querySelectorAll('[data-frame-field]')) {
    const key = input.dataset.frameField;
    if (key in settings) input.value = String(settings[key]);
    const visibleModes = {
      prompt: ['prompt-shader'], seed: ['prompt-shader'],
      objectClass: ['object'], fit: ['object'], focusSource: ['object'], focusDetail: ['object'],
    }[key];
    const label = input.closest('label');
    if (!label) continue;
    if (visibleModes) label.hidden = !visibleModes.includes(settings.mode);
    if (key === 'objectClass') label.hidden = settings.mode !== 'object' || settings.focusSource !== 'object';
    if (key === 'focusDetail') label.hidden = settings.mode !== 'object' || settings.focusSource !== 'face';
  }
  framePanel.querySelector('.frame-console__exercise').hidden = settings.mode !== 'exercise-target';
  for (const input of framePanel.querySelectorAll('[data-frame-exercise]')) {
    const key = input.dataset.frameExercise;
    if (key in settings.exerciseRule) input.value = String(settings.exerciseRule[key]);
  }
  for (const input of framePanel.querySelectorAll('[data-gesture-field]')) {
    const key = input.dataset.gestureField;
    if (key in gestureSettings) input.value = String(gestureSettings[key]);
  }
  for (const input of framePanel.querySelectorAll('[data-frame-zone]')) {
    const key = input.dataset.frameZone;
    if (key in zoneSettings) input.value = String(zoneSettings[key]);
  }
  const intensity = framePanel.querySelector('[data-frame-output="intensity"]');
  const visual = framePanel.querySelector('[data-frame-output="visualRoute"]');
  const sound = framePanel.querySelector('[data-frame-output="soundRoute"]');
  const tolerance = framePanel.querySelector('[data-frame-output="tolerance"]');
  const zoneOverlap = framePanel.querySelector('[data-frame-output="zoneOverlap"]');
  if (intensity) intensity.textContent = framePercent(settings.intensity);
  if (visual) visual.textContent = framePercent(settings.visualRoute);
  if (sound) sound.textContent = framePercent(settings.soundRoute);
  if (tolerance) tolerance.textContent = framePercent(settings.exerciseRule.tolerance);
  if (zoneOverlap) zoneOverlap.textContent = framePercent(zoneSettings.minOverlap);
  const routeState = settings.soundRoute > 0
    ? selectedGestureClipId
      ? `${frameSoundEvents} event · ${selectedGestureClipLabel || 'mapped clip'}`
      : 'sound route set · map a clip in S'
    : 'exact silence';
  const phase = gestureFrameState?.phase || 'searching';
  const objectCrop = frameObjectCropState;
  const focusName = objectCrop?.sourceKind === 'pose'
    ? 'person'
    : objectCrop?.sourceKind === 'face'
      ? objectCrop.focusDetail === 'face-edge' ? 'face edge' : 'face'
      : objectCrop?.objectClass || 'object';
  const objectState = objectCrop?.active
    ? `${focusName} · ${objectCrop.held ? 'held' : 'live'} · ${Math.round((objectCrop.score || 0) * 100)}% · ${objectCrop.mirrored ? 'mirrored' : 'camera direct'}`
    : `waiting for ${settings.focusSource || 'person'} · ${settings.focusDetail || 'whole'}`;
  const focusHelp = framePanel.querySelector('[data-frame-focus-state]');
  if (focusHelp) focusHelp.textContent = objectState;
  const recipe = frameContent.getState?.()?.runtime?.recipe;
  const recipeOutput = framePanel.querySelector('[data-frame-recipe-output]');
  if (recipeOutput && recipe) {
    recipeOutput.textContent = `${recipe.subject} · ${recipe.palette} · ${recipe.motion?.spin > 0.2 ? 'spin' : recipe.motion?.pulse > 0.2 ? 'pulse' : 'drift'} · ${recipe.texture} · seed ${settings.seed}`;
  }
  const generator = framePanel.querySelector('[data-frame-generator]');
  if (generator) generator.hidden = settings.mode !== 'prompt-shader';
  const generatorOutput = framePanel.querySelector('[data-frame-generator-status]');
  if (generatorOutput) generatorOutput.textContent = generatedFrameBackground.state;
  const phaseHelp = {
    searching: 'show both hands',
    arming: 'hold the rectangle',
    live: 'move to update',
    frozen: 'content locked · move to apply changes',
    fading: 'stillness is hiding content',
    off: 'move hands to wake',
  }[phase] || 'show both hands';
  frameStatusOutput.textContent = `${phase} · ${phaseHelp} · ${settings.mode} · ${routeState}`;
}

function applyFrameSettings(settings) {
  frameContentMode = settings.mode;
  gestureFrame.setMode(settings.mode);
  frameContent.configure(settings);
  renderFrameSurface(settings);
}

function applyGestureSettings(settings) {
  gestureFrame.destroy();
  gestureFrame = createGestureFrame({
    config: { gestureFrame: { ...CONFIG.gestureFrame, ...settings, mode: frameContentMode } },
  });
  gestureFrameState = null;
  frameContent.reset();
  frameObjectCrop.reset();
  frameZones.reset(frameZoneClock);
  frameZoneState = null;
  renderFrameSurface();
  setStatus(`frame timing · ${settings.freezeMs}/${settings.fadeMs}/${settings.offMs} ms`);
}

frameConfigurator.subscribe(applyFrameSettings);
gestureConfigurator.subscribe(applyGestureSettings);
frameZoneConfigurator.subscribe((settings) => {
  frameZones.configure(settings);
  renderFrameSurface();
});
frameZones.configure(frameZoneConfigurator.getState());
applyFrameSettings(frameConfigurator.getState());

function cycleFrameContentMode() {
  const index = CONTENT_MODES.indexOf(frameContentMode);
  const next = CONTENT_MODES[(index + 1) % CONTENT_MODES.length];
  frameConfigurator.configure({ mode: next });
  setStatus(`two-hand frame · ${next}`);
}

function resolveExercisePoint(trackingFrame) {
  const pose = trackingFrame?.poses?.[0];
  const source = frameConfigurator.getState().exerciseRule.source;
  if (pose?.landmarks) {
    if (source === 'left-wrist') return pose.landmarks[15] || null;
    if (source === 'right-wrist') return pose.landmarks[16] || null;
    if (source === 'left-index') return pose.landmarks[19] || null;
    if (source === 'right-index') return pose.landmarks[20] || null;
  }
  return null;
}

function isSceneMode(mode = controls.mode) {
  return CONFIG.sceneConfigurator.modes.includes(Number(mode));
}

function paletteIndex(name) {
  const index = PALETTES.findIndex((palette) => palette.name === name);
  return index >= 0 ? index : 0;
}

function captureStandardControls() {
  standardControls = {
    ...Object.fromEntries(SCENE_RENDER_KEYS.map((key) => [key, controls[key]])),
    palette: controls.palette,
  };
}

function restoreStandardControls() {
  for (const key of SCENE_RENDER_KEYS) controls[key] = standardControls[key];
  controls.palette = standardControls.palette;
  controls.scene = null;
}

const SCENE_FIELD_CONTEXT = Object.freeze({
  0: Object.freeze({
    intensity: 'intensity',
    feedback: 'trace hold',
    bloom: 'bloom',
    aberration: 'edge split',
    threshold: 'camera threshold',
    particleGain: 'particles',
    fieldFloor: 'light floor',
    bodyReveal: null,
    voidCoverage: 'inversion field',
    centering: null,
    warmth: 'oxide heat',
    density: 'trace density',
  }),
  3: Object.freeze({
    intensity: 'intensity',
    feedback: 'feedback',
    bloom: 'bloom',
    aberration: 'aberration',
    threshold: 'threshold',
    particleGain: 'particles',
    fieldFloor: 'field floor',
    bodyReveal: 'body clarity',
    voidCoverage: 'portal field',
    centering: null,
    warmth: 'accent heat',
    density: 'grain density',
  }),
  4: Object.freeze({
    intensity: 'intensity',
    feedback: 'feedback',
    bloom: 'bloom',
    aberration: 'aberration',
    threshold: 'threshold',
    particleGain: 'particles',
    fieldFloor: 'memory floor',
    bodyReveal: 'body clarity',
    voidCoverage: null,
    centering: 'body centre',
    warmth: 'accent heat',
    density: 'memory density',
  }),
});

function renderSceneFieldContext(mode) {
  const labels = SCENE_FIELD_CONTEXT[Number(mode)] || {};
  for (const input of scenePanel.querySelectorAll('[data-scene-field]')) {
    const key = input.dataset.sceneField;
    const label = input.closest('label');
    const labelText = label?.querySelector(`[data-scene-field-label="${key}"]`);
    const title = labels[key];
    if (label) label.hidden = !title;
    if (labelText && title) {
      const output = labelText.querySelector('output');
      labelText.replaceChildren(document.createTextNode(`${title} `), output);
    }
  }
}

function renderSceneSurface(settings = sceneConfigurator.getModeSettings(controls.mode)) {
  if (!settings) {
    scenePanel.dataset.mode = String(controls.mode);
    sceneStatusOutput.textContent = `mode ${controls.mode + 1} · tune is active on modes 1 + 4 + 5`;
    return;
  }
  scenePanel.dataset.mode = String(controls.mode);
  scenePanel.dataset.preset = settings.preset;
  for (const button of scenePanel.querySelectorAll('[data-scene-preset]')) {
    button.setAttribute('aria-pressed', String(button.dataset.scenePreset === settings.preset));
  }
  for (const input of scenePanel.querySelectorAll('[data-scene-field]')) {
    const key = input.dataset.sceneField;
    if (key in settings) input.value = String(settings[key]);
  }
  for (const output of scenePanel.querySelectorAll('[data-scene-output]')) {
    const key = output.dataset.sceneOutput;
    if (key in settings) output.textContent = `${Math.round(settings[key] * 100)}%`;
  }
  const guideTitle = scenePanel.querySelector('[data-scene-guide-title]');
  const guideCopy = scenePanel.querySelector('[data-scene-guide-copy]');
  if (Number(controls.mode) === 0) {
    if (guideTitle) guideTitle.textContent = '1 · MYTH TRACE';
    if (guideCopy) guideCopy.textContent = 'lift the light floor and reduce inversion field for a fuller hand-readable image.';
  } else if (Number(controls.mode) === 3) {
    if (guideTitle) guideTitle.textContent = '4 · SHAPER FIELD';
    if (guideCopy) guideCopy.textContent = 'cold contour · clear body · focus field follows hands and face. Start here for projection.';
  } else {
    if (guideTitle) guideTitle.textContent = '5 · COLD MEMORY';
    if (guideCopy) guideCopy.textContent = 'body stays centred · slow rings preserve a cold trace · memory density fills the room.';
  }
  renderSceneFieldContext(controls.mode);
  sceneStatusOutput.textContent = `mode ${controls.mode + 1} · ${settings.preset} · ${settings.palette}`;
}

function applySceneSettings(settings, mode = controls.mode) {
  if (!settings || !isSceneMode(mode)) return;
  controls.scene = { mode: Number(mode), ...settings };
  for (const key of SCENE_RENDER_KEYS) controls[key] = settings[key];
  controls.palette = paletteIndex(settings.palette);
  if (Number(mode) === controls.mode) renderSceneSurface(settings);
  if (calibrationState.active) updateCalibrationSurface();
}

function persistControlPatch(patch) {
  if (isSceneMode()) {
    sceneConfigurator.configure(controls.mode, patch);
  } else {
    Object.assign(standardControls, patch);
  }
}

function setMode(index) {
  const previousMode = controls.mode;
  const nextMode = ((Number(index) % MODES.length) + MODES.length) % MODES.length;
  if (!isSceneMode(previousMode) && isSceneMode(nextMode)) captureStandardControls();
  if (isSceneMode(previousMode) && !isSceneMode(nextMode)) restoreStandardControls();
  controls.mode = nextMode;
  if (isSceneMode(nextMode)) applySceneSettings(sceneConfigurator.getModeSettings(nextMode), nextMode);
  else controls.scene = null;
  renderer.setMode?.(controls.mode);
  for (const button of modeButtons) {
    const current = Number(button.dataset.mode) === controls.mode;
    button.dataset.on = String(current);
    button.setAttribute('aria-pressed', String(current));
  }
  stageMode.textContent = `${String(controls.mode + 1).padStart(2, '0')} · ${MODES[controls.mode].name.toLowerCase()}`;
  renderSceneSurface();
  setStatus(`${MODES[controls.mode].name.toLowerCase()} · mode ${controls.mode + 1}`);
}

sceneConfigurator.subscribe((_state, changedMode) => {
  if (changedMode === null || Number(changedMode) === controls.mode) {
    applySceneSettings(sceneConfigurator.getModeSettings(controls.mode));
  }
  renderSceneSurface();
});

function displayedTracking(frame, dt) {
  if (frame?.anchors?.length) return frame;
  pointerAnchor.velocityX = (controls.pointer.x - lastPointerX) / Math.max(dt, 1 / 120);
  pointerAnchor.velocityY = (controls.pointer.y - lastPointerY) / Math.max(dt, 1 / 120);
  pointerAnchor.x = controls.pointer.x;
  pointerAnchor.y = controls.pointer.y;
  pointerAnchor.strength = controls.pointer.down ? 1 : 0.42;
  lastPointerX = controls.pointer.x;
  lastPointerY = controls.pointer.y;
  fallbackTracking.ts = frame?.ts || performance.now();
  fallbackTracking.ready = Boolean(frame?.ready);
  fallbackTracking.camera = frame?.camera || fallbackTracking.camera;
  fallbackTracking.hands = frame?.hands || [];
  fallbackTracking.poses = frame?.poses || [];
  fallbackTracking.faces = frame?.faces || [];
  fallbackTracking.objects = frame?.objects || [];
  fallbackTracking.metrics.motion = clamp(Math.hypot(pointerAnchor.velocityX, pointerAnchor.velocityY) * 0.018);
  fallbackTracking.status = frame?.status === 'error' ? 'fallback' : (frame?.status || 'fallback');
  return fallbackTracking;
}

const focusCandidates = [];

function normalizedFocusClass(value) {
  return String(value || '').trim().toLowerCase();
}

function pushFocusCandidate(candidate, sourceKind, label, count) {
  const id = String(candidate?.id || '').trim();
  const bbox = candidate?.bbox;
  if (!id || !bbox) return count;
  const slot = focusCandidates[count] || {
    id: '', label: '', sourceKind: 'object', score: 0, bbox: null, lastSeen: 0,
  };
  slot.id = id;
  slot.label = label;
  slot.sourceKind = sourceKind;
  slot.score = Number(candidate?.score) || 0;
  slot.bbox = bbox;
  slot.lastSeen = Number(candidate?.lastSeen) || 0;
  focusCandidates[count] = slot;
  return count + 1;
}

function collectFocusCandidates(tracking, content) {
  let count = 0;
  const poses = Array.isArray(tracking?.poses) ? tracking.poses : [];
  const faces = Array.isArray(tracking?.faces) ? tracking.faces : [];
  const objects = Array.isArray(tracking?.objects) ? tracking.objects : [];
  for (let index = 0; index < poses.length; index += 1) {
    count = pushFocusCandidate(poses[index], 'pose', 'person', count);
  }
  for (let index = 0; index < faces.length; index += 1) {
    count = pushFocusCandidate(faces[index], 'face', 'face', count);
  }
  const filter = content?.focusSource === 'object'
    ? normalizedFocusClass(content?.objectClass)
    : '';
  for (let index = 0; index < objects.length; index += 1) {
    const object = objects[index];
    const label = String(object?.label || '').trim();
    if (filter && normalizedFocusClass(label) !== filter) continue;
    count = pushFocusCandidate(object, 'object', label || 'object', count);
  }
  focusCandidates.length = count;
  return focusCandidates;
}

function updateEntityConsole(time, frame) {
  if (entityPanel.hidden) return;
  entityUpdateFrame.time = time;
  entityUpdateFrame.tracking = frame;
  entityUpdateFrame.audio = audioFrame;
  entityConsole.update(entityUpdateFrame);
}

function setEntityConsole(active) {
  const open = Boolean(active);
  if (open && calibrationState.active) setCalibration(false);
  if (open && !narrativePanel.hidden) setNarrativeConsole(false);
  if (open && !samplerPanel.hidden) setSamplerConsole(false);
  if (open && !framePanel.hidden) setFrameConsole(false);
  if (open && !scenePanel.hidden) setSceneConsole(false);
  if (open && !musicPanel.hidden) setMusicConsole(false);
  if (open && !patchPanel.hidden) setPatchConsole(false);
  if (open && !capturePanel.hidden) setCaptureConsole(false);
  entityConsole.setOpen(open);
  setButtonState('entities', open);
}

function toggleEntityConsole() {
  setEntityConsole(entityPanel.hidden);
}

function createUnavailableSampler(error) {
  const state = Object.freeze({
    armed: false, recording: false, destroyed: false, silent: true, masterGain: 0,
    clipCount: 0, totalBytes: 0, decodedCount: 0, activeVoices: 0, queuedEvents: 0,
    lastEventAt: null, range: Object.freeze({ filterHz: 0, delaySend: 0, playbackRate: 1 }),
    error: error?.message || 'sampler unavailable',
  });
  return Object.freeze({
    arm: async () => false,
    loadClips: async () => [],
    listClips: () => Object.freeze([]),
    startRecording: async () => false,
    stopRecording: async () => null,
    toggleRecording: async () => false,
    renameClip: async () => false,
    deleteClip: async () => false,
    trigger: async () => false,
    updateRanges: () => false,
    panic: () => state,
    getState: () => state,
    destroy: () => {},
  });
}

function formatMegabytes(bytes) {
  return `${(Math.max(0, Number(bytes) || 0) / (1024 * 1024)).toFixed(1)} MB`;
}

function updatePerformanceMappingSurface(time = performance.now(), force = false) {
  if (!force && (samplerPanel.hidden || time - lastMappingSurfaceAt < CONFIG.entities.consoleRateMs)) return;
  lastMappingSurfaceAt = time;
  const handsRoute = latestEntitySettings?.settings?.hands || CONFIG.entities.sources.hands;
  const selected = selectedGestureClipId.length > 0;
  const soundReady = handsRoute.enabled !== false && Number(handsRoute.sound) > 0;
  samplerPanel.dataset.mappingClipId = selectedGestureClipId;
  samplerPanel.dataset.mappingArmed = String(samplerArmed);
  samplerPanel.dataset.mappingSoundRoute = String(Number(handsRoute.sound) || 0);
  samplerPanel.dataset.mappingEvents = String(mappingRuntime.events);
  samplerPanel.dataset.mappingRanges = String(mappingRuntime.ranges);
  samplerPanel.dataset.mappingFilter = mappingRuntime.filter.toFixed(3);
  samplerPanel.dataset.mappingDelay = mappingRuntime.delaySend.toFixed(3);
  samplerPanel.dataset.mappingRate = mappingRuntime.playbackRate.toFixed(2);
  if (!selected) samplerMappingOutput.textContent = 'unassigned · exact silence';
  else if (!samplerLibraryLoaded) samplerMappingOutput.textContent = 'restoring local target';
  else if (!samplerArmed) samplerMappingOutput.textContent = `${selectedGestureClipLabel} · arm sound`;
  else if (!soundReady) samplerMappingOutput.textContent = `${selectedGestureClipLabel} · raise E / hands sound`;
  else {
    samplerMappingOutput.textContent = `${selectedGestureClipLabel} · ${mappingRuntime.events} event · ${mappingRuntime.ranges} range`;
  }
}

function reconcilePerformanceMapping(clips) {
  const selected = clips.find((clip) => clip.id === selectedGestureClipId);
  if (selected) selectedGestureClipLabel = selected.label;
  else if (samplerLibraryLoaded && selectedGestureClipId) {
    selectedGestureClipId = '';
    selectedGestureClipLabel = '';
    persistPerformanceMappingState();
  }
}

function setGestureClip(clipId) {
  const nextId = String(clipId || '');
  selectedGestureClipId = selectedGestureClipId === nextId ? '' : nextId;
  selectedGestureClipLabel = sampler.listClips().find((clip) => clip.id === selectedGestureClipId)?.label || '';
  persistPerformanceMappingState();
  renderSamplerSurface();
  renderFrameSurface();
  setStatus(selectedGestureClipId
    ? `hand map · pinch triggers ${selectedGestureClipLabel}`
    : 'hand map cleared · exact silence');
}

function resetPerformanceMapping() {
  performanceMapper?.reset();
  mappingRuntime.events = 0;
  mappingRuntime.ranges = 0;
  mappingRuntime.filter = 0;
  mappingRuntime.delaySend = 0;
  mappingRuntime.playbackRate = 1;
  updatePerformanceMappingSurface(performance.now(), true);
}

function updatePerformanceMapping(time, frame) {
  performanceMappingInput.timestamp = time;
  performanceMappingInput.tracking = frame;
  performanceMappingInput.entitySettings = performanceRouteSettings;
  performanceMappingInput.armed = samplerArmed;
  performanceMappingInput.selectedClipId = selectedGestureClipId;
  const output = performanceMapper.update(performanceMappingInput);
  for (let index = 0; index < output.sampler.length; index += 1) {
    const intent = output.sampler[index];
    if (intent.kind === 'event') {
      mappingRuntime.events += 1;
      void sampler.trigger(intent);
      continue;
    }
    const values = intent.values;
    samplerRangeInput.filter = values.filter;
    samplerRangeInput.delaySend = clamp(
      values.delaySend * CONFIG.performanceMapping.spreadMix
        + values.density * CONFIG.performanceMapping.densityMix,
    );
    samplerRangeInput.playbackRate = clamp(
      values.playbackRate * CONFIG.performanceMapping.palmRateMix
        + values.density * CONFIG.performanceMapping.densityRateMix,
    );
    if (!sampler.updateRanges(samplerRangeInput, intent.timestamp)) continue;
    mappingRuntime.ranges += 1;
    mappingRuntime.filter = samplerRangeInput.filter;
    mappingRuntime.delaySend = samplerRangeInput.delaySend;
    mappingRuntime.playbackRate = values.rateSuggestion;
  }
  const handRoute = latestEntitySettings?.settings?.hands?.sound
    ?? CONFIG.entities.sources.hands.sound;
  musicUpdateInput.timestamp = time;
  musicUpdateInput.handRoute = handRoute;
  musicUpdateInput.framePhase = gestureFrameState?.phase || 'searching';
  musicUpdateInput.event = null;
  musicUpdateInput.range = null;
  music.update(musicUpdateInput);
  for (let index = 0; index < output.music.length; index += 1) {
    const intent = output.music[index];
    if (intent.kind !== 'range') continue;
    const values = intent.values;
    musicUpdateInput.range = values;
    gestureMusicRuntime.openness = clamp(values.openness);
    gestureMusicRuntime.spread = clamp(values.spread);
    gestureMusicRuntime.curl = Math.max(
      clamp(values.curls?.thumb), clamp(values.curls?.index), clamp(values.curls?.middle),
      clamp(values.curls?.ring), clamp(values.curls?.pinky),
    );
    gestureMusicRuntime.motion = clamp(values.velocity?.magnitude);
    gestureMusicRuntime.harmony = clamp(values.chordWidth + gestureMusicRuntime.motion * CONFIG.music.motionHarmonyMix);
    music.update(musicUpdateInput);
  }
  musicUpdateInput.range = null;
  for (let index = 0; index < output.music.length; index += 1) {
    const intent = output.music[index];
    if (intent.kind !== 'event') continue;
    musicUpdateInput.event = intent;
    gestureMusicRuntime.events += 1;
    gestureMusicRuntime.pinch = clamp(intent.strength);
    queuePerformancePatchEvent(PATCH_EVENT_IDS[2], 'pinch', intent.strength);
    music.update(musicUpdateInput);
  }
  musicUpdateInput.event = null;
  if (!musicPanel.hidden && time - lastMusicSurfaceAt >= CONFIG.entities.consoleRateMs) {
    lastMusicSurfaceAt = time;
    renderMusicSurface();
  }
  updatePerformanceMappingSurface(time);
}

function routeFrameEvent(event, soundRoute) {
  const type = String(event?.type || '');
  const baseVelocity = CONFIG.frameContent.eventVelocity[type];
  if (!Number.isFinite(baseVelocity)) return;
  void sampler.trigger({
    kind: 'event',
    edge: true,
    source: 'frame',
    key: `frame:${type}`,
    clipId: selectedGestureClipId,
    timestamp: Number(event?.ts) || performance.now(),
    cooldownMs: CONFIG.frameContent.eventCooldownMs,
    velocity: clamp(baseVelocity * soundRoute),
  }).then((accepted) => {
    if (!accepted) return;
    frameSoundEvents += 1;
    if (!framePanel.hidden) renderFrameSurface();
  });
}

function routeFrameZoneEvent(event, soundRoute) {
  const type = String(event?.type || '');
  const baseVelocity = CONFIG.frameZones.eventVelocity[type];
  if (!Number.isFinite(baseVelocity)) return;
  const sourceKey = event?.source === 'body' ? 'body' : 'objects';
  const sourceRoute = latestEntitySettings?.settings?.[sourceKey]
    || CONFIG.entities.sources[sourceKey];
  if (sourceRoute?.enabled === false || Number(sourceRoute?.sound) <= 0) return;
  const effectiveRoute = clamp(soundRoute * Number(sourceRoute.sound));
  if (effectiveRoute <= 0) return;
  void sampler.trigger({
    kind: 'event',
    edge: true,
    source: `frame-zone:${event.source}`,
    key: `frame-zone:${event.source}:${event.entityId}:${type}`,
    clipId: selectedGestureClipId,
    timestamp: Number(event?.ts) || performance.now(),
    cooldownMs: CONFIG.frameZones.cooldownMs,
    velocity: clamp(baseVelocity * effectiveRoute * (0.6 + 0.4 * clamp(event?.confidence))),
  }).then((accepted) => {
    if (!accepted) return;
    frameZoneEvents += 1;
    if (!framePanel.hidden) renderFrameSurface();
  });
}

function updateFrameSoundEvents() {
  const soundRoute = clamp(frameContentState?.soundRoute);
  if (!samplerArmed || !selectedGestureClipId || soundRoute <= 0) return;
  for (let index = 0; index < (gestureFrameState?.eventCount || 0); index += 1) {
    routeFrameEvent(gestureFrameState.events[index], soundRoute);
  }
  for (let index = 0; index < (frameContentState?.eventCount || 0); index += 1) {
    routeFrameEvent(frameContentState.events[index], soundRoute);
  }
  if (gestureFrameState?.phase !== 'off') {
    for (let index = 0; index < (frameZoneState?.eventCount || 0); index += 1) {
      routeFrameZoneEvent(frameZoneState.events[index], soundRoute);
    }
  }
  if (!framePanel.hidden) renderFrameSurface();
}

function renderSamplerSurface() {
  const state = sampler.getState();
  const clips = sampler.listClips();
  samplerArmed = state.armed;
  reconcilePerformanceMapping(clips);
  samplerPanel.dataset.armed = String(state.armed);
  samplerPanel.dataset.recording = String(state.recording);
  samplerPanel.dataset.silent = String(state.silent);
  samplerPanel.dataset.clipCount = String(state.clipCount);
  samplerArmButton.dataset.on = String(state.armed);
  samplerArmButton.textContent = state.armed ? 'playback ready' : 'start playback';
  const existingSources = new Set(clips.map((clip) => clip.provenance?.sourceUrl).filter(Boolean));
  const nasaMissing = NASA_POCKET_SET.filter((entry) => !existingSources.has(entry.sourceUrl));
  if (samplerNasaButton) {
    samplerNasaButton.disabled = nasaMissing.length === 0;
    samplerNasaButton.textContent = nasaMissing.length === 0
      ? 'nasa pocket set added'
      : `add nasa pocket set · ${nasaMissing.length}`;
  }
  samplerRecordButton.dataset.recording = String(state.recording);
  samplerRecordButton.textContent = state.recording ? 'stop + save' : 'rec / stop';
  samplerStatusOutput.textContent = state.recording
    ? 'recording locally · second REC stops · 9s cap'
    : latestSamplerStatus.message || (state.armed ? 'sampler armed · exact silence' : 'silent · sound disarmed');
  samplerCapacity.textContent = `${clips.length} / ${CONFIG.sampler.maxClips} · ${formatMegabytes(state.totalBytes)} / ${formatMegabytes(CONFIG.sampler.maxBytes)}`;
  samplerList.replaceChildren();
  if (!clips.length) {
    const empty = document.createElement('p');
    empty.textContent = 'no local clips · REC requests mic only when pressed · IMPORT CLIP never requests mic';
    samplerList.append(empty);
    updatePerformanceMappingSurface(performance.now(), true);
    return;
  }
  for (const clip of clips) {
    const row = document.createElement('article');
    row.className = 'sampler-clip';
    row.dataset.clipId = clip.id;
    const identity = document.createElement('label');
    identity.className = 'sampler-clip__identity';
    const label = document.createElement('input');
    label.value = clip.label;
    label.maxLength = 48;
    label.setAttribute('aria-label', `label ${clip.label}`);
    label.dataset.samplerLabel = clip.id;
    const details = document.createElement('span');
    const provenance = clip.provenance || {};
    const source = provenance.kind === 'import'
      ? `${provenance.license || 'CHECK TERMS'}${provenance.creator ? ` · ${provenance.creator}` : ''}`
      : 'recorded here';
    details.textContent = `${Number(clip.duration || 0).toFixed(1)}s · ${formatMegabytes(clip.size)} · ${source}`;
    identity.append(label, details);
    const play = document.createElement('button');
    play.type = 'button';
    play.textContent = 'play';
    play.dataset.samplerPlay = clip.id;
    const map = document.createElement('button');
    map.type = 'button';
    map.textContent = selectedGestureClipId === clip.id ? 'pinch mapped' : 'use with pinch';
    map.dataset.samplerMap = clip.id;
    map.setAttribute('aria-pressed', String(selectedGestureClipId === clip.id));
    row.dataset.mapped = String(selectedGestureClipId === clip.id);
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.textContent = 'rename';
    rename.dataset.samplerRename = clip.id;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'delete';
    remove.dataset.samplerDelete = clip.id;
    row.append(identity, play, map, rename, remove);
    samplerList.append(row);
  }
  updatePerformanceMappingSurface(performance.now(), true);
}

function samplerImportProvenance() {
  const value = (field) => samplerPanel.querySelector(`[data-sampler-provenance="${field}"]`)?.value || '';
  return { license: value('license'), creator: value('creator'), sourceUrl: value('sourceUrl') };
}

async function importSamplerClip(event) {
  const file = event.target?.files?.[0];
  if (!file) return;
  samplerStatusOutput.textContent = `importing ${file.name} · local only`;
  const imported = await sampler.importClip(file, samplerImportProvenance());
  event.target.value = '';
  renderSamplerSurface();
  setStatus(imported ? `imported ${imported.label} · browser local` : 'local import was not retained');
}

async function installNasaPocketSet() {
  const clips = sampler.listClips();
  const existingSources = new Set(clips.map((clip) => clip.provenance?.sourceUrl).filter(Boolean));
  const missing = NASA_POCKET_SET.filter((entry) => !existingSources.has(entry.sourceUrl));
  if (!missing.length) {
    samplerStatusOutput.textContent = 'NASA pocket set already in this browser';
    return;
  }
  const usedBytes = clips.reduce((total, clip) => total + (Number(clip.size) || 0), 0);
  const incomingBytes = missing.reduce((total, entry) => total + entry.bytes, 0);
  if (clips.length + missing.length > CONFIG.sampler.maxClips || usedBytes + incomingBytes > CONFIG.sampler.maxBytes) {
    samplerStatusOutput.textContent = 'NASA set needs room · delete clips first; no clip was removed';
    return;
  }
  if (samplerNasaButton) samplerNasaButton.disabled = true;
  try {
    for (let index = 0; index < missing.length; index += 1) {
      const entry = missing[index];
      samplerStatusOutput.textContent = `adding NASA ${index + 1}/${missing.length} · local copy`;
      const response = await fetch(entry.path, { cache: 'no-store' });
      if (!response.ok) throw new Error(`local NASA asset ${response.status}`);
      const blob = await response.blob();
      const file = new File([blob], entry.file, { type: 'audio/mpeg' });
      const imported = await sampler.importClip(file, {
        kind: 'import', license: 'NASA Media Usage', creator: 'NASA Artemis Audio Library', sourceUrl: entry.sourceUrl,
      });
      if (!imported) throw new Error(`could not add ${entry.label}`);
      await sampler.renameClip(imported.id, entry.label);
    }
    setStatus('NASA pocket set · four local clips ready to audition and map');
  } catch (error) {
    samplerStatusOutput.textContent = 'NASA pocket set unavailable · no existing clip changed';
    setStatus(`NASA pocket set · ${String(error?.message || 'unavailable').slice(0, 100)}`);
  } finally {
    renderSamplerSurface();
  }
}

function clearGeneratedFrameBackground() {
  generatedFrameBackground = Object.freeze({ image: null, prompt: '', state: 'local recipe active · generated still cleared' });
  renderFrameSurface();
}

async function generateFrameBackground() {
  const settings = frameConfigurator.getState();
  const prompt = String(settings.prompt || '').trim();
  if (!prompt) {
    generatedFrameBackground = Object.freeze({ image: null, prompt: '', state: 'enter a prompt before generate still' });
    renderFrameSurface(settings);
    return;
  }
  generatedFrameBackground = Object.freeze({ image: null, prompt, state: 'public edition · shader recipe stays local · cloud still generation is studio-only' });
  setStatus('public edition · local shader recipe active · no prompt was sent');
  renderFrameSurface(settings);
}

function handleSamplerStatus(status = {}) {
  latestSamplerStatus = {
    state: String(status.state || 'standby'),
    message: String(status.message || status.state || 'sampler standby'),
  };
  if (['saved', 'idle', 'record-error', 'record-unavailable', 'panic', 'destroyed'].includes(latestSamplerStatus.state)) {
    samplerSession.releaseMicStream();
  }
  if (sampler) renderSamplerSurface();
  updateInputRitual();
  if (latestSamplerStatus.message && latestSamplerStatus.state !== 'ready') {
    setStatus(latestSamplerStatus.message);
  }
}

function setSamplerConsole(active) {
  const open = Boolean(active);
  if (open && calibrationState.active) setCalibration(false);
  if (open && !narrativePanel.hidden) setNarrativeConsole(false);
  if (open && !entityPanel.hidden) setEntityConsole(false);
  if (open && !framePanel.hidden) setFrameConsole(false);
  if (open && !scenePanel.hidden) setSceneConsole(false);
  if (open && !musicPanel.hidden) setMusicConsole(false);
  if (open && !patchPanel.hidden) setPatchConsole(false);
  if (open && !capturePanel.hidden) setCaptureConsole(false);
  samplerPanel.hidden = !open;
  samplerPanel.dataset.open = String(open);
  setButtonState('sampler', open);
  if (open) {
    renderSamplerSurface();
    setStatus('local sampler · clips stay in this browser');
  }
}

function toggleSamplerConsole() {
  setSamplerConsole(samplerPanel.hidden);
}

function setFrameConsole(active) {
  const open = Boolean(active);
  if (open && calibrationState.active) setCalibration(false);
  if (open && !narrativePanel.hidden) setNarrativeConsole(false);
  if (open && !entityPanel.hidden) setEntityConsole(false);
  if (open && !samplerPanel.hidden) setSamplerConsole(false);
  if (open && !scenePanel.hidden) setSceneConsole(false);
  if (open && !musicPanel.hidden) setMusicConsole(false);
  if (open && !patchPanel.hidden) setPatchConsole(false);
  if (open && !capturePanel.hidden) setCaptureConsole(false);
  framePanel.hidden = !open;
  framePanel.dataset.open = String(open);
  setButtonState('frame', open);
  if (open) {
    renderFrameSurface();
    setStatus('frame field · settings stay in this browser');
  }
}

function toggleFrameConsole() {
  setFrameConsole(framePanel.hidden);
}

function setSceneConsole(active) {
  const open = Boolean(active);
  if (open && calibrationState.active) setCalibration(false);
  if (open && !narrativePanel.hidden) setNarrativeConsole(false);
  if (open && !entityPanel.hidden) setEntityConsole(false);
  if (open && !samplerPanel.hidden) setSamplerConsole(false);
  if (open && !framePanel.hidden) setFrameConsole(false);
  if (open && !musicPanel.hidden) setMusicConsole(false);
  if (open && !patchPanel.hidden) setPatchConsole(false);
  if (open && !capturePanel.hidden) setCaptureConsole(false);
  if (open && !isSceneMode()) setMode(3);
  scenePanel.hidden = !open;
  scenePanel.dataset.open = String(open);
  setButtonState('scene', open);
  if (open) {
    renderSceneSurface();
    setStatus(`scene tune · mode ${controls.mode + 1} · settings stay in this browser`);
  }
}

function toggleSceneConsole() {
  setSceneConsole(scenePanel.hidden);
}

function narrationLines(text) {
  return String(text || '')
    .trim()
    .split(/\n+/u)
    .flatMap((line) => line.split(/(?<=[.!?…])\s+/u))
    .map((line) => line.trim())
    .filter(Boolean);
}

function setNarrativeStatus(message) {
  narrativeStatusOutput.textContent = String(message || 'narrator ready');
}

function stopNarration({ reset = true } = {}) {
  voiceMemory?.stop();
  narrativeAudio.pause();
  if (reset) narrativeAudio.currentTime = 0;
  narrativeStage.hidden = true;
  narrativeState.lineIndex = -1;
  narrativeProgress.textContent = 'TIME OF POETRY · HELD';
}

function updateNarrativeStage(time, trackingFrameValue) {
  if (narrativeStage.hidden) return;
  const duration = Number(narrativeAudio.duration);
  const progress = Number.isFinite(duration) && duration > 0
    ? clamp(narrativeAudio.currentTime / duration)
    : 0;
  const lines = narrativeState.lines;
  const nextLineIndex = lines.length ? Math.min(lines.length - 1, Math.floor(progress * lines.length)) : -1;
  if (nextLineIndex !== narrativeState.lineIndex) {
    narrativeState.lineIndex = nextLineIndex;
    narrativeLine.textContent = lines[nextLineIndex] || '';
  }
  const bodyEnergy = narrativeBodyToggle.checked
    ? clamp(trackingFrameValue?.metrics?.bodyEnergy)
    : 0;
  const phase = Math.sin(time * 0.0011) * 0.5 + 0.5;
  narrativeStage.style.setProperty('--narrative-energy', bodyEnergy.toFixed(3));
  narrativeStage.style.setProperty('--narrative-drift', ((phase - 0.5) * bodyEnergy).toFixed(3));
  narrativeStage.style.setProperty('--narrative-lift', (bodyEnergy * 0.58).toFixed(3));
  narrativeProgress.textContent = `TIME OF POETRY · ${Math.round(progress * 100)}% · BODY ${Math.round(bodyEnergy * 100)}%`;
}

async function loadNarratorVoices() {
  if (narrativeState.voicesLoaded) return;
  narrativeState.voicesLoaded = true;
  setNarrativeStatus('public edition · author voice sources are ready · no network request');
  narrativeVoiceSelect.disabled = true;
}

function releaseNarrationAudio() {
  if (!narrativeState.objectUrl) return;
  URL.revokeObjectURL(narrativeState.objectUrl);
  narrativeState.objectUrl = '';
}

function narrationMediaIsSelected() {
  if (narrativeState.source === 'generated') return Boolean(narrativeState.objectUrl);
  return Boolean(narrativeAudio.currentSrc || narrativeAudio.src);
}

function setNarrativeSource(sourceId) {
  const source = CONFIG.narration.sources[sourceId];
  if (!source) return;
  stopNarration();
  narrativeState.source = sourceId;
  narrativeSourceSelect.value = sourceId;
  for (const button of narrativeSourceButtons) {
    const active = button.dataset.narrativeSourceButton === sourceId;
    button.dataset.on = String(active);
    button.setAttribute('aria-pressed', String(active));
  }
  const generated = sourceId === 'generated';
  narrativeGenerateButton.disabled = !generated;
  narrativeVoiceSelect.disabled = !generated || !narrativeState.voicesLoaded;
  narrativeProfileSelect.disabled = !generated;
  if (generated) {
    narrativePlayButton.disabled = !narrativeState.objectUrl;
    setNarrativeStatus(narrativeState.objectUrl
      ? 'generated voice ready · PLAY POEM starts it explicitly'
      : 'generated source · choose voice and CREATE VOICE');
    return;
  }
  releaseNarrationAudio();
  narrativeAudio.src = source.path;
  narrativeAudio.load();
  narrativeState.lines = narrationLines(narrativeTextInput.value || NARRATIVE_TEMPLATES.ru);
  narrativeState.lineIndex = -1;
  narrativeState.generatedText = narrativeTextInput.value;
  narrativeState.generatedVoiceName = source.label;
  narrativePlayButton.disabled = false;
  narrativeMeta.textContent = `${source.label} · ${(narrativeAudio.duration || 0).toFixed(0)}s · local playback`;
  setNarrativeStatus(`${source.label} loaded · PLAY POEM starts it explicitly`);
}

async function createNarration() {
  setNarrativeStatus('public edition · cloud voice generation stays in the local studio build');
}

async function playNarration() {
  if (!narrationMediaIsSelected()) {
    setNarrativeStatus(narrativeState.source === 'generated'
      ? 'create voice first'
      : 'choose an Alex source first');
    return;
  }
  try {
    const bodyTrackingActive = Boolean(tracking.getFrame?.()?.camera?.active);
    narrativePlayButton.disabled = true;
    setNarrativeStatus('starting selected voice · Chrome audio is being unlocked');
    await voiceMemory.arm(narrativeAudio);
    voiceMemory.start();
    await narrativeAudio.play();
    narrativeStage.hidden = false;
    narrativeState.lineIndex = -1;
    setNarrativeStatus(bodyTrackingActive
      ? 'poetry playing · local voice is in the performance audio mix · camera and tracking remain local'
      : 'poetry playing · local voice is in the performance audio mix · start camera separately for body motion');
  } catch (error) {
    voiceMemory.stop();
    setNarrativeStatus(`poetry could not start · ${error.message}`);
  } finally {
    narrativePlayButton.disabled = false;
  }
}

function setNarrativeConsole(active) {
  const open = Boolean(active);
  if (open && calibrationState.active) setCalibration(false);
  if (open && !entityPanel.hidden) setEntityConsole(false);
  if (open && !samplerPanel.hidden) setSamplerConsole(false);
  if (open && !framePanel.hidden) setFrameConsole(false);
  if (open && !scenePanel.hidden) setSceneConsole(false);
  if (open && !musicPanel.hidden) setMusicConsole(false);
  if (open && !patchPanel.hidden) setPatchConsole(false);
  if (open && !capturePanel.hidden) setCaptureConsole(false);
  narrativePanel.hidden = !open;
  narrativePanel.dataset.open = String(open);
  setButtonState('narrative', open);
  if (!open) stopNarration();
  if (open) void loadNarratorVoices();
  if (open) setNarrativeSource(narrativeSourceSelect.value || CONFIG.narration.defaultSource);
  if (open) renderVoiceMemorySurface();
}

function renderVoiceMemorySurface() {
  const state = voiceMemory?.getState?.();
  if (!state) return;
  for (const input of narrativeMemoryInputs) {
    const key = input.dataset.voiceMemory;
    const value = state.settings?.[key];
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else if (value !== undefined && document.activeElement !== input) input.value = String(value);
    const output = input.closest('label')?.querySelector('[data-voice-memory-output]');
    if (output && Number.isFinite(Number(value))) {
      const unit = key.includes('Seconds') ? 's' : key === 'repeatCount' ? '×' : '%';
      const display = unit === '%' ? Math.round(Number(value) * 100) : Number(value);
      output.textContent = `${display}${unit}`;
    }
  }
  if (narrativeMemoryStatus) narrativeMemoryStatus.textContent = state.lastEvent;
}

function handleVoiceMemoryControl(event) {
  const input = event.target.closest?.('[data-voice-memory]');
  if (!input) return;
  const key = input.dataset.voiceMemory;
  const value = input.type === 'checkbox' ? input.checked : Number(input.value);
  voiceMemory.configure({ [key]: value });
  renderVoiceMemorySurface();
}

function toggleNarrativeConsole() {
  setNarrativeConsole(narrativePanel.hidden);
}

function handleSceneControl(event) {
  const preset = event.target.closest('[data-scene-preset]');
  if (preset) {
    sceneConfigurator.applyPreset(controls.mode, preset.dataset.scenePreset);
    setStatus(`scene preset · ${preset.dataset.scenePreset}`);
    return;
  }
  const field = event.target.closest('[data-scene-field]');
  if (field) sceneConfigurator.configure(controls.mode, { [field.dataset.sceneField]: Number(field.value) });
}

function musicNoteLabel(note) {
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return `${names[note % 12]}${Math.floor(note / 12) - 1}`;
}

function ensureMusicKeyboard(centerNote = 60) {
  const start = Math.round(clamp(
    Math.round(Number(centerNote) || 60) - 12,
    CONFIG.music.noteMin,
    CONFIG.music.noteMax - 24,
  ));
  if (musicKeyboard.childElementCount && Number(musicKeyboard.dataset.start) === start) return;
  musicKeyboard.replaceChildren();
  musicKeyboard.dataset.start = String(start);
  const black = new Set([1, 3, 6, 8, 10]);
  for (let note = start; note <= start + 24; note += 1) {
    const key = document.createElement('button');
    key.type = 'button';
    key.className = 'music-key';
    key.dataset.musicNote = String(note);
    key.dataset.black = String(black.has(note % 12));
    key.dataset.active = 'false';
    key.setAttribute('aria-label', `note ${musicNoteLabel(note)}`);
    key.textContent = musicNoteLabel(note);
    musicKeyboard.append(key);
  }
}

function renderMusicSurface() {
  if (!music) return;
  const state = music.getState();
  const focusedNote = state.activeNotes?.at?.(-1)?.note ?? 60;
  ensureMusicKeyboard(focusedNote);
  const handRoute = latestEntitySettings?.settings?.hands?.sound
    ?? CONFIG.entities.sources.hands.sound;
  musicPanel.dataset.armed = String(Boolean(state.armed));
  musicPanel.dataset.silent = String(Boolean(state.silent));
  musicPanel.querySelector('[data-music-arm]').dataset.on = String(Boolean(state.armed));
  musicPanel.querySelector('[data-music-arm]').textContent = state.armed ? 'sound ready' : 'start sound';
  const activeNote = state.activeNotes?.at?.(-1);
  musicStatusOutput.textContent = state.silent
    ? state.silentReason
    : `playing · ${activeNote ? musicNoteLabel(activeNote.note) : 'note'} · velocity ${Math.round((activeNote?.velocity || 0) * 100)}% · ${state.voiceCount || state.activeNotes?.length || 0} ${(state.voiceCount || state.activeNotes?.length || 0) === 1 ? 'voice' : 'voices'}`;
  musicSilenceOutput.textContent = state.silentReason || 'output active';
  const midiFrame = audioMidi?.getFrame?.() || emptyAudio;
  const midiActive = Boolean(midiFrame.midiActive);
  const midiButton = musicPanel.querySelector('[data-music-midi]');
  midiButton.dataset.on = String(midiActive);
  midiButton.textContent = midiActive ? 'midi connected' : 'connect midi';
  musicMidiStatusOutput.textContent = midiActive
    ? `midi · ${midiFrame.devices?.join(', ') || 'input live'}`
    : latestAudioStatus.midi.message && latestAudioStatus.midi.message !== 'standby'
      ? latestAudioStatus.midi.message
      : 'midi standby · press CONNECT MIDI';
  const hatsButton = musicPanel.querySelector('[data-music-hats]');
  hatsButton.dataset.on = String(Boolean(state.hatsEnabled));
  hatsButton.textContent = state.hatsEnabled ? 'hats on' : 'hats off';
  for (const input of musicPanel.querySelectorAll('[data-music-field]')) {
    const field = input.dataset.musicField;
    const value = field === 'handRoute' ? handRoute : state[field];
    if (value !== undefined && document.activeElement !== input) input.value = String(value);
  }
  for (const output of musicPanel.querySelectorAll('[data-music-output]')) {
    const field = output.dataset.musicOutput;
    const value = field === 'handRoute' ? handRoute : state[field];
    if (Number.isFinite(Number(value))) output.textContent = `${Math.round(Number(value) * 100)}%`;
  }
  const activeNotes = new Set((state.activeNotes || []).map((note) => Number(note.note)));
  for (const key of musicKeyboard.querySelectorAll('[data-music-note]')) {
    key.dataset.active = String(activeNotes.has(Number(key.dataset.musicNote)));
  }
  if (musicGestureOutput) {
    musicGestureOutput.textContent = `PINCH ${Math.round(gestureMusicRuntime.pinch * 100)}% · OPEN ${Math.round(gestureMusicRuntime.openness * 100)}% · SPREAD ${Math.round(gestureMusicRuntime.spread * 100)}% · HARMONY ${Math.round(gestureMusicRuntime.harmony * 100)}%`;
  }
  if (musicFingerOutput) {
    musicFingerOutput.textContent = `MIDDLE ${Math.round((state.fingers?.middle || 0) * 100)}% · RING ${Math.round((state.fingers?.ring || 0) * 100)}% · PINKY ${Math.round((state.fingers?.pinky || 0) * 100)}% · HATS ${state.hatsEnabled ? 'ON' : 'OFF'}`;
  }
  if (musicRoleHint) {
    const role = state.handRole === 'left' ? 'левая' : state.handRole === 'right' ? 'правая' : 'обе руки';
    musicRoleHint.textContent = `${role} запускает ноты pinch-ом · обе руки всегда управляют тембром, echo и гармонической шириной.`;
  }
  if (musicOutputPath) {
    if (state.contextState !== 'running') {
      musicOutputPath.textContent = `audio context · ${state.contextState} · нажми START SOUND, затем PLAY TEST NOTE`;
    } else if (state.voiceCount > 0) {
      musicOutputPath.textContent = 'browser synth is playing locally · если не слышно, проверь mute вкладки Chrome и выбранный выход macOS';
    } else {
      musicOutputPath.textContent = 'WebAudio ready → выбранный выход macOS · PLAY TEST NOTE проверяет путь до колонок / проектора';
    }
  }
  if (musicLastEventOutput) musicLastEventOutput.textContent = `last event · ${state.lastEvent || 'idle'}`;
}

function setMusicConsole(active) {
  const open = Boolean(active);
  if (open && calibrationState.active) setCalibration(false);
  if (open && !narrativePanel.hidden) setNarrativeConsole(false);
  if (open && !entityPanel.hidden) setEntityConsole(false);
  if (open && !samplerPanel.hidden) setSamplerConsole(false);
  if (open && !framePanel.hidden) setFrameConsole(false);
  if (open && !scenePanel.hidden) setSceneConsole(false);
  if (open && !patchPanel.hidden) setPatchConsole(false);
  if (open && !capturePanel.hidden) setCaptureConsole(false);
  musicPanel.hidden = !open;
  if (!open) for (const key of [...computerMusicDown.keys()]) stopComputerMusicKey(key);
  musicPanel.dataset.open = String(open);
  setButtonState('music', open);
  if (open) {
    renderMusicSurface();
    setStatus(music.getState().silentReason || 'music instrument ready');
  }
}

function toggleMusicConsole() {
  setMusicConsole(musicPanel.hidden);
}

function setCaptureConsole(active) {
  const open = Boolean(active);
  if (open && calibrationState.active) setCalibration(false);
  if (open && !narrativePanel.hidden) setNarrativeConsole(false);
  if (open && !entityPanel.hidden) setEntityConsole(false);
  if (open && !samplerPanel.hidden) setSamplerConsole(false);
  if (open && !framePanel.hidden) setFrameConsole(false);
  if (open && !scenePanel.hidden) setSceneConsole(false);
  if (open && !musicPanel.hidden) setMusicConsole(false);
  if (open && !patchPanel.hidden) setPatchConsole(false);
  capturePanel.hidden = !open;
  capturePanel.dataset.open = String(open);
  setButtonState('capture', open);
  if (open) {
    renderCaptureSurface();
    setStatus('local capture · records projector image only when REC is pressed');
  }
}

function toggleCaptureConsole() {
  setCaptureConsole(capturePanel.hidden);
}

function panicCapture() {
  performanceRecorder.panic();
  stopCaptureStream();
  if (!capturePanel.hidden) renderCaptureSurface();
}

function applyPatchFrame(frame) {
  patchVisualState.active = frame?.active ? 1 : 0;
  patchVisualState.hands = 0;
  patchVisualState.frame = 0;
  patchVisualState.midi = 0;
  patchVisualState.pulse = 0;
  patchVisualState.events = Number(frame?.eventCount) || 0;
  for (let index = 0; index < (frame?.axisCount || 0); index += 1) {
    const axis = frame.axes[index];
    if (axis.id === PATCH_AXIS_IDS[0]) patchVisualState.hands = clamp(axis.value);
    if (axis.id === PATCH_AXIS_IDS[1]) patchVisualState.frame = clamp(axis.value);
    if (axis.id === PATCH_AXIS_IDS[2]) patchVisualState.midi = clamp(axis.value);
  }
  for (let index = 0; index < (frame?.eventCount || 0); index += 1) {
    patchVisualState.pulse = Math.max(patchVisualState.pulse, clamp(frame.events[index]?.value));
  }
  if (!patchPanel.hidden) renderPatchSurface();
}

function renderPatchSurface() {
  const state = performancePatchHost?.getState?.() || { status: 'idle', reason: 'patch unavailable', fps: 0 };
  const runningPatch = state.status === 'running';
  patchPanel.dataset.open = String(!patchPanel.hidden);
  patchPanel.dataset.status = state.status;
  patchToggleButton.dataset.running = String(runningPatch);
  patchToggleButton.textContent = runningPatch ? 'hold patch' : 'start patch';
  patchStatusOutput.textContent = state.status === 'running'
    ? `ghost-wire live · ${Math.round(state.fps || 0)} fps · X suspends instantly`
    : `${state.status} · ${state.reason}`;
  patchAxesOutput.textContent = `hands ${Math.round(patchVisualState.hands * 100)}% · frame ${Math.round(patchVisualState.frame * 100)}% · MIDI ${Math.round(patchVisualState.midi * 100)}% · pulse ${Math.round(patchVisualState.pulse * 100)}%`;
}

function loadPerformancePatch() {
  const adapter = createLocalPerformancePatchAdapter({ onFrame: applyPatchFrame });
  const loaded = performancePatchHost.load(CONFIG.performancePatch.defaultPatch, adapter);
  if (!loaded.valid) {
    setStatus(`patch rejected · ${loaded.errors.join(' · ')}`);
    return false;
  }
  renderPatchSurface();
  return performancePatchHost.getState().status === 'running';
}

function panicPerformancePatch() {
  performancePatchHost?.panic?.();
  applyPatchFrame(null);
  if (!patchPanel.hidden) renderPatchSurface();
}

function setPatchConsole(active) {
  const open = Boolean(active);
  if (open && calibrationState.active) setCalibration(false);
  if (open && !narrativePanel.hidden) setNarrativeConsole(false);
  if (open && !entityPanel.hidden) setEntityConsole(false);
  if (open && !samplerPanel.hidden) setSamplerConsole(false);
  if (open && !framePanel.hidden) setFrameConsole(false);
  if (open && !scenePanel.hidden) setSceneConsole(false);
  if (open && !musicPanel.hidden) setMusicConsole(false);
  if (open && !capturePanel.hidden) setCaptureConsole(false);
  patchPanel.hidden = !open;
  setButtonState('patch', open);
  if (open) renderPatchSurface();
}

function togglePatchConsole() {
  setPatchConsole(patchPanel.hidden);
}

function togglePerformancePatch() {
  if (performancePatchHost.getState().status === 'running') panicPerformancePatch();
  else loadPerformancePatch();
  renderPatchSurface();
}

function queuePerformancePatchEvent(id, type, value = 1) {
  if (patchEventCount >= performancePatchInput.events.length) return;
  const event = performancePatchInput.events[patchEventCount];
  event.id = id;
  event.type = type;
  event.value = clamp(value);
  patchEventCount += 1;
}

function updatePerformancePatch(time, tracking) {
  const metrics = tracking?.metrics || {};
  performancePatchInput.timestamp = time;
  performancePatchInput.fps = Number(renderer.getStats?.().fps) || 0;
  performancePatchInput.axes[0].value = clamp(metrics.handEnergy);
  performancePatchInput.axes[1].value = gestureFrameState?.phase && gestureFrameState.phase !== 'off' && gestureFrameState.phase !== 'searching' ? 1 : 0;
  performancePatchInput.axes[2].value = clamp(audioFrame?.midiEnergy);
  if ((gestureFrameState?.eventCount || 0) + (frameContentState?.eventCount || 0) + (frameZoneState?.eventCount || 0) > 0) {
    queuePerformancePatchEvent(PATCH_EVENT_IDS[1], 'edge', 1);
  }
  performancePatchHost.update(performancePatchInput);
  for (let index = 0; index < patchEventCount; index += 1) {
    const event = performancePatchInput.events[index];
    event.id = '';
    event.type = '';
    event.value = 0;
  }
  patchEventCount = 0;
}

function startComputerMusicKey(key) {
  if (computerMusicDown.has(key)) return;
  const note = CONFIG.music.computerKeyboardBaseNote + COMPUTER_MUSIC_KEYS[key];
  computerMusicDown.set(key, note);
  void music.arm().then(() => {
    if (computerMusicDown.get(key) !== note) return;
    music.handleMidiEvent({
      type: 'note', note, velocity: 0.82, channel: 0,
      device: 'computer keyboard', timestamp: performance.now(),
    });
    renderMusicSurface();
  });
}

function stopComputerMusicKey(key) {
  const note = computerMusicDown.get(key);
  if (!Number.isFinite(note)) return;
  computerMusicDown.delete(key);
  music.handleMidiEvent({
    type: 'noteoff', note, velocity: 0, channel: 0,
    device: 'computer keyboard', timestamp: performance.now(),
  });
  if (!musicPanel.hidden) renderMusicSurface();
}

function handleMusicControl(event) {
  const input = event.target.closest('[data-music-field]');
  if (!input) return;
  const field = input.dataset.musicField;
  const value = input.type === 'range' ? Number(input.value) : input.value;
  if (field === 'handRoute') {
    latestEntitySettings = entityConsole.configureSource('hands', { sound: value });
  } else {
    music.update({ timestamp: performance.now(), [field]: value });
  }
  renderMusicSurface();
}

function frameInputValue(input) {
  if (input.type === 'checkbox') return Boolean(input.checked);
  if (input.dataset.frameField === 'stageFill') return input.value === 'true';
  return input.type === 'range' || input.type === 'number'
    ? Number(input.value)
    : input.value;
}

function handleFrameControl(event) {
  const promptExample = event.target.closest('[data-frame-prompt-example]');
  if (promptExample) {
    frameConfigurator.configure({ prompt: promptExample.dataset.framePromptExample || '' });
    return;
  }
  if (event.target.closest('[data-frame-generate]')) {
    void generateFrameBackground();
    return;
  }
  if (event.target.closest('[data-frame-generate-clear]')) {
    clearGeneratedFrameBackground();
    return;
  }
  const modeButton = event.target.closest('[data-frame-mode]');
  if (modeButton) {
    frameConfigurator.configure({ mode: modeButton.dataset.frameMode });
    return;
  }
  const field = event.target.closest('[data-frame-field]');
  if (field) {
    const key = field.dataset.frameField;
    const value = frameInputValue(field);
    if (key === 'focusDetail' && value === 'face-edge') {
      frameConfigurator.configure({ focusSource: 'face', focusDetail: 'face-edge' });
    } else if (key === 'focusSource') {
      frameConfigurator.configure({
        focusSource: value,
        focusDetail: value === 'face' ? frameConfigurator.getState().focusDetail : 'whole',
        objectClass: value === 'object' ? '' : frameConfigurator.getState().objectClass,
      });
    } else {
      frameConfigurator.configure({ [key]: value });
    }
    return;
  }
  const exercise = event.target.closest('[data-frame-exercise]');
  if (exercise) {
    frameConfigurator.configure({
      exerciseRule: { [exercise.dataset.frameExercise]: frameInputValue(exercise) },
    });
    return;
  }
  const gesture = event.target.closest('[data-gesture-field]');
  if (gesture) {
    gestureConfigurator.configure({
      [gesture.dataset.gestureField]: frameInputValue(gesture),
    });
    return;
  }
  const zone = event.target.closest('[data-frame-zone]');
  if (zone) {
    frameZoneConfigurator.configure({
      [zone.dataset.frameZone]: frameInputValue(zone),
    });
  }
}

async function armSampler() {
  await sampler.arm();
  renderSamplerSurface();
  updateInputRitual();
}

async function toggleSamplerRecording() {
  await sampler.toggleRecording();
  renderSamplerSurface();
  updateInputRitual();
}

function panicSampler() {
  sampler.panic();
  resetPerformanceMapping();
  samplerSession.releaseMicStream();
  renderSamplerSurface();
  updateInputRitual();
}

async function handleSamplerListClick(event) {
  const button = event.target.closest('button');
  if (!button) return;
  const clipId = button.dataset.samplerPlay
    || button.dataset.samplerMap
    || button.dataset.samplerRename
    || button.dataset.samplerDelete;
  if (!clipId) return;
  if (button.dataset.samplerPlay) {
    if (!await sampler.arm()) return;
    await sampler.trigger({
      kind: 'event', edge: true, source: 'sampler-ui', key: `sampler-ui:${clipId}`,
      clipId, timestamp: performance.now(), cooldownMs: 0, velocity: 1,
    });
  }
  if (button.dataset.samplerMap) {
    setGestureClip(clipId);
    updateInputRitual();
    return;
  }
  if (button.dataset.samplerRename) {
    const input = [...samplerList.querySelectorAll('[data-sampler-label]')]
      .find((candidate) => candidate.dataset.samplerLabel === clipId);
    if (input) await sampler.renameClip(clipId, input.value);
  }
  if (button.dataset.samplerDelete) {
    const clip = sampler.listClips().find((candidate) => candidate.id === clipId);
    const confirmed = globalThis.confirm?.(`Delete local clip “${clip?.label || clipId}”?`) ?? false;
    if (confirmed) await sampler.deleteClip(clipId);
  }
  renderSamplerSurface();
  updateInputRitual();
}

function stopCaptureStream() {
  for (const track of captureVisualStream?.getTracks?.() || []) {
    try { track.stop?.(); } catch { /* stream release is best-effort */ }
  }
  samplerSession.releasePerformanceCaptureStream();
  captureVisualStream = null;
  captureStream = null;
  captureIncludesAudio = false;
  lastCaptureCompositeAt = -Infinity;
}

function compositeCaptureFrame(time, force = false) {
  if (!captureContext || (!force && !performanceRecorder?.getState?.().active)) return false;
  const width = Math.max(1, Number(glCanvas.width) || 1);
  const height = Math.max(1, Number(glCanvas.height) || 1);
  if (captureCanvas.width !== width || captureCanvas.height !== height) {
    captureCanvas.width = width;
    captureCanvas.height = height;
  }
  const interval = 1000 / CONFIG.performanceCapture.frameRate;
  if (!force && time - lastCaptureCompositeAt < interval) return false;
  lastCaptureCompositeAt = time;
  captureContext.setTransform(1, 0, 0, 1, 0, 0);
  captureContext.globalCompositeOperation = 'source-over';
  captureContext.globalAlpha = 1;
  captureContext.clearRect(0, 0, width, height);
  captureContext.drawImage(glCanvas, 0, 0, width, height);
  captureContext.drawImage(overlayCanvas, 0, 0, width, height);
  return true;
}

async function createCaptureStream() {
  if (captureStream) return captureStream;
  if (typeof captureCanvas.captureStream !== 'function') return null;
  compositeCaptureFrame(performance.now(), true);
  try {
    captureVisualStream = captureCanvas.captureStream(CONFIG.performanceCapture.frameRate);
    captureStream = captureVisualStream;
    const wantsAudio = Boolean(captureAudioToggle?.checked);
    if (wantsAudio) {
      try {
        const audioStream = await samplerSession.getPerformanceCaptureStream();
        const MediaStreamConstructor = globalThis.MediaStream;
        const audioTracks = audioStream?.getAudioTracks?.() || [];
        const videoTracks = captureVisualStream.getVideoTracks?.() || [];
        if (!MediaStreamConstructor || !audioTracks.length || !videoTracks.length) {
          throw new Error('live mix stream unavailable');
        }
        captureStream = new MediaStreamConstructor([...videoTracks, ...audioTracks]);
        captureIncludesAudio = true;
      } catch (error) {
        samplerSession.releasePerformanceCaptureStream();
        captureIncludesAudio = false;
        setStatus(`capture audio unavailable · visual take only · ${error.message}`);
      }
    }
  } catch (error) {
    setStatus(`capture unavailable · ${error.message}`);
    samplerSession.releasePerformanceCaptureStream();
    captureVisualStream = null;
    captureStream = null;
  }
  return captureStream;
}

function renderCaptureSurface() {
  const state = performanceRecorder.getState();
  const takes = performanceRecorder.listTakes();
  capturePanel.dataset.open = String(!capturePanel.hidden);
  capturePanel.dataset.recording = String(state.active);
  captureRecordButton.dataset.recording = String(state.active);
  captureRecordButton.textContent = state.active
    ? `stop + save ${captureIncludesAudio ? 'AV' : 'visual'} take`
    : `start ${captureAudioToggle?.checked ? 'AV' : 'visual'} take`;
  if (captureAudioToggle) captureAudioToggle.disabled = state.active;
  captureStatusOutput.textContent = state.active
    ? `recording locally · ${captureIncludesAudio ? 'live synth/sample mix + ' : ''}projector image · ${Math.round(state.durationMs / 1000)}s · max ${Math.round(CONFIG.performanceCapture.maxDurationMs / 60000)} min`
    : state.status === 'unsupported'
      ? 'MediaRecorder unavailable · stage remains live'
      : state.error || 'capture idle · no stream at boot';
  captureCapacity.textContent = `${takes.length} / ${CONFIG.performanceCapture.maxTakes} takes · ${formatMegabytes(state.totalBytes)} / ${formatMegabytes(CONFIG.performanceCapture.maxBytes)}`;
  captureTakes.replaceChildren();
  if (!takes.length) {
    const empty = document.createElement('p');
    empty.textContent = 'no takes yet · choose visual or live synth/sample mix, then start a local take';
    captureTakes.append(empty);
    return;
  }
  for (const take of takes) {
    const row = document.createElement('article');
    row.className = 'capture-take';
    const label = document.createElement('span');
    label.textContent = `${new Date(take.createdAt).toLocaleTimeString()} · ${(take.durationMs / 1000).toFixed(1)}s · ${formatMegabytes(take.size)}`;
    const download = document.createElement('a');
    download.href = performanceRecorder.getTakeUrl(take.id);
    download.download = `mythtrace-${take.id}.${take.mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
    download.textContent = 'download';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.captureDelete = take.id;
    remove.textContent = 'delete';
    row.append(label, download, remove);
    captureTakes.append(row);
  }
}

async function toggleCaptureRecording() {
  if (performanceRecorder.getState().active) {
    await performanceRecorder.stop();
    stopCaptureStream();
    renderCaptureSurface();
    setStatus('capture saved locally · choose download when ready');
    return;
  }
  const stream = await createCaptureStream();
  if (!stream || !performanceRecorder.start(stream)) {
    stopCaptureStream();
    renderCaptureSurface();
    return;
  }
  renderCaptureSurface();
  setStatus(captureIncludesAudio
    ? 'capture recording locally · projector image + live synth/sample mix'
    : 'capture recording locally · visual projector output');
}

function handleCaptureTakesClick(event) {
  const id = event.target.closest?.('[data-capture-delete]')?.dataset.captureDelete;
  if (!id) return;
  performanceRecorder.removeTake(id);
  renderCaptureSurface();
}

function sampleTracking(time) {
  try {
    const next = tracking.sample?.(time);
    if (next && typeof next.then === 'function') {
      next.then((value) => { if (value) trackingFrame = value; }).catch((error) => setStatus(`tracking · ${error.message}`));
    } else if (next) trackingFrame = next;
    else trackingFrame = tracking.getFrame?.() || trackingFrame;
  } catch (error) {
    setStatus(`tracking · ${error.message}`);
  }
}

function sampleAudio(time, frame) {
  try {
    const next = audioMidi.update?.(time, frame);
    if (next && typeof next.then === 'function') {
      next.then((value) => { if (value) audioFrame = value; }).catch((error) => setStatus(`audio · ${error.message}`));
    } else if (next) audioFrame = next;
    else audioFrame = audioMidi.getFrame?.() || audioFrame;
  } catch (error) {
    setStatus(`audio · ${error.message}`);
  }
}

function resize() {
  const width = stage.clientWidth || innerWidth;
  const height = stage.clientHeight || innerHeight;
  const dpr = Math.min(CONFIG.render.maxDpr, devicePixelRatio || 1);
  renderer.resize?.(width, height, dpr);
  overlay.resize(width, height, dpr);
  resizeQueued = false;
}

function frame(time) {
  if (resizeQueued) resize();
  const dt = Math.min(0.1, Math.max(1 / 240, (time - lastFrameAt) / 1000));
  lastFrameAt = time;
  if (!controls.paused && running) {
    frozenTime = time;
    frameZoneClock += dt * 1000;
    sampleTracking(time);
    const visibleTracking = displayedTracking(trackingFrame, dt);
    gestureFrameState = gestureFrame.update({
      timestamp: frameZoneClock,
      tracking: visibleTracking,
      mode: frameContentMode,
    });
    frameZoneState = frameZones.update({
      timestamp: time,
      gestureFrame: gestureFrameState,
      tracking: visibleTracking,
    });
    frameContentState = frameContent.update({
      timestamp: time,
      frame: gestureFrameState,
      exercisePoint: resolveExercisePoint(visibleTracking),
    });
    frameObjectCropState = frameObjectCrop.update({
      timestamp: time,
      candidates: collectFocusCandidates(visibleTracking, frameContentState),
      frame: gestureFrameState,
      content: frameContentState,
      camera: visibleTracking.camera,
    });
    updateFrameSoundEvents();
    sampleAudio(time, visibleTracking);
    updatePerformanceMapping(time, visibleTracking);
    updatePerformancePatch(time, visibleTracking);
    updateNarrativeStage(time, visibleTracking);
    renderer.render?.({ time, dt, tracking: visibleTracking, audio: audioFrame, controls, patch: patchVisualState });
    overlay.render({
      time, tracking: visibleTracking, audio: audioFrame, controls,
      stats: renderer.getStats?.() || {}, gestureFrame: gestureFrameState,
      frameContent: frameContentState, frameObjectCrop: frameObjectCropState,
      frameZone: frameZoneState, generatedBackground: generatedFrameBackground,
    });
    compositeCaptureFrame(time);
    updateEntityConsole(time, visibleTracking);
  } else {
    const visibleTracking = displayedTracking(trackingFrame, dt);
    updateNarrativeStage(frozenTime, visibleTracking);
    overlay.render({
      time: frozenTime, tracking: visibleTracking, audio: audioFrame, controls,
      stats: renderer.getStats?.() || {}, gestureFrame: gestureFrameState,
      frameContent: frameContentState, frameObjectCrop: frameObjectCropState,
      frameZone: frameZoneState, generatedBackground: generatedFrameBackground,
    });
    compositeCaptureFrame(time);
    updateEntityConsole(frozenTime, visibleTracking);
  }
  requestAnimationFrame(frame);
}

async function enableCamera(deviceId = cameraSelect.value) {
  preferredCameraDeviceId = String(deviceId || '');
  frameZones.reset(frameZoneClock);
  frameZoneState = null;
  setStatus('requesting camera · frames stay local');
  setInputState('camera', 'loading', 'requesting permission');
  try {
    await tracking.startCamera?.(preferredCameraDeviceId);
    const camera = tracking.getFrame?.()?.camera;
    controls.mirrored = camera?.mirrored ?? controls.mirrored;
    await refreshCameraDevices();
    setButtonState('camera', Boolean(camera?.active));
    updateInputRitual();
  } catch (error) {
    setStatus(`camera unavailable · pointer active · ${error.message}`);
    updateInputRitual();
  }
}

async function enableAudio() {
  try {
    await audioMidi.enableMic?.();
    setButtonState('audio', Boolean(audioMidi.getFrame?.()?.micActive));
    updateInputRitual();
  } catch (error) {
    setStatus(`mic unavailable · ${error.message}`);
  }
}

async function enableMidi() {
  try {
    const musicRequest = music.arm?.();
    const midiRequest = audioMidi.enableMIDI?.();
    await Promise.all([musicRequest, midiRequest]);
    setButtonState('midi', Boolean(audioMidi.getFrame?.()?.midiActive));
    updateInputRitual();
  } catch (error) {
    setStatus(`midi unavailable · ${error.message}`);
  }
}

async function activateHandInstrument() {
  const route = CONFIG.handInstrument;
  latestEntitySettings = entityConsole.configureSource('hands', {
    enabled: true,
    overlay: 1,
    sound: route.route,
  });
  music.update({
    timestamp: performance.now(),
    preset: route.preset,
    scale: route.scale,
  });
  setButtonState('hands', true);
  setStatus('hands play · arming local synth and camera');
  try {
    await Promise.all([
      music.arm(),
      tracking.getFrame?.()?.camera?.active ? Promise.resolve() : enableCamera(cameraSelect.value),
    ]);
    updateInputRitual();
    if (!musicPanel.hidden) renderMusicSurface();
    const cameraLive = Boolean(tracking.getFrame?.()?.camera?.active);
    setStatus(cameraLive
      ? 'hands play · pinch = note · open = timbre · two hands = harmony'
      : 'hands sound ready · grant camera to make gestures live');
  } catch (error) {
    setButtonState('hands', false);
    setStatus(`hands play unavailable · ${error.message}`);
  }
}

function enterSystem() {
  running = true;
  document.body.dataset.stopped = 'false';
  entry.dataset.hidden = 'true';
  setStatus('pointer field live · arm camera, mic or MIDI explicitly');
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else stage.requestFullscreen?.({ navigationUI: 'hide' });
}

function panicOutputs() {
  audioMidi.panic?.();
  panicSampler();
  music.panic?.();
  stopNarration();
  panicPerformancePatch();
  panicCapture();
  controls.pointer.down = false;
  setStatus('panic · all sound gates zero');
  updateInputRitual();
}

function stopSystem() {
  running = false;
  controls.paused = true;
  panicOutputs();
  document.body.dataset.stopped = 'true';
  setStatus('system held · press Space to resume');
}

function togglePause() {
  controls.paused = !controls.paused;
  running = true;
  document.body.dataset.stopped = 'false';
  if (controls.paused) {
    audioMidi.panic?.();
    panicSampler();
    music.panic?.();
    stopNarration();
    panicPerformancePatch();
    panicCapture();
  }
  setStatus(controls.paused ? 'field held' : 'field live');
}

function handleKey(event) {
  const key = event.key.toLowerCase();
  const editing = (
    event.target instanceof HTMLInputElement
    || event.target instanceof HTMLTextAreaElement
    || event.target instanceof HTMLSelectElement
  );
  if (editing) {
    if (scenePanel.contains(event.target) && (event.key === 'Escape' || key === 't')) {
      event.preventDefault();
      event.target.blur();
      setSceneConsole(false);
    }
    if (musicPanel.contains(event.target) && (event.key === 'Escape' || key === 'i')) {
      event.preventDefault();
      event.target.blur();
      setMusicConsole(false);
    }
    if (narrativePanel.contains(event.target) && (event.key === 'Escape' || key === 'z')) {
      event.preventDefault();
      event.target.blur();
      setNarrativeConsole(false);
    }
    return;
  }
  if (event.key === 'Enter' && entry.dataset.hidden !== 'true') {
    event.preventDefault();
    enterSystem();
    return;
  }
  if (key === 'u' && pendingBuildStamp) { event.preventDefault(); applyBuildUpdate(); return; }
  if (event.key === 'Escape' && !updateNotice.hidden) { event.preventDefault(); deferBuildUpdate(); return; }
  if (!musicPanel.hidden && !event.metaKey && !event.ctrlKey && !event.altKey
    && COMPUTER_MUSIC_KEYS[key] !== undefined) {
    event.preventDefault();
    if (!event.repeat) startComputerMusicKey(key);
    return;
  }
  if (calibrationState.active) {
    if (key === 'k' || event.key === 'Escape') { event.preventDefault(); setCalibration(false); return; }
    if (event.key === 'Tab') {
      event.preventDefault();
      calibrationState.selected = (calibrationState.selected + (event.shiftKey ? 3 : 1)) % 4;
      updateCalibrationSurface();
      return;
    }
    if (event.key === '[' || event.key === ']') {
      event.preventDefault();
      adjustCalibration(event.key === ']' ? 1 : -1);
      return;
    }
    if (key === 'm') { toggleMirror(); return; }
  }
  if (event.key === 'Escape' && !entityPanel.hidden) {
    event.preventDefault();
    setEntityConsole(false);
    return;
  }
  if (event.key === 'Escape' && !samplerPanel.hidden) {
    event.preventDefault();
    setSamplerConsole(false);
    return;
  }
  if (event.key === 'Escape' && !framePanel.hidden) {
    event.preventDefault();
    setFrameConsole(false);
    return;
  }
  if (event.key === 'Escape' && !scenePanel.hidden) {
    event.preventDefault();
    setSceneConsole(false);
    return;
  }
  if (event.key === 'Escape' && !musicPanel.hidden) {
    event.preventDefault();
    setMusicConsole(false);
    return;
  }
  if (event.key === 'Escape' && !narrativePanel.hidden) {
    event.preventDefault();
    setNarrativeConsole(false);
    return;
  }
  if (event.key === 'Escape' && !patchPanel.hidden) {
    event.preventDefault();
    setPatchConsole(false);
    return;
  }
  if (event.key === 'Escape' && !capturePanel.hidden) {
    event.preventDefault();
    setCaptureConsole(false);
    return;
  }
  if (key === 'e') { toggleEntityConsole(); return; }
  if (key === 's') { toggleSamplerConsole(); return; }
  if (key === 'g') { toggleFrameConsole(); return; }
  if (key === 't') { toggleSceneConsole(); return; }
  if (key === 'o') { toggleTrace(); return; }
  if (key === 'p') { toggleTrackingTiles(); return; }
  if (key === 'i') { toggleMusicConsole(); return; }
  if (key === 'j') { void activateHandInstrument(); return; }
  if (key === 'z') { toggleNarrativeConsole(); return; }
  if (key === 'q') { togglePatchConsole(); return; }
  if (key === 'l') { toggleCaptureConsole(); return; }
  if (key === 'v') { cycleFrameContentMode(); return; }
  if (key === 'k') { toggleCalibration(); return; }
  if (/^[1-5]$/.test(event.key)) setMode(Number(event.key) - 1);
  else if (event.key === ' ') { event.preventDefault(); togglePause(); }
  else if (event.key.toLowerCase() === 'f') toggleFullscreen();
  else if (event.key.toLowerCase() === 'h') {
    controls.hud = !controls.hud;
    document.body.dataset.hud = String(controls.hud);
  }
  else if (event.key.toLowerCase() === 'd') { controls.debug = !controls.debug; tracking.setDebug?.(controls.debug); }
  else if (event.key.toLowerCase() === 'm') toggleMirror();
  else if (event.key.toLowerCase() === 'c') enableCamera(cameraSelect.value);
  else if (event.key.toLowerCase() === 'a') enableAudio();
  else if (event.key.toLowerCase() === 'n') enableMidi();
  else if (event.key.toLowerCase() === 'r') {
    if (isSceneMode()) {
      const settings = sceneConfigurator.getModeSettings(controls.mode);
      const names = CONFIG.sceneConfigurator.presetOrder;
      const index = Math.max(0, names.indexOf(settings.palette));
      const palette = names[(index + 1) % names.length];
      sceneConfigurator.configure(controls.mode, { palette });
      setStatus(`palette · ${palette}`);
    } else {
      const legacyCount = 4;
      controls.palette = (controls.palette + 1) % legacyCount;
      standardControls.palette = controls.palette;
      setStatus(`palette · ${PALETTES[controls.palette].name}`);
    }
  }
  else if (event.key.toLowerCase() === 'x') {
    panicOutputs();
  }
  else if (event.key === 'Escape' && !document.fullscreenElement) stopSystem();
  else if (event.key === '-' || event.key === '_') nudgeLiveControl('intensity', -0.05);
  else if (event.key === '=' || event.key === '+') nudgeLiveControl('intensity', 0.05);
  else if (event.key === '[') nudgeLiveControl('feedback', -0.012, 0.72, 0.995);
  else if (event.key === ']') nudgeLiveControl('feedback', 0.012, 0.72, 0.995);
  else if (event.key === 'ArrowLeft') setLiveControl('threshold', clamp(controls.threshold - 0.03));
  else if (event.key === 'ArrowRight') setLiveControl('threshold', clamp(controls.threshold + 0.03));
  else if (event.key === 'ArrowDown') setLiveControl('bloom', clamp(controls.bloom - 0.04));
  else if (event.key === 'ArrowUp') setLiveControl('bloom', clamp(
    controls.bloom + 0.04,
    0,
    CONFIG.calibration.safeBloomMax,
  ));
  else if (event.key === '?' || event.key === '/') help.hidden = !help.hidden;
}

function setPointer(event) {
  const rect = stage.getBoundingClientRect();
  controls.pointer.x = clamp((event.clientX - rect.left) / rect.width);
  controls.pointer.y = clamp((event.clientY - rect.top) / rect.height);
}

stage.addEventListener('pointermove', setPointer, { passive: true });
stage.addEventListener('pointerdown', (event) => { setPointer(event); controls.pointer.down = true; });
stage.addEventListener('pointerup', () => { controls.pointer.down = false; });
stage.addEventListener('pointercancel', () => { controls.pointer.down = false; });
window.addEventListener('keydown', handleKey);
window.addEventListener('keyup', (event) => {
  stopComputerMusicKey(event.key.toLowerCase());
});
window.addEventListener('resize', () => { resizeQueued = true; }, { passive: true });
enterButton.addEventListener('click', enterSystem);
enterHandsButton.addEventListener('click', () => {
  enterSystem();
  void activateHandInstrument();
});
cameraSelect.addEventListener('change', () => enableCamera(cameraSelect.value));
applyUpdateButton.addEventListener('click', applyBuildUpdate);
deferUpdateButton.addEventListener('click', deferBuildUpdate);
entityPanel.querySelector('[data-entity-close]').addEventListener('click', () => {
  setButtonState('entities', false);
});
samplerPanel.querySelector('[data-sampler-close]').addEventListener('click', () => {
  setSamplerConsole(false);
});
samplerArmButton.addEventListener('click', () => { void armSampler(); });
samplerRecordButton.addEventListener('click', () => { void toggleSamplerRecording(); });
samplerImportInput.addEventListener('change', (event) => { void importSamplerClip(event); });
samplerNasaButton?.addEventListener('click', () => { void installNasaPocketSet(); });
samplerPanel.querySelector('[data-sampler-panic]').addEventListener('click', panicSampler);
samplerList.addEventListener('click', (event) => { void handleSamplerListClick(event); });
framePanel.querySelector('[data-frame-close]').addEventListener('click', () => setFrameConsole(false));
framePanel.querySelector('[data-frame-dictate]').addEventListener('click', () => {
  const promptInput = framePanel.querySelector('[data-frame-field="prompt"]');
  promptInput?.focus({ preventScroll: true });
  promptInput?.select();
  setStatus('prompt focused · use macOS Dictation (Fn twice) · local recipe updates live');
});
framePanel.querySelector('[data-frame-reset]').addEventListener('click', () => {
  frameConfigurator.reset();
  gestureConfigurator.reset();
  frameZoneConfigurator.reset();
  frameZones.reset(frameZoneClock);
  frameZoneState = null;
  applyFrameSettings(frameConfigurator.getState());
  setStatus('frame field reset · local defaults restored');
});
framePanel.addEventListener('click', handleFrameControl);
framePanel.addEventListener('input', handleFrameControl);
framePanel.addEventListener('change', handleFrameControl);
scenePanel.querySelector('[data-scene-close]').addEventListener('click', () => setSceneConsole(false));
scenePanel.querySelector('[data-scene-reset]').addEventListener('click', () => {
  sceneConfigurator.resetMode(controls.mode);
  setStatus(`scene tune reset · mode ${controls.mode + 1}`);
});
scenePanel.addEventListener('click', handleSceneControl);
scenePanel.addEventListener('input', handleSceneControl);
narrativePanel.querySelector('[data-narrative-close]').addEventListener('click', () => setNarrativeConsole(false));
narrativeGenerateButton.addEventListener('click', () => { void createNarration(); });
narrativePlayButton.addEventListener('click', () => { void playNarration(); });
narrativePanel.querySelector('[data-narrative-stop]').addEventListener('click', () => {
  stopNarration();
  setNarrativeStatus('voice stopped · tracking remains live');
});
narrativeLanguageSelect.addEventListener('change', () => {
  const previous = narrativeLanguageSelect.value === 'en' ? NARRATIVE_TEMPLATES.ru : NARRATIVE_TEMPLATES.en;
  if (narrativeTextInput.value.trim() === previous) narrativeTextInput.value = NARRATIVE_TEMPLATES[narrativeLanguageSelect.value];
  setNarrativeStatus('language changed · edit the visible script before CREATE VOICE');
});
narrativeSourceSelect.addEventListener('change', () => setNarrativeSource(narrativeSourceSelect.value));
narrativePanel.addEventListener('click', (event) => {
  const button = event.target.closest('[data-narrative-source-button]');
  if (!button) return;
  setNarrativeSource(button.dataset.narrativeSourceButton);
});
narrativePanel.addEventListener('input', handleVoiceMemoryControl);
narrativePanel.addEventListener('change', handleVoiceMemoryControl);
narrativeAudio.addEventListener('loadedmetadata', () => {
  if (narrativeState.source === 'generated') return;
  const source = CONFIG.narration.sources[narrativeState.source];
  if (!source) return;
  narrativeMeta.textContent = `${source.label} · ${Math.round(narrativeAudio.duration || 0)}s · local playback`;
});
narrativeAudio.addEventListener('canplay', () => {
  if (narrativeState.source === 'generated') return;
  const source = CONFIG.narration.sources[narrativeState.source];
  if (!source) return;
  narrativePlayButton.disabled = false;
  setNarrativeStatus(`${source.label} ready · PLAY POEM starts your local voice`);
});
narrativeAudio.addEventListener('error', () => {
  const source = CONFIG.narration.sources[narrativeState.source];
  const errorCode = narrativeAudio.error?.code;
  const detail = errorCode === 4
    ? 'format not supported by this browser'
    : 'the local audio file could not be read';
  narrativePlayButton.disabled = false;
  setNarrativeStatus(`${source?.label || 'voice'} unavailable · ${detail}`);
});
narrativeAudio.addEventListener('ended', () => {
  if (voiceMemory.handleEnded()) {
    narrativeProgress.textContent = 'TIME OF POETRY · MEMORY WAITING';
    setNarrativeStatus(voiceMemory.getState().lastEvent);
    return;
  }
  narrativeStage.hidden = true;
  narrativeProgress.textContent = 'TIME OF POETRY · COMPLETE';
  setNarrativeStatus('poetry complete · tracking remains live');
});
musicPanel.querySelector('[data-music-close]').addEventListener('click', () => setMusicConsole(false));
musicPanel.querySelector('[data-music-arm]').addEventListener('click', () => {
  void music.arm().then(renderMusicSurface);
});
musicPanel.querySelector('[data-music-test]').addEventListener('click', () => {
  void music.testOutput().then(renderMusicSurface);
});
musicPanel.querySelector('[data-music-hats]').addEventListener('click', () => {
  const current = music.getState();
  music.setHatsEnabled(!current.hatsEnabled);
  renderMusicSurface();
});
musicPanel.querySelector('[data-music-midi]').addEventListener('click', () => {
  void enableMidi().then(renderMusicSurface);
});
musicPanel.querySelector('[data-music-panic]').addEventListener('click', () => {
  music.panic();
  renderMusicSurface();
});
patchPanel.querySelector('[data-patch-close]').addEventListener('click', () => setPatchConsole(false));
patchToggleButton.addEventListener('click', togglePerformancePatch);
capturePanel.querySelector('[data-capture-close]').addEventListener('click', () => setCaptureConsole(false));
captureRecordButton.addEventListener('click', () => { void toggleCaptureRecording(); });
captureAudioToggle?.addEventListener('change', renderCaptureSurface);
captureTakes.addEventListener('click', handleCaptureTakesClick);
musicPanel.addEventListener('input', handleMusicControl);
musicPanel.addEventListener('change', handleMusicControl);
musicKeyboard.addEventListener('pointerdown', (event) => {
  const key = event.target.closest('[data-music-note]');
  if (!key) return;
  event.preventDefault();
  key.setPointerCapture?.(event.pointerId);
  music.handleMidiEvent({
    type: 'note', note: Number(key.dataset.musicNote), velocity: 0.72,
    channel: 0, device: 'screen keyboard', timestamp: performance.now(),
  });
  renderMusicSurface();
});
function releaseScreenMusicKey(event) {
  const key = event.target.closest?.('[data-music-note]');
  if (!key || key.dataset.active !== 'true') return;
  music.handleMidiEvent({
    type: 'noteoff', note: Number(key.dataset.musicNote), velocity: 0,
    channel: 0, device: 'screen keyboard', timestamp: performance.now(),
  });
  renderMusicSurface();
}
for (const endEvent of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  musicKeyboard.addEventListener(endEvent, (event) => {
    releaseScreenMusicKey(event);
  });
}
window.addEventListener('blur', () => {
  for (const key of [...computerMusicDown.keys()]) stopComputerMusicKey(key);
  for (const note of music.getState().activeNotes || []) {
    if (note.device !== 'screen keyboard') continue;
    music.handleMidiEvent({
      type: 'noteoff', note: note.note, velocity: 0,
      channel: note.channel, device: note.device, timestamp: performance.now(),
    });
  }
});

controlsBar.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  const action = button?.dataset.action;
  if (action === 'mode') setMode(Number(button.dataset.mode));
  if (action === 'camera') enableCamera(cameraSelect.value);
  if (action === 'hands') void activateHandInstrument();
  if (action === 'narrative') toggleNarrativeConsole();
  if (action === 'audio') enableAudio();
  if (action === 'midi') enableMidi();
  if (action === 'entities') toggleEntityConsole();
  if (action === 'sampler') toggleSamplerConsole();
  if (action === 'frame') toggleFrameConsole();
  if (action === 'scene') toggleSceneConsole();
  if (action === 'tiles') toggleTrackingTiles();
  if (action === 'trace') toggleTrace();
  if (action === 'music') toggleMusicConsole();
  if (action === 'patch') togglePatchConsole();
  if (action === 'capture') toggleCaptureConsole();
  if (action === 'calibration') toggleCalibration();
  if (action === 'fullscreen') toggleFullscreen();
  if (action === 'panic') panicOutputs();
  if (action === 'help') help.hidden = !help.hidden;
  if (action === 'advanced') {
    const open = document.body.dataset.advanced !== 'true';
    document.body.dataset.advanced = String(open);
    setButtonState('advanced', open);
    setStatus(open ? 'lab controls visible' : 'core performance controls');
  }
});

function connectLiveReload() {
  document.documentElement.dataset.server = 'public-static';
}

const restoredPerformance = restorePerformanceState();
preferredCameraDeviceId = String(restoredPerformance?.cameraDeviceId || '');
document.body.dataset.hud = String(controls.hud);
document.body.dataset.advanced = 'false';
document.documentElement.dataset.update = 'current';
if (restoredPerformance?.entryHidden) entry.dataset.hidden = 'true';
tracking.setDebug?.(controls.debug);
const restoredMirror = tracking.getFrame?.()?.camera?.mirrored;
if (typeof restoredMirror === 'boolean' && restoredMirror !== controls.mirrored) tracking.toggleMirror?.();
updateCalibrationSurface();
updateTraceButton();
updateTrackingTilesButton();
overlayCanvas.dataset.trace = String(controls.trace);
overlayCanvas.dataset.trackingTiles = String(controls.trackingTiles);
setMode(controls.mode);
if (restoredPerformance?.sceneOpen) setSceneConsole(true);
loadPerformancePatch();
resize();
document.documentElement.dataset.server = 'archive';
requestAnimationFrame(frame);

// Device enumeration is permissionless. Camera, mic and MIDI remain explicit controls.
refreshCameraDevices();
globalThis.navigator?.mediaDevices?.addEventListener?.('devicechange', handleCameraDeviceChange);
updateInputRitual();
renderSamplerSurface();
renderMusicSurface();
renderCaptureSurface();
renderPatchSurface();
void sampler.loadClips().then(() => {
  samplerLibraryLoaded = true;
  renderSamplerSurface();
  updateInputRitual();
});
if (restoredPerformance?.cameraActive) {
  setInputState('camera', 'standby', 'resume intent · press C');
  setStatus('performance restored · press C to resume the selected camera');
} else {
  setStatus('pointer field online · inputs disarmed');
}

window.addEventListener('beforeunload', () => {
  globalThis.navigator?.mediaDevices?.removeEventListener?.('devicechange', handleCameraDeviceChange);
  liveReloadSource?.close?.();
  tracking.destroy?.();
  audioMidi.destroy?.();
  samplerLibraryLoaded = false;
  sampler.destroy();
  performanceMapper.destroy();
  frameConfigurator.destroy();
  gestureConfigurator.destroy();
  frameZoneConfigurator.destroy();
  sceneConfigurator.destroy();
  music.destroy();
  panicCapture();
  performanceRecorder.destroy();
  performancePatchHost.destroy();
  frameZones.destroy();
  gestureFrame.destroy();
  frameContent.destroy();
  frameObjectCrop.destroy();
  voiceMemory.destroy();
  samplerSession.destroy();
  renderer.destroy?.();
  overlay.destroy();
  entityConsole.destroy();
});
