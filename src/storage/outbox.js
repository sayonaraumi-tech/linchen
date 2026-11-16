/* Durable command outbox. A failed remote operation is never discarded.
 * The caller triggers flush() explicitly, e.g. on reconnect; no hidden repair.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaOutbox=api;})(globalThis,function(){
'use strict';
const copy=x=>JSON.parse(JSON.stringify(x));
const keyFor=(projectId,companyId,uid)=>'tsukinowa_construction_outbox_v1_'+[projectId,companyId,uid].map(v=>String(v||'').replace(/[^A-Za-z0-9_-]/g,'_')).join('_');
function createOutbox({storage,projectId,companyId,uid,send}={}){
 if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function'||typeof send!=='function')throw Error('Outbox adapter missing');
 if(!projectId||!companyId||!uid)throw Error('Outbox scope missing');
 const key=keyFor(projectId,companyId,uid),archiveKey=key+'_archived';
 function read(name){
  const raw=storage.getItem(name);if(!raw)return [];
  const parsed=JSON.parse(raw);if(!Array.isArray(parsed))throw Error('Outbox data corrupted: '+name);return parsed;
 }
 let queue=read(key),archived=read(archiveKey),running=null;
 function persist(next,archive=archived){
  // Atomic per-key best effort; failed local storage must not pretend success.
  storage.setItem(key,JSON.stringify(next));
  if(archive!==archived)storage.setItem(archiveKey,JSON.stringify(archive));
  queue=next;archived=archive;
 }
 function enqueue(command){
  const id=String(command?.operationId||'');
  if(!id||!command.type)throw Error('操作IDと種類が必要です');
  const previous=queue.find(x=>x.operationId===id)||archived.find(x=>x.operationId===id);
  if(previous){
   if(JSON.stringify(previous.command)!==JSON.stringify(command))throw Error('操作IDが異なる内容に再利用されています');
   return copy(previous);
  }
  const entry={operationId:id,command:copy(command),status:'pending',attempts:0,error:null};
  persist([...queue,entry]);return copy(entry);
 }
 async function flush(){
  if(running)return running;
  running=(async()=>{
   let processed=0;
   for(const entry of [...queue]){
    if(entry.status==='blocked')break;
    if(entry.status!=='pending')continue;
    try{
     const result=await send(copy(entry.command));
     const next=queue.filter(x=>x.operationId!==entry.operationId);
     persist(next);processed++;
    }catch(e){
     const conflict=/競合|permission-denied|権限|版数|precondition|invalid-argument/i.test(String(e.code||'')+' '+String(e.message||''));
     const next=queue.map(x=>x.operationId===entry.operationId?{...x,status:conflict?'blocked':'pending',attempts:x.attempts+1,error:String(e.message||e)}:x);
     persist(next);return {processed,pending:queue.length,blocked:conflict,error:String(e.message||e)};
    }
   }
   return {processed,pending:queue.length,blocked:queue.some(x=>x.status==='blocked')};
  })();
  try{return await running;}finally{running=null;}
 }
 function archiveBlocked(operationId,{reason}={}){
  const entry=queue.find(x=>x.operationId===operationId);
  if(!entry||entry.status!=='blocked')throw Error('競合保管対象がありません');
  if(!reason||!String(reason).trim())throw Error('保管理由が必要です');
  const out=[...archived,{...entry,archivedReason:String(reason).trim()}];
  // archive before removal to guarantee retained evidence if storage fails
  storage.setItem(archiveKey,JSON.stringify(out));
  persist(queue.filter(x=>x.operationId!==operationId),out);
  return {operationId,archived:true};
 }
 function exportRecovery(){return JSON.stringify({projectId,companyId,uid,queue,archived},null,2);}
 return {enqueue,flush,snapshot:()=>copy(queue),archiveBlocked,exportRecovery,key};
}
return {createOutbox,keyFor};
});
