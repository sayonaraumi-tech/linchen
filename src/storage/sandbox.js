/* Deliberately test-scoped persistence adapter.
 * No production Firebase configuration or direct production data writes.
 */
const B=require('../core/business');
function createSandboxStore({storage,key='tsukinowa_construction_sandbox_v1'}={}){
 if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')throw Error('A scoped storage adapter is required');
 const clone=x=>JSON.parse(JSON.stringify(x));
 function validate(s){if(!s||s.schemaVersion!==1||s.scope!=='test'||!s.collections||!s.operationIds)throw Error('テスト専用データ以外は読み込めません');return s;}
 let latest;
 const raw=storage.getItem(key);
 if(raw){try{latest=validate(JSON.parse(raw));}catch(e){throw Error('テスト保存データが不正です。上書きせずバックアップを確認してください: '+e.message);}}
 else latest=B.emptyState('test');
 let pending=Promise.resolve();
 function checkExternal(){
   const raw=storage.getItem(key);
   if(raw){const external=validate(JSON.parse(raw));if(JSON.stringify(external)!==JSON.stringify(latest))throw Error('別の画面で更新されました。再読込してください');}
 }
 function perform(command){
  const task=pending.then(()=>{
   checkExternal();
   const result=B.perform(latest,command);
   storage.setItem(key,JSON.stringify(result.state));
   latest=result.state;
   return {result:clone(result.result),reused:result.reused};
  });
  pending=task.catch(()=>{});
  return task;
 }
 function snapshot(){return clone(latest);}
 function exportBackup(){return JSON.stringify({format:'tsukinowa-sandbox-backup',exportedAt:new Date().toISOString(),data:latest},null,2);}
 function importBackup(json){
  if(storage.getItem(key))throw Error('既存テストデータがあります。別の保存名を使用してください。');
  const parsed=JSON.parse(json);
  if(parsed.format!=='tsukinowa-sandbox-backup')throw Error('バックアップ形式が異なります');
  latest=validate(parsed.data);
  storage.setItem(key,JSON.stringify(latest));
 }
 return {perform,snapshot,exportBackup,importBackup,storageKey:key};
}
module.exports={createSandboxStore};
