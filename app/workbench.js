/* Stage 5 isolated interactive test harness. Not the final stage 6 UI.
 * Uses ONLY the existing domain and sandbox adapters: no accounting in views.
 */
(function(){
'use strict';
const B=globalThis.TsukinowaCoreBusiness;
const Calendar=globalThis.TsukinowaScheduleCalendar;
const Sandbox=globalThis.TsukinowaSandboxStorage;
if(!B||!Calendar||!Sandbox)throw Error('Required domain runtime missing');
const store=Sandbox.createSandboxStore({storage:localStorage,key:'linchen_independent_test_v1'});
const root=document.getElementById('page'),status=document.getElementById('status');
let current='home',seq=0;
const esc=x=>String(x??'').replace(/[&<>"']/g,k=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[k]));
const amount=x=>Number(x||0).toLocaleString('ja-JP')+' 円';
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const field=(name,label,type='text',value='',required=true)=>'<label>'+esc(label)+'<input name="'+esc(name)+'" type="'+esc(type)+'" value="'+esc(value)+'" '+(required?'required':'')+'></label>';
const select=(name,label,options)=>'<label>'+esc(label)+'<select name="'+esc(name)+'">'+options.map(([v,t])=>'<option value="'+esc(v)+'">'+esc(t)+'</option>').join('')+'</select></label>';
function form(id,inputs,label){return '<form data-action="'+esc(id)+'">'+inputs+'<button type="submit">'+esc(label)+'</button></form>';}
function grid(head,rows){return '<div class="table-scroller"><table><thead><tr>'+head.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';}
const td=values=>'<tr>'+values.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>';
const button=(action,id,label)=>'<button type="button" data-action="'+esc(action)+'" data-id="'+esc(id)+'">'+esc(label)+'</button>';
function snapshot(){return store.snapshot()}
function list(kind){return B.list(snapshot(),kind)}
function notice(message,error=false){status.textContent=message;status.dataset.error=error?'true':'false'}
function page(title,description,body){return '<h2>'+esc(title)+'</h2><p class="note">'+esc(description)+'</p>'+body;}
function home(){
 const s=snapshot(),v=B.getOverview(s);
 const props=[['売上',v.sales],['確認済入金',v.confirmedPayments],['未入金',v.outstanding],['支出',v.expenses],['現金入',v.cashIn],['現金出',v.cashOut]];
 return page('HOME','テスト領域内の全期間集計。銀行・プラットフォーム明細の二重計上は行いません。','<div class="metrics">'+props.map(([k,n])=>'<div class="metric">'+esc(k)+'<b>'+esc(amount(n))+'</b></div>').join('')+'</div><h3>データ数</h3>'+grid(['種別','件数'],B.COLLECTIONS.filter(c=>c!=='auditLogs').map(c=>td([c,list(c).length]))));
}
function schedule(){
 const s=snapshot(),month=document.getElementById('calendar-month')?.value||today().slice(0,7);
 const monthView=Calendar.calendarMonth(s,month);
 const inputs=field('date','施工日','date',today())+field('title','予定名')+field('customer','取引先','text','',false)+field('description','内容','text','',false);
 const cells=monthView.cells.map(c=>'<div class="day'+(c.inMonth?'':' outside')+'" data-date="'+esc(c.date)+'"><b>'+esc(c.day)+'</b>'+c.events.map(e=>'<div class="event">'+esc(e.title)+'<small> '+esc(e.status)+'</small></div>').join('')+'</div>').join('');
 const rows=list('schedule').filter(x=>x.status==='active').map(e=>'<tr><td>'+esc(e.date)+'</td><td>'+esc(e.title)+'</td><td>'+esc(e.customer||'')+'</td><td>'+esc(e.registeredSaleId?'売上登録済':'予定')+'</td><td>'+esc(e.googleEventId?'Google連携':'内部')+'</td><td>'+esc(e.id)+'</td><td>'+(e.registeredSaleId?'登録済':button('schedule-sale',e.id,'売上登録'))+'</td></tr>');
 return page('日程','内部日程が主データです。Google Calendar は不要で、無接続でも追加・表示できます。',
 '<label>対象月<input type="month" id="calendar-month" value="'+esc(month)+'"></label><div class="day-grid">'+cells+'</div>'+
 form('schedule',inputs,'日程を保存')+grid(['日付','件名','取引先','状態','由来','ID','操作'],rows));
}
function documents(){
 const inputs=select('docType','帳票種別',[['estimate','見積書'],['invoice','請求書'],['receipt','領収書'],['onoda','小野田']])+
 field('customerName','宛名')+field('invoiceDate','発行日','date',today())+
 field('amount','入力金額（見積・請求=税抜、領収=受領税込）','number','10000')+field('description','工事内容','text','壁紙補修')+
 select('paymentMethod','受領方法',[['現金','現金'],['銀行振込','銀行振込']]);
 return page('帳票','この画面は帳票レコードの保存動作を検証します。PDFの原版レイアウト・実際の印刷機能は別のPDFテストで検証します。',
 form('document',inputs,'帳票を正式保存')+
 '<p class="note">見積書は売上を作成しません。独立した領収書は現金のみ登録できます。銀行振込の領収書は既存売上・入金との明示的な関連が必要です。</p>');
}
function history(){
 const docs=list('documents').sort((a,b)=>b.issueDate.localeCompare(a.issueDate));
 const rows=docs.map(d=>'<tr><td>'+esc(d.invoiceNo)+'</td><td>'+esc(d.docType)+'</td><td>'+esc(d.customer)+'</td><td>'+esc(amount(d.amount))+'</td><td>'+esc(d.status)+'</td><td>'+esc(d.id)+'</td><td>'+button('voidDocument',d.id,'無効化')+' '+button('deleteTestRecord',d.id,'テスト削除')+'</td></tr>');
 return page('帳票履歴','確定帳票の番号と内容を保持。過去帳票の無効化は理由が必要です。',
 grid(['帳票番号','種別','宛名','金額','状態','ID','操作'],rows));
}
function sales(){
 const s=list('sales').filter(x=>x.status==='active'),payments=list('payments');
 const input=select('saleId','売上',s.map(x=>[x.id,x.customer+' '+amount(x.amount)]))+
 field('amount','入金額','number','1000')+field('paymentDate','入金日','date',today())+
 select('method','方法',[['現金','現金'],['銀行振込','銀行振込']]);
 const rows=s.map(x=>{const pay=payments.filter(p=>p.saleId===x.id&&p.status==='active'&&['cash-received','bank-confirmed'].includes(p.confirmation)).reduce((v,p)=>v+p.amount,0);return td([x.salesDate,x.customer,amount(x.amount),amount(pay),amount(x.amount-pay),x.id])});
 return page('売上・入金','売上と入金を別記録で管理。現金は現金台帳と連動し、銀行振込は照合前は未入金。',
 (s.length?form('payment',input,'入金登録'):'<p>まず請求書を作成してください。</p>')+
 grid(['売上日','宛名','売上','確認済入金','未収','ID'],rows));
}
function expenses(){
 const input=field('expenseDate','支出日','date',today())+field('vendor','支払先')+
 field('category','勘定科目','text','材料費')+field('amount','金額','number','1000')+
 select('paymentMethod','支払方法',[['現金','現金'],['銀行振込','銀行振込'],['法人信用カード','法人信用カード']]);
 const expenses=list('expenses');
 const rows=expenses.map(e=>'<tr><td>'+esc(e.expenseDate)+'</td><td>'+esc(e.vendor)+'</td><td>'+esc(e.category)+'</td><td>'+esc(amount(e.amount))+'</td><td>'+esc(e.paymentMethod)+'</td><td>'+esc(e.status)+'</td><td>'+button('expense-delete',e.id,'テスト削除')+'</td></tr>');
 const cash=list('cashLedger').filter(e=>!e.deletedAt);
 return page('支出・現金','現金支出は一件の現金台帳に鏡映。重複計上しません。',
 form('expense',input,'支出登録')+grid(['日付','支払先','科目','金額','方法','状態','操作'],rows)+
 '<h3>現金台帳</h3>'+grid(['日付','区分','金額','元ID'],cash.map(x=>td([x.date,x.type,amount(x.amount),x.sourceId]))));
}
function bank(){
 const input=field('account','口座','text','GMO')+field('externalId','明細識別子')+field('date','取引日','date',today())+
 field('description','摘要')+field('amount','金額','number','1000')+
 select('direction','入出金',[['income','入金'],['outgoing','出金']]);
 const banks=list('bankTransactions');
 const rows=banks.map(x=>'<tr><td>'+esc(x.date)+'</td><td>'+esc(x.description)+'</td><td>'+esc(amount(x.amount))+'</td><td>'+esc(x.direction)+'</td><td>'+esc(x.status)+'</td><td>'+esc(x.id)+'</td><td>'+(x.status==='matched'?button('bank-unmatch',x.id,'照合解除'):button('bank-match',x.id,'候補を確認'))+'</td></tr>');
 return page('銀行照合','銀行明細は入出金の証拠。登録だけでは売上や支出を作りません。候補を確認し、明示的な承認があって初めて既存の入金・支出と照合します。',
 form('bank',input,'銀行明細のテスト登録')+grid(['日付','摘要','金額','入出金','状態','ID','操作'],rows));
}
function settings(){
 const input=field('key','設定名','text','memo')+field('value','設定値','text','test');
 const customer=field('name','取引先名')+field('address','住所','text','',false);
 const customers=list('customers');
 return page('設定','独立テストデータのみ。旧システムの設定値は取得・上書きしません。',
 form('setting',input,'設定を保存')+form('customer',customer,'取引先を追加')+
 grid(['名前','住所','ID','操作'],customers.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.address)+'</td><td>'+esc(x.id)+'</td><td>'+button('customer-delete',x.id,'テスト削除')+'</td></tr>'))+
 '<button type="button" data-action="backup">テストデータのバックアップを保存</button>');
}
const views={home,schedule,documents,history,sales,expenses,bank,settings};
function render(pageId=current){
 if(!views[pageId])throw Error('Unknown view');
 current=pageId;root.innerHTML=views[pageId]();
 document.querySelectorAll('#nav button').forEach(b=>b.setAttribute('aria-current',b.dataset.page===current?'page':'false'));
}
let serial=0;
function operationId(){serial++;return 'browser_'+Date.now().toString(36)+'_'+serial+'_'+Math.random().toString(36).slice(2,12)}
function val(data,key){return String(data.get(key)??'').trim()}
async function submit(form){
 const data=new FormData(form),action=form.dataset.action;
 let command;
 switch(action){
 case 'schedule':command={type:'saveSchedule',date:val(data,'date'),title:val(data,'title'),customer:val(data,'customer'),description:val(data,'description')};break;
 case 'document':{
  const type=val(data,'docType'),amountValue=Number(val(data,'amount'));
  const customer=val(data,'customerName'),date=val(data,'invoiceDate'),description=val(data,'description');
  const gross=type==='receipt'?amountValue:amountValue+Math.round(amountValue*0.1);
  command={type:'issueDocument',docType:type,sourceKey:'test_'+operationId(),amount:gross,
   snapshot:{customerName:customer,invoiceDate:date,items:[{content:description,qty:1,price:amountValue,taxable:true,unit:'式'}],
    receiptTotal:amountValue,paymentMethod:val(data,'paymentMethod'),tadashi:description,carryoverAmount:0}};
  break;
 }
 case 'payment':command={type:'registerPayment',saleId:val(data,'saleId'),amount:Number(val(data,'amount')),paymentDate:val(data,'paymentDate'),method:val(data,'method')};break;
 case 'expense':command={type:'saveExpense',expenseDate:val(data,'expenseDate'),vendor:val(data,'vendor'),category:val(data,'category'),amount:Number(val(data,'amount')),paymentMethod:val(data,'paymentMethod')};break;
 case 'bank':command={type:'importBankTransaction',account:val(data,'account'),externalId:val(data,'externalId'),date:val(data,'date'),description:val(data,'description'),amount:Number(val(data,'amount')),direction:val(data,'direction')};break;
 case 'setting':command={type:'saveSettings',key:val(data,'key'),value:val(data,'value')};break;
 case 'customer':command={type:'saveCustomer',name:val(data,'name'),address:val(data,'address')};break;
 default:throw Error('Unsupported form action');
 }
 await store.perform({...command,operationId:operationId()});
 notice('テスト領域に保存しました：'+action);
 render(current);
}
async function clickAction(btn){
 const action=btn.dataset.action,id=btn.dataset.id;
 if(action==='backup'){
  const blob=new Blob([store.exportBackup()],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='linchen-test-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);
  notice('テストバックアップを書き出しました');return;
 }
 if(action==='schedule-sale'){
  const amountText=prompt('工事売上の税込金額（円）');
  if(amountText===null)return;
  if(!/^\d+$/.test(amountText.trim()))throw Error('税込金額は円単位の正数で指定してください');
  const ev=list('schedule').find(x=>x.id===id);
  if(!ev)throw Error('予定が見つかりません');
  await store.perform({type:'registerScheduleSale',operationId:operationId(),scheduleId:id,amount:Number(amountText),salesDate:ev.date});
  notice('同じ日程に売上を関連付けました');render();return;
 }
 if(action==='bank-match'){
  const bank=list('bankTransactions').find(x=>x.id===id);
  if(!bank||bank.status!=='unmatched')throw Error('未照合の銀行明細が必要です');
  const pool=bank.direction==='income'?list('payments').filter(x=>x.status==='active'&&x.confirmation==='pending-bank'&&!x.bankTxnId&&x.amount===bank.amount)
   :list('expenses').filter(x=>x.status==='active'&&x.paymentMethod!=='現金'&&!x.bankTxnId&&x.amount===bank.amount);
  if(!pool.length)throw Error('同額の未照合対象がありません。新規入金や支出は自動作成しません');
  const choice=prompt('対象IDを入力してください（候補: '+pool.map(x=>x.id).join(', ')+'）',pool.length===1?pool[0].id:'');
  if(!choice)return;
  if(!pool.some(x=>x.id===choice))throw Error('候補に存在しないIDです');
  if(!confirm('銀行証拠を既存の'+(bank.direction==='income'?'入金':'支出')+'に照合します。金額：'+amount(bank.amount)+'。確定しますか？'))return;
  const command=bank.direction==='income'?{type:'matchBankPayment',bankTxnId:id,paymentId:choice}:{type:'matchBankExpense',bankTxnId:id,expenseId:choice};
  await store.perform({...command,operationId:operationId()});notice('銀行照合を確定しました');render();return;
 }
 if(action==='bank-unmatch'){
  if(!confirm('この銀行明細の照合を解除しますか？'))return;
  await store.perform({type:'unmatchBank',bankTxnId:id,operationId:operationId()});
  notice('照合を解除しました');render();return;
 }
  const map={ 'customer-delete':'customers','expense-delete':'expenses'};
 if(action==='deleteTestRecord'||map[action]){
  const collection=map[action]||'documents';
  if(!confirm('テストデータの対象1件だけ削除します。ID: '+id+'。関連記録がある場合は削除できません。'))return;
  await store.perform({type:'deleteTestRecord',operationId:operationId(),collection,id,confirmTestDeletion:true});
  notice('指定されたテスト記録1件を削除しました');render();return;
 }
 if(action==='voidDocument'){
  const reason=prompt('無効理由を記入してください');
  if(!reason)return;
  await store.perform({type:'voidDocument',operationId:operationId(),documentId:id,reason});
  notice('帳票を無効化しました。原記録と監査は保持します。');render();return;
 }
 throw Error('Unsupported button action');
}
document.addEventListener('click',async e=>{
 const btn=e.target.closest('button');if(!btn)return;
 try{if(btn.dataset.page){render(btn.dataset.page);notice('');}
 else if(btn.dataset.action){await clickAction(btn);}}
 catch(error){notice(error.message,true);}
});
document.addEventListener('submit',async e=>{
 if(!e.target.matches('form[data-action]'))return;
 e.preventDefault();
 try{await submit(e.target);}catch(error){notice(error.message,true);}
});
document.addEventListener('change',e=>{
 if(e.target.id==='calendar-month')render('schedule');
});
render('home');
})();
