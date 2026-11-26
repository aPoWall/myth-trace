import { CONFIG } from './config.js';
// Gabriel edges: connect nearby measurements only when their diameter disc is empty.
export function proximityMesh(points, aspect = 1) {
  const { maxNodes, maxSpan, epsilon } = CONFIG.measuredMesh;
  const nodes = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).slice(0, maxNodes);
  const edges = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    const radius = ((b.x - a.x) * aspect) ** 2 / 4 + (b.y - a.y) ** 2 / 4;
    if (radius < epsilon || radius > maxSpan ** 2 / 4) continue;
    const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    if (nodes.some((p,k) => k !== i && k !== j && ((p.x - x) * aspect) ** 2 + (p.y - y) ** 2 < radius - epsilon)) continue;
    edges.push([a,b]);
  }
  return { nodes, edges };
}
