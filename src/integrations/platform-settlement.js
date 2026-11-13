/* Platform payouts are evidence; never derive sales directly from net deposits.
 * No hard-coded Stripe / NP / ATO fee rates: official statement lines are authoritative.
 * amounts are JPY integers. A payout may span sales periods.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TsukinowaPlatformSettlement=api;})(globalThis,function(){
'use strict';
const METHODS=Object.freeze(['stripe','np','ato']);
const int=(v,name)=>{if(!Number.isSafeInteger(v)||v<0)throw Error(name+' は0以上の整数円が必要です');return v};
const required=(v,name)=>{const s=String(v??'').trim();if(!s)throw Error(name+' が必要です');return s};
const add=(x,y)=>{const r=x+y;if(!Number.isSafeInteger(r))throw Error('集計金額の整数精度を超えました');return r};
function normalizeStatement(input){
 const provider=String(input.provider||'').trim().toLowerCase();
 if(!METHODS.includes(provider))throw Error('プラットフォーム種別が不正です');
 const id=required(input.statementId,'プラットフォーム明細ID');
 const lines=input.lines;
 if(!Array.isArray(lines)||!lines.length)throw Error('公式精算明細の取引行が必要です');
 const refs=new Set();
 const normalized=lines.map((line,index)=>{
  const sourceId=required(line.sourceId,'取引ID');
  if(refs.has(sourceId))throw Error('同一精算明細内に取引IDが重複しています');refs.add(sourceId);
  const gross=int(line.gross,'売上元金'),refund=int(line.refund||0,'返金'),
        fee=int(line.fee||0,'手数料'),adjustment=Number(line.adjustment||0);
  if(!Number.isSafeInteger(adjustment))throw Error('その他調整額が不正です');
  if(refund>gross)throw Error('取引の返金が元金より多くなっています');
  return {sourceId,gross,refund,fee,adjustment,orderId:String(line.orderId||'').trim(),
    settlementRef:String(line.settlementRef||'').trim(),row:index+1};
 });
 return {provider,statementId:id,periodStart:input.periodStart||'',periodEnd:input.periodEnd||'',lines:normalized,
   officialNet:int(input.officialNet,'公式精算の純額'),currency:input.currency||'JPY'};
}
function reconcile(statement,{orders=[],deposits=[]}={}){
 const s=normalizeStatement(statement);
 if(s.currency!=='JPY')throw Error('外貨精算は別途換算明細が必要です');
 const totals=s.lines.reduce((t,l)=>{
  t.gross=add(t.gross,l.gross);t.refunds=add(t.refunds,l.refund);
  t.fees=add(t.fees,l.fee);t.adjustments=add(t.adjustments,l.adjustment);return t;
 },{gross:0,refunds:0,fees:0,adjustments:0});
 totals.calculatedNet=totals.gross-totals.refunds-totals.fees+totals.adjustments;
 const bank=deposits.filter(d=>d.provider===s.provider&&d.statementId===s.statementId);
 const deposited=bank.reduce((n,d)=>add(n,int(d.amount,'入金額')),0);
 const orderMap=new Map(orders.map(x=>[x.id,x]));
 const unresolved=[],matched=[];
 for(const l of s.lines){
  const order=orderMap.get(l.orderId);
  if(!l.orderId||!order){unresolved.push({sourceId:l.sourceId,reason:'注文記録の明示的な関連がありません'});continue;}
  if(int(order.gross,'注文金額')!==l.gross){unresolved.push({sourceId:l.sourceId,reason:'公式明細と元注文金額が一致しません'});continue;}
  matched.push({sourceId:l.sourceId,orderId:l.orderId});
 }
 const differences={
   officialVsCalculated:s.officialNet-totals.calculatedNet,
   officialVsBank:s.officialNet-deposited
 };
 const status=differences.officialVsCalculated===0&&differences.officialVsBank===0&&unresolved.length===0?'reconciled':'review';
 return {provider:s.provider,statementId:s.statementId,periodStart:s.periodStart,periodEnd:s.periodEnd,
   totals,officialNet:s.officialNet,bankNet:deposited,differences,matched,unresolved,status,
   postingRules:{sales:'订单所指向的已确认売上；仅关联不新增',fee:'平台费用独立登记一次',payout:'净到账关联应收结算款；不新建売上'}};
}
return {METHODS,normalizeStatement,reconcile};
});
