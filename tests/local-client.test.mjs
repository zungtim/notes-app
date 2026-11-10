import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalStateClient, cleanExportLabel } from '../src/public/local-state.js';
import { LocalStateStore } from '../src/lib/local-state.mjs';

const response = (value, ok = true) => ({ok, json:async () => value});
const deferred = () => {let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('export labels keep Unicode titles within backend limits and create valid local files', async () => {
  const root=process.env.NOTES_TEST_ARTIFACTS||fileURLToPath(new URL('../_workspace/test-artifacts/',import.meta.url));
  await fs.mkdir(root,{recursive:true});
  const store=new LocalStateStore(await fs.mkdtemp(path.join(root,'client-export-')));
  assert.equal(cleanExportLabel('CON'),'_CON');
  assert.equal(cleanExportLabel('.hidden'),'hidden');
  assert.equal(cleanExportLabel('a/b\\c:d?*\u0000\u007f'),'a_b_c_d____');
  assert.equal(cleanExportLabel('...   '),'学习笔记');
  for(const title of ['中文'.repeat(150),'😀📝'.repeat(100),'CON','CON.txt','.hidden','../a/b\\c:d?* . ','a'.repeat(300)]){
    const label=cleanExportLabel(title);
    assert.ok(Buffer.byteLength(label)<=140);assert.ok(label.length<=100);
    assert.equal(/[\ud800-\udbff]$/.test(label),false);
    for(const format of ['json','markdown']){
      const filename=format==='json'?`${label}_2026-10-22.json`:`${label}.md`;
      assert.ok(Buffer.byteLength(filename)<=180);assert.ok(filename.length<=120);
      const content=format==='json'?'{}':'# Synthetic export';
      const result=await store.exportFile({filename,content,format});
      assert.equal(result.filename,filename);assert.equal(await fs.readFile(result.path,'utf8'),content);
    }
  }
});
function browserStorage(entries) {
  const values = new Map(entries);
  return {
    values,
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    removeItem(key) { values.delete(key); },
    setItem() { assert.fail('The app must not write new browser storage.'); },
  };
}

test('legacy migration waits for durable acknowledgement and only removes app-owned keys', async () => {
  const gate=deferred();const calls=[];
  const draft={data:{version:1,revision:2,topics:[],notes:[],links:[]},changedAt:'2026-10-22T00:00:00.000Z'};
  const storage=browserStorage([['unrelated','keep'],['zhixu-draft-v1',JSON.stringify(draft)],['zhixu-layout-topic_1','branches']]);
  const client=createLocalStateClient({makeId:()=> 'tab_one',fetcher:async(url,options)=>{
    calls.push({url,options});
    if(url==='/api/local-state')return response({preferences:{},drafts:[]});
    if(url==='/api/drafts')await gate.promise;
    return response({ok:true});
  }});
  const initialize=client.initialize(storage);await tick();
  assert.ok(storage.getItem('zhixu-draft-v1'));
  gate.resolve();await initialize;
  assert.equal(storage.getItem('zhixu-draft-v1'),null);
  assert.equal(storage.getItem('zhixu-layout-topic_1'),null);
  assert.equal(storage.getItem('unrelated'),'keep');
  const migrated=JSON.parse(calls.find(call=>call.url==='/api/drafts').options.body);
  assert.match(migrated.id,/^legacy_[a-f0-9]{64}$/);
  assert.deepEqual(migrated.draft,draft);
  assert.equal(client.preferences['zhixu-layout-topic_1'],'branches');
});

test('failed migration preserves old browser data, and retry uses the same content id', async () => {
  const raw=JSON.stringify({data:{revision:1},changedAt:'2026-10-22T00:00:00.000Z'});
  const storage=browserStorage([['zhixu-draft-v1',raw]]);const ids=[];const errors=[];let fail=true;
  const fetcher=async(url,options)=>{
    if(url==='/api/local-state')return response({preferences:{},drafts:[]});
    ids.push(JSON.parse(options.body).id);
    return response(fail?{message:'disk full'}:{ok:true},!fail);
  };
  await createLocalStateClient({fetcher,makeId:()=> 'one',onError:(...args)=>errors.push(args)}).initialize(storage);
  assert.equal(storage.getItem('zhixu-draft-v1'),raw);assert.equal(errors.length,1);
  fail=false;
  await createLocalStateClient({fetcher,makeId:()=> 'two'}).initialize(storage);
  assert.equal(storage.getItem('zhixu-draft-v1'),null);assert.equal(ids[0],ids[1]);
});

test('migration does not erase a newer value from an older open app tab', async () => {
  const storage=browserStorage([['zhixu-layout-topic_1','columns']]);
  const client=createLocalStateClient({makeId:()=> 'one',fetcher:async(url)=>{
    if(url==='/api/local-state')return response({preferences:{},drafts:[]});
    storage.values.set('zhixu-layout-topic_1','branches');return response({ok:true});
  }});
  await client.initialize(storage);
  assert.equal(storage.getItem('zhixu-layout-topic_1'),'branches');
  assert.equal(client.preferences['zhixu-layout-topic_1'],'columns');
});

test('an older notebook save cannot clear a draft captured while it was saving', async () => {
  const gate=deferred();const calls=[];
  const client=createLocalStateClient({makeId:()=> 'tab_one',fetcher:async(url,options)=>{
    calls.push({url,options});if(calls.length===1)await gate.promise;return response({ok:true});
  }});
  const first=client.captureDraft({revision:1,text:'first'});await tick();
  const cleanup=client.clearDraft(first.version);
  const second=client.captureDraft({revision:2,text:'newer'});
  gate.resolve();await first.promise;assert.equal(await cleanup,false);await second.promise;
  assert.equal(calls.some(call=>call.options.method==='DELETE'),false);
  assert.equal(JSON.parse(calls.at(-1).options.body).draft.data.text,'newer');
  assert.equal(client.draftDurable,true);
});

test('a newer draft is written after an already-running cleanup, with independent tab ids', async () => {
  const gate=deferred();const calls=[];
  const fetcher=async(url,options)=>{calls.push({url,options});if(options.method==='DELETE')await gate.promise;return response({ok:true});};
  const client=createLocalStateClient({fetcher,makeId:()=> 'tab_one'});
  const first=client.captureDraft({revision:1,text:'first'});await first.promise;
  const cleanup=client.clearDraft(first.version);await tick();
  const second=client.captureDraft({revision:2,text:'newer'});gate.resolve();await cleanup;await second.promise;
  const other=createLocalStateClient({fetcher,makeId:()=> 'tab_two'});await other.captureDraft({revision:1,text:'other tab'}).promise;
  assert.deepEqual(calls.map(call=>call.options.method),['POST','DELETE','POST','POST']);
  assert.equal(JSON.parse(calls[2].options.body).id,'tab_one');
  assert.equal(JSON.parse(calls[3].options.body).id,'tab_two');
});

test('failed draft writes remain undurable and can be retried without browser storage', async () => {
  let fail=true;
  const client=createLocalStateClient({makeId:()=> 'one',fetcher:async()=>response(fail?{message:'offline'}:{ok:true},!fail)});
  await assert.rejects(client.captureDraft({revision:1}).promise,/offline/);assert.equal(client.draftDurable,false);
  fail=false;await client.captureDraft({revision:1}).promise;assert.equal(client.draftDurable,true);
});

test('exports pass strings to the local file API and report failures to the caller', async () => {
  const gate=deferred();let body;let complete=false;
  const client=createLocalStateClient({makeId:()=> 'one',fetcher:async(url,options)=>{
    assert.equal(url,'/api/exports');body=JSON.parse(options.body);await gate.promise;
    return response({filename:'note.md',path:'app/data/exports/note.md',bytes:6});
  }});
  const exportPromise=client.exportFile('note.md','# Note','markdown').then(result=>{complete=true;return result;});
  await tick();assert.equal(complete,false);assert.deepEqual(body,{filename:'note.md',content:'# Note',format:'markdown'});
  gate.resolve();assert.equal((await exportPromise).path,'app/data/exports/note.md');
  const failing=createLocalStateClient({makeId:()=> 'two',fetcher:async()=>response({message:'disk full'},false)});
  await assert.rejects(failing.exportFile('notes.json','{}','json'),/disk full/);
});
