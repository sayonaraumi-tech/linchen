const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../src/core/business'),N=require('../src/core/document-numbering');
const snapshot={customerName:'A社',invoiceDate:'2026-11-13',items:[{content:'壁紙張替',qty:1,price:1000}]};
const issue=(id,type,issuedAt='2026-11-13T04:15:00Z')=>({type:'issueDocument',operationId:id,docType:type,sourceKey:id,amount:1100,issuedAt,snapshot});
test('all four document types share Tokyo minute sequence, never number a draft',()=>{
 let s=B.emptyState();
 assert.equal(B.list(s,'documents').length,0);
 const types=['estimate','invoice','receipt','onoda'];
 for(const [i,t] of types.entries()){
  const c=issue('doc'+i,t);
  if(t==='receipt')c.snapshot={...snapshot,receiptTotal:1100,paymentMethod:'現金'};
  s=B.perform(s,c).state;
 }
 const docs=B.list(s,'documents');
 assert.deepEqual(docs.map(x=>x.invoiceNo),['20261113-1315-01','20261113-1315-02','20261113-1315-03','20261113-1315-04']);
 assert(docs.every(x=>x.snapshot.invoiceNo===x.invoiceNo));
});
test('repeating formal save preserves issued document number',()=>{
 let s=B.emptyState(),cmd=issue('invoiceA','invoice');
 s=B.perform(s,cmd).state;
 const no=B.list(s,'documents')[0].invoiceNo;
 s=B.perform(s,{...cmd,operationId:'again'}).state;
 assert.equal(B.list(s,'documents')[0].invoiceNo,no);
 assert.equal(B.list(s,'documents').length,1);
});
test('revision keeps old invoice number and creates a fresh one',()=>{
 let s=B.emptyState();s=B.perform(s,issue('invoiceA','invoice')).state;
 const old=B.list(s,'documents')[0];
 s=B.perform(s,{type:'reviseDocument',operationId:'revision',documentId:old.id,reason:'住所の訂正',amount:1100,issuedAt:'2026-11-13T04:15:00Z',newSnapshot:{...old.snapshot,customerName:'B社'}}).state;
 const docs=B.list(s,'documents');
 assert.equal(docs[0].invoiceNo,'20261113-1315-01');
 assert.equal(docs[1].invoiceNo,'20261113-1315-02');
 assert.equal(docs[0].snapshot.invoiceNo,'20261113-1315-01');
});
test('manual injection of a formal number during new issue is blocked',()=>{
 let s=B.emptyState();const cmd=issue('invoiceA','invoice');cmd.snapshot={...snapshot,invoiceNo:'20261113-1315-99'};
 assert.throws(()=>B.perform(s,cmd),/システムが採番/);
});
test('Tokyo midnight date differs from UTC when expected',()=>{
 assert.equal(N.minuteKey('2026-11-12T15:01:00Z'),'20261113-0001');
});
