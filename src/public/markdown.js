// Small, offline Markdown renderer. User text is escaped before any markup is added.
import { renderMath } from './math.js';
export const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeURL(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
// Images are loaded only from files saved by this app, never from arbitrary URLs.
export function safeImageURL(value) {
  return /^\/images\/[a-f0-9]{64}\.(?:png|jpg|webp|gif)$/.test(String(value)) ? String(value) : null;
}
function inline(text) {
  const codes = [];
  // Strip control placeholders from user input, so they cannot refer to renderer tokens.
  let value = String(text).replace(/\u0000/g, '').replace(/`([^`]+)`/g, (_, code) => `\u0000${codes.push(`<code>${escapeHTML(code)}</code>`) - 1}\u0000`);
  value = value.replace(/!\[([^\]\n]*)\]\(([^\s)]+)\)/g, (original, label, href) => {
    const url = safeImageURL(href);
    const image = url ? `<span class="note-image"><button type="button" class="note-image-open" data-image-open="${url}" aria-label="查看大图：${escapeHTML(label || '笔记图片')}"><img src="${url}" alt="${escapeHTML(label)}" loading="lazy" decoding="async"></button>${label ? `<span class="note-image-caption">${escapeHTML(label)}</span>` : ''}</span>` : `<span class="image-unavailable" title="请将图片保存到本地笔记库后插入">${escapeHTML(original)}</span>`;
    return `\u0000${codes.push(image) - 1}\u0000`;
  });
  // Protect math before Markdown emphasis can interpret TeX subscripts. Code and
  // image captions are already protected, so formula delimiters stay literal there.
  value = value.replace(/\\\(([^\n]*?)\\\)/g, (_, formula) => `\u0000${codes.push(`<span class="math-inline">${renderMath(formula)}</span>`) - 1}\u0000`);
  value = value.replace(/(?<!\\)\$(?!\$)([^$\n]+?)(?<!\\)\$(?!\$)/g, (original, formula, offset, input) => {
    // Requiring adjacent non-space characters avoids common currency strings
    // such as "$10 and $20". An unmatched delimiter remains ordinary text.
    if (!formula.trim() || /^\s|\s$/.test(formula) || /\d/.test(input[offset + original.length] || '')) return original;
    return `\u0000${codes.push(`<span class="math-inline">${renderMath(formula)}</span>`) - 1}\u0000`;
  });
  value = escapeHTML(value);
  value = value.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_, label, href) => {
    const decoded = href.replace(/&amp;/g, '&');
    // Note routes stay inside the app and continue to work on another local port.
    if (/^#\/topic\/[A-Za-z0-9_-]+\/note\/[A-Za-z0-9_-]+(?:\?scope=[A-Za-z0-9_-]+)?$/.test(decoded)) {
      return `<a href="${escapeHTML(decoded)}">${label}</a>`;
    }
    const url = safeURL(decoded);
    return url ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
  });
  value = value.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+)__/g, '<strong>$1</strong>').replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>').replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  return value.replace(/\u0000(\d+)\u0000/g, (_, n) => codes[Number(n)]);
}
export function renderMarkdown(content) {
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  const result = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\s*```/.test(line)) {
      const language = line.replace(/^\s*```/, '').trim(); const code = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      result.push(`<div class="code-block"><span>${escapeHTML(language || '代码 / 原式')}</span><pre><code>${escapeHTML(code.join('\n'))}</code></pre></div>`); continue;
    }
    const singleFormula = line.trim().match(/^\$\$(.+)\$\$$/) || line.trim().match(/^\\\[(.+)\\\]$/);
    if (singleFormula) {
      result.push(`<div class="formula-block rendered-math">${renderMath(singleFormula[1], { displayMode: true })}</div>`); i++; continue;
    }
    const fence = line.trim() === '$$' ? '$$' : line.trim() === '\\[' ? '\\]' : null;
    if (fence) {
      let end = i + 1;
      while (end < lines.length && lines[end].trim() !== fence) end++;
      if (end < lines.length) {
        result.push(`<div class="formula-block rendered-math">${renderMath(lines.slice(i + 1, end).join('\n'), { displayMode: true })}</div>`);
        i = end + 1; continue;
      }
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { const level = Math.min(heading[1].length + 1, 6); result.push(`<h${level}>${inline(heading[2])}</h${level}>`); i++; continue; }
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) { result.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(line)) {
      const quote = []; while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      result.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`); continue;
    }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(line); i += 2; const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      result.push(`<div class="table-wrap"><table><thead><tr>${head.map(c=>`<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${head.map((_,n)=>`<td>${inline(r[n] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`); continue;
    }
    if (/^\s*([-*+] |\d+\. )/.test(line)) {
      const ordered = /^\s*\d+\./.test(line); const items = [];
      while (i < lines.length && /^\s*([-*+] |\d+\. )/.test(lines[i]) && /^\s*\d+\./.test(lines[i]) === ordered) {
        let item = lines[i++].replace(/^\s*(?:[-*+] |\d+\. )/, '');
        const check = item.match(/^\[([ xX])\]\s*(.*)$/);
        items.push(check ? `<li class="check-item"><span class="check-box ${check[1].trim()?'checked':''}">${check[1].trim()?'✓':''}</span>${inline(check[2])}</li>` : `<li>${inline(item)}</li>`);
      }
      result.push(`<${ordered?'ol':'ul'}>${items.join('')}</${ordered?'ol':'ul'}>`); continue;
    }
    const paragraph = [line]; i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*```|\s*>|\s*[-*+] |\s*\d+\. |\s*\$\$|\s*\\\[)/.test(lines[i]) && !(lines[i].includes('|') && i+1<lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i+1]))) paragraph.push(lines[i++]);
    result.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
  }
  return result.join('') || '<p class="muted">这条笔记还没有正文。点击“编辑”写下你的理解。</p>';
}
export function plainText(content) { return String(content || '').replace(/[#*`>~\[\]]/g, '').replace(/\s+/g, ' ').trim(); }
