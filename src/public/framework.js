import { noteSummary } from './review.js';

export const MODULE_TAG = '框架模块';
export const ITEM_TAG = '框架节点';
export const isFrameworkModule = note => Boolean(note?.tags?.includes(MODULE_TAG));
export const isFrameworkPlaceholder = note => Boolean(note?.tags?.includes(ITEM_TAG) && !String(note.content || '').trim() && note.status === 'inbox');

export function noteStatusLabel(note, labels) {
  return isFrameworkPlaceholder(note) && !isFrameworkModule(note) ? '待学习' : labels[note.status];
}

export function frameworkMembers(moduleId, notes, links, recursive = false) {
  const ids = new Set(notes.map(note => note.id));
  const found = new Set(ids.has(moduleId) ? [moduleId] : []);
  const queue = [...found];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const link of links) {
      if (link.type !== 'branch' || link.from !== queue[cursor] || !ids.has(link.to) || found.has(link.to)) continue;
      found.add(link.to);
      if (recursive) queue.push(link.to);
    }
    if (!recursive) break;
  }
  return notes.filter(note => found.has(note.id));
}

export function frameworkProgress(moduleId, notes, links) {
  const members = frameworkMembers(moduleId, notes, links, true);
  const counts = { understood: 0, learning: 0, review: 0, pending: 0, recorded: 0 };
  for (const note of members) {
    if (isFrameworkModule(note) && !String(note.content || '').trim()) continue;
    if (isFrameworkPlaceholder(note)) counts.pending++;
    else {
      counts.recorded++;
      if (['understood', 'learning', 'review'].includes(note.status)) counts[note.status]++;
    }
  }
  return counts;
}

export function frameworkCaption(note, notes, links, labels) {
  if (isFrameworkModule(note)) {
    const counts = frameworkProgress(note.id, notes, links);
    return [note.tags.includes('后续拓展') ? '后续拓展' : '', counts.understood ? `${counts.understood} 已理解` : '', counts.learning ? `${counts.learning} 学习中` : '', counts.review ? `${counts.review} 待复习` : '', counts.pending ? `${counts.pending} 待学习` : ''].filter(Boolean).join(' · ') || '模块导览';
  }
  if (isFrameworkPlaceholder(note)) return '待学习 · 正文留空';
  const summary = noteSummary(note.content).replace(/^核心(?:理论|结论|关系)：/, '').split(/[—：]/)[0];
  return [noteStatusLabel(note, labels), summary].filter(Boolean).join(' · ');
}

export function frameworkScopeOptions(notes, links) {
  const modules = notes.filter(isFrameworkModule);
  if (!modules.length) return {};
  const options = { overview: '框架总览' };
  for (const note of modules) options[note.id] = note.title;
  const assigned = new Set(modules.flatMap(note => frameworkMembers(note.id, notes, links, true).map(member => member.id)));
  if (notes.some(note => !assigned.has(note.id))) options.unassigned = '未归入模块的笔记';
  return options;
}

export function frameworkScopeForNote(noteId, notes, links) {
  const note = notes.find(value => value.id === noteId);
  if (isFrameworkModule(note)) return note.id;
  const moduleIds = new Set(notes.filter(isFrameworkModule).map(value => value.id));
  return links.find(link => link.type === 'branch' && link.to === noteId && moduleIds.has(link.from))?.from || 'unassigned';
}

// Module views contain their own members. Cross-module relationships remain
// in the notebook and overview; they do not expand a module's reading canvas.
const HIGHLIGHT_LENGTH = 56;

// Card text is an excerpt of existing material, never generated note content.
// Formula source, code, images and link targets remain in the full reading view.
function highlightText(value) {
  return String(value || '')
    .replace(/!\[[^\]\n]*\]\((?:[^()]|\([^()]*\))*\)/g, '')
    .replace(/\[([^\]\n]+)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    .replace(/\[([^\]\n]+)\]\[[^\]\n]*\]/g, '$1')
    .replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g, ' ')
    .replace(/\\\([\s\S]*?\\\)|\$[^$\n]*\$/g, '…')
    .replace(/<[^>]*>/g, '')
    .replace(/\b(?:https?:\/\/|file:\/\/|www\.)[^\s<>，。；、（）]+|#\/[^\s)]+/g, '')
    .replace(/\\[A-Za-z]+(?:\[[^\]]*\])?(?:\{[^{}]*\})*/g, '…')
    .replace(/^[ \t]*(?:[-*+][ \t]+|\d+[.)、][ \t]*)/, '')
    .replace(/[#*`>~\[\]{}$]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function shortHighlight(value) {
  const text = highlightText(value), chars = Array.from(text);
  return chars.length > HIGHLIGHT_LENGTH ? chars.slice(0, HIGHLIGHT_LENGTH - 1).join('') + '…' : text;
}

export function frameworkHighlights(note, notes = [], links = []) {
  let content = String(note?.content || '').replace(/\r\n/g, '\n');
  if (content.trim()) {
    content = content.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, '')
      .replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g, '');
    const core = /^#{1,3}[ \t]+(?:本节核心|核心要点|核心内容)[ \t]*$/m.exec(content);
    if (core) {
      content = content.slice(core.index + core[0].length);
      const headingLevel = core[0].match(/^#+/)[0].length;
      const nextSection = new RegExp(`^#{1,${headingLevel}}[ \\t]+`, 'm').exec(content);
      if (nextSection) content = content.slice(0, nextSection.index);
    } else {
      const appendix = /^#{1,3}[ \t]+(?:附图|来源|参考文献|推导与展开|补充说明)[ \t]*$/m.exec(content);
      if (appendix) content = content.slice(0, appendix.index);
    }
    const candidates = content.split(/\n[ \t]*\n|(?=^[ \t]*(?:[-*+]|\d+[.)、])[ \t]+)/m)
      .map(value => value.split('\n').filter(line => !/^[ \t]*(?:#{1,6}[ \t]|\||[-*_]{3,}[ \t]*$)/.test(line)).join(' '))
      .map(shortHighlight).filter(value => /[\p{L}\p{N}]/u.test(value));
    const displayHighlights = [...new Set(candidates)].slice(0, 2);
    return { displayHighlights, displayHighlightSource: displayHighlights.length ? '正文摘录' : '' };
  }
  if (isFrameworkModule(note)) {
    const directIds = new Set(links.filter(link => link.type === 'branch' && link.from === note.id).map(link => link.to));
    const displayHighlights = [...new Set(notes.filter(member => directIds.has(member.id)).map(member => shortHighlight(member.title)).filter(Boolean))].slice(0, 2);
    return { displayHighlights, displayHighlightSource: displayHighlights.length ? '框架目录' : '' };
  }
  return { displayHighlights: [], displayHighlightSource: '' };
}

export function frameworkView(notes, links, scope = 'overview', labels = {}) {
  const modules = notes.filter(isFrameworkModule);
  if (!modules.length) return { notes:notes.map(note=>({...note,...frameworkHighlights(note)})), links, externalLinks: [], hiddenDescendantCount: 0, contextNodeCount: 0, baseVisibleCount: notes.length };
  const moduleIds = new Set(modules.map(note => note.id));
  let visible;
  if (scope === 'unassigned') {
    const assigned = new Set(modules.flatMap(note => frameworkMembers(note.id, notes, links, true).map(member => member.id)));
    visible = notes.filter(note => !assigned.has(note.id));
  } else if (moduleIds.has(scope)) {
    visible=frameworkMembers(scope,notes,links);
  }
  else {
    const nested = new Set(links.filter(link => link.type === 'branch' && moduleIds.has(link.from) && moduleIds.has(link.to)).map(link => link.to));
    visible = modules.filter(note => !nested.has(note.id));
  }
  const visibleIds = new Set(visible.map(note => note.id));
  const byId = new Map(notes.map(note => [note.id, note]));
  const externalLinks = [];
  for (const link of links) {
    const fromVisible = visibleIds.has(link.from), toVisible = visibleIds.has(link.to);
    if (fromVisible === toVisible) continue;
    const visibleId = fromVisible ? link.from : link.to;
    const externalId = fromVisible ? link.to : link.from;
    const local = byId.get(visibleId), external = byId.get(externalId);
    if (!external || (local.topicId && external.topicId && local.topicId !== external.topicId)) continue;
    externalLinks.push({
      ...link, visibleId, externalId,
      externalNote: { id: externalId, title: external.title },
      externalScope: frameworkScopeForNote(externalId, notes, links),
    });
  }
  const descendants = new Set();
  const roots = moduleIds.has(scope) ? [scope] : scope === 'unassigned' ? [] : visible.filter(isFrameworkModule).map(note => note.id);
  for (const id of roots) for (const member of frameworkMembers(id, notes, links, true)) {
    if (!visibleIds.has(member.id)) descendants.add(member.id);
  }
  return {
    notes: visible.map(note => ({ ...note, frameworkModule: isFrameworkModule(note), caption: frameworkCaption(note, notes, links, labels),...frameworkHighlights(note,notes,links) })),
    links: links.filter(link => visibleIds.has(link.from) && visibleIds.has(link.to))
      .map(link => ({ ...link, hideLabel: link.type === 'branch'&&!String(link.label||'').trim() })),
    externalLinks,
    hiddenDescendantCount: descendants.size,
    contextNodeCount: 0,
    baseVisibleCount: visible.length,
  };
}

export function topicRecordSummary(notes) {
  const recorded = notes.filter(note => String(note.content || '').trim()).length;
  const modules = notes.filter(isFrameworkModule).length;
  const pending = notes.filter(note => !isFrameworkModule(note) && isFrameworkPlaceholder(note)).length;
  return modules ? `${recorded} 条有正文笔记 · ${modules} 个模块 · ${pending} 个待学习节点` : `${notes.length} 条笔记`;
}
