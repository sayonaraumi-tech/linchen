const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../src/core/business');
const exec=(s,id,c)=>B.perform(s,{operationId:id,...c}).state;
const invoice=(amount=11000)=>({type:'issueDocument',docType:'invoice',sourceKey:'invoiceA',amount,snapshot:{customerName:'原本顧客',invoiceDate:'2026-11-13',items:[{content:'施工',qty:1,price:amount}]}});
test('invoice correction reuses one sale and preserves the original snapshot',()=>{
 let s=B.emptyState();s=exec(s,'i',invoice());
 const d=B.list(s,'documents')[0],saleId=d.saleId;
 s=exec(s,'fix',{type:'reviseDocument',documentId:d.id,reason:'宛名変更',amount:12000,newSnapshot:{...d.snapshot,customerName:'訂正顧客'}});
 assert.equal(B.list(s,'sales').length,1);assert.equal(B.list(s,'sales')[0].id,saleId);
 assert.equal(B.list(s,'sales')[0].amount,12000);
 assert.equal(B.list(s,'documents').length,2);
 assert.equal(B.list(s,'documents').find(x=>x.id===d.id).snapshot.customerName,'原本顧客');
 assert.equal(B.list(s,'documents').find(x=>x.id===d.id).status,'revised');
 assert.equal(B.list(s,'documents').find(x=>x.id!==d.id).snapshot.customerName,'訂正顧客');
});
test('invoice correction cannot undercut already confirmed payment',()=>{
 let s=B.emptyState();s=exec(s,'i',invoice());
 const d=B.list(s,'documents')[0],saleId=d.saleId;
 s=exec(s,'pay',{type:'registerPayment',saleId,amount:8000,method:'現金',paymentDate:'2026-11-13'});
 assert.throws(()=>B.perform(s,{type:'reviseDocument',operationId:'bad',documentId:d.id,reason:'金額訂正',amount:7000,newSnapshot:d.snapshot}),/確認済入金/);
 assert.equal(B.list(s,'documents').length,1);assert.equal(B.list(s,'sales')[0].amount,11000);
});
test('second independent payment cannot exceed confirmed plus pending allocations',()=>{
 let s=B.emptyState();s=exec(s,'i',invoice());
 const saleId=B.list(s,'sales')[0].id;
 s=exec(s,'p1',{type:'registerPayment',saleId,amount:9000,method:'銀行振込',paymentDate:'2026-11-13'});
 assert.throws(()=>B.perform(s,{type:'registerPayment',operationId:'p2',saleId,amount:3000,method:'現金',paymentDate:'2026-11-13'}),/超える/);
 assert.equal(B.list(s,'payments').length,1);
});
test('issuing receipt for explicitly selected confirmed payment reuses it',()=>{
 let s=B.emptyState();s=exec(s,'i',invoice());
 const saleId=B.list(s,'sales')[0].id;
 s=exec(s,'pay',{type:'registerPayment',saleId,amount:11000,method:'現金',paymentDate:'2026-11-13'});
 const paymentId=B.list(s,'payments')[0].id;
 s=exec(s,'r',{type:'issueDocument',docType:'receipt',sourceKey:'receipt-A',saleId,paymentId,snapshot:{customerName:'原本顧客',invoiceDate:'2026-11-13',receiptTotal:11000,paymentMethod:'現金',tadashi:'施工費'}});
 assert.equal(B.list(s,'payments').length,1);assert.equal(B.list(s,'cashLedger').length,1);
 assert.equal(B.list(s,'sales').length,1);assert.equal(B.list(s,'documents').length,2);
});
test('receipt correction blocks editing cash amount or method',()=>{
 let s=B.emptyState();
 s=exec(s,'r',{type:'issueDocument',docType:'receipt',sourceKey:'receipt-A',snapshot:{customerName:'原顧客',invoiceDate:'2026-11-13',receiptTotal:1000,paymentMethod:'現金'}});
 const original=B.list(s,'documents')[0];
 assert.throws(()=>B.perform(s,{operationId:'edit',type:'reviseDocument',documentId:original.id,reason:'誤記',newSnapshot:{...original.snapshot,receiptTotal:900}}),/確定領収書/);
 assert.equal(B.list(s,'documents')[0].status,'active');
});
test('voiding uncollected invoice voids sale but not audit history',()=>{
 let s=B.emptyState();s=exec(s,'i',invoice());const id=B.list(s,'documents')[0].id;
 s=exec(s,'void',{type:'voidDocument',documentId:id,reason:'発行取消'});
 assert.equal(B.getOverview(s).sales,0);assert.equal(B.list(s,'documents')[0].status,'void');
 assert.equal(B.list(s,'auditLogs').length,2);
});
test('voiding invoice with pending payment requires settling payment first',()=>{
 let s=B.emptyState();s=exec(s,'i',invoice());
 const d=B.list(s,'documents')[0];
 s=exec(s,'p',{type:'registerPayment',saleId:d.saleId,amount:1000,method:'銀行振込',paymentDate:'2026-11-13'});
 assert.throws(()=>B.perform(s,{operationId:'void',type:'voidDocument',documentId:d.id,reason:'取消'}),/入金/);
});

test('reissued original reference after revision is forbidden; no second sale or document',()=>{
 let state=B.emptyState();
 state=exec(state,'issue1',invoice());
 const old=B.list(state,'documents')[0];
 state=exec(state,'revision1',{type:'reviseDocument',documentId:old.id,reason:'宛名訂正',amount:11000,newSnapshot:{...old.snapshot,customerName:'修正名'}});
 const before=JSON.stringify(state);
 assert.throws(()=>B.perform(state,{...invoice(),operationId:'issue2'}),/元参照は再発行できません/);
 assert.equal(JSON.stringify(state),before);
 assert.equal(B.list(state,'sales').length,1);
 assert.equal(B.list(state,'documents').length,2);
});
test('reissued cancelled original source never creates another numbered document',()=>{
 let state=B.emptyState();
 state=exec(state,'issue1',invoice());
 const old=B.list(state,'documents')[0];
 state=exec(state,'void1',{type:'voidDocument',documentId:old.id,reason:'発行取消'});
 assert.throws(()=>B.perform(state,{...invoice(),operationId:'again'}),/元参照は再発行できません/);
 assert.equal(B.list(state,'sales').length,1);
});
test('partial customer update does not silently erase saved address',()=>{
 let state=B.emptyState();
 state=exec(state,'first-customer',{type:'saveCustomer',name:'既存顧客',address:'東京都板橋区'});
 const id=B.list(state,'customers')[0].id;
 state=exec(state,'update-customer',{type:'saveCustomer',id,name:'名称訂正'});
 assert.equal(B.list(state,'customers')[0].address,'東京都板橋区');
});
