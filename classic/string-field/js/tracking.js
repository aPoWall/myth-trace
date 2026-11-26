import { CONFIG } from './config.js';
import { chooseCamera, classifyCamera } from './camera-policy.js';
import { createHandMotion } from './hand-motion.js';

const asset = (path) => new URL(path, import.meta.url).href;
const precision = CONFIG.tracking.precision;
const interval = 1000 / CONFIG.tracking.fps;

export function createTracker({ video, onHands = () => {}, onStatus = () => {} }) {
  let stream = null;
  let detector = null;
  let animation = 0;
  let videoCallback = null;
  let watchdog = null;
  let generation = 0;
  let mirror = true;
  let maxHands = precision.maxHands;
  let changingProfile = false;
  let profileQueue = Promise.resolve();
  let state = 'idle';
  let message = 'Camera off';
  let lastVideo = -Infinity;
  let lastSample = -Infinity;
  let inferenceMs = 0;
  let sampleHz = 0;
  let filteredResidualPx = 0;
  let devices = [];
  let cameraLabel = '';
  let deviceId = '';
  let requestedDevice = 'auto-mac';
  let width = 0;
  let height = 0;
  let captureFrameRate = 0;
  let delegate = '';
  const motion = createHandMotion({ precision, mirror });

  function getPrecision() {
    return {
      width: precision.width, height: precision.height, frameRate: precision.frameRate, maxHands,
      captureFrameRate, inferenceMs, sampleHz, filteredResidualPx,
      frameCallback: Boolean(video?.requestVideoFrameCallback),
    };
  }

  function status(next, text) {
    state = next;
    message = text;
    onStatus({ state, message, cameraLabel, deviceId, requestedDevice, width, height, delegate,
      precision: getPrecision() });
  }

  async function getDevices() {
    const found = await navigator.mediaDevices?.enumerateDevices?.() || [];
    devices = found.filter((device) => device.kind === 'videoinput').map((device) => ({
      deviceId: device.deviceId, label: device.label || '', kind: device.kind, ...classifyCamera(device.label),
    }));
    return devices.map((device) => ({ ...device }));
  }

  navigator.mediaDevices?.addEventListener?.('devicechange', async () => {
    try { await getDevices(); status(state, message); } catch { /* Device inventory is optional. */ }
  });

  function publish(timestamp, measured = false) {
    const hands = motion.getHands();
    onHands({ hands, timestamp, measured, inferenceMs, sampleHz, filteredResidualPx });
  }

  function updateStatus() {
    const hands = motion.getHands();
    const next = hands.some((hand) => !hand.stale) ? 'tracking' : 'searching';
    if (state !== next) status(next, next === 'tracking' ? 'Hands detected' : 'Hands lost · show your hands');
  }

  function stop() {
    generation++;
    if (animation) cancelAnimationFrame(animation);
    if (videoCallback != null) video.cancelVideoFrameCallback?.(videoCallback);
    if (watchdog != null) clearInterval(watchdog);
    animation = 0;
    videoCallback = watchdog = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (video) { video.pause(); video.srcObject = null; }
    detector?.close();
    detector = null;
    changingProfile = false;
    profileQueue = Promise.resolve();
    motion.reset();
    lastVideo = lastSample = -Infinity;
    inferenceMs = sampleHz = filteredResidualPx = 0;
    cameraLabel = deviceId = delegate = '';
    width = height = captureFrameRate = 0;
    publish(performance.now());
    status('idle', 'Camera off');
  }

  async function start(preference) {
    stop();
    const token = generation;
    requestedDevice = preference || 'auto-mac';
    status('starting', 'Starting camera and tracking');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable in this browser');
      await getDevices();
      if (token !== generation) return;
      let selected = chooseCamera(devices, requestedDevice);
      if (!selected && devices.some((device) => !device.label)
          && (requestedDevice === 'auto-mac' || requestedDevice === 'iphone')) {
        // Explicit start grants temporary permission so camera labels can be read.
        const provisional = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        try {
          if (token !== generation) return;
          await getDevices();
        } finally {
          provisional.getTracks().forEach((track) => track.stop());
        }
        if (token !== generation) return;
        selected = chooseCamera(devices, requestedDevice);
      }
      if (!selected && requestedDevice !== 'auto-mac' && requestedDevice !== 'iphone' && !devices.length) {
        selected = { deviceId: requestedDevice, label: '' };
      }
      if (!selected) {
        throw new Error(requestedDevice === 'iphone' ? 'iPhone camera not found' : 'No suitable camera found; select a device');
      }

      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: { exact: selected.deviceId },
          width: { ideal: precision.width },
          height: { ideal: precision.height },
          frameRate: { ideal: precision.frameRate },
        },
      });
      if (token !== generation) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = media;
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings?.() || {};
      cameraLabel = track?.label || selected.label || 'Camera';
      deviceId = settings.deviceId || selected.deviceId;
      captureFrameRate = settings.frameRate || 0;
      video.srcObject = stream;
      await video.play();
      if (token !== generation) return;
      width = video.videoWidth || settings.width || 0;
      height = video.videoHeight || settings.height || 0;
      const vision = await import('../../vendor/mediapipe/vision_bundle.mjs');
      const files = await vision.FilesetResolver.forVisionTasks(asset('../../vendor/mediapipe/wasm'));
      if (token !== generation) return;
      const options = {
        baseOptions: { modelAssetPath: asset('../../assets/models/hand_landmarker.task') },
        runningMode: 'VIDEO', numHands: maxHands,
        minHandDetectionConfidence: precision.minDetection,
        minHandPresenceConfidence: precision.minPresence,
        minTrackingConfidence: precision.minTracking,
      };
      let model;
      try {
        delegate = 'GPU';
        model = await vision.HandLandmarker.createFromOptions(files, {
          ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' },
        });
      } catch {
        if (token !== generation) return;
        delegate = 'CPU';
        model = await vision.HandLandmarker.createFromOptions(files, {
          ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' },
        });
      }
      if (token !== generation) { model.close(); return; }
      let configuredMax = options.numHands;
      while (maxHands !== configuredMax) {
        configuredMax = maxHands;
        try {
          await model.setOptions({ numHands: configuredMax });
        } catch (error) {
          model.close();
          throw error;
        }
        if (token !== generation) { model.close(); return; }
      }
      detector = model;
      status('searching', 'Camera on · show your hands');
      stream.getVideoTracks().forEach((track) => track.addEventListener('ended', () => {
        if (token !== generation) return;
        stop();
        status('unavailable', 'Camera disconnected');
      }, { once: true }));
      schedule(token);
      watchdog = setInterval(() => {
        if (token !== generation) return;
        const now = performance.now();
        if (motion.tick(now) !== null) {
          publish(now);
          updateStatus();
        }
      }, interval);
    } catch (error) {
      if (token !== generation) return;
      stop();
      status('unavailable', error?.name === 'NotAllowedError' ? 'Camera permission denied' :
        `Camera or tracking unavailable: ${error.message}`);
    }
  }

  function residue(hands) {
    let total = 0;
    let count = 0;
    for (const hand of hands) {
      if (hand.stale) continue;
      total += hand.residualPx ** 2;
      count++;
    }
    return count ? Math.sqrt(total / count) : 0;
  }

  function sample(now, mediaTime) {
    const mediaMs = mediaTime * 1000;
    if (changingProfile || video.readyState < 2 || !Number.isFinite(mediaMs) ||
        mediaMs - lastVideo < interval - 1 || now <= lastSample) return;
    lastVideo = mediaMs;
    const started = performance.now();
    const result = detector.detectForVideo(video, now);
    inferenceMs = performance.now() - started;
    if (Number.isFinite(lastSample)) {
      const instantaneous = 1000 / (now - lastSample);
      sampleHz = sampleHz ? sampleHz * .8 + instantaneous * .2 : instantaneous;
    }
    lastSample = now;
    width = video.videoWidth || width;
    height = video.videoHeight || height;
    const hands = motion.update(result, now, { width, height });
    filteredResidualPx = residue(hands);
    publish(now, true);
    updateStatus();
  }

  function schedule(token) {
    if (token !== generation || !detector || !stream) return;
    function onFrame(now, mediaTime) {
      if (token !== generation || !detector || !stream) return;
      try {
        sample(now, mediaTime);
        schedule(token);
      } catch (error) {
        stop();
        status('unavailable', `Tracking error: ${error.message}`);
      }
    }
    if (video.requestVideoFrameCallback) {
      videoCallback = video.requestVideoFrameCallback((now, info) => onFrame(now, info.mediaTime));
    } else {
      animation = requestAnimationFrame((now) => onFrame(now, video.currentTime));
    }
  }

  function setMaxHands(value) {
    const next = Number(value) === 4 ? 4 : 2;
    if (!detector) {
      maxHands = next;
      motion.setMaxHands(maxHands);
      return Promise.resolve(true);
    }
    const model = detector;
    const token = generation;
    const change = profileQueue.then(async () => {
      if (token !== generation || model !== detector) return false;
      if (maxHands === next) return true;
      changingProfile = true;
      try {
        await model.setOptions({ numHands: next });
        if (token !== generation) return false;
        maxHands = next;
        motion.setMaxHands(maxHands);
        publish(performance.now());
        status(state, maxHands === 4 ? 'Four-hand profile' : 'Two-hand precision profile');
        return true;
      } catch {
        if (token === generation) status(state, 'Hand profile unavailable');
        return false;
      } finally {
        if (token === generation) changingProfile = false;
      }
    });
    profileQueue = change;
    return change;
  }

  return {
    start, stop, getDevices, setMaxHands,
    setMirror(value) {
      mirror = Boolean(value);
      if (motion.setMirror(mirror)) publish(performance.now());
    },
    getState() {
      return {
        state, message, mirror, hands: motion.getHands(), active: Boolean(stream),
        devices: devices.map((device) => ({ ...device })), cameraLabel, deviceId, requestedDevice,
        width, height, delegate, inferenceMs, sampleHz, filteredResidualPx, precision: getPrecision(),
      };
    },
  };
}
