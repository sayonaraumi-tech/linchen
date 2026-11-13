/* End-to-end new domain snapshot -> frozen original HTML renderer -> real PDFs.
 * Both flows use the SAME new domain snapshot; old and migrated renderer outputs
 * must be pixel-equal. No real Firebase or user data.
 */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const crypto=require('node:crypto'),cp=require('node:child_process'),{chromium}=require('playwright');
const Business=require('../src/core/business');
const legacy=path.resolve(process.env.OLD_ROOT||'../geruninn'),migrated=path.resolve(process.env.NEW_ROOT||'legacy-pdf/source');
const out=path.resolve(process.env.INTEGRATION_PDF_OUT||'pdf-business-evidence');
const bundle=require.resolve('html2pdf.js/dist/html2pdf.bundle.min.js');
fs.mkdirSync(out,{recursive:true});
const cases=[
 {docType:'estimate',rows:2,pages:1},{docType:'invoice',rows:2,pages:1},
 {docType:'receipt',rows:2,pages:1},{docType:'onoda',rows:16,pages:1},
 {docType:'onoda',rows:17,pages:2}
];
function createFormal(caseSpec){
 let s=Business.emptyState('test');
 const items=Array.from({length:caseSpec.rows},(_,i)=>({
  content:'クロス張替 '+String(i+1),qty:1,price:1000,taxable:true,unit:'式'
 }));
 const snapshot={
  docType:caseSpec.docType,customerName:'合成テスト会社',invoiceDate:'2026-09-30',
  salesDate:'2026-09-30',items,paymentMethod:'現金',receiptTotal:2200,
  tadashi:'クロス張替工事代',remarks:'テスト用',carryoverMonth:'',carryoverAmount:0
 };
 const cmd={type:'issueDocument',operationId:'pdf-'+caseSpec.docType+'-'+caseSpec.rows,
  sourceKey:'pdf-'+caseSpec.docType+'-'+caseSpec.rows,
  docType:caseSpec.docType,issuedAt:'2026-11-13T04:15:00Z',
  amount:Math.max(1100,caseSpec.rows*1100),snapshot};
 const result=Business.perform(s,cmd);s=result.state;
 const document=result.result.document;
 assert.equal(Business.list(s,'documents').length,1);
 assert(document.invoiceNo.startsWith('20261113-1315-'));
 return {document,state:s};
}
function serve(root){return new Promise(resolve=>{
 const srv=http.createServer((req,res)=>{
  try{
   const u=new URL(req.url,'http://localhost').pathname;
   if(u==='/firebase-config.json'){res.setHeader('Content-Type','application/json');return res.end('{"enabled":false}');}
   const file=path.resolve(root,'.'+(u==='/'?'/index.html':u));
   if(!file.startsWith(root+path.sep)&&file!==path.join(root,'index.html'))return res.writeHead(403).end();
   const ext=path.extname(file);
   res.setHeader('Content-Type',ext==='.js'?'text/javascript':ext==='.html'?'text/html':'application/octet-stream');
   res.end(fs.readFileSync(file));
  }catch(e){res.writeHead(404).end('Not Found');}
 });
 srv.listen(0,'127.0.0.1',()=>resolve({server:srv,url:'http://127.0.0.1:'+srv.address().port+'/'}));
});}
function sizeInfo(file){
 const info=cp.execFileSync('pdfinfo',[file],{encoding:'utf8'});
 const pages=Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
 const box=info.match(/^Page size:\s+([^\n]+)/m)?.[1]||'';
 assert(box.includes('595')&&box.includes('841'),'Expected A4: '+box);
 return {pages,box};
}
function raster(file,prefix){
 cp.execFileSync('pdftoppm',['-r','72','-png',file,prefix]);
 return fs.readdirSync(out).filter(x=>x.startsWith(path.basename(prefix)+'-')&&x.endsWith('.png')).sort().map(x=>fs.readFileSync(path.join(out,x)));
}
async function pdf(browser,url,kind,caseSpec,width,document,state){
 const ctx=await browser.newContext({viewport:{width,height:900},acceptDownloads:true,serviceWorkers:'block'});
 const p=await ctx.newPage();
 p.on('dialog',d=>d.dismiss());
 await p.route('https://**/*',route=>route.abort());
 await p.route('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',route=>route.fulfill({path:bundle,contentType:'text/javascript'}));
 await p.goto(url,{waitUntil:'load'});
 const before=JSON.stringify(state);
 const values=await p.evaluate(({doc})=>{
  // This is the real new-domain confirmed document snapshot passed to the
  // original renderer, not a separately handcrafted PDF form fixture.
  const snap=JSON.parse(JSON.stringify(doc.snapshot));
  if(snap.invoiceNo!==doc.invoiceNo)throw Error('Formal number changed');
  applyFormState(snap,doc.docType);
  bizSwitchPage('chohyo');
  document.getElementById('previewArea').classList.add('show');
  const invoice=document.querySelector('#previewArea .invoice');
  fitInvoiceToOnePage(invoice,doc.docType);
  const current=collectFormState();
  if(current.customerName!==snap.customerName||current.invoiceNo!==snap.invoiceNo)throw Error('Snapshot mapping changed');
  if(current.invoiceDate!==snap.invoiceDate||current.docType!==doc.docType)throw Error('Document metadata changed');
  return {filename:buildPrintFilename(),actualRows:invoice.querySelectorAll('#invItems tr:not(.empty)').length,
   pageMode:invoice.classList.contains('multipage-onoda')?'multi':'single',
   number:current.invoiceNo,customer:current.customerName};
 },{doc:document});
 if(caseSpec.docType!=='receipt')assert.equal(values.actualRows,caseSpec.rows);
 if(caseSpec.docType==='onoda')assert.equal(values.pageMode,caseSpec.rows<=16?'single':'multi');
 const downloadPromise=p.waitForEvent('download',{timeout:20000});
 await p.evaluate(()=>doPrint());
 const download=await downloadPromise;
 const file=path.join(out,kind+'-'+caseSpec.docType+'-'+caseSpec.rows+'-'+width+'.pdf');
 await download.saveAs(file);
 const {pages,box}=sizeInfo(file);
 assert.equal(pages,caseSpec.pages,kind+' '+caseSpec.docType+' pages');
 assert.equal(JSON.stringify(state),before,'new accounting domain was mutated by PDF download');
 await ctx.close();
 return {file,pages,box,filename:values.filename,number:values.number,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
}
(async()=>{
 const a=await serve(legacy),b=await serve(migrated),browser=await chromium.launch({headless:true});
 const report=[];let errors=0;
 try{
  for(const width of [1280,390])for(const testCase of cases){
   const {document,state}=createFormal(testCase);
   const record={type:testCase.docType,rows:testCase.rows,width};
   try{
    record.original=await pdf(browser,a.url,'original',testCase,width,document,state);
    record.migrated=await pdf(browser,b.url,'migrated',testCase,width,document,state);
    assert.equal(record.original.filename,record.migrated.filename);
    assert.equal(record.original.pages,record.migrated.pages);
    const orig=raster(record.original.file,path.join(out,'original-'+testCase.docType+'-'+testCase.rows+'-'+width));
    const dest=raster(record.migrated.file,path.join(out,'migrated-'+testCase.docType+'-'+testCase.rows+'-'+width));
    assert.equal(orig.length,dest.length);
    assert(orig.every((x,i)=>x.equals(dest[i])),'PDF pixel difference');
    record.pixelEqual=true;record.result='PASS';
   }catch(e){record.result='FAIL';record.error=e.stack||String(e);errors++;}
   report.push(record);console.log('BUSINESS-PDF',record.type,record.rows,width,record.result,record.error||'');
  }
 }finally{
  await browser.close();a.server.close();b.server.close();
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),report},null,2));
 }
 if(errors)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
