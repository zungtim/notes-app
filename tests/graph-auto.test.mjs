import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeGraph, relationDiagnostics, GRAPH_RELATIONS } from '../src/public/graph.js';

test('Zoom repaints the same rounded connection in all hit and paint layers without reflow', () => {
  const attributeHost=()=>({attributes:{},writes:0,setAttribute(key,value){this.attributes[key]=String(value);this.writes++;}});
  const graph=Object.create(KnowledgeGraph.prototype),marker=attributeHost();
  const paths=[attributeHost(),attributeHost(),attributeHost()];
  const points=freeze([{x:0,y:0},{x:200,y:0},{x:200,y:240}]);
  const positions=new Map([['a',{x:-300,y:-84}],['b',{x:204,y:156}]]);
  const noteData=freeze([{id:'a',content:'Synthetic source'},{id:'b',content:'Synthetic target'}]);
  const linkData=freeze([{id:'ab',from:'a',to:'b',type:'applies'}]);
  const route={points},before=JSON.stringify({positions:[...positions],notes:noteData,links:linkData,points});
  Object.assign(graph,{
    transform:{x:21,y:-14,scale:1},world:attributeHost(),
    defs:{querySelectorAll(){return [marker];}},
    edgeCurves:[{points,paths,obstacles:[]}],edgeLabelLayer:{children:[]},
    scaleLabel:{textContent:''},root:{style:{setProperty(){}}},
    positions,notes:noteData,links:linkData,routes:new Map([['ab',route]]),
    computeLayout(){throw Error('Zoom cannot move cards');},
    render(){throw Error('Zoom cannot rebuild graph data');},
    callbacks:{onPositionChange(){throw Error('Zoom cannot save card positions');}},
  });
  graph.applyTransform();
  const fullSize=paths[0].attributes.d;
  assert.ok(fullSize.includes('Q'),'The visual route has a smooth bend');
  assert.ok(paths.every(path=>path.attributes.d===fullSize));
  assert.equal(marker.attributes.markerWidth,'7.5');
  graph.transform={x:64,y:98,scale:.25};graph.applyTransform();
  const zoomed=paths[0].attributes.d;
  assert.notEqual(zoomed,fullSize,'Zoom changes the curve radius rather than shrinking it to a sharp corner');
  assert.ok(paths.every(path=>path.attributes.d===zoomed),'Casing, visible stroke and hit target remain aligned');
  assert.equal(marker.attributes.markerWidth,'30');assert.equal(marker.attributes.markerHeight,'30');
  assert.equal(graph.world.attributes.transform,'translate(64 98) scale(0.25)');
  const writes=paths.map(path=>path.writes);
  graph.transform={x:12,y:34,scale:.25};graph.applyTransform();
  assert.deepEqual(paths.map(path=>path.writes),writes,'Panning at the same scale reuses the already smoothed paths');
  assert.equal(graph.world.attributes.transform,'translate(12 34) scale(0.25)');
  assert.equal(graph.routes.get('ab'),route);
  assert.equal(JSON.stringify({positions:[...positions],notes:noteData,links:linkData,points}),before);
});

// Legacy modes retain the 2026-10-23 manual-view behavior. The clean learning
// map requested on 2026-10-24 also rearranges changed structure. Exercise real
// lifecycle/geometry with synthetic notebooks; stub only painting/measurement.
function graphHost(layout = 'columns') {
  const graph = Object.create(KnowledgeGraph.prototype);
  const calls = { layout: 0, render: 0, readable: 0, cancel: 0, positionChange: 0, select: 0, apply: 0, views: [] };
  Object.assign(graph, {
    notes: [], links: [], positions: new Map(), structureSignature: null,
    viewKey: '', viewStates: new Map(), viewTimer: null,
    selectedId: null, query: '', layout, hasFitted: false, viewMode: 'initial',
    transform: { x: 0, y: 0, scale: 1 }, width: 1200, height: 800,
    connecting: null, showAuxiliary: false, showMembershipLines:false, sequenceSteps: new Map(),
    callbacks: {
      onPositionChange: () => { calls.positionChange++; },
      onSelect: () => { calls.select++; },
      onViewChange: (view, viewKey) => { calls.views.push({ view: structuredClone(view), viewKey }); },
    },
    render() { calls.render++; },
    readableView() { calls.readable++; this.hasFitted = true; this.viewMode = 'readable'; },
    cancelConnect() { calls.cancel++; this.connecting = null; },
    applyTransform() { calls.apply++; },
    hideEdgeTooltip() {},
    svg: { classList: { remove() {} }, hasPointerCapture: () => false },
  });
  const compute = KnowledgeGraph.prototype.computeLayout;
  graph.computeLayout = function (mode) { calls.layout++; return compute.call(this, mode); };
  return { graph, calls };
}

// Minimal SVG surface: pointer handlers, routing and path painting below all
// use production methods. Only DOM storage and physical hit testing are fake.
class DragSvg {
  constructor(tag) {
    this.tagName = tag; this.attributes = new Map(); this.children = []; this.style = { setProperty() {} };
    this.dataset = new Proxy({}, { get: (_, key) => this.attributes.get('data-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())), set: (_, key, value) => { this.attributes.set('data-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), value); return true; } });
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  set textContent(value) { this.text = String(value); this.children = []; }
  querySelectorAll(tag) { return this.children.flatMap(child => child instanceof DragSvg ? [...(child.tagName === tag ? [child] : []), ...child.querySelectorAll(tag)] : []); }
}

function paintedDragHost() {
  const { graph, calls } = graphHost('clean'), svg = new DragSvg('svg');
  const captured = new Set();
  Object.assign(svg, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
    setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id), releasePointerCapture: id => captured.delete(id), focus() {} });
  Object.assign(graph, { svg, uid: 'drag-test', transform: { x: 0, y: 0, scale: .5 }, viewKey: 'synthetic:drag',
    notes: [{ id: 'a', title: 'Synthetic source' }, { id: 'b', title: 'Synthetic target' }],
    links: [{ id: 'ab', from: 'a', to: 'b', type: 'applies', label: 'Synthetic relation' }],
    positions: new Map([['a', { x: 0, y: 0 }], ['b', { x: 560, y: 260 }]]),
    root: new DragSvg('div'), world: new DragSvg('g'), defs: new DragSvg('defs'),
    edgeLayer: new DragSvg('g'), edgeLabelLayer: new DragSvg('g'), nodeLayer: new DragSvg('g'), groupLayer: new DragSvg('g'),
    empty: {}, hint: {}, scaleLabel: {},
    render: KnowledgeGraph.prototype.render, applyTransform: KnowledgeGraph.prototype.applyTransform,
    computeLayout() { throw Error('Dragging cannot invoke card layout'); },
    autoLayout() { throw Error('No arrange button is involved'); },
    organize() { throw Error('No organize button is involved'); },
  });
  const event = (y, pointerId = 41) => ({ button: 0, pointerId, clientX: 300, clientY: y,
    target: { closest: selector => selector === '[data-node-id]' ? { dataset: { nodeId: 'b' } } : null }, preventDefault() {} });
  return { graph, calls, event };
}

test('Dragging reroutes all painted layers to a straight line without an arrange click or moving other cards', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElementNS: (_, tag) => new DragSvg(tag) };
  try {
    const { graph, calls, event } = paintedDragHost(), data = structuredClone({ notes: graph.notes, links: graph.links }), camera = { ...graph.transform };
    graph.render(); assert.ok(graph.routes.get('ab').points.length > 2);
    graph.onPointerDown(event(160));
    graph.onPointerMove(event(66));
    assert.deepEqual(graph.positions.get('b'), { x: 560, y: 72 });
    assert.equal(graph.routes.get('ab').points.length, 2, 'Straightening already occurs during the gesture');
    assert.equal(calls.views.length, 0, 'Intermediate pointer motion does not save every frame');
    graph.onPointerUp(event(50));
    assert.deepEqual(graph.positions.get('b'), { x: 560, y: 40 }, 'Use the final release coordinate even beyond the last move');
    assert.deepEqual(graph.positions.get('a'), { x: 0, y: 0 });
    assert.equal(graph.routes.get('ab').points.length, 2);
    const paths = graph.edgeLayer.children[0].children.filter(child => child.tagName === 'path');
    assert.equal(paths.length, 3);
    assert.ok(paths.every(path => path.attributes.get('d') === paths[0].attributes.get('d')));
    assert.ok(!paths[0].attributes.get('d').includes('Q'), 'Stroke, casing and hit area are all straight');
    assert.equal(calls.positionChange, 1); assert.equal(calls.views.length, 1);
    assert.deepEqual(calls.views[0].view.positions.b, { x: 560, y: 40 });
    assert.deepEqual(graph.transform, camera);
    assert.deepEqual({ notes: graph.notes, links: graph.links }, data);
  } finally { globalThis.document = oldDocument; }
});

test('A cancelled card drag restores its original position and route without saving', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElementNS: (_, tag) => new DragSvg(tag) };
  try {
    const { graph, calls, event } = paintedDragHost(); graph.render();
    const before = graph.routes.get('ab').path;
    graph.onPointerDown(event(160)); graph.onPointerMove(event(66));
    assert.equal(graph.routes.get('ab').points.length, 2);
    graph.onPointerUp(event(50), true);
    assert.deepEqual(graph.positions.get('b'), { x: 560, y: 260 });
    assert.equal(graph.routes.get('ab').path, before);
    assert.equal(calls.positionChange, 0); assert.equal(calls.views.length, 0);
  } finally { globalThis.document = oldDocument; }
});

test('A drop with no final pointermove still routes and saves the actual drop instead of selecting the card', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElementNS: (_, tag) => new DragSvg(tag) };
  try {
    const { graph, calls, event } = paintedDragHost(); graph.render();
    graph.onPointerDown(event(160)); graph.onPointerUp(event(50));
    assert.deepEqual(graph.positions.get('b'), { x: 560, y: 40 });
    assert.equal(graph.routes.get('ab').points.length, 2);
    assert.equal(calls.views.length, 1); assert.equal(calls.select, 0);
  } finally { globalThis.document = oldDocument; }
});

function syntheticNotebook(count = 12) {
  const stamp = '2026-01-01T00:00:00.000Z';
  const notes = Array.from({ length: count }, (_, i) => ({
    id: 'n' + String(i).padStart(2, '0'), topicId: 'synthetic',
    title: 'Synthetic card ' + i, content: 'Synthetic text',
    type: 'concept', status: 'learning', tags: [], sources: [],
    createdAt: stamp, updatedAt: stamp, position: { x: 0, y: 0 },
  }));
  const links = notes.slice(1).map((note, i) => ({
    id: 'edge-' + i, topicId: 'synthetic',
    from: notes[Math.floor(i / 3)].id, to: note.id, type: 'branch', label: '',
  }));
  return { version: 1, revision: 0, topics: [{ id: 'synthetic', title: 'Synthetic topic', createdAt: stamp }], notes, links };
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function assertClearCards(positions, ids) {
  assert.deepEqual(Object.keys(positions).sort(), [...ids].sort());
  const entries = Object.entries(positions);
  for (const [id, point] of entries) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), 'Finite coordinates for ' + id);
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const [[a, p], [b, q]] = [entries[i], entries[j]];
    assert.ok(Math.abs(p.x - q.x) >= 300 + 18 || Math.abs(p.y - q.y) >= 168 + 18,
      'Visible cards ' + a + ' and ' + b + ' have clear space');
  }
}

function adjust(graph, id = 'n03') {
  graph.positions.set(id, { x: 12345, y: -6789 });
  graph.transform = { x: 432, y: -123, scale: .83 };
  graph.viewMode = 'manual';
}

test('A scope with no saved view initializes once and never writes notebook coordinates', () => {
  const notebook = syntheticNotebook(50), snapshot = structuredClone(notebook);
  freeze(notebook);
  for (const mode of ['columns', 'branches', 'sequence']) {
    const { graph, calls } = graphHost(mode);
    assert.equal(graph.setData({ ...notebook, viewKey: 'synthetic:overview' }), graph);
    assertClearCards(graph.getPositions(), notebook.notes.map(note => note.id));
    assert.equal(calls.layout, 1);
    assert.equal(calls.readable, 1);
    assert.equal(calls.positionChange, 0);
    assert.equal(calls.views.length, 1, 'The initial private view is available for persistence');
    assert.equal(calls.views[0].viewKey, 'synthetic:overview');
    graph.setData({ ...notebook, viewKey: 'synthetic:overview' });
    assert.equal(calls.layout, 1);
    assert.equal(calls.readable, 1);
    assert.equal(calls.views.length, 1, 'Re-presenting the same scope does not request another save');
  }
  assert.deepEqual(notebook, snapshot);
});

test('Reopening restores the saved manual arrangement and viewport without recomputing or recentering', () => {
  const notebook = syntheticNotebook(), snapshot = structuredClone(notebook);
  const original = graphHost('sequence').graph;
  original.setData({ ...notebook, viewKey: 'synthetic:chapter' });
  adjust(original);
  const savedView = freeze({ version: 1, ...original.getViewState(), viewKey: 'synthetic:chapter' });
  const { graph, calls } = graphHost('sequence');
  graph.setData({ ...notebook, viewKey: 'synthetic:chapter', savedView });
  assert.deepEqual(graph.getViewState(), original.getViewState());
  assert.equal(calls.layout, 0);
  assert.equal(calls.readable, 0);
  assert.equal(calls.views.length, 0, 'Restoring an existing private view does not rewrite it');
  assert.equal(graph.viewMode, 'manual');
  assert.deepEqual(notebook, snapshot);
});

test('Selection, text, status and an older saved response cannot overwrite current manual work', () => {
  const notebook = syntheticNotebook(), { graph, calls } = graphHost();
  graph.setData({ ...notebook, viewKey: 'synthetic:overview' });
  const staleView = graph.getViewState();
  adjust(graph);
  const expected = graph.getViewState(), saves = calls.views.length;
  graph.setData({
    notes: [...notebook.notes].reverse().map(note => ({ ...note, title: 'Changed title', content: 'Changed prose', status: 'understood', position: { x: -999, y: -999 } })),
    links: [...notebook.links].reverse().map(link => ({ ...link, id: 'new-' + link.id, label: 'Changed explanation' })),
    selectedId: 'n08', query: '  SYNTHETIC  ', viewKey: 'synthetic:overview', savedView: staleView,
  });
  assert.deepEqual(graph.getViewState(), expected);
  assert.equal(calls.layout, 1);
  assert.equal(calls.readable, 1);
  assert.equal(calls.views.length, saves);
  assert.equal(graph.selectedId, 'n08');
  assert.equal(graph.query, 'synthetic');
});

test('Structural edits preserve every surviving card and viewport; only new cards receive clear positions', () => {
  const variants = [
    ['add cards', notebook => {
      for (const id of ['new-card', 'another-card']) notebook.notes.push({ ...notebook.notes[0], id });
      notebook.links.push({ id: 'new-edge', from: 'n03', to: 'new-card', type: 'branch' });
    }, true],
    ['remove a card', notebook => {
      notebook.notes = notebook.notes.filter(note => note.id !== 'n11');
      notebook.links = notebook.links.filter(link => link.from !== 'n11' && link.to !== 'n11');
    }, true],
    ['add a relationship', notebook => { notebook.links.push({ id: 'cross-link', from: 'n04', to: 'n09', type: 'applies' }); }, false],
    ['remove a relationship', notebook => { notebook.links.shift(); }, false],
    ['change an endpoint', notebook => { notebook.links[0].to = 'n10'; }, false],
    ['change a type', notebook => { notebook.links[0].type = 'prerequisite'; }, false],
  ];
  for (const [label, change, coordinatesChanged] of variants) {
    const notebook = syntheticNotebook(), { graph, calls } = graphHost();
    graph.setData({ ...notebook, viewKey: 'synthetic:overview' });
    adjust(graph);
    const previous = graph.getViewState(), saves = calls.views.length;
    const changed = structuredClone(notebook);
    change(changed);
    graph.setData({ ...changed, viewKey: 'synthetic:overview' });
    assert.equal(calls.layout, 1, label + ' does not rerun automatic layout');
    assert.equal(calls.readable, 1, label + ' does not move the viewport');
    assert.deepEqual(graph.transform, previous.transform);
    for (const note of changed.notes) if (previous.positions[note.id]) assert.deepEqual(graph.getPositions()[note.id], previous.positions[note.id]);
    assertClearCards(graph.getPositions(), changed.notes.map(note => note.id));
    assert.equal(calls.views.length, saves + Number(coordinatesChanged));
    assert.equal(calls.positionChange, 0);
    assert.deepEqual(notebook, syntheticNotebook());
  }
});

test('Scope caches restore their own manual view and never inherit a neighboring scope with identical nodes', () => {
  const notebook = syntheticNotebook(), { graph, calls } = graphHost();
  graph.setData({ ...notebook, viewKey: 'synthetic:overview' });
  adjust(graph, 'n00');
  const overview = graph.getViewState();
  graph.setData({ ...notebook, viewKey: 'synthetic:module' });
  assert.equal(calls.layout, 2, 'An unseen scope initializes independently');
  assert.notDeepEqual(graph.getPositions().n00, overview.positions.n00);
  adjust(graph, 'n01');
  graph.transform.x = -654;
  const module = graph.getViewState();
  graph.setData({ ...notebook, viewKey: 'synthetic:overview' });
  assert.equal(calls.layout, 2);
  assert.deepEqual(graph.getViewState(), overview);
  graph.setData({ ...notebook, viewKey: 'synthetic:module' });
  assert.equal(calls.layout, 2);
  assert.deepEqual(graph.getViewState(), module);
});

test('Saved scope and mode mismatches are ignored, while partial valid coordinates survive changed membership', () => {
  const notebook = syntheticNotebook(5), original = graphHost().graph;
  original.setData({ ...notebook, viewKey: 'synthetic:original' });
  adjust(original);
  const saved = original.getViewState();
  for (const [layout, savedView] of [
    ['columns', { ...saved, viewKey: 'synthetic:wrong' }],
    ['branches', { ...saved, viewKey: 'synthetic:target' }],
  ]) {
    const { graph, calls } = graphHost(layout);
    graph.setData({ ...notebook, viewKey: 'synthetic:target', savedView });
    assert.equal(calls.layout, 1, 'An unrelated saved view cannot replace this scope');
    assert.notDeepEqual(graph.getPositions().n03, saved.positions.n03);
  }
  const dirty = { ...saved, viewKey: 'synthetic:target', positions: {
    ...saved.positions, n01: { x: Infinity, y: 0 }, ghost: { x: 0, y: 0 },
  } };
  const snapshot = structuredClone(dirty), { graph, calls } = graphHost();
  graph.setData({ ...notebook, viewKey: 'synthetic:target', savedView: dirty });
  assert.equal(calls.layout, 0, 'The remaining saved cards are not automatically arranged again');
  assert.equal(calls.readable, 0);
  assert.deepEqual(graph.getPositions().n03, saved.positions.n03);
  assert.deepEqual(graph.transform, saved.transform);
  assertClearCards(graph.getPositions(), notebook.notes.map(note => note.id));
  assert.equal(Object.hasOwn(graph.getPositions(), 'ghost'), false);
  assert.deepEqual(dirty, snapshot);
  assert.equal(calls.views.length, 1, 'Pruned and newly placed coordinates can replace the outdated private view');
});

test('Explicit layout actions alone rearrange existing nodes and emit the final scope state', () => {
  const notebook = syntheticNotebook(), snapshot = structuredClone(notebook), { graph, calls } = graphHost();
  freeze(notebook);
  graph.setData({ ...notebook, viewKey: 'synthetic:overview' });
  const columns = graph.getPositions();
  adjust(graph);
  const branches = graph.setLayout('branches');
  assert.equal(graph.layout, 'branches');
  assertClearCards(branches, notebook.notes.map(note => note.id));
  assert.deepEqual(calls.views.at(-1), { view: graph.getViewState(), viewKey: 'synthetic:overview' });
  assert.deepEqual(graph.setLayout('columns'), columns);
  adjust(graph);
  assert.deepEqual(graph.autoLayout(), columns, 'Explicitly requesting the same layout restores its baseline');
  assert.equal(calls.layout, 4);
  assert.equal(calls.readable, 4);
  assert.equal(calls.views.length, 4);
  assert.equal(calls.positionChange, 0);
  assert.deepEqual(notebook, snapshot);
  const returned = graph.getViewState();
  returned.positions.n00.x += 1000;
  returned.transform.scale = 2;
  assert.deepEqual(graph.getPositions(), columns, 'State snapshots cannot alias active coordinates');
  assert.notEqual(graph.transform.scale, 2);
});

test('Completed drag and pan gestures persist the current scope; cancellation and selection do not', () => {
  const notebook = syntheticNotebook(), { graph, calls } = graphHost();
  graph.setData({ ...notebook, viewKey: 'synthetic:overview' });
  let saves = calls.views.length;
  const original = { ...graph.positions.get('n03') };
  graph.positions.set('n03', { x: 10000, y: -2000 });
  graph.pointer = { pointerId: 1, id: 'n03', moved: true, original };
  graph.onPointerUp({ pointerId: 1 });
  assert.equal(calls.positionChange, 1);
  assert.equal(calls.views.length, ++saves);
  assert.deepEqual(calls.views.at(-1).view, graph.getViewState());
  graph.transform.x = 456;
  graph.pointer = { pointerId: 2, id: null, moved: true, original: { x: 0, y: 0 } };
  graph.onPointerUp({ pointerId: 2 });
  assert.equal(calls.views.length, ++saves);
  graph.transform.x = 123;
  graph.pointer = { pointerId: 3, id: null, moved: true, original: { x: 456, y: 0 } };
  graph.onPointerUp({ pointerId: 3 }, true);
  assert.equal(graph.transform.x, 456);
  assert.equal(calls.views.length, saves);
  graph.positions.set('n03', { x: -999, y: -999 });
  graph.pointer = { pointerId: 4, id: 'n03', moved: true, original };
  graph.onPointerUp({ pointerId: 4 }, true);
  assert.deepEqual(graph.positions.get('n03'), original);
  assert.equal(calls.views.length, saves);
  graph.pointer = { pointerId: 5, id: 'n02', moved: false, original: graph.positions.get('n02') };
  graph.onPointerUp({ pointerId: 5 });
  assert.equal(calls.select, 1);
  assert.equal(calls.views.length, saves);
});

test('Button zoom emits a completed view and wheel gestures coalesce until the gesture ends', async () => {
  const { graph, calls } = graphHost();
  graph.setData({ ...syntheticNotebook(3), viewKey: 'synthetic:zoom' });
  let saves = calls.views.length;
  graph.zoomIn();
  assert.equal(calls.views.length, ++saves);
  assert.deepEqual(calls.views.at(-1).view.transform, graph.transform);
  graph.eventPoint = () => ({ x: 200, y: 150 });
  const event = { preventDefault() {}, deltaY: -50 };
  graph.onWheel(event);
  graph.onWheel(event);
  assert.equal(calls.views.length, saves, 'Wheel events do not write every animation step');
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(calls.views.length, saves + 1);
  assert.deepEqual(calls.views.at(-1).view.transform, graph.transform);
});

test('A pending wheel snapshot is flushed under its original scope before switching views', () => {
  const notebook = syntheticNotebook(3), { graph, calls } = graphHost();
  graph.setData({ ...notebook, viewKey: 'synthetic:first' });
  graph.eventPoint = () => ({ x: 200, y: 150 });
  graph.onWheel({ preventDefault() {}, deltaY: -80 });
  const finalFirst = graph.getViewState(), saves = calls.views.length;
  graph.setData({ ...notebook, viewKey: 'synthetic:second' });
  assert.deepEqual(calls.views[saves], { view: finalFirst, viewKey: 'synthetic:first' });
  assert.equal(calls.views[saves + 1].viewKey, 'synthetic:second');
  assert.equal(graph.viewTimer, null);
});

test('Unnamed graphs and presentation filters never request private state writes', () => {
  const { graph, calls } = graphHost();
  graph.setData(syntheticNotebook(3));
  graph.autoLayout();
  graph.zoomOut();
  assert.equal(calls.views.length, 0, 'The application must supply a real scope key before saving');
  graph.setData({ ...syntheticNotebook(3), viewKey: 'synthetic:named' });
  const saves = calls.views.length;
  graph.setShowAuxiliary(true);
  graph.selectNode('n01');
  assert.equal(calls.views.length, saves);
});

test('An empty neighboring scope clears its own cards and connection while a previous scope retains its view', () => {
  const notebook = syntheticNotebook(), { graph, calls } = graphHost();
  graph.setData({ ...notebook, viewKey: 'synthetic:overview' });
  adjust(graph);
  const saved = graph.getViewState();
  graph.connecting = { from: 'n00', type: 'branch' };
  graph.setData({ notes: [], links: [], viewKey: 'synthetic:empty' });
  assert.deepEqual(graph.getPositions(), {});
  assert.equal(graph.hasFitted, false);
  assert.equal(graph.connecting, null);
  assert.equal(calls.cancel, 1);
  graph.setData({ ...notebook, viewKey: 'synthetic:overview' });
  assert.deepEqual(graph.getViewState(), saved);
  assert.equal(calls.layout, 1, 'Returning restores the previous scope instead of laying it out again');
});

test('The real initial viewport stays readable and explicit full-graph fitting emits its private view', () => {
  for (const mode of ['columns', 'branches']) {
    const { graph, calls } = graphHost(mode);
    Object.assign(graph, {
      container: { getBoundingClientRect: () => ({ width: 1200, height: 800 }) },
      hint: { textContent: '' }, hintText: 'Synthetic graph',
      readableView: KnowledgeGraph.prototype.readableView,
    });
    graph.setData({ ...syntheticNotebook(50), viewKey: 'synthetic:large' });
    assert.equal(graph.readableOverflow, true);
    assert.ok(graph.transform.scale >= .55);
    const previous = graph.getViewState(), saves = calls.views.length;
    graph.setData({ ...syntheticNotebook(50), selectedId: 'n03', viewKey: 'synthetic:large' });
    assert.deepEqual(graph.getViewState(), previous);
    assert.equal(calls.views.length, saves);
    graph.fit();
    assert.equal(calls.views.length, saves + 1);
    assert.equal(graph.viewMode, 'fit');
    assert.equal(graph.readableOverflow, false);
    for (const point of graph.positions.values()) {
      const x = point.x * graph.transform.scale + graph.transform.x;
      const y = point.y * graph.transform.scale + graph.transform.y;
      assert.ok(x >= 0 && y >= 0 && x + 300 * graph.transform.scale <= graph.width && y + 168 * graph.transform.scale <= graph.height);
    }
  }
});

function syntheticStudyRoute() {
  const notebook = syntheticNotebook(7), main = notebook.notes.slice(1, 6);
  notebook.links = [
    ...notebook.notes.slice(1).map((note, index) => ({ id: 'membership-' + index, from: 'n00', to: note.id, type: 'branch' })),
    ...main.slice(1).map((note, index) => ({ id: 'reading-' + index, from: main[index].id, to: note.id, type: 'sequence' })),
    { id: 'support-prior', from: 'n01', to: 'n04', type: 'prerequisite' },
    { id: 'support-evidence', from: 'n02', to: 'n04', type: 'evidence' },
    { id: 'optional-study', from: 'n03', to: 'n06', type: 'extends' },
  ];
  return notebook;
}

test('Sequence filters disclose every relation including membership without disturbing saved layout', () => {
  const notebook = freeze(syntheticStudyRoute()), snapshot = structuredClone(notebook), { graph, calls } = graphHost('sequence');
  graph.setData({ ...notebook, viewKey: 'synthetic:study-route' });
  adjust(graph);
  const state = graph.getViewState(), saves = calls.views.length;
  assert(graph.displayLinks().every(link => link.type === 'sequence'));
  graph.setShowAuxiliary(true);
  assert.deepEqual(graph.displayLinks().map(link => link.id), notebook.links.map(link => link.id));
  graph.setShowAuxiliary(false);
  assert(graph.displayLinks().every(link => link.type === 'sequence'));
  assert.deepEqual(graph.getViewState(), state);
  assert.equal(calls.views.length, saves);
  assert.deepEqual(notebook, snapshot);
});

test('Only-routing action leaves every card, lock and camera exactly unchanged', () => {
  const notebook = freeze(syntheticNotebook(5)), { graph, calls } = graphHost();
  graph.setData({ ...notebook, viewKey: 'synthetic:routes' });
  graph.toggleLock('n00'); adjust(graph, 'n01');
  const before = graph.getViewState(), writes = calls.views.length;
  assert.deepEqual(graph.organize('routes').movedIds, []);
  assert.deepEqual(graph.getViewState(), before);
  assert.equal(calls.views.length, writes);
});

test('Local organization clears a movable overlap, respects lock and viewport and can be undone', () => {
  const notebook = freeze(syntheticNotebook(5)), { graph } = graphHost();
  graph.setData({ ...notebook, viewKey: 'synthetic:local' });
  graph.positions.set('n01', { ...graph.positions.get('n00') });
  graph.toggleLock('n00');
  graph.transform = { x: 135, y: -25, scale: .77 };
  const before = graph.getViewState(), result = graph.organize();
  assert(result.movedIds.includes('n01'));
  assertClearCards(graph.getPositions(), notebook.notes.map(note => note.id));
  assert.deepEqual(graph.getPositions().n00, before.positions.n00);
  assert.deepEqual(graph.transform, before.transform);
  assert.equal(graph.undoLayout(), true);
  assert.deepEqual(graph.getViewState(), before);
});

test('Full reflow preview never persists until applied; cancelling restores mode, positions and camera', () => {
  const notebook = freeze(syntheticNotebook()), { graph, calls } = graphHost();
  graph.setData({ ...notebook, viewKey: 'synthetic:preview' });
  adjust(graph); graph.toggleLock('n00');
  const before = graph.getViewState(), writes = calls.views.length;
  graph.previewLayout('branches');
  assert.equal(graph.layout, 'branches');
  assert.deepEqual(graph.getPositions().n00, before.positions.n00);
  graph.zoomIn(); graph.emitViewChange();
  assert.equal(calls.views.length, writes);
  assert.equal(graph.cancelPreview(), true);
  assert.deepEqual(graph.getViewState(), before);
  assert.equal(calls.views.length, writes);
  graph.previewLayout('branches');
  graph.applyPreview();
  assert.equal(calls.views.length, writes + 1);
  assert.equal(graph.undoLayout(), true);
  assert.deepEqual(graph.getViewState(), before);
  assert.equal(calls.views.length, writes + 2);
});

test('Leaving a preview cancels it before caching the old scope, and structure changes invalidate undo', () => {
  const notebook = syntheticNotebook(5), { graph, calls } = graphHost();
  graph.setData({ ...notebook, viewKey: 'synthetic:first' });
  const before = graph.getViewState(), writes = calls.views.length;
  graph.previewLayout('branches');
  graph.setData({ ...notebook, viewKey: 'synthetic:second' });
  assert.equal(graph.preview, null);
  assert.equal(calls.views.length, writes + 1, 'Only the initial second scope is saved');
  graph.setData({ ...notebook, viewKey: 'synthetic:first' });
  assert.deepEqual(graph.getViewState(), before);
  graph.toggleLock('n00');
  graph.setData({ ...notebook, links: [], viewKey: 'synthetic:first' });
  assert.equal(graph.undoLayout(), false);
  assert(graph.lockedIds.has('n00'));
});

test('Retired card locks do not constrain a reopened view or leave an invisible locked card', () => {
  const notebook = freeze(syntheticNotebook(3)), first = graphHost();
  first.graph.setData({ ...notebook, viewKey: 'synthetic:locks' });
  first.graph.toggleLock('n00');
  const saved = first.graph.getViewState(), { graph, calls } = graphHost();
  graph.setData({ ...notebook, viewKey: 'synthetic:locks', savedView: saved });
  assert.equal(graph.lockedIds.size,0);
  assert.deepEqual(graph.getPositions(), saved.positions, 'Removing the control alone does not move cards');
  graph.eventPoint = () => ({ x: 200, y: 100 });
  graph.pointer = { pointerId: 1, id: 'n00', start: { x: 0, y: 0 }, original: { ...graph.positions.get('n00') } };
  graph.onPointerMove({ pointerId: 1 });
  graph.onPointerUp({ pointerId: 1 });
  assert.notDeepEqual(graph.getPositions(), saved.positions);
  assert.equal(calls.positionChange, 1);
});

test('Typed cycle diagnostics distinguish prerequisite, membership and reading order from mixed feedback', () => {
  const notes = ['m', 'a', 'b', 'c'].map(id => ({ id }));
  const mixed = [
    { from: 'm', to: 'a', type: 'branch' }, { from: 'm', to: 'b', type: 'branch' },
    { from: 'a', to: 'b', type: 'prerequisite' }, { from: 'b', to: 'a', type: 'applies' },
  ];
  assert.deepEqual(relationDiagnostics(notes, mixed), []);
  const issues = relationDiagnostics(notes, [...mixed, { from: 'b', to: 'a', type: 'prerequisite' }, { from: 'b', to: 'c', type: 'prerequisite' }]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].relation, 'prerequisite');
  assert.deepEqual(issues[0].nodeIds, ['a', 'b', 'c']);
});

test('Module grouping represents membership without discarding sibling prerequisite or source edges', () => {
  const { graph } = graphHost();
  const notes = [{ id: 'm', title: 'Module', frameworkModule: true }, { id: 'a' }, { id: 'b' }];
  const links = [{id:'ma',from:'m',to:'a',type:'branch'},{id:'mb',from:'m',to:'b',type:'branch'},{id:'ab',from:'a',to:'b',type:'prerequisite'}];
  graph.setData({notes,links,viewKey:'synthetic:group'});
  graph.positions=new Map([['m',{x:0,y:0}],['a',{x:400,y:0}],['b',{x:800,y:0}]]);
  graph.setShowMembership(false);
  assert.equal(graph.membershipGroups().length,1);
  assert.deepEqual(graph.membershipGroups()[0].memberIds,['a','b']);
  assert.deepEqual(graph.displayLinks().map(edge=>edge.id),['ab']);
  assert.deepEqual(graph.links,links,'No knowledge edge is deleted');
  graph.setShowMembership(true);
  assert.equal(graph.membershipGroups().length,0);
  assert.deepEqual(graph.displayLinks().map(edge=>edge.id),['ma','mb','ab']);
});

test('A compact membership region may contain its owner without restoring the membership fan-out', () => {
  const { graph } = graphHost('clean');
  const notes = [{id:'m',frameworkModule:true},{id:'support'},{id:'a'},{id:'b'}];
  const links = notes.slice(1).map(note=>({id:'m-'+note.id,from:'m',to:note.id,type:'branch'}));
  graph.setData({notes,links});
  graph.positions=new Map([['m',{x:0,y:0}],['support',{x:0,y:248}],['a',{x:500,y:0}],['b',{x:1000,y:248}]]);
  graph.setShowMembership(false);
  assert.equal(graph.membershipGroups().length,1);
  assert.deepEqual(graph.membershipGroups()[0].memberIds,['support','a','b']);
  assert.equal(graph.displayLinks().length,0,'The owner is the region heading, not an unrelated intruder');
  assert.deepEqual(graph.links,links,'The display never removes the original membership links');
  graph.setShowMembership(true);
  assert.equal(graph.displayLinks().length,3,'Every stored membership remains available');
});

test('A sparse module groups membership and combines only an exactly overlapping study arrow',()=>{
  const {graph}=graphHost('clean');
  const notes=[{id:'m',frameworkModule:true},{id:'a'},{id:'b'},{id:'c'}];
  const links=[...notes.slice(1).map(n=>({id:'m-'+n.id,from:'m',to:n.id,type:'branch'})),
    {id:'read-ab',from:'a',to:'b',type:'sequence'},{id:'read-bc',from:'b',to:'c',type:'sequence'},
    {id:'know-ab',from:'a',to:'b',type:'prerequisite'}];
  const before=structuredClone({notes,links});
  graph.setData({notes,links});
  assert.deepEqual(new Set(graph.displayLinks().map(e=>e.id)),new Set(['read-bc','know-ab']));
  assert.deepEqual(graph.representedByLinkId.get('know-ab').map(edge=>edge.id),['read-ab']);
  assert.equal(graph.membershipGroups().reduce((sum,group)=>sum+group.linkIds.length,0),3);
  graph.setShowAuxiliary(true);
  assert.deepEqual(new Set(graph.displayLinks().map(e=>e.id)),new Set(links.map(e=>e.id)),'Presentation controls cannot silently drop a stored edge');
  assert.deepEqual({notes,links},before);
});

test('Every visible relation has strong background contrast and a legible screen-space width',()=>{
  const luminance=hex=>{
    const channels=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
  };
  const background=luminance('#fafbfc');
  for(const [type,config] of Object.entries(GRAPH_RELATIONS)){
    assert.ok((background+.05)/(luminance(config.color)+.05)>=3,`${type} has at least 3:1 contrast`);
    assert.ok(config.width>=2,`${type} keeps a visible stroke at overview zoom`);
  }
  assert.notEqual(GRAPH_RELATIONS.sequence.color,GRAPH_RELATIONS.prerequisite.color);
  assert.equal(GRAPH_RELATIONS.parallel.arrow,false);
});

test('Pure study-order relationships remain visible independently of the removed reading toolbar',()=>{
  const {graph}=graphHost('clean');
  const links=[{id:'ab',from:'a',to:'b',type:'sequence',label:'Original study order'}];
  graph.setData({notes:[{id:'a'},{id:'b'}],links});
  assert.deepEqual(graph.displayLinks(),links);
  graph.setShowAuxiliary(true);
  assert.deepEqual(graph.displayLinks(),links);
});

test('A mixed course keeps the unique reading continuation to blank chapters',()=>{
  const {graph}=graphHost('clean');
  const notes=[{id:'m',frameworkModule:true},...['a','b','c','d','supplement'].map(id=>({id}))];
  const links=[...notes.slice(1).map(n=>({id:'m-'+n.id,from:'m',to:n.id,type:'branch'})),
    {id:'content-ab',from:'a',to:'b',type:'extends',label:'Same model with a new condition'},
    {id:'read-ab',from:'a',to:'b',type:'sequence'},
    {id:'read-bc',from:'b',to:'c',type:'sequence'},
    {id:'read-cd',from:'c',to:'d',type:'sequence'}];
  const before=structuredClone({notes,links});
  graph.setData({notes,links,viewKey:'synthetic:essential-course'});
  assert.deepEqual(new Set(graph.displayLinks().map(e=>e.id)),new Set(['content-ab','read-bc','read-cd']));
  const group=graph.membershipGroups()[0];
  assert(group.memberIds.includes('supplement'),'An empty support card retains explicit module membership');
  assert.equal(group.linkIds.length,5);
  assert(group.bounds.left<=graph.positions.get('m').x&&group.bounds.top<=graph.positions.get('m').y,'The module card is inside its own group');
  const view=graph.getViewState();
  graph.setShowAuxiliary(true);
  assert.equal(graph.membershipGroups().length,0);
  assert.deepEqual(new Set(graph.displayLinks().map(e=>e.id)),new Set(links.map(e=>e.id)));
  graph.setShowAuxiliary(false);
  assert.equal(graph.displayLinks().length,3);
  assert.deepEqual(graph.getViewState(),view,'Presentation changes preserve camera and every position');
  assert.deepEqual({notes,links},before);
});

test('An unordered catalog star retains its arrows instead of becoming an empty group',()=>{
  const {graph}=graphHost('clean');
  const notes=[{id:'m',frameworkModule:true},{id:'a'},{id:'b'}];
  const links=[{id:'ma',from:'m',to:'a',type:'branch'},{id:'mb',from:'m',to:'b',type:'branch'}];
  graph.setData({notes,links});
  assert.equal(graph.membershipGroups().length,0);
  assert.deepEqual(new Set(graph.displayLinks().map(e=>e.id)),new Set(['ma','mb']));
});

test('Membership candidate queries inspect a pure catalog without changing visible arrows or saved views',()=>{
  const {graph,calls}=graphHost('clean');
  const notes=[{id:'m',frameworkModule:true},{id:'a'},{id:'b'}];
  const links=[{id:'ma',from:'m',to:'a',type:'branch'},{id:'mb',from:'m',to:'b',type:'branch'}];
  graph.setData({notes,links,viewKey:'synthetic:membership-candidates'});
  for(const showLines of [false,true]){
    graph.showMembershipLines=showLines;
    graph.forceMembershipGroups=false;
    const before=graph.getViewState(),renders=calls.render,writes=calls.views.length;
    assert.equal(graph.membershipGroups().length,0,'A query must not turn a pure catalog into a default group');
    const candidates=graph.membershipGroups({force:true});
    assert.equal(candidates.length,1);
    assert.deepEqual(new Set(candidates[0].memberIds),new Set(['a','b']));
    assert.deepEqual(new Set(candidates[0].linkIds),new Set(['ma','mb']));
    assert(candidates[0].bounds.left<=graph.positions.get('m').x&&candidates[0].bounds.top<=graph.positions.get('m').y,
      'A candidate includes the owner rather than leaving a detached heading');
    assert.equal(graph.showMembershipLines,showLines);
    assert.equal(graph.forceMembershipGroups,false);
    assert.equal(graph.membershipGroups().length,0);
    assert.deepEqual(new Set(graph.displayLinks().map(e=>e.id)),new Set(['ma','mb']));
    assert.deepEqual(graph.getViewState(),before);
    assert.equal(calls.render,renders,'Candidate inspection does not render or start a layout');
    assert.equal(calls.views.length,writes,'Candidate inspection cannot persist a preference');
  }
});

test('Forced membership candidates cannot enclose an unrelated card in otherwise clear geometry',()=>{
  const {graph,calls}=graphHost('clean');
  const notes=[{id:'m',frameworkModule:true},{id:'a'},{id:'b'},{id:'outside'}];
  const links=[{id:'ma',from:'m',to:'a',type:'branch'},{id:'mb',from:'m',to:'b',type:'branch'},
    {id:'ab',from:'a',to:'b',type:'prerequisite'}];
  graph.setData({notes,links,viewKey:'synthetic:unsafe-membership-candidate'});
  graph.positions=new Map([['m',{x:0,y:0}],['a',{x:400,y:0}],['b',{x:800,y:500}],['outside',{x:600,y:250}]]);
  graph.showMembershipLines=true;
  graph.forceMembershipGroups=true;
  const before=graph.getViewState(),renders=calls.render,writes=calls.views.length;
  assert.deepEqual(graph.membershipGroups({force:true}),[],
    'Forcing candidate inspection never overrides the unrelated-card safety boundary');
  assert.equal(graph.showMembershipLines,true);
  assert.equal(graph.forceMembershipGroups,true);
  assert.deepEqual(new Set(graph.displayLinks().map(e=>e.id)),new Set(['ma','mb','ab']));
  assert.deepEqual(graph.getViewState(),before);
  assert.equal(calls.render,renders);
  assert.equal(calls.views.length,writes);
});

test('A grouping never encloses unrelated cards or silently chooses one of multiple memberships', () => {
  const { graph } = graphHost();
  graph.setData({notes:[{id:'m',frameworkModule:true},{id:'a'},{id:'b'},{id:'outside'}],links:[{id:'ma',from:'m',to:'a',type:'branch'},{id:'mb',from:'m',to:'b',type:'branch'}]});
  graph.positions=new Map([['m',{x:0,y:0}],['a',{x:400,y:0}],['b',{x:800,y:0}],['outside',{x:650,y:0}]]);
  assert.deepEqual(graph.membershipGroups(),[]);
  assert.equal(graph.displayLinks().length,2);
});

test('Entering preview flushes the pre-preview wheel view and never saves the proposed arrangement', () => {
  const { graph, calls } = graphHost();
  graph.setData({...syntheticNotebook(3),viewKey:'synthetic:pending'});
  graph.eventPoint=()=>({x:200,y:150});
  graph.onWheel({preventDefault(){},deltaY:-70});
  const before=graph.getViewState(),writes=calls.views.length;
  graph.previewLayout('branches');
  assert.equal(calls.views.length,writes+1);
  assert.deepEqual(calls.views.at(-1).view,before);
  assert.equal(graph.viewTimer,null);
  graph.cancelPreview();
  assert.deepEqual(graph.getViewState(),before);
  assert.equal(calls.views.length,writes+1);
});

test('Changing a study route preserves manual positions until the user explicitly requests rearrangement', () => {
  const notebook = syntheticStudyRoute(), { graph, calls } = graphHost('sequence');
  graph.setData({ ...notebook, viewKey: 'synthetic:study-route' });
  const original = graph.getPositions();
  adjust(graph);
  const manual = graph.getViewState(), saves = calls.views.length;
  const changed = structuredClone(notebook);
  for (const link of changed.links.filter(link => link.type === 'sequence')) [link.from, link.to] = [link.to, link.from];
  graph.setData({ ...changed, viewKey: 'synthetic:study-route' });
  assert.deepEqual(graph.getViewState(), manual);
  assert.equal(calls.layout, 1);
  assert.equal(calls.views.length, saves);
  graph.autoLayout();
  assert.equal(calls.layout, 2);
  assert.notDeepEqual(graph.getPositions().n01, original.n01);
  assertClearCards(graph.getPositions(), changed.notes.map(note => note.id));
  assert.equal(calls.views.length, saves + 1);
});


test('Initial automatic viewport settling persists the final camera once without moving any cards', () => {
  let bounds = { width: 340, height: 240 };
  const { graph, calls } = graphHost('sequence');
  Object.assign(graph, {
    container: { getBoundingClientRect: () => bounds },
    hint: { textContent: '' }, hintText: 'Synthetic graph',
    readableView: KnowledgeGraph.prototype.readableView,
  });
  graph.setData({ ...syntheticStudyRoute(), viewKey: 'synthetic:settling' });
  const first = graph.getViewState(), saves = calls.views.length;
  bounds = { width: 1400, height: 900 };
  graph.handleResize(bounds);
  assert.equal(calls.layout, 1, 'A settling pane changes only its camera, never card geometry');
  assert.deepEqual(graph.getPositions(), first.positions);
  assert.notDeepEqual(graph.transform, first.transform);
  assert.equal(calls.views.length, saves + 1);
  assert.deepEqual(calls.views.at(-1), { view: graph.getViewState(), viewKey: 'synthetic:settling' });
  const final = graph.getViewState();
  graph.handleResize(bounds);
  graph.handleResize({ width: 0, height: 0 });
  assert.deepEqual(graph.getViewState(), final);
  assert.equal(calls.views.length, saves + 1, 'Identical or hidden measurements do not rewrite the saved camera');
  const reopened = graphHost('sequence');
  reopened.graph.setData({ ...syntheticStudyRoute(), viewKey: 'synthetic:settling', savedView: { ...final, viewKey: 'synthetic:settling' } });
  assert.deepEqual(reopened.graph.getViewState(), final);
  assert.equal(reopened.calls.layout, 0);
  assert.equal(reopened.calls.readable, 0);
});

test('A restored manual viewport survives pane settling without recentering or persistence callbacks', () => {
  const notebook = syntheticNotebook(5), original = graphHost().graph;
  original.setData({ ...notebook, viewKey: 'synthetic:manual-resize' });
  adjust(original);
  const saved = original.getViewState(), { graph, calls } = graphHost();
  let bounds = { width: 340, height: 240 };
  graph.container = { getBoundingClientRect: () => bounds };
  graph.setData({ ...notebook, viewKey: 'synthetic:manual-resize', savedView: { ...saved, viewKey: 'synthetic:manual-resize' } });
  bounds = { width: 1400, height: 900 };
  graph.handleResize(bounds);
  assert.deepEqual(graph.getViewState(), saved);
  assert.equal(graph.width, bounds.width);
  assert.equal(graph.height, bounds.height);
  assert.equal(calls.layout, 0);
  assert.equal(calls.readable, 0);
  assert.equal(calls.views.length, 0, 'A restored camera does not get replaced by an automatic resize snapshot');
});

test('Explicit full-graph fitting follows later canvas sizes and persists the updated fitted camera', () => {
  const { graph, calls } = graphHost();
  let bounds = { width: 1200, height: 800 };
  Object.assign(graph, {
    container: { getBoundingClientRect: () => bounds },
    hint: { textContent: '' }, hintText: 'Synthetic graph',
    readableView: KnowledgeGraph.prototype.readableView,
  });
  graph.setData({ ...syntheticNotebook(30), viewKey: 'synthetic:fit-resize' });
  graph.fit();
  const first = graph.getViewState(), saves = calls.views.length;
  bounds = { width: 800, height: 600 };
  graph.handleResize(bounds);
  assert.deepEqual(graph.getPositions(), first.positions);
  assert.notDeepEqual(graph.transform, first.transform);
  assert.equal(calls.views.length, saves + 1);
  assert.deepEqual(calls.views.at(-1).view, graph.getViewState());
  assert.equal(calls.layout, 1);
});

test('Full-graph fitting includes both ends of a wide graph below the former minimum zoom', () => {
  const {graph}=graphHost('clean');
  graph.container={getBoundingClientRect:()=>({width:600,height:400})};
  graph.hint={textContent:''};graph.hintText='Synthetic graph';
  const notebook=syntheticNotebook(2);
  graph.setData({...notebook,viewKey:'synthetic:wide'});
  graph.positions=new Map([['n00',{x:-200,y:0}],['n01',{x:12000,y:0}]]);
  graph.fit();
  assert.ok(graph.transform.scale<.12);
  const bounds=graph.graphBounds(),camera=graph.transform;
  assert.ok(bounds.minX*camera.scale+camera.x>=0);
  assert.ok(bounds.maxX*camera.scale+camera.x<=600);
  const reopened=graphHost('clean').graph;
  reopened.setData({...notebook,viewKey:'synthetic:wide',savedView:graph.getViewState()});
  assert.deepEqual(reopened.transform,camera);
});

test('Content feedback stays visible while an overlapping study order shares its scientific arrow',()=>{
  const {graph}=graphHost('clean');
  const notes=['a','b','c'].map(id=>({id,title:id}));
  const links=[{id:'ab',from:'a',to:'b',type:'applies'},{id:'bc',from:'b',to:'c',type:'evidence'},{id:'ca',from:'c',to:'a',type:'extends'},{id:'read-ab',from:'a',to:'b',type:'sequence'}];
  graph.setData({notes,links,viewKey:'synthetic:feedback'});
  assert.deepEqual(new Set(graph.displayLinks().map(e=>e.id)),new Set(['ab','bc','ca']));
  assert.deepEqual(graph.representedByLinkId.get('ab').map(edge=>edge.id),['read-ab']);
  graph.setShowAuxiliary(true);
  assert.equal(graph.displayLinks().length,4);
  assert.deepEqual(graph.links,links);
});

test('The clean map presents content relationships with multiple inputs while reading order stays supplementary', () => {
  const notebook = freeze(syntheticStudyRoute()), snapshot = structuredClone(notebook);
  const { graph, calls } = graphHost('clean');
  graph.setData({ ...notebook, viewKey: 'synthetic:clean' });
  const primary = graph.displayLinks();
  assert.equal(primary.length, notebook.links.length);
  assert.ok(primary.some(link => link.type === 'sequence'), 'Reading navigation remains labelled separately from scientific meaning');
  assert.ok(primary.some(link => link.id === 'support-prior'));
  assert.ok(primary.some(link => link.id === 'support-evidence'));
  assert.equal(primary.filter(link => link.to === 'n04'&&['prerequisite','evidence'].includes(link.type)).length, 2, 'Prior knowledge and evidence both reach the same concept');
  assert(primary.some(link=>link.to==='n04'&&link.type==='branch'),'Direct membership is separately retained');
  assertClearCards(graph.getPositions(), notebook.notes.map(note => note.id));
  const original = graph.getViewState(), saves = calls.views.length;
  graph.setShowAuxiliary(true);
  assert.deepEqual(graph.displayLinks().map(link => link.id).sort(), notebook.links.map(link => link.id).sort());
  graph.setShowAuxiliary(false);
  assert.deepEqual(graph.displayLinks().map(link => link.id).sort(), primary.map(link => link.id).sort());
  assert.deepEqual(graph.getViewState(), original, 'Showing cross-references does not rearrange the map');
  assert.equal(calls.views.length, saves);
  assert.equal(calls.positionChange, 0);
  assert.deepEqual(notebook, snapshot);
});

test('A clean map retains existing cards and camera when relationships or membership change', () => {
  const variants = [
    ['add a card', notebook => {
      notebook.notes.push({ ...notebook.notes[0], id: 'new-card' });
      notebook.links.push({ id: 'new-edge', from: 'n05', to: 'new-card', type: 'sequence' });
    }],
    ['remove a card', notebook => {
      notebook.notes = notebook.notes.filter(note => note.id !== 'n06');
      notebook.links = notebook.links.filter(link => link.from !== 'n06' && link.to !== 'n06');
    }],
    ['reverse a reading edge', notebook => {
      const edge = notebook.links.find(link => link.type === 'sequence');
      [edge.from, edge.to] = [edge.to, edge.from];
    }],
    ['change a relationship type', notebook => {
      notebook.links.find(link => link.id === 'optional-study').type = 'applies';
    }],
  ];
  for (const [label, change] of variants) {
    const notebook = syntheticStudyRoute(), { graph, calls } = graphHost('clean');
    graph.setData({ ...notebook, viewKey: 'synthetic:clean' });
    adjust(graph, 'n01');
    const manual = graph.getViewState(), saves = calls.views.length;
    const changed = structuredClone(notebook);
    change(changed);
    const snapshot = structuredClone(changed);
    freeze(changed);
    graph.setData({ ...changed, viewKey: 'synthetic:clean' });
    assert.equal(calls.layout, 1, label + ' does not rearrange existing cards');
    assert.equal(calls.readable, 1, label + ' does not reset the current camera');
    assert.deepEqual(graph.transform, manual.transform);
    for (const note of changed.notes) if (manual.positions[note.id]) assert.deepEqual(graph.getPositions()[note.id], manual.positions[note.id]);
    assert.notEqual(graph.getViewState().structureKey, manual.structureKey);
    assertClearCards(graph.getPositions(), changed.notes.map(note => note.id));
    assert.equal(calls.views.length, saves + 1);
    assert.equal(calls.positionChange, 0);
    assert.deepEqual(changed, snapshot, label + ' changes no notebook fields during presentation');
  }
});

test('Clean map selection, text edits and input order preserve the current arrangement and structure identity', () => {
  const notebook = syntheticStudyRoute(), { graph, calls } = graphHost('clean');
  graph.setData({ ...notebook, viewKey: 'synthetic:clean' });
  const olderSavedView = graph.getViewState();
  adjust(graph);
  const expected = graph.getViewState(), saves = calls.views.length;
  graph.setData({
    notes: [...notebook.notes].reverse().map(note => ({ ...note, title: 'Updated title', content: 'Updated content', status: 'understood' })),
    links: [...notebook.links].reverse().map(link => ({ ...link, id: 'renamed-' + link.id, label: 'New explanation' })),
    selectedId: 'n02', query: '  Updated ', viewKey: 'synthetic:clean', savedView: olderSavedView,
  });
  assert.deepEqual(graph.getViewState(), expected);
  assert.equal(calls.layout, 1);
  assert.equal(calls.readable, 1);
  assert.equal(calls.views.length, saves);
  assert.equal(calls.positionChange, 0);
  assert.equal(graph.selectedId, 'n02');
});

test('A clean view restores valid saved cards and ignores incompatible or malformed arrangements', () => {
  const notebook = syntheticStudyRoute(), original = graphHost('clean').graph;
  original.setData({ ...notebook, viewKey: 'synthetic:clean' });
  adjust(original);
  const saved = original.getViewState();
  assert.equal(saved.layout, 'clean');
  assert.equal(typeof saved.structureKey, 'string');
  assert.ok(saved.structureKey.startsWith('clean-logic-v1-'));
  assert.ok(saved.structureKey.length > 0 && saved.structureKey.length <= 100);
  const restored = graphHost('clean');
  restored.graph.setData({ ...notebook, viewKey: 'synthetic:clean', savedView: freeze({ version: 2, ...saved }) });
  assert.deepEqual(restored.graph.getViewState(), saved);
  assert.equal(restored.calls.layout, 0);
  assert.equal(restored.calls.readable, 0);
  assert.equal(restored.calls.views.length, 0);

  const legacy = graphHost('columns').graph;
  legacy.setData({ ...notebook, viewKey: 'synthetic:clean' });
  adjust(legacy);
  const missingKey = structuredClone(saved); delete missingKey.structureKey;
  const candidates = [
    { version: 1, ...legacy.getViewState() },
    { ...saved, structureKey: saved.structureKey.replace('clean-logic-v1-', 'clean-v1-') },
    { ...saved, structureKey: saved.structureKey.replace('clean-logic-v1-', 'clean-horizontal-v1-') },
    { ...saved, structureKey: 'outdated-structure' },
    missingKey,
    { ...saved, positions: { ...saved.positions, n01: { x: Infinity, y: 0 } } },
  ];
  for (const savedView of candidates) {
    const { graph, calls } = graphHost('clean');
    graph.setData({ ...notebook, viewKey: 'synthetic:clean', savedView });
    assert.equal(calls.layout, 1, 'An incompatible snapshot cannot revive a disordered old map');
    assert.equal(calls.readable, 1);
    assert.notDeepEqual(graph.getPositions().n03, saved.positions.n03);
    assertClearCards(graph.getPositions(), notebook.notes.map(note => note.id));
    assert.equal(calls.positionChange, 0);
  }
});

test('Reopening after a relationship change preserves saved cards and camera while renewing the structure identity', () => {
  const notebook = syntheticStudyRoute(), original = graphHost('clean').graph;
  original.setData({ ...notebook, viewKey: 'synthetic:clean' });
  adjust(original);
  const saved = original.getViewState(), changed = structuredClone(notebook);
  const edge = changed.links.find(link => link.type === 'sequence');
  [edge.from, edge.to] = [edge.to, edge.from];
  const { graph, calls } = graphHost('clean');
  graph.setData({ ...changed, viewKey: 'synthetic:clean', savedView: saved });
  assert.equal(calls.layout, 0);
  assert.equal(calls.readable, 0);
  assert.deepEqual(graph.getPositions(), saved.positions);
  assert.deepEqual(graph.transform, saved.transform);
  assert.notEqual(graph.getViewState().structureKey, saved.structureKey);
  assertClearCards(graph.getPositions(), changed.notes.map(note => note.id));
  assert.equal(calls.views.length, 1, 'Only the updated view identity needs persistence');
  assert.equal(calls.positionChange, 0);
});

test('Organizing connections redraws routes without moving cards, camera or selection', () => {
  const notebook = freeze(syntheticStudyRoute()), snapshot = structuredClone(notebook);
  const { graph, calls } = graphHost('clean');
  graph.setData({ ...notebook, selectedId: 'n02', viewKey: 'synthetic:connections' });
  adjust(graph);
  const before = graph.getViewState(), renders = calls.render, layouts = calls.layout, readable = calls.readable;
  assert.deepEqual(graph.organizeConnections(), before.positions);
  assert.deepEqual(graph.getViewState(), before);
  assert.equal(graph.selectedId, 'n02');
  assert.equal(calls.render, renders + 1, 'The router and label placement run again');
  assert.equal(calls.layout, layouts);
  assert.equal(calls.readable, readable);
  assert.equal(calls.positionChange, 0);
  assert.deepEqual(calls.views.at(-1).view, before);
  graph.organizeConnections();
  assert.deepEqual(graph.getViewState(), before, 'Repeated organization stays stable');
  assert.deepEqual(notebook, snapshot);
});

test('A partially retained clean view places only missing cards and prunes removed cards on reopening', () => {
  const notebook = syntheticStudyRoute(), original = graphHost('clean').graph;
  original.setData({ ...notebook, viewKey: 'synthetic:partial' });
  adjust(original);
  const saved = original.getViewState(), partial = structuredClone(saved);
  delete partial.positions.n06;
  partial.positions.removed = { x: -1000, y: 40 };
  const { graph, calls } = graphHost('clean');
  graph.setData({ ...notebook, viewKey: 'synthetic:partial', savedView: freeze(partial) });
  for (const note of notebook.notes) if (partial.positions[note.id]) assert.deepEqual(graph.getPositions()[note.id], partial.positions[note.id]);
  assert.equal(Object.hasOwn(graph.getPositions(), 'removed'), false);
  assert.deepEqual(graph.transform, saved.transform);
  assertClearCards(graph.getPositions(), notebook.notes.map(note => note.id));
  assert.equal(calls.layout, 0);
  assert.equal(calls.readable, 0);
  assert.equal(calls.views.length, 1);
});

test('A restored clean camera survives header and canvas-height settling after refresh', () => {
  const notebook = syntheticStudyRoute(), original = graphHost('clean').graph;
  original.setData({ ...notebook, viewKey: 'synthetic:height-settling' });
  adjust(original);
  const saved = original.getViewState(), { graph, calls } = graphHost('clean');
  let bounds = { width: 1200, height: 260 };
  graph.container = { getBoundingClientRect: () => bounds };
  graph.setData({ ...notebook, viewKey: 'synthetic:height-settling', savedView: { version: 2, ...saved } });
  bounds = { width: 1200, height: 800 };
  graph.handleResize(bounds);
  assert.deepEqual(graph.getViewState(), saved);
  assert.equal(calls.layout, 0);
  assert.equal(calls.readable, 0);
  assert.equal(calls.views.length, 0);
});

test('A restored clean map adapts its camera across a narrow-canvas breakpoint without rearranging cards', () => {
  const notebook = freeze(syntheticStudyRoute()), snapshot = structuredClone(notebook);
  const wide = { width: 1600, height: 1000 }, original = graphHost('clean').graph;
  Object.assign(original, {
    container: { getBoundingClientRect: () => wide },
    hint: { textContent: '' }, hintText: 'Synthetic clean map',
    readableView: KnowledgeGraph.prototype.readableView,
  });
  original.setData({ ...notebook, viewKey: 'synthetic:responsive-clean' });
  const saved = original.getViewState(), { graph, calls } = graphHost('clean');
  let bounds = wide;
  Object.assign(graph, {
    container: { getBoundingClientRect: () => bounds },
    hint: { textContent: '' }, hintText: 'Synthetic clean map',
    readableView: KnowledgeGraph.prototype.readableView,
  });
  graph.setData({ ...notebook, viewKey: 'synthetic:responsive-clean', savedView: { version: 2, ...saved } });
  assert.deepEqual(graph.getViewState(), saved);
  assert.equal(graph.viewMode, 'manual');
  assert.equal(calls.layout, 0);
  assert.equal(calls.views.length, 0);

  bounds = { width: 390, height: 844 };
  graph.handleResize(bounds);
  assert.deepEqual(graph.getPositions(), saved.positions, 'Responsive adaptation changes only the camera');
  assert.notDeepEqual(graph.transform, saved.transform);
  assert.equal(calls.layout, 0);
  assert.equal(calls.positionChange, 0);
  assert.equal(calls.views.length, 1);
  assert.deepEqual(calls.views[0], { view: graph.getViewState(), viewKey: 'synthetic:responsive-clean' });
  const first = [...graph.positions.values()].sort((a, b) => a.x - b.x || a.y - b.y)[0];
  const { x, y, scale } = graph.transform;
  const left = first.x * scale + x, top = first.y * scale + y;
  assert.ok(left >= 0 && top >= 0, 'The first card begins inside the narrow viewport instead of an empty outline corner');
  assert.ok(left + 300 * scale <= bounds.width && top + 168 * scale <= bounds.height,
    'The complete content card remains readable after narrowing');

  graph.viewMode = 'manual';
  const adapted = graph.getViewState(), saves = calls.views.length;
  bounds = { width: 410, height: 820 };
  graph.handleResize(bounds);
  assert.deepEqual(graph.getViewState(), adapted, 'Pane settling within the same breakpoint keeps a manual viewport');
  assert.equal(calls.views.length, saves);
  assert.equal(calls.layout, 0);
  assert.deepEqual(notebook, snapshot);
});

test('An expanded clean hierarchy starts with its foundational card instead of an empty outline corner', () => {
  const notebook = freeze(syntheticNotebook(50)), snapshot = structuredClone(notebook);
  const bounds = { width: 1600, height: 700 }, { graph, calls } = graphHost('clean');
  Object.assign(graph, {
    container: { getBoundingClientRect: () => bounds },
    hint: { textContent: '' }, hintText: 'Synthetic clean hierarchy',
    readableView: KnowledgeGraph.prototype.readableView,
  });
  graph.setData({ ...notebook, viewKey: 'synthetic:upper-branches' });
  assert.equal(graph.readableOverflow, true);
  const [firstId, first] = [...graph.positions].sort(([, a], [, b]) => a.x - b.x || a.y - b.y)[0];
  assert.equal(firstId, 'n00', 'The dependency root is the reading entrance');
  const { x, y, scale } = graph.transform;
  const left = first.x * scale + x, top = first.y * scale + y;
  assert.ok(left >= 0 && top >= 0, 'The foundational card starts inside the default camera');
  assert.ok(left + 300 * scale <= bounds.width && top + 168 * scale <= bounds.height,
    'The first card remains fully readable while the rest can be reached by panning');
  assert.equal(calls.layout, 1);
  assert.equal(calls.positionChange, 0);
  assert.deepEqual(calls.views, [{ view: graph.getViewState(), viewKey: 'synthetic:upper-branches' }]);
  assert.deepEqual(notebook, snapshot);
});
