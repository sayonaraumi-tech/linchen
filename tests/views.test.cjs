const assert=require('node:assert/strict'),{test}=require('node:test');
const B=require('../src/core/business'),V=require('../src/core/views');
const run=(s,id,cmd)=>B.perform(s,{operationId:id,...cmd}).state;
test('monthly HOME financial projection keeps sales and receipts separate',()=>{
 let s=B.emptyState();
 s=run(s,'i',{type:'issueDocument',docType:'invoice',sourceKey:'i',amount:11000,snapshot:{customerName:'A',invoiceDate:'2026-10-01'}});
 const sale=B.list(s,'sales')[0].id;
 s=run(s,'p',{type:'registerPayment',saleId:sale,amount:6000,method:'現金',paymentDate:'2026-11-03'});
 s=run(s,'e',{type:'saveExpense',vendor:'建材店',category:'材料費',paymentMethod:'現金',amount:3000,expenseDate:'2026-11-03'});
 const oct=V.dashboard(s,{month:'2026-10'}),nov=V.dashboard(s,{month:'2026-11'});
 assert.equal(oct.sales,11000);assert.equal(oct.receipts,0);
 assert.equal(nov.sales,0);assert.equal(nov.receipts,6000);assert.equal(nov.expenses,3000);
 assert.equal(nov.cashIncome,6000);assert.equal(nov.cashExpense,3000);
 const ar=V.salesRegister(s,{month:'2026-10'});assert.equal(ar[0].outstanding,5000);
 assert.equal(ar[0].status,'一部入金');
});
test('fiscal period starts in October and ends in September',()=>{
 assert.deepEqual(V.period({fiscalYear:2026}),{from:'2026-10-01',to:'2027-09-30'});
 assert.throws(()=>V.period({month:'2026-13'}));
});
test('documents history includes archived voided references',()=>{
 let s=B.emptyState();s=run(s,'doc',{type:'issueDocument',docType:'estimate',sourceKey:'e1',amount:5000,snapshot:{customerName:'A',invoiceDate:'2026-11-13'}});
 assert.equal(V.documentsHistory(s,'estimate').length,1);
 const id=B.list(s,'documents')[0].id;
 s=run(s,'void',{type:'voidRecord',collection:'documents',id,reason:'取り消し'});
 assert.equal(V.documentsHistory(s,'estimate').length,1);
 assert.equal(V.documentsHistory(s,'estimate')[0].status,'void');
});
test('CSV formula injection and multiline fields are escaped',()=>{
 const csv=V.exportCSV(['A','B'],[['=1+1','Hello,"world"\nline']]);
 assert(csv.startsWith('\uFEFF'));assert(csv.includes('"\'=1+1"'));assert(csv.includes('"Hello,""world""\nline"'));
});
