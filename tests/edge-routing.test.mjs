import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { routeGraphEdges, measureRouteQuality } from '../src/public/edge-routing.js';

const edge = (id, from, to, type = 'applies', extra = {}) => ({ id, from, to, type, ...extra });
const node = (id, x, y) => ({ id, x, y });
const routes = (nodes, links) => routeGraphEdges({ nodes, links, nodeWidth: 244, nodeHeight: 108 });
const segmentIntersects = (a, b, r) => Math.abs(a.y - b.y) < .01
  ? a.y > r.y && a.y < r.y + 108 && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + 244
  : a.x > r.x && a.x < r.x + 244 && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + 108;
function assertGeometry(route, nodes, endpoints = []) {
  assert.ok(route && route.path && !/NaN|Infinity|undefined/.test(route.path));
  assert.equal(route.obstructed, false);
  for (const p of route.points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1], b = route.points[i];
    assert.ok(Math.abs(a.x - b.x) < .01 || Math.abs(a.y - b.y) < .01, 'Orthogonal segment');
    for (const r of nodes) if (!endpoints.includes(r.id)) assert.equal(segmentIntersects(a, b, r), false, 'Avoid card ' + r.id);
  }
  if (route.labelVisible) {
    const box = { x: route.label.x - route.labelWidth / 2, y: route.label.y - route.labelHeight / 2, right: route.label.x + route.labelWidth / 2, bottom: route.label.y + route.labelHeight / 2 };
    for (const r of nodes) assert.ok(!(box.x < r.x + 244 && box.right > r.x && box.y < r.y + 108 && box.bottom > r.y), 'Label avoids ' + r.id);
  }
}

test('Aligned short vertical and horizontal connections stay straight', () => {
  for (const nodes of [[node('a', 0, 0), node('b', 0, 150)], [node('a', 0, 0), node('b', 320, 0)]]) {
    const route = routes(nodes, [edge('e', 'a', 'b', 'prerequisite', { labelWidth: 68, labelHeight: 36 })]).get('e');
    assertGeometry(route, nodes, ['a', 'b']); assert.equal(route.points.length, 2);
    assert.equal(route.labelVisible, true);
  }
});

test('Small horizontal and vertical offsets straighten at the card sides without moving cards', () => {
  const cases = [
    [node('a', 0, 0), node('b', 560, 16)],
    [node('a', 0, 0), node('b', 16, 360)],
    [node('a', 560, 16), node('b', 0, 0)],
    [node('a', 16, 360), node('b', 0, 0)],
  ];
  for (const nodes of cases) {
    const links = [edge('ab', 'a', 'b', 'applies', { label: 'Synthetic application' })];
    const input = structuredClone({ nodes, links });
    const route = routes(nodes, links).get('ab');
    assertGeometry(route, nodes, ['a', 'b']);
    assert.equal(route.points.length, 2, 'A small attachment mismatch does not need a dogleg');
    assert.equal(route.quality.bends, 0);
    const first = route.points[0], last = route.points.at(-1);
    assert.ok(first.x === last.x || first.y === last.y);
    const axis = first.y === last.y ? 'y' : 'x', half = axis === 'y' ? 54 : 122;
    assert.ok(Math.abs(first[axis] - nodes[0][axis] - half) <= 16);
    assert.ok(Math.abs(last[axis] - nodes[1][axis] - half) <= 16);
    assert.deepEqual({ nodes, links }, input);
  }
});

test('Unequal fan-out ports can align a near-horizontal edge while keeping neighbours separate', () => {
  const nodes = [node('a', 0, 0), node('b', 560, 0), node('side', 560, 220)];
  const links = [edge('ab', 'a', 'b'), edge('side', 'a', 'side')];
  const options = { nodes, links, nodeWidth: 300, nodeHeight: 168, spreadConnections: true };
  const result = routeGraphEdges(options), direct = result.get('ab');
  assert.equal(direct.points.length, 2);
  assert.equal(direct.points[0].y, direct.points[1].y);
  assert.ok(Math.abs(direct.points[0].y - result.get('side').points[0].y) >= 16);
  assert.equal(result.size, links.length);
  assert.deepEqual([...result], [...routeGraphEdges({ ...options, nodes: [...nodes].reverse(), links: [...links].reverse() })]);
});

test('Larger drag offsets straighten whenever facing card sides still have a common safe span', () => {
  for (const offset of [40, 72, 110]) {
    const nodes = [node('a', 0, 0), node('b', 560, offset)];
    const links = [edge('ab', 'a', 'b', 'applies', { labelWidth: 120, labelHeight: 32 })];
    const snapshot = structuredClone({ nodes, links });
    const route = routeGraphEdges({ nodes, links, nodeWidth: 300, nodeHeight: 168, spreadConnections: true }).get('ab');
    assert.equal(route.points.length, 2);
    assert.equal(route.points[0].y, route.points[1].y);
    assert.ok(route.points[0].y >= offset + 16 && route.points[0].y <= 168 - 16);
    assert.equal(route.obstructed, false); assert.equal(route.labelVisible, true);
    assert.deepEqual({ nodes, links }, snapshot);
  }
  const separate = routeGraphEdges({ nodes: [node('a', 0, 0), node('b', 560, 220)], links: [edge('ab', 'a', 'b')], nodeWidth: 300, nodeHeight: 168, spreadConnections: true }).get('ab');
  assert.ok(separate.points.length > 2, 'Cards with no shared side span still need a turn');
});

test('Straightening retains distinct relationships between the same two cards', () => {
  const nodes = [node('a', 0, 0), node('b', 560, 16)];
  const links = [edge('application', 'a', 'b'), edge('evidence', 'a', 'b', 'evidence')];
  const result = routeGraphEdges({ nodes, links, spreadConnections: true });
  assert.equal(result.size, 2);
  const [a, b] = result.values();
  for (const route of result.values()) { assertGeometry(route, nodes, ['a', 'b']); assert.equal(route.points.length, 2); }
  assert.ok(Math.abs(a.points[0].y - b.points[0].y) >= 16);
  assert.ok(Math.abs(a.points.at(-1).y - b.points.at(-1).y) >= 16);
});

test('An obstructed common corridor and substantial card offsets keep their necessary turns', () => {
  const blocked = [node('a', 0, 0), node('b', 1000, 16), node('middle', 500, 45)];
  const route = routes(blocked, [edge('ab', 'a', 'b')]).get('ab');
  assertGeometry(route, blocked, ['a', 'b']);
  assert.ok(route.points.length > 2, 'Straightening must not cut through the middle card');
  const offset = routes([node('a', 0, 0), node('b', 560, 90)], [edge('ab', 'a', 'b')]).get('ab');
  assert.ok(offset.points.length > 2, 'A large offset is a real change of direction');
});
test('Clear straight knowledge lines keep their direct corridor when other relationships cross it', () => {
  const nodes = [node('a', 0, 200), node('b', 1400, 200), ...[350, 700, 1050].flatMap((x, i) => [node('top-' + i, x, 120), node('bottom-' + i, x, 350)])];
  const links = [edge('direct', 'a', 'b'), ...[0, 1, 2].map(i => edge('vertical-' + i, 'top-' + i, 'bottom-' + i))];
  const result = routeGraphEdges({ nodes, links, spreadConnections: true });
  const direct = result.get('direct');
  assert.equal(result.size, links.length);
  assert.equal(direct.quality.bends, 0);
  assert.equal(direct.quality.length, 1152);
  for (const link of links) assertGeometry(result.get(link.id), nodes, [link.from, link.to]);
});
test('Production clean sequence keeps centre ports when supplementary connections share both ends', () => {
  const nodes = [node('a', 0, 0), node('b', 356, 0), node('c', 712, 0), node('side-in', 356, 188), node('side-out', 712, 188)];
  const backbone = [edge('ab', 'a', 'b', 'sequence'), edge('bc', 'b', 'c', 'sequence')];
  const branch = edge('branch', 'b', 'side-out', 'extends');
  const auxiliary = [edge('incoming', 'side-in', 'c'), edge('cross', 'a', 'c')];
  for (const links of [[...backbone, branch], [...backbone, branch, ...auxiliary]]) {
    const result = routeGraphEdges({ nodes, links, preferStraightSequence: true });
    for (const link of backbone) {
      const route = result.get(link.id);
      assertGeometry(route, nodes, [link.from, link.to]);
      assert.equal(route.points.length, 2);
      assert.equal(route.points[0].y, 54); assert.equal(route.points[1].y, 54);
      assert.equal(route.sourcePort, 'right'); assert.equal(route.targetPort, 'left');
    }
    assert.notEqual(result.get('branch').points[0].y, result.get('bc').points[0].y);
    if (result.has('incoming')) assert.notEqual(result.get('incoming').points.at(-1).y, result.get('bc').points.at(-1).y);
  }
});
test('Straight sequence option leaves groups without sequence relations unchanged', () => {
  const nodes = [node('a', 0, 0), node('b', 356, 0), node('c', 356, 188)];
  const links = [edge('ab', 'a', 'b', 'branch'), edge('ac', 'a', 'c', 'extends')];
  assert.deepEqual(routeGraphEdges({ nodes, links, preferStraightSequence: true }), routes(nodes, links));
});
test('Production content-card spreading preserves forward ports, dedicated channels and full horizontal labels', () => {
  const nodes = [node('module', 0, 990), ...Array.from({ length: 10 }, (_, i) => node('child-' + i, 900, i * 220))];
  const links = Array.from({ length: 10 }, (_, i) => edge('branch-' + i, 'module', 'child-' + i, 'branch', { label: '概念及其适用条件', labelWidth: 148, labelHeight: 40 }));
  const input = structuredClone({ nodes, links });
  const options = { nodes, links, nodeWidth: 300, nodeHeight: 168, spreadConnections: true };
  const result = routeGraphEdges(options), boxes = [], trunks = [];
  for (const route of result.values()) {
    assert.equal(route.sourcePort, 'right'); assert.equal(route.targetPort, 'left');
    assert.equal(route.obstructed, false); assert.equal(route.labelVisible, true); assert.equal(route.labelOrientation, 'horizontal');
    const box = { left: route.label.x - route.labelWidth / 2, right: route.label.x + route.labelWidth / 2, top: route.label.y - route.labelHeight / 2, bottom: route.label.y + route.labelHeight / 2 };
    for (const card of nodes) assert.ok(box.left >= card.x + 300 || box.right <= card.x || box.top >= card.y + 168 || box.bottom <= card.y);
    for (const other of boxes) assert.ok(box.left >= other.right || box.right <= other.left || box.top >= other.bottom || box.bottom <= other.top);
    boxes.push(box);
    route.points.slice(1).forEach((point, i) => {
      if (Math.abs(point.x - route.points[i].x) < .01 && Math.abs(point.y - route.points[i].y) > 30) trunks.push(point.x);
    });
  }
  trunks.sort((a, b) => a - b);
  for (let i = 1; i < trunks.length; i++) assert.ok(trunks[i] - trunks[i - 1] >= 24);
  assert.deepEqual([...result], [...routeGraphEdges({ ...options, nodes: [...nodes].reverse(), links: [...links].reverse() })]);
  assert.deepEqual({ nodes, links }, input);
});
test('A middle card blocks the direct path and creates a rounded local detour', () => {
  const nodes = [node('a', 0, 0), node('middle', 0, 180), node('b', 0, 360)];
  const route = routes(nodes, [edge('e', 'a', 'b')]).get('e');
  assertGeometry(route, nodes, ['a', 'b']);
  assert.ok(route.path.includes(' Q ')); assert.ok(route.points.length > 2);
  assert.ok(route.bounds.minX > -80 && route.bounds.maxX < 324, 'Detour stays near cards');
});
test('Port spreading separates three branches and opposite edges', () => {
  const nodes = [node('a', 0, 0), node('b', -330, 240), node('c', 0, 240), node('d', 330, 240)];
  const branch = routes(nodes, [edge('ab', 'a', 'b'), edge('ac', 'a', 'c'), edge('ad', 'a', 'd')]);
  const starts = [...branch.values()].map(r => r.points[0].x + ':' + r.points[0].y);
  assert.equal(new Set(starts).size, 3);
  for (const [id, route] of branch) assertGeometry(route, nodes, ['a', id[1]]);
  const two = routes([node('a', 0, 0), node('b', 0, 220)], [edge('up', 'a', 'b'), edge('down', 'b', 'a')]);
  assert.notEqual(two.get('up').path, two.get('down').path);
  assert.notEqual(two.get('up').points[0].x, two.get('down').points.at(-1).x);
});
test('Long returning extensions stay outside the framework and fit bounds include them', () => {
  const nodes = [node('a', 0, 600), node('b', 320, 0), node('middle', 0, 0), node('mid2', 0, 300)];
  const route = routes(nodes, [edge('e', 'a', 'b', 'extends')]).get('e');
  assertGeometry(route, nodes, ['a', 'b']); assert.ok(route.bounds.minX < 0); assert.ok(route.bounds.minY < 0);
  assert.equal(route.sourcePort, 'left'); assert.equal(route.targetPort, 'top');
});
test('Returning extensions compare local routes instead of following unrelated canvas bounds', () => {
  const nodes = [node('a', 0, 600), node('b', 100, 0), node('middle', -244, 0), node('mid2', -244, 300), node('distant', -2200, 900)];
  const route = routeGraphEdges({ nodes, links: [edge('return', 'a', 'b', 'extends')], spreadConnections: true }).get('return');
  assertGeometry(route, nodes, ['a', 'b']);
  assert.equal(route.sourcePort, 'left'); assert.equal(route.targetPort, 'top');
  assert.ok(route.quality.length < 1600, 'An unrelated card cannot force a canvas-wide perimeter trip');
  assert.ok(route.points.every(point => point.x > -300));
});
test('Labels avoid cards and one another while hidden labels reserve no space', () => {
  const nodes = [node('a', 0, 0), node('b', 380, 0)];
  const result = routes(nodes, [edge('e1', 'a', 'b'), edge('e2', 'a', 'b'), edge('e3', 'a', 'b', 'parallel', { hideLabel: true })]);
  const visible = [...result.values()].filter(r => r.labelVisible);
  for (const r of result.values()) assertGeometry(r, nodes, ['a', 'b']);
  for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++)
    assert.ok(Math.abs(visible[i].label.x - visible[j].label.x) >= (visible[i].labelWidth + visible[j].labelWidth) / 2 || Math.abs(visible[i].label.y - visible[j].label.y) >= (visible[i].labelHeight + visible[j].labelHeight) / 2);
  assert.equal(result.get('e3').labelVisible, false);
});
test('Self loops, malformed coordinates and dangling references never produce NaN', () => {
  const nodes = [node('a', Number.NaN, undefined), node('b', 350, 0)];
  const result = routes(nodes, [edge('loop', 'a', 'a'), edge('valid', 'a', 'b'), edge('missing', 'a', 'missing')]);
  assert.equal(result.has('missing'), false); assert.ok(!/NaN|Infinity/.test(result.get('loop').path));
  assert.ok(!/NaN|Infinity/.test(result.get('valid').path));
});
test('Synthetic fifty-card graph routes within an interactive rendering budget', () => {
  const nodes = Array.from({ length: 50 }, (_, i) => node('n' + i, (i % 10) * 320, Math.floor(i / 10) * 185));
  const links = [...Array.from({ length: 49 }, (_, i) => edge('e' + i, 'n' + i, 'n' + (i + 1))), ...Array.from({ length: 20 }, (_, i) => edge('v' + i, 'n' + i, 'n' + (i + 20)))];
  const start = performance.now(), result = routes(nodes, links), elapsed = performance.now() - start;
  assert.equal(result.size, links.length);
  for (const link of links) assertGeometry(result.get(link.id), nodes, [link.from, link.to]);
  assert.ok(elapsed < 2500, 'Routing elapsed ' + elapsed.toFixed(1) + 'ms');
});
test('A medium dense graph remains bounded while routing every chain and convergence edge', () => {
  const nodes = Array.from({ length: 18 }, (_, i) => node('n' + i, i % 6 * 350, Math.floor(i / 6) * 210));
  const links = [...Array.from({ length: 17 }, (_, i) => edge('chain-' + i, 'n' + i, 'n' + (i + 1))), ...Array.from({ length: 6 }, (_, i) => edge('input-' + i, 'n' + i, 'n17'))]
    .map(link => ({ ...link, labelWidth: 80, labelHeight: 30 }));
  const start = performance.now(), result = routeGraphEdges({ nodes, links, spreadConnections: true }), elapsed = performance.now() - start;
  assert.equal(result.size, links.length);
  for (const link of links) assertGeometry(result.get(link.id), nodes, [link.from, link.to]);
  assert.ok(elapsed < 1000, 'Dense routing elapsed ' + elapsed.toFixed(1) + 'ms');
});

test('Every visible label or its leader is anchored on its own orthogonal route', () => {
  const nodes = [node('a', 0, 0), node('b', 0, 150), node('c', 320, 150), node('d', 320, 400), node('e', 0, 400)];
  const links = [edge('ab', 'a', 'b'), edge('ac', 'a', 'c'), edge('bd', 'b', 'd'), edge('cd', 'c', 'd'), edge('ed', 'e', 'd'), edge('ea', 'e', 'a', 'extends')].map(l => ({ ...l, labelWidth: 68, labelHeight: 36 }));
  const result = routes(nodes, links);
  assert.ok([...result.values()].some(r => r.labelVisible));
  for (const route of result.values()) if (route.labelVisible) {
    const p = route.labelAnchor;
    assert.ok(route.points.slice(1).some((b, i) => {
      const a = route.points[i];
      return Math.abs(a.y - b.y) < .01
        ? Math.abs(p.y - a.y) < .01 && p.x >= Math.min(a.x, b.x) - .01 && p.x <= Math.max(a.x, b.x) + .01
        : Math.abs(p.x - a.x) < .01 && p.y >= Math.min(a.y, b.y) - .01 && p.y <= Math.max(a.y, b.y) + .01;
    }), 'Visible label must identify its own line');
    if (route.labelLeader) {
      assert.deepEqual(route.labelLeader[0], p);
      assert.ok(route.labelLeaderPath.startsWith('M '));
    } else assert.deepEqual(route.label, p);
  }
});

test('Node and edge array order cannot move ports, channels or labels', () => {
  const nodes = [node('m', 0, 150), node('a', 360, 0), node('b', 360, 250), node('c', 720, 150)];
  const links = [edge('ma', 'm', 'a', 'branch'), edge('mb', 'm', 'b', 'branch'), edge('ab', 'a', 'b', 'prerequisite'), edge('ac', 'a', 'c', 'prerequisite'), edge('bc', 'b', 'c', 'prerequisite')];
  const snapshot = structuredClone({ nodes, links });
  const forward = routes(nodes, links), reverse = routes([...nodes].reverse(), [...links].reverse());
  assert.deepEqual([...forward], [...reverse]);
  assert.deepEqual({ nodes, links }, snapshot, 'Routing leaves caller-owned graph untouched');
});

test('Two prerequisites converge at separate ports and distinct relationships remain separate', () => {
  const nodes = [node('a', 0, 0), node('b', 0, 220), node('c', 400, 110)];
  const links = [edge('ac', 'a', 'c', 'prerequisite', { label: '定义基础' }), edge('bc', 'b', 'c', 'prerequisite', { label: '数学工具' }), edge('ac2', 'a', 'c', 'prerequisite', { label: '另一必要条件' })];
  const result = routes(nodes, links);
  assert.equal(result.size, links.length);
  assert.equal(new Set([...result.values()].map(r => JSON.stringify(r.points.at(-1)))).size, 3);
  for (const link of links) assertGeometry(result.get(link.id), nodes, [link.from, link.to]);
});

test('Blocked endpoint stubs are diagnosed even when the middle route can detour', () => {
  const nodes = [node('a', 0, 0), node('overlap', 230, 0), node('b', 560, 0)];
  const route = routes(nodes, [edge('blocked', 'a', 'b')]).get('blocked');
  assert.equal(route.obstructed, true);
  assert.ok(route.quality.obstructions > 0);
  assert.ok(route.issues.includes('obstructed'));
  assert.ok(!/NaN|Infinity/.test(route.path));
});

test('Unplaceable and deliberately hidden labels have separate reasons', () => {
  const nodes = [node('a', 0, 0), node('b', 270, 0), node('north', 150, -108), node('south', 150, 108)];
  const narrow = routes(nodes, [edge('narrow', 'a', 'b', 'applies', { labelWidth: 220, labelHeight: 80 })]).get('narrow');
  assert.equal(narrow.labelVisible, false);
  assert.equal(narrow.labelDiagnostic, 'no-clear-space');
  assert.ok(narrow.issues.includes('label-no-space'));
  const hidden = routes(nodes, [edge('hidden', 'a', 'b', 'applies', { hideLabel: true })]).get('hidden');
  assert.equal(hidden.labelDiagnostic, 'hidden-by-view');
  assert.equal(hidden.issues.includes('label-no-space'), false);
});

test('Full explanations in a short convergence gap remain visible through clear leaders', () => {
  const nodes = [node('a', 0, 0), node('b', 0, 180), node('c', 356, 90)];
  const links = [edge('ac', 'a', 'c', 'prerequisite', { label: '定义是结论的基础', labelWidth: 112, labelHeight: 40 }), edge('bc', 'b', 'c', 'prerequisite', { label: '条件必须同时满足', labelWidth: 124, labelHeight: 40 })];
  const snapshot = structuredClone(links), result = routes(nodes, links);
  assert.deepEqual(links, snapshot, 'Full explanation text is never shortened or rewritten');
  assert.equal([...result.values()].filter(route => route.labelVisible).length, 2);
  assert.ok([...result.values()].some(route => route.labelLeader));
  for (const route of result.values()) {
    assertGeometry(route, nodes, ['a', 'b', 'c']);
    if (route.labelLeader) for (let i = 1; i < route.labelLeader.length; i++) {
      const a = route.labelLeader[i - 1], b = route.labelLeader[i];
      for (const card of nodes) assert.equal(segmentIntersects(a, b, card), false, 'Leader avoids ' + card.id);
    }
    assert.ok(route.bounds.minX <= route.label.x - route.labelWidth / 2);
    assert.ok(route.bounds.maxY >= route.label.y + route.labelHeight / 2);
  }
});

test('Visible labels avoid every other route and remain horizontal', () => {
  const nodes = [node('a', 0, 0), node('b', 380, 0), node('c', 0, 250), node('d', 380, 250)];
  const result = routes(nodes, [edge('ab', 'a', 'b'), edge('cd', 'c', 'd'), edge('ad', 'a', 'd'), edge('cb', 'c', 'b')]);
  assert.ok([...result.values()].some(route => route.labelVisible));
  for (const [id, route] of result) if (route.labelVisible) {
    assert.equal(route.labelOrientation, 'horizontal');
    const box = { x: route.label.x - route.labelWidth / 2, y: route.label.y - route.labelHeight / 2 };
    for (const [otherId, other] of result) if (otherId !== id) for (let i = 1; i < other.points.length; i++) {
      const a = other.points[i - 1], b = other.points[i];
      const hit = Math.abs(a.y - b.y) < .01
        ? a.y > box.y && a.y < box.y + route.labelHeight && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + route.labelWidth
        : a.x > box.x && a.x < box.x + route.labelWidth && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + route.labelHeight;
      assert.equal(hit, false, `${id} label avoids ${otherId}`);
    }
  }
});

test('Bounded global refinement does not worsen its complete-graph route objective', () => {
  const nodes = Array.from({ length: 12 }, (_, i) => node('n' + i, (i % 4) * 350, Math.floor(i / 4) * 200));
  const links = [edge('e1', 'n0', 'n6'), edge('e2', 'n1', 'n4'), edge('e3', 'n3', 'n8'), edge('e4', 'n2', 'n11'), edge('e5', 'n4', 'n10'), edge('e6', 'n7', 'n9')];
  const initial = measureRouteQuality(routeGraphEdges({ nodes, links, refinementLimit: 0 }));
  const final = measureRouteQuality(routeGraphEdges({ nodes, links }));
  const objective = q => q.length + q.bends * 27 + q.crossings * 140 + q.overlaps * 60 + q.overlapLength * 1.3;
  assert.equal(final.routes, links.length);
  assert.ok(objective(final) <= objective(initial) + .01);
  assert.equal(final.obstructed, 0);
});

test('Bounded endpoint probes untangle cross-card inputs without moving cards, hiding labels or dropping relationships', () => {
  const nodes = [node('a', 0, 0), node('b', 450, 0), node('c', 900, 0), node('d', 450, 220), node('e', 900, 220), node('sink', 1350, 440)];
  const links = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('cs', 'c', 'sink'), edge('as', 'a', 'sink'), edge('bs', 'b', 'sink'), edge('ds', 'd', 'sink'), edge('es', 'e', 'sink'), edge('de', 'd', 'e')]
    .map(link => ({ ...link, labelWidth: 80, labelHeight: 36 }));
  const snapshot = structuredClone({ nodes, links }), options = { nodes, links, spreadConnections: true };
  const initial = routeGraphEdges({ ...options, refinementLimit: 0 }), result = routeGraphEdges(options);
  const before = measureRouteQuality(initial), after = measureRouteQuality(result);
  const objective = q => q.length + q.bends * 27 + q.crossings * 140 + q.overlaps * 60 + q.overlapLength * 1.3;
  assert.ok(before.crossings > 0, 'The unrefined graph contains a genuine convergence conflict');
  assert.equal(after.crossings, 0); assert.equal(after.overlaps, 0);
  assert.ok(objective(after) < objective(before));
  assert.ok(after.length <= before.length * 1.1, 'Untangling stays near the original path lengths');
  assert.equal(after.hiddenLabels, 0); assert.equal(result.size, links.length);
  for (const link of links) {
    const route = result.get(link.id), original = initial.get(link.id);
    assertGeometry(route, nodes, [link.from, link.to]);
    assert.equal(route.sourcePort, original.sourcePort); assert.equal(route.targetPort, original.targetPort);
  }
  assert.deepEqual([...result], [...routeGraphEdges({ ...options, nodes: [...nodes].reverse(), links: [...links].reverse() })]);
  assert.deepEqual({ nodes, links }, snapshot);
});

test('Dense shortcut inputs separate shared channels and keep side attachments bounded and distinct', () => {
  const nodes = [node('a', 0, 220), node('b', 500, 440), node('c', 1000, 220), node('d', 1500, 220), node('e', 2000, 220), node('sink', 2500, 230)];
  const links = [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('cd', 'c', 'd'), edge('de', 'd', 'e'), edge('es', 'e', 'sink'), ...['a', 'b', 'c', 'd'].map(id => edge(id + 's', id, 'sink', 'extends'))]
    .map(link => ({ ...link, labelWidth: 80, labelHeight: 36 }));
  const options = { nodes, links, spreadConnections: true }, initial = routeGraphEdges({ ...options, refinementLimit: 0 }), result = routeGraphEdges(options);
  const before = measureRouteQuality(initial), after = measureRouteQuality(result);
  assert.ok(before.overlapLength > 0, 'The initial detours share an occupied grid channel');
  assert.equal(after.crossings, 0); assert.equal(after.overlaps, 0); assert.equal(after.obstructed, 0);
  assert.ok(after.length <= before.length); assert.equal(after.hiddenLabels, 0);
  const slots = routes => {
    const groups = new Map();
    for (const link of links) for (const endpoint of ['source', 'target']) {
      const route = routes.get(link.id), key = [endpoint, endpoint === 'source' ? link.from : link.to, route[endpoint + 'Port']].join(':');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(endpoint === 'source' ? route.points[0] : route.points.at(-1));
    }
    return [...groups].map(([key, points]) => [key, points.sort((a, b) => a.x - b.x || a.y - b.y)]).sort((a, b) => a[0].localeCompare(b[0]));
  };
  const initialSlots = slots(initial), finalSlots = slots(result);
  assert.deepEqual(finalSlots.map(([key, points]) => [key, points.length]), initialSlots.map(([key, points]) => [key, points.length]));
  finalSlots.forEach(([key, points], index) => points.forEach((point, i) => {
    assert.equal(point.x, initialSlots[index][1][i].x, 'Attachments stay on their original card side');
    const card = nodes.find(n => n.id === key.split(':')[1]);
    assert.ok(point.y >= card.y + 16 && point.y <= card.y + 108 - 16, 'Sliding attachments stay within the usable card side');
    if (i) assert.ok(point.y - points[i - 1].y >= 16, 'Ports remain separate on ' + key);
  }));
  for (const link of links) assertGeometry(result.get(link.id), nodes, [link.from, link.to]);
});

test('Quality reports pairwise crossings and shared channels without hiding edges', () => {
  const synthetic = new Map([
    ['h', { points: [{ x: 0, y: 50 }, { x: 100, y: 50 }], labelVisible: true }],
    ['v', { points: [{ x: 50, y: 0 }, { x: 50, y: 100 }], labelVisible: true }],
    ['near', { points: [{ x: 0, y: 52 }, { x: 100, y: 52 }], labelVisible: false, labelDiagnostic: 'no-clear-space' }],
  ]);
  const quality = measureRouteQuality(synthetic);
  assert.equal(quality.routes, 3);
  assert.equal(quality.crossings, 2);
  assert.equal(quality.overlaps, 1);
  assert.equal(quality.overlapLength, 100);
  assert.equal(quality.hiddenLabels, 1);
  assert.equal(synthetic.size, 3);
});
