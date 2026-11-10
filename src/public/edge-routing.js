// Pure geometry: this module never reads the DOM or changes notebook data.
const EPS = .01;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const horizontal = (a, b) => Math.abs(a.y - b.y) < EPS;
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const inside = (p, r) => p.x > r.left + EPS && p.x < r.right - EPS && p.y > r.top + EPS && p.y < r.bottom - EPS;
const inflate = (r, n) => ({ ...r, left: r.left - n, right: r.right + n, top: r.top - n, bottom: r.bottom + n });
function crosses(a, b, r) {
  return horizontal(a, b)
    ? a.y > r.top + EPS && a.y < r.bottom - EPS && Math.max(a.x, b.x) > r.left + EPS && Math.min(a.x, b.x) < r.right - EPS
    : a.x > r.left + EPS && a.x < r.right - EPS && Math.max(a.y, b.y) > r.top + EPS && Math.min(a.y, b.y) < r.bottom - EPS;
}
function compact(points) {
  const result = [];
  for (const p of points) {
    if (result.length && distance(result.at(-1), p) < EPS) continue;
    while (result.length > 1) {
      const a = result.at(-2), b = result.at(-1);
      if (((horizontal(a, b) && horizontal(b, p)) || (Math.abs(a.x - b.x) < EPS && Math.abs(b.x - p.x) < EPS)) && (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) >= 0) result.pop();
      else break;
    }
    result.push({ x: p.x, y: p.y });
  }
  return result;
}
function rounded(points) {
  const fmt = n => String(Math.round(n * 10) / 10);
  let d = 'M ' + fmt(points[0].x) + ' ' + fmt(points[0].y);
  for (let i = 1; i < points.length; i++) {
    const c = points[i];
    if (i === points.length - 1) { d += ' L ' + fmt(c.x) + ' ' + fmt(c.y); break; }
    const a = points[i - 1], b = points[i + 1], r = Math.min(10, distance(a, c) / 2, distance(c, b) / 2);
    const q = { x: c.x + Math.sign(a.x - c.x) * r, y: c.y + Math.sign(a.y - c.y) * r };
    const t = { x: c.x + Math.sign(b.x - c.x) * r, y: c.y + Math.sign(b.y - c.y) * r };
    d += ' L ' + fmt(q.x) + ' ' + fmt(q.y) + ' Q ' + fmt(c.x) + ' ' + fmt(c.y) + ' ' + fmt(t.x) + ' ' + fmt(t.y);
  }
  return d;
}
function port(r, side, offset, target) {
  const gap = target ? 4 : 0;
  if (side === 'left' || side === 'right') {
    const sign = side === 'left' ? -1 : 1, x = sign < 0 ? r.left : r.right;
    return { side, point: { x: x + sign * gap, y: r.cy + offset }, stub: { x: x + sign * 18, y: r.cy + offset } };
  }
  const sign = side === 'top' ? -1 : 1, y = sign < 0 ? r.top : r.bottom;
  return { side, point: { x: r.cx + offset, y: y + sign * gap }, stub: { x: r.cx + offset, y: y + sign * 18 } };
}
function sides(a, b, link, spreadConnections) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy, gapX = Math.abs(dx) - (a.right - a.left), gapY = Math.abs(dy) - (a.bottom - a.top);
  if (spreadConnections && link.type !== 'parallel' && b.left - a.right > 12) return { source: 'right', target: 'left' };
  if (link.type === 'extends' && dy < -330 && Math.abs(dy) > Math.abs(dx) * 1.5) return { source: 'left', target: 'top', feedback: true };
  if (gapY > 12 && (gapX <= 16 || Math.abs(dy) >= Math.abs(dx) * .9)) return { source: dy >= 0 ? 'bottom' : 'top', target: dy >= 0 ? 'top' : 'bottom' };
  if (gapX > 12) return { source: dx >= 0 ? 'right' : 'left', target: dx >= 0 ? 'left' : 'right' };
  return Math.abs(dy) >= Math.abs(dx) ? { source: dy >= 0 ? 'bottom' : 'top', target: dy >= 0 ? 'top' : 'bottom' } : { source: dx >= 0 ? 'right' : 'left', target: dx >= 0 ? 'left' : 'right' };
}
function clear(points, obstacles) {
  for (let i = 1; i < points.length; i++) for (const r of obstacles) if (crosses(points[i - 1], points[i], r)) return false;
  return true;
}
const stableCompare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function interaction(a, b, c, d) {
  const ah = horizontal(a, b), ch = horizontal(c, d);
  if (ah !== ch) {
    const h1 = ah ? a : c, h2 = ah ? b : d, v1 = ah ? c : a, v2 = ah ? d : b;
    const x = v1.x, y = h1.y;
    if (x < Math.min(h1.x, h2.x) - EPS || x > Math.max(h1.x, h2.x) + EPS
      || y < Math.min(v1.y, v2.y) - EPS || y > Math.max(v1.y, v2.y) + EPS) return null;
    // Shared endpoints are attachment points, not crossings. A turn touching
    // the interior of another line still makes the two routes hard to follow.
    const hEnd = Math.min(Math.abs(x - h1.x), Math.abs(x - h2.x)) < EPS;
    const vEnd = Math.min(Math.abs(y - v1.y), Math.abs(y - v2.y)) < EPS;
    return hEnd && vEnd ? null : { crossing: `${x.toFixed(2)}:${y.toFixed(2)}`, overlap: 0 };
  }
  const separation = ah ? Math.abs(a.y - c.y) : Math.abs(a.x - c.x);
  if (separation >= 6) return null;
  const length = ah
    ? Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))
    : Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
  return length > 12 ? { crossing: null, overlap: length } : null;
}
function lineInteractions(points, previous) {
  let crossings = 0, overlaps = 0, overlapLength = 0;
  for (const line of previous) {
    const locations = new Set();
    for (let i = 1; i < points.length; i++) for (let j = 1; j < line.length; j++) {
      const hit = interaction(points[i - 1], points[i], line[j - 1], line[j]);
      if (hit?.crossing) locations.add(hit.crossing);
      if (hit?.overlap) { overlaps++; overlapLength += hit.overlap; }
    }
    crossings += locations.size;
  }
  return { crossings, overlaps, overlapLength };
}
function interferenceCost(points, previous) {
  const { crossings, overlaps, overlapLength } = lineInteractions(points, previous);
  return crossings * 140 + overlaps * 60 + overlapLength * 1.3;
}
// Grid cells split a long route into short pieces. Ignoring overlaps under
// 12 px or contacts at cell endpoints would make an occupied channel appear
// cheap until the final route is compacted. Charge those pieces continuously;
// the complete-route objective still decides whether to accept the result.
function gridInterferenceCost(a, b, previous) {
  let score = 0;
  const ah = horizontal(a, b);
  for (const line of previous) for (let i = 1; i < line.length; i++) {
    const c = line[i - 1], d = line[i], ch = horizontal(c, d);
    if (ah !== ch) {
      const x = ah ? c.x : a.x, y = ah ? a.y : c.y;
      if (x < Math.min(a.x, b.x) - EPS || x > Math.max(a.x, b.x) + EPS
        || y < Math.min(a.y, b.y) - EPS || y > Math.max(a.y, b.y) + EPS
        || x < Math.min(c.x, d.x) - EPS || x > Math.max(c.x, d.x) + EPS
        || y < Math.min(c.y, d.y) - EPS || y > Math.max(c.y, d.y) + EPS) continue;
      const atCellEnd = distance({ x, y }, a) < EPS || distance({ x, y }, b) < EPS;
      score += atCellEnd ? 70 : 140;
    } else if ((ah ? Math.abs(a.y - c.y) : Math.abs(a.x - c.x)) < 6) {
      const overlap = ah
        ? Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))
        : Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
      score += Math.max(0, overlap) * 1.3;
    }
  }
  return score;
}
function geometryQuality(points) {
  return { bends: Math.max(0, points.length - 2), length: points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0) };
}
function cost(points, previous) {
  const p = compact(points), quality = geometryQuality(p);
  return quality.length + quality.bends * 27 + interferenceCost(p, previous);
}
function withinDetourBudget(points, shortest) {
  const candidate = geometryQuality(points), baseline = geometryQuality(shortest);
  return candidate.length <= baseline.length + Math.max(64, baseline.length * .2) + EPS
    && candidate.bends <= baseline.bends + 2;
}
// The coordinate grid is a fallback for local doglegs blocked by a card.
// A* includes incoming direction in its state to penalize unnecessary bends.
function grid(start, end, obstacles, bounds, previous = []) {
  const channelsX = previous.flatMap(line => line.slice(1).flatMap((p, i) => horizontal(line[i], p) ? [] : [p.x - 12, p.x + 12]));
  const channelsY = previous.flatMap(line => line.slice(1).flatMap((p, i) => horizontal(line[i], p) ? [p.y - 12, p.y + 12] : []));
  const xs = [...new Set([start.x, end.x, bounds.minX - 28, bounds.maxX + 28, ...obstacles.flatMap(r => [r.left - 2, r.right + 2]), ...channelsX])].sort((a, b) => a - b);
  const ys = [...new Set([start.y, end.y, bounds.minY - 28, bounds.maxY + 28, ...obstacles.flatMap(r => [r.top - 2, r.bottom + 2]), ...channelsY])].sort((a, b) => a - b);
  const width = xs.length, startCell = ys.indexOf(start.y) * width + xs.indexOf(start.x), endCell = ys.indexOf(end.y) * width + xs.indexOf(end.x);
  const point = cell => ({ x: xs[cell % width], y: ys[Math.floor(cell / width)] });
  const heap = [], best = new Map(), parents = new Map(), checks = new Map(), penalties = new Map();
  const push = v => { heap.push(v); let i = heap.length - 1; while (i > 0) { const p = Math.floor((i - 1) / 2); if (heap[p].priority <= v.priority) break; heap[i] = heap[p]; i = p; } heap[i] = v; };
  const pop = () => { const top = heap[0], v = heap.pop(); if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let c = i * 2 + 1; if (c + 1 < heap.length && heap[c + 1].priority < heap[c].priority) c++; if (heap[c].priority >= v.priority) break; heap[i] = heap[c]; i = c; } heap[i] = v; } return top; };
  for (const direction of [0, 1]) { const key = startCell * 2 + direction; best.set(key, 0); push({ key, cost: 0, priority: distance(start, end) }); }
  let found, steps = 0;
  while (heap.length && steps++ < 28000) {
    const current = pop(); if (current.cost !== best.get(current.key)) continue;
    const cell = Math.floor(current.key / 2), direction = current.key % 2;
    if (cell === endCell) { found = current.key; break; }
    const row = Math.floor(cell / width), col = cell % width, a = point(cell), neighbors = [];
    if (col > 0) neighbors.push([cell - 1, 0]); if (col + 1 < width) neighbors.push([cell + 1, 0]);
    if (row > 0) neighbors.push([cell - width, 1]); if (row + 1 < ys.length) neighbors.push([cell + width, 1]);
    for (const [next, orientation] of neighbors) {
      const b = point(next), segment = Math.min(cell, next) + ':' + Math.max(cell, next);
      if (!checks.has(segment)) checks.set(segment, !obstacles.some(r => inside(b, r) || crosses(a, b, r)));
      if (!checks.get(segment)) continue;
      if (!penalties.has(segment)) penalties.set(segment, gridInterferenceCost(a, b, previous));
      const key = next * 2 + orientation, score = current.cost + distance(a, b) + (direction === orientation ? 0 : 27) + penalties.get(segment);
      if (score >= (best.get(key) ?? Infinity)) continue;
      best.set(key, score); parents.set(key, current.key); push({ key, cost: score, priority: score + distance(b, end) });
    }
  }
  if (found === undefined) return null;
  const result = [];
  for (let key = found; key !== undefined; key = parents.get(key)) result.push(point(Math.floor(key / 2)));
  return compact(result.reverse());
}
function candidates(a, b, obstacles, bounds, feedback, lane, previous = []) {
  const result = [];
  if (feedback) {
    const x = bounds.minX - 42 - lane * 12, y = bounds.minY - 30 - lane * 12;
    result.push([a, { x, y: a.y }, { x, y }, { x: b.x, y }, b]);
  }
  if (horizontal(a, b) || Math.abs(a.x - b.x) < EPS) result.push([a, b]);
  result.push([a, { x: b.x, y: a.y }, b], [a, { x: a.x, y: b.y }, b]);
  const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
  const channelsX = previous.flatMap(line => line.slice(1).flatMap((p, i) => horizontal(line[i], p) ? [] : [p.x - 12, p.x + 12]));
  const channelsY = previous.flatMap(line => line.slice(1).flatMap((p, i) => horizontal(line[i], p) ? [p.y - 12, p.y + 12] : []));
  const xs = [...new Set([midX, Math.min(a.x, b.x) - 26, Math.max(a.x, b.x) + 26, ...obstacles.flatMap(r => [r.left - 2, r.right + 2]), ...channelsX])].sort((x, y) => Math.abs(x - midX) - Math.abs(y - midX) || x - y).slice(0, 24);
  const ys = [...new Set([midY, Math.min(a.y, b.y) - 26, Math.max(a.y, b.y) + 26, ...obstacles.flatMap(r => [r.top - 2, r.bottom + 2]), ...channelsY])].sort((x, y) => Math.abs(x - midY) - Math.abs(y - midY) || x - y).slice(0, 24);
  for (const x of xs) result.push([a, { x, y: a.y }, { x, y: b.y }, b]);
  for (const y of ys) result.push([a, { x: a.x, y }, { x: b.x, y }, b]);
  return result;
}
function placeLabel(points, width, height, obstacles, occupied, hidden, otherLines, preferHorizontal = false) {
  const fallback = points[Math.floor(points.length / 2)] || { x: 0, y: 0 };
  if (hidden) return { label: { ...fallback }, labelAnchor: { ...fallback }, labelLeader: null, labelLeaderPath: null, labelVisible: false, labelOrientation: 'horizontal', labelDiagnostic: 'hidden-by-view' };
  const choices = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], h = horizontal(a, b), size = distance(a, b);
    if (size < 12) continue;
    for (const t of [.5, .55, .45, .35, .65]) {
      const anchor = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const score = (preferHorizontal ? (h ? 100000 + i * 1000 + Math.min(size, 400) : Math.min(size, 500))
        : Math.min(size, 500) + (h ? 350 : 0)) - Math.abs(t - .5) * 45;
      if (size >= (h ? width + 4 : height + 2)) choices.push({ ...anchor, anchor, score, orientation: h ? 'horizontal' : 'vertical' });
      // Short spaces between cards often cannot hold the full explanation on
      // the line. Prefer a nearby horizontal label, with a short leader back to
      // its own route; wider offsets are a last resort around adjacent cards.
      const offsets = h ? [height / 2 + 8, height / 2 + 18, height / 2 + 35, height / 2 + 72]
        : [width / 2 + 8, width / 2 + 18, width / 2 + 35, width / 2 + 144];
      for (const offset of offsets) for (const sign of [-1, 1]) {
        const x = anchor.x + (h ? 0 : sign * offset), y = anchor.y + (h ? sign * offset : 0);
        const end = h ? { x, y: y - sign * height / 2 } : { x: x - sign * width / 2, y };
        choices.push({ x, y, anchor, leader: [anchor, end], score: score - 65 - offset * 1.5, orientation: h ? 'horizontal' : 'vertical' });
      }
    }
  }
  choices.sort((a, b) => b.score - a.score);
  for (const candidate of choices) {
    const padding = preferHorizontal ? 6 : 1;
    const box = { left: candidate.x - width / 2 - padding, right: candidate.x + width / 2 + padding, top: candidate.y - height / 2 - padding, bottom: candidate.y + height / 2 + padding };
    const overlaps = r => box.left < r.right && box.right > r.left && box.top < r.bottom && box.bottom > r.top;
    if (obstacles.some(overlaps) || occupied.some(overlaps)
      || otherLines.some(line => line.slice(1).some((p, i) => crosses(line[i], p, inflate(box, 2))))) continue;
    if (candidate.leader && (!clear(candidate.leader, obstacles) || !clear(candidate.leader, occupied)
      || interferenceCost(candidate.leader, otherLines) > 0
      || points.slice(1).some((p, i) => crosses(points[i], p, box)))) continue;
    occupied.push(box);
    if (candidate.leader) for (let i = 1; i < candidate.leader.length; i++) {
      const a = candidate.leader[i - 1], b = candidate.leader[i];
      occupied.push({ left: Math.min(a.x, b.x) - 2, right: Math.max(a.x, b.x) + 2, top: Math.min(a.y, b.y) - 2, bottom: Math.max(a.y, b.y) + 2 });
    }
    // Text remains horizontal even when its anchor is on a vertical segment.
    return { label: { x: candidate.x, y: candidate.y }, labelAnchor: { ...candidate.anchor }, labelLeader: candidate.leader || null,
      labelLeaderPath: candidate.leader ? rounded(candidate.leader) : null, labelVisible: true, labelOrientation: 'horizontal', labelAnchorOrientation: candidate.orientation, labelDiagnostic: null };
  }
  return { label: { ...fallback }, labelAnchor: { ...fallback }, labelLeader: null, labelLeaderPath: null, labelVisible: false, labelOrientation: 'horizontal', labelDiagnostic: 'no-clear-space' };
}

/** Pairwise route interference is counted once per pair/location. Overlaps are
 * close parallel segments (under 6 px apart) sharing more than 12 px, rather
 * than a claim that every mathematical intersection has been eliminated.
 */
export function measureRouteQuality(routes) {
  const entries = [...routes.values()];
  const totals = { routes: entries.length, crossings: 0, overlaps: 0, overlapLength: 0, bends: 0, length: 0, obstructed: 0, hiddenLabels: 0 };
  entries.forEach((route, index) => {
    const geometry = geometryQuality(route.points), interactions = lineInteractions(route.points, entries.slice(index + 1).map(other => other.points));
    for (const key of ['crossings', 'overlaps', 'overlapLength']) totals[key] += interactions[key];
    totals.bends += geometry.bends; totals.length += geometry.length;
    if (route.obstructed) totals.obstructed++;
    if (!route.labelVisible && route.labelDiagnostic !== 'hidden-by-view') totals.hiddenLabels++;
  });
  return totals;
}

export function routeGraphEdges({ nodes = [], links = [], nodeWidth = 244, nodeHeight = 108, refinementLimit = 8, preferStraightSequence = false, spreadConnections = false } = {}) {
  const width = Math.max(20, finite(nodeWidth)), height = Math.max(20, finite(nodeHeight));
  const rects = nodes.map(n => { const x = finite(n.x), y = finite(n.y); return { id: n.id, left: x, right: x + width, top: y, bottom: y + height, cx: x + width / 2, cy: y + height / 2 }; }).sort((a, b) => stableCompare(String(a.id), String(b.id)));
  const byId = new Map(rects.map(r => [r.id, r]));
  const bounds = rects.length ? { minX: Math.min(...rects.map(r => r.left)), minY: Math.min(...rects.map(r => r.top)), maxX: Math.max(...rects.map(r => r.right)), maxY: Math.max(...rects.map(r => r.bottom)) } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const obstacles = rects.map(r => inflate(r, 12)), labelObstacles = rects.map(r => inflate(r, 1));
  const work = links.filter(l => byId.has(l.from) && byId.has(l.to))
    .map(link => ({ link, key: JSON.stringify([link.id, link.from, link.to, link.type, link.label]), a: byId.get(link.from), b: byId.get(link.to), sides: sides(byId.get(link.from), byId.get(link.to), link, spreadConnections) }))
    .sort((a, b) => stableCompare(a.key, b.key)).map((item, index) => ({ ...item, index }));
  const groups = new Map(), offsets = new Map();
  for (const item of work) for (const endpoint of ['source', 'target']) {
    const r = endpoint === 'source' ? item.a : item.b, side = item.sides[endpoint], key = r.id + ':' + side;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ item, endpoint, other: endpoint === 'source' ? item.b : item.a });
  }
  for (const group of groups.values()) {
    const side = group[0].item.sides[group[0].endpoint], v = side === 'top' || side === 'bottom';
    group.sort((a, b) => (v ? a.other.cx - b.other.cx : a.other.cy - b.other.cy) || stableCompare(a.item.key, b.item.key));
    // Preserve the clean reading path's centre port even when supplementary
    // relationships attach to the same side of its cards.
    const alignedSequence = preferStraightSequence && !v
      ? group.filter(entry => entry.item.link.type === 'sequence' && Math.abs(entry.item.a.cy - entry.item.b.cy) < EPS) : [];
    if (alignedSequence.length === 1) {
      const centre = group.indexOf(alignedSequence[0]), sideCount = Math.max(centre, group.length - centre - 1);
      const spacing = Math.min(24, Math.max(0, (height - 42) / 2) / Math.max(1, sideCount));
      group.forEach((entry, i) => offsets.set(entry.item.index + ':' + entry.endpoint, (i - centre) * spacing));
      continue;
    }
    const portSpacing = spreadConnections ? Math.max(28, ...group.map(entry => finite(entry.item.link.labelHeight) + 12)) : 24;
    const spread = Math.min(v ? width - 58 : height - (spreadConnections ? 32 : 42), Math.max(0, group.length - 1) * portSpacing);
    group.forEach((entry, i) => offsets.set(entry.item.index + ':' + entry.endpoint, group.length === 1 ? 0 : -spread / 2 + i * spread / (group.length - 1)));
  }
  const channelGroups = new Map(), outgoing = new Map(), incoming = new Map(), channels = new Map();
  if (spreadConnections) for (const item of work) {
    if (item.sides.source !== 'right' || item.sides.target !== 'left' || item.b.left <= item.a.right) continue;
    const key = item.a.right + ':' + item.b.left;
    if (!channelGroups.has(key)) channelGroups.set(key, []);
    channelGroups.get(key).push(item);
    outgoing.set(item.a.id, (outgoing.get(item.a.id) || 0) + 1);
    incoming.set(item.b.id, (incoming.get(item.b.id) || 0) + 1);
  }
  for (const group of channelGroups.values()) {
    const labelWidth = Math.max(...group.map(item => finite(item.link.labelWidth) || 56));
    const room = group[0].b.left - group[0].a.right - labelWidth - 72;
    if (room < 0) continue;
    const score = item => Math.abs(item.b.cy - item.a.cy) * (outgoing.get(item.a.id) >= incoming.get(item.b.id) ? -1 : 1);
    group.sort((a, b) => score(a) - score(b) || a.a.cy - b.a.cy || a.b.cy - b.b.cy || stableCompare(a.key, b.key));
    const spacing = Math.min(28, room / Math.max(1, group.length - 1));
    group.forEach((item, index) => channels.set(item.index, item.a.right + 36 + index * spacing));
  }
  const routes = new Map(), previous = [], occupied = [];
  const ordered = [...work].sort((a, b) => Number(a.sides.feedback || false) - Number(b.sides.feedback || false) || distance({ x: a.a.cx, y: a.a.cy }, { x: a.b.cx, y: a.b.cy }) - distance({ x: b.a.cx, y: b.a.cy }, { x: b.b.cx, y: b.b.cy }) || stableCompare(a.key, b.key));
  function choose(item, otherLines, allowGrid = false) {
    const { index, a, b, sides: s, link } = item;
    const source = port(a, s.source, offsets.get(index + ':source') || 0, false), target = port(b, s.target, offsets.get(index + ':target') || 0, true);
    let points;
    if (a.id === b.id) {
      source.side = 'right'; target.side = 'top';
      points = [{ x: a.right, y: a.cy - 16 }, { x: a.right + 34, y: a.cy - 16 }, { x: a.right + 34, y: a.top - 32 }, { x: a.cx + 35, y: a.top - 32 }, { x: a.cx + 35, y: a.top - 4 }];
    } else {
      const options = candidates(source.stub, target.stub, obstacles, bounds, s.feedback, index, otherLines);
      const full = p => compact([source.point, ...p, target.point]);
      const channel = channels.get(index);
      const dedicated = channel == null ? null : [source.stub, { x: channel, y: source.stub.y }, { x: channel, y: target.stub.y }, target.stub];
      const straight = s.source !== s.target && ((['left', 'right'].includes(s.source) && ['left', 'right'].includes(s.target) && Math.abs(source.point.y - target.point.y) < EPS)
        || (['top', 'bottom'].includes(s.source) && ['top', 'bottom'].includes(s.target) && Math.abs(source.point.x - target.point.x) < EPS))
        ? [source.point, target.point] : null;
      if (straight && clear(straight, rects)) points = straight;
      else {
        // Assigned fan-out lanes and returning extensions are useful starting
        // routes, but must compete with local alternatives when lines collide.
        // Put the dedicated lane first to retain it when complete costs tie.
        const clearOptions = [...(dedicated ? [dedicated] : []), ...options]
          .filter(p => clear(p, obstacles) && clear(full(p), rects)).map(full);
        if (!clearOptions.length) {
          const baseline = grid(source.stub, target.stub, obstacles, bounds);
          if (baseline && clear(full(baseline), rects)) clearOptions.push(full(baseline));
        }
        const shortest = [...clearOptions].sort((a, b) => cost(a, []) - cost(b, []))[0];
        points = clearOptions.filter(p => withinDetourBudget(p, shortest))
          .map(p => ({ p, score: cost(p, otherLines) })).sort((a, b) => a.score - b.score)[0]?.p;
        if (allowGrid) {
          const alternative = grid(source.stub, target.stub, obstacles, bounds, otherLines);
          if (alternative && clear(full(alternative), rects) && (!shortest || withinDetourBudget(full(alternative), shortest))
            && (!points || cost(full(alternative), otherLines) < cost(points, otherLines) - EPS)) points = full(alternative);
        }
        if (!points) points = full([source.stub, { x: target.stub.x, y: source.stub.y }, target.stub]);
      }
    }
    points = compact(points);
    const obstructions = rects.filter(r => !clear(points, [r])).length;
    return { points, sourcePort: source.side, targetPort: target.side, obstructed: obstructions > 0, obstructions };
  }
  for (const item of ordered) {
    const route = choose(item, previous);
    routes.set(item.link.id, route); previous.push(route.points);
  }
  const allLines = id => [...routes].filter(([other]) => other !== id).map(([, r]) => r.points);
  const hiddenLabelCount = () => {
    const boxes = [];
    let count = 0;
    for (const { link } of ordered) {
      const labelWidth = Math.max(28, Math.min(220, finite(link.labelWidth) || 42)), labelHeight = Math.max(16, Math.min(80, finite(link.labelHeight) || 22));
      const placement = placeLabel(routes.get(link.id).points, labelWidth, labelHeight, labelObstacles, boxes, Boolean(link.hideLabel), allLines(link.id), spreadConnections);
      if (!placement.labelVisible && !link.hideLabel) count++;
    }
    return count;
  };
  // Revisit a bounded set of troublesome routes after all channels are known.
  // Each accepted update reduces its global pairwise cost; old paths remain a
  // candidate, so this cannot make that objective worse. Large graphs skip A*.
  const ranked = ordered.map(item => ({ item, score: interferenceCost(routes.get(item.link.id).points, [...routes].filter(([id]) => id !== item.link.id).map(([, r]) => r.points)) }))
    .filter(entry => entry.score > 0).sort((a, b) => b.score - a.score || stableCompare(a.item.key, b.item.key)).slice(0, Math.max(0, Math.min(8, Math.floor(finite(refinementLimit)))));
  for (const { item } of ranked) {
    const current = routes.get(item.link.id), others = [...routes].filter(([id]) => id !== item.link.id).map(([, r]) => r.points);
    const candidate = choose(item, others, work.length <= 24);
    if (!candidate.obstructed && (current.obstructed || cost(candidate.points, others) < cost(current.points, others) - EPS)) routes.set(item.link.id, candidate);
  }
  // Cross-card detours can reverse the arrival order implied by card centres.
  // Try a bounded number of endpoint-slot swaps instead of guessing a new
  // universal ordering. Accept only a strict improvement of the whole graph;
  // failed probes restore both slots and routes. Clear straight lines keep
  // their ports, and large graphs retain the inexpensive routing path.
  const swapLimit = work.length <= 16 ? Math.min(12, Math.max(0, Math.floor(finite(refinementLimit))) * 3) : 0;
  if (swapLimit) {
    const trouble = new Map(work.map(item => [item.link.id, interferenceCost(routes.get(item.link.id).points, allLines(item.link.id))]));
    const pairs = [];
    for (const [key, group] of groups) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j], score = trouble.get(a.item.link.id) + trouble.get(b.item.link.id);
      if (score > 0 && a.endpoint === b.endpoint && a.item !== b.item) pairs.push({ a, b, score, key: JSON.stringify([key, a.item.key, b.item.key]) });
    }
    pairs.sort((a, b) => b.score - a.score || stableCompare(a.key, b.key));
    const completeCost = () => {
      const seen = [];
      let score = 0;
      for (const route of routes.values()) { score += cost(route.points, seen); seen.push(route.points); }
      return score;
    };
    let objective = completeCost(), hiddenLabels = hiddenLabelCount(), probes = 0;
    for (const { a, b } of pairs) {
      if (probes >= swapLimit) break;
      const idA = a.item.link.id, idB = b.item.link.id, oldA = routes.get(idA), oldB = routes.get(idB);
      if (oldA.points.length === 2 || oldB.points.length === 2) continue;
      const keyA = a.item.index + ':' + a.endpoint, keyB = b.item.index + ':' + b.endpoint;
      const offsetA = offsets.get(keyA), offsetB = offsets.get(keyB);
      if (Math.abs(offsetA - offsetB) < EPS) continue;
      probes++;
      offsets.set(keyA, offsetB); offsets.set(keyB, offsetA);
      const candidateA = choose(a.item, allLines(idA), true);
      routes.set(idA, candidateA);
      const candidateB = choose(b.item, allLines(idB), true);
      routes.set(idB, candidateB);
      const next = candidateA.obstructed || candidateB.obstructed ? Infinity : completeCost();
      const nextHidden = next < objective - EPS ? hiddenLabelCount() : Infinity;
      if (next < objective - EPS && nextHidden <= hiddenLabels) { objective = next; hiddenLabels = nextHidden; }
      else {
        offsets.set(keyA, offsetA); offsets.set(keyB, offsetB);
        routes.set(idA, oldA); routes.set(idB, oldB);
      }
    }
  }
  // A small difference between independently spread ports creates a visible
  // two-corner step even in an empty corridor. Slide only those attachments,
  // never cards: use the shared usable part of their facing sides, keeping
  // at least 16 units between neighbouring ports. This is independent
  // of zoom, so scrolling cannot change attachment points or label layout.
  const slideRange = (item, endpoint, axis, value) => {
    const card = endpoint === 'source' ? item.a : item.b, side = item.sides[endpoint];
    const centre = axis === 'y' ? card.cy : card.cx;
    const span = Math.max(0, axis === 'y' ? height - (spreadConnections ? 32 : 42) : width - 58);
    let low = centre - span / 2, high = centre + span / 2;
    if (preferStraightSequence && axis === 'y' && item.link.type === 'sequence' && Math.abs(item.a.cy - item.b.cy) < EPS) return { low: value, high: value };
    for (const entry of groups.get(card.id + ':' + side)) {
      if (entry.item === item && entry.endpoint === endpoint) continue;
      const position = centre + (offsets.get(entry.item.index + ':' + entry.endpoint) || 0);
      if (position < value - EPS) low = Math.max(low, position + 16);
      else if (position > value + EPS) high = Math.min(high, position - 16);
      else return { low: 1, high: 0 };
    }
    return { low, high };
  };
  let snapHiddenLabels;
  for (const item of ordered) {
    const current = routes.get(item.link.id), first = current.points[0], last = current.points.at(-1), s = item.sides;
    if (current.obstructed || current.points.length <= 2) continue;
    const axis = (s.source === 'right' && s.target === 'left' && item.b.left > item.a.right
      || s.source === 'left' && s.target === 'right' && item.b.right < item.a.left) ? 'y'
      : (s.source === 'bottom' && s.target === 'top' && item.b.top > item.a.bottom
        || s.source === 'top' && s.target === 'bottom' && item.b.bottom < item.a.top) ? 'x' : null;
    if (!axis || Math.abs(first[axis] - last[axis]) < EPS) continue;
    const sourceRange = slideRange(item, 'source', axis, first[axis]), targetRange = slideRange(item, 'target', axis, last[axis]);
    const low = Math.max(sourceRange.low, targetRange.low), high = Math.min(sourceRange.high, targetRange.high);
    if (low > high) continue;
    const clamp = value => Math.max(low, Math.min(high, value));
    const choices = [...new Set([clamp((first[axis] + last[axis]) / 2), clamp(first[axis]), clamp(last[axis])])];
    const others = allLines(item.link.id), before = lineInteractions(current.points, others);
    for (const value of choices) {
      const points = [{ ...first, [axis]: value }, { ...last, [axis]: value }];
      if (!clear(points, rects) || !clear(points, obstacles.filter(r => r.id !== item.a.id && r.id !== item.b.id))) continue;
      const after = lineInteractions(points, others);
      if (after.crossings > before.crossings || after.overlaps > before.overlaps || after.overlapLength > before.overlapLength + EPS
        || cost(points, others) >= cost(current.points, others) - EPS) continue;
      snapHiddenLabels ??= hiddenLabelCount();
      routes.set(item.link.id, { ...current, points });
      const nextHidden = hiddenLabelCount();
      if (nextHidden > snapHiddenLabels) { routes.set(item.link.id, current); continue; }
      snapHiddenLabels = nextHidden;
      offsets.set(item.index + ':source', value - (axis === 'y' ? item.a.cy : item.a.cx));
      offsets.set(item.index + ':target', value - (axis === 'y' ? item.b.cy : item.b.cx));
      break;
    }
  }
  // Labels are placed after routing, so they avoid future as well as prior
  // routes, in addition to cards and already reserved labels.
  for (const { link } of ordered) {
    const route = routes.get(link.id), points = route.points, otherLines = [...routes].filter(([id]) => id !== link.id).map(([, other]) => other.points);
    const labelWidth = Math.max(28, Math.min(220, finite(link.labelWidth) || 42)), labelHeight = Math.max(16, Math.min(80, finite(link.labelHeight) || 22));
    const placement = placeLabel(points, labelWidth, labelHeight, labelObstacles, occupied, Boolean(link.hideLabel), otherLines, spreadConnections);
    const routeBounds = { minX: Math.min(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxX: Math.max(...points.map(p => p.x)), maxY: Math.max(...points.map(p => p.y)) };
    if (placement.labelVisible) {
      routeBounds.minX = Math.min(routeBounds.minX, placement.label.x - labelWidth / 2); routeBounds.maxX = Math.max(routeBounds.maxX, placement.label.x + labelWidth / 2);
      routeBounds.minY = Math.min(routeBounds.minY, placement.label.y - labelHeight / 2); routeBounds.maxY = Math.max(routeBounds.maxY, placement.label.y + labelHeight / 2);
      for (const p of placement.labelLeader || []) {
        routeBounds.minX = Math.min(routeBounds.minX, p.x); routeBounds.maxX = Math.max(routeBounds.maxX, p.x);
        routeBounds.minY = Math.min(routeBounds.minY, p.y); routeBounds.maxY = Math.max(routeBounds.maxY, p.y);
      }
    }
    const quality = { ...geometryQuality(points), ...lineInteractions(points, otherLines), obstructions: route.obstructions };
    const issues = [];
    if (route.obstructed) issues.push('obstructed');
    if (quality.crossings) issues.push('crossing');
    if (quality.overlaps) issues.push('shared-channel');
    if (placement.labelDiagnostic === 'no-clear-space') issues.push('label-no-space');
    routes.set(link.id, { ...route, path: rounded(points), ...placement, labelWidth, labelHeight, bounds: routeBounds, quality, issues });
  }
  return routes;
}
