const {test}=require('node:test'),assert=require('node:assert/strict');
const {createShadow}=require('../src/compat/legacy-shadow');
const {LEGACY_COLLECTIONS}=require('../src/compat/legacy-contract');
const dump=()=>Object.fromEntries(LEGACY_COLLECTIONS.map(name=>[name,[]]));
test('legacy 15 collection shadow keeps receivable_ payment anchor without duplicating sales',()=>{
 const d=dump();
 d.receivables=[{id:'receivable_20260930_001',amount:11000,customer:'旧取引先',status:'active'}];
 d.payments=[{id:'pay_1',saleId:'receivable_20260930_001',amount:4000,confirmation:'bank-confirmed'},
             {id:'pay_2',saleId:'receivable_20260930_001',amount:2000,confirmation:'pending-bank'}];
 const before=JSON.stringify(d),s=createShadow(d,{requireFullExport:true});
 const row=s.receivableRows()[0];
 assert.equal(row.sourceCollection,'receivables');
 assert.equal(row.confirmedPaid,4000);assert.equal(row.pending,2000);assert.equal(row.outstanding,7000);
 assert.equal(s.reconcile().totals.amount,11000);
 assert.equal(s.reconcile().totals.collected,4000);
 assert.equal(JSON.stringify(d),before);
 assert.equal(d.sales.length,0);
});
test('legacy Google links preserve old event ID and sale/document references',()=>{
 const d=dump();
 d.calendarLinks=[{id:'cal-old',googleEventId:'g123',calendarId:'client-cal',date:'2026-09-30',title:'施工',
   linkedInvoiceId:'old-invoice',linkedEstimateId:'old-est',googlePatchPending:true}];
 d.documents=[{id:'old-invoice',confirmed:true,invoiceNo:'old-001',snapshot:{invoiceNo:'old-001',items:[]}}];
 d.estimates=[{id:'old-est',historyId:'old-invoice'}];
 assert.throws(()=>createShadow(d,{requireFullExport:true}),/Legacy data audit blocked/); // old estimate lifecycle still blocks promotion
});
test('partial shadow can inspect old invoice without changing its snapshot',()=>{
 const d={documents:[{id:'d1',invoiceNo:'legacy-number',confirmed:true,snapshot:{invoiceNo:'legacy-number',items:[{content:'旧補修'}]}}]};
 const s=createShadow(d);
 assert.equal(s.oldDocument('d1').snapshot.items[0].content,'旧補修');
 const changed=s.oldDocument('d1');changed.snapshot.items[0].content='NOT WRITTEN';
 assert.equal(d.documents[0].snapshot.items[0].content,'旧補修');
});
test('full export required before promotion checks and partial missing references are never fabricated',()=>{
 assert.throws(()=>createShadow({documents:[]},{requireFullExport:true}),/incomplete/);
 const d=dump();
 d.payments=[{id:'p1',saleId:'missing',amount:500,confirmation:'bank-confirmed'}];
 assert.throws(()=>createShadow(d,{requireFullExport:true}),/Legacy data audit blocked/);
});
test('overpaid original receivable blocks silent ledger projection',()=>{
 const d=dump();
 d.sales=[{id:'sale_1',amount:1000,status:'active'}];
 d.payments=[{id:'pay_1',saleId:'sale_1',amount:2000,confirmation:'cash-received'}];
 const s=createShadow(d,{requireFullExport:true});
 assert.throws(()=>s.receivableRows(),/overpaid/);
});
