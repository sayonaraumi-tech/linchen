const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../src/core/business'),N=require('../src/compat/outstanding-adapter');
const run=(s,id,c)=>B.perform(s,{...c,operationId:id}).state;
test('read-only notice after partial bank payment reuses original invoice and amount',()=>{
 let s=B.emptyState();
 s=run(s,'invoice',{type:'issueDocument',docType:'invoice',sourceKey:'original',amount:11000,
  snapshot:{customerName:'管理会社',invoiceDate:'2026-09-30',items:[{content:'クロス張替',qty:1,price:10000}]}});
 const doc=B.list(s,'documents')[0],sale=B.list(s,'sales')[0];
 s=run(s,'pay',{type:'registerPayment',saleId:sale.id,paymentDate:'2026-10-05',method:'銀行振込',amount:4000});
 const pay=B.list(s,'payments')[0];
 assert.equal(B.balance(s,sale.id),11000);
 s=run(s,'bank',{type:'importBankTransaction',account:'GMO',externalId:'orig-pay',date:'2026-10-05',description:'管理会社',amount:4000,direction:'income'});
 s=run(s,'match',{type:'matchBankPayment',bankTxnId:B.list(s,'bankTransactions')[0].id,paymentId:pay.id});
 const before=JSON.stringify(s);
 const n=N.previewOutstanding(s,doc.id,'2026-11-13');
 assert.equal(n.invoiceAmount,11000);assert.equal(n.paidAmount,4000);assert.equal(n.outstandingAmount,7000);
 assert.match(n.note,/新規工事分ではなく/);assert.equal(n.originalInvoiceNo,doc.invoiceNo);
 assert.equal(n.readonly,true);assert.equal(JSON.stringify(s),before);
 assert.equal(B.list(s,'documents').length,1);assert.equal(B.list(s,'sales').length,1);
});
test('notice cannot issue for fully paid, revised or cancelled historical invoices',()=>{
 let s=B.emptyState();
 s=run(s,'invoice',{type:'issueDocument',docType:'invoice',sourceKey:'orig2',amount:5000,
  snapshot:{customerName:'管理会社',invoiceDate:'2026-09-30',items:[]}});
 const doc=B.list(s,'documents')[0],sale=B.list(s,'sales')[0];
 s=run(s,'paid',{type:'registerPayment',saleId:sale.id,amount:5000,method:'現金',paymentDate:'2026-10-05'});
 assert.throws(()=>N.previewOutstanding(s,doc.id,'2026-11-13'),/未入金/);
 s=run(s,'revision',{type:'reviseDocument',documentId:doc.id,reason:'宛名訂正',
  amount:5000,newSnapshot:{...doc.snapshot,customerName:'訂正版',invoiceDate:'2026-09-30'}});
 assert.throws(()=>N.previewOutstanding(s,doc.id,'2026-11-13'),/有効な請求書/);
});
test('unconfirmed bank payment does not reduce outstanding amount in notice',()=>{
 let s=B.emptyState();
 s=run(s,'invoice',{type:'issueDocument',docType:'invoice',sourceKey:'orig3',amount:8000,
  snapshot:{customerName:'未入金顧客',invoiceDate:'2026-09-30',items:[]}});
 const doc=B.list(s,'documents')[0],sale=B.list(s,'sales')[0];
 s=run(s,'pending',{type:'registerPayment',saleId:sale.id,amount:8000,method:'銀行振込',paymentDate:'2026-10-10'});
 const n=N.previewOutstanding(s,doc.id,'2026-11-13');
 assert.equal(n.outstandingAmount,8000);assert.equal(n.paidAmount,0);
});
