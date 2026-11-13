const {test}=require('node:test'),assert=require('node:assert/strict');
const {createCommandService}=require('../src/services/command-service');
function fakeRepo(){
 const collections=new Map(),markers=new Map();let locked=false;
 const cp=x=>JSON.parse(JSON.stringify(x));
 return {
  data:collections,markers,
  async read(name,id){return cp(collections.get(name+'/'+id)||null)},
  async list(name){return [...collections].filter(([k])=>k.startsWith(name+'/')).map(([key,record])=>({id:key.split('/').at(-1),...cp(record)}));},
  async readOperation(id){return cp(markers.get(id)||null)},
  async apply({operationId,action,changes}){
   if(markers.has(operationId))return {reused:true,targets:markers.get(operationId).targets};
   for(const c of changes){
    const old=collections.get(c.collection+'/'+c.id);
    assert.equal(old?.revision||0,c.expectedRevision,'revision conflict: '+c.collection+'/'+c.id);
   }
   const targets=changes.map(c=>c.collection+'/'+c.id);
   for(const c of changes)collections.set(c.collection+'/'+c.id,{revision:c.expectedRevision+1,payload:cp(c.payload)});
   markers.set(operationId,{action,targets});
   return {operationId,reused:false,targets};
  }
 };
}
const cmd=(operationId,type,args={})=>({operationId,type,...args});
test('invoice with sale and metadata is one atomic multi-record operation',async()=>{
 const repo=fakeRepo(),service=createCommandService({repository:repo});
 const invoice=cmd('invoice-1','issueDocument',{docType:'invoice',sourceKey:'i1',issuedAt:'2026-11-13T04:15:00Z',amount:11000,snapshot:{customerName:'A',invoiceDate:'2026-11-13',items:[]}});
 const a=await service.execute(invoice);
 assert.equal(a.changes,3);assert.equal(a.reused,false);
 assert.equal([...repo.data].filter(([k])=>k.startsWith('sales/')).length,1);
 assert.equal([...repo.data].filter(([k])=>k.startsWith('documents/')).length,1);
 assert.equal((await service.execute(invoice)).reused,true);
 assert.equal([...repo.data].filter(([k])=>k.startsWith('sales/')).length,1);
});
test('cash receipt one atomic operation creates sale/payment/cash/document/meta, never twice',async()=>{
 const repo=fakeRepo(),svc=createCommandService({repository:repo});
 const receipt=cmd('receipt1','issueDocument',{docType:'receipt',sourceKey:'r1',issuedAt:'2026-11-13T04:15:00Z',snapshot:{customerName:'A',invoiceDate:'2026-11-13',receiptTotal:11000,paymentMethod:'現金'}});
 const r=await svc.execute(receipt);assert.equal(r.changes,5);
 for(const c of ['sales','payments','cashLedger','documents'])assert.equal([...repo.data.keys()].filter(x=>x.startsWith(c+'/')).length,1,c);
 assert.equal((await svc.execute(receipt)).reused,true);
 assert.equal([...repo.data].filter(([k])=>k.startsWith('cashLedger/')).length,1);
});
test('confirmed cash receipt changes no bank-ledger evidence',async()=>{
 const repo=fakeRepo(),svc=createCommandService({repository:repo});
 await svc.execute(cmd('r1','issueDocument',{docType:'receipt',sourceKey:'r1',snapshot:{customerName:'A',invoiceDate:'2026-11-13',receiptTotal:1000,paymentMethod:'現金'}}));
 assert.equal([...repo.data].filter(([k])=>k.startsWith('bankTransactions/')).length,0);
});
test('bank match includes changed bank and payment rows in same transaction',async()=>{
 const repo=fakeRepo(),svc=createCommandService({repository:repo});
 await svc.execute(cmd('i','issueDocument',{docType:'invoice',sourceKey:'i1',amount:1100,snapshot:{customerName:'A',invoiceDate:'2026-11-13'}}));
 const sale=[...repo.data].find(([k])=>k.startsWith('sales/'))[0].split('/')[1];
 await svc.execute(cmd('p','registerPayment',{saleId:sale,method:'銀行振込',amount:1100,paymentDate:'2026-11-13'}));
 await svc.execute(cmd('b','importBankTransaction',{account:'GMO',externalId:'e1',date:'2026-11-13',direction:'income',amount:1100}));
 const payment=[...repo.data].find(([k])=>k.startsWith('payments/'))[0].split('/')[1];
 const bank=[...repo.data].find(([k])=>k.startsWith('bankTransactions/'))[0].split('/')[1];
 const r=await svc.execute(cmd('match','matchBankPayment',{bankTxnId:bank,paymentId:payment}));
 assert.equal(r.changes,3);
 assert.equal(repo.data.get('bankTransactions/'+bank).payload.status,'matched');
 assert.equal(repo.data.get('payments/'+payment).payload.confirmation,'bank-confirmed');
});
test('operation fails entirely on stale meta revision after another write',async()=>{
 const repo=fakeRepo(),svc=createCommandService({repository:repo});
 await svc.execute(cmd('project','saveProject',{customer:'A'}));
 const original=repo.data.get('settings/_domain_metadata');
 const previous=repo.apply;
 repo.apply=async args=>{repo.data.set('settings/_domain_metadata',{revision:original.revision+1,payload:{seq:999,schemaVersion:1}});return previous(args)};
 await assert.rejects(svc.execute(cmd('other','saveProject',{customer:'B'})),/revision conflict/);
 assert.equal([...repo.data].filter(([k])=>k.startsWith('projects/')).length,1);
});
test('test deletion does not delete Firestore records',async()=>{
 const svc=createCommandService({repository:fakeRepo()});
 await assert.rejects(svc.execute(cmd('delete','deleteTestRecord',{collection:'projects',id:'x',confirmTestDeletion:true})),/テスト/);
});
