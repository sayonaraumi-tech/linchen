const {test}=require('node:test'),assert=require('node:assert/strict'),B=require('../src/core/business');
const run=(s,id,c)=>B.perform(s,{...c,operationId:id}).state;
test('bank interest/refund classification is separate income and never a construction sale',()=>{
 let s=B.emptyState();
 s=run(s,'bank1',{type:'importBankTransaction',account:'GMO',externalId:'i1',date:'2026-11-13',description:'普通預金利息',amount:2679,direction:'income'});
 const id=B.list(s,'bankTransactions')[0].id;
 const before=JSON.stringify(s);
 assert.throws(()=>run(s,'unapproved',{type:'reviewBankIncome',bankTxnId:id,interest:true,reason:'利息',reviewed:false}),/明示確認/);
 assert.equal(JSON.stringify(s),before);
 s=run(s,'review',{type:'reviewBankIncome',bankTxnId:id,interest:true,reason:'受取利息で確認',reviewed:true});
 assert.equal(B.getOverview(s).sales,0);
 assert.equal(B.getOverview(s).confirmedPayments,0);
 assert.equal(B.getOverview(s).otherIncome,2679);
 assert.equal(B.list(s,'bankTransactions')[0].category,'受取利息');
 s=run(s,'undo',{type:'unmatchBank',bankTxnId:id});
 assert.equal(B.getOverview(s).otherIncome,0);
 assert.equal(B.list(s,'bankTransactions')[0].category,undefined);
});
test('bank cashback explicitly classified as miscellaneous income without second bank entry',()=>{
 let s=B.emptyState();
 s=run(s,'bank2',{type:'importBankTransaction',account:'GMO',externalId:'cardback',date:'2026-11-13',description:'Visa Cashback',amount:500,direction:'income'});
 const id=B.list(s,'bankTransactions')[0].id;
 s=run(s,'misc',{type:'reviewBankIncome',bankTxnId:id,interest:false,reason:'Visa返金確認',reviewed:true});
 assert.equal(B.getOverview(s).otherIncome,500);
 assert.equal(B.list(s,'bankTransactions').length,1);
 assert.equal(B.list(s,'payments').length,0);
 assert.throws(()=>run(s,'second',{type:'reviewBankIncome',bankTxnId:id,interest:false,reason:'重複',reviewed:true}),/未照合/);
});
test('void monthly supplier invoice reverses expense and advance deduction with no negative cash',()=>{
 let s=B.emptyState();
 s=run(s,'supplier',{type:'saveSupplier',name:'材料会社',openingBalance:100000});
 const id=B.list(s,'suppliers')[0].id;
 s=run(s,'invoice',{type:'settleSupplierInvoice',supplierId:id,invoiceMonth:'2026-10',invoiceNo:'2026-10-11',date:'2026-10-31',amount:80000,deductionAmount:60000,reviewed:true,description:'壁紙'});
 const tx=B.list(s,'supplierTransactions')[0];
 assert.equal(B.getOverview(s).expenses,80000);
 assert.equal(B.supplierBalance(s,id),40000);
 s=run(s,'void',{type:'voidSupplierTransaction',transactionId:tx.id,reason:'原請求書の取消'});
 assert.equal(B.getOverview(s).expenses,0);
 assert.equal(B.supplierBalance(s,id),100000);
 assert.equal(B.list(s,'cashLedger').length,0);
 assert.throws(()=>run(s,'again',{type:'settleSupplierInvoice',supplierId:id,invoiceMonth:'2026-10',invoiceNo:'2026-10-11',date:'2026-10-31',amount:80000,deductionAmount:60000,reviewed:true,description:'壁紙'}),/専用訂正/);
});
test('linked supplier cash or bank transaction cannot be cancelled before evidence is resolved',()=>{
 let s=B.emptyState();
 s=run(s,'supplier',{type:'saveSupplier',name:'材料会社',openingBalance:0});
 const supplier=B.list(s,'suppliers')[0];
 s=run(s,'cash',{type:'recordSupplierTransaction',supplierId:supplier.id,transactionType:'prepayment',date:'2026-11-13',amount:5000,paymentMethod:'現金'});
 const tx=B.list(s,'supplierTransactions')[0],ledger=B.list(s,'cashLedger')[0];
 assert.equal(ledger.amount,5000);
 s=run(s,'cancel',{type:'voidSupplierTransaction',transactionId:tx.id,reason:'二重前払'});
 assert.equal(B.supplierBalance(s,supplier.id),0);
 assert.equal(B.getOverview(s).cashOut,0);
 assert.equal(B.list(s,'cashLedger').length,1);
});

test('already deducted supplier advance cannot be cancelled while the monthly invoice remains active',()=>{
 let s=B.emptyState();
 s=run(s,'supplier',{type:'saveSupplier',name:'東鵬テスト',openingBalance:0});
 const supplier=B.list(s,'suppliers')[0];
 s=run(s,'prepay',{type:'recordSupplierTransaction',supplierId:supplier.id,transactionType:'prepayment',amount:1000000,date:'2026-10-01',paymentMethod:'銀行振込'});
 const tx=B.list(s,'supplierTransactions').find(x=>x.type==='prepayment');
 s=run(s,'invoice',{type:'settleSupplierInvoice',supplierId:supplier.id,invoiceMonth:'2026-10',invoiceNo:'D202610',
  amount:500000,deductionAmount:500000,date:'2026-10-31',description:'月次材料',reviewed:true});
 const before=JSON.stringify(s);
 assert.throws(()=>run(s,'void-prepay',{type:'voidSupplierTransaction',transactionId:tx.id,reason:'取り消し'}),/残高がマイナス/);
 assert.equal(JSON.stringify(s),before);
 const invoice=B.list(s,'supplierTransactions').find(x=>x.type==='monthlyInvoice');
 s=run(s,'void-invoice',{type:'voidSupplierTransaction',transactionId:invoice.id,reason:'請求取消'});
 s=run(s,'void-prepay-again',{type:'voidSupplierTransaction',transactionId:tx.id,reason:'前渡訂正'});
 assert.equal(B.supplierBalance(s,supplier.id),0);
 assert.equal(B.getOverview(s).expenses,0);
});
