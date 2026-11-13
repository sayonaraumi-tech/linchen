/* Local-only PDF service. Exact legacy frozen HTML renderer.
 * No bookkeeping writes, no remote fetch, no production auth/config.
 */
'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const bundle=require.resolve('html2pdf.js/dist/html2pdf.bundle.min.js');
const types=new Set(['estimate','invoice','receipt','onoda']);
let browserPromise=null;
function validate(doc){
 if(!doc||typeof doc!=='object'||!types.has(doc.docType)||!doc.snapshot||!doc.invoiceNo)throw Error('保存済み正式帳票が必要です');
 if(doc.snapshot.invoiceNo!==doc.invoiceNo)throw Error('原本番号が一致しません');
 if(!/^\d{8}-\d{4}-\d{2,}$/.test(doc.invoiceNo))throw Error('帳票番号が不正です');
 if(!Array.isArray(doc.snapshot.items)||doc.snapshot.items.length>100)throw Error('帳票明細が不正です');
 if(typeof doc.snapshot.customerName!=='string'||doc.snapshot.customerName.length>500)throw Error('宛名が不正です');
 return JSON.parse(JSON.stringify(doc));
}
async function renderFormal({origin,document}){
 const doc=validate(document);
 const browser=await(browserPromise||(browserPromise=chromium.launch({headless:true}).catch(e=>{browserPromise=null;throw e})));
 const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true,serviceWorkers:'block'});
 try{
  const p=await context.newPage();
  p.on('dialog',dialog=>dialog.dismiss());
  const base=new URL(origin).origin;
  await p.route('**/*',route=>{
   const u=route.request().url();
   if(u==='https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js')
    return route.fulfill({path:bundle,contentType:'application/javascript'});
   if(u.startsWith(base+'/legacy-pdf/source/'))return route.continue();
   return route.abort();
  });
  await p.goto(origin+'/legacy-pdf/source/index.html',{waitUntil:'load',timeout:20000});
  const filename=await p.evaluate(({snapshot,docType,invoiceNo})=>{
   if(snapshot.invoiceNo!==invoiceNo)throw Error('帳票番号の不一致');
   applyFormState(JSON.parse(JSON.stringify(snapshot)),docType);
   bizSwitchPage('chohyo');
   document.getElementById('previewArea').classList.add('show');
   const invoice=document.querySelector('#previewArea .invoice');
   fitInvoiceToOnePage(invoice,docType);
   const after=collectFormState();
   if(after.invoiceNo!==invoiceNo||after.customerName!==snapshot.customerName||after.docType!==docType)throw Error('保存済み帳票の内容確認に失敗');
   return buildPrintFilename();
  },{snapshot:doc.snapshot,docType:doc.docType,invoiceNo:doc.invoiceNo});
  if(!filename.endsWith('.pdf'))throw Error('原版PDFファイル名に誤り');
  const pending=p.waitForEvent('download',{timeout:30000});
  await p.evaluate(()=>doPrint());
  const download=await pending, file=await download.path();
  const bytes=await fs.readFile(file);
  if(bytes.subarray(0,4).toString('ascii')!=='%PDF')throw Error('PDF出力に失敗');
  return {bytes,filename};
 }finally{await context.close();}
}
async function closeBrowser(){if(browserPromise){const b=await browserPromise;await b.close();browserPromise=null;}}
module.exports={validate,renderFormal,closeBrowser};
