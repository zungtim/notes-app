import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NotebookStore, ValidationError, ConflictError } from './lib/store.mjs';
import { ImageStore, MAX_IMAGE_BYTES, IMAGE_FILE_RE } from './lib/images.mjs';
import { LocalStateStore, MAX_DRAFT_BYTES, MAX_EXPORT_BODY_BYTES, MAX_PREFERENCE_BODY_BYTES } from './lib/local-state.mjs';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_NOTEBOOK_BODY_BYTES = 64 * 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sameOrigin(req) {
  const host = req.headers.host;
  const port = req.socket.localPort;
  const validHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (port === 80) { validHosts.add('127.0.0.1'); validHosts.add('localhost'); validHosts.add('[::1]'); }
  if (!validHosts.has(host)) return false;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    try { if (new URL(origin).origin !== new URL(`http://${host}`).origin) return false; }
    catch { return false; }
  }
  return !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']);
}

async function readJSON(req, limit = MAX_NOTEBOOK_BODY_BYTES, limitMessage = '笔记文件超过64MB限制') {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new ValidationError('请求Content-Type必须为application/json');
  const declared = Number(req.headers['content-length']);
  if (declared > limit) { const error = new Error(limitMessage); error.statusCode = 413; throw error; }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) { const error = new Error(limitMessage); error.statusCode = 413; throw error; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ValidationError('请求不是有效的JSON'); }
}

async function readImage(req) {
  if (!/^image\/(?:png|jpeg|gif|webp)(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new ValidationError('仅支持PNG、JPEG、GIF、WebP图片。');
  if (Number(req.headers['content-length']) > MAX_IMAGE_BYTES) { const error = new Error('单张图片不能超过10MB。'); error.statusCode = 413; throw error; }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const clean = () => { req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onAborted); };
    const onError = error => { clean(); reject(error); };
    const onAborted = () => onError(new ValidationError('图片上传被中断。'));
    const onEnd = () => { clean(); resolve(Buffer.concat(chunks)); };
    const onData = chunk => {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) { const error = new Error('单张图片不能超过10MB。'); error.statusCode = 413; clean(); req.resume(); reject(error); return; }
      chunks.push(chunk);
    };
    req.on('data', onData); req.once('end', onEnd); req.once('error', onError); req.once('aborted', onAborted);
  });
}

export function createAppServer({ dataDir = path.join(APP_ROOT, 'data'), publicDir = path.join(APP_ROOT, 'src', 'public'), store = new NotebookStore(dataDir), images = new ImageStore(dataDir), localState = new LocalStateStore(dataDir), readOnly = false } = {}) {
  const publicRoot = path.resolve(publicDir);
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (readOnly) res.setHeader('X-Notes-Read-Only', '1');
    try {
      if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden', message: '只允许通过本机同源访问。' });
      const rawPath = (req.url ?? '/').split('?')[0];
      let pathname;
      try { pathname = decodeURIComponent(rawPath); }
      catch { return json(res, 400, { error: 'bad_request', message: '无效的路径编码。' }); }
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').includes('..')) return json(res, 403, { error: 'forbidden', message: '禁止访问该路径。' });
      // A personal-library preview has a separate preference directory. Never
      // invoke notebook, image, draft or export writers while it is read-only.
      if (readOnly && !['GET', 'HEAD'].includes(req.method)
        && !(req.method === 'POST' && pathname === '/api/preferences')) {
        return json(res, 403, { error: 'read_only', message: '当前为原笔记的只读预览，正式笔记不会被修改。' });
      }
      if (pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, version: 1, app: 'local-learning-notes', root: APP_ROOT });
      if (pathname === '/api/local-state') {
        if (req.method === 'GET') return json(res, 200, await localState.read());
        res.setHeader('Allow', 'GET');
        return json(res, 405, { error: 'method_not_allowed', message: '本地状态只支持读取。' });
      }
      if (pathname === '/api/preferences') {
        if (req.method === 'POST') return json(res, 200, await localState.savePreference(await readJSON(req, MAX_PREFERENCE_BODY_BYTES, '界面偏好请求超过大小限制。')));
        res.setHeader('Allow', 'POST');
        return json(res, 405, { error: 'method_not_allowed', message: '界面偏好只支持保存。' });
      }
      if (pathname === '/api/drafts') {
        if (req.method === 'POST') return json(res, 200, await localState.saveDraft(await readJSON(req, MAX_DRAFT_BYTES, '草稿请求超过64MiB限制。')));
        res.setHeader('Allow', 'POST');
        return json(res, 405, { error: 'method_not_allowed', message: '草稿只支持保存。' });
      }
      if (pathname.startsWith('/api/drafts/')) {
        if (req.method === 'DELETE') return json(res, 200, await localState.deleteDraft(pathname.slice('/api/drafts/'.length)));
        res.setHeader('Allow', 'DELETE');
        return json(res, 405, { error: 'method_not_allowed', message: '单份草稿只支持删除。' });
      }
      if (pathname === '/api/exports') {
        if (req.method === 'POST') return json(res, 201, await localState.exportFile(await readJSON(req, MAX_EXPORT_BODY_BYTES, '导出请求超过大小限制。')));
        res.setHeader('Allow', 'POST');
        return json(res, 405, { error: 'method_not_allowed', message: '导出只支持保存到本地文件。' });
      }
      if (pathname === '/api/images') {
        if (req.method === 'GET') return json(res, 200, { images: await images.list() });
        if (req.method === 'POST') return json(res, 201, await images.save(await readImage(req), req.headers['content-type'], req.headers['x-image-name']));
        res.setHeader('Allow', 'GET, POST');
        return json(res, 405, { error: 'method_not_allowed', message: '不支持此请求方式。' });
      }
      if (pathname.startsWith('/images/')) {
        if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return json(res, 405, { error: 'method_not_allowed', message: '不支持此请求方式。' }); }
        const filename = pathname.slice('/images/'.length);
        if (!IMAGE_FILE_RE.test(filename)) return json(res, 404, { error: 'not_found', message: '图片不存在。' });
        try {
          const image = await images.read(filename);
          res.writeHead(200, { 'Content-Type': image.mime, 'Content-Length': image.size, 'Cache-Control': 'no-store' });
          return res.end(req.method === 'HEAD' ? undefined : image.buffer);
        } catch (error) {
          if (error.code === 'ENOENT') return json(res, 404, { error: 'not_found', message: '图片不存在。' });
          throw error;
        }
      }
      if (pathname === '/api/notebook') {
        if (req.method === 'GET') return json(res, 200, await store.read());
        if (req.method === 'POST') {
          const body = await readJSON(req);
          if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['notebook', 'baseRevision'].includes(key))) throw new ValidationError('请求必须为{notebook,baseRevision}');
          return json(res, 200, await store.save(body.notebook, body.baseRevision));
        }
        res.setHeader('Allow', 'GET, POST');
        return json(res, 405, { error: 'method_not_allowed', message: '不支持此请求方式。' });
      }
      if (pathname.startsWith('/api/') || pathname === '/data' || pathname.startsWith('/data/') || pathname.startsWith('/.')) return json(res, 404, { error: 'not_found', message: '页面不存在。' });
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'method_not_allowed', message: '不支持此请求方式。' });
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      let file = path.resolve(publicRoot, relative);
      if (file !== publicRoot && !file.startsWith(`${publicRoot}${path.sep}`)) return json(res, 403, { error: 'forbidden', message: '禁止访问该路径。' });
      try {
        const stat = await fs.stat(file);
        if (!stat.isFile()) return json(res, 404, { error: 'not_found', message: '文件不存在。' });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (path.extname(relative)) return json(res, 404, { error: 'not_found', message: '文件不存在。' });
        file = path.join(publicRoot, 'index.html');
      }
      const real = await fs.realpath(file);
      const realPublic = await fs.realpath(publicRoot);
      if (!real.startsWith(`${realPublic}${path.sep}`)) return json(res, 403, { error: 'forbidden', message: '禁止访问该路径。' });
      const buffer = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': buffer.length });
      res.end(req.method === 'HEAD' ? undefined : buffer);
    } catch (error) {
      if (res.writableEnded) return;
      if (error instanceof ConflictError) return json(res, 409, { error: 'conflict', message: error.message, notebook: error.notebook });
      const status = error.statusCode ?? 500;
      if (status === 413) { res.setHeader('Connection', 'close'); req.resume(); }
      if (status >= 500) console.error('Notebook request failed:', error);
      return json(res, status, { error: status >= 500 ? 'storage_error' : 'bad_request', message: status >= 500 ? '本地文件读写失败，请检查数据目录及终端信息。' : error.message });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return { server, store, images, localState };
}

export async function startServer() {
  const requestedPort = process.env.PORT ?? '4317';
  if (!/^\d+$/.test(requestedPort) || Number(requestedPort) < 1 || Number(requestedPort) > 65535) throw new Error('PORT必须是1至65535之间的端口号');
  const { server, store } = createAppServer();
  await store.initialize();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(requestedPort), '127.0.0.1', resolve); });
  console.log(`学习笔记已启动：http://127.0.0.1:${requestedPort}`);
  console.log(`数据保存于：${path.join(APP_ROOT, 'data', 'notebook.json')}`);
  return server;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  startServer().catch(error => { console.error(`启动失败：${error.message}`); process.exitCode = 1; });
}
