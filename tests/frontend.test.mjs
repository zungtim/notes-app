import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNotebookFixture } from './fixtures/notebook.mjs';
import { validateImport,mergeNotebooks } from '../src/public/import.js';
import { NotebookStore, validateNotebook } from '../src/lib/store.mjs';
import { renderMarkdown,safeURL } from '../src/public/markdown.js';
import { noteSummary, renderNoteBody, REVIEW_TEMPLATE } from '../src/public/review.js';
const seed=createNotebookFixture();
let counter=0;const uid=prefix=>`${prefix}_test_${++counter}`;

test('original export merges without duplicating notes or relationships',()=>{
  const result=mergeNotebooks(seed,seed,uid);
  assert.deepEqual(result,seed);validateNotebook(result);
});
test('source-only, tag-only and status-only edits survive backup merging',()=>{
  for(const kind of ['source','tag','status']){
    const old=structuredClone(seed);
    if(kind==='source')old.notes[0].sources[0].excerpt+=' additional source context';
    if(kind==='tag')old.notes[0].tags.push('new-tag');
    if(kind==='status')old.notes[0].status='review';
    const result=mergeNotebooks(seed,old,uid);
    assert.equal(result.notes.length,seed.notes.length+1);
    const added=result.notes.find(n=>!seed.notes.some(s=>s.id===n.id));
    assert.deepEqual(added.sources,old.notes[0].sources);
    assert.deepEqual(added.tags,old.notes[0].tags);
    assert.equal(added.status,old.notes[0].status);
    assert.ok(result.links.some(l=>l.from===added.id||l.to===added.id));
    validateNotebook(result);
  }
});
test('invalid dates, unsafe colors, duplicate identifiers and cross-topic links reject before import',()=>{
  const mutations=[
    d=>{delete d.notes[0].createdAt;},
    d=>{d.topics[0].color='\" onclick=\"alert(1)';},
    d=>{d.notes[1].id=d.notes[0].id;},
    d=>{d.notes[0].position={x:Infinity,y:0};},
    d=>{d.links[0].to=d.notes.find(n=>n.topicId!==d.links[0].topicId).id;},
    d=>{d.notes[0].sources[0].title='';}
  ];
  for(const mutate of mutations){const d=structuredClone(seed);mutate(d);assert.throws(()=>validateImport(d));assert.throws(()=>validateNotebook(d));}
});
test('Markdown displays untrusted content as text and rejects executable links',()=>{
  const html=renderMarkdown('<img src=x onerror=alert(1)>\n\n[bad](javascript:alert)\n\n```html\n<script>alert(1)</script>\n```');
  assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('&lt;img'));assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(safeURL('javascript:alert(1)'),null);assert.equal(safeURL('file:///D:/secret'),null);
  assert.equal(safeURL('https://doi.org/10.1021/cr200349r'),'https://doi.org/10.1021/cr200349r');
  assert.ok(renderMarkdown('| A | B |\n| --- | --- |\n| one | two |').includes('<table>'));
});

test('common derivation notation renders without exposing TeX source or accepting executable markup',()=>{
  for(const formula of [String.raw`N=\lceil q\rceil`,String.raw`-k\cot(ka)=\kappa`,String.raw`\Psi^{*\prime\prime}`,String.raw`e^x-1\simeq x`]){
    const html=renderMarkdown(`$$\n${formula}\n$$`);
    assert(html.includes('<math'));assert(!html.includes('class="math-source"'));
  }
  assert(!renderMarkdown('$$\n\\text{<script>bad</script>}\n$$').includes('<script>'));
});

test('review links open notes in the current app and keep unsafe relative links inert',()=>{
  const internal=renderMarkdown('[Review](#/topic/topic_unit/note/note-unit)');
  assert.ok(internal.includes('<a href="#/topic/topic_unit/note/note-unit">Review</a>'));
  assert.ok(!internal.includes('target="_blank"'));
  assert.ok(renderMarkdown('[Scoped](#/topic/topic_unit/note/note-unit?scope=module-unit)').includes('href="#/topic/topic_unit/note/note-unit?scope=module-unit"'));
  for(const href of ['#/topic/topic_unit/note/note-unit?redirect=evil','//example.org','../secret','#javascript:alert']){
    assert.ok(!renderMarkdown(`[Unsafe](${href})`).includes('<a href='));
  }
  assert.ok(renderMarkdown('[Source](https://example.org)').includes('target="_blank" rel="noopener noreferrer"'));
});

test('list previews recall the conclusion without exposing table links or formula source',()=>{
  const content='## 本节核心\n\n**核心：比较条件后选择模型。**\n\n| 顺序 | 内容 |\n| --- | --- |\n| [下一节](#/topic/topic_unit/note/note-unit) | 详情 |\n\n$$\n\\frac{h}{p}\n$$\n\n## 研究联系\n\n其他内容。';
  assert.equal(noteSummary(content),'核心：比较条件后选择模型。');
  assert.equal(noteSummary('# 标题\n参见 [下一节](#/topic/topic_unit/note/note-unit)。\n\n下一段。'),'参见 下一节。');
  assert.equal(noteSummary('普通正文第一段。\n\n第二段。'),'普通正文第一段。');
});

test('review shows derivations and images in the same continuous flow',()=>{
  const image='/images/'+'a'.repeat(64)+'.png';
  const content='## 本节核心\n\n**先确定所求量。**\n\n## 研究联系\n\n用于比较测量。\n\n## 推导与展开\n\n展开的计算步骤。\n\n$$\n\\frac{1}{2}\n$$\n\n## 附图\n\n![原图]('+image+')';
  const html=renderNoteBody(content);
  assert.equal((html.match(/<details\b/g)||[]).length,0);
  assert(html.indexOf('先确定所求量')<html.indexOf('展开的计算步骤'));
  assert(html.indexOf('展开的计算步骤')<html.indexOf(`src="${image}"`));
  assert(html.includes('<math')&&!html.includes('math-source'));
  assert(html.includes(`src="${image}"`));
  assert.equal(noteSummary(content),'先确定所求量。');
  assert(REVIEW_TEMPLATE.includes('必要推导或证据'));
});

test('support headings in code stay literal and later ordinary sections remain visible',()=>{
  const content='```md\n## 推导与展开\ncode only\n```\n\n## 补充说明\n补充材料。\n\n## 研究联系\n正文中的研究联系。';
  const html=renderNoteBody(content);
  assert.equal((html.match(/<details\b/g)||[]).length,0);
  assert(html.includes('<pre><code>## 推导与展开'));
  assert(html.indexOf('正文中的研究联系')>html.indexOf('补充材料'));
});


test('continuous supplements never label a populated note as empty',()=>{
  const cases=[
    '## 本节核心\n已写好的核心。\n\n## 补充说明\n折叠的说明。\n',
    '## 补充说明\n只有补充的笔记。\n\n',
    '## 推导与展开\n第一份材料。\n\n## 附图\n附图说明。',
    '## 补充说明\n折叠的说明。\n\n## 研究联系\n仍需显示的后续正文。'
  ];
  for(const content of cases){
    const html=renderNoteBody(content);
    assert(!html.includes('这条笔记还没有正文'));
    assert(!html.includes('<details'));
  }
  for(const content of ['', '  \n\n']){
    assert.equal((renderNoteBody(content).match(/这条笔记还没有正文/g)||[]).length,1);
  }
});


test('study sequence links survive saving, JSON import and repeated backup merging', async () => {
  const notebook = createNotebookFixture();
  notebook.links.push({
    id: 'study_step_ab', topicId: 'topic_a', from: 'note_a', to: 'note_b',
    type: 'sequence', label: 'Read this next; no prerequisite claim',
  });
  const original = structuredClone(notebook);
  assert.equal(validateNotebook(notebook), notebook);
  assert.equal(validateImport(notebook), notebook);

  const root = process.env.NOTES_TEST_ARTIFACTS
    || fileURLToPath(new URL('../_workspace/test-artifacts/', import.meta.url));
  await fs.mkdir(root, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(root, 'study-sequence-import-'));
  const saved = await new NotebookStore(dataDir).save(notebook, notebook.revision);
  assert.equal(saved.revision, 1);
  const restored = await new NotebookStore(dataDir).read();
  assert.deepEqual(restored, saved, 'A fresh store keeps the sequence relation intact');
  assert.deepEqual(notebook, original, 'Saving cannot rewrite input note state or positions');

  const imported = validateImport(JSON.parse(JSON.stringify(restored)));
  const empty = { version: 1, revision: 0, topics: [], notes: [], links: [] };
  const merged = mergeNotebooks(empty, imported, uid);
  validateNotebook(merged);
  assert.deepEqual(merged.notes, imported.notes);
  assert.deepEqual(merged.links, imported.links);
  assert.deepEqual(merged.links.map(link => link.type), ['extends', 'sequence'],
    'Reading order and a conceptual relation can coexist between the same two notes');
  assert.deepEqual(mergeNotebooks(merged, imported, uid), merged,
    'Importing the same study route again cannot duplicate its links');

  const crossTopic = structuredClone(imported);
  crossTopic.links.find(link => link.type === 'sequence').to = 'note_c';
  assert.throws(() => validateImport(crossTopic));
  assert.throws(() => validateNotebook(crossTopic));
});
