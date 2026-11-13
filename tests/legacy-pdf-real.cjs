'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),cp=require('node:child_process'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const oldRoot=path.resolve(process.env.OLD_ROOT||'../geruninn');
const newRoot=path.resolve(process.env.NEW_ROOT||'legacy-pdf/source');
const bundle=require.resolve('html2pdf.js/dist/html2pdf.bundle.min.js');
const out=path.resolve(process.env.PDF_OUT||'pdf-evidence');
fs.mkdirSync(out,{recursive:true});
const types=[
  {name:'estimate',type:'estimate',rows:2,pages:1},
  {name:'invoice',type:'invoice',rows:2,pages:1},
  {name:'receipt',type:'receipt',rows:2,pages:1},
  {name:'onoda-1',type:'onoda',rows:1,pages:1},
  {name:'onoda-16',type:'onoda',rows:16,pages:1},
  {name:'onoda-17',type:'onoda',rows:17,pages:2},
  {name:'onoda-35',type:'onoda',rows:35,pages:3},
];
function serve(root){
 return new Promise(resolve=>{
  const server=http.createServer((req,res)=>{
   try{
    const u=new URL(req.url,'http://127.0.0.1').pathname;
    if(u==='/firebase-config.json'){res.setHeader('Content-Type','application/json');return res.end('{"enabled":false}');}
    const file=path.resolve(root,'.'+(u==='/'?'/index.html':u));
    if(!file.startsWith(root+path.sep)&&file!==path.join(root,'index.html')){res.writeHead(403).end();return;}
    const ext=path.extname(file);
    res.setHeader('Content-Type',ext==='.js'?'application/javascript':ext==='.html'?'text/html':ext==='.json'?'application/json':'application/octet-stream');
    res.end(fs.readFileSync(file));
   }catch(e){res.writeHead(404).end('Not found');}
  });
  server.listen(0,'127.0.0.1',()=>resolve({server,url:'http://127.0.0.1:'+server.address().port+'/'}));
 });
}
function info(file){
 const s=cp.execFileSync('pdfinfo',[file],{encoding:'utf8'});
 const pages=+(s.match(/^Pages:\s+(\d+)/m)||[])[1];
 const size=(s.match(/^Page size:\s+(.+)$/m)||[])[1]||'';
 assert(size.includes('595')&&size.includes('841'),file+' non A4: '+size);
 return {pages,size};
}
function renderPngs(pdf,prefix){
 cp.execFileSync('pdftoppm',['-r','72','-png',pdf,prefix]);
 return fs.readdirSync(out).filter(x=>x.startsWith(path.basename(prefix)+'-')&&x.endsWith('.png')).sort().map(x=>path.join(out,x));
}
async function runOne(browser,endpoint,group,width,test){
 const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true,serviceWorkers:'block'});
 const page=await context.newPage();
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',d=>d.dismiss());
 await page.route('https://**/*',route=>route.abort());
 await page.route('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js',route=>route.fulfill({path:bundle,contentType:'application/javascript'}));
 await page.goto(endpoint,{waitUntil:'load'});
 const meta=await page.evaluate(x=>{
  const items=Array.from({length:x.rows},(_,i)=>({content:'壁紙張替 '+(i+1),qty:1,price:1000,taxable:true,unit:'式'}));
  const state={docType:x.type,invoiceNo:'20260930-001',invoiceDate:'2026-09-30',salesDate:'2026-09-30',customerName:'テスト株式会社',items,receiptTotal:'2200',paymentMethod:'現金',tadashi:'壁紙工事代',remarks:'検証用',carryoverAmount:0,carryoverMonth:''};
  applyFormState(state,x.type);
  const el=document.querySelector('#previewArea .invoice');
  bizSwitchPage('chohyo');
  document.getElementById('previewArea').classList.add('show');
  fitInvoiceToOnePage(el,x.type);
  return {type:docType,rowCount:el.querySelectorAll('#invItems tr:not(.empty)').length,mode:el.classList.contains('multipage-onoda')?'multipage':el.classList.contains('normal-16')?'normal-16':'ordinary',filename:buildPrintFilename()};
 },test);
 if(test.type!=='receipt')assert.equal(meta.rowCount,test.rows,group+' '+test.name+' rows mismatch');
 if(test.type==='onoda')assert.equal(meta.mode,test.rows<=16?'normal-16':'multipage',group+' '+test.name+' mode');
 const pdfPath=path.join(out,group+'-'+test.name+'-'+width+'.pdf');
 const downloadPromise=page.waitForEvent('download',{timeout:15000});
 await page.evaluate(()=>doPrint());
 const download=await downloadPromise;
 await download.saveAs(pdfPath);
 const pdf=info(pdfPath);
 assert.equal(pdf.pages,test.pages,group+' '+test.name+' expected '+test.pages+' pages got '+pdf.pages);
 if(errors.length)console.log('Browser notes',group,test.name,errors);
 await context.close();
 return {pdfPath,pdf,filename:meta.filename,sha256:crypto.createHash('sha256').update(fs.readFileSync(pdfPath)).digest('hex')};
}
(async()=>{
 const old=await serve(oldRoot),fresh=await serve(newRoot),browser=await chromium.launch({headless:true});
 let failed=false;const report=[];
 try{
  for(const width of [1280,390])for(const test of types){
   const row={case:test.name,width};console.log('BEGIN',test.name,width);
   try{
    row.old=await runOne(browser,old.url,'old',width,test);
    row.new=await runOne(browser,fresh.url,'new',width,test);
    assert.equal(row.old.filename,row.new.filename,'filename mismatch');
    assert.equal(row.old.pdf.pages,row.new.pdf.pages,'pages mismatch');
    assert.equal(row.old.pdf.size,row.new.pdf.size,'page sizes mismatch');
    const a=renderPngs(row.old.pdfPath,path.join(out,'old-'+test.name+'-'+width));
    const b=renderPngs(row.new.pdfPath,path.join(out,'new-'+test.name+'-'+width));
    assert.equal(a.length,b.length,'rendered page count');
    row.pixelEqual=a.every((f,i)=>fs.readFileSync(f).equals(fs.readFileSync(b[i])));
    assert(row.pixelEqual,'PNG pixel mismatch');
    row.result='PASS';
   }catch(err){failed=true;row.result='FAIL';row.error=err.stack||String(err);}
   report.push(row);console.log(test.name,width,row.result,row.error||'');
  }
 }finally{
  await browser.close();old.server.close();fresh.server.close();
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({sourceCommit:'6674e019731b7fbc490e52e32fed348f7c0b7a6d',report},null,2));
 }
 if(failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});