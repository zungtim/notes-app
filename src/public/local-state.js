const LEGACY_DRAFT_KEY = 'zhixu-draft-v1';
const PANE_KEY = 'notes-pane-layout-v1';
const preferenceKey = key => key === PANE_KEY || /^zhixu-layout-[A-Za-z0-9_-]+$/.test(key) || /^notes-graph-(?:view|context)-[A-Za-z0-9_-]{1,220}$/.test(key);

export function cleanExportLabel(text) {
  const deviceName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  let label = String(text).replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').trim().replace(/^[. ]+/, '').replace(/[. ]+$/, '');
  if (deviceName.test(label)) label = `_${label}`;
  // Leave room for a date and extension within both backend filename limits.
  const encoder = new TextEncoder();
  let result = '', bytes = 0;
  for (const character of label) {
    const size = encoder.encode(character).length;
    if (bytes + size > 140 || result.length + character.length > 100) break;
    result += character;bytes += size;
  }
  result = result.replace(/[. ]+$/, '') || '学习笔记';
  return deviceName.test(result) ? `_${result}` : result;
}

async function requestJSON(fetcher, url, options) {
  const response = await fetcher(url, options);
  let result;
  try { result = await response.json(); }
  catch { throw new Error('本机服务返回了无法读取的结果。'); }
  if (!response.ok) throw new Error(result?.message || '本机文件保存失败。');
  return result;
}

export function createLocalStateClient({fetcher = globalThis.fetch, onError = () => {}, makeId = () => `draft_${crypto.randomUUID().replaceAll('-', '')}`} = {}) {
  const preferences = Object.create(null);
  const drafts = new Map();
  const draftId = makeId();
  let queue = Promise.resolve();
  let pending = 0;
  let draftVersion = 0;
  let durableVersion = 0;

  function enqueue(operation) {
    pending++;
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result.finally(() => { pending--; });
  }

  const post = (url, body) => requestJSON(fetcher, url, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
  });

  async function initialize(legacyStorage = null) {
    const result = await requestJSON(fetcher, '/api/local-state');
    for (const [key, value] of Object.entries(result.preferences || {})) {
      if (preferenceKey(key) && typeof value === 'string') preferences[key] = value;
    }
    for (const entry of result.drafts || []) drafts.set(entry.id, entry);
    if (!legacyStorage) return;
    const keys = [];
    try {
      for (let i = 0; i < legacyStorage.length; i++) {
        const key = legacyStorage.key(i);
        if (key === LEGACY_DRAFT_KEY || preferenceKey(key)) keys.push(key);
      }
    } catch (error) { onError('旧浏览器数据无法读取，原数据已保留。', error); return; }
    for (const key of keys) {
      try {
        const raw = legacyStorage.getItem(key);
        if (raw === null) continue;
        if (key === LEGACY_DRAFT_KEY) {
          const draft = JSON.parse(raw);
          // A content-derived id makes a retry safe without storing a new browser key.
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
          const id = `legacy_${[...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('')}`;
          await post('/api/drafts', {id, draft});
          drafts.set(id, {id, draft});
        } else {
          await post('/api/preferences', {key, value:raw});
          preferences[key] = raw;
        }
        // Do not erase a newer value written by an older open app tab during migration.
        if (legacyStorage.getItem(key) === raw) legacyStorage.removeItem(key);
      } catch (error) { onError('旧浏览器数据迁移未完成，未迁移的数据已保留。', error); }
    }
  }

  function setPreference(key, value) {
    preferences[key] = value;
    return enqueue(() => post('/api/preferences', {key, value}));
  }

  function captureDraft(data, changedAt = new Date().toISOString()) {
    const version = ++draftVersion;
    const draft = {data:structuredClone(data), changedAt};
    const promise = enqueue(async () => {
      // Coalesce changes which have not started writing yet.
      if (version !== draftVersion) return false;
      await post('/api/drafts', {id:draftId, draft});
      drafts.set(draftId, {id:draftId, draft});
      durableVersion = version;
      return true;
    });
    return {version, promise};
  }

  function clearDraft(version) {
    return enqueue(async () => {
      if (version !== draftVersion) return false;
      await requestJSON(fetcher, `/api/drafts/${encodeURIComponent(draftId)}`, {method:'DELETE'});
      drafts.delete(draftId);
      durableVersion = 0;
      return true;
    });
  }

  function removeRecoveredDraft(id) {
    if (id === draftId) return Promise.reject(new Error('当前窗口草稿需在笔记保存后移除。'));
    return enqueue(async () => {
      await requestJSON(fetcher, `/api/drafts/${encodeURIComponent(id)}`, {method:'DELETE'});
      drafts.delete(id);
    });
  }

  return {
    preferences, drafts, initialize, setPreference, captureDraft, clearDraft, removeRecoveredDraft,
    get draftId() { return draftId; },
    get draftVersion() { return draftVersion; },
    get draftDurable() { return draftVersion > 0 && durableVersion === draftVersion; },
    get pending() { return pending; },
    async exportFile(filename, content, format) {
      pending++;
      try { return await post('/api/exports', {filename, content, format}); }
      finally { pending--; }
    },
  };
}
