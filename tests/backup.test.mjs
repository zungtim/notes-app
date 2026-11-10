import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {APP_ROOT,createAppServer} from '../src/server.mjs';
import {createNotebookFixture} from './fixtures/notebook.mjs';
import {createBackup,parseBackup,restoreBackupImages,referencedImages} from '../src/public/backup.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGNULstmYGBgYgADKAUAE1gBCu14UxIAAAAASUVORK5CYII=','base64');
const url=`/images/${createHash('sha256').update(png).digest('hex')}.png`;
const doc=()=>{const d=createNotebookFixture();d.notes[0].content+=`\n\n![测试图片](${url})`;d.notes[1].content+=`\n\n![重复引用](${url})`;return d;};
test('full backup embeds referenced image once and restores identical binary before notebook import',async()=>{
  const d=doc();const fetched=[];
  const bundle=await createBackup(d,async path=>{fetched.push(path);return new Response(png,{headers:{'Content-Type':'image/png'}});});
  assert.deepEqual(fetched,[url]);assert.equal(bundle.images.length,1);assert.equal(bundle.images[0].base64,png.toString('base64'));
  const parsed=parseBackup(bundle);let restored=0;
  await restoreBackupImages(parsed,async(path,options)=>{assert.equal(path,'/api/images');assert.deepEqual(Buffer.from(options.body),png);restored++;return Response.json({url});});
  assert.equal(restored,1);assert.deepEqual(parsed.notebook,d);assert.deepEqual(referencedImages(d),[url]);
});
test('old text backup still imports and missing image-only backup stops before notebook changes',async()=>{
  const text=createNotebookFixture();assert.deepEqual(parseBackup(text).notebook,text);
  await restoreBackupImages(parseBackup(text),()=>{throw new Error('should not fetch');});
  const parsed=parseBackup(doc());await assert.rejects(restoreBackupImages(parsed,async()=>new Response(null,{status:404})),/缺少原图/);
});
test('missing, unsafe or altered backup image is rejected before uploads',async()=>{
  const bundle=await createBackup(doc(),async()=>new Response(png));
  const missing=structuredClone(bundle);missing.images=[];assert.throws(()=>parseBackup(missing),/缺少/);
  const unsafe=structuredClone(bundle);unsafe.images[0].url='/images/../../private.png';assert.throws(()=>parseBackup(unsafe),/地址/);
  const altered=structuredClone(bundle);altered.images[0].base64=Buffer.from('corrupted').toString('base64');let uploads=0;
  await assert.rejects(restoreBackupImages(parseBackup(altered),async()=>{uploads++;}),/不匹配/);assert.equal(uploads,0);
  await assert.rejects(createBackup(doc(),async()=>new Response(null,{status:404})),/无法读取/);
});

test('image backup restores into a fresh library and survives a real server restart',async t=>{
  const parent=process.env.NOTES_TEST_ARTIFACTS||path.join(APP_ROOT,'.dev-workspace','test-artifacts');await fs.mkdir(parent,{recursive:true});
  const directory=await fs.mkdtemp(path.join(parent,'image-backup-'));
  const active=new Set();
  const start=async dataDir=>{const {server}=createAppServer({dataDir});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));active.add(server);return {server,fetcher:(url,options)=>fetch(`http://127.0.0.1:${server.address().port}${url}`,options)};};
  const stop=async server=>{await new Promise(resolve=>server.close(resolve));active.delete(server);};
  t.after(async()=>{for(const server of active)await stop(server);});
  const source=await start(path.join(directory,'source'));
  const uploaded=await source.fetcher('/api/images',{method:'POST',headers:{'Content-Type':'image/png'},body:png});
  assert.equal(uploaded.status,201);assert.equal((await uploaded.json()).url,url);
  const saved=await source.fetcher('/api/notebook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({notebook:doc(),baseRevision:0})});
  assert.equal(saved.status,200);const original=await saved.json();
  const bundle=await createBackup(original,source.fetcher);const parsed=parseBackup(JSON.parse(JSON.stringify(bundle)));
  const targetDir=path.join(directory,'target'),target=await start(targetDir);
  assert.equal((await target.fetcher(url)).status,404);
  await restoreBackupImages(parsed,target.fetcher);
  const restored=await target.fetcher('/api/notebook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({notebook:{...parsed.notebook,revision:0},baseRevision:0})});
  assert.equal(restored.status,200);await stop(target.server);
  const reopened=await start(targetDir);const notebook=await (await reopened.fetcher('/api/notebook')).json();
  assert.deepEqual(notebook.notes,original.notes);assert.deepEqual(notebook.links,original.links);
  assert.deepEqual(Buffer.from(await (await reopened.fetcher(url)).arrayBuffer()),png);
  assert.equal((await (await reopened.fetcher('/api/images')).json()).images.length,1);
  const exportedAgain=await createBackup(notebook,reopened.fetcher);assert.deepEqual(exportedAgain.images,bundle.images);
});
