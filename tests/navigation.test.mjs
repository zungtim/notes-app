import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseRoute, routeHash, resolveRoute, createHashNavigation } from '../src/public/navigation.js';
import * as framework from '../src/public/framework.js';
import { bindImageEditor, installImageUI, imagesUploading } from '../src/public/images.js';

function fixture() {
  const modules = ['a', 'b', 'c', 'd'].map(id => ({ id, topicId: 't', title: `Module ${id}`, tags: ['框架模块'] }));
  const notes = ['n1', 'n2', 'loose'].map(id => ({ id, topicId: 't', title: id, tags: [] }));
  const pairs = [['a', 'b'], ['b', 'c'], ['a', 'd'], ['b', 'n1'], ['b', 'n2']];
  return { topics: [{ id: 't' }, { id: 'other' }], notes: [...modules, ...notes],
    links: pairs.map(([from, to], i) => ({ id: `l${i}`, topicId: 't', from, to, type: 'branch' })) };
}
const topic = (scope = 'overview', noteId = null) => ({ view: 'topic', topicId: 't', scope, noteId });

function browser(initial = '#/home') {
  const entries = [initial], renders = [], repairs = [];
  let index = 0, blocked = false, warnings = 0;
  const db = fixture();
  const nav = createHashNavigation({
    readHash: () => entries[index],
    setHash: hash => { entries.splice(++index); entries.push(hash); },
    replaceHash: hash => { repairs.push(hash); entries[index] = hash; },
    getNotebook: () => db, applyRoute: route => renders.push(route),
    isBlocked: () => blocked, onBlocked: () => warnings++
  });
  const back = () => { if (index > 0) index--; nav.restore(); };
  const forward = () => { if (index < entries.length - 1) index++; nav.restore(); };
  nav.restore();
  return { nav, db, entries, renders, repairs, back, forward,
    go: route => { nav.navigate(route); nav.restore(); },
    get hash() { return entries[index]; }, get route() { return renders.at(-1); },
    set blocked(value) { blocked = value; }, get warnings() { return warnings; } };
}

test('hash routes round-trip stable IDs, including encoded IDs, and retain old links', () => {
  const route = { view: 'topic', topicId: 'topic /一', scope: 'module?二', noteId: 'note#三' };
  assert.deepEqual(parseRoute(routeHash(route)), route);
  assert.equal(routeHash(topic()), '#/topic/t');
  assert.deepEqual(parseRoute('#/topic/t/note/n1'), { ...topic(null, 'n1') });
  assert.equal(parseRoute('#/topic/%E0%A4%A').view, 'home');
  assert.equal(parseRoute('#/unknown').view, 'home');
});

test('legacy, missing, invalid and deleted scopes have deterministic fallbacks', () => {
  const db = fixture();
  assert.deepEqual(resolveRoute(parseRoute('#/topic/t'), db), topic());
  assert.deepEqual(resolveRoute(parseRoute('#/topic/t/note/n1'), db), topic('b', 'n1'));
  assert.deepEqual(resolveRoute(topic('deleted'), db), topic());
  assert.deepEqual(resolveRoute(topic('deleted', 'n1'), db), topic('b', 'n1'));
  assert.deepEqual(resolveRoute(topic('b', 'deleted-note'), db), topic('b'));
  assert.deepEqual(resolveRoute(topic('a', 'n2'), db), topic('b', 'n2'));
  assert.deepEqual(resolveRoute(topic(null, 'loose'), db), topic('unassigned', 'loose'));
  assert.equal(resolveRoute({ ...topic('b'), topicId: 'deleted-topic' }, db).view, 'home');
  assert.equal(resolveRoute({ ...topic('b', 'n1'), topicId: 'other' }, db).noteId, null);
  const plain = { topics: [{ id: 't' }], notes: [{ id: 'n1', topicId: 't', tags: [] }], links: [] };
  assert.deepEqual(resolveRoute(topic('deleted', 'n1'), plain), topic('overview', 'n1'));
});

test('native history restores home, A, nested B and C in actual visit order', () => {
  const b = browser();
  for (const scope of ['a', 'b', 'c']) b.go(topic(scope));
  for (const scope of ['b', 'a']) { b.back(); assert.deepEqual(b.route, topic(scope)); }
  b.back(); assert.equal(b.route.view, 'home');
  for (const scope of ['a', 'b', 'c']) { b.forward(); assert.deepEqual(b.route, topic(scope)); assert.equal(b.hash, routeHash(b.route)); }
  assert.equal(b.entries.length, 4);
  assert.equal(b.repairs.length, 0);
  assert.equal(b.renders.length, 10);
});

test('note selection, related-note navigation and close preserve module context', () => {
  const b = browser();
  for (const route of [topic('b'), topic('b', 'n1'), topic('b', 'n2'), topic('b')]) b.go(route);
  b.back(); assert.deepEqual(b.route, topic('b', 'n2'));
  b.back(); assert.deepEqual(b.route, topic('b', 'n1'));
  b.back(); assert.deepEqual(b.route, topic('b'));
  b.forward(); b.forward(); assert.deepEqual(b.route, topic('b', 'n2'));
});

test('visiting D after going back drops the former forward branch', () => {
  const b = browser(); b.go(topic('a')); b.go(topic('b')); b.back(); b.go(topic('d'));
  b.forward(); assert.deepEqual(b.route, topic('d'));
  assert.deepEqual(b.entries, ['#/home', routeHash(topic('a')), routeHash(topic('d'))]);
});

test('same target and duplicate hash notifications do not add history or render again', () => {
  const b = browser(); b.go(topic('b', 'n1'));
  const count = b.renders.length;
  for (let i = 0; i < 3; i++) { b.go(topic('b', 'n1')); b.nav.restore(); }
  assert.equal(b.entries.length, 2); assert.equal(b.renders.length, count);
  // Explicit overview is a new destination, independent of the previous entry.
  b.go(topic()); assert.equal(b.hash, '#/topic/t');
  b.back(); assert.deepEqual(b.route, topic('b', 'n1'));
});

test('refresh restores a scoped note; normalization replaces only the invalid entry', () => {
  const b = browser(routeHash(topic('b', 'n2')));
  assert.deepEqual(b.route, topic('b', 'n2')); assert.equal(b.repairs.length, 0);
  const legacy = browser('#/topic/t/note/n1');
  assert.deepEqual(legacy.route, topic('b', 'n1')); assert.equal(legacy.entries.length, 1);
  const dead = browser('#/topic/t?scope=removed');
  assert.deepEqual(dead.repairs, ['#/topic/t']); assert.deepEqual(dead.route, topic());
});

test('upload traversal waits without rewriting visited entries or losing the forward chain', () => {
  const b = browser(); b.go(topic('a')); b.go(topic('b', 'n1'));
  b.blocked = true; b.back();
  assert.equal(b.hash, routeHash(topic('a')));
  assert.deepEqual(b.route, topic('b', 'n1')); // Keep the upload's editor alive.
  assert.equal(b.nav.navigate(topic('d')), false);
  assert.equal(b.entries.length, 3); assert.equal(b.repairs.length, 0);
  b.blocked = false; b.nav.resume(); assert.deepEqual(b.route, topic('a'));
  b.forward(); assert.deepEqual(b.route, topic('b', 'n1'));
  b.back(); b.go(topic('d')); b.forward(); assert.deepEqual(b.route, topic('d'));
});

test('several traversals during an upload restore the latest target, once', () => {
  const b = browser(); b.go(topic('a')); b.go(topic('b')); b.go(topic('c'));
  b.blocked = true; b.back(); b.back(); b.forward();
  const count = b.renders.length;
  b.blocked = false; b.nav.resume(); b.nav.resume();
  assert.deepEqual(b.route, topic('b')); assert.equal(b.renders.length, count + 1);
  assert.equal(b.repairs.length, 0); b.forward(); assert.deepEqual(b.route, topic('c'));
  b.blocked = true; b.back(); b.forward(); b.blocked = false;
  const same = b.renders.length; b.nav.resume(); assert.equal(b.renders.length, same);
});

test('app navigation flushes the old view key and preserves pending saves and draft state', async () => {
  const source = await readFile(new URL('../src/public/app.js', import.meta.url), 'utf8');
  let hash = '#/topic/t?scope=a';
  const history = [], rendered = [], flushed = [];
  const context = vm.createContext({ createHashNavigation, ...framework, URLSearchParams,
    createLocalStateClient: () => ({ preferences: {} }), imagesUploading: () => false,
    location: { get hash() { return hash; }, set hash(value) { hash = value; history.push(value); } },
    history: { replaceState: (_data, _title, value) => { hash = value; } },
    document: { querySelector: () => ({ classList: { remove() {} } }) },
    record: route => rendered.push(JSON.parse(JSON.stringify(route))), flush: route => flushed.push(JSON.parse(JSON.stringify(route))) });
  vm.runInContext(source.replace(/^import .+;\r?$/gm, '').replace(/\ninit\(\);\s*$/, '') + `
    render=()=>record(state.route);
    globalThis.app={state,navigate,readRoute,selectGraphNote,selectNote,showFrameworkScope};
  `, context);
  const { app } = context;
  app.state.db = fixture(); app.readRoute();
  app.state.dirty = true; app.state.saving = true; app.state.change = 5;
  vm.runInContext('state.graph={destroy(){flush(state.route);}}', context);
  app.selectGraphNote('b');
  assert.equal(rendered.length, 1); // hashchange is responsible for rendering.
  app.readRoute(); assert.deepEqual(flushed, [topic('a')]);
  assert.deepEqual(rendered.at(-1), topic('b'));
  app.selectNote('n1'); app.readRoute();
  assert.deepEqual(rendered.at(-1), topic('b', 'n1'));
  app.selectNote('n2'); app.readRoute();
  assert.deepEqual(rendered.at(-1), topic('b', 'n2'));
  assert.equal(app.state.dirty, true); assert.equal(app.state.saving, true); assert.equal(app.state.change, 5);
  assert.deepEqual(app.state.db, fixture());
  assert.equal(history.length, 3);
  // A focused tag input uses change, which native traversal need not dispatch.
  context.document.querySelector = selector => selector === '#edit-tags' ? { value: 'synthetic, pending' } : { classList: { remove() {} } };
  vm.runInContext('updateNote=(id,values)=>Object.assign(noteById(id),values);state.editing=true;', context);
  hash = routeHash(topic('a')); app.readRoute();
  assert.deepEqual(Array.from(app.state.db.notes.find(note => note.id === 'n2').tags), ['synthetic', 'pending']);
  assert.deepEqual(rendered.at(-1), topic('a'));
  app.navigate('all'); app.readRoute();
  const renderCount = rendered.length, historyCount = history.length;
  app.navigate('all');
  assert.equal(rendered.length, renderCount + 1); assert.equal(history.length, historyCount);
});

for (const outcome of ['success', 'failure']) test(`real image editor resumes traversed route after upload ${outcome}`, async t => {
  const oldDocument = globalThis.document, oldRequest = globalThis.XMLHttpRequest;
  t.after(() => { globalThis.document = oldDocument; globalThis.XMLHttpRequest = oldRequest; });
  const elements = [], listeners = new Set(), inputOwners = [], rendered = [];
  const makeElement = tag => {
    const element = { tag, classList: { toggle() {} }, setAttribute() {}, append() {} };
    elements.push(element); return element;
  };
  globalThis.document = { createElement: makeElement, addEventListener() {} };
  let request;
  globalThis.XMLHttpRequest = class {
    constructor() { request = this; this.upload = {}; }
    open() {} setRequestHeader() {} send() {}
  };
  let hash = routeHash(topic('b', 'n1')), current = topic('b', 'n1');
  const repairs = [];
  const nav = createHashNavigation({ readHash: () => hash, setHash: value => { hash = value; },
    replaceHash: value => repairs.push(value), getNotebook: fixture,
    isBlocked: imagesUploading, applyRoute: route => { current = route; rendered.push(route); } });
  nav.restore();
  installImageUI(() => {}, () => nav.resume());
  const textarea = { value: 'unsaved text', isConnected: true, selectionStart: 12, selectionEnd: 12, maxLength: 120000,
    after() {}, addEventListener: (_name, listener) => listeners.add(listener),
    removeEventListener: (_name, listener) => listeners.delete(listener), closest: () => null,
    setRangeText(text, start, end) { this.value = this.value.slice(0, start) + text + this.value.slice(end); this.selectionEnd = start + text.length; },
    dispatchEvent() { inputOwners.push(current.noteId); for (const listener of [...listeners]) listener(); } };
  bindImageEditor(textarea, { toolbar: { append() {} }, isCurrent: () => current.noteId === 'n1' });
  const chooser = elements.find(element => element.type === 'file');
  chooser.files = [{ type: 'image/png', name: 'synthetic.png', size: 1 }]; chooser.onchange();
  assert.equal(imagesUploading(), true);
  hash = routeHash(topic('a')); nav.restore();
  assert.equal(current.noteId, 'n1'); assert.equal(repairs.length, 0);
  if (outcome === 'success') {
    request.status = 201; request.responseText = JSON.stringify({ url: `/images/${'a'.repeat(64)}.png` }); request.onload();
  } else request.onerror();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(imagesUploading(), false);
  assert.deepEqual(current, topic('a')); assert.equal(rendered.length, 2);
  assert.equal(repairs.length, 0); assert.ok(textarea.value.includes('unsaved text'));
  assert.equal(textarea.value.includes('/images/'), outcome === 'success');
  assert.deepEqual(inputOwners, outcome === 'success' ? ['n1'] : []);
  // The old note's entry remains available; replaying it adds no new entry.
  hash = routeHash(topic('b', 'n1')); nav.restore(); assert.deepEqual(current, topic('b', 'n1'));
});
