import { validateImport } from './import.js';

export const MAX_BACKUP_BYTES=256*1024*1024;
const MAX_IMAGE_BYTES=10*1024*1024;
const TYPES={'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp'};
const LOCAL_IMAGE=/^\/images\/([a-f0-9]{64})\.(png|jpg|gif|webp)$/;
const findImages=/\/images\/[a-f0-9]{64}\.(?:png|jpg|gif|webp)(?![a-z0-9./])/g;
export function referencedImages(notebook){
  return [...new Set(notebook.notes.flatMap(note=>String(note.content||'').match(findImages)||[]))];
}
function bytesToBase64(bytes){
  let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(text);
}
function base64ToBytes(value){
  if(typeof value!=='string'||value.length>Math.ceil(MAX_IMAGE_BYTES/3)*4||!value.length||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw new Error('备份中的图片编码无效或超过10MB。');
  const decoded=atob(value);const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));
  if(!bytes.length||bytes.length>MAX_IMAGE_BYTES)throw new Error('备份中的图片超过10MB。');
  return bytes;
}
async function digest(bytes){
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function validateImage(item){
  if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['url','mime','name','base64'].includes(k)))throw new Error('备份中的图片信息不完整。');
  const match=typeof item.url==='string'&&item.url.match(LOCAL_IMAGE);
  if(!match||TYPES[item.mime]!==match[2]||typeof item.name!=='string'||item.name.length>500)throw new Error('备份中的图片地址或格式无效。');
  return base64ToBytes(item.base64);
}

export function parseBackup(value){
  if(value?.format!=='zhixu-backup')return {notebook:validateImport(value),images:[],legacy:true};
  if(value.backupVersion!==1||Object.keys(value).some(k=>!['format','backupVersion','exportedAt','notebook','images'].includes(k))||!Array.isArray(value.images)||value.images.length>5000)throw new Error('不支持这个图片备份的格式。');
  validateImport(value.notebook);
  if(typeof value.exportedAt!=='string'||!Number.isFinite(Date.parse(value.exportedAt)))throw new Error('备份日期无效。');
  const seen=new Set();for(const item of value.images){validateImage(item);if(seen.has(item.url))throw new Error('备份中的图片地址重复。');seen.add(item.url);}
  for(const url of referencedImages(value.notebook))if(!seen.has(url))throw new Error('完整备份缺少笔记引用的图片，现有笔记不会被替换。');
  return {notebook:value.notebook,images:value.images,legacy:false};
}

export async function createBackup(notebook,fetcher=fetch){
  const snapshot=structuredClone(validateImport(notebook));
  const backup={format:'zhixu-backup',backupVersion:1,exportedAt:new Date().toISOString(),notebook:snapshot,images:[]};
  let size=new TextEncoder().encode(JSON.stringify(backup)).length;
  for(const url of referencedImages(snapshot)){
    const response=await fetcher(url);
    if(!response.ok)throw new Error('有一张笔记图片无法读取，备份未导出。请检查原图是否仍在data/images。');
    const bytes=new Uint8Array(await response.arrayBuffer());
    const ext=url.match(LOCAL_IMAGE)[2],mime=Object.keys(TYPES).find(type=>TYPES[type]===ext);
    if(!bytes.length||bytes.length>MAX_IMAGE_BYTES||`/images/${await digest(bytes)}.${ext}`!==url)throw new Error('图片文件不完整，备份未导出。');
    const item={url,mime,name:url.split('/').at(-1),base64:bytesToBase64(bytes)};
    size+=new TextEncoder().encode(JSON.stringify(item)).length+1;
    if(size>MAX_BACKUP_BYTES)throw new Error('完整备份超过256MB。请停止应用后复制整个应用目录进行备份。');
    backup.images.push(item);
  }
  return backup;
}

export async function restoreBackupImages(parsed,fetcher=fetch,onProgress=()=>{}){
  // Verify every hash before creating any file, then upload before committing notebook changes.
  const decoded=[];
  for(const item of parsed.images){const bytes=validateImage(item);const ext=TYPES[item.mime];if(`/images/${await digest(bytes)}.${ext}`!==item.url)throw new Error('备份图片内容与其地址不匹配，现有笔记不会被替换。');decoded.push({item,bytes});}
  if(parsed.legacy){
    for(const url of referencedImages(parsed.notebook)){const r=await fetcher(url,{method:'HEAD'});if(!r.ok)throw new Error('这份旧备份只含图片链接，缺少原图。请使用含图片的完整JSON备份，或先恢复data/images文件夹。');}
  }
  for(let i=0;i<decoded.length;i++){
    onProgress(i,decoded.length);
    const {item,bytes}=decoded[i];
    const response=await fetcher('/api/images',{method:'POST',headers:{'Content-Type':item.mime,'X-Image-Name':encodeURIComponent(item.name)},body:bytes});
    const result=await response.json();
    if(!response.ok)throw new Error(result.message||'图片恢复失败，现有笔记不会被替换。');
    if(result.url!==item.url)throw new Error('图片恢复地址不一致，现有笔记不会被替换。');
  }
  onProgress(decoded.length,decoded.length);
}
