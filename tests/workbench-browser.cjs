'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {serve}=require('../scripts/serve-workbench.cjs');
const create=async()=>{
 const site=await serve(0),browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:800},acceptDownloads:true});
 const page=await context.newPage();
 return {site,browser,context,page,close:async()=>{await context.close();await browser.close();site.server.close();}};
};
test('independent app starts, changes tabs, persists local schedule on reload without Google',async()=>{
 const app=await create();
 try{
  await app.page.goto(app.site.url);
  await assert.doesNotReject(app.page.getByRole('heading',{name:'HOME'}).waitFor());
  await app.page.getByRole('button',{name:'日程',exact:true}).click();
  await app.page.locator('input[name=date]').fill('2026-11-16');
  await app.page.locator('input[name=title]').fill('壁紙張替 確認用');
  await app.page.locator('input[name=customer]').fill('テスト管理会社');
  await app.page.getByRole('button',{name:'日程を保存'}).click();
  assert.match(await app.page.locator('#status').innerText(),/保存しました/);
  await app.page.reload();
  await app.page.getByRole('button',{name:'日程',exact:true}).click();
  assert.match(await app.page.locator('#page').innerText(),/壁紙張替 確認用/);
  assert.match(await app.page.locator('#page').innerText(),/内部/);
  const data=await app.page.evaluate(()=>JSON.parse(localStorage.getItem('linchen_independent_test_v1')));
  assert.equal(Object.keys(data.collections.schedule).length,1);
  assert.equal(data.collections.schedule[Object.keys(data.collections.schedule)[0]].googleEventId,'');
 }finally{await app.close();}
});
test('cash receipt creates sale, confirmed payment and cash entry exactly once, survives reload',async()=>{
 const app=await create();
 try{
  await app.page.goto(app.site.url);
  await app.page.getByRole('button',{name:'帳票',exact:true}).click();
  await app.page.locator('[name=docType]').selectOption('receipt');
  await app.page.locator('[name=customerName]').fill('現金テスト顧客');
  await app.page.locator('[name=amount]').fill('12000');
  await app.page.getByRole('button',{name:'帳票を正式保存'}).click();
  assert.match(await app.page.locator('#status').innerText(),/保存しました/);
  await app.page.reload();
  const data=await app.page.evaluate(()=>JSON.parse(localStorage.getItem('linchen_independent_test_v1')));
  for(const c of ['documents','sales','payments','cashLedger'])assert.equal(Object.keys(data.collections[c]).length,1,c);
  assert.equal(data.collections.payments[Object.keys(data.collections.payments)[0]].confirmation,'cash-received');
  assert.equal(data.collections.cashLedger[Object.keys(data.collections.cashLedger)[0]].amount,12000);
  await app.page.getByRole('button',{name:'HOME'}).click();
  assert.match(await app.page.locator('#page').innerText(),/12,000 円/);
 }finally{await app.close();}
});
test('test delete removes one unlinked customer and never clears all records',async()=>{
 const app=await create();
 try{
  await app.page.goto(app.site.url);
  await app.page.getByRole('button',{name:'設定',exact:true}).click();
  await app.page.locator('input[name=name]').fill('顧客A');
  await app.page.getByRole('button',{name:'取引先を追加'}).click();
  await app.page.locator('input[name=name]').fill('顧客B');
  await app.page.getByRole('button',{name:'取引先を追加'}).click();
  app.page.once('dialog',dialog=>dialog.accept());
  await app.page.getByRole('button',{name:'テスト削除'}).first().click();
  const data=await app.page.evaluate(()=>JSON.parse(localStorage.getItem('linchen_independent_test_v1')));
  assert.equal(Object.keys(data.collections.customers).length,1);
  assert.equal(Object.values(data.collections.customers)[0].name,'顧客B');
 }finally{await app.close();}
});
test('untrusted customer name is displayed as text, never executed',async()=>{
 const app=await create();
 try{
  await app.page.goto(app.site.url);
  await app.page.getByRole('button',{name:'設定',exact:true}).click();
  await app.page.locator('input[name=name]').fill('<img src=x onerror=alert(1)>');
  await app.page.getByRole('button',{name:'取引先を追加'}).click();
  assert.equal(await app.page.locator('#page img').count(),0);
  assert.match(await app.page.locator('#page').innerText(),/<img src=x onerror=alert/);
 }finally{await app.close();}
});
test('test server blocks firebase config and non-app/source files',async()=>{
 const app=await create();
 try{
  const a=await app.page.request.get(app.site.url.replace('/app/index.html','/firebase.json'));
  assert.equal(a.status(),404);
  const b=await app.page.request.get(app.site.url.replace('/app/index.html','/src/core/business.js'));
  assert.equal(b.status(),200);
 }finally{await app.close();}
});

test('calendar business sale can be registered once without any Google event',async()=>{
 const app=await create();
 try{
  await app.page.goto(app.site.url);
  await app.page.getByRole('button',{name:'日程',exact:true}).click();
  await app.page.locator('input[name=date]').fill('2026-11-16');
  await app.page.locator('input[name=title]').fill('内部売上確認');
  await app.page.getByRole('button',{name:'日程を保存'}).click();
  app.page.once('dialog',d=>d.accept('11000'));
  await app.page.getByRole('button',{name:'売上登録',exact:true}).click();
  let data=await app.page.evaluate(()=>JSON.parse(localStorage.getItem('linchen_independent_test_v1')));
  assert.equal(Object.keys(data.collections.sales).length,1);
  assert.equal(Object.keys(data.collections.schedule).length,1);
  assert.equal(Object.values(data.collections.schedule)[0].registeredSaleId,Object.values(data.collections.sales)[0].id);
 }finally{await app.close();}
});
test('bank matching is explicit and never creates a duplicate sale',async()=>{
 const app=await create();
 try{
  await app.page.goto(app.site.url);
  await app.page.getByRole('button',{name:'帳票',exact:true}).click();
  await app.page.locator('[name=docType]').selectOption('invoice');
  await app.page.locator('[name=customerName]').fill('銀行試験先');
  await app.page.locator('[name=amount]').fill('11000');
  await app.page.getByRole('button',{name:'帳票を正式保存'}).click();
  await app.page.getByRole('button',{name:'売上・入金',exact:true}).click();
  await app.page.locator('[name=amount]').fill('11000');
  await app.page.locator('[name=method]').selectOption('銀行振込');
  await app.page.getByRole('button',{name:'入金登録'}).click();
  await app.page.getByRole('button',{name:'銀行照合'}).click();
  await app.page.locator('[name=externalId]').fill('bank-synthetic-1');
  await app.page.locator('[name=description]').fill('テスト入金');
  await app.page.locator('[name=amount]').fill('11000');
  await app.page.getByRole('button',{name:'銀行明細のテスト登録'}).click();
  app.page.on('dialog',d=>d.accept());
  await app.page.getByRole('button',{name:'候補を確認'}).click();
  const data=await app.page.evaluate(()=>JSON.parse(localStorage.getItem('linchen_independent_test_v1')));
  assert.equal(Object.keys(data.collections.sales).length,1);
  assert.equal(Object.values(data.collections.payments)[0].confirmation,'bank-confirmed');
  assert.equal(Object.values(data.collections.bankTransactions)[0].status,'matched');
  assert.equal(Object.keys(data.collections.cashLedger).length,0);
 }finally{await app.close();}
});
