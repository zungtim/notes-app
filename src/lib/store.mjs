import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const NOTE_TYPES = new Set(['concept', 'question', 'insight', 'paper', 'method']);
export const NOTE_STATUSES = new Set(['inbox', 'learning', 'understood', 'review']);
export const SOURCE_TYPES = new Set(['conversation', 'paper', 'thought', 'web', 'other']);
export const LINK_TYPES = new Set(['sequence', 'parallel', 'branch', 'extends', 'prerequisite', 'evidence', 'contradicts', 'applies']);

export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; this.statusCode = 400; }
}

export class ConflictError extends Error {
  constructor(notebook) {
    super('笔记已在另一个窗口中更新，请读取最新版本后再保存。');
    this.name = 'ConflictError'; this.statusCode = 409; this.notebook = notebook;
  }
}

const fail = (at, message) => { throw new ValidationError(`${at}: ${message}`); };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function object(value, at, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(at, '应为对象');
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${at}.${key}`, '未知字段');
}

function string(value, at, max, { empty = false } = {}) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(at, `应为${empty ? '可空' : '非空'}字符串，长度不超过${max}`);
}

function id(value, at) {
  string(value, at, 100);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) fail(at, '标识符只允许字母、数字、下划线和连字符');
}

function date(value, at) {
  string(value, at, 50);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) fail(at, '应为ISO日期时间');
}

function array(value, at, max) {
  if (!Array.isArray(value) || value.length > max) fail(at, `应为数组，数量不超过${max}`);
}

function enumeration(value, at, allowed) {
  if (!allowed.has(value)) fail(at, '不支持的类型或状态');
}

function optionalString(value, key, at, max) {
  if (own(value, key)) string(value[key], `${at}.${key}`, max, { empty: true });
}

function source(value, at) {
  object(value, at, ['id', 'type', 'title', 'url', 'excerpt']);
  id(value.id, `${at}.id`);
  enumeration(value.type, `${at}.type`, SOURCE_TYPES);
  string(value.title, `${at}.title`, 500);
  optionalString(value, 'url', at, 4000);
  optionalString(value, 'excerpt', at, 60000);
}

/** Validate the complete document before any write, including references. */
export function validateNotebook(value) {
  object(value, 'notebook', ['version', 'revision', 'topics', 'notes', 'links']);
  if (value.version !== 1) fail('notebook.version', '仅支持版本1');
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) fail('notebook.revision', '应为非负安全整数');
  array(value.topics, 'notebook.topics', 250);
  array(value.notes, 'notebook.notes', 5000);
  array(value.links, 'notebook.links', 15000);
  const topics = new Set();
  const notes = new Map();
  const links = new Set();

  value.topics.forEach((topic, i) => {
    const at = `topics[${i}]`;
    object(topic, at, ['id', 'title', 'description', 'color', 'createdAt']);
    id(topic.id, `${at}.id`);
    if (topics.has(topic.id)) fail(`${at}.id`, '重复的主题标识符');
    topics.add(topic.id);
    string(topic.title, `${at}.title`, 300);
    optionalString(topic, 'description', at, 4000);
    if (own(topic, 'color')) {
      string(topic.color, `${at}.color`, 7);
      if (!/^#[0-9a-f]{6}$/i.test(topic.color)) fail(`${at}.color`, '应为六位十六进制颜色');
    }
    date(topic.createdAt, `${at}.createdAt`);
  });

  value.notes.forEach((note, i) => {
    const at = `notes[${i}]`;
    object(note, at, ['id', 'topicId', 'title', 'content', 'type', 'status', 'tags', 'sources', 'createdAt', 'updatedAt', 'position']);
    id(note.id, `${at}.id`);
    if (notes.has(note.id)) fail(`${at}.id`, '重复的笔记标识符');
    id(note.topicId, `${at}.topicId`);
    if (!topics.has(note.topicId)) fail(`${at}.topicId`, '主题不存在');
    string(note.title, `${at}.title`, 300);
    string(note.content, `${at}.content`, 120000, { empty: true });
    enumeration(note.type, `${at}.type`, NOTE_TYPES);
    enumeration(note.status, `${at}.status`, NOTE_STATUSES);
    array(note.tags, `${at}.tags`, 50);
    note.tags.forEach((tag, j) => string(tag, `${at}.tags[${j}]`, 100));
    if (new Set(note.tags).size !== note.tags.length) fail(`${at}.tags`, '标签不能重复');
    array(note.sources, `${at}.sources`, 100);
    const sourceIds = new Set();
    note.sources.forEach((entry, j) => {
      source(entry, `${at}.sources[${j}]`);
      if (sourceIds.has(entry.id)) fail(`${at}.sources[${j}].id`, '重复的来源标识符');
      sourceIds.add(entry.id);
    });
    date(note.createdAt, `${at}.createdAt`);
    date(note.updatedAt, `${at}.updatedAt`);
    if (own(note, 'position')) {
      object(note.position, `${at}.position`, ['x', 'y']);
      for (const axis of ['x', 'y']) if (!Number.isFinite(note.position[axis]) || Math.abs(note.position[axis]) > 1000000) fail(`${at}.position.${axis}`, '应为有限坐标，绝对值不超过1000000');
    }
    notes.set(note.id, note);
  });

  value.links.forEach((link, i) => {
    const at = `links[${i}]`;
    object(link, at, ['id', 'topicId', 'from', 'to', 'type', 'label']);
    id(link.id, `${at}.id`);
    if (links.has(link.id)) fail(`${at}.id`, '重复的关系标识符');
    links.add(link.id);
    id(link.topicId, `${at}.topicId`);
    if (!topics.has(link.topicId)) fail(`${at}.topicId`, '主题不存在');
    id(link.from, `${at}.from`); id(link.to, `${at}.to`);
    if (link.from === link.to) fail(at, '不允许自连接');
    const from = notes.get(link.from), to = notes.get(link.to);
    if (!from || !to) fail(at, '关系指向了不存在的笔记');
    if (from.topicId !== link.topicId || to.topicId !== link.topicId) fail(at, '关系不能跨主题');
    enumeration(link.type, `${at}.type`, LINK_TYPES);
    optionalString(link, 'label', at, 500);
  });
  return value;
}

const clone = value => JSON.parse(JSON.stringify(value));
const emptyNotebook = () => ({ version: 1, revision: 0, topics: [], notes: [], links: [] });

/** Saves are serialized and atomic. Ten named backup slots are overwritten in rotation. */
export class NotebookStore {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir);
    this.file = path.join(this.dataDir, 'notebook.json');
    this.ready = null;
    this.queue = Promise.resolve();
    this.current = null;
  }

  async initialize() {
    if (!this.ready) this.ready = this.#initialize();
    return this.ready;
  }

  async #initialize() {
    await fs.mkdir(this.dataDir, { recursive: true });
    try {
      this.current = validateNotebook(JSON.parse(await fs.readFile(this.file, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      let initial;
      try { initial = JSON.parse(await fs.readFile(path.join(this.dataDir, 'seed.json'), 'utf8')); }
      catch (seedError) { if (seedError.code !== 'ENOENT') throw seedError; initial = emptyNotebook(); }
      validateNotebook(initial);
      initial.revision = 0;
      await this.#atomicWrite(initial);
      this.current = initial;
    }
    return clone(this.current);
  }

  async read() {
    await this.initialize();
    await this.queue;
    return clone(this.current);
  }

  async save(notebook, baseRevision) {
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) throw new ValidationError('baseRevision应为非负安全整数');
    validateNotebook(notebook);
    if (notebook.revision !== baseRevision) throw new ValidationError('notebook.revision必须与baseRevision一致');
    const incoming = clone(notebook);
    await this.initialize();
    const task = this.queue.then(async () => {
      if (baseRevision !== this.current.revision) throw new ConflictError(clone(this.current));
      if (this.current.revision >= Number.MAX_SAFE_INTEGER) throw new ValidationError('笔记版本号已达到上限');
      incoming.revision = this.current.revision + 1;
      const backups = path.join(this.dataDir, 'backups');
      await fs.mkdir(backups, { recursive: true });
      const slot = String(this.current.revision % 10).padStart(2, '0');
      await fs.copyFile(this.file, path.join(backups, `notebook-${slot}.json`));
      await this.#atomicWrite(incoming);
      this.current = incoming;
      return clone(this.current);
    });
    this.queue = task.catch(() => {});
    return task;
  }

  async #atomicWrite(notebook) {
    const temporary = path.join(this.dataDir, `.notebook-${randomUUID()}.tmp`);
    const handle = await fs.open(temporary, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(notebook, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    await fs.rename(temporary, this.file);
  }
}
