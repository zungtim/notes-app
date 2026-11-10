import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { smoothEdgePath } from '../src/public/edge-path.js';

// Parse the public SVG result so assertions inspect rendered geometry rather
// than implementation helpers or the radius-search decisions.
function geometry(path) {
  const tokens = path.match(/[MLQ]|[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi) || [];
  const segments = [];
  let current = null, start = null, index = 0;
  const point = () => ({ x: Number(tokens[index++]), y: Number(tokens[index++]) });
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M') { current = point(); start = current; }
    else if (command === 'L') {
      const to = point(); segments.push({ type: 'line', from: current, to }); current = to;
    } else if (command === 'Q') {
      const control = point(), to = point(); segments.push({ type: 'curve', from: current, control, to }); current = to;
    } else assert.fail('Unexpected SVG command: ' + command);
  }
  return { start, end: current, segments, curves: segments.filter(segment => segment.type === 'curve') };
}

function sample(segment, t) {
  if (segment.type === 'line') return { x: segment.from.x + (segment.to.x - segment.from.x) * t,
    y: segment.from.y + (segment.to.y - segment.from.y) * t };
  const u = 1 - t;
  return { x: u * u * segment.from.x + 2 * u * t * segment.control.x + t * t * segment.to.x,
    y: u * u * segment.from.y + 2 * u * t * segment.control.y + t * t * segment.to.y };
}

function assertClear(path, obstacles) {
  for (const segment of geometry(path).segments) for (let step = 0; step <= 2000; step++) {
    const point = sample(segment, step / 2000);
    assert.ok(!obstacles.some(rect => point.x > rect.left + 1e-8 && point.x < rect.right - 1e-8
      && point.y > rect.top + 1e-8 && point.y < rect.bottom - 1e-8), 'Rendered arc and retained lines stay outside rectangle interiors');
  }
}

const bend = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }];

test('Zoom changes display rounding by screen size with an explicit safe world cap', () => {
  for (const scale of [2, 1, .5, .25]) {
    const result = geometry(smoothEdgePath(bend, { scale })), curve = result.curves[0];
    assert.equal(result.curves.length, 1);
    const radius = curve.control.x - curve.from.x;
    assert.equal(radius * scale, 14, 'A visible bend keeps a fourteen-screen-pixel tangent offset');
    assert.equal(curve.to.y - curve.control.y, radius);
    assert.deepEqual(result.start, bend[0]); assert.deepEqual(result.end, bend.at(-1));
  }
  const capped = geometry(smoothEdgePath(bend, { scale: .01 })).curves[0];
  assert.equal(capped.control.x - capped.from.x, 80);
  for (const scale of [0, -1, NaN, Infinity, '0.5']) assert.equal(smoothEdgePath(bend, { scale }), smoothEdgePath(bend));
});

test('Short adjacent bends consume at most half either segment and preserve traversal direction', () => {
  const route = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 4 }, { x: 9, y: 4 }];
  const result = geometry(smoothEdgePath(route, { scale: .1 }));
  assert.equal(result.curves.length, 2);
  assert.equal(result.curves[0].control.x - result.curves[0].from.x, 2);
  assert.equal(result.curves[1].to.x - result.curves[1].control.x, 1.5);
  assert.ok(result.curves[0].to.y <= result.curves[1].from.y, 'Consecutive trims do not overlap or reverse a short leg');
  for (const segment of result.segments) assert.ok(segment.to.x >= segment.from.x && segment.to.y >= segment.from.y);
  assert.deepEqual(result.start, route[0]); assert.deepEqual(result.end, route.at(-1));
});

test('Rendered curves retain each original corner control and its incoming/outgoing tangents', () => {
  const route = [{ x: .123456789123456, y: -.987654321987654 },
    { x: 300, y: -.987654321987654 }, { x: 300, y: 200 }, { x: 500, y: 200 }];
  const result = geometry(smoothEdgePath(route, { scale: .23 }));
  assert.deepEqual(result.start, route[0]); assert.deepEqual(result.end, route.at(-1));
  for (let i = 0; i < result.curves.length; i++) {
    const curve = result.curves[i], corner = route[i + 1], previous = route[i], next = route[i + 2];
    assert.deepEqual(curve.control, corner);
    const crossBefore = (curve.control.x - curve.from.x) * (corner.y - previous.y)
      - (curve.control.y - curve.from.y) * (corner.x - previous.x);
    const crossAfter = (curve.to.x - curve.control.x) * (next.y - corner.y)
      - (curve.to.y - curve.control.y) * (next.x - corner.x);
    assert.equal(crossBefore, 0); assert.equal(crossAfter, 0);
  }
  assert.equal(smoothEdgePath([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 40, y: 0 }]), 'M 0 0 L 20 0 L 40 0');
  assert.equal(geometry(smoothEdgePath([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 0 }])).curves.length, 0,
    'A return along the same leg stays an explicit reversal');
});

test('Card or label rectangles shrink a corner that would cut across free orthogonal legs', () => {
  const route = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  const rect = { left: 96, right: 97, top: 3, bottom: 4 };
  const unsafe = geometry(smoothEdgePath(route)).curves[0];
  assert.deepEqual(sample(unsafe, .5), { x: 96.5, y: 3.5 }, 'The ordinary fourteen-unit arc would enter the obstacle');
  const safe = smoothEdgePath(route, { obstacles: [rect] }), result = geometry(safe);
  assert.ok(result.curves[0].control.x - result.curves[0].from.x < 14);
  assertClear(safe, [rect]);
  assert.deepEqual(result.start, route[0]); assert.deepEqual(result.end, route.at(-1));
});

test('Analytic obstacle checks catch very thin rectangles and do not reject an empty part of the bounding box', () => {
  const route = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  const ordinary = smoothEdgePath(route), curve = geometry(ordinary).curves[0], point = sample(curve, .413);
  const narrow = { left: point.x - 1e-7, right: point.x + 1e-7, top: point.y - 1e-7, bottom: point.y + 1e-7 };
  assert.notEqual(smoothEdgePath(route, { obstacles: [narrow] }), ordinary,
    'A collision between coarse sampling positions still changes the unsafe arc');
  const emptyArea = { left: 87, right: 88, top: 10, bottom: 11 };
  assert.equal(smoothEdgePath(route, { obstacles: [emptyArea] }), ordinary,
    'A rectangle inside the control box but away from the arc leaves its rounding intact');
});

test('An obstructed wedge falls back to the original corner and boundary tangency stays permitted', () => {
  const route = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  const filledWedge = { left: 0, right: 100, top: 0, bottom: 100 };
  const path = smoothEdgePath(route, { scale: .2, obstacles: [filledWedge] });
  assert.equal(path, 'M 0 0 L 100 0 L 100 100');
  assertClear(path, [filledWedge]);
  const outside = { left: 100, right: 120, top: 0, bottom: 100 };
  assert.equal(smoothEdgePath(route, { obstacles: [outside] }), smoothEdgePath(route),
    'Touching an obstacle edge does not invent an interior collision');
});

test('Obstacle avoidance works for all quarter-turn orientations', () => {
  const rotate = ({ x, y }) => ({ x: -y, y: x });
  let route = [{ x: -100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 100 }];
  let rectangle = [{ x: -4, y: 3 }, { x: -3, y: 4 }];
  for (let turn = 0; turn < 4; turn++) {
    const rect = { left: Math.min(...rectangle.map(p => p.x)), right: Math.max(...rectangle.map(p => p.x)),
      top: Math.min(...rectangle.map(p => p.y)), bottom: Math.max(...rectangle.map(p => p.y)) };
    const safe = smoothEdgePath(route, { obstacles: [rect] });
    assert.notEqual(safe, smoothEdgePath(route)); assertClear(safe, [rect]);
    route = route.map(rotate); rectangle = rectangle.map(rotate);
  }
});

test('Invalid/short input stays finite and neither points nor obstacle records are changed', () => {
  for (const points of [undefined, null, {}, [], [null, {}, { x: NaN, y: 0 }]]) assert.equal(smoothEdgePath(points), '');
  assert.equal(smoothEdgePath([{ x: 2, y: 3 }]), 'M 2 3');
  assert.equal(smoothEdgePath([{ x: 2, y: 3 }, { x: 2, y: 3 }, { x: 4, y: 5 }]), 'M 2 3 L 4 5');
  const invalid = [null, { x: 0, y: 0 }, { x: Infinity, y: 20 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  const obstacles = [{ left: 96, right: 97, top: 3, bottom: 4 }, null, {}, { left: NaN, right: 10, top: 0, bottom: 10 }];
  const before = structuredClone({ invalid, obstacles });
  invalid.forEach(value => value && Object.freeze(value)); obstacles.forEach(value => value && Object.freeze(value));
  Object.freeze(invalid); Object.freeze(obstacles);
  const path = smoothEdgePath(invalid, { scale: .3, obstacles });
  assert.doesNotMatch(path, /NaN|Infinity|undefined/);
  assert.deepEqual({ invalid, obstacles }, before);
  assert.equal(smoothEdgePath(bend, null), smoothEdgePath(bend));
});

test('Display-only redraws remain bounded for a synthetic graph with many distant obstacles', () => {
  const obstacles = Array.from({ length: 200 }, (_, i) => ({ left: 1000 + i * 300,
    right: 1244 + i * 300, top: 1000, bottom: 1108 }));
  const route = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 600, y: 200 }, { x: 600, y: 500 }];
  const before = structuredClone(route), start = performance.now();
  for (let edge = 0; edge < 150; edge++) assert.ok(smoothEdgePath(route, { scale: .2 + edge % 10 / 10, obstacles }).includes('Q'));
  assert.ok(performance.now() - start < 2000, 'A display redraw avoids routing searches or unbounded collision iteration');
  assert.deepEqual(route, before);
});
