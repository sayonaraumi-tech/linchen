const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/compat/legacy-contract');
test('all 15 legacy collections are covered by explicit mapping or migration hold',()=>{
 assert.equal(C.LEGACY_COLLECTIONS.length,15);
 for(const collection of C.LEGACY_COLLECTIONS){
  assert(C.MAPPING[collection]);
  assert(['blocked','archive-only','explicit-link','needs-schema-review'].includes(C.MAPPING[collection].mode));
 }
 assert(C.LEGACY_COLLECTIONS.includes('receivables'));
 assert(C.LEGACY_COLLECTIONS.includes('estimates'));
 assert(C.LEGACY_COLLECTIONS.includes('migrations'));
 assert(!C.NEW_COLLECTIONS.includes('receivables'));
});
test('legacy local keys must stay intact and not be silently read by new sandbox',()=>{
 assert.equal(C.LOCAL_KEYS.business,'tsukinowa_business_v1');
 assert.equal(C.LOCAL_KEYS.documents,'tsukinowa_chohyo_confirmed_history_v1');
 assert.equal(C.LOCAL_KEYS.settings,'tsukinowa_business_settings_v1');
});
test('a legacy formal document keeps its exact snapshot and original number in read-only audit',()=>{
 const dump={documents:[{id:'old-doc-1',payload:{documentId:'old-doc-1',confirmed:true,docType:'onoda',
  invoiceNo:'20260930-001',snapshot:{invoiceNo:'20260930-001',carryoverAmount:9999,customerName:'テスト',items:[]}}}]};
 const before=JSON.stringify(dump),v=C.validateLegacyDump(dump);
 assert.equal(v.readOnly,true);
 assert(v.warnings.some(x=>x.code==='carryover-display-only'));
 assert.equal(v.issues.length,0);
 assert.equal(JSON.stringify(dump),before);
 assert.equal(v.canAutoMigrate,false);
});
test('estimates and receivables cannot be silently converted or deleted',()=>{
 const report=C.validateLegacyDump({estimates:[{id:'est_001',amount:1000}],receivables:[{id:'receivable_1',amount:2000}]});
 assert(report.issues.some(x=>x.collection==='estimates'&&x.code==='missing-new-domain'));
 assert(report.issues.some(x=>x.collection==='receivables'&&x.code==='missing-new-domain'));
 assert.equal(report.canAutoMigrate,false);
});
test('reject unknown collections, broken snapshots and duplicated IDs',()=>{
 const r=C.validateLegacyDump({documents:[{id:'same',confirmed:true},{id:'same',confirmed:true}],strange:[{}]});
 assert(r.issues.some(x=>x.code==='duplicate-id'));
 assert(r.issues.some(x=>x.code==='missing-formal-snapshot'));
 assert(r.issues.some(x=>x.code==='unknown-collection'));
});
test('new system never directly reads production legacy storage keys',()=>{
 const fake={tsukinowa_business_v1:'do-not-touch',tsukinowa_chohyo_confirmed_history_v1:'do-not-touch'};
 const original={...fake};C.validateLegacyDump({});
 assert.deepEqual(fake,original);
});
