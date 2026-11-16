const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../src/core/business'),V=require('../src/core/views');
const run=(s,id,c)=>B.perform(s,{...c,operationId:id}).state;
test('bank interest and cashback only appear as otherIncome in bank month, never new sale',()=>{
 let s=B.emptyState();
 s=run(s,'interest',{type:'importBankTransaction',account:'GMO',externalId:'int1',date:'2026-10-31',direction:'income',amount:2679,description:'預金利息'});
 const bank=B.list(s,'bankTransactions')[0];
 s=run(s,'confirm',{type:'reviewBankIncome',reviewed:true,interest:true,bankTxnId:bank.id,reason:'公式口座明細'});
 const october=V.dashboard(s,{month:'2026-10'}),november=V.dashboard(s,{month:'2026-11'});
 assert.equal(october.otherIncome,2679);assert.equal(october.sales,0);assert.equal(october.receipts,0);
 assert.equal(november.otherIncome,0);
 assert.equal(B.getOverview(s).otherIncome,2679);
 s=run(s,'undo',{type:'unmatchBank',bankTxnId:bank.id});
 assert.equal(V.dashboard(s,{month:'2026-10'}).otherIncome,0);
});
