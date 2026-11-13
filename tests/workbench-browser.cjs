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
  await app.page.locator('[name=amount]').fill('10000');
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
  app.page.on('dialog',d=>d.type()==='prompt'?d.accept(d.defaultValue()):d.accept());
  await app.page.getByRole('button',{name:'候補を確認'}).click();
  await app.page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('銀行照合を確定しました')||document.querySelector('#status')?.dataset.error==='true',{timeout:7000});
  assert.match(await app.page.locator('#status').innerText(),/銀行照合を確定しました/);
  const data=await app.page.evaluate(()=>JSON.parse(localStorage.getItem('linchen_independent_test_v1')));
  assert.equal(Object.keys(data.collections.sales).length,1);
  assert.equal(Object.values(data.collections.payments)[0].confirmation,'bank-confirmed');
  assert.equal(Object.values(data.collections.bankTransactions)[0].status,'matched');
  assert.equal(Object.keys(data.collections.cashLedger).length,0);
 }finally{await app.close();}
});

test('every one of eight navigation buttons opens the expected functional workspace',async()=>{
 const app=await create();
 try{
  await app.page.goto(app.site.url);
  for(const name of ['HOME','日程','帳票','帳票履歴','売上・入金','支出・現金','銀行照合','設定']){
   await app.page.getByRole('button',{name,exact:true}).click();
   assert.equal(await app.page.locator('#page h2').innerText(),name);
   assert.equal(await app.page.getByRole('button',{name,exact:true}).getAttribute('aria-current'),'page');
  }
 }finally{await app.close();}
});
test('rapid duplicate receipt form submits commit exactly one receipt/sale/payment/cash row',async()=>{
 const app=await create();
 try{
  await app.page.goto(app.site.url);
  await app.page.getByRole('button',{name:'帳票',exact:true}).click();
  await app.page.locator('[name=docType]').selectOption('receipt');
  await app.page.locator('[name=customerName]').fill('連打確認顧客');
  await app.page.locator('[name=amount]').fill('15000');
  await app.page.locator('form[data-action=document]').evaluate(form=>{
   form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
   form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  });
  await app.page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('保存しました'));
  const data=await app.page.evaluate(()=>JSON.parse(localStorage.getItem('linchen_independent_test_v1')));
  for(const collection of ['documents','sales','payments','cashLedger'])assert.equal(Object.keys(data.collections[collection]).length,1,collection);
 }finally{await app.close();}
});
test('estimated document does not create sales and existing invoice remains unchanged after history navigation',async()=>{
 const app=await create();
 try{
  await app.page.goto(app.site.url);
  await app.page.getByRole('button',{name:'帳票',exact:true}).click();
  await app.page.locator('[name=docType]').selectOption('estimate');
  await app.page.locator('[name=customerName]').fill('見積テスト顧客');
  await app.page.locator('[name=amount]').fill('10000');
  await app.page.getByRole('button',{name:'帳票を正式保存'}).click();
  await app.page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('保存しました'));
  await app.page.getByRole('button',{name:'帳票履歴'}).click();
  assert.match(await app.page.locator('#page').innerText(),/見積テスト顧客/);
  const data=await app.page.evaluate(()=>JSON.parse(localStorage.getItem('linchen_independent_test_v1')));
  assert.equal(Object.keys(data.collections.documents).length,1);
  assert.equal(Object.keys(data.collections.sales).length,0);
 }finally{await app.close();}
});
test('missing bank match candidate does not manufacture payment or expense',async()=>{
 const app=await create();
 try{
  await app.page.goto(app.site.url);
  await app.page.getByRole('button',{name:'銀行照合'}).click();
  await app.page.locator('[name=externalId]').fill('bank-no-target');
  await app.page.locator('[name=description]').fill('候補未登録');
  await app.page.locator('[name=amount]').fill('13000');
  await app.page.getByRole('button',{name:'銀行明細のテスト登録'}).click();
  await app.page.getByRole('button',{name:'候補を確認'}).click();
  assert.match(await app.page.locator('#status').innerText(),/同額の未照合対象がありません/);
  const data=await app.page.evaluate(()=>JSON.parse(localStorage.getItem('linchen_independent_test_v1')));
  assert.equal(Object.keys(data.collections.payments).length,0);
  assert.equal(Object.keys(data.collections.expenses).length,0);
  assert.equal(Object.keys(data.collections.bankTransactions).length,1);
 }finally{await app.close();}
});

test('estimate -> invoice -> bank payment -> receipt -> HOME remains one sale and one payment',async()=>{
 const app=await create();
 try{
  await app.page.goto(app.site.url);
  await app.page.getByRole('button',{name:'帳票',exact:true}).click();
  await app.page.locator('[name=docType]').selectOption('estimate');
  await app.page.locator('[name=customerName]').fill('同一業務テスト');
  await app.page.locator('[name=description]').fill('原本クロス工事');
  await app.page.locator('[name=amount]').fill('10000');
  await app.page.getByRole('button',{name:'帳票を正式保存'}).click();
  await app.page.getByRole('button',{name:'帳票履歴',exact:true}).click();
  app.page.on('dialog',d=>d.type()==='prompt'?d.accept(d.defaultValue()):d.accept());
  await app.page.getByRole('button',{name:'請求書に変換'}).click();
  await app.page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('請求書を発行'));
  let data=await app.page.evaluate(()=>JSON.parse(localStorage.getItem('linchen_independent_test_v1')));
  assert.equal(Object.keys(data.collections.sales).length,1);
  assert.equal(Object.keys(data.collections.documents).length,2);
  await app.page.getByRole('button',{name:'売上・入金',exact:true}).click();
  await app.page.locator('[name=method]').selectOption('銀行振込');
  await app.page.locator('[name=amount]').fill('11000');
  await app.page.getByRole('button',{name:'入金登録'}).click();
  await app.page.getByRole('button',{name:'銀行照合',exact:true}).click();
  await app.page.locator('[name=externalId]').fill('full-chain-bank');
  await app.page.locator('[name=description]').fill('請求入金');
  await app.page.locator('[name=amount]').fill('11000');
  await app.page.getByRole('button',{name:'銀行明細のテスト登録'}).click();
  await app.page.getByRole('button',{name:'候補を確認'}).click();
  await app.page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('銀行照合を確定'));
  await app.page.getByRole('button',{name:'売上・入金',exact:true}).click();
  await app.page.getByRole('button',{name:'領収書発行'}).click();
  await app.page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('領収書を発行'));
  data=await app.page.evaluate(()=>JSON.parse(localStorage.getItem('linchen_independent_test_v1')));
  assert.equal(Object.keys(data.collections.sales).length,1);
  assert.equal(Object.keys(data.collections.documents).length,3);
  assert.equal(Object.keys(data.collections.payments).length,1);
  assert.equal(Object.keys(data.collections.bankTransactions).length,1);
  assert.equal(Object.keys(data.collections.cashLedger).length,0);
  await app.page.getByRole('button',{name:'HOME',exact:true}).click();
  assert.match(await app.page.locator('#page').innerText(),/未入金[\s\S]*0 円/);
 }finally{await app.close();}
});
test('edit cancel and restore expense uses a single cash entry and updates HOME',async()=>{
 const app=await create();
 try{
  await app.page.goto(app.site.url);
  await app.page.getByRole('button',{name:'支出・現金',exact:true}).click();
  await app.page.locator('[name=vendor]').fill('テスト材料屋');
  await app.page.locator('[name=amount]').fill('5000');
  await app.page.locator('[name=paymentMethod]').selectOption('現金');
  await app.page.getByRole('button',{name:'支出登録'}).click();
  await app.page.getByRole('button',{name:'編集'}).click();
  await app.page.locator('[name=amount]').fill('3000');
  await app.page.getByRole('button',{name:'支出を変更'}).click();
  let data=await app.page.evaluate(()=>JSON.parse(localStorage.getItem('linchen_independent_test_v1')));
  assert.equal(Object.keys(data.collections.cashLedger).length,1);
  assert.equal(Object.values(data.collections.cashLedger)[0].amount,3000);
  app.page.on('dialog',d=>d.accept('二重登録'));
  await app.page.getByRole('button',{name:'取消'}).click();
  await app.page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('取消しました'));
  await app.page.getByRole('button',{name:'HOME',exact:true}).click();
  assert.match(await app.page.locator('#page').innerText(),/現金出[\s\S]*0 円/);
  await app.page.getByRole('button',{name:'支出・現金',exact:true}).click();
  await app.page.getByRole('button',{name:'復元'}).click();
  await app.page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('復元しました'));
  data=await app.page.evaluate(()=>JSON.parse(localStorage.getItem('linchen_independent_test_v1')));
  assert.equal(Object.keys(data.collections.cashLedger).length,1);
  assert.equal(Object.values(data.collections.cashLedger)[0].amount,3000);
  await app.page.getByRole('button',{name:'HOME',exact:true}).click();
  assert.match(await app.page.locator('#page').innerText(),/現金出[\s\S]*3,000 円/);
 }finally{await app.close();}
});
test('saved historical document re-downloads real frozen PDF without changing accounting snapshot',async()=>{
 const app=await create();
 try{
  await app.page.goto(app.site.url);
  await app.page.getByRole('button',{name:'帳票',exact:true}).click();
  await app.page.locator('[name=docType]').selectOption('invoice');
  await app.page.locator('[name=customerName]').fill('PDF検証顧客');
  await app.page.locator('[name=amount]').fill('10000');
  await app.page.getByRole('button',{name:'帳票を正式保存'}).click();
  await app.page.reload();
  await app.page.getByRole('button',{name:'帳票履歴',exact:true}).click();
  const before=await app.page.evaluate(()=>localStorage.getItem('linchen_independent_test_v1'));
  const pending=app.page.waitForEvent('download',{timeout:45000});
  await app.page.getByRole('button',{name:'原版PDF'}).click();
  const downloaded=await Promise.race([pending,app.page.waitForFunction(()=>document.querySelector('#status')?.dataset.error==='true',{timeout:40000}).then(async()=>{throw new Error(await app.page.locator('#status').innerText())})]);
  assert(downloaded.suggestedFilename().endsWith('.pdf'));
  const buffer=require('node:fs').readFileSync(await downloaded.path());
  assert.equal(buffer.subarray(0,4).toString('ascii'),'%PDF');
  assert(buffer.length>1000);
  const after=await app.page.evaluate(()=>localStorage.getItem('linchen_independent_test_v1'));
  assert.equal(after,before,'PDF download must be read only');
 }finally{await app.close();}
});
