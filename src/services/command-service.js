/* Atomic application service: own business domain -> multi-record Firestore.
 * A revision-checked shared domain counter serializes commands; document numbers,
 * accounting links and cash mirroring commit together in ONE Firestore transaction.
 * This is a guarded integration prototype, not production activation.
 */
const Domain=require('../core/business');
const META_ID='_domain_metadata';
const COLLECTIONS=Domain.COLLECTIONS.filter(k=>k!=='auditLogs');
const clone=x=>JSON.parse(JSON.stringify(x));
const json=x=>JSON.stringify(x);
class RevisionConflict extends Error {}
async function requestHash(command){
 const canonical=(value)=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
 const bytes=new TextEncoder().encode(JSON.stringify(canonical(command)));
 if(!globalThis.crypto?.subtle)throw Error('Secure SHA-256 not available for operation verification');
 const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
}
function createCommandService({repository,maximumChanges=6,maximumRecords=2000}={}){
 if(!repository||!['list','read','apply','readOperation'].every(k=>typeof repository[k]==='function'))throw Error('Transactional Firestore repository required');
 if(!Number.isInteger(maximumChanges)||maximumChanges<2||maximumChanges>8)throw Error('Invalid maximum changes');
 if(!Number.isInteger(maximumRecords)||maximumRecords<1||maximumRecords>10000)throw Error('Invalid maximum records');
 async function load(){
  const first=await repository.read('settings',META_ID);
  const state=Domain.emptyState('production');
  const snapshots={};
  let scanned=0;
  for(const collection of COLLECTIONS){
   const records=await repository.list(collection,maximumRecords-scanned+1);
   scanned+=records.length;
   if(scanned>maximumRecords)throw Error('大量履歴データを全件読込する操作は未対応です。ページ分割された信頼済サーバ処理が必要です');
   for(const r of records){
    if(collection==='settings'&&r.id===META_ID)continue;
    if(!r.payload||!Number.isInteger(r.revision))throw Error('Invalid Firestore record: '+collection+'/'+r.id);
    state.collections[collection][r.id]=clone(r.payload);
    snapshots[collection+'/'+r.id]={revision:r.revision,payload:clone(r.payload)};
   }
  }
  const last=await repository.read('settings',META_ID);
  if(json(first)!==json(last))throw new RevisionConflict('同期中に更新がありました。操作を再試行してください');
  state.seq=Number(first?.payload?.seq||0);
  if(!Number.isSafeInteger(state.seq)||state.seq<0)throw Error('Domain sequence corrupted');
  return {state,revision:first?.revision||0,snapshots};
 }
 async function execute(command){
  if(command.type==='deleteTestRecord')throw Error('テスト削除はテスト領域のみで利用可能です');
  if(!command.operationId||!command.type)throw Error('操作IDと種類が必要です');
  if(command.type==='saveSettings'&&command.key===META_ID)throw Error('予約済み設定キーです');
  const fingerprint=await requestHash(command);
  const previous=await repository.readOperation(command.operationId);
  if(previous){
   const actor=await repository.identity();
   if(previous.action!==command.type||previous.requestHash!==fingerprint||previous.actorId!==actor.uid)throw Error('同一操作IDの依頼内容が一致しません');
   return {reused:true,targets:previous.targets,operationId:command.operationId};
  }
  const {state,revision,snapshots}=await load();
  if(command.expectedRevision!==undefined&&command.expectedRevision!==revision){
   throw new RevisionConflict('版数競合: 最新のデータを再読込してください');
  }
  const editableCollection={saveCustomer:'customers',saveSchedule:'schedule'}[command.type];
  if(command.expectedRevision!==undefined&&command.id&&editableCollection){
   const original=snapshots[editableCollection+'/'+command.id]?.payload;
   if(!original)throw Error('編集対象の記録がありません');
   if(editableCollection==='schedule'&&(original.estimateId||original.registeredSaleId||original.googleEventId||
     Object.values(state.collections.documents).some(doc=>doc.scheduleId===original.id||
       doc.items?.some(item=>item.sourceEventId===original.id)))){
    throw Error('連携済日程は専用の訂正手続が必要です');
   }
  }
  const before=clone(state);
  const result=Domain.perform(state,command);
  const changed=[];
  for(const collection of COLLECTIONS){
   for(const [id,payload] of Object.entries(result.state.collections[collection])){
    const key=collection+'/'+id,old=snapshots[key];
    if(!old||json(old.payload)!==json(payload)){
     changed.push({collection,id,expectedRevision:old?.revision||0,payload:clone(payload)});
    }
   }
   for(const id of Object.keys(before.collections[collection])){
    if(!result.state.collections[collection][id])throw Error('正式データの直接削除はできません');
   }
  }
  const meta={seq:result.state.seq,schemaVersion:1};
  changed.push({collection:'settings',id:META_ID,expectedRevision:revision,payload:meta});
  if(changed.length>maximumChanges)throw Error('多件数の操作は業務単位で分割し、個別照合してください');
  // All changed business records, audit logs, and domain meta commit atomically.
  try{
   const commit=await repository.apply({operationId:command.operationId,action:command.type,changes:changed,requestHash:fingerprint});
   return {...commit,result:clone(result.result),changes:changed.length};
  }catch(e){
   // If another client succeeded with identical operationId, only return the
   // immutable marker; never repeat accounting or allocate a second number.
   const committed=await repository.readOperation(command.operationId);
   if(committed){
    const actor=await repository.identity();
    if(committed.action!==command.type||committed.requestHash!==fingerprint||committed.actorId!==actor.uid)throw Error('同一操作IDの依頼内容が一致しません');
    return {reused:true,targets:committed.targets,operationId:command.operationId};
   }
   throw e;
  }
 }
 return {execute,load};
}
module.exports={createCommandService,META_ID,RevisionConflict};
