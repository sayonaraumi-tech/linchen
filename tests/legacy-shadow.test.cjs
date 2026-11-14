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
 const shadow=createShadow(d,{requireFullExport:true});
 const link=shadow.calendarRows()[0];
 assert.equal(link.googleEventId,'g123');
 assert.equal(link.googleCalendarId,'client-cal');
 assert.deepEqual(link.documentIds,['old-invoice']);
 assert.equal(link.estimateId,'old-est');
 assert.equal(shadow.estimatesRows()[0].originalId,'old-est');
 assert.equal(shadow.reconcile().canPromote,false);
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

test('legacy shadow unpaid balances match original frozen accounting.js receivables including dates and carried debt',()=>{
 const old=require('../legacy-pdf/source/js/accounting.js');
 const d=dump();
 d.sales=[{id:'sale_1',customer:'A',salesDate:'2026-09-10',amount:11000,status:'active'},
          {id:'sale_2',customer:'B',salesDate:'2026-10-10',amount:8000,status:'active'}];
 d.receivables=[{id:'receivable_1',customer:'旧期繰越',salesDate:'2026-08-10',amount:3000,receivableOnly:true,status:'active'}];
 d.payments=[{id:'pay_1',saleId:'sale_1',paymentDate:'2026-09-20',amount:4000,confirmation:'bank-confirmed'},
             {id:'pay_2',saleId:'sale_1',paymentDate:'2026-10-20',amount:1000,confirmation:'bank-confirmed'},
             {id:'pay_3',saleId:'receivable_1',paymentDate:'2026-09-28',amount:1000,confirmation:'cash-received'}];
 const shadow=createShadow(d,{requireFullExport:true});
 const asOf='2026-09-30';
 const received=shadow.receivableRows({asOf});
 const expected=old.receivables([...d.sales,...d.receivables],d.payments,asOf);
 assert.deepEqual(
  received.map(r=>({id:r.id,paid:r.confirmedPaid,unpaid:r.outstanding})).sort((a,b)=>a.id.localeCompare(b.id)),
  expected.map(r=>({id:r.id,paid:r.paid,unpaid:r.outstanding})).sort((a,b)=>a.id.localeCompare(b.id))
 );
 assert.equal(received.filter(r=>!r.receivableOnly).reduce((n,r)=>n+r.amount,0),11000);
 assert.equal(received.reduce((n,r)=>n+r.outstanding,0),9000);
});
test('old revised and duplicate business rows are excluded from balances like original accounting domain',()=>{
 const old=require('../legacy-pdf/source/js/accounting.js');
 const d=dump();
 d.sales=[{id:'sale_1',amount:1000,salesDate:'2026-09-01',documentStatus:'duplicate'},
          {id:'sale_2',amount:2000,salesDate:'2026-09-01',status:'revised'},
          {id:'sale_3',amount:3000,salesDate:'2026-09-01'}];
 const shadow=createShadow(d,{requireFullExport:true}),actual=shadow.receivableRows();
 const expected=old.receivables(d.sales,[], '9999-12-31');
 assert.deepEqual(actual.map(x=>x.id),expected.map(x=>x.id));
 assert.equal(actual.length,1);
});
