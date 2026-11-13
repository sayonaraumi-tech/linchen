const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const sdk=require('firebase/firestore'),{createRepository}=require('../src/storage/firestore-repository');
let env;
const projectId='demo-tsukinowa-construction';
before(async()=>{env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8086,rules:fs.readFileSync(path.join(__dirname,'../firestore.rules'),'utf8')}});});
after(async()=>{if(env)await env.cleanup();});
function context(uid,role,companyId='tsukinowa'){
 const ctx=env.authenticatedContext(uid,{role,companyId,linchenSandbox:true});
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

test('even a company admin cannot write without isolated sandbox claim',async()=>{
 const ctx=env.authenticatedContext('prod-admin-no-test-claim',{role:'admin',companyId:'tsukinowa'});
 const ref=sdk.doc(ctx.firestore(),'companies/tsukinowa/settings/no-test-change');
 await assertFails(sdk.setDoc(ref,{companyId:'tsukinowa',value:'forbidden'}));
 const other=env.authenticatedContext('prod-admin-false',{role:'admin',companyId:'tsukinowa',linchenSandbox:false});
 await assertFails(sdk.setDoc(sdk.doc(other.firestore(),'companies/tsukinowa/settings/false-claim'),{test:true}));
});
