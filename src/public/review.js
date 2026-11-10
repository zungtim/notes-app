import { renderMarkdown, plainText } from './markdown.js';

export const REVIEW_TEMPLATE = '## 问题与思路\n\n本条要解决什么问题？关键思路和结论是什么？\n\n## 理解过程\n\n写清定义、条件、必要推导或证据；把配图、易混点和知识联系放在对应步骤旁。';

// A list card recalls the opening conclusion; full formulas and tables stay in the note.
export function noteSummary(content) {
  const text = String(content || '').replace(/\r\n/g, '\n')
    .replace(/```[^\n]*\n[\s\S]*?```/g, '')
    .replace(/^#{1,6}[ \t]+.*$/gm, '')
    .replace(/!\[[^\]\n]*\]\([^\s)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^\s)]+\)/g, '$1');
  const paragraph = text.split(/\n\s*\n/).find(value => {
    const first = value.trim();
    return first && !first.startsWith('$$') && !first.startsWith('\\[') && !first.startsWith('```') && !first.startsWith('|');
  });
  return plainText(paragraph || '');
}

// Necessary explanations stay in one continuous reading flow, regardless of title.
export function renderNoteBody(content) {
  return renderMarkdown(content);
}

// These controls scroll locally; the application hash and browser history stay intact.
export function installNoteOutline(article) {
  // Markdown headings render one level below the note title (## → h3).
  const headings = [...article.querySelectorAll('h2,h3,h4')];
  if (headings.length < 3) return;
  const panel = document.createElement('details'); panel.className = 'note-outline-panel'; panel.open = window.innerWidth > 720;
  const label = document.createElement('summary'); label.textContent = `本页思路 · ${headings.length} 处`;
  const nav = document.createElement('nav'); nav.className = 'note-outline'; nav.setAttribute('aria-label', '本页思路');
  for (const heading of headings) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = heading.textContent;
    button.onclick = () => { heading.scrollIntoView({ block: 'start' }); heading.tabIndex = -1; heading.focus({ preventScroll: true }); };
    nav.append(button);
  }
  panel.append(label, nav);
  const opening = [...article.children].find(node => node.tagName === 'P');
  if (opening) opening.after(panel); else article.prepend(panel);
}
