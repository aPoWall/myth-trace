export const airVoiceLevel = (frame, linked) => linked && frame?.micActive
  ? Math.max(0, Math.min(1, Number(frame.rawRms) || 0)) : 0;

export function inputSourceLabel(frame) {
  if (!frame?.micActive) return 'Input off';
  const label = frame.micDeviceLabel || 'Selected microphone';
  const system = /blackhole|loopback|soundflower|system audio|stereo mix|aggregate/i.test(label);
  return `${system ? 'SYSTEM INPUT' : 'MIC'} · ${label} · ${frame.monitorActive ? 'monitor on' : 'analysis only'}`;
}
