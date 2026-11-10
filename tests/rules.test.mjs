import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { APP_ROOT, createAppServer } from '../src/server.mjs';

async function isolatedServer(t) {
  const root = process.env.NOTES_TEST_ARTIFACTS || path.join(APP_ROOT, '.dev-workspace', 'test-artifacts');
  await fs.mkdir(root, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(root, 'rules-'));
  const { server } = createAppServer({ dataDir });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeIdleConnections();
  }));
  const url = 'http://127.0.0.1:' + server.address().port;
  return { dataDir, request: (route, init) => fetch(url + route, init) };
}

test('a source-only installation serves assets without creating assistant rules', async t => {
  const { dataDir, request } = await isolatedServer(t);
  const notebook = await (await request('/api/notebook')).json();
  assert.deepEqual(notebook, { version: 1, revision: 0, topics: [], notes: [], links: [] });
  for (const route of ['/', '/app.js', '/styles.css', '/favicon.svg']) {
    assert.equal((await request(route)).status, 200, route);
  }
  const html = await (await request('/')).text();
  assert.ok(!html.includes('rules-button'));
  assert.equal((await request('/api/recording-rules')).status, 404);
  await assert.rejects(fs.access(path.join(dataDir, '记录约定.md')), { code: 'ENOENT' });
});

test('legacy assistant files cannot be read or replaced through the app', async t => {
  const { dataDir, request } = await isolatedServer(t);
  const personalRules = '# Synthetic assistant instructions\nPrivate test fixture.';
  const rulesPath = path.join(dataDir, '记录约定.md');
  await fs.writeFile(rulesPath, personalRules);
  for (const route of ['/api/recording-rules', '/data/记录约定.md', '/记录约定.md', '/config/recording-rules.md']) {
    const response = await request(route);
    assert.equal(response.status, 404, route);
    assert.ok(!(await response.text()).includes(personalRules));
  }
  assert.equal((await request('/api/recording-rules', { method: 'POST', body: 'replacement' })).status, 404);
  assert.equal(await fs.readFile(rulesPath, 'utf8'), personalRules);
  assert.equal((await (await request('/api/notebook')).json()).revision, 0);
});

test('repeated retired endpoint reads never recreate rule files', async t => {
  const { dataDir, request } = await isolatedServer(t);
  for (let i = 0; i < 3; i++) assert.equal((await request('/api/recording-rules')).status, 404);
  await assert.rejects(fs.access(path.join(dataDir, '记录约定.md')), { code: 'ENOENT' });
});
