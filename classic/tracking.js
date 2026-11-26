const HAND_TIPS = Object.freeze([
  Object.freeze([4, 'thumb']),
  Object.freeze([8, 'index']),
  Object.freeze([12, 'middle']),
  Object.freeze([16, 'ring']),
  Object.freeze([20, 'little']),
]);

const PALM_LANDMARKS = Object.freeze([0, 5, 9, 13, 17]);

const POSE_TORSO_LANDMARKS = Object.freeze([11, 12, 23, 24]);
const POSE_FACE_LANDMARKS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
// A projection needs a readable contour, not all 478 MediaPipe mesh points.
// These are the outer oval plus a few eye and mouth points; the tracker keeps
// its output light enough for the overlay to stay restrained at projector size.
const FACE_CONTOUR_LANDMARKS = Object.freeze([
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  33, 133, 159, 145, 263, 362, 386, 374, 61, 291, 13, 14,
]);
const FACE_CONTOUR_MAX_INDEX = Math.max(...FACE_CONTOUR_LANDMARKS);
const FACE_JAW_BLENDSHAPES = new Set(['jawopen']);
const FACE_SMILE_LEFT_BLENDSHAPES = new Set(['mouthsmileleft']);
const FACE_SMILE_RIGHT_BLENDSHAPES = new Set(['mouthsmileright']);
const POSE_JOINTS = Object.freeze([
  Object.freeze([11, 'left shoulder']),
  Object.freeze([12, 'right shoulder']),
  Object.freeze([13, 'left elbow']),
  Object.freeze([14, 'right elbow']),
  Object.freeze([15, 'left wrist']),
  Object.freeze([16, 'right wrist']),
  Object.freeze([23, 'left hip']),
  Object.freeze([24, 'right hip']),
  Object.freeze([25, 'left knee']),
  Object.freeze([26, 'right knee']),
  Object.freeze([27, 'left ankle']),
  Object.freeze([28, 'right ankle']),
]);

function clamp(value, min = 0, max = 1) {
  const finite = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, finite));
}

function mix(previous, next, amount) {
  return previous + (next - previous) * amount;
}

function errorText(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error || 'unknown error');
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function boxDiagonal(box) {
  return Math.hypot(box.w, box.h);
}

function boxCenter(box) {
  return { x: box.x + box.w * 0.5, y: box.y + box.h * 0.5 };
}

function copyBox(box) {
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}

function transformPoint(point, mirrored) {
  const x = clamp(Number(point?.x));
  return {
    x: mirrored ? 1 - x : x,
    y: clamp(Number(point?.y)),
    z: clamp(Number(point?.z), -1, 1),
  };
}

function boundsForPoints(points) {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: clamp(minX),
    y: clamp(minY),
    w: clamp(maxX - minX),
    h: clamp(maxY - minY),
  };
}

function palmForLandmarks(landmarks) {
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;
  for (const index of PALM_LANDMARKS) {
    const point = landmarks[index];
    if (!point) continue;
    x += point.x;
    y += point.y;
    z += point.z;
    count += 1;
  }
  if (!count) return { x: 0, y: 0, z: 0 };
  return { x: clamp(x / count), y: clamp(y / count), z: clamp(z / count, -1, 1) };
}

function averagePoint(landmarks, indexes = null) {
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;
  const source = indexes || landmarks.keys();
  for (const index of source) {
    const point = landmarks[index];
    if (!point) continue;
    x += point.x;
    y += point.y;
    z += point.z;
    count += 1;
  }
  if (!count && indexes) return averagePoint(landmarks);
  if (!count) return { x: 0, y: 0, z: 0 };
  return {
    x: clamp(x / count),
    y: clamp(y / count),
    z: clamp(z / count, -1, 1),
  };
}

function pointConfidence(point) {
  const presence = Number(point?.presence);
  const visibility = Number(point?.visibility);
  if (Number.isFinite(presence) && Number.isFinite(visibility)) {
    return clamp(Math.min(presence, visibility));
  }
  if (Number.isFinite(presence)) return clamp(presence);
  if (Number.isFinite(visibility)) return clamp(visibility);
  return 1;
}

function handShape(landmarks, palm, bbox) {
  const scale = Math.max(boxDiagonal(bbox), Number.EPSILON);
  const thumb = landmarks[4] || palm;
  const index = landmarks[8] || palm;
  let openness = 0;
  for (const [tipIndex] of HAND_TIPS) openness += pointDistance(landmarks[tipIndex] || palm, palm);
  openness /= HAND_TIPS.length * scale;
  return {
    pinch: clamp(1 - pointDistance(thumb, index) / scale),
    openness: clamp(openness),
  };
}

function normalizedHandedness(category) {
  const name = String(category?.categoryName || category?.displayName || '').toLowerCase();
  if (name === 'left') return 'Left';
  if (name === 'right') return 'Right';
  return 'Unknown';
}

function smoothBox(previous, next, amount) {
  if (!previous) return copyBox(next);
  return {
    x: clamp(mix(previous.x, next.x, amount)),
    y: clamp(mix(previous.y, next.y, amount)),
    w: clamp(mix(previous.w, next.w, amount)),
    h: clamp(mix(previous.h, next.h, amount)),
  };
}

function smoothPoints(previous, next, amount) {
  if (!previous || previous.length !== next.length) return next.map((point) => ({ ...point }));
  for (let index = 0; index < next.length; index += 1) {
    const oldPoint = previous[index];
    const newPoint = next[index];
    oldPoint.x = clamp(mix(oldPoint.x, newPoint.x, amount));
    oldPoint.y = clamp(mix(oldPoint.y, newPoint.y, amount));
    oldPoint.z = clamp(mix(oldPoint.z, newPoint.z, amount), -1, 1);
  }
  return previous;
}

function holdConfidence(track, timestamp, lostHoldMs) {
  if (track.missingSince === null) return 1;
  if (lostHoldMs <= 0) return 0;
  return clamp(1 - (timestamp - track.missingSince) / lostHoldMs);
}

function matchCandidates(candidates, tracks, config, compatible, penalty = () => 0) {
  const pairs = [];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex];
    for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
      const track = tracks[trackIndex];
      if (!compatible(candidate, track)) continue;
      const distance = pointDistance(candidate.center, track.center);
      const gate = Math.max(config.tracking.ema, boxDiagonal(candidate.bbox), boxDiagonal(track.bbox));
      if (distance > gate) continue;
      pairs.push({ candidateIndex, trackIndex, distance, cost: distance + penalty(candidate, track) });
    }
  }
  pairs.sort((a, b) => a.cost - b.cost);
  const matches = new Map();
  const usedTracks = new Set();
  for (const pair of pairs) {
    if (matches.has(pair.candidateIndex) || usedTracks.has(pair.trackIndex)) continue;
    matches.set(pair.candidateIndex, tracks[pair.trackIndex]);
    usedTracks.add(pair.trackIndex);
  }
  return matches;
}

function capTracks(tracks, maximum) {
  const limit = Math.max(0, Math.floor(maximum));
  if (tracks.size <= limit) return;
  const ordered = [...tracks.values()].sort((a, b) => {
    const aVisible = Number(a.missingSince === null);
    const bVisible = Number(b.missingSince === null);
    return bVisible - aVisible || b.lastSeen - a.lastSeen;
  });
  const keep = new Set(ordered.slice(0, limit).map((track) => track.id));
  for (const id of tracks.keys()) {
    if (!keep.has(id)) tracks.delete(id);
  }
}

function cloneHand(track, confidence) {
  return {
    id: track.id,
    handedness: track.handedness,
    score: clamp(track.score * confidence),
    landmarks: track.landmarks,
    palm: track.palm,
    pinch: track.pinch,
    openness: track.openness,
    velocityX: track.velocityX,
    velocityY: track.velocityY,
    bbox: track.bbox,
    lastSeen: track.lastSeen,
  };
}

function cloneObject(track, confidence, timestamp) {
  return {
    id: track.id,
    label: track.label,
    score: clamp(track.score * confidence),
    bbox: track.bbox,
    velocityX: track.velocityX,
    velocityY: track.velocityY,
    age: Math.max(0, timestamp - track.createdAt),
    lastSeen: track.lastSeen,
  };
}

function clonePose(track, confidence, timestamp) {
  return {
    id: track.id,
    score: clamp(track.score * confidence),
    landmarks: track.landmarks,
    center: track.center,
    bbox: track.bbox,
    velocityX: track.velocityX,
    velocityY: track.velocityY,
    age: Math.max(0, timestamp - track.createdAt),
    lastSeen: track.lastSeen,
  };
}

function cloneFace(track, confidence, timestamp) {
  return {
    id: track.id,
    score: clamp(track.score * confidence),
    landmarks: track.landmarks,
    center: track.center,
    bbox: track.bbox,
    velocity: { x: track.velocityX, y: track.velocityY },
    blendshapes: {
      jawOpen: clamp(track.blendshapes.jawOpen),
      smile: clamp(track.blendshapes.smile),
    },
    age: Math.max(0, timestamp - track.createdAt),
    lastSeen: track.lastSeen,
  };
}

function cameraConstraints(config, deviceId = '') {
  const video = {
    width: { ideal: config.camera.width },
    height: { ideal: config.camera.height },
    frameRate: { ideal: config.camera.frameRate },
  };
  if (deviceId) video.deviceId = { exact: deviceId };
  else video.facingMode = { ideal: config.camera.facingMode };
  return {
    audio: false,
    video,
  };
}

/**
 * Camera and MediaPipe Tasks Vision tracking for MythTrace.
 * The callback receives status objects with a `fallback: 'pointer'` hook when
 * camera or primary hand tracking is unavailable.
 */
export function createTrackingEngine({ video, config, onStatus }) {
  const trackingConfig = config?.tracking;
  const cameraConfig = config?.camera;
  if (!video || !trackingConfig || !cameraConfig) {
    throw new TypeError('tracking requires video, config.camera and config.tracking');
  }

  const frame = {
    ts: 0,
    ready: false,
    camera: {
      active: false,
      width: 0,
      height: 0,
      mirrored: true,
      error: '',
      deviceId: '',
      label: '',
    },
    hands: [],
    poses: [],
    faces: [],
    objects: [],
    anchors: [],
    metrics: { motion: 0, handEnergy: 0, bodyEnergy: 0, objectEnergy: 0, confidence: 0 },
    status: 'idle',
  };

  const handTracks = new Map();
  const objectTracks = new Map();
  let handSequence = 0;
  let poseSequence = 0;
  let objectSequence = 0;
  let poseTrack = null;
  let faceTrack = null;
  let handLandmarker = null;
  let poseLandmarker = null;
  let faceLandmarker = null;
  let objectDetector = null;
  let visionRuntime = null;
  let visionFileset = null;
  let runtimeSource = '';
  let handError = '';
  let poseError = '';
  let faceError = '';
  let objectError = '';
  let cameraStream = null;
  let activeCameraSelection = null;
  let cameraStartPromise = null;
  let cameraStartDeviceId = '';
  let modelLoadPromise = null;
  let modelsLoading = false;
  let cameraGeneration = 0;
  let lastHandSample = -Infinity;
  let lastPoseSample = -Infinity;
  let lastFaceSample = -Infinity;
  let lastObjectSample = -Infinity;
  let debug = false;
  let destroyed = false;
  let lastStatusSignature = '';
  const stoppedStreams = new WeakSet();

  function emitStatus(message, force = false) {
    const handStatus = handLandmarker
      ? 'live'
      : modelsLoading
        ? 'loading'
        : handError
          ? 'unavailable'
          : 'idle';
    const poseStatus = !trackingConfig.poseModel
      ? 'disabled'
      : poseLandmarker
        ? 'live'
        : modelsLoading
          ? 'loading'
          : poseError
            ? 'unavailable'
            : 'idle';
    const faceStatus = !trackingConfig.faceModel
      ? 'disabled'
      : faceLandmarker
        ? 'live'
        : modelsLoading
          ? 'loading'
          : faceError
            ? 'unavailable'
            : 'idle';
    const objectStatus = !trackingConfig.objectModel
      ? 'disabled'
      : objectDetector
        ? 'live'
        : modelsLoading
          ? 'loading'
          : objectError
            ? 'unavailable'
            : 'idle';
    const payload = {
      source: 'tracking',
      status: frame.status,
      message,
      active: frame.camera.active,
      ready: frame.ready,
      fallback: frame.status === 'fallback' ? 'pointer' : '',
      cameraError: frame.camera.error,
      cameraDeviceId: frame.camera.deviceId,
      cameraLabel: frame.camera.label,
      handError,
      handStatus,
      poseError,
      poseStatus,
      faceError,
      faceStatus,
      objectError,
      objectStatus,
      runtime: runtimeSource,
      debug,
    };
    const signature = JSON.stringify(payload);
    if (!force && signature === lastStatusSignature) return;
    lastStatusSignature = signature;
    if (typeof onStatus === 'function') {
      try {
        onStatus(payload);
      } catch {
        // A presentation-layer callback must never stop camera or inference.
      }
    }
  }

  function statusMessage() {
    if (frame.status === 'idle') return 'tracking idle';
    if (frame.status === 'loading') return frame.camera.active
      ? 'tracking models loading · camera frames stay local'
      : 'camera loading · frames stay local';
    if (frame.status === 'error') return 'tracking error';
    if (frame.status === 'fallback') {
      const reason = frame.camera.error || handError || poseError || 'tracking model unavailable';
      return `tracking fallback · pointer active · ${reason}`;
    }
    const liveTasks = [];
    if (handLandmarker) liveTasks.push('hands');
    if (poseLandmarker) liveTasks.push('pose');
    if (faceLandmarker) liveTasks.push('face');
    if (objectDetector) liveTasks.push('objects');
    const unavailable = [];
    if (handError) unavailable.push(`hands unavailable · ${handError}`);
    if (poseError) unavailable.push(`pose unavailable · ${poseError}`);
    if (faceError) unavailable.push(`face unavailable · ${faceError}`);
    if (objectError) unavailable.push(`objects unavailable · ${objectError}`);
    const live = liveTasks.length ? liveTasks.join(' + ') : 'pointer';
    const suffix = unavailable.length ? ` · ${unavailable.join(' · ')}` : '';
    return `tracking live · ${live} · ${runtimeSource || 'local'} runtime${suffix}`;
  }

  function refreshStatus(force = false) {
    if (destroyed) {
      frame.status = 'idle';
      frame.ready = false;
    } else if (!frame.camera.active) {
      frame.status = frame.camera.error ? 'fallback' : 'idle';
      frame.ready = false;
    } else if (modelsLoading) {
      frame.status = 'loading';
      frame.ready = false;
    } else if (handLandmarker || poseLandmarker || faceLandmarker) {
      frame.status = 'live';
      frame.ready = true;
    } else {
      frame.status = 'fallback';
      frame.ready = Boolean(objectDetector);
    }
    emitStatus(statusMessage(), force);
  }

  function clearTracks() {
    handTracks.clear();
    poseTrack = null;
    faceTrack = null;
    objectTracks.clear();
    frame.hands = [];
    frame.poses = [];
    frame.faces = [];
    frame.objects = [];
    frame.anchors = [];
    frame.metrics.motion = 0;
    frame.metrics.handEnergy = 0;
    frame.metrics.bodyEnergy = 0;
    frame.metrics.objectEnergy = 0;
    frame.metrics.confidence = 0;
    lastHandSample = -Infinity;
    lastPoseSample = -Infinity;
    lastFaceSample = -Infinity;
    lastObjectSample = -Infinity;
  }

  function updateCameraDimensions() {
    if (!frame.camera.active) return;
    const track = cameraStream?.getVideoTracks?.()[0];
    const settings = track?.getSettings?.() || {};
    frame.camera.width = Math.max(0, Math.round(Number(video.videoWidth || settings.width || cameraConfig.width) || 0));
    frame.camera.height = Math.max(0, Math.round(Number(video.videoHeight || settings.height || cameraConfig.height) || 0));
    frame.camera.deviceId = String(settings.deviceId || frame.camera.deviceId || '');
    frame.camera.label = String(track?.label || frame.camera.label || '');
  }

  async function loadVisionRuntime() {
    if (visionRuntime && visionFileset) return;
    let localError;
    try {
      const module = await import(trackingConfig.visionBundle);
      if (!module.FilesetResolver) throw new Error('local Tasks Vision bundle is incomplete');
      const fileset = await module.FilesetResolver.forVisionTasks(trackingConfig.wasmRoot);
      visionRuntime = module;
      visionFileset = fileset;
      runtimeSource = 'local';
      return;
    } catch (error) {
      localError = error;
    }

    if (trackingConfig.allowCdnFallback !== true) {
      runtimeSource = 'local-only';
      throw new Error(`local Tasks Vision runtime unavailable · CDN fallback disabled (${errorText(localError)})`);
    }

    try {
      const module = await import(trackingConfig.cdnBundle);
      if (!module.FilesetResolver) throw new Error('CDN Tasks Vision bundle is incomplete');
      const fileset = await module.FilesetResolver.forVisionTasks(trackingConfig.cdnWasm);
      visionRuntime = module;
      visionFileset = fileset;
      runtimeSource = 'cdn';
      emitStatus('local tracking runtime unavailable · using pinned CDN fallback', true);
    } catch (cdnError) {
      throw new Error(`Tasks Vision unavailable (local: ${errorText(localError)}; CDN: ${errorText(cdnError)})`);
    }
  }

  async function createTask(TaskClass, options) {
    try {
      return await TaskClass.createFromOptions(visionFileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: 'GPU' },
      });
    } catch {
      return TaskClass.createFromOptions(visionFileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: 'CPU' },
      });
    }
  }

  async function ensureModels() {
    if (destroyed) throw new Error('tracking engine destroyed');
    const needHand = !handLandmarker;
    const needPose = Boolean(trackingConfig.poseModel) && !poseLandmarker;
    const needFace = Boolean(trackingConfig.faceModel) && !faceLandmarker;
    const needObject = Boolean(trackingConfig.objectModel) && !objectDetector;
    if (!needHand && !needPose && !needFace && !needObject) return;
    if (modelLoadPromise) return modelLoadPromise;

    modelsLoading = true;
    refreshStatus(true);
    modelLoadPromise = (async () => {
      try {
        await loadVisionRuntime();
      } catch (error) {
        handError = errorText(error);
        if (needPose) poseError = handError;
        if (needFace) faceError = handError;
        if (needObject) objectError = handError;
        return;
      }

      if (needHand) {
        try {
          if (!visionRuntime.HandLandmarker) throw new Error('HandLandmarker is missing from Tasks Vision');
          const task = await createTask(visionRuntime.HandLandmarker, {
            baseOptions: { modelAssetPath: trackingConfig.handModel },
            runningMode: 'VIDEO',
            numHands: trackingConfig.maxHands,
            minHandDetectionConfidence: trackingConfig.minHandScore,
            minHandPresenceConfidence: trackingConfig.minHandScore,
            minTrackingConfidence: trackingConfig.minHandScore,
          });
          if (destroyed) task.close?.();
          else handLandmarker = task;
          handError = '';
        } catch (error) {
          handError = errorText(error);
        }
      }

      if (needPose) {
        try {
          if (!visionRuntime.PoseLandmarker) throw new Error('PoseLandmarker is missing from Tasks Vision');
          const task = await createTask(visionRuntime.PoseLandmarker, {
            baseOptions: { modelAssetPath: trackingConfig.poseModel },
            runningMode: 'VIDEO',
            numPoses: trackingConfig.maxPoses,
            minPoseDetectionConfidence: trackingConfig.minPoseScore,
            minPosePresenceConfidence: trackingConfig.minPoseScore,
            minTrackingConfidence: trackingConfig.minPoseScore,
            outputSegmentationMasks: false,
          });
          if (destroyed) task.close?.();
          else poseLandmarker = task;
          poseError = '';
        } catch (error) {
          poseError = errorText(error);
        }
      } else if (!trackingConfig.poseModel) {
        poseError = '';
      }

      if (needFace) {
        try {
          if (!visionRuntime.FaceLandmarker) throw new Error('FaceLandmarker is missing from Tasks Vision');
          const task = await createTask(visionRuntime.FaceLandmarker, {
            baseOptions: { modelAssetPath: trackingConfig.faceModel },
            runningMode: 'VIDEO',
            numFaces: trackingConfig.maxFaces,
            minFaceDetectionConfidence: trackingConfig.minFaceScore,
            minFacePresenceConfidence: trackingConfig.minFaceScore,
            minTrackingConfidence: trackingConfig.minFaceScore,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: false,
          });
          if (destroyed) task.close?.();
          else faceLandmarker = task;
          faceError = '';
        } catch (error) {
          faceError = errorText(error);
        }
      } else if (!trackingConfig.faceModel) {
        faceError = '';
      }

      if (needObject) {
        try {
          if (!visionRuntime.ObjectDetector) throw new Error('ObjectDetector is missing from Tasks Vision');
          const task = await createTask(visionRuntime.ObjectDetector, {
            baseOptions: { modelAssetPath: trackingConfig.objectModel },
            runningMode: 'VIDEO',
            maxResults: trackingConfig.maxObjects,
            scoreThreshold: trackingConfig.minObjectScore,
          });
          if (destroyed) task.close?.();
          else objectDetector = task;
          objectError = '';
        } catch (error) {
          objectError = errorText(error);
        }
      } else if (!trackingConfig.objectModel) {
        objectError = '';
      }
    })();

    try {
      await modelLoadPromise;
    } finally {
      modelLoadPromise = null;
      modelsLoading = false;
      refreshStatus(true);
    }
  }

  function stopStream(stream) {
    if (!stream || stoppedStreams.has(stream)) return;
    stoppedStreams.add(stream);
    for (const track of stream?.getTracks?.() || []) {
      try {
        track.stop();
      } catch {
        // Tracks may already be ended.
      }
    }
  }

  function resetCameraState(error = '') {
    frame.camera.active = false;
    frame.camera.width = 0;
    frame.camera.height = 0;
    frame.camera.error = error;
    frame.camera.deviceId = '';
    frame.camera.label = '';
    frame.ready = false;
    activeCameraSelection = null;
  }

  function detachVideoStream(stream) {
    if (video.srcObject === stream || (!stream && video.srcObject)) video.srcObject = null;
    try {
      video.pause();
    } catch {
      // Test doubles and unusual media elements may not implement pause fully.
    }
    stopStream(stream);
  }

  function retireCurrentCamera(error = '') {
    const stream = cameraStream || video.srcObject;
    cameraStream = null;
    resetCameraState(error);
    detachVideoStream(stream);
    clearTracks();
  }

  function handleStreamEnded(stream) {
    if (!frame.camera.active || cameraStream !== stream) return;
    cameraGeneration += 1;
    cameraStartPromise = null;
    cameraStartDeviceId = '';
    retireCurrentCamera('camera stream ended');
    refreshStatus(true);
  }

  async function startCamera(deviceId = '') {
    if (destroyed) throw new Error('tracking engine destroyed');
    const hasDeviceSelection = arguments.length > 0;
    const requestedDeviceId = typeof deviceId === 'string' ? deviceId.trim() : '';
    if (
      cameraStartPromise
      && (!hasDeviceSelection || requestedDeviceId === cameraStartDeviceId)
    ) return cameraStartPromise;
    if (
      frame.camera.active
      && cameraStream
      && (!hasDeviceSelection || requestedDeviceId === activeCameraSelection)
    ) {
      await ensureModels();
      updateCameraDimensions();
      refreshStatus(true);
      return frame;
    }

    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      cameraGeneration += 1;
      cameraStartPromise = null;
      cameraStartDeviceId = '';
      if (cameraStream || video.srcObject) retireCurrentCamera('camera API unavailable');
      else {
        resetCameraState('camera API unavailable');
        clearTracks();
      }
      refreshStatus(true);
      throw new Error(frame.camera.error);
    }

    const generation = ++cameraGeneration;
    if (cameraStream || video.srcObject) retireCurrentCamera();
    else {
      resetCameraState();
      clearTracks();
    }
    frame.status = 'loading';
    emitStatus(statusMessage(), true);

    const pending = (async () => {
      let stream;
      try {
        stream = await mediaDevices.getUserMedia(cameraConstraints(config, requestedDeviceId));
        if (destroyed || generation !== cameraGeneration) {
          stopStream(stream);
          throw new Error('camera start cancelled');
        }

        const track = stream.getVideoTracks?.()[0];
        if (!track) throw new Error('camera stream has no video track');
        cameraStream = stream;
        for (const videoTrack of stream.getVideoTracks?.() || []) {
          videoTrack.addEventListener?.('ended', () => handleStreamEnded(stream), { once: true });
        }
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        await video.play();
        if (destroyed || generation !== cameraGeneration) {
          stopStream(stream);
          throw new Error('camera start cancelled');
        }

        frame.camera.active = true;
        frame.camera.error = '';
        activeCameraSelection = requestedDeviceId;
        frame.camera.deviceId = String(track.getSettings?.().deviceId || requestedDeviceId || '');
        frame.camera.label = String(track.label || '');
        updateCameraDimensions();
        refreshStatus(true);
        await ensureModels();
        if (destroyed || generation !== cameraGeneration || cameraStream !== stream) {
          stopStream(stream);
          throw new Error('camera start cancelled');
        }
        updateCameraDimensions();
        return frame;
      } catch (error) {
        if (stream) stopStream(stream);
        if (cameraStream === stream) cameraStream = null;
        if (video.srcObject === stream) detachVideoStream(stream);
        if (!destroyed && generation === cameraGeneration) {
          resetCameraState(errorText(error));
          clearTracks();
          refreshStatus(true);
        }
        throw error;
      }
    })();

    cameraStartPromise = pending;
    cameraStartDeviceId = requestedDeviceId;
    try {
      return await pending;
    } finally {
      if (cameraStartPromise === pending) {
        cameraStartPromise = null;
        cameraStartDeviceId = '';
      }
    }
  }

  function stopCamera() {
    cameraGeneration += 1;
    cameraStartPromise = null;
    cameraStartDeviceId = '';
    retireCurrentCamera();
    refreshStatus(true);
    return frame;
  }

  function toggleMirror() {
    frame.camera.mirrored = !frame.camera.mirrored;
    clearTracks();
    emitStatus(statusMessage(), true);
    return frame.camera.mirrored;
  }

  function setDebug(value) {
    debug = Boolean(value);
    emitStatus(statusMessage(), true);
    return debug;
  }

  function makeHandCandidates(result) {
    const landmarksList = Array.isArray(result?.landmarks) ? result.landmarks : [];
    const handednessList = result?.handednesses || result?.handedness || [];
    const candidates = [];
    for (let index = 0; index < landmarksList.length; index += 1) {
      const rawLandmarks = landmarksList[index];
      if (!Array.isArray(rawLandmarks) || !rawLandmarks.length) continue;
      const category = handednessList[index]?.[0] || null;
      const score = clamp(Number(category?.score));
      if (score < trackingConfig.minHandScore) continue;
      const landmarks = rawLandmarks.map((point) => transformPoint(point, frame.camera.mirrored));
      const bbox = boundsForPoints(landmarks);
      const palm = palmForLandmarks(landmarks);
      candidates.push({
        handedness: normalizedHandedness(category),
        score,
        landmarks,
        palm,
        bbox,
        center: palm,
      });
    }
    return candidates;
  }

  function updateHandTracks(result, timestamp) {
    const candidates = makeHandCandidates(result);
    const tracks = [...handTracks.values()];
    const matches = matchCandidates(
      candidates,
      tracks,
      config,
      () => true,
      (candidate, track) => (
        candidate.handedness !== 'Unknown'
        && track.handedness !== 'Unknown'
        && candidate.handedness !== track.handedness
          ? trackingConfig.ema
          : 0
      ),
    );
    const matchedIds = new Set();

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      let track = matches.get(index);
      if (!track) {
        const shape = handShape(candidate.landmarks, candidate.palm, candidate.bbox);
        track = {
          id: `hand:${handSequence++}`,
          handedness: candidate.handedness,
          score: candidate.score,
          landmarks: candidate.landmarks,
          palm: candidate.palm,
          pinch: shape.pinch,
          openness: shape.openness,
          velocityX: 0,
          velocityY: 0,
          bbox: candidate.bbox,
          center: candidate.palm,
          lastSeen: timestamp,
          missingSince: null,
        };
        handTracks.set(track.id, track);
      } else {
        const previousPalm = track.palm;
        const deltaSeconds = Math.max((timestamp - track.lastSeen) / 1000, trackingConfig.handIntervalMs / 1000);
        track.landmarks = smoothPoints(track.landmarks, candidate.landmarks, trackingConfig.ema);
        track.palm = palmForLandmarks(track.landmarks);
        track.bbox = boundsForPoints(track.landmarks);
        const shape = handShape(track.landmarks, track.palm, track.bbox);
        track.pinch = mix(track.pinch, shape.pinch, trackingConfig.ema);
        track.openness = mix(track.openness, shape.openness, trackingConfig.ema);
        track.velocityX = clamp((track.palm.x - previousPalm.x) / deltaSeconds, -1, 1);
        track.velocityY = clamp((track.palm.y - previousPalm.y) / deltaSeconds, -1, 1);
        track.score = clamp(mix(track.score, candidate.score, trackingConfig.ema));
        if (candidate.handedness !== 'Unknown') track.handedness = candidate.handedness;
        track.center = track.palm;
        track.lastSeen = timestamp;
        track.missingSince = null;
      }
      matchedIds.add(track.id);
    }

    for (const track of handTracks.values()) {
      if (!matchedIds.has(track.id) && track.missingSince === null) track.missingSince = timestamp;
    }
    capTracks(handTracks, trackingConfig.maxHands);
  }

  function makePoseCandidates(result) {
    const landmarksList = Array.isArray(result?.landmarks) ? result.landmarks : [];
    const candidates = [];
    const maximum = Math.max(0, Math.floor(Number(trackingConfig.maxPoses) || 0));
    for (let index = 0; index < landmarksList.length; index += 1) {
      const rawLandmarks = landmarksList[index];
      if (!Array.isArray(rawLandmarks) || !rawLandmarks.length) continue;
      const landmarkScores = rawLandmarks.map(pointConfidence);
      let score = 0;
      for (const value of landmarkScores) score += value;
      score = clamp(score / landmarkScores.length);
      if (score < trackingConfig.minPoseScore) continue;
      const landmarks = rawLandmarks.map((point) => transformPoint(point, frame.camera.mirrored));
      const bbox = boundsForPoints(landmarks);
      const center = averagePoint(landmarks, POSE_TORSO_LANDMARKS);
      candidates.push({ score, landmarkScores, landmarks, bbox, center, sourceIndex: index });
    }
    candidates.sort((a, b) => b.score - a.score || a.sourceIndex - b.sourceIndex);
    return candidates.slice(0, maximum);
  }

  function poseCandidateMatches(candidate, track) {
    const distance = pointDistance(candidate.center, track.center);
    return distance <= trackingConfig.ema;
  }

  function markPoseMissing(timestamp) {
    if (!poseTrack) return;
    if (poseTrack.missingSince === null) poseTrack.missingSince = timestamp;
    poseTrack.bodyEnergy = 0;
  }

  function updatePoseTrack(result, timestamp) {
    const candidates = makePoseCandidates(result);
    if (!poseTrack) {
      const candidate = candidates[0];
      if (!candidate) return;
      poseTrack = {
        id: `pose:${poseSequence++}`,
        score: candidate.score,
        landmarkScores: candidate.landmarkScores,
        landmarks: candidate.landmarks,
        center: candidate.center,
        bbox: candidate.bbox,
        velocityX: 0,
        velocityY: 0,
        bodyEnergy: 0,
        createdAt: timestamp,
        lastSeen: timestamp,
        missingSince: null,
      };
      return;
    }

    let candidate = null;
    let candidateDistance = Infinity;
    for (const option of candidates) {
      if (!poseCandidateMatches(option, poseTrack)) continue;
      const distance = pointDistance(option.center, poseTrack.center);
      if (distance < candidateDistance) {
        candidate = option;
        candidateDistance = distance;
      }
    }
    if (!candidate) {
      markPoseMissing(timestamp);
      return;
    }

    const previousCenter = poseTrack.center;
    const previousLandmarks = poseTrack.landmarks.map((point) => ({ ...point }));
    const deltaSeconds = Math.max(
      (timestamp - poseTrack.lastSeen) / 1000,
      trackingConfig.poseIntervalMs / 1000,
    );
    poseTrack.landmarks = smoothPoints(poseTrack.landmarks, candidate.landmarks, trackingConfig.ema);
    poseTrack.center = averagePoint(poseTrack.landmarks, POSE_TORSO_LANDMARKS);
    poseTrack.bbox = boundsForPoints(poseTrack.landmarks);
    poseTrack.velocityX = clamp((poseTrack.center.x - previousCenter.x) / deltaSeconds, -1, 1);
    poseTrack.velocityY = clamp((poseTrack.center.y - previousCenter.y) / deltaSeconds, -1, 1);
    let bodyEnergy = 0;
    for (let index = 0; index < poseTrack.landmarks.length; index += 1) {
      const previousPoint = previousLandmarks[index] || poseTrack.landmarks[index];
      bodyEnergy += pointDistance(poseTrack.landmarks[index], previousPoint) / deltaSeconds;
    }
    poseTrack.bodyEnergy = poseTrack.landmarks.length
      ? clamp(bodyEnergy / poseTrack.landmarks.length)
      : 0;
    poseTrack.score = clamp(mix(poseTrack.score, candidate.score, trackingConfig.ema));
    if (poseTrack.landmarkScores.length === candidate.landmarkScores.length) {
      for (let index = 0; index < candidate.landmarkScores.length; index += 1) {
        poseTrack.landmarkScores[index] = clamp(mix(
          poseTrack.landmarkScores[index],
          candidate.landmarkScores[index],
          trackingConfig.ema,
        ));
      }
    } else {
      poseTrack.landmarkScores = candidate.landmarkScores.slice();
    }
    poseTrack.lastSeen = timestamp;
    poseTrack.missingSince = null;
  }

  function sparseFaceLandmarks(rawLandmarks) {
    if (!Array.isArray(rawLandmarks)) return [];
    // Deterministic short mock results remain useful in tests and preserve a
    // degraded local face task rather than silently emitting no track.
    if (rawLandmarks.length <= FACE_CONTOUR_MAX_INDEX) {
      return rawLandmarks;
    }
    const sparse = [];
    for (const index of FACE_CONTOUR_LANDMARKS) {
      const point = rawLandmarks[index];
      if (point) sparse.push(point);
    }
    return sparse;
  }

  function blendshapeValue(categories, names) {
    for (const category of categories || []) {
      const name = String(category?.categoryName || category?.displayName || '').toLowerCase();
      if (!names.has(name)) continue;
      return clamp(Number(category?.score));
    }
    return null;
  }

  function faceBlendshapes(rawBlendshapes) {
    const categories = Array.isArray(rawBlendshapes?.categories)
      ? rawBlendshapes.categories
      : Array.isArray(rawBlendshapes)
        ? rawBlendshapes
        : [];
    const jawOpen = blendshapeValue(categories, FACE_JAW_BLENDSHAPES) ?? 0;
    const smileLeft = blendshapeValue(categories, FACE_SMILE_LEFT_BLENDSHAPES);
    const smileRight = blendshapeValue(categories, FACE_SMILE_RIGHT_BLENDSHAPES);
    const smileCount = Number(smileLeft !== null) + Number(smileRight !== null);
    return {
      jawOpen,
      smile: smileCount
        ? clamp(((smileLeft ?? 0) + (smileRight ?? 0)) / smileCount)
        : 0,
    };
  }

  function faceResultScore(result, index) {
    const candidate = result?.faceScores?.[index] ?? result?.faceDetectionScores?.[index];
    const score = Number(candidate?.score ?? candidate);
    // MediaPipe FaceLandmarker applies minFaceDetectionConfidence internally,
    // but a test/runtime may expose an explicit result score.
    return Number.isFinite(score) ? clamp(score) : 1;
  }

  function makeFaceCandidates(result) {
    const landmarksList = Array.isArray(result?.faceLandmarks) ? result.faceLandmarks : [];
    const blendshapesList = Array.isArray(result?.faceBlendshapes) ? result.faceBlendshapes : [];
    const candidates = [];
    const maximum = Math.max(0, Math.floor(Number(trackingConfig.maxFaces) || 0));
    for (let index = 0; index < landmarksList.length && candidates.length < maximum; index += 1) {
      const rawLandmarks = sparseFaceLandmarks(landmarksList[index]);
      if (!rawLandmarks.length) continue;
      const score = faceResultScore(result, index);
      if (score < trackingConfig.minFaceScore) continue;
      const landmarks = rawLandmarks.map((point) => transformPoint(point, frame.camera.mirrored));
      const bbox = boundsForPoints(landmarks);
      candidates.push({
        score,
        landmarks,
        bbox,
        center: averagePoint(landmarks),
        blendshapes: faceBlendshapes(blendshapesList[index]),
        sourceIndex: index,
      });
    }
    candidates.sort((a, b) => b.score - a.score || a.sourceIndex - b.sourceIndex);
    return candidates;
  }

  function markFaceMissing(timestamp) {
    if (!faceTrack || faceTrack.missingSince !== null) return;
    faceTrack.missingSince = timestamp;
  }

  function faceCandidateMatches(candidate, track) {
    const gate = Math.max(
      trackingConfig.faceEma,
      boxDiagonal(candidate.bbox),
      boxDiagonal(track.bbox),
    );
    return pointDistance(candidate.center, track.center) <= gate;
  }

  function updateFaceTrack(result, timestamp) {
    const candidates = makeFaceCandidates(result);
    if (!faceTrack) {
      const candidate = candidates[0];
      if (!candidate) return;
      faceTrack = {
        id: 'face:0',
        score: candidate.score,
        landmarks: candidate.landmarks,
        center: candidate.center,
        bbox: candidate.bbox,
        velocityX: 0,
        velocityY: 0,
        blendshapes: candidate.blendshapes,
        createdAt: timestamp,
        lastSeen: timestamp,
        missingSince: null,
      };
      return;
    }

    let candidate = null;
    let candidateDistance = Infinity;
    for (const option of candidates) {
      if (!faceCandidateMatches(option, faceTrack)) continue;
      const distance = pointDistance(option.center, faceTrack.center);
      if (distance < candidateDistance) {
        candidate = option;
        candidateDistance = distance;
      }
    }
    if (!candidate) {
      markFaceMissing(timestamp);
      return;
    }

    const previousCenter = faceTrack.center;
    const deltaSeconds = Math.max(
      (timestamp - faceTrack.lastSeen) / 1000,
      trackingConfig.faceIntervalMs / 1000,
    );
    faceTrack.landmarks = smoothPoints(faceTrack.landmarks, candidate.landmarks, trackingConfig.faceEma);
    faceTrack.bbox = boundsForPoints(faceTrack.landmarks);
    faceTrack.center = averagePoint(faceTrack.landmarks);
    faceTrack.velocityX = clamp((faceTrack.center.x - previousCenter.x) / deltaSeconds, -1, 1);
    faceTrack.velocityY = clamp((faceTrack.center.y - previousCenter.y) / deltaSeconds, -1, 1);
    faceTrack.score = clamp(mix(faceTrack.score, candidate.score, trackingConfig.faceEma));
    faceTrack.blendshapes.jawOpen = clamp(mix(
      faceTrack.blendshapes.jawOpen,
      candidate.blendshapes.jawOpen,
      trackingConfig.faceEma,
    ));
    faceTrack.blendshapes.smile = clamp(mix(
      faceTrack.blendshapes.smile,
      candidate.blendshapes.smile,
      trackingConfig.faceEma,
    ));
    faceTrack.lastSeen = timestamp;
    faceTrack.missingSince = null;
  }

  function normalizeObjectBox(rawBox) {
    const width = Math.max(1, frame.camera.width || video.videoWidth || cameraConfig.width);
    const height = Math.max(1, frame.camera.height || video.videoHeight || cameraConfig.height);
    const sourceX = clamp(Number(rawBox?.originX) / width);
    const sourceY = clamp(Number(rawBox?.originY) / height);
    const sourceRight = clamp((Number(rawBox?.originX) + Number(rawBox?.width)) / width);
    const sourceBottom = clamp((Number(rawBox?.originY) + Number(rawBox?.height)) / height);
    const normalizedWidth = clamp(sourceRight - sourceX);
    const normalizedHeight = clamp(sourceBottom - sourceY);
    return {
      x: frame.camera.mirrored ? clamp(1 - sourceRight) : sourceX,
      y: sourceY,
      w: normalizedWidth,
      h: normalizedHeight,
    };
  }

  function makeObjectCandidates(result) {
    const detections = Array.isArray(result?.detections) ? result.detections : [];
    const candidates = [];
    for (const detection of detections) {
      const categories = Array.isArray(detection?.categories) ? detection.categories : [];
      let category = null;
      for (const option of categories) {
        if (!category || Number(option?.score) > Number(category?.score)) category = option;
      }
      const score = clamp(Number(category?.score));
      if (!category || score < trackingConfig.minObjectScore || !detection.boundingBox) continue;
      const bbox = normalizeObjectBox(detection.boundingBox);
      const label = String(category.categoryName || category.displayName || 'object');
      candidates.push({ label, score, bbox, center: boxCenter(bbox) });
      if (candidates.length >= trackingConfig.maxObjects) break;
    }
    return candidates;
  }

  function updateObjectTracks(result, timestamp) {
    const candidates = makeObjectCandidates(result);
    const tracks = [...objectTracks.values()];
    const matches = matchCandidates(candidates, tracks, config, (candidate, track) => candidate.label === track.label);
    const matchedIds = new Set();

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      let track = matches.get(index);
      if (!track) {
        track = {
          id: `object:${objectSequence++}`,
          label: candidate.label,
          score: candidate.score,
          bbox: candidate.bbox,
          center: candidate.center,
          velocityX: 0,
          velocityY: 0,
          createdAt: timestamp,
          lastSeen: timestamp,
          missingSince: null,
        };
        objectTracks.set(track.id, track);
      } else {
        const previousCenter = track.center;
        const deltaSeconds = Math.max((timestamp - track.lastSeen) / 1000, trackingConfig.objectIntervalMs / 1000);
        track.bbox = smoothBox(track.bbox, candidate.bbox, trackingConfig.ema);
        track.center = boxCenter(track.bbox);
        track.velocityX = clamp((track.center.x - previousCenter.x) / deltaSeconds, -1, 1);
        track.velocityY = clamp((track.center.y - previousCenter.y) / deltaSeconds, -1, 1);
        track.score = clamp(mix(track.score, candidate.score, trackingConfig.ema));
        track.lastSeen = timestamp;
        track.missingSince = null;
      }
      matchedIds.add(track.id);
    }

    for (const track of objectTracks.values()) {
      if (!matchedIds.has(track.id) && track.missingSince === null) track.missingSince = timestamp;
    }
    capTracks(objectTracks, trackingConfig.maxObjects);
  }

  function markMissing(tracks, timestamp) {
    for (const track of tracks.values()) {
      if (track.missingSince === null) track.missingSince = timestamp;
    }
  }

  function disableHandLandmarker(error, timestamp) {
    handError = errorText(error);
    try {
      handLandmarker?.close?.();
    } catch {
      // The task is already failed.
    }
    handLandmarker = null;
    markMissing(handTracks, timestamp);
    refreshStatus(true);
  }

  function disablePoseLandmarker(error, timestamp) {
    poseError = errorText(error);
    try {
      poseLandmarker?.close?.();
    } catch {
      // The task is already failed.
    }
    poseLandmarker = null;
    markPoseMissing(timestamp);
    refreshStatus(true);
  }

  function disableFaceLandmarker(error, timestamp) {
    faceError = errorText(error);
    try {
      faceLandmarker?.close?.();
    } catch {
      // The task is already failed.
    }
    faceLandmarker = null;
    markFaceMissing(timestamp);
    refreshStatus(true);
  }

  function disableObjectDetector(error, timestamp) {
    objectError = errorText(error);
    try {
      objectDetector?.close?.();
    } catch {
      // The task is already failed.
    }
    objectDetector = null;
    markMissing(objectTracks, timestamp);
    refreshStatus(true);
  }

  function rebuildFrame(timestamp) {
    const hands = [];
    const poses = [];
    const faces = [];
    const objects = [];
    for (const [id, track] of handTracks) {
      const confidence = holdConfidence(track, timestamp, trackingConfig.lostHoldMs);
      if (confidence <= 0) {
        handTracks.delete(id);
        continue;
      }
      hands.push(cloneHand(track, confidence));
    }
    if (poseTrack) {
      const confidence = holdConfidence(poseTrack, timestamp, trackingConfig.lostHoldMs);
      if (confidence <= 0) {
        poseTrack = null;
      } else {
        poses.push(clonePose(poseTrack, confidence, timestamp));
      }
    }
    if (faceTrack) {
      const confidence = holdConfidence(faceTrack, timestamp, trackingConfig.lostHoldMs);
      if (confidence <= 0) {
        faceTrack = null;
      } else {
        faces.push(cloneFace(faceTrack, confidence, timestamp));
      }
    }
    for (const [id, track] of objectTracks) {
      const confidence = holdConfidence(track, timestamp, trackingConfig.lostHoldMs);
      if (confidence <= 0) {
        objectTracks.delete(id);
        continue;
      }
      objects.push(cloneObject(track, confidence, timestamp));
    }

    const anchors = [];
    for (const hand of hands) {
      for (const [tipIndex, tipName] of HAND_TIPS) {
        const point = hand.landmarks[tipIndex];
        if (!point) continue;
        anchors.push({
          id: `${hand.id}:tip:${tipIndex}`,
          kind: 'fingertip',
          label: `${hand.handedness.toLowerCase()} ${tipName}`,
          x: point.x,
          y: point.y,
          z: point.z,
          strength: tipIndex === 8 ? Math.max(hand.pinch, hand.score) : hand.score,
          confidence: hand.score,
          velocityX: hand.velocityX,
          velocityY: hand.velocityY,
          bbox: hand.bbox,
        });
      }
      anchors.push({
        id: `${hand.id}:palm`,
        kind: 'palm',
        label: `${hand.handedness.toLowerCase()} palm`,
        x: hand.palm.x,
        y: hand.palm.y,
        z: hand.palm.z,
        strength: Math.max(hand.openness, hand.score),
        confidence: hand.score,
        velocityX: hand.velocityX,
        velocityY: hand.velocityY,
        bbox: hand.bbox,
      });
    }
    for (const face of faces) {
      anchors.push({
        id: `${face.id}:anchor`,
        kind: 'face',
        label: 'face',
        x: face.center.x,
        y: face.center.y,
        z: face.center.z,
        strength: face.score,
        confidence: face.score,
        velocityX: face.velocity.x,
        velocityY: face.velocity.y,
        bbox: face.bbox,
      });
    }
    const dedicatedFaceAvailable = faces.length > 0;
    for (const pose of poses) {
      anchors.push({
        id: `${pose.id}:center`,
        kind: 'person',
        label: 'person',
        x: pose.center.x,
        y: pose.center.y,
        z: pose.center.z,
        strength: clamp(Math.max(pose.score, poseTrack?.bodyEnergy || 0)),
        confidence: pose.score,
        velocityX: pose.velocityX,
        velocityY: pose.velocityY,
        bbox: pose.bbox,
      });

      const facePoints = [];
      let faceConfidence = 0;
      for (const index of POSE_FACE_LANDMARKS) {
        const point = pose.landmarks[index];
        if (!point) continue;
        facePoints.push(point);
        faceConfidence += poseTrack?.landmarkScores[index] ?? pose.score;
      }
      if (!dedicatedFaceAvailable && facePoints.length) {
        faceConfidence = clamp(Math.min(pose.score, faceConfidence / facePoints.length));
        const faceCenter = averagePoint(facePoints);
        anchors.push({
          id: `${pose.id}:face`,
          kind: 'face',
          label: 'face',
          x: faceCenter.x,
          y: faceCenter.y,
          z: faceCenter.z,
          strength: faceConfidence,
          confidence: faceConfidence,
          velocityX: pose.velocityX,
          velocityY: pose.velocityY,
          bbox: boundsForPoints(facePoints),
        });
      }

      for (const [index, label] of POSE_JOINTS) {
        const point = pose.landmarks[index];
        if (!point) continue;
        const confidence = clamp(Math.min(
          pose.score,
          poseTrack?.landmarkScores[index] ?? pose.score,
        ));
        anchors.push({
          id: `${pose.id}:joint:${index}`,
          kind: 'person',
          label,
          x: point.x,
          y: point.y,
          z: point.z,
          strength: confidence,
          confidence,
          velocityX: pose.velocityX,
          velocityY: pose.velocityY,
          bbox: pose.bbox,
        });
      }
    }
    const poseConfidenceLive = Boolean(
      poseTrack
      && poseTrack.missingSince === null
      && poses[0]?.score >= trackingConfig.minPoseScore,
    );
    for (const object of objects) {
      if (poseConfidenceLive && object.label.toLowerCase() === 'person') continue;
      const center = boxCenter(object.bbox);
      anchors.push({
        id: `${object.id}:anchor`,
        kind: object.label.toLowerCase() === 'person' ? 'person' : 'object',
        label: object.label,
        x: clamp(center.x),
        y: clamp(center.y),
        z: 0,
        strength: object.score,
        confidence: object.score,
        velocityX: object.velocityX,
        velocityY: object.velocityY,
        bbox: object.bbox,
      });
    }

    let handEnergy = 0;
    for (const hand of hands) handEnergy += Math.hypot(hand.velocityX, hand.velocityY) * hand.score;
    handEnergy = hands.length ? clamp(handEnergy / hands.length) : 0;
    const bodyEnergy = poses.length && poseTrack ? clamp(poseTrack.bodyEnergy) : 0;
    let objectEnergy = 0;
    for (const object of objects) objectEnergy += Math.hypot(object.velocityX, object.velocityY) * object.score;
    objectEnergy = objects.length ? clamp(objectEnergy / objects.length) : 0;
    let confidence = 0;
    for (const hand of hands) confidence += hand.score;
    for (const pose of poses) confidence += pose.score;
    for (const face of faces) confidence += face.score;
    for (const object of objects) confidence += object.score;
    const entityCount = hands.length + poses.length + faces.length + objects.length;
    const energySourceCount = Number(Boolean(hands.length))
      + Number(Boolean(poses.length))
      + Number(Boolean(objects.length));

    frame.ts = timestamp;
    frame.hands = hands;
    frame.poses = poses;
    frame.faces = faces;
    frame.objects = objects;
    frame.anchors = anchors;
    frame.metrics.handEnergy = handEnergy;
    frame.metrics.bodyEnergy = bodyEnergy;
    frame.metrics.objectEnergy = objectEnergy;
    frame.metrics.motion = energySourceCount
      ? clamp((handEnergy + bodyEnergy + objectEnergy) / energySourceCount)
      : 0;
    frame.metrics.confidence = entityCount ? clamp(confidence / entityCount) : 0;
  }

  function sample(timestamp) {
    const now = Number.isFinite(timestamp)
      ? Math.max(0, timestamp)
      : (globalThis.performance?.now?.() ?? Date.now());
    frame.ts = now;
    if (destroyed) {
      frame.status = 'error';
      frame.ready = false;
      emitStatus('tracking error · engine destroyed');
      return frame;
    }
    if (!frame.camera.active || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      rebuildFrame(now);
      return frame;
    }

    updateCameraDimensions();
    if (handLandmarker && now - lastHandSample >= trackingConfig.handIntervalMs) {
      lastHandSample = now;
      try {
        updateHandTracks(handLandmarker.detectForVideo(video, now), now);
      } catch (error) {
        disableHandLandmarker(error, now);
      }
    }
    if (poseLandmarker && now - lastPoseSample >= trackingConfig.poseIntervalMs) {
      lastPoseSample = now;
      try {
        updatePoseTrack(poseLandmarker.detectForVideo(video, now), now);
      } catch (error) {
        disablePoseLandmarker(error, now);
      }
    }
    if (faceLandmarker && now - lastFaceSample >= trackingConfig.faceIntervalMs) {
      lastFaceSample = now;
      try {
        updateFaceTrack(faceLandmarker.detectForVideo(video, now), now);
      } catch (error) {
        disableFaceLandmarker(error, now);
      }
    }
    if (objectDetector && now - lastObjectSample >= trackingConfig.objectIntervalMs) {
      lastObjectSample = now;
      try {
        updateObjectTracks(objectDetector.detectForVideo(video, now), now);
      } catch (error) {
        disableObjectDetector(error, now);
      }
    }
    rebuildFrame(now);
    return frame;
  }

  function getFrame() {
    return frame;
  }

  function destroy() {
    if (destroyed) return;
    stopCamera();
    destroyed = true;
    try {
      handLandmarker?.close?.();
    } catch {
      // Close is best-effort during page teardown.
    }
    try {
      poseLandmarker?.close?.();
    } catch {
      // Close is best-effort during page teardown.
    }
    try {
      faceLandmarker?.close?.();
    } catch {
      // Close is best-effort during page teardown.
    }
    try {
      objectDetector?.close?.();
    } catch {
      // Close is best-effort during page teardown.
    }
    handLandmarker = null;
    poseLandmarker = null;
    faceLandmarker = null;
    objectDetector = null;
    visionRuntime = null;
    visionFileset = null;
    refreshStatus(true);
  }

  return {
    startCamera,
    stopCamera,
    toggleMirror,
    setDebug,
    sample,
    getFrame,
    destroy,
  };
}
