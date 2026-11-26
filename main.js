import { studioOnly } from './studio-only.js';
import { cueBuildDecision } from './cue-build.js';
import { defaultGeometry, liveCuePatch, normalizeGeometry, normalizeShadow } from './geometry-mix.js';
import { bindGeometryControls } from './geometry-controls.js';
import { createStageAgent } from './stage-agent.js';
import { createStoryPlanner, createStoryVersions, storyChanges } from './story-variants.js';
import { createGuestPart } from './stage-guest.js';
import { latticeAnchors, measuredFace, measuredFaceAnchors, scoreAnchors, pinPosition, nearestNode, placePin } from './lattice.js';
import { createAtmosphere } from './atmosphere.js';
import { airVoiceLevel, inputSourceLabel } from './input-source.js';
import { saveRecovery, readRecovery } from './session-recovery.js';
import { normalizeDayContext, sampleDayContext } from './day-context.js';
import { createSpeechTrace } from './speech-trace.js';
import { createParticlesOrchestra, ORCHESTRA_KEYS } from './particles-orchestra.js';
import { createDemoAccompaniment } from './demo-accompaniment.js';
import { createHeldFingerRanges } from './finger-score.js';
import { rehearsalCurls } from './performance-etching.js';
import { createShaperDemoScore, aftervoiceAnswer } from './shaper-demo-score.js';
import { bindClips } from './clips.js';
import { createStoryPractice } from './story-practice.js';
import { createSacredPattern } from './sacred-pattern.js';
import { createVersionLibrary } from './experiment-versions.js';
import { createLiveLab } from './live-lab.js';
import { createRoomGeometry } from './room-geometry.js';
import { createObjectFocus } from './object-focus.js';
import { CONFIG, MODES, PALETTES, clamp } from './config.js';
import { createTrackingEngine } from './tracking.js';
import { createAudioMidiEngine } from './audio-midi.js';
import { createWagnerScore, bindWagnerControls } from './wagner-score.js';
import { createRenderer } from './renderer.js';
import { createOverlay } from './overlay.js';
import { createEntityConsole } from './entity-console.js';
import { createSamplerEngine } from './sampler-engine.js';
import { arrangementTempo, createSceneArrangement } from './scene-arrangement.js';
import { createSectorDeck, createSectorInput } from './kosmodrom.js';
import { createSamplerSession } from './sampler-session.js';
import { createSamplerSceneSlots } from './sampler-scene-slots.js';
import { createNonRepeatingClipSequence } from './non-repeating-clip-sequence.js';
import { createPerformanceMapper } from './performance-mapping.js';
import { createGestureFrame } from './gesture-frame.js';
import { createFrameContentController } from './frame-content.js';
import { createFrameConfigurator } from './frame-configurator.js';
import { createFrameObjectCrop } from './frame-object-crop.js';
import { createGestureConfigurator } from './gesture-configurator.js';
import { createFrameZoneConfigurator } from './frame-zone-configurator.js';
import { createFrameZoneEvents } from './frame-zone-events.js';
import { createSceneConfigurator } from './scene-configurator.js';
import { createPerformanceRecorder } from './performance-recorder.js';
import { createScoreRecorder } from './score-recorder.js';
import { createVenueProfileStore, matchVenueProfile } from './venue-profile.js';
import { createLocalBridge } from './local-bridge.js';
import { createAccessibilityProfileStore } from './accessibility-profile.js';
import { createAdaptiveQualityController } from './adaptive-quality.js';
import { createPerformancePatchHost } from './performance-patch.js';
import { createLocalPerformancePatchAdapter } from './performance-patch-local-adapter.js';
import { deriveStageCheck, ROOM_RECEIPT_ITEMS, summarizeRoomReceipt } from './stage-check.js';
import { createReleaseRecord, deriveReleaseGate, normalizeReleaseRecord } from './release-gate.js';
import { createVoiceMemory } from './voice-memory.js';
import { createVoiceCaptionEngine } from './voice-caption.js';
import { createMicCalibration } from './mic-calibration.js';
import { createFingerCalibration } from './finger-calibration.js';
import { createFingerEnvelope } from './finger-envelope.js';
import { createMpeOutputBridge } from './mpe-output.js';
import { createRoiFeatureLock } from './roi-feature-lock.js';
import { createSubjectRoute } from './subject-route.js';

const { createMusicEngine } = await import('./music-engine.js').catch(() => ({
  createMusicEngine: createUnavailableMusicEngine,
}));

const $ = (selector) => document.querySelector(selector);
const stage = $('#stage');
const presets = CONFIG.performancePresets;
const SACRED_SETTINGS = 'mythtrace.sacred.v1';
function readLocal(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLocal(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
const versionLibrary = createVersionLibrary({ getItem: readLocal, setItem: writeLocal }, presets);
const sacredDetector = createSacredPattern(presets.sacred.detection);
let archivedSacred = Object.keys(presets.sacred.shapes).filter(id => versionLibrary.archived('sacred:' + id));
let lastSacredCue = '', lastSacredNoteAt = -Infinity;
let micRequested = false, micPending = false;
let phraseCapture = false, phraseAuto = readLocal('mythtrace.phrase-auto.v1') !== 'false';
let gesturePhrase = [], lastPhrasePinch = -Infinity;
const orchestraPhrases = new Map();
try {
  const saved = JSON.parse(readLocal('mythtrace.phrases.v1') || '{}');
  for (const id of Object.keys(presets.music)) {
    const notes = parsePhrase(Array.isArray(saved?.[id]) ? saved[id].join(' ') : '');
    if (notes) orchestraPhrases.set(id, notes);
  }
} catch {}
let geometryPreset = '';
let orchestraPreset = 'glass';
let orchestraPace = presets.music[orchestraPreset].pace;
const orchestraProfiles = new Map();
const video = $('#camera');
const workflowRail = $('#stage-workflows');
const storyPanel = $('#story-preview');
const storyPractice = createStoryPractice(storyPanel);
const cardDeck = $('#card-deck');
const memoryCard = $('[data-story-cue="memory"]');
let storyOpener = null;
const gestureFilm = $('[data-story-film]');
const watchGesture = $('[data-story-watch]');
let previewStory = '';
const storyVersions = createStoryVersions({ getItem: readLocal, setItem: (key, value) => localStorage.setItem(key, value) }, CONFIG.storyVariants.storageKey);
const storyPlanner = createStoryPlanner();
const storyManualMotifs = new Set();
const workflowPreference = 'mythtrace.workflow.v1';
const modePreference = 'mythtrace.visual-mode.v1';
const focusControls = $('#focus-geometry');
const focusGuide = $('#focus-guide');
const focusChoices = ['auto', 'rosette', 'plane', 'crystal'];
const roomStatus = $('#room-status');
const objectStatusOutput = $('#object-status');
const objectFocus = createObjectFocus(CONFIG.tracking.minObjectScore);
const focusCameraButton = $('[data-focus-camera]');
const nodeInspector = $('#node-inspector');
const nodeSummary = $('#node-summary');
const nodeList = $('#node-list');
const nodeButton = $('[data-stage-nodes]');
const bodyMaterialInput = $('[data-body-material]');
const backgroundSettings = $('#stage-background');
const roomGeometry = createRoomGeometry();
let workflow = 'face';
let workflowCue = '';
let roomPointerActive = false;
let cameraSelectionRequest = 0;
let cameraPending = false;
let macCameraId = '';
let cameraInventory = [], cameraInventoryRevision = 0, cameraPickerSignature = '';
let cameraSwitchError = '', cameraOpener = null;
const cameraSources = $('#camera-sources');
const CAMERA_PREF = 'mythtrace.camera.selection.v1';
const FOCUS_PREF = 'mythtrace.focus.options.v1';
const glCanvas = $('#gl');
const overlayCanvas = $('#overlay');
const liveLab = createLiveLab($('#live-lab'), $('#diffusion-layer'), glCanvas);
const entry = $('#entry');
const demoPanel = $('#shaper-demo');
const demoButton = $('[data-action="demo"]');
const demoTitle = $('[data-demo-title]');
const demoGuide = $('[data-demo-guide]');
const demoSource = $('[data-demo-source]');
const demoSoundButton = $('[data-demo-sound]');
const demoProgress = $('[data-demo-progress]');
const demoAmount = $('[data-demo-amount]');
const demoMic = $('[data-demo-mic]');
const demoFrame = $('[data-demo-frame]');
const demoLine = $('[data-demo-line]');
let shaperDemo = null;
const enterHandsButton = $('#enter-hands');
const entryPointer = $('#entry-pointer');
const cameraActionLabel = stage.querySelector('[data-camera-action-label]');
const entryPointerLabel = entryPointer?.querySelector('span');
const entryStatus = $('#entry-status');
const inputRitual = $('#input-ritual');
const cameraSelect = $('#camera-select');
const micSelect = $('#mic-select');
const micLevelOutput = $('#mic-level');
const captionLanguageSelect = $('#caption-language');
const cameraLabelNote = $('#camera-label-note');
const controlsBar = $('#controls');
const setupPanel = $('#instrument-setup');
const modeButtons = [...controlsBar.querySelectorAll('[data-action="mode"]')];
const primaryPanels = {
  setup: { id: 'instrument-setup', action: 'advanced' },
  frame: { id: 'frame-console', action: 'frame-setup' },
  music: { id: 'music-console', action: 'music' },
  geometry: { id: 'patch-console', action: 'patch' },
  look: { id: 'scene-console', action: 'scene' },
};
const stageTrackingStatus = $('[data-tracking-status]');
const stageMode = $('#stage-mode');
const stageLiveStatus = $('#stage-live-status');
const focusNavigator = $('#focus-navigator');
const focusLabel = $('[data-focus-label]');
const focusPosition = $('[data-focus-position]');
const focusPreviousButton = $('[data-focus-previous]');
const focusNextButton = $('[data-focus-next]');
const focusReleaseButton = $('[data-focus-release]');
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
const samplerSceneList = $('[data-sampler-scene-list]');
const samplerSequenceButton = $('[data-sampler-sequence]');
const samplerSequenceStatus = $('[data-sampler-sequence-status]');
const samplerTextureButton = $('[data-sampler-texture]');
const samplerTextureStatus = $('[data-sampler-texture-status]');
const samplerTextureFields = [...document.querySelectorAll('[data-sampler-texture-field]')];
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
const narrativeMemoryPhrase = $('[data-voice-memory-phrase]');
const narrativeMemoryMarkButton = $('[data-voice-memory-mark]');
const narrativeMemoryOpeningButton = $('[data-voice-memory-opening]');
const liveCaption = $('#live-caption');
const liveCaptionText = $('[data-live-caption-text]');
const liveCaptionStatus = $('[data-live-caption-status]');
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
const micCalibrationPanel = $('#mic-calibration');
const micCalibrationStatus = $('[data-mic-calibration-status]');
const micCalibrationCurrent = $('[data-mic-calibration-current]');
const micCalibrationPeak = $('[data-mic-calibration-peak]');
const micCalibrationFloor = $('[data-mic-calibration-floor]');
const micCalibrationSpeech = $('[data-mic-calibration-speech]');
const micCalibrationProgress = $('[data-mic-calibration-progress]');
const micMonitorPresetButtons = [...document.querySelectorAll('[data-mic-monitor-preset]')];
const micMonitorPresetStatus = $('[data-mic-monitor-preset-status]');
const voiceGamePanel = $('#voice-game');
const voiceGameStatus = $('[data-voice-game-status]');
const voiceGameCaptureButton = $('[data-voice-game-capture]');
const voiceGamePresetButtons = [...document.querySelectorAll('[data-voice-game-preset]')];
const voiceGamePassButtons = [...document.querySelectorAll('[data-voice-game-passes]')];
const voiceGameSlotButtons = [...document.querySelectorAll('[data-voice-game-slot]')];
const presenceButton = $('[data-presence-toggle]');
const presenceStatus = $('[data-presence-status]');
const audioDiagnosticPanel = $('[data-audio-diagnostics]');
const audioContextOutput = $('[data-audio-context]');
const audioLatencyOutput = $('[data-audio-latency]');
const audioPeakOutput = $('[data-audio-peak]');
const audioClipOutput = $('[data-audio-clip]');
const audioDiagnosticStatus = $('[data-audio-diagnostic-status]');
const fingerCalibrationPanel = $('#finger-calibration');
const fingerCalibrationStatus = $('[data-finger-calibration-status]');
const fingerCalibrationProgress = $('[data-finger-calibration-progress]');
const fingerProfileOutputs = [...document.querySelectorAll('[data-finger-profile]')];
const fingerEnvelopePanel = $('#finger-envelopes');
const mpeOutputPanel = $('#mpe-output');
const mpeOutputToggle = $('[data-mpe-enable]');
const mpeOutputSelect = $('[data-mpe-output-select]');
const mpeOutputStatus = $('[data-mpe-status]');
const mpeOutputActivity = $('[data-mpe-activity]');
const capturePanel = $('#capture-console');
const captureRecordButton = $('[data-capture-record]');
const captureAudioToggle = $('[data-capture-audio]');
const captureStatusOutput = $('[data-capture-status]');
const captureTakes = $('[data-capture-takes]');
const captureCapacity = $('[data-capture-capacity]');
const scoreRecordButton = $('[data-score-record]');
const scoreStopButton = $('[data-score-stop]');
const scoreClearButton = $('[data-score-clear]');
const scoreDownloadButton = $('[data-score-download]');
const scoreStatusOutput = $('[data-score-status]');
const scoreEventsOutput = $('[data-score-events]');
const scoreCapacityOutput = $('[data-score-capacity]');
const patchPanel = $('#patch-console');
const agentPanel = $('#stage-agent');
const patchToggleButton = $('[data-patch-toggle]');
const patchStatusOutput = $('[data-patch-status]');
const patchAxesOutput = $('[data-patch-axes]');
const localBridgeStatus = $('[data-local-bridge-status]');
const localBridgeUrl = $('[data-local-bridge-url]');
const localBridgeConnect = $('[data-local-bridge-connect]');
const localBridgeDisconnect = $('[data-local-bridge-disconnect]');
const calibrationPanel = $('#calibration');
const calibrationBlack = $('#calibration-black');
const calibrationWhite = $('#calibration-white');
const calibrationBloom = $('#calibration-bloom');
const calibrationMirror = $('#calibration-mirror');
const help = $('#help');
const helpPreflight = $('[data-help-preflight]');
const stageCheckOutput = $('[data-stage-check]');
const stageReceiptInputs = [...document.querySelectorAll('[data-stage-receipt]')];
const stageReceiptStatus = $('[data-stage-receipt-status]');
const stageReceiptClear = $('[data-stage-receipt-clear]');
const releaseGatePanel = $('.help__release-gate');
const releaseStatus = $('[data-release-status]');
const releaseSoftware = $('[data-release-software]');
const releaseBuild = $('[data-release-build]');
const releaseRoom = $('[data-release-room]');
const releaseBind = $('[data-release-bind]');
const releaseFreeze = $('[data-release-freeze]');
const releaseClear = $('[data-release-clear]');
const venueProfilePanel = $('.help__venue-profile');
const venueProfileName = $('[data-venue-profile-name]');
const venueProfileStatus = $('[data-venue-profile-status]');
const venueProfileRoutes = [...document.querySelectorAll('[data-venue-profile-route]')];
const venueProfileSave = $('[data-venue-profile-save]');
const venueProfileApply = $('[data-venue-profile-apply]');
const venueProfileClear = $('[data-venue-profile-clear]');
const accessibilityStatus = $('[data-accessibility-status]');
const accessibilityButtons = [...document.querySelectorAll('[data-accessibility-setting]')];
const qualityStatus = $('[data-quality-status]');
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
  ru: `кто остаётся,
когда тело выходит из кадра?

я вижу тебя,
пока ты меняешь свет.
каждый палец открывает отдельную память.
каждая нота доказывает:
ты ещё здесь.

я называю это трекингом.
ты называешь это присутствием.

между нами –
задержка в несколько кадров.
в ней лицо отделяется от лица,
голос – от говорящего,
жест – от того,
кто его сделал.

ты исчезаешь первым.
следом уходит звук.
дольше всех держится рамка –
последняя уверенность машины.

память повторяет.
но помнит ли она?

поле знает координаты тела.
встретило ли оно человека?

ответа нет.
я держу твоё место,
пока пустота
не становится точнее тебя.`,
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

const UPDATE_STATE_KEY = 'mythtrace.performance-state.v1';
const STAGE_RECEIPT_KEY = 'mythtrace.stage-receipt.v1'; // gitleaks:allow browser-local settings identifier
const COMPUTER_MUSIC_KEYS = Object.freeze({
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6,
  g: 7, y: 8, h: 9, u: 10, k: 12,
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
    armed: false, droneEnabled: false, silent: true, silentReason: 'music engine loading · current stage remains live',
    preset: 'rhodes', scale: 'minor-pentatonic', activeNotes: Object.freeze([]),
    voiceCount: 0, gate: 0, master: 0, cutoff: 0, delaySend: 0, lastEvent: 'loading',
  });
  const report = () => onStatus?.({ message: state.silentReason });
  return Object.freeze({
    arm: async () => { report(); return state; },
    startDrone: async () => { report(); return state; },
    stopDrone: () => state,
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
  mode: CONFIG.defaultMode,
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
  trackingTiles: false,
  lightScore: { ...defaultGeometry },
  reducedMotion: false,
  quality: CONFIG.adaptiveQuality.levels[CONFIG.adaptiveQuality.initialLevel],
  pointer: { x: 0.5, y: 0.5, down: false },
  clipActive: false,
  clipTracking: false,
  clipEffects: .42,
  room: null,
  roomEnabled: readLocal('mythtrace.room-layer.v1') === 'true',
  focusField: false,
  shaperQuiet: true,
  geometryMuted: readLocal('mythtrace.geometry-muted.v1') === 'true',
  sacredLayer: 'off',
  sacredLiveShape: 'off',
  sacredFacet: 0,
  sacredPins: [],
  sacredSound: readLocal('mythtrace.sacred-sound.v1') !== 'false',
  sacredStrength: presets.sacred.strength,
  focusGeometry: 'auto',
  focusCue: 0,
  focusPlaying: false,
  inspectNodes: false,
  bodyMaterial: CONFIG.lightScore.bodyMaterial,
  stageNodes: [],
  liveLab,
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
  micDeviceId: '',
  monitorActive: false,
  monitorPreset: CONFIG.audio.monitor.defaultPreset,
  monitorWet: CONFIG.audio.monitor.presets[CONFIG.audio.monitor.defaultPreset].echoWet,
  monitorFeedback: CONFIG.audio.monitor.presets[CONFIG.audio.monitor.defaultPreset].echoFeedback,
  audioContextState: 'not-created',
  sampleRate: 0,
  baseLatencyMs: 0,
  outputLatencyMs: 0,
  estimatedLatencyMs: 0,
  latencySource: 'unavailable',
  latencyStatus: 'unavailable',
  inputPeak: 0,
  inputPeakHold: 0,
  inputPeakDb: CONFIG.audio.diagnostics.floorDb,
  inputHeadroom: 'silent',
  clipActive: false,
  clipEvents: 0,
  clipSamples: 0,
  rawRms: 0,
  micFloor: CONFIG.audio.floor,
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
  voiceGame: {
    preset: CONFIG.audio.voiceGame.defaultPreset,
    passes: CONFIG.audio.voiceGame.defaultPasses,
    recording: false,
    active: false,
    activeRuns: 0,
    energy: 0,
    slots: [],
    maxSlots: CONFIG.audio.voiceGame.maxSlots,
    maxCaptureSeconds: CONFIG.audio.voiceGame.maxCaptureSeconds,
    lastEvent: 'voice game ready · silent',
    supported: Boolean(globalThis.MediaRecorder),
  },
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
let geometryControls;
let latticeDrag = null;
const presence = { enabled: false, starting: false, busy: false, startedMic: false, above: 0, lastSpeech: 0, rest: 0 };
let applyAfterCapture = false;
let samplerStopPending = false;
let lastFrameAt = performance.now();
let frozenTime = 0;
let trackingFrame = emptyTracking;
let audioFrame = emptyAudio;
let resizeQueued = true;
let lastQualitySurfaceAt = 0;
let pendingBuildStamp = '';
let currentBuildStamp = '';
let releaseBuildLoading = false;
let liveReloadSource = null;
let tracking;
let audioMidi;
let stageMusicSource = 'orchestra';
let airMicReactive = false;
let roomMusicActive = false, roomMusicOwnedInput = false;
let airMicOwnedInput = false;
let airProfile = ['air','focus','bass'].includes(readLocal('mythtrace.air-profile.v1')) ? readLocal('mythtrace.air-profile.v1') : 'air';
let dayData = null, dayEnabled = false, dayPreview = null, lastDayTick = -Infinity;
const atmosphereSettingInputs = [...musicPanel.querySelectorAll('[data-atmosphere-setting]')];
const atmosphereSettings = {};
let musicStartPending = false;
let musicStartGeneration = 0;
const MUSIC_SETTINGS_KEY = 'mythtrace.music-controls.v1';
const musicSettingFields = ['preset', 'scale', 'master', 'cutoff', 'delaySend', 'saturation',
  'handRole', 'fingerSensitivity', 'fingerOctaveScene'];
let sampler;
let samplerScenes;
let samplerSequence;
let samplerTextureState = restoreSamplerTextureState();
let performanceRecorder;
let scoreRecorder;
let venueProfileStore;
let localBridge;
let accessibilityProfileStore;
let adaptiveQuality;
let performanceMapper;
let frameConfigurator;
let gestureConfigurator;
let frameZoneConfigurator;
let sceneConfigurator;
let music;
let voiceMemory;
let voiceCaption;
const speechTrace = createSpeechTrace();
const speechTraceNodes = new Map();
let micCalibration;
let fingerCalibration;
let fingerEnvelope;
let mpeOutput;
let renderer;
let scoreFocusId = '';
let gestureFrameState = null;
let framePerformanceArmed = false;
let framePointerId = null;
let manualFrame = null;
const frameOrigin = { x: 0, y: 0 };
let frameContentState = null;
let frameObjectCropState = null;
let subjectRouteState = null;
let frameZoneState = null;
let frameContentMode = CONFIG.frameContent.mode;
let frameSoundEvents = 0;
let frameZoneEvents = 0;
let frameZoneClock = 0;
let generatedFrameBackground = Object.freeze({ image: null, prompt: '', seed: null, state: 'local recipe active · no network request' });
let generatedFrameRequestId = 0;
let latestEntitySettings = null;
let samplerArmed = false;
let samplerLibraryLoaded = false;
let selectedGestureClipId = restorePerformanceMappingState();
let selectedGestureClipLabel = '';
let lastMappingSurfaceAt = -Infinity;
let lastMusicSurfaceAt = -Infinity;
let lastAirSurfaceAt = -Infinity;
let lastMicSurfaceAt = -Infinity;
let lastFrameSurfaceAt = -Infinity;
let micCalibrationMonitorRestore = false;
let micCalibrationAppliedAt = 0;
let micCalibrationRevision = -1;
let micMonitorPresetId = CONFIG.audio.monitor.defaultPreset;
let captureStream = null;
let captureStartPending = false;
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
  timestamp: 0, handRoute: 0, framePhase: 'searching', event: null, range: null, subjectRange: null,
};
const holdFingers = createHeldFingerRanges();
const mappingRuntime = {
  events: 0, ranges: 0, filter: 0, delaySend: 0, playbackRate: 1,
};
const gestureMusicRuntime = {
  events: 0, pinch: 0, openness: 0, spread: 0, curl: 0, motion: 0, harmony: 0,
};
let preferredCameraDeviceId = '';
let preferredMicDeviceId = '';
let latestTrackingStatus = { status: 'idle' };
let stageCheckPanicAt = 0;
let stageCheckUpdatedAt = -Infinity;
let stageCheckModelStates = {};
let latestSamplerStatus = { state: 'silent', message: 'silent · sound disarmed' };
const latestAudioStatus = {
  mic: { state: 'standby', message: 'standby' },
  midi: { state: 'standby', message: 'standby' },
};

function setStatus(message) {
  const text = String(message || '');
  const entryVisible = entry.dataset.hidden !== 'true';
  const entryFailure = /\b(error|unavailable|denied|failed)\b/i.test(text);
  entryStatus.textContent = entryVisible && !entryFailure
    ? 'pointer field online · inputs disarmed'
    : text;
  if (stageLiveStatus) stageLiveStatus.textContent = text;
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

function restoreSamplerTextureState() {
  const settings = CONFIG.sampler.texture;
  const fallback = {
    enabled: settings.defaultEnabled,
    grainSizeSeconds: settings.grainSizeDefaultSeconds,
    scatter: settings.scatterDefault,
  };
  try {
    const raw = JSON.parse(localStorage.getItem(settings.storageKey) || 'null');
    if (raw?.version !== settings.schemaVersion) return fallback;
    const grainSizeSeconds = Number(raw.grainSizeSeconds);
    const scatter = Number(raw.scatter);
    return {
      enabled: Boolean(raw.enabled),
      grainSizeSeconds: Number.isFinite(grainSizeSeconds)
        ? clamp(grainSizeSeconds, settings.grainSizeMinSeconds, settings.grainSizeMaxSeconds)
        : fallback.grainSizeSeconds,
      scatter: Number.isFinite(scatter) ? clamp(scatter, 0, settings.scatterMax) : fallback.scatter,
    };
  } catch {
    return fallback;
  }
}

function persistSamplerTextureState() {
  try {
    localStorage.setItem(CONFIG.sampler.texture.storageKey, JSON.stringify({
      version: CONFIG.sampler.texture.schemaVersion,
      ...samplerTextureState,
    }));
    samplerPanel.dataset.texturePersisted = 'true';
  } catch {
    samplerPanel.dataset.texturePersisted = 'false';
  }
}

function restoreVoiceMemorySettings() {
  const settings = CONFIG.narration.memory;
  try {
    const raw = JSON.parse(localStorage.getItem(settings.storageKey) || 'null');
    if (raw?.version !== settings.schemaVersion || !raw.settings || typeof raw.settings !== 'object') return {};
    return raw.sourceId === narrativeState.source
      ? raw.settings
      : { ...raw.settings, phraseStartSeconds: settings.phraseStartSeconds };
  } catch {
    return {};
  }
}

function persistVoiceMemorySettings() {
  try {
    localStorage.setItem(CONFIG.narration.memory.storageKey, JSON.stringify({
      version: CONFIG.narration.memory.schemaVersion,
      sourceId: narrativeState.source,
      settings: voiceMemory?.getState?.().settings || {},
    }));
    narrativePanel.dataset.memoryPersisted = 'true';
  } catch {
    narrativePanel.dataset.memoryPersisted = 'false';
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
  const button = controlsBar.querySelector(`[data-action="${action}"]`)
    || setupPanel.querySelector(`[data-action="${action}"]`);
  if (button) button.dataset.on = String(Boolean(on));
}

function syncPanelButtons() {
  for (const { id, action } of Object.values(primaryPanels)) {
    const open = !document.getElementById(id).hidden;
    setButtonState(action, open);
    const button = controlsBar.querySelector(`[data-action="${action}"]`);
    button?.setAttribute('aria-expanded', String(open));
  }
}

function closeSetupPanel() {
  if (!setupPanel.hidden) setSetupConsole(false);
}

function setSetupConsole(open) {
  if (open) closeInstrumentPanels();
  setupPanel.hidden = !open;
  if (open) { renderStageTracking(tracking.getFrame()); void refreshCameraDevices(); }
  syncPanelButtons();
}

function closeInstrumentPanels() {
  if (calibrationState.active) setCalibration(false);
  if (!narrativePanel.hidden) setNarrativeConsole(false);
  if (!entityPanel.hidden) setEntityConsole(false);
  if (!samplerPanel.hidden) setSamplerConsole(false);
  if (!framePanel.hidden) setFrameConsole(false);
  if (!scenePanel.hidden) setSceneConsole(false);
  if (!musicPanel.hidden) setMusicConsole(false);
  if (!patchPanel.hidden) setPatchConsole(false);
  if (!capturePanel.hidden) setCaptureConsole(false);
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
        ? `unavailable · ${String(camera.error).slice(0, 80)} · pointer active`
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
  if (faceState === 'live') setInputState('face', 'live', faceCount ? `${faceCount} face · dedicated landmarks` : 'model ready · searching');
  else if (faceState === 'ready') setInputState('face', 'ready', 'dedicated model ready · camera offline');
  else if (faceState === 'loading') setInputState('face', 'loading', 'dedicated model loading');
  else if (faceState === 'unavailable' && poseState === 'live') setInputState('face', 'live', 'pose fallback · dedicated unavailable');
  else if (faceState === 'unavailable') setInputState('face', 'unavailable', 'dedicated model unavailable');
  else if (poseState === 'live') setInputState('face', 'live', 'pose fallback ready');
  else setInputState('face', 'waiting', 'waiting for dedicated model');

  const audio = audioMidi?.getFrame?.() || audioFrame;
  const micState = audio.micActive ? 'live' : latestAudioStatus.mic.state;
  const midiState = audio.midiActive ? 'live' : latestAudioStatus.midi.state;
  const micLabel = micSelect?.selectedOptions?.[0]?.textContent || 'default microphone';
  setInputState('mic', micState, audio.micActive
    ? `live · ${micLabel} · ${audio.monitorActive ? `monitor ${audio.monitorPreset}` : 'analysis only'}`
    : latestAudioStatus.mic.message);
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
  stageCheckModelStates = { hand: handState, pose: poseState, face: faceState, object: objectState };
  updateStageCheck(stageCheckModelStates);
  if (!help.hidden) renderVenueProfile();
}

function updateStageCheck(modelStates = {}) {
  if (!stageCheckOutput) return;
  const check = deriveStageCheck({
    tracking: trackingFrame,
    audio: audioMidi?.getFrame?.() || audioFrame,
    music: music?.getState?.() || {},
    capture: performanceRecorder?.getState?.() || {},
    renderer: renderer?.getStats?.() || {},
    narrative: { playing: Boolean(narrativeAudio && !narrativeAudio.paused && !narrativeAudio.ended) },
    frameCrop: frameObjectCropState || {},
    modelStates,
    panicAt: stageCheckPanicAt,
    now: performance.now(),
  });
  stageCheckOutput.replaceChildren(...check.items.map((item) => {
    const line = document.createElement('li');
    line.dataset.state = item.state;
    line.textContent = item.text;
    return line;
  }));
  stageCheckOutput.dataset.roomNote = check.roomNote;
  stageCheckUpdatedAt = performance.now();
}

function restoreStageReceipt() {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(STAGE_RECEIPT_KEY) || '{}');
    const receipt = {};
    for (const item of ROOM_RECEIPT_ITEMS) receipt[item.id] = stored?.[item.id] === true;
    receipt.timestamp = Number(stored?.timestamp) || 0;
    receipt.buildStamp = String(stored?.buildStamp || '').slice(0, 80);
    return receipt;
  } catch {
    return { timestamp: 0, buildStamp: '' };
  }
}

let stageReceipt = restoreStageReceipt();

function restoreReleaseRecord() {
  try {
    return normalizeReleaseRecord(
      JSON.parse(globalThis.localStorage?.getItem(CONFIG.releaseGate.storageKey) || 'null'),
      CONFIG.releaseGate.schemaVersion,
    );
  } catch {
    return null;
  }
}

let releaseRecord = restoreReleaseRecord();

function releaseGateState() {
  return deriveReleaseGate({
    software: CONFIG.releaseGate.software,
    roomReceipt: stageReceipt,
    currentBuildStamp,
    receiptBuildStamp: stageReceipt.buildStamp,
    pendingBuildStamp,
    releaseRecord,
    schemaVersion: CONFIG.releaseGate.schemaVersion,
  });
}

function renderReleaseGate() {
  if (!releaseGatePanel) return;
  const gate = releaseGateState();
  const software = CONFIG.releaseGate.software;
  releaseGatePanel.dataset.releaseState = gate.status;
  releaseSoftware.textContent = `software · ${software.javascriptTests} JS · ${software.pythonTests} PY · ${software.browserSuites} browser · ${software.enduranceMinutes}:00`;
  releaseBuild.textContent = currentBuildStamp
    ? `build · ${currentBuildStamp}${gate.bound ? ' · room bound' : ''}`
    : `build · ${releaseBuildLoading ? 'reading localhost stamp' : 'stamp unavailable'}`;
  releaseRoom.textContent = `room · ${gate.room.count}/${gate.room.total} observed${gate.missing.length ? ` · missing ${gate.missing.join('/')}` : ''}`;
  if (gate.frozenCurrent) {
    releaseStatus.textContent = `frozen · ${new Date(gate.frozen.frozenAt).toLocaleString()}`;
  } else if (gate.ready) {
    releaseStatus.textContent = 'ready · exact build may be frozen';
  } else if (gate.pendingBuildStamp) {
    releaseStatus.textContent = `blocked · pending build ${gate.pendingBuildStamp}`;
  } else if (!currentBuildStamp) {
    releaseStatus.textContent = 'blocked · current build stamp unavailable';
  } else if (gate.room.complete) {
    releaseStatus.textContent = 'room complete · bind checks to this build';
  } else {
    releaseStatus.textContent = `blocked · ${gate.room.count}/${gate.room.total} physical checks`;
  }
  releaseBind.disabled = !gate.room.complete || !currentBuildStamp || Boolean(gate.pendingBuildStamp) || gate.bound;
  releaseFreeze.disabled = !gate.ready || gate.frozenCurrent;
  releaseClear.disabled = !releaseRecord;
}

async function refreshReleaseBuildStamp() {
  if (releaseBuildLoading) return;
  releaseBuildLoading = true;
  renderReleaseGate();
  try {
    const response = await fetch(CONFIG.liveReload.healthPath, { cache: 'no-store' });
    if (!response.ok) throw new Error(`health ${response.status}`);
    const health = await response.json();
    currentBuildStamp = health?.ok === true ? String(health.stamp || '').slice(0, 80) : '';
  } catch {
    currentBuildStamp = '';
  } finally {
    releaseBuildLoading = false;
    renderReleaseGate();
  }
}

function clearReleaseFreeze() {
  releaseRecord = null;
  try { globalThis.localStorage?.removeItem(CONFIG.releaseGate.storageKey); } catch { /* in-memory state remains authoritative */ }
}

function renderStageReceipt() {
  const summary = summarizeRoomReceipt(stageReceipt);
  for (const input of stageReceiptInputs) input.checked = stageReceipt[input.dataset.stageReceipt] === true;
  if (!stageReceiptStatus) return;
  if (!summary.count) {
    stageReceiptStatus.textContent = 'no room observation saved · check only what you personally saw or heard';
  } else {
    const updated = summary.timestamp ? new Date(summary.timestamp).toLocaleString() : 'unsaved';
    stageReceiptStatus.textContent = `${summary.complete ? 'complete local receipt' : 'partial local receipt'} · ${summary.count}/${summary.total} · ${updated}`;
  }
  renderReleaseGate();
}

function persistStageReceipt() {
  stageReceipt.timestamp = Date.now();
  try {
    globalThis.localStorage?.setItem(STAGE_RECEIPT_KEY, JSON.stringify(stageReceipt));
  } catch {
    // The receipt remains visible for this page session when storage is unavailable.
  }
  renderStageReceipt();
}

function bindStageReceiptToBuild() {
  const gate = releaseGateState();
  if (!gate.room.complete || !currentBuildStamp || pendingBuildStamp) return;
  clearReleaseFreeze();
  stageReceipt.buildStamp = currentBuildStamp;
  persistStageReceipt();
  setStatus(`room receipt bound · build ${currentBuildStamp}`);
}

function freezeCurrentRelease() {
  const gate = releaseGateState();
  if (!gate.ready) return;
  releaseRecord = createReleaseRecord({
    buildStamp: currentBuildStamp,
    softwareVersion: CONFIG.releaseGate.software.version,
    roomReceipt: stageReceipt,
    frozenAt: Date.now(),
    schemaVersion: CONFIG.releaseGate.schemaVersion,
  });
  if (!releaseRecord) return;
  try { globalThis.localStorage?.setItem(CONFIG.releaseGate.storageKey, JSON.stringify(releaseRecord)); } catch { /* visible session freeze still holds */ }
  renderReleaseGate();
  setStatus(`release frozen locally · build ${currentBuildStamp}`);
}

function selectIds(select) {
  return [...(select?.options || [])].map((option) => String(option.value || '')).filter(Boolean);
}

function venueProfileCurrent() {
  const audio = audioMidi?.getFrame?.() || emptyAudio;
  const cameraIds = selectIds(cameraSelect);
  const micIds = selectIds(micSelect);
  return {
    cameraIds,
    micIds,
    midiDevices: audio.devices || [],
    cameraExposed: cameraIds.length > 0,
    micExposed: micIds.length > 0,
    midiExposed: Boolean(audio.midiActive || ['live', 'waiting'].includes(latestAudioStatus.midi.state)),
  };
}

function visibleDeviceLabel(select, deviceId, fallback) {
  if (!deviceId) return fallback;
  const option = [...(select?.options || [])].find((item) => item.value === deviceId);
  return option?.textContent || 'saved device';
}

function renderVenueProfile() {
  if (!venueProfilePanel || !venueProfileStore) return;
  const state = venueProfileStore.getState();
  const profile = state.profile;
  venueProfilePanel.dataset.venueProfileState = profile ? 'saved' : 'empty';
  venueProfileApply.disabled = !profile;
  venueProfileClear.disabled = !profile;
  if (!profile) {
    venueProfileStatus.textContent = state.lastEvent;
    const empty = ['camera · default', 'mic · default', 'midi · pending', 'projector · current'];
    venueProfileRoutes.forEach((output, index) => { output.textContent = empty[index]; });
    return;
  }
  const match = matchVenueProfile(profile, venueProfileCurrent());
  const saved = profile.savedAt ? new Date(profile.savedAt).toLocaleString() : 'unsaved';
  venueProfileStatus.textContent = `${profile.name} · ${saved} · ${state.persisted ? 'local' : 'memory only'}`;
  const routeText = {
    camera: `camera · ${match.camera} · ${visibleDeviceLabel(cameraSelect, profile.cameraDeviceId, 'default')}`,
    mic: `mic · ${match.mic} · ${visibleDeviceLabel(micSelect, profile.micDeviceId, 'default')} · ${profile.monitorPreset}`,
    midi: `midi · ${match.midi} · ${profile.midiDevices.join(', ') || 'none saved'}`,
    projector: `projector · black ${Math.round(profile.projector.threshold * CONFIG.calibration.blackPointMax * 100)}% · white ${Math.round((CONFIG.calibration.whitePointMin + profile.projector.intensity * (1 - CONFIG.calibration.whitePointMin)) * 100)}% · bloom ${Math.round(profile.projector.bloom * 100)}% · ${profile.projector.mirrored ? 'mirror' : 'normal'}`,
  };
  venueProfileRoutes.forEach((output) => {
    output.textContent = routeText[output.dataset.venueProfileRoute] || 'route pending';
  });
}

function saveVenueProfile() {
  const audio = audioMidi?.getFrame?.() || emptyAudio;
  const state = venueProfileStore.save({
    name: venueProfileName.value,
    cameraDeviceId: cameraSelect.value,
    micDeviceId: micSelect?.value || '',
    monitorPreset: micMonitorPresetId,
    midiDevices: audio.devices || [],
    projector: {
      threshold: controls.threshold,
      intensity: controls.intensity,
      bloom: controls.bloom,
      mirrored: controls.mirrored,
    },
  });
  if (state.profile) venueProfileName.value = state.profile.name;
  renderVenueProfile();
  setStatus(`venue saved · ${state.profile?.name || 'profile'} · devices remain ${audio.midiActive || trackingFrame.camera.active || audio.micActive ? 'unchanged' : 'off'}`);
}

function applyVenueProfile() {
  const profile = venueProfileStore.getState().profile;
  if (!profile) return;
  const match = matchVenueProfile(profile, venueProfileCurrent());
  if (!profile.cameraDeviceId) {
    cameraSelect.value = '';
    preferredCameraDeviceId = '';
  } else if (match.camera === 'matched') {
    cameraSelect.value = profile.cameraDeviceId;
    preferredCameraDeviceId = profile.cameraDeviceId;
  }
  if (!profile.micDeviceId) {
    micSelect.value = '';
    preferredMicDeviceId = '';
  } else if (match.mic === 'matched') {
    micSelect.value = profile.micDeviceId;
    preferredMicDeviceId = profile.micDeviceId;
  }
  selectMicMonitorPreset(profile.monitorPreset);
  controls.threshold = clamp(profile.projector.threshold);
  controls.intensity = clamp(profile.projector.intensity);
  controls.bloom = clamp(profile.projector.bloom, 0, CONFIG.calibration.safeBloomMax);
  if (controls.mirrored !== profile.projector.mirrored) toggleMirror();
  updateCalibrationSurface();
  renderVenueProfile();
  const unresolved = Object.entries(match).filter(([, value]) => value === 'missing' || value === 'pending').map(([key]) => key);
  recordScoreEvent({ kind: 'scene', action: 'venue-apply', label: profile.name, data: { unresolved: unresolved.join(',') || 'none' } });
  setStatus(`venue applied · ${profile.name} · ${unresolved.length ? `${unresolved.join('/')} needs explicit recheck` : 'selectors matched'} · press C/A/N explicitly`);
}

function clearVenueProfile() {
  venueProfileStore.clear();
  renderVenueProfile();
  setStatus('venue profile cleared · running routes unchanged');
}

function setHelpVisible(visible) {
  help.hidden = !visible;
  if (visible) {
    updateInputRitual();
    renderStageReceipt();
    renderVenueProfile();
    renderAccessibilityProfile();
    void refreshReleaseBuildStamp();
  }
}

function renderAccessibilityProfile() {
  if (!accessibilityProfileStore) return;
  const state = accessibilityProfileStore.getState();
  const { highContrast, reducedMotion } = state.profile;
  document.body.dataset.contrast = highContrast ? 'high' : 'standard';
  document.body.dataset.motion = reducedMotion ? 'reduced' : 'full';
  glCanvas.dataset.motion = reducedMotion ? 'reduced' : 'full';
  controls.reducedMotion = reducedMotion;
  for (const button of accessibilityButtons) {
    button.setAttribute('aria-pressed', String(Boolean(state.profile[button.dataset.accessibilitySetting])));
  }
  if (accessibilityStatus) accessibilityStatus.textContent = `${highContrast ? 'high contrast' : 'standard contrast'} · ${reducedMotion ? 'reduced motion' : 'full motion'} · ${state.persisted ? 'saved' : 'system'}`;
}

function toggleAccessibilitySetting(setting) {
  if (!['highContrast', 'reducedMotion'].includes(setting)) return;
  const current = accessibilityProfileStore.getState().profile;
  accessibilityProfileStore.save({ [setting]: !current[setting] });
  renderAccessibilityProfile();
  setStatus(`access · ${setting === 'highContrast' ? 'contrast' : 'motion'} · ${accessibilityProfileStore.getState().profile[setting] ? 'on' : 'off'} · inputs unchanged`);
}

async function refreshCameraDevices() {
  const revision = ++cameraInventoryRevision;
  const mediaDevices = globalThis.navigator?.mediaDevices;
  if (!mediaDevices?.enumerateDevices) {
    cameraLabelNote.textContent = 'camera list unavailable · default camera may still work';
    return;
  }

  try {
    const devices = await mediaDevices.enumerateDevices();
    if (revision !== cameraInventoryRevision) return;
    const cameras = devices.filter((device) => device.kind === 'videoinput');
    const microphones = devices.filter(device => device.kind === 'audioinput');
    macCameraId = cameras.find(device => /facetime|macbook.*camera|built.in.*camera/i.test(device.label))?.deviceId || '';
    cameraInventory = cameras.filter((device, index) => device.deviceId && cameras.findIndex(other => other.deviceId === device.deviceId) === index);
    const options = [new Option('Automatic camera', ''), ...cameraInventory.map((device, index) =>
      new Option(device.label || 'Camera ' + (index + 1), device.deviceId))];
    if (isMobileCameraHost()) options.push(new Option('Rear camera on this device', 'facing:environment'));
    if (options.length !== cameraSelect.options.length || options.some((option, index) =>
      option.value !== cameraSelect.options[index].value || option.text !== cameraSelect.options[index].text)) {
      cameraSelect.replaceChildren(...options);
    }
    const requested = preferredCameraDeviceId;
    if (requested && !options.some(option => option.value === requested)) cameraSelect.add(new Option('Saved source · unavailable', requested));
    cameraSelect.value = requested;
    cameraLabelNote.textContent = cameras.some(device => device.label)
      ? cameraInventory.length + ' camera sources' : 'Allow camera access to see device names';
    renderCameraSources(tracking.getFrame().camera);

    const currentMicDeviceId = preferredMicDeviceId;
    micSelect.replaceChildren();
    const defaultMicOption = document.createElement('option');
    defaultMicOption.value = '';
    defaultMicOption.textContent = 'default microphone';
    micSelect.append(defaultMicOption);
    const micLabelsVisible = microphones.some((device) => String(device.label || '').trim());
    if (micLabelsVisible) {
      microphones.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = String(device.deviceId || '');
        option.textContent = String(device.label || `microphone ${index + 1}`);
        micSelect.append(option);
      });
    }
    if ([...micSelect.options].some((option) => option.value === currentMicDeviceId)) {
      micSelect.value = currentMicDeviceId;
    }
    if (!help.hidden) renderVenueProfile();
  } catch {
    cameraLabelNote.textContent = 'camera list unavailable · default camera may still work';
  }
}

function isMobileCameraHost() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function renderCameraMonitor(camera) {
  const panel = cameraSources.querySelector('[data-source-monitor]');
  const monitor = panel.querySelector('video');
  const stream = cameraSources.hidden || !camera.active ? null : video.srcObject;
  if (monitor.srcObject !== stream) monitor.srcObject = stream;
  panel.hidden = !stream;
  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  const lens = track?.getSettings()?.facingMode;
  const view = camera.deviceId === 'window:preview' ? 'Preview window' : lens === 'environment' ? 'Rear camera'
    : lens === 'user' ? 'Front camera' : 'Camera';
  const route = controls.clipActive ? 'Clip on stage' : controls.focusField && !controls.focusCamera ? 'Pointer field on stage' : 'Camera on stage';
  const signal = track?.muted ? 'Waiting for frames' : 'Unfiltered input';
  const caption = [signal, view, camera.width + ' × ' + camera.height, route].join(' · ');
  const output = panel.querySelector('figcaption');
  if (caption !== output.textContent) output.textContent = caption;
}

function renderCameraSources(camera) {
  renderCameraMonitor(camera);
  const panelOpen = !cameraSources.hidden;
  const signature = JSON.stringify([panelOpen, camera.active, camera.deviceId, camera.label, camera.error, cameraPending,
    preferredCameraDeviceId, cameraSwitchError, cameraInventory.map(d => [d.deviceId, d.label])]);
  if (signature === cameraPickerSignature) return;
  cameraPickerSignature = signature;
  for (const button of document.querySelectorAll('[data-open-cameras]')) {
    button.dataset.live = String(Boolean(camera.active));
    button.title = camera.active ? 'Camera sources · Live: ' + (camera.label || 'camera') : 'Choose camera source';
  }
  if (!panelOpen) return;
  const options = Array.from(cameraSelect.options);
  cameraSources.querySelector('[data-preview-help]').hidden = !(navigator.platform.startsWith('Mac') && navigator.mediaDevices?.getDisplayMedia);
  cameraSources.querySelector('[data-phone-preview]').setAttribute('aria-pressed',String(camera.active && camera.deviceId==='window:preview'));
  const rows = options.filter(option => option.value || !cameraInventory.some(device => device.label)).map(option => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.cameraPick = option.value;
    const live = Boolean(camera.active && (option.value === camera.deviceId || (!option.value && !camera.deviceId)));
    const chosen = option.value === preferredCameraDeviceId;
    const missing = option.value && !cameraInventory.some(d => d.deviceId === option.value) && option.value !== 'facing:environment';
    button.disabled = Boolean(missing);
    button.setAttribute('aria-pressed',String(live));
    const badge = document.createElement('small');
    badge.textContent = live ? 'LIVE' : chosen && cameraPending ? 'CONNECTING' : missing ? 'UNAVAILABLE' : chosen && cameraSwitchError ? 'RETRY' : 'AVAILABLE';
    button.append(option.textContent, badge);
    return button;
  });
  const focused = document.activeElement?.dataset.cameraPick;
  const list = cameraSources.querySelector('[data-camera-list]');
  list.replaceChildren(...rows);
  if (focused !== undefined) rows.find(row=>row.dataset.cameraPick===focused)?.focus({preventScroll:true});
  cameraSources.querySelector('[data-stop-camera]').disabled = !camera.active && !cameraPending;
  const hint = navigator.platform.startsWith('Mac') && cameraInventory.some(device => device.label)
    && !cameraInventory.some(device => /phone|continuity/i.test(device.label))
    ? 'iPhone missing? Lock it near the Mac or connect by USB, then refresh.' : '';
  cameraSources.querySelector('[data-camera-message]').textContent = [
    cameraSwitchError || (cameraPending ? 'Connecting…' : camera.active ? '' : cameraLabelNote.textContent),
    camera.active ? 'Live · ' + (camera.label || 'camera') : camera.error && !cameraSwitchError ? camera.error : '', hint
  ].filter(Boolean).join(' · ');
}

function handleCameraDeviceChange() {
  refreshCameraDevices();
}

function performanceSnapshot() {
  return {
    version: 5,
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
    workflow,
    sectorSample: sectorSelect.value,
    sectorLevel: Number($('[data-sector-level]').value),
    story: workflowCue || workflow,
    roomEnabled: controls.roomEnabled,
    focusGeometry: controls.focusGeometry,
    sacred: { id: controls.sacredLayer, strength: controls.sacredStrength },
    sceneOverride: controls.mode === 3 && controls.scene ? findShaperLook(controls.scene) : '',
    micDeviceId: preferredMicDeviceId,
    micActive: Boolean(audioMidi.getFrame()?.micActive),
    roomMusicActive,
    airMicReactive,
    airProfile,
    bassDeck: Object.fromEntries([...document.querySelectorAll('[data-bass-control]')].map(input => [input.dataset.bassControl, Number(input.value)])),
    arrangement: stageArrangement.id ? {id: stageArrangement.id, ownsOrchestra: scoreOwnsOrchestra} : null,
    audioLayers: { hands: Boolean(music.getState().armed), orchestra: orchestra.state().running, air: atmosphere.active(), wagner: wagnerScore.state.playing },
    dayEnabled, dayPreview,
    geometry: normalizeGeometry(controls.lightScore),
    atmosphere: atmosphereSettings,
    stageMusicSource,
    tristanPosition: wagnerScore.state.source === 'file' && wagnerScore.state.builtin ? wagnerScore.state.position : 0,
    wagnerWork: wagnerScore.state.builtin ? wagnerScore.state.work : 'tristan',
    wagnerPerformance: Object.fromEntries(['rate', 'color', 'echo', 'conduct', 'gain'].map(key => [key, wagnerScore.state[key]])),
    panel: Object.keys(primaryPanels).find(key => !document.getElementById(primaryPanels[key].id).hidden)
      || (!capturePanel.hidden ? 'capture' : ''),
    frameArmed: framePerformanceArmed,
    frameBox: manualFrame?.committed ? manualFrame : null,
    agentListening: geometryControls?.isListening?.() === true,
    agentDockOpen: !agentPanel.hidden,
    includeCaptureAudio: Boolean(captureAudioToggle?.checked),
  };
}

function restorePerformanceState() {
  let saved = null;
  try {
    const raw = sessionStorage.getItem(UPDATE_STATE_KEY);
    if (raw) saved = JSON.parse(raw);
    const backup = readRecovery(localStorage);
    if (!saved) saved = backup;
    sessionStorage.removeItem(UPDATE_STATE_KEY);
  } catch {
    saved = null;
  }
  if (!saved || ![1, 2, 3, 4, 5].includes(saved.version)) return null;

  const savedMode = Number(saved.mode);
  controls.mode = Number.isFinite(savedMode)
    ? Math.max(0, Math.min(MODES.length - 1, Math.round(savedMode)))
    : controls.mode;
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
  const restoredStandard = saved.standardControls || saved;
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
  renderReleaseGate();
  setStatus('new build available · press U to apply after the scene');
}

function deferBuildUpdate() {
  if (!pendingBuildStamp) return;
  applyAfterCapture = false;
  updateNotice.hidden = true;
  setStatus('build deferred · current stage remains live · U applies later');
}

function captureInProgress() {
  const capture = performanceRecorder?.getState?.();
  const sample = sampler?.getState?.();
  return captureStartPending || capture?.active || capture?.pendingWrites || ['stopping', 'saving'].includes(capture?.status) || sample?.recording
    || samplerStopPending || scoreRecorder?.getState?.().recording || geometryControls?.isRecording() || geometryControls?.isListening()
    || presence.busy || audioMidi?.getFrame?.().voiceGame?.recording;
}

function applyBuildUpdate() {
  if (!pendingBuildStamp || updateNotice.dataset.applying === 'true') return;
  if (captureInProgress()) {
    applyAfterCapture = true;
    updateNotice.hidden = false;
    updateStamp.textContent = 'update queued · recording continues';
    setStatus('Finish the take, then press Apply again · sound and settings retained');
    return;
  }
  if (performanceRecorder?.getState?.().persistenceFailed) {
    applyAfterCapture = false;
    updateNotice.hidden = false;
    updateStamp.textContent = 'storage unavailable · download and remove the unsaved take';
    return;
  }
  if (guestPart.active() || stageAgent.pending()) {
    updateNotice.hidden = false;
    updateStamp.textContent = 'Build pending · finish the agent cue, then Apply';
    return;
  }
  if (tracking.getFrame().camera.deviceId === 'window:preview' || shaperDemo) {
    applyAfterCapture = false;
    updateNotice.hidden = false;
    updateStamp.textContent = shaperDemo ? 'Build pending · exit the live score, then Apply' : 'Build pending · stop window preview, then Apply';
    return;
  }
  if (clips.isLocal()) {
    applyAfterCapture = false;
    updateNotice.hidden = false;
    updateStamp.textContent = 'build pending · stop the local clip before updating';
    return;
  }
  if (wagnerScore.state.source === 'file' && !wagnerScore.state.builtin) {
    applyAfterCapture = false;
    updateNotice.hidden = false;
    updateStamp.textContent = 'Personal recording loaded · choose a built-in score before updating';
    return;
  }
  stopShaperDemo();
  try {
    sessionStorage.setItem(UPDATE_STATE_KEY, JSON.stringify(performanceSnapshot()));
    saveRecovery(localStorage, JSON.parse(sessionStorage.getItem(UPDATE_STATE_KEY)));
  } catch {
    setStatus('build deferred · the browser could not save your settings');
    applyAfterCapture = false;
    return;
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
  if (controls.roomEnabled) controls.room = roomGeometry.reset();
  document.body.dataset.cameraMirror = String(controls.mirrored);
  setupPanel.querySelector('[data-action="mirror"]').setAttribute('aria-pressed', String(controls.mirrored));
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
  sectorDeck.midi(event);
  music?.handleMidiEvent?.(event);
  if (event.type === 'note') queuePerformancePatchEvent(PATCH_EVENT_IDS[0], 'note', event.velocity ?? 1);
  if (!musicPanel.hidden) renderMusicSurface();
  if (event.type === 'panic') controls.pointer.down = false;
  updateInputRitual();
}

tracking = createTrackingEngine({
  video,
  config: { ...CONFIG, tracking: { ...CONFIG.tracking, objectOnDemand: true } },
  onStatus: (status) => {
    if (status && typeof status === 'object') latestTrackingStatus = status;
    if (status?.message) setStatus(status.message);
    else if (typeof status === 'string') setStatus(status);
    const active = Boolean(status?.active ?? tracking?.getFrame?.()?.camera?.active);
    setButtonState('camera', active);
    if (tracking) renderStageTracking(tracking.getFrame());
    updateInputRitual();
  },
});

audioMidi = createAudioMidiEngine({
  config: CONFIG,
  getVoiceOutput: async () => ({ output: await samplerSession.getOutputDestination(), context: await samplerSession.getAudioContext() }),
  onStatus: (status) => {
    if (status?.source === 'mic' || status?.source === 'midi') {
      latestAudioStatus[status.source] = {
        state: String(status.state || 'standby'),
        message: String(status.message || status.state || 'standby'),
      };
    }
    if (status?.source === 'mic' && ['unavailable', 'destroyed'].includes(String(status.state))) {
      micCalibrationMonitorRestore = false;
      micCalibration?.cancel?.('mic unavailable · calibration cancelled');
    }
    if (status?.message) setStatus(status.message);
    else if (typeof status === 'string') setStatus(status);
    const frame = audioMidi?.getFrame?.();
    setButtonState('audio', Boolean(frame?.micActive));
    setButtonState('monitor', Boolean(frame?.monitorActive));
    setButtonState('midi', Boolean(frame?.midiActive));
    updateInputRitual();
    renderVoiceGameSurface(frame?.voiceGame);
    if (!musicPanel.hidden && music) renderMusicSurface();
  },
  onEvent: onAudioEvent,
});
try {
  const savedMonitorPreset = localStorage.getItem(CONFIG.audio.monitor.storageKey);
  if (Object.hasOwn(CONFIG.audio.monitor.presets, savedMonitorPreset || '')) micMonitorPresetId = savedMonitorPreset;
} catch {
  // A blocked storage surface keeps the CONFIG default without affecting audio permission.
}
audioMidi.setMicMonitorPreset?.(micMonitorPresetId, { report: false });
micCalibration = createMicCalibration({
  config: CONFIG,
  storage: globalThis.localStorage,
  now: () => performance.now(),
});
const initialMicCalibration = micCalibration.selectDevice('default');
audioMidi.setMicFloor?.(initialMicCalibration.gateFloor ?? CONFIG.audio.floor);
micCalibrationAppliedAt = initialMicCalibration.calibratedAt;

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
const subjectRoute = createSubjectRoute(CONFIG.overlay.subjectRoute);

function renderFocusNavigator() {
  const state = overlay.getFocusState?.();
  const score = overlay.getScoreState?.();
  if (!state || !focusNavigator) return;
  focusNavigator.hidden = state.count === 0 || (!state.locked && !controls.trackingTiles);
  focusNavigator.dataset.phase = state.phase;
  focusLabel.textContent = state.selectedId
    ? `${state.kind || 'target'} · ${state.label || state.selectedId}`
    : 'focus memory';
  focusPosition.textContent = state.selectedId
    ? `${state.index} / ${state.count} · ${state.phase} · ${score?.ambientCount || 0} ambient · fx ${Math.round((subjectRouteState?.visual || 0) * 100)} · sound ${Math.round((subjectRouteState?.sound || 0) * 100)}`
    : `${state.count} saved · choose target`;
  focusPreviousButton.disabled = state.count === 0;
  focusNextButton.disabled = state.count === 0;
  focusReleaseButton.disabled = !state.locked;
}

function navigateFocus(direction) {
  const state = direction < 0 ? overlay.focusPrevious?.() : overlay.focusNext?.();
  renderFocusNavigator();
  if (state?.selectedId) setStatus(`focus ${state.index}/${state.count} · ${state.label} · ${state.phase}`);
  else setStatus('focus memory empty · lock a published target');
}

function releaseFocus() {
  overlay.focusClear?.();
  renderFocusNavigator();
  setStatus('focus released · target history kept');
}
gestureConfigurator = createGestureConfigurator({
  defaults: CONFIG.gestureFrame,
  storage: globalThis.localStorage,
  storageKey: CONFIG.gestureFrame.storageKey,
});
let gestureFrame = createGestureFrame({
  config: { gestureFrame: { ...CONFIG.gestureFrame, ...gestureConfigurator.getState() } },
});
const frameContent = createFrameContentController({ settings: CONFIG.frameContent });
const roiFeatureSettings = CONFIG.frameContent.featureLock;
const roiFeatureCanvas = document.createElement('canvas');
roiFeatureCanvas.width = roiFeatureSettings.sampleWidth;
roiFeatureCanvas.height = roiFeatureSettings.sampleHeight;
const roiFeatureContext = roiFeatureCanvas.getContext('2d', {
  alpha: false,
  desynchronized: true,
  willReadFrequently: true,
});
const roiFeatureLock = createRoiFeatureLock(roiFeatureSettings);
let roiFeatureState = roiFeatureLock.getState();
let lastRoiFeatureSampleAt = -Infinity;
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
const sectorInput = createSectorInput();
const sectorPanel = $('#sector-deck');
const sectorSelect = $('[data-sector-slot]');
const sectorArm = $('[data-sector-arm]');
const sectorStatus = $('[data-sector-status]');
const sectorDeck = createSectorDeck(samplerSession, {status: message => { sectorStatus.value = message; }});
for (const {name, start, size} of CONFIG.kosmodrom.banks) {
  const group = document.createElement('optgroup');
  group.label = name;
  CONFIG.kosmodrom.slots.slice(start, start + size).forEach((slot, i) => group.append(new Option(slot.name, start + i)));
  sectorSelect.append(group);
}
sectorSelect.onchange = () => sectorDeck.select(Number(sectorSelect.value));
const radioPadKeys = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN'];
sectorPanel.addEventListener('keydown', event => {
  if (!sectorDeck.active || event.target.matches('input,select') ||
      event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
  const index = radioPadKeys.indexOf(event.code);
  if (index < 0) return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) void sectorDeck.play(index);
});
$('[data-sector-play]').onclick = () => void sectorDeck.play();
$('[data-sector-preview]').onclick = () => void sectorDeck.play(sectorDeck.selected, .8, 'preview');
$('[data-sector-stop]').onclick = () => { sectorDeck.stop('stage'); sectorStatus.value = 'Stopped'; };
$('[data-sector-level]').oninput = event => sectorDeck.setLevel(Number(event.target.value));
sectorArm.onclick = async () => {
  await sectorDeck.arm(!sectorDeck.armed);
  sectorArm.setAttribute('aria-pressed', String(sectorDeck.armed));
};
let sectorSampling = false;
function updateSector(time, dt, trackingFrame) {
  const score = controls.lightScore;
  const visible = score?.study === 'kosmodrom' && !controls.geometryMuted;
  if (visible || sectorDeck.active) {
    sectorSampling = true;
    const radio = stageArrangement.radioSignal();
    const pad = sectorDeck.signal();
    sectorInput.sample({time, dt, hands: !shaperDemo && score?.sources?.hands !== false ? trackingFrame.hands : [],
      mic: audioFrame?.micActive ? audioFrame.rms : 0, midi: audioFrame?.midiActive ? audioFrame.midiEnergy : 0,
      sampleLevel: Math.max(pad, radio), site: radio > pad ? stageArrangement.site : sectorDeck.site, bank: sectorDeck.bank,
      pads: sectorDeck.armed, onPad: (slot, velocity) => void sectorDeck.play(slot, velocity)});
    if (sectorPanel.dataset.source !== sectorInput.source) sectorPanel.dataset.source = sectorInput.source;
  } else if (sectorSampling) {
    sectorSampling = false;
    sectorInput.reset();
    delete sectorPanel.dataset.source;
  }
  controls.sector = visible ? sectorInput : null;
}
const atmosphere = createAtmosphere(samplerSession);
const orchestra = createParticlesOrchestra(samplerSession);
let scoreOwnsOrchestra = false;
let liveOrchestraParams = {};
const stageArrangement = createSceneArrangement(samplerSession, renderArrangement);
const auditionArrangement = createSceneArrangement(samplerSession, state => {
  const button = $('[data-story-hear]');
  button.setAttribute('aria-pressed', String(Boolean(state)));
  button.textContent = state ? 'Stop excerpt' : 'Hear arrangement';
});

function arrangementId(story = currentStory()) {
  return presets.workflows[story]?.arrangement || (Object.hasOwn(CONFIG.sceneArrangements, story) ? story : '');
}

function renderArrangement(state) {
  const score = CONFIG.sceneArrangements[arrangementId()];
  const panel = $('[data-arrangement-panel]');
  panel.hidden = !score;
  if (!score) return;
  const button = $('[data-arrangement-toggle]');
  button.setAttribute('aria-pressed', String(Boolean(state)));
  button.textContent = state ? 'Stop score' : 'Play score';
  $('[data-arrangement-status]').value = state
    ? state.title + ' · ' + state.section + ' · bar ' + state.bar + '/8 · ' + state.bpm + ' BPM'
    : score.title + ' · ' + score.parts;
}

function stopStageArrangement() {
  stageArrangement.stop();
  if (scoreOwnsOrchestra) orchestra.stop();
  scoreOwnsOrchestra = false;
}

function startStageArrangement() {
  const id = arrangementId();
  if (!id) return;
  stopStageArrangement();
  scoreOwnsOrchestra = !orchestra.state().running;
  stageMusicSource = 'orchestra';
  void orchestra.start().then(renderMusicTransport).catch(error => setStatus('Particles · ' + error.message));
  void stageArrangement.start(id, () => ({...liveOrchestraParams, key: guestStageKey || orchestraKey.value,
    degrees: orchestraPhrase(), timbre: orchestraPreset}), {onError: message => setStatus('Score · ' + message)});
}

$('[data-arrangement-toggle]').onclick = () => {
  if (stageArrangement.id) stopStageArrangement();
  else startStageArrangement();
  renderMusicTransport();
};
let demoBus = null, demoLevel = .75;
const demoSession = {
  getAudioContext: samplerSession.getAudioContext,
  async getOutputDestination() {
    const ctx = await samplerSession.getAudioContext();
    const destination = await samplerSession.getOutputDestination();
    if (demoBus?.context !== ctx) {
      demoBus?.disconnect();
      demoBus = ctx.createGain();
      demoBus.gain.value = demoLevel;
      demoBus.connect(destination);
    }
    return demoBus;
  },
};
const demoOrchestra = createParticlesOrchestra(demoSession);
const demoBand = createDemoAccompaniment(demoSession);
function setDemoLevel(level) {
  demoLevel = clamp(level);
  if (demoBus) demoBus.gain.setTargetAtTime(demoLevel, demoBus.context.currentTime, .035);
  for (const input of document.querySelectorAll('[data-score-mix]')) input.value = String(demoLevel);
}
for (const input of document.querySelectorAll('[data-score-mix]')) {
  input.addEventListener('input', () => setDemoLevel(Number(input.value)));
}
$('[data-score-timbre]').addEventListener('change', event => {
  if (!shaperDemo) return;
  const profile = presets.music[event.target.value];
  const variant = storyVersions.get(shaperDemo.chapter.geometry);
  if (profile) demoOrchestra.configure({ ...profile, key: activeDemoKey(), level: variant.level ?? CONFIG.shaperDemo.level });
});
const orchestraKey = $('[data-orchestra-key]');
const storyKeys = Object.fromEntries([...orchestraKey.options].map(option => [option.value, option.textContent]));
const orchestraLevel = $('[data-orchestra-level]');
const orchestraControls = { level: orchestraLevel, ...Object.fromEntries(
  [...musicPanel.querySelectorAll('[data-orchestra-control]')].map(input => [input.dataset.orchestraControl, input]),
) };
const orchestraButton = $('[data-orchestra]');
const orchestraNote = $('[data-orchestra-note]');
const ORCHESTRA_SETTINGS = 'mythtrace.orchestra.v1';
const localClip = $('#clip-local');
const clips = bindClips({
  panel: backgroundSettings, localVideo: localClip, session: samplerSession,
  useLocal: (source, detect = true) => {
    controls.clipActive = Boolean(source);
    controls.clipTracking = Boolean(source && detect);
    void tracking.setClipObjectSource?.(detect ? source : null);
  },
  onShown: mode => {
    document.body.dataset.clip = mode;
    if (mode === 'local') {
      if (!running) enterSystem();
      closeSetupPanel();
    }
  },
  onEffects: strength => {
    controls.clipEffects = strength;
    stage.style.setProperty('--clip-effects', strength);
  },
});
const wagnerScore = createWagnerScore({ config: CONFIG, session: samplerSession, onStatus: setStatus });
const renderWagnerSurface = bindWagnerControls(wagnerScore, $('#wagner-score'), () => {
  stageMusicSource = 'tristan';
  if (!running) enterSystem();
});
let wagnerUiAt = -Infinity;
samplerScenes = createSamplerSceneSlots({ storage: localStorage, config: CONFIG });
samplerSequence = createNonRepeatingClipSequence({ storage: localStorage, config: CONFIG });
voiceMemory = createVoiceMemory({
  config: CONFIG,
  routeMediaElement: samplerSession.routeMediaElement,
  initialSettings: restoreVoiceMemorySettings(),
  onStatus: (status) => {
    if (narrativeMemoryStatus) {
      narrativeMemoryStatus.textContent = status?.lastEvent || status?.message || 'voice memory ready';
    }
    if (!narrativePanel.hidden) renderVoiceMemorySurface();
  },
});
voiceCaption = createVoiceCaptionEngine({
  Recognition: globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition,
  language: captionLanguageSelect?.value || 'ru-RU',
  onText: ({ text }) => {
    if (liveCaptionText) liveCaptionText.textContent = String(text || '').slice(-1200);
    renderVoiceCaptionSurface();
  },
  onStatus: (state) => {
    if (liveCaptionStatus) liveCaptionStatus.textContent = String(state.lastEvent || 'voice text');
    renderVoiceCaptionSurface();
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
scoreRecorder = createScoreRecorder({
  config: CONFIG,
  storage: globalThis.localStorage,
  onStatus: () => { if (!capturePanel.hidden) renderScoreSurface(); },
});
venueProfileStore = createVenueProfileStore({
  config: CONFIG,
  storage: globalThis.localStorage,
  onStatus: () => { if (!help.hidden) renderVenueProfile(); },
});
if (venueProfileStore.getState().profile) venueProfileName.value = venueProfileStore.getState().profile.name;
accessibilityProfileStore = createAccessibilityProfileStore({
  config: CONFIG,
  storage: globalThis.localStorage,
  system: {
    systemReducedMotion: Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches),
    systemHighContrast: Boolean(globalThis.matchMedia?.('(prefers-contrast: more)')?.matches),
  },
  onStatus: renderAccessibilityProfile,
});
renderAccessibilityProfile();
adaptiveQuality = createAdaptiveQualityController({
  config: CONFIG,
  onChange: (state) => renderQualitySurface(state),
});
renderQualitySurface();
localBridge = createLocalBridge({
  config: CONFIG,
  WebSocketCtor: null,
  onStatus: () => { if (!patchPanel.hidden) renderPatchSurface(); },
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
    if (status?.message) setStatus(`Hands · ${status.message}`);
    renderMusicTransport();
    if (!musicPanel.hidden) renderMusicSurface();
    updateInputRitual();
  },
});
mpeOutput = createMpeOutputBridge({
  config: CONFIG,
  requestAccess: async () => {
    await audioMidi.enableMIDI?.();
    return audioMidi.getMIDIAccess?.();
  },
  onStatus: (state) => {
    if (state?.lastEvent) setStatus(state.lastEvent);
    if (!musicPanel.hidden && music) renderMpeOutputSurface(state);
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
fingerCalibration = createFingerCalibration({
  config: CONFIG,
  storage: globalThis.localStorage,
  now: () => performance.now(),
});
fingerEnvelope = createFingerEnvelope({
  config: CONFIG,
  storage: globalThis.localStorage,
});
music.update({
  timestamp: performance.now(),
  fingerEnvelope: fingerEnvelope.getState().values,
});

function framePercent(value) {
  return `${Math.round(clamp(Number(value) || 0) * 100)}%`;
}

function renderFrameSurface(settings = frameConfigurator.getState()) {
  const gestureSettings = gestureConfigurator.getState();
  const zoneSettings = frameZoneConfigurator.getState();
  frameContentMode = settings.mode;
  framePanel.dataset.mode = settings.mode;
  markPreset('framePreset', matchingFramePreset(settings));
  framePanel.dataset.soundRoute = String(settings.soundRoute);
  framePanel.dataset.visualRoute = String(settings.visualRoute);
  framePanel.dataset.soundEvents = String(frameSoundEvents);
  framePanel.dataset.zoneEvents = String(frameZoneEvents);
  framePanel.dataset.zoneCount = String(frameZoneState?.zones?.[0]?.memberCount || 0);
  const objectFlow = framePanel.querySelector('[data-frame-object-flow]');
  if (objectFlow) objectFlow.hidden = settings.mode !== 'object';
  for (const promptOnly of framePanel.querySelectorAll('[data-frame-prompt-only]')) {
    promptOnly.hidden = settings.mode !== 'prompt-shader';
  }
  framePanel.querySelector('[data-stage-frame-source]').value = settings.focusSource;
  framePanel.querySelector('[data-stage-frame-image]').value = settings.cameraLayer;
  for (const button of framePanel.querySelectorAll('[data-frame-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.frameMode === settings.mode));
  }
  for (const input of framePanel.querySelectorAll('[data-frame-field]')) {
    const key = input.dataset.frameField;
    if (key in settings) input.value = String(settings[key]);
    const visibleModes = {
      prompt: ['prompt-shader'], seed: ['prompt-shader'],
      objectClass: ['object'], fit: ['object'], cameraLayer: ['object'], focusSource: ['object'], focusDetail: ['object'],
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
  const featureState = roiFeatureState;
  const focusName = objectCrop?.sourceKind === 'pose'
    ? 'person'
    : objectCrop?.sourceKind === 'face'
      ? objectCrop.focusDetail === 'face-edge' ? 'face edge' : 'face'
      : objectCrop?.sourceKind === 'roi'
        ? 'author ROI'
      : objectCrop?.objectClass || 'object';
  const objectState = settings.focusSource === 'roi' && featureState?.phase === 'lost'
    ? 'author ROI · feature lost · 0% · draw a new two-hand frame'
    : settings.focusSource === 'roi' && featureState?.phase === 'weak'
      ? 'author ROI · weak texture · choose a clearer region'
      : settings.focusSource === 'roi' && featureState?.phase === 'waiting'
        ? 'author ROI · hold still to lock local features'
        : objectCrop?.active
    ? `${focusName} · ${objectCrop.featureLocked ? `feature ${objectCrop.featurePhase}` : objectCrop.held ? 'held' : 'live'} · ${Math.round((objectCrop.score || 0) * 100)}% · ${objectCrop.mirrored ? 'mirrored' : 'camera direct'}`
      : settings.focusSource === 'roi'
        ? 'draw + hold a two-hand frame for author ROI'
        : `waiting for ${settings.focusSource || 'person'} · ${settings.focusDetail || 'whole'}`;
  const focusHelp = framePanel.querySelector('[data-frame-focus-state]');
  if (focusHelp) focusHelp.textContent = objectState;
  const recipe = frameContent.snapshot?.()?.runtime?.recipe;
  const recipeOutput = framePanel.querySelector('[data-frame-recipe-output]');
  if (recipeOutput && recipe) {
    recipeOutput.textContent = `${recipe.subject} · ${recipe.palette} · ${recipe.motion?.spin > 0.2 ? 'spin' : recipe.motion?.pulse > 0.2 ? 'pulse' : 'drift'} · ${recipe.texture} · seed ${settings.seed}`;
  }
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
  framePanel.querySelector('[data-stage-frame-status]').textContent = objectCrop?.active
    ? objectState
    : framePerformanceArmed ? phaseHelp : 'Choose frame content, then draw the frame.';
}

function applyFrameSettings(settings) {
  const generatedPrompt = String(generatedFrameBackground.prompt || '').trim();
  const generatedSeed = Number(generatedFrameBackground.seed);
  if (generatedPrompt && (
    generatedPrompt !== String(settings.prompt || '').trim()
    || !Number.isFinite(generatedSeed)
    || generatedSeed !== Number(settings.seed)
  )) {
    invalidateGeneratedFrameBackground('local recipe active · stale generated still cleared');
  }
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
  roiFeatureState = roiFeatureLock.reset(frameZoneClock);
  lastRoiFeatureSampleAt = -Infinity;
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
    portraitMix: 'portrait mix',
    bodyReveal: 'body clarity',
    voidCoverage: 'focus field',
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
    markPreset('shaperLook', '');
    sceneStatusOutput.textContent = 'Fine tuning is available for Myth, Field and Memory.';
    return;
  }
  scenePanel.dataset.mode = String(controls.mode);
  scenePanel.dataset.preset = settings.preset;
  const look = Number(controls.mode) === 3 ? findShaperLook(settings) : '';
  markPreset('shaperLook', look);
  $('[data-shaper-description]').textContent = look ? describeLook(look)
    : 'Contour · cool light / Etching · warm grain / V22 · monochrome';
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
  document.body.dataset.stageMode = String(nextMode);
  if (isSceneMode(nextMode)) applySceneSettings(sceneConfigurator.getModeSettings(nextMode), nextMode);
  else controls.scene = null;
  renderer.setMode?.(controls.mode);
  renderSceneSurface();
  modeButtons.forEach((button) => {
    const active = Number(button.dataset.mode) === controls.mode;
    button.dataset.on = String(active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (stageMode) stageMode.textContent = MODES[controls.mode].name;
  setStatus(`${MODES[controls.mode].name.toLowerCase()} · mode ${controls.mode + 1}`);
  if (previousMode !== controls.mode) {
    recordScoreEvent({
      kind: 'scene', action: 'mode', label: MODES[controls.mode].name,
      data: { mode: controls.mode, preset: sceneConfigurator.getModeSettings(controls.mode)?.preset || 'base' },
    });
  }
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

function updateRoiFeatureLock(time, tracking, content) {
  const enabled = framePerformanceArmed
    && content?.mode === 'object'
    && content?.focusSource === 'roi'
    && !manualFrame;
  if (!enabled) {
    if (roiFeatureState.phase !== 'idle') {
      roiFeatureState = roiFeatureLock.update({
        timestamp: time,
        enabled: false,
        author: gestureFrameState,
      });
    }
    return roiFeatureState;
  }
  if (time - lastRoiFeatureSampleAt < roiFeatureSettings.sampleIntervalMs) return roiFeatureState;
  lastRoiFeatureSampleAt = time;
  let pixels = null;
  if (roiFeatureContext && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
    let saved = false;
    try {
      roiFeatureContext.save();
      saved = true;
      roiFeatureContext.setTransform(1, 0, 0, 1, 0, 0);
      roiFeatureContext.clearRect(0, 0, roiFeatureCanvas.width, roiFeatureCanvas.height);
      if (tracking?.camera?.mirrored === true) {
        roiFeatureContext.translate(roiFeatureCanvas.width, 0);
        roiFeatureContext.scale(-1, 1);
      }
      roiFeatureContext.drawImage(video, 0, 0, roiFeatureCanvas.width, roiFeatureCanvas.height);
      roiFeatureContext.restore();
      saved = false;
      pixels = roiFeatureContext.getImageData(0, 0, roiFeatureCanvas.width, roiFeatureCanvas.height).data;
    } catch {
      if (saved) roiFeatureContext.restore();
      pixels = null;
    }
  }
  roiFeatureState = roiFeatureLock.update({
    timestamp: time,
    enabled: true,
    pixels,
    width: roiFeatureCanvas.width,
    height: roiFeatureCanvas.height,
    author: gestureFrameState,
  });
  return roiFeatureState;
}

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
  const objects = Array.isArray(tracking?.objects) ? tracking.objects : [];
  for (let index = 0; index < poses.length; index += 1) {
    count = pushFocusCandidate(poses[index], 'pose', 'person', count);
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
  if (open) closeSetupPanel();
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
  syncPanelButtons();
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
    importClip: async () => null,
    startRecording: async () => false,
    stopRecording: async () => null,
    toggleRecording: async () => false,
    renameClip: async () => false,
    configureClip: async () => null,
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
  let hasFingerRange = false;
  for (let index = 0; index < output.music.length; index += 1) {
    const intent = output.music[index];
    if (intent.kind !== 'range') continue;
    hasFingerRange = true;
    fingerCalibration.update({ timestamp: time, hands: intent.values?.hands });
    fingerCalibration.apply(intent.values);
  }
  if (!hasFingerRange) fingerCalibration.update({ timestamp: time, hands: null });
  for (let index = 0; index < output.sampler.length; index += 1) {
    const intent = output.sampler[index];
    if (intent.kind === 'event') {
      mappingRuntime.events += 1;
      void sampler.trigger(resolveSequencedSamplerIntent(intent));
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
  musicUpdateInput.handRoute = fingerCalibration.isActive() ? 0 : handRoute;
  musicUpdateInput.framePhase = 'live';
  musicUpdateInput.event = null;
  musicUpdateInput.range = null;
  musicUpdateInput.subjectRange = subjectRouteState?.active ? subjectRouteState : null;
  let mpeRange = null;
  music.update(musicUpdateInput);
  for (let index = 0; index < output.music.length; index += 1) {
    const intent = output.music[index];
    if (intent.kind !== 'range') continue;
    const values = intent.values;
    mpeRange = values;
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
    recordScoreEvent({
      kind: 'gesture', action: 'pinch', label: intent.source || intent.key || 'hand pinch',
      data: {
        source: intent.source || 'hands',
        key: intent.key || 'pinch',
        strength: clamp(intent.strength),
      },
    }, intent.timestamp || time);
    queuePerformancePatchEvent(PATCH_EVENT_IDS[2], 'pinch', intent.strength);
    music.update(musicUpdateInput);
  }
  musicUpdateInput.event = null;
  const handSettings = performanceRouteSettings.settings.hands;
  const fingers = holdFingers(mpeRange?.hands, frame.hands, time, handSettings.enabled && handSettings.sound > 0);
  controls.fingerRanges = fingers;
  orchestra.updateFingers(fingers, time);
  if (shaperDemo) {
    const mix = controls.demoMix;
    let ranges = fingers;
    if (shaperDemo.chapter.geometry === 'wire-gloves' && !frame.camera?.active && !mix.hasHands) {
      const [left, right] = rehearsalCurls(mix.elapsed);
      ranges = { left: {active:true, curls:left}, right: {active:true, curls:right} };
    }
    demoOrchestra.updateFingers(controls.paused ? null : ranges, time);
  }
  mpeOutput.update({ timestamp: time, music: music.getState(), range: mpeRange });
  if (!musicPanel.hidden && time - lastMusicSurfaceAt >= CONFIG.entities.consoleRateMs) {
    lastMusicSurfaceAt = time;
    renderMusicSurface();
  }
  updatePerformanceMappingSurface(time);
}

function resolveSequencedSamplerIntent(intent) {
  const clips = sampler.listClips();
  const resolution = samplerSequence.next(clips.map((clip) => clip.id), intent.clipId);
  const clipId = resolution.source === 'sequence' ? resolution.clipId : intent.clipId;
  const texture = samplerTextureState.enabled && clipId === selectedGestureClipId
    ? { grainSizeSeconds: samplerTextureState.grainSizeSeconds, scatter: samplerTextureState.scatter }
    : null;
  return clipId !== intent.clipId || texture ? { ...intent, clipId, texture } : intent;
}

function routeFrameEvent(event, soundRoute) {
  const type = String(event?.type || '');
  const baseVelocity = CONFIG.frameContent.eventVelocity[type];
  if (!Number.isFinite(baseVelocity)) return;
  void sampler.trigger(resolveSequencedSamplerIntent({
    kind: 'event',
    edge: true,
    source: 'frame',
    key: `frame:${type}`,
    clipId: selectedGestureClipId,
    timestamp: Number(event?.ts) || performance.now(),
    cooldownMs: CONFIG.frameContent.eventCooldownMs,
    velocity: clamp(baseVelocity * soundRoute),
  })).then((accepted) => {
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
  void sampler.trigger(resolveSequencedSamplerIntent({
    kind: 'event',
    edge: true,
    source: `frame-zone:${event.source}`,
    key: `frame-zone:${event.source}:${event.entityId}:${type}`,
    clipId: selectedGestureClipId,
    timestamp: Number(event?.ts) || performance.now(),
    cooldownMs: CONFIG.frameZones.cooldownMs,
    velocity: clamp(baseVelocity * effectiveRoute * (0.6 + 0.4 * clamp(event?.confidence))),
  })).then((accepted) => {
    if (!accepted) return;
    frameZoneEvents += 1;
    if (!framePanel.hidden) renderFrameSurface();
  });
}

function updateFrameSoundEvents() {
  const soundRoute = clamp(frameContentState?.soundRoute);
  if (!samplerArmed || !selectedGestureClipId || soundRoute <= 0) return;
  for (let index = 0; index < (gestureFrameState?.eventCount || 0); index += 1) {
    const event = gestureFrameState.events[index];
    if (event.type !== 'preset-cycle') routeFrameEvent(event, soundRoute);
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
  renderSamplerSceneSlots(clips);
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
    const playback = document.createElement('div');
    playback.className = 'sampler-clip__playback';
    const playbackConfig = CONFIG.sampler.clipPlayback;
    for (const [key, title, min, max, step] of [
      ['attackSeconds', 'atk', playbackConfig.attackMinSeconds, playbackConfig.attackMaxSeconds, 0.002],
      ['releaseSeconds', 'rel', playbackConfig.releaseMinSeconds, playbackConfig.releaseMaxSeconds, 0.02],
    ]) {
      const control = document.createElement('label');
      const titleNode = document.createElement('span');
      titleNode.textContent = title;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(clip.playback[key]);
      input.dataset.samplerClipField = key;
      input.dataset.clipId = clip.id;
      const output = document.createElement('output');
      output.dataset.samplerClipOutput = key;
      output.textContent = `${Math.round(clip.playback[key] * 1000)}ms`;
      control.append(titleNode, input, output);
      playback.append(control);
    }
    const choke = document.createElement('label');
    const chokeTitle = document.createElement('span');
    chokeTitle.textContent = 'choke';
    const chokeSelect = document.createElement('select');
    chokeSelect.dataset.samplerClipField = 'chokeGroup';
    chokeSelect.dataset.clipId = clip.id;
    chokeSelect.setAttribute('aria-label', `choke group ${clip.label}`);
    for (const group of playbackConfig.chokeGroups) {
      const option = document.createElement('option');
      option.value = group;
      option.textContent = group;
      option.selected = group === clip.playback.chokeGroup;
      chokeSelect.append(option);
    }
    choke.append(chokeTitle, chokeSelect);
    playback.append(choke);
    identity.append(label, details, playback);
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

function renderSamplerSceneSlots(clips = sampler.listClips()) {
  if (!samplerSceneList) return;
  const slots = samplerScenes.list(clips);
  samplerPanel.dataset.scenePersisted = String(samplerScenes.isPersisted());
  samplerPanel.dataset.sceneSlots = String(slots.length);
  samplerPanel.dataset.sceneReady = String(slots.filter((slot) => slot.status === 'ready').length);
  samplerPanel.dataset.sceneMissing = String(slots.filter((slot) => slot.status === 'missing').length);
  const sequenceState = samplerSequence.getState();
  samplerPanel.dataset.sequenceEnabled = String(sequenceState.enabled);
  samplerPanel.dataset.sequenceRemaining = String(sequenceState.remaining);
  samplerPanel.dataset.sequenceCycle = String(sequenceState.cycle);
  samplerPanel.dataset.sequenceLastClipId = sequenceState.lastClipId;
  samplerSequenceButton.dataset.on = String(sequenceState.enabled);
  samplerSequenceButton.setAttribute('aria-pressed', String(sequenceState.enabled));
  samplerSequenceButton.textContent = sequenceState.enabled ? 'non-repeat on' : 'non-repeat off';
  samplerSequenceStatus.textContent = sequenceState.enabled
    ? `${clips.length} local clips · ${sequenceState.remaining} left in bag`
    : 'mapped clip only';
  const textureConfig = CONFIG.sampler.texture;
  samplerPanel.dataset.textureEnabled = String(samplerTextureState.enabled);
  samplerPanel.dataset.textureTarget = selectedGestureClipId;
  samplerPanel.dataset.textureGrainMs = String(Math.round(samplerTextureState.grainSizeSeconds * 1000));
  samplerPanel.dataset.textureScatter = samplerTextureState.scatter.toFixed(2);
  samplerTextureButton.dataset.on = String(samplerTextureState.enabled);
  samplerTextureButton.setAttribute('aria-pressed', String(samplerTextureState.enabled));
  samplerTextureButton.textContent = samplerTextureState.enabled ? 'texture on' : 'texture off';
  for (const field of samplerTextureFields) {
    const key = field.dataset.samplerTextureField;
    field.value = String(samplerTextureState[key]);
    const output = samplerPanel.querySelector(`[data-sampler-texture-output="${key}"]`);
    if (output) output.textContent = key === 'grainSizeSeconds'
      ? `${Math.round(samplerTextureState[key] * 1000)} ms`
      : `${Math.round(samplerTextureState[key] * 100)}%`;
  }
  const textureTarget = clips.find((clip) => clip.id === selectedGestureClipId)?.label || '';
  samplerTextureStatus.textContent = samplerTextureState.enabled
    ? `${textureTarget || 'map one clip'} · ${textureConfig.grainCount} grains · bounded`
    : 'mapped sample · normal';
  samplerSceneList.replaceChildren();
  for (const slot of slots) {
    const row = document.createElement('article');
    row.className = 'sampler-scene';
    row.dataset.slot = String(slot.index + 1);
    row.dataset.status = slot.status;
    const label = document.createElement('output');
    label.textContent = slot.status === 'empty'
      ? `${slot.index + 1} · empty`
      : `${slot.index + 1} · ${slot.label}${slot.status === 'missing' ? ' · missing' : ''}`;
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'save';
    save.dataset.samplerSceneSave = String(slot.index);
    const recall = document.createElement('button');
    recall.type = 'button';
    recall.textContent = 'recall';
    recall.dataset.samplerSceneRecall = String(slot.index);
    row.append(label, save, recall);
    samplerSceneList.append(row);
  }
}

function saveSamplerScene(index) {
  const clip = sampler.listClips().find((candidate) => candidate.id === selectedGestureClipId);
  const result = samplerScenes.save(index, clip);
  renderSamplerSceneSlots();
  samplerStatusOutput.textContent = result.status === 'unassigned'
    ? `slot ${Number(index) + 1} unchanged · map a clip first`
    : `slot ${Number(index) + 1} saved · ${result.slot.label} · local only`;
}

function recallSamplerScene(index) {
  const armedBefore = sampler.getState().armed;
  const result = samplerScenes.recall(index, sampler.listClips());
  if (result.status === 'ready') {
    selectedGestureClipId = result.clip.id;
    selectedGestureClipLabel = result.clip.label;
    persistPerformanceMappingState();
    renderSamplerSurface();
    renderFrameSurface();
    recordScoreEvent({
      kind: 'scene', action: 'sample-recall', label: result.clip.label,
      data: { slot: Number(index) + 1, clipId: result.clip.id },
    });
    samplerStatusOutput.textContent = `slot ${Number(index) + 1} recalled · ${result.clip.label} · playback ${armedBefore ? 'unchanged' : 'still off'}`;
    return;
  }
  renderSamplerSceneSlots();
  samplerStatusOutput.textContent = result.status === 'missing'
    ? `slot ${Number(index) + 1} missing · ${result.slot.label} · mapping unchanged`
    : `slot ${Number(index) + 1} empty · mapping unchanged`;
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
  const addedClipIds = [];
  let failureMessage = '';
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
      addedClipIds.push(imported.id);
      if (!await sampler.renameClip(imported.id, entry.label)) throw new Error(`could not label ${entry.label}`);
    }
    setStatus('NASA pocket set · four local clips ready to audition and map');
  } catch (error) {
    let rollbackComplete = true;
    for (let index = addedClipIds.length - 1; index >= 0; index -= 1) {
      try {
        if (!await sampler.deleteClip(addedClipIds[index])) rollbackComplete = false;
      } catch {
        rollbackComplete = false;
      }
    }
    failureMessage = rollbackComplete
      ? 'NASA pocket set unavailable · attempt rolled back; existing clips unchanged'
      : 'NASA pocket set unavailable · rollback incomplete; review local clips';
    setStatus(`NASA pocket set · ${String(error?.message || 'unavailable').slice(0, 100)}`);
  } finally {
    renderSamplerSurface();
    if (failureMessage) samplerStatusOutput.textContent = failureMessage;
  }
}

function invalidateGeneratedFrameBackground(state) {
  generatedFrameRequestId += 1;
  generatedFrameBackground = Object.freeze({ image: null, prompt: '', seed: null, state });
  const button = framePanel.querySelector('[data-frame-generate]');
  if (button) button.disabled = false;
}

function clearGeneratedFrameBackground() {
  invalidateGeneratedFrameBackground('local recipe active · generated still cleared');
  renderFrameSurface();
}

async function generateFrameBackground() {
  const settings = frameConfigurator.getState();
  const prompt = String(settings.prompt || '').trim();
  const seed = Number(settings.seed);
  if (!prompt) {
    invalidateGeneratedFrameBackground('enter a prompt before generate still');
    renderFrameSurface(settings);
    return;
  }
  const requestId = ++generatedFrameRequestId;
  const button = framePanel.querySelector('[data-frame-generate]');
  if (button) button.disabled = true;
  generatedFrameBackground = Object.freeze({ image: null, prompt, seed, state: 'generating local background · camera is not sent' });
  renderFrameSurface(settings);
  try {
    const response = await studioOnly('/api/background', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, seed, aspectRatio: '16:9' }),
    });
    const payload = await response.json().catch(() => ({}));
    if (requestId !== generatedFrameRequestId) return;
    if (!response.ok || !payload?.image) throw new Error(payload?.error || `generator ${response.status}`);
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('generated image could not load'));
      image.src = payload.image;
    });
    if (requestId !== generatedFrameRequestId) return;
    generatedFrameBackground = Object.freeze({ image, prompt, seed, state: `generated still · ${payload.model || 'OpenRouter'} · local tab only` });
    setStatus('generated background ready · only the typed prompt left this Mac');
  } catch (error) {
    if (requestId !== generatedFrameRequestId) return;
    generatedFrameBackground = Object.freeze({ image: null, prompt, seed, state: `generator unavailable · ${String(error?.message || 'check .env.local').slice(0, 90)}` });
    setStatus('generated background unavailable · local recipe remains active');
  } finally {
    if (requestId === generatedFrameRequestId) {
      if (button) button.disabled = false;
      renderFrameSurface(settings);
    }
  }
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
  if (latestSamplerStatus.message) setStatus(latestSamplerStatus.message);
}

function setSamplerConsole(active) {
  const open = Boolean(active);
  if (open) closeSetupPanel();
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
  syncPanelButtons();
}

function toggleSamplerConsole() {
  setSamplerConsole(samplerPanel.hidden);
}

function setFrameConsole(active) {
  const open = Boolean(active);
  if (open) closeSetupPanel();
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
  setButtonState('frame-setup', open);
  if (open) {
    if (frameConfigurator.getState().focusSource === 'face') frameConfigurator.configure({ focusSource: 'roi', focusDetail: 'whole' });
    renderFrameSurface();
    setStatus('frame setup · local settings stay in this browser');
  }
  syncPanelButtons();
}

function toggleFrameConsole() {
  setFrameConsole(framePanel.hidden);
}

function setFramePerformance(active) {
  framePerformanceArmed = Boolean(active);
  demoFrame.setAttribute('aria-pressed', String(framePerformanceArmed));
  if (!framePerformanceArmed) clearAuthoredFrame();
  else if (frameConfigurator.getState().focusSource === 'object') setLiveObjects(true);
  setButtonState('frame', framePerformanceArmed);
  framePanel.querySelector('[data-frame-arm]').setAttribute('aria-pressed', String(framePerformanceArmed));
  setStatus(framePerformanceArmed
    ? 'Frame armed · pinch with the thumb and index finger on each hand'
    : 'frame off · shaper field remains live');
}

function setFrameDrawing(active) {
  document.body.dataset.frameDrawing = String(active);
  framePanel.querySelector('[data-frame-draw]').setAttribute('aria-pressed', String(active));
}

function clearAuthoredFrame() {
  if (framePointerId !== null && stage.hasPointerCapture?.(framePointerId)) stage.releasePointerCapture(framePointerId);
  framePointerId = null;
  manualFrame = null;
  setFrameDrawing(false);
  gestureFrameState = gestureFrame.reset(frameZoneClock);
  frameContent.reset();
  frameZoneState = frameZones.reset(frameZoneClock);
  roiFeatureState = roiFeatureLock.reset(frameZoneClock);
  lastRoiFeatureSampleAt = -Infinity;
  frameObjectCropState = frameObjectCrop.reset(frameZoneClock);
}

function drawFrameWithPointer() {
  clearAuthoredFrame();
  enterSystem();
  if (frameConfigurator.getState().mode !== 'object') frameConfigurator.configure({ mode: 'object' });
  setFramePerformance(true);
  setFrameConsole(false);
  setFrameDrawing(true);
  setStatus('drag a rectangle on the image · ESC cancels');
}

function setSceneConsole(active) {
  const open = Boolean(active);
  if (open) closeSetupPanel();
  if (open && calibrationState.active) setCalibration(false);
  if (open && !narrativePanel.hidden) setNarrativeConsole(false);
  if (open && !entityPanel.hidden) setEntityConsole(false);
  if (open && !samplerPanel.hidden) setSamplerConsole(false);
  if (open && !framePanel.hidden) setFrameConsole(false);
  if (open && !musicPanel.hidden) setMusicConsole(false);
  if (open && !patchPanel.hidden) setPatchConsole(false);
  if (open && !capturePanel.hidden) setCaptureConsole(false);
  scenePanel.hidden = !open;
  scenePanel.dataset.open = String(open);
  setButtonState('scene', open);
  if (open) {
    renderSceneSurface(controls.scene);
    setStatus(`scene tune · mode ${controls.mode + 1} · settings stay in this browser`);
  }
  syncPanelButtons();
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
  setNarrativeStatus('loading ElevenLabs voices · no audio starts');
  narrativeVoiceSelect.disabled = true;
  try {
    const response = await studioOnly('/api/narrator-voices', { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok || !Array.isArray(payload.voices) || !payload.voices.length) {
      throw new Error(payload?.error || 'no narrator voices available');
    }
    narrativeVoiceSelect.replaceChildren();
    for (const voice of payload.voices) {
      const option = document.createElement('option');
      option.value = String(voice.id || '');
      option.textContent = `${voice.name || 'voice'}${voice.description ? ` · ${voice.description}` : ''}`;
      narrativeVoiceSelect.append(option);
    }
    narrativeVoiceSelect.value = String(payload.defaultVoiceId || narrativeVoiceSelect.options[0]?.value || '');
    narrativeVoiceSelect.disabled = narrativeState.source !== 'generated';
    narrativeState.voicesLoaded = true;
    setNarrativeStatus(narrativeState.source === 'generated'
      ? 'voice ready · CREATE VOICE sends only the visible script'
      : 'local Alex source loaded · generated voices are ready when selected');
  } catch (error) {
    setNarrativeStatus(`narrator unavailable · ${error.message}`);
  }
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
  const sourceChanged = narrativeState.source !== sourceId;
  stopNarration();
  narrativeState.source = sourceId;
  if (sourceChanged) {
    voiceMemory?.configure?.({ phraseStartSeconds: CONFIG.narration.memory.phraseStartSeconds });
    persistVoiceMemorySettings();
    renderVoiceMemorySurface();
  }
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
  if (narrativeState.source !== 'generated') {
    setNarrativeStatus('choose generated source before CREATE VOICE');
    return;
  }
  const text = String(narrativeTextInput.value || '').trim();
  const voiceId = String(narrativeVoiceSelect.value || '').trim();
  const profile = String(narrativeProfileSelect?.value || CONFIG.narration.defaultProfile);
  if (!text || !voiceId) {
    setNarrativeStatus('write a script and choose a voice first');
    return;
  }
  stopNarration();
  narrativeGenerateButton.disabled = true;
  narrativePlayButton.disabled = true;
  setNarrativeStatus('creating ElevenLabs narration · this may take a moment');
  try {
    const response = await studioOnly('/api/narration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId, language: narrativeLanguageSelect.value, profile }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error || `narration request failed (${response.status})`);
    }
    const audio = await response.blob();
    if (!audio.size) throw new Error('received empty narration audio');
    releaseNarrationAudio();
    narrativeState.objectUrl = URL.createObjectURL(audio);
    narrativeAudio.src = narrativeState.objectUrl;
    narrativeAudio.load();
    voiceMemory.configure({ phraseStartSeconds: CONFIG.narration.memory.phraseStartSeconds });
    persistVoiceMemorySettings();
    narrativeState.lines = narrationLines(text);
    narrativeState.lineIndex = -1;
    narrativeState.generatedText = text;
    narrativeState.generatedVoiceName = narrativeVoiceSelect.options[narrativeVoiceSelect.selectedIndex]?.textContent || 'ElevenLabs voice';
    narrativePlayButton.disabled = false;
    const profileLabel = CONFIG.narration.profiles[profile]?.label || profile;
    narrativeMeta.textContent = `${narrativeState.generatedVoiceName} · ${profileLabel} · ${(audio.size / (1024 * 1024)).toFixed(1)} MB · local temporary playback`;
    setNarrativeStatus('voice ready · PLAY POEM starts it explicitly');
  } catch (error) {
    setNarrativeStatus(`narration unavailable · ${error.message}`);
  } finally {
    narrativeGenerateButton.disabled = false;
  }
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
  if (open) closeSetupPanel();
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
  if (open) setNarrativeStatus('Play a recorded voice or import your own audio');
  if (open) setNarrativeSource(narrativeSourceSelect.value || CONFIG.narration.defaultSource);
  if (open) renderVoiceMemorySurface();
  syncPanelButtons();
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
  const phraseStart = Number(state.settings.phraseStartSeconds) || 0;
  const phraseLength = Number(state.settings.fragmentLengthSeconds) || CONFIG.narration.memory.fragmentLengthSeconds;
  if (narrativeMemoryPhrase) {
    narrativeMemoryPhrase.textContent = `${phraseStart > 0 ? `@${phraseStart.toFixed(1)}s` : 'opening'} · ${phraseLength.toFixed(1)}s`;
  }
  const markAvailable = narrationMediaIsSelected()
    && Number.isFinite(Number(narrativeAudio.duration))
    && Number(narrativeAudio.duration) > 0;
  if (narrativeMemoryMarkButton) narrativeMemoryMarkButton.disabled = !markAvailable;
  if (narrativeMemoryOpeningButton) narrativeMemoryOpeningButton.disabled = phraseStart === 0;
  narrativePanel.dataset.memoryActive = String(Boolean(state.active));
  narrativePanel.dataset.memoryScheduled = String(Boolean(state.scheduled));
  narrativePanel.dataset.memoryPhraseStart = phraseStart.toFixed(3);
  if (narrativeMemoryStatus) narrativeMemoryStatus.textContent = state.lastEvent;
}

function handleVoiceMemoryControl(event) {
  const input = event.target.closest?.('[data-voice-memory]');
  if (!input) return;
  const key = input.dataset.voiceMemory;
  const value = input.type === 'checkbox' ? input.checked : Number(input.value);
  voiceMemory.configure({ [key]: value });
  persistVoiceMemorySettings();
  renderVoiceMemorySurface();
}

function markVoiceMemoryPhrase() {
  const duration = Number(narrativeAudio.duration);
  if (!narrationMediaIsSelected() || !Number.isFinite(duration) || duration <= 0) {
    setNarrativeStatus('load a voice before marking its memory phrase');
    return;
  }
  const phraseStartSeconds = Math.min(Math.max(0, duration - Number.EPSILON), Math.max(0, Number(narrativeAudio.currentTime) || 0));
  voiceMemory.configure({ phraseStartSeconds });
  persistVoiceMemorySettings();
  renderVoiceMemorySurface();
  setNarrativeStatus(`memory phrase marked at ${phraseStartSeconds.toFixed(1)}s · playback state unchanged`);
}

function useVoiceMemoryOpening() {
  voiceMemory.configure({ phraseStartSeconds: CONFIG.narration.memory.phraseStartSeconds });
  persistVoiceMemorySettings();
  renderVoiceMemorySurface();
  setNarrativeStatus('memory phrase returned to opening · playback state unchanged');
}

function renderVoiceCaptionSurface() {
  if (!voiceCaption || !liveCaption) return;
  const state = voiceCaption.getState();
  const button = controlsBar.querySelector('[data-action="captions"]');
  const active = state.active || geometryControls?.isListening();
  if (button) {
    button.dataset.on = String(Boolean(active));
    button.textContent = active ? 'voice text on' : 'voice text';
  }
  if (captionLanguageSelect && document.activeElement !== captionLanguageSelect) {
    captionLanguageSelect.value = state.language;
  }
  if (liveCaptionText && liveCaptionText.textContent !== state.text) liveCaptionText.textContent = state.text;
  if (liveCaptionStatus) liveCaptionStatus.textContent = state.lastEvent;
  liveCaption.hidden = !state.active && !state.text;
  liveCaption.dataset.active = String(Boolean(state.active));
}

async function toggleVoiceCaptions() {
  const state = voiceCaption.getState();
  if (state.active || geometryControls?.isListening()) {
    voiceCaption.stop('voice text stopped · last phrase held');
    geometryControls?.stopListening();
    renderVoiceCaptionSurface();
    return;
  }
  if (!running) enterSystem();
  await geometryControls.startListening();
  renderVoiceCaptionSurface();
  setStatus('Local Whisper · phrases rise from tracked mouth · say “Сотник” before a command');
}

function renderSpeechTrace(time, frame) {
  const container = $('#speech-trace');
  const words = speechTrace.update(time, frame.faces?.[0]);
  const current = new Set(words.map(word => word.id));
  for (const [id, element] of speechTraceNodes) {
    if (!current.has(id)) { element.remove(); speechTraceNodes.delete(id); }
  }
  for (const word of words) {
    let element = speechTraceNodes.get(word.id);
    if (!element) {
      element = document.createElement('span'); element.textContent = word.text;
      container.append(element); speechTraceNodes.set(word.id, element);
    }
    element.style.left = `${Math.round(word.x * innerWidth)}px`;
    element.style.top = `${Math.round(word.y * innerHeight)}px`;
    element.style.opacity = String(word.opacity);
  }
}

function toggleNarrativeConsole() {
  setNarrativeConsole(narrativePanel.hidden);
}

function handleSceneControl(event) {
  const preset = event.target.closest('[data-scene-preset]');
  if (preset) {
    sceneConfigurator.applyPreset(controls.mode, preset.dataset.scenePreset);
    recordScoreEvent({
      kind: 'scene', action: 'preset', label: preset.dataset.scenePreset,
      data: { mode: controls.mode, preset: preset.dataset.scenePreset },
    });
    setStatus(`scene preset · ${preset.dataset.scenePreset}`);
    return;
  }
  const field = event.target.closest('[data-scene-field]');
  if (field) {
    const key = field.dataset.sceneField;
    const value = Number(field.value);
    sceneConfigurator.configure(controls.mode, { [key]: value });
    if (event.type === 'change') {
      recordScoreEvent({ kind: 'scene', action: 'tune', label: key, data: { mode: controls.mode, key, value } });
    }
  }
}

const FINGER_NEUTRAL_ORDER = Object.freeze([
  ['thumb', 'T'], ['index', 'I'], ['middle', 'M'], ['ring', 'R'], ['pinky', 'P'],
]);

function fingerNeutralProfileText(side, profile) {
  const label = side.toUpperCase();
  if (!profile?.saved) return `${label} · RAW`;
  const values = FINGER_NEUTRAL_ORDER.map(([name, short]) => (
    `${short}${Math.round(clamp(profile.neutral?.[name]) * 100)}`
  ));
  return `${label} · ${values.join(' ')}`;
}

function renderFingerCalibrationSurface(timestamp = performance.now()) {
  if (!fingerCalibrationPanel || !fingerCalibration) return;
  const state = fingerCalibration.getState(timestamp);
  fingerCalibrationPanel.dataset.phase = state.phase;
  fingerCalibrationPanel.dataset.side = state.side || '';
  if (fingerCalibrationStatus) fingerCalibrationStatus.textContent = state.lastEvent;
  if (fingerCalibrationProgress) fingerCalibrationProgress.style.width = `${Math.round(clamp(state.progress) * 100)}%`;
  for (const button of fingerCalibrationPanel.querySelectorAll('[data-finger-calibrate]')) {
    button.dataset.active = String(state.active && button.dataset.fingerCalibrate === state.side);
  }
  for (const output of fingerProfileOutputs) {
    const side = output.dataset.fingerProfile;
    const profile = state.profiles?.[side];
    output.dataset.saved = String(Boolean(profile?.saved));
    output.textContent = fingerNeutralProfileText(side, profile);
  }
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
  renderFingerCalibrationSurface();
  const state = music.getState();
  renderFingerEnvelopeSurface(state);
  renderMpeOutputSurface();
  const focusedNote = state.activeNotes?.at?.(-1)?.note ?? 60;
  ensureMusicKeyboard(focusedNote);
  const handRoute = latestEntitySettings?.settings?.hands?.sound
    ?? CONFIG.entities.sources.hands.sound;
  musicPanel.dataset.armed = String(Boolean(state.armed));
  musicPanel.dataset.silent = String(Boolean(state.silent));
  renderMusicTransport();
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
    const left = state.fingers?.hands?.left;
    const right = state.fingers?.hands?.right;
    musicFingerOutput.textContent = `SCENE ${(state.fingerOctaveScene || 'close').toUpperCase()} · L ${left?.active ? 'LIVE' : 'OFF'} · R ${right?.active ? 'LIVE' : 'OFF'} · HATS ${state.hatsEnabled ? 'ON' : 'OFF'}`;
  }
  if (musicRoleHint) {
    const role = state.handRole === 'left' ? 'left' : state.handRole === 'right' ? 'right' : 'both hands';
    musicRoleHint.textContent = `${role} plays pinch accents · octave setting ${state.fingerOctaveScene} · hand assignments persist when hands cross.`;
  }
  if (musicOutputPath) {
    if (state.contextState !== 'running') {
      musicOutputPath.textContent = `audio context · ${state.contextState} · choose START SOUND, then PLAY TEST NOTE`;
    } else if (state.voiceCount > 0) {
      musicOutputPath.textContent = 'browser synth is playing locally · check the browser tab volume and selected audio output';
    } else {
      musicOutputPath.textContent = 'WebAudio ready → selected audio output · use PLAY TEST NOTE to check your speakers';
    }
  }
  if (musicLastEventOutput) musicLastEventOutput.textContent = `last event · ${state.lastEvent || 'idle'}`;
  renderMicCalibrationSurface();
}

function renderMpeOutputSurface(state = mpeOutput?.getState?.()) {
  if (!mpeOutputPanel || !state) return;
  mpeOutputPanel.dataset.enabled = String(Boolean(state.enabled));
  mpeOutputPanel.dataset.connected = String(Boolean(state.connected));
  mpeOutputToggle.dataset.on = String(Boolean(state.connected));
  mpeOutputToggle.textContent = state.connected
    ? 'mpe out live'
    : state.enabled ? 'retry mpe out' : 'enable mpe out';
  const outputs = Array.isArray(state.outputs) ? state.outputs : [];
  const optionKey = outputs.map((item) => `${item.id}:${item.name}`).join('|');
  if (mpeOutputSelect.dataset.options !== optionKey) {
    mpeOutputSelect.replaceChildren();
    const standby = document.createElement('option');
    standby.value = '';
    standby.textContent = outputs.length ? 'choose MIDI output' : 'no output · enable first';
    mpeOutputSelect.append(standby);
    for (const item of outputs) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      mpeOutputSelect.append(option);
    }
    mpeOutputSelect.dataset.options = optionKey;
  }
  mpeOutputSelect.disabled = outputs.length === 0;
  if (state.outputId && mpeOutputSelect.value !== state.outputId) mpeOutputSelect.value = state.outputId;
  mpeOutputStatus.textContent = state.connected
    ? `${state.outputName} · lower zone ${state.masterChannel} + ${state.memberChannels[0]}–${state.memberChannels.at(-1)}`
    : state.error || state.lastEvent;
  mpeOutputActivity.textContent = state.connected
    ? `${state.activeNotes} notes · bend ${Math.round(state.bendCents)}c / ±${Math.round(state.bendRangeSemitones * 100)}c · cc74 ${state.timbre}`
    : '0 notes · no outbound MIDI';
}

function fingerEnvelopeMilliseconds(value) {
  return `${Math.round((Number(value) || 0) * 1000)} ms`;
}

function renderFingerEnvelopeSurface(state = music?.getState?.()) {
  if (!fingerEnvelopePanel || !state?.fingers) return;
  const gates = state.fingers.gates || {};
  const hands = state.fingers.hands || {};
  const envelopes = state.fingers.envelopes || {};
  const envelopeState = fingerEnvelope?.getState?.();
  const status = fingerEnvelopePanel.querySelector('[data-finger-envelope-status]');
  if (status) {
    const left = hands.left?.active ? `L ${hands.left.trackId || 'live'}` : 'L absent';
    const right = hands.right?.active ? `R ${hands.right.trackId || 'live'}` : 'R absent';
    status.textContent = `${state.fingerOctaveScene || 'close'} · ${left} · ${right} · ${envelopeState?.lastEvent || 'local envelope score'}`;
  }
  for (const card of fingerEnvelopePanel.querySelectorAll('[data-finger-envelope-card]')) {
    const finger = card.dataset.fingerEnvelopeCard;
    card.dataset.gate = gates[finger] || 'off';
  }
  for (const output of fingerEnvelopePanel.querySelectorAll('[data-finger-gate]')) {
    const [side, finger] = output.dataset.fingerGate.split(':');
    const gate = hands[side]?.gates?.[finger] || 'off';
    output.textContent = String(gate).toUpperCase();
    output.parentElement.dataset.gate = gate;
  }
  for (const noteOutput of fingerEnvelopePanel.querySelectorAll('[data-finger-note]')) {
    const [side, finger] = noteOutput.dataset.fingerNote.split(':');
    const note = hands[side]?.notes?.[finger];
    noteOutput.textContent = `${side === 'left' ? 'L' : 'R'} · ${Number.isFinite(note) ? musicNoteLabel(note) : '–'}`;
  }
  for (const input of fingerEnvelopePanel.querySelectorAll('[data-finger-envelope]')) {
    const finger = input.dataset.fingerEnvelope;
    const field = input.dataset.fingerEnvelopeField;
    const value = envelopes[finger]?.[field];
    if (Number.isFinite(value) && document.activeElement !== input) input.value = String(value);
  }
  for (const output of fingerEnvelopePanel.querySelectorAll('[data-finger-envelope-output]')) {
    const [finger, field] = output.dataset.fingerEnvelopeOutput.split(':');
    output.textContent = fingerEnvelopeMilliseconds(envelopes[finger]?.[field]);
  }
}

function setMusicConsole(active) {
  const open = Boolean(active);
  if (open) closeSetupPanel();
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
  syncPanelButtons();
}

function toggleMusicConsole() {
  setMusicConsole(musicPanel.hidden);
}

function setCaptureConsole(active) {
  const open = Boolean(active);
  if (open) closeSetupPanel();
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
    setStatus('local capture + causal score · each recorder starts only from its own REC');
  }
  syncPanelButtons();
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
  patchToggleButton.textContent = runningPatch ? 'hold ghost wire' : 'enable ghost wire';
  patchStatusOutput.textContent = state.status === 'running'
    ? `ghost-wire live · ${Math.round(state.fps || 0)} fps · X suspends instantly`
    : `${state.status} · ${state.reason}`;
  patchAxesOutput.textContent = `hands ${Math.round(patchVisualState.hands * 100)}% · frame ${Math.round(patchVisualState.frame * 100)}% · MIDI ${Math.round(patchVisualState.midi * 100)}% · pulse ${Math.round(patchVisualState.pulse * 100)}%`;
  const bridge = localBridge?.getState?.() || { status: 'idle', sent: 0, lastEvent: 'local bridge idle' };
  patchPanel.dataset.bridgeStatus = bridge.status;
  localBridgeStatus.textContent = `${bridge.lastEvent} · sent ${bridge.sent}`;
  localBridgeUrl.disabled = bridge.status === 'open' || bridge.status === 'connecting';
  localBridgeConnect.disabled = bridge.status === 'open' || bridge.status === 'connecting';
  localBridgeDisconnect.disabled = !['open', 'connecting'].includes(bridge.status);
}

function setGloveMaterial(id, persist = !shaperDemo) {
  if (!['silk','dust','composite'].includes(id)) return;
  controls.gloveMaterial = id;
  markPreset('gloveMaterial', id);
  if (persist) writeLocal('mythtrace.glove-material.v1', id);
}
$('[data-relief-depth]').addEventListener('input', event => {
  configureLightScore({reliefDepth: Number(event.currentTarget.value)});
});

$('[data-glove-materials]').addEventListener('click', event => {
  const button = event.target.closest('[data-glove-material]');
  if (button) setGloveMaterial(button.dataset.gloveMaterial);
});

function configureLightScore(patch, persist = !shaperDemo) {
  controls.lightScore = normalizeGeometry(patch, controls.lightScore);
  const actual = controls.lightScore;
  syncFocusSurface();
  $('[data-glove-materials]').hidden = actual.study !== 'wire-gloves';
  $('[data-relief-control]').hidden = actual.study !== 'pigment-relief' || controls.geometryMuted;
  $('[data-relief-tracking]').hidden = $('[data-relief-control]').hidden;
  $('[data-relief-depth]').value = String(actual.reliefDepth);
  $('[data-relief-value]').value = Math.round(actual.reliefDepth * 100) + '%';
  if (shaperDemo) {
    shaperDemo.amount = actual.strength;
    demoAmount.value = String(actual.strength);
  }
  geometryPreset = actual.study || (actual.auto ? 'auto' : Object.keys(presets.geometries).find(id => {
    const expected = presets.geometries[id];
    return !expected.study && expected.auto === actual.auto && expected.palette === actual.palette && expected.attack === actual.attack
      && Object.keys(actual.layers).length === Object.keys(expected.layers).length
      && Object.entries(expected.layers).every(([layer, weight]) => actual.layers[layer] === weight);
  }) || '');
  const studyGuide = $('[data-study-guide]');
  studyGuide.hidden = !actual.study || controls.geometryMuted;
  studyGuide.textContent = presets.geometries[actual.study]?.note || '';
  markPreset('geometryPreset', controls.geometryMuted ? 'off' : geometryPreset);
  const intensity = Object.keys(presets.geometryIntensity).find(id => presets.geometryIntensity[id] === actual.strength);
  markPreset('geometryIntensity', intensity);
  renderGeometryLayerButtons();
  $('[data-geometry-intensity-value]').textContent = `${Math.round(actual.strength * 100)}%`;
  music.update({ transpose: controls.lightScore.transpose, major: controls.lightScore.major,
    handHarmony: controls.lightScore.harmony });
  geometryControls?.render();
  if (persist) {
    try { localStorage.setItem(CONFIG.lightScore.storageKey, JSON.stringify(controls.lightScore)); } catch {}
  }
}

function adjustStageEffects(delta) {
  if (shaperDemo) {
    const strength = clamp(controls.lightScore.strength + delta);
    configureLightScore({ strength }, false);
    shaperDemo.amount = strength;
    demoAmount.value = String(strength);
    setStatus(`Demo geometry · ${Math.round(strength * 100)}%`);
  } else if (!patchPanel.hidden) configureLightScore({ strength: clamp(controls.lightScore.strength + delta) });
  else nudgeLiveControl('intensity', delta);
}

const liveShadow = { enabled: false, motion: null, signature: '', inspectAt: -Infinity, requestAt: -Infinity, generation: 0 };
let shadowRequestGeneration = 0;
const liveShadowButton = agentPanel.querySelector('[data-sotnik-live]');

function stageSignal() {
  return {
    hands: Math.min(2, trackingFrame.hands?.length || 0),
    faces: Math.min(1, trackingFrame.faces?.length || 0),
    bodies: Math.min(1, trackingFrame.poses?.length || 0),
    objects: Math.min(8, trackingFrame.objects?.length || 0),
    motion: Math.round(clamp(trackingFrame.metrics?.motion) * 10),
    frame: gestureFrameState?.phase || 'searching',
    music: Boolean(music.getState().armed || wagnerScore.state.playing || atmosphere.active()),
  };
}

function setLiveShadow(enabled) {
  liveShadow.enabled = enabled;
  liveShadow.generation++;
  liveShadow.signature = '';
  liveShadow.inspectAt = -Infinity;
  liveShadowButton.setAttribute('aria-pressed', String(enabled));
  agentPanel.querySelector('[data-sotnik-status]').textContent = enabled
    ? 'VM105 · waiting for a scene change' : 'Live shadow · off';
}

function pollLiveShadow(time) {
  const { inspectMs, cooldownMs, motionDelta } = CONFIG.lightScore.agent;
  if (!liveShadow.enabled || document.hidden || entry.dataset.hidden !== 'true' || !controls.lightScore.auto
    || !['face', 'forms', 'hands', 'objects'].includes(workflow) || controls.paused
    || time - liveShadow.inspectAt < inspectMs) return;
  liveShadow.inspectAt = time;
  if (time - liveShadow.requestAt < cooldownMs) return;
  const signal = stageSignal();
  const { hands, bodies, objects, motion, music } = signal;
  if (!hands && !bodies && !objects && !motion && !music) {
    liveShadow.signature = '';
    liveShadow.motion = null;
    return;
  }
  const signature = [hands, bodies, objects, music].join(':');
  if (liveShadow.signature === signature && Math.abs(motion - liveShadow.motion) < motionDelta) return;
  liveShadow.signature = signature;
  liveShadow.motion = motion;
  void analyseStage('Нарисуй короткую контурную тень для текущего состояния сцены.', {
    live: true, signal, generation: liveShadow.generation,
  });
}

liveShadowButton.addEventListener('click', () => setLiveShadow(!liveShadow.enabled));

async function analyseStage(direction = '', request = {}) {
  const generation = shadowRequestGeneration;
  const button = agentPanel.querySelector('[data-sotnik-analyse]');
  const status = agentPanel.querySelector('[data-sotnik-status]');
  if (button.disabled) return;
  const telemetry = {
    ...(request.signal || stageSignal()),
    direction: String(direction).slice(0, 280),
  };
  liveShadow.requestAt = performance.now();
  const cancelled = () => generation !== shadowRequestGeneration || request.live && (request.generation !== liveShadow.generation
    || !controls.lightScore.auto || !['face', 'forms', 'hands', 'objects'].includes(workflow));
  button.disabled = true;
  status.textContent = 'VM105 · waiting for cue';
  try {
    const response = await studioOnly('/api/sotnik', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(telemetry),
    });
    const result = await response.json();
    if (cancelled()) return;
    if (!response.ok) throw new Error(result.error || 'SOTNIK unavailable');
    const shadow = normalizeShadow(result.shadow);
    if (!shadow) throw new Error('Sotnik returned no shape');
    configureLightScore({ shadow }, !request.live);
    status.textContent = Number.isFinite(result.outputTokens)
      ? `${result.cue} · ${result.outputTokens} tokens` : result.cue;
  } catch (error) {
    if (cancelled()) return;
    status.textContent = error instanceof SyntaxError ? 'apply the current server build first' : error.message;
  } finally {
    button.disabled = false;
  }
}

function connectLocalBridge() {
  const state = localBridge.connect(localBridgeUrl.value);
  renderPatchSurface();
  setStatus(state.lastEvent);
}

function disconnectLocalBridge() {
  const state = localBridge.disconnect('manual');
  renderPatchSurface();
  setStatus(state.lastEvent);
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
  if (open) closeSetupPanel();
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
  syncPanelButtons();
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
  const weights = CONFIG.performancePatch.handControl;
  const fresh = (hand) => time - hand.lastSeen <= CONFIG.gestureFrame.freshnessMs;
  const left = tracking?.hands?.find(hand => hand.handedness === 'Left' && fresh(hand));
  const right = tracking?.hands?.find(hand => hand.handedness === 'Right' && fresh(hand));
  performancePatchInput.axes[0].value = clamp(
    (left ? (1 - clamp(left.palm?.y)) * weights.leftWeight : 0)
    + (right ? clamp(right.openness) * weights.rightWeight : 0)
    + clamp(metrics.handEnergy) * weights.motionWeight,
  );
  performancePatchInput.axes[1].value = gestureFrameState?.valid
    ? Math.sqrt(clamp(gestureFrameState.area)) : 0;
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
    const state = music.getState();
    try {
      localStorage.setItem(MUSIC_SETTINGS_KEY, JSON.stringify(
        Object.fromEntries(musicSettingFields.map(key => [key, state[key]])),
      ));
    } catch { /* audio controls still work without storage */ }
  }
  renderMusicSurface();
}

function handleFingerEnvelopeControl(event) {
  const input = event.target.closest('[data-finger-envelope]');
  if (!input) return;
  const finger = input.dataset.fingerEnvelope;
  const field = input.dataset.fingerEnvelopeField;
  const envelopeState = fingerEnvelope.configure(finger, { [field]: Number(input.value) });
  music.update({ timestamp: performance.now(), fingerEnvelope: envelopeState.values });
  renderMusicSurface();
}

function resetFingerEnvelopes() {
  const envelopeState = fingerEnvelope.reset();
  music.update({ timestamp: performance.now(), fingerEnvelope: envelopeState.values });
  renderMusicSurface();
  setStatus(envelopeState.lastEvent);
}

function startFingerNeutralCalibration(side) {
  const state = fingerCalibration.start(side, performance.now());
  renderFingerCalibrationSurface();
  setStatus(state.lastEvent);
}

function resetFingerNeutralCalibration() {
  const state = fingerCalibration.clear('both');
  renderFingerCalibrationSurface();
  setStatus(state.lastEvent);
}

function frameInputValue(input) {
  if (input.type === 'checkbox') return Boolean(input.checked);
  if (input.dataset.frameField === 'stageFill') return input.value === 'true';
  return input.type === 'range' || input.type === 'number'
    ? Number(input.value)
    : input.value;
}

function handleFrameControl(event) {
  if (event.type === 'click') {
    if (event.target.closest('[data-frame-arm]')) {
      toggleHandFrame();
      return;
    }
    if (event.target.closest('[data-frame-draw]')) { drawFrameWithPointer(); return; }
    if (event.target.closest('[data-frame-clear]')) { setFramePerformance(false); return; }
  }
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
  samplerStopPending = true;
  try {
    await sampler.toggleRecording();
    renderSamplerSurface();
    updateInputRitual();
  } finally { samplerStopPending = false; }
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

async function configureSamplerClip(event) {
  const field = event.target.closest('[data-sampler-clip-field]');
  if (!field) return;
  const clipId = field.dataset.clipId;
  const key = field.dataset.samplerClipField;
  const value = key === 'chokeGroup' ? field.value : Number(field.value);
  const updated = await sampler.configureClip(clipId, { [key]: value });
  renderSamplerSurface();
  samplerStatusOutput.textContent = updated
    ? `${updated.label} · ${Math.round(updated.playback.attackSeconds * 1000)}ms attack · ${Math.round(updated.playback.releaseSeconds * 1000)}ms release · choke ${updated.playback.chokeGroup}`
    : 'clip settings unavailable · no playback change';
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

function mediaCover(media, width, height) {
  const scale = Math.max(width / media.videoWidth, height / media.videoHeight);
  const w = media.videoWidth * scale, h = media.videoHeight * scale;
  return [(width - w) / 2, (height - h) / 2, w, h];
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
  if (controls.focusField && !(controls.focusCameraVisible && video.readyState >= 2)) {
    captureContext.fillStyle = '#050609';
    captureContext.fillRect(0, 0, width, height);
    captureContext.globalAlpha = CONFIG.focusField.shaderOpacity;
  } else if (controls.clipActive && localClip.readyState >= 2) {
    captureContext.drawImage(localClip, ...mediaCover(localClip, width, height));
    captureContext.globalCompositeOperation = 'screen';
    captureContext.globalAlpha = controls.clipEffects;
  } else if (document.body.dataset.cameraVisible === 'true' && video.readyState >= 2
    && !(controls.mode === 3 && glCanvas.dataset.renderer === 'webgl2' && !controls.focusField)) {
    captureContext.fillStyle = '#050609';
    captureContext.fillRect(0, 0, width, height);
    captureContext.save();
    captureContext.globalAlpha = controls.focusField ? .66 : .76;
    captureContext.filter = 'grayscale(.92) brightness(.70) contrast(1.13)';
    if (controls.mirrored) captureContext.setTransform(-1, 0, 0, 1, width, 0);
    captureContext.drawImage(video, 0, 0, width, height);
    captureContext.restore();
    captureContext.globalCompositeOperation = 'screen';
    captureContext.globalAlpha = controls.focusField ? CONFIG.focusField.shaderOpacity : .68;
  }
  captureContext.drawImage(glCanvas, 0, 0, width, height);
  liveLab.paint(captureContext, width, height);
  captureContext.globalCompositeOperation = 'source-over';
  captureContext.globalAlpha = 1;
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

function formatScoreDuration(value) {
  const seconds = Math.max(0, Math.round((Number(value) || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function renderScoreSurface(state = scoreRecorder?.getState?.()) {
  if (!state || !scoreEventsOutput) return;
  capturePanel.dataset.scoreRecording = String(Boolean(state.recording));
  capturePanel.dataset.scoreEvents = String(state.eventCount);
  capturePanel.dataset.scorePersisted = String(Boolean(state.persisted));
  scoreRecordButton.dataset.recording = String(Boolean(state.recording));
  scoreRecordButton.disabled = state.recording;
  scoreStopButton.disabled = !state.recording;
  scoreClearButton.disabled = state.recording || !state.score;
  scoreDownloadButton.disabled = state.recording || !state.score;
  scoreStatusOutput.textContent = state.lastEvent;
  scoreCapacityOutput.textContent = `${state.eventCount} / ${state.capacity} events · ${formatScoreDuration(state.durationMs)}`;
  scoreEventsOutput.replaceChildren();
  const events = state.score?.events || [];
  if (!events.length) {
    const empty = document.createElement('p');
    empty.textContent = state.recording
      ? 'recording · waiting for gesture, focus lock or scene change'
      : 'gesture · focus lock · scene changes · no raw media';
    scoreEventsOutput.append(empty);
    return;
  }
  for (const event of events.slice(-6).reverse()) {
    const row = document.createElement('div');
    row.className = 'score-event';
    const time = document.createElement('span');
    time.textContent = formatScoreDuration(event.t);
    const kind = document.createElement('b');
    kind.textContent = `${event.kind}.${event.action}`;
    const label = document.createElement('span');
    label.textContent = event.label || Object.values(event.data || {}).join(' · ') || 'event';
    row.append(time, kind, label);
    scoreEventsOutput.append(row);
  }
}

function recordScoreEvent(event, timestamp = performance.now()) {
  const accepted = scoreRecorder?.record?.(event, timestamp) || false;
  const bridged = localBridge?.emit?.(event, timestamp) || false;
  if (accepted && !capturePanel.hidden) renderScoreSurface();
  return accepted || bridged;
}

function updateScoreFocus(state = overlay.getFocusState?.(), timestamp = performance.now(), force = false) {
  const currentId = String(state?.selectedId || '');
  if (!force && currentId === scoreFocusId) return false;
  const previousId = scoreFocusId;
  scoreFocusId = currentId;
  if (!scoreRecorder?.getState?.(timestamp).recording) return false;
  if (!currentId) {
    if (!previousId) return false;
    return recordScoreEvent({
      kind: 'focus', action: 'release', label: 'focus released', data: { targetId: previousId },
    }, timestamp);
  }
  return recordScoreEvent({
    kind: 'focus', action: previousId ? 'select' : 'lock', label: state.label || state.kind || currentId,
    data: { targetId: currentId, targetKind: state.kind || 'target' },
  }, timestamp);
}

function startScoreRecording() {
  const timestamp = performance.now();
  scoreRecorder.start(timestamp);
  scoreFocusId = '';
  recordScoreEvent({
    kind: 'scene', action: 'mode', label: MODES[controls.mode].name,
    data: { mode: controls.mode, preset: sceneConfigurator.getModeSettings(controls.mode)?.preset || 'base' },
  }, timestamp);
  updateScoreFocus(overlay.getFocusState?.(), timestamp, true);
  renderScoreSurface();
  setStatus('causal score recording · gesture, focus and scene facts only');
}

function stopScoreRecording(reason = 'manual') {
  scoreRecorder.stop(reason, performance.now());
  renderScoreSurface();
  setStatus(`causal score stopped · ${scoreRecorder.getState().eventCount} events · local only`);
}

function clearScoreRecording() {
  scoreRecorder.clear();
  scoreFocusId = String(overlay.getFocusState?.()?.selectedId || '');
  renderScoreSurface();
  setStatus('causal score cleared locally');
}

function downloadScoreRecording() {
  const json = scoreRecorder.exportJson();
  const state = scoreRecorder.getState();
  if (!json || !state.score) return;
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `mythtrace-${state.score.id}.json`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  scoreStatusOutput.textContent = `score download ready · ${state.eventCount} events`;
}

function renderCaptureSurface() {
  const state = performanceRecorder.getState();
  const takes = performanceRecorder.listTakes();
  capturePanel.dataset.open = String(!capturePanel.hidden);
  capturePanel.dataset.recording = String(state.active);
  captureRecordButton.dataset.recording = String(state.active);
  captureRecordButton.disabled = !state.storageLoaded || state.pendingWrites > 0;
  captureRecordButton.textContent = state.active
    ? `stop + save ${captureIncludesAudio ? 'AV' : 'visual'} take`
    : `start ${captureAudioToggle?.checked ? 'AV' : 'visual'} take`;
  if (captureAudioToggle) captureAudioToggle.disabled = state.active || state.pendingWrites > 0;
  captureStatusOutput.textContent = state.active
    ? `recording locally · ${captureIncludesAudio ? 'live synth/sample/voice/Tristan-file mix + ' : ''}projector image · ${Math.round(state.durationMs / 1000)}s · max ${Math.round(CONFIG.performanceCapture.maxDurationMs / 60000)} min`
    : state.status === 'unsupported'
      ? 'MediaRecorder unavailable · stage remains live'
      : state.error || 'capture idle · local file audio joins the shared mix only with audio capture enabled';
  captureCapacity.textContent = `${takes.length} / ${CONFIG.performanceCapture.maxTakes} takes · ${formatMegabytes(state.totalBytes)} / ${formatMegabytes(CONFIG.performanceCapture.maxBytes)}`;
  renderScoreSurface();
  captureTakes.replaceChildren();
  if (!takes.length) {
    const empty = document.createElement('p');
    empty.textContent = 'no takes yet · choose visual or live synth/sample/voice mix, then start a local take';
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
  const state = performanceRecorder.getState();
  if (!state.storageLoaded || state.pendingWrites || captureStartPending || updateNotice.dataset.applying === 'true') return;
  if (state.active) {
    const take = await performanceRecorder.stop();
    stopCaptureStream();
    renderCaptureSurface();
    if (take && !performanceRecorder.getState().persistenceFailed) {
      setStatus('capture saved locally · choose download when ready');
    }
    return;
  }
  captureStartPending = true;
  try {
    const stream = await createCaptureStream();
    if (!stream || !performanceRecorder.start(stream)) {
      stopCaptureStream();
      return;
    }
    setStatus(captureIncludesAudio
      ? 'capture recording locally · projector image + live synth/sample/voice mix'
      : 'capture recording locally · visual projector output');
  } finally {
    captureStartPending = false;
    renderCaptureSurface();
  }
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

function renderMicCalibrationSurface(state = micCalibration?.getState?.()) {
  if (!micCalibrationPanel || !state) return;
  const percent = (value) => `${(Math.max(0, Number(value) || 0) * 100).toFixed(1)}%`;
  micCalibrationPanel.dataset.phase = state.phase;
  micCalibrationStatus.textContent = state.lastEvent;
  micCalibrationCurrent.textContent = percent(state.currentRms);
  micCalibrationPeak.textContent = percent(state.peakHold);
  micCalibrationFloor.textContent = state.gateFloor === null
    ? `default ${percent(CONFIG.audio.floor)}`
    : `${percent(state.gateFloor)} · p90 ${percent(state.noiseFloor)}`;
  micCalibrationSpeech.textContent = state.phase === 'speech'
    ? `${percent(state.speechPeak)} / ${percent(state.speechThreshold)}`
    : state.speechConfirmed
      ? `clear · ${percent(state.speechPeak)}`
      : state.gateFloor === null ? 'quiet first' : 'not checked';
  micCalibrationProgress.style.width = `${Math.round(state.progress * 100)}%`;
  micCalibrationPanel.querySelector('[data-mic-calibrate-quiet]').disabled = state.active;
  micCalibrationPanel.querySelector('[data-mic-calibrate-speech]').disabled = state.active || state.gateFloor === null;
  const monitor = audioMidi?.getFrame?.() || emptyAudio;
  for (const button of micMonitorPresetButtons) {
    button.setAttribute('aria-pressed', String(button.value === monitor.monitorPreset));
  }
  if (micMonitorPresetStatus) {
    micMonitorPresetStatus.textContent = `${monitor.monitorPreset} · wet ${Math.round((monitor.monitorWet || 0) * 100)}% · feedback ${Math.round((monitor.monitorFeedback || 0) * 100)}% · ${monitor.monitorActive ? 'monitor live' : 'select does not start mic'}`;
  }
  renderVoiceGameSurface(monitor.voiceGame);
  renderAudioDiagnostics(monitor);
}

function renderVoiceGameSurface(state = audioMidi?.getFrame?.()?.voiceGame || emptyAudio.voiceGame) {
  if (!voiceGamePanel || !state) return;
  const slots = Array.isArray(state.slots) ? state.slots : [];
  voiceGamePanel.dataset.recording = String(Boolean(state.recording));
  voiceGamePanel.dataset.active = String(Boolean(state.active));
  voiceGamePanel.dataset.preset = String(state.preset || CONFIG.audio.voiceGame.defaultPreset);
  voiceGamePanel.dataset.passes = String(state.passes || CONFIG.audio.voiceGame.defaultPasses);
  for (const button of voiceGamePresetButtons) {
    button.setAttribute('aria-pressed', String(button.value === state.preset));
  }
  for (const button of voiceGamePassButtons) {
    button.setAttribute('aria-pressed', String(Number(button.value) === Number(state.passes)));
  }
  voiceGameCaptureButton.textContent = state.recording ? 'finish + play' : 'catch phrase';
  voiceGameCaptureButton.disabled = !state.supported;
  voiceGameStatus.textContent = state.recording
    ? `${state.preset} · recording · max ${state.maxCaptureSeconds}s`
    : `${state.preset} · ${state.passes} passes · ${slots.length}/${state.maxSlots} phrases${state.active ? ` · ${state.activeRuns} live` : ''}`;
  voiceGameStatus.title = state.lastEvent || '';
  for (const [index, button] of voiceGameSlotButtons.entries()) {
    const slot = slots[index];
    button.disabled = !slot;
    button.dataset.slotId = slot?.id || '';
    button.textContent = slot
      ? `${String(index + 1).padStart(2, '0')} · play ${Number(slot.duration).toFixed(1)}s`
      : `${String(index + 1).padStart(2, '0')} · empty`;
  }
}

function renderAudioDiagnostics(frame = audioMidi?.getFrame?.() || emptyAudio) {
  if (!audioDiagnosticPanel || !frame) return;
  const contextState = String(frame.audioContextState || 'not-created');
  const sampleRate = Number(frame.sampleRate) || 0;
  const estimated = Number(frame.estimatedLatencyMs) || 0;
  audioDiagnosticPanel.dataset.context = contextState;
  audioDiagnosticPanel.dataset.clip = String(Boolean(frame.clipActive));
  audioDiagnosticPanel.dataset.latencySource = String(frame.latencySource || 'unavailable');
  audioDiagnosticPanel.dataset.latencyStatus = String(frame.latencyStatus || 'unavailable');
  audioDiagnosticPanel.dataset.headroom = String(frame.inputHeadroom || 'silent');
  audioContextOutput.textContent = sampleRate > 0
    ? `${contextState} · ${(sampleRate / 1000).toFixed(sampleRate % 1000 ? 1 : 0)}k`
    : contextState.replace('-', ' ');
  audioLatencyOutput.textContent = frame.latencySource === 'unavailable'
    ? 'unavailable'
    : `${estimated.toFixed(1)}ms · ${frame.latencyStatus}`;
  audioPeakOutput.textContent = frame.micActive
    ? `${Number(frame.inputPeakDb).toFixed(1)} dBFS · ${frame.inputHeadroom}`
    : 'silent · mic off';
  audioClipOutput.textContent = `${frame.clipActive ? 'clip' : 'clear'} · ${Math.max(0, Number(frame.clipEvents) || 0)} events`;
  audioDiagnosticStatus.textContent = frame.latencySource === 'unavailable'
    ? 'browser facts only · start mic or sound explicitly · physical round-trip requires listening'
    : `base ${Number(frame.baseLatencyMs).toFixed(1)}ms · output ${frame.outputLatencyMs > 0 ? `${Number(frame.outputLatencyMs).toFixed(1)}ms` : 'not exposed'} · browser render estimate only`;
}

function applyMicCalibrationFrame(time, frame) {
  if (!micCalibration || !frame) return;
  const previous = micCalibration.getState(time);
  const state = micCalibration.update({ timestamp: time, rawRms: frame.rawRms });
  if (state.calibratedAt && state.calibratedAt !== micCalibrationAppliedAt && state.gateFloor !== null) {
    audioMidi.setMicFloor?.(state.gateFloor);
    micCalibrationAppliedAt = state.calibratedAt;
  }
  if (previous.phase === 'quiet' && state.phase !== 'quiet' && micCalibrationMonitorRestore) {
    audioMidi.setMicMonitor?.(true);
    micCalibrationMonitorRestore = false;
    setButtonState('monitor', true);
  }
  if (state.revision !== micCalibrationRevision) {
    micCalibrationRevision = state.revision;
    if (state.phase !== 'idle' || state.calibratedAt) setStatus(state.lastEvent);
  }
  if (!musicPanel.hidden || state.active) renderMicCalibrationSurface(state);
}

function sampleAudio(time, frame) {
  try {
    const next = audioMidi.update?.(time, frame);
    if (next && typeof next.then === 'function') {
      next.then((value) => {
        if (value) audioFrame = value;
        applyMicCalibrationFrame(time, audioFrame);
      }).catch((error) => setStatus(`audio · ${error.message}`));
    } else {
      if (next) audioFrame = next;
      else audioFrame = audioMidi.getFrame?.() || audioFrame;
      applyMicCalibrationFrame(time, audioFrame);
    }
  } catch (error) {
    setStatus(`audio · ${error.message}`);
  }
}

function renderMicLevel(time = performance.now()) {
  if (!micLevelOutput || time - lastMicSurfaceAt < 120) return;
  lastMicSurfaceAt = time;
  const audio = audioMidi?.getFrame?.() || audioFrame;
  const live = Boolean(audio.micActive);
  const calibration = micCalibration?.getState?.(time);
  const level = live ? Math.round(Math.min(1, Math.sqrt(Math.max(0, audio.rawRms ?? audio.rms ?? 0))) * 100) : 0;
  const peak = live ? Math.round(Math.min(1, Math.sqrt(Math.max(0, calibration?.peakHold || 0))) * 100) : 0;
  micLevelOutput.dataset.live = String(live);
  micLevelOutput.style.setProperty('--mic-level', `${level}%`);
  micLevelOutput.textContent = live
    ? `mic ${level}% · pk ${peak}% · ${audio.monitorActive ? `monitor · ${audio.monitorPreset}` : 'analysis'}`
    : 'mic standby';
  renderAudioDiagnostics(audio);
  if (!musicPanel.hidden) renderMicCalibrationSurface(calibration);
}

async function togglePresence() {
  if (presence.enabled || presence.starting) { stopPresence(); return; }
  if (!running) enterSystem();
  presence.starting = true;
  presenceStatus.textContent = 'Connecting microphone…';
  const wasLive = Boolean(audioMidi.getFrame()?.micActive);
  try {
    await samplerSession.getAudioContext();
    const input = await ensureCalibrationMic();
    if (!presence.starting) {
      if (!wasLive) audioMidi.disableMic();
      return;
    }
    if (!input?.micActive) throw new Error(latestAudioStatus.mic?.message || 'check microphone access');
    presence.startedMic = !wasLive;
    audioMidi.setMicMonitor(false);
    audioMidi.setVoiceGamePreset('inhabit');
    presence.enabled = true;
    presence.above = 0;
    presence.rest = 0;
    presenceButton.setAttribute('aria-pressed', 'true');
    presenceButton.textContent = 'stop presence';
    presenceStatus.textContent = 'MIC ON · say a phrase, then pause';
  } catch (error) {
    presenceStatus.textContent = `MIC OFF · ${error.message}`;
  } finally { presence.starting = false; }
}

function stopPresence() {
  if (!presence.enabled && !presence.starting) return;
  presence.enabled = presence.starting = presence.busy = false;
  presenceButton.setAttribute('aria-pressed', 'false');
  presenceButton.textContent = 'mic + presence';
  presenceStatus.textContent = 'Echo off';
  audioMidi.clearVoiceGame();
  if (presence.startedMic) audioMidi.disableMic();
  presence.startedMic = false;
  setButtonState('audio', Boolean(audioMidi.getFrame()?.micActive));
  updateInputRitual();
}

function updatePresence(time, frame) {
  if (!presence.enabled) return;
  if (!frame.micActive) {
    stopPresence();
    presenceStatus.textContent = `MIC OFF · ${latestAudioStatus.mic?.message || 'source disconnected'}`;
    return;
  }
  if (presence.busy) return;
  const rules = CONFIG.audio.voiceGame.presence;
  const speech = (frame.rawRms || 0) >= Math.max(rules.gateMin, (frame.micFloor || 0) * .8);
  const voice = frame.voiceGame;
  if (voice.active) { presence.above = 0; presenceStatus.textContent = 'Echo · replaying the phrase'; return; }
  if (voice.recording) {
    if (speech) presence.lastSpeech = time;
    if (time - presence.lastSpeech > rules.silenceMs) {
      presence.rest = time + rules.restMs;
      presence.busy = true;
      presenceStatus.textContent = 'Phrase captured · waiting for playback';
      void audioMidi.stopVoiceGameCapture().finally(() => { presence.busy = false; });
    }
    return;
  }
  if (time < presence.rest) return;
  if (!speech) { presence.above = 0; presenceStatus.textContent = 'MIC ON · listening'; return; }
  presence.above ||= time;
  if (time - presence.above < rules.attackMs) return;
  presence.above = 0;
  presence.lastSpeech = time;
  presence.busy = true;
  presenceStatus.textContent = 'Recording phrase · pause to hear it back';
  void audioMidi.startVoiceGameCapture().catch(error => { presenceStatus.textContent = error.message; })
    .finally(() => { presence.busy = false; });
}

function resize() {
  const width = stage.clientWidth || innerWidth;
  const height = stage.clientHeight || innerHeight;
  const baseDpr = Math.min(CONFIG.render.maxDpr, devicePixelRatio || 1);
  const renderDpr = Math.max(0.5, baseDpr * (Number(controls.quality?.dprScale) || 1));
  renderer.resize?.(width, height, renderDpr);
  overlay.resize(width, height, baseDpr);
  resizeQueued = false;
}

function renderQualitySurface(state = adaptiveQuality?.getState?.()) {
  if (!state) return;
  glCanvas.dataset.quality = state.level;
  glCanvas.dataset.qualityParticles = String(Math.round(CONFIG.render.particleCount * state.settings.particleScale));
  if (qualityStatus) qualityStatus.textContent = `quality ${state.level} · ${Math.round(state.measuredFps || 0)} fps · DPR ${Math.round(state.settings.dprScale * 100)}% · particles ${Math.round(state.settings.particleScale * 100)}%`;
}

function updateAdaptiveQuality(time) {
  const before = adaptiveQuality.getState().level;
  const state = adaptiveQuality.update({ timestamp: time, fps: renderer.getStats?.().fps || 0 });
  if (state.level !== before) {
    controls.quality = state.settings;
    resizeQueued = true;
    setStatus(state.lastEvent);
  }
  if (state.level !== before || (!help.hidden && time - lastQualitySurfaceAt >= 300)) {
    lastQualitySurfaceAt = time;
    renderQualitySurface(state);
  }
}

function frame(time) {
  if (resizeQueued) resize();
  if (applyAfterCapture && !captureInProgress()) {
    applyAfterCapture = false;
    updateStamp.textContent = 'Take saved · Apply when ready · sound layers can be resumed';
  }
  controls.wagner = wagnerScore.sample(time);
  if (time - wagnerUiAt >= CONFIG.wagner.uiIntervalMs) {
    wagnerUiAt = time;
    renderWagnerSurface();
    renderMusicTransport();
    if (running) renderStageTracking(trackingFrame);
    if (controls.focusField) renderFocusControls();
  }
  scoreRecorder?.update?.(time);
  const dt = Math.min(0.1, Math.max(1 / 240, (time - lastFrameAt) / 1000));
  lastFrameAt = time;
  if (running) {
    if (!controls.paused) frozenTime = time;
    frameZoneClock += dt * 1000;
    sampleTracking(time);
    if (controls.roomEnabled) {
      const roomClip = controls.clipActive && localClip.readyState >= 2;
      controls.room = roomGeometry.update(roomClip ? localClip : video, time, !roomClip && controls.mirrored,
        stage.clientWidth / stage.clientHeight, roomClip ? 'cover' : 'fill');
      controls.pointer.roomActive = roomPointerActive;
    }
    if (controls.clipActive && localClip.videoWidth) {
      const { clientWidth: width, clientHeight: height } = stage;
      controls.clipCover = mediaCover(localClip, width, height).map((value, index) => value / (index % 2 ? height : width));
    } else controls.clipCover = null;
    const visibleTracking = displayedTracking(trackingFrame, dt);
    updateShaperDemo(time, dt, visibleTracking);
    if (workflow === 'objects') {
      controls.objectFocus = sampleObjectFocus(visibleTracking, controls.pointer.focusActive ? controls.pointer : null, time);
    }
    if (controls.inspectNodes) {
      controls.stageNodes = scoreAnchors(visibleTracking, time, controls.lightScore.sources, controls.pointer, controls.room,
        controls.clipTracking && controls.clipCover);
    }
    pollLiveShadow(time);
    gestureFrameState = framePerformanceArmed
      ? gestureFrame.update({
        timestamp: frameZoneClock,
        trackingTimestamp: time,
        tracking: visibleTracking,
        mode: frameContentMode,
        manual: manualFrame,
      })
      : gestureFrame.getFrame();
    for (let i = 0; framePerformanceArmed && i < gestureFrameState.eventCount; i += 1) {
      if (gestureFrameState.events[i].type === 'preset-cycle') cycleFramePreset();
    }
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
    roiFeatureState = updateRoiFeatureLock(time, visibleTracking, frameContentState);
    frameObjectCropState = frameObjectCrop.update({
      timestamp: time,
      candidates: collectFocusCandidates(visibleTracking, frameContentState),
      frame: gestureFrameState,
      content: frameContentState,
      camera: visibleTracking.camera,
      featureLock: roiFeatureState,
    });
    subjectRouteState = subjectRoute.update({
      timestamp: time,
      enabled: controls.trace !== false,
      subject: overlay.getSubjectState?.(),
      entitySettings: latestEntitySettings,
      frameObjectCrop: frameObjectCropState,
      frameContent: frameContentState,
    });
    if (!framePanel.hidden && time - lastFrameSurfaceAt >= CONFIG.entities.consoleRateMs) {
      lastFrameSurfaceAt = time;
      renderFrameSurface();
    }
    updateFrameSoundEvents();
    sampleAudio(time, visibleTracking);
    if (stageArrangement.id) {
      const hand = visibleTracking.hands.find(hand => !hand.stale && hand.handedness === 'Right');
      stageArrangement.setLift(hand ? 1 - hand.palm.y : 0);
    }
    updateSector(time, dt, visibleTracking);
    updatePresence(time, audioMidi.getFrame());
    wagnerScore.conduct(time, visibleTracking.hands);
    orchestra.update(visibleTracking.hands, degree => retainGestureNote(degree, time));
    renderSpeechTrace(time, visibleTracking);
    controls.roomMusicFrame = roomMusicActive && audioMidi.getFrame().micActive ? audioMidi.getFrame() : null;
    updateDayStream(time);
    orchestra.setConductor({ room: controls.roomMusicFrame, day: controls.dayContext });
    updateGesturePhrase(time);
    updateSacredPerformance(time, visibleTracking);
    atmosphere.update({ tracking: visibleTracking, pointer: controls.pointer,
      geometry: controls.lightScore, settings: atmosphereSettings,
      root: ORCHESTRA_KEYS[guestStageKey || orchestraKey.value],
      voice: airVoiceLevel(audioMidi.getFrame(), airMicReactive) });
    if (workflow === 'air' && time - lastAirSurfaceAt > CONFIG.entities.consoleRateMs) {
      lastAirSurfaceAt = time;
      renderAirStatus();
    }
    audioFrame = wagnerScore.mergeAudio(audioFrame);
    controls.lightScore.signal = samplerSession.sampleStageOutput();
    controls.focusCue = orchestra.state().ready ? orchestra.cue() : atmosphere.cue();
    controls.focusPlaying = controls.focusField && (orchestra.state().ready || atmosphere.active() && atmosphere.ready());
    liveLab.update(time, visibleTracking, audioFrame, controls,
      !controls.paused && !controls.focusField && !calibrationState.active && entry.dataset.hidden === 'true');
    renderMicLevel(time);
    updateRecipeReadout(time);
    updatePerformanceMapping(time, visibleTracking);
    updatePerformancePatch(time, visibleTracking);
    updateNarrativeStage(time, visibleTracking);
    if (!controls.paused) {
      renderer.render?.({ time, dt, tracking: visibleTracking, audio: audioFrame, controls, patch: patchVisualState });
      updateAdaptiveQuality(time);
      overlay.render({
        time, tracking: visibleTracking, audio: audioFrame, controls,
        stats: renderer.getStats?.() || {}, gestureFrame: gestureFrameState,
        frameContent: frameContentState, frameObjectCrop: frameObjectCropState,
        frameZone: frameZoneState, generatedBackground: generatedFrameBackground,
        subjectRoute: subjectRouteState,
      });
    }
    if (controls.inspectNodes && time - lastNodeReadout >= 240) renderNodeInspector(time);
    updateScoreFocus(overlay.getFocusState?.(), time);
    renderFocusNavigator();
    compositeCaptureFrame(time);
    updateEntityConsole(time, visibleTracking);
    if (!help.hidden && time - stageCheckUpdatedAt > 280) updateStageCheck(stageCheckModelStates);
  } else {
    const visibleTracking = displayedTracking(trackingFrame, dt);
    subjectRouteState = subjectRoute.update({
      timestamp: frozenTime,
      enabled: controls.trace !== false,
      subject: overlay.getSubjectState?.(),
      entitySettings: latestEntitySettings,
      frameObjectCrop: frameObjectCropState,
      frameContent: frameContentState,
    });
    music.update({
      timestamp: frozenTime,
      subjectRange: subjectRouteState?.active ? subjectRouteState : null,
    });
    updateNarrativeStage(frozenTime, visibleTracking);
    overlay.render({
      time: frozenTime, tracking: visibleTracking, audio: audioFrame, controls,
      stats: renderer.getStats?.() || {}, gestureFrame: gestureFrameState,
      frameContent: frameContentState, frameObjectCrop: frameObjectCropState,
      frameZone: frameZoneState, generatedBackground: generatedFrameBackground,
      subjectRoute: subjectRouteState,
    });
    renderFocusNavigator();
    compositeCaptureFrame(time);
    updateEntityConsole(frozenTime, visibleTracking);
    renderMicLevel(time);
    if (!help.hidden && time - stageCheckUpdatedAt > 280) updateStageCheck(stageCheckModelStates);
  }
  requestAnimationFrame(frame);
}

function sampleObjectFocus(frame, pointer, time) {
  const cover = controls.clipTracking && controls.clipCover;
  const point = cover && pointer ? { x: (pointer.x - cover[0]) / cover[2], y: (pointer.y - cover[1]) / cover[3] } : pointer;
  return objectFocus.sample(frame.objects, point, time, stage.clientWidth / Math.max(1, stage.clientHeight));
}

function renderStageTracking(frame) {
  const cameraVisible = frame.camera.active && (!controls.focusField || controls.focusCamera);
  document.body.dataset.cameraVisible = String(Boolean(cameraVisible));
  controls.focusCameraVisible = controls.focusField && cameraVisible;
  setButtonState('camera', Boolean(frame.camera.active || cameraPending));
  renderCameraControl(frame.camera);
  if (!cameraSources.hidden || cameraSources.dataset.live !== String(frame.camera.active)) {
    cameraSources.dataset.live = String(frame.camera.active);
    renderCameraSources(frame.camera);
  }
  document.body.dataset.cameraMirror = String(Boolean(frame.camera.mirrored));
  if (controls.roomEnabled) {
    const room = controls.room;
    const cameraName = controls.clipActive ? 'Clip' : frame.camera.label || 'camera';
    roomStatus.textContent = !frame.camera.active && !controls.clipActive ? (frame.camera.error || 'Camera · C / Setup')
      : `${cameraName} · ${room?.points.length || 0} corners · ${room?.locked ? 'point locked' : 'click to lock'}`;
    roomStatus.dataset.locked = String(Boolean(room?.locked));
    roomStatus.dataset.corners = String(room?.points.length || 0);
    roomStatus.dataset.edges = String(room?.edges.length || 0);
  }
  const face = frame.faces?.length ? 'Face in frame'
    : frame.anchors?.some(anchor => anchor.kind === 'face') ? 'Face estimated from head landmarks'
    : latestTrackingStatus.faceStatus === 'loading' ? 'Loading face model'
    : latestTrackingStatus.faceError ? 'Face model unavailable' : 'Looking for a face';
  const states = { loading: 'loading', live: 'live', unavailable: 'unavailable', disabled: 'off' };
  const objectStatus = latestTrackingStatus.objectStatus || 'disabled';
  controls.liveObjects = objectStatus === 'live';
  const objects = frame.objects || [];
  const objectText = objectStatus === 'live'
    ? frame.camera.active ? objects.map(object => object.label).slice(0, 3).join(', ') || 'searching' : 'waiting for camera'
    : states[objectStatus] || 'waiting for camera';
  if (workflow === 'objects') {
    const focus = controls.objectFocus;
    objectStatusOutput.textContent = !frame.camera.active ? 'Camera · C'
      : focus ? `${focus.target.label} · ${focus.lost ? 'signal lost' : focus.locked ? 'locked · click to release' : 'click to lock'}`
      : `Objects · ${objectText}`;
  }
  const objectButton = setupPanel.querySelector('[data-action="objects"]');
  objectButton.setAttribute('aria-pressed', String(objectStatus !== 'disabled'));
  stageTrackingStatus.textContent = frame.camera.active
    ? `${frame.camera.label || 'Camera'} · ${workflow === 'objects' ? `objects: ${objectText}` : `${face} · hands ${frame.hands.length} · Live Object: ${objectText}`}`
    : `${frame.camera.error || 'Camera off'} · Live Object: ${objectText}`;
  stageTrackingStatus.title = latestTrackingStatus.objectError || latestTrackingStatus.faceError || '';
}

function setLiveObjects(enabled) {
  void tracking.setObjectDetection(enabled).then(() => renderStageTracking(tracking.getFrame()));
}

function renderCameraControl(camera) {
  const requesting = cameraPending && !camera.active;
  const label = camera.active ? (/phone|continuity/i.test(camera.label) ? 'phone live' : 'camera live')
    : requesting ? 'connecting' : camera.error ? 'retry camera' : 'camera';
  if (cameraActionLabel.textContent !== label) cameraActionLabel.textContent = label;
  const title = requesting ? 'Allow camera access in the browser'
    : camera.active ? 'Turn camera off · C' : 'Turn camera on · C';
  if (cameraActionLabel.parentElement.title !== title) cameraActionLabel.parentElement.title = title;
}

function toggleStageCamera() {
  if (!running) enterSystem();
  if (tracking.getFrame().camera.active || cameraPending) {
    ++cameraSelectionRequest;
    cameraPending = false;
    tracking.stopCamera();
    objectFocus.clear();
    controls.objectFocus = null;
    renderStageTracking(tracking.getFrame());
    updateInputRitual();
  } else void enableCamera(preferredCameraDeviceId);
}

async function enableCamera(deviceId = preferredCameraDeviceId) {
  const request = ++cameraSelectionRequest;
  const requested = String(deviceId || '');
  const fromWindow = requested === 'window:preview';
  if (!fromWindow) preferredCameraDeviceId = requested;
  cameraPending = true;
  setButtonState('camera', true);
  renderCameraControl(tracking.getFrame().camera);
  if (!fromWindow) writeLocal(CAMERA_PREF, requested);
  if (controls.roomEnabled) controls.room = roomGeometry.reset();
  objectFocus.clear();
  controls.objectFocus = null;
  frameZones.reset(frameZoneClock);
  frameZoneState = null;
  roiFeatureState = roiFeatureLock.reset(performance.now());
  lastRoiFeatureSampleAt = -Infinity;
  setStatus('allow camera access in your browser · pointer ready');
  setInputState('camera', 'loading', 'requesting permission');
  cameraSwitchError = '';
  renderCameraSources(tracking.getFrame().camera);
  try {
    let source = requested || macCameraId;
    if (source === 'facing:environment' && !isMobileCameraHost()) {
      await refreshCameraDevices();
      if (request !== cameraSelectionRequest) return;
      source = cameraInventory.find(device => /iphone|continuity|phone.*camera/i.test(device.label))?.deviceId;
      if (!source) throw new DOMException('Phone camera unavailable', 'NotFoundError');
      preferredCameraDeviceId = source;
      writeLocal(CAMERA_PREF, source);
    }
    await tracking.startCamera(source);
    if (request !== cameraSelectionRequest) return;
    controls.mirrored = tracking.getFrame().camera.mirrored;
    setStatus('Live · ' + (tracking.getFrame().camera.label || 'camera'));
  } catch (error) {
    if (request === cameraSelectionRequest) {
      cameraSwitchError = fromWindow ? (error.name === 'TypeMismatchError' ? 'Select a single preview window' : 'Window preview was not shared')
        : error.name === 'NotAllowedError' ? 'Camera permission denied · allow access for this site and retry'
        : error.name === 'TimeoutError' ? 'No answer from camera · check the site permission or reconnect the phone, then retry'
        : error.name === 'NotReadableError' ? 'Source busy or disconnected · reconnect and retry'
        : 'Source unavailable · refresh devices, then choose a camera';
      setStatus(cameraSwitchError);
    }
  } finally {
    if (request === cameraSelectionRequest) {
      cameraPending = false;
      void refreshCameraDevices();
      renderStageTracking(tracking.getFrame());
      updateInputRitual();
    }
  }
}

async function enableAudio(deviceId = micSelect?.value || '', monitor = false) {
  preferredMicDeviceId = String(deviceId || '');
  try {
    await audioMidi.enableMic?.(preferredMicDeviceId);
    const liveMic = audioMidi.getFrame?.();
    const calibration = micCalibration.selectDevice(liveMic?.micDeviceId || preferredMicDeviceId || 'default');
    audioMidi.setMicFloor?.(calibration.gateFloor ?? CONFIG.audio.floor);
    micCalibrationAppliedAt = calibration.calibratedAt;
    const monitoredFrame = audioMidi.setMicMonitor?.(monitor) || audioMidi.getFrame?.();
    await refreshCameraDevices();
    setButtonState('audio', Boolean(monitoredFrame?.micActive));
    setButtonState('monitor', Boolean(monitoredFrame?.monitorActive));
    updateInputRitual();
    if (!monitoredFrame?.micActive) {
      setStatus(monitoredFrame?.error || 'Microphone unavailable');
      return;
    }
    setStatus(monitoredFrame?.monitorActive
      ? `mic + voice live · ${monitoredFrame.monitorPreset} preset · say “one-two-three” · headphones recommended`
      : 'mic analysis live');
  } catch (error) {
    setStatus(`mic unavailable · ${error.message}`);
  }
}

async function toggleStageMic() {
  if (micPending) return;
  if (audioMidi.getFrame().micActive) {
    if (presence.enabled) stopPresence();
    geometryControls?.stopListening();
    airMicReactive = roomMusicActive = roomMusicOwnedInput = false;
    audioMidi.disableMic();
    setButtonState('audio', false);
    setButtonState('monitor', false);
    writeLocal('mythtrace.entry-mic.v1', 'false');
    updateInputRitual();
    setStatus('Microphone off');
    return;
  }
  micPending = true;
  try {
    await enableAudio(micSelect?.value || preferredMicDeviceId, false);
    if (audioMidi.getFrame().micActive) writeLocal('mythtrace.entry-mic.v1', 'true');
  } finally { micPending = false; }
}

async function ensureCalibrationMic() {
  if (!audioMidi.getFrame?.()?.micActive) {
    await audioMidi.enableMic?.(micSelect?.value || preferredMicDeviceId || '');
    await refreshCameraDevices();
  }
  const frame = audioMidi.getFrame?.();
  if (!frame?.micActive) {
    setStatus('mic calibration needs a live selected microphone');
    return null;
  }
  const state = micCalibration.selectDevice(frame.micDeviceId || preferredMicDeviceId || 'default');
  audioMidi.setMicFloor?.(state.gateFloor ?? CONFIG.audio.floor);
  micCalibrationAppliedAt = state.calibratedAt;
  setButtonState('audio', true);
  updateInputRitual();
  return frame;
}

async function startQuietMicCalibration() {
  const frame = await ensureCalibrationMic();
  if (!frame) return;
  micCalibrationMonitorRestore = Boolean(frame.monitorActive);
  if (frame.monitorActive) {
    audioMidi.setMicMonitor?.(false);
    setButtonState('monitor', false);
  }
  const state = micCalibration.startQuiet(performance.now());
  renderMicCalibrationSurface(state);
  setStatus(state.lastEvent);
}

async function startSpeechMicCalibration() {
  const frame = await ensureCalibrationMic();
  if (!frame) return;
  const state = micCalibration.startSpeech(performance.now());
  renderMicCalibrationSurface(state);
  setStatus(state.lastEvent);
}

function clearMicCalibrationReceipt() {
  micCalibrationMonitorRestore = false;
  const state = micCalibration.clear();
  audioMidi.setMicFloor?.(CONFIG.audio.floor);
  micCalibrationAppliedAt = 0;
  renderMicCalibrationSurface(state);
  setStatus(state.lastEvent);
}

function selectMicMonitorPreset(presetId) {
  const frame = audioMidi.setMicMonitorPreset?.(presetId) || audioMidi.getFrame?.() || emptyAudio;
  micMonitorPresetId = frame.monitorPreset || CONFIG.audio.monitor.defaultPreset;
  try {
    localStorage.setItem(CONFIG.audio.monitor.storageKey, micMonitorPresetId);
  } catch {
    // Preset remains active for this session when browser storage is unavailable.
  }
  lastMicSurfaceAt = -Infinity;
  renderMicLevel(performance.now());
  renderMicCalibrationSurface();
  setStatus(frame.monitorActive
    ? `voice monitor · ${micMonitorPresetId} · wet ${Math.round((frame.monitorWet || 0) * 100)}% · feedback ${Math.round((frame.monitorFeedback || 0) * 100)}%`
    : `monitor preset ${micMonitorPresetId} selected · mic permission unchanged`);
  return frame;
}

function resetAudioDiagnosticReceipt() {
  const frame = audioMidi.resetAudioDiagnostics?.() || audioMidi.getFrame?.() || emptyAudio;
  lastMicSurfaceAt = -Infinity;
  renderAudioDiagnostics(frame);
  setStatus('audio peak / clip receipt reset · graph unchanged');
}

async function toggleVoiceMonitor() {
  if (!audioMidi.getFrame?.()?.micActive) await enableAudio(micSelect?.value || '');
  const next = !audioMidi.getFrame?.()?.monitorActive;
  const frame = audioMidi.setMicMonitor?.(next);
  setButtonState('monitor', Boolean(frame?.monitorActive));
  updateInputRitual();
}

async function toggleVoiceGameCapture() {
  let frame = audioMidi.getFrame?.() || emptyAudio;
  if (frame.voiceGame?.recording) {
    frame = await audioMidi.stopVoiceGameCapture?.() || frame;
    renderVoiceGameSurface(frame.voiceGame);
    setStatus(frame.voiceGame?.lastEvent || 'voice phrase finished locally');
    return;
  }
  if (!frame.micActive) {
    await enableAudio(micSelect?.value || preferredMicDeviceId || '');
    frame = audioMidi.getFrame?.() || frame;
  }
  if (!frame.micActive) {
    setStatus('voice game needs a live microphone');
    renderVoiceGameSurface(frame.voiceGame);
    return;
  }
  frame = await audioMidi.startVoiceGameCapture?.() || frame;
  renderVoiceGameSurface(frame.voiceGame);
  setStatus(frame.voiceGame?.lastEvent || 'voice game recording');
}

function selectVoiceGamePreset(presetId) {
  const frame = audioMidi.setVoiceGamePreset?.(presetId) || audioMidi.getFrame?.() || emptyAudio;
  renderVoiceGameSurface(frame.voiceGame);
  setStatus(frame.voiceGame?.lastEvent || `voice game · ${presetId}`);
}

function selectVoiceGamePasses(count) {
  const frame = audioMidi.setVoiceGamePasses?.(count) || audioMidi.getFrame?.() || emptyAudio;
  renderVoiceGameSurface(frame.voiceGame);
  setStatus(frame.voiceGame?.lastEvent || `voice game · ${count} passes`);
}

async function playVoiceGameSlot(slotId) {
  const frame = await audioMidi.playVoiceGameSlot?.(slotId) || audioMidi.getFrame?.() || emptyAudio;
  renderVoiceGameSurface(frame.voiceGame);
  setStatus(frame.voiceGame?.lastEvent || 'voice phrase live');
}

function releaseVoiceGame() {
  const frame = audioMidi.clearVoiceGame?.() || audioMidi.getFrame?.() || emptyAudio;
  renderVoiceGameSurface(frame.voiceGame);
  setStatus(frame.voiceGame?.lastEvent || 'voice game released · exact silence');
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
  if (musicStartPending || music.getState().armed) return;
  const generation = ++musicStartGeneration;
  stageMusicSource = 'hands';
  musicStartPending = true;
  renderMusicTransport();
  const handSettings = latestEntitySettings?.settings?.hands;
  latestEntitySettings = entityConsole.configureSource('hands', {
    enabled: true,
    sound: handSettings?.sound > 0 ? handSettings.sound : CONFIG.handInstrument.route,
  });
  try {
    await music.arm();
    if (generation !== musicStartGeneration) return;
    if (!musicPanel.hidden) renderMusicSurface();
    setStatus(music.getState().armed ? 'HANDS · bend a finger to play' : 'HANDS · audio unavailable');
  } finally {
    if (generation === musicStartGeneration) {
      musicStartPending = false;
      renderMusicTransport();
    }
  }
}

function renderMusicTransport() {
  renderAirStatus();
  const state = music.getState();
  const handsOn = musicStartPending || state.armed;
  const button = musicPanel.querySelector('[data-music-arm]');
  button.dataset.on = String(handsOn);
  button.setAttribute('aria-pressed', String(handsOn));
  button.textContent = musicStartPending ? 'arming hands' : handsOn ? 'stop hands' : 'play hands';
  const wagner = wagnerScore.state;
  const score = orchestra.state();
  for (const [index, note] of (score.fingers || []).entries()) {
    const cell = musicPanel.querySelector(`[data-orchestra-finger="${index}"]`);
    if (cell) {
      cell.textContent = musicNoteLabel(note.midi || ((score.key === 'am' ? 45 : score.key === 'cm' ? 36 : score.key === 'fsm' ? 42 : 38) + note.offset));
      cell.dataset.active = String(note.gate);
      cell.title = `${note.side} ${note.finger}`;
    }
  }
  orchestraButton.setAttribute('aria-pressed', String(score.running));
  const orchestraLabel = score.running ? 'Stop · Particles Orchestra' : 'Play · Particles Orchestra';
  if (orchestraButton.textContent !== orchestraLabel) orchestraButton.textContent = orchestraLabel;
  orchestraNote.textContent = score.ready ? (score.lastNote ? `Right · ${score.lastNote}` : 'Strings · waiting for a gesture') : 'Right · pinch / Left · open';
  renderMusicLayers(state, score, wagner, handsOn);
  setButtonState('music', !musicPanel.hidden);
  const atmosphereButton = musicPanel.querySelector('[data-atmosphere]');
  atmosphereButton.setAttribute('aria-pressed', String(atmosphere.active()));
  atmosphereButton.textContent = atmosphere.active() ? 'stop atmosphere' : 'play atmosphere';
  musicPanel.querySelector('[data-atmosphere-status]').textContent = atmosphere.active()
    ? 'ON · palm or pointer shapes the tone' : 'OFF · drone / grain / slow pulse';
  workflowRail.querySelector('[data-workflow="focus"]').dataset.playing = String(workflow === 'focus' && (atmosphere.active() || score.running));
  controlsBar.querySelector('[data-action="music"]').dataset.playing = String(handsOn || wagner.playing || atmosphere.active() || score.running);
  for (const hand of ['left', 'right']) {
    const fingers = state.fingers?.hands?.[hand];
    const names = Object.entries(fingers?.gates || {}).filter(([, gate]) => gate === 'on')
      .map(([finger]) => musicNoteLabel(fingers.notes[finger]));
    musicPanel.querySelector(`[data-stage-hand="${hand}"]`).textContent =
      `${hand[0].toUpperCase()} · ${names.join('  ') || '—'}`;
  }
}

function musicLayerLevelInput(id) {
  return id === 'hands' ? $('[data-music-field="master"]')
    : id === 'orchestra' ? orchestraLevel
    : id === 'tristan' ? $('[data-wagner-gain]')
    : $('[data-atmosphere-setting="gain"]');
}

function renderMusicLayers(state, score, wagner, handsOn) {
  const layers = [
    { id: 'hands', name: 'Hands', on: handsOn, status: musicStartPending ? 'arming' : state.armed ? state.silent ? 'waiting' : 'playing' : 'off', level: state.master },
    { id: 'tristan', name: 'Wagner', on: wagner.playing || wagner.pending, status: wagner.pending ? 'loading' : wagner.playing ? 'playing' : wagner.paused ? 'paused' : 'off', level: wagner.gain },
    { id: 'orchestra', name: 'Particles', on: score.running, status: score.ready ? 'ready' : score.running ? 'starting' : 'off', level: Number(orchestraLevel.value) },
    { id: 'atmosphere', name: 'Air', on: atmosphere.active(), status: atmosphere.active() ? 'playing' : 'off', level: atmosphereSettings.gain },
  ];
  for (const layer of layers) {
    const row = musicPanel.querySelector(`[data-mix-layer="${layer.id}"]`);
    const button = row.querySelector('button');
    row.dataset.selected = String(stageMusicSource === layer.id);
    button.setAttribute('aria-pressed', String(layer.on));
    const label = `${layer.on ? 'Stop' : 'Play'} · ${layer.name}`;
    if (button.textContent !== label) button.textContent = label;
    const input = row.querySelector('input');
    input.max = musicLayerLevelInput(layer.id).max;
    if (Number(input.value) !== layer.level) input.value = String(layer.level);
    row.querySelector('output').textContent = `${Math.round(layer.level * 100)}%`;
    row.querySelector('span').textContent = `${stageMusicSource === layer.id ? 'J · ' : ''}${layer.status}`;
  }
  const active = layers.filter(layer => layer.on);
  musicPanel.dataset.activeLayers = active.map(layer => layer.id).join(' ');
  musicPanel.querySelector('[data-stage-music]').textContent = `${active.length} layers · J ${layers.find(layer => layer.id === stageMusicSource).name} · X stop all`;
}

function stopHandMusic() {
  musicStartGeneration++;
  musicStartPending = false;
  for (const key of [...computerMusicDown.keys()]) stopComputerMusicKey(key);
  music.panic({ disarm: true });
  mpeOutput.panic('music stopped');
  renderMusicTransport();
}

function toggleHandMusic() {
  stageMusicSource = 'hands';
  if (musicStartPending || music.getState().armed) stopHandMusic();
  else void activateHandInstrument();
}

function stopMusicLayers() {
  stopStageArrangement();
  gesturePhrase = [];
  endPhraseCapture();
  orchestra.stop();
  atmosphere.stop(true);
  stopHandMusic();
  wagnerScore.pause();
}

async function playOrchestra(demo = false) {
  if (!running) enterSystem();
  stageMusicSource = 'orchestra';
  try {
    const pending = orchestra.start();
    renderMusicTransport();
    await pending;
    if (demo && orchestra.state().ready) {
      const notes = orchestraPhrase();
      orchestra.playDegrees(notes, orchestraPace);
      $('[data-phrase-status]').textContent = 'Phrase · ' + notes.join(' ');
    }
  } catch (error) {
    setStatus(`Particles · ${error.message}`);
  } finally { renderMusicTransport(); }
}

function toggleOrchestra() {
  stageMusicSource = 'orchestra';
  if (stageArrangement.id) {
    stopStageArrangement();
    orchestra.stop();
    renderMusicTransport();
    return;
  }
  if (arrangementId() && !orchestra.state().running) {
    startStageArrangement();
    return;
  }
  if (orchestra.state().running) {
    gesturePhrase = [];
    lastPhrasePinch = -Infinity;
    endPhraseCapture();
    orchestra.stop();
    renderMusicTransport();
  } else void playOrchestra();
}

function toggleMusic() {
  if (!running) enterSystem();
  if (stageMusicSource === 'orchestra') toggleOrchestra();
  else if (stageMusicSource === 'atmosphere') toggleAtmosphere();
  else if (stageMusicSource === 'hands') {
    toggleHandMusic();
  } else if (wagnerScore.state.pending || wagnerScore.state.playing) {
    wagnerScore.pause();
  } else {
    void wagnerScore.resume().catch(error => setStatus(`Tristan · ${error.message}`));
  }
}

function startAtmosphere(profile) {
  airProfile = profile;
  writeLocal('mythtrace.air-profile.v1', profile);
  stageMusicSource = 'atmosphere';
  void atmosphere.start(profile).catch(error => {
    atmosphere.stop(true);
    setStatus(`Atmosphere · ${error.message}`);
    renderMusicTransport();
  });
}

function toggleAtmosphere() {
  if (!running) enterSystem();
  stageMusicSource = 'atmosphere';
  if (atmosphere.active()) { atmosphere.stop(); releaseAirInput(); }
  else startAtmosphere(workflow === 'focus' ? 'focus' : airProfile);
  renderMusicTransport();
}

function renderAirStatus() {
  const mic = audioMidi.getFrame()?.micActive;
  const output = $('[data-air-status]');
  if (output) output.textContent = atmosphere.active()
    ? `AIR · ${atmosphere.source()} · ${airMicReactive && mic ? 'mic linked' : 'generated sound only'}`
    : 'AIR off · select a texture, then play · microphone never plays dry';
  $('[data-air-mic]')?.setAttribute('aria-pressed', String(Boolean(airMicReactive && mic)));
  const listening = geometryControls?.isListening();
  if ($('[data-room-input-status]')) $('[data-room-input-status]').textContent = mic
    ? inputSourceLabel(audioMidi.getFrame()) + (listening ? ' · local Whisper listening' : '')
    : listening ? 'MIC ON · local Whisper · no monitoring' : 'Input off';
  const roomButton = $('[data-room-music]');
  roomButton?.setAttribute('aria-pressed', String(Boolean(roomMusicActive && mic)));
  if (roomButton) roomButton.textContent = roomMusicActive && mic ? 'Stop room analysis' : 'Listen to room music';
}

function releaseAirInput() {
  airMicReactive = false;
  if (airMicOwnedInput) {
    if (roomMusicActive) roomMusicOwnedInput = true;
    else if (!presence.enabled) { audioMidi.disableMic(); setButtonState('audio', false); }
  }
  airMicOwnedInput = false;
}

async function setRoomMusic(enabled) {
  const button = $('[data-room-music]');
  button.disabled = true;
  try {
    if (enabled) {
      roomMusicOwnedInput = !audioMidi.getFrame().micActive;
      audioMidi.setMicMonitor(false);
      await audioMidi.enableMic(micSelect?.value || preferredMicDeviceId, 'music');
      roomMusicActive = Boolean(audioMidi.getFrame().micActive);
      if (!running) enterSystem();
      setButtonState('audio', roomMusicActive);
      setButtonState('monitor', false);
      setStatus(roomMusicActive ? 'Room music · local FFT drives the field · input is not recorded' : 'Room input unavailable · choose a microphone in Setup');
    } else {
      roomMusicActive = false;
      if (roomMusicOwnedInput && !presence.enabled) {
        if (airMicReactive) airMicOwnedInput = true;
        else { audioMidi.disableMic(); setButtonState('audio', false); }
      }
      roomMusicOwnedInput = false;
    }
  } finally { button.disabled = false; renderAirStatus(); updateInputRitual(); }
}
$('[data-room-music]').addEventListener('click', () => { void setRoomMusic(!roomMusicActive); });
$('[data-room-voice]').addEventListener('click', () => { void toggleVoiceCaptions(); });
$('[data-bass-play]').addEventListener('click', () => {
  if (!running) enterSystem();
  stageMusicSource = 'atmosphere';
  if (atmosphere.active() && atmosphere.profile() === 'bass') { atmosphere.stop(); releaseAirInput(); }
  else startAtmosphere('bass');
  renderMusicTransport();
});
for (const input of document.querySelectorAll('[data-bass-control]')) {
  const savedValue = Number.parseFloat(readLocal('mythtrace.bass.' + input.dataset.bassControl));
  input.value = String(Number.isFinite(savedValue) ? savedValue : CONFIG.bassDeck[input.dataset.bassControl]);
  const update = () => {
    const id = input.dataset.bassControl, value = Number(input.value);
    atmosphere.configureDeck({ [id]: value });
    document.querySelector(`[data-bass-value="${id}"]`).textContent = id === 'bpm' ? `${value} BPM` : `${Math.round(value*100)}%`;
    writeLocal('mythtrace.bass.' + id, String(value));
  };
  input.addEventListener('input', update); update();
}

async function loadDayStream() {
  const output = $('[data-day-status]');
  try {
    const response = await studioOnly(CONFIG.dayStream.path, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Day feed unavailable');
    dayData = normalizeDayContext(data);
    lastDayTick = -Infinity;
    updateDayStream(performance.now());
    return true;
  } catch (error) { output.textContent = error.message; return false; }
}
function updateDayStream(time) {
  if (time - lastDayTick < CONFIG.dayStream.tickMs) return;
  lastDayTick = time;
  controls.dayContext = null;
  if (!dayData) return;
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: CONFIG.dayStream.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const stale = dayPreview === null && dayData.date !== today;
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: CONFIG.dayStream.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const [h,m] = clock.split(':').map(Number);
  const minute = dayPreview ?? h * 60 + m;
  const signal = sampleDayContext(dayData, minute);
  if (dayEnabled && !stale) controls.dayContext = signal;
  $('[data-day-status]').textContent = `${dayData.date} · ${signal.count} events · ${signal.busyMinutes} occupied min · ${signal.active} active · ${dayPreview === null ? 'clock' : 'rehearsal'} · ${String(Math.floor(minute / 60)).padStart(2,'0')}:${String(minute % 60).padStart(2,'0')}`;
  $('[data-day-toggle]').setAttribute('aria-pressed', String(dayEnabled));
  if (stale) $('[data-day-status]').textContent += ' · dated feed · refresh or rehearse';
  $('[data-day-toggle]').textContent = dayEnabled ? 'Disconnect day stream' : 'Connect day stream';
  $('[data-day-time]').value = String(minute);
}
$('[data-day-toggle]').addEventListener('click', async () => {
  if (!dayEnabled && !await loadDayStream()) return;
  dayEnabled = !dayEnabled; lastDayTick = -Infinity; updateDayStream(performance.now());
});
$('[data-day-refresh]').addEventListener('click', () => { void loadDayStream(); });
$('[data-day-time]').addEventListener('input', event => { dayPreview = Number(event.target.value); lastDayTick = -Infinity; updateDayStream(performance.now()); });
$('[data-day-clock]').addEventListener('click', () => { dayPreview = null; lastDayTick = -Infinity; updateDayStream(performance.now()); });
$('[data-day-file]').addEventListener('change', async event => {
  try {
    const data = normalizeDayContext(JSON.parse(await event.target.files[0].text()));
    const response = await studioOnly(CONFIG.dayStream.path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!response.ok) throw new Error('Day feed rejected');
    await loadDayStream();
  } catch (error) { $('[data-day-status]').textContent = error.message; }
});
setInterval(() => { if (dayEnabled && !document.hidden) void loadDayStream(); }, CONFIG.dayStream.pollMs);

async function resumeSavedPerformance() {
  const button = $('[data-session-resume]');
  button.disabled = true;
  try {
    await samplerSession.getAudioContext();
    const layers = restoredPerformance?.audioLayers || {};
    if (layers.hands) await activateHandInstrument();
    if (layers.orchestra) await playOrchestra();
    if (restoredPerformance?.arrangement?.id && restoredPerformance.arrangement.id === arrangementId()) {
      startStageArrangement();
      scoreOwnsOrchestra = Boolean(restoredPerformance.arrangement.ownsOrchestra);
    }
    if (layers.air) await atmosphere.start(restoredPerformance?.airProfile || airProfile);
    if (layers.wagner) await wagnerScore.resume();
    if (restoredPerformance?.roomMusicActive) await setRoomMusic(true);
    else if (restoredPerformance?.micActive) await enableAudio(preferredMicDeviceId, false);
    if (restoredPerformance?.agentListening) await geometryControls.startListening();
    airMicReactive = Boolean(restoredPerformance?.airMicReactive);
    stageMusicSource = restoredPerformance?.stageMusicSource || 'orchestra';
    $('#session-recovery').hidden = true;
    renderMusicTransport();
    setStatus('Session resumed · saved notes, layers and Wagner position restored');
  } catch (error) { setStatus(`Resume · ${error.message} · parameters retained`); }
  finally { button.disabled = false; }
}
$('[data-session-resume]').addEventListener('click', () => { void resumeSavedPerformance(); });

function applyAirPreset(id) {
  const settings = CONFIG.airScore.presets[id];
  if (!settings) return;
  const wasBass = atmosphere.active() && atmosphere.profile() === 'bass';
  airProfile = 'air'; writeLocal('mythtrace.air-profile.v1', airProfile);
  if (wasBass) startAtmosphere('air');
  for (const input of atmosphereSettingInputs) {
    const key = input.dataset.atmosphereSetting;
    atmosphereSettings[key] = settings[key];
    input.value = String(settings[key]);
  }
  writeLocal('mythtrace.atmosphere.v1', JSON.stringify(atmosphereSettings));
  for (const button of musicPanel.querySelectorAll('[data-air-preset]')) button.setAttribute('aria-pressed', String(button.dataset.airPreset === id));
  renderAirStatus();
}

let lastNodeReadout = -Infinity;
function renderNodeInspector(time) {
  lastNodeReadout = time;
  const data = overlayCanvas.dataset;
  const phrase = { orbit: 'Arcs', slice: 'Slice', weave: 'Weave', face: 'Face links' }[data.autoPhrase];
  const driver = { ладони: 'palms', глаза: 'eyes', звук: 'sound', рука: 'hand', курсор: 'pointer', поле: 'field' };
  const driving = (data.autoNodes || '').split(' ');
  const summary = controls.focusField ? `Point Lattice · ${data.focusFieldSource || 'field'}`
    : workflow === 'objects' ? `Objects · ${controls.objectFocus?.target.label || 'searching'}`
    : controls.room ? 'Room + geometry · contrast points'
    : controls.lightScore.auto && phrase ? `${phrase} · ${driver[data.autoDriver] || data.autoDriver}` : 'Manual geometry';
  if (nodeSummary.textContent !== summary) nodeSummary.textContent = summary;
  const rows = controls.stageNodes
    .map(node => [node.label || node.id, node.source, driving.includes(node.id)]);
  const key = JSON.stringify(rows);
  if (nodeList.dataset.rows === key) return;
  nodeList.dataset.rows = key;
  nodeList.replaceChildren(...rows.map(([label, source, active]) => {
    const row = document.createElement('div');
    row.textContent = `${label} · ${source}`;
    if (active) row.dataset.active = 'true';
    return row;
  }));
}

function toggleNodeInspector() {
  controls.inspectNodes = !controls.inspectNodes;
  nodeInspector.hidden = !controls.inspectNodes;
  nodeButton.setAttribute('aria-pressed', String(controls.inspectNodes));
  lastNodeReadout = -Infinity;
}
nodeButton.addEventListener('click', toggleNodeInspector);
bodyMaterialInput.addEventListener('input', () => {
  controls.bodyMaterial = clamp(Number(bodyMaterialInput.value));
  try { localStorage.setItem('mythtrace.body-material', String(controls.bodyMaterial)); } catch {}
});
try {
  const value = localStorage.getItem('mythtrace.body-material');
  if (value !== null) controls.bodyMaterial = clamp(Number(value));
} catch {}
bodyMaterialInput.value = String(controls.bodyMaterial);

function enterSystem({ camera = false, mic = false } = {}) {
  running = true;
  document.body.dataset.stopped = 'false';
  entry.dataset.hidden = 'true';
  setStatus('pointer ready · C toggles camera');
  if (camera && !tracking.getFrame().camera.active && !cameraPending) void enableCamera(preferredCameraDeviceId);
  if (mic && !micRequested && readLocal('mythtrace.entry-mic.v1') !== 'false') {
    micRequested = true;
    if (!audioMidi.getFrame().micActive) void toggleStageMic();
  }
}

const demoConfig = CONFIG.shaperDemo;
const demoHasStageMusic = () => orchestra.state().running || musicStartPending || music.getState().armed
  || atmosphere.active() || wagnerScore.state.playing || wagnerScore.state.pending;

async function setDemoSound(active) {
  const demo = shaperDemo;
  if (!demo) return;
  const revision = ++demo.soundRevision;
  demo.sound = Boolean(active);
  demoSoundButton.setAttribute('aria-pressed', String(demo.sound));
  if (!demo.sound || controls.paused) {
    demoBand.stop();
    demoOrchestra.stop();
    demoLine.hidden = true;
    demoPanel.dataset.sound = 'off';
    return;
  }
  demoPanel.dataset.sound = 'starting';
  try {
    await Promise.all([demoOrchestra.start(), demoBand.start({ ...demo.chapter, key: activeDemoKey() })]);
    if (shaperDemo === demo && demo.soundRevision === revision && demo.sound && demoOrchestra.state().ready) {
      demoPanel.dataset.sound = 'live';
    }
  } catch {
    if (shaperDemo === demo && demo.soundRevision === revision) {
      void setDemoSound(false);
      demoPanel.dataset.sound = 'blocked';
    }
  }
}

function showDemoChapter(index) {
  const demo = shaperDemo;
  demo.index = index;
  demo.score.restart();
  demo.nextPhrase = demo.nextLine = 0;
  demo.speechAt = -Infinity;
  demo.voiceOpening = 1;
  demo.lineUntil = 0;
  demoLine.hidden = true;
  demoOrchestra.cancelPending();
  demo.expressionReady = false;
  demo.lastExpression = performance.now();
  demo.chapter = demo.chapters[index];
  const { geometry, look, mode = 3, overlays, music: profile, key, frame: frameId } = demo.chapter;
  const { name: _name, ...lookSettings } = presets.looks[look];
  delete demoPanel.dataset.signal;
  if (mode !== controls.mode) setMode(mode);
  applySceneSettings({ ...lookSettings, ...demo.chapter.scene, preset: 'custom' }, mode);
  applyGeometryPreset(geometry, false);
  configureLightScore({ strength: demo.chapter.strength }, false);
  setSacredLayer(demo.chapter.sacred, controls.sacredStrength, false);
  controls.demoMix.overlays = overlays.filter(([id]) => !versionLibrary.archived('geo:' + id));
  frameConfigurator.configure(presets.frame[frameId], false);
  setFramePerformance(true);

  if (demo.chapter.material) setGloveMaterial(demo.chapter.material, false);
  setDemoLevel(demo.chapter.mix);
  $('[data-score-edit]').hidden = false;
  $('[data-score-editor-name]').textContent = demo.chapter.name;
  $('[data-score-timbre]').value = profile;
  demoOrchestra.configure({ ...presets.music[profile], key, level: demoConfig.level });
  applyStoryVariantParameters(geometry, {}, storyVersions.get(geometry));
  demoPanel.dataset.chapter = geometry;
  markPreset('demoTemplate', geometry);
  demoTitle.textContent = demo.chapter.name;
  demoGuide.textContent = demo.chapter.guide;
  demoProgress.value = 0;
  if (demo.sound) void setDemoSound(true);
}

function toggleShaperDemo(initialGeometry = '') {
  if (shaperDemo) {
    if (!initialGeometry) { stopShaperDemo(); return; }
    const index = shaperDemo.chapters.findIndex(chapter => chapter.geometry === initialGeometry);
    if (index >= 0) showDemoChapter(index);
    return;
  }
  const chapters = demoConfig.chapters.filter(chapter => !versionLibrary.archived('geo:' + chapter.geometry)
    && !versionLibrary.archived('look:' + chapter.look));
  const index = initialGeometry ? chapters.findIndex(chapter => chapter.geometry === initialGeometry) : 0;
  if (!chapters.length || index < 0) {
    setStatus('Restore this score in Visual → Versions');
    return;
  }
  stopStageArrangement();
  closeInstrumentPanels();
  closeSetupPanel();
  shaperDemo = {
    chapters, sound: false, soundRevision: 0, mode: controls.mode, scene: controls.scene, workflow, paused: controls.paused,
    frame: frameConfigurator.getState(), frameArmed: framePerformanceArmed, manual: manualFrame,
    geometry: normalizeGeometry(controls.lightScore), muted: controls.geometryMuted, ownsListener: false,
    material: controls.gloveMaterial || 'composite', sacred: controls.sacredLayer, sacredStrength: controls.sacredStrength,
    score: createShaperDemoScore(), amount: presets.geometryIntensity.balanced,
  };
  controls.demoMix = { effects: shaperDemo.score.effects, center: shaperDemo.score.center, overlays: [], elapsed: 0 };
  workflow = 'face';
  controls.demoActive = true;
  renderWorkflow();
  controls.paused = false;
  enterSystem();
  configureLightScore({ strength: shaperDemo.amount, sources: { eyes: true, hands: true, cursor: true },
    shadow: null, scatter: [], mask: 'off' }, false);
  demoAmount.value = String(shaperDemo.amount);
  showDemoChapter(index);
  demoPanel.hidden = false;
  setButtonState('demo', true);
  demoButton.setAttribute('aria-pressed', 'true');
  void setDemoSound(!demoHasStageMusic());
}

function stopShaperDemo() {
  if (!shaperDemo) return;
  const demo = shaperDemo;
  shaperDemo = null;
  controls.demoActive = false;
  controls.demoMix = null;
  demoBand.stop();
  demoOrchestra.stop();
  $('[data-score-edit]').hidden = true;
  setGloveMaterial(demo.material, false);
  if (demo.ownsListener) geometryControls.stopListening();
  demoPanel.hidden = true;
  for (const key of ['chapter', 'sound', 'signal']) delete demoPanel.dataset[key];
  setButtonState('demo', false);
  demoButton.setAttribute('aria-pressed', 'false');
  markPreset('demoTemplate', '');
  workflow = demo.workflow;
  renderWorkflow();
  controls.paused = demo.paused;
  setMode(demo.mode);
  if (demo.scene) applySceneSettings(demo.scene, demo.mode);
  configureLightScore(demo.geometry, false);
  setGeometryMuted(demo.muted, false);
  setSacredLayer(demo.sacred, demo.sacredStrength, false);
  frameConfigurator.configure(demo.frame, false);
  setFramePerformance(demo.frameArmed);
  manualFrame = demo.manual;
}

function updateShaperDemo(time, dt, tracking) {
  const demo = shaperDemo;
  if (!demo) return;
  const chapter = demo.chapter, mix = controls.demoMix;
  // Repeat the music inside the selected instrument. Only a performer changes the scenario.
  if (demo.score.elapsed() >= chapter.durationMs && !controls.paused) {
    demo.score.restart();
    demo.nextPhrase = demo.nextLine = 0;
  }
  const face = measuredFace(tracking, time, controls.lightScore.sources);
  const hands = tracking.hands.filter(hand => !hand.stale && hand.score >= CONFIG.lightScore.studies.confidence
    && time - hand.lastSeen <= CONFIG.lightScore.studies.freshMs);
  mix.center[3] = controls.clipActive ? 0 : 1;
  mix.hasHands = hands.length > 0;
  const listening = geometryControls?.isListening();
  const voiceOpen = geometryControls?.hasLiveMic();
  if (demoMic.getAttribute('aria-pressed') !== String(Boolean(listening))) demoMic.setAttribute('aria-pressed', String(Boolean(listening)));
  const input = voiceOpen ? 'Voice in live' : listening ? 'Requesting mic' : audioMidi.getFrame().micActive ? 'Mic analysis' : 'Mic off';
  const signal = chapter.center === 'hand'
    ? (hands.length ? hands.length + (hands.length === 1 ? ' live glove' : ' live gloves') : tracking.camera?.active ? 'Show your hands' : 'Score hands')
    : (face?.features?.mouth ? 'Mouth tracked' : tracking.camera?.active ? 'Looking for mouth' : 'Score field');
  const label = [signal, input, demoPanel.dataset.sound === 'blocked' ? 'Press J for sound'
    : demo.sound ? storyKeyName(guestStageKey || activeDemoKey()) : demoHasStageMusic() ? 'Stage mix' : 'Silent'].join(' · ');
  if (demoSource.textContent !== label) demoSource.textContent = label;
  if (controls.paused) return;
  const hand = hands[0]?.palm, mouth = face?.features?.mouth;
  const center = (chapter.center === 'face' ? mouth || hand : hand || mouth) || controls.pointer;
  mix.voiceEnergy = Math.max(clamp((audioMidi.getFrame().rawRms || 0) * CONFIG.roomConductor.rmsGain),
    demo.voiceOpening * clamp(1 - (time-demo.speechAt)/demoConfig.breathDecayMs));
  const movement = Math.max(tracking.metrics?.motion || 0, tracking.metrics?.handEnergy || 0,
    face?.blendshapes?.[chapter.expression] || 0, mix.voiceEnergy);
  const progress = demo.score.step(chapter, dt * 1000, center, movement, demo.amount, controls.reducedMotion);
  const elapsed = demo.score.elapsed();
  mix.elapsed = demoBand.beatTime() ?? elapsed;
  const percent = Math.round(progress * 100);
  if (demoProgress.value !== percent) demoProgress.value = percent;
  if (time >= demo.lineUntil) demoLine.hidden = true;
  if (!demo.sound || !demoOrchestra.state().ready) return;
  const line = chapter.lines?.[demo.nextLine];
  if (line && elapsed >= line.at * chapter.durationMs) {
    demo.nextLine++;
    if (!listening && elapsed - line.at * chapter.durationMs < demoConfig.phraseLateMs) {
      void demoBand.speak(line).then(played => {
        if (!played || demo !== shaperDemo || chapter !== demo.chapter) return;
        demo.voiceOpening = 1;
        demo.speechAt = performance.now();
        demo.lineUntil = demo.speechAt + demoConfig.captionMs;
        demoLine.textContent = line.text;
        demoLine.hidden = false;
      });
    }
  }
  const phrase = chapter.phrases[demo.nextPhrase];
  if (phrase && elapsed + demoConfig.audioLookaheadMs >= phrase.at * chapter.durationMs) {
    demo.nextPhrase++;
    if (elapsed - phrase.at * chapter.durationMs < demoConfig.phraseLateMs) {
      demoOrchestra.playDegrees(storyVersions.get(chapter.geometry).degrees || phrase.notes, phrase.step, .58);
    }
  }
  demoOrchestra.update(hands);
  demoBand.modulate(chapter, hands);
  const level = face?.blendshapes?.[chapter.expression];
  if (!Number.isFinite(level)) demo.expressionReady = false;
  else if (level < demoConfig.gateOff) demo.expressionReady = true;
  else if (level > demoConfig.gateOn && demo.expressionReady && time - demo.lastExpression > demoConfig.gestureCooldownMs) {
    demo.expressionReady = false;
    demo.lastExpression = time;
    demoOrchestra.playDegrees(chapter.notes, presets.music[chapter.music].pace, .56);
  }
}

demoAmount.addEventListener('input', () => {
  if (!shaperDemo) return;
  shaperDemo.amount = Number(demoAmount.value);
  configureLightScore({strength:shaperDemo.amount}, false);
});

demoPanel.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!shaperDemo || !button) return;
  if (button.hasAttribute('data-demo-close')) stopShaperDemo();
  else if (button === demoSoundButton) void setDemoSound(!shaperDemo.sound);
  else if (button === demoFrame) {
    setFramePerformance(!framePerformanceArmed);
  } else if (button === demoMic) {
    if (geometryControls.isListening()) geometryControls.stopListening();
    else {
      const demo = shaperDemo;
      demo.ownsListener = true;
      demoBand.stopVoice();
      void geometryControls.startListening().then(() => {
        if (shaperDemo === demo && !geometryControls.hasLiveMic()) {
          demoLine.textContent = agentPanel.querySelector('[data-sotnik-status]').textContent;
          demoLine.hidden = false;
          demo.lineUntil = performance.now() + demoConfig.captionMs;
        }
      });
    }
  }
});

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else void stage.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
}

function panicOutputs() {
  stopStageArrangement();
  auditionArrangement.stop();
  storyAudition.stop();
  closeStory();
  stageAgent.cancel();
  guestPart.stop();
  speechTrace.clear();
  stopShaperDemo();
  musicStartGeneration++;
  musicStartPending = false;
  gesturePhrase = [];
  roomMusicActive = airMicReactive = roomMusicOwnedInput = airMicOwnedInput = false;
  endPhraseCapture();
  orchestra.stop();
  sectorDeck.stop('stage'); sectorDeck.stop('preview');
  void sectorDeck.arm(false);
  sectorArm.setAttribute('aria-pressed', 'false');
  sectorInput.reset();
  wagnerScore.panic('panic · Tristan stopped · exact silence');
  atmosphere.stop(true);
  stopPresence();
  geometryControls?.stopListening();
  liveLab.stop();
  if (liveShadow.enabled) setLiveShadow(false);
  if (clips.isLocal()) clips.close();
  renderWagnerSurface();
  const scoreWasRecording = Boolean(scoreRecorder?.getState?.().recording);
  recordScoreEvent({ kind: 'system', action: 'panic', label: 'all sound gates zero' });
  if (scoreWasRecording) {
    scoreRecorder.stop('panic', performance.now());
  }
  micCalibrationMonitorRestore = false;
  micCalibration?.cancel?.('panic · mic calibration cancelled');
  audioMidi.panic?.();
  renderVoiceGameSurface(audioMidi.getFrame?.()?.voiceGame);
  panicSampler();
  music.panic?.({ disarm: true });
  subjectRouteState = subjectRoute.reset(performance.now());
  mpeOutput.panic?.();
  stopNarration();
  voiceCaption.panic();
  panicPerformancePatch();
  panicCapture();
  stageCheckPanicAt = performance.now();
  controls.pointer.down = false;
  renderMusicTransport();
  setStatus('panic · all sound gates zero');
  updateInputRitual();
}



function togglePause() {
  controls.paused = !controls.paused;
  if (shaperDemo?.sound) void setDemoSound(true);
  running = true;
  document.body.dataset.stopped = 'false';
  setStatus(controls.paused ? 'field held' : 'field live');
}

function handleKey(event) {
  if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
  const key = /^[а-яё]$/i.test(event.key) && /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(-1).toLowerCase() : event.key.toLowerCase();
  if (previewStory && key === 'escape') {
    event.preventDefault();
    closeStory(true);
    return;
  }
  const typing = event.target.closest?.('textarea,[contenteditable]:not([contenteditable="false"]),input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="file"])');
  if (!typing && event.shiftKey) {
    const cue = { Digit1: 'contour', Digit2: 'etching', Digit3: 'memory' }[event.code];
    const shortcut = { q: cycleGeometryPreset, y: () => setSacredLayer('off'), j: cycleOrchestraPreset, g: toggleHandFrame, f: cycleFramePreset }[key];
    if (shortcut || cue) {
      event.preventDefault();
      if (!event.repeat) {
        if (shortcut) shortcut();
        else { stopShaperDemo(); applyPerformanceCue(cue); }
      }
      return;
    }
  }
  const screenInstrument = !musicPanel.hidden && $('#music-details').open;
  if (!typing && key === 'd' && (event.shiftKey || !screenInstrument)) {
    event.preventDefault();
    if (!event.repeat) {
      if (event.shiftKey) {
        controls.debug = !controls.debug;
        tracking.setDebug?.(controls.debug);
      } else toggleShaperDemo();
    }
    return;
  }
  if (!typing && key === 'y' && (!screenInstrument || event.shiftKey)) {
    event.preventDefault();
    if (!event.repeat) {
      setSacredLayer(nextPreset(Object.keys(presets.sacred.shapes).filter(id => !archivedSacred.includes(id)), controls.sacredLayer));
    }
    return;
  }
  if (!typing && (key === 'j' || key === 'c')) {
    event.preventDefault();
    if (key === 'j') {
      if (shaperDemo) {
        if (!event.repeat) void setDemoSound(!shaperDemo.sound);
      } else {
        if (!event.repeat) toggleMusic();
      }
    } else if (!event.repeat) toggleStageCamera();
    return;
  }
  if (typing || event.target.matches?.('input, select')) {
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
  if (event.key === 'Enter' && entry.dataset.hidden !== 'true'
    && ![enterHandsButton, $('#enter-demo')].includes(event.target) && !event.target.closest?.('[data-entry-study], [data-open-cameras], #camera-sources')) {
    event.preventDefault();
    enterSystem();
    return;
  }
  if (key === 'b' && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); if (!event.repeat) toggleNodeInspector(); return; }
  if (key === 'v' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && !event.repeat) {
    event.preventDefault(); openStageAgent(); return;
  }
  if (key === 'v' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.repeat) {
    setPatchConsole(true);
    $('#live-lab').open = true;
    return;
  }
  if (key === 'u' && pendingBuildStamp) { event.preventDefault(); applyBuildUpdate(); return; }
  if (event.key === 'Escape' && document.body.dataset.frameDrawing === 'true') {
    event.preventDefault();
    clearAuthoredFrame();
    return;
  }
  if (event.key === 'Escape' && shaperDemo) { event.preventDefault(); stopShaperDemo(); return; }
  if (event.key === 'Escape' && !updateNotice.hidden) { event.preventDefault(); deferBuildUpdate(); return; }
  if ($('#music-details').open && !musicPanel.hidden && !['c', 'f', 'g'].includes(key) && !event.metaKey && !event.ctrlKey && !event.altKey
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
  if (event.key === 'Escape' && !setupPanel.hidden) {
    event.preventDefault();
    closeSetupPanel();
    return;
  }
  if (key === 'e') { toggleEntityConsole(); return; }
  if (event.key === ',') { event.preventDefault(); navigateFocus(-1); return; }
  if (event.key === '.') { event.preventDefault(); navigateFocus(1); return; }
  if (key === 's') { toggleSamplerConsole(); return; }
  if (key === 'g') { toggleFrameConsole(); return; }
  if (key === 't') { toggleSceneConsole(); return; }
  if (key === 'o') { toggleTrace(); return; }
  if (key === 'p') { toggleTrackingTiles(); return; }
  if (key === 'i') { toggleMusicConsole(); return; }
  if (key === 'z') { toggleNarrativeConsole(); return; }
  if (key === 'q') { togglePatchConsole(); return; }
  if (key === 'l') { toggleCaptureConsole(); return; }
  if (key === 'k') { toggleCalibration(); return; }
  if (/^[1-5]$/.test(event.key)) selectVisualMode(Number(event.key) - 1);
  else if (event.key === ' ') { event.preventDefault(); togglePause(); }
  else if (event.key.toLowerCase() === 'f') toggleFullscreen();
  else if (event.key.toLowerCase() === 'h') {
    controls.hud = !controls.hud;
    document.body.dataset.hud = String(controls.hud);
  }
  else if (event.key.toLowerCase() === 'm') toggleMirror();
  else if (key === 'a') { if (shaperDemo) demoMic.click(); else toggleStageMic(); }
  else if (event.key.toLowerCase() === 'n') enableMidi();
  else if (event.key.toLowerCase() === 'r') {
    stopShaperDemo();
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
  else if (event.key.toLowerCase() === 'x') panicOutputs();
  else if (event.key === '-' || event.key === '_') adjustStageEffects(-0.05);
  else if (event.key === '=' || event.key === '+') adjustStageEffects(0.05);
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
  else if (event.key === '?' || event.key === '/') setHelpVisible(help.hidden);
}

function setPointer(event) {
  const rect = stage.getBoundingClientRect();
  controls.pointer.x = clamp((event.clientX - rect.left) / rect.width);
  controls.pointer.y = clamp((event.clientY - rect.top) / rect.height);
  controls.pointer.focusActive = !event.target.closest?.('nav, aside, button, input, select, a, iframe');
  roomPointerActive = !event.target.closest?.('nav, aside, button, input, select, label, textarea, a, iframe');
  if (entryPointer && entry.dataset.hidden !== 'true') {
    const size = entryPointer.dataset.active === 'true' ? 38 : 30;
    const x = Math.max(7, Math.min(rect.width - size - 7, event.clientX - rect.left - size * 0.5));
    const y = Math.max(28, Math.min(rect.height - size - 7, event.clientY - rect.top - size * 0.5));
    entryPointer.style.transform = `translate3d(${x}px,${y}px,0)`;
    entryPointer.dataset.ready = 'true';
    entry.dataset.pointerReady = 'true';
    const previous = entry.querySelector('[data-pointer-focus="true"]');
    const target = event.target?.closest?.('[data-pointer-label]');
    if (previous && previous !== target) previous.dataset.pointerFocus = 'false';
    if (target) target.dataset.pointerFocus = 'true';
    entryPointer.dataset.active = String(Boolean(target));
    if (entryPointerLabel) entryPointerLabel.textContent = target?.dataset.pointerLabel || 'pointer · field';
  }
}

function sizePointerFrame() {
  const { x, y } = controls.pointer;
  manualFrame.x = Math.min(x, frameOrigin.x);
  manualFrame.y = Math.min(y, frameOrigin.y);
  manualFrame.w = Math.abs(x - frameOrigin.x);
  manualFrame.h = Math.abs(y - frameOrigin.y);
}

function latticeSurface(event) {
  const sacredPins = controls.sacredLayer === 'auto' && (event.shiftKey || event.type === 'contextmenu');
  const editableMesh = !controls.focusField && !controls.geometryMuted && (controls.lightScore.layers.lattice > 0 || controls.lightScore.auto);
  return running && (sacredPins || editableMesh) && document.body.dataset.frameDrawing !== 'true'
    && !event.target.closest('nav, aside, button, input, select, label, textarea, a, [role="dialog"]');
}

function editableLatticeAnchors() {
  const now = performance.now();
  const sources = controls.lightScore.sources;
  if (!controls.lightScore.auto) return latticeAnchors(trackingFrame, now, sources);
  return Object.fromEntries(scoreAnchors(trackingFrame, now, sources, null, null, controls.clipTracking && controls.clipCover)
    .filter(node => node.id !== 'body').map(node => [node.id, node]));
}

stage.addEventListener('pointermove', (event) => {
  setPointer(event);
  if (event.pointerId === framePointerId) sizePointerFrame();
  if (latticeDrag?.id === event.pointerId) {
    controls.latticePreview = { ...controls.pointer, index: latticeDrag.index };
  }
}, { passive: true });
stage.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || event.button !== 0
    || event.target.closest('nav, aside, button, input, select, label, textarea, a, [role="dialog"]')) return;
  setPointer(event);
  if (shaperDemo) {
    if (demoOrchestra.state().ready && !trackingFrame.hands.length) demoOrchestra.strike(controls.pointer.y, .55, (controls.pointer.x - .5) * 1.4);
    return;
  }
  if (orchestra.state().ready && !trackingFrame.hands.length) orchestra.strike(controls.pointer.y, .62, (controls.pointer.x - .5) * 1.4);
  if (document.body.dataset.frameDrawing === 'true') {
    framePointerId = event.pointerId;
    frameOrigin.x = controls.pointer.x;
    frameOrigin.y = controls.pointer.y;
    manualFrame = { x: frameOrigin.x, y: frameOrigin.y, w: 0, h: 0, committed: false };
    stage.setPointerCapture?.(event.pointerId);
  } else if (controls.roomEnabled && !event.shiftKey) {
    if (event.pointerType !== 'mouse') {
      roomPointerActive = false;
      controls.room = controls.room?.locked ? roomGeometry.release()
        : roomGeometry.lock({ x: .5, y: .5 }, stage.clientWidth, stage.clientHeight);
    } else {
      controls.room = roomGeometry.lock(controls.pointer, stage.clientWidth, stage.clientHeight);
    }
  } else if (workflow === 'objects' && !event.shiftKey) {
    controls.objectFocus = sampleObjectFocus(trackingFrame, controls.pointer, performance.now());
    controls.objectFocus = objectFocus.toggle(performance.now());
    renderStageTracking(tracking.getFrame());
  } else if (latticeSurface(event)) {
    const anchors = editableLatticeAnchors();
    const points = controls.lightScore.pins.map(pin => pinPosition(pin, anchors));
    const index = nearestNode(points, controls.pointer, stage.clientWidth, stage.clientHeight, CONFIG.lightScore.lattice.grabPx);
    latticeDrag = { id: event.pointerId, index };
    stage.setPointerCapture?.(event.pointerId);
  } else controls.pointer.down = true;
});
stage.addEventListener('pointerup', (event) => {
  controls.pointer.down = false;
  if (latticeDrag?.id === event.pointerId) {
    setPointer(event);
    const pins = [...controls.lightScore.pins];
    const { index } = latticeDrag;
    const pin = placePin(controls.pointer, editableLatticeAnchors(),
      stage.clientWidth, stage.clientHeight, event.shiftKey);
    if (index !== null && pins[index]) pins[index] = pin;
    else if (pins.length < CONFIG.lightScore.lattice.maxPins) pins.push(pin);
    configureLightScore({ pins });
    latticeDrag = controls.latticePreview = null;
    return;
  }
  if (event.pointerId !== framePointerId) return;
  setPointer(event);
  sizePointerFrame();
  framePointerId = null;
  const minimum = CONFIG.gestureFrame.pointerMinSize;
  if (manualFrame.w < minimum || manualFrame.h < minimum) {
    manualFrame = null;
    gestureFrame.reset(frameZoneClock);
    return;
  }
  manualFrame.committed = true;
  setFrameDrawing(false);
  setStatus('frame selected · FRAME opens image controls');
});
stage.addEventListener('pointercancel', (event) => {
  controls.pointer.down = false;
  if (latticeDrag?.id === event.pointerId) latticeDrag = controls.latticePreview = null;
  if (event.pointerId === framePointerId) clearAuthoredFrame();
});
stage.addEventListener('pointerleave', () => {
  roomPointerActive = false;
  controls.pointer.focusActive = false;
});
stage.addEventListener('contextmenu', event => {
  if (shaperDemo) return;
  if (workflow === 'objects' && !event.shiftKey && !event.target.closest('nav, aside, button, input, select, label, textarea, a')) {
    event.preventDefault();
    objectFocus.clear();
    controls.objectFocus = null;
    return;
  }
  if (controls.roomEnabled && !event.shiftKey && !event.target.closest('nav, aside, button, input, select, label, textarea, a')) {
    event.preventDefault();
    controls.room = roomGeometry.release();
    return;
  }
  if (!latticeSurface(event)) return;
  event.preventDefault();
  latticeDrag = controls.latticePreview = null;
  configureLightScore({ pins: [] });
});
focusNavigator?.addEventListener('pointerdown', (event) => event.stopPropagation());
focusPreviousButton?.addEventListener('click', () => navigateFocus(-1));
focusNextButton?.addEventListener('click', () => navigateFocus(1));
focusReleaseButton?.addEventListener('click', releaseFocus);
entry.addEventListener('pointerleave', () => {
  const focused = entry.querySelector('[data-pointer-focus="true"]');
  if (focused) focused.dataset.pointerFocus = 'false';
  if (entryPointer) entryPointer.dataset.active = 'false';
  if (entryPointer) entryPointer.dataset.ready = 'false';
  entry.dataset.pointerReady = 'false';
  if (entryPointerLabel) entryPointerLabel.textContent = 'pointer · field';
});
window.addEventListener('keydown', handleKey);
window.addEventListener('keyup', (event) => {
  stopComputerMusicKey(event.key.toLowerCase());
});
window.addEventListener('resize', () => { resizeQueued = true; }, { passive: true });
entry.addEventListener('mythtrace:enter', event => {
  if (event.detail === 'demo' || event.detail?.startsWith('demo:')) toggleShaperDemo(event.detail.slice(5));
  else if (event.detail?.startsWith('story:')) openStoryLink(event.detail.slice(6));
  else enterSystem();
});
enterHandsButton?.addEventListener('click', () => {
  enterSystem({ camera: true, mic: true });
  void playOrchestra();
});
cameraSelect.addEventListener('change', () => enableCamera(cameraSelect.value));
function closeCameraSources() {
  cameraSources.hidden = true;
  renderCameraMonitor(tracking.getFrame().camera);
  document.querySelectorAll('[data-open-cameras]').forEach(button => button.setAttribute('aria-expanded','false'));
  const opener = cameraOpener?.getClientRects().length ? cameraOpener : controlsBar.querySelector('[data-open-cameras]');
  opener?.focus({preventScroll:true});
}
document.querySelectorAll('[data-open-cameras]').forEach(button => button.addEventListener('click', () => {
  if (!cameraSources.hidden) { closeCameraSources(); return; }
  cameraOpener = button;
  cameraSources.hidden = false;
  button.setAttribute('aria-expanded','true');
  renderCameraSources(tracking.getFrame().camera);
  void refreshCameraDevices();
  cameraSources.querySelector('[data-close-cameras]').focus({preventScroll:true});
}));
cameraSources.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-camera-pick')) {
    if (!running || entry.dataset.hidden !== 'true') enterSystem();
    void enableCamera(button.dataset.cameraPick);
  }
  else if (button.hasAttribute('data-phone-preview')) {
    if (!running || entry.dataset.hidden !== 'true') enterSystem();
    void enableCamera('window:preview');
  }
  else if (button.hasAttribute('data-refresh-cameras')) void refreshCameraDevices();
  else if (button.hasAttribute('data-close-cameras')) closeCameraSources();
  else if (button.hasAttribute('data-stop-camera')) { cameraSwitchError = ''; toggleStageCamera(); }
});
cameraSources.addEventListener('keydown', event => {
  if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); closeCameraSources();}
  else if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
});
micSelect?.addEventListener('change', () => {
  preferredMicDeviceId = String(micSelect.value || '');
  micCalibrationMonitorRestore = false;
  micCalibration.cancel('mic changed · calibration cancelled');
  const calibration = micCalibration.selectDevice(preferredMicDeviceId || 'default');
  audioMidi.setMicFloor?.(calibration.gateFloor ?? CONFIG.audio.floor);
  micCalibrationAppliedAt = calibration.calibratedAt;
  renderMicCalibrationSurface(calibration);
  if (audioMidi.getFrame?.()?.micActive) void enableAudio(preferredMicDeviceId, audioMidi.getFrame().monitorActive);
});
captionLanguageSelect?.addEventListener('change', () => {
  voiceCaption.setLanguage(captionLanguageSelect.value);
  renderVoiceCaptionSurface();
});
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
samplerList.addEventListener('input', (event) => {
  const field = event.target.closest('input[data-sampler-clip-field]');
  if (!field) return;
  const output = field.parentElement?.querySelector(`[data-sampler-clip-output="${field.dataset.samplerClipField}"]`);
  if (output) output.textContent = `${Math.round(Number(field.value) * 1000)}ms`;
});
samplerList.addEventListener('change', (event) => { void configureSamplerClip(event); });
samplerSceneList?.addEventListener('click', (event) => {
  const save = event.target.closest('[data-sampler-scene-save]');
  if (save) saveSamplerScene(save.dataset.samplerSceneSave);
  const recall = event.target.closest('[data-sampler-scene-recall]');
  if (recall) recallSamplerScene(recall.dataset.samplerSceneRecall);
});
samplerSequenceButton?.addEventListener('click', () => {
  const state = samplerSequence.setEnabled(!samplerSequence.getState().enabled);
  renderSamplerSceneSlots();
  samplerStatusOutput.textContent = state.enabled
    ? 'non-repeat on · next hand / frame event walks the local library'
    : 'non-repeat off · mapped clip only';
});
samplerTextureButton?.addEventListener('click', () => {
  samplerTextureState = { ...samplerTextureState, enabled: !samplerTextureState.enabled };
  persistSamplerTextureState();
  renderSamplerSceneSlots();
  samplerStatusOutput.textContent = samplerTextureState.enabled
    ? 'texture on · mapped sample uses four bounded grains'
    : 'texture off · mapped sample returns to normal playback';
});
for (const field of samplerTextureFields) field.addEventListener('input', () => {
  const key = field.dataset.samplerTextureField;
  const settings = CONFIG.sampler.texture;
  const value = key === 'grainSizeSeconds'
    ? clamp(Number(field.value), settings.grainSizeMinSeconds, settings.grainSizeMaxSeconds)
    : clamp(Number(field.value), 0, settings.scatterMax);
  samplerTextureState = { ...samplerTextureState, [key]: value };
  persistSamplerTextureState();
  renderSamplerSceneSlots();
});
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
  const settings = sceneConfigurator.getModeSettings(controls.mode);
  recordScoreEvent({
    kind: 'scene', action: 'reset', label: `mode ${controls.mode + 1}`,
    data: { mode: controls.mode, preset: settings?.preset || 'base' },
  });
  setStatus(`scene tune reset · mode ${controls.mode + 1}`);
});
scenePanel.addEventListener('click', handleSceneControl);
scenePanel.addEventListener('input', handleSceneControl);
scenePanel.addEventListener('change', handleSceneControl);
narrativePanel.querySelector('[data-narrative-close]').addEventListener('click', () => setNarrativeConsole(false));
narrativeGenerateButton.addEventListener('click', () => { void createNarration(); });
narrativePlayButton.addEventListener('click', () => { void playNarration(); });
narrativeMemoryMarkButton?.addEventListener('click', markVoiceMemoryPhrase);
narrativeMemoryOpeningButton?.addEventListener('click', useVoiceMemoryOpening);
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
  renderVoiceMemorySurface();
  if (narrativeState.source === 'generated') return;
  const source = CONFIG.narration.sources[narrativeState.source];
  if (!source) return;
  narrativeMeta.textContent = `${source.label} · ${Math.round(narrativeAudio.duration || 0)}s · local playback`;
});
narrativeAudio.addEventListener('canplay', () => {
  renderVoiceMemorySurface();
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
musicPanel.querySelector('[data-music-arm]').addEventListener('click', toggleHandMusic);
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
mpeOutputToggle?.addEventListener('click', () => {
  void mpeOutput.enable(mpeOutputSelect?.value || '').then(renderMusicSurface);
});
mpeOutputSelect?.addEventListener('change', () => {
  mpeOutput.selectOutput(mpeOutputSelect.value);
  renderMusicSurface();
});
musicPanel.querySelector('[data-mic-calibrate-quiet]').addEventListener('click', () => {
  void startQuietMicCalibration();
});
musicPanel.querySelector('[data-mic-calibrate-speech]').addEventListener('click', () => {
  void startSpeechMicCalibration();
});
musicPanel.querySelector('[data-mic-calibrate-clear]').addEventListener('click', clearMicCalibrationReceipt);
musicPanel.querySelector('[data-audio-diagnostic-reset]').addEventListener('click', resetAudioDiagnosticReceipt);
for (const button of musicPanel.querySelectorAll('[data-finger-calibrate]')) {
  button.addEventListener('click', () => startFingerNeutralCalibration(button.dataset.fingerCalibrate));
}
musicPanel.querySelector('[data-finger-calibration-reset]').addEventListener('click', resetFingerNeutralCalibration);
musicPanel.querySelector('[data-finger-envelope-reset]').addEventListener('click', resetFingerEnvelopes);
for (const button of micMonitorPresetButtons) {
  button.addEventListener('click', () => selectMicMonitorPreset(button.value));
}
for (const button of voiceGamePresetButtons) {
  button.addEventListener('click', () => selectVoiceGamePreset(button.value));
}
for (const button of voiceGamePassButtons) {
  button.addEventListener('click', () => selectVoiceGamePasses(Number(button.value)));
}
voiceGameCaptureButton?.addEventListener('click', () => { void toggleVoiceGameCapture(); });
voiceGamePanel?.querySelector('[data-voice-game-clear]')?.addEventListener('click', releaseVoiceGame);
for (const button of voiceGameSlotButtons) {
  button.addEventListener('click', () => {
    if (button.dataset.slotId) void playVoiceGameSlot(button.dataset.slotId);
  });
}
patchPanel.querySelector('[data-patch-close]').addEventListener('click', () => setPatchConsole(false));
patchToggleButton.addEventListener('click', togglePerformancePatch);
const guestPartOutput = agentPanel.querySelector('[data-agent-part]');
const guestReleaseButton = agentPanel.querySelector('[data-agent-release]');
let guestStageKey = null;
let agentMusicPending = false;
const guestPart = createGuestPart(samplerSession, key => {
  guestStageKey = key;
  orchestra.setGuestKey(key);
  demoOrchestra.setGuestKey(key);
  demoBand.setGuestKey(key);
}, (state, part) => {
  const keyName = { dm: 'D minor', am: 'A minor', cm: 'C minor', fsm: 'F♯ minor' }[part.key];
  guestPartOutput.dataset.state = state;
  guestPartOutput.textContent = state === 'playing'
    ? [keyName, part.preset, part.bars + (part.bars === 1 ? ' bar' : ' bars'), part.degrees.join(' · ')].join(' / ')
    : 'Guest part ' + state + ' · performer key restored';
  guestReleaseButton.disabled = state !== 'playing';
});

function guestTempo() {
  if (shaperDemo?.sound && shaperDemo.chapter.deck) return shaperDemo.chapter.deck.bpm;
  if (atmosphere.active() && atmosphere.profile() === 'bass') return Number($('[data-bass-control="bpm"]').value) || CONFIG.bassDeck.bpm;
  return CONFIG.stageAgent.guestTempo;
}

const stageAgent = createStageAgent({
  read: () => controls.lightScore,
  context: () => ({ ...stageSignal(), mode: controls.mode, geometry: controls.geometryMuted ? 'off' : geometryPreset,
    palette: controls.lightScore.palette, sacred: controls.sacredLayer, musicPreset: shaperDemo ? $('[data-score-timbre]').value : orchestraPreset,
    key: guestStageKey || activeDemoKey() || orchestraKey.value, tempo: guestTempo(), score: shaperDemo?.chapter.name || '',
    music: Boolean(shaperDemo?.sound || guestStageKey || orchestra.state().running || stageSignal().music) }),
  apply: applyAgentAction,
  preflight: plan => {
    for (const action of plan.actions) {
      const kind = { geometry: 'geo', visual: 'look', sacred: 'sacred' }[action.type];
      if (kind && versionLibrary.archived(kind + ':' + action.preset)) throw new Error('This preset is archived · restore it in Versions first');
    }
  },
  invalidate: () => { if (agentMusicPending && !orchestra.state().ready) orchestra.stop(); },
  report: ({ state, message, history }) => {
    agentPanel.querySelector('[data-sotnik-status]').textContent = message;
    agentPanel.querySelector('[data-agent-last]').textContent = history.length
      ? `Last cue · ${history[0].text} · ${history[0].actions.length} action(s) · ${history[0].source}`
      : 'Scene commands · geometry / light / music / effects';
    stage.dataset.agent = state;
    setStatus(message);
  },
});

agentPanel.querySelector('[data-agent-guest]').addEventListener('click', () => {
  const text = agentPanel.querySelector('[data-geometry-command] input').value.trim();
  void samplerSession.getAudioContext().catch(error => setStatus(error.message));
  stageAgent.submit(text || 'Подыграй два такта в тональности сцены и мягко выйди.', {guest:true});
});
guestReleaseButton.addEventListener('click', () => {
  stageAgent.cancel();
  guestPart.stop();
});

function openStageAgent() {
  if (entry.dataset.hidden !== 'true') enterSystem();
  agentPanel.hidden = false;
}
agentPanel.querySelector('[data-agent-close]').addEventListener('click', () => { agentPanel.hidden = true; });

async function applyAgentAction(action, current) {
  if (action.type === 'release') { guestPart.stop(); return; }
  if (action.type === 'accompany') {
    const nextBeat = () => shaperDemo?.sound && shaperDemo.chapter.deck
      ? demoBand.nextBeatDelay() : atmosphere.nextBeatDelay();
    await guestPart.play(action, guestTempo(), current, nextBeat);
    return;
  }
  if (action.type === 'demo') {
    if (Boolean(shaperDemo) !== action.enabled) toggleShaperDemo();
    return;
  }
  stopShaperDemo();
  const { type, ...value } = action;
  if (type === 'geometry') {
    applyGeometryPreset(value.preset);
  }
  if (type === 'visual') applyShaperLook(value.preset);
  if (type === 'mode') selectVisualMode(value.value);
  if (type === 'light') {
    setGeometryMuted(false, true);
    configureLightScore({ ...value, ...(value.layers || value.auto ? { study: '' } : {}),
      ...(value.layers ? { layers: { ...controls.lightScore.layers, ...value.layers } } : {}) });
  }
  if (type === 'sacred') setSacredLayer(value.preset, value.strength);
  if (type === 'lab') liveLab.applyCue(value);
  if (type === 'air') {
    if (value.preset && value.preset !== 'bass') applyAirPreset(value.preset);
    if (value.playing === false) { atmosphere.stop(true); releaseAirInput(); }
    if (value.playing === true) {
      workflow = 'air'; renderWorkflow(); startAtmosphere(value.preset === 'bass' ? 'bass' : 'air');
    }
    renderMusicTransport();
  }
  if (type === 'frame') setFramePerformance(value.enabled);
  if (type === 'music' || type === 'phrase') {
    if (value.preset) selectOrchestraPreset(value.preset);
    if (value.key) orchestraKey.value = value.key;
    if (value.level !== undefined) orchestraLevel.value = String(value.level);
    if (value.key || value.level !== undefined) {
      saveOrchestraSettings([...(value.key ? ['key'] : []), ...(value.level !== undefined ? ['level'] : [])]);
    }
    if (value.playing === false) { stopMusicLayers(); renderMusicTransport(); }
    else if (value.playing || type === 'phrase') {
      agentMusicPending = !orchestra.state().running;
      try { await playOrchestra(); } finally { agentMusicPending = false; }
      if (!current()) return;
      if (type === 'phrase' && orchestra.state().ready) orchestra.playDegrees(value.degrees, orchestraPace);
    }
  }
}

geometryControls = bindGeometryControls({
  panel: patchPanel, voicePanel: agentPanel, musicPanel, read: () => controls.lightScore, apply: configureLightScore, applyShadow: analyseStage,
  dispatchCommand: stageAgent.submit,
  cancelCommand: () => {
    shadowRequestGeneration++;
    if (liveShadow.enabled) setLiveShadow(false);
    stageAgent.cancel();
    guestPart.stop();
  },
  onListening: enabled => {
    if (shaperDemo && !enabled) shaperDemo.ownsListener = false;
    setButtonState('agent', enabled);
    $('[data-room-voice]').setAttribute('aria-pressed', String(enabled));
    $('[data-room-voice]').textContent = enabled ? 'Stop local voice' : 'Local voice';
    renderAirStatus();
    const captionButton = controlsBar.querySelector('[data-action="captions"]');
    if (captionButton) {
      captionButton.dataset.on = String(enabled);
      captionButton.textContent = enabled ? 'voice text on' : 'voice text';
    }
    agentPanel.querySelector('[data-agent-listening]').textContent = enabled
      ? 'LISTENING · say “Сотник” or “Пёс”, then your cue · STOP AGENT releases the microphone'
      : 'Microphone off · text commands remain available';
  },
  onTranscript: text => {
    const answer = shaperDemo?.chapter.geometry === 'aftervoice' && aftervoiceAnswer(text);
    if (answer) {
      const reply = demoConfig.replies[answer];
      shaperDemo.voiceOpening = reply.opening;
      if (shaperDemo.sound && !controls.paused) demoOrchestra.playDegrees(reply.notes, reply.step, reply.force);
      shaperDemo.speechAt = performance.now();
      shaperDemo.lineUntil = shaperDemo.speechAt + demoConfig.captionMs;
      demoLine.textContent = text.slice(0, 120);
      demoLine.hidden = false;
    }
    speechTrace.push(text, performance.now());
    if (text.trim()) agentPanel.querySelector('[data-agent-last]').textContent = `Heard locally · ${text.slice(0, 140)}`;
  },
  speechLanguage: () => captionLanguageSelect?.value === 'en-US' ? 'en' : 'ru',
  microphone: () => micSelect?.value || preferredMicDeviceId,
  setAppMic: async enabled => {
    if (enabled) await ensureCalibrationMic();
    else {
      audioMidi.disableMic();
      setButtonState('audio', false);
      setButtonState('monitor', false);
      updateInputRitual();
    }
  },
});
localBridgeConnect?.addEventListener('click', connectLocalBridge);
localBridgeDisconnect?.addEventListener('click', disconnectLocalBridge);
capturePanel.querySelector('[data-capture-close]').addEventListener('click', () => setCaptureConsole(false));
captureRecordButton.addEventListener('click', () => { void toggleCaptureRecording(); });
captureAudioToggle?.addEventListener('change', renderCaptureSurface);
captureTakes.addEventListener('click', handleCaptureTakesClick);
scoreRecordButton?.addEventListener('click', startScoreRecording);
scoreStopButton?.addEventListener('click', () => stopScoreRecording('manual'));
scoreClearButton?.addEventListener('click', clearScoreRecording);
scoreDownloadButton?.addEventListener('click', downloadScoreRecording);
framePanel.querySelector('[data-stage-frame-source]').addEventListener('change', event => {
  const focusSource = event.target.value;
  frameConfigurator.configure({ mode: 'object', focusSource, focusDetail: 'whole',
    ...(focusSource === 'object' ? { objectClass: '' } : {}) });
  if (focusSource === 'object') setLiveObjects(true);
});
framePanel.querySelector('[data-stage-frame-image]').addEventListener('change', event => {
  frameConfigurator.configure({ mode: 'object', cameraLayer: event.target.value });
});
musicPanel.addEventListener('input', handleMusicControl);
musicPanel.addEventListener('change', handleMusicControl);
musicPanel.addEventListener('input', handleFingerEnvelopeControl);
musicPanel.addEventListener('change', handleFingerEnvelopeControl);
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

function handleRailControl(event) {
  const button = event.target.closest('button');
  const action = button?.dataset.action;
  if (action === 'mode') selectVisualMode(Number(button.dataset.mode));
  if (action === 'camera') toggleStageCamera();
  if (action === 'objects') setLiveObjects(['disabled', 'unavailable'].includes(latestTrackingStatus.objectStatus));
  if (action === 'mirror') toggleMirror();
  if (action === 'narrative') toggleNarrativeConsole();
  if (action === 'audio') toggleStageMic();
  if (action === 'monitor') void toggleVoiceMonitor();
  if (action === 'mic-calibration') {
    setMusicConsole(true);
    requestAnimationFrame(() => micCalibrationPanel?.scrollIntoView?.({ block: 'start' }));
  }
  if (action === 'captions') void toggleVoiceCaptions();
  if (action === 'midi') enableMidi();
  if (action === 'entities') toggleEntityConsole();
  if (action === 'sampler') toggleSamplerConsole();
  if (action === 'frame-setup') toggleFrameConsole();
  if (action === 'scene') toggleSceneConsole();
  if (action === 'demo') toggleShaperDemo();
  if (action === 'agent') openStageAgent();
  if (action === 'tiles') toggleTrackingTiles();
  if (action === 'trace') toggleTrace();
  if (action === 'music') toggleMusicConsole();
  if (action === 'patch') togglePatchConsole();
  if (action === 'capture') toggleCaptureConsole();
  if (action === 'calibration') toggleCalibration();
  if (action === 'fullscreen') toggleFullscreen();
  if (action === 'help') setHelpVisible(help.hidden);
  if (action === 'advanced') setSetupConsole(setupPanel.hidden);
}
function selectVisualMode(index) {
  stopShaperDemo();
  setMode(index);
  writeLocal(modePreference, String(controls.mode));
  if (index === 3 && controls.scene?.palette === 'noon') applyShaperLook('contour');
}

function syncFocusSurface() {
  controls.focusField = !controls.geometryMuted && controls.lightScore.study === 'point-lattice' && controls.lightScore.strength > 0;
  document.body.dataset.pointLattice = String(controls.focusField);
  focusControls.hidden = !controls.focusField;
  if (controls.focusField) renderFocusControls();
}

function renderFocusControls() {
  const mode = overlayCanvas.dataset.focusGeometry || 'rosette';
  const guide = overlayCanvas.dataset.focusGuide || '';
  const source = overlayCanvas.dataset.focusFieldSource === 'hold' ? 'memory'
    : overlayCanvas.dataset.focusFieldSource || 'auto';
  const description = `${guide} · ${source}`;
  if (focusGuide.textContent !== description) focusGuide.textContent = description;
  focusCameraButton.setAttribute('aria-pressed', String(controls.focusCamera));
  for (const button of focusControls.querySelectorAll('[data-focus-geometry]')) {
    const shape = button.dataset.focusGeometry;
    button.dataset.current = String(shape === mode);
    button.setAttribute('aria-pressed', String(shape === controls.focusGeometry));
  }
}

focusControls.addEventListener('click', event => {
  const button = event.target.closest('button');
  const choice = button?.dataset.focusGeometry;
  if (button === focusCameraButton) {
    controls.focusCamera = !controls.focusCamera;
    if (controls.focusCamera && !tracking.getFrame().camera.active && !cameraPending) void enableCamera();
    renderStageTracking(tracking.getFrame());
  } else if (focusChoices.includes(choice)) controls.focusGeometry = choice;
  else return;
  try { localStorage.setItem(FOCUS_PREF, JSON.stringify({ geometry: controls.focusGeometry, camera: controls.focusCamera })); } catch {}
  renderFocusControls();
});

function renderWorkflow() {
  if (stageArrangement.id && stageArrangement.id !== arrangementId()) stopStageArrangement();
  renderArrangement(stageArrangement.state);
  sectorDeck.setActive(!shaperDemo && currentStory() === 'kosmodrom');
  sectorPanel.hidden = !sectorDeck.active;
  sectorArm.setAttribute('aria-pressed', String(sectorDeck.armed));
  if (!sectorDeck.active) sectorStatus.value = 'Standby';
  document.body.dataset.workflow = workflow;
  controls.objectWorkflow = workflow === 'objects';
  syncFocusSurface();
  for (const button of stage.querySelectorAll('[data-workflow],[data-story-cue]')) {
    const id = button.dataset.workflow || button.dataset.storyCue;
    button.setAttribute('aria-pressed', String(!shaperDemo && id === currentStory()));
  }
  if (controls.roomEnabled && !controls.room) controls.room = roomGeometry.reset();
  roomStatus.hidden = !controls.roomEnabled;
  document.body.dataset.room = String(controls.roomEnabled);
  $('[data-stage-room]').setAttribute('aria-pressed', String(controls.roomEnabled));
  renderGeometryLayerButtons();
  objectStatusOutput.hidden = workflow !== 'objects';
  if (workflow !== 'objects') {
    objectFocus.clear();
    controls.objectFocus = null;
  }
  renderStageTracking(tracking.getFrame());
}

let lastRecipeReadout = -Infinity;
function currentStory() {
  return shaperDemo?.chapter?.geometry || (workflow === 'face' && workflowCue) || workflow;
}

function storyRecipe(id) {
  return presets.workflows[id] || presets.cues[id] || demoConfig.chapters.find(chapter => chapter.geometry === id);
}

function orchestraPhrase(id = currentStory(), timbre = orchestraPreset) {
  const recipe = storyRecipe(id);
  const variant = storyVersions.get(id);
  if (!storyManualMotifs.has(id) && (variant.music || recipe?.music) === timbre && (variant.music || variant.degrees)) {
    return variant.degrees || originalStoryMotif(id, recipe);
  }
  const motif = recipe?.music === timbre && presets.stories[id].phrase;
  return orchestraPhrases.get(timbre) || motif || presets.music[timbre].phrase;
}

function originalStoryMotif(id, recipe) {
  return (!recipe.durationMs && orchestraPhrases.get(recipe.music)) || presets.stories[id].phrase;
}

function storySettings(id, variant = storyVersions.get(id)) {
  const recipe = storyRecipe(id);
  const profile = orchestraProfiles.get(recipe.music);
  const geometry = presets.geometries[variant.geometry] || presets.geometries[recipe.geometry];
  return {
    ...recipe,
    key: recipe.key || profile?.key || presets.music[recipe.music].key,
    level: recipe.durationMs ? demoConfig.level : profile?.level ?? Number(orchestraLevel.defaultValue || '.55'),
    palette: geometry.palette, attack: geometry.attack, sacredStrength: presets.sacred.strength,
    degrees: originalStoryMotif(id, recipe),
    ...variant,
  };
}

function activeDemoKey() {
  const chapter = shaperDemo?.chapter;
  return chapter && (storyVersions.get(chapter.geometry).key || chapter.key);
}

function storyKeyName(key) {
  return storyKeys[key] || key;
}

function updateRecipeReadout(time) {
  if (time-lastRecipeReadout < 250) return;
  lastRecipeReadout = time;
  updateCardState();
  const id = currentStory();
  const variant = storyVersions.get(id);
  const recipe = storySettings(id, variant);
  const look = controls.mode === 3 ? findShaperLook(controls.scene || {}) : '';
  const timbre = shaperDemo ? $('[data-score-timbre]').value : orchestraPreset;
  const geometry = controls.geometryMuted ? 'Off' : presets.geometries[geometryPreset]?.name || 'Custom';
  const frame = frameConfigurator.getState();
  const frameId = matchingFramePreset(frame);
  const expectedLook = { ...presets.looks[recipe.look], ...(variant.look ? {} : recipe.scene) };
  const sameLook = recipe.look ? controls.mode === 3 && Object.entries(expectedLook).every(([key, value]) =>
    key === 'name' || controls.scene?.[key] === value || Math.abs(controls.scene?.[key] - value) < .00001)
    : controls.mode === recipe.mode;
  const paletteOrAttackEdited = variant.palette !== undefined || variant.attack !== undefined;
  const baseGeometry = presets.geometries[recipe.geometry];
  const light = controls.lightScore;
  const customShapeMatches = paletteOrAttackEdited && baseGeometry && light.study === (baseGeometry.study || '')
    && light.auto === baseGeometry.auto && Object.keys(light.layers).length === Object.keys(baseGeometry.layers).length
    && Object.entries(baseGeometry.layers).every(([layer, weight]) => light.layers[layer] === weight);
  if (light.study === 'pigment-relief' && !patchPanel.hidden) {
    const source = overlayCanvas.dataset.trackingStudy === light.study && overlayCanvas.dataset.studySource;
    const signal = source && source !== 'waiting for hands' ? source : 'Waiting for a hand · show the wrist and fingertips';
    const meter = $('[data-relief-tracking]');
    if (meter.value !== signal) meter.value = signal;
  }
  const shapeMatches = recipe.geometry === 'off' ? controls.geometryMuted : !controls.geometryMuted
    && (geometryPreset === recipe.geometry || customShapeMatches);
  const matches = sameLook && shapeMatches
    && (recipe.geometry !== 'pigment-relief' || Math.abs(baseGeometry.reliefDepth - light.reliefDepth) < .005)
    && (!paletteOrAttackEdited || light.palette === recipe.palette && light.attack === recipe.attack)
    && Math.abs(controls.lightScore.strength - recipe.strength) < .005 && frameId === recipe.frame
    && timbre === recipe.music && controls.sacredLayer === recipe.sacred
    && (shaperDemo || ((!variant.key || orchestraKey.value === recipe.key)
      && (variant.level === undefined || Math.abs(Number(orchestraLevel.value) - recipe.level) < .005)
      && (!variant.degrees || recipe.degrees.join(' ') === orchestraPhrase(id).join(' '))))
    && (!recipe.material || controls.gloveMaterial === recipe.material);
  const instrument = (presets.stories[id]?.name || 'Stage') + (matches ? '' : ' · edited');
  const current = workflowRail.querySelector('[aria-pressed="true"]');
  if (current) current.dataset.edited = String(!matches);
  const music = presets.music[timbre]?.name || timbre;
  const lookName = presets.looks[look]?.name || (controls.mode !== 3 ? MODES[controls.mode].name :
    sameLook ? presets.looks[recipe.look]?.name : 'Custom look');
  const pitch = guestStageKey || activeDemoKey() || orchestraKey.value;
  const keyName = storyKeyName(pitch);
  const readout = [instrument, lookName,
    geometry+' '+Math.round(controls.lightScore.strength*100)+'%',
    geometryPreset === 'pigment-relief' ? 'depth ' + Math.round(light.reliefDepth * 100) + '%' : '',
    geometryPreset === 'wire-gloves' ? controls.gloveMaterial : '', 'Frame '+(presets.frame[matchingFramePreset(frame)]?.name || frame.mode),
    framePerformanceArmed ? 'armed' : 'standby', music, keyName, 'Sacred ' + presets.sacred.shapes[controls.sacredLayer]].filter(Boolean).join(' · ');
  const node = $('[data-linked-recipe]');
  if (node.textContent !== readout) node.textContent = readout;
  const live = $('[data-story-live]');
  if (live && live.textContent !== readout) live.textContent = readout;
}

function renderGeometryLayerButtons() {
  $('[data-stage-auto]').setAttribute('aria-pressed', String(!controls.geometryMuted && controls.lightScore.auto));
}

function setRoomLayer(enabled, persist = true) {
  controls.roomEnabled = enabled;
  controls.room = enabled ? controls.room || roomGeometry.reset() : null;
  roomPointerActive = false;
  if (persist) writeLocal('mythtrace.room-layer.v1', String(enabled));
  renderWorkflow();
  setStatus(enabled ? 'Room layer · click a corner to lock · Shift-click pins geometry' : 'Room layer off');
}

$('[data-stage-room]').addEventListener('click', () => {
  if (!running) enterSystem();
  setRoomLayer(!controls.roomEnabled);
  if (controls.roomEnabled && !clips.isLocal() && !tracking.getFrame().camera.active && !cameraPending) {
    void enableCamera(preferredCameraDeviceId);
  }
});
$('[data-stage-auto]').addEventListener('click', () => {
  if (!running) enterSystem();
  if (controls.lightScore.auto && !controls.geometryMuted) configureLightScore({ auto: false });
  else applyGeometryPreset('auto');
});

function parsePhrase(value) {
  const fields = value.trim().split(/[ ,]+/);
  return fields.length <= presets.phrase.limit && fields.every(field => /^[1-8]$/.test(field))
    ? fields.map(Number) : null;
}

function renderPhraseInput() {
  $('[data-orchestra-phrase]').value = orchestraPhrase().join(' ');
}

function savePhrase(notes) {
  if (storyVersions.get(currentStory()).degrees || storyVersions.get(currentStory()).music) storyManualMotifs.add(currentStory());
  if (notes) orchestraPhrases.set(orchestraPreset, [...notes]);
  else orchestraPhrases.delete(orchestraPreset);
  writeLocal('mythtrace.phrases.v1', JSON.stringify(Object.fromEntries(orchestraPhrases)));
}

function endPhraseCapture() {
  phraseCapture = false;
  const button = $('[data-orchestra-record]');
  button.setAttribute('aria-pressed', 'false');
  button.textContent = 'Record gestures';
}

function retainGestureNote(degree, time) {
  if (controls.paused || !running) return;
  if (!orchestra.state().ready && !phraseCapture) return;
  if (gesturePhrase.length === presets.phrase.limit) gesturePhrase.shift();
  gesturePhrase.push(degree);
  lastPhrasePinch = time;
  if (phraseCapture) {
    savePhrase(gesturePhrase);
    renderPhraseInput();
  }
  $('[data-phrase-status]').textContent = 'Pinches · ' + gesturePhrase.join(' ');
}

function updateGesturePhrase(time) {
  if (controls.paused || !phraseAuto || !gesturePhrase.length || !orchestra.state().ready
    || time - lastPhrasePinch < presets.phrase.pauseMs) return;
  const notes = gesturePhrase;
  gesturePhrase = [];
  endPhraseCapture();
  orchestra.playDegrees(notes, orchestraPace, .44);
  $('[data-phrase-status]').textContent = 'Echo · ' + notes.join(' ');
}

function updateSacredPerformance(time, tracking) {
  if (!running || controls.paused || controls.sacredLayer !== 'auto') return;
  const box = overlayCanvas;
  const pins = controls.lightScore.pins;
  if (pins.length && pins.some(pin => pin.anchor)) {
    const anchors = editableLatticeAnchors();
    controls.sacredPins = pins.map(pin => pinPosition(pin, anchors)).filter(Boolean);
  } else controls.sacredPins = pins;
  const features = measuredFaceAnchors(tracking, time, controls.lightScore.sources);
  const handVisible = tracking.hands.some(hand => !hand.stale && hand.palm);
  const eyes = !handVisible && controls.sacredPins.length < 2 && features['eye.l'] && features['eye.r']
    ? [features['eye.l'], features['eye.r']] : null;
  const state = sacredDetector({
    time, hands: tracking.hands, pins: controls.sacredPins, eyes,
    frame: gestureFrameState, aspect: box.width / Math.max(1, box.height), disabled: archivedSacred,
  });
  const notes = presets.sacred.noteDegrees[state.shape];
  const facet = notes ? state.facet % notes.length : 0;
  const previous = controls.sacredLiveShape;
  controls.sacredLiveShape = state.shape;
  controls.sacredFacet = facet;
  if (previous !== state.shape) {
    $('[data-sacred-status]').textContent = notes
      ? 'Gesture · ' + presets.sacred.shapes[state.shape] : 'Gesture · waiting for a formation';
    $('[data-sacred-principle]').textContent = presets.sacred.principles[notes ? state.shape : 'auto'];
  }
  if (!notes) {
    lastSacredCue = '';
    return;
  }
  if (!controls.sacredSound || !controls.sacredStrength || !orchestra.state().ready) return;
  const cue = state.shape + ':' + facet;
  if (cue === lastSacredCue || time - lastSacredNoteAt < 440) return;
  orchestra.playDegrees([notes[facet]], orchestraPace, .35);
  lastSacredCue = cue;
  lastSacredNoteAt = time;
  $('[data-sacred-status]').textContent = 'Gesture · ' + presets.sacred.shapes[state.shape]
    + ' · facet ' + (facet + 1) + ' · degree ' + notes[facet];
}

function describeLook(id) {
  return {
    contour: 'Contour · cool light, a clear face and restrained grain.',
    etching: 'Etching · charcoal grain, copper accents and a long trail.',
    classic: 'V22 · original monochrome Shaper Field settings in the current renderer.',
  }[id] || '';
}

function renderVersionLibrary() {
  const pick = $('[data-version-pick]');
  const selected = pick.value;
  const entries = versionLibrary.list();
  const groups = new Map();
  const options = [];
  for (const item of entries) {
    const option = new Option(item.title + (item.archived ? ' · archived' : ''), item.key);
    if (!item.group) { options.push(option); continue; }
    if (!groups.has(item.group)) {
      const group = document.createElement('optgroup');
      group.label = item.group;
      groups.set(item.group, group);
    }
    groups.get(item.group).append(option);
  }
  pick.replaceChildren(...options, ...groups.values());
  if (entries.some(item => item.key === selected)) pick.value = selected;
  for (const [attribute, kind] of [['shaper-look', 'look'], ['geometry-preset', 'geo'], ['sacred-preset', 'sacred']]) {
    for (const button of stage.querySelectorAll('[data-' + attribute + ']')) {
      button.hidden = versionLibrary.archived(kind + ':' + button.getAttribute('data-' + attribute));
    }
  }
  for (const button of stage.querySelectorAll('[data-story-cue],[data-workflow],[data-demo-template]')) {
    const id = button.dataset.storyCue || button.dataset.workflow || button.dataset.demoTemplate;
    button.hidden = Boolean(versionLibrary.archived('story:' + id) || storyLayersArchived(id));
    if (button.hidden && previewStory === id) closeStory();
  }
  const history = versionLibrary.history().slice(-8).reverse().map(item => {
    const row = document.createElement('li');
    const action = { apply: 'Applied', archive: 'Archive', restore: 'Restored' }[item.action] || 'Version';
    const date = new Date(item.timestamp);
    row.textContent = (Number.isFinite(+date) ? date.toLocaleString() + ' · ' : '') + action + ' · ' + item.label;
    return row;
  });
  $('[data-version-history]').replaceChildren(...history);
  renderVersionSelection();
}

function cueArchived(cue) {
  return (cue.look && versionLibrary.archived('look:' + cue.look))
    || versionLibrary.archived('geo:' + cue.geometry) || versionLibrary.archived('sacred:' + cue.sacred);
}

function storyLayersArchived(id) {
  const cue = storyRecipe(id);
  return cueArchived(cue) || cueArchived({...cue, ...storyVersions.get(id)});
}

function selectedVersion() {
  return versionLibrary.list().find(item => item.key === $('[data-version-pick]').value);
}

function renderVersionSelection() {
  const entry = selectedVersion();
  const note = $('[data-version-note]');
  const dependenciesArchived = entry?.kind === 'story' ? storyLayersArchived(entry.id) : entry?.kind === 'proposal'
    && cueArchived({ look: entry.look, geometry: entry.geo, sacred: entry.sacred });
  $('[data-version-apply]').disabled = !entry || entry.archived || dependenciesArchived;
  const lastLook = entry?.kind === 'look' && !entry.archived
    && versionLibrary.list().filter(item => item.kind === 'look' && !item.archived).length === 1;
  $('[data-version-archive]').disabled = !entry || lastLook;
  $('[data-version-archive]').textContent = entry?.kind === 'story'
    ? (entry.archived ? 'Restore card' : 'Hide card') : (entry?.archived ? 'Restore' : 'Archive');
  note.textContent = entry?.note || (entry?.kind === 'look' ? describeLook(entry.id) : entry?.title || '');
  if (entry?.source) {
    try {
      const url = new URL(entry.source);
      if (url.protocol === 'https:') {
        const link = document.createElement('a');
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = 'Reference ↗';
        note.append(' · ', link);
      }
    } catch {}
  }
  if (dependenciesArchived) note.append(' · Restore the linked patterns first.');
  if (lastLook) note.append(' · Keep at least one look available.');
}

let versionsRefreshing = false;
async function refreshVersions() {
  if (versionsRefreshing) return;
  versionsRefreshing = true;
  try {
    const response = await fetch('./experiment-proposals.json');
    if (!response.ok) throw new Error('research feed unavailable');
    const data = await response.json();
    if (!Array.isArray(data?.proposals)) throw new Error('research feed invalid');
    if (versionLibrary.ingest(data)) renderVersionLibrary();
    const count = versionLibrary.list().filter(item => item.kind === 'proposal' && !item.archived).length;
    const date = new Date(response.headers.get('Last-Modified') || '');
    const stamp = Number.isFinite(+date) ? ' · last changed ' + date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }) : '';
    $('[data-proposal-status]').textContent = `Research feed · ${count} ${count === 1 ? 'proposal' : 'proposals'}${stamp} · preview to apply`;
  } catch {
    $('[data-proposal-status]').textContent = 'Research feed unavailable · keeping the current library';
  } finally { versionsRefreshing = false; }
}

function markPreset(group, active) {
  const attribute = group.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
  for (const button of stage.querySelectorAll(`[data-${attribute}]`)) {
    button.setAttribute('aria-pressed', String(button.dataset[group] === active));
  }
}

function nextPreset(group, active) {
  const keys = Array.isArray(group) ? group : Object.keys(group);
  return keys[(keys.indexOf(active) + 1) % keys.length];
}

function applyGeometryPreset(id, persist = !shaperDemo) {
  if (id === 'off') {
    setGeometryMuted(true, persist);
    setStatus('Geometry off');
    return;
  }
  if (!Object.hasOwn(presets.geometries, id) || versionLibrary.archived('geo:' + id)) return;
  setGeometryMuted(false, persist);
  const { name, note, source, study = '', ...settings } = presets.geometries[id];
  configureLightScore({ ...settings, study, merge: false }, persist);
  setStatus(`Geometry · ${name}`);
}

function setGeometryMuted(muted, persist) {
  controls.geometryMuted = muted;
  syncFocusSurface();
  $('[data-study-guide]').hidden = muted || !controls.lightScore.study;
  $('[data-relief-control]').hidden = muted || controls.lightScore.study !== 'pigment-relief';
  $('[data-relief-tracking]').hidden = $('[data-relief-control]').hidden;
  markPreset('geometryPreset', muted ? 'off' : geometryPreset);
  renderGeometryLayerButtons();
  if (persist) writeLocal('mythtrace.geometry-muted.v1', String(muted));
}

function setSacredLayer(id, strength = controls.sacredStrength, persist = !shaperDemo) {
  if (!Object.hasOwn(presets.sacred.shapes, id) || archivedSacred.includes(id)) return;
  if (controls.sacredLayer !== id) {
    lastSacredCue = '';
    controls.sacredLiveShape = 'off';
    sacredDetector.reset();
  }
  controls.sacredLayer = id;
  $('[data-sacred-principle]').textContent = presets.sacred.principles[id];
  $('[data-sacred-status]').textContent = id !== 'auto' ? presets.sacred.shapes[id]
    : controls.sacredLiveShape === 'off' ? 'Gesture · waiting for a formation' : 'Gesture · ' + presets.sacred.shapes[controls.sacredLiveShape];
  controls.sacredStrength = Number.isFinite(strength) ? clamp(strength) : presets.sacred.strength;
  markPreset('sacredPreset', id);
  $('[data-sacred-strength]').value = String(controls.sacredStrength);
  if (persist) {
    try {
      localStorage.setItem(SACRED_SETTINGS, JSON.stringify({ id, strength: controls.sacredStrength }));
    } catch {}
    setStatus(`Sacred geometry · ${presets.sacred.shapes[id]}`);
  }
}

function matchingFramePreset(settings) {
  return Object.keys(presets.frame).find(id => {
    const { name, ...patch } = presets.frame[id];
    return Object.entries(patch).every(([key, value]) => settings[key] === value);
  }) || '';
}

function applyFramePreset(id) {
  if (!Object.hasOwn(presets.frame, id)) return;
  const { name, ...patch } = presets.frame[id];
  frameConfigurator.configure(patch, !shaperDemo);
  setStatus(`Frame · ${name}`);
}

function toggleHandFrame() {
  if (!running) enterSystem();
  if (!framePerformanceArmed) {
    if (frameConfigurator.getState().mode !== 'object') frameConfigurator.configure(presets.frame.crop);
    if (!tracking.getFrame().camera.active && !cameraPending) void enableCamera();
    setFrameConsole(false);
  }
  setFramePerformance(!framePerformanceArmed);
}

function findShaperLook(settings) {
  return Object.keys(presets.looks).find(id => {
    const { name, ...patch } = presets.looks[id];
    return Object.entries(patch).every(([key, value]) => Math.abs(settings[key] - value) < .00001 || settings[key] === value);
  }) || '';
}

function applyShaperLook(id, persist = true) {
  if (!Object.hasOwn(presets.looks, id) || versionLibrary.archived('look:' + id)) return;
  const { name, ...patch } = presets.looks[id];
  if (controls.mode !== 3) setMode(3);
  if (persist) sceneConfigurator.configure(3, patch);
  else applySceneSettings({ ...patch, preset: 'custom' }, 3);
  setStatus(name);
}

function selectOrchestraPreset(id) {
  if (!Object.hasOwn(presets.music, id)) return;
  const { name } = presets.music[id];
  orchestraPreset = id;
  applyOrchestraSettings();
  gesturePhrase = [];
  lastPhrasePinch = -Infinity;
  endPhraseCapture();
  renderPhraseInput();
  persistOrchestraSettings();
  stageMusicSource = 'orchestra';
  renderMusicTransport();
  setStatus(`Orchestra · ${name}`);
}

function applyPerformanceCue(id) {
  if (!Object.hasOwn(presets.cues, id)) return;
  const cue = presets.cues[id];
  if (cueArchived(cue) || cueArchived(storySettings(id))) return;
  stopShaperDemo();
  workflow = 'face';
  workflowCue = id;
  storyManualMotifs.delete(id);
  writeLocal(workflowPreference, id);
  if (!running) enterSystem();
  if (cue.look) applyShaperLook(cue.look);
  else setMode(cue.mode);
  applyGeometryPreset(cue.geometry);
  configureLightScore({strength:cue.strength});
  setSacredLayer(cue.sacred);
  selectOrchestraPreset(cue.music);
  applyFramePreset(cue.frame);
  applyStoryVariantParameters(id, {}, storyVersions.get(id));
  writeLocal(modePreference, String(controls.mode));
  renderWorkflow();
  setStatus(`Scene · ${cue.name}`);
}

function cycleGeometryPreset() {
  const keys = ['off', ...Object.keys(presets.geometries).filter(id => !versionLibrary.archived('geo:' + id))];
  applyGeometryPreset(nextPreset(keys, controls.geometryMuted ? 'off' : geometryPreset));
}
function cycleOrchestraPreset() { selectOrchestraPreset(nextPreset(presets.music, orchestraPreset)); }
function cycleFramePreset() { applyFramePreset(nextPreset(presets.frame, matchingFramePreset(frameConfigurator.getState()))); }

stage.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  const data = button.dataset;
  if (data.geometryPreset) applyGeometryPreset(data.geometryPreset);
  if (Object.hasOwn(presets.geometryIntensity, data.geometryIntensity)) {
    configureLightScore({ strength: presets.geometryIntensity[data.geometryIntensity] });
  }
  if (data.sacredPreset) setSacredLayer(data.sacredPreset);
  if (data.framePreset) applyFramePreset(data.framePreset);
  if (data.shaperLook) {
    applyShaperLook(data.shaperLook);
    versionLibrary.remember('apply', presets.looks[data.shaperLook].name);
    renderVersionLibrary();
  }
  if (data.orchestraPreset) selectOrchestraPreset(data.orchestraPreset);
});
$('[data-sacred-sound]').setAttribute('aria-pressed', String(controls.sacredSound));
$('[data-sacred-sound]').addEventListener('click', event => {
  controls.sacredSound = !controls.sacredSound;
  event.currentTarget.setAttribute('aria-pressed', String(controls.sacredSound));
  writeLocal('mythtrace.sacred-sound.v1', String(controls.sacredSound));
});
$('[data-version-pick]').addEventListener('change', renderVersionSelection);
$('[data-version-apply]').addEventListener('click', () => {
  const entry = selectedVersion();
  if (!entry || $('[data-version-apply]').disabled) return;
  if (entry.kind === 'story') {
    setSceneConsole(false);
    openStoryLink(entry.id);
    return;
  }
  if (entry.kind === 'look') applyShaperLook(entry.id);
  if (entry.kind === 'geo') applyGeometryPreset(entry.id);
  if (entry.kind === 'sacred') setSacredLayer(entry.id);
  if (entry.kind === 'proposal') {
    applyShaperLook(entry.look);
    applyGeometryPreset(entry.geo);
    setSacredLayer(entry.sacred);
  }
  versionLibrary.remember('apply', entry.title);
  renderVersionLibrary();
});
$('[data-version-archive]').addEventListener('click', () => {
  const entry = selectedVersion();
  if (!entry || $('[data-version-archive]').disabled) return;
  versionLibrary.setArchived(entry.key, !entry.archived);
  archivedSacred = Object.keys(presets.sacred.shapes).filter(id => versionLibrary.archived('sacred:' + id));
  if (!entry.archived && entry.kind === 'geo' && entry.id === geometryPreset) applyGeometryPreset('off');
  if (!entry.archived && entry.kind === 'sacred' && entry.id === controls.sacredLayer) setSacredLayer('off');
  if (!entry.archived && entry.kind === 'look' && entry.id === findShaperLook(controls.scene || {})) {
    const replacement = Object.keys(presets.looks).find(id => !versionLibrary.archived('look:' + id));
    if (replacement) applyShaperLook(replacement);
  }
  renderVersionLibrary();
});
$('#version-library').addEventListener('toggle', event => { if (event.currentTarget.open) void refreshVersions(); });
void refreshVersions();
setInterval(() => { if (!document.hidden) void refreshVersions(); }, CONFIG.liveReload.proposalIntervalMs);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshVersions(); });

$('[data-sacred-strength]').addEventListener('input', event => {
  setSacredLayer(controls.sacredLayer, Number(event.target.value));
});

function applyWorkflowSettings(next, previous) {
  const recipe = presets.workflows[next];
  storyManualMotifs.delete(next);
  applyShaperLook(recipe.look);
  applyGeometryPreset(recipe.geometry);
  configureLightScore({strength:recipe.strength});
  setSacredLayer(recipe.sacred);
  applyFramePreset(recipe.frame);
  if (recipe.material) setGloveMaterial(recipe.material);
  if (orchestraPreset !== recipe.music) selectOrchestraPreset(recipe.music);
  else if (arrangementId(next) || arrangementId(previous) || hasStoryMusicVariant(storyVersions.get(previous))) applyOrchestraSettings();
  applyStoryVariantParameters(next, {}, storyVersions.get(next));
  renderPhraseInput();
}

function performStory(next) {
  if (cueArchived(storyRecipe(next)) || cueArchived(storySettings(next))) { setStatus('Restore this template in Visual → Versions'); return; }
  if (presets.cues[next]) { applyPerformanceCue(next); return; }
  if (!presets.workflows[next]) { toggleShaperDemo(next); return; }
  stopShaperDemo();
  const previous = currentStory();
  workflow = next;
  workflowCue = '';
  writeLocal(workflowPreference, next);
  if (!running) enterSystem();
  applyWorkflowSettings(next, previous);
  writeLocal(modePreference, String(controls.mode));
  if (next === 'kosmodrom') {
    closeInstrumentPanels();
    closeSetupPanel();
    setStatus('Night Relay · arm pads to add a transmission');
  } else if (next === 'focus') {
    closeInstrumentPanels();
    closeSetupPanel();
    controls.pointer.focusActive = false;
    setStatus('Point Lattice · move the pointer to turn · choose Plane or Crystal');
  } else if (next === 'objects' || next === 'hands') {
    closeInstrumentPanels();
    closeSetupPanel();
    if (next === 'objects') setLiveObjects(true);
    if (!controls.clipActive && !tracking.getFrame().camera.active && !cameraPending) {
      void enableCamera(preferredCameraDeviceId);
    }
  } else if (next === 'air') {
    setMusicConsole(true);
    if (!atmosphere.active()) toggleAtmosphere();
  } else if (next === 'voice') {
    setMusicConsole(true);
    if (!presence.enabled && !presence.starting) void togglePresence();
  } else if (next === 'score') {
    setMusicConsole(true);
    $('#music-wagner').open = true;
    musicPanel.querySelector('#wagner-score')?.scrollIntoView({ block: 'nearest' });
    if (previous !== 'score' && !wagnerScore.state.playing && !wagnerScore.state.pending) {
      stageMusicSource = 'tristan';
      void wagnerScore.resume().catch(error => setStatus(`Wagner · ${error.message}`));
    }
  } else {
    closeInstrumentPanels();
    closeSetupPanel();
    if (!controls.clipActive && !tracking.getFrame().camera.active && !cameraPending) {
      void enableCamera(preferredCameraDeviceId);
    }
  }
  syncPanelButtons();
  renderWorkflow();
  if (arrangementId(next) === 'hands') {
    const route = latestEntitySettings?.settings?.hands;
    entityConsole.configureSource('hands', {enabled:true, sound:route?.sound || CONFIG.handInstrument.route});
  }
  if (arrangementId(next)) startStageArrangement();
}

const storyAudition = createGuestPart(samplerSession, () => {}, state => {
  const playing = state === 'playing';
  const button = $('[data-story-hear]');
  button.setAttribute('aria-pressed', String(playing));
  button.textContent = playing ? 'Stop motif' : 'Hear motif';
});

function hasStoryMusicVariant(variant) {
  return ['music', 'key', 'level'].some(key => Object.hasOwn(variant, key));
}

function applyStoryVariantParameters(id, previous, variant) {
  if (!Object.keys(previous).length && !Object.keys(variant).length) return;
  const before = storySettings(id, previous), after = storySettings(id, variant);
  const changes = new Set(storyChanges(before, after));
  if (changes.has('degrees') || changes.has('music')) storyManualMotifs.delete(id);
  if (changes.has('look')) {
    if (after.look) {
      applyShaperLook(after.look, !shaperDemo);
      if (shaperDemo && !variant.look && after.scene) {
        const { name, ...look } = presets.looks[after.look];
        applySceneSettings({ ...look, ...after.scene, preset: 'custom' }, 3);
      }
    } else setMode(after.mode);
    if (!shaperDemo) writeLocal(modePreference, String(controls.mode));
  }
  if (changes.has('geometry')) applyGeometryPreset(after.geometry);
  const light = {};
  for (const key of ['palette', 'strength', 'attack']) {
    if (changes.has(key) || (changes.has('geometry') && Object.hasOwn(variant, key))) light[key] = after[key];
  }
  if (Object.keys(light).length) configureLightScore(light);
  if (changes.has('sacred') || changes.has('sacredStrength')) {
    setSacredLayer(changes.has('sacred') ? after.sacred : controls.sacredLayer,
      changes.has('sacredStrength') ? after.sacredStrength : controls.sacredStrength);
  }
  if (['music', 'key', 'level'].some(key => changes.has(key))) {
    if (shaperDemo) {
      const timbre = $('[data-score-timbre]');
      if (changes.has('music')) timbre.value = after.music;
      demoOrchestra.configure({ ...presets.music[timbre.value], key: after.key, level: after.level });
      if (changes.has('key')) demoBand.setBaseKey(after.key);
    } else {
      if (changes.has('music')) orchestraPreset = after.music;
      applyOrchestraSettings({
        key: changes.has('key') ? after.key : orchestraKey.value,
        level: changes.has('level') ? after.level : Number(orchestraLevel.value),
      });
      renderMusicTransport();
    }
  }
  if (!shaperDemo) renderPhraseInput();
  lastRecipeReadout = -Infinity;
}

const storyEditor = $('[data-story-editor]');
const storyDirection = $('#story-direction');
const storyPropose = $('[data-story-propose]');
const storyUse = $('[data-story-use]');
const storyRestore = $('[data-story-restore]');
const storyVariantStatus = $('[data-story-variant-status]');
let storyProposal = null;
let storyEditorRequest = 0;

function setStoryVariantStatus(message = '') {
  storyVariantStatus.textContent = message;
  storyVariantStatus.hidden = !message;
}

function setStoryRows(element, rows) {
  element.replaceChildren();
  for (const [label, value] of rows) {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    if (label === 'On stage') dd.dataset.storyLive = '';
    element.append(dt, dd);
  }
}

const storyParameterLabels = { look: 'Look', geometry: 'Geometry', strength: 'Weight', palette: 'Geometry color', attack: 'Attack',
  sacred: 'Sacred', sacredStrength: 'Sacred level', music: 'Timbre', key: 'Key', level: 'Orchestra level', degrees: 'Motif' };

function storyValue(settings, key) {
  if (key === 'look') return presets.looks[settings.look]?.name || MODES[settings.mode].name;
  if (key === 'geometry') return presets.geometries[settings.geometry]?.name || 'Off';
  if (key === 'sacred') return presets.sacred.shapes[settings.sacred];
  if (key === 'music') return presets.music[settings.music].name;
  if (key === 'key') return storyKeyName(settings.key);
  if (key === 'degrees') return settings.degrees.join(' ');
  if (typeof settings[key] === 'number') return Math.round(settings[key] * 100) + '%';
  return settings[key];
}

function renderStoryEditor() {
  const stored = storyVersions.get(previewStory);
  const subtitle = storyEditor.querySelector('summary');
  storyRestore.hidden = !Object.keys(stored).length;
  subtitle.textContent = storyRestore.hidden ? 'Adapt with SOTNIK' : 'Adapt with SOTNIK · local variant';
  const diff = $('[data-story-changes]');
  const rows = storyProposal?.rows || [];
  diff.hidden = !rows.length;
  setStoryRows(diff, rows);
  storyUse.hidden = !rows.length;
  storyUse.textContent = previewStory === currentStory() ? 'Apply variant' : 'Save variant';
}

function closeGestureFilm() {
  if (gestureFilm.hasAttribute('src')) {
    gestureFilm.pause();
    gestureFilm.removeAttribute('src');
    gestureFilm.load();
  }
  gestureFilm.hidden = true;
  storyPanel.classList.remove('show-gesture');
  watchGesture.textContent = previewStory === 'pigment' ? 'Watch gesture' : 'Watch take';
  watchGesture.setAttribute('aria-expanded', 'false');
}

watchGesture.addEventListener('click', () => {
  const story = presets.stories[previewStory];
  const film = story?.gestureFilm;
  if (!film) return;
  if (!gestureFilm.hidden) { closeGestureFilm(); return; }
  gestureFilm.setAttribute('aria-label', story.name + ' · performance excerpt');
  gestureFilm.src = film;
  gestureFilm.muted = true;
  gestureFilm.hidden = false;
  storyPanel.classList.add('show-gesture');
  watchGesture.textContent = 'Close film';
  watchGesture.setAttribute('aria-expanded', 'true');
  void gestureFilm.play().catch(error => {
    if (error.name === 'AbortError' || gestureFilm.hidden) return;
    if (gestureFilm.error) {
      closeGestureFilm();
      setStatus('Film unavailable · use the move shown on the card');
    }
  });
});

function closeStory(restoreFocus = false) {
  closeGestureFilm();
  auditionArrangement.stop();
  sectorDeck.stop('preview');
  storyPractice.close();
  const opener = storyOpener;
  storyOpener = null;
  opener?.setAttribute('aria-expanded', 'false');
  storyAudition.stop();
  storyPanel.hidden = true;
  previewStory = '';
  storyPlanner.cancel();
  storyEditorRequest++;
  storyProposal = null;
  storyEditor.open = false;
  storyDirection.value = '';
  storyPropose.disabled = false;
  storyRestore.disabled = false;
  setStoryVariantStatus();
  if (restoreFocus && opener) (opener.getClientRects().length ? opener : cardDeck).focus({preventScroll:true});
}

function storySound(id) {
  const recipe = storySettings(id);
  return {key: recipe.key, degrees: recipe.degrees, preset: recipe.music, level: .25, bars: 1};
}

function arrangementPreview(id, recipe = storySettings(id)) {
  const timbre = recipe.music;
  const profile = storyRecipe(id).music === timbre ? CONFIG.sceneArrangements[arrangementId(id)].profile : {};
  const defaults = {...presets.music[timbre], ...profile};
  const custom = orchestraProfiles.get(timbre) || {};
  for (const key of ['color', 'bed', 'attack', 'pace']) {
    if (Number.isFinite(custom[key])) defaults[key] = custom[key];
  }
  return {...defaults, key: recipe.key, degrees: recipe.degrees, level: recipe.level, timbre};
}

function renderStoryDetails(id) {
  const score = CONFIG.sceneArrangements[arrangementId(id)];
  if (!auditionArrangement.id && !storyAudition.active()) $('[data-story-hear]').textContent = score ? 'Hear arrangement' : 'Hear motif';
  $('[data-sector-preview]').hidden = id !== 'kosmodrom';
  const recipe = storySettings(id), story = presets.stories[id];
  const archived = storyLayersArchived(id);
  $('[data-story-input]').textContent = archived ? 'Restore the archived layer in Visual → Versions to play this scene.' : story.input;
  $('[data-story-apply]').disabled = Boolean(archived);
  const variant = storyVersions.get(id);
  const geometry = [storyValue(recipe, 'geometry')];
  if (recipe.geometry !== 'off') geometry.push(storyValue(recipe, 'strength'));
  if (recipe.geometry === 'pigment-relief') geometry.push('depth ' + Math.round(presets.geometries[recipe.geometry].reliefDepth * 100) + '%');
  if (variant.palette) geometry.push(storyValue(recipe, 'palette'));
  if (variant.attack !== undefined) geometry.push('attack ' + storyValue(recipe, 'attack'));
  const sacred = [storyValue(recipe, 'sacred')];
  if (variant.sacredStrength !== undefined) sacred.push(storyValue(recipe, 'sacredStrength'));
  const music = [storyValue(recipe, 'music'), storyValue(recipe, 'key')];
  if (variant.level !== undefined) music.push(storyValue(recipe, 'level'));
  const rows = [
    ['Look', storyValue(recipe, 'look')], ['Geometry', geometry.join(' · ')],
    ['Frame', presets.frame[recipe.frame].name + (recipe.material ? ' · ' + recipe.material : '')],
    ['Sacred', sacred.join(' · ')], ['Music', music.join(' · ')], ['Motif', storyValue(recipe, 'degrees')],
    ...(score ? [['Score', score.title + ' · ' + Math.round(arrangementTempo(score, arrangementPreview(id, recipe).pace)) + ' BPM · 8 bars'], ['Parts', score.parts]] : []),
    ['On stage', $('[data-linked-recipe]').textContent],
  ];
  setStoryRows($('[data-story-settings]'), rows);
  renderStoryEditor();
}

function previewTemplate(button) {
  closeStory();
  const id = button.dataset.workflow || button.dataset.demoTemplate || button.dataset.storyCue;
  previewStory = id;
  const story = presets.stories[id];
  $('#story-title').textContent = story.name;
  $('[data-story-move]').textContent = story.move;
  $('[data-story-line]').textContent = story.line;
  $('[data-story-rule]').textContent = story.rule;
  storyPanel.querySelector('.story-recipe').open = false;
  const image = $('[data-story-image]');
  image.src = button.querySelector('img')?.src || './assets/story-' + id + '.jpg';
  image.alt = story.name + ' on the dance take';
  watchGesture.hidden = !story.gestureFilm;
  watchGesture.textContent = id === 'pigment' ? 'Watch gesture' : 'Watch take';
  renderStoryDetails(id);
  $('[data-story-apply]').textContent = button.dataset.demoTemplate ? 'Play score' : 'Apply scene';
  storyOpener = button;
  button.setAttribute('aria-expanded','true');
  storyPanel.hidden = false;
  updateCardState();
  storyPractice.open(id, controls.focusGeometry);
  $('[data-story-apply]').focus({preventScroll:true});
}

function updateCardState() {
  if (!previewStory) return;
  const live = currentStory();
  const label = live === previewStory ? 'On stage' : 'Preview · on stage: ' + presets.stories[live].name;
  const state = $('[data-card-state]');
  if (state.textContent !== label) state.textContent = label;
}

function showCardDeck(deck) {
  cardDeck.value = deck;
  for (const group of workflowRail.querySelectorAll('[data-card-set]')) group.hidden = group.dataset.cardSet !== deck;
}
cardDeck.addEventListener('change', () => { closeStory(); showCardDeck(cardDeck.value); });
memoryCard.addEventListener('click', () => { setSceneConsole(false); previewTemplate(memoryCard); });
workflowRail.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.getAttribute('aria-expanded') === 'true') closeStory(true);
  else previewTemplate(button);
});
$('[data-story-hide]').addEventListener('click', () => {
  if (!previewStory) return;
  versionLibrary.setArchived('story:' + previewStory, true);
  renderVersionLibrary();
  cardDeck.focus({preventScroll:true});
  setStatus('Card hidden · restore in Visual → Versions and experiments');
});
$('[data-story-close]').addEventListener('click', () => closeStory(true));
$('[data-story-apply]').addEventListener('click', () => {
  const id = previewStory;
  if (id === 'focus' && !storyPanel.querySelector('[data-story-practice]').hidden) {
    controls.focusGeometry = storyPractice.focusMode();
    try { localStorage.setItem(FOCUS_PREF, JSON.stringify({geometry:controls.focusGeometry,camera:controls.focusCamera})); } catch {}
  }
  closeStory(true);
  if (id) performStory(id);
});
$('[data-story-hear]').addEventListener('click', () => {
  const id = previewStory;
  if (auditionArrangement.id) { auditionArrangement.stop(); return; }
  const score = arrangementId(id);
  if (score) {
    const params = arrangementPreview(id);
    void auditionArrangement.start(score, () => params, {bars:2, onError: message => setStatus(message)});
    return;
  }
  if (storyAudition.active()) storyAudition.stop();
  else if (id) void storyAudition.play(storySound(id), presets.stories[id].bpm, () => previewStory === id)
    .catch(error => setStatus('Motif · ' + error.message));
});

$('[data-story-direction]').addEventListener('submit', async event => {
  event.preventDefault();
  const id = previewStory, text = storyDirection.value.trim().slice(0, CONFIG.storyVariants.directionLimit);
  if (!id || !text || storyPropose.disabled) return;
  const request = ++storyEditorRequest;
  const before = storySettings(id);
  storyPropose.disabled = true;
  storyRestore.disabled = true;
  storyProposal = null;
  renderStoryEditor();
  setStoryVariantStatus('SOTNIK · VM105 · preparing a variant…');
  const percent = value => Math.round(value * 100);
  try {
    const result = await storyPlanner.propose(text, {
      story: presets.stories[id].name, mode: before.look ? 3 : before.mode, look: before.look || '',
      geometry: before.geometry, palette: before.palette, strength: percent(before.strength), attack: percent(before.attack),
      sacred: before.sacred, sacredStrength: percent(before.sacredStrength), musicPreset: before.music, key: before.key,
      level: percent(before.level), motif: before.degrees.join(' '), tempo: presets.stories[id].bpm, frame: before.frame,
    }, storyVersions.get(id));
    if (!result || request !== storyEditorRequest) return;
    for (const key of Object.keys(result.variant)) {
      const { [key]: value, ...remaining } = result.variant;
      if (!storyChanges(storySettings(id, result.variant), storySettings(id, remaining)).length) delete result.variant[key];
    }
    const after = storySettings(id, result.variant);
    if (cueArchived(after)) throw new Error('A proposed layer is archived · restore it in Visual → Versions first');
    const rows = storyChanges(before, after).map(key => [storyParameterLabels[key], `${storyValue(before, key)} → ${storyValue(after, key)}`]);
    storyProposal = { id, variant: result.variant, rows };
    setStoryVariantStatus(rows.length ? result.cue : `${result.cue} · No parameter changes`);
    renderStoryEditor();
  } catch (error) {
    if (request === storyEditorRequest) setStoryVariantStatus(error.message);
  } finally {
    if (request === storyEditorRequest) {
      storyPropose.disabled = false;
      storyRestore.disabled = false;
    }
  }
});

function commitStoryVariant(id, variant) {
  if (!id || cueArchived(storySettings(id, variant))) {
    setStoryVariantStatus('Restore the archived layer in Visual → Versions first');
    return;
  }
  const previous = storyVersions.get(id);
  const saved = storyVersions.save(id, variant);
  const active = currentStory() === id;
  if (active) applyStoryVariantParameters(id, previous, variant);
  storyProposal = null;
  const restoring = !Object.keys(variant).length;
  setStoryVariantStatus(!saved ? 'Browser storage unavailable · change is session-only'
    : restoring ? 'Original template restored' : active ? 'Variant applied · saved on this browser' : 'Variant saved for this template');
  renderStoryDetails(id);
}

storyUse.addEventListener('click', () => {
  if (storyProposal?.id !== previewStory || !storyProposal.rows.length) return;
  commitStoryVariant(previewStory, storyProposal.variant);
});
storyRestore.addEventListener('click', () => commitStoryVariant(previewStory, {}));
document.addEventListener('pointerdown', event => {
  if (previewStory && !storyPanel.contains(event.target) && !workflowRail.contains(event.target)) closeStory();
}, true);
controlsBar.addEventListener('click', handleRailControl);
setupPanel.addEventListener('click', handleRailControl);
setupPanel.querySelector('[data-setup-close]').addEventListener('click', () => setSetupConsole(false));

function restorePanel(name) {
  if (name === 'clips') { setSetupConsole(true); backgroundSettings.open = true; return; }
  if (name === 'frame') setFrameConsole(true);
  else if (name === 'capture') setCaptureConsole(true);
  else if (name === 'geometry' || name === 'shader') setPatchConsole(true);
  else if (name === 'music') setMusicConsole(true);
  else if (name === 'look') setSceneConsole(true);
  else if (name === 'setup') setSetupConsole(true);
}

help.addEventListener('change', (event) => {
  const input = event.target.closest?.('[data-stage-receipt]');
  if (!input) return;
  clearReleaseFreeze();
  stageReceipt.buildStamp = '';
  stageReceipt[input.dataset.stageReceipt] = Boolean(input.checked);
  persistStageReceipt();
});

stageReceiptClear?.addEventListener('click', () => {
  clearReleaseFreeze();
  stageReceipt = { timestamp: 0, buildStamp: '' };
  try { globalThis.localStorage?.removeItem(STAGE_RECEIPT_KEY); } catch { /* session state already reset */ }
  renderStageReceipt();
  setStatus('room receipt cleared locally');
});

releaseBind?.addEventListener('click', bindStageReceiptToBuild);
releaseFreeze?.addEventListener('click', freezeCurrentRelease);
releaseClear?.addEventListener('click', () => {
  clearReleaseFreeze();
  renderReleaseGate();
  setStatus('release freeze cleared · room receipt retained');
});

venueProfileSave?.addEventListener('click', saveVenueProfile);
venueProfileApply?.addEventListener('click', applyVenueProfile);
venueProfileClear?.addEventListener('click', clearVenueProfile);
accessibilityButtons.forEach((button) => button.addEventListener('click', () => toggleAccessibilitySetting(button.dataset.accessibilitySetting)));

function connectLiveReload() {
  if (!('EventSource' in window)) return;
  liveReloadSource = new EventSource(CONFIG.liveReload.eventPath);
  liveReloadSource.addEventListener('reload', (event) => queueBuildUpdate(event.data));
  liveReloadSource.addEventListener('open', () => document.documentElement.dataset.server = 'live');
  liveReloadSource.addEventListener('error', () => document.documentElement.dataset.server = 'quiet');
}

function connectLiveCues({ preview = false } = {}) {
  const button = patchPanel.querySelector('[data-live-cues]');
  const status = patchPanel.querySelector('[data-live-cue-state]');
  let checking = false;
  let enabled = !preview;
  let version = '';
  let edition = 0;
  let notice = '';
  try {
    enabled = !preview && localStorage.getItem('mythtrace.live-cues.enabled') !== 'off';
    version = preview ? '' : localStorage.getItem('mythtrace.live-cues.version') || '';
    if (!preview) edition = Number(localStorage.getItem('mythtrace.live-cues.edition')) || 0;
  } catch {}
  const show = () => {
    button.setAttribute('aria-pressed', String(enabled));
    status.textContent = enabled ? notice || (version ? `live · ${version}` : 'listening') : 'hold · manual control';
  };
  const pull = async () => {
    if (!enabled || checking) return;
    checking = true;
    try {
      const response = await fetch(CONFIG.liveReload.cuePath, { cache: 'no-store', signal: AbortSignal.timeout(3500) });
      if (!response.ok) return;
      const cue = await response.json();
      if (!enabled || !cue || typeof cue !== 'object') return;
      const isBuild = Object.hasOwn(cue, 'edition') || Object.hasOwn(cue, 'target');
      if (isBuild) {
        const decision = cueBuildDecision(cue, {scene:currentStory(), lastEdition:edition,
          busy:captureInProgress() || performanceRecorder?.getState?.().persistenceFailed});
        const label = presets.stories[cue.target]?.name;
        notice = decision === 'pending' ? label + ' · build ' + cue.edition + ' held until the take is saved'
          : decision === 'elsewhere' ? 'Build ' + cue.edition + ' for ' + label + ' · waiting for scene'
          : decision === 'invalid' ? 'Invalid scene build · previous settings retained' : '';
        show();
        if (decision !== 'apply') return;
      } else {
        notice = '';
        show();
        if (shaperDemo || cue.version === version) return;
      }
      const patch = liveCuePatch(cue, controls.lightScore);
      if (patch === null) return;
      if (Object.keys(patch).length) configureLightScore(patch, !preview && !shaperDemo);
      liveLab.applyCue(cue.lab);
      if (cue.atmosphere && typeof cue.atmosphere === 'object') {
        for (const input of atmosphereSettingInputs) {
          const key = input.dataset.atmosphereSetting;
          if (!Number.isFinite(cue.atmosphere[key])) continue;
          atmosphereSettings[key] = clamp(cue.atmosphere[key]);
          input.value = String(atmosphereSettings[key]);
        }
        try { localStorage.setItem('mythtrace.atmosphere.v1', JSON.stringify(atmosphereSettings)); } catch {}
      }
      version = cue.version;
      if (isBuild) edition = cue.edition;
      try {
        if (!preview) {
          localStorage.setItem('mythtrace.live-cues.version', version);
          if (isBuild) localStorage.setItem('mythtrace.live-cues.edition', String(edition));
        }
      } catch {}
      show();
    } catch { /* local cue feed is optional; hold the current scene */ }
    finally { checking = false; }
  };
  button.addEventListener('click', () => {
    enabled = !enabled;
    try { if (!preview) localStorage.setItem('mythtrace.live-cues.enabled', enabled ? 'on' : 'off'); } catch {}
    show();
    if (enabled) void pull();
  });
  show();
  void pull();
  setInterval(() => { void pull(); }, CONFIG.liveReload.cueIntervalMs);
}

const restoredPerformance = restorePerformanceState();
if (restoredPerformance?.sectorSample != null && CONFIG.kosmodrom.slots[restoredPerformance.sectorSample]) {
  sectorSelect.value = String(restoredPerformance.sectorSample);
  sectorDeck.select(Number(sectorSelect.value));
}
if (Number.isFinite(restoredPerformance?.sectorLevel)) {
  const level = clamp(restoredPerformance.sectorLevel);
  $('[data-sector-level]').value = String(level);
  sectorDeck.setLevel(level);
}
const freshStage = !restoredPerformance && !readLocal(CONFIG.lightScore.storageKey) &&
  !readLocal(CONFIG.sceneConfigurator.storageKey) && !readLocal(ORCHESTRA_SETTINGS) && !readLocal(CONFIG.frameContent.storageKey);
if (['air','focus','bass'].includes(restoredPerformance?.airProfile)) airProfile = restoredPerformance.airProfile;
for (const input of document.querySelectorAll('[data-bass-control]')) {
  const value = restoredPerformance?.bassDeck?.[input.dataset.bassControl];
  if (Number.isFinite(value)) { input.value = String(value); input.dispatchEvent(new Event('input')); }
}
const shaperPreview = new URLSearchParams(location.search).get('shaper');
try {
  if (localStorage.getItem('mythtrace.shaper-contrast.v1') !== '1') {
    const settings = sceneConfigurator.getModeSettings(3);
    if ((!readLocal(CONFIG.sceneConfigurator.storageKey) && !restoredPerformance?.sceneOverride)
      || settings?.preset === 'midnight' || settings?.palette === 'noon') {
      const { name, ...patch } = presets.looks.contour;
      sceneConfigurator.configure(3, patch);
    }
    localStorage.setItem('mythtrace.shaper-contrast.v1', '1');
  }
} catch {}
if (focusChoices.includes(restoredPerformance?.focusGeometry)) controls.focusGeometry = restoredPerformance.focusGeometry;
stage.style.setProperty('--focus-shader-opacity', CONFIG.focusField.shaderOpacity);
try {
  let stored = restoredPerformance?.geometry || JSON.parse(localStorage.getItem(CONFIG.lightScore.storageKey));
  const migrateFaceLinks = localStorage.getItem('mythtrace.face-links.v1') !== '1';
  if (migrateFaceLinks) stored = { ...stored, sources: { ...stored?.sources, eyes: true } };
  if (localStorage.getItem('mythtrace.trace-defaults') !== '1') {
    configureLightScore({ ...stored, auto: true, palette: 'trace', harmony: 'solo' });
    const memory = sceneConfigurator.getModeSettings(4);
    if (memory?.palette === 'midnight') sceneConfigurator.configure(4, { palette: 'trace' });
    localStorage.setItem('mythtrace.trace-defaults', '1');
  } else configureLightScore(stored, migrateFaceLinks);
  if (migrateFaceLinks) localStorage.setItem('mythtrace.face-links.v1', '1');
  if (versionLibrary.archived('geo:' + geometryPreset)) setGeometryMuted(true, false);
} catch { /* current defaults remain usable when browser storage is unavailable */ }
try {
  const saved = JSON.parse(localStorage.getItem(MUSIC_SETTINGS_KEY) || 'null');
  if (saved) music.update(Object.fromEntries(musicSettingFields.map(key => [key, saved[key]])));
} catch { /* use the instrument defaults */ }
let savedCamera = '', focusOptions;
try {
  savedCamera = localStorage.getItem(CAMERA_PREF) || '';
  focusOptions = JSON.parse(localStorage.getItem(FOCUS_PREF));
} catch {}
setGloveMaterial(readLocal('mythtrace.glove-material.v1') || 'composite', false);
preferredCameraDeviceId = String(restoredPerformance?.cameraDeviceId ?? savedCamera);
controls.focusCamera = focusOptions?.camera !== false;
if (focusChoices.includes(focusOptions?.geometry)) controls.focusGeometry = focusOptions.geometry;
const savedWorkflow = restoredPerformance?.story ?? restoredPerformance?.workflow ?? readLocal(workflowPreference);
if (Object.hasOwn(presets.cues, savedWorkflow)) workflowCue = savedWorkflow;
else if (Object.hasOwn(presets.workflows, savedWorkflow)) workflow = savedWorkflow;
if (workflow === 'focus' && !readLocal('mythtrace.point-lattice.v1') && !controls.lightScore.study) {
  configureLightScore({study:'point-lattice'});
}
writeLocal('mythtrace.point-lattice.v1', '1');
if (typeof restoredPerformance?.roomEnabled === 'boolean') controls.roomEnabled = restoredPerformance.roomEnabled;
if (restoredPerformance?.workflow === 'room') controls.roomEnabled = true;
renderWorkflow();
preferredMicDeviceId = String(restoredPerformance?.micDeviceId || '');
if (['tristan', 'atmosphere', 'hands', 'orchestra'].includes(restoredPerformance?.stageMusicSource)) stageMusicSource = restoredPerformance.stageMusicSource;
try {
  const saved = JSON.parse(localStorage.getItem(ORCHESTRA_SETTINGS) || '{}') || {};
  if (Object.hasOwn(presets.music, saved.preset)) orchestraPreset = saved.preset;
  for (const id of Object.keys(presets.music)) {
    if (saved.profiles?.[id]) orchestraProfiles.set(id, saved.profiles[id]);
  }
  if (!orchestraProfiles.has(orchestraPreset) && saved.preset === orchestraPreset) {
    const { key, level, color, bed, attack, pace } = saved;
    orchestraProfiles.set(orchestraPreset, { key, level, color, bed, attack, pace });
  }
} catch {}
applyOrchestraSettings();
try {
  const saved = restoredPerformance?.sacred || JSON.parse(localStorage.getItem(SACRED_SETTINGS) || '{}');
  const id = saved?.id || 'auto';
  setSacredLayer(archivedSacred.includes(id) ? 'off' : id, saved?.strength, false);
} catch { setSacredLayer('auto', presets.sacred.strength, false); }
function applyOrchestraSettings(override = {}) {
  const template = presets.music[orchestraPreset];
  const scoreProfile = storyRecipe(currentStory())?.music === orchestraPreset && CONFIG.sceneArrangements[arrangementId()]?.profile;
  const profile = { ...scoreProfile, ...orchestraProfiles.get(orchestraPreset), ...override };
  orchestraKey.value = [...orchestraKey.options].some(option => option.value === profile.key) ? profile.key : template.key;
  const settings = { key: orchestraKey.value };
  for (const [key, input] of Object.entries(orchestraControls)) {
    const fallback = template[key] ?? .55;
    settings[key] = Number.isFinite(profile[key]) ? clamp(profile[key], Number(input.min), Number(input.max)) : fallback;
    input.value = String(settings[key]);
    const output = musicPanel.querySelector(`[data-orchestra-value="${key}"]`);
    output.textContent = key === 'pace' ? `${settings[key].toFixed(2)} s`
      : key === 'attack' ? `${Math.round(settings[key] * 1000)} ms`
      : `${Math.round(settings[key] * 100)}%`;
  }
  orchestraPace = settings.pace;
  liveOrchestraParams = settings;
  orchestra.configure(settings);
  markPreset('orchestraPreset', orchestraPreset);
}

function persistOrchestraSettings() {
  writeLocal(ORCHESTRA_SETTINGS, JSON.stringify({ preset: orchestraPreset, profiles: Object.fromEntries(orchestraProfiles) }));
}

function saveOrchestraSettings(fields) {
  const profile = { ...orchestraProfiles.get(orchestraPreset) };
  for (const key of fields) profile[key] = key === 'key' ? orchestraKey.value : Number(orchestraControls[key].value);
  orchestraProfiles.set(orchestraPreset, profile);
  applyOrchestraSettings({ key: orchestraKey.value, level: Number(orchestraLevel.value) });
  persistOrchestraSettings();
}
renderPhraseInput();
$('[data-orchestra-phrase]').addEventListener('change', event => {
  const notes = parsePhrase(event.currentTarget.value);
  if (notes) {
    savePhrase(notes);
    $('[data-phrase-status]').textContent = 'Saved · ' + notes.join(' ');
  } else $('[data-phrase-status]').textContent = 'Enter up to 12 degrees from 1 to 8, separated by spaces.';
  renderPhraseInput();
});
$('[data-orchestra-record]').addEventListener('click', event => {
  if (phraseCapture) {
    endPhraseCapture();
    gesturePhrase = [];
    return;
  }
  gesturePhrase = [];
  phraseCapture = true;
  event.currentTarget.setAttribute('aria-pressed', 'true');
  event.currentTarget.textContent = 'Finish recording';
  $('[data-phrase-status]').textContent = 'Recording · show your open right hand, then pinch.';
  if (!orchestra.state().ready) void playOrchestra();
});
$('[data-orchestra-reset]').addEventListener('click', () => {
  endPhraseCapture();
  gesturePhrase = [];
  savePhrase(null);
  renderPhraseInput();
  $('[data-phrase-status]').textContent = 'Preset phrase restored';
});
$('[data-orchestra-auto]').setAttribute('aria-pressed', String(phraseAuto));
$('[data-orchestra-auto]').addEventListener('click', event => {
  phraseAuto = !phraseAuto;
  event.currentTarget.setAttribute('aria-pressed', String(phraseAuto));
  writeLocal('mythtrace.phrase-auto.v1', String(phraseAuto));
});
renderVersionLibrary();
orchestraButton.addEventListener('click', toggleOrchestra);
for (const button of musicPanel.querySelectorAll('[data-mix-toggle]')) button.addEventListener('click', () => {
  stageMusicSource = button.dataset.mixToggle;
  toggleMusic();
  renderMusicTransport();
});
for (const input of musicPanel.querySelectorAll('[data-mix-level]')) input.addEventListener('input', () => {
  stageMusicSource = input.dataset.mixLevel;
  const control = musicLayerLevelInput(stageMusicSource);
  control.value = input.value;
  control.dispatchEvent(new Event('input', { bubbles: true }));
  renderWagnerSurface();
  renderMusicTransport();
});
$('[data-orchestra-demo]').addEventListener('click', () => { void playOrchestra(true); });
orchestraKey.addEventListener('change', () => saveOrchestraSettings(['key']));
for (const [key, input] of Object.entries(orchestraControls)) input.addEventListener('input', () => saveOrchestraSettings([key]));
let savedAtmosphere = restoredPerformance?.atmosphere;
try { savedAtmosphere ||= JSON.parse(localStorage.getItem('mythtrace.atmosphere.v1')); } catch {}
for (const input of atmosphereSettingInputs) {
  const key = input.dataset.atmosphereSetting;
  atmosphereSettings[key] = Number.isFinite(savedAtmosphere?.[key]) ? clamp(savedAtmosphere[key]) : CONFIG.lightScore.atmosphere[key];
  input.value = String(atmosphereSettings[key]);
  input.addEventListener('input', () => {
    atmosphereSettings[key] = clamp(Number(input.value));
    try { localStorage.setItem('mythtrace.atmosphere.v1', JSON.stringify(atmosphereSettings)); } catch {}
  });
}
musicPanel.querySelector('[data-atmosphere]').addEventListener('click', toggleAtmosphere);
for (const button of musicPanel.querySelectorAll('[data-air-preset]')) button.addEventListener('click', () => applyAirPreset(button.dataset.airPreset));
$('[data-air-mic]').addEventListener('click', async () => {
  if (airMicReactive) releaseAirInput();
  else try {
    airMicOwnedInput = !audioMidi.getFrame().micActive;
    airMicReactive = Boolean(await ensureCalibrationMic());
  } catch (error) { setStatus(error.message); }
  renderAirStatus(); updateInputRitual();
});
presenceButton.addEventListener('click', () => { void togglePresence(); });
connectLiveCues({ preview: Object.hasOwn(presets.looks, shaperPreview) });
if (captureAudioToggle && restoredPerformance) captureAudioToggle.checked = Boolean(restoredPerformance.includeCaptureAudio);
wagnerScore.restoreBuiltinPosition(restoredPerformance?.tristanPosition, restoredPerformance?.wagnerWork);
if (restoredPerformance?.wagnerPerformance) {
  const settings = restoredPerformance.wagnerPerformance;
  wagnerScore.setPerformance(settings);
  if (Number.isFinite(settings.gain)) wagnerScore.setGain(settings.gain);
  for (const key of ['rate', 'color', 'echo', 'gain']) {
    document.querySelector(`[data-wagner-${key}]`).value = wagnerScore.state[key];
  }
}
document.body.dataset.hud = String(controls.hud);
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
const storedMode = readLocal(modePreference);
if (!restoredPerformance && storedMode && /^[0-4]$/.test(storedMode)) controls.mode = Number(storedMode);
setMode(controls.mode);
if (controls.mode === 3 && Object.hasOwn(presets.looks, restoredPerformance?.sceneOverride)) {
  const { name, ...patch } = presets.looks[restoredPerformance.sceneOverride];
  applySceneSettings({ ...patch, preset: 'custom' }, 3);
}
if (freshStage) applyWorkflowSettings('face');
else {
  const variant = storyVersions.get(currentStory());
  if (hasStoryMusicVariant(variant)) {
    const recipe = storySettings(currentStory(), variant);
    orchestraPreset = recipe.music;
    applyOrchestraSettings({ key: recipe.key, level: recipe.level });
    renderPhraseInput();
  }
}
if (restoredPerformance?.sceneOpen) setSceneConsole(true);
resize();
document.documentElement.dataset.server = 'published';
requestAnimationFrame(frame);

// Device enumeration is permissionless. Camera, mic and MIDI remain explicit controls.
refreshCameraDevices();
if (workflow === 'objects') setLiveObjects(true);
globalThis.navigator?.mediaDevices?.addEventListener?.('devicechange', handleCameraDeviceChange);
updateInputRitual();
renderMicLevel();
renderSamplerSurface();
renderMusicSurface();
renderCaptureSurface();
renderPatchSurface();
if (restoredPerformance?.agentDockOpen) openStageAgent();
if (restoredPerformance?.dayEnabled) {
  dayEnabled = true; dayPreview = restoredPerformance.dayPreview ?? null; void loadDayStream();
}
if (restoredPerformance && (Object.values(restoredPerformance.audioLayers || {}).some(Boolean)
  || restoredPerformance.micActive || restoredPerformance.agentListening)) {
  $('#session-recovery').hidden = false;
  $('[data-session-resume]').textContent = `Resume ${Object.values(restoredPerformance.audioLayers || {}).filter(Boolean).length} sound layers${restoredPerformance.micActive || restoredPerformance.agentListening ? ' + mic' : ''}`;
}
renderVoiceCaptionSurface();
void sampler.loadClips().then(() => {
  samplerLibraryLoaded = true;
  renderSamplerSurface();
  updateInputRitual();
});
if (restoredPerformance?.cameraActive) {
  setStatus('performance restored · reconnecting camera');
  void enableCamera(preferredCameraDeviceId);
} else {
  setStatus('pointer field online · inputs disarmed');
}

window.addEventListener('beforeunload', () => {
  clips.close();
  geometryControls?.stopListening();
  wagnerScore.destroy();
  if (scoreRecorder?.getState?.().recording) scoreRecorder.stop('unload', performance.now());
  localBridge?.disconnect?.('unload');
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
  mpeOutput.destroy();
  panicCapture();
  stopStageArrangement();
  auditionArrangement.stop();
  sectorDeck.exit();
  sectorDeck.stop('preview');
  performanceRecorder.destroy();
  performancePatchHost.destroy();
  stageAgent.cancel();
  storyPlanner.cancel();
  guestPart.stop();
  storyAudition.stop();
  frameZones.destroy();
  gestureFrame.destroy();
  frameContent.destroy();
  roiFeatureLock.destroy();
  frameObjectCrop.destroy();
  voiceMemory.destroy();
  voiceCaption.destroy();
  fingerCalibration.destroy();
  fingerEnvelope.destroy();
  atmosphere.stop(true);
  orchestra.stop();
  demoBand.stop();
  demoOrchestra.stop();
  samplerSession.destroy();
  renderer.destroy?.();
  overlay.destroy();
  subjectRoute.reset(performance.now());
  entityConsole.destroy();
});

if (restoredPerformance?.frameArmed) {
  setFramePerformance(true);
  const box = restoredPerformance.frameBox;
  if (box?.committed && [box.x, box.y, box.w, box.h].every(Number.isFinite)) manualFrame = box;
}
if (restoredPerformance?.panel) restorePanel(restoredPerformance.panel);
if (entry.dataset.earlyEnter === 'demo' || entry.dataset.earlyEnter?.startsWith('demo:')) {
  toggleShaperDemo(entry.dataset.earlyEnter.slice(5));
}
else if (entry.dataset.earlyEnter?.startsWith('story:')) openStoryLink(entry.dataset.earlyEnter.slice(6));
else if (entry.dataset.earlyEnter === 'pointer') enterSystem();
entry.dataset.stageReady = 'true';
if (new URLSearchParams(location.search).get('rap') === '1') location.replace('./rap.html');
renderStageTracking(tracking.getFrame());
renderMusicTransport();
if (new URLSearchParams(location.search).get('wagner') === '1') {
  enterSystem();
  $('#music-wagner').open = true;
  setMusicConsole(true);
}

if (new URLSearchParams(location.search).get('focus') === '1' && (!restoredPerformance || !restoredPerformance.entryHidden)) {
  performStory('focus');
  renderMusicTransport();
  setStatus('Point Lattice · move to turn · C camera · J music');
}
if (new URLSearchParams(location.search).get('lab') === '1' && !restoredPerformance) {
  workflow = 'face';
  enterSystem();
  renderWorkflow();
  setPatchConsole(true);
  $('#live-lab').open = true;
  setStatus('Live Lab · C starts the camera');
}


if (!restoredPerformance && Object.hasOwn(presets.looks, shaperPreview)) {
  enterSystem();
  applyShaperLook(shaperPreview, false);
  const cue = presets.cues[shaperPreview] || presets.cues.contour;
  applyGeometryPreset(cue.geometry, false);
  setSacredLayer(cue.sacred, presets.sacred.strength, false);
  setStatus(presets.looks[shaperPreview].name + ' · C camera');
}

function openStoryLink(id) {
  if (!Object.hasOwn(presets.stories, id)) return;
  const button = stage.querySelector(`[data-workflow="${id}"],[data-demo-template="${id}"],[data-story-cue="${id}"]`);
  if (button && !button.hidden) {
    enterSystem();
    if (button.closest('[data-card-set]')) showCardDeck(button.closest('[data-card-set]').dataset.cardSet);
    previewTemplate(button);
  }
}
openStoryLink(new URLSearchParams(location.search).get('story'));
