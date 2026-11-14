const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../src/core/business'),PDF=require('../src/pdf/frozen-document');
const LegacyBusiness=require('../legacy-pdf/source/js/business-domain');
test('re-downloading original invoice is read-only, keeps number and uses legacy filename logic',async()=>{
 let state=B.emptyState();
 state=B.perform(state,{operationId:'issue',type:'issueDocument',docType:'invoice',sourceKey:'formal-invoice',amount:11000,issuedAt:'2026-11-13T04:15:00Z',snapshot:{customerName:'テスト顧客',invoiceDate:'2026-11-13',items:[{content:'クロス張替',qty:10,price:1000}]}}).state;
 const doc=B.list(state,'documents')[0],before=JSON.stringify(state);
 let renderCount=0;
 const service=PDF.createFrozenPdfService({
  loadDocument:async id=>B.list(state,'documents').find(d=>d.id===id),
  filenameForSnapshot:x=>LegacyBusiness.documentFilename(x),
  exportLegacyPDF:async({snapshot,filename})=>{
   renderCount++;
   assert.equal(snapshot.invoiceNo,doc.invoiceNo);
   assert(filename.endsWith('.pdf'));
   return Buffer.from('%PDF-1.7\nsynthetic test fixture\n');
  }
 });
 const out=await service.download(doc.id);
 assert(out.filename.endsWith('.pdf'));
 assert.equal(out.invoiceNo,doc.invoiceNo);
 await service.download(doc.id);
 assert.equal(renderCount,2);
 assert.equal(JSON.stringify(state),before);
 assert.equal(B.list(state,'sales').length,1);
});
test('PDF renderer mutating captured snapshot is rejected',async()=>{
 const d={id:'d',docType:'receipt',invoiceNo:'20261113-1315-01',snapshot:{invoiceNo:'20261113-1315-01',docType:'receipt',customerName:'A',invoiceDate:'2026-11-13'}};
 const svc=PDF.createFrozenPdfService({loadDocument:async()=>d,filenameForSnapshot:()=> 'receipt.pdf',exportLegacyPDF:async({snapshot})=>{snapshot.customerName='modified';return Buffer.from('%PDF-1.4');}});
 await assert.rejects(svc.download('d'),/変更されました/);
 assert.equal(d.snapshot.customerName,'A');
});
test('draft and missing formal number cannot be rendered as saved originals',async()=>{
 const svc=PDF.createFrozenPdfService({loadDocument:async()=>({id:'draft',docType:'estimate',snapshot:{}}),filenameForSnapshot:()=> 'draft.pdf',exportLegacyPDF:async()=>Buffer.from('%PDF-1.4')});
 await assert.rejects(svc.download('draft'),/確定帳票/);
});
