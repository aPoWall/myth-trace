const KEY = 'mythtrace.experiments.v1';
const VALID_ID = /^[a-z0-9][a-z0-9-]{1,55}$/;
const LIMIT = 75;

export function createVersionLibrary(storage, presets) {
  let saved;
  let proposals = [];
  const entries = Object.entries(presets.looks).map(([id, look]) => ({
    key: 'look:' + id, id, title: look.name, kind: 'look',
  }));
  for (const [id, item] of Object.entries(presets.geometries)) {
    entries.push({ key: 'geo:' + id, id, title: item.study ? item.name : 'Geometry · ' + item.name,
      kind: 'geo', group: item.study ? 'Tracking Studies' : '', note: item.note, source: item.source });
  }
  for (const [id, title] of Object.entries(presets.sacred.shapes)) {
    if (id !== 'off' && id !== 'auto') entries.push({ key: 'sacred:' + id, id, title: 'Sacred layer · ' + title, kind: 'sacred' });
  }
  for (const [id, story] of Object.entries(presets.stories || {})) {
    entries.push({ key: 'story:' + id, id, title: story.name, kind: 'story', group: 'Scene cards', note: story.move });
  }
  try { saved = JSON.parse(storage?.getItem(KEY) || '{}'); } catch {}
  const hidden = new Set(Array.isArray(saved?.hidden) ? saved.hidden.filter(key => typeof key === 'string').slice(-LIMIT) : []);
  let history = Array.isArray(saved?.history) ? saved.history.filter(item => item && typeof item.label === 'string').slice(-LIMIT) : [];
  const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';

  function remember(action, label) {
    history = [...history.slice(-LIMIT + 1), { timestamp: new Date().toISOString(), action, label }];
    try { storage?.setItem(KEY, JSON.stringify({ hidden: Array.from(hidden).slice(-LIMIT), history })); } catch {}
  }

  function ingest(data) {
    if (!Array.isArray(data?.proposals)) return;
    const received = new Map();
    for (const entry of data.proposals.slice(0, 20)) {
      const id = text(entry?.id, 56);
      const title = text(entry?.title, 55);
      if (!VALID_ID.test(id) || !title || received.has(id)) continue;
      const look = entry.look;
      const geo = entry.geometry;
      const sacred = entry.sacred;
      if (!Object.hasOwn(presets.looks, look) || !Object.hasOwn(presets.geometries, geo)
        || !Object.hasOwn(presets.sacred.shapes, sacred)) continue;
      received.set(id, { key: 'proposal:' + id, id, title, kind: 'proposal', look, geo, sacred,
        note: text(entry.note, 210), source: text(entry.source, 220) });
    }
    const next = [...received.values()];
    if (JSON.stringify(next) === JSON.stringify(proposals)) return false;
    proposals = next;
    return true;
  }

  function list() { return [...entries, ...proposals].map(entry => ({ ...entry, archived: hidden.has(entry.key) })); }
  function setArchived(key, archived) {
    const entry = list().find(item => item.key === key);
    if (!entry || entry.archived === archived) return;
    if (archived) hidden.add(key);
    else hidden.delete(key);
    remember(archived ? 'archive' : 'restore', entry.title);
  }
  return { ingest, list, setArchived, remember, archived: key => hidden.has(key), history: () => history };
}
