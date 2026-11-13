/* Independent headless business model for Tsukinowa construction.
 * No Firebase, DOM, PDF engine, or production data dependencies.
 * Prototype API; persistence adapters and PDF integration are separate stages.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TsukinowaCoreBusiness=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const COLLECTIONS=Object.freeze(['settings','customers','projects','schedule','documents','sales','payments','expenses','cashLedger','bankTransactions','auditLogs']);
const TYPES=Object.freeze(['estimate','invoice','receipt','onoda']);
const clone=x=>JSON.parse(JSON.stringify(x));
const yen=x=>{if(typeof x==='string'&&!/^\d+$/.test(x.trim()))throw Error('金額は円単位の整数で入力してください');const n=Number(x);if(!Number.isSafeInteger(n)||n<0)throw Error('金額は0以上の安全な整数を指定してください');return n;};
const text=(v,k)=>{let s=String(v??'').trim();if(!s)throw Error(k+'は必須です');return s;};
const date=(v,k='日付')=>{const s=text(v,k);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw Error(k+'の形式が不正です');return s;};
const active=r=>!!r&&!r.deletedAt&&r.status!=='void'&&r.status!=='cancelled';
const BANK_PENDING='pending-bank',BANK_CONFIRMED='bank-confirmed',CASH='cash-received';
function emptyState(scope='test'){
 if(!['test','production'].includes(scope))throw Error('Invalid scope');
 return {schemaVersion:1,scope,collections:Object.fromEntries(COLLECTIONS.map(k=>[k,{}])),operationIds:{},seq:0};
}
function assertState(s){if(!s||s.schemaVersion!==1||!s.collections||!COLLECTIONS.every(k=>s.collections[k]))throw Error('Unsupported state');}
function idFor(s,prefix){s.seq++;return prefix+'_'+String(s.seq).padStart(6,'0');}
function sum(rs){return rs.reduce((n,r)=>n+yen(r.amount),0);}
function rows(s,c){return Object.values(s.collections[c]);}
function row(s,c,id){return s.collections[c][id]||null;}
function write(s,c,record){if(!COLLECTIONS.includes(c))throw Error('Unsupported collection');s.collections[c][record.id]=record;return record;}
function requireRow(s,c,id){const r=row(s,c,id);if(!active(r))throw Error(c+'の対象レコードがありません: '+id);return r;}
function registerSale(s,sourceId,attrs){
 const found=rows(s,'sales').find(r=>active(r)&&r.sourceId===sourceId);
 if(found)return found;
 return write(s,'sales',{id:idFor(s,'sale'),sourceId,customer:attrs.customer||'',description:attrs.description||'',amount:yen(attrs.amount),salesDate:date(attrs.salesDate),invoiceDate:attrs.invoiceDate?date(attrs.invoiceDate):'',documentId:attrs.documentId||'',scheduleId:attrs.scheduleId||'',status:'active'});
}
function totalPayments(s,saleId){return sum(rows(s,'payments').filter(p=>active(p)&&p.saleId===saleId&&[BANK_CONFIRMED,CASH].includes(p.confirmation)));}
function balance(s,saleId){const sale=requireRow(s,'sales',saleId);return sale.amount-totalPayments(s,saleId);}
function mirrorCash(s,sourceType,source){
 const key='cash_'+source.id;const cash=s.collections.cashLedger[key];
 const eligible=active(source)&&(sourceType==='payments'?source.confirmation===CASH:source.paymentMethod==='現金');
 if(!eligible){if(cash)cash.deletedAt='void';return null;}
 if(cash){Object.assign(cash,{amount:source.amount,date:sourceType==='payments'?source.paymentDate:source.expenseDate,deletedAt:null});return cash;}
 return write(s,'cashLedger',{id:key,type:sourceType==='payments'?'income':'expense',date:sourceType==='payments'?source.paymentDate:source.expenseDate,amount:yen(source.amount),sourceType,sourceId:source.id,deletedAt:null});
}
function payment(s,input){
 const sale=requireRow(s,'sales',input.saleId);
 const amount=yen(input.amount);if(!amount)throw Error('入金額は正数です');
 const method=text(input.method,'入金方法'),payDate=date(input.paymentDate,'入金日');
 const confirmation=method==='現金'?CASH:BANK_PENDING;
 if(input.sourceDocumentId){
  const old=rows(s,'payments').find(p=>active(p)&&p.sourceDocumentId===input.sourceDocumentId);
  if(old){if(old.saleId!==sale.id||old.amount!==amount)throw Error('領収書に関連した既存入金が一致しません');return old;}
 }
 const p=write(s,'payments',{id:idFor(s,'pay'),saleId:sale.id,sourceDocumentId:input.sourceDocumentId||'',amount,method,paymentDate:payDate,confirmation,bankTxnId:'',status:'active'});
 mirrorCash(s,'payments',p);
 return p;
}
function issue(s,x){
 if(!TYPES.includes(x.docType))throw Error('帳票種類が不正です');
 const snapshot=clone(x.snapshot||{});
 const customer=text(snapshot.customerName,'宛名'),issueDate=date(snapshot.invoiceDate,'発行日');
 const docType=x.docType;const items=Array.isArray(snapshot.items)?clone(snapshot.items):[];
 const amount=docType==='receipt'?yen(snapshot.receiptTotal):yen(x.amount);
 if(!amount)throw Error('帳票金額は正数です');
 const sourceKey=x.sourceKey?text(x.sourceKey,'帳票参照'):'';
 const existing=sourceKey?rows(s,'documents').find(d=>active(d)&&d.sourceKey===sourceKey&&d.docType===docType):null;
 if(existing){if(existing.amount!==amount||JSON.stringify(existing.snapshot)!==JSON.stringify(snapshot))throw Error('発行済帳票の修正は訂正版を作成してください');return {document:existing,saleId:existing.saleId,paymentId:existing.paymentId,reused:true};}
 let sale=null,pay=null;
 if(docType==='invoice'||docType==='onoda'){
  const source=x.scheduleId?'schedule:'+x.scheduleId:sourceKey?'invoice:'+sourceKey:'document:'+String(s.seq+1);
  sale=registerSale(s,source,{customer,amount,salesDate:x.salesDate||issueDate,invoiceDate:issueDate,description:items.map(i=>i.content).join(' / '),scheduleId:x.scheduleId||''});
  if(sale.amount!==amount)throw Error('関連売上の金額が一致しません');
 }
 if(docType==='receipt'){
  if(x.saleId){sale=requireRow(s,'sales',x.saleId);}
  else sale=registerSale(s,'receipt:'+String(s.seq+1),{customer,amount,salesDate:issueDate,invoiceDate:'',description:snapshot.tadashi||''});
  pay=payment(s,{saleId:sale.id,amount,method:text(snapshot.paymentMethod,'入金方法'),paymentDate:issueDate,sourceDocumentId:sourceKey||'receipt:'+String(s.seq+1)});
 }
 const doc=write(s,'documents',{id:idFor(s,'doc'),docType,sourceKey,customer,issueDate,amount,snapshot,items,saleId:sale?.id||'',paymentId:pay?.id||'',scheduleId:x.scheduleId||'',status:'active',revisionOf:''});
 if(sale&&!sale.documentId)sale.documentId=doc.id;
 if(pay&&!pay.sourceDocumentId)pay.sourceDocumentId=doc.id;
 return {document:doc,saleId:sale?.id||'',paymentId:pay?.id||'',reused:false};
}
function operate(s,cmd){
 const c=cmd||{},t=text(c.type,'操作種別');let a;
 switch(t){
 case 'saveSettings':{
  const key=text(c.key,'設定名');
  a=write(s,'settings',{id:key,key,value:clone(c.value),status:'active'});break;}
 case 'saveCustomer':{
  const name=text(c.name,'顧客名'),id=c.id||idFor(s,'customer');
  const old=row(s,'customers',id);a=write(s,'customers',{...old,id,name,address:String(c.address||''),status:'active'});break;}
 case 'saveProject':{
  const id=c.id||idFor(s,'project');
  a=write(s,'projects',{id,customer:text(c.customer,'顧客'),description:String(c.description||''),status:'active'});break;}
 case 'saveSchedule':{
  const id=c.id||idFor(s,'event'),old=row(s,'schedule',id);
  if(old?.registeredSaleId&&c.projectId&&c.projectId!==old.projectId)throw Error('売上登録済みの工事は案件変更できません');
  a=write(s,'schedule',{...old,id,date:date(c.date,'施工日'),title:text(c.title,'予定名'),customer:String(c.customer||''),description:String(c.description||''),projectId:String(c.projectId||old?.projectId||''),googleEventId:String(c.googleEventId||old?.googleEventId||''),registeredSaleId:old?.registeredSaleId||'',status:'active'});break;}
 case 'registerScheduleSale':{
  const ev=requireRow(s,'schedule',c.scheduleId);
  if(ev.registeredSaleId){a=requireRow(s,'sales',ev.registeredSaleId);break;}
  a=registerSale(s,'schedule:'+ev.id,{customer:ev.customer||ev.title,amount:c.amount,salesDate:c.salesDate||ev.date,description:ev.description,scheduleId:ev.id});
  ev.registeredSaleId=a.id;break;}
 case 'issueDocument':a=issue(s,c);break;
 case 'registerPayment':a=payment(s,c);break;
 case 'saveExpense':{
  const amount=yen(c.amount);if(!amount)throw Error('支出金額は正数です');
  const id=c.id||idFor(s,'exp'),old=row(s,'expenses',id);
  if(old?.bankTxnId)throw Error('銀行照合を解除してから支出を訂正してください');
  a=write(s,'expenses',{...old,id,expenseDate:date(c.expenseDate,'支出日'),vendor:text(c.vendor,'取引先'),description:String(c.description||''),category:text(c.category,'科目'),amount,paymentMethod:text(c.paymentMethod,'支払方法'),bankTxnId:'',status:'active'});
  mirrorCash(s,'expenses',a);break;}
 case 'importBankTransaction':{
  const account=text(c.account,'銀行口座'),externalId=text(c.externalId,'銀行明細識別子');
  const match=rows(s,'bankTransactions').find(b=>b.account===account&&b.externalId===externalId);
  const amount=yen(c.amount);if(!amount)throw Error('銀行金額は正数です');
  if(match){if(match.amount!==amount||match.direction!==c.direction)throw Error('同じ銀行明細識別子の内容が異なります');a={transaction:match,reused:true};break;}
  if(!['income','outgoing'].includes(c.direction))throw Error('入出金区分が不正です');
  const transaction=write(s,'bankTransactions',{id:idFor(s,'bank'),account,externalId,date:date(c.date,'銀行日付'),description:String(c.description||''),amount,direction:c.direction,matchType:'',matchId:'',status:'unmatched'});
  a={transaction,reused:false};break;}
 case 'matchBankPayment':{
  const b=requireRow(s,'bankTransactions',c.bankTxnId),p=requireRow(s,'payments',c.paymentId);
  if(b.direction!=='income'||b.status!=='unmatched'||p.confirmation!==BANK_PENDING||p.bankTxnId||b.amount!==p.amount)throw Error('入金照合条件が一致しません');
  if(!active(row(s,'sales',p.saleId)))throw Error('売上が無効です');
  b.status='matched';b.matchType='payment';b.matchId=p.id;p.bankTxnId=b.id;p.confirmation=BANK_CONFIRMED;p.paymentDate=b.date;a={bank:b,payment:p};break;}
 case 'matchBankExpense':{
  const b=requireRow(s,'bankTransactions',c.bankTxnId),e=requireRow(s,'expenses',c.expenseId);
  if(b.direction!=='outgoing'||b.status!=='unmatched'||e.paymentMethod==='現金'||e.bankTxnId||b.amount!==e.amount)throw Error('出金照合条件が一致しません');
  b.status='matched';b.matchType='expense';b.matchId=e.id;e.bankTxnId=b.id;a={bank:b,expense:e};break;}
 case 'unmatchBank':{
  const b=requireRow(s,'bankTransactions',c.bankTxnId);
  if(b.status!=='matched')throw Error('未照合の明細です');
  if(b.matchType==='payment'){const p=requireRow(s,'payments',b.matchId);p.bankTxnId='';p.confirmation=BANK_PENDING;}
  if(b.matchType==='expense'){const e=requireRow(s,'expenses',b.matchId);e.bankTxnId='';}
  b.status='unmatched';b.matchType='';b.matchId='';a=b;break;}
 case 'voidRecord':{
  if(!['documents','sales','payments','expenses','schedule','projects'].includes(c.collection))throw Error('取消対象外です');
  const target=requireRow(s,c.collection,c.id);text(c.reason,'取消理由');
  if(c.collection==='sales'&&totalPayments(s,target.id)>0)throw Error('入金がある売上は先に入金を整理してください');
  if(c.collection==='payments'&&target.bankTxnId)throw Error('銀行照合を先に解除してください');
  if(c.collection==='documents'&&(target.saleId||target.paymentId))throw Error('売上・入金と関連する正式帳票は専用の訂正・取消処理が必要です');
  if(c.collection==='sales'&&rows(s,'documents').some(d=>active(d)&&d.saleId===target.id))throw Error('発行済帳票と関連する売上は直接取消できません');
  if(c.collection==='schedule'&&target.registeredSaleId)throw Error('売上登録済みの予定は直接削除できません');
  target.status='void';target.voidReason=c.reason;
  if(c.collection==='payments')mirrorCash(s,'payments',target);
  if(c.collection==='expenses')mirrorCash(s,'expenses',target);
  a=target;break;}
 case 'deleteTestRecord':{
  if(s.scope!=='test')throw Error('正式データを物理削除できません');
  if(!c.confirmTestDeletion)throw Error('テスト削除を明示確認してください');
  if(!COLLECTIONS.includes(c.collection)||c.collection==='auditLogs')throw Error('削除できない種別です');
  const target=requireRow(s,c.collection,c.id);
  const related={sales:()=>rows(s,'payments').some(p=>active(p)&&p.saleId===target.id),
    payments:()=>rows(s,'cashLedger').some(p=>active(p)&&p.sourceId===target.id),
    expenses:()=>rows(s,'cashLedger').some(p=>active(p)&&p.sourceId===target.id),
    documents:()=>rows(s,'sales').some(p=>active(p)&&p.documentId===target.id)||rows(s,'payments').some(p=>active(p)&&p.sourceDocumentId===target.sourceKey),
    projects:()=>rows(s,'schedule').some(p=>active(p)&&p.projectId===target.id),
    customers:()=>rows(s,'projects').some(p=>active(p)&&p.customer===target.name),
    schedule:()=>rows(s,'sales').some(p=>active(p)&&p.scheduleId===target.id),
    bankTransactions:()=>target.status==='matched'};
  if(related[c.collection]?.())throw Error('関連記録が存在するため先に関連を解除してください');
  delete s.collections[c.collection][c.id];a={deletedId:c.id,collection:c.collection};break;}
 default:throw Error('Unsupported operation: '+t);
 }
 return a;
}
function perform(state,command){
 assertState(state);const c=clone(command||{});const operationId=text(c.operationId,'操作ID');
 if(state.operationIds[operationId])return {state:clone(state),result:clone(state.operationIds[operationId].result),reused:true};
 const candidate=clone(state);const result=operate(candidate,c);
 candidate.operationIds[operationId]={result:clone(result),type:c.type};
 write(candidate,'auditLogs',{id:idFor(candidate,'audit'),operationId,action:c.type,targetId:result?.id||result?.document?.id||result?.payment?.id||result?.deletedId||'',scope:candidate.scope});
 return {state:candidate,result:clone(result),reused:false};
}
function getOverview(s){
 assertState(s);const sales=rows(s,'sales').filter(active),expenses=rows(s,'expenses').filter(active),payments=rows(s,'payments').filter(p=>active(p)&&[CASH,BANK_CONFIRMED].includes(p.confirmation));
 const cash=rows(s,'cashLedger').filter(active);
 return {sales:sum(sales),confirmedPayments:sum(payments),outstanding:sales.reduce((n,x)=>n+x.amount-totalPayments(s,x.id),0),expenses:sum(expenses),cashIn:sum(cash.filter(x=>x.type==='income')),cashOut:sum(cash.filter(x=>x.type==='expense')),salesCount:sales.length,expenseCount:expenses.length};
}
function list(s,collection){assertState(s);if(!COLLECTIONS.includes(collection))throw Error('Unsupported collection');return clone(rows(s,collection));}
return {COLLECTIONS,TYPES,emptyState,perform,list,getOverview,balance};
});
