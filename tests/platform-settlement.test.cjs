const {test}=require('node:test'),assert=require('node:assert/strict');
const {reconcileMonth,monthlyReport}=require('../src/integrations/platform-settlement');
const stripe=()=>({provider:'stripe',period:'2026-09',account:'GMO',
 official:{documentId:'stripe-settlement-sep',gross:100000,refunds:2000,feeTotal:3500,adjustments:0,netPayout:94500},
 bankPayouts:[{id:'bank-oct-1',account:'GMO',direction:'income',amount:94500,date:'2026-10-02'}],
 expectedFee:3500});
const ato=()=>({provider:'ato',period:'2026-09',account:'GMO',
 official:{documentId:'ato-sep',gross:50000,refunds:0,feeTotal:2250,adjustments:-250,netPayout:47500},
 bankPayouts:[{id:'bank-oct-2',account:'GMO',direction:'income',amount:47500,date:'2026-10-03'}],
 expectedFee:2250});
const np=()=>({provider:'np',period:'2026-09',account:'GMO',
 official:{documentId:'np-invoice-sep',feeTotal:73582},
 bankDebits:[{id:'np-autodebit-oct',account:'GMO',direction:'outgoing',amount:73582,date:'2026-10-27'}],
 expectedFee:73582});
test('NP monthly official invoice vs bank automatic debit, not payout or sale',()=>{
 const x=reconcileMonth(np());
 assert.equal(x.mode,'monthly-auto-debit');assert.equal(x.status,'matched');
 assert.equal(x.bankDifference,0);assert.equal(x.feeDifference,0);
 assert.equal(x.accountingWrites,0);assert.equal(x.readOnly,true);
 assert.equal(x.officialNet,undefined);
});
test('NP bank withdrawal mismatch and internal fee gap are reported independently',()=>{
 const sample=np();sample.bankDebits[0].amount=67828;sample.expectedFee=70000;
 const x=reconcileMonth(sample);
 assert.equal(x.bankDifference,-5754);assert.equal(x.feeDifference,3582);
 assert.equal(x.status,'review');assert.equal(x.issues.length,2);
});
test('NP missing bank evidence is not treated as zero yen withdrawal',()=>{
 const sample=np();delete sample.bankDebits;
 const x=reconcileMonth(sample);
 assert.equal(x.bankDifference,null);assert.equal(x.actualBankAmount,null);
 assert.equal(x.status,'review');
});
for(const fn of [stripe,ato])test(fn().provider+' monthly payout compared to a single bank deposit',()=>{
 const x=reconcileMonth(fn());
 assert.equal(x.mode,'monthly-bank-payout');assert.equal(x.status,'matched');
 assert.equal(x.netDifference,0);assert.equal(x.bankDifference,0);
 assert.equal(x.feeDifference,0);assert.equal(x.accountingWrites,0);
 assert.equal(x.bankEvidenceIds.length,1);
});
test('settlement period can differ from one monthly payout arrival date',()=>{
 const x=reconcileMonth(stripe());
 assert.equal(x.period,'2026-09');
 assert.equal(x.bankEvidenceIds[0],'bank-oct-1');
});
test('one monthly payout may have explicitly identified split bank transfers, not individual sales',()=>{
 const sample=stripe();
 sample.bankPayouts=[{...sample.bankPayouts[0],amount:40000},
   {id:'bank-oct-3',account:'GMO',direction:'income',amount:54500,date:'2026-10-03'}];
 const x=reconcileMonth(sample);assert.equal(x.status,'matched');
 assert.equal(x.bankEvidenceIds.length,2);
});
test('bank total or official fee discrepancy is reported, never posted',()=>{
 const sample=ato();sample.bankPayouts[0].amount=47000;sample.expectedFee=2000;
 const x=reconcileMonth(sample);
 assert.equal(x.bankDifference,-500);assert.equal(x.feeDifference,250);
 assert.equal(x.status,'review');assert.equal(x.accountingWrites,0);
});
test('actual official fee comes from statement, no fixed NP or Stripe rates',()=>{
 const sample=stripe();sample.official.feeTotal=9999;
 const x=reconcileMonth(sample);
 assert.equal(x.officialFee,9999);assert.equal(x.netDifference,6499);
});
test('bad bank direction/account is not silently matched',()=>{
 const sample=np();sample.bankDebits[0].direction='income';
 assert.throws(()=>reconcileMonth(sample),/入出金方向/);
});
test('one monthly reconciliation per platform and account; duplicates rejected',()=>{
 const records=monthlyReport([stripe(),ato(),np()]);
 assert.equal(records.length,3);
 assert.throws(()=>monthlyReport([stripe(),stripe()]),/重複/);
});
test('reconciling external provider records cannot mutate official or bank sources',()=>{
 const data=Object.freeze({...stripe(),official:Object.freeze({...stripe().official}),bankPayouts:Object.freeze([Object.freeze({...stripe().bankPayouts[0]})])});
 const original=JSON.stringify(data);reconcileMonth(data);assert.equal(JSON.stringify(data),original);
});

test('a repeated bank row ID must not double-count a single monthly payout',()=>{
 const x=stripe();x.bankPayouts.push({...x.bankPayouts[0]});
 assert.throws(()=>reconcileMonth(x),/二重/);
});
test('platform verification never imports the accounting engine, Firebase or calendar',()=>{
 const source=require('node:fs').readFileSync(require.resolve('../src/integrations/platform-settlement'),'utf8');
 assert(!/\brequire\s*\(/.test(source),'internal monthly audit must remain dependency-free');
 assert(!/firebase|firestore|localStorage|setDoc|saveExpense|registerPayment|registerSale/.test(source));
});
