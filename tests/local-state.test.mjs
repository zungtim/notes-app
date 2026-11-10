import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { APP_ROOT, createAppServer, MAX_NOTEBOOK_BODY_BYTES } from '../src/server.mjs';
import { LocalStateStore, MAX_JSON_EXPORT_BYTES, MAX_MARKDOWN_EXPORT_BYTES, MAX_EXPORT_BODY_BYTES, MAX_GRAPH_VIEW_PREFERENCE_BYTES, MAX_PREFERENCE_BODY_BYTES } from '../src/lib/local-state.mjs';
import { createNotebookFixture } from './fixtures/notebook.mjs';

async function workspace() {
  const root = process.env.NOTES_TEST_ARTIFACTS || path.join(APP_ROOT, '_workspace', 'test-artifacts');
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, 'local-state-'));
}

const draft = () => ({ data: createNotebookFixture(), changedAt: '2026-01-02T03:04:05.000Z' });

function request(port, route, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function isolatedServer(t) {
  const dataDir = await workspace();
  const { server } = createAppServer({ dataDir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }));
  const port = server.address().port;
  const send = (route, body, options = {}) => request(port, route, { method: 'POST', ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, body: JSON.stringify(body) });
  return { port, dataDir, send };
}

test('preferences merge single keys under concurrent writes and survive a fresh store', async () => {
  const dataDir = await workspace();
  const state = new LocalStateStore(dataDir);
  assert.deepEqual(await state.read(), { preferences: {}, drafts: [] });
  const pane = JSON.stringify({ version: 1, sidebarWidth: 240, headerHeight: null });
  await Promise.all([
    state.savePreference({ key: 'notes-pane-layout-v1', value: pane }),
    ...Array.from({ length: 12 }, (_, i) => state.savePreference({ key: `zhixu-layout-topic_${i}`, value: i % 2 ? 'columns' : 'branches' })),
  ]);
  const restored = await new LocalStateStore(dataDir).read();
  assert.equal(Object.keys(restored.preferences).length, 13);
  assert.equal(restored.preferences['notes-pane-layout-v1'], pane);
  for (let i = 0; i < 12; i++) assert.equal(restored.preferences[`zhixu-layout-topic_${i}`], i % 2 ? 'columns' : 'branches');
  await assert.rejects(state.savePreference({ key: '__proto__', value: '{}' }), /不支持/);
  await assert.rejects(state.savePreference({ key: 'zhixu-layout-topic_0', value: 'arbitrary' }), /布局/);
  await assert.rejects(state.savePreference({ key: 'notes-pane-layout-v1', value: '{broken' }), /JSON/);
  assert.equal((await state.read()).preferences['notes-pane-layout-v1'], pane);
  assert.ok(!(await fs.readdir(dataDir)).some(name => name.endsWith('.tmp')));
});

test('validated drafts are private files with independent ids, persistence and ordered deletion', async () => {
  const dataDir = await workspace();
  const state = new LocalStateStore(dataDir);
  const first = draft(), second = draft(); second.data.notes[0].title = '第二个独立草稿';
  await Promise.all([state.saveDraft({ id: 'window_a', draft: first }), state.saveDraft({ id: 'window_b', draft: second })]);
  assert.deepEqual((await new LocalStateStore(dataDir).read()).drafts, [{ id: 'window_a', draft: first }, { id: 'window_b', draft: second }]);
  for (const id of ['../escape', '..', 'nested/file', 'C:\\outside', 'CON', 'nul']) await assert.rejects(state.saveDraft({ id, draft: first }), /标识符/);
  const broken = draft(); broken.data.notes[0].topicId = 'missing';
  await assert.rejects(state.saveDraft({ id: 'window_a', draft: broken }), /主题不存在/);
  await assert.rejects(state.saveDraft({ id: 'window_a', draft: { ...first, changedAt: 'yesterday' } }), /日期/);
  assert.deepEqual((await state.read()).drafts[0].draft, first);
  await Promise.all([state.saveDraft({ id: 'window_a', draft: second }), state.deleteDraft('window_a')]);
  assert.deepEqual((await state.read()).drafts, [{ id: 'window_b', draft: second }]);
  assert.deepEqual(await state.deleteDraft('window_a'), { id: 'window_a', deleted: true });
  await assert.rejects(fs.stat(path.join(dataDir, 'notebook.json')), { code: 'ENOENT' });
});

test('exports stay in data/exports and duplicate filenames never replace prior contents', async () => {
  const dataDir = await workspace();
  const state = new LocalStateStore(dataDir);
  const content = JSON.stringify({ notes: ['中文', 'quote: "', 'newline\n'], image: 'data:image/png;base64,AAAA' });
  const [first, second] = await Promise.all([
    state.exportFile({ filename: '笔记备份.json', content, format: 'json' }),
    state.exportFile({ filename: '笔记备份.json', content: '{"second":true}', format: 'json' }),
  ]);
  assert.notEqual(first.filename, second.filename);
  assert.equal(first.filename, '笔记备份.json');
  assert.equal(path.dirname(first.path), path.join(dataDir, 'exports'));
  assert.equal(first.bytes, Buffer.byteLength(content));
  assert.equal(await fs.readFile(first.path, 'utf8'), content);
  assert.equal(await fs.readFile(second.path, 'utf8'), '{"second":true}');
  const markdown = await state.exportFile({ filename: '复习', content: '# 复习\n\n内容', format: 'markdown' });
  assert.equal(markdown.filename, '复习.md');
  assert.equal(await fs.readFile(markdown.path, 'utf8'), '# 复习\n\n内容');
  for (const filename of ['../outside.json', 'nested/file.json', 'D:\\outside.json', 'x.json:stream', 'CON.json', 'bad.json.', '.hidden.json']) await assert.rejects(state.exportFile({ filename, content, format: 'json' }), /文件名/);
  await assert.rejects(state.exportFile({ filename: 'wrong.md', content, format: 'json' }), /扩展名/);
  await assert.rejects(state.exportFile({ filename: 'broken.json', content: '{broken', format: 'json' }), /有效JSON/);
  await assert.rejects(state.exportFile({ filename: 'big.md', content: 'x'.repeat(MAX_MARKDOWN_EXPORT_BYTES + 1), format: 'markdown' }), { statusCode: 413 });
  assert.equal(MAX_JSON_EXPORT_BYTES, 256 * 1024 * 1024);
  assert.ok(MAX_EXPORT_BODY_BYTES > 2 * MAX_JSON_EXPORT_BYTES);
  assert.equal(MAX_NOTEBOOK_BODY_BYTES, 64 * 1024 * 1024);
  assert.equal((await fs.readdir(path.join(dataDir, 'exports'))).length, 3);
});

test('private-state directories cannot be redirected through a junction or symlink', async t => {
  const root = await workspace();
  const dataDir = path.join(root, 'data'), outside = path.join(root, 'unrelated');
  await fs.mkdir(dataDir); await fs.mkdir(outside);
  try { await fs.symlink(outside, path.join(dataDir, 'exports'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('This environment does not allow directory links'); return; } throw error; }
  await assert.rejects(new LocalStateStore(dataDir).exportFile({ filename: 'blocked.json', content: '{}', format: 'json' }), /目录不能指向/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('local state HTTP routes retain origin checks, limits, private caching and data isolation', async t => {
  const { port, dataDir, send } = await isolatedServer(t);
  const initial = await request(port, '/api/local-state');
  assert.equal(initial.status, 200);
  assert.equal(initial.headers['cache-control'], 'no-store');
  assert.deepEqual(initial.json(), { preferences: {}, drafts: [] });
  assert.equal((await send('/api/preferences', { key: 'zhixu-layout-topic', value: 'columns' })).status, 200);
  assert.equal((await send('/api/drafts', { id: 'http_draft', draft: draft() })).status, 200);
  const exported = await send('/api/exports', { filename: '测试.json', content: '{"ok":true}', format: 'json' });
  assert.equal(exported.status, 201);
  assert.equal(await fs.readFile(exported.json().path, 'utf8'), '{"ok":true}');
  const guarded = [
    ['/api/preferences', { key: 'zhixu-layout-topic', value: 'branches' }],
    ['/api/drafts', { id: 'forbidden', draft: draft() }],
    ['/api/exports', { filename: 'forbidden.json', content: '{}', format: 'json' }],
  ];
  for (const [route, body] of guarded) assert.equal((await send(route, body, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request(port, '/api/local-state', { headers: { Host: `evil.example:${port}` } })).status, 403);
  assert.equal((await request(port, '/api/drafts/http_draft', { method: 'DELETE', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await request(port, '/api/drafts/bad%2Fid', { method: 'DELETE' })).status, 400);
  assert.equal((await request(port, '/api/drafts/%2e%2e', { method: 'DELETE' })).status, 403);
  assert.equal((await request(port, '/data/drafts/http_draft.json')).status, 404);
  assert.equal((await request(port, `/data/exports/${encodeURIComponent('测试.json')}`)).status, 404);
  assert.equal((await request(port, '/api/exports')).status, 405);
  assert.equal((await request(port, '/api/exports', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(MAX_EXPORT_BODY_BYTES + 1) } })).status, 413);
  assert.equal((await request(port, '/api/drafts/http_draft', { method: 'DELETE' })).status, 200);
  const restored = await new LocalStateStore(dataDir).read();
  assert.equal(restored.preferences['zhixu-layout-topic'], 'columns');
  assert.deepEqual(restored.drafts, []);
  assert.deepEqual(await fs.readdir(path.join(dataDir, 'exports')), ['测试.json']);
});


test('Study sequence layout preference survives reopening and leaves another topic preference intact', async () => {
  const dataDir = await workspace();
  const state = new LocalStateStore(dataDir);
  const key = 'zhixu-layout-synthetic_study', otherKey = 'zhixu-layout-synthetic_other';
  await state.savePreference({ key: otherKey, value: 'columns' });
  await state.savePreference({ key, value: 'sequence' });

  const reopened = new LocalStateStore(dataDir);
  assert.deepEqual(await reopened.read(), {
    preferences: { [otherKey]: 'columns', [key]: 'sequence' }, drafts: [],
  });
  await reopened.savePreference({ key, value: 'branches' });
  assert.equal((await new LocalStateStore(dataDir).read()).preferences[key], 'branches');
  await reopened.savePreference({ key, value: 'sequence' });
  const restored = await new LocalStateStore(dataDir).read();
  assert.equal(restored.preferences[key], 'sequence');
  assert.equal(restored.preferences[otherKey], 'columns', 'A topic view change preserves unrelated preferences');
  await assert.rejects(reopened.savePreference({ key, value: 'sequence-other' }), /布局/);
  assert.deepEqual(await new LocalStateStore(dataDir).read(), restored,
    'Rejecting an unsupported view does not replace the last saved sequence preference');
});


function syntheticGraphView() {
  return {
    version: 1, layout: 'sequence',
    positions: { node_a: { x: 10, y: 20 }, node_b: { x: -30, y: 100 } },
    transform: { x: 125, y: -45, scale: .8 },
  };
}

function syntheticCleanGraphView() {
  return { ...syntheticGraphView(), version: 2, layout: 'clean', structureKey: 'synthetic-learning-structure' };
}

test('A clean graph view can replace its legacy snapshot while other legacy scopes remain readable', async () => {
  const dataDir = await workspace(), state = new LocalStateStore(dataDir);
  const legacy = Object.fromEntries(['columns', 'branches', 'sequence'].map(layout => [
    `notes-graph-view-synthetic__${layout}`, JSON.stringify({ ...syntheticGraphView(), layout }),
  ]));
  for (const [key, value] of Object.entries(legacy)) await state.savePreference({ key, value });

  const key = 'notes-graph-view-synthetic__columns', view = syntheticCleanGraphView();
  await state.savePreference({ key, value: JSON.stringify(view) });
  const reopened = new LocalStateStore(dataDir), restored = await reopened.read();
  assert.deepEqual(restored.preferences, { ...legacy, [key]: JSON.stringify(view) });
  assert.deepEqual(restored.drafts, []);

  view.positions.node_b = { x: 420, y: 210 };
  view.transform = { x: -280, y: 90, scale: 1.1 };
  await reopened.savePreference({ key, value: JSON.stringify(view) });
  assert.deepEqual(JSON.parse((await new LocalStateStore(dataDir).read()).preferences[key]), view);
  await assert.rejects(fs.stat(path.join(dataDir, 'notebook.json')), { code: 'ENOENT' });
});

test('Clean view storage rejects mismatched versions and invalid structure keys without replacing its last valid view', async () => {
  const dataDir = await workspace(), state = new LocalStateStore(dataDir);
  const key = 'notes-graph-view-synthetic__clean', value = JSON.stringify(syntheticCleanGraphView());
  await state.savePreference({ key, value });
  const before = await fs.readFile(path.join(dataDir, 'preferences.json'), 'utf8');
  const invalidViews = [
    { ...syntheticGraphView(), layout: 'clean' },
    ...['columns', 'branches', 'sequence'].map(layout => ({ ...syntheticCleanGraphView(), layout })),
    { ...syntheticCleanGraphView(), version: 0 },
    { ...syntheticCleanGraphView(), version: 3 },
    { ...syntheticGraphView(), structureKey: 'legacy-has-no-structure-key' },
  ];
  for (const structureKey of [undefined, null, '', 123, {}, 'x'.repeat(101)]) {
    const invalid = syntheticCleanGraphView();
    if (structureKey === undefined) delete invalid.structureKey;
    else invalid.structureKey = structureKey;
    invalidViews.push(invalid);
  }
  for (const view of invalidViews) {
    await assert.rejects(state.savePreference({ key, value: JSON.stringify(view) }), { statusCode: 400 });
  }
  assert.equal(await fs.readFile(path.join(dataDir, 'preferences.json'), 'utf8'), before);
  assert.equal((await new LocalStateStore(dataDir).read()).preferences[key], value);
});

test('The preferences API round-trips a clean graph snapshot independently of notebook data', async t => {
  const { dataDir, send } = await isolatedServer(t);
  const key = 'notes-graph-view-synthetic__overview', view = syntheticCleanGraphView();
  const saved = await send('/api/preferences', { key, value: JSON.stringify(view) });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(JSON.parse((await new LocalStateStore(dataDir).read()).preferences[key]), view);
  const rejected = await send('/api/preferences', { key, value: JSON.stringify({ ...view, layout: 'branches' }) });
  assert.equal(rejected.status, 400);
  assert.deepEqual(JSON.parse((await new LocalStateStore(dataDir).read()).preferences[key]), view);
  await assert.rejects(fs.stat(path.join(dataDir, 'notebook.json')), { code: 'ENOENT' });
});

test('Graph view positions and viewport survive reopening independently for each scope', async () => {
  const dataDir = await workspace(), state = new LocalStateStore(dataDir);
  const firstKey = 'notes-graph-view-topic_a__module_a';
  const secondKey = 'notes-graph-view-topic_a__module_b';
  const first = syntheticGraphView(), second = syntheticGraphView();
  second.layout = 'branches';
  second.positions.node_a = { x: -300, y: 400 };
  second.transform = { x: -25, y: 72, scale: 1.2 };
  const pane = JSON.stringify({ version: 1, sidebarWidth: 230, headerHeight: 120 });
  await Promise.all([
    state.savePreference({ key: firstKey, value: JSON.stringify(first) }),
    state.savePreference({ key: secondKey, value: JSON.stringify(second) }),
    state.savePreference({ key: 'notes-pane-layout-v1', value: pane }),
    state.savePreference({ key: 'zhixu-layout-topic_a', value: 'columns' }),
  ]);

  const reopened = new LocalStateStore(dataDir), saved = await reopened.read();
  assert.deepEqual(JSON.parse(saved.preferences[firstKey]), first);
  assert.deepEqual(JSON.parse(saved.preferences[secondKey]), second);
  assert.equal(saved.preferences['notes-pane-layout-v1'], pane);
  assert.equal(saved.preferences['zhixu-layout-topic_a'], 'columns');
  assert.equal(Object.keys(saved.preferences).length, 4);
  assert.deepEqual(saved.drafts, []);

  first.positions.node_a = { x: 912, y: -638 };
  first.transform = { x: 200, y: 80, scale: .55 };
  await reopened.savePreference({ key: firstKey, value: JSON.stringify(first) });
  const restored = await new LocalStateStore(dataDir).read();
  assert.deepEqual(JSON.parse(restored.preferences[firstKey]), first);
  assert.deepEqual(JSON.parse(restored.preferences[secondKey]), second,
    'Saving one module cannot overwrite another module of the same topic');
  assert.equal(restored.preferences['notes-pane-layout-v1'], pane);
  assert.equal(restored.preferences['zhixu-layout-topic_a'], 'columns');
  await assert.rejects(fs.stat(path.join(dataDir, 'notebook.json')), { code: 'ENOENT' });
});

test('Graph locks roundtrip with legacy views and reject invalid or out-of-view identifiers', async () => {
  const dataDir = await workspace(), state = new LocalStateStore(dataDir);
  const key = 'notes-graph-view-topic_lock__module_a', view = syntheticGraphView();
  view.lockedIds = ['node_a'];
  const value = JSON.stringify(view);
  await state.savePreference({ key, value });
  assert.deepEqual(JSON.parse((await new LocalStateStore(dataDir).read()).preferences[key]), view);
  const contextKey='notes-graph-context-topic_lock__module_a';
  await state.savePreference({key:contextKey,value});
  assert.equal((await state.read()).preferences[contextKey],value,'Expanded context has separate durable positions and locks');
  for (const lockedIds of ['node_a', null, ['node_a', 'node_a'], ['ghost'], ['__proto__'], [42]]) {
    await assert.rejects(state.savePreference({ key, value: JSON.stringify({ ...view, lockedIds }) }), { statusCode: 400 });
  }
  assert.equal((await state.read()).preferences[key], value);
  delete view.lockedIds;
  await state.savePreference({ key, value: JSON.stringify(view) });
  assert.deepEqual(JSON.parse((await state.read()).preferences[key]), view, 'Old views remain valid');
});

test('Graph view preferences reject unsafe keys, malformed points and invalid transforms without replacing saved state', async () => {
  const dataDir = await workspace(), state = new LocalStateStore(dataDir);
  const key = 'notes-graph-view-topic_a__module_a', value = JSON.stringify(syntheticGraphView());
  await state.savePreference({ key, value });
  const before = await fs.readFile(path.join(dataDir, 'preferences.json'), 'utf8');
  for (const badKey of ['__proto__', 'arbitrary', 'notes-graph-view-', 'notes-graph-view-x/y',
    'notes-graph-view-x y', 'notes-graph-view-' + 'x'.repeat(221)]) {
    await assert.rejects(state.savePreference({ key: badKey, value }), { statusCode: 400 });
  }
  const mutations = [
    view => { view.version = 2; },
    view => { view.layout = 'unknown'; },
    view => { view.extra = true; },
    view => { delete view.positions; },
    view => { view.positions = []; },
    view => { view.positions = null; },
    view => { view.positions = { '': { x: 0, y: 0 } }; },
    view => { view.positions = { '../outside': { x: 0, y: 0 } }; },
    view => { view.positions = { ['x'.repeat(101)]: { x: 0, y: 0 } }; },
    view => { view.positions.node_a.x = 1000001; },
    view => { view.positions.node_a.x = '10'; },
    view => { view.positions.node_a.y = null; },
    view => { view.positions.node_a = []; },
    view => { view.positions.node_a.extra = 1; },
    view => { delete view.positions.node_a.y; },
    view => { delete view.transform; },
    view => { view.transform = []; },
    view => { view.transform.extra = 1; },
    view => { view.transform.x = -1000001; },
    view => { view.transform.y = null; },
    view => { view.transform.scale = 0; },
    view => { view.transform.scale = -1; },
    view => { view.transform.scale = 4.01; },
    view => { view.transform.scale = '1'; },
  ];
  for (const mutate of mutations) {
    const invalid = syntheticGraphView(); mutate(invalid);
    await assert.rejects(state.savePreference({ key, value: JSON.stringify(invalid) }), { statusCode: 400 });
  }
  for (const id of ['__proto__', 'constructor', 'prototype']) {
    const invalid = syntheticGraphView();
    invalid.positions = Object.fromEntries([[id, { x: 0, y: 0 }]]);
    await assert.rejects(state.savePreference({ key, value: JSON.stringify(invalid) }), { statusCode: 400 });
  }
  for (const invalid of ['{broken', '[]', 'null', value.replace('"x":10', '"x":1e309')]) {
    await assert.rejects(state.savePreference({ key, value: invalid }), { statusCode: 400 });
  }
  await assert.rejects(state.savePreference({ key, value: syntheticGraphView() }), { statusCode: 400 });
  await assert.rejects(state.savePreference({ key, value: ' '.repeat(MAX_GRAPH_VIEW_PREFERENCE_BYTES) + value }), { statusCode: 413 });
  assert.equal(await fs.readFile(path.join(dataDir, 'preferences.json'), 'utf8'), before);
  assert.deepEqual((await new LocalStateStore(dataDir).read()).preferences, { [key]: value });
});

test('Graph view HTTP storage accepts 5000 synthetic points and keeps bounded preference requests', async t => {
  const { port, dataDir, send } = await isolatedServer(t);
  const key = 'notes-graph-view-topic_a__module_a', view = syntheticGraphView();
  view.positions = Object.fromEntries(Array.from({ length: 5000 }, (_, index) =>
    ['node_' + index, { x: index, y: index === 0 ? 0 : -index }]));
  const value = JSON.stringify(view);
  assert.ok(Buffer.byteLength(value) > 8192, 'A useful graph snapshot may exceed the legacy preference request limit');
  assert.ok(Buffer.byteLength(value) < MAX_GRAPH_VIEW_PREFERENCE_BYTES);
  const saved = await send('/api/preferences', { key, value });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(JSON.parse((await new LocalStateStore(dataDir).read()).preferences[key]), view);

  view.positions.node_5000 = { x: 1, y: 2 };
  const excessivePoints = await send('/api/preferences', { key, value: JSON.stringify(view) });
  assert.equal(excessivePoints.status, 400);
  assert.equal((await new LocalStateStore(dataDir).read()).preferences[key], value,
    'Rejecting an excessive point count preserves the previous view');
  const excessiveBody = await request(port, '/api/preferences', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(MAX_PREFERENCE_BODY_BYTES + 1) },
  });
  assert.equal(excessiveBody.status, 413);
  assert.ok(MAX_PREFERENCE_BODY_BYTES > 2 * MAX_GRAPH_VIEW_PREFERENCE_BYTES);
  await assert.rejects(fs.stat(path.join(dataDir, 'notebook.json')), { code: 'ENOENT' });
});
