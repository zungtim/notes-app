// Presentation only. Stored scientific relationships are never reduced through
// a path, a chapter number, or a guess about a note's importance.
const DIRECTIONAL_CONTENT_PRIORITY = new Map([
  ['prerequisite', 0], ['applies', 1], ['evidence', 2],
  ['extends', 3], ['contradicts', 4],
]);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const endpointKey = edge => JSON.stringify([edge.from, edge.to]);
const edgeKey = edge => JSON.stringify([
  edge.from, edge.to, edge.type, edge.id, String(edge.label || ''),
]);
const compareEdges = (a, b) => compare(edgeKey(a), edgeKey(b));

/**
 * Select the default edges without discarding stored meaning.
 *
 * A study-order arrow may share one visible arrow only when a known directed
 * content edge has exactly the same ordered endpoints. Parallel, membership,
 * indirect paths and unknown relation types cannot represent study order.
 * Every content edge (including feedback and multiple inputs) remains visible.
 *
 * representedByLinkId maps the chosen visible edge id to its original study
 * order explanations. supplementaryReasons makes each omission recoverable.
 * The caller may render supplementaryLinks through its existing all-relations
 * control; no notebook record, relation type, or label is changed.
 */
export function essentialGraphPlan(notes = [], links = []) {
  const known = new Set((Array.isArray(notes) ? notes : [])
    .filter(note => note && note.id != null).map(note => String(note.id)));
  const normalized = [];
  for (const edge of Array.isArray(links) ? links : []) {
    if (!edge || edge.from == null || edge.to == null) continue;
    const from = String(edge.from), to = String(edge.to);
    if (from === to || !known.has(from) || !known.has(to)) continue;
    const type = String(edge.type || 'extends');
    // Production graph data already has ids. A stable local id also permits
    // pure callers to plan legacy links without using input-array positions.
    const id = edge.id != null ? String(edge.id)
      : `presentation:${JSON.stringify([from, to, type, String(edge.label || '')])}`;
    normalized.push({ ...edge, id, from, to, type });
  }
  normalized.sort(compareEdges);
  const idCounts = new Map();
  for (const edge of normalized) idCounts.set(edge.id, (idCounts.get(edge.id) || 0) + 1);
  const identifiable = edge => Boolean(edge.id.trim()) && idCounts.get(edge.id) === 1;
  const representatives = new Map();
  for (const edge of normalized) {
    if (!DIRECTIONAL_CONTENT_PRIORITY.has(edge.type) || !identifiable(edge)) continue;
    const key = endpointKey(edge), previous = representatives.get(key);
    if (!previous
      || DIRECTIONAL_CONTENT_PRIORITY.get(edge.type) < DIRECTIONAL_CONTENT_PRIORITY.get(previous.type)
      || edge.type === previous.type && compareEdges(edge, previous) < 0) {
      representatives.set(key, edge);
    }
  }
  const visibleLinks = [], supplementaryLinks = [];
  const representedByLinkId = new Map(), supplementaryReasons = new Map();
  for (const edge of normalized) {
    const representative = edge.type === 'sequence' && identifiable(edge)
      ? representatives.get(endpointKey(edge)) : null;
    if (!representative) { visibleLinks.push(edge); continue; }
    supplementaryLinks.push(edge);
    if (!representedByLinkId.has(representative.id)) representedByLinkId.set(representative.id, []);
    representedByLinkId.get(representative.id).push(edge);
    supplementaryReasons.set(edge.id, {
      reason: 'same-direction-content', representativeId: representative.id,
    });
  }
  return { visibleLinks, supplementaryLinks, representedByLinkId, supplementaryReasons };
}
