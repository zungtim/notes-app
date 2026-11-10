import { routeGraphEdges } from './edge-routing.js';
import { cleanGraphPlan, computeGraphLayout, computeIncrementalLayout, placeAdditionalNodes, layoutSignature, studySequenceOrder, relationLabelGeometry } from './graph-layout.js';
import { essentialGraphPlan } from './graph-presentation.js';
import { smoothEdgePath } from './edge-path.js';

const NS = 'http://www.w3.org/2000/svg';

const RELATIONS = {
  sequence: { label: '学习顺序', color: '#2463a6', dash: '', arrow: true, width: 2.1 },
  parallel: { label: '并列', color: '#7046a0', dash: '7 4', arrow: false, width: 2 },
  branch: { label: '归属', color: '#526879', dash: '', arrow: true, width: 2 },
  extends: { label: '延伸', color: '#506890', dash: '', arrow: true, width: 2 },
  prerequisite: { label: '前置', color: '#92510b', dash: '6 4', arrow: true, width: 2.1 },
  evidence: { label: '依据', color: '#236b7b', dash: '', arrow: true, width: 2 },
  contradicts: { label: '辨析', color: '#a43d4b', dash: '3 4', arrow: true, width: 2 },
  applies: { label: '应用', color: '#29644d', dash: '', arrow: true, width: 2 },
};

const NOTE_TYPES = {
  concept: ['概念', '◎'], definition: ['概念', '◎'], paper: ['文献', '▤'],
  literature: ['文献', '▤'], question: ['问题', '?'], insight: ['思考', '✦'],
  thought: ['思考', '✦'], method: ['方法', '⌘'], experiment: ['实验', '⚗'],
  conversation: ['对话', '◌'], dialogue: ['对话', '◌'], calculation: ['推导', '∑'],
  note: ['笔记', '✎'], resource: ['资料', '▤'],
};

const STATUS = {
  understood: ['已理解', '#23766b'], mastered: ['已掌握', '#23766b'], done: ['已理解', '#23766b'],
  learning: ['学习中', '#c87848'], reading: ['学习中', '#c87848'],
  review: ['待复习', '#ad8946'], unclear: ['待理解', '#ad8946'],
  todo: ['待学习', '#87908b'], draft: ['待整理', '#87908b'],
};

const NODE_W = 300;
const NODE_H = 168;
export const GRAPH_CARD_SIZE = Object.freeze({ width: NODE_W, height: NODE_H });
const READABLE_MIN_SCALE = .55;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const normalizeLayout = mode => mode === 'clean' ? 'clean' : mode === 'sequence' ? 'sequence' : ['branches', 'radial'].includes(mode) ? 'branches' : 'columns';

const finitePoint = value => Boolean(value && typeof value === 'object' && !Array.isArray(value)
  && Number.isFinite(value.x) && Number.isFinite(value.y));

// Preserve the production geometry identity while allowing structural edits to
// retain surviving cards. A changed key updates metadata, never semantic edges.
function structureKey(signature) {
  let first = 2166136261, second = 3339675911;
  for (let i = 0; i < signature.length; i++) {
    const code = signature.charCodeAt(i);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2246822519);
  }
  return `clean-logic-v1-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

function savedGraphView(value, layout, viewKey, signature, ids) {
  if (!value || typeof value !== 'object' || value.layout !== layout
    || (value.viewKey != null && value.viewKey !== viewKey)
    || !value.positions || typeof value.positions !== 'object' || Array.isArray(value.positions)) return null;
  if (layout === 'clean' && (typeof value.structureKey !== 'string'
    || !/^clean-logic-v1-[a-z0-9]+-[a-z0-9]+$/.test(value.structureKey)
    || Object.values(value.positions).some(point => !finitePoint(point))
    || ids.size > 0 && ![...ids].some(id => finitePoint(value.positions[id])))) return null;
  const transform = finitePoint(value.transform) && Number.isFinite(value.transform.scale) && value.transform.scale > 0
    ? { x: value.transform.x, y: value.transform.y, scale: Math.min(value.transform.scale, 2.8) } : null;
  const lockedIds = Array.isArray(value.lockedIds) ? value.lockedIds.filter(id => typeof id === 'string' && finitePoint(value.positions[id])) : [];
  return { layout, positions: value.positions, transform, lockedIds,
    structureChanged: layout === 'clean' && value.structureKey !== structureKey(signature) };
}

// A cycle in a single semantic relation needs review. A mixed feedback path
// (e.g. a principle applied to an example) is not automatically a contradiction.
export function relationDiagnostics(notes, links) {
  const known = new Set(notes.map(note => String(note.id))), issues = [];
  for (const type of ['branch', 'prerequisite', 'sequence']) {
    const pending = new Set(known), children = new Map([...known].map(id => [id, []]));
    const incoming = new Map([...known].map(id => [id, 0]));
    for (const link of links) if (link.type === type && known.has(String(link.from)) && known.has(String(link.to))) {
      children.get(String(link.from)).push(String(link.to));
      incoming.set(String(link.to), incoming.get(String(link.to)) + 1);
    }
    const queue = [...known].filter(id => !incoming.get(id));
    for (let i = 0; i < queue.length; i++) {
      pending.delete(queue[i]);
      for (const child of children.get(queue[i])) {
        incoming.set(child, incoming.get(child) - 1);
        if (!incoming.get(child)) queue.push(child);
      }
    }
    // Kahn's remainder includes downstream nodes; report an affected region,
    // never claim that all remaining nodes themselves form the cycle.
    if (pending.size) issues.push({ type: 'relation-cycle', relation: type, nodeIds: [...pending].sort(), message: `${RELATIONS[type].label}关系含回路，相关顺序需核对；原关系已保留` });
  }
  return issues;
}

function element(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function splitTitle(value, maxWidth = NODE_W - 30) {
  const chars = Array.from(String(value || '未命名笔记'));
  const lines = [];
  let current = '';
  let width = 0;
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    const charWidth = /[\u0000-\u00ff]/.test(char) ? 8.3 : 16;
    if (width + charWidth > maxWidth && current) {
      lines.push(current);
      current = '';
      width = 0;
      if (lines.length === 2) {
        lines[1] = lines[1].slice(0, -1) + '…';
        return lines;
      }
    }
    current += char;
    width += charWidth;
  }
  if (current) lines.push(current);
  return lines.length ? lines : ['未命名笔记'];
}

function labelContent(link) {
  const type = RELATIONS[link.type]?.label || '联系';
  const detail = String(link.label || '').trim();
  const short = Array.from(detail).slice(0, 18).join('') + (Array.from(detail).length > 18 ? '…' : '');
  const width = Math.max(44, Math.min(190, Array.from(short || type).reduce((sum, char) => sum + (/[\u0000-\u00ff]/.test(char) ? 6.2 : 12), 16)));
  return { type, short, width, height: short ? 40 : 24 };
}

function clippedText(value, maxWidth, size = 12) {
  let text = '', width = 0;
  for (const char of Array.from(String(value || ''))) {
    width += /[\u0000-\u00ff]/.test(char) ? size * .56 : size;
    if (width > maxWidth) return text + '…';
    text += char;
  }
  return text;
}

function relationCaption(link) {
  const type=RELATIONS[link.type]?.label||'关联';
  const detail=String(link.label||'').replace(/\s+/g,' ').trim();
  const chars=Array.from(detail),short=chars.length>28?chars.slice(0,28).join('')+'…':detail;
  return short?`${type}：${short}`:type;
}

/**
 * Local SVG graph. Positions are the top-left corners of cards in world coordinates.
 * onPositionChange(id, {x, y}) fires once after dragging a card.
 * onConnect({from, to, type}) fires when a connection target is selected.
 * Coordinates and viewport are private view state. Existing cards retain their
 * placement during content edits and connection organization.
 * onViewChange(view, viewKey) never changes notebook positions.
 */
export class KnowledgeGraph {
  constructor(container, { onSelect, onPositionChange, onConnect, onConnectionChange, onViewChange, onPresentationChange, layout = 'clean' } = {}) {
    this.container = container;
    this.callbacks = { onSelect, onPositionChange, onConnect, onConnectionChange, onViewChange, onPresentationChange };
    this.notes = [];
    this.links = [];
    this.positions = new Map();
    this.lockedIds = new Set();
    this.undoStack = [];
    this.preview = null;
    this.layoutIssues = [];
    this.structureSignature = null;
    this.viewKey = '';
    this.viewStates = new Map();
    this.viewTimer = null;
    this.selectedId = null;
    this.query = '';
    this.layout = normalizeLayout(layout);
    this.cleanPlan = null;
    this.auxiliaryLinkIds = new Set();
    this.showAuxiliary = false;
    this.showMembershipLines = false;
    this.sequenceSteps = new Map();
    this.transform = { x: 0, y: 0, scale: 1 };
    this.width = 800;
    this.height = 500;
    this.hasFitted = false;
    this.viewMode = 'initial';
    this.fitPadding = {};
    this.connecting = null;
    this.pointer = null;
    this.uid = `kg-${Math.random().toString(36).slice(2, 10)}`;

    this.root = document.createElement('div');
    this.root.className = 'kg';
    this.svg = element('svg', { class: 'kg-canvas', width: '100%', height: '100%', tabindex: '0', role: 'application', 'aria-label': '知识关系图，拖动节点或空白区域，滚轮缩放' });
    this.defs = element('defs');
    for (const [type, config] of Object.entries(RELATIONS)) {
      const marker = element('marker', { id: `${this.uid}-${type}`, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7.5', markerHeight: '7.5', markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse' });
      marker.append(element('path', { d: 'M 0 1 L 9 5 L 0 9 z', fill: config.color }));
      this.defs.append(marker);
    }
    this.world = element('g', { class: 'kg-world' });
    this.groupLayer = element('g', { class: 'kg-groups' });
    this.edgeLayer = element('g', { class: 'kg-edges' });
    this.nodeLayer = element('g', { class: 'kg-nodes' });
    this.edgeLabelLayer = element('g', { class: 'kg-edge-labels' });
    this.world.append(this.groupLayer, this.edgeLayer, this.edgeLabelLayer, this.nodeLayer);
    this.svg.append(this.defs, this.world);

    this.hint = document.createElement('div');
    this.hint.className = 'kg-hint';
    this.hintText = '自动整理 · 主线优先 · 滚轮缩放';
    this.hint.textContent = this.hintText;
    this.scaleLabel = document.createElement('div');
    this.scaleLabel.className = 'kg-scale';
    this.scaleLabel.setAttribute('aria-hidden', 'true');
    this.empty = document.createElement('div');
    this.empty.className = 'kg-empty';
    const emptyIcon = document.createElement('div');
    emptyIcon.className = 'kg-empty-icon';
    emptyIcon.textContent = '◎';
    const emptyTitle = document.createElement('strong');
    emptyTitle.textContent = '从一条笔记开始连接知识';
    const emptyText = document.createElement('span');
    emptyText.textContent = '概念、疑问与思考，都可以成为你的知识地图中的节点。';
    this.empty.append(emptyIcon, emptyTitle, emptyText);

    this.banner = document.createElement('div');
    this.banner.className = 'kg-connect-banner';
    this.banner.hidden = true;
    this.bannerText = document.createElement('span');
    this.cancelButton = document.createElement('button');
    this.cancelButton.type = 'button';
    this.cancelButton.textContent = '取消';
    this.cancelButton.addEventListener('click', () => this.cancelConnect());
    this.banner.append(this.bannerText, this.cancelButton);
    this.edgeTooltip = document.createElement('div');
    this.edgeTooltip.className = 'kg-edge-tooltip';
    this.edgeTooltip.setAttribute('role', 'tooltip');
    this.edgeTooltip.hidden = true;
    this.qualityPanel = document.createElement('details');
    this.qualityPanel.className = 'kg-quality';
    this.previewBar = document.createElement('div');
    this.previewBar.className = 'kg-preview-bar';
    this.previewBar.hidden = true;
    const previewText = document.createElement('span');
    previewText.textContent = '排版预览 · 尚未保存';
    const apply = document.createElement('button');
    apply.textContent = '应用排版'; apply.onclick = () => this.applyPreview();
    const cancel = document.createElement('button');
    cancel.textContent = '取消预览'; cancel.onclick = () => this.cancelPreview();
    this.previewBar.append(previewText, apply, cancel);
    this.root.append(this.svg, this.hint, this.scaleLabel, this.empty, this.banner, this.edgeTooltip, this.qualityPanel, this.previewBar);
    this.container.append(this.root);

    this.handlers = {
      pointerover: event => this.onEdgeEnter(event),
      pointerout: event => this.onEdgeLeave(event),
      focusin: event => this.onEdgeEnter(event),
      focusout: event => this.onEdgeLeave(event),
      pointerdown: event => this.onPointerDown(event),
      pointermove: event => this.onPointerMove(event),
      pointerup: event => this.onPointerUp(event),
      pointercancel: event => this.onPointerUp(event, true),
      wheel: event => this.onWheel(event),
      dblclick: event => {
        const id = event.target.closest?.('[data-node-id]')?.dataset.nodeId;
        if (id && !this.connecting) this.focus(id);
      },
      keydown: event => this.onKeyDown(event),
    };
    for (const [name, handler] of Object.entries(this.handlers)) this.svg.addEventListener(name, handler, name === 'wheel' ? { passive: false } : undefined);
    this.resizeObserver = new ResizeObserver(entries => {
      const bounds = entries[0]?.contentRect;
      if (bounds) this.handleResize(bounds);
    });
    this.resizeObserver.observe(this.container);
    this.applyTransform();
  }

  handleResize(bounds) {
    // Hidden reading panes provide zero dimensions. Ordinary pane settling
    // preserves a manual camera; a clean map adapts when its screen size changes
    // substantially so a desktop camera cannot strand every card off mobile.
    if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)
      || bounds.width < 1 || bounds.height < 1) return;
    const previous = { ...this.transform };
    const previousWidth = this.width;
    const widthChange = Math.abs(bounds.width - previousWidth);
    const crossesCompactWidth = (bounds.width < 600) !== (previousWidth < 600);
    const majorWidthChange = bounds.width < previousWidth * .65 || bounds.width > previousWidth * 1.55;
    const adaptManualClean = this.layout === 'clean' && this.hasFitted && this.notes.length
      && this.viewMode === 'manual' && widthChange >= 96 && (crossesCompactWidth || majorWidthChange);
    this.width = bounds.width;
    this.height = bounds.height;
    let automatic = false;
    if (adaptManualClean) {
      this.readableView();
      this.viewMode = 'manual';
      automatic = true;
    } else if (!this.hasFitted && this.notes.length) {
      this.readableView();
      automatic = true;
    } else if (this.hasFitted && this.viewMode === 'fit') {
      this.fit(this.fitPadding, false);
      automatic = true;
    } else if (this.hasFitted && this.viewMode === 'readable') {
      this.readableView();
      automatic = true;
    } else if (this.hasFitted) {
      this.applyTransform();
    }
    // Initial pane sizes can settle after setData. Persist that final automatic
    // camera as well, so a no-interaction reopening restores what was visible.
    if (automatic && (previous.x !== this.transform.x || previous.y !== this.transform.y
      || previous.scale !== this.transform.scale)) this.emitViewChange();
  }

  setData({ notes = [], links = [], selectedId = null, query = '', viewKey = '', savedView = null } = {}) {
    const nextViewKey = String(viewKey);
    let nextSignature = layoutSignature(notes, links, this.layout);
    if (this.preview && (nextViewKey !== this.viewKey || nextSignature !== this.structureSignature)) this.cancelPreview();
    nextSignature = layoutSignature(notes, links, this.layout);
    const entering = this.structureSignature === null || nextViewKey !== this.viewKey;
    if (entering || nextSignature !== this.structureSignature) { this.undoStack = []; this.layoutIssues = []; }
    this.viewStates ||= new Map();
    if (entering && this.structureSignature !== null) {
      // Finish an in-flight wheel gesture under its original scope key.
      if (this.viewTimer) this.emitViewChange();
      if (this.viewKey) this.viewStates.set(this.viewKey, this.getViewState());
    }
    this.notes = notes.filter(note => note && note.id != null).map(note => ({ ...note, id: String(note.id) }));
    const ids = new Set(this.notes.map(note => note.id));
    this.links = links.filter(link => link && ids.has(String(link.from)) && ids.has(String(link.to))).map((link, index) => ({ ...link, id: String(link.id ?? 'edge-' + index), from: String(link.from), to: String(link.to) }));
    this.cleanPlan = this.layout === 'clean' ? cleanGraphPlan(this.notes, this.links) : null;
    this.selectedId = selectedId != null ? String(selectedId) : null;
    this.query = String(query || '').trim().toLocaleLowerCase();
    let shouldSave = false;
    if (entering) {
      const restored = savedGraphView(savedView, this.layout, nextViewKey, nextSignature, ids)
        || savedGraphView(this.viewStates.get(nextViewKey), this.layout, nextViewKey, nextSignature, ids);
      this.positions = restored ? new Map(Object.entries(restored.positions))
        : new Map(Object.entries(this.notes.length ? this.computeLayout(this.layout) : {}));
      this.lockedIds = new Set();
      this.transform = restored?.transform ? { ...restored.transform } : { x: 0, y: 0, scale: 1 };
      this.hasFitted = Boolean(restored?.transform && this.notes.length);
      this.viewMode = this.hasFitted ? 'manual' : 'initial';
      this.readableOverflow = false;
      const bounds = this.container?.getBoundingClientRect?.();
      if (bounds?.width > 0) this.width = bounds.width;
      if (bounds?.height > 0) this.height = bounds.height;
      shouldSave = !restored || !restored.transform || restored.structureChanged;
    } else if (nextSignature !== this.structureSignature && this.layout === 'clean') shouldSave = true;
    this.lockedIds = new Set([...(this.lockedIds || [])].filter(id => ids.has(id)));
    // Structural changes retain surviving positions. New cards seek free space
    // near their actual relationships; opening a view never reflows old cards.
    shouldSave = this.ensureCardPositions() || shouldSave;
    this.structureSignature = layoutSignature(this.notes, this.links, this.layout);
    this.viewKey = nextViewKey;
    if (this.connecting && !ids.has(this.connecting.from)) this.cancelConnect();
    this.render();
    if (this.notes.length && !this.hasFitted) this.readableView();
    else if (!this.notes.length) this.hasFitted = false;
    if (shouldSave && (this.notes.length || !entering)) this.emitViewChange();
    return this;
  }

  ensureCardPositions() {
    const ids = new Set(this.notes.map(note => note.id));
    const retained = new Map([...this.positions].filter(([id, point]) => ids.has(id) && finitePoint(point))
      .map(([id, point]) => [id, { x: point.x, y: point.y }]));
    let changed = retained.size !== this.positions.size;
    this.positions = retained;
    const missing = [...ids].filter(id => !retained.has(id)).sort();
    if (!missing.length) return changed;
    changed = true;
    if (!retained.size) {
      this.positions = new Map(Object.entries(this.computeLayout(this.layout)));
      return changed;
    }
    const result = placeAdditionalNodes(this.notes, this.links, { positions: this.getPositions(), nodeWidth: NODE_W, nodeHeight: NODE_H, mode: this.layout });
    this.positions = new Map(Object.entries(result.positions));
    this.layoutIssues = result.issues;
    return changed;
  }

  getPositions() {
    return Object.fromEntries(Array.from(this.positions, ([id, position]) => [id, { ...position }]));
  }

  getViewState() {
    const view = { layout: this.layout, positions: this.getPositions(), transform: { ...this.transform } };
    if (this.layout === 'clean') view.structureKey = structureKey(this.structureSignature || layoutSignature(this.notes, this.links, this.layout));
    if (this.lockedIds?.size) view.lockedIds = [...this.lockedIds].sort();
    return view;
  }

  emitViewChange() {
    if (this.viewTimer) clearTimeout(this.viewTimer);
    this.viewTimer = null;
    if (this.preview) return;
    if (!this.viewKey) return;
    this.viewStates ||= new Map();
    this.viewStates.set(this.viewKey, this.getViewState());
    this.callbacks.onViewChange?.(this.getViewState(), this.viewKey);
  }

  scheduleViewChange() {
    if (this.viewTimer) clearTimeout(this.viewTimer);
    this.viewTimer = setTimeout(() => {
      this.viewTimer = null;
      this.emitViewChange();
    }, 180);
  }

  setLayout(mode = 'clean') {
    return this.autoLayout(mode);
  }

  autoLayout(mode = this.layout) {
    this.rememberView();
    this.layout = normalizeLayout(mode);
    this.cleanPlan = this.layout === 'clean' ? cleanGraphPlan(this.notes, this.links) : null;
    this.positions = new Map(Object.entries(this.fullLayout(this.layout)));
    this.structureSignature = layoutSignature(this.notes, this.links, this.layout);
    if (this.undoStack?.length) this.undoStack.at(-1).signature = this.structureSignature;
    this.render();
    this.readableView();
    this.emitViewChange();
    return this.getPositions();
  }

  fullLayout(mode) {
    const positions = this.computeLayout(mode);
    if (!this.lockedIds?.size) { this.layoutIssues = []; return positions; }
    for (const id of this.lockedIds) if (this.positions.has(id)) positions[id] = { ...this.positions.get(id) };
    const result = computeIncrementalLayout(this.notes, this.links, { positions, lockedIds: [...this.lockedIds], movableIds: this.notes.map(note => note.id), nodeWidth: NODE_W, nodeHeight: NODE_H, mode });
    this.layoutIssues = result.issues;
    return result.positions;
  }

  rememberView(view = this.getViewState()) {
    this.undoStack ||= [];
    this.undoStack.push({ view: structuredClone(view), viewKey: this.viewKey, signature: this.structureSignature });
    if (this.undoStack.length > 20) this.undoStack.shift();
  }

  restoreView(view) {
    this.layout = normalizeLayout(view.layout);
    this.cleanPlan = this.layout === 'clean' ? cleanGraphPlan(this.notes, this.links) : null;
    const ids = new Set(this.notes.map(note => note.id));
    this.positions = new Map(Object.entries(view.positions).filter(([id]) => ids.has(id)));
    this.lockedIds = new Set((view.lockedIds || []).filter(id => ids.has(id)));
    this.transform = { ...view.transform };
    this.viewMode = 'manual'; this.hasFitted = Boolean(this.notes.length);
    this.structureSignature = layoutSignature(this.notes, this.links, this.layout);
    this.layoutIssues = [];
    this.render();
    this.callbacks.onPresentationChange?.();
  }

  undoLayout() {
    if (this.preview) return this.cancelPreview();
    const entry = this.undoStack?.pop();
    if (!entry || entry.viewKey !== this.viewKey || entry.signature !== this.structureSignature) return false;
    this.restoreView(entry.view);
    this.emitViewChange();
    return true;
  }

  organize(mode = 'local') {
    if (this.preview) this.cancelPreview();
    const before = this.getViewState();
    if (mode === 'routes') {
      this.cleanPlan = this.layout === 'clean' ? cleanGraphPlan(this.notes, this.links) : null;
      this.render();
      return { movedIds: [], issues: this.layoutIssues || [] };
    }
    const troubled = new Set();
    if(this.layout==='columns')for(const link of this.links){
      const from=this.positions.get(link.from),to=this.positions.get(link.to);
      if(['prerequisite','sequence'].includes(link.type)&&from&&to&&from.x>=to.x&&!this.lockedIds?.has(link.to))troubled.add(link.to);
    }
    for (const link of this.displayLinks()) {
      const route = this.routes?.get(link.id);
      if (route?.obstructed || route?.quality?.overlaps || route?.labelDiagnostic === 'no-clear-space') {
        const id = !this.lockedIds?.has(link.to) ? link.to : link.from;
        troubled.add(id);
      }
    }
    const result = computeIncrementalLayout(this.notes, this.links, { positions: before.positions, lockedIds: [...(this.lockedIds || [])], ...(troubled.size ? { movableIds: [...troubled] } : {}), nodeWidth: NODE_W, nodeHeight: NODE_H, mode: this.layout });
    this.layoutIssues = result.issues;
    if (Object.keys(result.positions).some(id => !before.positions[id] || before.positions[id].x !== result.positions[id].x || before.positions[id].y !== result.positions[id].y)) {
      this.rememberView(before);
      this.positions = new Map(Object.entries(result.positions));
      this.viewMode = 'manual';
      this.render(); this.emitViewChange();
    } else this.render();
    return result;
  }

  // Compatibility with the production entry point. This action deliberately
  // leaves coordinates, camera and selection unchanged.
  organizeConnections() {
    this.organize('routes');
    this.viewMode = 'manual';
    this.hasFitted = this.positions.size > 0;
    this.emitViewChange();
    return this.getPositions();
  }

  previewLayout(mode = this.layout) {
    if (this.preview) this.cancelPreview();
    if (this.viewTimer) this.emitViewChange();
    const before = this.getViewState();
    this.preview = { before, signature: this.structureSignature, viewKey: this.viewKey };
    this.layout = normalizeLayout(mode);
    this.cleanPlan = this.layout === 'clean' ? cleanGraphPlan(this.notes, this.links) : null;
    this.positions = new Map(Object.entries(this.fullLayout(this.layout)));
    this.structureSignature = layoutSignature(this.notes, this.links, this.layout);
    this.render(); this.readableView();
    if (this.previewBar) this.previewBar.hidden = false;
    this.callbacks.onPresentationChange?.();
    return this.getPositions();
  }

  applyPreview() {
    if (!this.preview) return false;
    const { before, signature } = this.preview;
    this.preview = null;
    this.rememberView(before);
    // History validity is tied to the current rendered structure/mode.
    this.undoStack.at(-1).signature = this.structureSignature;
    if (this.previewBar) this.previewBar.hidden = true;
    this.emitViewChange(); this.callbacks.onPresentationChange?.();
    return Boolean(signature);
  }

  cancelPreview() {
    if (!this.preview) return false;
    const { before } = this.preview;
    this.preview = null;
    if (this.previewBar) this.previewBar.hidden = true;
    this.restoreView(before);
    return true;
  }

  toggleLock(id) {
    if (this.preview || !this.positions.has(String(id))) return false;
    this.lockedIds ||= new Set();
    this.rememberView();
    if (this.lockedIds.has(String(id))) this.lockedIds.delete(String(id));
    else this.lockedIds.add(String(id));
    this.render(); this.emitViewChange();
    return this.lockedIds.has(String(id));
  }

  computeLayout(mode) {
    return computeGraphLayout(this.notes, this.links, { mode, nodeWidth: NODE_W, nodeHeight: NODE_H });
  }

  computeColumnLayout() {
    return this.computeLayout('columns');
  }

  computeRadialLayout() {
    return this.computeLayout('branches');
  }

  matches(note) {
    if (!this.query) return true;
    return [note.title, note.content, note.summary, ...(Array.isArray(note.tags) ? note.tags : [])].filter(Boolean).join(' ').toLocaleLowerCase().includes(this.query);
  }

  displayLinks() {
    let links = this.links;
    if(this.layout==='clean'){
      const plan=essentialGraphPlan(this.notes,this.links);
      this.auxiliaryLinkIds=new Set();
      this.representedByLinkId=this.showAuxiliary?new Map():plan.representedByLinkId;
      links=this.showAuxiliary?this.links:plan.visibleLinks;
    }else { this.auxiliaryLinkIds=new Set();this.representedByLinkId=new Map(); }
    if (this.layout === 'sequence' && studySequenceOrder(this.notes, this.links).length) links = links.filter(link => link.type === 'sequence' || this.showAuxiliary);
    const represented = new Set(this.membershipGroups().flatMap(group => group.linkIds));
    return links.filter(link => !represented.has(link.id));
  }

  membershipGroups({force=false}={}) {
    if(!['clean','columns'].includes(this.layout)||(!force&&this.showMembershipLines!==false)||this.showAuxiliary)return [];
    const groups=[];
    for(const module of this.notes.filter(note=>note.frameworkModule)){
      const edges=this.links.filter(link=>link.type==='branch'&&link.from===module.id&&link.to!==module.id);
      const ids=new Set(edges.map(link=>link.to));
      if(ids.size<2)continue;
      // Pure catalog stars keep their arrows unless the user explicitly asks
      // for a box. Automatic grouping requires an inner content/reading map.
      if(!force&&!this.forceMembershipGroups&&!this.links.some(link=>link.type!=='branch'&&ids.has(link.from)&&ids.has(link.to)))continue;
      const points=[module.id,...ids].map(id=>this.positions.get(id));
      if(points.some(point=>!finitePoint(point)))continue;
      const bounds={left:Math.min(...points.map(p=>p.x))-18,right:Math.max(...points.map(p=>p.x))+NODE_W+18,top:Math.min(...points.map(p=>p.y))-34,bottom:Math.max(...points.map(p=>p.y))+NODE_H+18};
      // A group must never imply containment of an unrelated card. Ambiguous
      // multi-membership or overlapping containers fall back to explicit edges.
      if(this.notes.some(note=>note.id!==module.id&&!ids.has(note.id)&&this.positions.has(note.id)&&this.positions.get(note.id).x<bounds.right&&this.positions.get(note.id).x+NODE_W>bounds.left&&this.positions.get(note.id).y<bounds.bottom&&this.positions.get(note.id).y+NODE_H>bounds.top))continue;
      groups.push({id:module.id,title:module.title,bounds,linkIds:edges.map(edge=>edge.id),memberIds:[...ids]});
    }
    return groups.filter((group,index)=>!groups.some((other,j)=>index!==j&&group.bounds.left<other.bounds.right&&group.bounds.right>other.bounds.left&&group.bounds.top<other.bounds.bottom&&group.bounds.bottom>other.bounds.top));
  }

  setShowMembership(value) { this.showMembershipLines=Boolean(value);this.forceMembershipGroups=!value; this.render(); }

  setShowAuxiliary(value) {
    this.showAuxiliary = Boolean(value);
    this.render();
    return this;
  }

  render() {
    this.empty.hidden = this.notes.length > 0;
    this.hint.hidden = this.notes.length === 0;
    this.root.classList.toggle('is-connecting', Boolean(this.connecting));
    this.root.classList.toggle('is-clean',this.layout==='clean');
    this.hideEdgeTooltip();
    this.root.classList.toggle('has-selection', Boolean(this.selectedId));
    this.edgeLayer.replaceChildren();
    this.edgeLabelLayer.replaceChildren();
    this.nodeLayer.replaceChildren();
    this.groupLayer?.replaceChildren();
    for(const group of this.membershipGroups()){
      if(!this.groupLayer)break;
      const b=group.bounds;
      const box=element('g',{'class':`kg-membership-group${group.id===this.selectedId||group.memberIds.includes(this.selectedId)?' is-related':''}`,'data-module-id':group.id,'data-represented-link-ids':JSON.stringify(group.linkIds),'role':'group','aria-label':`${group.title}：模块卡片及 ${group.memberIds.length} 张成员卡片，归属由分组框表示`});
      box.append(element('rect',{x:b.left,y:b.top,width:b.right-b.left,height:b.bottom-b.top,rx:15}));
      box.append(element('text',{x:b.left+14,y:b.top+20},`模块：${group.title} · ${group.memberIds.length} 个成员`));
      this.groupLayer.append(box);
    }
    const matches = new Set(this.notes.filter(note => this.matches(note)).map(note => note.id));
    this.sequenceSteps = new Map((this.layout==='sequence'?studySequenceOrder(this.notes,this.links):[]).map((id,index)=>[id,index+1]));
    const displayLinks = this.displayLinks();
    const related = new Set();
    for (const link of this.links) {
      if (link.from === this.selectedId) related.add(link.to);
      if (link.to === this.selectedId) related.add(link.from);
    }
    this.routes = routeGraphEdges({
      nodes: this.notes.map(note => ({ id: note.id, ...this.positions.get(note.id) })),
      links: displayLinks.map(link => {const label=this.layout==='clean'?relationLabelGeometry(relationCaption(link)):labelContent(link);return { ...link, labelWidth: label.width, labelHeight: label.height };}),
      nodeWidth: NODE_W, nodeHeight: NODE_H,
      spreadConnections:this.layout==='clean',preferStraightSequence:this.layout==='sequence',
    });
    this.edgeCurves = [];
    this.edgeCurveCards = this.notes.map(note => {
      const point = this.positions.get(note.id);
      return {left:point.x,right:point.x+NODE_W,top:point.y,bottom:point.y+NODE_H};
    });
    for (const link of displayLinks) this.renderEdge(link, this.routes.get(link.id), matches);
    for (const note of this.notes) this.renderNode(note, matches.has(note.id), related.has(note.id));
    this.applyTransform();
    this.updateDiagnostics();
    this.callbacks.onPresentationChange?.();
  }

  updateDiagnostics() {
    if (!this.qualityPanel) return;
    const items = [...(this.layoutIssues || []), ...relationDiagnostics(this.notes, this.links)].map(issue => ({ message: issue.message, id: issue.nodeIds?.[0] }));
    for (const link of this.displayLinks()) {
      const route = this.routes?.get(link.id);
      const from = this.notes.find(note => note.id === link.from)?.title || link.from;
      const to = this.notes.find(note => note.id === link.to)?.title || link.to;
      if (route?.obstructed) items.push({ message: `连线受阻：${from} → ${to}；可重新整理附近卡片`, id: link.from });
      if (route?.labelDiagnostic === 'no-clear-space') items.push({ message: `${from} → ${to}：${RELATIONS[link.type]?.label || link.type}${link.label ? ' · ' + link.label : ''}（图上说明暂收起，可悬停连线）`, id: link.from });
    }
    this.qualityPanel.replaceChildren();
    const summary = document.createElement('summary');
    summary.textContent = items.length ? `排版提示 ${items.length}` : '关系说明';
    this.qualityPanel.append(summary);
    const tip = document.createElement('p');
    tip.textContent = '内容关系全部保留。分组框表示归属；同向同端点的学习顺序合并到科学连线，悬停可读完整说明。可在已有菜单查看全部关系。';
    this.qualityPanel.append(tip);
    for (const item of items) {
      const button = document.createElement('button');
      button.textContent = item.message;
      button.onclick = () => this.focus(item.id);
      this.qualityPanel.append(button);
    }
  }

  renderEdge(link, route, matches) {
    if (!route) return;
    const type = Object.hasOwn(RELATIONS, link.type) ? link.type : 'extends';
    const config = RELATIONS[type];
    const selected = link.from === this.selectedId || link.to === this.selectedId;
    const dim = Boolean(this.query && (!matches.has(link.from) || !matches.has(link.to)));
    const from = this.notes.find(note => note.id === link.from)?.title || '笔记';
    const to = this.notes.find(note => note.id === link.to)?.title || '笔记';
    const represented=this.representedByLinkId?.get(String(link.id))||[];
    const extra=represented.map(edge=>`同时表示${RELATIONS[edge.type]?.label||edge.type}：${edge.label||'按已有安排接着学习'}`).join('\n');
    const detail = from + (config.arrow ? ' → ' : ' ↔ ') + to + '\n' + config.label + (link.label ? ' · ' + link.label : '') + (extra?'\n'+extra:'') + (route.obstructed ? '\n连线受阻，可重新整理附近卡片' : '');
    const classes = ['kg-edge', selected ? 'is-related' : '', dim ? 'is-dim' : '',this.auxiliaryLinkIds?.has(String(link.id))?'is-auxiliary':'', route.obstructed ? 'is-obstructed' : ''].filter(Boolean).join(' ');
    const group = element('g', { class: classes, style:`--kg-edge-color:${config.color};--kg-edge-width:${config.width||2.3}px`, 'data-link-id': String(link.id ?? ''),'data-represented-link-ids':JSON.stringify(represented.map(edge=>edge.id)), 'data-relation': type, tabindex: '0', role: 'img', 'aria-label': detail });
    group.dataset.detail = detail;
    const common = { d: route.path, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    const casing = element('path', { ...common, class: 'kg-edge-casing', 'stroke-width': String((config.width||2)+3), 'vector-effect': 'non-scaling-stroke' });
    const visible = element('path', { ...common, class: 'kg-edge-line', stroke: config.color, 'stroke-width': String(config.width || 1.45), 'stroke-dasharray': config.dash || undefined, 'vector-effect': 'non-scaling-stroke', 'marker-end': config.arrow ? `url(#${this.uid}-${type})` : undefined });
    const hitArea = element('path', { ...common, class: 'kg-edge-hit', stroke: 'transparent', 'stroke-width': '14', 'vector-effect': 'non-scaling-stroke' });
    group.append(casing, visible, hitArea);
    const labelObstacles = [...this.routes].filter(([id,other])=>id!==link.id&&other.labelVisible).map(([,other])=>({left:other.label.x-other.labelWidth/2,right:other.label.x+other.labelWidth/2,top:other.label.y-other.labelHeight/2,bottom:other.label.y+other.labelHeight/2}));
    this.edgeCurves.push({points:route.points,paths:[casing,visible,hitArea],obstacles:[...this.edgeCurveCards,...labelObstacles]});
    if(route.labelVisible&&route.labelLeaderPath)group.append(element('path',{d:route.labelLeaderPath,class:'kg-label-leader',fill:'none','vector-effect':'non-scaling-stroke','pointer-events':'none'}));
    this.edgeLayer.append(group);
    if (link.hideLabel || !route.labelVisible) return;
    const labelGroup = element('g', { class: ['kg-edge-label', selected ? 'is-related' : '', dim ? 'is-dim' : ''].filter(Boolean).join(' '), style:`--kg-edge-color:${config.color}`, 'data-link-id': String(link.id ?? ''), 'data-x': route.label.x, 'data-y': route.label.y, 'pointer-events': 'none', 'aria-hidden': 'true' });
    const label = this.layout==='clean'?relationLabelGeometry(relationCaption(link)):labelContent(link);
    labelGroup.append(element('rect', { x: -label.width / 2, y: -label.height / 2, width: label.width, height: label.height, rx: 5 }));
    if(this.layout==='clean'){
      label.lines.forEach((line,index)=>labelGroup.append(element('text',{x:0,y:(index-(label.lines.length-1)/2)*16+4,'text-anchor':'middle'},line)));
    }else{
      labelGroup.append(element('text', { x: 0, y: label.short ? -4 : 4, 'text-anchor': 'middle' }, label.type));
      if(label.short)labelGroup.append(element('text', { class: 'kg-edge-caption', x: 0, y: 12, 'text-anchor': 'middle' }, label.short));
    }
    this.edgeLabelLayer.append(labelGroup);
  }

  hideEdgeTooltip() {
    if (!this.edgeTooltip) return;
    this.edgeTooltip.hidden = true;
    for (const layer of [this.edgeLayer, this.edgeLabelLayer]) {
      layer?.querySelectorAll('.is-active').forEach(node => node.classList.remove('is-active'));
    }
  }

  onEdgeEnter(event) {
    const edge = event.target.closest?.('.kg-edge');
    if (!edge || this.pointer || this.connecting) return;
    this.hideEdgeTooltip();
    edge.classList.add('is-active');
    for (const label of this.edgeLabelLayer.children) {
      if (label.dataset.linkId === edge.dataset.linkId) label.classList.add('is-active');
    }
    this.edgeTooltip.textContent = edge.dataset.detail;
    this.edgeTooltip.hidden = false;
    const root = this.root.getBoundingClientRect();
    const edgeBox = edge.getBoundingClientRect();
    const x = event.type === 'focusin' ? edgeBox.x + edgeBox.width / 2 : event.clientX;
    const y = event.type === 'focusin' ? edgeBox.y + edgeBox.height / 2 : event.clientY;
    const width = this.edgeTooltip.offsetWidth, height = this.edgeTooltip.offsetHeight;
    this.edgeTooltip.style.left = clamp(x - root.x + 14, 8, Math.max(8, root.width - width - 8)) + 'px';
    this.edgeTooltip.style.top = clamp(y - root.y + 14, 8, Math.max(8, root.height - height - 8)) + 'px';
  }

  onEdgeLeave(event) {
    const edge = event.target.closest?.('.kg-edge');
    if (!edge || edge === event.relatedTarget?.closest?.('.kg-edge')) return;
    if (event.type === 'pointerout' && document.activeElement === edge) return;
    this.hideEdgeTooltip();
  }

  renderNode(note, matched, related) {
    const position = this.positions.get(note.id);
    if (!position) return;
    const selected = note.id === this.selectedId;
    const source = note.id === this.connecting?.from;
    const studyStep = this.sequenceSteps?.get(note.id);
    const locked = this.lockedIds?.has(note.id);
    const classes = ['kg-node',studyStep?'is-study-step':'', note.frameworkModule ? 'is-framework-module' : '', note.contextNode||note.graphContext ? 'is-context' : '', locked ? 'is-locked' : '', selected ? 'is-selected' : '', related ? 'is-related' : '', source ? 'is-source' : '', this.query && !matched && !selected ? 'is-dim' : '', this.query && matched ? 'is-match' : ''].filter(Boolean).join(' ');
    const group = element('g', { class: classes, transform: `translate(${position.x} ${position.y})`, 'data-node-id': note.id, 'data-study-step': studyStep, tabindex: '0', role: 'button', 'aria-label': `${note.title || '未命名笔记'}，${NOTE_TYPES[note.type]?.[0] || '笔记'}`, 'aria-pressed': String(selected) });
    const type = note.frameworkModule ? ['模块', '▤'] : (NOTE_TYPES[note.type] || NOTE_TYPES.note);
    const status = STATUS[note.status] || ['待整理', '#87908b'];
    const highlights=Array.isArray(note.displayHighlights)?note.displayHighlights.slice(0,2):[];
    group.append(element('title', {}, `${note.title || '未命名笔记'}\n${highlights.join('\n')}\n${note.caption || `${type[0]} · ${status[0]}`}`));
    group.append(element('rect', { class: 'kg-node-focus', x: -4, y: -4, width: NODE_W + 8, height: NODE_H + 8, rx: 17 }));
    group.append(element('rect', { class: 'kg-node-card', x: 0, y: 0, width: NODE_W, height: NODE_H, rx: 13 }));
    group.append(element('rect', { class: 'kg-node-icon-bg', x: 14, y: 12, width: 22, height: 22, rx: 7 }));
    group.append(element('text', { class: 'kg-node-icon', x: 25, y: 28, 'text-anchor': 'middle' }, studyStep ? String(studyStep).padStart(2, '0') : type[1]));
    const membership=this.links.find(edge=>edge.type==='branch'&&edge.to===note.id);
    const memberLabel=String(membership?.label||'').trim();
    const role=/^(?:基础|先备|前置)/.test(memberLabel)?'基础补充':/^(?:后续|拓展|延伸)/.test(memberLabel)?'后续补充':null;
    group.append(element('text', { class: 'kg-node-type', x: 43, y: 27 }, studyStep?'学习顺序':role||`${type[0]}${note.displayHighlightSource?' · '+note.displayHighlightSource:''}`));
    const title = element('text', { class: 'kg-node-title', x: 15, y: 54 });
    const lines = splitTitle(note.title);
    lines.forEach((line, index) => title.append(element('tspan', { x: 15, y: lines.length === 1 ? 60 : 53 + index * 21 }, line)));
    group.append(title);
    highlights.forEach((text,index)=>group.append(element('text',{class:'kg-node-summary',x:15,y:103+index*18},clippedText(text,NODE_W-34))));
    if (note.caption) {
      const caption=this.layout==='clean'&&!note.frameworkModule?note.caption.split(' · ')[0]:note.caption;
      group.append(element('text', { class: 'kg-node-caption', x: 15, y: NODE_H-17 }, clippedText(caption,NODE_W-38,11)));
    }
    if (source) group.append(element('circle', { class: 'kg-source-halo', cx: NODE_W - 17, cy: NODE_H - 15, r: 4 }));
    this.nodeLayer.append(group);
  }

  applyTransform() {
    const { x, y, scale } = this.transform;
    this.world.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`);
    this.defs?.querySelectorAll('marker').forEach(marker=>{
      marker.setAttribute('markerWidth',String(7.5/scale));
      marker.setAttribute('markerHeight',String(7.5/scale));
    });
    // Curve size follows the viewport; zooming only repaints the same routes.
    for (const curve of this.edgeCurves || []) {
      if (curve.scale === scale) continue;
      const path = smoothEdgePath(curve.points,{scale,obstacles:curve.obstacles});
      for (const layer of curve.paths) layer.setAttribute('d',path);
      curve.scale = scale;
    }
    for (const label of this.edgeLabelLayer.children) {
      label.setAttribute('transform', `translate(${label.dataset.x} ${label.dataset.y})`);
    }
    this.scaleLabel.textContent = `${Math.round(scale * 100)}%`;
    this.root.style.setProperty('--kg-grid-size', `${Math.max(12, 24 * scale)}px`);
    this.root.style.setProperty('--kg-grid-x', `${x}px`);
    this.root.style.setProperty('--kg-grid-y', `${y}px`);
  }

  eventPoint(event) {
    const bounds = this.svg.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  onPointerDown(event) {
    if (event.button !== 0 || this.pointer) return;
    const lockId = event.target.closest?.('[data-lock-id]')?.dataset.lockId;
    if (lockId) { event.preventDefault(); this.toggleLock(lockId); return; }
    const edge = event.target.closest?.('.kg-edge');
    if (edge) { edge.focus({ preventScroll: true }); event.preventDefault(); return; }
    this.hideEdgeTooltip();
    const id = event.target.closest?.('[data-node-id]')?.dataset.nodeId;
    const point = this.eventPoint(event);
    this.pointer = { pointerId: event.pointerId, id: id || null, start: point, last: point, moved: false, original: id ? { ...this.positions.get(id) } : { x: this.transform.x, y: this.transform.y } };
    this.svg.setPointerCapture(event.pointerId);
    this.svg.classList.add(id ? 'is-node-dragging' : 'is-panning');
    if (id) this.svg.focus({ preventScroll: true });
    event.preventDefault();
  }

  onPointerMove(event) {
    const pointer = this.pointer;
    if (!pointer || event.pointerId !== pointer.pointerId) return;
    const point = this.eventPoint(event);
    const dx = point.x - pointer.start.x;
    const dy = point.y - pointer.start.y;
    if (Math.hypot(dx, dy) > 4) pointer.moved = true;
    if (!pointer.moved) return;
    if (pointer.id && !this.connecting && !this.preview && !this.lockedIds?.has(pointer.id)) {
      this.viewMode = 'manual';
      this.positions.set(pointer.id, { x: pointer.original.x + dx / this.transform.scale, y: pointer.original.y + dy / this.transform.scale });
      this.render();
    } else if (!pointer.id) {
      this.viewMode = 'manual';
      this.transform.x = pointer.original.x + dx;
      this.transform.y = pointer.original.y + dy;
      this.applyTransform();
    }
    pointer.last = point;
  }

  onPointerUp(event, cancelled = false) {
    const pointer = this.pointer;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    // A release can arrive beyond the final pointermove. Keep the exact drop
    // position, then finish routing there without invoking any card layout.
    if (!cancelled && pointer.id && !this.connecting && !this.preview && !this.lockedIds?.has(pointer.id)
      && pointer.start && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      const point = this.eventPoint(event), dx = point.x - pointer.start.x, dy = point.y - pointer.start.y;
      if (pointer.moved || Math.hypot(dx, dy) > 4) {
        pointer.moved = true;
        this.viewMode = 'manual';
        this.positions.set(pointer.id, { x: pointer.original.x + dx / this.transform.scale, y: pointer.original.y + dy / this.transform.scale });
      }
    }
    this.pointer = null;
    this.svg.classList.remove('is-node-dragging', 'is-panning');
    if (this.svg.hasPointerCapture(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
    if (cancelled) {
      if (pointer.id && pointer.moved && !this.connecting) {
        this.positions.set(pointer.id, pointer.original);
        this.render();
      } else if (!pointer.id && pointer.moved) {
        this.transform.x = pointer.original.x;
        this.transform.y = pointer.original.y;
        this.applyTransform();
      }
      return;
    }
    if (pointer.id && pointer.moved && !this.connecting && !this.lockedIds?.has(pointer.id) && !this.preview) {
      this.render();
      this.callbacks.onPositionChange?.(pointer.id, { ...this.positions.get(pointer.id) });
    }
    if (pointer.moved && (!pointer.id || (!this.connecting && !this.lockedIds?.has(pointer.id)))) this.emitViewChange();
    if (pointer.id && !pointer.moved) this.selectNode(pointer.id);
  }

  selectNode(id) {
    if (this.connecting) {
      if (id === this.connecting.from) return;
      const connection = { from: this.connecting.from, to: id, type: this.connecting.type };
      this.cancelConnect();
      this.callbacks.onConnect?.(connection);
      return;
    }
    this.selectedId = id;
    this.render();
    this.callbacks.onSelect?.(id);
  }

  onWheel(event) {
    event.preventDefault();
    const point = this.eventPoint(event);
    const multiplier = Math.exp(-clamp(event.deltaY, -150, 150) * .0015);
    this.zoomAt(this.transform.scale * multiplier, point, { notify: false });
    this.scheduleViewChange();
  }

  onKeyDown(event) {
    const lockId = event.target.closest?.('[data-lock-id]')?.dataset.lockId;
    if (lockId && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); this.toggleLock(lockId); return; }
    if (event.key === 'Escape') { if (this.preview) this.cancelPreview(); else this.cancelConnect(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); this.undoLayout(); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); this.zoomIn(); }
    else if (event.key === '-') { event.preventDefault(); this.zoomOut(); }
    else if (event.key === '0') { event.preventDefault(); this.fit(); }
    else if (event.key === 'Enter' || event.key === ' ') {
      const id = event.target.closest?.('[data-node-id]')?.dataset.nodeId;
      if (id) { event.preventDefault(); this.selectNode(id); }
    }
  }

  zoomAt(scale, point = { x: this.width / 2, y: this.height / 2 }, { notify = true } = {}) {
    this.viewMode = 'manual';
    const oldScale = this.transform.scale;
    this.hideEdgeTooltip();
    const newScale = clamp(scale, .12, 2.8);
    this.transform.x = point.x - (point.x - this.transform.x) * newScale / oldScale;
    this.transform.y = point.y - (point.y - this.transform.y) * newScale / oldScale;
    this.transform.scale = newScale;
    this.applyTransform();
    if (notify) this.emitViewChange();
    return this.transform.scale;
  }

  zoomIn() { return this.zoomAt(this.transform.scale * 1.2); }
  zoomOut() { return this.zoomAt(this.transform.scale / 1.2); }

  graphBounds() {
    const values = Array.from(this.positions.values());
    const routes = Array.from(this.routes?.values() || []);
    const groups=this.membershipGroups();
    return {
      minX: Math.min(...values.map(position => position.x), ...routes.map(route => route.bounds.minX),...groups.map(group=>group.bounds.left)),
      minY: Math.min(...values.map(position => position.y), ...routes.map(route => route.bounds.minY),...groups.map(group=>group.bounds.top)),
      maxX: Math.max(...values.map(position => position.x + NODE_W), ...routes.map(route => route.bounds.maxX),...groups.map(group=>group.bounds.right)),
      maxY: Math.max(...values.map(position => position.y + NODE_H), ...routes.map(route => route.bounds.maxY),...groups.map(group=>group.bounds.bottom)),
    };
  }

  setHint(text) {
    this.hintText = text;
    this.updateHint();
  }

  updateHint() {
    this.hint.textContent = this.readableOverflow
      ? `${this.hintText} · 拖动画布查看其余内容`
      : this.hintText;
  }

  fit({ paddingX, paddingY } = {}, notify = true) {
    if (!this.positions.size) return;
    const { minX, minY, maxX, maxY } = this.graphBounds();
    const bounds = this.container.getBoundingClientRect();
    this.width = bounds.width || this.width;
    this.height = bounds.height || this.height;
    const marginX = paddingX ?? (this.width < 500 ? 26 : 72);
    const marginY = paddingY ?? 70;
    const scale = Math.max(Number.EPSILON, Math.min((this.width - marginX * 2) / Math.max(NODE_W, maxX - minX), (this.height - marginY * 2) / Math.max(NODE_H, maxY - minY), 1.12));
    this.transform = { x: this.width / 2 - (minX + maxX) * scale / 2, y: this.height / 2 - (minY + maxY) * scale / 2, scale };
    this.hasFitted = true;
    this.viewMode = 'fit';
    this.fitPadding = { paddingX, paddingY };
    this.readableOverflow = false;
    this.updateHint();
    this.applyTransform();
    if (notify) this.emitViewChange();
  }

  /** Show the complete graph when labels remain legible. Large graphs start
   * at a readable scale near a stable structural root; fit() is the explicit
   * overview. Selecting or editing a note never chooses a different viewport.
   */
  readableView(id = null) {
    if (!this.positions.size) return;
    const bounds = this.container.getBoundingClientRect();
    this.width = bounds.width || this.width;
    this.height = bounds.height || this.height;
    const { minX, minY, maxX, maxY } = this.graphBounds();
    const overviewScale = Math.min((this.width - 64) / Math.max(NODE_W, maxX - minX), (this.height - 116) / Math.max(NODE_H, maxY - minY));
    const marginX=this.layout==='clean'&&this.width<600?24:32;
    const maximumScale=this.layout==='clean'?Math.min(1.12,Math.max(.12,(this.width-marginX*2)/NODE_W),Math.max(.12,(this.height-96)/NODE_H)):1.12;
    const minimumScale=this.layout==='clean'?Math.min(.78,maximumScale):READABLE_MIN_SCALE;
    const scale = clamp(overviewScale, minimumScale, maximumScale);
    this.readableOverflow = overviewScale < minimumScale;
    if (!this.readableOverflow) {
      this.transform = { x: this.width / 2 - (minX + maxX) * scale / 2, y: this.height / 2 - (minY + maxY) * scale / 2, scale };
    } else if(this.layout==='clean'){
      const candidates=this.notes.filter(note=>!note.graphContext&&!note.contextNode);
      const first=(candidates.length?candidates:this.notes).map(note=>this.positions.get(note.id)).filter(Boolean).sort((a,b)=>a.x-b.x||a.y-b.y)[0];
      const start=first||{x:minX,y:minY};
      this.transform={x:marginX-start.x*scale,y:72-start.y*scale,scale};
    } else {
      const structural = this.displayLinks().filter(link => link.from !== link.to && ['sequence', 'branch', 'prerequisite', 'extends'].includes(link.type));
      const incoming = new Set(structural.map(link => link.to));
      const outgoing = new Map(), branches = new Map();
      for (const link of structural) {
        outgoing.set(link.from, (outgoing.get(link.from) || 0) + 1);
        if (link.type === 'branch') branches.set(link.from, (branches.get(link.from) || 0) + 1);
      }
      const roots = [...this.notes].sort((a, b) => Number(incoming.has(a.id)) - Number(incoming.has(b.id))
        || (branches.get(b.id) || 0) - (branches.get(a.id) || 0) || (outgoing.get(b.id) || 0) - (outgoing.get(a.id) || 0)
        || this.positions.get(a.id).x - this.positions.get(b.id).x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const firstStep = this.layout === 'sequence' ? studySequenceOrder(this.notes, this.links)[0] : null;
      const preferredId = id != null && this.positions.has(String(id)) ? String(id) : firstStep || roots[0]?.id;
      const position = this.positions.get(preferredId);
      if (!position) return;
      const anchorX = this.layout === 'branches' ? this.width / 2 : Math.max(NODE_W * scale / 2 + 24, this.width / 4);
      this.transform = { x: anchorX - (position.x + NODE_W / 2) * scale, y: this.height / 2 - (position.y + NODE_H / 2) * scale, scale };
    }
    this.hasFitted = true;
    this.viewMode = 'readable';
    this.updateHint();
    this.applyTransform();
  }

  focus(id) {
    const position = this.positions.get(String(id));
    if (!position) return;
    const scale = clamp(Math.max(.85, this.transform.scale), .85, 1.4);
    this.transform = { x: this.width / 2 - (position.x + NODE_W / 2) * scale, y: this.height / 2 - (position.y + NODE_H / 2) * scale, scale };
    this.viewMode = 'manual';
    this.applyTransform();
    this.emitViewChange();
  }

  startConnect(sourceId, type = 'extends') {
    const id = String(sourceId);
    if (!this.positions.has(id)) return false;
    this.connecting = { from: id, type: Object.hasOwn(RELATIONS, type) ? type : 'extends' };
    const title = this.notes.find(note => note.id === id)?.title || '当前笔记';
    this.bannerText.textContent = `从「${title}」建立${RELATIONS[this.connecting.type].label}关系：点击另一个节点`;
    this.banner.hidden = false;
    this.callbacks.onConnectionChange?.({ ...this.connecting });
    this.render();
    this.svg.focus({ preventScroll: true });
    return true;
  }

  cancelConnect() {
    const wasConnecting = Boolean(this.connecting);
    this.connecting = null;
    this.banner.hidden = true;
    if (wasConnecting) {
      this.callbacks.onConnectionChange?.(null);
      this.render();
    }
  }

  isConnecting() { return Boolean(this.connecting); }

  destroy() {
    if (this.preview) this.cancelPreview();
    if (this.viewTimer) this.emitViewChange();
    this.resizeObserver.disconnect();
    for (const [name, handler] of Object.entries(this.handlers)) this.svg.removeEventListener(name, handler);
    this.root.remove();
  }
}

export { RELATIONS as GRAPH_RELATIONS };
