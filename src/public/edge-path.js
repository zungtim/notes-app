// Display-only smoothing. The routed points and the stored graph stay intact.
const SCREEN_RADIUS = 14;
const MAX_WORLD_RADIUS = 80;
const MIN_WORLD_RADIUS = 1e-6;
const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const number = value => value === 0 ? '0' : String(value);
const pair = point => `${number(point.x)} ${number(point.y)}`;

function rectangles(obstacles) {
  return (Array.isArray(obstacles) ? obstacles : []).filter(rect => rect
    && [rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite))
    .map(rect => ({ left: Math.min(rect.left, rect.right), right: Math.max(rect.left, rect.right),
      top: Math.min(rect.top, rect.bottom), bottom: Math.max(rect.top, rect.bottom) }))
    .filter(rect => rect.left < rect.right && rect.top < rect.bottom);
}

// Solve a quadratic relative to the corner, avoiding cancellation from large
// world-space offsets. Stable roots also catch narrow obstacles between samples.
function boundaryRoots(start, end, boundary) {
  const a = start + end, b = -2 * start, c = start - boundary;
  const epsilon = Number.EPSILON * 16 * Math.max(1, Math.abs(a), Math.abs(b));
  if (Math.abs(a) <= epsilon) return Math.abs(b) <= epsilon ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  const q = -.5 * (b + (b < 0 ? -root : root));
  return q === 0 ? [-b / (2 * a)] : [q / a, c / q];
}

function curveEntersRectangle(start, corner, end, rect) {
  if (Math.max(start.x, corner.x, end.x) <= rect.left
    || Math.min(start.x, corner.x, end.x) >= rect.right
    || Math.max(start.y, corner.y, end.y) <= rect.top
    || Math.min(start.y, corner.y, end.y) >= rect.bottom) return false;
  const x0 = start.x - corner.x, x1 = end.x - corner.x;
  const y0 = start.y - corner.y, y1 = end.y - corner.y;
  const left = rect.left - corner.x, right = rect.right - corner.x;
  const top = rect.top - corner.y, bottom = rect.bottom - corner.y;
  const cuts = [0, 1,
    ...boundaryRoots(x0, x1, left), ...boundaryRoots(x0, x1, right),
    ...boundaryRoots(y0, y1, top), ...boundaryRoots(y0, y1, bottom)]
    .filter(t => Number.isFinite(t) && t >= 0 && t <= 1).sort((a, b) => a - b);
  const inside = t => {
    const u = 1 - t, x = u * u * x0 + t * t * x1, y = u * u * y0 + t * t * y1;
    return x > left && x < right && y > top && y < bottom;
  };
  // Between consecutive rectangle-boundary roots, both coordinates keep their
  // inside/outside classification. This checks the entire arc, not a sampling.
  if (inside(0) || inside(1)) return true;
  for (let i = 1; i < cuts.length; i++) if (cuts[i] > cuts[i - 1]
    && inside(cuts[i - 1] + (cuts[i] - cuts[i - 1]) / 2)) return true;
  return false;
}

function cornerPoints(corner, incoming, outgoing, radius) {
  return {
    start: { x: corner.x - incoming.x * radius, y: corner.y - incoming.y * radius },
    end: { x: corner.x + outgoing.x * radius, y: corner.y + outgoing.y * radius },
  };
}

function safeRadius(corner, incoming, outgoing, radius, obstacles) {
  const blocked = value => {
    const { start, end } = cornerPoints(corner, incoming, outgoing, value);
    return obstacles.some(rect => curveEntersRectangle(start, corner, end, rect));
  };
  if (!obstacles.length || !blocked(radius)) return radius;
  let unsafe = radius, safe = radius;
  for (let attempt = 0; attempt < 12; attempt++) {
    safe /= 2;
    if (safe < MIN_WORLD_RADIUS) return 0;
    if (blocked(safe)) { unsafe = safe; continue; }
    // Keep a verified-safe lower candidate at every step. Correctness does not
    // assume that all radii have a monotone relationship with every obstacle.
    for (let refinement = 0; refinement < 10; refinement++) {
      const next = (safe + unsafe) / 2;
      if (blocked(next)) unsafe = next; else safe = next;
    }
    return safe;
  }
  return 0;
}

/** Round display corners by about 14 screen pixels, capped at 80 world units.
 * Tangent points stay on the original adjacent segments and each consumes at
 * most half a segment. Card/label obstacles use world-space rectangle bounds.
 * If an arc cannot be made safe, retain the original routed corner. Existing
 * straight-segment collisions belong to routing and are not repaired here.
 */
export function smoothEdgePath(points, options = {}) {
  const { scale = 1, obstacles = [] } = options || {};
  const valid = [];
  for (const point of Array.isArray(points) ? points : []) {
    if (!finitePoint(point)) continue;
    const previous = valid.at(-1);
    if (!previous || previous.x !== point.x || previous.y !== point.y) valid.push({ x: point.x, y: point.y });
  }
  if (!valid.length) return '';
  const zoom = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const desiredRadius = Math.min(MAX_WORLD_RADIUS, SCREEN_RADIUS / zoom);
  const bounds = rectangles(obstacles);
  const commands = [`M ${pair(valid[0])}`];
  for (let i = 1; i < valid.length - 1; i++) {
    const previous = valid[i - 1], corner = valid[i], next = valid[i + 1];
    const dx0 = corner.x - previous.x, dy0 = corner.y - previous.y;
    const dx1 = next.x - corner.x, dy1 = next.y - corner.y;
    const before = Math.hypot(dx0, dy0), after = Math.hypot(dx1, dy1);
    if (!Number.isFinite(before) || !Number.isFinite(after) || !before || !after) {
      commands.push(`L ${pair(corner)}`); continue;
    }
    const incoming = { x: dx0 / before, y: dy0 / before }, outgoing = { x: dx1 / after, y: dy1 / after };
    if (Math.abs(incoming.x * outgoing.y - incoming.y * outgoing.x) < 1e-10) {
      commands.push(`L ${pair(corner)}`); continue;
    }
    const radius = safeRadius(corner, incoming, outgoing,
      Math.min(desiredRadius, before / 2, after / 2), bounds);
    if (radius < MIN_WORLD_RADIUS) { commands.push(`L ${pair(corner)}`); continue; }
    const { start, end } = cornerPoints(corner, incoming, outgoing, radius);
    commands.push(`L ${pair(start)} Q ${pair(corner)} ${pair(end)}`);
  }
  if (valid.length > 1) commands.push(`L ${pair(valid.at(-1))}`);
  return commands.join(' ');
}
