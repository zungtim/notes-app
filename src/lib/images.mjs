import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ValidationError } from './store.mjs';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_FILE_RE = /^([a-f0-9]{64})\.(png|jpg|gif|webp)$/;
const MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const fail = message => { throw new ValidationError(message); };

/** Infer format from bytes, then validate its header and dimensions before storing it. */
export function inspectImage(buffer, declaredMime) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) fail('图片内容为空。');
  if (buffer.length > MAX_IMAGE_BYTES) { const error = new Error('单张图片不能超过10MB。'); error.statusCode = 413; throw error; }
  let ext, width, height;
  if (buffer.length >= 33 && buffer.subarray(0, 8).equals(PNG)) {
    ext = 'png';
    if (buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') fail('PNG图片头无效。');
    width = buffer.readUInt32BE(16); height = buffer.readUInt32BE(20);
    let offset = 8, ended = false, data = false;
    while (offset + 12 <= buffer.length) {
      const size = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8);
      if (size > buffer.length - offset - 12) fail('PNG图片内容不完整。');
      if (type === 'IDAT') data = true;
      offset += size + 12;
      if (type === 'IEND') { ended = size === 0 && offset === buffer.length; break; }
    }
    if (!ended || !data) fail('PNG图片内容不完整。');
  } else if (buffer.length >= 14 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) {
    ext = 'gif'; width = buffer.readUInt16LE(6); height = buffer.readUInt16LE(8);
    if (buffer[buffer.length - 1] !== 0x3b) fail('GIF图片内容不完整。');
  } else if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    ext = 'jpg';
    if (buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) fail('JPEG图片内容不完整。');
    let offset = 2;
    const frames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset < buffer.length - 2) {
      if (buffer[offset] !== 0xff) fail('JPEG图片段无效。');
      while (buffer[offset] === 0xff) offset++;
      const marker = buffer[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > buffer.length) fail('JPEG图片内容不完整。');
      const size = buffer.readUInt16BE(offset);
      if (size < 2 || size > buffer.length - offset) fail('JPEG图片段长度无效。');
      if (frames.has(marker)) {
        if (size < 8) fail('JPEG图片尺寸信息无效。');
        height = buffer.readUInt16BE(offset + 3); width = buffer.readUInt16BE(offset + 5); break;
      }
      offset += size;
    }
  } else if (buffer.length >= 20 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    ext = 'webp';
    if (buffer.readUInt32LE(4) + 8 !== buffer.length) fail('WebP图片内容不完整。');
    const kind = buffer.toString('ascii', 12, 16), size = buffer.readUInt32LE(16);
    if (size > buffer.length - 20) fail('WebP图片段长度无效。');
    if (kind === 'VP8X' && size >= 10 && buffer.length >= 30) {
      width = buffer.readUIntLE(24, 3) + 1; height = buffer.readUIntLE(27, 3) + 1;
    } else if (kind === 'VP8L' && size >= 5 && buffer.length >= 25 && buffer[20] === 0x2f) {
      const bits = buffer.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (kind === 'VP8 ' && size >= 10 && buffer.length >= 30 && buffer.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      width = buffer.readUInt16LE(26) & 0x3fff; height = buffer.readUInt16LE(28) & 0x3fff;
    }
  } else fail('仅支持PNG、JPEG、GIF、WebP图片，文件内容与图片格式不符。');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 65535 || height > 65535 || width * height > 100000000) fail('图片尺寸无效或过大，请先缩小图片。');
  const mime = MIME[ext], given = String(declaredMime ?? '').split(';')[0].trim().toLowerCase();
  if (given !== mime) fail('图片Content-Type与实际文件格式不一致。');
  return { ext, mime, width, height, size: buffer.length };
}

function imageName(value, fallback) {
  if (typeof value !== 'string') return fallback;
  let name;
  try { name = decodeURIComponent(value); } catch { name = value; }
  return name.replace(/[\u0000-\u001f\u007f]/g, '').split(/[\\/]/).pop().slice(0, 250).trim() || fallback;
}

/** Content-addressed, immutable image files. Re-uploading bytes reuses the same file. */
export class ImageStore {
  constructor(dataDir) { this.dir = path.resolve(dataDir, 'images'); this.queue = Promise.resolve(); }

  async #directory() {
    await fs.mkdir(this.dir, { recursive: true });
    const actual = await fs.realpath(this.dir);
    if (path.normalize(actual).toLowerCase() !== path.normalize(this.dir).toLowerCase()) fail('图片目录不能指向其他位置。');
    return actual;
  }

  async save(buffer, mime, name) {
    const info = inspectImage(buffer, mime);
    const id = createHash('sha256').update(buffer).digest('hex'), filename = `${id}.${info.ext}`;
    const task = this.queue.then(async () => {
      await this.#directory();
      const target = path.join(this.dir, filename);
      try {
        const stored = await this.read(filename);
        if (!stored.buffer.equals(buffer)) throw new Error('已存图片与其内容标识不一致。');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const temporary = path.join(this.dir, `.upload-${randomUUID()}.tmp`);
        const handle = await fs.open(temporary, 'wx');
        try { await handle.writeFile(buffer); await handle.sync(); } finally { await handle.close(); }
        await fs.rename(temporary, target);
      }
      return { id, name: imageName(name, filename), url: `/images/${filename}`, mime: info.mime, size: info.size, width: info.width, height: info.height };
    });
    this.queue = task.catch(() => {});
    return task;
  }

  async read(filename) {
    if (!IMAGE_FILE_RE.test(filename)) fail('无效的图片地址。');
    const root = await this.#directory(), file = path.join(root, filename);
    const actual = await fs.realpath(file);
    if (path.normalize(actual).toLowerCase() !== path.normalize(file).toLowerCase()) fail('图片不能指向其他文件。');
    const stat = await fs.stat(actual);
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) fail('图片文件无效。');
    const buffer = await fs.readFile(actual), ext = path.extname(filename).slice(1);
    const info = inspectImage(buffer, MIME[ext]);
    if (createHash('sha256').update(buffer).digest('hex') !== filename.slice(0, 64)) fail('图片文件内容已损坏。');
    return { buffer, mime: info.mime, size: info.size, width: info.width, height: info.height };
  }

  async list() {
    await this.#directory();
    await this.queue;
    const names = (await fs.readdir(this.dir)).filter(name => IMAGE_FILE_RE.test(name)).sort();
    const images = [];
    for (const name of names) {
      const { mime, size, width, height } = await this.read(name);
      images.push({ id: name.slice(0, 64), name, url: `/images/${name}`, mime, size, width, height });
    }
    return images;
  }
}
