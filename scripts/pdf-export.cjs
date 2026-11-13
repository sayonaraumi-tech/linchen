/* Local-only PDF service. Exact legacy frozen HTML renderer.
 * No bookkeeping writes, no remote fetch, no production auth/config.
 */
'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const frozen=path.resolve(__dirname,'../legacy-pdf/source');
let rendererServer=null;
async function rendererOrigin(){
 if(rendererServer)return rendererServer.url;
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.method!=='GET'){res.writeHead(405).end();return;}
   const pathname=new URL(req.url,'http://127.0.0.1').pathname;
   if(pathname==='/firebase-config.json'){res.writeHead(200,{'Content-Type':'application/json'}).end('{"enabled":false}');return;}
   const file=path.resolve(frozen,'.'+(pathname==='/'?'/index.html':pathname));
   if(!file.startsWith(frozen+path.sep)){res.writeHead(403).end();return;}
   const ext=path.extname(file);
   const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'}[ext];
   if(!mime){res.writeHead(403).end();return;}
   res.writeHead(200,{'Content-Type':mime});res.end(await fs.readFile(file));
  }catch{res.writeHead(404).end('Not Found');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 rendererServer={server,url:'http://127.0.0.1:'+server.address().port};
 return rendererServer.url;
}
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
async function renderFormal({document}){
 const doc=validate(document);
 const origin=await rendererOrigin();
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
   if(u.startsWith(base+'/'))return route.continue();
   return route.abort();
  });
  await p.goto(origin+'/',{waitUntil:'load',timeout:20000});
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
async function closeBrowser(){if(browserPromise){const b=await browserPromise;await b.close();browserPromise=null;}if(rendererServer){await new Promise(resolve=>rendererServer.server.close(resolve));rendererServer=null;}}
module.exports={validate,renderFormal,closeBrowser};
