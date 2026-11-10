import { KnowledgeGraph, GRAPH_RELATIONS } from './graph.js';
import { cleanGraphPlan } from './graph-layout.js';
import { installPaneLayout, PANE_STORAGE_KEY } from './pane-layout.js';
import { createLocalStateClient, cleanExportLabel } from './local-state.js';
let paneLayout = null;
import { isFrameworkModule, isFrameworkPlaceholder, noteStatusLabel, frameworkScopeOptions, frameworkView, topicRecordSummary } from './framework.js';
import { REVIEW_TEMPLATE, renderNoteBody, noteSummary, installNoteOutline } from './review.js';
import { escapeHTML as esc, renderMarkdown, plainText, safeURL } from './markdown.js';
import { validateImport, mergeNotebooks } from './import.js';
import { bindImageEditor, imagesUploading, installImageUI } from './images.js';
import { createBackup, parseBackup, restoreBackupImages, MAX_BACKUP_BYTES } from './backup.js';
import { createHashNavigation, parseRoute } from './navigation.js';

const TYPES = {concept:'概念',question:'问题',insight:'思考',paper:'文献',method:'方法'};
const STATUSES = {inbox:'待整理',learning:'学习中',understood:'已理解',review:'待复习'};
const SOURCES = {conversation:'对话摘录',paper:'文献阅读',thought:'自己的思考',web:'网页资料',other:'其他来源'};
const RELATIONS = {sequence:'学习顺序',parallel:'并列',branch:'分支',extends:'延伸',prerequisite:'前置',evidence:'依据',contradicts:'辨析',applies:'应用'};
const RELATION_HELP = {sequence:'按这条箭头接着学习或复习，不表示起点严格推导出终点。',parallel:'两个概念同属一个层次，可以一起比较，不表示先后。',branch:'从一个主题发散出一个子问题或子概念。',extends:'沿着已有理解进一步推导、扩展或深入。',prerequisite:'先理解起点笔记，再学习终点笔记。',evidence:'起点提供支持终点观点的文献、观察或依据。',contradicts:'标出需要辨别的差异、矛盾或容易混淆之处。',applies:'把起点的原理用于终点的实验、方法或情境。'};
const ICON_PATHS = {
  spaces:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  notes:'<path d="M6 3h10l3 3v15H6z"/><path d="M15 3v5h4M9 12h7M9 16h5"/>',
  question:'<circle cx="12" cy="12" r="9"/><path d="M9.2 9a3 3 0 0 1 5.6 1c0 2-2.8 2.4-2.8 4M12 17h.01"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
  upload:'<path d="M12 15V3m-4 4 4-4 4 4M4 16v4h16v-4"/>',
  help:'<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM13 7a3 3 0 0 1 3-3h4v15h-3a4 4 0 0 0-4 2"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  graph:'<circle cx="5" cy="12" r="2.5"/><circle cx="18" cy="5" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m7 11 9-5m-9 7 9 5"/>',
  atom:'<ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/><circle cx="12" cy="12" r="1"/>',
  route:'<circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 5h8a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8h8"/>',
  idea:'<path d="M9 18h6M10 21h4M8 15c-5-5-2-12 4-12s9 7 4 12l-1 3H9z"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  edit:'<path d="m15 4 5 5-11 11-6 1 1-6zM13 6l5 5"/>',
  link:'<path d="m10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(2 0) scale(.83 1)"/>',
  fit:'<path d="M9 3H3v6M15 3h6v6M21 15v6h-6M3 15v6h6"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  check:'<path d="m5 12 4 4 10-10"/>',
  source:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.notes}</svg>`;
const typeIcon = type => ({concept:'atom',question:'question',insight:'idea',paper:'source',method:'route'})[type] || 'notes';
const state = {db:null,readOnly:false,route:{view:'home',topicId:null,noteId:null},graph:null,editing:false,focusReading:true,topicView:'graph',layout:'clean',frameworkScopes:{},dirty:false,saving:false,change:0,saveTimer:null,conflict:false,filters:{query:'',type:'',status:'',source:'',tag:'',sort:'updated'},modal:null};
const $ = selector => document.querySelector(selector);
const uid = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-','')}`;
const now = () => new Date().toISOString();
const date = iso => new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'short',day:'numeric'}).format(new Date(iso));
const dateTime = iso => new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));
const options = (values, selected='', blank='') => `${blank ? `<option value="">${esc(blank)}</option>`:''}${Object.entries(values).map(([key,label])=>`<option value="${esc(key)}" ${key===selected?'selected':''}>${esc(label)}</option>`).join('')}`;
const topicOptions = selected => state.db.topics.map(t=>`<option value="${esc(t.id)}" ${t.id===selected?'selected':''}>${esc(t.title)}</option>`).join('');
const noteById = id => state.db.notes.find(n=>n.id===id);
const topicById = id => state.db.topics.find(t=>t.id===id);
const currentNote = () => noteById(state.route.noteId);
const topicNotes = id => state.db.notes.filter(n=>n.topicId===id);
const topicLinks = id => state.db.links.filter(l=>l.topicId===id);
const topicCounts = id => `${topicRecordSummary(topicNotes(id))} · ${topicLinks(id).length} 条连接`;
const statusOptions = note => isFrameworkPlaceholder(note) ? {...STATUSES,inbox:isFrameworkModule(note)?'模块导览':'待学习'} : STATUSES;
function noteBodyHTML(note) {
  if (String(note.content || '').trim()) return renderNoteBody(note.content);
  if (isFrameworkModule(note)) return '<div class="framework-empty"><strong>模块导览</strong><p>在关系图中展开本模块，选择要学习的知识节点。</p></div>';
  if (isFrameworkPlaceholder(note)) return '<div class="framework-empty"><strong>待学习</strong><p>正文留空。学习后再补充核心结论与研究联系；阅读位置可在“来源与连接”中查看。</p></div>';
  return renderNoteBody(note.content);
}
function showFrameworkScope(scope) {
  navigate('topic',state.route.topicId,null,scope);
}
function selectGraphNote(id) {
  if (isFrameworkModule(noteById(id)) && state.frameworkScopes[state.route.topicId]!==id) showFrameworkScope(id);
  else selectNote(id);
}
const normalized = value => String(value || '').normalize('NFKC').toLocaleLowerCase();
function searchText(note) { return normalized([note.title,note.content,note.tags.join(' '),TYPES[note.type],noteStatusLabel(note,STATUSES),topicById(note.topicId)?.title,...note.sources.flatMap(s=>[s.title,s.url,s.excerpt,SOURCES[s.type]])].join('\n')); }
function matches(note, query) { return normalized(query).trim().split(/\s+/).filter(Boolean).every(term=>searchText(note).includes(term)); }
function toast(message, error=false) { const el=$('#toast');el.textContent=message;el.className=`toast show${error?' error':''}`;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3200); }
function updateSaveStatus(text, kind='') {
  const el=$('#save-status');
  el.className=`save-status ${state.readOnly?'read-only':kind}`;
  el.innerHTML=`<span class="local-dot"></span><span>${esc(state.readOnly?'原笔记只读预览':text)}</span>`;
  el.title=state.readOnly?'正在查看原笔记；可以阅读和整理导图，正文、关系与学习状态不会改写。':'点击重试保存';
}
function allowNotebookWrite(){
  if(!state.db){toast('笔记正在载入，请稍候。');return false;}
  if(!state.readOnly)return true;
  toast('原笔记只读预览：可以阅读和整理导图，内容与学习状态保持不变。');
  return false;
}
function applyReadOnlyUI(){
  document.body.classList.toggle('is-read-only',state.readOnly);
  if(!state.readOnly)return;
  const selectors='#capture-sidebar,#topic-sidebar,#home-new-topic,#list-new-note,#edit-topic,#topic-new-note,#add-relation,#toggle-edit,#edit-status,#add-source,#detail-add-link,#connect-on-map,#delete-note,#backup-button,#export-note,[data-remove-link],[data-remove-source]';
  document.querySelectorAll(selectors).forEach(control=>{control.disabled=true;control.title='原笔记只读预览，内容保持不变';});
  const label=$('.local-card strong'),description=$('.local-card p');
  if(label)label.textContent='原笔记只读预览';
  if(description)description.textContent='阅读与导图整理 · 不改写笔记';
}
const localState = createLocalStateClient({onError:(message,error)=>toast(`${message} ${error.message}`,true)});
function keepDraft() {
  if(state.readOnly)return Promise.resolve(false);
  const {version,promise}=localState.captureDraft(state.db,now());
  return promise.catch(error=>{
    if(version===localState.draftVersion&&state.dirty){
      updateSaveStatus('草稿未落盘 · 请保持窗口打开','error');
      toast(`草稿尚未持久保存：${error.message}。请保持窗口打开并重试。`,true);
    }
    return false;
  });
}
function persistPreference(key,value){
  localState.setPreference(key,value).catch(error=>toast(`布局尚未保存：${error.message}。恢复连接后请重新调整。`,true));
}
function graphViewPreferenceKey(topicId,scope){return `notes-graph-view-${topicId}__${scope}`;}
function savedGraphView(topicId,scope){
  try{const view=JSON.parse(localState.preferences[graphViewPreferenceKey(topicId,scope)]||'null');return [1,2].includes(view?.version)?view:null;}catch{return null;}
}
function persistGraphView(view,viewKey){
  if(!viewKey)return;
  const [topicId,scope]=String(viewKey).split(':');if(!topicId||!scope)return;
  persistPreference(graphViewPreferenceKey(topicId,scope),JSON.stringify({version:view.layout==='clean'?2:1,...view}));
}
function mutate(fn) {
  if(!allowNotebookWrite())return Promise.resolve(false);
  fn();state.dirty=true;state.change++;const draft=keepDraft();updateSaveStatus('尚未保存','unsaved');updateChrome();clearTimeout(state.saveTimer);state.saveTimer=setTimeout(save,550);return draft;
}
async function save() {
  clearTimeout(state.saveTimer);
  if(state.readOnly){updateSaveStatus('原笔记只读预览');return;}
  if(!state.dirty || state.saving || state.conflict) return;
  state.saving=true;const change=state.change;const draftVersion=localState.draftVersion;const snapshot=structuredClone(state.db);
  updateSaveStatus('保存中…','unsaved');
  try {
    const response=await fetch('/api/notebook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:snapshot.revision,notebook:snapshot})});
    const result=await response.json();
    if(response.status===409){state.conflict=true;updateSaveStatus('需要处理版本冲突','error');showConflict(result.notebook);return;}
    if(!response.ok) throw new Error(result.message || '保存失败');
    state.db.revision=result.revision;
    state.dirty=state.change!==change;
    if(!state.dirty){
      try{await localState.clearDraft(draftVersion);}catch(error){toast(`笔记已保存，旧草稿未能清理：${error.message}`,true);}
      if(!state.dirty&&state.change===change)updateSaveStatus('已保存在本地');
    }
    else {keepDraft();state.saveTimer=setTimeout(save,150);}
  } catch(error) {updateSaveStatus('未保存 · 点击重试','error');toast(`保存未完成：${error.message}。${localState.draftDurable?'当前修改已保留在本机草稿文件。':'当前修改尚未持久保存，请保持窗口打开并重试。'}`,true);}
  finally {state.saving=false;if(state.dirty&&!state.conflict&&state.change!==change)state.saveTimer=setTimeout(save,150);}
}
const navigation = createHashNavigation({
  readHash:()=>location.hash, setHash:hash=>{location.hash=hash;},
  replaceHash:hash=>history.replaceState(null,'',hash), getNotebook:()=>state.db,
  isBlocked:imagesUploading,
  onBlocked:()=>toast('图片正在保存，请稍候；浏览器导航将在图片处理完成后恢复。'),
  beforeNavigate:()=>{closeModal();state.filters.query='';$('.sidebar')?.classList.remove('open');},
  applyRoute:route=>{
    // Native traversal can remove a focused input without firing change.
    // Commit the tag field while the outgoing note still owns the editor.
    const tagInput=$('#edit-tags'),note=currentNote();
    if(state.editing&&!state.readOnly&&note&&tagInput){
      const tags=parseTags(tagInput.value);
      if(JSON.stringify(tags)!==JSON.stringify(note.tags))updateNote(note.id,{tags});
    }
    // Flush the outgoing graph before changing route/scope. Its callback uses
    // the graph's own viewKey, so its camera cannot leak into the new module.
    paneLayout?.detachTopic();state.graph?.destroy();state.graph=null;
    state.route=route;
    if(route.view==='topic')state.frameworkScopes[route.topicId]=route.scope;
    state.editing=false;render();
  }
});
function navigate(view,topicId=null,noteId=null,scope=null){
  if(noteId&&scope==null&&topicId===state.route.topicId)scope=state.route.scope;
  const changed=navigation.navigate({view,topicId,noteId,scope});
  // Reopening a list can reset its filters without creating a history entry.
  if(!changed&&['home','all','questions','review'].includes(view)&&!imagesUploading())navigation.restore({force:true});
  return changed;
}
function readRoute(){return navigation.restore();}
function updateChrome(){
  if(!state.db)return;
  $('#all-count').textContent=state.db.notes.length;
  $('#question-count').textContent=state.db.notes.filter(n=>n.type==='question'&&n.status!=='understood').length;
  document.querySelectorAll('.primary-nav [data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===state.route.view));
  $('#topic-nav').innerHTML=state.db.topics.map(t=>`<button data-topic="${esc(t.id)}" class="${state.route.topicId===t.id?'active':''}"><span class="topic-dot" style="background:${/^#[0-9a-f]{6}$/i.test(t.color)?t.color:'#23766b'}"></span><span class="topic-name">${esc(t.title)}</span></button>`).join('');
  $('#topic-nav').querySelectorAll('[data-topic]').forEach(button=>button.onclick=()=>navigate('topic',button.dataset.topic));
  const labels={home:'主题',all:'全部笔记',questions:'待解问题',review:'待复习'};
  $('#breadcrumbs').innerHTML=state.route.view==='topic'?`笔记 <span>/</span> <strong>${esc(topicById(state.route.topicId)?.title||'主题')}</strong>`:`笔记 <span>/</span> <strong>${labels[state.route.view]||'主题'}</strong>`;
  applyReadOnlyUI();
}
function render(){paneLayout?.detachTopic();state.graph?.destroy();state.graph=null;updateChrome();paneLayout?.refreshSidebarLabels();if(state.route.view==='home')renderHome();else if(state.route.view==='topic')renderTopic();else renderListPage();applyReadOnlyUI();}
function renderHome(){
  const recent=state.db.notes.filter(n=>String(n.content||'').trim()).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,5);
  $('#main-content').innerHTML=`<div class="page"><section class="hero"><div><h1>笔记</h1><p>记录、检索与复习。</p></div></section><div class="section-row"><h2>我的主题 <small>${state.db.topics.length} 个</small></h2><button class="text-button" id="home-new-topic">${icon('plus')}新建主题</button></div><div class="topic-grid">${state.db.topics.map(t=>{const notes=topicNotes(t.id);return `<button class="topic-card" data-topic="${esc(t.id)}"><h3>${esc(t.title)}</h3>${t.description?`<p class="topic-card-description">${esc(t.description)}</p>`:''}<div class="topic-card-footer"><span>${topicCounts(t.id)}</span><span class="go">${icon('arrow')}</span></div></button>`}).join('')||'<div class="empty-state"><strong>还没有主题</strong><p>点击“新建主题”开始记录。</p></div>'}</div><div class="home-bottom"><section><div class="section-row"><h2>最近更新</h2><button class="text-button" id="home-all">查看全部 ${icon('arrow')}</button></div><div class="recent-list">${recent.map(n=>`<button class="recent-item" data-note="${esc(n.id)}"><span class="note-mini-icon">${icon(typeIcon(n.type))}</span><div class="recent-text"><div class="recent-title">${esc(n.title)}</div><div class="recent-meta"><span>${esc(topicById(n.topicId)?.title||'')}</span><span class="tag status-${n.status}">${noteStatusLabel(n,STATUSES)}</span></div></div><span class="recent-time">${date(n.updatedAt)}</span></button>`).join('')||'<div class="empty-state"><p>新建的笔记会出现在这里。</p></div>'}</div></section></div></div>`;
  $('#home-new-topic').onclick=()=>showTopicForm();$('#home-all').onclick=()=>navigate('all');
  $('#main-content').querySelectorAll('[data-topic]').forEach(b=>b.onclick=()=>navigate('topic',b.dataset.topic));
  $('#main-content').querySelectorAll('[data-note]').forEach(b=>b.onclick=()=>{const n=noteById(b.dataset.note);navigate('topic',n.topicId,n.id);});
}
function filteredNotes(base=state.db.notes){
  const f=state.filters;let notes=base.filter(n=>matches(n,f.query)&&(!f.type||n.type===f.type)&&(!f.status||n.status===f.status)&&(!f.source||n.sources.some(s=>s.type===f.source))&&(!f.tag||n.tags.includes(f.tag)));
  if(f.sort==='title')notes.sort((a,b)=>a.title.localeCompare(b.title,'zh-CN'));else if(f.sort==='created')notes.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));else notes.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));return notes;
}
function noteCard(n){return `<button class="note-list-card" data-note="${esc(n.id)}"><span class="note-mini-icon">${icon(typeIcon(n.type))}</span><div class="note-list-body"><h3>${esc(n.title)}</h3><p>${esc((noteSummary(n.content)||(isFrameworkModule(n)?'模块导览：展开对应学习节点。':isFrameworkPlaceholder(n)?'待学习，正文留空。':'')).slice(0,180))}</p><div class="note-list-meta"><span>${esc(topicById(n.topicId)?.title||'')}</span><span>· ${TYPES[n.type]}</span>${n.tags.slice(0,4).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}<span>${n.sources.length} 个来源</span></div></div><div class="note-list-tail"><span class="tag status-${n.status}">${noteStatusLabel(n,STATUSES)}</span><div style="margin-top:10px">${date(n.updatedAt)}</div></div></button>`;}
function renderListPage(){
  const titles={all:['全部笔记','从标题、正文、标签和来源中找到你需要的线索。'],questions:['待解问题','把暂时没有理解的地方留下来，慢慢找到答案。'],review:['待复习','回到旧的理解，看看能否用自己的话重新说明。']};
  const [title,description]=titles[state.route.view];
  const tags=[...new Set(state.db.notes.flatMap(n=>n.tags))].slice(0,18);
  $('#main-content').innerHTML=`<div class="page"><div class="page-heading"><div><h1>${title}</h1><p>${description}</p></div><button class="button primary" id="list-new-note">${icon('plus')}记录笔记</button></div><div class="list-toolbar"><label class="list-search">${icon('search')}<input id="list-search" aria-label="在笔记中搜索" placeholder="输入关键词，可用空格组合多个词" value="${esc(state.filters.query)}"></label><select class="select" id="filter-type" aria-label="筛选笔记类型">${options(TYPES,state.filters.type,'全部类型')}</select><select class="select" id="filter-status" aria-label="筛选掌握状态">${options(STATUSES,state.filters.status,'全部状态')}</select><select class="select" id="filter-source" aria-label="筛选来源">${options(SOURCES,state.filters.source,'全部来源')}</select><select class="select" id="filter-sort" aria-label="排序方式">${options({updated:'最近更新',created:'最近创建',title:'标题排序'},state.filters.sort)}</select></div><div class="tag-cloud">${tags.map(t=>`<button data-tag="${esc(t)}" class="${state.filters.tag===t?'active':''}"># ${esc(t)}</button>`).join('')}</div><div id="list-results"></div></div>`;
  $('#list-new-note').onclick=()=>showCapture();$('#list-search').oninput=e=>{state.filters.query=e.target.value;renderListResults();};
  for(const [name,key] of [['type','type'],['status','status'],['source','source'],['sort','sort']])$(`#filter-${name}`).onchange=e=>{state.filters[key]=e.target.value;renderListResults();};
  document.querySelectorAll('[data-tag]').forEach(b=>b.onclick=()=>{state.filters.tag=state.filters.tag===b.dataset.tag?'':b.dataset.tag;document.querySelectorAll('[data-tag]').forEach(c=>c.classList.toggle('active',c.dataset.tag===state.filters.tag));renderListResults();});
  renderListResults();
}
function renderListResults(){let base=state.db.notes;if(state.route.view==='questions')base=base.filter(n=>n.type==='question'&&n.status!=='understood');if(state.route.view==='review')base=base.filter(n=>n.status==='review');const notes=filteredNotes(base);$('#list-results').innerHTML=`<div class="note-filter-count">${notes.length} 条笔记${state.filters.tag?` · 标签 ${esc(state.filters.tag)}`:''}</div><div class="note-list">${notes.map(noteCard).join('')||`<div class="empty-state">${icon('search')}<strong>这里暂时没有笔记</strong><p>可以换一个关键词或筛选条件，也可以记录新的问题。</p></div>`}</div>`;$('#list-results').querySelectorAll('[data-note]').forEach(b=>b.onclick=()=>{const n=noteById(b.dataset.note);navigate('topic',n.topicId,n.id);});}
function graphOrganizeControls(){
  return `<button class="button subtle" id="graph-reset" title="按已保存的知识关系整理当前图">${icon('route')}自动整理</button><details class="graph-organize-menu"><summary role="button" aria-label="更多整理选项">⌄</summary><div><button id="graph-routes">仅整理连线</button><button id="graph-auxiliary" aria-pressed="false">查看全部关系</button><button id="graph-membership" aria-pressed="false">显示全部归属连线</button><button id="graph-reflow">重新排版（先预览）</button><button id="graph-undo" disabled>撤销上次布局调整</button></div></details>`;
}
function bindGraphOrganizeMenu() {
  const menu = $('.graph-organize-menu'), panel = menu?.querySelector('div');
  if (!panel || typeof panel.showPopover !== 'function') return;
  // The resizable heading scrolls independently. A top-layer popover keeps
  // the full menu usable even when its trigger sits beside the canvas edge.
  panel.popover = 'auto';
  menu.addEventListener('toggle', () => {
    if (!menu.open) { panel.hidePopover(); return; }
    panel.showPopover();
    const anchor = menu.querySelector('summary').getBoundingClientRect();
    const box = panel.getBoundingClientRect(), margin = 8;
    panel.style.left = `${Math.max(margin, Math.min(anchor.right - box.width, innerWidth - box.width - margin))}px`;
    panel.style.top = `${Math.max(margin, Math.min(anchor.bottom + 4, innerHeight - box.height - margin))}px`;
  });
  panel.addEventListener('toggle', event => { if (event.newState === 'closed') menu.open = false; });
}
function topicPurpose(topic){
  const text=plainText(topic.description||'').trim();
  const sentence=text.match(/^[^。！？!?]+[。！？!?]?/)?.[0]||text;
  const characters=Array.from(sentence);
  return characters.length>140?characters.slice(0,139).join('')+'…':sentence;
}
function renderTopic(){
  const topic=topicById(state.route.topicId);const notes=topicNotes(topic.id);const links=topicLinks(topic.id);

  const scopes=frameworkScopeOptions(notes,links);
  const scope=state.route.scope||'overview';
  const scopeToolbar=Object.keys(scopes).length?`<select class="select framework-scope" id="framework-scope" aria-label="展开学习模块">${options(scopes,scope)}</select>${scope!=='overview'?'<button class="button subtle" id="framework-overview">返回总览</button>':''}`:'';

  const purpose=topicPurpose(topic);
  state.layout='clean';

  $('#main-content').innerHTML=`<div class="topic-workspace"><div class="topic-heading">
    <div class="topic-top"><div class="topic-title-block"><h1><span class="topic-dot" style="background:${/^#[0-9a-f]{6}$/i.test(topic.color)?topic.color:'#23766b'}"></span>${esc(topic.title)}</h1>
      ${purpose?`<p class="topic-purpose" title="${esc(topic.description||'')}">${esc(purpose)}</p>`:''}
      <p><span id="topic-counts">${topicCounts(topic.id)}</span></p></div>
      <div class="topic-top-actions"><button class="button subtle topic-rename-button" id="edit-topic">${icon('edit')}主题设置</button><button class="button primary" id="topic-new-note">${icon('plus')}添加笔记</button></div></div>
    <div class="topic-tools"><div class="view-tabs"><button data-mode="graph" class="${state.topicView==='graph'?'active':''}">${icon('graph')}关系图</button><button data-mode="list" class="${state.topicView==='list'?'active':''}">${icon('notes')}笔记列表</button></div>
      <div class="graph-tools">${scopeToolbar}<button class="button subtle" id="add-relation" style="padding:5px 9px;font-size:10px">${icon('link')}<span class="relation-button-label">添加关系</span></button><span class="toolbar-divider"></span>${graphOrganizeControls()}<button class="icon-button" id="graph-minus" aria-label="缩小关系图">−</button><button class="icon-button" id="graph-plus" aria-label="放大关系图">＋</button><button class="icon-button" id="graph-fit" title="显示全图" aria-label="显示全图">${icon('fit')}</button></div></div></div>
    <div id="topic-splitter" class="pane-splitter topic-splitter" role="separator" aria-orientation="horizontal" aria-label="调整关系图上方区域高度" aria-controls="topic-body" tabindex="0" title="上下拖动调整关系图可视范围；双击恢复默认"></div>
    <div class="topic-body" id="topic-body"><section class="graph-section" aria-label="二级知识关系图">${state.topicView==='graph'?`<div id="graph-canvas" class="graph-canvas"></div><div class="graph-legend"><span><i class="legend-line"></i>主干连接</span></div>`:`<div class="topic-note-list"><div class="note-list">${notes.map(noteCard).join('')||'<div class="empty-state"><strong>这个主题还没有笔记</strong><p>点击“添加笔记”开始记录。</p></div>'}</div></div>`}</section><aside id="detail-panel" class="detail-panel" aria-label="三级笔记详情"></aside></div></div>`;
  if($('#framework-scope')) $('#framework-scope').onchange=e=>showFrameworkScope(e.target.value);
  if($('#framework-overview')) $('#framework-overview').onclick=()=>showFrameworkScope('overview');
  $('#edit-topic').onclick=()=>{if(allowNotebookWrite())showTopicForm(topic);};$('#topic-new-note').onclick=()=>showCapture(topic.id);$('#add-relation').onclick=()=>{if(allowNotebookWrite())showRelation();};
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{state.topicView=b.dataset.mode;render();});
  if($('#graph-auxiliary')) $('#graph-auxiliary').onclick=()=>{state.graph?.setShowAuxiliary(!state.graph.showAuxiliary);$('.graph-organize-menu').open=false;syncGraphPresentationControls();};
  $('#graph-reset').onclick=()=>{if(state.graph){state.graph.autoLayout('clean');toast('已按保存的知识关系整理；可撤销');syncGraphPresentationControls();}};
  bindGraphOrganizeMenu();
  $('#graph-routes').onclick=()=>{state.graph?.organize('routes');$('.graph-organize-menu').open=false;toast('已重新整理连线；卡片位置和缩放保留');};
  $('#graph-membership').onclick=()=>{if(state.graph)state.graph.setShowMembership(state.graph.membershipGroups().length>0);$('.graph-organize-menu').open=false;syncGraphPresentationControls();};
  $('#graph-reflow').onclick=()=>{state.graph?.previewLayout(state.layout);$('.graph-organize-menu').open=false;};
  $('#graph-undo').onclick=()=>{if(state.graph?.undoLayout())toast('已恢复上一次布局');$('.graph-organize-menu').open=false;syncGraphPresentationControls();};
  $('#graph-fit').className='button subtle';$('#graph-fit').append('全图');
  $('#graph-minus').onclick=()=>state.graph?.zoomOut();$('#graph-plus').onclick=()=>state.graph?.zoomIn();$('#graph-fit').onclick=()=>state.graph?.fit();
  // Settle the detail pane and split widths before restoring the graph camera.
  // Otherwise hiding an empty detail pane looks like a major responsive resize
  // and replaces the saved viewport during back/forward navigation.
  renderDetail();
  paneLayout?.bindTopic(document.querySelector('.topic-workspace'));
  if(state.topicView==='graph'){
    state.graph=new KnowledgeGraph($('#graph-canvas'),{layout:state.layout,onViewChange:persistGraphView,onPresentationChange:syncGraphPresentationControls,onSelect:selectGraphNote,onConnect:data=>addLink(data),onConnectionChange:data=>{if(data)toast('点击另一个节点完成连接；按 Esc 取消');}});
    refreshGraph();
  } else $('#main-content').querySelectorAll('[data-note]').forEach(b=>b.onclick=()=>selectNote(b.dataset.note));
  syncGraphPresentationControls();
}
function refreshGraph() {
  const notes=topicNotes(state.route.topicId),links=topicLinks(state.route.topicId);
  const scope=state.frameworkScopes[state.route.topicId]||'overview';
  const viewKey=`${state.route.topicId}:${scope}`;
  const view=frameworkView(notes,links,scope,STATUSES);
  state.graphView=view;
  const saved=savedGraphView(state.route.topicId,scope);
  if(state.graph)state.graph.setData({...view,selectedId:state.route.noteId,query:'',viewKey,savedView:saved?{...saved,viewKey}:null});
  const counts=$('#topic-counts');if(counts)counts.textContent=topicCounts(state.route.topicId);
  syncGraphPresentationControls();
}
function syncGraphPresentationControls(){
  if(!state.graph)return;
  state.layout=state.graph.layout;
  if($('#graph-layout'))$('#graph-layout').value=state.layout;
  if($('#graph-undo'))$('#graph-undo').disabled=!state.graph.preview&&!state.graph.undoStack?.length;
  const view=state.graphView;
  const ordered=state.layout==='sequence'&&state.graph.links.some(link=>link.type==='sequence');
  const auxiliary=$('#graph-auxiliary');
  const visibleLinks=state.graph.displayLinks();
  const membershipCount=state.graph.membershipGroups().reduce((count,group)=>count+group.linkIds.length,0);
  const mergedCount=[...(state.graph.representedByLinkId?.values()||[])].reduce((count,edges)=>count+edges.length,0);
  const hiddenCount=state.graph.links.length-visibleLinks.length-membershipCount;
  const canGroup=state.graph.membershipGroups({force:true}).length>0;
  const membership=$('#graph-membership');if(membership){membership.textContent=membershipCount?'显示全部归属连线':'使用归属分组框';membership.setAttribute('aria-pressed',String(!membershipCount));membership.disabled=!['clean','columns'].includes(state.layout)||state.graph.showAuxiliary||!membershipCount&&!canGroup;membership.title=state.graph.showAuxiliary?'返回主要关系后可切换归属表示':!membershipCount&&!canGroup?'当前布局无法安全分组，归属仍由连线表示':'';}
  if(auxiliary){auxiliary.style.display=hiddenCount||membershipCount||state.graph.showAuxiliary?'':'none';auxiliary.textContent=state.graph.showAuxiliary?'返回主要关系':`查看全部关系 ${state.graph.links.length}`;auxiliary.setAttribute('aria-pressed',String(Boolean(state.graph.showAuxiliary)));}
  const legend=$('.graph-legend');
  if(legend){const types=new Set(visibleLinks.map(link=>link.type));legend.innerHTML=Object.entries(RELATIONS).filter(([key])=>types.has(key)).map(([key])=>`<span style="--kg-edge-color:${GRAPH_RELATIONS[key].color}"><i class="legend-line ${GRAPH_RELATIONS[key].dash?'is-dashed':''} ${GRAPH_RELATIONS[key].arrow?'has-arrow':''}"></i>${GRAPH_RELATIONS[key].label}</span>`).join('')+`<span class="graph-visibility">${state.graph.notes.length} 张卡片 · ${visibleLinks.length} 条${state.graph.showAuxiliary?'':'主要'}连线${membershipCount?` · ${membershipCount} 条归属由分组表示`:''}${mergedCount?` · ${mergedCount} 条顺序合并显示`:''}${hiddenCount>mergedCount?` · ${hiddenCount-mergedCount} 条补充联系`:''}${view?.hiddenDescendantCount?` · ${view.hiddenDescendantCount} 张在下级模块`:''}</span>`;}
  state.graph.setHint(state.graph.preview?'排版预览：按保存的知识关系重排，应用后才保存':ordered?'学习顺序只表示先后':state.graph.showAuxiliary?'全部关系 · 悬停连线查看完整联系':membershipCount?'主要关系 · 分组表示归属 · 悬停连线查看完整联系':'主要关系 · 悬停连线查看完整联系');
}
function selectNote(id){const note=noteById(id);if(note)navigate('topic',note.topicId,id,note.topicId===state.route.topicId?state.route.scope:null);}
function renderDetail(){
  const panel=$('#detail-panel');if(!panel)return;const note=currentNote();
  if(state.readOnly)state.editing=false;
  panel.classList.toggle('has-no-note',!note);
  $('.topic-workspace')?.classList.toggle('is-focused',Boolean(note)&&state.focusReading);
  if(!note){panel.innerHTML=`<div class="detail-empty"><div class="level-label">LEVEL 03 · 笔记内容</div>${icon('notes')}<h3>沿着一个节点，走进理解。</h3><p>点击图中的笔记，查看正文、来源和它与其他笔记的连接。</p></div>`;return;}
  panel.innerHTML=`<div class="detail-top"><div class="detail-level"><span>${state.editing?'编辑笔记':'笔记详情'}</span></div><div class="detail-actions"><button class="button subtle focus-toggle" id="toggle-focus" aria-label="${state.focusReading?'显示关系图':'专注阅读'}">${icon(state.focusReading?'graph':'notes')}${state.focusReading?'关系图':'专注阅读'}</button><button class="icon-button" id="copy-note" aria-label="复制笔记内容" title="复制为 Markdown">${icon('copy')}</button><button class="icon-button" id="export-note" aria-label="导出这条笔记" title="导出 Markdown">${icon('download')}</button><button class="icon-button" id="toggle-edit" aria-label="${state.editing?'预览笔记':'编辑笔记'}" title="${state.editing?'预览':'编辑'}">${icon(state.editing?'check':'edit')}</button><button class="icon-button" id="close-detail" aria-label="关闭笔记详情">${icon('close')}</button></div></div>${state.editing?`<input class="note-title-input" id="edit-title" aria-label="笔记标题" value="${esc(note.title)}" maxlength="300"><div class="note-edit-fields"><select class="select" id="edit-type" aria-label="笔记类型">${options(TYPES,note.type)}</select><select class="select" id="edit-status" aria-label="掌握状态">${options(statusOptions(note),note.status)}</select></div>`:`<h2 class="note-title">${esc(note.title)}</h2><div class="note-meta-row"><span class="tag">${TYPES[note.type]}</span><select class="select ${note.status}" id="edit-status" aria-label="掌握状态">${options(statusOptions(note),note.status)}</select>${note.tags.slice(0,5).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>`}<div class="meta-time">更新于 ${dateTime(note.updatedAt)}</div>${state.editing?`<div class="editor-toolbar"><button data-wrap="bold" title="加粗">B</button><button data-wrap="heading" title="标题">H</button><button data-wrap="list" title="列表">≡</button><button data-wrap="quote" title="引用">❝</button><button data-wrap="code" title="代码">&lt;/&gt;</button><button data-wrap="math" title="公式">ƒ</button><button data-wrap="check" title="待办">☑</button><button data-wrap="link" title="链接">↗</button></div><textarea class="note-content-editor" id="edit-content" aria-label="笔记正文" maxlength="120000" placeholder="写下自己的理解，或粘贴对话、文献内容。支持 Markdown。">${esc(note.content)}</textarea><div class="editor-hint">支持 Markdown 和常用 LaTeX 公式 · 编辑后自动保存</div><label class="form-label" for="edit-tags">标签，用逗号分隔</label><input class="input" id="edit-tags" value="${esc(note.tags.join('，'))}" placeholder="例如：分子束，平动温度" maxlength="5000"><div style="margin-top:12px"><button class="button primary" id="finish-edit">完成并预览</button></div>`:`<article class="markdown-body">${noteBodyHTML(note)}</article>`}${noteSupportHTML(note)}`;
  if(!state.editing)installNoteOutline(panel.querySelector('article'));
  $('#toggle-focus').onclick=()=>{state.focusReading=!state.focusReading;renderDetail();};
  $('#copy-note').onclick=()=>copyText(markdownExport(note));$('#export-note').onclick=async()=>{try{const result=await saveExport(`${cleanFilename(note.title)}.md`,markdownExport(note),'markdown');toast(`Markdown 已保存至：${result.path}`);}catch(error){toast(`导出失败：${error.message}`,true);}};
  $('#toggle-edit').onclick=()=>{if(!allowNotebookWrite())return;state.editing=!state.editing;renderDetail();};$('#close-detail').onclick=()=>navigate('topic',state.route.topicId,null,state.route.scope);
  $('#edit-status').onchange=e=>updateNote(note.id,{status:e.target.value});
  if(state.editing&&!state.readOnly){$('#edit-title').oninput=e=>updateNote(note.id,{title:e.target.value.trim()||'未命名笔记'});$('#edit-content').oninput=e=>updateNote(note.id,{content:e.target.value});$('#edit-type').onchange=e=>updateNote(note.id,{type:e.target.value});$('#edit-tags').onchange=e=>updateNote(note.id,{tags:parseTags(e.target.value)});$('#finish-edit').onclick=()=>{state.editing=false;renderDetail();};document.querySelectorAll('[data-wrap]').forEach(b=>b.onclick=()=>insertMarkdown(b.dataset.wrap));bindImageEditor($('#edit-content'),{toolbar:$('.editor-toolbar'),isCurrent:()=>!state.readOnly&&state.editing&&state.route.noteId===note.id,onError:toast,onBusy:busy=>{['finish-edit','toggle-edit','close-detail'].forEach(id=>{const button=document.getElementById(id);if(button)button.disabled=busy;});}});}
  $('#add-source').onclick=()=>{if(allowNotebookWrite())showSourceForm(note.id);};$('#detail-add-link').onclick=()=>{if(allowNotebookWrite())showRelation(note.id);};$('#connect-on-map').onclick=()=>{if(allowNotebookWrite())showGraphConnect(note.id);};$('#delete-note').onclick=()=>{if(allowNotebookWrite())showDelete(note.id);};
  panel.querySelectorAll('[data-related]').forEach(b=>b.onclick=()=>selectNote(b.dataset.related));
  panel.querySelectorAll('[data-remove-link]').forEach(b=>b.onclick=()=>{if(!allowNotebookWrite())return;mutate(()=>{state.db.links=state.db.links.filter(l=>l.id!==b.dataset.removeLink);});refreshGraph();renderDetail();toast('已移除这条连接，笔记内容保留');});
  panel.querySelectorAll('[data-remove-source]').forEach(b=>b.onclick=()=>{if(!allowNotebookWrite())return;const s=note.sources.find(v=>v.id===b.dataset.removeSource);showConfirm('移除这个来源？',`将从这条笔记中移除“${s.title}”。正文和原始文件不会改变。`,()=>{mutate(()=>{note.sources=note.sources.filter(v=>v.id!==s.id);note.updatedAt=now();});renderDetail();});});
  panel.querySelectorAll('[data-copy-path]').forEach(b=>b.onclick=()=>copyText(note.sources.find(s=>s.id===b.dataset.copyPath)?.url||''));
  applyReadOnlyUI();
}
function noteSupportHTML(note){
  return `<section class="note-support"><section class="detail-section"><div class="detail-section-heading"><span>知识连接</span><button class="text-button" id="detail-add-link">＋ 连接</button></div>${relationsHTML(note)}<button class="button subtle" id="connect-on-map" style="margin-top:11px;font-size:11px">${icon('graph')}在图上连接</button></section><details class="note-sources" ${state.editing?'open':''}><summary>来源记录 · ${note.sources.length}</summary><section class="detail-section"><div class="detail-section-heading"><span>可追溯材料</span><button class="text-button" id="add-source">＋ 添加来源</button></div>${note.sources.map(s=>sourceCard(s)).join('')||'<p class="muted">尚未记录来源。</p>'}</section></details><div class="danger-zone" ${state.editing?'':'hidden'}><button id="delete-note">删除这条笔记</button></div></section>`;
}
function updateNote(id,values){if(!allowNotebookWrite())return;mutate(()=>Object.assign(noteById(id),values,{updatedAt:now()}));if(values.title||values.type||values.status)refreshGraph();}
function sourceCard(s){const url=safeURL(s.url);return `<div class="source-card"><div class="source-top">${icon(s.type==='conversation'?'idea':'source')}<span>${SOURCES[s.type]}</span><button class="source-remove" data-remove-source="${esc(s.id)}" aria-label="移除来源 ${esc(s.title)}">×</button></div><strong>${esc(s.title)}</strong>${s.excerpt?`<p>${esc(s.excerpt)}</p>`:''}${s.url?url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(s.url)}</a>`:`<span class="source-path">${esc(s.url)}</span><button class="text-button" data-copy-path="${esc(s.id)}" style="font-size:9px;margin-top:5px">复制文件路径</button>`:''}</div>`;}
function relationsHTML(note){const links=state.db.links.filter(l=>l.from===note.id||l.to===note.id);return links.map(l=>{const outgoing=l.from===note.id;const related=noteById(outgoing?l.to:l.from);return `<div class="relation-row"><button class="relation-item" data-related="${esc(related.id)}"><span class="relation-label">${outgoing?'→':'←'} ${RELATIONS[l.type]}</span><strong>${esc(related.title)}</strong>${l.label?`<span class="relation-context">${esc(l.label)}</span>`:''}</button><button class="relation-delete" data-remove-link="${esc(l.id)}" title="移除连接" aria-label="移除与 ${esc(related.title)} 的连接">×</button></div>`}).join('')||'<p class="muted" style="font-size:10px">为这条笔记找一个相关概念，建立第一条连接。</p>';}
function parseTags(text){return [...new Set(text.split(/[,，;；\n]/).map(t=>t.trim().slice(0,100)).filter(Boolean))].slice(0,50);}
function insertMarkdown(kind){const input=$('#edit-content');const start=input.selectionStart,end=input.selectionEnd;const selected=input.value.slice(start,end);const wrappers={bold:[`**${selected||'重点内容'}**`,2],heading:[`\n## ${selected||'小标题'}\n`,4],list:[`\n- ${selected||'第一点'}\n`,3],quote:[`\n> ${selected||'摘录或引用'}\n`,3],code:[`\n\`\`\`\n${selected||'代码'}\n\`\`\`\n`,5],math:[`\n$$\n${selected||'E = h\\nu'}\n$$\n`,4],check:[`\n- [ ] ${selected||'待完成的事情'}\n`,7],link:[`[${selected||'链接文字'}](https://)`,1]};const [text,offset]=wrappers[kind];input.setRangeText(text,start,end,'end');input.focus();if(!selected)input.setSelectionRange(start+offset,start+text.length-(kind==='bold'?2:kind==='math'?4:1));input.dispatchEvent(new Event('input',{bubbles:true}));}
function modal(title,body,{wide=false,search=false}={}){closeModal();$('#modal-root').innerHTML=`<div class="modal-overlay"><section class="modal ${wide?'wide':''} ${search?'search-modal':''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">${search?'':`<div class="modal-header"><h2>${esc(title)}</h2><button class="icon-button modal-close" aria-label="关闭弹窗">${icon('close')}</button></div>`}<div class="${search?'':'modal-body'}">${body}</div></section></div>`;state.modal=title;$('.modal-close')?.addEventListener('click',closeModal);$('.modal-overlay').onclick=e=>{if(e.target===e.currentTarget)closeModal();};setTimeout(()=>($('.modal input:not([type=radio])')||$('.modal textarea')||$('.modal-body button')||$('.modal button'))?.focus(),30);}
function closeModal(){if(imagesUploading()){toast('图片正在保存，请稍候完成后再关闭。');return;}if(state.modal){$('#modal-root').innerHTML='';state.modal=null;}}
function showCapture(topicId=state.route.topicId){
  if(!allowNotebookWrite())return;
  if(!state.db.topics.length){showTopicForm();toast('先新建一个主题，再记录笔记');return;}
  topicId=topicId||state.db.topics[0].id;
  modal('新建笔记',`<p class="modal-intro">可以粘贴对话、摘录文献，或写下刚刚产生的想法。</p><form id="capture-form"><input class="input capture-title" id="capture-title" placeholder="给这条笔记一个清晰的标题" aria-label="新笔记标题" maxlength="300" required><div class="capture-content-label"><label class="form-label" for="capture-content">笔记内容</label><button class="text-button" type="button" id="capture-review-template">复习模板</button></div><textarea class="form-textarea capture-note-content" id="capture-content" aria-label="新笔记内容" placeholder="写下内容。也可以先留一个问题，稍后慢慢补充。" maxlength="120000"></textarea><div class="form-row"><div><label class="form-label" for="capture-topic">放入主题</label><select class="select" id="capture-topic">${topicOptions(topicId)}</select></div><div><label class="form-label" for="capture-type">笔记类型</label><select class="select" id="capture-type">${options(TYPES,'concept')}</select></div></div><div class="form-row"><div><label class="form-label" for="capture-source">这条思路来自</label><select class="select" id="capture-source">${options(SOURCES,'thought')}</select></div><div><label class="form-label" for="capture-status">当前状态</label><select class="select" id="capture-status">${options(STATUSES,'inbox')}</select></div></div><details class="optional-details"><summary>补充来源和标签（可选）</summary><label class="form-label" for="capture-source-title">来源名称</label><input class="input" id="capture-source-title" placeholder="例如：与助手的对话 / 某篇论文 / 自己的观察" maxlength="500"><label class="form-label" for="capture-source-url">网址、DOI链接或本地文件路径</label><input class="input" id="capture-source-url" placeholder="https://doi.org/… 或 D:\\…" maxlength="4000"><label class="form-label" for="capture-tags">标签，用逗号分隔</label><input class="input" id="capture-tags" placeholder="例如：分子束，待确认" maxlength="5000"></details><div class="form-error" id="capture-error"></div><div class="modal-footer"><button class="button" type="button" id="capture-cancel">取消</button><button class="button primary" type="submit">保存笔记</button></div></form>`);
  const captureInput=$('#capture-content'),captureTools=document.createElement('div');captureTools.className='editor-toolbar capture-image-toolbar';captureInput.before(captureTools);
  bindImageEditor(captureInput,{toolbar:captureTools,isCurrent:()=>!state.readOnly&&$('#capture-content')===captureInput,onError:toast,onBusy:busy=>{const submit=$('#capture-form button[type=submit]');if(submit)submit.disabled=busy;}});
  $('#capture-review-template').onclick=()=>{if(captureInput.value.trim()){toast('复习模板用于空白正文。已有内容已保留。');return;}captureInput.value=REVIEW_TEMPLATE;captureInput.focus();const cursor=REVIEW_TEMPLATE.indexOf('\n\n')+2;captureInput.setSelectionRange(cursor,cursor);};
  $('#capture-cancel').onclick=closeModal;$('#capture-form').onsubmit=e=>{e.preventDefault();if(imagesUploading()){$('#capture-error').textContent='请等图片保存完成后再提交笔记。';return;}const title=$('#capture-title').value.trim();if(!title){$('#capture-error').textContent='请先填写标题。';return;}const stamp=now();const type=$('#capture-source').value;const sourceTitle=$('#capture-source-title').value.trim()||({thought:'自己的学习记录',conversation:'对话摘录',paper:'文献阅读记录',web:'网页阅读记录',other:'其他学习记录'})[type];const note={id:uid('note'),topicId:$('#capture-topic').value,title,content:$('#capture-content').value,type:$('#capture-type').value,status:$('#capture-status').value,tags:parseTags($('#capture-tags').value),sources:[{id:uid('source'),type,title:sourceTitle,url:$('#capture-source-url').value.trim(),excerpt:''}],createdAt:stamp,updatedAt:stamp};mutate(()=>state.db.notes.push(note));navigate('topic',note.topicId,note.id);toast('笔记已加入主题，正在保存到本地');};
}
function showTopicForm(topic=null){const colors=['#23766b','#c87848','#7288a6','#998254','#957994','#67918c'];let color=topic?.color||colors[0];modal(topic?'主题设置':'新建学习主题',`<p class="modal-intro">主题是一级入口。可以按学习方向、文献或一个长期问题来组织。</p><form id="topic-form"><label class="form-label" for="topic-title">主题名称</label><input class="input" id="topic-title" value="${esc(topic?.title||'')}" placeholder="例如：分子束与碰撞动力学" maxlength="300" required><label class="form-label" for="topic-description">简短说明</label><textarea class="form-textarea" id="topic-description" style="min-height:85px" placeholder="这个主题想解决什么问题？" maxlength="4000">${esc(topic?.description||'')}</textarea><label class="form-label">主题颜色</label><div class="color-options">${colors.map(c=>`<button type="button" class="color-choice ${c===color?'selected':''}" data-color="${c}" style="background:${c}" aria-label="主题颜色 ${c}"></button>`).join('')}</div><div class="modal-footer"><button type="button" class="button" id="topic-cancel">取消</button><button class="button primary" type="submit">${topic?'保存设置':'创建主题'}</button></div></form>`);$('#topic-cancel').onclick=closeModal;document.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{color=b.dataset.color;document.querySelectorAll('[data-color]').forEach(c=>c.classList.toggle('selected',c.dataset.color===color));});$('#topic-form').onsubmit=e=>{e.preventDefault();const title=$('#topic-title').value.trim();if(!title)return;const description=$('#topic-description').value.trim();if(topic){mutate(()=>Object.assign(topic,{title,description,color}));closeModal();render();}else{const t={id:uid('topic'),title,description,color,createdAt:now()};mutate(()=>state.db.topics.push(t));navigate('topic',t.id);toast('主题已创建，可以开始记录和连接');}};}
function showSourceForm(noteId){modal('给笔记补充一个来源',`<form id="source-form"><label class="form-label" for="source-type">来源类型</label><select class="select source-form-type" id="source-type">${options(SOURCES,'paper')}</select><label class="form-label" for="source-title">来源名称</label><input class="input" id="source-title" placeholder="例如：论文标题 / 对话主题 / 思考时间" maxlength="500" required><label class="form-label" for="source-url">网址、DOI链接或本地文件路径</label><input class="input" id="source-url" placeholder="可选。记录原始材料的位置。" maxlength="4000"><label class="form-label" for="source-excerpt">摘录或说明</label><textarea class="form-textarea" id="source-excerpt" placeholder="记录相关页码、原句或这条来源为何有用。" maxlength="60000"></textarea><div class="modal-footer"><button type="button" class="button" id="source-cancel">取消</button><button class="button primary" type="submit">添加来源</button></div></form>`);$('#source-cancel').onclick=closeModal;$('#source-form').onsubmit=e=>{e.preventDefault();const title=$('#source-title').value.trim();if(!title)return;const source={id:uid('source'),type:$('#source-type').value,title,url:$('#source-url').value.trim(),excerpt:$('#source-excerpt').value};mutate(()=>{const n=noteById(noteId);n.sources.push(source);n.updatedAt=now();});closeModal();renderDetail();toast('来源已添加');};}
function showRelation(fromId=state.route.noteId){const notes=topicNotes(state.route.topicId);if(notes.length<2){toast('这个主题至少需要两条笔记才能建立连接');return;}fromId=fromId||notes[0].id;const selectNotes=(selected)=>notes.map(n=>`<option value="${esc(n.id)}" ${n.id===selected?'selected':''}>${esc(n.title)}</option>`).join('');modal('连接两条笔记',`<p class="modal-intro">关系是二级图的骨架。选择连接的方向，再说明它们之间的逻辑。</p><form id="relation-form"><label class="form-label" for="relation-from">从这条笔记</label><select class="select" style="width:100%" id="relation-from">${selectNotes(fromId)}</select><label class="form-label" for="relation-to">连接到</label><select class="select" style="width:100%" id="relation-to">${selectNotes(notes.find(n=>n.id!==fromId)?.id)}</select><label class="form-label" for="relation-type">它们是什么关系？</label><select class="select" style="width:100%" id="relation-type">${options(RELATIONS,'extends')}</select><div class="connect-type-description" id="relation-help">${RELATION_HELP.extends}</div><label class="form-label" for="relation-label">连接说明（可选）</label><input class="input" id="relation-label" maxlength="500" placeholder="例如：由能量随场变化，进一步推到力的方向"><div class="form-error" id="relation-error"></div><div class="modal-footer"><button type="button" class="button" id="relation-cancel">取消</button><button class="button primary" type="submit">建立连接</button></div></form>`);$('#relation-cancel').onclick=closeModal;$('#relation-type').onchange=e=>$('#relation-help').textContent=RELATION_HELP[e.target.value];$('#relation-form').onsubmit=e=>{e.preventDefault();if(addLink({from:$('#relation-from').value,to:$('#relation-to').value,type:$('#relation-type').value,label:$('#relation-label').value.trim()}))closeModal();};}
function addLink({from,to,type,label=''}){if(from===to){const error=$('#relation-error');if(error)error.textContent='请连接两条不同的笔记。';else toast('不能把笔记连接到自身');return false;}const a=noteById(from),b=noteById(to);if(!a||!b||a.topicId!==b.topicId){toast('请连接同一主题中的笔记',true);return false;}if(state.db.links.some(l=>l.type===type&&((l.from===from&&l.to===to)||(type==='parallel'&&l.from===to&&l.to===from)))){const error=$('#relation-error');if(error)error.textContent='这两条笔记之间已经有相同的关系。';else toast('这条关系已经存在');return false;}mutate(()=>state.db.links.push({id:uid('link'),topicId:a.topicId,from,to,type,label}));refreshGraph();renderDetail();toast(`已建立“${RELATIONS[type]}”关系`);return true;}
function showGraphConnect(fromId){if(state.topicView!=='graph'){state.topicView='graph';render();}modal('在图上连接笔记',`<p class="modal-intro">起点是“${esc(noteById(fromId).title)}”。选择关系后，点击图中的另一个节点。</p><label class="form-label" for="map-connect-type">连接关系</label><select class="select" style="width:100%" id="map-connect-type">${options(RELATIONS,'extends')}</select><p class="connect-type-description" id="map-connect-help">${RELATION_HELP.extends}</p><div class="modal-footer"><button class="button primary" id="map-connect-start">开始选择终点</button></div>`);$('#map-connect-type').onchange=e=>$('#map-connect-help').textContent=RELATION_HELP[e.target.value];$('#map-connect-start').onclick=()=>{const type=$('#map-connect-type').value;closeModal();state.graph.startConnect(fromId,type);};}
function showConfirm(title,description,action){modal(title,`<p class="modal-intro">${esc(description)}</p><div class="modal-footer"><button class="button" id="confirm-cancel">取消</button><button class="button danger" id="confirm-action">确认</button></div>`);$('#confirm-cancel').onclick=closeModal;$('#confirm-action').onclick=()=>{closeModal();action();};}
function showDelete(id){const note=noteById(id);showConfirm('删除这条笔记？',`“${note.title}”及它的连接会从笔记库移除。可以通过之前导出的备份或本地近期备份恢复。`,()=>{mutate(()=>{state.db.notes=state.db.notes.filter(n=>n.id!==id);state.db.links=state.db.links.filter(l=>l.from!==id&&l.to!==id);});navigation.restore({force:true});toast('已删除这一条笔记');});}
function highlighted(text,query){const terms=normalized(query).split(/\s+/).filter(Boolean);if(!terms.length)return esc(text);const escaped=esc(text);const pattern=terms.map(t=>esc(t).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');return escaped.replace(new RegExp(`(${pattern})`,'gi'),'<mark>$1</mark>');}
function showSearch(){modal('搜索笔记',`<div class="search-input-wrap">${icon('search')}<input id="global-search" aria-label="全局搜索" placeholder="搜索标题、正文、标签和来源…" autocomplete="off"><button class="icon-button" id="search-close" aria-label="关闭搜索">${icon('close')}</button></div><div class="search-results" id="search-results"></div><div class="search-footer">多个关键词用空格分隔 · Enter 打开第一条 · Esc 关闭</div>`,{search:true});$('#search-close').onclick=closeModal;$('#global-search').oninput=renderSearchResults;$('#global-search').onkeydown=e=>{if(e.key==='Enter')$('#search-results [data-result]')?.click();};renderSearchResults();}
function renderSearchResults(){const query=$('#global-search').value;const results=state.db.notes.filter(n=>matches(n,query)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,35);$('#search-results').innerHTML=results.map(n=>{const sourceMatch=n.sources.find(s=>normalized([s.title,s.url,s.excerpt].join(' ')).includes(normalized(query).trim())&&query.trim());const summary=sourceMatch?`来源：${sourceMatch.title} · ${sourceMatch.excerpt||sourceMatch.url||''}`:plainText(n.content);return `<button class="search-result" data-result="${esc(n.id)}"><span class="note-mini-icon">${icon(typeIcon(n.type))}</span><div style="min-width:0"><h3>${highlighted(n.title,query)}</h3><p>${highlighted(summary.slice(0,170),query)}</p><small>${esc(topicById(n.topicId)?.title||'')} · ${TYPES[n.type]} · ${n.tags.map(t=>`# ${esc(t)}`).join(' ')}</small></div></button>`}).join('')||'<div class="empty-state"><strong>暂时没有匹配的笔记</strong><p>试试更短的关键词，或搜索来源名称。</p></div>';$('#search-results').querySelectorAll('[data-result]').forEach(b=>b.onclick=()=>{const n=noteById(b.dataset.result);navigate('topic',n.topicId,n.id);});}
function cleanFilename(text){return cleanExportLabel(text);}
async function saveExport(filename,content,format){if(state.readOnly)throw new Error('原笔记只读预览不写入导出文件。需要文字时可使用“复制笔记内容”。');return localState.exportFile(filename,content,format);}
async function copyText(text){try{await navigator.clipboard.writeText(text);toast('已复制，可以粘贴到其他地方');}catch{modal('复制笔记内容',`<p class="modal-intro">浏览器未允许直接复制，请选中以下内容手动复制。</p><textarea class="form-textarea" id="manual-copy" style="min-height:260px">${esc(text)}</textarea>`);$('#manual-copy').select();}}
function markdownExport(note){return `# ${note.title}\n\n主题：${topicById(note.topicId)?.title||''}\n类型：${TYPES[note.type]} · 状态：${noteStatusLabel(note,STATUSES)}\n标签：${note.tags.join('、')}\n更新：${dateTime(note.updatedAt)}\n\n${note.content}\n\n---\n\n## 来源\n\n${note.sources.map(s=>`- ${SOURCES[s.type]}：${s.title}${s.url?`\n  ${s.url}`:''}${s.excerpt?`\n\n  > ${s.excerpt.replaceAll('\n','\n  > ')}`:''}`).join('\n\n')||'暂无'}\n\n## 知识连接\n\n${state.db.links.filter(l=>l.from===note.id||l.to===note.id).map(l=>`- ${l.from===note.id?'→':'←'} ${RELATIONS[l.type]}：${noteById(l.from===note.id?l.to:l.from)?.title||''}${l.label?`（${l.label}）`:''}`).join('\n')||'暂无'}\n`;}
async function exportJSON(data=state.db,label='笔记备份'){
  if(!allowNotebookWrite())return null;
  if(state.exporting){toast('正在准备完整备份，请稍候。');return;}
  state.exporting=true;toast('正在准备完整备份，并读取笔记中的图片…');
  try{const backup=await createBackup(data);const result=await saveExport(`${cleanFilename(label)}_${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(backup),'json');toast(`备份已保存至：${result.path}（${backup.images.length} 张图片）`);return result;}
  catch(error){toast(`备份失败：${error.message}`,true);return null;}finally{state.exporting=false;}
}
function showBackup(){
  if(!allowNotebookWrite())return;
  modal('导入与备份',`<p class="modal-intro">给自己的学习留一份完整副本。导出文件统一保存在本应用的 data/exports 文件夹。</p><div class="backup-grid"><div class="backup-card">${icon('download')}<h3>导出笔记备份</h3><p>保存主题、正文、来源、关系、节点位置，以及正文引用的全部图片。个人规则和历史归档需随 data 文件夹另行备份。</p><button class="button" id="backup-export">保存 JSON 备份</button></div><div class="backup-card">${icon('upload')}<h3>导入已有笔记</h3><p>先查看主题、笔记、连接和图片数量，再选择合并或替换。仍可导入旧版文字备份。</p><button class="button" id="backup-import">选择 JSON 文件</button></div></div><div class="info-box">${state.db.topics.length} 个主题 · ${state.db.notes.length} 条笔记 · ${state.db.links.length} 条连接<br>正文保存于 data/notebook.json，图片文件保存于 data/images。每次保存会保留近期正文版本到 data/backups，最多 10 个版本；这些历史版本引用原有图片。JSON 备份会另外包含正文引用的图片。</div><div class="info-box warning">导出文件可能包含私人笔记、对话和图片，与其他个人数据一样留在本机，不要随源码发布。</div>`,{wide:true});
  $('#backup-export').onclick=()=>exportJSON();$('#backup-import').onclick=()=>$('#import-file').click();
  if([...localState.drafts.keys()].some(id=>id!==localState.draftId)){
    const draftsButton=document.createElement('button');draftsButton.className='button';draftsButton.textContent='查看已保留草稿';draftsButton.onclick=showDraftRecovery;$('.modal-body').append(draftsButton);
  }
}
function mergeImport(imported){return mergeNotebooks(state.db,imported,uid);}
function showImport(data,filename,backup={notebook:data,images:[],legacy:true}){
  if(!allowNotebookWrite())return;
  modal('预览即将导入的笔记',`<p class="modal-intro">文件：${esc(filename)}。确认以下内容与导入方式。</p><div class="import-counts"><span><strong>${data.topics.length}</strong>主题</span><span><strong>${data.notes.length}</strong>笔记</span><span><strong>${data.links.length}</strong>连接</span><span><strong>${backup.images.length}</strong>图片文件</span></div><p class="modal-intro">${backup.legacy?'这是一份旧版文字备份。若正文含本地图片链接，将先检查原图是否已在当前应用中。':'确认后先恢复图片，再载入笔记。图片与正文都保存在本机。'}</p><label class="import-mode"><input type="radio" name="import-mode" value="merge" checked><span>合并到现有笔记<small>已有内容保留。相同编号且内容、来源、标签等完全相同的笔记会跳过；有变动的内容作为新笔记保留。</small></span></label><label class="import-mode"><input type="radio" name="import-mode" value="replace"><span>替换当前笔记库<small>用这个文件的完整内容替换当前库。确认前可先导出当前内容。</small></span></label><div class="info-box warning" id="import-warning" hidden>替换会移除当前库中不在这个备份里的内容。请先导出当前库，或确认已有可恢复备份。</div><div class="form-error" id="import-error"></div><div class="modal-footer"><button class="button" id="import-current-backup">先备份当前内容</button><button class="button primary" id="import-confirm">确认导入</button></div>`);
  document.querySelectorAll('[name="import-mode"]').forEach(r=>r.onchange=()=>$('#import-warning').hidden=$('[name="import-mode"]:checked').value!=='replace');
  const dialog=$('.modal'),button=$('#import-confirm'),errorBox=$('#import-error');
  $('#import-current-backup').onclick=async()=>{
    button.disabled=true;
    try{await exportJSON();}finally{if(dialog.isConnected&&!state.importing)button.disabled=false;}
  };
  button.onclick=async()=>{
    if(!allowNotebookWrite())return;
    if(state.importing){toast('正在恢复另一份备份，请稍候。');return;}
    if(state.exporting){toast('正在保存当前备份，请完成后再导入。');return;}
    const mode=$('[name="import-mode"]:checked').value;
    const candidate=()=>{const result=mode==='merge'?mergeImport(data):{...structuredClone(data),revision:state.db.revision};validateImport(result);result.revision=state.db.revision;return result;};
    state.importing=true;button.disabled=true;errorBox.textContent='';dialog.querySelectorAll('[name="import-mode"]').forEach(r=>r.disabled=true);
    try{
      candidate();
      await restoreBackupImages(backup,fetch,(done,total)=>{if(!dialog.isConnected)throw new Error('导入已取消；当前笔记没有改动。');button.textContent=total?`恢复图片 ${done}/${total}…`:'正在检查备份…';});
      if(!dialog.isConnected)throw new Error('导入已取消；当前笔记没有改动。');
      const next=candidate();mutate(()=>{state.db=next;});navigate('home');await save();if(!state.conflict)toast('笔记及图片已载入，保存状态见右上角');
    }catch(error){if(dialog.isConnected)errorBox.textContent=error.message;else toast(error.message,true);}
    finally{state.importing=false;if(dialog.isConnected){button.disabled=false;button.textContent='确认导入';dialog.querySelectorAll('[name="import-mode"]').forEach(r=>r.disabled=false);}}
  };
}
function showConflict(latest){
  if(state.readOnly)return;
  state.conflictLatest=latest;
  if(imagesUploading()){toast('另一窗口更新了笔记。请等图片完成，再点击保存状态处理版本冲突。',true);return;}
  modal('另一个窗口更新了笔记',`<p class="modal-intro">为了避免覆盖另一窗口的内容，这次保存已暂停。${localState.draftDurable?'当前修改已保留在本应用的草稿文件中。':'草稿尚未确认落盘，请保持窗口打开。'}</p><div class="info-box">建议先导出当前草稿，再读取最新笔记。之后可以用“导入与备份”合并需要保留的内容。</div><div class="modal-footer"><button class="button" id="conflict-export">导出当前草稿</button><button class="button primary" id="conflict-reload">读取最新笔记</button></div>`);
  $('#conflict-export').onclick=()=>exportJSON(state.db,'笔记冲突草稿');
  $('#conflict-reload').onclick=()=>showConfirm('读取最新笔记？','这会用另一窗口的最新版本替换本窗口未保存的修改。请确认已经导出需要保留的草稿。',async()=>{
    const version=localState.draftVersion;
    state.db=structuredClone(latest);state.dirty=false;state.conflict=false;state.change++;
    updateSaveStatus('已保存在本地');navigate('home');
    try{await localState.clearDraft(version);}catch(error){toast(`已读取笔记，旧草稿仍保留：${error.message}`,true);}
  });
}

function showDraftRecovery(){
  if(state.readOnly)return;
  const entries=[...localState.drafts.values()].filter(entry=>entry.id!==localState.draftId&&entry.draft?.data).sort((a,b)=>b.draft.changedAt.localeCompare(a.draft.changedAt));
  if(!entries.length)return;
  modal(`发现 ${entries.length} 份未保存草稿`,`<p class="modal-intro">这些草稿保存在本应用的 data 中。每个窗口分别保留，较早版本可先导出，再通过“导入与备份”合并。</p><label class="form-label" for="draft-select">选择草稿</label><select class="select" id="draft-select">${entries.map(entry=>`<option value="${esc(entry.id)}">${dateTime(entry.draft.changedAt)} · 版本 ${entry.draft.data.revision}</option>`).join('')}</select><div class="info-box" id="draft-description"></div><div class="modal-footer"><button class="button" id="draft-export">导出此草稿</button><button class="button" id="draft-discard">丢弃此草稿</button><button class="button" id="draft-later">稍后处理</button><button class="button primary" id="draft-restore">恢复草稿</button></div>`);
  const selected=()=>entries.find(entry=>entry.id===$('#draft-select').value);
  const describe=()=>{
    const {draft}=selected();const stale=draft.data.revision!==state.db.revision;
    const same=JSON.stringify(draft.data)===JSON.stringify(state.db);
    $('#draft-description').textContent=stale?'笔记库版本已更新。这份草稿不能直接覆盖当前库，请先导出再合并。':same?'这份草稿与当前笔记一致，可以保留或丢弃。':'这份草稿基于当前笔记版本，可以恢复后继续保存。';
    $('#draft-restore').disabled=stale||same||state.dirty;
  };
  $('#draft-select').onchange=describe;describe();
  $('#draft-later').onclick=closeModal;
  $('#draft-export').onclick=()=>exportJSON(selected().draft.data,'笔记恢复草稿');
  $('#draft-discard').onclick=()=>{
    const entry=selected();
    showConfirm('丢弃这份草稿？','只移除所选草稿文件，已保存的笔记不会改变。需要保留时请先导出。',async()=>{
      try{await localState.removeRecoveredDraft(entry.id);showDraftRecovery();}catch(error){toast(`草稿未移除：${error.message}`,true);}
    });
  };
  $('#draft-restore').onclick=async()=>{
    const entry=selected();
    if(state.dirty||entry.draft.data.revision!==state.db.revision){toast('当前笔记已变化，请导出草稿后合并。',true);return;}
    const persisted=mutate(()=>state.db=structuredClone(entry.draft.data));closeModal();render();
    if(await persisted){try{await localState.removeRecoveredDraft(entry.id);}catch(error){toast(`已恢复，原草稿仍保留：${error.message}`,true);}}
  };
}
function showHelp(){modal('笔记使用指南',`<p class="modal-intro">记录笔记，按主题整理，再用搜索和关系图回顾。</p><div class="help-steps"><div class="help-step"><span>01</span><div><strong>主题：给一段学习一个入口</strong><p>首页卡片是一级结构，例如“分子束与碰撞”。每个主题有自己的笔记和关系图。</p></div></div><div class="help-step"><span>02</span><div><strong>关系图：把逻辑画出来</strong><p>并列用于比较，分支用于发散，延伸用于深入。还可以标记前置、依据、辨析和应用。已有位置会保留，新卡片优先补到相关卡片附近。“自动整理”按已保存的知识关系重新排布，可撤销。默认突出主要联系：分组表示归属，同向同端点的学习顺序并入科学连线。悬停读完整说明，菜单可查看全部关系。内容关系由笔记整理时结合材料审核保存。按钮旁菜单提供仅整理连线、显示全部归属线和撤销。重新排版先预览，应用后才保存。主线从左向右展开，长主线可横向拖动查看；并列支路在上下分开，汇合内容继续向右。模块画布只显示本模块内容，跨模块关系在框架总览中查看。滚轮缩放，点击“显示全图”可查看所有节点。</p></div></div><div class="help-step"><span>03</span><div><strong>笔记详情：留下具体理解和来源</strong><p>点击节点后默认专注阅读；点“关系图”返回图与正文。新建笔记可用“复习模板”从问题与思路开始，把必要推导、配图、辨析与联系放在对应步骤旁。正文连续显示；“本页思路”可就地定位，知识连接直接可见，完整来源记录按需展开。编辑支持 Markdown 标题、列表、引用、表格、代码和待办。常用 LaTeX 公式支持离线排版：行内使用 $…$，独立公式使用 $$ 块。支持分式、上下标、希腊字母等；暂不支持的语法会显示原式。代码块保持原文。一个笔记可以记录多个来源，也可以选择、粘贴或拖放图片到正文，点击已保存的图片可缩放、查看原始大小，放大后可拖动查看。</p></div></div><div class="help-step"><span>↗</span><div><strong>检索和回顾</strong><p>Ctrl K 搜索标题、正文、标签和来源。Ctrl N 快速记录；Ctrl S 立即保存。待解问题与待复习帮助你回到需要继续理解的内容。</p></div></div></div><div class="info-box">笔记库从空白开始。你可以自行记录，也可以在后续对话中明确让我总结并生成笔记，再写入这个本地笔记库。</div><div class="info-box">数据只保存在本机。使用右上角的保存状态确认落盘；定期导出 JSON。双击应用目录的“启动笔记.cmd”可再次打开。</div>`,{wide:true});}
async function init(){
  installImageUI(toast,()=>navigation.resume());
  document.addEventListener('click',event=>{
    const anchor=event.target.closest('a[href^="#/"]');
    if(!anchor||event.defaultPrevented||event.button>0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||anchor.target==='_blank')return;
    const route=parseRoute(anchor.getAttribute('href'));
    event.preventDefault();navigate(route.view,route.topicId,route.noteId,route.scope);
  });
  document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
  $('#brand-home').onclick=e=>{e.preventDefault();navigate('home');};document.querySelectorAll('.primary-nav [data-view]').forEach(b=>b.onclick=()=>{state.filters={query:'',type:'',status:'',source:'',tag:'',sort:'updated'};navigate(b.dataset.view);});
  $('#capture-sidebar').onclick=()=>showCapture();$('#topic-sidebar').onclick=()=>{if(allowNotebookWrite())showTopicForm();};$('#search-button').onclick=showSearch;$('#backup-button').onclick=showBackup;$('#help-button').onclick=showHelp;$('#save-status').onclick=()=>{if(state.readOnly){allowNotebookWrite();return;}if(state.conflict)showConflict(state.conflictLatest);else save();};$('#mobile-menu').onclick=()=>$('.sidebar').classList.toggle('open');
  $('#import-file').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file||!allowNotebookWrite())return;if(file.size>MAX_BACKUP_BYTES){toast('完整备份超过256MB，请改为恢复整个应用目录。',true);return;}try{const backup=parseBackup(JSON.parse(await file.text()));showImport(backup.notebook,file.name,backup);}catch(error){toast(`无法导入：${error.message}`,true);}};
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(state.db)showSearch();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='n'){e.preventDefault();if(state.db)showCapture();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();save();}else if(e.key==='Escape'){closeModal();$('.sidebar').classList.remove('open');}});
  document.addEventListener('keydown',e=>{if(e.key!=='Tab'||!state.modal)return;const focusables=[...document.querySelectorAll('.modal button,.modal input,.modal select,.modal textarea,.modal summary,.modal a')].filter(el=>!el.disabled&&el.getClientRects().length);if(!focusables.length)return;const first=focusables[0],last=focusables.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}});
  window.addEventListener('hashchange',()=>{if(state.db)readRoute();});
  window.addEventListener('beforeunload',e=>{if(state.dirty||state.saving||state.importing||state.exporting||localState.pending||imagesUploading()){e.preventDefault();e.returnValue='';}});
  window.addEventListener('offline',()=>{if(state.dirty){updateSaveStatus('连接中断 · 修改未保存','error');toast(localState.draftDurable?'连接已中断，当前修改保留在本机草稿文件中。':'连接已中断，当前修改尚未持久保存，请保持窗口打开。',true);}});
  window.addEventListener('online',()=>{if(state.dirty&&!state.conflict){keepDraft();save();}});
  try{
    // The response declares read-only mode before any legacy browser state can
    // be migrated or a saved draft can be restored into this notebook.
    const response=await fetch('/api/notebook');
    state.readOnly=response.headers?.get('X-Notes-Read-Only')==='1';
    const data=await response.json();if(!response.ok)throw new Error(data.message||'读取失败');
    if(state.readOnly)document.title='原笔记只读预览 · 笔记';
    let legacyStorage=null;if(!state.readOnly){try{legacyStorage=window.localStorage;}catch{}}
    await localState.initialize(legacyStorage);
    let panePreferences=null;try{panePreferences=JSON.parse(localState.preferences[PANE_STORAGE_KEY]||'null');}catch{}
    paneLayout=installPaneLayout({initialPreferences:panePreferences,persistPreference});
    state.db=data;updateSaveStatus('已保存在本地');readRoute();if(!state.readOnly)showDraftRecovery();
  }
  catch(error){updateSaveStatus('读取失败','error');$('#main-content').innerHTML=`<div class="empty-state">${icon('question')}<strong>暂时无法打开笔记库</strong><p>${esc(error.message)}<br>请确认本地服务正在运行。如果文件损坏，可从已有备份恢复。</p><button class="button" id="retry-load">重新载入</button></div>`;$('#retry-load').onclick=()=>location.reload();}
}
init();
