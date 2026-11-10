import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { computeGraphLayout, computeIncrementalLayout, placeAdditionalNodes, layoutSignature, studySequenceOrder, cleanGraphPlan, relationLabelGeometry } from '../src/public/graph-layout.js';

const notes = ids => ids.map(id => ({ id, title: 'Synthetic ' + id }));
const link = (from, to, type = 'branch') => ({ id: from + '-' + to + '-' + type, from, to, type });
const modes = ['columns', 'branches'];
const shuffled = items => [...items.filter((_, i) => i % 2).reverse(), ...items.filter((_, i) => !(i % 2)).reverse()];

test('Browsing index retains parallel preparation, three-input merging and research feedback',()=>{
  const items=notes(['start','p','q','theory','merge','measure','explain']);
  const semantic=[link('start','p','applies'),link('start','q','applies'),link('p','q','parallel'),link('p','merge','applies'),link('q','merge','applies'),link('theory','merge','prerequisite'),link('theory','explain','applies'),link('merge','measure','extends'),link('measure','explain','evidence'),link('explain','start','extends')];
  const order=['start','p','q','theory','merge','measure','explain'];
  const edges=[...semantic,...order.slice(1).map((id,i)=>link(order[i],id,'sequence'))];
  const snapshot=structuredClone({items,edges}),plan=cleanGraphPlan(items,edges);
  const positions=computeGraphLayout(items,edges,{mode:'clean'});
  assert.equal(positions.p.x,positions.q.x);
  for(const id of ['p','q','theory'])assert(positions[id].x<positions.merge.x);
  assert.equal(plan.primaryLinks.filter(e=>e.to==='merge'&&['applies','prerequisite'].includes(e.type)).length,3);
  assert(plan.auxiliaryLinks.some(e=>e.from==='explain'&&e.to==='start'));
  assert(!plan.primaryLinks.some(e=>e.type==='sequence'));
  assert.equal(plan.primaryLinks.length+plan.auxiliaryLinks.length,edges.length);
  assert.deepEqual({items,edges},snapshot);
});

test('Long reading modules retain memberships, actual dependencies and populated supplements',()=>{
  const ids=['m',...Array.from({length:7},(_,i)=>'lesson'+i),'f1','f2','later'];
  const items=notes(ids).map(n=>({...n,content:n.id==='later'?'':'Existing text',tags:n.id==='m'?['框架模块']:n.id==='f1'?['基础']:[]}));
  const edges=[...ids.slice(1).map(id=>link('m',id)),...Array.from({length:6},(_,i)=>link('lesson'+i,'lesson'+(i+1),'sequence')),link('lesson3','lesson4','prerequisite')];
  edges.find(e=>e.to==='f2').label='基础补充；旧说明不决定是否有正文';
  const before=structuredClone({items,edges}),plan=cleanGraphPlan(items,edges);
  assert.equal(plan.primaryLinks.filter(e=>e.type==='branch').length,10);
  assert.equal(plan.primaryLinks.filter(e=>e.type==='prerequisite').length,1);
  assert.equal(plan.auxiliaryLinks.filter(e=>e.type==='sequence').length,6);
  assert.equal(studySequenceOrder(items,edges).length,7);
  assertCards(computeGraphLayout(items,edges,{mode:'clean'}),ids);
  assert.deepEqual({items,edges},before);
});

test('Sparse modules use reviewed content topology without a fixed reading grid or a forced single row', () => {
  const reading = Array.from({ length: 7 }, (_, i) => 'lesson-' + i);
  const ids = ['module', ...reading, 'support-a', 'support-b', 'support-c'];
  const items = notes(ids), edges = [...ids.slice(1).map(id => link('module', id)),
    ...reading.slice(1).map((id, i) => link(reading[i], id, 'sequence')),
    link(reading[3], reading[4], 'prerequisite')];
  const before = structuredClone({ items, edges });
  const options = { mode: 'clean', nodeWidth: 300, nodeHeight: 168, originX: -13, originY: 29 };
  const result = computeGraphLayout(items, edges, options);
  assertCards(result, ids, { ...options, minimumGap: 80 });
  assert.ok(result[reading[4]].x > result[reading[3]].x, 'The reviewed dependency points right');
  assert.equal(result[reading[0]].x, result[reading[1]].x, 'Unrelated peers do not become scientific successors');
  const plan = cleanGraphPlan(items, edges);
  assert.equal(plan.primaryLinks.length + plan.auxiliaryLinks.length, edges.length);
  assert.deepEqual(computeGraphLayout(shuffled(items), shuffled(edges), options), result);
  assert.deepEqual({ items, edges }, before);
});

test('A newly reviewed content dependency changes its layer without inventing a chapter-order chain', () => {
  const reading = Array.from({ length: 7 }, (_, i) => 'step-' + i);
  const ids = ['module', ...reading, 'support'];
  const edges = [...ids.slice(1).map(id => link('module', id)),
    ...reading.slice(1).map((id, i) => link(reading[i], id, 'sequence'))];
  const base = computeGraphLayout(notes(ids), edges, { mode: 'clean' });
  assert.equal(base[reading[0]].x, base[reading[1]].x);
  edges.push(link(reading[2], reading[3], 'prerequisite'));
  const result = computeGraphLayout(notes(ids), edges, { mode: 'clean' });
  assert.ok(result[reading[3]].x > result[reading[2]].x);
  assert.equal(result[reading[0]].x, result[reading[1]].x);
  assertCards(result, ids);
});

test('Explicit parallel groups and multiple parents cannot be flattened into the sparse reading fallback', () => {
  const reading = Array.from({ length: 7 }, (_, i) => 'step-' + i);
  const ids = ['module', ...reading, 'support'];
  const edges = [...ids.slice(1).map(id => link('module', id)),
    ...reading.slice(1).map((id, i) => link(reading[i], id, 'sequence'))];
  const parallel = computeGraphLayout(notes(ids), [...edges, link(reading[0], reading[1], 'parallel')], { mode: 'clean' });
  assert.equal(parallel[reading[0]].x, parallel[reading[1]].x);
  assert.notEqual(parallel[reading[0]].y, parallel[reading[1]].y);
  const merge = computeGraphLayout(notes(ids), [...edges,
    link(reading[0], reading[2], 'applies'), link(reading[1], reading[2], 'prerequisite')], { mode: 'clean' });
  assert.equal(merge[reading[0]].x, merge[reading[1]].x, 'A genuine two-input merge retains its shared upstream column');
  for (const id of reading.slice(0, 2)) assert.ok(merge[id].x < merge[reading[2]].x);
  const membership = computeGraphLayout(notes(ids), [...edges, link(reading[0], reading[1])], { mode: 'clean' });
  assert.ok(membership[reading[1]].x > membership[reading[0]].x, 'Multiple membership parents keep the explicit hierarchy');
});

test('Optional module context stays outside and cannot reshape the module core',()=>{
  const core=notes(['m','a','b','c']);
  const edges=[link('m','a'),link('m','b'),link('m','c'),link('a','b','parallel')];
  const base=computeGraphLayout(core,edges,{mode:'clean'});
  const context=[{id:'prior',graphContext:true},{id:'next',graphContext:true},{id:'side',contextNode:true}];
  const all=[...edges,link('prior','m','prerequisite'),link('m','next','applies'),link('c','side','parallel')];
  const result=computeGraphLayout([...core,...context],all,{mode:'clean'});
  for(const n of core)assert.deepEqual(result[n.id],base[n.id]);
  assert(result.prior.x<Math.min(...Object.values(base).map(p=>p.x)));
  for(const id of ['next','side'])assert(result[id].x>Math.max(...Object.values(base).map(p=>p.x)));
  assertCards(result,[...core,...context].map(n=>n.id));
});
function bounds(positions, width = 244, height = 108) {
  const values = Object.values(positions);
  return { width: Math.max(...values.map(p => p.x + width)) - Math.min(...values.map(p => p.x)), height: Math.max(...values.map(p => p.y + height)) - Math.min(...values.map(p => p.y)) };
}
function assertCards(positions, ids, { nodeWidth = 244, nodeHeight = 108, minimumGap = 48 } = {}) {
  assert.deepEqual(Object.keys(positions).sort(), [...ids].sort(), 'Every visible node has exactly one position');
  for (const [id, position] of Object.entries(positions)) assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y), 'Finite coordinates for ' + id);
  const values = Object.entries(positions);
  for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) {
    const [[a, p], [b, q]] = [values[i], values[j]];
    const x = Math.abs(p.x - q.x) - nodeWidth, y = Math.abs(p.y - q.y) - nodeHeight;
    assert.ok(x >= minimumGap - .002 || y >= minimumGap - .002, 'Cards ' + a + ' and ' + b + ' reserve a clear gap');
  }
}
function crossingCount(positions, edges) {
  // Count order inversions for independent edges between adjacent columns.
  let result = 0;
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const a = edges[i], b = edges[j];
    if (a.from === b.from || a.to === b.to) continue;
    const p = positions[a.from], q = positions[a.to], r = positions[b.from], s = positions[b.to];
    if (p.x === r.x && q.x === s.x && p.x !== q.x && (p.y - r.y) * (q.y - s.y) < 0) result++;
  }
  return result;
}

test('A complete directory owner becomes an upper group heading without adding a prerequisite column', () => {
  const members = notes(['a', 'b', 'join']);
  const items = [{ id: 'module', title: 'Synthetic group', frameworkModule: true }, ...members];
  const content = [link('a', 'join', 'prerequisite'), link('b', 'join', 'applies')];
  const edges = [...members.map(note => link('module', note.id)), ...content];
  const options = { mode: 'clean' };
  const base = computeGraphLayout(members, content, options);
  const result = computeGraphLayout(items, edges, options);
  assert.deepEqual(result.module, { x: 0, y: 0 });
  for (const member of members) {
    assert.equal(result[member.id].x, base[member.id].x, 'Containment does not introduce an extra science rank');
    assert.equal(result[member.id].y, base[member.id].y + 108 + 80);
  }
  assert.equal(result.a.x, result.b.x);
  assert.ok(result.join.x > result.a.x);
  assertCards(result, items.map(note => note.id), { minimumGap: 80 });
});

test('A directory heading preserves multiple inputs, feedback data and an unconnected supplementary card', () => {
  const ids = ['module', 'intro', 'symbols', 'probability', 'operator', 'statistics', 'spread', 'summary', 'later'];
  const items = notes(ids).map(note => ({ ...note, frameworkModule: ['module', 'intro'].includes(note.id),
    content: note.id === 'later' ? '' : 'Synthetic existing material' }));
  const memberships = ids.slice(1).map(id => ({ ...link('module', id),
    label: id === 'symbols' ? '基础符号补充' : id === 'later' ? '后续补充' : 'Synthetic membership' }));
  const content = [link('intro', 'probability', 'prerequisite'), link('symbols', 'probability', 'prerequisite'),
    link('probability', 'operator', 'extends'), link('operator', 'statistics', 'prerequisite'),
    link('statistics', 'spread', 'extends'), ...['probability', 'operator', 'statistics', 'spread'].map(id => link(id, 'summary', 'extends')),
    link('summary', 'intro', 'extends')];
  const order = ['intro', 'probability', 'operator', 'statistics', 'spread', 'summary'];
  const edges = [...memberships, ...content, ...order.slice(1).map((id, index) => link(order[index], id, 'sequence'))];
  const before = structuredClone({ items, edges });
  const result = computeGraphLayout(items, edges, { mode: 'clean' });
  assertCards(result, ids, { minimumGap: 80 });
  assert.equal(result.intro.x, result.symbols.x);
  assert.ok(result.symbols.y < result.intro.y, 'Original membership role labels still order foundational peers');
  assert.ok(result.probability.x > result.intro.x);
  for (let i = 1; i < order.length; i++) assert.ok(result[order[i]].x > result[order[i - 1]].x);
  const connected = ids.filter(id => !['module', 'later'].includes(id));
  assert.ok(result.later.y >= Math.max(...connected.map(id => result[id].y)) + 108 + 80,
    'An unconnected placeholder remains inside a separate supporting area');
  assert.deepEqual({ items, edges }, before, 'Geometry does not fabricate or discard a stored edge');
  assert.deepEqual(computeGraphLayout(shuffled(items), shuffled(edges), { mode: 'clean' }), result);
});

test('Partially populated directories retain the remaining saved study sequence after real content ends', () => {
  const path = Array.from({ length: 9 }, (_, index) => 'lesson-' + index);
  const items = [{ id: 'module', frameworkModule: true }, ...notes(path)];
  const edges = [...path.map(id => link('module', id)),
    ...path.slice(1).map((id, index) => link(path[index], id, 'sequence')),
    link(path[0], path[1], 'extends'), link(path[1], path[2], 'extends')];
  const before = structuredClone({ items, edges });
  const result = computeGraphLayout(items, edges, { mode: 'clean' });
  for (let i = 1; i < path.length; i++) assert.ok(result[path[i]].x > result[path[i - 1]].x,
    'Saved navigation remains a soft layout constraint for ' + path[i]);
  assert.ok(items.slice(1).every(note => result[note.id].y > result.module.y));
  assertCards(result, items.map(note => note.id), { minimumGap: 80 });
  assert.deepEqual({ items, edges }, before);
});

test('Study-only directories stay connected in their saved order without treating that order as science', () => {
  const path = ['first', 'second', 'third', 'fourth'];
  const items = [{ id: 'module', frameworkModule: true }, ...notes(path)];
  const edges = [...path.map(id => link('module', id)),
    ...path.slice(1).map((id, index) => link(path[index], id, 'sequence'))];
  const before = structuredClone(edges);
  const result = computeGraphLayout(items, edges, { mode: 'clean' });
  for (let i = 1; i < path.length; i++) assert.ok(result[path[i]].x > result[path[i - 1]].x);
  assertCards(result, items.map(note => note.id), { minimumGap: 80 });
  assert.deepEqual(edges, before);
  assert.equal(edges.some(edge => edge.type === 'prerequisite'), false);
});

test('A directory study-order conflict cannot reverse scientific layers or split a parallel group', () => {
  const items = [{ id: 'module', frameworkModule: true }, ...notes(['a', 'b', 'next'])];
  const edges = [...['a', 'b', 'next'].map(id => link('module', id)),
    link('a', 'b', 'parallel'), link('a', 'next', 'prerequisite'), link('b', 'next', 'applies'),
    link('next', 'a', 'sequence'), link('a', 'b', 'sequence')];
  const before = structuredClone(edges);
  const result = computeGraphLayout(items, edges, { mode: 'clean' });
  assert.equal(result.a.x, result.b.x);
  assert.notEqual(result.a.y, result.b.y);
  assert.ok(result.next.x > result.a.x);
  assertCards(result, items.map(note => note.id), { minimumGap: 80 });
  assert.deepEqual(edges, before);
});

test('A scientific owner, an incomplete directory and multiple memberships keep the ordinary hierarchy', () => {
  const items = [{ id: 'module', frameworkModule: true }, ...notes(['a', 'b'])];
  const memberships = [link('module', 'a'), link('module', 'b')];
  const plain = values => values.map(note => ({ ...note, frameworkModule: false }));
  for (const extra of [link('module', 'b', 'prerequisite'), link('a', 'module', 'evidence'),
    link('module', 'a', 'sequence'), link('a', 'b'), link('a', 'module')]) {
    const edges = [...memberships, extra];
    assert.deepEqual(computeGraphLayout(items, edges, { mode: 'clean' }),
      computeGraphLayout(plain(items), edges, { mode: 'clean' }), 'No heading shortcut for ' + extra.type);
  }
  const mixed = [...items, { id: 'outside' }];
  assert.deepEqual(computeGraphLayout(mixed, memberships, { mode: 'clean' }),
    computeGraphLayout(plain(mixed), memberships, { mode: 'clean' }));
});

test('Group heading geometry honors dimensions and origin and ignores invisible membership routing corridors', () => {
  const items = [{ id: 'module', frameworkModule: true }, ...notes(['a', 'b', 'c', 'spare'])];
  const edges = [...['a', 'b', 'c', 'spare'].map(id => link('module', id)),
    link('a', 'b', 'prerequisite'), link('b', 'c', 'extends')];
  const before = structuredClone({ items, edges });
  for (const dimensions of [{ nodeWidth: 320, nodeHeight: 144, columnGap: 76, rowGap: 32 },
    { nodeWidth: 80, nodeHeight: 36, columnGap: 48, rowGap: 24 }]) {
    const options = { mode: 'clean', ...dimensions, originX: -127.25, originY: 43.5 };
    const result = computeGraphLayout(items, edges, options);
    assert.deepEqual(result.module, { x: options.originX, y: options.originY });
    assert.equal(Math.min(...Object.values(result).map(point => point.x)), options.originX);
    assert.equal(Math.min(...Object.values(result).map(point => point.y)), options.originY);
    assertCards(result, items.map(note => note.id), { ...dimensions, minimumGap: Math.min(80, dimensions.columnGap) });
    const longMemberships = edges.map(edge => edge.type === 'branch'
      ? { ...edge, label: 'Synthetic directory membership '.repeat(40) } : edge);
    assert.deepEqual(computeGraphLayout(items, longMemberships, options), result,
      'Omitted containment fan-out cannot inflate every content corridor');
    assert.deepEqual(computeGraphLayout(shuffled(items), shuffled(edges), options), result);
  }
  assert.deepEqual({ items, edges }, before);
});

test('Directory headings keep prototype-shaped member ids as ordinary supporting cards', () => {
  const items = [{ id: 'module', frameworkModule: true }, ...notes(['__proto__', 'constructor', 'toString'])];
  const edges = items.slice(1).map(note => link('module', note.id));
  const before = structuredClone({ items, edges });
  const result = computeGraphLayout(items, edges, { mode: 'clean' });
  assertCards(result, items.map(note => note.id), { minimumGap: 80 });
  assert.equal(Object.hasOwn(result, '__proto__'), true);
  assert.equal(Object.hasOwn(result, 'constructor'), true);
  assert.equal(Object.hasOwn(result, 'toString'), true);
  assert.deepEqual({ items, edges }, before);
});

test('A branching outline keeps siblings together and gives both mind-map sides their own subtree space', () => {
  const ids = ['root', 'a', 'b', 'c', 'a1', 'a2', 'b1', 'b2', 'c1', 'c2'];
  const edges = [link('root', 'a'), link('root', 'b'), link('root', 'c'), link('a', 'a1'), link('a', 'a2'), link('b', 'b1'), link('b', 'b2'), link('c', 'c1'), link('c', 'c2')];
  const columns = computeGraphLayout(notes(ids), edges);
  assertCards(columns, ids);
  for (const edge of edges) assert.ok(columns[edge.to].x > columns[edge.from].x, 'Branch proceeds to the next level');
  assert.equal(columns.a.x, columns.b.x); assert.equal(columns.b.x, columns.c.x);
  assert.equal(crossingCount(columns, edges), 0, 'A pure tree has no interleaved branch edges');
  const branches = computeGraphLayout(notes(ids), edges, { mode: 'branches' });
  assertCards(branches, ids);
  assert.ok(['a', 'b', 'c'].some(id => branches[id].x < branches.root.x));
  assert.ok(['a', 'b', 'c'].some(id => branches[id].x > branches.root.x));
  for (const parent of ['a', 'b', 'c']) {
    const direction = Math.sign(branches[parent].x - branches.root.x);
    for (const id of [parent + '1', parent + '2']) assert.equal(Math.sign(branches[id].x - branches[parent].x), direction, 'A subtree continues on its allocated side');
  }
});

test('Longest dependency paths and multiple parents take precedence over a shortcut', () => {
  const ids = ['a', 'b', 'c', 'd', 'other'];
  const edges = [link('a', 'b', 'prerequisite'), link('b', 'c', 'extends'), link('c', 'd', 'prerequisite'), link('a', 'd', 'extends'), link('other', 'd', 'prerequisite')];
  const result = computeGraphLayout(notes(ids), edges);
  assertCards(result, ids);
  for (const edge of edges) assert.ok(result[edge.to].x > result[edge.from].x, 'Every accepted dependency points forward');
  assert.equal(result.d.x - result.a.x, 3 * (244 + 112), 'The shortcut does not collapse the learning chain');
});

test('Sibling flow refines columns without changing branch membership or the mind-map outline', () => {
  const ids = ['root', 'a', 'b', 'c', 'a1'];
  const outline = [link('root', 'a'), link('root', 'b'), link('root', 'c'), link('a', 'a1')];
  const crossLinks = [link('a', 'b', 'prerequisite'), link('b', 'c', 'extends'), link('a1', 'root', 'extends')];
  const snapshot = structuredClone([...outline, ...crossLinks]);
  const expected = computeGraphLayout(notes(ids), outline, { mode: 'branches' });
  assert.deepEqual(computeGraphLayout(notes(ids), [...outline, ...crossLinks], { mode: 'branches' }), expected);
  const columns = computeGraphLayout(notes(ids), [...outline, ...crossLinks]);
  assertCards(columns, ids);
  for (const edge of outline) assert.ok(columns[edge.to].x > columns[edge.from].x, 'Every membership edge still points into the module');
  assert.ok(columns.b.x > columns.a.x, 'A confirmed sibling prerequisite receives a forward subcolumn');
  assert.deepEqual([...outline, ...crossLinks], snapshot, 'Refining geometry cannot remove or rewrite any relationship');
});

test('Sibling prerequisites and study order form local flow columns without inventing a serial chain', () => {
  const ids = ['root', 'z-first', 'm-next', 'a-last'];
  const edges = [link('root', 'z-first'), link('root', 'm-next'), link('root', 'a-last'), link('z-first', 'm-next', 'prerequisite'), link('m-next', 'a-last', 'sequence')];
  const result = computeGraphLayout(notes(ids), edges);
  assertCards(result, ids);
  assert.ok(result['z-first'].x < result['m-next'].x && result['m-next'].x < result['a-last'].x);
  const independent = edges.filter(edge => edge.type === 'branch');
  const parallel = computeGraphLayout(notes(ids), independent);
  assert.equal(parallel['z-first'].x, parallel['a-last'].x, 'Unconnected siblings remain parallel');
});

test('Branch cycles, pure dependency cycles and self loops all terminate with clear card spacing', () => {
  for (const type of ['branch', 'prerequisite', 'extends']) {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const edges = [link('a', 'b', type), link('b', 'c', type), link('c', 'a', type), link('c', 'd', type), link('d', 'e', type), link('b', 'b', type)];
    for (const mode of modes) {
      const result = computeGraphLayout(notes(ids), edges, { mode });
      assertCards(result, ids);
      assert.deepEqual(result, computeGraphLayout(shuffled(notes(ids)), shuffled(edges), { mode }));
      if (mode === 'columns') assert.ok(result.e.x > result.d.x, 'Outgoing edges leave the loop group');
    }
  }
});

test('Disconnected outlines and isolated cards are packed into separated compact regions', () => {
  const ids = ['root', 'a', 'b', 'other', 'o1', 'o2', ...Array.from({ length: 12 }, (_, i) => 'isolated-' + i)];
  const edges = [link('root', 'a'), link('root', 'b'), link('other', 'o1'), link('other', 'o2')];
  for (const mode of modes) assertCards(computeGraphLayout(notes(ids), edges, { mode }), ids);
  const isolated = notes(Array.from({ length: 20 }, (_, i) => 'n' + i));
  const result = computeGraphLayout(isolated, []), size = bounds(result);
  assertCards(result, isolated.map(note => note.id));
  assert.ok(size.width / size.height > .65 && size.width / size.height < 3.5, 'Isolated nodes do not become one long row or column');
});

test('Auxiliary links neither become hierarchy constraints nor stretch established outlines', () => {
  const ids = ['root', 'a', 'b', 'c', 'z'];
  const outline = [link('root', 'a'), link('a', 'b'), link('b', 'c')];
  const auxiliary = [link('c', 'root', 'applies'), link('b', 'a', 'evidence'), link('z', 'root', 'parallel'), link('a', 'z', 'contradicts')];
  for (const mode of modes) assert.deepEqual(computeGraphLayout(notes(ids), [...outline, ...auxiliary], { mode }), computeGraphLayout(notes(ids), outline, { mode }));
});

test('Input order, saved overlaps, selection, note text and learning status never affect automatic geometry', () => {
  const ids = ['root', 'a', 'b', 'c', 'd', 'e'];
  const edges = [link('root', 'a'), link('root', 'b'), link('a', 'c'), link('b', 'd'), link('d', 'e', 'extends'), link('c', 'e', 'applies')];
  const original = notes(ids);
  const changed = shuffled(original).map(note => ({ ...note, title: 'Changed title', content: 'Different prose', status: 'understood', selected: true, selectedId: note.id, position: { x: 5, y: 5 } }));
  for (const mode of modes) {
    const expected = computeGraphLayout(original, edges, { mode });
    assert.deepEqual(computeGraphLayout(changed, shuffled(edges).map(edge => ({ ...edge, id: 'replacement-' + edge.id })), { mode, selectedId: 'e' }), expected);
    assert.equal(layoutSignature(changed, shuffled(edges), mode), layoutSignature(original, edges, mode));
    assertCards(expected, ids);
  }
  assert.equal(layoutSignature(original, edges, 'radial'), layoutSignature(original, edges, 'branches'));
  assert.notEqual(layoutSignature(original, edges, 'branches'), layoutSignature(original, edges, 'columns'));
  assert.notEqual(layoutSignature(original, edges), layoutSignature(original, edges.slice(1)));
  assert.notEqual(layoutSignature(original, edges), layoutSignature(notes([...ids, 'new']), edges));
  assert.notEqual(layoutSignature(original, edges), layoutSignature(original, edges.map((edge, i) => i ? edge : { ...edge, type: 'prerequisite' })));
});

test('Invalid references and duplicate relationships do not change geometry or mutate the inputs', () => {
  const original = notes(['a', 'b']), edges = [link('a', 'b')];
  const snapshot = JSON.stringify([original, edges]);
  const dirtyNotes = [null, {}, ...original, { ...original[0], position: { x: Infinity, y: NaN } }];
  const dirtyEdges = [null, {}, ...edges, { ...edges[0], id: 'duplicate' }, link('a', 'missing')];
  for (const mode of modes) assert.deepEqual(computeGraphLayout(dirtyNotes, dirtyEdges, { mode }), computeGraphLayout(original, edges, { mode }));
  assert.equal(layoutSignature(dirtyNotes, dirtyEdges), layoutSignature(original, edges));
  assert.equal(JSON.stringify([original, edges]), snapshot);
  assert.deepEqual(computeGraphLayout([], edges), {});
  assertCards(computeGraphLayout([{ id: '__proto__' }, { id: 2 }], [link('__proto__', 2)]), ['__proto__', '2']);
});

test('Custom card dimensions, gaps and origin are applied to the full geometry', () => {
  const ids = ['root', 'a', 'b', 'c', 'isolated'];
  const edges = [link('root', 'a'), link('root', 'b'), link('a', 'c')];
  const options = { nodeWidth: 320, nodeHeight: 144, columnGap: 76, rowGap: 32, componentGap: 90, originX: -123, originY: 57 };
  for (const mode of modes) {
    const result = computeGraphLayout(notes(ids), edges, { ...options, mode });
    assertCards(result, ids, { ...options, minimumGap: 32 });
    assert.equal(Math.min(...Object.values(result).map(p => p.x)), -123);
    assert.equal(Math.min(...Object.values(result).map(p => p.y)), 57);
  }
  assertCards(computeGraphLayout(notes(ids), edges, { nodeWidth: NaN, nodeHeight: Infinity }), ids);
});

test('Membership and sibling prerequisites remain distinct while multiple parents converge', () => {
  const graphNotes = notes(['module', 'a', 'b', 'join', 'after']);
  const edges = [link('module', 'a'), link('module', 'b'), link('module', 'join'), link('module', 'after'),
    link('a', 'join', 'prerequisite'), link('b', 'join', 'prerequisite'), link('join', 'after', 'sequence')];
  const before = structuredClone({ graphNotes, edges });
  const result = computeGraphLayout(graphNotes, edges);
  assertCards(result, graphNotes.map(note => note.id));
  assert.equal(result.a.x, result.b.x, 'Independent inputs stay parallel');
  assert.ok(result.join.x > result.a.x && result.after.x > result.join.x, 'Both prerequisites lead to a common downstream column');
  assert.deepEqual({ graphNotes, edges }, before);
  assert.deepEqual(computeGraphLayout(shuffled(graphNotes), shuffled(edges)), result);
  const three = [link('module', 'a'), link('module', 'b'), link('a', 'b', 'prerequisite')];
  const small = computeGraphLayout(notes(['module', 'a', 'b']), three);
  assert.ok(small.module.x < small.a.x && small.a.x < small.b.x);
  assert.equal(three.length, 3, 'The direct module-to-b membership edge is not reduced away');
});

test('Incremental placement adds a related card locally and leaves every existing coordinate exact', () => {
  const graphNotes = notes(['root', 'new', 'unrelated']);
  const edges = [link('root', 'new')];
  const positions = { root: { x: 123.123456, y: -45.456789 }, unrelated: { x: 10000, y: 400 } };
  const before = structuredClone({ graphNotes, edges, positions });
  const result = placeAdditionalNodes(graphNotes, edges, { positions });
  assert.deepEqual(result.positions.root, positions.root);
  assert.deepEqual(result.positions.unrelated, positions.unrelated);
  assert.ok(result.positions.new.x > positions.root.x && result.positions.new.x < positions.root.x + 700,
    'New membership is placed next to its parent, not beyond an unrelated rightmost card');
  assertCards(result.positions, graphNotes.map(note => note.id), { minimumGap: 24 });
  assert.deepEqual(result.movedIds, ['new']);
  assert.deepEqual({ graphNotes, edges, positions }, before);
  const replay = placeAdditionalNodes(graphNotes, edges, { positions: result.positions });
  assert.deepEqual(replay.positions, result.positions);
  assert.deepEqual(replay.movedIds, []);
});

test('Local overlap repair preserves locked and out-of-scope cards and is stable on replay', () => {
  const graphNotes = notes(['anchor', 'crowded', 'outside']);
  const edges = [link('anchor', 'crowded')];
  const positions = { anchor: { x: 0, y: 0 }, crowded: { x: 30, y: 20 }, outside: { x: 2000, y: 600 } };
  const options = { positions, lockedIds: ['anchor'], scopeIds: ['anchor', 'crowded'] };
  const result = computeIncrementalLayout(graphNotes, edges, options);
  assert.deepEqual(result.positions.anchor, positions.anchor);
  assert.deepEqual(result.positions.outside, positions.outside);
  assert.deepEqual(result.movedIds, ['crowded']);
  assertCards(result.positions, graphNotes.map(note => note.id), { minimumGap: 24 });
  assert.deepEqual(result.issues, []);
  const replay = computeIncrementalLayout(graphNotes, edges, { ...options, positions: result.positions });
  assert.deepEqual(replay.positions, result.positions);
  assert.deepEqual(replay.movedIds, []);
  assert.deepEqual(computeIncrementalLayout(shuffled(graphNotes), shuffled(edges), options), result);
});

test('Fixed collisions are diagnosed without breaking locks or moving unselected cards', () => {
  const graphNotes = notes(['a', 'b', 'outside']);
  const positions = { a: { x: 0, y: 0 }, b: { x: 20, y: 20 }, outside: { x: 40, y: 40 } };
  const result = computeIncrementalLayout(graphNotes, [], { positions, lockedIds: new Set(['a', 'b']), movableIds: [] });
  assert.deepEqual(result.positions, positions);
  assert.deepEqual(result.movedIds, []);
  assert.ok(result.issues.some(issue => issue.type === 'fixed-overlap' && issue.nodeIds.includes('a') && issue.nodeIds.includes('b')));
  const missingOnly = placeAdditionalNodes(graphNotes, [], { positions });
  assert.deepEqual(missingOnly.positions, positions, 'Adding missing cards never repairs existing overlaps implicitly');
  assert.deepEqual(missingOnly.movedIds, []);
});

test('Explicit local routing nominations can repair long associations within a bounded radius', () => {
  const graphNotes = notes(['anchor', 'far', 'outside']);
  const edges = [link('anchor', 'far')];
  const positions = { anchor: { x: 0, y: 0 }, far: { x: 1100, y: 100 }, outside: { x: 5000, y: 5000 } };
  const options = { positions, lockedIds: ['anchor'], movableIds: ['far'] };
  const result = computeIncrementalLayout(graphNotes, edges, options);
  assert.deepEqual(result.positions.anchor, positions.anchor);
  assert.deepEqual(result.positions.outside, positions.outside);
  assert.ok(result.positions.far.x < positions.far.x);
  assert.ok(Math.abs(result.positions.far.x - positions.far.x) + Math.abs(result.positions.far.y - positions.far.y) <= 1068);
  const replay = computeIncrementalLayout(graphNotes, edges, { ...options, positions: result.positions });
  assert.deepEqual(replay.positions, result.positions);
  assert.deepEqual(replay.movedIds, []);
  const distant = { ...positions, far: { x: 100000, y: 100000 } };
  const limited = computeIncrementalLayout(graphNotes, edges, { ...options, positions: distant });
  assert.deepEqual(limited.positions, distant, 'Out-of-range cards do not march towards their target over repeated clicks');
  assert.ok(limited.issues.some(issue => issue.type === 'outside-local-range'));
});

test('Incremental layout accepts map inputs, custom dimensions and prototype-shaped ids without mutation', () => {
  const graphNotes = notes(['__proto__', 'new', 'other']);
  const edges = [link('__proto__', 'new')];
  const positions = new Map([['__proto__', { x: -100, y: 20 }], ['other', { x: 4000, y: 4000 }]]);
  const before = structuredClone(positions);
  const result = placeAdditionalNodes(graphNotes, edges, { positions, nodeWidth: 320, nodeHeight: 144, minimumGap: 32 });
  assertCards(result.positions, graphNotes.map(note => note.id), { nodeWidth: 320, nodeHeight: 144, minimumGap: 32 });
  assert.deepEqual(result.positions.__proto__, positions.get('__proto__'));
  assert.deepEqual(positions, before);
  assert.deepEqual(computeIncrementalLayout([], [], { positions }), { positions: {}, movedIds: [], issues: [] });
});

test('Flow cycles keep every card and relationship and report affected constraints', () => {
  const graphNotes = notes(['module', 'a', 'b', 'after']);
  const edges = [link('module', 'a'), link('module', 'b'), link('module', 'after'),
    link('a', 'b', 'prerequisite'), link('b', 'a', 'prerequisite'), link('b', 'after', 'sequence')];
  const before = structuredClone({ graphNotes, edges });
  const result = computeIncrementalLayout(graphNotes, edges);
  assertCards(result.positions, graphNotes.map(note => note.id));
  assert.ok(result.issues.some(issue => issue.type === 'flow-cycle' && issue.nodeIds.includes('a') && issue.nodeIds.includes('b')));
  assert.deepEqual({ graphNotes, edges }, before);
  assert.deepEqual(computeIncrementalLayout(shuffled(graphNotes), shuffled(edges)), result);
});

test('Cycle diagnostics keep prerequisite and study-order semantics separate', () => {
  const graphNotes = notes(['a', 'b']);
  const mixed = [link('a', 'b', 'sequence'), link('b', 'a', 'prerequisite')];
  const snapshot = structuredClone(mixed);
  const result = computeIncrementalLayout(graphNotes, mixed);
  assert.equal(result.issues.some(issue => issue.type === 'flow-cycle'), false,
    'Two individually acyclic relation types must not produce a semantic-cycle warning');
  assert.deepEqual(mixed, snapshot);
  for (const relationType of ['prerequisite', 'sequence']) {
    const cyclic = [link('a', 'b', relationType), link('b', 'a', relationType)];
    const diagnostic = computeIncrementalLayout(graphNotes, cyclic).issues.filter(issue => issue.type === 'flow-cycle');
    assert.equal(diagnostic.length, 1);
    assert.equal(diagnostic[0].relationType, relationType);
    assert.deepEqual(diagnostic[0].nodeIds, ['a', 'b']);
  }
});

export function mixedFiftyNodeGraph() {
  const ids = Array.from({ length: 50 }, (_, i) => 'n' + String(i).padStart(2, '0'));
  const edges = [];
  for (let i = 1; i < 24; i++) edges.push(link(ids[Math.floor((i - 1) / 3)], ids[i]));
  for (let i = 24; i < 36; i++) edges.push(link(ids[i - 1], ids[i], i % 2 ? 'prerequisite' : 'extends'));
  edges.push(link(ids[8], ids[26], 'prerequisite'), link(ids[20], ids[31], 'prerequisite'), link(ids[35], ids[0], 'extends'));
  for (let i = 37; i < 44; i++) edges.push(link(ids[i - 1], ids[i], 'extends'));
  edges.push(link(ids[44], ids[45]), link(ids[45], ids[46]), link(ids[46], ids[44]));
  edges.push(link(ids[6], ids[33], 'applies'), link(ids[16], ids[40], 'parallel'), link(ids[47], ids[48], 'evidence'));
  return { notes: notes(ids), links: edges };
}

test('Long sibling flows in a dense fifty-card module retain vertical routing space', () => {
  // Five related nine-section courses with cross-references. Promoting every
  // sibling prerequisite into a global rank would squeeze 44 cards into five
  // rows and force many unrelated routes through the same horizontal lanes.
  const ids = ['m', ...Array.from({ length: 5 }, (_, i) => 'g' + i), ...Array.from({ length: 44 }, (_, i) => 'n' + i)];
  const edges = Array.from({ length: 5 }, (_, i) => link('m', 'g' + i));
  for (let i = 0; i < 44; i++) {
    edges.push(link('g' + Math.min(4, Math.floor(i / 9)), 'n' + i));
    if (i % 9 && i > 0) edges.push(link('n' + (i - 1), 'n' + i, 'prerequisite'));
    if (i % 3 === 0 && i + 7 < 44) edges.push(link('n' + i, 'n' + (i + 7), 'applies'));
    if (i % 5 === 0 && i + 2 < 44) edges.push(link('n' + (i + 2), 'n' + i, 'evidence'));
    if (i % 7 === 0 && i + 1 < 44) edges.push(link('n' + i, 'n' + (i + 1), 'parallel'));
  }
  assert.equal(ids.length, 50); assert.equal(edges.length, 117);
  const graphNotes = notes(ids), before = structuredClone({ graphNotes, edges });
  const result = computeGraphLayout(graphNotes, edges);
  assertCards(result, ids);
  for (let group = 0; group < 5; group++) {
    const children = ids.filter(id => /^n\d+$/.test(id) && Math.min(4, Math.floor(Number(id.slice(1)) / 9)) === group);
    const positions = children.map(id => result[id]);
    const horizontalSpan = Math.max(...positions.map(point => point.x)) - Math.min(...positions.map(point => point.x));
    const verticalSpan = Math.max(...positions.map(point => point.y)) - Math.min(...positions.map(point => point.y));
    assert.ok(horizontalSpan <= 244 + 112, 'A long sibling course does not become an unbounded horizontal strip');
    assert.ok(verticalSpan >= (children.length - 1) * (108 + 48) / 2, 'Each course retains several rows for cross-link routing');
  }
  assert.ok(bounds(result).width <= 5 * (244 + 112), 'Flow refinement stays local instead of expanding the entire module width');
  const local = computeIncrementalLayout(graphNotes, edges, { positions: result });
  assert.deepEqual(local.positions, result, 'A conservative full layout remains stable under the default local action');
  assert.deepEqual(local.movedIds, []);
  assert.ok(local.issues.some(issue => issue.type === 'flow-layout-limited'), 'The display limitation can be explained without deleting relationships');
  assert.deepEqual({ graphNotes, edges }, before);
  assert.deepEqual(computeGraphLayout(shuffled(graphNotes), shuffled(edges)), result);
});

test('A fifty-card mixed graph stays deterministic and comfortably within an interactive layout budget', () => {
  const graph = mixedFiftyNodeGraph();
  for (const mode of modes) {
    const started = performance.now();
    const result = computeGraphLayout(graph.notes, graph.links, { mode });
    const elapsed = performance.now() - started;
    assertCards(result, graph.notes.map(note => note.id));
    assert.deepEqual(computeGraphLayout(shuffled(graph.notes), shuffled(graph.links), { mode }), result);
    assert.ok(elapsed < 250, 'Fifty-card ' + mode + ' layout elapsed ' + elapsed.toFixed(1) + 'ms');
    const size = bounds(result);
    assert.ok(size.width < 9000 && size.height < 6000, 'Mixed graph has bounded, readable component spacing');
  }
});

test('The supported five-thousand-note limit handles a deep branch chain without call-stack overflow', () => {
  const graphNotes = notes(Array.from({ length: 5000 }, (_, i) => 'deep-' + String(i).padStart(4, '0')));
  const edges = graphNotes.slice(1).map((note, i) => link(graphNotes[i].id, note.id));
  for (const mode of modes) {
    const result = computeGraphLayout(graphNotes, edges, { mode });
    assert.equal(Object.keys(result).length, graphNotes.length);
    for (const note of graphNotes) {
      assert.ok(Number.isFinite(result[note.id]?.x) && Number.isFinite(result[note.id]?.y), 'Finite deep-chain coordinates in ' + mode);
    }
    assert.deepEqual(computeGraphLayout([...graphNotes].reverse(), [...edges].reverse(), { mode }), result, 'Deep-chain geometry remains deterministic in ' + mode);
    for (let i = 1; i < graphNotes.length; i++) {
      assert.equal(result[graphNotes[i].id].x - result[graphNotes[i - 1].id].x, 244 + 112);
      assert.equal(result[graphNotes[i].id].y, result[graphNotes[i - 1].id].y);
    }
  }
});


test('Explicit study order overrides sibling ids and auxiliary relationships without changing notebook data', () => {
  const path = ['z-first', 'm-second', 'a-third', 't-fourth', 'b-fifth', 'k-sixth', 'd-seventh'];
  const graphNotes = notes(['module', ...path, 'supplement']);
  const sequence = path.slice(1).map((id, i) => link(path[i], id, 'sequence'));
  const other = [
    ...path.map(id => link('module', id)), link('module', 'supplement'),
    link(path.at(-1), path[0], 'prerequisite'), link('supplement', path[2], 'evidence'),
    link(path[4], path[1], 'applies'),
  ];
  const snapshot = structuredClone({ graphNotes, sequence, other });
  assert.deepEqual(studySequenceOrder(graphNotes, sequence), path);
  assert.deepEqual(studySequenceOrder(graphNotes, [...other, ...sequence]), path);
  assert.deepEqual(studySequenceOrder(shuffled(graphNotes), shuffled([...other, ...sequence])), path);
  assert.deepEqual(computeGraphLayout(graphNotes, [...sequence, ...other], { mode: 'sequence' }),
    computeGraphLayout(shuffled(graphNotes), shuffled(sequence), { mode: 'sequence' }));
  assert.deepEqual({ graphNotes, sequence, other }, snapshot);
});

test('The study path reads through three snake columns while auxiliary cards keep a separate left column', () => {
  const path = ['z-first', 'm-second', 'a-third', 't-fourth', 'b-fifth', 'k-sixth', 'd-seventh'];
  const ids = ['module', 'supplement', ...path];
  const sequence = path.slice(1).map((id, i) => link(path[i], id, 'sequence'));
  const result = computeGraphLayout(notes(ids), sequence, { mode: 'sequence' });
  assertCards(result, ids);
  const mainX = Math.min(...path.map(id => result[id].x));
  for (const id of ['module', 'supplement']) assert.ok(result[id].x + 244 + 48 <= mainX,
    'Non-sequence card ' + id + ' stays clear of the study path');
  assert.equal(result.module.x, result.supplement.x);
  assert.equal(new Set(path.slice(0, 3).map(id => result[id].x)).size, 3);
  for (let i = 1; i < path.length; i++) {
    const previous = result[path[i - 1]], current = result[path[i]];
    if (i % 3 === 0) {
      assert.equal(current.x, previous.x, 'A row turn stays on the same column');
      assert.ok(current.y - previous.y >= 108 + 80, 'Rows reserve a readable vertical gap');
    } else {
      assert.equal(current.y, previous.y, 'Adjacent cards in a row share their horizontal axis');
      const direction = Math.floor(i / 3) % 2 ? -1 : 1;
      assert.ok((current.x - previous.x) * direction >= 244 + 48, 'Snake alternates the horizontal reading direction');
    }
  }
  const withoutAuxiliary = computeGraphLayout(notes(path), sequence, { mode: 'sequence' });
  assert.equal(Math.min(...Object.values(withoutAuxiliary).map(point => point.x)), 0);
  assert.equal(Math.min(...Object.values(withoutAuxiliary).map(point => point.y)), 0);
});

test('Study order ignores duplicate, self and unknown sequence edges, and keeps every valid participant once', () => {
  const graphNotes = notes(['z-first', 'a-next', 'unrelated']);
  const sequence = link('z-first', 'a-next', 'sequence');
  const dirty = [null, {}, sequence, { ...sequence, id: 'duplicate' },
    link('unrelated', 'unrelated', 'sequence'), link('unrelated', 'missing', 'sequence')];
  assert.deepEqual(studySequenceOrder([null, {}, ...graphNotes], dirty), ['z-first', 'a-next']);
  assert.deepEqual(computeGraphLayout(graphNotes, dirty, { mode: 'sequence' }),
    computeGraphLayout(graphNotes, [sequence], { mode: 'sequence' }));
  assert.deepEqual(studySequenceOrder([{ id: 2 }, { id: '__proto__' }], [link(2, '__proto__', 'sequence')]), ['2', '__proto__']);
});

test('Graphs without valid study edges keep the existing columns layout and expose no study numbering', () => {
  const graphNotes = notes(['root', 'a', 'b', 'c', 'isolated']);
  const outline = [link('root', 'a'), link('root', 'b'), link('a', 'c'), link('b', 'c', 'prerequisite')];
  assert.deepEqual(studySequenceOrder(graphNotes, outline), []);
  assert.deepEqual(computeGraphLayout(graphNotes, outline, { mode: 'sequence' }), computeGraphLayout(graphNotes, outline));
  const invalid = [link('a', 'a', 'sequence'), link('a', 'missing', 'sequence')];
  assert.deepEqual(studySequenceOrder(graphNotes, invalid), []);
  assert.deepEqual(computeGraphLayout(graphNotes, invalid, { mode: 'sequence' }), computeGraphLayout(graphNotes, invalid));
  assert.deepEqual(studySequenceOrder([], []), []);
  assert.deepEqual(computeGraphLayout([], [], { mode: 'sequence' }), {});
});

test('Cyclic and branching study relationships terminate with a stable order and clear card geometry', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'auxiliary'];
  const edges = [link('a', 'b', 'sequence'), link('b', 'c', 'sequence'),
    link('c', 'a', 'sequence'), link('c', 'd', 'sequence'), link('c', 'e', 'sequence')];
  const expected = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(studySequenceOrder(notes(ids), edges), expected);
  assert.deepEqual(studySequenceOrder(shuffled(notes(ids)), shuffled(edges)), expected);
  const result = computeGraphLayout(notes(ids), edges, { mode: 'sequence' });
  assertCards(result, ids);
  assert.deepEqual(computeGraphLayout(shuffled(notes(ids)), shuffled(edges), { mode: 'sequence' }), result);
  const acyclic = [link('z-start', 'b', 'sequence'), link('z-start', 'a', 'sequence'),
    link('a', 'end', 'sequence'), link('b', 'end', 'sequence')];
  assert.deepEqual(studySequenceOrder(notes(['z-start', 'b', 'a', 'end']), acyclic), ['z-start', 'a', 'b', 'end']);
});

test('Study mode has its own layout signature and honors custom card geometry and origin', () => {
  const path = ['s4', 's1', 's6', 's2', 's5', 's3', 's7'];
  const graphNotes = notes(['auxiliary', ...path]);
  const edges = path.slice(1).map((id, i) => link(path[i], id, 'sequence'));
  const signature = layoutSignature(graphNotes, edges, 'sequence');
  assert.notEqual(signature, layoutSignature(graphNotes, edges, 'columns'));
  assert.notEqual(signature, layoutSignature(graphNotes, edges, 'branches'));
  assert.equal(signature, layoutSignature(shuffled(graphNotes), shuffled([...edges, { ...edges[0], id: 'duplicate' }]), 'sequence'));
  assert.notEqual(signature, layoutSignature(graphNotes, edges.slice(1), 'sequence'));
  const changed = graphNotes.map(note => ({ ...note, title: 'Changed title', status: 'understood', content: 'Changed text', position: { x: 10, y: 10 } }));
  assert.equal(signature, layoutSignature(changed, edges, 'sequence'));
  const options = { mode: 'sequence', nodeWidth: 320, nodeHeight: 144, columnGap: 76, rowGap: 32, originX: -123, originY: 57 };
  const result = computeGraphLayout(graphNotes, edges, options);
  assertCards(result, graphNotes.map(note => note.id), { ...options, minimumGap: 32 });
  assert.equal(Math.min(...Object.values(result).map(point => point.x)), -123);
  assert.equal(Math.min(...Object.values(result).map(point => point.y)), 57);
});

test('Clean planning prioritizes existing content, preserves merges and retains navigation as a reference', () => {
  const graphNotes = notes(['module', 'a', 'b', 'c', 'math', 'supplement']);
  const membership = { ...link('module', 'a'), hideLabel: true, label: 'Belongs to this module' };
  const edges = [membership, link('module', 'b'), link('module', 'c'), link('module', 'supplement'),
    link('a', 'b', 'sequence'), link('b', 'c', 'sequence'), link('a', 'b', 'prerequisite'),
    link('b', 'c', 'applies'), link('math', 'module', 'prerequisite'),
    link('c', 'a', 'extends'), link('b', 'supplement', 'applies'), link('supplement', 'c', 'evidence')];
  const snapshot = structuredClone({ graphNotes, edges });
  const plan = cleanGraphPlan(graphNotes, edges);
  const primaryIds = new Set(plan.primaryLinks.map(edge => edge.id));
  assert.ok(primaryIds.has('a-b-prerequisite') && primaryIds.has('b-c-applies'), 'Content relationships define the diagram');
  assert.ok(primaryIds.has(membership.id) && primaryIds.has('math-module-prerequisite'));
  assert.deepEqual(plan.primaryLinks.find(edge => edge.id === membership.id), membership, 'Labels and hidden membership-label metadata survive planning');
  assert.ok(plan.primaryLinks.some(edge => edge.id === 'module-b-branch'), 'Membership is not reduced through a prerequisite or application path');
  assert.ok(plan.auxiliaryLinks.some(edge => edge.id === 'c-a-extends'));
  assert.ok(primaryIds.has('b-supplement-applies') && primaryIds.has('supplement-c-evidence'), 'Multiple content inputs remain visible at a merge');
  assert.ok(plan.auxiliaryLinks.some(edge => edge.id === 'a-b-sequence'));
  assert.ok(plan.auxiliaryLinks.some(edge => edge.id === 'b-c-sequence'));
  assert.ok(plan.primaryLinks.filter(edge => edge.to === 'c').length > 1, 'A content merge is not reduced to a single parent');
  assert.deepEqual([...plan.primaryLinks, ...plan.auxiliaryLinks].map(edge => edge.id).sort(), edges.map(edge => edge.id).sort(), 'No stored relationship is discarded');
  assert.deepEqual(plan.sequenceOrder, ['a', 'b', 'c']);
  const duplicate = { ...membership, id: 'z-repeated-membership', label: 'Another explanation of the same membership' };
  const repeated = cleanGraphPlan(graphNotes, [...edges, duplicate]);
  assert.deepEqual(repeated.primaryLinks, plan.primaryLinks, 'Repeated references do not add duplicate backbone arrows');
  assert.ok(repeated.auxiliaryLinks.some(edge => edge.id === duplicate.id), 'A repeated relationship and its explanation remain available');
  assert.deepEqual(cleanGraphPlan(shuffled(graphNotes), shuffled([...edges, duplicate])), repeated);
  assert.deepEqual({ graphNotes, edges }, snapshot, 'Planning does not rewrite note or link objects');
});

test('Clean planning preserves membership independently of mixed-type paths and same-endpoint explanations', () => {
  const graphNotes = notes(['module', 'a', 'b']);
  const edges = [link('module', 'a'), link('module', 'b'), link('a', 'b', 'prerequisite'),
    link('a', 'b', 'applies'), link('b', 'a', 'extends'), link('a', 'b', 'sequence')];
  const before = structuredClone(edges), plan = cleanGraphPlan(graphNotes, edges);
  for (const edge of edges.slice(0, 4)) assert.ok(plan.primaryLinks.some(value => value.id === edge.id),
    'Membership and each distinct content explanation remain visible: ' + edge.type);
  assert.ok(plan.auxiliaryLinks.some(edge => edge.type === 'extends'), 'A feedback explanation remains accessible');
  assert.ok(plan.auxiliaryLinks.some(edge => edge.type === 'sequence'), 'Reading navigation remains distinct');
  assert.deepEqual([...plan.primaryLinks, ...plan.auxiliaryLinks].map(edge => edge.id).sort(), edges.map(edge => edge.id).sort());
  assert.deepEqual(edges, before);
  const result = computeGraphLayout(graphNotes, edges, { mode: 'clean' });
  assertCards(result, graphNotes.map(note => note.id));
  assert.ok(result.module.x < result.a.x && result.a.x < result.b.x);
});

test('Clean module reading uses explicit foundation and extension roles without inventing a process', () => {
  const graphNotes = [
    { id: 'module', title: 'Synthetic module', tags: ['框架模块'] },
    { id: 'core-z', title: '2. Core lesson' },
    { id: 'core-a', title: '10. Core lesson' },
    { id: 'foundation', title: 'Synthetic symbols', tags: ['先备知识'] },
    { id: 'extension', title: 'Synthetic expansion', tags: ['后续拓展'] },
  ];
  const edges = graphNotes.slice(1).map(note => link('module', note.id));
  edges.push(link('core-z', 'core-a', 'sequence'));
  const before = structuredClone({ graphNotes, edges });
  const plan = cleanGraphPlan(graphNotes, edges), positions = computeGraphLayout(graphNotes, edges, { mode: 'clean' });
  assert.ok(positions.foundation.y < positions['core-z'].y && positions['core-z'].y < positions['core-a'].y);
  assert.ok(positions.extension.y > positions['core-a'].y);
  assert.equal(positions['core-z'].x, positions['core-a'].x, 'An index is a reading aid, not a causal subcolumn');
  assert.ok(plan.primaryLinks.every(edge => edge.type === 'branch'));
  const replay = computeIncrementalLayout(graphNotes, edges, { mode: 'clean', positions });
  assert.deepEqual(replay.positions, positions, 'Local organization preserves the clean reading arrangement');
  assert.deepEqual(replay.movedIds, []);
  const extra = { id: 'new-lesson', title: 'Synthetic addition' }, updatedNotes = [...graphNotes, extra];
  const incremental = placeAdditionalNodes(updatedNotes, [...edges, link('module', extra.id)], { mode: 'clean', positions, lockedIds: ['core-z'] });
  for (const note of graphNotes) assert.deepEqual(incremental.positions[note.id], positions[note.id], 'Adding a clean card preserves old coordinates');
  assertCards(incremental.positions, updatedNotes.map(note => note.id), { minimumGap: 24 });
  assert.deepEqual({ graphNotes, edges }, before);
});

test('Content dependencies form parallel branches and a visible diamond merge instead of a reading chain', () => {
  const ids = ['question', 'motion', 'state', 'collision', 'detection', 'explanation', 'model'];
  const edges = [link('question', 'motion', 'prerequisite'), link('question', 'state', 'prerequisite'),
    link('motion', 'collision', 'applies'), link('state', 'collision', 'applies'),
    link('collision', 'detection', 'extends'), link('detection', 'explanation', 'evidence'),
    link('model', 'collision', 'prerequisite'), link('model', 'explanation', 'applies'),
    link('motion', 'state', 'parallel'), link('motion', 'state', 'sequence')];
  const snapshot = structuredClone({ graphNotes: notes(ids), edges });
  const plan = cleanGraphPlan(snapshot.graphNotes, edges), result = computeGraphLayout(snapshot.graphNotes, edges, { mode: 'clean' });
  assertCards(result, ids);
  assert.equal(result.motion.x, result.state.x, 'Parallel preparations share a layer');
  assert.notEqual(result.motion.y, result.state.y, 'Parallel preparations have separate visible cards');
  assert.ok(result.collision.x > result.motion.x && result.collision.x > result.state.x);
  assert.equal(plan.primaryLinks.filter(edge => edge.to === 'collision').length, 3, 'All three supporting inputs remain visible');
  assert.equal(result.model.x, result.motion.x, 'A short theory support branch stays close to its convergence');
  assert.ok(plan.primaryLinks.some(edge => edge.type === 'parallel'));
  assert.ok(plan.auxiliaryLinks.some(edge => edge.type === 'sequence'), 'Reading order cannot replace parallel content');
  for (const edge of plan.primaryLinks.filter(edge => edge.type !== 'parallel')) assert.ok(result[edge.to].x > result[edge.from].x);
  assert.deepEqual(computeGraphLayout(shuffled(snapshot.graphNotes), shuffled(edges), { mode: 'clean' }), result);
  assert.deepEqual({ graphNotes: notes(ids), edges }, snapshot);
});

test('A module without content dependencies shows membership branches without inventing a causal study chain', () => {
  const ids = ['root', 'a', 'b', 'c'];
  const edges = [link('root', 'a'), link('root', 'b'), link('root', 'c'), link('a', 'b', 'sequence'), link('b', 'c', 'sequence')];
  const plan = cleanGraphPlan(notes(ids), edges);
  const result = computeGraphLayout(notes(ids), edges, { mode: 'clean' });
  assertCards(result, ids);
  assert.equal(plan.primaryLinks.length, 3);
  assert.ok(plan.primaryLinks.every(edge => edge.type === 'branch'));
  assert.equal(result.a.x, result.b.x); assert.equal(result.b.x, result.c.x);
  assert.ok(result.a.x > result.root.x);
  assert.deepEqual(plan.sequenceOrder, ['a', 'b', 'c']);
  assert.deepEqual(computeGraphLayout(shuffled(notes(ids)), shuffled(edges), { mode: 'clean' }), result);
});

test('Automatic content maps keep peer lessons in explicit reading order instead of id or crossing-score order', () => {
  const order = ['z-first', 'b-second', 'a-third', 'y-fourth', 'c-fifth'];
  const ids = ['module', ...order, 'use'];
  const edges = [...order.map(id => link('module', id)),
    ...order.slice(1).map((id, i) => link(order[i], id, 'sequence')), link('module', 'use', 'applies')];
  const result = computeGraphLayout(notes(ids), edges, { mode: 'clean' });
  assertCards(result, ids);
  for (let i = 1; i < order.length; i++) {
    assert.equal(result[order[i - 1]].x, result[order[i]].x, 'Peer lessons keep their content layer');
    assert.ok(result[order[i - 1]].y < result[order[i]].y, 'Earlier reading appears above later reading');
  }
  assert.ok(cleanGraphPlan(notes(ids), edges).primaryLinks.every(edge => edge.type !== 'sequence'), 'Reading order does not create causal arrows');
  assert.deepEqual(computeGraphLayout(shuffled(notes(ids)), shuffled(edges), { mode: 'clean' }), result);
});

test('Foundational prerequisites precede applications even when a reading index points backwards', () => {
  const ids = ['foundation', 'application', 'result'];
  const edges = [link('foundation', 'application', 'prerequisite'), link('application', 'result', 'applies'),
    link('application', 'foundation', 'sequence')];
  const result = computeGraphLayout(notes(ids), edges, { mode: 'clean' });
  assert.ok(result.foundation.x < result.application.x && result.application.x < result.result.x);
  assert.equal(cleanGraphPlan(notes(ids), edges).primaryLinks.length, 2);
});

test('Explicit foundation tags and membership descriptions put basic material ahead of same-layer lessons', () => {
  const graphNotes = [{ id: 'root', title: '模块' }, { id: 'first', title: '01 第一节' },
    { id: 'second', title: '02 第二节' }, { id: 'basic-tag', title: '必要符号', tags: ['先备知识'] },
    { id: 'basic-label', title: '必要常量' }];
  const edges = ['first', 'second', 'basic-tag', 'basic-label'].map(id => link('root', id));
  edges.find(edge => edge.to === 'basic-label').label = '基础常量补充';
  edges.push(link('first', 'second', 'sequence'));
  const result = computeGraphLayout(graphNotes, edges, { mode: 'clean' });
  assert.ok(result['basic-tag'].y < result.first.y && result['basic-label'].y < result.first.y);
  assert.ok(result.first.y < result.second.y);
  assert.ok(cleanGraphPlan(graphNotes, edges).primaryLinks.every(edge => edge.type === 'branch'), 'Basic placement does not invent a prerequisite edge');
});

test('Numbered titles give unindexed peers a natural directory order throughout the app', () => {
  const graphNotes = [{ id: 'root', title: '目录' }, { id: 'a', title: '10. 主题' },
    { id: 'z', title: '2、主题' }, { id: 'm', title: '第1节 主题' }];
  const edges = ['a', 'z', 'm'].map(id => link('root', id));
  const result = computeGraphLayout(graphNotes, edges, { mode: 'clean' });
  assert.ok(result.m.y < result.z.y && result.z.y < result.a.y);
  assert.equal(layoutSignature(graphNotes, edges, 'clean'), layoutSignature(graphNotes.map(note => ({ ...note, title: 'Edited' })), edges, 'clean'),
    'Prose changes do not automatically overwrite a saved arrangement; explicit organization can use the new titles');
});

test('Dense fan-out reserves more routing width and label clearance without changing content relationships', () => {
  const ids = ['root', ...Array.from({ length: 10 }, (_, i) => 'child-' + i)];
  const edges = ids.slice(1).map(id => ({ ...link('root', id), label: '说明这一知识点与所属模块之间的内容联系' }));
  const input = { graphNotes: notes(ids), edges }, before = structuredClone(input);
  const result = computeGraphLayout(input.graphNotes, edges, { mode: 'clean', nodeWidth: 300, nodeHeight: 168 });
  assert.ok(result[ids[1]].x - result.root.x - 300 >= 480, 'The routing corridor grows with fan-out and text');
  const children = ids.slice(1).map(id => result[id]).sort((a, b) => a.y - b.y);
  assert.equal(result.root.y, children[0].y, 'A module begins beside its first lesson instead of halfway down the reading list');
  for (let i = 1; i < children.length; i++) assert.ok(children[i].y - children[i - 1].y >= 248);
  assert.equal(cleanGraphPlan(input.graphNotes, edges).primaryLinks.length, edges.length);
  assert.deepEqual(input, before);
});

test('Relationship labels wrap inside the same measured rectangle used by automatic layout', () => {
  const text = '从已有基础知识理解新的概念与实验条件，并说明这一联系的适用范围';
  const box = relationLabelGeometry(text);
  assert.ok(box.lines.length > 1 && box.lines.length <= 4);
  assert.equal(box.lines.join(''), text);
  assert.ok(box.width <= 212 && box.height <= 76);
  assert.ok(relationLabelGeometry('短标签').height < box.height);
});

test('Existing reading navigation identifies a same-type feedback edge without replacing the content chain', () => {
  const path = ['z-domain', 'y-question', 'x-states', 'w-control', 'v-collision', 'u-measurement', 'a-interpretation'];
  const content = path.slice(1).map((id, i) => link(path[i], id, 'extends'));
  const feedback = link(path.at(-1), path[1], 'extends');
  const navigation = path.slice(1).map((id, i) => link(path[i], id, 'sequence'));
  const edges = [feedback, ...content, ...navigation], snapshot = structuredClone(edges);
  const plan = cleanGraphPlan(notes(path), edges), ids = new Set(plan.primaryLinks.map(edge => edge.id));
  for (const edge of content) assert.ok(ids.has(edge.id), 'The forward content chain survives: ' + edge.id);
  assert.ok(plan.auxiliaryLinks.some(edge => edge.id === feedback.id), 'Return to the question remains a feedback reference');
  assert.ok(plan.primaryLinks.every(edge => edge.type === 'extends'), 'Navigation does not become scientific content');
  assert.deepEqual(plan.sequenceOrder, path);
  assert.deepEqual(cleanGraphPlan(shuffled(notes(path)), shuffled(edges)), plan);
  const positions = computeGraphLayout(notes(path), edges, { mode: 'clean' });
  for (const edge of content) assert.ok(positions[edge.to].x > positions[edge.from].x);
  assert.deepEqual(edges, snapshot);
});

test('A component containing only parallel relationships preserves all cards on a shared layer', () => {
  const ids = ['a', 'b', 'c'];
  const edges = [link('a', 'b', 'parallel'), link('b', 'c', 'parallel')];
  const plan = cleanGraphPlan(notes(ids), edges), result = computeGraphLayout(notes(ids), edges, { mode: 'clean' });
  assertCards(result, ids);
  assert.equal(plan.primaryLinks.length, 2);
  assert.equal(new Set(Object.values(result).map(point => point.x)).size, 1);
  assert.equal(new Set(Object.values(result).map(point => point.y)).size, 3);
  assert.deepEqual(computeGraphLayout(shuffled(notes(ids)), shuffled(edges), { mode: 'clean' }), result);
});

test('Pure reading components retain a horizontal navigation fallback without connecting unrelated paths', () => {
  const ids = ['z-first', 'a-next', 'q-first', 'b-next', 'loose'];
  const edges = [link('z-first', 'a-next', 'sequence'), link('q-first', 'b-next', 'sequence')];
  const plan = cleanGraphPlan(notes(ids), edges), result = computeGraphLayout(notes(ids), edges, { mode: 'clean' });
  assertCards(result, ids);
  assert.deepEqual(plan.primaryLinks.map(edge => edge.id).sort(), edges.slice(0, 2).map(edge => edge.id).sort());
  assert.equal(result['z-first'].y, result['a-next'].y);
  assert.equal(result['q-first'].y, result['b-next'].y);
  assert.ok(result['a-next'].x > result['z-first'].x && result['b-next'].x > result['q-first'].x);
  assert.notDeepEqual(result['z-first'], result['q-first']);
});

test('A long pure reading fallback stays horizontal while conflicting parallel imports cannot reverse a dependency', () => {
  const ids = Array.from({ length: 12 }, (_, i) => 'step-' + String(i).padStart(2, '0'));
  const sequence = ids.slice(1).map((id, i) => link(ids[i], id, 'sequence'));
  const result = computeGraphLayout(notes(ids), sequence, { mode: 'clean' });
  assertCards(result, ids);
  const step = result[ids[1]].x - result[ids[0]].x;
  assert.ok(step >= 244 + 112, 'Reading cards retain room for labels');
  for (let i = 0; i < ids.length; i++) {
    assert.equal(result[ids[i]].x, i * step);
    assert.equal(result[ids[i]].y, 0);
  }
  const conflicting = [link('a', 'b', 'prerequisite'), link('a', 'b', 'parallel')];
  const layout = computeGraphLayout(notes(['a', 'b']), conflicting, { mode: 'clean' });
  assert.ok(layout.b.x > layout.a.x, 'A parallel annotation cannot contradict an explicit dependency');
  assert.equal(cleanGraphPlan(notes(['a', 'b']), conflicting).primaryLinks.length, 2, 'Both stored explanations remain accessible');
});

test('Clean topology is stable for reordered imports, multiple parents, loops and auxiliary references', () => {
  const ids = ['root', 'a', 'b', 'c', 'd', 'other'];
  const edges = [link('root', 'a'), link('root', 'b'), link('a', 'c'), link('b', 'c'), link('c', 'root'),
    link('c', 'd', 'extends'), link('d', 'a', 'prerequisite')];
  const graphNotes = notes(ids), result = computeGraphLayout(graphNotes, edges, { mode: 'clean' });
  assertCards(result, ids);
  const plan = cleanGraphPlan(graphNotes, edges);
  for (const edge of plan.primaryLinks) assert.ok(result[edge.from].x < result[edge.to].x, 'Only the accepted hierarchy determines levels');
  const auxiliary = [link('other', 'root', 'contradicts'), link('d', 'other', 'contradicts'), link('b', 'a', 'contradicts')];
  assert.deepEqual(computeGraphLayout(shuffled(graphNotes), shuffled([...edges, ...auxiliary]), { mode: 'clean' }), result);
  assert.deepEqual(cleanGraphPlan(shuffled(graphNotes), shuffled(edges)), plan);
  const dirty = [null, {}, ...edges, { ...edges[0], id: 'z-duplicate' }, link('a', 'missing'), link('a', 'a')];
  assert.deepEqual(computeGraphLayout([null, {}, ...graphNotes, graphNotes[0]], dirty, { mode: 'clean' }), result);
  assert.notEqual(layoutSignature(graphNotes, edges, 'clean'), layoutSignature(graphNotes, edges, 'columns'));
});

test('Clean isolated cards use a compact three-column grid without inventing learning relations', () => {
  const ids = Array.from({ length: 20 }, (_, i) => 'isolated-' + String(i).padStart(2, '0'));
  const result = computeGraphLayout(notes(ids), [], { mode: 'clean' });
  assertCards(result, ids);
  assert.equal(new Set(Object.values(result).map(point => point.x)).size, 3);
  assert.equal(new Set(Object.values(result).map(point => point.y)).size, 7);
  assert.deepEqual(cleanGraphPlan(notes(ids), []), { primaryLinks: [], auxiliaryLinks: [], sequenceOrder: [] });
  assert.deepEqual(computeGraphLayout(shuffled(notes(ids)), [], { mode: 'clean' }), result);
  assert.deepEqual(computeGraphLayout([], [], { mode: 'clean' }), {});
});

test('Clean geometry honors card size, origin and spacing with cycles and secondary components', () => {
  const ids = ['a', 'b', 'c', 'module', 'other', 'child', 'isolated'];
  const edges = [link('a', 'b', 'sequence'), link('b', 'c', 'sequence'), link('c', 'a', 'sequence'),
    link('module', 'a'), link('other', 'child'), link('child', 'module', 'evidence')];
  const options = { mode: 'clean', nodeWidth: 320, nodeHeight: 144, columnGap: 76, rowGap: 32, componentGap: 90, originX: -123, originY: 57 };
  const result = computeGraphLayout(notes(ids), edges, options);
  assertCards(result, ids, { ...options, minimumGap: 32 });
  assert.equal(Math.min(...Object.values(result).map(point => point.x)), options.originX);
  assert.equal(Math.min(...Object.values(result).map(point => point.y)), options.originY);
  assert.deepEqual(computeGraphLayout(shuffled(notes(ids)), shuffled(edges), options), result);
  const changed = notes(ids).map(note => ({ ...note, title: 'Different title', content: 'Changed prose', status: 'understood', position: { x: 0, y: 0 } }));
  assert.deepEqual(computeGraphLayout(changed, edges, options), result);
});
