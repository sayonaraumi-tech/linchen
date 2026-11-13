const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../src/core/business');
const Bank=require('../src/integrations/bank-csv');
const act=(s,id,c)=>B.perform(s,{...c,operationId:id}).state;
test('GMO CSV parses BOM, quoted comma, memo, and balance without losing data',()=>{
 const csv='\uFEFF日付,摘要,入金金額,出金金額,残高,メモ\n2026/11/13,"振込,Ａ社","11,000",,20000,"改行\n続き"\n2026/11/14,材料店,,"3,000",17000,カード';
 const result=Bank.parseCSV(csv,{account:'GMOあおぞら'});
 assert.equal(result.errors.length,0);assert.equal(result.entries.length,2);
 assert.equal(result.entries[0].incoming,11000);assert.equal(result.entries[0].description,'振込,A社');
 assert.equal(result.entries[0].memo,'改行\n続き');assert.equal(result.entries[1].outgoing,3000);
 assert.equal(result.entries[1].balance,17000);
 assert.equal(Bank.inspectImport([],result.entries).accepted.length,2);
 assert.equal(Bank.inspectImport(result.entries,result.entries).duplicates.length,2);
});
test('same date and amount with distinct balances remain separate',()=>{
 const csv='日付,摘要,入金,出金,残高\n2026-11-13,テスト会社,1000,,10000\n2026-11-13,テスト会社,1000,,11000';
 const {entries}=Bank.parseCSV(csv,{account:'main'});assert.equal(entries.length,2);
 assert.notEqual(entries[0].identity,entries[1].identity);
 assert.equal(Bank.inspectImport(entries,[entries[0]]).duplicates.length,1);
});
test('missing bank ID or balance is reviewed, never auto matched',()=>{
 const csv='日付,摘要,入金,出金\n20261113,テスト会社,1000,';
 const {entries}=Bank.parseCSV(csv,{account:'GMO',accountAliases:{GMO:'メイン口座'}});
 const result=Bank.inspectImport([],entries);
 assert.equal(result.review.length,1);assert.equal(result.accepted[0].account,'メイン口座');
 const suggestion=Bank.matchCandidates(entries[0],{payments:[{id:'p1',amount:1000,confirmation:'pending-bank'}]});
 assert.equal(suggestion.candidates.length,1);assert.equal(suggestion.autoConfirmed,false);
});
test('invalid bank rows carry a line error and never become valid entries',()=>{
 const {entries,errors}=Bank.parseCSV('日付,摘要,入金,出金\n2026-02-30,X,100,0\n2026-11-13,A,100,100\n2026-11-13,B,500,',{account:'GMO'});
 assert.equal(entries.length,1);assert.equal(errors.length,2);
});
test('supplier prepayment not expense; one consolidated monthly invoice is expense',()=>{
 let s=B.emptyState();
 s=act(s,'supplier',{type:'saveSupplier',name:'東鵬',openingBalance:1000000});
 const id=B.list(s,'suppliers')[0].id;
 s=act(s,'p',{type:'recordSupplierTransaction',supplierId:id,transactionType:'prepayment',date:'2026-11-01',amount:1000000,paymentMethod:'銀行振込'});
 assert.equal(B.supplierBalance(s,id),2000000);assert.equal(B.getOverview(s).expenses,0);
 s=act(s,'bill',{type:'recordSupplierTransaction',supplierId:id,transactionType:'monthlyInvoice',date:'2026-11-30',invoiceMonth:'2026-11',amount:1438620});
 assert.equal(B.supplierBalance(s,id),561380);assert.equal(B.getOverview(s).expenses,1438620);
 s=act(s,'billReplay',{type:'recordSupplierTransaction',supplierId:id,transactionType:'monthlyInvoice',date:'2026-11-30',invoiceMonth:'2026-11',amount:1438620});
 assert.equal(B.list(s,'expenses').length,1);
 assert.throws(()=>B.perform(s,{operationId:'bad',type:'recordSupplierTransaction',supplierId:id,transactionType:'monthlyInvoice',date:'2026-11-30',invoiceMonth:'2026-11',amount:1500000}),/訂正/);
 const expense=B.list(s,'expenses')[0];
 assert.throws(()=>B.perform(s,{operationId:'edit',type:'saveExpense',id:expense.id,vendor:'X',category:'材料費',expenseDate:'2026-11-30',amount:1,paymentMethod:'現金'}),/仕入先台帳/);
});
test('supplier transfer matches bank outgoing with no duplicate expense',()=>{
 let s=B.emptyState();
 s=act(s,'supplier',{type:'saveSupplier',name:'東鵬'});
 const id=B.list(s,'suppliers')[0].id;
 s=act(s,'payment',{type:'recordSupplierTransaction',supplierId:id,transactionType:'prepayment',date:'2026-11-01',amount:10000,paymentMethod:'銀行振込'});
 const tx=B.list(s,'supplierTransactions')[0];
 s=act(s,'bank',{type:'importBankTransaction',account:'GMO',externalId:'e1',date:'2026-11-01',direction:'outgoing',amount:10000});
 const b=B.list(s,'bankTransactions')[0];
 s=act(s,'match',{type:'matchBankSupplier',bankTxnId:b.id,transactionId:tx.id});
 assert.equal(B.getOverview(s).expenses,0);
 assert.equal(B.list(s,'bankTransactions')[0].status,'matched');
 s=act(s,'unmatch',{type:'unmatchBank',bankTxnId:b.id});
 assert.equal(B.list(s,'supplierTransactions')[0].bankTxnId,'');
});
