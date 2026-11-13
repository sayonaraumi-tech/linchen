const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const sdk=require('firebase/firestore'),{createRepository}=require('../src/storage/firestore-repository');
let env;
const projectId='demo-tsukinowa-construction';
before(async()=>{env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8086,rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});});
after(async()=>{if(env)await env.cleanup();});
function context(uid,role,companyId='tsukinowa'){
 const ctx=env.authenticatedContext(uid,{role,companyId});
 const repo=createRepository({sdk,db:ctx.firestore(),getIdentity:async()=>({uid,role,companyId}),companyId:'tsukinowa',writeEnabled:true});
 return {ctx,repo};
}
test('real Firestore transaction writes envelope + immutable audit + operation atomically',async()=>{
 const {repo}=context('admin','admin');
 const q={operationId:'rule-test-a',action:'saveCustomer',changes:[{collection:'customers',id:'rulecustomer',expectedRevision:0,payload:{name:'検証顧客'}}]};
 const first=await repo.apply(q);
 assert.equal(first.reused,false);
 const saved=await repo.read('customers','rulecustomer');
 assert.equal(saved.payload.name,'検証顧客');assert.equal(saved.revision,1);
 assert.equal((await repo.apply(q)).reused,true);
 await assert.rejects(repo.apply({...q,operationId:'rule-test-b'}),/版数競合/);
 const audit=await repo.read('auditLogs','rule-test-a_0');assert.equal(audit.after.name,'検証顧客');
});
test('staff can read customer but cannot read bank or mutate direct Firestore documents',async()=>{
 const {repo,ctx}=context('staff','staff');
 assert.equal((await repo.read('customers','rulecustomer')).payload.name,'検証顧客');
 await assert.rejects(repo.list('bankTransactions'),/管理者/);
 const ref=sdk.doc(ctx.firestore(),'companies/tsukinowa/bankTransactions/evil');
 await assertFails(sdk.setDoc(ref,{companyId:'tsukinowa',amount:999}));
});
test('foreign company role and unauthenticated direct write denied',async()=>{
 const outsider=env.authenticatedContext('outsider',{role:'admin',companyId:'other'});
 await assertFails(sdk.getDoc(sdk.doc(outsider.firestore(),'companies/tsukinowa/customers/rulecustomer')));
 const anonymous=env.unauthenticatedContext();
 await assertFails(sdk.setDoc(sdk.doc(anonymous.firestore(),'companies/tsukinowa/customers/x'),{any:1}));
});
test('admin cannot forge a bare record without transaction audit and operation marker',async()=>{
 const {ctx}=context('admin','admin');
 const target=sdk.doc(ctx.firestore(),'companies/tsukinowa/customers/unlogged');
 await assertFails(sdk.setDoc(target,{schemaVersion:1,companyId:'tsukinowa',revision:1,payload:{name:'bad'}}));
});
test('admin cannot delete protected business records',async()=>{
 const {ctx}=context('admin','admin');
 await assertFails(sdk.deleteDoc(sdk.doc(ctx.firestore(),'companies/tsukinowa/customers/rulecustomer')));
});
