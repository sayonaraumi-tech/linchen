const {chromium}=require("playwright"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),http=require("node:http");
const root=path.resolve(__dirname,".."),out=path.join(root,"screenshots");
fs.mkdirSync(out,{recursive:true});
const mime={".html":"text/html",".js":"text/javascript",".css":"text/css"};
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,"http://127.0.0.1"),p=path.resolve(root,"."+u.pathname);
  if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return}
  fs.readFile(p,(err,b)=>{if(err){res.writeHead(404).end();return}res.setHeader("Content-Type",mime[path.extname(p)]||"application/octet-stream");res.end(b)});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const origin="http://127.0.0.1:"+server.address().port;
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const page=await browser.newPage({viewport:{width:1512,height:982},deviceScaleFactor:1});
  const failures=[];page.on("pageerror",e=>failures.push(e.message));
  await page.goto(origin+"/index.html",{waitUntil:"networkidle"});
  const expected=["ホーム","日程","見積履歴","帳票","保存帳票","売上・入金","支出・現金","銀行照合","設定"];
  for(let i=0;i<expected.length;i++){
   await page.locator(".navbtn").nth(i).click();
   await page.mouse.move(1250,77);
   await page.waitForTimeout(220);
   const rail=await page.locator("#sidebar").boundingBox();
   const icon=await page.locator(".navbtn.active .nav-icon").boundingBox();
   assert(rail.width===56 && icon.x>=0 && icon.x+icon.width<=56,"Collapsed sidebar must expose active icon");
   assert.equal(await page.locator("#sidebar").evaluate(e=>e.scrollLeft),0,"Sidebar should never scroll horizontally");
   await assert.equal(await page.locator("#pageTitle").innerText(),expected[i]);
   await page.screenshot({path:path.join(out,String(i+1).padStart(2,"0")+"-"+["home","calendar","estimates","documents","saved-documents","sales-payments","expenses-cash","bank-reconciliation","settings"][i]+".png"),fullPage:true});
  }
  await page.locator(".navbtn").nth(8).click();
  await page.locator("#sidebarMode").selectOption("compact");
  await page.locator("#sidebar").hover();
  await page.waitForTimeout(220);
  assert.equal(Math.round((await page.locator("#sidebar").boundingBox()).width),56,"fixed compact sidebar must stay 56px");
  await page.locator("#sidebarMode").selectOption("auto");
  await page.locator("#sidebar").hover();
  await page.waitForTimeout(220);
  assert.equal(Math.round((await page.locator("#sidebar").boundingBox()).width),190,"hover sidebar must expand");
  await page.locator(".navbtn").nth(6).click();
  await page.locator("[data-mode='現金出納帳']").click();
  assert.equal(await page.locator(".sectionhead h2").last().innerText(),"現金出納帳");
  await page.locator("[data-mode='立替管理']").click();
  assert.equal(await page.locator(".sectionhead h2").last().innerText(),"代表者立替");
  await page.locator(".navbtn").nth(7).click();
  await page.locator("#bankFilter").selectOption("未照合");
  assert.equal(await page.locator(".triple tbody tr").count(),3);
  await page.locator(".navbtn").nth(5).click();
  await page.locator(".content-table tbody tr").nth(1).click();
  assert.match(await page.locator("#content").innerText(),/INV-026-102/);
  await page.locator(".navbtn").nth(3).click();
  await page.locator('[data-action="sandbox-receipt"]').click();
  await page.waitForFunction(()=>globalThis.TsukinowaSandbox?.counts().sales===1,{timeout:10000});
  const totals=await page.evaluate(()=>globalThis.TsukinowaSandbox.counts());
  assert.equal(totals.sales,1);assert.equal(totals.payments,1);assert.equal(totals.cashLedger,1);
  assert.equal(failures.length,0,"Browser JS errors: "+failures.join("; "));
  console.log("PASS: nine real screenshots, page navigation, sidebar, cash tabs, bank filter, row detail. Output: screenshots/");
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});