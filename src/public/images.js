import { safeImageURL } from './markdown.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
let activeUploads = 0;
let announce = () => {};
let preview = null;
let previousFocus = null;
let previewCleanup = () => {};
let onUploadsIdle = () => {};

export const imagesUploading = () => activeUploads > 0;

export function installImageUI(notify, onIdle = () => {}) {
  announce = notify;
  onUploadsIdle = onIdle;
  // Keep the note/editor stable until the selected image has been inserted.
  document.addEventListener('click', event => {
    if (imagesUploading() && event.target.closest('button, a, summary')) {
      event.preventDefault(); event.stopImmediatePropagation();
      announce('图片正在保存，请稍候完成后再切换或提交笔记。');
    }
  }, true);
  document.addEventListener('keydown', event => {
    if (imagesUploading() && (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && ['n', 'k'].includes(event.key.toLowerCase())))) {
      event.preventDefault(); event.stopImmediatePropagation();
      announce('图片正在保存，请稍候完成后再切换或提交笔记。');
    }
    if (!preview) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closePreview(); }
    else if (event.key === 'Tab') {
      const buttons = [...preview.querySelectorAll('button')]; const index = buttons.indexOf(document.activeElement);
      event.preventDefault(); buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    }
  }, true);
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-image-open]');
    if (button && safeImageURL(button.dataset.imageOpen)) openPreview(button.dataset.imageOpen, button.querySelector('img')?.alt || '笔记图片');
  });
}

export function openPreview(url, label = '笔记图片') {
  if (!safeImageURL(url)) return;
  closePreview(); previousFocus = document.activeElement;
  preview = document.createElement('div'); preview.className = 'image-preview-overlay';
  preview.setAttribute('role', 'dialog'); preview.setAttribute('aria-modal', 'true'); preview.setAttribute('aria-label', label);
  const close = document.createElement('button'); close.className = 'image-preview-close'; close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', '关闭大图'); close.onclick = closePreview;
  const toolbar = document.createElement('div'); toolbar.className = 'image-preview-tools'; toolbar.setAttribute('aria-label', '图片缩放');
  const viewport = document.createElement('div'); viewport.className = 'image-preview-viewport';
  const canvas = document.createElement('div'); canvas.className = 'image-preview-canvas';
  const img = document.createElement('img'); img.alt = label; img.draggable = false;
  const caption = document.createElement('div'); caption.className = 'image-preview-caption'; caption.textContent = label;
  let scale = 1, fitted = true;
  const value = document.createElement('span'); value.setAttribute('aria-live', 'polite');
  const fitScale = () => Math.min(1, (viewport.clientWidth - 32) / img.naturalWidth, (viewport.clientHeight - 32) / img.naturalHeight);
  function resize(next, fit = false) {
    if (!img.naturalWidth) return;
    const oldWidth = Math.max(viewport.clientWidth, img.naturalWidth * scale + 32);
    const oldHeight = Math.max(viewport.clientHeight, img.naturalHeight * scale + 32);
    const cx = (viewport.scrollLeft + viewport.clientWidth / 2) / oldWidth;
    const cy = (viewport.scrollTop + viewport.clientHeight / 2) / oldHeight;
    fitted = fit; scale = Math.max(.05, Math.min(4, next));
    img.style.width = `${img.naturalWidth * scale}px`; img.style.height = `${img.naturalHeight * scale}px`;
    canvas.style.width = `${Math.max(viewport.clientWidth, img.naturalWidth * scale + 32)}px`;
    canvas.style.height = `${Math.max(viewport.clientHeight, img.naturalHeight * scale + 32)}px`;
    viewport.scrollLeft = cx * canvas.clientWidth - viewport.clientWidth / 2;
    viewport.scrollTop = cy * canvas.clientHeight - viewport.clientHeight / 2;
    value.textContent = `${Math.round(scale * 100)}%`;
  }
  const control = (text, title, action) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.setAttribute('aria-label', title); button.onclick = action; toolbar.append(button); };
  control('−', '缩小图片', () => resize(scale / 1.25)); toolbar.append(value);
  control('＋', '放大图片', () => resize(scale * 1.25));
  control('适应窗口', '图片适应窗口', () => resize(fitScale(), true));
  control('原始大小', '图片原始大小', () => resize(1));
  const error = () => { caption.textContent = `图片未能载入：${label}`; };
  img.onload = () => resize(fitScale(), true); img.onerror = error;
  canvas.append(img); viewport.append(canvas); preview.append(close, toolbar, viewport, caption); document.body.append(preview);
  img.src = url;
  let drag = null;
  viewport.onpointerdown = event => { if (event.button !== 0) return; drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop }; viewport.setPointerCapture(event.pointerId); viewport.classList.add('is-dragging'); };
  viewport.onpointermove = event => { if (!drag) return; viewport.scrollLeft = drag.left - event.clientX + drag.x; viewport.scrollTop = drag.top - event.clientY + drag.y; };
  viewport.onpointerup = viewport.onpointercancel = () => { drag = null; viewport.classList.remove('is-dragging'); };
  viewport.onwheel = event => { if (!event.ctrlKey) return; event.preventDefault(); resize(scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)); };
  const onResize = () => resize(fitted ? fitScale() : scale, fitted);
  window.addEventListener('resize', onResize); previewCleanup = () => window.removeEventListener('resize', onResize);
  preview.addEventListener('click', event => { if (event.target === preview) closePreview(); });
  close.focus();
}

function closePreview() { if (!preview) return; previewCleanup(); previewCleanup = () => {}; preview.remove(); preview = null; if (previousFocus?.isConnected) previousFocus.focus(); previousFocus = null; }

function imageMime(file) {
  const mime = String(file.type || '').toLowerCase();
  if (MIME_TYPES.has(mime)) return mime;
  // Some Windows browsers omit MIME for local files. The server verifies actual bytes.
  if (!mime) return ({png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif'})[file.name?.split('.').at(-1)?.toLowerCase()] || null;
  return null;
}

export function uploadImage(file, onProgress = () => {}) {
  const mime = imageMime(file);
  if (!mime) return Promise.reject(new Error('请选择 PNG、JPEG、WebP 或 GIF 图片。'));
  if (!file.size) return Promise.reject(new Error('图片文件为空，请重新选择。'));
  if (file.size > MAX_IMAGE_BYTES) return Promise.reject(new Error('单张图片不能超过 10MB，请缩小图片后再添加。'));
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest(); request.open('POST', '/api/images'); request.timeout = 120000;
    request.setRequestHeader('Content-Type', mime);
    request.setRequestHeader('X-Image-Name', encodeURIComponent(String(file.name || '笔记图片').slice(0,500)));
    request.upload.onprogress = event => onProgress(event.lengthComputable ? Math.round(event.loaded / event.total * 100) : null);
    request.onload = () => {
      let data; try { data = JSON.parse(request.responseText); } catch { reject(new Error('本地图片服务返回了无法识别的结果。')); return; }
      if (request.status < 200 || request.status >= 300) { reject(new Error(data.message || '图片保存失败，请重试。')); return; }
      if (!safeImageURL(data.url)) { reject(new Error('图片服务返回了无效路径。')); return; }
      resolve(data);
    };
    request.onerror = () => reject(new Error('无法连接本地图片服务，请确认应用正在运行。'));
    request.ontimeout = () => reject(new Error('图片保存超时，请重试。'));
    request.onabort = () => reject(new Error('图片保存已取消。'));
    request.send(file);
  });
}

export function bindImageEditor(textarea, { toolbar, pickerButton = null, isCurrent = () => true, onBusy = () => {}, onError = announce } = {}) {
  const chooser = document.createElement('input'); chooser.type = 'file'; chooser.accept = 'image/png,image/jpeg,image/webp,image/gif'; chooser.multiple = true; chooser.hidden = true; chooser.setAttribute('aria-label', '选择要保存的图片');
  const status = document.createElement('div'); status.className = 'image-upload-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const hint = document.createElement('div'); hint.className = 'image-editor-hint'; hint.textContent = '图片可选择、粘贴或拖到正文 · PNG / JPEG / WebP / GIF · 每张 ≤ 10MB';
  textarea.after(status, hint, chooser);
  if (!pickerButton) {
    pickerButton = document.createElement('button'); pickerButton.type = 'button'; pickerButton.className = 'image-picker-button'; pickerButton.textContent = '▧ 图片'; pickerButton.title = '保存图片并插入正文'; pickerButton.setAttribute('aria-label', '添加图片'); toolbar.append(pickerButton);
  }
  let busy = false;
  pickerButton.onclick = () => { if (!busy) chooser.click(); };
  chooser.onchange = () => { const files = [...chooser.files]; chooser.value = ''; addFiles(files); };
  const setStatus = (message, error = false) => { status.textContent = message; status.classList.toggle('error', error); };
  const targetValid = () => textarea.isConnected && isCurrent();

  async function addFiles(files) {
    if (!files.length || !targetValid()) return;
    if (busy) { onError('这组图片还在保存，请完成后再添加其他图片。'); return; }
    const invalid = files.find(file => !imageMime(file) || !file.size || file.size > MAX_IMAGE_BYTES);
    if (invalid) { const message = !imageMime(invalid) ? '请选择 PNG、JPEG、WebP 或 GIF 图片。' : !invalid.size ? '图片文件为空，请重新选择。' : '单张图片不能超过 10MB，请缩小图片后再添加。'; setStatus(message, true); onError(message, true); return; }
    busy = true; activeUploads++; pickerButton.disabled = true; onBusy(true);
    setStatus(`正在保存图片 1/${files.length}…`);
    // Track the insertion bookmark even if the user types while the upload completes.
    let start = textarea.selectionStart, end = textarea.selectionEnd, previous = textarea.value;
    const trackEdit = () => {
      const current = textarea.value; let prefix = 0, suffix = 0;
      while (prefix < previous.length && prefix < current.length && previous[prefix] === current[prefix]) prefix++;
      while (suffix < previous.length - prefix && suffix < current.length - prefix && previous[previous.length - 1 - suffix] === current[current.length - 1 - suffix]) suffix++;
      const removedEnd = previous.length - suffix; const difference = current.length - previous.length;
      const adjust = position => position <= prefix ? position : position >= removedEnd ? Math.max(prefix, position + difference) : current.length - suffix;
      start = adjust(start); end = adjust(end); previous = current;
    };
    textarea.addEventListener('input', trackEdit);
    let completed = 0;
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index]; const result = await uploadImage(file, percentage => setStatus(`正在保存图片 ${index + 1}/${files.length}${percentage === null ? '…' : ` · ${percentage}%`}`));
        if (!targetValid()) { onError('图片已保存在本地，但编辑位置已改变；请回到原笔记后重新添加。', true); break; }
        const label = String(file.name || '笔记图片').replace(/\.[a-z0-9]+$/i, '').replace(/[\[\]\r\n]/g, ' ').trim().slice(0,160) || '笔记图片';
        const markdown = `\n\n![${label}](${result.url})\n\n`;
        if (textarea.value.length - (end - start) + markdown.length > (textarea.maxLength > 0 ? textarea.maxLength : Infinity)) { throw new Error('正文已达到长度上限，图片未插入。请减少正文后重试。'); }
        textarea.removeEventListener('input', trackEdit);
        textarea.setRangeText(markdown, start, end, 'end'); start = end = textarea.selectionEnd; previous = textarea.value;
        textarea.dispatchEvent(new Event('input', {bubbles:true})); textarea.addEventListener('input', trackEdit); completed++;
      }
      if (completed) setStatus(`已保存并插入 ${completed} 张图片${textarea.closest('#capture-form') ? ' · 点击“保存笔记”完成记录' : ' · 正文将自动保存'}`);
    } catch (error) { const message = `${completed ? `前 ${completed} 张已插入。` : ''}${error.message}`; if (targetValid()) setStatus(message, true); onError(message, true); }
    finally { textarea.removeEventListener('input', trackEdit); busy = false; activeUploads--; pickerButton.disabled = false; onBusy(false); if (!imagesUploading()) onUploadsIdle(); }
  }
  textarea.addEventListener('paste', event => {
    const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
    if (files.length) { event.preventDefault(); addFiles(files); }
  });
  textarea.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy'; if (!busy) textarea.classList.add('image-drop-target'); } });
  textarea.addEventListener('dragleave', () => textarea.classList.remove('image-drop-target'));
  textarea.addEventListener('drop', event => { textarea.classList.remove('image-drop-target'); const files = [...(event.dataTransfer?.files || [])]; if (files.length) { event.preventDefault(); addFiles(files); } });
  return { isBusy: () => busy };
}
