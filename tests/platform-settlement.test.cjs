const {test}=require('node:test'),assert=require('node:assert/strict');
const {reconcile}=require('../src/integrations/platform-settlement');
const make=provider=>({provider,statementId:'official-2026-09',officialNet:9550,lines:[
 {sourceId:'tx1',orderId:'order1',gross:10000,fee:450,refund:0,adjustment:0}]});
for(const provider of ['stripe','np','ato'])test(provider+' official fee and payout matched to original order and bank',()=>{
 const x=reconcile(make(provider),{orders:[{id:'order1',gross:10000}],deposits:[{provider,statementId:'official-2026-09',amount:9550}]});
 assert.equal(x.status,'reconciled');assert.equal(x.totals.gross,10000);
 assert.equal(x.totals.fees,450);assert.equal(x.bankNet,9550);assert.equal(x.postingRules.payout.includes('不新建売上'),true);
});
test('bank payout may land later than sales period, checked by statement identity',()=>{
 const s={...make('stripe'),periodStart:'2026-09-01',periodEnd:'2026-09-30'};
 const x=reconcile(s,{orders:[{id:'order1',gross:10000}],deposits:[{provider:'stripe',statementId:s.statementId,date:'2026-10-02',amount:9550}]});
 assert.equal(x.status,'reconciled');assert.equal(x.periodEnd,'2026-09-30');
});
test('unknown official fees cannot be inferred from bank net',()=>{
 const x=reconcile(make('ato'),{deposits:[{provider:'ato',statementId:'official-2026-09',amount:9550}],orders:[]});
 assert.equal(x.status,'review');assert.equal(x.unresolved.length,1);
});
test('official payout different from calculation or deposit blocks reconciliation',()=>{
 const s={...make('np'),officialNet:9000};
 const x=reconcile(s,{orders:[{id:'order1',gross:10000}],deposits:[{provider:'np',statementId:s.statementId,amount:9550}]});
 assert.equal(x.status,'review');
 assert.equal(x.differences.officialVsCalculated,-550);assert.equal(x.differences.officialVsBank,-550);
});
test('same official transaction in same statement is rejected',()=>{
 const s=make('stripe');s.lines.push({...s.lines[0]});
 assert.throws(()=>reconcile(s),/重複/);
});
