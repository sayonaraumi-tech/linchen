const {test}=require('node:test'),assert=require('node:assert/strict');
const {previewHistoricalPdf}=require('../src/compat/historical-pdf-preview');
const draft={customerName:'合成会社',invoiceNo:'OLD-2025-001',issueDate:'2025-09-30',dueDate:'2025-10-31',invoiceAmount:11000,billingMonth:'2025-09',items:[{content:'クロス張替',qty:1,price:10000}]};
test('historical invoice preview preserves source number and does not write sales',()=>{
 const docs=[],sales=[];
 const p=previewHistoricalPdf({draft,documents:docs,sales,sourceHash:'a'.repeat(64)});
 assert.equal(p.draft.invoiceNo,'OLD-2025-001');assert.equal(p.createSale,false);
 assert.equal(p.automaticWrites,0);assert.equal(p.issueNewNumber,false);
 assert.equal(docs.length,0);assert.equal(sales.length,0);
 assert.equal(p.status,'unlinked-review');
});
test('existing invoice number or same source hash is blocked as duplicate',()=>{
 const p=previewHistoricalPdf({draft,documents:[{id:'prior',snapshot:{invoiceNo:'OLD-2025-001'},sourceHash:'b'.repeat(64)}],sales:[]});
 assert.equal(p.status,'duplicate');assert.equal(p.duplicateId,'prior');
});
test('one matching sale requires explicit user review, ambiguous matches cannot silently link',()=>{
 const one={id:'sale1',customer:'合成会社',amount:11000,invoiceDate:'2025-09-30'};
 const p=previewHistoricalPdf({draft,sales:[one]});
 assert.equal(p.status,'link-review');assert.deepEqual(p.matchingSaleIds,['sale1']);
 const conflict=previewHistoricalPdf({draft,sales:[one,{...one,id:'sale2'}]});
 assert.equal(conflict.status,'ambiguous');
});
test('unparseable or missing official due date never fills guessed date',()=>{
 assert.throws(()=>previewHistoricalPdf({text:'発行日: 2025-09-30 宛名: 会社'}),/日付/);
});
