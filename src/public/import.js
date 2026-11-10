const TYPES = new Set(['concept','question','insight','paper','method']);
const STATUSES = new Set(['inbox','learning','understood','review']);
const SOURCES = new Set(['conversation','paper','thought','web','other']);
const RELATIONS = new Set(['sequence','parallel','branch','extends','prerequisite','evidence','contradicts','applies']);
const fail = (at, text) => { throw new Error(`${at}：${text}`); };
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj,key);
function object(value, at, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(at,'应为对象');
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(at,`未知字段 ${key}`);
}
function text(value,at,max,empty=false) {
  if (typeof value !== 'string' || value.length>max || (!empty&&!value.trim())) fail(at,`应为${empty?'可空':'非空'}文字，最多 ${max} 字符`);
}
function id(value,at) {text(value,at,100);if(!/^[A-Za-z0-9_-]+$/.test(value))fail(at,'编号格式无效');}
function date(value,at) {text(value,at,50);if(!/^\d{4}-\d{2}-\d{2}T/.test(value)||!Number.isFinite(Date.parse(value)))fail(at,'日期格式无效');}
function array(value,at,max) {if(!Array.isArray(value)||value.length>max)fail(at,`应为数组，最多 ${max} 项`);}
function member(value,at,set) {if(!set.has(value))fail(at,'类型或状态无效');}
function optional(value,key,at,max) {if(own(value,key))text(value[key],`${at}.${key}`,max,true);}

// Check the whole import before it can replace any visible or saved data.
export function validateImport(data) {
  object(data,'备份',['version','revision','topics','notes','links']);
  if(data.version!==1)fail('备份','请使用笔记导出的版本 1 JSON 文件');
  if(!Number.isSafeInteger(data.revision)||data.revision<0)fail('备份','版本号无效');
  array(data.topics,'主题',250);array(data.notes,'笔记',5000);array(data.links,'连接',15000);
  const topics=new Set(),notes=new Map(),links=new Set();
  data.topics.forEach((t,i)=>{
    const at=`主题 ${i+1}`;object(t,at,['id','title','description','color','createdAt']);id(t.id,at);
    if(topics.has(t.id))fail(at,'主题编号重复');topics.add(t.id);
    text(t.title,at,300);optional(t,'description',at,4000);date(t.createdAt,at);
    if(own(t,'color')&&!/^#[0-9a-f]{6}$/i.test(t.color))fail(at,'颜色格式无效');
  });
  data.notes.forEach((n,i)=>{
    const at=`笔记 ${i+1}`;object(n,at,['id','topicId','title','content','type','status','tags','sources','createdAt','updatedAt','position']);
    id(n.id,at);id(n.topicId,at);if(notes.has(n.id))fail(at,'笔记编号重复');if(!topics.has(n.topicId))fail(at,'所属主题不存在');
    text(n.title,at,300);text(n.content,at,120000,true);member(n.type,at,TYPES);member(n.status,at,STATUSES);
    array(n.tags,at,50);n.tags.forEach(t=>text(t,at,100));if(new Set(n.tags).size!==n.tags.length)fail(at,'标签重复');
    array(n.sources,at,100);const sourceIds=new Set();n.sources.forEach(s=>{
      object(s,at,['id','type','title','url','excerpt']);id(s.id,at);member(s.type,at,SOURCES);text(s.title,at,500);
      optional(s,'url',at,4000);optional(s,'excerpt',at,60000);
      if(sourceIds.has(s.id))fail(at,'来源编号重复');sourceIds.add(s.id);
    });
    date(n.createdAt,at);date(n.updatedAt,at);
    if(own(n,'position')){object(n.position,at,['x','y']);for(const axis of ['x','y'])if(!Number.isFinite(n.position[axis])||Math.abs(n.position[axis])>1000000)fail(at,'图中位置无效');}
    notes.set(n.id,n);
  });
  data.links.forEach((l,i)=>{
    const at=`连接 ${i+1}`;object(l,at,['id','topicId','from','to','type','label']);id(l.id,at);id(l.topicId,at);id(l.from,at);id(l.to,at);
    if(links.has(l.id))fail(at,'连接编号重复');links.add(l.id);
    const from=notes.get(l.from),to=notes.get(l.to);
    if(!topics.has(l.topicId)||!from||!to)fail(at,'主题或笔记端点不存在');
    if(l.from===l.to)fail(at,'不能连接笔记自身');
    if(from.topicId!==l.topicId||to.topicId!==l.topicId)fail(at,'连接不能跨主题');
    member(l.type,at,RELATIONS);optional(l,'label',at,500);
  });
  if(new TextEncoder().encode(JSON.stringify({notebook:data,baseRevision:data.revision})).length>64*1024*1024)fail('备份','内容超过 64MB，请分成多个笔记库保存');
  return data;
}

const sameFields=(a,b,keys)=>keys.every(key=>JSON.stringify(a[key])===JSON.stringify(b[key]));
export function mergeNotebooks(current,imported,uid) {
  const db=structuredClone(current),topics=new Map(),notes=new Map();
  for(const t of imported.topics){
    let existing=db.topics.find(x=>x.id===t.id&&sameFields(x,t,['title','description','color','createdAt']));
    if(!existing){existing={...t,id:db.topics.some(x=>x.id===t.id)?uid('topic'):t.id};db.topics.push(existing);}
    topics.set(t.id,existing.id);
  }
  for(const n of imported.notes){
    const existing=db.notes.find(x=>x.id===n.id&&x.topicId===topics.get(n.topicId)&&sameFields(x,n,['title','content','type','status','tags','sources','createdAt','updatedAt','position']));
    if(existing){notes.set(n.id,existing.id);continue;}
    const copy={...n,id:db.notes.some(x=>x.id===n.id)?uid('note'):n.id,topicId:topics.get(n.topicId)};
    db.notes.push(copy);notes.set(n.id,copy.id);
  }
  for(const l of imported.links){
    const from=notes.get(l.from),to=notes.get(l.to);
    if(!db.links.some(x=>x.from===from&&x.to===to&&x.type===l.type&&(x.label||'')===(l.label||'')))db.links.push({...l,id:db.links.some(x=>x.id===l.id)?uid('link'):l.id,topicId:topics.get(l.topicId),from,to});
  }
  return validateImport(db);
}
