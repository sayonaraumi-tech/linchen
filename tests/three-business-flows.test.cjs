const {test}=require('node:test'),assert=require('node:assert/strict'),B=require('../src/core/business');
const run=(state,operationId,cmd)=>B.perform(state,{...cmd,operationId}).state;
function prepared(){
 let s=B.emptyState();
 s=run(s,'estimate',{type:'issueDocument',docType:'estimate',sourceKey:'orig-quote',amount:11000,
 snapshot:{customerName:'管理会社A',invoiceDate:'2026-11-13',items:[{content:'クロス張替',qty:1,price:10000}],remarks:'工事のご案内'}});
 return s;
}
test('estimate -> invoice -> confirmed bank receipt preserves original immutable snapshot and only one sale',()=>{
 let s=prepared();const estimate=B.list(s,'documents')[0],frozen=JSON.stringify(estimate.snapshot);
 assert.equal(B.list(s,'sales').length,0);
 s=run(s,'convert1',{type:'convertEstimateToInvoice',estimateId:estimate.id,invoiceDate:'2026-11-14',issuedAt:'2026-11-14T01:00:00Z'});
 const invoice=B.list(s,'documents').find(d=>d.docType==='invoice');
 assert(invoice);assert.notEqual(invoice.invoiceNo,estimate.invoiceNo);
 assert.equal(invoice.estimateId,estimate.id);assert.equal(invoice.snapshot.items[0].content,'クロス張替');
 assert.equal(B.list(s,'sales').length,1);
 assert.equal(JSON.stringify(B.list(s,'documents').find(d=>d.id===estimate.id).snapshot),frozen);
 s=run(s,'convert2',{type:'convertEstimateToInvoice',estimateId:estimate.id,invoiceDate:'2026-11-14'});
 assert.equal(B.list(s,'documents').length,2);assert.equal(B.list(s,'sales').length,1);
 s=run(s,'payment',{type:'registerPayment',saleId:invoice.saleId,amount:11000,method:'銀行振込',paymentDate:'2026-11-17'});
 const pay=B.list(s,'payments')[0];
 const before=JSON.stringify(s);
 assert.throws(()=>run(s,'early-receipt',{type:'issueReceiptForPayment',paymentId:pay.id}),/未照合/);
 assert.equal(JSON.stringify(s),before);
 s=run(s,'bank',{type:'importBankTransaction',account:'GMO',externalId:'tx-verify',date:'2026-11-17',direction:'income',description:'テスト',amount:11000});
 const bank=B.list(s,'bankTransactions')[0];
 s=run(s,'match',{type:'matchBankPayment',bankTxnId:bank.id,paymentId:pay.id});
 assert.equal(B.getOverview(s).outstanding,0);
 s=run(s,'receipt1',{type:'issueReceiptForPayment',paymentId:pay.id,issuedAt:'2026-11-17T03:00:00Z'});
 s=run(s,'receipt2',{type:'issueReceiptForPayment',paymentId:pay.id,issuedAt:'2026-11-18T03:00:00Z'});
 assert.equal(B.list(s,'documents').length,3);
 assert.equal(B.list(s,'sales').length,1);
 assert.equal(B.list(s,'payments').length,1);
 assert.equal(B.list(s,'cashLedger').length,0);
 assert.equal(B.list(s,'documents').find(d=>d.docType==='receipt').linkedInvoiceId,invoice.id);
 assert.equal(B.getOverview(s).sales,11000);
 assert.equal(B.getOverview(s).confirmedPayments,11000);
});
test('cash receipt from a paid invoice reuses original cash payment and cash ledger exactly once',()=>{
 let s=prepared(),est=B.list(s,'documents')[0];
 s=run(s,'invoice',{type:'convertEstimateToInvoice',estimateId:est.id});
 const sale=B.list(s,'sales')[0];
 s=run(s,'cash',{type:'registerPayment',saleId:sale.id,amount:11000,method:'現金',paymentDate:'2026-11-15'});
 const pay=B.list(s,'payments')[0];
 s=run(s,'receipt',{type:'issueReceiptForPayment',paymentId:pay.id});
 s=run(s,'repeat',{type:'issueReceiptForPayment',paymentId:pay.id});
 assert.equal(B.list(s,'cashLedger').length,1);
 assert.equal(B.list(s,'documents').filter(d=>d.docType==='receipt').length,1);
 assert.equal(B.getOverview(s).outstanding,0);
});
test('editing cash expense updates linked cash only; cancel expense reverses cash and never updates bank',()=>{
 let s=B.emptyState();
 s=run(s,'expense',{type:'saveExpense',expenseDate:'2026-11-13',vendor:'店A',category:'材料費',amount:5000,paymentMethod:'現金'});
 const e=B.list(s,'expenses')[0];assert.equal(B.getOverview(s).cashOut,5000);
 s=run(s,'edit',{type:'saveExpense',id:e.id,expenseDate:'2026-11-14',vendor:'店A',category:'材料費',amount:3000,paymentMethod:'現金'});
 assert.equal(B.getOverview(s).cashOut,3000);
 s=run(s,'void',{type:'voidRecord',collection:'expenses',id:e.id,reason:'二重入力'});
 assert.equal(B.getOverview(s).cashOut,0);
 assert.equal(B.getOverview(s).expenses,0);
 assert.throws(()=>run(s,'resurrect',{type:'saveExpense',id:e.id,expenseDate:'2026-11-14',vendor:'店A',category:'材料費',amount:1000,paymentMethod:'現金'}),/復活/);
});
test('cannot cancel a confirmed-payment receipt from generic payment void',()=>{
 let s=B.emptyState();
 s=run(s,'receipt',{type:'issueDocument',docType:'receipt',sourceKey:'cash-x',snapshot:{customerName:'A',invoiceDate:'2026-11-13',receiptTotal:5000,paymentMethod:'現金'}});
 const pay=B.list(s,'payments')[0];
 assert.throws(()=>run(s,'void-pay',{type:'voidRecord',collection:'payments',id:pay.id,reason:'誤り'}),/領収書/);
 assert.equal(B.getOverview(s).cashIn,5000);
});
