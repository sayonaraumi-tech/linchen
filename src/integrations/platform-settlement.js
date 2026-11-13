/* Monthly platform reconciliation, strictly READ ONLY.
 * NP: monthly official commission invoice -> GMO bank automatic DEBIT.
 * Stripe/ATO: monthly official settlement -> aggregated bank PAYOUT.
 * Never create/edit sales, payments, expenses or banking transactions here.
 * This file contains neither SDK nor domain command imports.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.TsukinowaPlatformSettlement=api;
})(globalThis,function(){
'use strict';
const PROVIDERS=Object.freeze(['np','stripe','ato']);
const positiveInt=(n,label)=>{if(!Number.isSafeInteger(n)||n<0)throw Error(label+'は0以上の整数円が必要です');return n;};
const signedInt=(n,label)=>{if(!Number.isSafeInteger(n))throw Error(label+'は整数円が必要です');return n;};
const required=(x,label)=>{const s=String(x??'').trim();if(!s)throw Error(label+'が必要です');return s;};
const sum=(xs)=>xs.reduce((n,x)=>{const v=n+x;if(!Number.isSafeInteger(v))throw Error('合計が上限を超えています');return v;},0);
const verifyPeriod=p=>{const period=required(p,'対象年月');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw Error('対象年月はYYYY-MMで指定してください');return period;};
const verifyProvider=p=>{const provider=required(p,'決済方法').toLowerCase();if(!PROVIDERS.includes(provider))throw Error('対応していない決済方法です');return provider;};
const money=(x,k)=>x===undefined||x===null?null:positiveInt(x,k);
const createResult=(provider,period)=>({provider,period,mode:provider==='np'?'monthly-auto-debit':'monthly-bank-payout',readOnly:true,accountingWrites:0,issues:[]});
function bankRows(rows,{account,direction}){
 if(!Array.isArray(rows))throw Error('銀行証拠の形式が不正です');
 return rows.map((r,i)=>{
  if(!r||!r.id)throw Error('銀行明細IDがありません: '+(i+1));
  if(r.account!==account||r.direction!==direction)throw Error('異なる口座または入出金方向が含まれます');
  return {id:String(r.id),amount:positiveInt(r.amount,'銀行金額'),date:String(r.date||'')};
 });
}
function reconcileMonth(data){
 if(!data||typeof data!=='object')throw Error('月次核対の資料が必要です');
 const provider=verifyProvider(data.provider),period=verifyPeriod(data.period);
 const result=createResult(provider,period);
 const source=data.official;
 if(!source||!source.documentId)throw Error('公式請求書／精算明細のIDが必要です');
 result.source={documentId:required(source.documentId,'公式証憑ID'),period,account:String(data.account||'')};
 if(!result.source.account)throw Error('銀行口座の指定が必要です');
 if(provider==='np'){
  const invoiceFee=positiveInt(source.feeTotal,'NP公式手数料');
  const rows=bankRows(data.bankDebits||[],{account:result.source.account,direction:'outgoing'});
  const withdrawn=rows.length?sum(rows.map(r=>r.amount)):null;
  const expected=money(data.expectedFee,'内部見込手数料');
  result.officialFee=invoiceFee;result.actualBankAmount=withdrawn;result.bankEvidenceIds=rows.map(r=>r.id);
  result.bankDifference=withdrawn===null?null:withdrawn-invoiceFee;
  result.feeDifference=expected===null?null:invoiceFee-expected;
  result.expectedFee=expected;
  if(withdrawn===null)result.issues.push('銀行自動引落明細が未登録');
  else if(result.bankDifference!==0)result.issues.push('銀行引落額とNP公式請求額が不一致');
  if(expected!==null&&result.feeDifference!==0)result.issues.push('公式手数料と内部見込額に差額');
 }else{
  // Net payout is already one monthly transfer (or explicitly linked split transfers).
  // No per-transaction bank posting or accounting operation is performed.
  const gross=positiveInt(source.gross,'公式月間取引合計');
  const refunds=positiveInt(source.refunds||0,'公式返金');
  const fee=positiveInt(source.feeTotal,'公式手数料');
  const adjustments=signedInt(source.adjustments||0,'公式調整額');
  const net=positiveInt(source.netPayout,'公式月間入金予定額');
  const computed=gross-refunds-fee+adjustments;
  if(!Number.isSafeInteger(computed))throw Error('公式合計計算が上限を超えています');
  const rows=bankRows(data.bankPayouts||[],{account:result.source.account,direction:'income'});
  const deposited=rows.length?sum(rows.map(r=>r.amount)):null;
  const expected=money(data.expectedFee,'内部見込手数料');
  result.officialFee=fee;result.expectedFee=expected;
  result.feeDifference=expected===null?null:fee-expected;
  result.officialNet=net;result.calculatedNet=computed;result.netDifference=net-computed;
  result.actualBankAmount=deposited;result.bankDifference=deposited===null?null:deposited-net;
  result.bankEvidenceIds=rows.map(r=>r.id);
  if(result.netDifference!==0)result.issues.push('公式明細内の入金計算が不一致');
  if(deposited===null)result.issues.push('月次銀行入金が未確認');
  else if(result.bankDifference!==0)result.issues.push('公式入金予定額と銀行入金合計が不一致');
  if(expected!==null&&result.feeDifference!==0)result.issues.push('公式手数料と内部見込額に差額');
 }
 result.status=result.issues.length?'review':'matched';
 return result;
}
function monthlyReport(records){
 if(!Array.isArray(records))throw Error('月次記録の形式が不正です');
 const keys=new Set();const results=[];
 for(const row of records){
  const x=reconcileMonth(row);
  const key=x.period+'|'+x.provider+'|'+x.source.account;
  if(keys.has(key))throw Error('同一月、平台、銀行口座が重複: '+key);
  keys.add(key);results.push(x);
 }
 return results.sort((a,b)=>a.period.localeCompare(b.period)||a.provider.localeCompare(b.provider));
}
return {PROVIDERS,reconcileMonth,monthlyReport};
});