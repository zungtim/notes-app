import test from 'node:test';
import assert from 'node:assert/strict';
import { essentialGraphPlan } from '../src/public/graph-presentation.js';

const notes = ids => ids.map(id => ({ id, title: String(id) }));
const edge = (id, from, to, type, label = '') => ({ id, from, to, type, label });
const ids = links => links.map(link => link.id).sort();
const frozen = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
};

test('An overlapping study arrow shares its exact directed content edge without changing either meaning', () => {
  const knowledge = edge('knowledge', 'a', 'b', 'prerequisite', 'A supplies the required definition');
  const reading = edge('reading', 'a', 'b', 'sequence', 'Review A before B; not a proof');
  const original = frozen({ notes: notes(['a', 'b']), links: [reading, knowledge] });
  const snapshot = structuredClone(original);
  const plan = essentialGraphPlan(original.notes, original.links);
  assert.deepEqual(plan.visibleLinks, [knowledge]);
  assert.deepEqual(plan.supplementaryLinks, [reading]);
  assert.deepEqual(plan.representedByLinkId.get('knowledge'), [reading]);
  assert.deepEqual(plan.supplementaryReasons.get('reading'), {
    reason: 'same-direction-content', representativeId: 'knowledge',
  });
  assert.deepEqual(original, snapshot);
});

test('Indirect scientific paths and mixed membership paths cannot suppress a direct reading edge', () => {
  const links = [edge('ab', 'a', 'b', 'prerequisite'), edge('bc', 'b', 'c', 'applies'),
    edge('read-ac', 'a', 'c', 'sequence'), edge('ma', 'm', 'a', 'branch'),
    edge('read-ma', 'm', 'a', 'sequence')];
  const plan = essentialGraphPlan(notes(['m', 'a', 'b', 'c']), links);
  assert.deepEqual(ids(plan.visibleLinks), ids(links));
  assert.deepEqual(plan.supplementaryLinks, []);
});

test('A sparse course keeps all reading links that lack a coincident content arrow', () => {
  const links = [edge('ab', 'a', 'b', 'sequence'), edge('bc', 'b', 'c', 'sequence'),
    edge('cd', 'c', 'd', 'sequence'), edge('known-ab', 'a', 'b', 'extends')];
  const plan = essentialGraphPlan(notes(['a', 'b', 'c', 'd']), links);
  assert.deepEqual(ids(plan.visibleLinks), ['bc', 'cd', 'known-ab']);
  assert.deepEqual(ids(plan.supplementaryLinks), ['ab']);
});

test('Membership-only and reading-only graphs remain fully connected as originally specified', () => {
  const links = [edge('ma', 'm', 'a', 'branch'), edge('mb', 'm', 'b', 'branch'),
    edge('mc', 'm', 'c', 'branch'), edge('ab', 'a', 'b', 'sequence'),
    edge('bc', 'b', 'c', 'sequence')];
  const plan = essentialGraphPlan(notes(['m', 'a', 'b', 'c']), links);
  assert.deepEqual(ids(plan.visibleLinks), ids(links));
  assert.equal(plan.representedByLinkId.size, 0);
});

test('Parallel and reverse arrows cannot be mistaken for a same-direction content explanation', () => {
  const links = [edge('parallel', 'a', 'b', 'parallel'), edge('read-ab', 'a', 'b', 'sequence'),
    edge('forward', 'b', 'c', 'prerequisite'), edge('read-cb', 'c', 'b', 'sequence')];
  const plan = essentialGraphPlan(notes(['a', 'b', 'c']), links);
  assert.deepEqual(ids(plan.visibleLinks), ids(links));
  assert.deepEqual(plan.supplementaryLinks, []);
});

test('Multiple scientific inputs, same-endpoint types, evidence, contradiction and feedback all remain visible', () => {
  const links = [edge('am', 'a', 'merge', 'prerequisite'), edge('bm', 'b', 'merge', 'evidence'),
    edge('am-application', 'a', 'merge', 'applies'), edge('mc', 'merge', 'c', 'extends'),
    edge('ca', 'c', 'a', 'extends'), edge('compare', 'a', 'b', 'contradicts'),
    edge('parallel', 'a', 'b', 'parallel'), edge('read-am', 'a', 'merge', 'sequence')];
  const plan = essentialGraphPlan(notes(['a', 'b', 'merge', 'c']), links);
  assert.deepEqual(ids(plan.visibleLinks), ids(links.filter(link => link.type !== 'sequence')));
  assert.deepEqual(ids(plan.supplementaryLinks), ['read-am']);
  assert.deepEqual(ids(plan.representedByLinkId.get('am')), ['read-am']);
  assert.equal(plan.representedByLinkId.has('am-application'), false);
});

test('Representative choice and every output order are deterministic across shuffled imports', () => {
  const links = [edge('z-prior', 'a', 'b', 'prerequisite', 'Second stored explanation'),
    edge('a-prior', 'a', 'b', 'prerequisite', 'First stored explanation'),
    edge('apply', 'a', 'b', 'applies'), edge('read-2', 'a', 'b', 'sequence', 'A second reading note'),
    edge('read-1', 'a', 'b', 'sequence', 'The primary reading note'), edge('bc', 'b', 'c', 'extends')];
  const graphNotes = notes(['a', 'b', 'c']);
  const expected = essentialGraphPlan(graphNotes, links);
  assert.equal(expected.visibleLinks.filter(link => link.from === 'a' && link.to === 'b').length, 3,
    'Distinct stored content explanations are not deduplicated away');
  assert.deepEqual(ids(expected.representedByLinkId.get('a-prior')), ['read-1', 'read-2']);
  for (const reordered of [[...links].reverse(), [...links.slice(2), ...links.slice(0, 2)]]) {
    assert.deepEqual(essentialGraphPlan([...graphNotes].reverse(), reordered), expected);
  }
});

test('Prototype-shaped ids, numeric ids and missing edge ids stay safe and deterministic', () => {
  const graphNotes = notes(['__proto__', 'constructor', 7]);
  const links = [edge('__proto__', '__proto__', 'constructor', 'evidence'),
    edge('constructor', '__proto__', 'constructor', 'sequence'),
    { from: 'constructor', to: 7, type: 'extends', label: 'Existing explanation' },
    { from: 'constructor', to: '7', type: 'sequence', label: 'Read this next' }];
  const plan = essentialGraphPlan(graphNotes, links);
  assert.deepEqual(plan.representedByLinkId.get('__proto__').map(link => link.id), ['constructor']);
  assert.equal(plan.visibleLinks.length, 2);
  assert.equal(plan.supplementaryLinks.length, 2);
  assert.deepEqual(essentialGraphPlan([...graphNotes].reverse(), [...links].reverse()), plan);
});

test('Invalid endpoints and self-loops are ignored without fabricating fallback relationships', () => {
  const links = [null, {}, edge('self', 'a', 'a', 'sequence'),
    edge('missing', 'a', 'missing', 'prerequisite'), edge('valid', 'a', 'b', 'sequence')];
  const plan = essentialGraphPlan([null, {}, ...notes(['a', 'b'])], links);
  assert.deepEqual(ids(plan.visibleLinks), ['valid']);
  assert.deepEqual(plan.supplementaryLinks, []);
  assert.deepEqual(essentialGraphPlan([], links).visibleLinks, []);
});

test('Empty and duplicate ids never combine explanations belonging to different stored endpoints', () => {
  const links = [edge('', 'a', 'b', 'prerequisite'), edge('read-ab', 'a', 'b', 'sequence'),
    edge('shared-content', 'c', 'd', 'prerequisite'), edge('shared-content', 'e', 'f', 'prerequisite'),
    edge('read-cd', 'c', 'd', 'sequence'), edge('read-ef', 'e', 'f', 'sequence'),
    edge('safe-content', 'g', 'h', 'extends'), edge('', 'g', 'h', 'sequence'),
    edge('repeated-reading', 'g', 'h', 'sequence'), edge('repeated-reading', 'h', 'g', 'sequence'),
    edge('  ', 'c', 'a', 'applies'), edge('read-ca', 'c', 'a', 'sequence'),
    edge('good-content', 'i', 'j', 'prerequisite'), edge('good-reading', 'i', 'j', 'sequence')];
  const before = structuredClone(links);
  const plan = essentialGraphPlan(notes(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']), links);
  assert.deepEqual(ids(plan.supplementaryLinks), ['good-reading']);
  assert.deepEqual(ids(plan.visibleLinks), ids(links.filter(link => link.id !== 'good-reading')));
  assert.deepEqual([...plan.representedByLinkId.keys()], ['good-content']);
  assert.deepEqual([...plan.supplementaryReasons.keys()], ['good-reading']);
  assert.deepEqual(links, before, 'Defensive presentation does not repair or rewrite old ids');
});

test('Unrecognized relation types stay visible and cannot suppress explicitly stored study order', () => {
  const links = [edge('custom', 'a', 'b', 'custom-relation'), edge('read', 'a', 'b', 'sequence')];
  const plan = essentialGraphPlan(notes(['a', 'b']), links);
  assert.deepEqual(ids(plan.visibleLinks), ['custom', 'read']);
  assert.equal(plan.supplementaryReasons.size, 0);
});

test('Every valid input edge remains recoverable and prose cannot alter the presentation policy', () => {
  const links = [edge('content', 'a', 'b', 'prerequisite'), edge('reading', 'a', 'b', 'sequence'),
    edge('context', 'b', 'c', 'extends'), edge('feedback', 'c', 'a', 'applies')];
  const graphNotes = notes(['a', 'b', 'c']);
  const plan = essentialGraphPlan(graphNotes, links);
  assert.deepEqual(ids([...plan.visibleLinks, ...plan.supplementaryLinks]), ids(links));
  const rewritten = graphNotes.map(note => ({ ...note, title: 'A different heading',
    content: 'Number 1, related words, or a new paragraph', status: 'understood', position: { x: 99, y: -5 } }));
  assert.deepEqual(essentialGraphPlan(rewritten, links), plan);
});
