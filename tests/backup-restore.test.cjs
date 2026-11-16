const {test}=require('node:test'),assert=require('node:assert/strict');
const D=require('../src/core/business'),R=require('../src/storage/backup-restore');
const createdAt='2026-11-13T11:00:00Z',companyId='tsukinowa-isolated';
const run=(s,id,command)=>D.perform(s,{...command,operationId:id}).state;
function original(){let s=D.emptyState('test');
 s=run(s,'doc',{type:'issueDocument',docType:'invoice',sourceKey:'test-1',amount:11000,
  snapshot:{customerName:'合成会社',invoiceDate:'2026-11-13',items:[{content:'壁紙張替',qty:1,price:10000}]}});
 const sale=D.list(s,'sales')[0];
 s=run(s,'pay',{type:'registerPayment',saleId:sale.id,method:'現金',amount:11000,paymentDate:'2026-11-13'});
 return s;}
test('offline backup round-trip preserves operation journal, cash and all financial totals',()=>{
 const source=original(),before=JSON.stringify(source),bundle=R.exportBackup({state:source,companyId,createdAt});
 const inspected=R.inspectBackup(bundle,{companyId});
 assert.equal(inspected.valid,true);assert.equal(inspected.overview.outstanding,0);
 const restored=R.restoreToEmptyTest({bundle,companyId,confirmation:'RESTORE-ISOLATED-TEST',currentState:D.emptyState('test')});
 assert.deepEqual(restored.state,source);assert.equal(JSON.stringify(source),before);
 const replay=D.perform(restored.state,{type:'issueDocument',operationId:'doc',docType:'invoice',sourceKey:'test-1',amount:11000,
  snapshot:{customerName:'合成会社',invoiceDate:'2026-11-13',items:[{content:'壁紙張替',qty:1,price:10000}]}});
 assert.equal(replay.reused,true);
 assert.equal(D.list(replay.state,'documents').length,1);
});
test('wrong company, altered cash amount, changed totals or missing collection fails closed',()=>{
 const bundle=R.exportBackup({state:original(),companyId,createdAt});
 assert.throws(()=>R.inspectBackup(bundle,{companyId:'other'}),/Company/);
 const altered=structuredClone(bundle);altered.state.collections.cashLedger[Object.keys(altered.state.collections.cashLedger)[0]].amount=999999;
 assert.throws(()=>R.inspectBackup(altered,{companyId}),/checksum/);
 const missing=structuredClone(bundle);delete missing.state.collections.payments;delete missing.sha256;
 assert.throws(()=>R.inspectBackup(missing,{companyId}),/checksum/);
});
test('production backups can be inspected but cannot be restored by a test recovery tool',()=>{
 const s=D.emptyState('production'),bundle=R.exportBackup({state:s,companyId,createdAt});
 assert.equal(R.inspectBackup(bundle,{companyId}).valid,true);
 assert.throws(()=>R.restoreToEmptyTest({bundle,companyId,confirmation:'RESTORE-ISOLATED-TEST',currentState:D.emptyState('test')}),/Production/);
});
test('restore refuses overwrite, explicit token required, and rejects secrets before export',()=>{
 const bundle=R.exportBackup({state:original(),companyId,createdAt});
 assert.throws(()=>R.restoreToEmptyTest({bundle,companyId,currentState:D.emptyState('test')}),/confirmation/);
 assert.throws(()=>R.restoreToEmptyTest({bundle,companyId,confirmation:'RESTORE-ISOLATED-TEST',currentState:original()}),/empty/);
 const corrupted=original();corrupted.collections.settings.creds={id:'creds',value:{accessToken:'test'}};
 assert.throws(()=>R.exportBackup({state:corrupted,companyId,createdAt}),/Sensitive/);
});
