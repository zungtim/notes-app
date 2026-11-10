import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { NotebookStore, ValidationError, ConflictError, validateNotebook } from '../src/lib/store.mjs';
import { LocalStateStore } from '../src/lib/local-state.mjs';
import { APP_ROOT, MAX_NOTEBOOK_BODY_BYTES, createAppServer } from '../src/server.mjs';

const stamp = '2026-10-04T00:00:00.000Z';
function fixture() {
  return {
    version: 1, revision: 0,
    topics: [{ id: 'topic', title: '分子束', description: 'test', color: '#123456', createdAt: stamp }],
    notes: ['n1', 'n2'].map(id => ({ id, topicId: 'topic', title: id, content: '# 笔记\n冷与慢不同', type: 'concept', status: 'learning', tags: ['物理'], sources: [{ id: 's1', type: 'paper', title: '综述', url: 'https://example.org/paper', excerpt: '短摘录' }], createdAt: stamp, updatedAt: stamp, position: { x: 100, y: 100 } })),
    links: [{ id: 'l1', topicId: 'topic', from: 'n1', to: 'n2', type: 'extends', label: '延伸' }]
  };
}

async function workspace() {
  const root = process.env.NOTES_TEST_ARTIFACTS || path.join(APP_ROOT, '.dev-workspace', 'test-artifacts');
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, 'run-'));
}

test('complete validation catches broken references, unknown types and malformed fields', () => {
  assert.equal(validateNotebook(fixture()).version, 1);
  const cases = [
    x => { x.notes[0].topicId = 'missing'; },
    x => { x.links[0].to = 'missing'; },
    x => { x.links[0].to = 'n1'; },
    x => { x.notes[0].type = 'other'; },
    x => { x.notes[0].status = 'done'; },
    x => { x.links[0].type = 'random'; },
    x => { x.notes[0].sources[0].type = 'random'; },
    x => { x.notes[0].sources[0].url = 42; },
    x => { x.notes[0].position.x = Infinity; },
    x => { x.notes[0].tags.push('物理'); },
    x => { x.notes[0].unknown = true; },
    x => { x.topics.push({ ...x.topics[0] }); }
  ];
  for (const mutate of cases) { const x = fixture(); mutate(x); assert.throws(() => validateNotebook(x), ValidationError); }
  const cross = fixture();
  cross.topics.push({ ...cross.topics[0], id: 'other' });
  cross.notes[1].topicId = 'other';
  assert.throws(() => validateNotebook(cross), /不能跨主题/);
});

test('store initializes from seed, preserves disk state after invalid saves and detects concurrent conflicts', async () => {
  const dataDir = await workspace();
  await fs.writeFile(path.join(dataDir, 'seed.json'), JSON.stringify(fixture()));
  const store = new NotebookStore(dataDir);
  const initial = await store.read();
  initial.notes[0].title = '第一窗口';
  const competitor = fixture(); competitor.notes[0].title = '第二窗口';
  const results = await Promise.allSettled([store.save(initial, 0), store.save(competitor, 0)]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.ok(results[1].reason instanceof ConflictError);
  assert.equal(results[1].reason.notebook.revision, 1);
  const persisted = JSON.parse(await fs.readFile(path.join(dataDir, 'notebook.json'), 'utf8'));
  assert.equal(persisted.notes[0].title, '第一窗口');
  const broken = structuredClone(persisted); broken.notes[0].topicId = 'missing';
  await assert.rejects(store.save(broken, 1), ValidationError);
  assert.deepEqual(await store.read(), persisted);
  const backup = JSON.parse(await fs.readFile(path.join(dataDir, 'backups', 'notebook-00.json'), 'utf8'));
  assert.equal(backup.revision, 0);
  for (let i = 1; i <= 11; i++) { const next = await store.read(); await store.save(next, next.revision); }
  const files = await fs.readdir(path.join(dataDir, 'backups'));
  assert.equal(files.length, 10);
  const restarted = new NotebookStore(dataDir);
  assert.equal((await restarted.read()).revision, 12);
});

test('corrupt existing notebook is reported and never overwritten by seed', async () => {
  const dataDir = await workspace();
  await fs.writeFile(path.join(dataDir, 'notebook.json'), '{corrupt');
  await fs.writeFile(path.join(dataDir, 'seed.json'), JSON.stringify(fixture()));
  await assert.rejects(new NotebookStore(dataDir).read(), SyntaxError);
  assert.equal(await fs.readFile(path.join(dataDir, 'notebook.json'), 'utf8'), '{corrupt');
});

function request(port, url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', error => { error.message = `${method} ${url}: ${error.message}`; reject(error); });
    req.end(body);
  });
}

test('HTTP API saves, returns revision conflicts and blocks cross-origin, traversal and data files', async t => {
  const root = await workspace();
  const dataDir = path.join(root, 'data'); const publicDir = path.join(root, 'public');
  await fs.mkdir(dataDir); await fs.mkdir(publicDir);
  await fs.writeFile(path.join(dataDir, 'seed.json'), JSON.stringify(fixture()));
  await fs.writeFile(path.join(publicDir, 'index.html'), '<!doctype html><h1>Learning</h1>');
  const { server } = createAppServer({ dataDir, publicDir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  assert.equal((await request(port, '/')).status, 200);
  const current = JSON.parse((await request(port, '/api/notebook')).text);
  const payload = JSON.stringify({ notebook: current, baseRevision: 0 });
  const saved = await request(port, '/api/notebook', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` }, body: payload });
  assert.equal(saved.status, 200); assert.equal(JSON.parse(saved.text).revision, 1);
  assert.equal(saved.headers['x-notes-read-only'], undefined, 'Ordinary app servers retain writable behavior without a preview header');
  const conflict = await request(port, '/api/notebook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
  assert.equal(conflict.status, 409); assert.equal(JSON.parse(conflict.text).notebook.revision, 1);
  assert.equal((await request(port, '/api/notebook', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: payload })).status, 403);
  assert.equal((await request(port, '/api/notebook', { headers: { Host: `evil.example:${port}` } })).status, 403);
  assert.equal((await request(port, '/api/notebook', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await request(port, '/%2e%2e/data/notebook.json')).status, 403);
  assert.equal((await request(port, '/data/notebook.json')).status, 404);
  assert.equal((await request(port, '/server.mjs')).status, 404);
  assert.equal((await request(port, '/api/notebook', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: payload })).status, 400);
  assert.equal(MAX_NOTEBOOK_BODY_BYTES, 64 * 1024 * 1024);
  const tooLarge = await request(port, '/api/notebook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(MAX_NOTEBOOK_BODY_BYTES + 1) } });
  assert.equal(tooLarge.status, 413);
  assert.match(JSON.parse(tooLarge.text).message, /64MB/);
  const health = await request(port, '/api/health');
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.text).app, 'local-learning-notes');
  assert.equal(JSON.parse(health.text).root, APP_ROOT);
});

test('read-only previews allow reading and isolated preferences while blocking every content-write entry point', async t => {
  const root = await workspace(), sourceDir = path.join(root, 'synthetic-source'), previewDir = path.join(root, 'preview-state');
  await fs.mkdir(sourceDir); await fs.mkdir(previewDir);
  const original = JSON.stringify(fixture(), null, 2), sourceFile = path.join(sourceDir, 'notebook.json');
  await fs.writeFile(sourceFile, original);
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=', 'base64');
  const filename = 'a'.repeat(64) + '.png', imageInfo = { id: 'a'.repeat(64), url: `/images/${filename}`, mime: 'image/png', size: image.length, width: 1, height: 1 };
  const calls = { notebookSave: 0, imageSave: 0, draftSave: 0, exportFile: 0, draftDelete: 0, preferenceSave: 0 };
  const forbiddenWrite = name => async () => { calls[name]++; throw new Error(`Unexpected preview write: ${name}`); };
  const state = new LocalStateStore(previewDir);
  const store = {
    read: async () => JSON.parse(await fs.readFile(sourceFile, 'utf8')),
    save: forbiddenWrite('notebookSave'),
  };
  const images = {
    list: async () => [imageInfo],
    read: async name => { assert.equal(name, filename); return { buffer: image, mime: 'image/png', size: image.length }; },
    save: forbiddenWrite('imageSave'),
  };
  const localState = {
    read: () => state.read(),
    savePreference: body => { calls.preferenceSave++; return state.savePreference(body); },
    saveDraft: forbiddenWrite('draftSave'),
    exportFile: forbiddenWrite('exportFile'),
    deleteDraft: forbiddenWrite('draftDelete'),
  };
  const { server } = createAppServer({ readOnly: true, dataDir: previewDir, store, images, localState });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }));
  const port = server.address().port;
  const notebook = await request(port, '/api/notebook');
  assert.equal(notebook.status, 200);
  assert.equal(notebook.headers['x-notes-read-only'], '1');
  assert.deepEqual(JSON.parse(notebook.text), fixture());
  const health = await request(port, '/api/health');
  assert.equal(health.status, 200); assert.equal(health.headers['x-notes-read-only'], '1');
  assert.equal(JSON.parse(health.text).app, 'local-learning-notes');
  const listed = await request(port, '/api/images');
  assert.equal(listed.status, 200); assert.deepEqual(JSON.parse(listed.text), { images: [imageInfo] });
  const loaded = await request(port, `/images/${filename}`);
  assert.equal(loaded.status, 200); assert.equal(loaded.headers['content-type'], 'image/png');
  assert.equal(loaded.headers['content-length'], String(image.length)); assert.equal(loaded.headers['x-notes-read-only'], '1');
  const imageHead = await request(port, `/images/${filename}`, { method: 'HEAD' });
  assert.equal(imageHead.status, 200); assert.equal(imageHead.text, ''); assert.equal(imageHead.headers['x-notes-read-only'], '1');
  const initial = await request(port, '/api/local-state');
  assert.equal(initial.status, 200); assert.deepEqual(JSON.parse(initial.text), { preferences: {}, drafts: [] });

  const blocked = [
    ['/api/notebook', 'POST', JSON.stringify({ notebook: fixture(), baseRevision: 0 })],
    ['/api/drafts', 'POST', JSON.stringify({ id: 'preview_draft', draft: { data: fixture(), changedAt: stamp } })],
    ['/api/images', 'POST', image, 'image/png'],
    ['/api/exports', 'POST', JSON.stringify({ filename: 'preview.json', content: '{}', format: 'json' })],
    ['/api/drafts/preview_draft', 'DELETE'],
    ['/api/notebook', 'PUT', '{}'],
    ['/api/preferences', 'PATCH', '{}'],
    [`/images/${filename}`, 'DELETE'],
    ['/api/health', 'OPTIONS'],
    ['/api/unknown-write', 'POST', '{not valid JSON'],
  ];
  for (const [url, method, body, type = 'application/json'] of blocked) {
    const result = await request(port, url, { method, headers: { 'Content-Type': type }, body });
    assert.equal(result.status, 403, `${method} ${url} is rejected before a storage write`);
    assert.equal(result.headers['x-notes-read-only'], '1');
  }
  assert.deepEqual(calls, { notebookSave: 0, imageSave: 0, draftSave: 0, exportFile: 0, draftDelete: 0, preferenceSave: 0 });

  const preference = { key: 'notes-pane-layout-v1', value: JSON.stringify({ version: 1, sidebarWidth: 240, headerHeight: null }) };
  const saved = await request(port, '/api/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preference) });
  assert.equal(saved.status, 200); assert.equal(saved.headers['x-notes-read-only'], '1');
  assert.equal(calls.preferenceSave, 1);
  const persisted = JSON.parse(await fs.readFile(path.join(previewDir, 'preferences.json'), 'utf8'));
  assert.equal(persisted[preference.key], preference.value, 'Only the isolated preview state directory stores layout preferences');
  assert.equal((await request(port, '/api/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify(preference) })).status, 403);
  assert.equal(calls.preferenceSave, 1, 'Read-only preference exceptions still enforce same-origin access');
  assert.equal(await fs.readFile(sourceFile, 'utf8'), original, 'The synthetic source notebook remains byte-for-byte unchanged');
  assert.deepEqual(JSON.parse((await request(port, '/api/notebook')).text), fixture());
  assert.deepEqual((await state.read()).drafts, []);
  assert.deepEqual(await fs.readdir(sourceDir), ['notebook.json']);
  assert.deepEqual((await fs.readdir(previewDir)).sort(), ['drafts', 'preferences.json']);
});
