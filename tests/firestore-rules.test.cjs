const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const sdk=require('firebase/firestore'),{createRepository}=require('../src/storage/firestore-repository');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {createTrustedRepository}=require('../services/api/firebase-repository.cjs');
let env, adminApp;
const projectId='demo-tsukinowa-construction';
before(async()=>{
 if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8086')throw Error('Run this suite against the local Firestore emulator');
 adminApp=initializeApp({projectId},'linchen-rules-test');
 env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8086,rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});});
after(async()=>{if(env)await env.cleanup();if(adminApp)await deleteApp(adminApp);});
function context(uid,role,companyId='tsukinowa'){
 const ctx=env.authenticatedContext(uid,{role,companyId,linchenSandbox:true});
 const repo=createRepository({sdk,db:ctx.firestore(),getIdentity:async()=>({uid,role,companyId}),companyId:'tsukinowa',writeEnabled:true});
 return {ctx,repo:role==='admin'&&companyId==='tsukinowa'?createTrustedRepository(adminApp,{uid,role,companyId}):repo};
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

test('formal number has atomic unique reservation and original snapshot cannot be overwritten',async()=>{
 const {repo}=context('admin','admin');
 const no='20261113-1315-01';
 const docPayload={docType:'invoice',invoiceNo:no,snapshot:{invoiceNo:no,customerName:'A'},status:'active'};
 const command={operationId:'number-test-a',action:'issueDocument',changes:[{collection:'documents',id:'documentA',expectedRevision:0,payload:docPayload}]};
 assert.equal((await repo.apply(command)).reused,false);
 assert.equal((await repo.apply(command)).reused,true);
 await assert.rejects(repo.apply({operationId:'number-test-b',action:'issueDocument',changes:[{collection:'documents',id:'documentB',expectedRevision:0,payload:docPayload}]}),/帳票番号/);
 await assert.rejects(repo.apply({operationId:'number-test-c',action:'reviseInPlace',changes:[{collection:'documents',id:'documentA',expectedRevision:1,payload:{...docPayload,snapshot:{invoiceNo:no,customerName:'不正変更'}}}]}));
 assert.equal((await repo.read('documents','documentA')).payload.snapshot.customerName,'A');
});

test('real Firestore domain service atomically creates invoice and cash receipt with no duplicate sale',async()=>{
 const {repo}=context('admin','admin');
 const {createCommandService}=require('../src/services/command-service');
 const service=createCommandService({repository:repo,maximumChanges:6});
 const invoice={operationId:'domain-invoice-test',type:'issueDocument',docType:'invoice',
   sourceKey:'domain-invoice-test',issuedAt:'2026-11-13T04:16:00Z',amount:11000,
   snapshot:{customerName:'合成テスト顧客',invoiceDate:'2026-11-13',items:[{content:'壁紙',qty:1,price:10000}]}};
 const first=await service.execute(invoice);
 assert.equal(first.reused,false);assert.equal(first.changes,3);
 assert.equal((await service.execute(invoice)).reused,true);
 const sales=await repo.list('sales');assert.equal(sales.length,1);
 const documentRows=(await repo.list('documents')).filter(x=>x.payload.sourceKey==='domain-invoice-test');
 assert.equal(documentRows.length,1);
 assert.equal(documentRows[0].payload.invoiceNo,'20261113-1316-01');
 const receipt={operationId:'domain-receipt-test',type:'issueDocument',docType:'receipt',
   sourceKey:'domain-receipt-test',issuedAt:'2026-11-13T04:17:00Z',
   snapshot:{customerName:'現金テスト顧客',invoiceDate:'2026-11-13',receiptTotal:12000,paymentMethod:'現金'}};
 const paid=await service.execute(receipt);assert.equal(paid.reused,false);
 assert.equal(paid.changes,5);
 const cashReceipts=(await repo.list('sales')).filter(x=>x.payload.sourceId.startsWith('receipt:'));
 assert.equal(cashReceipts.length,1);
 const payments=await repo.list('payments');
 assert.equal(payments.length,1);assert.equal(payments[0].payload.confirmation,'cash-received');
 const ledger=await repo.list('cashLedger');
 assert.equal(ledger.length,1);
 assert.equal(ledger[0].payload.sourceId,payments[0].id);
 assert.equal((await service.execute(receipt)).reused,true);
 assert.equal((await repo.list('cashLedger')).length,1);
});

test('two concurrent administrators cannot silently overwrite shared business IDs',async()=>{
 const {createCommandService}=require('../src/services/command-service');
 const svc1=createCommandService({repository:context('admin','admin').repo,maximumChanges:6});
 const svc2=createCommandService({repository:context('admin2','admin').repo,maximumChanges:6});
 const commands=[
  {operationId:'concurrent-project-one',type:'saveProject',customer:'同時申請A'},
  {operationId:'concurrent-project-two',type:'saveProject',customer:'同時申請B'}
 ];
 const both=await Promise.allSettled([svc1.execute(commands[0]),svc2.execute(commands[1])]);
 for(const [i,r] of both.entries())if(r.status==='rejected'){
  await (i===0?svc1:svc2).execute(commands[i]);
 }
 const saved=(await context('admin','admin').repo.list('projects'))
   .filter(r=>['同時申請A','同時申請B'].includes(r.payload.customer));
 assert.equal(saved.length,2);
 assert.notEqual(saved[0].id,saved[1].id);
});

test('advanced estimate acceptance and supplier monthly deduction commit as atomic Firestore business transactions',async()=>{
 const {createCommandService}=require('../src/services/command-service');
 const {repo}=context('admin','admin');
 const service=createCommandService({repository:repo,maximumChanges:6});
 const estimate={operationId:'fs-est-base',type:'issueDocument',docType:'estimate',sourceKey:'fs-est-base',amount:11000,
  snapshot:{customerName:'合成顧客',invoiceDate:'2026-11-13',items:[{content:'クロス張替',qty:1,price:10000}]}};
 await service.execute(estimate);
 const estimateId=(await repo.list('documents')).find(x=>x.payload.sourceKey==='fs-est-base').id;
 const accepted=await service.execute({operationId:'fs-est-accept',type:'acceptEstimate',estimateId,workDate:'2026-11-19'});
 assert.equal(accepted.reused,false);assert.equal(accepted.changes,4);
 const schedules=(await repo.list('schedule')).filter(x=>x.payload.estimateId===estimateId);
 assert.equal(schedules.length,1);assert.equal((await repo.list('sales')).filter(x=>x.payload.scheduleId===schedules[0].id).length,0);
 await service.execute({operationId:'fs-supplier-new',type:'saveSupplier',name:'合成仕入先',openingBalance:100000});
 const supplier=(await repo.list('suppliers')).find(x=>x.payload.name==='合成仕入先');
 const saved=await service.execute({operationId:'fs-supplier-month',type:'settleSupplierInvoice',supplierId:supplier.id,
  invoiceMonth:'2026-11',invoiceNo:'FS-SUPPLIER-001',date:'2026-11-30',amount:80000,deductionAmount:60000,
  description:'材料仕入',reviewed:true});
 assert.equal(saved.reused,false);assert.equal(saved.changes,3);
 const t=(await repo.list('supplierTransactions')).filter(x=>x.payload.invoiceNo==='FS-SUPPLIER-001');
 const exp=(await repo.list('expenses')).filter(x=>x.payload.supplierTransactionId===t[0].id);
 assert.equal(t.length,1);assert.equal(t[0].payload.deductionAmount,60000);assert.equal(exp.length,1);
 assert.equal(exp[0].payload.amount,80000);
 const replay=await service.execute({operationId:'fs-supplier-month',type:'settleSupplierInvoice',supplierId:supplier.id,
  invoiceMonth:'2026-11',invoiceNo:'FS-SUPPLIER-001',date:'2026-11-30',amount:80000,deductionAmount:60000,
  description:'材料仕入',reviewed:true});
 assert.equal(replay.reused,true);
 assert.equal((await repo.list('expenses')).filter(x=>x.payload.supplierTransactionId===t[0].id).length,1);
});

test('even a sandbox-tagged admin cannot commit a fully structured accounting write directly',async()=>{
 const {ctx}=context('admin','admin');
 const direct=createRepository({sdk,db:ctx.firestore(),companyId:'tsukinowa',
   getIdentity:async()=>({uid:'admin',role:'admin',companyId:'tsukinowa'}),writeEnabled:true});
 await assertFails(direct.apply({operationId:'forge-audit-and-row',action:'registerPayment',changes:[
   {collection:'payments',id:'fake-payment',expectedRevision:0,payload:{amount:10000,confirmation:'cash-received'}},
   {collection:'cashLedger',id:'fake-cash',expectedRevision:0,payload:{amount:10000,sourceId:'fake-payment'}}
 ]}));
 assert.equal(await direct.readOperation('forge-audit-and-row'),null);
 assert.equal(await direct.read('cashLedger','fake-cash'),null);
});

test('hostile client matrix rejects direct financial edits, forged audit, cross-tenant and deletion',async()=>{
 const admin=env.authenticatedContext('production-admin',{role:'admin',companyId:'tsukinowa'}).firestore();
 const staff=env.authenticatedContext('production-staff',{role:'staff',companyId:'tsukinowa'}).firestore();
 const forgedSandboxStaff=env.authenticatedContext('staff-sandbox',{role:'staff',companyId:'tsukinowa',linchenSandbox:true}).firestore();
 const otherTenant=env.authenticatedContext('other-admin',{role:'admin',companyId:'other-company',linchenSandbox:true}).firestore();
 const anon=env.unauthenticatedContext().firestore();
 const c='companies/tsukinowa';
 const forgedRecord={companyId:'tsukinowa',payload:{amount:990000,status:'paid'},revision:1,
   createdBy:'production-admin',updatedBy:'production-admin',lastOperationId:'forged',lastAuditId:'forged_0'};
 const forgedOperation={operationId:'forged',actorId:'production-admin',companyId:'tsukinowa',
   targets:['payments/forged'],signature:'fake',action:'payment-confirm'};
 for(const collectionName of ['sales','payments','cashLedger','bankTransactions','expenses','documents','settings']){
   await assertFails(sdk.setDoc(sdk.doc(admin,`${c}/${collectionName}/forged`),forgedRecord));
   await assertFails(sdk.setDoc(sdk.doc(staff,`${c}/${collectionName}/forged`),forgedRecord));
 }
 await assertFails(sdk.setDoc(sdk.doc(admin,`${c}/operations/forged`),forgedOperation));
 await assertFails(sdk.setDoc(sdk.doc(staff,`${c}/auditLogs/forged`),{companyId:'tsukinowa',after:{amount:1}}));
 await assertFails(sdk.setDoc(sdk.doc(forgedSandboxStaff,`${c}/operations/forged`),forgedOperation));
 await assertFails(sdk.setDoc(sdk.doc(otherTenant,`${c}/payments/forged`),forgedRecord));
 await assertFails(sdk.setDoc(sdk.doc(anon,`${c}/sales/forged`),forgedRecord));
 await assertFails(sdk.deleteDoc(sdk.doc(admin,`${c}/payments/forged`)));
 await assertFails(sdk.updateDoc(sdk.doc(admin,`${c}/payments/forged`),{revision:999,payload:{amount:0}}));
});

test('trusted API verifies Firebase identity, roles, tenant, freshness and optimistic revisions',async()=>{
 const {getAuth}=require('firebase-admin/auth');
 const {randomUUID}=require('node:crypto');
 const {createCommandHandler}=require('../services/api/commands.cjs');
 const host=process.env.FIREBASE_AUTH_EMULATOR_HOST;
 assert.equal(host,'127.0.0.1:9098');
 const auth=getAuth(adminApp);
 async function login(role,companyId='api-isolated',linchenSandbox=false){
  const email=randomUUID()+'@example.invalid',password=randomUUID();
  const user=await auth.createUser({email,password});
  await auth.setCustomUserClaims(user.uid,{role,companyId,linchenSandbox});
  const result=await fetch('http://'+host+'/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})
  });
  assert.equal(result.status,200);
  return {token:(await result.json()).idToken,uid:user.uid};
 }
 const handler=createCommandHandler({app:adminApp,companyId:'api-isolated'});
 const admin=await login('admin'),otherAdmin=await login('admin');
 const mfaProtected=createCommandHandler({app:adminApp,companyId:'api-isolated',requireAdminMfa:true});
 const withoutMfa=await mfaProtected(new Request('http://localhost/api/workspace',{
  headers:{Authorization:'Bearer '+admin.token}
 }));
 assert.equal(withoutMfa.status,403);
 assert.equal((await withoutMfa.json()).error,'mfa_required');
 const staff=await login('staff'),foreign=await login('admin','other'),sandbox=await login('admin','api-isolated',true);
 const call=(token,command)=>handler(new Request('http://localhost/api/commands',{
  method:command?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
  ...(command?{body:JSON.stringify(command)}:{})
 }));
 const base={operationId:randomUUID(),type:'saveCustomer',name:'架空顧客',expectedRevision:0,expiresAt:Date.now()+60000};
 assert.equal((await call(null,base)).status,401);
 assert.equal((await call('invalid',base)).status,401);
 for(const actor of [staff,foreign,sandbox])assert.equal((await call(actor.token,base)).status,403);
 for(const bad of [
  {...base,expiresAt:Date.now()-1},
  {...base,amount:5000},
  {...base,type:'importBankTransaction'},
  {...base,companyId:'other'},
  {...base,id:'__proto__'},
  {...base,name:'x'.repeat(13000)},
 ])assert.equal((await call(admin.token,bad)).status,400);
 assert.deepEqual(await (await call(admin.token)).json(),{revision:0});
 const first=await call(admin.token,base);
 assert.equal(first.status,200);
 const committed=await first.json();
 assert.equal(committed.reused,false);
 const reordered=Object.fromEntries(Object.entries(base).reverse());
 assert.equal((await (await call(admin.token,reordered)).json()).reused,true);
 assert.equal((await call(otherAdmin.token,base)).status,409);
 assert.equal((await call(admin.token,{...base,name:'変更'})).status,409);
 assert.equal((await call(admin.token,{...base,operationId:randomUUID()})).status,409);
 assert.equal((await call(admin.token,{...base,operationId:randomUUID(),expectedRevision:1,id:'missing'})).status,422);
 const observer=env.authenticatedContext('second-client',{companyId:'api-isolated',role:'admin'}).firestore();
 const saved=await sdk.getDoc(sdk.doc(observer,'companies/api-isolated/'+committed.targets[0]));
 assert.equal(saved.data().createdBy,admin.uid);
 assert.equal(saved.data().payload.name,'架空顧客');
 const audit=await sdk.getDoc(sdk.doc(observer,'companies/api-isolated/auditLogs/'+saved.data().lastAuditId));
 assert.equal(audit.data().after.name,'架空顧客');
 await auth.updateUser(admin.uid,{disabled:true});
 assert.equal((await call(admin.token)).status,401);
});
