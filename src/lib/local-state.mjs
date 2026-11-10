import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ValidationError, validateNotebook } from './store.mjs';

export const MAX_DRAFT_BYTES = 64 * 1024 * 1024;
export const MAX_JSON_EXPORT_BYTES = 256 * 1024 * 1024;
export const MAX_MARKDOWN_EXPORT_BYTES = 16 * 1024 * 1024;
// An exported JSON document is itself a string inside the HTTP JSON envelope.
export const MAX_EXPORT_BODY_BYTES = 2 * MAX_JSON_EXPORT_BYTES + 64 * 1024;
// A graph snapshot is encoded as a JSON string inside the preference request.
export const MAX_GRAPH_VIEW_PREFERENCE_BYTES = 1024 * 1024;
export const MAX_PREFERENCE_BODY_BYTES = 2 * MAX_GRAPH_VIEW_PREFERENCE_BYTES + 4096;
const MAX_PREFERENCES_BYTES = 8 * 1024 * 1024;
const GRAPH_VIEW_KEY = /^notes-graph-(?:view|context)-[A-Za-z0-9_-]{1,220}$/;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const clone = value => JSON.parse(JSON.stringify(value));
const invalid = message => { throw new ValidationError(message); };
const tooLarge = message => { const error = new ValidationError(message); error.statusCode = 413; throw error; };
const samePath = (a, b) => process.platform === 'win32' ? path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase() : path.normalize(a) === path.normalize(b);

function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid(`${label}包含无效字段。`);
}

function draftId(id) {
  if (typeof id !== 'string' || !SAFE_ID.test(id) || DEVICE_NAME.test(id)) invalid('草稿标识符只允许1至100个字母、数字、下划线和连字符，不能使用系统保留名称。');
  return id;
}

function graphViewPreference(value) {
  let view;
  try { view = JSON.parse(value); } catch { invalid('关系图视图偏好必须为有效JSON。'); }
  object(view, view?.version === 2 ? ['version', 'layout', 'positions', 'transform', 'structureKey', 'lockedIds'] : ['version', 'layout', 'positions', 'transform', 'lockedIds'], '关系图视图偏好');
  if (![1,2].includes(view.version)) invalid('关系图视图偏好仅支持版本1或2。');
  if ((view.version===1&&!['columns','branches','sequence'].includes(view.layout))||(view.version===2&&view.layout!=='clean')) invalid('关系图视图布局无效。');
  if(view.version===2&&(typeof view.structureKey!=='string'||!view.structureKey.length||view.structureKey.length>100))invalid('关系图视图缺少有效的结构标识。');
  const positions = view.positions;
  if (!positions || typeof positions !== 'object' || Array.isArray(positions)) invalid('关系图节点位置必须为对象。');
  const points = Object.entries(positions);
  if (points.length > 5000) invalid('关系图节点位置最多5000项。');
  for (const [id, point] of points) {
    if (!SAFE_ID.test(id) || UNSAFE_OBJECT_KEYS.has(id)) invalid('关系图节点位置包含无效标识符。');
    object(point, ['x', 'y'], '关系图节点位置');
    for (const axis of ['x', 'y']) {
      if (!Number.isFinite(point[axis]) || Math.abs(point[axis]) > 1000000) invalid('关系图节点位置必须为绝对值不超过1000000的有限坐标。');
    }
  }
  if (Object.hasOwn(view, 'lockedIds')) {
    if (!Array.isArray(view.lockedIds) || view.lockedIds.length > 5000
      || new Set(view.lockedIds).size !== view.lockedIds.length
      || view.lockedIds.some(id => typeof id !== 'string' || !SAFE_ID.test(id) || UNSAFE_OBJECT_KEYS.has(id) || !Object.hasOwn(positions, id))) invalid('锁定卡片必须是不重复且已在视图中的有效标识符。');
  }
  object(view.transform, ['x', 'y', 'scale'], '关系图视口');
  for (const axis of ['x', 'y']) {
    if (!Number.isFinite(view.transform[axis]) || Math.abs(view.transform[axis]) > 1000000) invalid('关系图视口必须为绝对值不超过1000000的有限坐标。');
  }
  if (!Number.isFinite(view.transform.scale) || view.transform.scale < .05 || view.transform.scale > 4) invalid('关系图视口缩放必须在0.05至4之间。');
}

function preference(key, value) {
  const graphView = typeof key === 'string' && GRAPH_VIEW_KEY.test(key);
  if (typeof key !== 'string' || (!graphView && key !== 'notes-pane-layout-v1' && !/^zhixu-layout-[A-Za-z0-9_-]{1,100}$/.test(key))) invalid('不支持该界面偏好。');
  if (typeof value !== 'string') invalid('界面偏好值必须为字符串。');
  if (graphView) {
    if (Buffer.byteLength(value) > MAX_GRAPH_VIEW_PREFERENCE_BYTES) tooLarge('关系图视图偏好超过1MiB限制。');
    graphViewPreference(value);
    return;
  }
  if (Buffer.byteLength(value) > 4096) invalid('界面偏好值必须为不超过4KB的字符串。');
  if (key.startsWith('zhixu-layout-')) {
    if (!['columns', 'branches', 'sequence'].includes(value)) invalid('关系图布局只支持columns、branches或sequence。');
  } else {
    let pane;
    try { pane = JSON.parse(value); } catch { invalid('分区偏好必须为有效JSON。'); }
    object(pane, ['version', 'sidebarWidth', 'headerHeight'], '分区偏好');
    if (pane.version !== 1) invalid('分区偏好仅支持版本1。');
    for (const key of ['sidebarWidth', 'headerHeight']) {
      if (Object.hasOwn(pane, key) && pane[key] !== null && (!Number.isFinite(pane[key]) || pane[key] < 0 || pane[key] > 2000)) invalid('分区尺寸必须为0至2000之间的有限数值或null。');
    }
  }
}

function validateDraft(draft) {
  object(draft, ['data', 'changedAt'], '草稿');
  validateNotebook(draft.data);
  if (typeof draft.changedAt !== 'string' || draft.changedAt.length > 50 || !/^\d{4}-\d{2}-\d{2}T/.test(draft.changedAt) || !Number.isFinite(Date.parse(draft.changedAt))) invalid('草稿changedAt必须为ISO日期时间。');
  return draft;
}

function exportName(filename, format) {
  if (!['json', 'markdown'].includes(format)) invalid('导出格式只支持json或markdown。');
  if (typeof filename !== 'string' || !filename.trim() || filename.length > 120 || Buffer.byteLength(filename) > 180 || /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(filename) || filename.startsWith('.') || /[. ]$/.test(filename) || DEVICE_NAME.test(filename)) invalid('导出文件名无效，不能包含目录、系统保留名称或特殊路径字符。');
  const extension = format === 'json' ? '.json' : '.md';
  if (!path.extname(filename)) return filename + extension;
  if (path.extname(filename).toLowerCase() !== extension) invalid('导出文件扩展名与格式不一致。');
  return filename;
}

/** Private app state uses one in-process write queue and stays under dataDir. */
export class LocalStateStore {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir);
    this.queue = Promise.resolve();
  }

  #enqueue(operation) {
    const task = this.queue.then(operation);
    this.queue = task.catch(() => {});
    return task;
  }

  async #directory(name = '') {
    await fs.mkdir(this.dataDir, { recursive: true });
    if (!samePath(await fs.realpath(this.dataDir), this.dataDir)) invalid('本地状态数据目录不能指向其他位置。');
    const directory = name ? path.join(this.dataDir, name) : this.dataDir;
    if (name) {
      try { await fs.mkdir(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      if (!samePath(await fs.realpath(directory), directory)) invalid('本地状态子目录不能指向其他位置。');
    }
    return directory;
  }

  async #readJSON(file, limit) {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !samePath(await fs.realpath(file), file)) invalid('本地状态文件不能指向其他文件。');
    if (stat.size > limit) tooLarge('本地状态文件超过大小限制。');
    return JSON.parse(await fs.readFile(file, 'utf8'));
  }

  async #preferences() {
    const file = path.join(await this.#directory(), 'preferences.json');
    let preferences;
    try { preferences = await this.#readJSON(file, MAX_PREFERENCES_BYTES); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return {}; }
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) invalid('已存储的界面偏好格式无效。');
    for (const [key, value] of Object.entries(preferences)) preference(key, value);
    return preferences;
  }

  async #atomicJSON(file, value, limit) {
    const content = JSON.stringify(value, null, 2) + '\n';
    if (Buffer.byteLength(content) > limit) tooLarge('本地状态超过大小限制。');
    // Never follow an existing link when replacing a private state file.
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || !samePath(await fs.realpath(file), file)) invalid('本地状态文件不能指向其他文件。');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = path.join(path.dirname(file), `.state-${randomUUID()}.tmp`);
    try {
      const handle = await fs.open(temporary, 'wx');
      try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, file);
    } catch (error) {
      try { await fs.unlink(temporary); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') console.error('Unable to remove local-state temporary file:', cleanupError); }
      throw error;
    }
  }

  async read() {
    await this.queue;
    const preferences = await this.#preferences();
    const directory = await this.#directory('drafts');
    const drafts = [];
    for (const filename of (await fs.readdir(directory)).sort()) {
      if (!filename.endsWith('.json')) continue;
      const id = filename.slice(0, -5);
      draftId(id);
      const draft = validateDraft(await this.#readJSON(path.join(directory, filename), MAX_DRAFT_BYTES));
      drafts.push({ id, draft });
    }
    return { preferences, drafts };
  }

  async savePreference(body) {
    object(body, ['key', 'value'], '偏好请求');
    preference(body.key, body.value);
    const { key, value } = body;
    return this.#enqueue(async () => {
      const preferences = await this.#preferences();
      preferences[key] = value;
      await this.#atomicJSON(path.join(this.dataDir, 'preferences.json'), preferences, MAX_PREFERENCES_BYTES);
      return { key, value };
    });
  }

  async saveDraft(body) {
    object(body, ['id', 'draft'], '草稿请求');
    const id = draftId(body.id);
    const draft = clone(validateDraft(body.draft));
    return this.#enqueue(async () => {
      const directory = await this.#directory('drafts');
      await this.#atomicJSON(path.join(directory, `${id}.json`), draft, MAX_DRAFT_BYTES);
      return { id };
    });
  }

  async deleteDraft(id) {
    draftId(id);
    return this.#enqueue(async () => {
      const file = path.join(await this.#directory('drafts'), `${id}.json`);
      try {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || !samePath(await fs.realpath(file), file)) invalid('草稿不能指向其他文件。');
        await fs.unlink(file);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return { id, deleted: true };
    });
  }

  async exportFile(body) {
    object(body, ['filename', 'content', 'format'], '导出请求');
    const filename = exportName(body.filename, body.format);
    if (typeof body.content !== 'string') invalid('导出内容必须为字符串。');
    const content = body.content;
    const bytes = Buffer.byteLength(content);
    const limit = body.format === 'json' ? MAX_JSON_EXPORT_BYTES : MAX_MARKDOWN_EXPORT_BYTES;
    if (bytes > limit) tooLarge(body.format === 'json' ? 'JSON导出超过256MiB限制。' : 'Markdown导出超过16MiB限制。');
    if (body.format === 'json') {
      try { JSON.parse(content); } catch { invalid('JSON导出内容不是有效JSON。'); }
    }
    return this.#enqueue(async () => {
      const directory = await this.#directory('exports');
      let targetName = filename;
      for (;;) {
        const file = path.join(directory, targetName);
        let handle;
        try { handle = await fs.open(file, 'wx'); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const extension = path.extname(filename);
          targetName = `${filename.slice(0, -extension.length)}-${randomUUID()}${extension}`;
          continue;
        }
        try {
          try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
        } catch (error) {
          try { await fs.unlink(file); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') console.error('Unable to remove incomplete export:', cleanupError); }
          throw error;
        }
        return { filename: targetName, path: file, bytes };
      }
    });
  }
}
