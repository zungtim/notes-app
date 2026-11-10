// Pure, deterministic card geometry. Notebook positions and presentation state
// never enter the hierarchy; auxiliary relations remain visible cross-links.
import { essentialGraphPlan } from './graph-presentation.js';

const STRUCTURAL = new Set(['branch', 'prerequisite', 'extends']);
const WEIGHT = { branch: 12, prerequisite: 4, extends: 2 };
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const positive = (value, fallback, minimum) => Number.isFinite(Number(value)) ? Math.max(minimum, Number(value)) : fallback;
const modeName = mode => mode === 'clean' ? 'clean' : mode === 'sequence' ? 'sequence' : ['branches', 'radial'].includes(mode) ? 'branches' : 'columns';

const readingCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

// Labels reserve the same world-space rectangle that the renderer draws.
export function relationLabelGeometry(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const lines = [], limit = 192;
  let current = '', width = 0, widest = 0;
  for (const char of Array.from(text)) {
    const size = /[\u0000-\u00ff]/.test(char) ? 6.7 : 12;
    if (current && width + size > limit) {
      lines.push(current); widest = Math.max(widest, width); current = ''; width = 0;
      if (lines.length === 4) { lines[3] = Array.from(lines[3]).slice(0, -1).join('') + '…'; break; }
    }
    current += char; width += size;
  }
  if (current && lines.length < 4) { lines.push(current); widest = Math.max(widest, width); }
  return { lines, width: Math.max(56, Math.ceil(widest + 20)), height: Math.max(28, lines.length * 16 + 12) };
}

function graphInput(notes, links) {
  const ids = [...new Set((Array.isArray(notes) ? notes : []).filter(note => note && note.id != null).map(note => String(note.id)))].sort(compare);
  const known = new Set(ids), edges = new Map();
  for (const link of Array.isArray(links) ? links : []) {
    if (!link || link.from == null || link.to == null) continue;
    const from = String(link.from), to = String(link.to), type = String(link.type || 'extends');
    if (!known.has(from) || !known.has(to)) continue;
    const key = JSON.stringify([from, to, type]);
    edges.set(key, { from, to, type });
  }
  return { ids, links: [...edges].sort(([a], [b]) => compare(a, b)).map(([, edge]) => edge) };
}

/** Only changes to visible nodes, relation endpoints/types or layout mode count.
 * Array order, duplicate edges, edge ids, selection, prose, status and saved
 * coordinates do not invalidate a manual arrangement during an editing session.
 */
export function layoutSignature(notes = [], links = [], mode = 'columns') {
  const graph = graphInput(notes, links);
  return JSON.stringify([modeName(mode), graph.ids, graph.links.map(({ from, to, type }) => [from, to, type])]);
}

// Only explicit, valid sequence edges define the study path. Branch membership
// and scientific cross-references deliberately cannot choose its reading order.
function sequenceOrder(graph) {
  const edges = graph.links.filter(edge => edge.type === 'sequence' && edge.from !== edge.to);
  if (!edges.length) return [];
  const involved = new Set(edges.flatMap(edge => [edge.from, edge.to]));
  const ids = graph.ids.filter(id => involved.has(id));
  const children = new Map(ids.map(id => [id, []]));
  const incoming = new Map(ids.map(id => [id, 0]));
  for (const edge of edges) {
    children.get(edge.from).push(edge.to);
    incoming.set(edge.to, incoming.get(edge.to) + 1);
  }
  const available = ids.filter(id => incoming.get(id) === 0);
  const pending = new Set(ids), ordered = [];
  while (pending.size) {
    // A cyclic import has no full topological order. Break only the display
    // deadlock by stable id; retain every card and leave stored edges untouched.
    const id = available.length ? available.shift() : pending.values().next().value;
    if (!pending.delete(id)) continue;
    ordered.push(id);
    for (const child of children.get(id)) {
      if (!pending.has(child)) continue;
      incoming.set(child, incoming.get(child) - 1);
      if (incoming.get(child) === 0) available.push(child);
    }
    available.sort(compare);
  }
  return ordered;
}

/** Return the deterministic reading order of nodes participating in explicit,
 * valid, non-self sequence edges. Empty or unrelated graphs return []. Cycles
 * receive a stable display order without mutating notebook relationships.
 */
export function studySequenceOrder(notes = [], links = []) {
  return sequenceOrder(graphInput(notes, links));
}

function connectedGroups(ids, edges) {
  const neighbors = new Map(ids.map(id => [id, []]));
  for (const { from, to } of edges) {
    neighbors.get(from).push(to); neighbors.get(to).push(from);
  }
  const unseen = new Set(ids), groups = [];
  for (const id of ids) {
    if (!unseen.delete(id)) continue;
    const group = [id];
    for (let i = 0; i < group.length; i++) for (const child of neighbors.get(group[i])) {
      if (unseen.delete(child)) group.push(child);
    }
    groups.push(group.sort(compare));
  }
  return groups;
}

const LOGIC_PRIORITY = new Map([['prerequisite', 0], ['applies', 1], ['evidence', 2], ['extends', 3], ['branch', 4], ['sequence', 5]]);
const reaches = (children, from, target) => {
  const seen = new Set([from]), pending = [from];
  for (let i = 0; i < pending.length; i++) {
    if (pending[i] === target) return true;
    for (const child of children.get(pending[i]) || []) if (!seen.has(child)) { seen.add(child); pending.push(child); }
  }
  return false;
};

/** Select existing content relationships, not an invented learning chain.
 * Multiple prerequisites and applications can converge on the same card.
 * Membership remains a separate, explicit relationship; reading
 * sequence is navigation, except in a component with no content relationships.
 * Cycles, duplicate arrows and navigation remain accessible as auxiliary links.
 */
export function cleanGraphPlan(notes = [], links = []) {
  const graph = graphInput(notes, links), known = new Set(graph.ids), unique = new Map(), duplicateLinks = [];
  for (const edge of Array.isArray(links) ? links : []) {
    if (!edge || edge.from == null || edge.to == null) continue;
    const from = String(edge.from), to = String(edge.to), type = String(edge.type || 'extends');
    if (!known.has(from) || !known.has(to) || from === to) continue;
    const value = { ...edge, from, to, type }, key = JSON.stringify([from, to, type]);
    const previous = unique.get(key);
    // Duplicate ids or labels do not influence geometry. Pick a stable copy so
    // the caller can still render the original explanatory fields and edge id.
    if (!previous) unique.set(key, value);
    else if (compare(JSON.stringify([value.id ?? '', value.label ?? '']), JSON.stringify([previous.id ?? '', previous.label ?? ''])) < 0) {
      unique.set(key, value); duplicateLinks.push(previous);
    } else duplicateLinks.push(value);
  }
  const sequenceEdges = [...unique.values()].filter(edge => edge.type === 'sequence');
  const participantSet = new Set(sequenceEdges.flatMap(edge => [edge.from, edge.to]));
  const participants = graph.ids.filter(id => participantSet.has(id)), navigationComponent = new Map();
  const baseSequence = connectedGroups(participants, sequenceEdges).flatMap((ids, index) => {
    ids.forEach(id => navigationComponent.set(id, index));
    const members = new Set(ids);
    return sequenceOrder({ ids, links: sequenceEdges.filter(edge => members.has(edge.from)) });
  });
  const navigationIndex = new Map(baseSequence.map((id, index) => [id, index]));
  const navigationDirection = edge => navigationComponent.has(edge.from)
    && navigationComponent.get(edge.from) === navigationComponent.get(edge.to)
    ? navigationIndex.get(edge.to) > navigationIndex.get(edge.from) ? 0 : 2 : 1;
  // When existing content forms a feedback cycle, a known reading order is a
  // tie-breaker between equal relation types, not a new scientific dependency.
  // Forward content survives before a return-to-question extension is offered.
  const candidates = [...unique.values()].sort((a, b) => (LOGIC_PRIORITY.get(a.type) ?? 6) - (LOGIC_PRIORITY.get(b.type) ?? 6)
    || navigationDirection(a) - navigationDirection(b)
    || compare(a.from, b.from) || compare(a.to, b.to) || compare(a.type, b.type));
  const relevant = candidates.filter(edge => LOGIC_PRIORITY.has(edge.type) || edge.type === 'parallel');
  const groups = connectedGroups(graph.ids, relevant), component = new Map();
  groups.forEach((ids, i) => ids.forEach(id => component.set(id, i)));
  const contentGroups = new Set(relevant.filter(edge => edge.type !== 'sequence').map(edge => component.get(edge.from)));
  const children = new Map(graph.ids.map(id => [id, new Set()]));
  const primaryLinks = [], auxiliaryLinks = [];
  for (const edge of candidates) {
    if (edge.type === 'parallel') { primaryLinks.push(edge); continue; }
    if (!LOGIC_PRIORITY.has(edge.type) || edge.type === 'sequence' && contentGroups.has(component.get(edge.from))
      || reaches(children, edge.to, edge.from)) { auxiliaryLinks.push(edge); continue; }
    // Two stored types between the same cards explain different facts. The
    // geometric hierarchy may choose one strongest constraint internally, but
    // the renderer must still receive both explanations. In particular, an
    // M→A membership plus A→B prerequisite never replaces M→B membership.
    primaryLinks.push(edge); children.get(edge.from).add(edge.to);
  }
  auxiliaryLinks.push(...duplicateLinks.sort((a, b) => compare(JSON.stringify([a.from, a.to, a.type, a.id ?? '', a.label ?? '']), JSON.stringify([b.from, b.to, b.type, b.id ?? '', b.label ?? '']))));
  return { primaryLinks, auxiliaryLinks, sequenceOrder: baseSequence };
}

function cardGrid(ids, settings, top = 0) {
  const { nodeWidth, nodeHeight, columnGap, rowGap } = settings;
  return new Map(ids.map((id, i) => [id, {
    x: i % 3 * (nodeWidth + columnGap),
    y: top + Math.floor(i / 3) * (nodeHeight + Math.max(80, rowGap)),
  }]));
}

function logicHierarchy(graph, notes, navigation, sourceLinks) {
  const noteById = new Map((Array.isArray(notes) ? notes : []).filter(note => note?.id != null).map(note => [String(note.id), note]));
  const foundationTags = new Set(['基础', '基础知识', '先备知识', '前置知识', 'foundation']);
  const foundations = new Set([...noteById].filter(([, note]) => Array.isArray(note.tags)
    && note.tags.some(tag => foundationTags.has(String(tag).toLowerCase()))).map(([id]) => id));
  const extensionTags = new Set(['后续拓展', '后续补充', '拓展阅读', '延伸阅读', 'supplement', 'extension']);
  const extensions = new Set([...noteById].filter(([, note]) => Array.isArray(note.tags)
    && note.tags.some(tag => extensionTags.has(String(tag).toLowerCase()))).map(([id]) => id));
  for (const edge of sourceLinks) if (edge.type === 'branch' && /^(?:基础|先备|前置)/.test(String(edge.label || '').trim())) foundations.add(String(edge.to));
  for (const edge of sourceLinks) if (edge.type === 'branch' && /^(?:后续补充|后续拓展|拓展阅读|延伸阅读)/.test(String(edge.label || '').trim())) extensions.add(String(edge.to));
  const navigationIndex = new Map(navigation.map((id, index) => [id, index]));
  const directoryNumber = id => String(noteById.get(id)?.title || '').normalize('NFKC')
    .match(/^\s*(?:第\s*)?(\d+[A-Za-z]?(?:\.\d+)*)(?:\s|[.、:：)）-]|节|章|部分|$)/)?.[1];
  const compareReading = (a, b) => Number(!foundations.has(a)) - Number(!foundations.has(b))
    || Number(extensions.has(a)) - Number(extensions.has(b))
    || (navigationIndex.get(a) ?? Infinity) - (navigationIndex.get(b) ?? Infinity)
    || (directoryNumber(a) && directoryNumber(b) ? readingCollator.compare(directoryNumber(a), directoryNumber(b))
      : Number(!directoryNumber(a)) - Number(!directoryNumber(b))) || compare(a, b);
  const readingOrder = new Map([...graph.ids].sort(compareReading).map((id, index) => [id, index]));
  const directed = graph.links.filter(edge => edge.type !== 'parallel');
  const union = new Map(graph.ids.map(id => [id, id]));
  const find = id => {
    let root = id;
    while (union.get(root) !== root) root = union.get(root);
    while (id !== root) { const next = union.get(id); union.set(id, root); id = next; }
    return root;
  };
  // Parallel is a shared layer, never a directed dependency. Merge compatible
  // pairs only: conflicting imported relations must not make the DAG cyclic.
  for (const edge of graph.links.filter(edge => edge.type === 'parallel')) {
    const from = find(edge.from), to = find(edge.to);
    if (from === to) continue;
    const children = new Map(graph.ids.map(id => [find(id), new Set()]));
    for (const link of directed) children.get(find(link.from)).add(find(link.to));
    if (!reaches(children, from, to) && !reaches(children, to, from)) {
      union.set(compare(from, to) < 0 ? to : from, compare(from, to) < 0 ? from : to);
    }
  }
  const units = new Map();
  for (const id of graph.ids) {
    const owner = find(id);
    if (!units.has(owner)) units.set(owner, { id: owner, nodes: [] });
    units.get(owner).nodes.push(id);
  }
  for (const unit of units.values()) unit.nodes.sort(compareReading);
  const ids = [...units.keys()].sort(compare), incoming = new Map(ids.map(id => [id, new Map()]));
  const outgoing = new Map(ids.map(id => [id, new Map()]));
  for (const edge of directed) {
    const from = find(edge.from), to = find(edge.to);
    if (from === to) continue;
    const weight = 7 - LOGIC_PRIORITY.get(edge.type), previous = outgoing.get(from).get(to);
    if (previous && previous.weight >= weight) continue;
    const value = { from, to, weight, edge };
    outgoing.get(from).set(to, value); incoming.get(to).set(from, value);
  }
  const remaining = new Map(ids.map(id => [id, incoming.get(id).size]));
  const pending = ids.filter(id => !remaining.get(id)), order = [], ranks = new Map(ids.map(id => [id, 0]));
  while (pending.length) {
    const id = pending.shift(); order.push(id);
    for (const child of [...outgoing.get(id).keys()].sort(compare)) {
      ranks.set(child, Math.max(ranks.get(child), ranks.get(id) + 1));
      remaining.set(child, remaining.get(child) - 1);
      if (!remaining.get(child)) { pending.push(child); pending.sort(compare); }
    }
  }
  // Keep each terminal at its natural depth, but bring a short independent
  // support branch close to its merge instead of spanning the entire diagram.
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i], next = [...outgoing.get(id).keys()];
    if (next.length) ranks.set(id, Math.max(ranks.get(id), Math.min(...next.map(child => ranks.get(child) - 1))));
  }
  const primary = new Map();
  for (const id of ids) {
    const parents = [...incoming.get(id).values()].sort((a, b) => b.weight - a.weight || ranks.get(b.from) - ranks.get(a.from) || compare(a.from, b.from));
    if (parents.length) primary.set(id, parents[0]);
  }
  const components = connectedGroups(ids, directed.map(edge => ({ from: find(edge.from), to: find(edge.to) })));
  const ordering = new Map(ids.map(id => [id, new Set()])), layers = new Map();
  for (const id of ids) {
    const rank = ranks.get(id);
    if (!layers.has(rank)) layers.set(rank, []);
    layers.get(rank).push(id);
  }
  // Content prerequisites determine columns first. Reading order only orders
  // peers top-to-bottom; it never creates an extra knowledge dependency.
  for (const layer of layers.values()) {
    layer.sort((a, b) => compareReading(units.get(a).nodes[0], units.get(b).nodes[0]));
    for (let i = 1; i < layer.length; i++) ordering.get(layer[i - 1]).add(layer[i]);
  }
  return { units, incoming, outgoing, ranks, primary, components, ordering, readingOrder };
}

function readableComponentSettings(component, hierarchy, links, settings) {
  const members = new Set(component), owners = new Map();
  for (const id of component) for (const node of hierarchy.units.get(id).nodes) owners.set(node, id);
  const channels = new Map();
  let labelHeight = 28;
  for (const edge of links) {
    const from = owners.get(edge.from), to = owners.get(edge.to);
    if (!members.has(from) || !members.has(to)) continue;
    const box = relationLabelGeometry(edge.label || edge.type);
    labelHeight = Math.max(labelHeight, box.height);
    if (edge.type === 'parallel') continue;
    for (let rank = hierarchy.ranks.get(from); rank < hierarchy.ranks.get(to); rank++) {
      const entry = channels.get(rank) || { count: 0, width: 56 };
      entry.count++; entry.width = Math.max(entry.width, box.width); channels.set(rank, entry);
    }
  }
  return { ...settings, readingTop: true, rowGap: Math.max(settings.rowGap, 80, labelHeight + 32),
    columnGaps: new Map([...channels].map(([rank, entry]) => [rank,
      Math.max(settings.columnGap, 200, entry.width + 80 + (entry.count - 1) * 28)])),
  };
}


// A pure module owner describes containment, not an additional prerequisite
// before every one of its members. Only a complete, unambiguous directory may
// become the group heading; scientific owners and mixed memberships retain the
// ordinary hierarchy. Nothing here removes a stored or displayed relationship.
function moduleHeadingLayout(notes, links, graph, settings) {
  if (graph.ids.length < 3) return null;
  const branches = graph.links.filter(edge => edge.type === 'branch');
  if (branches.length !== graph.ids.length - 1) return null;
  const noteById = new Map(notes.filter(note => note?.id != null).map(note => [String(note.id), note]));
  const candidates = graph.ids.filter(id => noteById.get(id)?.frameworkModule
    && branches.every(edge => edge.from === id && edge.to !== id)
    && new Set(branches.map(edge => edge.to)).size === graph.ids.length - 1
    && !graph.links.some(edge => edge.type !== 'branch' && (edge.from === id || edge.to === id)));
  if (candidates.length !== 1) return null;
  const owner = candidates[0], members = graph.ids.filter(id => id !== owner);
  const memberSet = new Set(members), memberNotes = members.map(id => noteById.get(id));
  const memberLinks = links.filter(edge => edge && edge.from != null && edge.to != null
    && memberSet.has(String(edge.from)) && memberSet.has(String(edge.to)));
  const presentation = essentialGraphPlan(memberNotes, memberLinks);
  const plan = cleanGraphPlan(memberNotes, presentation.visibleLinks);
  const geometryLinks = plan.primaryLinks.filter(edge => edge.type !== 'sequence');
  const base = logicHierarchy(graphInput(memberNotes, geometryLinks), memberNotes, plan.sequenceOrder, links);
  const unitOf = new Map([...base.units].flatMap(([id, unit]) => unit.nodes.map(node => [node, id])));
  const children = new Map([...base.outgoing].map(([id, outgoing]) => [id, new Set(outgoing.keys())]));
  const navigationIndex = new Map(plan.sequenceOrder.map((id, index) => [id, index]));
  const navigation = presentation.visibleLinks.filter(edge => edge.type === 'sequence').sort((a, b) =>
    (navigationIndex.get(a.from) ?? Infinity) - (navigationIndex.get(b.from) ?? Infinity)
    || compare(a.from, b.from) || compare(a.to, b.to));
  // Scientific layers and compatible parallel groups win. The remaining saved
  // reading links can align a partially populated course without claiming that
  // later, empty cards scientifically depend on their predecessor.
  for (const edge of navigation) {
    const from = unitOf.get(edge.from), to = unitOf.get(edge.to);
    if (from === to || reaches(children, to, from)) continue;
    geometryLinks.push(edge); children.get(from).add(to);
  }
  const hierarchy = logicHierarchy(graphInput(memberNotes, geometryLinks), memberNotes, plan.sequenceOrder, links);
  const connected = new Set(memberLinks.flatMap(edge => [String(edge.from), String(edge.to)]));
  const activeComponents = hierarchy.components.filter(component => component.some(id =>
    hierarchy.units.get(id).nodes.some(node => connected.has(node))));
  const localSettings = { ...settings, originX: 0, originY: 0 };
  const positions = Object.assign(Object.create(null), activeComponents.length ? pack(activeComponents.map(component => columnComponent(component, hierarchy,
    readableComponentSettings(component, hierarchy, geometryLinks, localSettings))),
  { ...localSettings, readingOrder: hierarchy.readingOrder }) : {});
  const supporting = members.filter(id => !connected.has(id)).sort((a, b) =>
    hierarchy.readingOrder.get(a) - hierarchy.readingOrder.get(b) || compare(a, b));
  const supportTop = Object.keys(positions).length
    ? Math.max(...Object.values(positions).map(point => point.y)) + settings.nodeHeight + Math.max(80, settings.rowGap) : 0;
  for (const [id, position] of cardGrid(supporting, localSettings, supportTop)) positions[id] = position;
  const headingSpace = settings.nodeHeight + Math.max(80, settings.rowGap);
  return Object.fromEntries(graph.ids.map(id => [id, id === owner
    ? { x: settings.originX, y: settings.originY }
    : { x: Math.round((positions[id].x + settings.originX) * 1000) / 1000,
      y: Math.round((positions[id].y + settings.originY + headingSpace) * 1000) / 1000 }]));
}

function cleanLayout(notes, links, graph, settings) {
  // An expanded module's neighbours are context, not new members. Keep the
  // module's own geometry independent of optional surrounding modules.
  const context=notes.filter(note=>note&&note.id!=null&&(note.graphContext||note.contextNode));
  const core=notes.filter(note=>note&&note.id!=null&&!note.graphContext&&!note.contextNode);
  if(context.length&&core.length){
    const coreIds=new Set(core.map(note=>String(note.id)));
    const coreLinks=links.filter(link=>coreIds.has(String(link.from))&&coreIds.has(String(link.to)));
    const positions=cleanLayout(core,coreLinks,graphInput(core,coreLinks),settings);
    const values=Object.values(positions),left=Math.min(...values.map(p=>p.x)),right=Math.max(...values.map(p=>p.x));
    const gap=Math.max(200,settings.columnGap),lanes={before:[],after:[]};
    for(const note of context){
      const id=String(note.id),prior=links.some(e=>String(e.from)===id&&coreIds.has(String(e.to))&&e.type==='prerequisite');
      lanes[prior?'before':'after'].push(note);
    }
    for(const [side,members] of Object.entries(lanes)){
      const occupied=[];
      members.sort((a,b)=>compare(String(a.id),String(b.id)));
      for(const note of members){
        const id=String(note.id),neighbors=links.flatMap(e=>String(e.from)===id&&coreIds.has(String(e.to))?[String(e.to)]:String(e.to)===id&&coreIds.has(String(e.from))?[String(e.from)]:[]);
        const ys=neighbors.map(other=>positions[other].y).sort((a,b)=>a-b);
        let y=ys.length?ys[Math.floor(ys.length/2)]:settings.originY;
        while(occupied.some(other=>Math.abs(other-y)<settings.nodeHeight+settings.rowGap))y+=settings.nodeHeight+settings.rowGap;
        occupied.push(y);
        positions[id]={x:side==='before'?left-settings.nodeWidth-gap:right+settings.nodeWidth+gap,y};
      }
    }
    return positions;
  }
  const moduleHeading = moduleHeadingLayout(notes, links, graph, settings);
  if (moduleHeading) return moduleHeading;
  const plan = cleanGraphPlan(notes, links), primary = graphInput(notes, plan.primaryLinks);
  if (!primary.links.length) return Object.fromEntries([...cardGrid(graph.ids, settings)].map(([id, point]) => [id, {
    x: Math.round((point.x + settings.originX) * 1000) / 1000,
    y: Math.round((point.y + settings.originY) * 1000) / 1000,
  }]));
  const h = logicHierarchy(primary, notes, plan.sequenceOrder, plan.primaryLinks);
  return pack(h.components.map(component => columnComponent(component, h,
    readableComponentSettings(component, h, plan.primaryLinks, settings))), { ...settings, readingOrder: h.readingOrder });
}

function sequenceComponent(graph, settings) {
  const order = sequenceOrder(graph);
  if (!order.length) return null;
  const { nodeWidth: width, nodeHeight: height, columnGap, rowGap, originX, originY } = settings;
  const main = new Set(order), auxiliary = graph.ids.filter(id => !main.has(id));
  const mainX = auxiliary.length ? width + columnGap : 0;
  const positions = new Map();
  for (let i = 0; i < auxiliary.length; i++) positions.set(auxiliary[i], {
    x: 0, y: i * (height + rowGap),
  });
  for (let i = 0; i < order.length; i++) {
    const row = Math.floor(i / 3), column = row % 2 ? 2 - i % 3 : i % 3;
    positions.set(order[i], {
      x: mainX + column * (width + columnGap),
      y: row * (height + Math.max(80, rowGap)),
    });
  }
  return Object.fromEntries([...positions].map(([id, point]) => [id, {
    x: Math.round((point.x + originX) * 1000) / 1000,
    y: Math.round((point.y + originY) * 1000) / 1000,
  }]));
}

// Tarjan condenses actual branch cycles before adding softer dependencies.
function branchUnits(ids, links) {
  const children = new Map(ids.map(id => [id, []]));
  for (const link of links) if (link.type === 'branch' && link.from !== link.to) children.get(link.from).push(link.to);
  for (const values of children.values()) values.sort(compare);
  let next = 0;
  const indices = new Map(), low = new Map(), stack = [], stacked = new Set(), members = [];
  const enter = id => {
    indices.set(id, next); low.set(id, next++); stack.push(id); stacked.add(id);
  };
  for (const id of ids) {
    if (indices.has(id)) continue;
    enter(id);
    const frames = [{ id, cursor: 0 }];
    while (frames.length) {
      const frame = frames.at(-1), neighbors = children.get(frame.id);
      if (frame.cursor < neighbors.length) {
        const child = neighbors[frame.cursor++];
        if (!indices.has(child)) { enter(child); frames.push({ id: child, cursor: 0 }); }
        else if (stacked.has(child)) low.set(frame.id, Math.min(low.get(frame.id), indices.get(child)));
        continue;
      }
      frames.pop();
      if (frames.length) {
        const parent = frames.at(-1).id;
        low.set(parent, Math.min(low.get(parent), low.get(frame.id)));
      }
      if (low.get(frame.id) !== indices.get(frame.id)) continue;
      const group = [];
      let child;
      do { child = stack.pop(); stacked.delete(child); group.push(child); } while (child !== frame.id);
      members.push(group.sort(compare));
    }
  }
  members.sort((a, b) => compare(a[0], b[0]));
  const units = members.map(nodes => ({ id: nodes[0], nodes }));
  const owner = new Map(units.flatMap(unit => unit.nodes.map(id => [id, unit.id])));
  return { units, owner, children };
}

function hierarchy(graph) {
  const { units, owner, children: branchChildren } = branchUnits(graph.ids, graph.links);
  const outgoing = new Map(units.map(unit => [unit.id, new Map()]));
  const incoming = new Map(units.map(unit => [unit.id, new Map()]));
  const branchParent = new Set();
  const add = edge => {
    const from = owner.get(edge.from), to = owner.get(edge.to);
    if (from === to) return;
    const old = outgoing.get(from).get(to);
    if (old && old.weight >= WEIGHT[edge.type]) return;
    const value = { from, to, weight: WEIGHT[edge.type], edge };
    outgoing.get(from).set(to, value); incoming.get(to).set(from, value);
  };
  for (const edge of graph.links) if (edge.type === 'branch') {
    add(edge);
    if (owner.get(edge.from) !== owner.get(edge.to)) branchParent.add(owner.get(edge.to));
  }
  const reaches = (from, target) => {
    const seen = new Set([from]), queue = [from];
    for (let i = 0; i < queue.length; i++) {
      if (queue[i] === target) return true;
      for (const child of outgoing.get(queue[i]).keys()) if (!seen.has(child)) { seen.add(child); queue.push(child); }
    }
    return false;
  };
  // Branch membership is the stable outline. A prerequisite between two
  // siblings, or a returning extension, must not stretch that outline.
  const dependencies = graph.links.filter(edge => STRUCTURAL.has(edge.type) && edge.type !== 'branch')
    .sort((a, b) => WEIGHT[b.type] - WEIGHT[a.type] || compare(a.from, b.from) || compare(a.to, b.to));
  for (const edge of dependencies) {
    const from = owner.get(edge.from), to = owner.get(edge.to);
    if (from === to || branchParent.has(to) || reaches(to, from)) continue;
    add(edge);
  }
  const remaining = new Map(units.map(unit => [unit.id, incoming.get(unit.id).size]));
  const queue = units.filter(unit => !remaining.get(unit.id)).map(unit => unit.id).sort(compare);
  const ranks = new Map(units.map(unit => [unit.id, 0]));
  while (queue.length) {
    const id = queue.shift();
    for (const child of [...outgoing.get(id).keys()].sort(compare)) {
      ranks.set(child, Math.max(ranks.get(child), ranks.get(id) + 1));
      remaining.set(child, remaining.get(child) - 1);
      if (!remaining.get(child)) { queue.push(child); queue.sort(compare); }
    }
  }
  // Dependencies between nodes that already have branch parents order siblings
  // vertically without inventing extra hierarchy levels. Returning links and
  // auxiliary relation types do not enter these constraints.
  const ordering = new Map(units.map(unit => [unit.id, new Set()]));
  for (const edge of dependencies) {
    const from = owner.get(edge.from), to = owner.get(edge.to);
    if (from === to || ranks.get(from) !== ranks.get(to)) continue;
    const seen = new Set([to]), pending = [to];
    for (let i = 0; i < pending.length; i++) for (const child of ordering.get(pending[i])) if (!seen.has(child)) { seen.add(child); pending.push(child); }
    if (!seen.has(from)) ordering.get(from).add(to);
  }
  const primary = new Map();
  for (const unit of units) {
    const parents = [...incoming.get(unit.id).values()].sort((a, b) => b.weight - a.weight || ranks.get(b.from) - ranks.get(a.from) || compare(a.from, b.from));
    if (parents.length) primary.set(unit.id, parents[0]);
  }
  // Components are measured from the accepted outline. Cross-links affect
  // routing, not the size or depth of the outline's component rectangles.
  const unseen = new Set(units.map(unit => unit.id)), components = [];
  for (const unit of units) {
    if (!unseen.delete(unit.id)) continue;
    const component = [unit.id];
    for (let i = 0; i < component.length; i++) for (const neighbor of [...outgoing.get(component[i]).keys(), ...incoming.get(component[i]).keys()]) {
      if (unseen.delete(neighbor)) component.push(neighbor);
    }
    components.push(component.sort(compare));
  }
  return { units: new Map(units.map(unit => [unit.id, unit])), owner, outgoing, incoming, branchChildren, ranks, ordering, primary, components };
}

// Flow subcolumns are a local aid, not an instruction to turn a large module
// into a horizontal strip. A long/dense connected flow remains in the original
// vertical outline, where it retains routing space and can be explored locally.
function siblingFlowGroups(h, graph) {
  const component = new Map(h.components.flatMap((ids, index) => ids.map(id => [id, index])));
  const candidates = new Map(), neighbors = new Map();
  for (const edge of graph.links) {
    if (!['prerequisite', 'sequence'].includes(edge.type)) continue;
    const from = h.owner.get(edge.from), to = h.owner.get(edge.to);
    if (from === to || h.ranks.get(from) !== h.ranks.get(to) || component.get(from) !== component.get(to)) continue;
    const key = JSON.stringify([from, to]), weight = edge.type === 'sequence' ? 6 : 4;
    if (!candidates.has(key) || candidates.get(key).weight < weight) candidates.set(key, { from, to, weight, edge });
    if (!neighbors.has(from)) neighbors.set(from, new Set());
    if (!neighbors.has(to)) neighbors.set(to, new Set());
    neighbors.get(from).add(to); neighbors.get(to).add(from);
  }
  const remaining = new Set([...neighbors.keys()].sort(compare)), groups = [];
  for (const root of [...remaining]) {
    if (!remaining.delete(root)) continue;
    const ids = [root];
    for (let i = 0; i < ids.length; i++) for (const next of [...neighbors.get(ids[i])].sort(compare)) if (remaining.delete(next)) ids.push(next);
    ids.sort(compare);
    const known = new Set(ids), edges = [...candidates.values()].filter(edge => known.has(edge.from));
    const incoming = new Map(ids.map(id => [id, 0])), outgoing = new Map(ids.map(id => [id, []]));
    for (const edge of edges) { incoming.set(edge.to, incoming.get(edge.to) + 1); outgoing.get(edge.from).push(edge.to); }
    const queue = ids.filter(id => !incoming.get(id)), ranks = new Map(ids.map(id => [id, 0]));
    for (let i = 0; i < queue.length; i++) for (const to of outgoing.get(queue[i])) {
      ranks.set(to, Math.max(ranks.get(to), ranks.get(queue[i]) + 1));
      incoming.set(to, incoming.get(to) - 1); if (!incoming.get(to)) queue.push(to);
    }
    const limited = ids.length > 6 || edges.length > ids.length * 2 || queue.length !== ids.length || Math.max(...ranks.values()) > 2;
    groups.push({ ids, edges, limited });
  }
  return groups;
}

// A module's children can share membership while participating in a shallow
// flow. Membership edges remain unchanged, including direct shortcut branches.
function refineSiblingFlow(h, graph) {
  const groups = siblingFlowGroups(h, graph);
  const reaches = (from, target) => {
    const seen = new Set([from]), queue = [from];
    for (let i = 0; i < queue.length; i++) {
      if (queue[i] === target) return true;
      for (const id of h.outgoing.get(queue[i]).keys()) if (!seen.has(id)) { seen.add(id); queue.push(id); }
    }
    return false;
  };
  for (const group of groups) for (const value of group.limited ? [] : group.edges) {
    const { from, to } = value;
    if (reaches(to, from)) continue;
    if (h.outgoing.get(from).has(to)) continue;
    h.outgoing.get(from).set(to, value); h.incoming.get(to).set(from, value);
  }
  const incoming = new Map([...h.units.keys()].map(id => [id, h.incoming.get(id).size]));
  const queue = [...h.units.keys()].filter(id => !incoming.get(id)).sort(compare);
  h.ranks = new Map([...h.units.keys()].map(id => [id, 0]));
  for (let i = 0; i < queue.length; i++) for (const to of [...h.outgoing.get(queue[i]).keys()].sort(compare)) {
    h.ranks.set(to, Math.max(h.ranks.get(to), h.ranks.get(queue[i]) + 1));
    incoming.set(to, incoming.get(to) - 1);
    if (!incoming.get(to)) queue.push(to);
  }
}

function sortLayer(layer, scores, outlineOrder, ordering) {
  const pending = new Set(layer), indegree = new Map(layer.map(id => [id, 0]));
  for (const id of layer) for (const child of ordering.get(id)) if (pending.has(child)) indegree.set(child, indegree.get(child) + 1);
  const result = [];
  while (pending.size) {
    const available = [...pending].filter(id => !indegree.get(id));
    available.sort((a, b) => scores.get(a) - scores.get(b) || outlineOrder.get(a) - outlineOrder.get(b) || compare(a, b));
    const id = available[0];
    result.push(id); pending.delete(id);
    for (const child of ordering.get(id)) if (pending.has(child)) indegree.set(child, indegree.get(child) - 1);
  }
  layer.splice(0, layer.length, ...result);
}

// Project preferred centres onto non-overlapping, ordered intervals. The pool
// adjacent violators algorithm gives the least-squares solution in linear time.
function separate(layer, preferred, heights, gap) {
  let cursor = 0;
  const offsets = layer.map((id, i) => {
    if (i) cursor += heights.get(layer[i - 1]) / 2 + gap + heights.get(id) / 2;
    return cursor;
  });
  const blocks = [];
  layer.forEach((id, i) => {
    blocks.push({ start: i, end: i, sum: preferred.get(id) - offsets[i], count: 1 });
    while (blocks.length > 1 && blocks.at(-2).sum / blocks.at(-2).count > blocks.at(-1).sum / blocks.at(-1).count) {
      const b = blocks.pop(), a = blocks.pop();
      blocks.push({ start: a.start, end: b.end, sum: a.sum + b.sum, count: a.count + b.count });
    }
  });
  const result = new Map();
  for (const block of blocks) for (let i = block.start; i <= block.end; i++) result.set(layer[i], block.sum / block.count + offsets[i]);
  return result;
}

function columnComponent(component, h, settings) {
  const { nodeWidth: width, nodeHeight: height, columnGap, rowGap } = settings;
  const heights = new Map(component.map(id => [id, h.units.get(id).nodes.length * (height + rowGap) - rowGap]));
  const set = new Set(component), tree = new Map(component.map(id => [id, []]));
  for (const id of component) if (h.primary.has(id)) tree.get(h.primary.get(id).from).push(id);
  for (const children of tree.values()) children.sort(compare);
  const outlineOrder = new Map();
  for (const root of component) if (!h.primary.has(root)) {
    const pending = [root];
    while (pending.length) {
      const id = pending.pop(), children = tree.get(id);
      outlineOrder.set(id, outlineOrder.size);
      for (let i = children.length - 1; i >= 0; i--) pending.push(children[i]);
    }
  }
  const minimumRank = Math.min(...component.map(id => h.ranks.get(id))), layers = [];
  for (const id of component) {
    const rank = h.ranks.get(id) - minimumRank;
    (layers[rank] ||= []).push(id);
  }
  for (const layer of layers) layer.sort((a, b) => outlineOrder.get(a) - outlineOrder.get(b) || compare(a, b));
  const layerHeight = layer => layer.reduce((sum, id) => sum + heights.get(id), 0) + Math.max(0, layer.length - 1) * rowGap;
  let centres = new Map();
  const resetCentres = () => {
    const total = Math.max(...layers.map(layerHeight));
    for (const layer of layers) {
      let y = (total - layerHeight(layer)) / 2;
      for (const id of layer) { centres.set(id, y + heights.get(id) / 2); y += heights.get(id) + rowGap; }
    }
  };
  resetCentres();
  // Bidirectional weighted barycentres reduce crossings. Branches dominate
  // softer dependencies; deterministic outline order breaks every tie.
  for (let pass = 0; pass < 8; pass++) {
    const forward = pass % 2 === 0, ordered = forward ? layers : [...layers].reverse();
    for (const layer of ordered) {
      const score = id => {
        const neighbors = [...(forward ? h.incoming : h.outgoing).get(id).values()].filter(edge => set.has(forward ? edge.from : edge.to));
        const total = neighbors.reduce((sum, edge) => sum + edge.weight, 0);
        return total ? neighbors.reduce((sum, edge) => sum + centres.get(forward ? edge.from : edge.to) * edge.weight, 0) / total : centres.get(id);
      };
      const scores = new Map(layer.map(id => [id, score(id)]));
      sortLayer(layer, scores, outlineOrder, h.ordering);
    }
    resetCentres();
  }
  for (let pass = 0; pass < 10; pass++) {
    const forward = pass % 2 === 0;
    for (const layer of forward ? layers : [...layers].reverse()) {
      const preferred = new Map(layer.map(id => {
        const neighbors = [...(forward ? h.incoming : h.outgoing).get(id).values()].filter(edge => set.has(forward ? edge.from : edge.to));
        const total = neighbors.reduce((sum, edge) => sum + edge.weight, 0);
        return [id, total ? neighbors.reduce((sum, edge) => sum + centres.get(forward ? edge.from : edge.to) * edge.weight, 0) / total : centres.get(id)];
      }));
      for (const [id, y] of separate(layer, preferred, heights, rowGap)) centres.set(id, y);
    }
  }
  if (settings.readingTop) for (const layer of [...layers].reverse()) {
    const preferred = new Map(layer.map(id => {
      const next = [...h.outgoing.get(id).values()].filter(edge => set.has(edge.to));
      const members = next.filter(edge => edge.edge.type === 'branch');
      const firstTop = members.length >= 3 ? Math.min(...members.map(edge => centres.get(edge.to) - heights.get(edge.to) / 2)) : null;
      return [id, firstTop != null ? firstTop + heights.get(id) / 2
        : next.length === 1 ? centres.get(next[0].to) : centres.get(id)];
    }));
    for (const [id, y] of separate(layer, preferred, heights, rowGap)) centres.set(id, y);
  }
  const positions = new Map();
  const columnX = [0];
  for (let rank = 1; rank < layers.length; rank++) columnX[rank] = columnX[rank - 1] + width
    + (settings.columnGaps?.get(minimumRank + rank - 1) ?? columnGap);
  for (let rank = 0; rank < layers.length; rank++) for (const id of layers[rank]) {
    const top = centres.get(id) - heights.get(id) / 2;
    h.units.get(id).nodes.forEach((node, index) => positions.set(node, { x: columnX[rank], y: top + index * (height + rowGap) }));
  }
  return positions;
}

function branchTrees(h) {
  const children = new Map([...h.units.values()].flatMap(unit => unit.nodes.map(id => [id, []]))), parent = new Map();
  const roots = new Map();
  for (const unit of h.units.values()) {
    const root = h.primary.get(unit.id)?.edge.to || unit.nodes[0];
    roots.set(unit.id, root);
    const allowed = new Set(unit.nodes), visited = new Set([root]), queue = [root];
    // A branch SCC is strongly connected, so its directed spanning tree can
    // retain meaningful arrows while the remaining loop edges stay cross-links.
    for (let i = 0; i < queue.length; i++) for (const child of h.branchChildren.get(queue[i])) {
      if (!allowed.has(child) || visited.has(child)) continue;
      visited.add(child); queue.push(child); children.get(queue[i]).push(child); parent.set(child, queue[i]);
    }
  }
  for (const [id, relation] of h.primary) {
    const child = roots.get(id), from = relation.edge.from;
    children.get(from).push(child); parent.set(child, from);
  }
  for (const values of children.values()) values.sort(compare);
  return { children, roots: [...children.keys()].filter(id => !parent.has(id)).sort(compare) };
}

function branchComponent(root, children, settings) {
  const { nodeWidth: width, nodeHeight: height, rowGap, columnGap } = settings;
  const spans = new Map(), order = [], pending = [root];
  while (pending.length) {
    const id = pending.pop();
    order.push(id);
    for (const child of children.get(id)) pending.push(child);
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i], descendants = children.get(id);
    spans.set(id, Math.max(height, descendants.reduce((sum, child) => sum + spans.get(child), 0) + Math.max(0, descendants.length - 1) * rowGap));
  }
  const left = [], right = [];
  let leftHeight = 0, rightHeight = 0;
  for (const child of [...children.get(root)].sort((a, b) => spans.get(b) - spans.get(a) || compare(a, b))) {
    const side = rightHeight <= leftHeight ? right : left;
    if (side === right) rightHeight += spans.get(child) + (right.length ? rowGap : 0);
    else leftHeight += spans.get(child) + (left.length ? rowGap : 0);
    side.push(child);
  }
  const total = Math.max(height, leftHeight, rightHeight), positions = new Map([[root, { x: 0, y: (total - height) / 2 }]]);
  const placements = [];
  for (const [side, sideHeight, direction] of [[left, leftHeight, -1], [right, rightHeight, 1]]) {
    let y = (total - sideHeight) / 2;
    for (const id of side) { placements.push({ id, depth: 1, top: y, direction }); y += spans.get(id) + rowGap; }
  }
  placements.reverse();
  while (placements.length) {
    const { id, depth, top, direction } = placements.pop();
    positions.set(id, { x: direction * depth * (width + columnGap), y: top + (spans.get(id) - height) / 2 });
    let y = top;
    const descendants = children.get(id).map(child => {
      const placement = { id: child, depth: depth + 1, top: y, direction };
      y += spans.get(child) + rowGap;
      return placement;
    });
    for (let i = descendants.length - 1; i >= 0; i--) placements.push(descendants[i]);
  }
  return positions;
}

function rectangle(positions, settings) {
  const values = [...positions.values()];
  const minX = Math.min(...values.map(p => p.x)), minY = Math.min(...values.map(p => p.y));
  return {
    positions: new Map([...positions].map(([id, p]) => [id, { x: p.x - minX, y: p.y - minY }])),
    width: Math.max(...values.map(p => p.x)) - minX + settings.nodeWidth,
    height: Math.max(...values.map(p => p.y)) - minY + settings.nodeHeight,
    key: [...positions.keys()].sort(compare)[0],
  };
}

function pack(components, settings) {
  const { componentGap: gap, aspectRatio } = settings;
  const firstReading = box => Math.min(...[...box.positions.keys()].map(id => settings.readingOrder?.get(id) ?? Infinity));
  const boxes = components.map(positions => rectangle(positions, settings))
    .sort((a, b) => (settings.readingOrder ? firstReading(a) - firstReading(b) : 0)
      || b.height - a.height || b.width - a.width || compare(a.key, b.key));
  const widest = Math.max(...boxes.map(box => box.width));
  const ideal = Math.max(widest, Math.sqrt(boxes.reduce((sum, box) => sum + (box.width + gap) * (box.height + gap), 0) * aspectRatio));
  const widths = [...new Set([widest, ...[.7, .85, 1, 1.2, 1.5].map(factor => Math.max(widest, ideal * factor))])];
  let best;
  for (const target of widths) {
    const shelves = [], placements = [];
    for (const box of boxes) {
      let shelf = shelves.find(candidate => candidate.x + box.width <= target + .001);
      if (!shelf) {
        const previous = shelves.at(-1);
        shelf = { x: 0, y: previous ? previous.y + previous.height + gap : 0, height: box.height };
        shelves.push(shelf);
      }
      placements.push({ box, x: shelf.x, y: shelf.y }); shelf.x += box.width + gap;
    }
    const width = Math.max(...placements.map(p => p.x + p.box.width)), height = Math.max(...placements.map(p => p.y + p.box.height));
    const score = width * height * (1 + Math.abs(Math.log(width / height / aspectRatio)) * .18);
    if (!best || score < best.score) best = { score, placements };
  }
  return Object.fromEntries(best.placements.flatMap(({ box, x, y }) => [...box.positions].map(([id, p]) => [id, {
    x: Math.round((p.x + x + settings.originX) * 1000) / 1000,
    y: Math.round((p.y + y + settings.originY) * 1000) / 1000,
  }])));
}

/** Return card top-left coordinates without reading the DOM or mutating inputs.
 * columns: branch-first hierarchy, longest-path dependency layers and compact
 * ordered rows. branches: a balanced mind-map whose child subtrees reserve their
 * complete height. sequence: explicit study paths read through three snake
 * columns; auxiliary cards occupy a separate column at the left. Graphs without
 * sequence edges retain columns geometry. Disconnected outlines receive
 * separate packed rectangles in the outline modes.
 * clean: existing content dependencies form parallel branches and merges;
 * navigation and numbered titles order peers without adding knowledge edges.
 */
export function computeGraphLayout(notes = [], links = [], options = {}) {
  const graph = graphInput(notes, links);
  if (!graph.ids.length) return {};
  const settings = {
    nodeWidth: positive(options.nodeWidth, 244, 20), nodeHeight: positive(options.nodeHeight, 108, 20),
    columnGap: positive(options.columnGap, 112, 48), rowGap: positive(options.rowGap, 48, 24),
    componentGap: positive(options.componentGap, 132, 48), aspectRatio: positive(options.aspectRatio, 1.6, .2),
    originX: Number.isFinite(Number(options.originX)) ? Number(options.originX) : 0,
    originY: Number.isFinite(Number(options.originY)) ? Number(options.originY) : 0,
  };
  if (modeName(options.mode) === 'clean') return cleanLayout(notes, links, graph, settings);
  if (modeName(options.mode) === 'sequence') {
    const positions = sequenceComponent(graph, settings);
    if (positions) return positions;
  }
  const h = hierarchy(graph);
  if (modeName(options.mode) === 'branches') {
    const tree = branchTrees(h);
    return pack(tree.roots.map(root => branchComponent(root, tree.children, settings)), settings);
  }
  refineSiblingFlow(h, graph);
  return pack(h.components.map(component => columnComponent(component, h, settings)), settings);
}

const pointIsFinite = point => Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
const idCollection = value => value instanceof Set || Array.isArray(value) ? new Set([...value].map(String)) : null;
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] || 0; };

function flowIssues(graph, mode) {
  const issues = [];
  // Reading order and logical prerequisites answer different questions. A
  // returning edge of the other type is not evidence of a semantic cycle.
  for (const relationType of ['prerequisite', 'sequence']) {
    const edges = graph.links.filter(edge => edge.type === relationType);
    const incoming = new Map(graph.ids.map(id => [id, 0])), outgoing = new Map(graph.ids.map(id => [id, []]));
    for (const edge of edges) { incoming.set(edge.to, incoming.get(edge.to) + 1); outgoing.get(edge.from).push(edge.to); }
    const queue = graph.ids.filter(id => !incoming.get(id));
    for (let i = 0; i < queue.length; i++) for (const to of outgoing.get(queue[i])) {
      incoming.set(to, incoming.get(to) - 1); if (!incoming.get(to)) queue.push(to);
    }
    const affected = graph.ids.filter(id => incoming.get(id));
    if (affected.length) issues.push({ type: 'flow-cycle', relationType, nodeIds: affected,
      message: `${relationType === 'prerequisite' ? '前置' : '学习顺序'}关系形成循环；保留全部关系，循环及其后继的方向不能同时满足。` });
  }
  if (modeName(mode) === 'columns') {
    const limited = siblingFlowGroups(hierarchy(graph), graph).filter(group => group.limited);
    if (limited.length) issues.push({ type: 'flow-layout-limited', nodeIds: limited.flatMap(group => group.ids).sort(compare),
      message: '较长、密集或方向冲突的同层联系保留纵向空间；请聚焦较小范围查看依赖，全部知识关系仍保留。' });
  }
  return issues;
}

/** Incrementally arrange a view without changing any knowledge relationship.
 * Existing points outside scopeIds/movableIds, and all locked points, are hard
 * constraints. By default only collisions and unusually long structural links
 * nominate existing cards; a caller may explicitly nominate routing trouble
 * via movableIds. No whole-view recentering or partial march towards a distant
 * target is performed. Unsolvable hard constraints are returned in issues.
 */
export function computeIncrementalLayout(notes = [], links = [], options = {}) {
  const graph = graphInput(notes, links), issues = flowIssues(graph, options.mode);
  if (!graph.ids.length) return { positions: {}, movedIds: [], issues };
  const width = positive(options.nodeWidth, 244, 20), height = positive(options.nodeHeight, 108, 20);
  const gap = positive(options.minimumGap, 24, 0);
  const stepX = width + positive(options.columnGap, 112, 48), stepY = height + positive(options.rowGap, 48, 24);
  const maxMove = positive(options.maxMoveDistance, Math.max(stepX * 3, stepY * 4), 0);
  const baseline = computeGraphLayout(notes, links, options);
  const movementLinks = modeName(options.mode) === 'clean'
    ? graphInput(notes, cleanGraphPlan(notes, links).primaryLinks).links : graph.links;
  const raw = options.positions instanceof Map ? new Map([...options.positions].map(([id, point]) => [String(id), point]))
    : new Map(Object.entries(options.positions || {}));
  const original = new Map(graph.ids.filter(id => pointIsFinite(raw.get(id)))
    .map(id => [id, { x: raw.get(id).x, y: raw.get(id).y }]));
  const locked = idCollection(options.lockedIds) || new Set(), scope = idCollection(options.scopeIds);
  const nominated = idCollection(options.movableIds), moving = new Set();
  const allowed = id => !options.missingOnly && !locked.has(id) && (!scope || scope.has(id)) && (!nominated || nominated.has(id));
  const overlaps = (a, b) => Math.abs(a.x - b.x) < width + gap - .001 && Math.abs(a.y - b.y) < height + gap - .001;
  if (!original.size) {
    for (const id of graph.ids) if (locked.has(id)) issues.push({ type: 'missing-locked-position', nodeIds: [id], message: '锁定节点缺少有效坐标，已生成初始位置。' });
    return { positions: baseline, movedIds: [...graph.ids], issues };
  }
  if (nominated) for (const id of graph.ids) if (original.has(id) && allowed(id)) moving.add(id);
  for (let i = 0; i < graph.ids.length; i++) for (let j = i + 1; j < graph.ids.length; j++) {
    const a = graph.ids[i], b = graph.ids[j];
    if (!original.has(a) || !original.has(b) || !overlaps(original.get(a), original.get(b))) continue;
    if (allowed(b)) moving.add(b); else if (allowed(a)) moving.add(a);
  }
  if (!nominated && !options.missingOnly) for (const edge of movementLinks) {
    if (!['branch', 'prerequisite', 'sequence'].includes(edge.type) || !original.has(edge.from) || !original.has(edge.to)) continue;
    if (manhattan(original.get(edge.from), original.get(edge.to)) <= Math.max(stepX * 2.5, stepY * 4)) continue;
    if (allowed(edge.to)) moving.add(edge.to); else if (allowed(edge.from)) moving.add(edge.from);
  }
  // Keep one existing anchor when a caller nominated every card, preventing an
  // unconstrained local operation from translating the whole view each time.
  if (moving.size === original.size) moving.delete([...original.keys()][0]);
  const fixed = new Map([...original].filter(([id]) => !moving.has(id)));
  const delta = {
    x: median([...fixed].map(([id, point]) => point.x - baseline[id].x)),
    y: median([...fixed].map(([id, point]) => point.y - baseline[id].y)),
  };
  const adjacent = new Map(graph.ids.map(id => [id, []]));
  for (const edge of movementLinks) if (edge.from !== edge.to) {
    const weight = edge.type === 'branch' ? 12 : ['prerequisite', 'sequence'].includes(edge.type) ? 8 : 2;
    adjacent.get(edge.from).push({ id: edge.to, weight }); adjacent.get(edge.to).push({ id: edge.from, weight });
  }
  const placed = new Map(fixed);
  const targetFor = (id, anchors) => {
    const neighbors = adjacent.get(id).filter(edge => anchors.has(edge.id));
    if (!neighbors.length) return { x: baseline[id].x + delta.x, y: baseline[id].y + delta.y };
    const total = neighbors.reduce((sum, edge) => sum + edge.weight, 0);
    return {
      x: neighbors.reduce((sum, edge) => sum + (anchors.get(edge.id).x + baseline[id].x - baseline[edge.id].x) * edge.weight, 0) / total,
      y: neighbors.reduce((sum, edge) => sum + (anchors.get(edge.id).y + baseline[id].y - baseline[edge.id].y) * edge.weight, 0) / total,
    };
  };
  const free = point => [...placed.values()].every(other => !overlaps(point, other));
  const pending = [...graph.ids.filter(id => moving.has(id)), ...graph.ids.filter(id => !original.has(id))
    .sort((a, b) => baseline[a].x - baseline[b].x || baseline[a].y - baseline[b].y || compare(a, b))];
  for (const id of pending) {
    const old = original.get(id), target = targetFor(id, old ? fixed : placed);
    if (!old && locked.has(id)) issues.push({ type: 'missing-locked-position', nodeIds: [id], message: '锁定节点缺少有效坐标，已在关联位置补入。' });
    const candidates = old ? [{ ...old }] : [];
    // A fixed goal and fixed lattice keep a repeated local operation stable;
    // never step incrementally towards a goal outside the movement limit.
    if (!old || manhattan(old, target) <= maxMove) {
      for (let ring = 0; ring <= 6; ring++) for (let x = -ring; x <= ring; x++) for (let y = -ring; y <= ring; y++) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== ring) continue;
        candidates.push({ x: target.x + x * (width + gap), y: target.y + y * (height + gap) });
      }
    }
    if (old && !free(old)) {
      for (let ring = 1; ring <= 4; ring++) for (const [x, y] of [[ring, 0], [-ring, 0], [0, ring], [0, -ring]]) {
        candidates.push({ x: old.x + x * (width + gap), y: old.y + y * (height + gap) });
      }
    }
    const feasible = candidates.filter(point => (!old || manhattan(old, point) <= maxMove) && free(point));
    const score = point => manhattan(point, target) + (old ? manhattan(point, old) * .35 : 0);
    feasible.sort((a, b) => score(a) - score(b) || a.y - b.y || a.x - b.x);
    let selected = feasible[0];
    if (!selected && !old) {
      // New cards have no displacement bound. A position beyond the occupied
      // boundary is always available, including very crowded imports.
      selected = { x: Math.max(...[...placed.values()].map(point => point.x)) + width + gap, y: target.y };
    }
    if (!selected) selected = { ...old };
    if (old && manhattan(old, target) > maxMove && free(old)) issues.push({ type: 'outside-local-range', nodeIds: [id], message: '关联目标超出局部调整范围；保留原位置，可使用重新排版。' });
    placed.set(id, old && manhattan(old, selected) === 0 ? { ...old }
      : { x: Math.round(selected.x * 1000) / 1000, y: Math.round(selected.y * 1000) / 1000 });
  }
  for (let i = 0; i < graph.ids.length; i++) for (let j = i + 1; j < graph.ids.length; j++) {
    const a = graph.ids[i], b = graph.ids[j];
    if (overlaps(placed.get(a), placed.get(b))) issues.push({ type: 'fixed-overlap', nodeIds: [a, b], message: '卡片仍有重叠或间距不足；锁定或局部范围限制阻止了进一步移动。' });
  }
  const positions = Object.fromEntries(graph.ids.map(id => [id, { ...placed.get(id) }]));
  return { positions, movedIds: graph.ids.filter(id => !original.has(id) || manhattan(original.get(id), positions[id]) > .001), issues };
}

/** Place missing cards only, preserving every valid existing coordinate. */
export function placeAdditionalNodes(notes = [], links = [], options = {}) {
  return computeIncrementalLayout(notes, links, { ...options, missingOnly: true });
}
