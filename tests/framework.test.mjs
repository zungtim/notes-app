import test from 'node:test';
import assert from 'node:assert/strict';
import { frameworkView, frameworkMembers, frameworkProgress, frameworkScopeForNote, frameworkScopeOptions, isFrameworkPlaceholder, noteStatusLabel, topicRecordSummary, frameworkHighlights } from '../src/public/framework.js';

const labels={inbox:'待整理',learning:'学习中',understood:'已理解',review:'待复习'};
const note=(id,tags,content='',status='inbox')=>({id,title:id,type:'concept',tags,content,status});
const notes=[note('group',['框架模块','框架节点']),note('chapter',['框架模块'],'## 本节核心\n\n已确认的概括。','understood'),note('known',[],'## 本节核心\n\n**核心理论：测试模型——解释观察。**','understood'),note('next',['框架节点']),note('otherGroup',['框架模块','框架节点']),note('other',['框架节点']),note('loose',[],'新笔记。','learning')];
const edge=(from,to,type='branch')=>({from,to,type});
const links=[edge('group','chapter'),edge('chapter','known'),edge('group','next'),edge('otherGroup','other'),edge('known','other','prerequisite'),edge('group','otherGroup','applies')];

test('overview contains top modules; a module canvas contains only its own members',()=>{
  assert.deepEqual(frameworkView(notes,links,'overview',labels).notes.map(n=>n.id),['group','otherGroup']);
  const groupView=frameworkView(notes,links,'group',labels);
  assert.deepEqual(groupView.notes.map(n=>n.id),['group','chapter','next']);
  assert.deepEqual(groupView.notes.filter(n=>n.graphContext),[]);
  assert.deepEqual(frameworkView(notes,links,'chapter',labels).notes.map(n=>n.id),['chapter','known']);
  assert.deepEqual(frameworkMembers('group',notes,links,true).map(n=>n.id),['group','chapter','known','next']);
  assert.equal(frameworkScopeForNote('known',notes,links),'chapter');
  assert.equal(frameworkScopeForNote('loose',notes,links),'unassigned');
  assert.deepEqual(frameworkView(notes,links,'unassigned',labels).notes.map(n=>n.id),['loose']);
  assert.equal(frameworkScopeOptions(notes,links).unassigned,'未归入模块的笔记');
});

test('planned content stays empty and progress is based on actual note states',()=>{
  const before=structuredClone(notes);
  assert.deepEqual(frameworkProgress('group',notes,links),{understood:2,learning:0,review:0,pending:1,recorded:2});
  assert.equal(noteStatusLabel(notes[3],labels),'待学习');
  assert.equal(noteStatusLabel({...notes[3],content:'已填写内容。'},labels),'待整理');
  assert.equal(noteStatusLabel({...notes[3],status:'learning'},labels),'学习中');
  assert.equal(isFrameworkPlaceholder(notes[3]),true);
  assert.match(frameworkView(notes,links,'overview',labels).notes[0].caption,/2 已理解.*1 待学习/);
  assert.equal(topicRecordSummary(notes),'3 条有正文笔记 · 3 个模块 · 2 个待学习节点');
  assert.deepEqual(notes,before);
});

test('branch cycles terminate and ordinary topics keep all original notes and links',()=>{
  assert.equal(frameworkMembers('group',notes,[...links,edge('known','group')],true).length,4);
  const plain=[note('a',[]),note('b',[])],plainLinks=[edge('a','b','extends')];
  const view=frameworkView(plain,plainLinks,'overview',labels);
  assert.deepEqual(view.notes.map(({displayHighlights,displayHighlightSource,...original})=>original),plain);
  assert.equal(view.links,plainLinks);
  assert.deepEqual(view.externalLinks,[]);
  assert.equal(view.hiddenDescendantCount,0);
  assert.equal(view.contextNodeCount,0);
  assert.equal(topicRecordSummary(plain),'2 条笔记');
});

test('cross-module relationships stay in the overview without expanding a module canvas',()=>{
  const graphNotes=[note('root',['框架模块']),note('leaf',[],'已有正文','learning'),
    note('before',['框架模块']),note('after',['框架模块']),note('parallel',['框架模块']),
    note('second-hop',['框架模块']),note('leaf-target',['框架模块']),note('reading-only',['框架模块']),
    note('foreign-leaf',[],'另一模块的笔记','understood')];
  const graphLinks=[edge('root','leaf'),edge('before','root','prerequisite'),edge('root','after','applies'),
    edge('parallel','root','parallel'),edge('after','second-hop','extends'),edge('leaf','leaf-target','applies'),
    edge('root','reading-only','sequence'),edge('after','foreign-leaf'),edge('root','foreign-leaf','evidence')];
  const snapshot=structuredClone({graphNotes,graphLinks});
  const view=frameworkView(graphNotes,graphLinks,'root',labels);
  assert.deepEqual(view.notes.map(n=>n.id),['root','leaf']);
  assert.deepEqual(view.notes.filter(n=>n.graphContext),[]);
  assert.deepEqual(view.links.map(({from,to,type})=>({from,to,type})),[edge('root','leaf')]);
  assert.ok(frameworkView(graphNotes,graphLinks,'overview',labels).links.some(e=>e.from==='before'&&e.to==='root'),'The original cross-module relationship remains accessible in the overview');
  assert.deepEqual(frameworkMembers('root',graphNotes,graphLinks).map(n=>n.id),['root','leaf']);
  assert.deepEqual(frameworkProgress('root',graphNotes,graphLinks),{understood:0,learning:1,review:0,pending:0,recorded:1});
  assert.ok(frameworkView(graphNotes,graphLinks,'overview',labels).notes.every(n=>!n.graphContext));
  assert.deepEqual({graphNotes,graphLinks},snapshot);
});

test('card highlights excerpt two existing core statements and remove Markdown, links, math and code',()=>{
  const source=note('excerpt',[],[
    '## 本节核心','',
    '**结论：** [模型](https://example.org/model) 解释观测。','',
    '- **判断：** 比较 $E=\\frac{p^2}{2m}$ 与 [条件](#/topic/example/note/conditions)。',
    '- 第三条保留在正文。','',
    '```js','不属于要点的代码','```','',
    '$$','\\frac{a}{b}','$$','',
    '## 研究联系','',
    '后续可能的用途不冒充核心结论。','',
    '## 附图','',
    '![图片](https://example.org/image.png)'
  ].join('\n'),'learning');
  const before=structuredClone(source), result=frameworkHighlights(source);
  assert.deepEqual(result,{displayHighlights:['结论： 模型 解释观测。','判断： 比较 … 与 条件。'],displayHighlightSource:'正文摘录'});
  assert.ok(result.displayHighlights.every(line=>!/[\\$*`]|https?:|#\//.test(line)));
  assert.deepEqual(source,before);
  assert.deepEqual(frameworkHighlights(note('formula',[],'$$\\frac{a}{b}$$')),{displayHighlights:[],displayHighlightSource:''});
});

test('empty module highlights use direct child titles without filling placeholders or borrowing descendant prose',()=>{
  const graphNotes=[note('module',['框架模块','框架节点']),
    {...note('child',['框架模块']),title:'[已有子模块](https://example.org/path)'},
    {...note('next',['框架节点']),title:'待学概念'},note('deep',[],'不应借用的下层正文','understood')];
  const graphLinks=[edge('module','child'),edge('module','next'),edge('child','deep')];
  const before=structuredClone(graphNotes);
  assert.deepEqual(frameworkHighlights(graphNotes[0],graphNotes,graphLinks),{
    displayHighlights:['已有子模块','待学概念'],displayHighlightSource:'框架目录'
  });
  const view=frameworkView(graphNotes,graphLinks,'module',labels);
  assert.equal(view.notes.find(n=>n.id==='module').content,'');
  assert.equal(view.notes.find(n=>n.id==='next').content,'');
  assert.deepEqual(view.notes.find(n=>n.id==='next').displayHighlights,[]);
  assert.equal(view.notes.find(n=>n.id==='next').status,'inbox');
  assert.deepEqual(graphNotes,before);
});

test('editing prose only updates excerpts while visible note ids and relationship structure stay unchanged',()=>{
  const graphNotes=[note('module',['框架模块'],'## 本节核心\n\n原有结论。'),note('member',[],'原有内容。')];
  const graphLinks=[edge('module','member')];
  const first=frameworkView(graphNotes,graphLinks,'module',labels);
  const changed=graphNotes.map(n=>({...n,content:'## 本节核心\n\n'+('新结论与适用条件。'.repeat(12))}));
  const second=frameworkView(changed,graphLinks,'module',labels);
  assert.deepEqual(first.notes.map(n=>n.id),second.notes.map(n=>n.id));
  assert.deepEqual(first.links,second.links);
  assert.notDeepEqual(first.notes[0].displayHighlights,second.notes[0].displayHighlights);
  assert.ok(second.notes.every(n=>n.displayHighlights.length<=2&&n.displayHighlights.every(line=>Array.from(line).length<=56)));
  assert.ok(second.notes[0].displayHighlights[0].endsWith('…'));
});

test('module membership and sibling prerequisite remain distinct and simultaneously visible',()=>{
  const items=[note('m',['框架模块']),note('a',[]),note('b',[])];
  const relations=[edge('m','a'),edge('m','b'),edge('a','b','prerequisite')];
  const before=structuredClone({items,relations});
  const view=frameworkView(items,relations,'m',labels);
  assert.deepEqual(view.notes.map(n=>n.id),['m','a','b']);
  assert.deepEqual(view.links.map(({from,to,type})=>({from,to,type})),relations);
  assert.deepEqual(view.externalLinks,[]);
  assert.deepEqual({items,relations},before);
});

test('module boundary records preserve both directions and expose the external target scope',()=>{
  const view=frameworkView(notes,links,'chapter',labels);
  assert.deepEqual(view.notes.map(n=>n.id),['chapter','known']);
  assert.deepEqual(view.externalLinks.map(({visibleId,externalId,type,externalScope})=>({visibleId,externalId,type,externalScope})),[
    {visibleId:'chapter',externalId:'group',type:'branch',externalScope:'group'},
    {visibleId:'known',externalId:'other',type:'prerequisite',externalScope:'otherGroup'},
  ]);
  assert.equal(view.externalLinks[1].externalNote.title,'other');
  assert.equal(view.baseVisibleCount,2);
  assert.equal(view.contextNodeCount,0);
});

test('retired context expansion requests cannot add foreign cards or modify source records',()=>{
  const before=structuredClone({notes,links});
  const view=frameworkView(notes,links,'chapter',labels,{includeContext:true});
  assert.deepEqual(view.notes.map(n=>n.id),['chapter','known']);
  assert.deepEqual(view.notes.filter(n=>n.contextNode),[]);
  assert.equal(view.notes.some(n=>n.id==='next'),false,'A neighbour of the context node is not a second expansion hop');
  assert.equal(view.notes.some(n=>n.id==='otherGroup'),false,'Context membership is not silently reassigned');
  assert.deepEqual(view.links.map(({from,to,type})=>({from,to,type})),[
    edge('chapter','known'),
  ]);
  assert.equal(view.contextNodeCount,0);
  assert.equal(view.externalLinks.length,2,'Boundary metadata remains available to collapse the added context');
  assert.deepEqual({notes,links},before);
});

test('hidden descendants count actual omitted nodes and invalid external endpoints are never fabricated',()=>{
  assert.equal(frameworkView(notes,links,'group',labels).hiddenDescendantCount,1);
  assert.equal(frameworkView(notes,links,'overview',labels).hiddenDescendantCount,4);
  assert.equal(frameworkView(notes,links,'overview',labels,{includeContext:true}).hiddenDescendantCount,4);
  const local=[{...note('m',['框架模块']),topicId:'t'}, {...note('a',[]),topicId:'t'}, {...note('foreign',[]),topicId:'another'}];
  const relations=[edge('m','a'),edge('a','missing','applies'),edge('a','foreign','prerequisite')];
  const view=frameworkView(local,relations,'m',labels,{includeContext:true});
  assert.deepEqual(view.notes.map(n=>n.id),['m','a']);
  assert.deepEqual(view.externalLinks,[]);
  assert.equal(view.contextNodeCount,0);
  assert.deepEqual(view.links.map(({from,to,type})=>({from,to,type})),[edge('m','a')]);
});
