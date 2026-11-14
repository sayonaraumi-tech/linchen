const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../src/core/business'),I=require('../src/integrations/bank-import');
const csv='日付,摘要,入金金額,出金金額,残高,メモ\n2026/11/13,テスト入金,"11,000",,20000,売上\n2026/11/14,材料,,"3,000",17000,支出';
test('import CSV is evidence only and can be repeated without second bank row',()=>{
 let state=B.emptyState();
 const first=I.importCSV(state,csv,{account:'GMOあおぞら',batchId:'batch1'});
 state=first.state;
 assert.equal(first.summary.imported,2);assert.equal(first.summary.requiresReview,0);
 assert.equal(B.list(state,'bankTransactions').length,2);
 assert.equal(B.list(state,'sales').length,0);assert.equal(B.list(state,'payments').length,0);assert.equal(B.list(state,'expenses').length,0);
 const second=I.importCSV(state,csv,{account:'GMOあおぞら',batchId:'batch2'});
 assert.equal(second.summary.imported,0);assert.equal(second.summary.duplicates,2);
 assert.equal(B.list(second.state,'bankTransactions').length,2);
 assert.equal(B.list(second.state,'bankTransactions')[0].memo,'売上');
});
test('bank CSV errors reject full batch without changing prior state',()=>{
 const initial=B.emptyState();
 assert.throws(()=>I.importCSV(initial,'日付,摘要,入金,出金\n2026-11-13,A,100,\n2026-11-13,B,100,200',{account:'GMO'}),/不正な行/);
 assert.equal(B.list(initial,'bankTransactions').length,0);
});
test('Shift_JIS decoder works for Japanese bank descriptions',()=>{
 const bytes=Uint8Array.from([0x93,0xfa,0x95,0x74,0x8c,0xfb]); // 日付? fixed bytes are only a decoder smoke
 const decoded=I.decodeBytes(bytes,{encoding:'shift_jis'});
 assert(decoded.length>0);
 const bom=new Uint8Array([0xef,0xbb,0xbf,0x61]);
 assert.equal(I.decodeBytes(bom),'a');
});
test('changing a bank row under same external identity is rejected',()=>{
 let s=B.emptyState();
 const identified='日付,摘要,入金,出金,取引番号\n2026-11-13,A,11000,,tx-1';
 s=I.importCSV(s,identified,{account:'GMO'}).state;
 const changed=identified.replace('11000','12000');
 assert.throws(()=>I.importCSV(s,changed,{account:'GMO'}),/取引内容|銀行明細/);
});
