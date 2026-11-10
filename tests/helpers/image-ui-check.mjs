// Manual browser verification. All notebook and image APIs are intercepted;
// this check reads app assets but never writes the production notebook.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { startQaServer } from './start-qa.mjs';

// Optional developer tool: use a separately provided Playwright installation.
// Browser profiles, downloads and temporary files stay in the QA workspace.
const qa = await startQaServer('notes-image-ui');
let context;
try {
const { chromium } = await import(process.env.NOTES_PLAYWRIGHT_MODULE || 'playwright');
const root=path.join(qa.workspace,'artifacts');
context = await chromium.launchPersistentContext(path.join(qa.workspace,'profile'),{...(process.env.NOTES_BROWSER_EXECUTABLE ? {executablePath:process.env.NOTES_BROWSER_EXECUTABLE} : {}),headless:true,viewport:{width:1440,height:1000},downloadsPath:root,env:{...process.env}});
const page=await context.newPage();let delayUpload=false;let uploads=0;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGNULstmYGBgYgADKAUAE1gBCu14UxIAAAAASUVORK5CYII=','base64');
const hash=createHash('sha256').update(png).digest('hex');const imageURL=`/images/${hash}.png`;const stamp=new Date().toISOString();
let notebook={version:1,revision:0,topics:[{id:'test_topic',title:'图片界面测试',description:'独立浏览器 fixture',color:'#23766b',createdAt:stamp}],notes:[{id:'test_note',topicId:'test_topic',title:'已有笔记',content:'初始正文',type:'concept',status:'inbox',tags:[],sources:[],createdAt:stamp,updatedAt:stamp}],links:[]};
const errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.route('**/api/notebook',async route=>{
  if(route.request().method()==='POST'){const body=route.request().postDataJSON();assert.equal(body.baseRevision,notebook.revision);notebook={...body.notebook,revision:notebook.revision+1};}
  await route.fulfill({status:200,json:notebook});
});
await page.route('**/api/images',async route=>{uploads++;if(delayUpload)await new Promise(resolve=>setTimeout(resolve,700));await route.fulfill({status:201,json:{id:hash,name:'测试图片.png',url:imageURL,mime:'image/png',size:png.length,width:2,height:3}});});
await page.route('**/images/*',route=>route.fulfill({status:200,contentType:'image/png',body:png}));
const file=(name='实验截图.png')=>({name,mimeType:'image/png',buffer:png});
  await page.goto(qa.url);await page.waitForSelector('#home-new-topic');
  await page.locator('#capture-sidebar').click();await page.locator('#capture-title').fill('新建含图笔记');await page.locator('#capture-content').fill('## 问题\n文字说明\n\n## 推导与展开\n必要推理\n\n## 附图\n对应读图');
  await page.locator('#capture-content').evaluate(el=>el.setSelectionRange(el.value.length,el.value.length));
  await page.locator('#capture-form input[type=file]').setInputFiles(file());
  await page.waitForFunction(()=>document.querySelector('#capture-content').value.includes('/images/'));
  assert.ok(await page.locator('.image-upload-status').textContent());
  await page.locator('#capture-form button[type=submit]').click();await page.waitForSelector('.note-image-open');
  await page.waitForFunction(()=>document.querySelector('.note-image-open img').naturalWidth===2);await page.waitForTimeout(650);
  assert.equal(notebook.notes.length,2);assert.ok(notebook.notes[1].content.includes(imageURL));
  assert.ok(notebook.notes[1].content.includes('必要推理'));
  assert.equal(await page.locator('article details:not(.note-outline-panel)').count(),0);
  assert.equal(await page.locator('.note-outline button').count(),3,await page.locator('article').innerHTML());
  const routeBefore=await page.evaluate(()=>({hash:location.hash,history:history.length}));
  await page.locator('.note-outline button').last().click();
  assert.deepEqual(await page.evaluate(()=>({hash:location.hash,history:history.length})),routeBefore);
  await page.locator('.note-image-open').click();await page.waitForSelector('.image-preview-overlay');
  await page.waitForFunction(()=>document.querySelector('.image-preview-overlay img').naturalWidth===2);
  await page.getByRole('button',{name:'放大图片',exact:true}).click();
  assert.equal(await page.locator('.image-preview-tools [aria-live]').textContent(),'125%');
  await page.getByRole('button',{name:'图片适应窗口',exact:true}).click();
  assert.equal(await page.locator('.image-preview-tools [aria-live]').textContent(),'100%');
  await page.getByRole('button',{name:'图片原始大小',exact:true}).click();
  await page.keyboard.press('Tab');assert.equal(await page.locator('.image-preview-close').evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Shift+Tab');assert.equal(await page.getByRole('button',{name:'图片原始大小',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.image-preview-overlay').count(),0);
  assert.equal(await page.locator('.note-image-open').evaluate(el=>el===document.activeElement),true);
  await page.locator('#toggle-edit').click();
  await page.evaluate(bytes=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(bytes)],'粘贴图片.png',{type:'image/png'}));document.querySelector('#edit-content').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));},[...png]);
  await page.waitForFunction(()=>document.querySelector('#edit-content').value.includes('粘贴图片'));
  await page.evaluate(bytes=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(bytes)],'拖放图片.png',{type:'image/png'}));document.querySelector('#edit-content').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));},[...png]);
  await page.waitForFunction(()=>document.querySelector('#edit-content').value.includes('拖放图片'));
  const before=await page.locator('#edit-content').inputValue();
  await page.locator('#detail-panel input[type=file]').setInputFiles({name:'unsafe.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});
  assert.ok((await page.locator('.image-upload-status').textContent()).includes('请选择 PNG'));
  assert.equal(await page.locator('#edit-content').inputValue(),before);
  const pastePrevented=await page.evaluate(()=>{const transfer=new DataTransfer();transfer.setData('text/plain','文字粘贴');const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer});document.querySelector('#edit-content').dispatchEvent(event);return event.defaultPrevented;});assert.equal(pastePrevented,false);
  delayUpload=true;await page.locator('#detail-panel input[type=file]').setInputFiles(file('慢速图片.png'));await page.waitForTimeout(80);assert.equal(await page.locator('#finish-edit').isDisabled(),true);
  await page.evaluate(()=>location.hash='#/home');await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>location.hash),'#/home');assert.equal(await page.locator('#edit-content').count(),1);
  await page.waitForSelector('#home-new-topic');await page.goBack();await page.waitForSelector('.note-image-open');assert.equal(await page.locator('.note-image-open').count(),4);
  await page.waitForTimeout(650);assert.equal(uploads,4);assert.equal(errors.length,0,errors.join('\n'));
  await page.screenshot({path:path.join(root,'image-detail.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'image-mobile.png'),fullPage:true});
  console.log('IMAGE_UI_OK: capture, saved-note edit, upload, paste, drag/drop, unsupported format, text paste, large preview, pending upload route guard, autosave.');console.log(`Screenshots: ${root}`);
} finally {try {await context?.close();} finally {await qa.close();}}
