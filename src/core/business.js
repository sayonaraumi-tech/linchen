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
const Numbering=typeof module==='object'&&module.exports?require('./document-numbering'):globalThis.TsukinowaDocumentNumbers;
const COLLECTIONS=Object.freeze(['settings','customers','projects','schedule','documents','sales','payments','expenses','cashLedger','bankTransactions','suppliers','supplierTransactions','auditLogs']);
const TYPES=Object.freeze(['estimate','invoice','receipt','onoda']);
const clone=x=>JSON.parse(JSON.stringify(x));
const yen=x=>{if(typeof x==='string'&&!/^\d+$/.test(x.trim()))throw Error('金額は円単位の整数で入力してください');const n=Number(x);if(!Number.isSafeInteger(n)||n<0)throw Error('金額は0以上の安全な整数を指定してください');return n;};
const signedYen=x=>{if(typeof x==='string'&&!/^-?\d+$/.test(x.trim()))throw Error('残高は円単位の整数で入力してください');const n=Number(x);if(!Number.isSafeInteger(n))throw Error('残高は安全な整数で入力してください');return n;};
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
function supplierBalance(s,supplierId){
 const supplier=requireRow(s,'suppliers',supplierId);let total=supplier.openingBalance||0;
 for(const tx of rows(s,'supplierTransactions').filter(x=>active(x)&&x.supplierId===supplierId))total+=tx.type==='monthlyInvoice'?-(tx.deductionAmount===undefined?tx.amount:tx.deductionAmount):tx.amount;
 return total;
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
 const alreadyReserved=sum(rows(s,'payments').filter(p=>active(p)&&p.saleId===sale.id));
 if(alreadyReserved+amount>sale.amount)throw Error('入金合計が売上残高を超えるため登録できません');
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
 const existing=sourceKey?rows(s,'documents').find(d=>d.sourceKey===sourceKey&&d.docType===docType):null;
 if(existing){
  if(existing.status!=='active')throw Error('訂正済・取消済帳票の元参照は再発行できません。訂正処理を使用してください');
  const originalSnapshot=clone(existing.snapshot),requested=clone(snapshot);
  delete originalSnapshot.invoiceNo;delete requested.invoiceNo;
  if(existing.amount!==amount||JSON.stringify(originalSnapshot)!==JSON.stringify(requested))throw Error('発行済帳票の修正は訂正版を作成してください');
  return {document:existing,saleId:existing.saleId,paymentId:existing.paymentId,reused:true};
 }
 if(snapshot.invoiceNo)throw Error('新規帳票の正式番号はシステムが採番します');
 snapshot.invoiceNo=Numbering.reserve(rows(s,'documents'),x.issuedAt||new Date());
 let sale=null,pay=null;
 if(docType==='invoice'||docType==='onoda'){
  const source=x.scheduleId?'schedule:'+x.scheduleId:sourceKey?'invoice:'+sourceKey:'document:'+String(s.seq+1);
  sale=registerSale(s,source,{customer,amount,salesDate:x.salesDate||issueDate,invoiceDate:issueDate,description:items.map(i=>i.content).join(' / '),scheduleId:x.scheduleId||''});
  if(sale.amount!==amount)throw Error('関連売上の金額が一致しません');
  if(x.scheduleId){const ev=row(s,'schedule',x.scheduleId);if(ev){
   if(!active(ev))throw Error('取消済みの工事予定に請求書を関連付けられません');
   if(ev.registeredSaleId&&ev.registeredSaleId!==sale.id)throw Error('同じ工事日程に別の売上が登録されています');
   ev.registeredSaleId=sale.id;
  }}
 }
 if(docType==='receipt'){
  if(x.saleId){sale=requireRow(s,'sales',x.saleId);}
  else {
   if(snapshot.paymentMethod!=='現金')throw Error('現金以外の独立領収書は既存売上・入金との明示的な紐付けが必要です');
   sale=registerSale(s,'receipt:'+String(s.seq+1),{customer,amount,salesDate:issueDate,invoiceDate:'',description:snapshot.tadashi||''});
  }
  if(x.paymentId){
   pay=requireRow(s,'payments',x.paymentId);
   if(pay.saleId!==sale.id||pay.amount!==amount||![CASH,BANK_CONFIRMED].includes(pay.confirmation))throw Error('指定した確認済入金と領収書が一致しません');
   if(pay.sourceDocumentId&&pay.sourceDocumentId!==sourceKey)throw Error('別の領収書がすでに発行されています');
   if(snapshot.paymentMethod&&snapshot.paymentMethod!==pay.method)throw Error('入金方法が既存の支払記録と一致しません');
   pay.sourceDocumentId=sourceKey||pay.sourceDocumentId;
  }else{
   pay=payment(s,{saleId:sale.id,amount,method:text(snapshot.paymentMethod,'入金方法'),paymentDate:issueDate,sourceDocumentId:sourceKey||'receipt:'+String(s.seq+1)});
  }
 }
 const doc=write(s,'documents',{id:idFor(s,'doc'),docType,sourceKey,invoiceNo:snapshot.invoiceNo,customer,issueDate,amount,snapshot,items,saleId:sale?.id||'',paymentId:pay?.id||'',scheduleId:x.scheduleId||'',status:'active',revisionOf:''});
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
  const old=row(s,'customers',id);if(old&&!active(old))throw Error('無効な顧客を直接上書きできません');
  if(old&&old.name!==name&&(
   rows(s,'projects').some(p=>active(p)&&p.customer===old.name)||
   rows(s,'sales').some(p=>active(p)&&p.customer===old.name)||
   rows(s,'documents').some(p=>active(p)&&p.customer===old.name)
  ))throw Error('既存帳票・売上に関係する取引先名の変更には専用の訂正手続が必要です');
  a=write(s,'customers',{...old,id,name,address:c.address===undefined?old?.address||'':String(c.address),status:'active'});break;}
 case 'saveProject':{
  const id=c.id||idFor(s,'project');
  a=write(s,'projects',{id,customer:text(c.customer,'顧客'),description:String(c.description||''),status:'active'});break;}
 case 'saveSchedule':{
  const id=c.id||idFor(s,'event'),old=row(s,'schedule',id);
  if(old&&!active(old))throw Error('取消済日程は通常保存で復活できません');
  if(old?.registeredSaleId&&c.projectId&&c.projectId!==old.projectId)throw Error('売上登録済みの工事は案件変更できません');
  a=write(s,'schedule',{...old,id,date:date(c.date,'施工日'),title:text(c.title,'予定名'),customer:c.customer===undefined?old?.customer||'':String(c.customer),description:c.description===undefined?old?.description||'':String(c.description),projectId:String(c.projectId||old?.projectId||''),calendarId:String(c.calendarId||old?.calendarId||''),googleEventId:String(c.googleEventId||old?.googleEventId||''),googleUpdatedAt:c.googleUpdatedAt||old?.googleUpdatedAt||'',googleStatus:c.googleStatus||old?.googleStatus||'confirmed',start:c.start||old?.start||'',end:c.end||old?.end||'',location:c.location===undefined?old?.location||'':String(c.location),registeredSaleId:old?.registeredSaleId||'',status:'active'});break;}
 case 'registerScheduleSale':{
  const ev=requireRow(s,'schedule',c.scheduleId);
  if(ev.registeredSaleId){a=requireRow(s,'sales',ev.registeredSaleId);break;}
  a=registerSale(s,'schedule:'+ev.id,{customer:ev.customer||ev.title,amount:c.amount,salesDate:c.salesDate||ev.date,description:ev.description,scheduleId:ev.id});
  ev.registeredSaleId=a.id;break;}
 case 'acceptEstimate':{
  const estimate=requireRow(s,'documents',c.estimateId);
  if(estimate.docType!=='estimate'||!['active','accepted','accepted-undated'].includes(estimate.status))throw Error('受注できる見積書を選択してください');
  const workDate=c.workDate?date(c.workDate,'施工予定日'):'';
  if(estimate.acceptedScheduleId){
   const ev=requireRow(s,'schedule',estimate.acceptedScheduleId);
   if(!workDate&&ev.date)throw Error('日程確定後の予定日削除は専用変更手続が必要です');
   if(workDate&&ev.date!==workDate){
    if(ev.registeredSaleId)throw Error('売上登録済み予定は工事日を直接変更できません');
    ev.date=workDate;
    const project=row(s,'projects',ev.projectId);
    if(project)project.workDate=workDate;
    estimate.acceptedWorkDate=workDate;
   }
   a={estimateId:estimate.id,projectId:ev.projectId,scheduleId:ev.id,reused:true};break;
  }
  estimate.status=workDate?'accepted':'accepted-undated';
  estimate.acceptedWorkDate=workDate;
  if(!workDate){a={estimateId:estimate.id,projectId:'',scheduleId:'',reused:false};break;}
  const project=write(s,'projects',{id:idFor(s,'project'),customer:estimate.customer,
   estimateId:estimate.id,description:estimate.items.map(x=>x.content||'').filter(Boolean).join(' / '),
   workDate,status:'active'});
  const ev=write(s,'schedule',{id:idFor(s,'event'),date:workDate,title:project.description||'工事予定',
   customer:estimate.customer,description:project.description,projectId:project.id,estimateId:estimate.id,
   documentId:estimate.id,googleEventId:'',calendarId:'',googleUpdatedAt:'',
   googleStatus:'confirmed',registeredSaleId:'',status:'active'});
  estimate.acceptedProjectId=project.id;
  estimate.acceptedScheduleId=ev.id;
  a={estimateId:estimate.id,projectId:project.id,scheduleId:ev.id,reused:false};
  break;
 }
 case 'convertEstimateToInvoice':{
  const estimate=requireRow(s,'documents',c.estimateId);
  if(estimate.docType!=='estimate'||!['active','accepted','accepted-undated'].includes(estimate.status))throw Error('有効な見積書を選択してください');
  const existing=rows(s,'documents').find(d=>d.docType==='invoice'&&d.estimateId===estimate.id);
  if(existing){
   if(!active(existing))throw Error('変換済請求書は無効です。訂正手続が必要です');
   a={document:existing,saleId:existing.saleId,estimateId:estimate.id,reused:true};break;
  }
  const snap=clone(estimate.snapshot);
  delete snap.invoiceNo;
  snap.invoiceDate=date(c.invoiceDate||estimate.issueDate,'請求発行日');
  snap.docType='invoice';
  const originalAmount=yen(estimate.amount);
  a=issue(s,{docType:'invoice',snapshot:snap,amount:originalAmount,
   sourceKey:'converted-estimate:'+estimate.id,
   scheduleId:c.scheduleId||estimate.acceptedScheduleId||estimate.scheduleId||'',salesDate:c.salesDate||snap.invoiceDate,issuedAt:c.issuedAt});
  a.document.estimateId=estimate.id;
  estimate.convertedInvoiceId=a.document.id;
  break;
 }
 case 'issueReceiptForPayment':{
  const pay=requireRow(s,'payments',c.paymentId);
  if(![CASH,BANK_CONFIRMED].includes(pay.confirmation))throw Error('銀行未照合の入金には領収書を発行できません');
  const sale=requireRow(s,'sales',pay.saleId);
  const existing=rows(s,'documents').find(d=>d.docType==='receipt'&&d.paymentId===pay.id);
  if(existing){
   if(!active(existing))throw Error('無効な領収書は再発行できません');
   a={document:existing,saleId:sale.id,paymentId:pay.id,reused:true};break;
  }
  const invoice=rows(s,'documents').find(d=>active(d)&&d.saleId===sale.id&&(d.docType==='invoice'||d.docType==='onoda'));
  const snap={customerName:invoice?.customer||sale.customer,invoiceDate:pay.paymentDate,
   docType:'receipt',receiptTotal:pay.amount,paymentMethod:pay.method,
   tadashi:c.tadashi||sale.description||'工事代金',items:clone(invoice?.items||[]),
   linkedInvoiceId:invoice?.id||''};
  a=issue(s,{docType:'receipt',snapshot:snap,saleId:sale.id,paymentId:pay.id,
   sourceKey:'payment-receipt:'+pay.id,issuedAt:c.issuedAt});
  a.document.linkedInvoiceId=invoice?.id||'';
  break;
 }
 case 'issueDocument':a=issue(s,c);break;
 case 'reviseDocument':{
  const original=requireRow(s,'documents',c.documentId),reason=text(c.reason,'訂正理由');
  if(original.status!=='active')throw Error('有効な原本だけを訂正できます');
  if(c.newSnapshot?.docType&&c.newSnapshot.docType!==original.docType)throw Error('帳票種類を変更できません');
  const snap=clone(c.newSnapshot||{});delete snap.invoiceNo;
  const amount=original.docType==='receipt'?yen(snap.receiptTotal):yen(c.amount);
  if(!amount)throw Error('訂正金額が不正です');
  const customer=text(snap.customerName,'宛名'),newDate=date(snap.invoiceDate,'発行日');
  if(original.saleId){
   const sale=requireRow(s,'sales',original.saleId);
   const confirmed=totalPayments(s,sale.id);
   if(original.docType==='receipt'){
    const pay=requireRow(s,'payments',original.paymentId);
    if(amount!==pay.amount||snap.paymentMethod!==pay.method||newDate!==original.issueDate)throw Error('確定領収書の金額・日付・方法は訂正できません');
   }else{
    if(amount<confirmed)throw Error('訂正後請求額が確認済入金より小さくなります');
    if(amount!==original.amount){
     const reserved=sum(rows(s,'payments').filter(p=>active(p)&&p.saleId===sale.id));
     if(amount<reserved)throw Error('未確定入金も含む予約済金額より少ない金額へ訂正できません');
     sale.amount=amount;
    }
   }
   sale.customer=customer;
  }
  snap.invoiceNo=Numbering.reserve(rows(s,'documents'),c.issuedAt||new Date());
  original.status='revised';original.revisedReason=reason;
  const revised=write(s,'documents',{id:idFor(s,'doc'),docType:original.docType,sourceKey:'revision:'+original.id,invoiceNo:snap.invoiceNo,customer,issueDate:newDate,amount,snapshot:snap,items:clone(snap.items||[]),saleId:original.saleId,paymentId:original.paymentId,scheduleId:original.scheduleId,status:'active',revisionOf:original.id});
  original.revisedTo=revised.id;
  if(original.saleId){const sale=requireRow(s,'sales',original.saleId);sale.documentId=revised.id;}
  if(original.paymentId){const pay=requireRow(s,'payments',original.paymentId);pay.sourceDocumentId=revised.sourceKey;}
  a={document:revised,originalId:original.id,saleId:revised.saleId,paymentId:revised.paymentId};break;}
 case 'voidDocument':{
  const original=requireRow(s,'documents',c.documentId);
  if(original.status!=='active')throw Error('現在有効な帳票以外は無効処理できません');
  text(c.reason,'無効理由');
  if(original.paymentId)throw Error('入金がある領収書は直接無効にできません');
  if(original.saleId){
   if(rows(s,'documents').some(d=>d.id!==original.id&&d.saleId===original.saleId&&d.status==='active'))throw Error('同じ売上を参照する別の有効帳票があるため直接無効にできません');
   const sale=requireRow(s,'sales',original.saleId);
   if(rows(s,'payments').some(p=>active(p)&&p.saleId===sale.id))throw Error('入金を先に整理してください');
   sale.status='void';sale.voidReason=c.reason;
  }
  original.status='void';original.voidReason=c.reason;a=original;break;}
 case 'registerPayment':a=payment(s,c);break;
 case 'saveSupplier':{
  const id=c.id||idFor(s,'supplier'),old=row(s,'suppliers',id);
  if(old&&c.openingBalance!==undefined&&signedYen(c.openingBalance)!==old.openingBalance&&rows(s,'supplierTransactions').some(x=>active(x)&&x.supplierId===id))throw Error('取引後の期首残高変更は訂正処理が必要です');
  a=write(s,'suppliers',{...old,id,name:text(c.name,'仕入先名'),openingBalance:old?.openingBalance??signedYen(c.openingBalance||0),status:'active'});break;}
 case 'settleSupplierInvoice':{
  if(c.reviewed!==true)throw Error('公式請求書と前渡控除額の確認が必要です');
  const supplier=requireRow(s,'suppliers',c.supplierId);
  const month=text(c.invoiceMonth,'請求月');
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('請求月が不正です');
  const invoiceNo=text(c.invoiceNo,'請求書番号');
  const amount=yen(c.amount),deductionAmount=yen(c.deductionAmount);
  if(!amount||deductionAmount>amount)throw Error('請求額・前渡控除額を確認してください');
  const day=date(c.date,'請求日'),sourceHash=String(c.sourceHash||'').trim();
  if(sourceHash&&!/^[0-9a-f]{64}$/.test(sourceHash))throw Error('請求書PDFハッシュを確認してください');
  const id='monthly_'+supplier.id+'_'+month;
  const existing=row(s,'supplierTransactions',id);
  if(existing){
   if(!active(existing)||existing.invoiceNo!==invoiceNo||existing.amount!==amount||
     existing.deductionAmount!==deductionAmount||existing.date!==day||existing.sourceHash!==sourceHash)
     throw Error('既存請求と異なります。専用訂正処理が必要です');
   a={transaction:existing,reused:true,balance:supplierBalance(s,supplier.id)};break;
  }
  if(rows(s,'supplierTransactions').some(tx=>tx.supplierId===supplier.id&&
    (tx.invoiceNo===invoiceNo||(sourceHash&&tx.sourceHash===sourceHash))))
   throw Error('同じ請求番号またはPDFがすでに登録されています');
  if(deductionAmount>Math.max(0,supplierBalance(s,supplier.id)))throw Error('前渡控除額が未使用残高を超えています');
  const description=text(c.description,'材料購入内容');
  const transaction=write(s,'supplierTransactions',{id,supplierId:supplier.id,date:day,
   type:'monthlyInvoice',amount,deductionAmount,invoiceMonth:month,invoiceNo,
   sourceHash,description,paymentMethod:'月締',bankTxnId:'',status:'active'});
  write(s,'expenses',{id:'expense_'+id,expenseDate:day,vendor:supplier.name,
   description,category:'材料費',amount,paymentMethod:'仕入先請求',
   supplierTransactionId:id,bankTxnId:'',status:'active'});
  a={transaction,balance:supplierBalance(s,supplier.id),payable:amount-deductionAmount,reused:false};break;
 }
 case 'recordSupplierTransaction':{
  const supplier=requireRow(s,'suppliers',c.supplierId);
  if(!['prepayment','payment','monthlyInvoice'].includes(c.transactionType))throw Error('仕入先取引区分が不正です');
  const amount=yen(c.amount);if(!amount)throw Error('仕入先取引金額は正数です');
  const day=date(c.date,'取引日'),month=c.invoiceMonth||day.slice(0,7);
  if(c.transactionType==='monthlyInvoice'&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('請求対象月が不正です');
  const id=c.transactionType==='monthlyInvoice'?'monthly_'+supplier.id+'_'+month:c.transactionId||idFor(s,'supplierTx');
  const prev=row(s,'supplierTransactions',id);
  if(prev){if(prev.amount!==amount||prev.date!==day||prev.type!==c.transactionType)throw Error('既存の仕入先取引と一致しません（訂正が必要）');a={transaction:prev,balance:supplierBalance(s,supplier.id),reused:true};break;}
  const transaction=write(s,'supplierTransactions',{id,supplierId:supplier.id,date:day,type:c.transactionType,amount,invoiceMonth:c.transactionType==='monthlyInvoice'?month:'',paymentMethod:c.transactionType==='monthlyInvoice'?'未払':text(c.paymentMethod,'支払方法'),bankTxnId:'',description:String(c.description||''),status:'active'});
  if(transaction.type==='monthlyInvoice'){
    const eid='expense_'+id;
    write(s,'expenses',{id:eid,expenseDate:day,vendor:supplier.name,description:c.description||month+'月分 材料請求',category:'材料費',amount,paymentMethod:'仕入先請求',supplierTransactionId:id,bankTxnId:'',status:'active'});
  }else if(transaction.paymentMethod==='現金'){
    write(s,'cashLedger',{id:'cash_'+id,type:'expense',date:day,amount,sourceType:'supplierTransactions',sourceId:id,deletedAt:null});
  }
  a={transaction,balance:supplierBalance(s,supplier.id),reused:false};break;}
 case 'saveExpense':{
  const amount=yen(c.amount);if(!amount)throw Error('支出金額は正数です');
  const id=c.id||idFor(s,'exp'),old=row(s,'expenses',id);
  if(old?.bankTxnId)throw Error('銀行照合を解除してから支出を訂正してください');
  if(old?.supplierTransactionId)throw Error('仕入先請求に連動する支出は仕入先台帳から訂正してください');
  if(old&&!active(old))throw Error('取消済支出は通常保存で復活できません');
  a=write(s,'expenses',{...old,id,expenseDate:date(c.expenseDate,'支出日'),vendor:text(c.vendor,'取引先'),description:String(c.description||''),category:text(c.category,'科目'),amount,paymentMethod:text(c.paymentMethod,'支払方法'),bankTxnId:'',status:'active'});
  mirrorCash(s,'expenses',a);break;}
 case 'importBankTransaction':{
  const account=text(c.account,'銀行口座'),externalId=text(c.externalId,'銀行明細識別子');
  const match=rows(s,'bankTransactions').find(b=>b.account===account&&b.externalId===externalId);
  const amount=yen(c.amount);if(!amount)throw Error('銀行金額は正数です');
  if(match){if(match.amount!==amount||match.direction!==c.direction||match.date!==date(c.date,'銀行日付')||match.description!==String(c.description||''))throw Error('同じ銀行明細識別子の内容が異なります');a={transaction:match,reused:true};break;}
  if(!['income','outgoing'].includes(c.direction))throw Error('入出金区分が不正です');
  const transaction=write(s,'bankTransactions',{id:idFor(s,'bank'),account,externalId,date:date(c.date,'銀行日付'),description:String(c.description||''),amount,direction:c.direction,balance:c.balance??null,memo:String(c.memo||''),occurrence:c.occurrence||1,confidence:c.confidence||'review',rawDescription:String(c.rawDescription||''),matchType:'',matchId:'',status:'unmatched'});
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
 case 'matchBankSupplier':{
  const b=requireRow(s,'bankTransactions',c.bankTxnId),tx=requireRow(s,'supplierTransactions',c.transactionId);
  if(b.direction!=='outgoing'||b.status!=='unmatched'||tx.paymentMethod==='現金'||tx.type==='monthlyInvoice'||tx.bankTxnId||b.amount!==tx.amount)throw Error('仕入先送金の照合条件が一致しません');
  b.status='matched';b.matchType='supplier';b.matchId=tx.id;tx.bankTxnId=b.id;a={bank:b,transaction:tx};break;}
 case 'unmatchBank':{
  const b=requireRow(s,'bankTransactions',c.bankTxnId);
  if(b.status!=='matched')throw Error('未照合の明細です');
  if(b.matchType==='payment'){const p=requireRow(s,'payments',b.matchId);p.bankTxnId='';p.confirmation=BANK_PENDING;}
  if(b.matchType==='expense'){const e=requireRow(s,'expenses',b.matchId);e.bankTxnId='';}
  if(b.matchType==='supplier'){const tx=requireRow(s,'supplierTransactions',b.matchId);tx.bankTxnId='';}
  b.status='unmatched';b.matchType='';b.matchId='';a=b;break;}
 case 'voidRecord':{
  if(!['documents','sales','payments','expenses','schedule','projects','customers'].includes(c.collection))throw Error('取消対象外です');
  const target=requireRow(s,c.collection,c.id);text(c.reason,'取消理由');
  if(c.collection==='sales'&&rows(s,'payments').some(p=>active(p)&&p.saleId===target.id))throw Error('登録済入金がある売上は未確認分を含め先に整理してください');
  if(c.collection==='payments'&&target.bankTxnId)throw Error('銀行照合を先に解除してください');
  if(c.collection==='expenses'&&target.bankTxnId)throw Error('銀行照合済支出は照合解除してから取消してください');
  if(c.collection==='customers'&&(
   rows(s,'projects').some(p=>active(p)&&p.customer===target.name)||
   rows(s,'sales').some(p=>active(p)&&p.customer===target.name)||
   rows(s,'documents').some(p=>active(p)&&p.customer===target.name)
  ))throw Error('関連する帳票・売上・案件のある取引先は直接取消できません');
  if(c.collection==='payments'&&rows(s,'documents').some(d=>d.paymentId===target.id&&active(d)))throw Error('領収書と関連する入金は先に専用訂正処理が必要です');
  if(c.collection==='documents'&&(target.saleId||target.paymentId))throw Error('売上・入金と関連する正式帳票は専用の訂正・取消処理が必要です');
  if(c.collection==='sales'&&rows(s,'documents').some(d=>active(d)&&d.saleId===target.id))throw Error('発行済帳票と関連する売上は直接取消できません');
  if(c.collection==='schedule'&&target.registeredSaleId)throw Error('売上登録済みの予定は直接削除できません');
  if(c.collection==='projects'&&rows(s,'schedule').some(e=>active(e)&&e.projectId===target.id))throw Error('紐付け予定がある案件は直接取消できません');
  if(c.collection==='schedule'&&rows(s,'documents').some(d=>active(d)&&d.scheduleId===target.id))throw Error('発行済帳票に関連する予定は直接取消できません');
  target.status='void';target.voidReason=c.reason;
  if(c.collection==='payments')mirrorCash(s,'payments',target);
  if(c.collection==='expenses')mirrorCash(s,'expenses',target);
  a=target;break;}
 case 'restoreRecord':{
  if(!['customers','schedule','expenses'].includes(c.collection))throw Error('復元できない記録です');
  const target=row(s,c.collection,c.id);
  if(!target||target.status!=='void')throw Error('取消済みの対象が必要です');
  if(!c.confirmRestore)throw Error('復元の明示確認が必要です');
  if(c.collection==='expenses'&&target.bankTxnId)throw Error('銀行照合済み支出は復元できません');
  target.status='active';delete target.voidReason;
  if(c.collection==='expenses')mirrorCash(s,'expenses',target);
  a=target;break;
 }
 case 'deleteTestRecord':{
  if(s.scope!=='test')throw Error('正式データを物理削除できません');
  if(!c.confirmTestDeletion)throw Error('テスト削除を明示確認してください');
  if(!COLLECTIONS.includes(c.collection)||c.collection==='auditLogs')throw Error('削除できない種別です');
  const target=requireRow(s,c.collection,c.id);
  const related={suppliers:()=>rows(s,'supplierTransactions').some(p=>active(p)&&p.supplierId===target.id),
    supplierTransactions:()=>rows(s,'expenses').some(p=>active(p)&&p.supplierTransactionId===target.id)||rows(s,'cashLedger').some(p=>active(p)&&p.sourceId===target.id)||!!target.bankTxnId,
    sales:()=>rows(s,'payments').some(p=>active(p)&&p.saleId===target.id),
    payments:()=>rows(s,'cashLedger').some(p=>active(p)&&p.sourceId===target.id)||rows(s,'documents').some(d=>d.paymentId===target.id),
    expenses:()=>rows(s,'cashLedger').some(p=>active(p)&&p.sourceId===target.id),
    documents:()=>rows(s,'sales').some(p=>active(p)&&p.documentId===target.id)||rows(s,'payments').some(p=>active(p)&&p.sourceDocumentId===target.sourceKey)||rows(s,'documents').some(d=>d.id!==target.id&&(d.estimateId===target.id||d.linkedInvoiceId===target.id||d.revisionOf===target.id)),
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
 if(state.operationIds[operationId]){
  const previous=state.operationIds[operationId];
  if(previous.type!==c.type||previous.command&&JSON.stringify(previous.command)!==JSON.stringify(c))throw Error('同じ操作IDで異なる内容を保存できません');
  return {state:clone(state),result:clone(previous.result),reused:true};
 }
 const candidate=clone(state);const result=operate(candidate,c);
 candidate.operationIds[operationId]={result:clone(result),type:c.type,command:clone(c)};
 write(candidate,'auditLogs',{id:idFor(candidate,'audit'),operationId,action:c.type,targetId:result?.id||result?.document?.id||result?.payment?.id||result?.deletedId||'',scope:candidate.scope});
 return {state:candidate,result:clone(result),reused:false};
}
function getOverview(s){
 assertState(s);const sales=rows(s,'sales').filter(active),expenses=rows(s,'expenses').filter(active),payments=rows(s,'payments').filter(p=>active(p)&&[CASH,BANK_CONFIRMED].includes(p.confirmation));
 const cash=rows(s,'cashLedger').filter(active);
 return {sales:sum(sales),confirmedPayments:sum(payments),outstanding:sales.reduce((n,x)=>n+x.amount-totalPayments(s,x.id),0),expenses:sum(expenses),cashIn:sum(cash.filter(x=>x.type==='income')),cashOut:sum(cash.filter(x=>x.type==='expense')),salesCount:sales.length,expenseCount:expenses.length};
}
function list(s,collection){assertState(s);if(!COLLECTIONS.includes(collection))throw Error('Unsupported collection');return clone(rows(s,collection));}
return {COLLECTIONS,TYPES,emptyState,perform,list,getOverview,balance,supplierBalance};
});
