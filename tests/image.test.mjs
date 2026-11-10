import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { APP_ROOT, createAppServer } from '../src/server.mjs';
import { ImageStore, inspectImage, MAX_IMAGE_BYTES } from '../src/lib/images.mjs';

// Real 2 × 3 pixel fixtures encoded by Pillow, not synthetic format headers.
const fixtures = [
  { mime: 'image/png', ext: 'png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGNULstmYGBgYgADKAUAE1gBCu14UxIAAAAASUVORK5CYII=' },
  { mime: 'image/jpeg', ext: 'jpg', base64: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDm6KKK6D5s/9k=' },
  { mime: 'image/gif', ext: 'gif', base64: 'R0lGODdhAgADAIEAACN2awAAAAAAAAAAACwAAAAAAgADAAAIBgABCBwYEAA7' },
  { mime: 'image/webp', ext: 'webp', base64: 'UklGRjQAAABXRUJQVlA4ICgAAABwAQCdASoCAAMAAUAmJaACdAFAAAD+7/2+tJpF5/+YJ/7/f9/vJcAA' }
].map(f => ({ ...f, buffer: Buffer.from(f.base64, 'base64') }));

async function workspace() {
  const root = process.env.NOTES_TEST_ARTIFACTS || path.join(APP_ROOT, '.dev-workspace', 'test-artifacts');
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, 'images-'));
}

function request(port, url, { method = 'GET', headers = {}, body, chunked = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks), json: () => JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    if (chunked) { req.write(body.subarray(0, body.length - 1)); req.end(body.subarray(body.length - 1)); }
    else req.end(body);
  });
}

test('real raster files detect correct formats and dimensions; invalid headers and MIME reject', () => {
  for (const f of fixtures) assert.deepEqual(inspectImage(f.buffer, f.mime), { ext: f.ext, mime: f.mime, width: 2, height: 3, size: f.buffer.length });
  const png = fixtures[0].buffer;
  assert.throws(() => inspectImage(png, 'image/jpeg'), /不一致/);
  assert.throws(() => inspectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml'), /仅支持/);
  assert.throws(() => inspectImage(Buffer.from('not a PNG'), 'image/png'), /格式不符/);
  assert.throws(() => inspectImage(png.subarray(0, png.length - 1), 'image/png'), /不完整/);
  const huge = Buffer.from(png); huge.writeUInt32BE(50000, 16); huge.writeUInt32BE(50000, 20);
  assert.throws(() => inspectImage(huge, 'image/png'), /尺寸无效或过大/);
  assert.throws(() => inspectImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'image/png'), error => error.statusCode === 413);
});

test('image files persist by SHA256, deduplicate bytes without rewrite and remain readable after restart', async () => {
  const root = await workspace(), store = new ImageStore(root), png = fixtures[0];
  const first = await store.save(png.buffer, png.mime, encodeURIComponent('D:\\资料\\分子束图.png'));
  const expected = createHash('sha256').update(png.buffer).digest('hex');
  assert.equal(first.id, expected); assert.equal(first.name, '分子束图.png');
  const file = path.join(root, 'images', `${expected}.png`), before = await fs.stat(file);
  const second = await store.save(png.buffer, png.mime, encodeURIComponent('another.png'));
  assert.equal(second.url, first.url); assert.equal(second.name, 'another.png');
  assert.equal((await fs.stat(file)).mtimeMs, before.mtimeMs);
  assert.deepEqual(await fs.readdir(path.join(root, 'images')), [`${expected}.png`]);
  const restarted = new ImageStore(root), read = await restarted.read(`${expected}.png`);
  assert.deepEqual(read.buffer, png.buffer);
  assert.equal((await restarted.list()).length, 1);
  await assert.rejects(restarted.read('../notebook.json'), /无效的图片地址/);
  await fs.writeFile(file, fixtures[1].buffer);
  await assert.rejects(restarted.read(`${expected}.png`), /不一致/);
});

test('HTTP uploads all formats, serves exact bytes and HEAD metadata, blocks traversal, unsafe origin and oversized streams', async t => {
  const root = await workspace(), dataDir = path.join(root, 'data'), publicDir = path.join(root, 'public');
  await fs.mkdir(publicDir); await fs.writeFile(path.join(publicDir, 'index.html'), '<!doctype html><p>Images</p>');
  const { server } = createAppServer({ dataDir, publicDir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port, uploads = [];
  for (const fixture of fixtures) {
    const response = await request(port, '/api/images', { method: 'POST', headers: { 'Content-Type': fixture.mime, 'X-Image-Name': encodeURIComponent(`论文.${fixture.ext}`) }, body: fixture.buffer });
    assert.equal(response.status, 201); const meta = response.json(); uploads.push(meta);
    assert.equal(meta.name, `论文.${fixture.ext}`); assert.equal(meta.width, 2); assert.equal(meta.height, 3);
    const served = await request(port, meta.url);
    assert.equal(served.status, 200); assert.deepEqual(served.buffer, fixture.buffer); assert.equal(served.headers['content-type'], fixture.mime);
    const head = await request(port, meta.url, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(Number(head.headers['content-length']), fixture.buffer.length); assert.equal(head.buffer.length, 0);
  }
  const reupload = await request(port, '/api/images', { method: 'POST', headers: { 'Content-Type': fixtures[0].mime }, body: fixtures[0].buffer });
  assert.equal(reupload.json().url, uploads[0].url);
  assert.equal((await request(port, '/api/images')).json().images.length, 4);
  assert.equal((await request(port, '/api/images', { method: 'POST', headers: { 'Content-Type': 'image/png', Origin: 'https://evil.example' }, body: fixtures[0].buffer })).status, 403);
  assert.equal((await request(port, '/api/images', { method: 'POST', headers: { 'Content-Type': 'image/svg+xml' }, body: '<svg/>' })).status, 400);
  assert.equal((await request(port, '/api/images', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: '<svg/>' })).status, 400);
  assert.equal((await request(port, '/api/images', { method: 'POST', headers: { 'Content-Type': 'image/png', 'Content-Length': String(MAX_IMAGE_BYTES + 1) } })).status, 413);
  assert.equal((await request(port, '/api/images', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.alloc(MAX_IMAGE_BYTES + 1), chunked: true })).status, 413);
  assert.equal((await request(port, '/images/%2e%2e/notebook.json')).status, 403);
  assert.equal((await request(port, '/images/'+ 'a'.repeat(64)+'.png')).status, 404);
  assert.equal((await request(port, '/data/images/' + uploads[0].url.split('/').pop())).status, 404);
  assert.equal((await request(port, '/images/' + uploads[0].url.split('/').pop() + '/anything')).status, 404);
  assert.equal((await request(port, uploads[0].url, { method: 'POST', body: 'x' })).status, 405);
});
