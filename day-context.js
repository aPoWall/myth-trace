import { CONFIG, clamp } from './config.js';
export function normalizeDayContext(value) {
  if (!value || value.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(value.date || '') || !Array.isArray(value.windows)) throw new Error('Expected day-stream v1: date and time windows');
  const windows = value.windows.slice(0, CONFIG.dayStream.maxEvents).map(window => {
    if (!Number.isFinite(window.start) || !Number.isFinite(window.end) || window.start < 0 || window.end > 1440 || window.end <= window.start) throw new Error('Invalid calendar time window');
    return { start: window.start, end: window.end, kind: window.kind === 'focus' ? 'focus' : 'event' };
  }).sort((a,b) => a.start - b.start);
  return { version: 1, date: value.date, updatedAt: String(value.updatedAt || ''), source: String(value.source || 'local').slice(0,80), windows };
}
export function sampleDayContext(day, minute) {
  const active = day.windows.filter(window => minute >= window.start && minute < window.end);
  const next = day.windows.find(window => window.start > minute);
  let busy = 0, end = -1;
  for (const window of day.windows) { busy += Math.max(0, window.end - Math.max(end, window.start)); end = Math.max(end, window.end); }
  return { count: day.windows.length, busyMinutes: busy, active: active.length, density: clamp(busy / CONFIG.dayStream.densityMinutes),
    phase: clamp(minute / 1440), pressure: clamp(active.length * CONFIG.dayStream.overlapPressure), gapMinutes: next ? next.start - minute : 1440 - minute,
    progress: active.length ? clamp((minute - active[0].start) / (active[0].end - active[0].start)) : 0 };
}
