const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../src/core/business');
const execute=(s,id,cmd)=>B.perform(s,{...cmd,operationId:id}).state;
function quote(){
 let state=B.emptyState();
 state=execute(state,'estimate-base',{type:'issueDocument',docType:'estimate',sourceKey:'quote-2026',
  amount:14300,snapshot:{customerName:'独立テスト顧客',invoiceDate:'2026-10-03',
   items:[{content:'クロス張替',qty:1,price:10000},{content:'穴補修',qty:1,price:3000}]}});
 return state;
}
test('estimate acceptance creates exactly one internal project and calendar event, no sale or payment',()=>{
 let s=quote(),original=B.list(s,'documents')[0],frozen=JSON.stringify(original.snapshot);
 s=execute(s,'accept1',{type:'acceptEstimate',estimateId:original.id,workDate:'2026-10-20'});
 assert.equal(B.list(s,'projects').length,1);assert.equal(B.list(s,'schedule').length,1);
 assert.equal(B.list(s,'sales').length,0);assert.equal(B.list(s,'payments').length,0);
 assert.equal(B.list(s,'schedule')[0].googleEventId,'');
 assert.equal(B.list(s,'schedule')[0].estimateId,original.id);
 assert.equal(JSON.stringify(B.list(s,'documents')[0].snapshot),frozen);
 const first=B.list(s,'schedule')[0].id;
 s=execute(s,'accept2',{type:'acceptEstimate',estimateId:original.id,workDate:'2026-10-20'});
 assert.equal(B.list(s,'schedule').length,1);assert.equal(B.list(s,'schedule')[0].id,first);
});
test('undated acceptance remains independent, later setting date generates a single event',()=>{
 let s=quote(),d=B.list(s,'documents')[0];
 s=execute(s,'accept-no-date',{type:'acceptEstimate',estimateId:d.id});
 assert.equal(B.list(s,'schedule').length,0);
 assert.equal(B.list(s,'documents')[0].status,'accepted-undated');
 s=execute(s,'date-later',{type:'acceptEstimate',estimateId:d.id,workDate:'2026-10-22'});
 assert.equal(B.list(s,'schedule').length,1);
 s=execute(s,'change-date',{type:'acceptEstimate',estimateId:d.id,workDate:'2026-10-24'});
 assert.equal(B.list(s,'schedule').length,1);assert.equal(B.list(s,'schedule')[0].date,'2026-10-24');
 assert.equal(B.list(s,'projects')[0].workDate,'2026-10-24');
});
test('invoice issued from accepted quote reuses accepted schedule and produces one sale',()=>{
 let s=quote(),d=B.list(s,'documents')[0];
 s=execute(s,'accept',{type:'acceptEstimate',estimateId:d.id,workDate:'2026-10-10'});
 const ev=B.list(s,'schedule')[0],estimated=JSON.stringify(d.snapshot);
 s=execute(s,'invoice',{type:'convertEstimateToInvoice',estimateId:d.id,invoiceDate:'2026-10-11'});
 assert.equal(B.list(s,'sales').length,1);
 assert.equal(B.list(s,'documents').filter(x=>x.docType==='invoice').length,1);
 const doc=B.list(s,'documents').find(x=>x.docType==='invoice');
 assert.equal(doc.scheduleId,ev.id);assert.equal(doc.estimateId,d.id);
 assert.equal(B.list(s,'schedule')[0].registeredSaleId,doc.saleId);
 assert.equal(JSON.stringify(B.list(s,'documents').find(x=>x.id===d.id).snapshot),estimated);
 s=execute(s,'repeat',{type:'convertEstimateToInvoice',estimateId:d.id,invoiceDate:'2026-10-11'});
 assert.equal(B.list(s,'sales').length,1);
 assert.equal(B.list(s,'schedule').length,1);
});
test('accepted sold schedule date cannot be changed by quote replay',()=>{
 let s=quote(),d=B.list(s,'documents')[0];
 s=execute(s,'accept',{type:'acceptEstimate',estimateId:d.id,workDate:'2026-10-10'});
 s=execute(s,'invoice',{type:'convertEstimateToInvoice',estimateId:d.id});
 const before=JSON.stringify(s);
 assert.throws(()=>B.perform(s,{operationId:'modify',type:'acceptEstimate',estimateId:d.id,workDate:'2026-10-21'}),/売上登録済み/);
 assert.equal(JSON.stringify(s),before);
});
