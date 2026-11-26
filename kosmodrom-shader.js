// Port of ShaperPulse/index.html's kosmodromSector in the final projector pass.
export const sectorGLSL = `
float sectorHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float sectorLine(float v, float width) { return 1.0 - smoothstep(0.0, width, abs(v)); }
float sectorGrid(vec2 uv, float scale, float width) {
  vec2 g = abs(fract(uv * scale - 0.5) - 0.5);
  return max(sectorLine(g.x, width), sectorLine(g.y, width));
}
float sectorRing(vec2 d, float r, float width) { return sectorLine(length(d) - r, width); }
float kosmodromSector(vec2 uv, vec2 p, float drive, float field) {
  float gate = uSector.x;
  if (gate <= 0.001) return 0.0;
  float midi = uSector.y;
  float hand = uSector.z;
  float signal = uSector.w;
  vec2 c = mix(vec2(0.5), uSectorCenters.xy, smoothstep(0.03, 0.30, signal));
  c = mix(c, uSectorCenters.zw, clamp(hand * 0.42, 0.0, 1.0));
  vec2 d = (uv - c) * vec2(uResolution.x / uResolution.y, 1.0);
  float len = length(d);
  float angle = atan(d.y, d.x);
  float sectorCount = 10.0 + floor(midi * 12.0) + floor(signal * 6.0);
  float phase = uTime * (0.10 + gate * 0.42 + midi * 0.22);
  float ink = 0.0;

  for (int i = 0; i < 11; i++) {
    float fi = float(i);
    float r = 0.045 + fi * (0.030 + signal * 0.006) + fract(phase * 0.19 + fi * 0.071) * 0.018;
    ink += sectorRing(d, r, 0.0013 + drive * 0.0019 + gate * 0.0010) * (0.48 + gate * 0.60) / (1.0 + fi * 0.22);
  }

  float polar = sectorLine(fract((angle / 6.28318 + 0.5 + field * 0.035 + phase * 0.05) * sectorCount) - 0.5, 0.010 + drive * 0.006);
  polar *= (1.0 - smoothstep(0.06, 0.56, len)) * (0.28 + gate * 0.38);

  vec2 blocks = floor((uv + vec2(field * 0.025, -field * 0.018)) * vec2(18.0, 11.0));
  float badSector = step(0.78 - gate * 0.16, sectorHash(blocks + floor(phase * 7.0)));
  float scan = step(0.975 - signal * 0.045 - midi * 0.018, fract((uv.y + field * 0.11 + phase * 0.32) * (34.0 + gate * 52.0)));
  float cut = sectorGrid(uv + vec2(field * 0.012, -field * 0.010), 12.0 + signal * 18.0 + midi * 16.0, 0.010);
  float diagonal = sectorLine(sin((p.x * 21.0 - p.y * 14.0 + phase * 2.4 + field * 3.0) * 6.28318), 0.026 + drive * 0.010);

  ink += polar;
  ink += scan * (0.16 + gate * 0.28);
  ink += cut * (0.10 + hand * 0.22);
  ink += diagonal * badSector * (0.18 + signal * 0.24);
  return ink * gate;
}
`;
