const {test}=require('node:test'),assert=require('node:assert/strict'),B=require('../src/core/business');
const execute=(state,id,command)=>B.perform(state,{...command,operationId:id}).state;
const start=()=>{let s=B.emptyState();s=execute(s,'supplier',{type:'saveSupplier',name:'東鵬',openingBalance:0});const supplier=B.list(s,'suppliers')[0];s=execute(s,'prepay',{type:'recordSupplierTransaction',transactionType:'prepayment',supplierId:supplier.id,date:'2026-10-01',amount:1000000,paymentMethod:'銀行振込'});return {s,supplier};};
const invoice=supplierId=>({type:'settleSupplierInvoice',supplierId,invoiceMonth:'2026-10',invoiceNo:'M202610',date:'2026-10-31',amount:100000,reviewed:true,deductionAmount:80000,description:'壁紙材料'});
test('reviewed monthly supplier invoice expenses full amount only once, deducts only explicit advance',()=>{
 let {s,supplier}=start();const amount=B.supplierBalance(s,supplier.id);assert.equal(amount,1000000);
 s=execute(s,'inv',{...invoice(supplier.id)});
 assert.equal(B.supplierBalance(s,supplier.id),920000);
 assert.equal(B.list(s,'expenses').length,1);assert.equal(B.list(s,'expenses')[0].amount,100000);
 assert.equal(B.list(s,'supplierTransactions').find(x=>x.type==='monthlyInvoice').deductionAmount,80000);
 assert.equal(B.getOverview(s).expenses,100000);
 assert.equal(B.list(s,'cashLedger').length,0);
 s=execute(s,'repeated',{...invoice(supplier.id)});
 assert.equal(B.list(s,'supplierTransactions').length,2);assert.equal(B.list(s,'expenses').length,1);
 assert.equal(B.supplierBalance(s,supplier.id),920000);
});
test('missing review, overdeduction and duplicate invoice number all fail atomically',()=>{
 let {s,supplier}=start();const before=JSON.stringify(s);
 assert.throws(()=>execute(s,'bad1',{...invoice(supplier.id),reviewed:false}),/確認/);
 assert.throws(()=>execute(s,'bad2',{...invoice(supplier.id),deductionAmount:100001}),/確認/);
 assert.throws(()=>execute(s,'bad3',{...invoice(supplier.id),deductionAmount:999999}),/確認/);
 assert.equal(JSON.stringify(s),before);
 s=execute(s,'first',{...invoice(supplier.id)});
 assert.throws(()=>execute(s,'conflict',{...invoice(supplier.id),amount:110000}),/訂正/);
 const next={...invoice(supplier.id),invoiceMonth:'2026-11',date:'2026-11-30',amount:50000,deductionAmount:50000};
 assert.throws(()=>execute(s,'same-no',next),/同じ請求番号/);
 assert.equal(B.list(s,'expenses').length,1);
});
test('monthly invoice can leave payable without reducing prepaid amount; old simple invoices stay backwards-compatible',()=>{
 let {s,supplier}=start();
 const cmd={...invoice(supplier.id),deductionAmount:0};
 s=execute(s,'no-deduct',cmd);
 assert.equal(B.supplierBalance(s,supplier.id),1000000);
 assert.equal(B.list(s,'expenses')[0].amount,100000);
 assert.equal(B.list(s,'supplierTransactions').find(x=>x.type==='monthlyInvoice').deductionAmount,0);
 let other=B.emptyState();other=execute(other,'new',{type:'saveSupplier',name:'材料会社',openingBalance:25000});
 const id=B.list(other,'suppliers')[0].id;
 other=execute(other,'simple',{type:'recordSupplierTransaction',supplierId:id,transactionType:'monthlyInvoice',
   amount:10000,invoiceMonth:'2026-10',date:'2026-10-31'});
 assert.equal(B.supplierBalance(other,id),15000);
});
