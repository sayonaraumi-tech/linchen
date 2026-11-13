/* Explicitly gated Firestore repository. This is a persistence boundary,
 * not a shortcut around the business domain's validation.
 * Never enable against production before security rules/emulator acceptance.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaFirestoreGateway=api;})(globalThis,function(){
'use strict';
const COLLECTIONS=Object.freeze(['settings','customers','projects','schedule','documents','sales','payments','expenses','cashLedger','bankTransactions','suppliers','supplierTransactions','calendarLinks','auditLogs']);
const STAFF_READ=new Set(['customers','projects','schedule','documents','sales','payments','calendarLinks']);
const validId=x=>typeof x==='string'&&x.length>0&&x.length<=160&&!/[/\x00-\x1f]/.test(x)&&!['.','..'].includes(x);
const requireId=(x,label)=>{if(!validId(x))throw Error(label+'のIDが不正です');return x;};
function createRepository({sdk,db,getIdentity,companyId,writeEnabled=false}={}){
 if(!sdk||!db||typeof getIdentity!=='function')throw Error('Firestore SDK、DB、認証が必要です');
 requireId(companyId,'会社');
 const base='companies/'+companyId;
 async function identity(){
  const user=await getIdentity();
  if(!user||!user.uid||user.companyId!==companyId||!['admin','staff'].includes(user.role))throw Error('会社権限を確認できません');
  return user;
 }
 function collectionName(name){if(!COLLECTIONS.includes(name))throw Error('Unknown collection: '+name);return name;}
 function path(name,id){return base+'/'+collectionName(name)+'/'+requireId(id,'記録');}
 function canRead(user,name){if(user.role==='staff'&&!STAFF_READ.has(name))throw Error('この記録は管理者のみです');}
 async function readOperation(operationId){
  const user=await identity();if(user.role!=='admin')throw Error('操作記録は管理者のみです');
  const snap=await sdk.getDoc(sdk.doc(db,base+'/operations/'+requireId(operationId,'操作')));
  return snap.exists()?snap.data():null;
 }
 async function read(name,id){
  const user=await identity();canRead(user,name);
  const snap=await sdk.getDoc(sdk.doc(db,path(name,id)));
  return snap.exists()?{id:snap.id,...snap.data()}:null;
 }
 async function list(name){
  const user=await identity();canRead(user,name);
  const snaps=await sdk.getDocs(sdk.collection(db,base+'/'+collectionName(name)));
  return snaps.docs.map(d=>({id:d.id,...d.data()}));
 }
 /* One command is an immutable operation with up to ten checked writes.
  * No delete, no blind writes, no client-controlled actor or audit metadata.
  * Caller must validate the domain command before calling apply().
  */
 async function apply({operationId,action,changes}={}){
  if(!writeEnabled)throw Error('Firestore書込は検証完了まで無効です');
  const user=await identity();
  if(user.role!=='admin')throw Error('会計・正式登録は管理者のみです');
  requireId(operationId,'操作');requireId(action,'操作種別');
  if(!Array.isArray(changes)||changes.length<1||changes.length>10)throw Error('更新件数が不正です');
  const seen=new Set();
  for(const c of changes){
   if(!c||!COLLECTIONS.includes(c.collection)||c.collection==='auditLogs')throw Error('更新対象が不正です');
   requireId(c.id,'記録');
   if(!Number.isInteger(c.expectedRevision)||c.expectedRevision<0)throw Error('更新版数が必要です');
   if(!c.payload||typeof c.payload!=='object'||Array.isArray(c.payload))throw Error('更新内容が不正です');
   const k=c.collection+'/'+c.id;if(seen.has(k))throw Error('同じ記録を一度の操作で二重更新できません');seen.add(k);
  }
  const signature=JSON.stringify({action,changes:changes.map(c=>({collection:c.collection,id:c.id,expectedRevision:c.expectedRevision,payload:c.payload}))});
  const operationPath=base+'/operations/'+operationId;
  return sdk.runTransaction(db,async tx=>{
   const marker=await tx.get(sdk.doc(db,operationPath));
   if(marker.exists()){
    const prev=marker.data();
    if(prev.action!==action||prev.actorId!==user.uid||prev.signature!==signature)throw Error('操作IDの重複内容が不一致です');
    return {operationId,reused:true,targets:prev.targets};
   }
   const old=[];
   const numberClaims=changes.filter(c=>c.collection==='documents'&&c.expectedRevision===0);
   for(const c of numberClaims){
    const no=c.payload.invoiceNo;
    if(!/^\d{8}-\d{4}-\d{2,}$/.test(String(no||''))||c.payload.snapshot?.invoiceNo!==no)throw Error('正式帳票番号とsnapshotが一致しません');
    const reservation=await tx.get(sdk.doc(db,base+'/documentNumbers/'+no));
    if(reservation.exists())throw Error('帳票番号の競合: '+no);
   }
   for(const c of changes){const snap=await tx.get(sdk.doc(db,path(c.collection,c.id)));old.push(snap.exists()?snap.data():null);}
   for(let i=0;i<changes.length;i++){
    const c=changes[i],previous=old[i];
    const revision=previous?.revision||0;
    if(revision!==c.expectedRevision)throw Error('版数競合: '+c.collection+'/'+c.id);
    if(previous&&previous.companyId!==companyId)throw Error('会社IDが不一致です');
   }
   const now=sdk.serverTimestamp(),targets=changes.map(c=>c.collection+'/'+c.id);
   for(let i=0;i<changes.length;i++){
    const c=changes[i],previous=old[i],auditId=operationId+'_'+i;
    const envelope={schemaVersion:1,companyId,revision:(previous?.revision||0)+1,createdAt:previous?.createdAt||now,createdBy:previous?.createdBy||user.uid,updatedAt:now,updatedBy:user.uid,lastOperationId:operationId,lastAuditId:auditId,payload:structuredClone(c.payload)};
    tx.set(sdk.doc(db,path(c.collection,c.id)),envelope);
    tx.set(sdk.doc(db,path('auditLogs',auditId)),{operationId,userId:user.uid,companyId,entityType:c.collection,entityId:c.id,action,before:previous?.payload||null,after:structuredClone(c.payload),timestamp:now});
   }
   for(const c of numberClaims){tx.set(sdk.doc(db,base+'/documentNumbers/'+c.payload.invoiceNo),{invoiceNo:c.payload.invoiceNo,operationId,actorId:user.uid,companyId,documentId:c.id,createdAt:now});}
   tx.set(sdk.doc(db,operationPath),{operationId,action,actorId:user.uid,companyId,targets,signature,createdAt:now});
   return {operationId,reused:false,targets};
  });
 }
 return {read,list,readOperation,apply,identity,companyId};
}
return {COLLECTIONS,STAFF_READ:[...STAFF_READ],createRepository};
});
