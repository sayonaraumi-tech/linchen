const {test}=require('node:test'),assert=require('node:assert/strict'),B=require('../src/core/business');
const run=(s,id,c)=>B.perform(s,{...c,operationId:id}).state;
test('expense category learning applies only to future records and never changes prior booked category',()=>{
 let s=B.emptyState();
 s=run(s,'first',{type:'saveExpense',expenseDate:'2026-11-10',vendor:'株式会社 材料',category:'消耗品費',amount:1000,paymentMethod:'銀行振込'});
 const oldId=B.list(s,'expenses')[0].id;
 s=run(s,'rule',{type:'saveExpenseCategoryRule',vendor:'株式会社 材料',category:'材料費'});
 assert.equal(B.suggestExpenseCategory(s,'株式会社　材料'),'材料費');
 s=run(s,'later',{type:'saveExpense',expenseDate:'2026-11-11',vendor:'株式会社 材料',amount:2000,paymentMethod:'銀行振込'});
 const rows=B.list(s,'expenses');
 assert.equal(rows.find(x=>x.id===oldId).category,'消耗品費');
 assert.equal(rows.find(x=>x.id!==oldId).category,'材料費');
 assert.equal(B.getOverview(s).expenses,3000);
});
test('expense category learning can be disabled without changing historical expenses',()=>{
 let s=B.emptyState();
 s=run(s,'rule',{type:'saveExpenseCategoryRule',vendor:'材料店',category:'材料費'});
 s=run(s,'disable',{type:'saveExpenseCategoryRule',vendor:'材料店',category:'材料費',enabled:false});
 assert.equal(B.suggestExpenseCategory(s,'材料店'),null);
 const before=JSON.stringify(s);
 assert.throws(()=>run(s,'missing',{type:'saveExpense',expenseDate:'2026-11-13',vendor:'材料店',amount:100,paymentMethod:'現金'}),/科目を選択/);
 assert.equal(JSON.stringify(s),before);
 assert.throws(()=>run(s,'bad-key',{type:'saveSettings',key:'expense_rule_材料店',value:{category:'給与'}}),/管理専用/);
});
test('bank exclusion blocks matching and preserves imported evidence; reenabling needs reason',()=>{
 let s=B.emptyState();
 s=run(s,'invoice',{type:'issueDocument',docType:'invoice',sourceKey:'inv',amount:1000,
  snapshot:{customerName:'A',invoiceDate:'2026-11-13',items:[]}});
 const sale=B.list(s,'sales')[0];
 s=run(s,'payment',{type:'registerPayment',saleId:sale.id,method:'銀行振込',amount:1000,paymentDate:'2026-11-13'});
 const pay=B.list(s,'payments')[0];
 s=run(s,'bank',{type:'importBankTransaction',account:'GMO',externalId:'bankX',amount:1000,date:'2026-11-13',description:'A',direction:'income'});
 const bank=B.list(s,'bankTransactions')[0];
 s=run(s,'exclude',{type:'bankExclude',bankTxnId:bank.id,excluded:true,reason:'重複候補・原本確認待ち'});
 assert.equal(B.list(s,'bankTransactions')[0].status,'excluded');
 assert.throws(()=>run(s,'match',{type:'matchBankPayment',bankTxnId:bank.id,paymentId:pay.id}),/入金照合条件/);
 assert.equal(B.list(s,'payments')[0].confirmation,'pending-bank');
 s=run(s,'unexclude',{type:'bankExclude',bankTxnId:bank.id,excluded:false,reason:'原本確認済み'});
 s=run(s,'match-ok',{type:'matchBankPayment',bankTxnId:bank.id,paymentId:pay.id});
 assert.equal(B.list(s,'bankTransactions')[0].status,'matched');
 assert.throws(()=>run(s,'bad-exclude',{type:'bankExclude',bankTxnId:bank.id,excluded:true,reason:'誤り'}),/照合を解除/);
});
test('explicit cash balance adjustment never manufactures sales or expenses and cannot reuse ID with new value',()=>{
 let s=B.emptyState();const cmd={type:'cashAdjustment',adjustmentId:'opening-2026',direction:'income',date:'2026-10-01',amount:10000,description:'期首残高訂正',confirmed:true};
 assert.throws(()=>run(s,'unapproved',{...cmd,confirmed:false}),/明示確認/);
 s=run(s,'cash-adjust1',cmd);
 s=run(s,'cash-adjust2',cmd);
 assert.equal(B.list(s,'cashLedger').length,1);
 assert.equal(B.getOverview(s).cashIn,10000);
 assert.equal(B.getOverview(s).sales,0);assert.equal(B.getOverview(s).expenses,0);
 assert.throws(()=>run(s,'different',{...cmd,amount:9999}),/上書き/);
});
