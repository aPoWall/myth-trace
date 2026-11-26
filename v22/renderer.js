import { PALETTES } from './config.js';

const FULLSCREEN_VERTEX = `#version 300 es
precision highp float;

out vec2 vUv;

void main() {
  vec2 position = gl_VertexID == 0
    ? vec2(-1.0, -1.0)
    : (gl_VertexID == 1 ? vec2(3.0, -1.0) : vec2(-1.0, 3.0));
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

function sceneFragment(maxAnchors) {
  return `#version 300 es
precision highp float;

#define MAX_ANCHORS ${maxAnchors}

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uCamera;
uniform vec2 uResolution;
uniform float uTime;
uniform float uCameraActive;
uniform float uMirrored;
uniform int uMode;
uniform int uAnchorCount;
uniform vec4 uAnchors[MAX_ANCHORS];
uniform vec4 uControls;
uniform vec4 uAudio;
uniform vec4 uAudioPulse;
uniform vec4 uMetrics;
uniform vec4 uSceneTuning;
uniform vec4 uSceneLook;
uniform vec4 uBodyFrame;
uniform float uBodyConfidence;

float saturate(float value) {
  return clamp(value, 0.0, 1.0);
}

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

float hash21(vec2 point) {
  vec3 p3 = fract(vec3(point.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 displayUv(vec2 uv) {
  return vec2(mix(uv.x, 1.0 - uv.x, uMirrored), uv.y);
}

vec3 syntheticCamera(vec2 uv) {
  vec2 centered = uv - 0.5;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  centered.x *= aspect;
  float rings = sin(length(centered) * 42.0 - uTime * 1.7);
  float bars = sin((centered.x * 19.0 + centered.y * 13.0) + uTime * 0.9);
  float field = 0.08 + 0.045 * rings + 0.035 * bars;
  for (int i = 0; i < MAX_ANCHORS; i += 1) {
    if (i >= uAnchorCount) break;
    vec4 anchor = uAnchors[i];
    vec2 delta = uv - vec2(anchor.x, 1.0 - anchor.y);
    delta.x *= aspect;
    float glow = exp(-dot(delta, delta) * (72.0 + float(i) * 2.0));
    field += glow * (0.32 + anchor.z * 0.5) * anchor.w;
  }
  float grid = step(0.965, fract(uv.x * 31.0)) + step(0.97, fract(uv.y * 19.0));
  field += grid * 0.06;
  return vec3(saturate(field));
}

vec3 cameraAt(vec2 uv) {
  vec2 sampleUv = clamp(displayUv(uv), 0.001, 0.999);
  if (uCameraActive > 0.5) return texture(uCamera, sampleUv).rgb;
  return syntheticCamera(uv);
}

float cameraLuma(vec2 uv) {
  return luma(cameraAt(uv));
}

float sobel(vec2 uv) {
  vec2 pixel = 1.0 / max(uResolution, vec2(1.0));
  float tl = cameraLuma(uv + pixel * vec2(-1.0,  1.0));
  float tc = cameraLuma(uv + pixel * vec2( 0.0,  1.0));
  float tr = cameraLuma(uv + pixel * vec2( 1.0,  1.0));
  float ml = cameraLuma(uv + pixel * vec2(-1.0,  0.0));
  float mr = cameraLuma(uv + pixel * vec2( 1.0,  0.0));
  float bl = cameraLuma(uv + pixel * vec2(-1.0, -1.0));
  float bc = cameraLuma(uv + pixel * vec2( 0.0, -1.0));
  float br = cameraLuma(uv + pixel * vec2( 1.0, -1.0));
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy =  tl + 2.0 * tc + tr - bl - 2.0 * bc - br;
  return length(vec2(gx, gy));
}

float anchorField(vec2 uv, out vec2 displacement) {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  float field = 0.0;
  displacement = vec2(0.0);
  for (int i = 0; i < MAX_ANCHORS; i += 1) {
    if (i >= uAnchorCount) break;
    vec4 anchor = uAnchors[i];
    vec2 delta = uv - vec2(anchor.x, 1.0 - anchor.y);
    vec2 metricDelta = vec2(delta.x * aspect, delta.y);
    float distanceSquared = max(dot(metricDelta, metricDelta), 0.00004);
    float influence = exp(-distanceSquared * 86.0) * anchor.z * anchor.w;
    field += influence;
    displacement += normalize(delta + vec2(0.0001)) * influence;
  }
  return saturate(field);
}

float bayer(vec2 pixel) {
  ivec2 p = ivec2(mod(floor(pixel), 4.0));
  int index = p.x + p.y * 4;
  float matrix[16] = float[16](
     0.0,  8.0,  2.0, 10.0,
    12.0,  4.0, 14.0,  6.0,
     3.0, 11.0,  1.0,  9.0,
    15.0,  7.0, 13.0,  5.0
  );
  return (matrix[index] + 0.5) / 16.0;
}

float ellipseMask(vec2 uv, vec2 center, vec2 size, float feather) {
  vec2 delta = (uv - center) / max(size, vec2(0.001));
  return 1.0 - smoothstep(1.0 - feather, 1.0, dot(delta, delta));
}

float bodySilhouette(vec2 uv) {
  vec2 bodySize = max(uBodyFrame.zw * vec2(0.54, 0.52), vec2(0.06, 0.10));
  float torso = ellipseMask(uv, uBodyFrame.xy, bodySize, 0.32);
  vec2 faceCenter = uBodyFrame.xy + vec2(0.0, uBodyFrame.w * 0.36);
  vec2 faceSize = max(uBodyFrame.zw * vec2(0.22, 0.15), vec2(0.035, 0.045));
  float face = ellipseMask(uv, faceCenter, faceSize, 0.38);
  return max(torso, face) * uBodyConfidence;
}

void main() {
  float intensity = uControls.x;
  float thresholdValue = uControls.y;
  float audioEnergy = saturate(uAudio.x + uAudio.y * 0.65 + uAudioPulse.y * 0.45);
  vec2 fieldDirection;
  float field = anchorField(vUv, fieldDirection);
  vec2 warpedUv = vUv;
  warpedUv += fieldDirection * (0.006 + uMetrics.x * 0.018) * intensity;
  warpedUv.x += sin(vUv.y * 91.0 + uTime * 2.4) * uAudio.z * 0.0025;

  vec3 cameraColor = cameraAt(clamp(warpedUv, 0.0, 1.0));
  float gray = luma(cameraColor);
  float edges = sobel(vUv);
  float scan = sin(gl_FragCoord.y * 1.34 + uTime * 4.0) * 0.5 + 0.5;
  float noise = hash21(gl_FragCoord.xy + floor(uTime * 12.0));
  float value = gray;
  float silhouette = bodySilhouette(vUv);

  if (uMode == 0) {
    float contrast = smoothstep(thresholdValue - 0.22, thresholdValue + 0.18, gray);
    float inspection = step(0.988, fract(vUv.x * 17.0 + vUv.y * 3.0));
    value = mix(contrast, 1.0 - contrast, field * mix(0.10, 0.24, uSceneTuning.z));
    value += edges * 0.52 + inspection * (0.08 + uMetrics.w * 0.18);
  } else if (uMode == 1) {
    float wire = smoothstep(0.055, 0.42, edges * (1.4 + intensity));
    value = wire + gray * 0.08 + field * 0.34;
    value *= 0.72 + scan * 0.28;
  } else if (uMode == 2) {
    float levels = floor(gray * 5.0 + bayer(gl_FragCoord.xy) * 0.95) / 4.0;
    float dots = smoothstep(0.72, 0.18, length(fract(gl_FragCoord.xy / 5.0) - 0.5));
    float bands = step(0.42, fract(vUv.y * 28.0 + uTime * 0.12));
    value = levels * mix(0.62, 1.0, dots) + bands * 0.035 + edges * 0.2;
  } else if (uMode == 3) {
    // MODE_SHAPER_FIELD_CONTOUR: a local hand/face field draws cold scan contours while the body remains legible.
    float aspect = uResolution.x / max(uResolution.y, 1.0);
    float scanCoordinate = vUv.x * aspect * 21.0 + vUv.y * 13.0 + field * 8.0 + uTime * 0.10;
    float scanLine = 1.0 - smoothstep(0.43, 0.50, abs(fract(scanCoordinate) - 0.5));
    float focusField = smoothstep(0.04, 0.72, field) * uSceneTuning.z;
    float contourBody = gray * (0.26 + silhouette * uSceneTuning.y * 0.66) + edges * 0.62;
    value = contourBody + scanLine * focusField * (0.24 + uSceneLook.w * 0.34);
    value += field * (0.08 + uAudioPulse.x * 0.22);
    value += scan * focusField * 0.075;
  } else {
    // MODE_COLD_MEMORY_BODY_TRACE: slow body-centred rings preserve a clear silhouette and leave a long cool residue.
    vec2 memoryCenter = mix(vec2(0.5), uBodyFrame.xy, uBodyConfidence * uSceneTuning.w);
    vec2 memoryDelta = (vUv - memoryCenter) * vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
    float memoryRadius = length(memoryDelta);
    float memoryBand = 1.0 - smoothstep(0.38, 0.50, abs(fract(memoryRadius * 11.0 - uTime * 0.16 + audioEnergy * 0.26) - 0.5));
    float memoryFalloff = exp(-memoryRadius * 2.45);
    float highlight = smoothstep(thresholdValue - 0.08, 0.94, gray);
    float relief = gray * (0.32 + silhouette * uSceneTuning.y * 0.78) + edges * 0.42;
    value = relief + highlight * (0.18 + audioEnergy * 0.46);
    value += memoryBand * memoryFalloff * (0.10 + uSceneLook.w * 0.20);
    value += field * (0.12 + uAudioPulse.x * 0.32) * uSceneLook.w;
  }

  value += (noise - 0.5) * (0.025 + uAudio.w * 0.06);
  value = saturate(value * (0.62 + intensity * 0.9));
  if (uMode == 0 || uMode == 3 || uMode == 4) {
    float reveal = silhouette * uSceneTuning.y * (0.12 + gray * 0.48 + edges * 0.16);
    value = max(value, uSceneTuning.x + reveal);
  }
  fragColor = vec4(vec3(value), 1.0);
}`;
}

function particleVertex(maxAnchors) {
  return `#version 300 es
precision highp float;

#define MAX_ANCHORS ${maxAnchors}

uniform vec2 uResolution;
uniform float uTime;
uniform int uMode;
uniform int uAnchorCount;
uniform vec4 uAnchors[MAX_ANCHORS];
uniform vec4 uControls;
uniform vec4 uAudio;
uniform vec4 uAudioPulse;
uniform vec4 uMetrics;
uniform vec4 uSceneTuning;
uniform vec4 uSceneLook;
uniform vec4 uBodyFrame;
uniform float uBodyConfidence;

out float vEnergy;
out float vSeed;

float hash11(float value) {
  value = fract(value * 0.1031);
  value *= value + 33.33;
  value *= value + value;
  return fract(value);
}

void main() {
  float id = float(gl_VertexID);
  float seedX = hash11(id + 0.17);
  float seedY = hash11(id * 1.6180339 + 7.13);
  float seed = hash11(id * 0.7548777 + 19.7);
  vec2 base = vec2(seedX, seedY) * 2.0 - 1.0;
  base.x *= uResolution.y / max(uResolution.x, 1.0);

  float audioEnergy = clamp(uAudio.x + uAudio.y * 0.7 + uAudioPulse.y * 0.55, 0.0, 1.0);
  float motion = clamp(uMetrics.x + uMetrics.y * 0.5 + uMetrics.z * 0.35, 0.0, 1.0);
  float phase = uTime * (0.08 + audioEnergy * 0.22) + seed * 6.2831853;
  base += vec2(cos(phase * 1.7), sin(phase * 1.3)) * (0.008 + motion * 0.035);

  float attraction = 0.0;
  if (uAnchorCount > 0) {
    int anchorIndex = int(mod(id, float(uAnchorCount)));
    vec4 anchor = uAnchors[anchorIndex];
    vec2 target = vec2(anchor.x * 2.0 - 1.0, (1.0 - anchor.y) * 2.0 - 1.0);
    target.x *= uResolution.y / max(uResolution.x, 1.0);
    float orbit = 0.025 + seed * 0.12 + audioEnergy * 0.06;
    target += vec2(cos(phase + seed * 17.0), sin(phase + seed * 23.0)) * orbit;
    attraction = clamp(anchor.z * anchor.w * (0.22 + motion * 0.45 + uAudioPulse.x * 0.25), 0.0, 0.92);
    if (uMode == 4) attraction = clamp(attraction + 0.16, 0.0, 0.92);
    if (uMode == 3) attraction = clamp(attraction + 0.08, 0.0, 0.82);
    base = mix(base, target, attraction);
  }

  if (uMode == 4 && uBodyConfidence > 0.0) {
    // MODE_COLD_MEMORY_PARTICLE_ORBIT: a broad body-centred orbit makes movement leave a readable residue.
    vec2 bodyTarget = vec2(
      uBodyFrame.x * 2.0 - 1.0,
      uBodyFrame.y * 2.0 - 1.0
    );
    bodyTarget.x *= uResolution.y / max(uResolution.x, 1.0);
    vec2 bodyScatter = vec2(seedX * 2.0 - 1.0, seedY * 2.0 - 1.0) * uBodyFrame.zw;
    bodyScatter.x *= uResolution.y / max(uResolution.x, 1.0);
    float bodyPull = clamp(
      uSceneTuning.w * uBodyConfidence * (0.22 + seed * 0.34),
      0.0,
      0.72
    );
    base = mix(base, bodyTarget + bodyScatter * 0.62, bodyPull);
  }

  base.x *= uResolution.x / max(uResolution.y, 1.0);
  gl_Position = vec4(base, 0.0, 1.0);
  float particleGain = uControls.z;
  float densityGain = mix(0.58, 1.0, uSceneLook.w);
  float sizeEnergy = particleGain * densityGain * (0.35 + audioEnergy * 0.85 + motion * 0.62 + attraction);
  gl_PointSize = clamp((0.65 + seed * 1.45) * (0.65 + sizeEnergy * 1.8), 1.0, 6.5);
  vEnergy = clamp(sizeEnergy * (0.32 + seed * 0.68), 0.0, 1.0);
  vSeed = seed;
}`;
}

const PARTICLE_FRAGMENT = `#version 300 es
precision highp float;

in float vEnergy;
in float vSeed;
out vec4 fragColor;

void main() {
  vec2 point = gl_PointCoord - 0.5;
  float circle = smoothstep(0.5, 0.08, length(point));
  float core = smoothstep(0.2, 0.0, length(point));
  float alpha = circle * (0.08 + vEnergy * 0.7);
  fragColor = vec4(vec3(0.5 + vSeed * 0.5 + core * 0.35), alpha);
}`;

function feedbackFragment(maxAnchors) {
  return `#version 300 es
precision highp float;

#define MAX_ANCHORS ${maxAnchors}

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;
uniform sampler2D uPrevious;
uniform vec2 uResolution;
uniform float uTime;
uniform float uDecay;
uniform int uMode;
uniform int uAnchorCount;
uniform vec4 uAnchors[MAX_ANCHORS];
uniform vec2 uAnchorVelocity[MAX_ANCHORS];
uniform vec4 uAudioPulse;
uniform vec4 uMetrics;
uniform vec4 uSceneTuning;
uniform vec4 uSceneLook;
uniform vec4 uBodyFrame;
uniform float uBodyConfidence;

void main() {
  vec2 pixel = 1.0 / max(uResolution, vec2(1.0));
  vec2 curl = vec2(
    sin(vUv.y * 18.0 + uTime * 0.43),
    cos(vUv.x * 16.0 - uTime * 0.37)
  );
  curl *= pixel * (1.4 + uMetrics.x * 8.0 + uAudioPulse.y * 5.0);

  vec2 injection = vec2(0.0);
  float portalField = 0.0;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  for (int i = 0; i < MAX_ANCHORS; i += 1) {
    if (i >= uAnchorCount) break;
    vec4 anchor = uAnchors[i];
    vec2 delta = vUv - vec2(anchor.x, 1.0 - anchor.y);
    vec2 metricDelta = vec2(delta.x * aspect, delta.y);
    float influence = exp(-dot(metricDelta, metricDelta) * 58.0) * anchor.z * anchor.w;
    injection += vec2(uAnchorVelocity[i].x, -uAnchorVelocity[i].y) * influence;
    portalField += influence;
  }
  injection = clamp(injection, vec2(-1.0), vec2(1.0));

  vec2 historyUv = vUv - curl - injection * pixel * (4.0 + uMetrics.x * 12.0);
  if (uMode == 3) {
    // MODE_SHAPER_FIELD_FEEDBACK_SCAN: keep history local to tracked anchors instead of opening an inverted portal.
    vec2 scanDrift = vec2(sin(vUv.y * 27.0 + uTime), cos(vUv.x * 23.0 - uTime));
    historyUv += scanDrift * portalField * pixel * mix(3.0, 7.0, uSceneTuning.z);
  } else if (uMode == 4) {
    // MODE_COLD_MEMORY_FEEDBACK_ORBIT: rotate prior light gently around the tracked body centre.
    vec2 bodyCenter = mix(vec2(0.5), uBodyFrame.xy, uBodyConfidence * uSceneTuning.w);
    vec2 bodyDelta = vUv - bodyCenter;
    vec2 orbit = vec2(-bodyDelta.y, bodyDelta.x);
    historyUv += orbit * pixel * (2.0 + uSceneLook.w * 5.0);
  }
  vec3 current = texture(uScene, vUv).rgb;
  vec3 history = texture(uPrevious, clamp(historyUv, 0.001, 0.999)).rgb;
  float decay = clamp(uDecay - uAudioPulse.x * 0.012, 0.0, 0.9995);
  vec3 trail = history * decay;
  vec3 composite = max(current, trail);
  composite += min(current, trail) * (0.045 + uAudioPulse.z * 0.08);
  fragColor = vec4(clamp(composite, 0.0, 1.0), 1.0);
}`;
}

const BLUR_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSource;
uniform vec2 uDirection;
uniform float uThreshold;
uniform float uPrefilter;

vec3 filtered(vec2 uv) {
  vec3 color = texture(uSource, uv).rgb;
  float peak = max(color.r, max(color.g, color.b));
  float gate = smoothstep(uThreshold, min(1.0, uThreshold + 0.22), peak);
  return mix(color, color * gate, uPrefilter);
}

void main() {
  vec3 color = filtered(vUv) * 0.2270270270;
  color += filtered(vUv + uDirection * 1.3846153846) * 0.3162162162;
  color += filtered(vUv - uDirection * 1.3846153846) * 0.3162162162;
  color += filtered(vUv + uDirection * 3.2307692308) * 0.0702702703;
  color += filtered(vUv - uDirection * 3.2307692308) * 0.0702702703;
  fragColor = vec4(color, 1.0);
}`;

const FINAL_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uFeedback;
uniform sampler2D uBloom;
uniform sampler2D uCamera;
uniform vec2 uResolution;
uniform float uTime;
uniform float uCameraActive;
uniform float uMirrored;
uniform float uBloomGain;
uniform float uAberration;
uniform float uIntensity;
uniform float uBlackPoint;
uniform float uWhitePoint;
uniform float uCalibrationActive;
uniform int uMode;
uniform vec3 uPaletteBg;
uniform vec3 uPaletteInk;
uniform vec3 uPaletteAccent;
uniform vec4 uAudio;
uniform vec4 uMetrics;
uniform vec4 uSceneTuning;
uniform vec4 uSceneLook;
uniform vec4 uBodyFrame;
uniform float uBodyConfidence;
uniform vec4 uPatch;
uniform vec4 uPatchLook;

float hash21(vec2 point) {
  vec3 p3 = fract(vec3(point.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

float boxMask(vec2 uv, vec2 low, vec2 high) {
  vec2 inside = step(low, uv) * step(uv, high);
  return inside.x * inside.y;
}

float lineMask(float value, float center, float width) {
  return 1.0 - smoothstep(width, width * 1.8, abs(value - center));
}

float boxOutline(vec2 uv, vec2 low, vec2 high, float width) {
  float outer = boxMask(uv, low, high);
  float inner = boxMask(uv, low + vec2(width), high - vec2(width));
  return max(0.0, outer - inner);
}

float ellipseMask(vec2 uv, vec2 center, vec2 size, float feather) {
  vec2 delta = (uv - center) / max(size, vec2(0.001));
  return 1.0 - smoothstep(1.0 - feather, 1.0, dot(delta, delta));
}

float bodySilhouette(vec2 uv) {
  vec2 bodySize = max(uBodyFrame.zw * vec2(0.54, 0.52), vec2(0.06, 0.10));
  float torso = ellipseMask(uv, uBodyFrame.xy, bodySize, 0.32);
  vec2 faceCenter = uBodyFrame.xy + vec2(0.0, uBodyFrame.w * 0.36);
  vec2 faceSize = max(uBodyFrame.zw * vec2(0.22, 0.15), vec2(0.035, 0.045));
  float face = ellipseMask(uv, faceCenter, faceSize, 0.38);
  return max(torso, face) * uBodyConfidence;
}

vec3 calibrationChart(vec2 rawUv) {
  vec2 uv = vec2(mix(rawUv.x, 1.0 - rawUv.x, uMirrored), rawUv.y);
  vec3 chart = vec3(0.0);

  float rampBand = boxMask(uv, vec2(0.08, 0.52), vec2(0.92, 0.79));
  float ramp = clamp((uv.x - 0.08) / 0.84, 0.0, 1.0);
  chart = mix(chart, vec3(ramp), rampBand);

  float blackBand = boxMask(uv, vec2(0.08, 0.16), vec2(0.36, 0.38));
  float blackCell = floor(clamp((uv.x - 0.08) / 0.28, 0.0, 0.9999) * 4.0);
  float blackTarget = 0.01;
  if (blackCell > 0.5) blackTarget = 0.03;
  if (blackCell > 1.5) blackTarget = 0.06;
  if (blackCell > 2.5) blackTarget = 0.10;
  chart = mix(chart, vec3(blackTarget), blackBand);

  float whiteBand = boxMask(uv, vec2(0.64, 0.16), vec2(0.92, 0.38));
  float whiteCell = floor(clamp((uv.x - 0.64) / 0.28, 0.0, 0.9999) * 4.0);
  float whiteTarget = 0.72;
  if (whiteCell > 0.5) whiteTarget = 0.82;
  if (whiteCell > 1.5) whiteTarget = 0.91;
  if (whiteCell > 2.5) whiteTarget = 0.98;
  chart = mix(chart, vec3(whiteTarget), whiteBand);

  vec2 bloomDelta = (uv - vec2(0.5, 0.27)) * vec2(1.0, 1.35);
  float bloomCore = exp(-dot(bloomDelta, bloomDelta) * 1100.0);
  float bloomHalo = exp(-dot(bloomDelta, bloomDelta) * 90.0) * 0.34;
  float bloomTarget = clamp((bloomCore + bloomHalo) * uBloomGain, 0.0, uBloomGain);
  chart = max(chart, vec3(bloomTarget));

  float safeFrame = boxOutline(uv, vec2(0.025), vec2(0.975), 0.0035);
  float crosshair = max(
    lineMask(uv.x, 0.5, 0.0015) * boxMask(uv, vec2(0.43, 0.44), vec2(0.57, 0.50)),
    lineMask(uv.y, 0.47, 0.0015) * boxMask(uv, vec2(0.47, 0.40), vec2(0.53, 0.54))
  );
  chart = max(chart, vec3(safeFrame * 0.58));
  chart = max(chart, vec3(crosshair * 0.86));

  float leftMarker = boxOutline(uv, vec2(0.055, 0.855), vec2(0.125, 0.945), 0.006);
  leftMarker = max(leftMarker, boxMask(uv, vec2(0.061, 0.861), vec2(0.075, 0.927)));
  float rightMarker = boxMask(uv, vec2(0.875, 0.865), vec2(0.895, 0.885));
  rightMarker += boxMask(uv, vec2(0.905, 0.895), vec2(0.925, 0.915));
  rightMarker += boxMask(uv, vec2(0.875, 0.925), vec2(0.895, 0.945));
  chart = max(chart, vec3(clamp(leftMarker + rightMarker, 0.0, 1.0)));

  return clamp(chart, 0.0, 1.0);
}

void main() {
  if (uCalibrationActive > 0.5) {
    vec3 calibratedChart = calibrationChart(vUv);
    float calibrationRange = max(uWhitePoint - uBlackPoint, 0.001);
    vec3 boundedChart = clamp((calibratedChart - vec3(uBlackPoint)) / calibrationRange, 0.0, 1.0);
    fragColor = vec4(boundedChart, 1.0);
    return;
  }

  vec2 pixel = 1.0 / max(uResolution, vec2(1.0));
  vec2 radial = vUv - 0.5;
  float split = uAberration * (1.5 + uAudio.y * 5.0 + uMetrics.x * 3.0);
  vec2 offset = radial * pixel * split * 5.0;
  vec3 feedback;
  feedback.r = texture(uFeedback, clamp(vUv + offset, 0.0, 1.0)).r;
  feedback.g = texture(uFeedback, vUv).g;
  feedback.b = texture(uFeedback, clamp(vUv - offset, 0.0, 1.0)).b;

  vec3 bloom = texture(uBloom, vUv).rgb * uBloomGain;
  float signal = luma(feedback + bloom);
  // MODE_RETUNE_SINGLE_POLARITY: modes 4/5 arrive pre-shaped from the scene pass.
  float polarity = signal;

  vec3 graded = mix(uPaletteBg, uPaletteInk, clamp(polarity * (0.78 + uIntensity * 0.55), 0.0, 1.0));
  graded += uPaletteAccent * bloom * (0.16 + uSceneLook.x * 0.18 + uSceneLook.z * 0.24);
  if (uCameraActive > 0.5) {
    vec2 cameraUv = vec2(mix(vUv.x, 1.0 - vUv.x, uMirrored), vUv.y);
    float cameraGray = luma(texture(uCamera, cameraUv).rgb);
    graded = mix(graded, graded * (0.72 + cameraGray * 0.52), 0.14);
    if (uMode == 3 || uMode == 4) {
      float revealMask = bodySilhouette(vUv) * uSceneTuning.y;
      vec3 cameraRelief = mix(uPaletteBg, uPaletteInk, cameraGray);
      graded = mix(graded, cameraRelief, revealMask * 0.54);
    }
  }

  float patchFrequency = mix(uPatchLook.y, uPatchLook.z, max(uPatch.y, uPatch.z));
  float patchPhase = (vUv.x * 0.82 - vUv.y * 1.17) * patchFrequency + uTime * (1.6 + uPatch.w * 4.0);
  float patchWeave = abs(sin(patchPhase) * cos((vUv.x + vUv.y) * patchFrequency * 0.31 - uTime));
  float patchLine = 1.0 - smoothstep(uPatchLook.w, uPatchLook.w * 2.0, patchWeave);
  float patchPulse = clamp(uPatchLook.x + uPatch.y * 0.22 + uPatch.z * 0.18, 0.0, 1.0);
  vec3 patchInk = mix(uPaletteInk, uPaletteAccent, uPatch.w);
  graded += patchInk * patchLine * patchPulse * uPatch.x;

  float vignette = smoothstep(0.82, 0.18, length(radial * vec2(uResolution.x / max(uResolution.y, 1.0), 1.0)));
  float grain = hash21(gl_FragCoord.xy + floor(uTime * 60.0)) - 0.5;
  graded *= 0.56 + vignette * 0.44;
  graded += grain * (0.018 + uAudio.w * 0.025);
  if (uMode == 0 || uMode == 3 || uMode == 4) {
    vec3 floorTone = mix(uPaletteBg, uPaletteInk, uSceneTuning.x * (0.72 + uSceneLook.w * 0.28));
    graded = max(graded, floorTone);
  }
  float outputRange = max(uWhitePoint - uBlackPoint, 0.001);
  vec3 boundedOutput = clamp((graded - vec3(uBlackPoint)) / outputRange, 0.0, 1.0);
  fragColor = vec4(boundedOutput, 1.0);
}`;

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function unit(value, fallback = 0) {
  return Math.min(1, Math.max(0, finite(value, fallback)));
}

function boundedSceneValue(sceneRetune, scene, fallbackScene, key, neutral) {
  if (!scene && !fallbackScene) return neutral;
  const bounds = sceneRetune.limits[key];
  const fallback = Math.min(
    bounds[1],
    Math.max(bounds[0], finite(fallbackScene?.[key], neutral)),
  );
  return Math.min(bounds[1], Math.max(bounds[0], finite(scene?.[key], fallback)));
}

function boundedRenderValue(config, scene, key, fallback) {
  if (!scene) return fallback;
  const bounds = config.sceneConfigurator?.renderLimits?.[key];
  if (!Array.isArray(bounds) || bounds.length < 2
    || !Number.isFinite(bounds[0]) || !Number.isFinite(bounds[1])
    || bounds[0] > bounds[1]) return fallback;
  return Math.min(bounds[1], Math.max(bounds[0], finite(scene[key], fallback)));
}

function resolveSceneOverride(controls, mode) {
  if (mode !== 3 && mode !== 4) return null;
  const scene = controls?.scene;
  return scene && scene.mode === mode ? scene : null;
}

function resolveBodyFrame(tracking, sceneRetune, target) {
  const framing = sceneRetune.bodyFrame;
  let centerX = 0.5;
  let centerY = 0.5;
  let frameWidth = framing.fallbackWidth;
  let frameHeight = framing.fallbackHeight;
  let confidence = 0;
  let selectedPose = null;

  for (const pose of tracking?.poses || []) {
    const score = unit(pose?.score);
    if (score > confidence) {
      confidence = score;
      selectedPose = pose;
    }
  }

  if (selectedPose) {
    const box = selectedPose.bbox;
    frameWidth = Math.max(framing.minWidth, unit(box?.w, framing.fallbackWidth));
    frameHeight = Math.max(framing.minHeight, unit(box?.h, framing.fallbackHeight));
    centerX = unit(selectedPose.center?.x, unit(box?.x, 0.5) + frameWidth * 0.5);
    centerY = unit(selectedPose.center?.y, unit(box?.y, 0.5) + frameHeight * 0.5);
  } else {
    for (const anchor of tracking?.anchors || []) {
      if (anchor?.kind !== 'person' && anchor?.kind !== 'face') continue;
      const score = unit(anchor.confidence, unit(anchor.strength));
      if (score <= confidence) continue;
      confidence = score;
      const box = anchor.bbox;
      frameWidth = Math.max(framing.minWidth, unit(box?.w, framing.fallbackWidth));
      frameHeight = Math.max(framing.minHeight, unit(box?.h, framing.fallbackHeight));
      centerX = unit(anchor.x, unit(box?.x, 0.5) + frameWidth * 0.5);
      centerY = unit(anchor.y, unit(box?.y, 0.5) + frameHeight * 0.5);
      if (anchor.kind === 'face' && !box) centerY = unit(centerY + frameHeight * 0.28);
    }
  }

  target[0] = centerX;
  target[1] = 1 - centerY;
  target[2] = frameWidth;
  target[3] = frameHeight;
  return confidence;
}

function calibrationFrame(canvas, config, controls, scene) {
  const blackPointMax = unit(config.calibration.blackPointMax);
  const whitePointMin = unit(config.calibration.whitePointMin);
  const safeBloomMax = unit(config.calibration.safeBloomMax);
  const intensity = boundedRenderValue(
    config,
    scene,
    'intensity',
    unit(controls?.intensity, config.render.intensity),
  );
  const threshold = boundedRenderValue(
    config,
    scene,
    'threshold',
    unit(controls?.threshold, config.render.threshold),
  );
  const bloom = boundedRenderValue(
    config,
    scene,
    'bloom',
    unit(controls?.bloom, config.render.bloom),
  );
  return {
    active: canvas.dataset.calibration === 'true',
    black: threshold * blackPointMax,
    white: whitePointMin + intensity * (1 - whitePointMin),
    bloom: Math.min(safeBloomMax, bloom),
  };
}

function publishCalibrationDiagnostics(canvas, calibration) {
  canvas.dataset.calibrationActive = String(calibration.active);
  canvas.dataset.calibrationBlack = calibration.black.toFixed(3);
  canvas.dataset.calibrationWhite = calibration.white.toFixed(3);
  canvas.dataset.calibrationBloom = calibration.bloom.toFixed(3);
}

function clearCalibrationDiagnostics(canvas) {
  delete canvas.dataset.calibrationActive;
  delete canvas.dataset.calibrationBlack;
  delete canvas.dataset.calibrationWhite;
  delete canvas.dataset.calibrationBloom;
}

function compileShader(gl, type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader) || 'unknown shader error';
    gl.deleteShader(shader);
    throw new Error(`${label}: ${detail}`);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource, label) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource, `${label} vertex`);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label} fragment`);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const detail = gl.getProgramInfoLog(program) || 'unknown program error';
    gl.deleteProgram(program);
    throw new Error(`${label} link: ${detail}`);
  }
  return program;
}

function uniformMap(gl, program, names) {
  const uniforms = Object.create(null);
  for (const name of names) uniforms[name] = gl.getUniformLocation(program, name);
  return uniforms;
}

function createTexture(gl, filter = gl.LINEAR) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return texture;
}

function createTarget(gl, filter = gl.LINEAR) {
  const texture = createTexture(gl, filter);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  return { texture, framebuffer, width: 1, height: 1 };
}

function allocateTarget(gl, target, width, height) {
  target.width = Math.max(1, Math.round(width));
  target.height = Math.max(1, Math.round(height));
  gl.bindTexture(gl.TEXTURE_2D, target.texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    target.width,
    target.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`framebuffer incomplete at ${target.width}x${target.height}`);
  }
  gl.viewport(0, 0, target.width, target.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

function bindTexture(gl, unitIndex, texture, location) {
  gl.activeTexture(gl.TEXTURE0 + unitIndex);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(location, unitIndex);
}

function createFallbackRenderer({ canvas, video, config, onStatus, reason }) {
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
  let width = 1;
  let height = 1;
  let dpr = 1;
  let mode = 0;
  let frames = 0;
  let fps = 0;
  let fpsStartedAt = 0;
  const stats = { fps: 0, frameMs: 0, drawCalls: 0, particles: 0, webgl2: false, error: reason };

  canvas.dataset.renderer = 'fallback';
  canvas.dataset.rendererError = reason;
  canvas.style.background = '#050609';
  onStatus?.(`webgl2 unavailable · visible canvas fallback · ${reason}`);

  function resize(nextWidth, nextHeight, nextDpr = 1) {
    width = Math.max(1, finite(nextWidth, 1));
    height = Math.max(1, finite(nextHeight, 1));
    dpr = Math.max(1, Math.min(config.render.maxDpr, finite(nextDpr, 1)));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function setMode(index) {
    mode = ((Math.round(finite(index)) % 5) + 5) % 5;
  }

  function render({ time = performance.now(), tracking, audio, controls } = {}) {
    if (!context) return;
    const startedAt = performance.now();
    if (controls && Number.isFinite(controls.mode)) setMode(controls.mode);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = '#050609';
    context.fillRect(0, 0, width, height);

    const cameraLive = Boolean(tracking?.camera?.active && video?.readyState >= 2 && video.videoWidth);
    if (cameraLive) {
      context.save();
      context.globalAlpha = 0.68;
      context.filter = 'grayscale(1) contrast(2.2)';
      const sourceAspect = video.videoWidth / Math.max(video.videoHeight, 1);
      const targetAspect = width / Math.max(height, 1);
      let drawWidth = width;
      let drawHeight = height;
      if (sourceAspect > targetAspect) drawWidth = height * sourceAspect;
      else drawHeight = width / sourceAspect;
      if (controls?.mirrored) {
        context.translate(width, 0);
        context.scale(-1, 1);
        context.drawImage(video, (width - drawWidth) * -0.5, (height - drawHeight) * 0.5, drawWidth, drawHeight);
      } else {
        context.drawImage(video, (width - drawWidth) * 0.5, (height - drawHeight) * 0.5, drawWidth, drawHeight);
      }
      context.restore();
    }

    const intensity = unit(controls?.intensity, config.render.intensity);
    const gate = unit(audio?.gate);
    context.strokeStyle = `rgba(230,236,242,${0.14 + intensity * 0.24})`;
    context.lineWidth = 1;
    const spacing = Math.max(18, Math.min(width, height) / 24);
    for (let x = 0; x < width; x += spacing) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x + Math.sin(time * 0.001 + x) * gate * spacing, height);
      context.stroke();
    }
    for (const anchor of tracking?.anchors || []) {
      const x = unit(anchor.x, 0.5) * width;
      const y = unit(anchor.y, 0.5) * height;
      const radius = spacing * (0.5 + unit(anchor.strength) * 1.5);
      context.strokeStyle = 'rgba(242,246,249,.82)';
      context.strokeRect(x - radius, y - radius, radius * 2, radius * 2);
      context.beginPath();
      context.arc(x, y, Math.max(2, radius * 0.18), 0, Math.PI * 2);
      context.stroke();
    }

    context.fillStyle = 'rgba(5,6,9,.86)';
    context.fillRect(18, height - 70, Math.min(width - 36, 620), 48);
    context.fillStyle = '#edf2f6';
    context.font = '600 12px SFMono-Regular, Menlo, monospace';
    context.fillText(`MYTH TRACE · SAFE RASTER MODE ${mode + 1}`, 30, height - 53);
    context.fillStyle = 'rgba(237,242,246,.68)';
    context.font = '10px SFMono-Regular, Menlo, monospace';
    context.fillText(`WEBGL2 UNAVAILABLE · ${reason}`, 30, height - 36);

    frames += 1;
    if (!fpsStartedAt) fpsStartedAt = time;
    const elapsed = time - fpsStartedAt;
    if (elapsed >= 500) {
      fps = frames * 1000 / Math.max(elapsed, 1);
      frames = 0;
      fpsStartedAt = time;
      stats.fps = fps;
    }
    stats.frameMs = performance.now() - startedAt;
    stats.drawCalls = 1;
  }

  function getStats() {
    return stats;
  }

  function destroy() {
    context?.clearRect(0, 0, width, height);
    delete canvas.dataset.renderer;
    delete canvas.dataset.rendererError;
    clearCalibrationDiagnostics(canvas);
    canvas.style.background = '';
  }

  return { resize, setMode, render, getStats, destroy };
}

function createWebGlFailureRenderer({ canvas, gl, config, onStatus, reason }) {
  let width = 1;
  let height = 1;
  let dpr = 1;
  let mode = 0;
  const stats = { fps: 0, frameMs: 0, drawCalls: 1, particles: 0, webgl2: false, error: reason };

  canvas.dataset.renderer = 'fallback';
  canvas.dataset.rendererError = reason;
  onStatus?.(`webgl2 pipeline failed · visible diagnostic field · ${reason}`);

  function resize(nextWidth, nextHeight, nextDpr = 1) {
    width = Math.max(1, finite(nextWidth, 1));
    height = Math.max(1, finite(nextHeight, 1));
    dpr = Math.max(1, Math.min(config.render.maxDpr, finite(nextDpr, 1)));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function setMode(index) {
    mode = ((Math.round(finite(index)) % 5) + 5) % 5;
  }

  function render({ time = performance.now(), controls } = {}) {
    const startedAt = performance.now();
    if (controls && Number.isFinite(controls.mode)) setMode(controls.mode);
    const pulse = Math.sin(finite(time) * 0.002) * 0.5 + 0.5;
    gl.disable(gl.SCISSOR_TEST);
    // Safe diagnostic state must remain projector-legible and cold, never resemble a red failure alarm.
    gl.clearColor(0.004 + mode * 0.003, 0.012 + pulse * 0.006, 0.020 + pulse * 0.018, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    const stripeWidth = Math.max(1, Math.round(canvas.width / 31));
    gl.clearColor(0.12 + pulse * 0.12, 0.34 + pulse * 0.16, 0.50 + pulse * 0.18, 1);
    for (let x = 0; x < canvas.width; x += stripeWidth * 4) {
      gl.scissor(x, 0, stripeWidth, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.disable(gl.SCISSOR_TEST);
    stats.frameMs = performance.now() - startedAt;
  }

  function getStats() {
    return stats;
  }

  function destroy() {
    delete canvas.dataset.renderer;
    delete canvas.dataset.rendererError;
    clearCalibrationDiagnostics(canvas);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  resize(canvas.clientWidth || 1, canvas.clientHeight || 1, 1);
  return { resize, setMode, render, getStats, destroy };
}

/**
 * Raw WebGL2 renderer for the MythTrace camera instrument.
 *
 * @param {{canvas: HTMLCanvasElement, video: HTMLVideoElement, config: object, onStatus?: Function}} options
 * @returns {{resize: Function, setMode: Function, render: Function, getStats: Function, destroy: Function}}
 */
export function createRenderer({ canvas, video, config, onStatus }) {
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('renderer requires a canvas');
  if (!config?.render || !config?.overlay || !config?.sceneRetune) throw new TypeError('renderer requires CONFIG');

  let gl;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      desynchronized: true,
      powerPreference: 'high-performance',
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
  } catch (error) {
    return createFallbackRenderer({ canvas, video, config, onStatus, reason: error.message || 'context creation failed' });
  }
  if (!gl) return createFallbackRenderer({ canvas, video, config, onStatus, reason: 'browser or GPU has no WebGL2 context' });

  const maxAnchors = Math.max(1, Math.round(config.overlay.maxPortals));
  const particleCount = Math.round(config.render.particleCount);
  const anchorData = new Float32Array(maxAnchors * 4);
  const anchorVelocityData = new Float32Array(maxAnchors * 2);
  const bodyFrameData = new Float32Array(4);
  const stats = {
    fps: 0,
    frameMs: 0,
    drawCalls: 0,
    particles: particleCount,
    anchors: 0,
    width: 1,
    height: 1,
    webgl2: true,
    error: '',
  };

  let width = 1;
  let height = 1;
  let dpr = 1;
  let mode = 0;
  let feedbackReadIndex = 0;
  let frameCounter = 0;
  let fpsStartedAt = 0;
  let destroyed = false;
  let contextLost = false;
  let cameraUploadFailed = false;

  const resources = {
    programs: [],
    textures: [],
    framebuffers: [],
    vertexArrays: [],
  };

  let sceneProgram;
  let particleProgram;
  let feedbackProgram;
  let blurProgram;
  let finalProgram;
  let sceneUniforms;
  let particleUniforms;
  let feedbackUniforms;
  let blurUniforms;
  let finalUniforms;
  let cameraTexture;
  let sceneTarget;
  let feedbackTargets;
  let bloomTargets;
  let fullscreenVao;
  let particleVao;

  function registerTarget(target) {
    resources.textures.push(target.texture);
    resources.framebuffers.push(target.framebuffer);
    return target;
  }

  function initialise() {
    sceneProgram = createProgram(gl, FULLSCREEN_VERTEX, sceneFragment(maxAnchors), 'scene');
    particleProgram = createProgram(gl, particleVertex(maxAnchors), PARTICLE_FRAGMENT, 'particles');
    feedbackProgram = createProgram(gl, FULLSCREEN_VERTEX, feedbackFragment(maxAnchors), 'feedback');
    blurProgram = createProgram(gl, FULLSCREEN_VERTEX, BLUR_FRAGMENT, 'bloom');
    finalProgram = createProgram(gl, FULLSCREEN_VERTEX, FINAL_FRAGMENT, 'final');
    resources.programs.push(sceneProgram, particleProgram, feedbackProgram, blurProgram, finalProgram);

    sceneUniforms = uniformMap(gl, sceneProgram, [
      'uCamera', 'uResolution', 'uTime', 'uCameraActive', 'uMirrored', 'uMode', 'uAnchorCount',
      'uAnchors[0]', 'uControls', 'uAudio', 'uAudioPulse', 'uMetrics', 'uSceneTuning',
      'uSceneLook', 'uBodyFrame', 'uBodyConfidence',
    ]);
    particleUniforms = uniformMap(gl, particleProgram, [
      'uResolution', 'uTime', 'uMode', 'uAnchorCount', 'uAnchors[0]', 'uControls', 'uAudio',
      'uAudioPulse', 'uMetrics', 'uSceneTuning', 'uSceneLook', 'uBodyFrame', 'uBodyConfidence',
    ]);
    feedbackUniforms = uniformMap(gl, feedbackProgram, [
      'uScene', 'uPrevious', 'uResolution', 'uTime', 'uDecay', 'uMode', 'uAnchorCount',
      'uAnchors[0]', 'uAnchorVelocity[0]', 'uAudioPulse', 'uMetrics', 'uSceneTuning',
      'uSceneLook', 'uBodyFrame', 'uBodyConfidence',
    ]);
    blurUniforms = uniformMap(gl, blurProgram, ['uSource', 'uDirection', 'uThreshold', 'uPrefilter']);
    finalUniforms = uniformMap(gl, finalProgram, [
      'uFeedback', 'uBloom', 'uCamera', 'uResolution', 'uTime', 'uCameraActive', 'uMirrored',
      'uBloomGain', 'uAberration', 'uIntensity', 'uMode', 'uPaletteBg', 'uPaletteInk',
      'uPaletteAccent', 'uAudio', 'uMetrics', 'uBlackPoint', 'uWhitePoint', 'uCalibrationActive',
      'uSceneTuning', 'uSceneLook', 'uBodyFrame', 'uBodyConfidence', 'uPatch', 'uPatchLook',
    ]);

    cameraTexture = createTexture(gl, gl.LINEAR);
    resources.textures.push(cameraTexture);
    gl.bindTexture(gl.TEXTURE_2D, cameraTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

    sceneTarget = registerTarget(createTarget(gl));
    feedbackTargets = [registerTarget(createTarget(gl)), registerTarget(createTarget(gl))];
    bloomTargets = [registerTarget(createTarget(gl)), registerTarget(createTarget(gl))];

    fullscreenVao = gl.createVertexArray();
    particleVao = gl.createVertexArray();
    resources.vertexArrays.push(fullscreenVao, particleVao);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    canvas.dataset.renderer = 'webgl2';
  }

  function clearResources() {
    for (const framebuffer of resources.framebuffers) gl.deleteFramebuffer(framebuffer);
    for (const texture of resources.textures) gl.deleteTexture(texture);
    for (const vertexArray of resources.vertexArrays) gl.deleteVertexArray(vertexArray);
    for (const program of resources.programs) gl.deleteProgram(program);
    resources.framebuffers.length = 0;
    resources.textures.length = 0;
    resources.vertexArrays.length = 0;
    resources.programs.length = 0;
  }

  function handleContextLost(event) {
    event.preventDefault();
    contextLost = true;
    stats.error = 'WebGL2 context lost';
    canvas.dataset.renderer = 'lost';
    onStatus?.('webgl2 context lost · waiting for GPU restore');
  }

  function handleContextRestored() {
    contextLost = false;
    stats.error = '';
    clearResources();
    try {
      initialise();
      resize(width, height, dpr);
      onStatus?.('webgl2 restored · multipass field online');
    } catch (error) {
      contextLost = true;
      stats.error = error.message;
      canvas.dataset.renderer = 'lost';
      onStatus?.(`webgl2 restore failed · ${error.message}`);
    }
  }

  canvas.addEventListener('webglcontextlost', handleContextLost, false);
  canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

  try {
    initialise();
  } catch (error) {
    canvas.removeEventListener('webglcontextlost', handleContextLost, false);
    canvas.removeEventListener('webglcontextrestored', handleContextRestored, false);
    clearResources();
    return createWebGlFailureRenderer({ canvas, gl, config, onStatus, reason: error.message });
  }

  function resize(nextWidth, nextHeight, nextDpr = 1) {
    width = Math.max(1, finite(nextWidth, 1));
    height = Math.max(1, finite(nextHeight, 1));
    dpr = Math.max(1, Math.min(config.render.maxDpr, finite(nextDpr, 1)));
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    stats.width = pixelWidth;
    stats.height = pixelHeight;
    if (destroyed || contextLost) return;

    allocateTarget(gl, sceneTarget, pixelWidth, pixelHeight);
    allocateTarget(gl, feedbackTargets[0], pixelWidth, pixelHeight);
    allocateTarget(gl, feedbackTargets[1], pixelWidth, pixelHeight);
    allocateTarget(gl, bloomTargets[0], Math.ceil(pixelWidth / 2), Math.ceil(pixelHeight / 2));
    allocateTarget(gl, bloomTargets[1], Math.ceil(pixelWidth / 2), Math.ceil(pixelHeight / 2));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    feedbackReadIndex = 0;
  }

  function setMode(index) {
    mode = ((Math.round(finite(index)) % 5) + 5) % 5;
  }

  function uploadCamera(tracking) {
    const live = Boolean(
      tracking?.camera?.active
      && video
      && video.readyState >= 2
      && video.videoWidth > 0
      && video.videoHeight > 0,
    );
    if (!live) return 0;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cameraTexture);
    try {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      cameraUploadFailed = false;
      return 1;
    } catch (error) {
      if (!cameraUploadFailed) onStatus?.(`camera texture unavailable · synthetic field active · ${error.message}`);
      cameraUploadFailed = true;
      return 0;
    }
  }

  function uploadFrameData(tracking, controls) {
    anchorData.fill(0);
    anchorVelocityData.fill(0);
    const anchors = tracking?.anchors || [];
    const pointer = controls?.pointer;
    let count = Math.min(maxAnchors, anchors.length);
    for (let index = 0; index < count; index += 1) {
      const anchor = anchors[index] || {};
      const anchorOffset = index * 4;
      const velocityOffset = index * 2;
      anchorData[anchorOffset] = unit(anchor.x, 0.5);
      anchorData[anchorOffset + 1] = unit(anchor.y, 0.5);
      anchorData[anchorOffset + 2] = unit(anchor.strength, unit(anchor.confidence, 0.5));
      anchorData[anchorOffset + 3] = unit(anchor.confidence, 1);
      anchorVelocityData[velocityOffset] = Math.max(-1, Math.min(1, finite(anchor.velocityX)));
      anchorVelocityData[velocityOffset + 1] = Math.max(-1, Math.min(1, finite(anchor.velocityY)));
    }
    if (count === 0 && pointer) {
      anchorData[0] = unit(pointer.x, 0.5);
      anchorData[1] = unit(pointer.y, 0.5);
      anchorData[2] = pointer.down ? 1 : 0.42;
      anchorData[3] = 1;
      count = 1;
    }
    stats.anchors = count;
    return count;
  }

  function applySharedUniforms(uniforms, values) {
    gl.uniform2f(uniforms.uResolution, canvas.width, canvas.height);
    gl.uniform1f(uniforms.uTime, values.timeSeconds);
    gl.uniform1i(uniforms.uMode, values.modeIndex);
    gl.uniform1i(uniforms.uAnchorCount, values.anchorCount);
    gl.uniform4fv(uniforms['uAnchors[0]'], anchorData);
    gl.uniform4f(uniforms.uControls, values.intensity, values.threshold, values.particleGain, values.aberration);
    gl.uniform4f(uniforms.uAudio, values.rms, values.bass, values.mid, values.high);
    gl.uniform4f(uniforms.uAudioPulse, values.beat, values.gate, values.midiEnergy, values.note);
    gl.uniform4f(uniforms.uMetrics, values.motion, values.handEnergy, values.objectEnergy, values.confidence);
    gl.uniform4f(
      uniforms.uSceneTuning,
      values.fieldFloor,
      values.bodyReveal,
      values.voidCoverage,
      values.centering,
    );
    gl.uniform4f(uniforms.uSceneLook, values.warmth, values.sceneFeedback, values.sceneBloom, values.density);
    gl.uniform4fv(uniforms.uBodyFrame, bodyFrameData);
    gl.uniform1f(uniforms.uBodyConfidence, values.bodyConfidence);
  }

  function renderScene(values) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTarget.framebuffer);
    gl.viewport(0, 0, sceneTarget.width, sceneTarget.height);
    gl.disable(gl.BLEND);
    gl.useProgram(sceneProgram);
    gl.bindVertexArray(fullscreenVao);
    bindTexture(gl, 0, cameraTexture, sceneUniforms.uCamera);
    applySharedUniforms(sceneUniforms, values);
    gl.uniform1f(sceneUniforms.uCameraActive, values.cameraActive);
    gl.uniform1f(sceneUniforms.uMirrored, values.mirrored);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(particleProgram);
    gl.bindVertexArray(particleVao);
    applySharedUniforms(particleUniforms, values);
    gl.drawArrays(gl.POINTS, 0, particleCount);
    gl.disable(gl.BLEND);
  }

  function renderFeedback(values, writeIndex) {
    const writeTarget = feedbackTargets[writeIndex];
    gl.bindFramebuffer(gl.FRAMEBUFFER, writeTarget.framebuffer);
    gl.viewport(0, 0, writeTarget.width, writeTarget.height);
    gl.useProgram(feedbackProgram);
    gl.bindVertexArray(fullscreenVao);
    bindTexture(gl, 0, sceneTarget.texture, feedbackUniforms.uScene);
    bindTexture(gl, 1, feedbackTargets[feedbackReadIndex].texture, feedbackUniforms.uPrevious);
    gl.uniform2f(feedbackUniforms.uResolution, writeTarget.width, writeTarget.height);
    gl.uniform1f(feedbackUniforms.uTime, values.timeSeconds);
    gl.uniform1f(feedbackUniforms.uDecay, values.feedback);
    gl.uniform1i(feedbackUniforms.uMode, values.modeIndex);
    gl.uniform1i(feedbackUniforms.uAnchorCount, values.anchorCount);
    gl.uniform4fv(feedbackUniforms['uAnchors[0]'], anchorData);
    gl.uniform2fv(feedbackUniforms['uAnchorVelocity[0]'], anchorVelocityData);
    gl.uniform4f(feedbackUniforms.uAudioPulse, values.beat, values.gate, values.midiEnergy, values.note);
    gl.uniform4f(feedbackUniforms.uMetrics, values.motion, values.handEnergy, values.objectEnergy, values.confidence);
    gl.uniform4f(
      feedbackUniforms.uSceneTuning,
      values.fieldFloor,
      values.bodyReveal,
      values.voidCoverage,
      values.centering,
    );
    gl.uniform4f(
      feedbackUniforms.uSceneLook,
      values.warmth,
      values.sceneFeedback,
      values.sceneBloom,
      values.density,
    );
    gl.uniform4fv(feedbackUniforms.uBodyFrame, bodyFrameData);
    gl.uniform1f(feedbackUniforms.uBodyConfidence, values.bodyConfidence);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function renderBloom(values, feedbackTexture) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomTargets[0].framebuffer);
    gl.viewport(0, 0, bloomTargets[0].width, bloomTargets[0].height);
    gl.useProgram(blurProgram);
    gl.bindVertexArray(fullscreenVao);
    bindTexture(gl, 0, feedbackTexture, blurUniforms.uSource);
    gl.uniform2f(blurUniforms.uDirection, 1 / bloomTargets[0].width, 0);
    gl.uniform1f(blurUniforms.uThreshold, values.threshold);
    gl.uniform1f(blurUniforms.uPrefilter, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomTargets[1].framebuffer);
    gl.viewport(0, 0, bloomTargets[1].width, bloomTargets[1].height);
    bindTexture(gl, 0, bloomTargets[0].texture, blurUniforms.uSource);
    gl.uniform2f(blurUniforms.uDirection, 0, 1 / bloomTargets[1].height);
    gl.uniform1f(blurUniforms.uPrefilter, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function renderFinal(values, feedbackTexture) {
    const palette = PALETTES[values.paletteIndex] || PALETTES[0];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(finalProgram);
    gl.bindVertexArray(fullscreenVao);
    bindTexture(gl, 0, feedbackTexture, finalUniforms.uFeedback);
    bindTexture(gl, 1, bloomTargets[1].texture, finalUniforms.uBloom);
    bindTexture(gl, 2, cameraTexture, finalUniforms.uCamera);
    gl.uniform2f(finalUniforms.uResolution, canvas.width, canvas.height);
    gl.uniform1f(finalUniforms.uTime, values.timeSeconds);
    gl.uniform1f(finalUniforms.uCameraActive, values.cameraActive);
    gl.uniform1f(finalUniforms.uMirrored, values.mirrored);
    gl.uniform1f(finalUniforms.uBloomGain, values.bloom);
    gl.uniform1f(finalUniforms.uAberration, values.aberration);
    gl.uniform1f(finalUniforms.uIntensity, values.intensity);
    gl.uniform1f(finalUniforms.uBlackPoint, values.calibrationBlack);
    gl.uniform1f(finalUniforms.uWhitePoint, values.calibrationWhite);
    gl.uniform1f(finalUniforms.uCalibrationActive, values.calibrationActive);
    gl.uniform1i(finalUniforms.uMode, values.modeIndex);
    gl.uniform3fv(finalUniforms.uPaletteBg, palette.bg);
    gl.uniform3fv(finalUniforms.uPaletteInk, palette.ink);
    gl.uniform3fv(finalUniforms.uPaletteAccent, palette.accent);
    gl.uniform4f(finalUniforms.uAudio, values.rms, values.bass, values.mid, values.high);
    gl.uniform4f(finalUniforms.uMetrics, values.motion, values.handEnergy, values.objectEnergy, values.confidence);
    gl.uniform4f(
      finalUniforms.uSceneTuning,
      values.fieldFloor,
      values.bodyReveal,
      values.voidCoverage,
      values.centering,
    );
    gl.uniform4f(
      finalUniforms.uSceneLook,
      values.warmth,
      values.sceneFeedback,
      values.sceneBloom,
      values.density,
    );
    gl.uniform4fv(finalUniforms.uBodyFrame, bodyFrameData);
    gl.uniform1f(finalUniforms.uBodyConfidence, values.bodyConfidence);
    gl.uniform4f(finalUniforms.uPatch, values.patchActive, values.patchHands, values.patchFrame, values.patchMidi);
    gl.uniform4f(
      finalUniforms.uPatchLook,
      values.patchPulse,
      config.performancePatch.visual.wireFrequencyMin,
      config.performancePatch.visual.wireFrequencyMax,
      config.performancePatch.visual.wireWidth,
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  function render({ time = performance.now(), dt = 0, tracking, audio, controls, patch } = {}) {
    if (destroyed || contextLost) return;
    const startedAt = performance.now();
    if (canvas.width < 1 || canvas.height < 1) return;
    if (controls && Number.isFinite(controls.mode)) setMode(controls.mode);
    const anchorCount = uploadFrameData(tracking, controls);
    const cameraActive = uploadCamera(tracking);
    const metrics = tracking?.metrics || {};
    const sceneRetune = config.sceneRetune;
    const sceneFallback = mode === 0
      ? sceneRetune.mythTrace
      : mode === 3
        ? sceneRetune.voidPortals
        : (mode === 4 ? sceneRetune.bloomStorm : null);
    const sceneOverride = resolveSceneOverride(controls, mode);
    const calibration = calibrationFrame(canvas, config, controls, sceneOverride);
    const bodyConfidence = resolveBodyFrame(tracking, sceneRetune, bodyFrameData);
    const controlIntensity = boundedRenderValue(
      config,
      sceneOverride,
      'intensity',
      unit(controls?.intensity, config.render.intensity),
    );
    const controlFeedback = Math.min(0.9995, Math.max(0, boundedRenderValue(
      config,
      sceneOverride,
      'feedback',
      finite(controls?.feedback, config.render.feedback),
    )));
    const controlAberration = boundedRenderValue(
      config,
      sceneOverride,
      'aberration',
      unit(controls?.aberration, config.render.aberration),
    );
    const controlThreshold = boundedRenderValue(
      config,
      sceneOverride,
      'threshold',
      unit(controls?.threshold, config.render.threshold),
    );
    const controlParticleGain = boundedRenderValue(
      config,
      sceneOverride,
      'particleGain',
      unit(controls?.particleGain, config.render.particleGain),
    );
    const sceneFeedback = boundedSceneValue(
      sceneRetune,
      sceneOverride,
      sceneFallback,
      'feedback',
      controlFeedback,
    );
    const sceneBloomLimit = boundedSceneValue(
      sceneRetune,
      sceneOverride,
      sceneFallback,
      'bloom',
      calibration.bloom,
    );
    const bloom = sceneFallback ? Math.min(calibration.bloom, sceneBloomLimit) : calibration.bloom;
    publishCalibrationDiagnostics(canvas, calibration);
    const values = {
      timeSeconds: finite(time) * 0.001,
      dt: Math.max(0, finite(dt)),
      modeIndex: mode,
      anchorCount,
      cameraActive,
      mirrored: controls?.mirrored ?? tracking?.camera?.mirrored ? 1 : 0,
      intensity: controlIntensity,
      feedback: sceneFallback ? Math.min(controlFeedback, sceneFeedback) : controlFeedback,
      bloom,
      aberration: controlAberration,
      threshold: controlThreshold,
      particleGain: controlParticleGain,
      paletteIndex: ((Math.round(finite(controls?.palette, sceneRetune.defaultPalette)) % PALETTES.length) + PALETTES.length) % PALETTES.length,
      rms: unit(audio?.rms),
      bass: unit(audio?.bass),
      mid: unit(audio?.mid),
      high: unit(audio?.high),
      beat: unit(audio?.beat),
      gate: unit(audio?.gate),
      midiEnergy: unit(audio?.midiEnergy),
      note: audio?.lastNote === null ? 0 : unit(finite(audio?.lastNote) / 127),
      motion: unit(metrics.motion),
      handEnergy: unit(metrics.handEnergy),
      objectEnergy: unit(metrics.objectEnergy),
      confidence: unit(metrics.confidence),
      fieldFloor: boundedSceneValue(sceneRetune, sceneOverride, sceneFallback, 'fieldFloor', 0),
      bodyReveal: boundedSceneValue(sceneRetune, sceneOverride, sceneFallback, 'bodyReveal', 0),
      voidCoverage: boundedSceneValue(sceneRetune, sceneOverride, sceneFallback, 'voidCoverage', 0),
      centering: boundedSceneValue(sceneRetune, sceneOverride, sceneFallback, 'centering', 0),
      warmth: boundedSceneValue(sceneRetune, sceneOverride, sceneFallback, 'warmth', 1),
      sceneFeedback: sceneFallback ? Math.min(controlFeedback, sceneFeedback) : controlFeedback,
      sceneBloom: bloom,
      density: boundedSceneValue(sceneRetune, sceneOverride, sceneFallback, 'density', 1),
      bodyConfidence,
      calibrationActive: calibration.active ? 1 : 0,
      calibrationBlack: calibration.black,
      calibrationWhite: calibration.white,
      patchActive: unit(patch?.active),
      patchHands: unit(patch?.hands),
      patchFrame: unit(patch?.frame),
      patchMidi: unit(patch?.midi),
      patchPulse: unit(patch?.pulse),
    };

    const feedbackWriteIndex = 1 - feedbackReadIndex;
    renderScene(values);
    renderFeedback(values, feedbackWriteIndex);
    renderBloom(values, feedbackTargets[feedbackWriteIndex].texture);
    renderFinal(values, feedbackTargets[feedbackWriteIndex].texture);
    feedbackReadIndex = feedbackWriteIndex;

    frameCounter += 1;
    if (!fpsStartedAt) fpsStartedAt = time;
    const fpsElapsed = time - fpsStartedAt;
    if (fpsElapsed >= 500) {
      stats.fps = frameCounter * 1000 / Math.max(fpsElapsed, 1);
      frameCounter = 0;
      fpsStartedAt = time;
    }
    stats.frameMs = performance.now() - startedAt;
    stats.drawCalls = 6;
  }

  function getStats() {
    return stats;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    canvas.removeEventListener('webglcontextlost', handleContextLost, false);
    canvas.removeEventListener('webglcontextrestored', handleContextRestored, false);
    if (!contextLost) clearResources();
    delete canvas.dataset.renderer;
    clearCalibrationDiagnostics(canvas);
  }

  resize(canvas.clientWidth || 1, canvas.clientHeight || 1, 1);
  onStatus?.('webgl2 multipass field online · 65,536 particles');
  return { resize, setMode, render, getStats, destroy };
}
