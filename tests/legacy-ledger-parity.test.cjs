const {test}=require('node:test'),assert=require('node:assert/strict');
const {parity}=require('../scripts/legacy-ledger-parity.cjs');
const {LEGACY_COLLECTIONS}=require('../src/compat/legacy-contract');
const baseline=()=>Object.fromEntries(LEGACY_COLLECTIONS.map(x=>[x,[]]));
test('old accounting aggregate and new read-only bridge agree across a fiscal close',()=>{
 const d=baseline();
 d.sales=[{id:'sale_1',amount:11000,salesDate:'2026-09-20',customer:'合成顧客'}];
 d.receivables=[{id:'receivable_1',amount:5000,salesDate:'2026-04-10',receivableOnly:true}];
 d.payments=[
  {id:'pay_1',saleId:'sale_1',amount:4000,paymentDate:'2026-09-30',confirmation:'bank-confirmed'},
  {id:'pay_2',saleId:'sale_1',amount:2000,paymentDate:'2026-10-01',confirmation:'bank-confirmed'},
  {id:'pay_3',saleId:'receivable_1',amount:1000,paymentDate:'2026-09-15',confirmation:'cash-received'}
 ];
 const before=JSON.stringify(d),p=parity(d,{asOf:'2026-09-30'});
 assert.equal(p.pass,true);assert.equal(p.discrepancies.length,0);
 assert.equal(p.oldTotals.grossSales,11000);assert.equal(p.oldTotals.outstanding,11000);
 assert.equal(p.migrationAuthorized,false);
 assert.equal(JSON.stringify(d),before);
});
test('missing original receivable anchor blocks parity rather than guessing income',()=>{
 const d=baseline();d.payments=[{id:'pay_9',saleId:'receivable_missing',amount:1000,confirmation:'bank-confirmed'}];
 assert.throws(()=>parity(d),/blocked/);
});
