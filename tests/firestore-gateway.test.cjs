const {test}=require('node:test'),assert=require('node:assert/strict');
const {createRepository}=require('../src/storage/firestore-repository');
function mockFirestore(){
 const data=new Map(),db={};
 const ref=(db,path)=>({path,id:path.split('/').at(-1)});
 const snap=(id,val)=>({id,exists:()=>val!==undefined,data:()=>structuredClone(val)});
 const sdk={
  doc:ref,
  collection:ref,
  serverTimestamp:()=>({seconds:1234}),
  getDoc:async r=>snap(r.id,data.get(r.path)),
  getDocs:async r=>({docs:[...data].filter(([k])=>k.startsWith(r.path+'/')).map(([k,v])=>snap(k.split('/').at(-1),v))}),
  runTransaction:async (db,fn)=>{
   const writes=[];
   const tx={get:async r=>snap(r.id,data.get(r.path)),set:(r,v)=>writes.push([r.path,structuredClone(v)])};
   const out=await fn(tx);
   for(const [k,v] of writes)data.set(k,v);
   return out;
  }
 };
 return {sdk,db,data};
}
const input={operationId:'op1',action:'saveCustomer',changes:[{collection:'customers',id:'customer1',expectedRevision:0,payload:{name:'テスト株式会社'}}]};
test('Firestore gateway refuses write by default',async()=>{
 const m=mockFirestore(),repo=createRepository({...m,getIdentity:async()=>({uid:'admin',companyId:'test',role:'admin'}),companyId:'test'});
 await assert.rejects(repo.apply(input),/無効/);
 assert.equal(m.data.size,0);
});
test('write is one transaction with operation and before/after audit, replay returns read-only',async()=>{
 const m=mockFirestore(),repo=createRepository({...m,getIdentity:async()=>({uid:'admin',companyId:'test',role:'admin'}),companyId:'test',writeEnabled:true});
 const first=await repo.apply(input);assert.equal(first.reused,false);
 assert.equal(m.data.size,3);
 const record=await repo.read('customers','customer1');assert.equal(record.revision,1);
 assert.equal(record.payload.name,'テスト株式会社');
 assert.equal((await repo.apply(input)).reused,true);
 assert.equal(m.data.size,3);
 await assert.rejects(repo.apply({...input,changes:[{...input.changes[0],payload:{name:'別名'}}]}),/重複/);
 assert.equal(m.data.size,3);
});
test('stale revision fails without any partial writes',async()=>{
 const m=mockFirestore(),repo=createRepository({...m,getIdentity:async()=>({uid:'admin',companyId:'test',role:'admin'}),companyId:'test',writeEnabled:true});
 await repo.apply(input);
 await assert.rejects(repo.apply({operationId:'op2',action:'update',changes:[{collection:'customers',id:'customer1',expectedRevision:0,payload:{name:'B'}}]}),/版数競合/);
 assert.equal(m.data.size,3);
});
test('staff cannot write accounting; staff cannot read protected bank data',async()=>{
 const m=mockFirestore(),repo=createRepository({...m,getIdentity:async()=>({uid:'staff',companyId:'test',role:'staff'}),companyId:'test',writeEnabled:true});
 await assert.rejects(repo.apply(input),/管理者/);
 await assert.rejects(repo.list('bankTransactions'),/管理者/);
 await assert.rejects(repo.read('expenses','e1'),/管理者/);
});
test('cross-company identity is rejected before any database action',async()=>{
 const m=mockFirestore(),repo=createRepository({...m,getIdentity:async()=>({uid:'admin',companyId:'other',role:'admin'}),companyId:'test',writeEnabled:true});
 await assert.rejects(repo.apply(input),/権限/);
 assert.equal(m.data.size,0);
});
