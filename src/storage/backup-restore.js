/* Offline backup + restore preflight for isolated business data.
 * No Firebase SDK, network, or production write capability.
 * Canonical SHA-256 detects altered payloads. Recovery is test-only and
 * requires an exact company scope and an explicit operator confirmation.
 */
'use strict';
const crypto=require('node:crypto'),Domain=require('../core/business');
const clone=v=>JSON.parse(JSON.stringify(v));
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?
 Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const forbidden=/^(?:apiKey|secret|password|accessToken|refreshToken|privateKey)$/i;
function noSecretFields(root){
 const walk=(x,path='data')=>{
  if(Array.isArray(x)){x.forEach((v,i)=>walk(v,path+'['+i+']'));return;}
  if(!x||typeof x!=='object')return;
  for(const [k,v]of Object.entries(x)){
   if(forbidden.test(k))throw Error('Sensitive field cannot be backed up: '+path+'.'+k);
   walk(v,path+'.'+k);
  }
 };walk(root);
}
function validateState(state){
 if(!state||state.schemaVersion!==1||!['test','production'].includes(state.scope))throw Error('Unsupported backup schema');
 for(const col of Domain.COLLECTIONS){
  const rows=state.collections?.[col];
  if(!rows||typeof rows!=='object'||Array.isArray(rows))throw Error('Missing backup collection: '+col);
  for(const [id,row]of Object.entries(rows)){
   if(!row||row.id!==id)throw Error('Backup identity mismatch: '+col+'/'+id);
  }
 }
 if(!Number.isSafeInteger(state.seq)||state.seq<0)throw Error('Invalid sequence');
 if(!state.operationIds||typeof state.operationIds!=='object'||Array.isArray(state.operationIds))throw Error('Operation journal missing');
 noSecretFields(state);
 const result=Domain.getOverview(state);
 for(const [k,v]of Object.entries(result))if(typeof v==='number'&&!Number.isSafeInteger(v))throw Error('Invalid financial total '+k);
 return result;
}
function exportBackup({state,companyId,createdAt}={}){
 if(!companyId||typeof companyId!=='string'||companyId.length>100)throw Error('Company scope required');
 if(!/^\d{4}-\d\d-\d\dT/.test(String(createdAt||'')))throw Error('Backup creation timestamp required');
 const overview=validateState(state),payload=clone(state);
 const body={format:'linchen-isolated-backup-v1',companyId,createdAt,readonly:true,
   recordCount:Domain.COLLECTIONS.reduce((n,k)=>n+Object.keys(payload.collections[k]).length,0),
   overview,state:payload};
 return {...body,sha256:digest(body)};
}
function inspectBackup(bundle,{companyId}={}){
 if(!bundle||bundle.format!=='linchen-isolated-backup-v1'||bundle.companyId!==companyId)
  throw Error('Company or backup format mismatch');
 const {sha256,...body}=bundle;
 if(!/^[0-9a-f]{64}$/.test(String(sha256||''))||digest(body)!==sha256)throw Error('Backup checksum mismatch');
 const overview=validateState(bundle.state);
 if(JSON.stringify(stable(overview))!==JSON.stringify(stable(bundle.overview)))throw Error('Backup financial totals mismatch');
 const count=Domain.COLLECTIONS.reduce((n,k)=>n+Object.keys(bundle.state.collections[k]).length,0);
 if(count!==bundle.recordCount)throw Error('Backup record count mismatch');
 return {valid:true,companyId,count,overview,sha256,scope:bundle.state.scope};
}
function restoreToEmptyTest({bundle,companyId,confirmation,currentState}={}){
 if(confirmation!=='RESTORE-ISOLATED-TEST')throw Error('Explicit restore confirmation required');
 const inspection=inspectBackup(bundle,{companyId});
 if(inspection.scope!=='test'||currentState?.scope!=='test')throw Error('Production data recovery is not authorized');
 if(!currentState||Domain.COLLECTIONS.some(k=>Object.keys(currentState.collections?.[k]||{}).length)||
    Object.keys(currentState.operationIds||{}).length)throw Error('Restore target must be an empty isolated test account');
 const restored=clone(bundle.state);
 if(digest(restored)!==digest(bundle.state))throw Error('Backup restore verification failed');
 return {state:restored,report:{...inspection,restored:true,productionTouched:false}};
}
module.exports={exportBackup,inspectBackup,restoreToEmptyTest,digest};
